// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

#[cfg(target_os = "macos")]
mod menu;

use tauri_plugin_stronghold::TauriStronghold;

fn main() {
  let builder = tauri::Builder::default()
    .plugin(TauriStronghold::default())
    .invoke_handler(tauri::generate_handler![commands::generate_totp]);

  // Needed on macOS to enable basic operations, like copy & paste and select-all via keyboard shortcuts.
  #[cfg(target_os = "macos")]
  let builder = builder.menu(menu::menu());

  builder
    .run(tauri::generate_context!())
    .expect("error while running application");
}
