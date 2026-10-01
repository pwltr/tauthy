// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(all(feature = "migration-test", feature = "isolated-preview"))]
compile_error!("migration-test and isolated-preview cannot be enabled together");

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

mod aegis;
mod commands;
mod diagnostics;
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

#[cfg(target_os = "macos")]
#[derive(Default)]
struct StartupVisibility(AtomicBool);

#[cfg(target_os = "macos")]
fn startup_background(value: &str) -> Result<tauri::window::Color, String> {
  let hex = value
    .strip_prefix('#')
    .filter(|hex| hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .ok_or_else(|| "invalid startup background".to_string())?;
  let channel = |index| {
    u8::from_str_radix(&hex[index..index + 2], 16)
      .map_err(|_| "invalid startup background".to_string())
  };
  Ok(tauri::window::Color(
    channel(0)?,
    channel(2)?,
    channel(4)?,
    255,
  ))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn startup_ready(
  window: tauri::WebviewWindow,
  visibility: tauri::State<'_, StartupVisibility>,
  background: String,
) -> Result<(), String> {
  let color = startup_background(&background)?;
  window
    .set_background_color(Some(color))
    .map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  visibility.0.store(true, Ordering::Release);
  Ok(())
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

  #[cfg(target_os = "macos")]
  let builder = builder.manage(StartupVisibility::default());

  let builder = builder
    .manage(sync::PubkySyncState::default())
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

  // Isolated apps must never install a production update over themselves.
  #[cfg(not(any(feature = "migration-test", feature = "isolated-preview")))]
  let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

  let builder = builder.invoke_handler(tauri::generate_handler![
    #[cfg(target_os = "macos")]
    startup_ready,
    #[cfg(feature = "migration-test")]
    migration_test::import_diagnostic,
    aegis::decrypt_aegis_vault,
    ente::decrypt_ente_export,
    proton::decrypt_proton_export,
    commands::generate_totp,
    commands::generate_totps,
    diagnostics::diagnostics_record,
    diagnostics::diagnostics_export,
    #[cfg(target_os = "macos")]
    menu::menu_set_enabled,
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
    sync::pubky_sync_start,
    sync::pubky_sync_poll,
    sync::pubky_sync_cancel,
    sync::pubky_sync_create,
    sync::pubky_sync_join,
    sync::pubky_sync_recovery_code,
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
      // Diagnostics are best-effort: a log-directory problem must never block
      // access to the vault. Only fixed event identifiers can enter the log.
      let diagnostics = app
        .path()
        .app_log_dir()
        .ok()
        .and_then(|path| diagnostics::Diagnostics::new(&path).ok())
        .unwrap_or_else(diagnostics::Diagnostics::memory_only);
      let _ = diagnostics.record("app.start", None);
      app.manage(diagnostics);
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
      if cfg!(feature = "isolated-preview")
        != (app.config().identifier == "com.pwltr.tauthy.preview")
      {
        return Err(
          std::io::Error::other(
            "isolated-preview feature and isolated app configuration must be used together",
          )
          .into(),
        );
      }
      #[cfg(feature = "file-vault")]
      {
        #[cfg(not(any(feature = "migration-test", feature = "isolated-preview")))]
        let name = if cfg!(debug_assertions) {
          "tauthy-dev"
        } else {
          "tauthy"
        };
        #[cfg(feature = "isolated-preview")]
        let name = if cfg!(debug_assertions) {
          "tauthy-preview-dev"
        } else {
          "tauthy-preview"
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
      #[cfg(target_os = "macos")]
      {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_secs(5));
          if !handle
            .state::<StartupVisibility>()
            .0
            .load(Ordering::Acquire)
          {
            // A frontend failure must not strand the only app window hidden.
            if let Some(window) = handle.get_webview_window("main") {
              let _ = window.show();
            }
          }
        });
      }
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

  let mut context = tauri::generate_context!();
  #[cfg(target_os = "macos")]
  if let Some(window) = context
    .config_mut()
    .app
    .windows
    .iter_mut()
    .find(|window| window.label == "main")
  {
    window.visible = false;
  }
  builder
    .run(context)
    .expect("error while running application");
}

#[cfg(test)]
mod tests {
  use super::protect_window_content;
  #[cfg(target_os = "macos")]
  use super::startup_background;

  #[test]
  fn screen_capture_policy_matches_the_build() {
    if cfg!(debug_assertions) {
      assert!(!protect_window_content());
    } else {
      assert!(protect_window_content());
    }
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn startup_background_accepts_only_hex_colors() {
    assert_eq!(
      startup_background("#1e1e1e").unwrap(),
      tauri::window::Color(30, 30, 30, 255)
    );
    assert!(startup_background("white").is_err());
    assert!(startup_background("#ffffff00").is_err());
    assert!(startup_background("#fff;url(x)").is_err());
  }
}
