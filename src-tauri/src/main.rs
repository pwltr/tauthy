// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod aegis;
mod commands;
mod ente;
#[cfg_attr(feature = "file-vault", allow(dead_code))]
mod legacy_vault;
#[cfg(feature = "migration-test")]
mod migration_test;
mod otp;
mod proton;
mod sync;
mod tauthy_backup;
mod tray;
mod twofas;
mod vault_access;
#[allow(dead_code)]
mod vault_commands;
// File storage is the default. Legacy commands remain available only in builds
// using --no-default-features; the legacy reader is still used for migration.
#[allow(dead_code)]
mod vault_credentials;
#[allow(dead_code)]
mod vault_file;
#[allow(dead_code)]
mod vault_fs;
#[allow(dead_code)]
mod vault_journal;
#[allow(dead_code)]
mod vault_metadata;
#[allow(dead_code)]
mod vault_runtime;
#[allow(dead_code)]
mod vault_transaction;

#[cfg(not(feature = "file-vault"))]
use legacy_vault as application_commands;
#[cfg(feature = "file-vault")]
use vault_commands as application_commands;

#[cfg(target_os = "macos")]
mod menu;

fn protect_window_content() -> bool {
  !cfg!(debug_assertions)
}

fn main() {
  let builder = tauri::Builder::default();

  // Register this first so duplicate launches are stopped before any other
  // plugin or vault initialization can run.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    tray::show_main_window(app);
  }));

  #[cfg(not(feature = "file-vault"))]
  let builder = builder.manage(legacy_vault::VaultState::default());

  let builder = builder
    .manage(tray::TrayLabelState::default())
    .manage(tray::TrayMenuState::default())
    .manage(tray::TrayEnabledState::default())
    .manage(tray::TrayFeedbackState::default())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init());

  // A disposable test app must never install a production update over itself.
  #[cfg(not(feature = "migration-test"))]
  let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

  let builder = builder.invoke_handler(tauri::generate_handler![
    #[cfg(feature = "migration-test")]
    migration_test::import_diagnostic,
    aegis::decrypt_aegis_vault,
    ente::decrypt_ente_export,
    proton::decrypt_proton_export,
    commands::generate_totp,
    commands::generate_totps,
    #[cfg(feature = "file-vault")]
    vault_commands::vault_initialize,
    #[cfg(feature = "file-vault")]
    vault_commands::vault_create,
    #[cfg(feature = "file-vault")]
    vault_commands::vault_migrate,
    #[cfg(feature = "file-vault")]
    vault_commands::vault_delete,
    #[cfg(feature = "file-vault")]
    vault_commands::vault_import_foreign,
    application_commands::vault_load,
    application_commands::vault_change_password,
    application_commands::vault_get,
    application_commands::vault_save,
    application_commands::vault_unload,
    vault_commands::vault_backend,
    application_commands::vault_status,
    sync::sync_create,
    sync::sync_disconnect,
    sync::sync_join,
    sync::sync_merge_conflicted_copy,
    sync::sync_now,
    sync::sync_status,
    tauthy_backup::decrypt_tauthy_backup,
    tauthy_backup::encrypt_tauthy_backup,
    twofas::decrypt_twofas_backup,
    tray::tray_configure,
  ]);

  let builder = builder
    .setup(|app| {
      if cfg!(feature = "migration-test")
        != (app.config().identifier == "com.pwltr.tauthy.migrationtest")
      {
        return Err(
          std::io::Error::other(
            "migration-test feature and isolated app configuration must be used together",
          )
          .into(),
        );
      }
      #[cfg(feature = "file-vault")]
      {
        #[cfg(not(feature = "migration-test"))]
        let name = if cfg!(debug_assertions) {
          "tauthy-dev"
        } else {
          "tauthy"
        };
        #[cfg(not(feature = "migration-test"))]
        let directory = app.path().data_dir()?.join(name);
        #[cfg(feature = "migration-test")]
        let directory = migration_test::prepare_directory(&app.path().data_dir()?)?;
        std::fs::create_dir_all(&directory)?;
        #[cfg(feature = "migration-test")]
        app.manage(migration_test::ImportDiagnostics::new(&directory)?);
        app.manage(vault_commands::FileVaultState::new(directory));
      }
      // Release builds keep account codes out of screenshots and screen sharing.
      // Development builds remain capturable for visual QA.
      app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::other("main window is unavailable"))?
        .set_content_protected(protect_window_content())?;
      // Needed on macOS to enable basic operations, like copy & paste and select-all via keyboard shortcuts.
      #[cfg(target_os = "macos")]
      menu::setup(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      if window.label() == "main" && tray::is_enabled(window.app_handle()) {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    });

  builder
    .run(tauri::generate_context!())
    .expect("error while running application");
}

#[cfg(test)]
mod tests {
  use super::protect_window_content;

  #[test]
  fn screen_capture_policy_matches_the_build() {
    if cfg!(debug_assertions) {
      assert!(!protect_window_content());
    } else {
      assert!(protect_window_content());
    }
  }
}
