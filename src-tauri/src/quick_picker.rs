//! A macOS quick-copy window. Secrets never cross this window's IPC boundary.
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

use objc2_app_kit::{
  NSApplicationActivationOptions, NSColor, NSRunningApplication, NSWindow, NSWorkspace,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use zeroize::{Zeroize, Zeroizing};

use crate::vault_access::{ApplicationVault, VaultAccess};

const LABEL: &str = "quick-picker";
const SHORTCUT: &str = "Command+Shift+C";
// Match the panel's CSS radius so its border follows the native window mask.
const CORNER_RADIUS: f64 = 16.0;

#[derive(Default)]
pub(crate) struct PickerState {
  ready: AtomicBool,
  requested: AtomicBool,
  previous_app: AtomicI32,
}

#[derive(Deserialize)]
struct Account {
  uuid: String,
  name: String,
  issuer: Option<String>,
  group: Option<String>,
  icon: Option<String>,
  secret: String,
}

impl Drop for Account {
  fn drop(&mut self) {
    self.secret.zeroize();
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickerEntry {
  uuid: String,
  name: String,
  issuer: Option<String>,
  group: Option<String>,
  icon: Option<String>,
  code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
  locked: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  entries: Option<Vec<PickerEntry>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  codes: Option<Vec<PickerCode>>,
  expires_at_ms: Option<u64>,
}

#[derive(Serialize)]
struct PickerCode {
  uuid: String,
  code: Option<String>,
}

fn accounts(records: &dyn crate::vault_access::RecordAccess) -> Result<Vec<Account>, String> {
  let record = Zeroizing::new(
    records
      .get_record(b"vault")?
      .unwrap_or_else(|| b"[]".to_vec()),
  );
  serde_json::from_slice(&record).map_err(|_| "Unable to read accounts".into())
}

fn snapshot(vault: &impl VaultAccess, include_metadata: bool) -> Result<Snapshot, String> {
  let result = vault.with_records(|records| {
    let accounts = accounts(records)?;
    let generated =
      crate::commands::generate_totps_for(accounts.iter().map(|entry| entry.secret.as_str()))?;
    let expires_at_ms = Some(generated.expires_at_ms);
    if !include_metadata {
      return Ok(Snapshot {
        locked: false,
        entries: None,
        codes: Some(
          accounts
            .iter()
            .zip(generated.codes)
            .map(|(entry, code)| PickerCode {
              uuid: entry.uuid.clone(),
              code,
            })
            .collect(),
        ),
        expires_at_ms,
      });
    }
    let entries = accounts
      .iter()
      .zip(generated.codes)
      .map(|(entry, code)| PickerEntry {
        uuid: entry.uuid.clone(),
        name: entry.name.clone(),
        issuer: entry.issuer.clone(),
        group: entry.group.clone(),
        icon: entry.icon.clone(),
        code,
      })
      .collect();
    Ok(Snapshot {
      locked: false,
      entries: Some(entries),
      codes: None,
      expires_at_ms,
    })
  });
  match result {
    Err(error) if error == "vault is locked" => Ok(Snapshot {
      locked: true,
      entries: Some(vec![]),
      codes: None,
      expires_at_ms: None,
    }),
    result => result,
  }
}

fn copy_code(
  vault: &impl VaultAccess,
  uuid: &str,
  write: impl FnOnce(String) -> Result<(), String>,
) -> Result<(), String> {
  // Hold the vault's serialized scope until the clipboard write completes.
  // A concurrent lock cannot leave a cached secret/code available for copying.
  vault.with_records(|records| {
    let entries = accounts(records)?;
    let entry = entries
      .iter()
      .find(|entry| entry.uuid == uuid)
      .ok_or("Account not found")?;
    write(crate::commands::generate_totp_for(&entry.secret)?)
  })
}

fn require_window(window: &WebviewWindow, label: &str) -> Result<(), String> {
  if window.label() == label {
    Ok(())
  } else {
    Err("Unavailable in this window".into())
  }
}

pub(crate) fn setup(app: &mut tauri::App) -> tauri::Result<()> {
  app.manage(PickerState::default());
  let window = WebviewWindowBuilder::new(
    app,
    LABEL,
    tauri::WebviewUrl::App("index.html?quick-picker".into()),
  )
  .title("Tauthy Quick Copy")
  .inner_size(480.0, 390.0)
  .decorations(false)
  .resizable(false)
  .maximizable(false)
  .always_on_top(true)
  .visible_on_all_workspaces(true)
  .shadow(true)
  .visible(false)
  .focused(false)
  .accept_first_mouse(true)
  .content_protected(crate::protect_window_content())
  .background_color(tauri::window::Color(30, 30, 30, 255))
  .build()?;
  round_window(&window)?;
  let handle = app.handle().clone();
  window.on_window_event(move |event| match event {
    tauri::WindowEvent::Focused(false) => {
      dismiss(&handle, false);
    }
    tauri::WindowEvent::CloseRequested { api, .. } => {
      api.prevent_close();
      dismiss(&handle, true);
    }
    _ => {}
  });
  Ok(())
}

fn round_window(window: &WebviewWindow) -> tauri::Result<()> {
  // Called from Tauri's setup hook on the main thread. Tauri owns this NSWindow
  // for the lifetime of the webview window; the borrowed pointer is not retained.
  let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
  native.setOpaque(false);
  native.setBackgroundColor(Some(&NSColor::clearColor()));
  if let Some(content) = native.contentView() {
    content.setWantsLayer(true);
    if let Some(layer) = content.layer() {
      // Clip the entire webview, including its opaque backing, using public
      // AppKit/Core Animation APIs rather than WebKit's private transparency API.
      layer.setCornerRadius(CORNER_RADIUS);
      layer.setMasksToBounds(true);
    }
  }
  native.invalidateShadow();
  Ok(())
}

fn reveal(app: &AppHandle) -> Result<(), String> {
  let state = app.state::<PickerState>();
  if !state.ready.load(Ordering::Acquire) || !state.requested.load(Ordering::Acquire) {
    return Ok(());
  }
  let window = app.get_webview_window(LABEL).ok_or("Picker unavailable")?;
  let monitor = app
    .cursor_position()
    .ok()
    .and_then(|position| {
      window
        .monitor_from_point(position.x, position.y)
        .ok()
        .flatten()
    })
    .or_else(|| window.primary_monitor().ok().flatten());
  if let Some(monitor) = monitor {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let x = area.position.x as f64 / scale + (area.size.width as f64 / scale - 480.0) / 2.0;
    let y = area.position.y as f64 / scale + (area.size.height as f64 / scale * 0.18);
    window
      .set_position(tauri::LogicalPosition::new(x, y))
      .map_err(|e| e.to_string())?;
  }
  window.show().map_err(|e| e.to_string())?;
  window.set_focus().map_err(|e| e.to_string())?;
  window
    .emit("tauthy://picker-open", ())
    .map_err(|e| e.to_string())
}

pub(crate) fn show(app: &AppHandle) {
  let handle = app.clone();
  let _ = app.run_on_main_thread(move || {
    let state = handle.state::<PickerState>();
    if state.requested.load(Ordering::Acquire) {
      dismiss(&handle, true);
      return;
    }
    let previous = NSWorkspace::sharedWorkspace()
      .frontmostApplication()
      .map(|app| app.processIdentifier())
      .filter(|pid| *pid != std::process::id() as i32)
      .unwrap_or(0);
    state.previous_app.store(previous, Ordering::Release);
    state.requested.store(true, Ordering::Release);
    if let Err(error) = reveal(&handle) {
      dismiss(&handle, false);
      eprintln!("Unable to show quick picker: {error}");
    }
  });
}

fn dismiss(app: &AppHandle, restore_focus: bool) {
  let state = app.state::<PickerState>();
  if !state.requested.swap(false, Ordering::AcqRel) {
    return;
  }
  let previous = state.previous_app.swap(0, Ordering::AcqRel);
  if let Some(window) = app.get_webview_window(LABEL) {
    let _ = window.hide();
    let _ = window.emit("tauthy://picker-close", ());
  }
  // Clicking another app should leave focus where the user put it. Only an
  // explicit dismissal/copy returns to the app that invoked the picker.
  if restore_focus && previous != 0 {
    let _ = app.run_on_main_thread(move || {
      if let Some(previous) =
        NSRunningApplication::runningApplicationWithProcessIdentifier(previous)
      {
        #[allow(deprecated)]
        previous.activateWithOptions(NSApplicationActivationOptions::empty());
      }
    });
  }
}

pub(crate) fn refresh(app: &AppHandle) {
  if app.try_state::<PickerState>().is_some() {
    let _ = app.emit_to(LABEL, "tauthy://picker-refresh", ());
  }
}

#[tauri::command]
pub(crate) fn quick_picker_configure(
  app: AppHandle,
  window: WebviewWindow,
  enabled: bool,
) -> Result<(), String> {
  require_window(&window, "main")?;
  if enabled {
    if !app.global_shortcut().is_registered(SHORTCUT) {
      app
        .global_shortcut()
        .on_shortcut(SHORTCUT, |app, _, event| {
          if event.state == ShortcutState::Pressed {
            show(app);
          }
        })
        .map_err(|_| "shortcutUnavailable".to_string())?;
    }
  } else {
    app
      .global_shortcut()
      .unregister(SHORTCUT)
      .map_err(|_| "shortcutUnavailable".to_string())?;
    dismiss(&app, false);
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn quick_picker_ready(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
  require_window(&window, LABEL)?;
  app
    .state::<PickerState>()
    .ready
    .store(true, Ordering::Release);
  reveal(&app)
}

#[tauri::command]
pub(crate) fn quick_picker_snapshot(
  window: WebviewWindow,
  vault: State<'_, ApplicationVault>,
  include_metadata: bool,
) -> Result<Snapshot, String> {
  require_window(&window, LABEL)?;
  snapshot(vault.inner(), include_metadata)
}

#[tauri::command]
pub(crate) fn quick_picker_copy(
  app: AppHandle,
  window: WebviewWindow,
  vault: State<'_, ApplicationVault>,
  uuid: String,
) -> Result<(), String> {
  require_window(&window, LABEL)?;
  copy_code(vault.inner(), &uuid, |code| {
    app.clipboard().write_text(code).map_err(|e| e.to_string())
  })?;
  let _ = app.emit_to("main", "tauthy://entry-used", uuid);
  dismiss(&app, true);
  Ok(())
}

#[tauri::command]
pub(crate) fn quick_picker_dismiss(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
  require_window(&window, LABEL)?;
  dismiss(&app, true);
  Ok(())
}

#[tauri::command]
pub(crate) fn quick_picker_open_main(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
  require_window(&window, LABEL)?;
  dismiss(&app, false);
  crate::tray::show_main_window(&app);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::vault_access::RecordAccess;

  struct Vault {
    locked: bool,
  }
  impl RecordAccess for Vault {
    fn get_record(&self, _: &[u8]) -> Result<Option<Vec<u8>>, String> {
      Ok(Some(
        br#"[{"uuid":"one","name":"alice","issuer":"GitHub","icon":"PHN2Zz48L3N2Zz4=","secret":"JBSWY3DPEHPK3PXP"},{"uuid":"two","name":"bob","secret":"JBSWY3DPEHPK3PXP"}]"#
          .to_vec(),
      ))
    }
    fn save_records(&self, _: Vec<crate::vault_access::RecordUpdate<'_>>) -> Result<(), String> {
      unreachable!()
    }
  }
  impl VaultAccess for Vault {
    fn with_records<T>(
      &self,
      operation: impl FnOnce(&dyn RecordAccess) -> Result<T, String>,
    ) -> Result<T, String> {
      if self.locked {
        Err("vault is locked".into())
      } else {
        operation(self)
      }
    }
  }

  #[test]
  fn window_permissions_enforce_the_picker_boundary() {
    use tauri::utils::acl::resolved::Resolved;
    let manifests =
      serde_json::from_str(include_str!("../gen/schemas/acl-manifests.json")).unwrap();
    let capabilities =
      serde_json::from_str(include_str!("../gen/schemas/capabilities.json")).unwrap();
    let resolved = Resolved::resolve(
      &manifests,
      capabilities,
      tauri::utils::platform::Target::MacOS,
    )
    .unwrap();
    assert!(resolved.has_app_acl);
    let authority = tauri::runtime_authority!(manifests, resolved);
    for command in [
      "plugin:event|emit",
      "plugin:event|emit_to",
      "plugin:os|os_type",
    ] {
      assert!(
        authority
          .resolve_access(command, LABEL, LABEL, &tauri::ipc::Origin::Local)
          .is_none(),
        "picker must not invoke {command}"
      );
      assert!(
        authority
          .resolve_access(command, "main", "main", &tauri::ipc::Origin::Local)
          .is_some(),
        "main must retain {command}"
      );
    }
    // Event listeners and their cleanup must remain usable. GlobalStyle's OS
    // getter reads plugin startup data without invoking an OS command.
    for command in ["plugin:event|listen", "plugin:event|unlisten"] {
      assert!(
        authority
          .resolve_access(command, LABEL, LABEL, &tauri::ipc::Origin::Local)
          .is_some(),
        "picker must retain {command}"
      );
    }
    for command in [
      "vault_get",
      "vault_load",
      "vault_save",
      "encrypt_tauthy_backup",
      "quick_picker_configure",
    ] {
      assert!(
        authority
          .resolve_access(command, LABEL, LABEL, &tauri::ipc::Origin::Local)
          .is_none(),
        "picker must not invoke {command}"
      );
      assert!(
        authority
          .resolve_access(command, "main", "main", &tauri::ipc::Origin::Local)
          .is_some(),
        "main must retain {command}"
      );
    }
    for command in [
      "quick_picker_snapshot",
      "quick_picker_copy",
      "quick_picker_ready",
      "quick_picker_dismiss",
      "quick_picker_open_main",
    ] {
      assert!(
        authority
          .resolve_access(command, LABEL, LABEL, &tauri::ipc::Origin::Local)
          .is_some(),
        "picker must be able to invoke {command}"
      );
    }
  }

  #[test]
  fn snapshot_contains_codes_but_never_secrets() {
    let snapshot = snapshot(&Vault { locked: false }, true).unwrap();
    let entries = snapshot.entries.as_ref().unwrap();
    assert_eq!(entries[0].code.as_ref().unwrap().len(), 6);
    assert!(snapshot.expires_at_ms.is_some());
    let json = serde_json::to_string(&snapshot).unwrap();
    assert_eq!(entries[0].icon.as_deref(), Some("PHN2Zz48L3N2Zz4="));
    assert!(entries[1].icon.is_none());
    assert!(!json.contains("secret"));
    assert!(!json.contains("JBSWY3DPEHPK3PXP"));
  }

  #[test]
  fn rollover_response_contains_only_ids_codes_and_expiration() {
    let snapshot = snapshot(&Vault { locked: false }, false).unwrap();
    let json = serde_json::to_value(&snapshot).unwrap();
    assert!(json.get("entries").is_none());
    assert!(snapshot.expires_at_ms.is_some());
    let codes = snapshot.codes.unwrap();
    assert_eq!(codes.len(), 2);
    assert_eq!(codes[0].uuid, "one");
    assert_eq!(codes[0].code.as_ref().unwrap().len(), 6);
    assert_eq!(codes[0].code, codes[1].code);
    assert!(json["codes"][0].get("icon").is_none());
    assert!(json["codes"][0].get("name").is_none());
  }

  #[test]
  fn locked_vault_has_no_entries_and_cannot_copy() {
    let vault = Vault { locked: true };
    let snapshot = snapshot(&vault, false).unwrap();
    assert!(snapshot.locked);
    assert!(snapshot.entries.unwrap().is_empty());
    assert!(snapshot.codes.is_none());
    assert!(copy_code(&vault, "one", |_| panic!("must not write clipboard")).is_err());
  }

  #[test]
  fn copy_resolves_account_at_the_time_of_the_action() {
    let vault = Vault { locked: false };
    copy_code(&vault, "one", |code| {
      assert_eq!(code.len(), 6);
      Ok(())
    })
    .unwrap();
    assert!(copy_code(&vault, "deleted", |_| panic!("must not write clipboard")).is_err());
    assert_eq!(
      copy_code(&vault, "one", |_| Err("clipboard unavailable".into())).unwrap_err(),
      "clipboard unavailable"
    );
  }
}
