// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod aegis;
mod commands;
mod ente;
mod legacy_vault;
mod otp;
mod sync;
mod tauthy_backup;
mod tray;
mod twofas;

#[cfg(target_os = "macos")]
mod menu;

fn main() {
  let builder = tauri::Builder::default();

  // Register this first so duplicate launches are stopped before any other
  // plugin or vault initialization can run.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    tray::show_main_window(app);
  }));

  let builder = builder
    .manage(legacy_vault::VaultState::default())
    .manage(tray::TrayLabelState::default())
    .manage(tray::TrayMenuState::default())
    .manage(tray::TrayEnabledState::default())
    .manage(tray::TrayFeedbackState::default())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      aegis::decrypt_aegis_vault,
      ente::decrypt_ente_export,
      commands::generate_totp,
      commands::generate_totps,
      legacy_vault::vault_load,
      legacy_vault::vault_change_password,
      legacy_vault::vault_get,
      legacy_vault::vault_save,
      legacy_vault::vault_unload,
      legacy_vault::vault_status,
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
