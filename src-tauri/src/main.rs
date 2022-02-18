#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod commands;

use tauri_plugin_stronghold::TauriStronghold;

fn main() {
  tauri::Builder::default()
    .plugin(TauriStronghold::default())
    .invoke_handler(tauri::generate_handler![commands::generate_totp])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
