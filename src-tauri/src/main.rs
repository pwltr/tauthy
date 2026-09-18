// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod legacy_vault;
mod otp;

#[cfg(target_os = "macos")]
mod menu;

fn main() {
  let builder = tauri::Builder::default();

  // Register this first so duplicate launches are stopped before any other
  // plugin or vault initialization can run.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.show();
      let _ = window.set_focus();
    }
  }));

  let builder = builder
    .manage(legacy_vault::VaultState::default())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      commands::generate_totp,
      commands::generate_totps,
      legacy_vault::vault_load,
      legacy_vault::vault_get,
      legacy_vault::vault_save,
      legacy_vault::vault_unload,
      legacy_vault::vault_status,
    ]);

  let builder = builder.setup(|app| {
    // Keep secrets out of screen captures in production. Debug builds and
    // explicitly marked test builds remain capturable for UI verification.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if !cfg!(debug_assertions) && option_env!("TAUTHY_ALLOW_SCREENSHOTS").is_none() {
      use tauri::Manager;

      if let Some(window) = app.get_webview_window("main") {
        window.set_content_protected(true)?;
      }
    }

    // Needed on macOS to enable basic operations, like copy & paste and select-all via keyboard shortcuts.
    #[cfg(target_os = "macos")]
    menu::setup(app)?;

    Ok(())
  });

  builder
    .run(tauri::generate_context!())
    .expect("error while running application");
}
