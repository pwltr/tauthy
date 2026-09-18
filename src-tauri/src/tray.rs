use std::sync::{
  atomic::{AtomicBool, Ordering},
  Mutex,
};

use serde::Deserialize;
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
  AppHandle, Manager, State,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{commands, legacy_vault};

const TRAY_ID: &str = "tauthy-tray";
const ACCOUNT_ID_PREFIX: &str = "tauthy-tray:account:";
const OPEN_ID: &str = "tauthy-tray:open";
const QUIT_ID: &str = "tauthy-tray:quit";
const STATUS_ID: &str = "tauthy-tray:status";
const FEEDBACK_DURATION: std::time::Duration = std::time::Duration::from_secs(2);
// Derived from the canonical app artwork as an alpha-only macOS template, so
// it keeps the bull's proportions and follows the menu bar's appearance.
const TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/tray-icon.png");
const SUCCESS_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/tray-success.png");
const ERROR_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/tray-error.png");

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
  locked: String,
  empty: String,
  unavailable: String,
  open: String,
  quit: String,
  tooltip: String,
  copied: String,
  copy_failed: String,
}

impl Default for TrayLabels {
  fn default() -> Self {
    Self {
      locked: "Unlock Tauthy to show accounts".into(),
      empty: "No accounts yet".into(),
      unavailable: "Accounts are unavailable".into(),
      open: "Open Tauthy".into(),
      quit: "Quit Tauthy".into(),
      tooltip: "Tauthy".into(),
      copied: "Code copied".into(),
      copy_failed: "Could not copy code".into(),
    }
  }
}

pub struct TrayLabelState(Mutex<TrayLabels>);

impl Default for TrayLabelState {
  fn default() -> Self {
    Self(Mutex::new(TrayLabels::default()))
  }
}

pub struct TrayMenuState(Mutex<Option<Menu<tauri::Wry>>>);

impl Default for TrayMenuState {
  fn default() -> Self {
    Self(Mutex::new(None))
  }
}

#[derive(Default)]
pub struct TrayEnabledState(AtomicBool);

#[derive(Default)]
pub struct TrayFeedbackState(std::sync::atomic::AtomicU64);

#[derive(Deserialize)]
struct TrayEntry {
  uuid: String,
  name: String,
  issuer: Option<String>,
  secret: String,
}

fn account_label(account: &TrayEntry) -> String {
  let label = match account
    .issuer
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    Some(issuer) => format!("{issuer} ({})", account.name),
    None => account.name.clone(),
  };
  let label = menu_text(&label);
  if label.is_empty() {
    "Tauthy".into()
  } else {
    label
  }
}

fn menu_text(text: &str) -> String {
  text
    .replace('&', "&&")
    .replace(['\r', '\n'], " ")
    .trim()
    .to_string()
}

fn entries(app: &AppHandle) -> Result<Option<Vec<TrayEntry>>, String> {
  let state = app.state::<legacy_vault::VaultState>();
  let Some(record) = legacy_vault::vault_record_at(&state)? else {
    return Ok(None);
  };

  serde_json::from_str(&record)
    .map(Some)
    .map_err(|error| format!("Unable to read tray accounts: {error}"))
}

fn labels(app: &AppHandle) -> TrayLabels {
  app
    .state::<TrayLabelState>()
    .0
    .lock()
    .map(|labels| labels.clone())
    .unwrap_or_default()
}

fn populate_menu(app: &AppHandle, menu: &Menu<tauri::Wry>) -> Result<(), String> {
  let labels = labels(app);

  match entries(app) {
    Ok(Some(accounts)) if !accounts.is_empty() => {
      for account in accounts {
        let label = account_label(&account);
        let item = MenuItem::with_id(
          app,
          format!("{ACCOUNT_ID_PREFIX}{}", account.uuid),
          label,
          true,
          None::<&str>,
        )
        .map_err(|error| error.to_string())?;
        menu.append(&item).map_err(|error| error.to_string())?;
      }
    }
    Ok(Some(_)) => {
      let item = MenuItem::with_id(app, STATUS_ID, labels.empty, false, None::<&str>)
        .map_err(|error| error.to_string())?;
      menu.append(&item).map_err(|error| error.to_string())?;
    }
    Ok(None) => {
      let item = MenuItem::with_id(app, STATUS_ID, labels.locked, false, None::<&str>)
        .map_err(|error| error.to_string())?;
      menu.append(&item).map_err(|error| error.to_string())?;
    }
    Err(_) => {
      let item = MenuItem::with_id(app, STATUS_ID, labels.unavailable, false, None::<&str>)
        .map_err(|error| error.to_string())?;
      menu.append(&item).map_err(|error| error.to_string())?;
    }
  }

  menu
    .append(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?)
    .map_err(|error| error.to_string())?;
  menu
    .append(
      &MenuItem::with_id(app, OPEN_ID, labels.open, true, None::<&str>)
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
  menu
    .append(
      &MenuItem::with_id(app, QUIT_ID, labels.quit, true, None::<&str>)
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

  Ok(())
}

pub fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn copy_account_code(app: &AppHandle, uuid: &str) -> Result<(), String> {
  let account = entries(app)?
    .ok_or_else(|| "vault is locked".to_string())?
    .into_iter()
    .find(|entry| entry.uuid == uuid)
    .ok_or_else(|| "account not found".to_string())?;
  let code = commands::generate_totp(account.secret)?;
  app
    .clipboard()
    .write_text(code)
    .map_err(|error| error.to_string())
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
  let id = event.id().as_ref();
  if id == OPEN_ID {
    show_main_window(app);
  } else if id == QUIT_ID {
    app.exit(0);
  } else if let Some(uuid) = id.strip_prefix(ACCOUNT_ID_PREFIX) {
    let labels = labels(app);
    match copy_account_code(app, uuid) {
      Ok(()) => show_feedback(app, labels.copied, SUCCESS_ICON.clone()),
      Err(_) => show_feedback(app, labels.copy_failed, ERROR_ICON.clone()),
    }
  }
}

fn restore_icon(app: &AppHandle) {
  let Some(tray) = app.tray_by_id(TRAY_ID) else {
    return;
  };

  #[cfg(target_os = "macos")]
  let _ = tray.set_icon_with_as_template(Some(TRAY_ICON.clone()), true);
  #[cfg(not(target_os = "macos"))]
  let _ = tray.set_icon(app.default_window_icon().cloned());
  let _ = tray.set_tooltip(Some(labels(app).tooltip));
}

fn show_feedback(app: &AppHandle, message: String, icon: tauri::image::Image<'static>) {
  let generation = app
    .state::<TrayFeedbackState>()
    .0
    .fetch_add(1, Ordering::Relaxed)
    + 1;
  if let Some(tray) = app.tray_by_id(TRAY_ID) {
    let _ = tray.set_icon_with_as_template(Some(icon), false);
    let _ = tray.set_tooltip(Some(message));
  }

  let app = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(FEEDBACK_DURATION);
    if app.state::<TrayFeedbackState>().0.load(Ordering::Relaxed) == generation {
      restore_icon(&app);
    }
  });
}

pub fn refresh_menu(app: &AppHandle) -> Result<(), String> {
  let state = app.state::<TrayMenuState>();
  let guard = state
    .0
    .lock()
    .map_err(|_| "The tray menu state is unavailable.".to_string())?;
  let Some(menu) = guard.as_ref() else {
    return Ok(());
  };

  while !menu.items().map_err(|error| error.to_string())?.is_empty() {
    menu.remove_at(0).map_err(|error| error.to_string())?;
  }
  populate_menu(app, menu)
}

pub fn is_enabled(app: &AppHandle) -> bool {
  app.state::<TrayEnabledState>().0.load(Ordering::Relaxed)
}

fn enable(app: &AppHandle) -> Result<(), String> {
  if app.tray_by_id(TRAY_ID).is_some() {
    return refresh_menu(app);
  }

  let menu = Menu::new(app).map_err(|error| error.to_string())?;
  populate_menu(app, &menu)?;
  let labels = labels(app);
  let mut builder = TrayIconBuilder::with_id(TRAY_ID)
    .menu(&menu)
    .tooltip(labels.tooltip)
    .show_menu_on_left_click(true)
    .on_menu_event(handle_menu_event);

  #[cfg(target_os = "macos")]
  {
    builder = builder.icon(TRAY_ICON.clone()).icon_as_template(true);
  }
  #[cfg(not(target_os = "macos"))]
  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }

  builder.build(app).map_err(|error| error.to_string())?;
  app
    .state::<TrayMenuState>()
    .0
    .lock()
    .map_err(|_| "The tray menu state is unavailable.".to_string())?
    .replace(menu);
  Ok(())
}

fn disable(app: &AppHandle) -> Result<(), String> {
  app
    .state::<TrayFeedbackState>()
    .0
    .fetch_add(1, Ordering::Relaxed);
  app.remove_tray_by_id(TRAY_ID);
  app
    .state::<TrayMenuState>()
    .0
    .lock()
    .map_err(|_| "The tray menu state is unavailable.".to_string())?
    .take();
  Ok(())
}

#[tauri::command]
pub fn tray_configure(
  app: AppHandle,
  state: State<'_, TrayLabelState>,
  enabled: bool,
  labels: TrayLabels,
) -> Result<(), String> {
  *state
    .0
    .lock()
    .map_err(|_| "The tray label state is unavailable.".to_string())? = labels;
  app
    .state::<TrayFeedbackState>()
    .0
    .fetch_add(1, Ordering::Relaxed);
  app
    .state::<TrayEnabledState>()
    .0
    .store(enabled, Ordering::Relaxed);

  if enabled {
    enable(&app)?;
    restore_icon(&app);
    Ok(())
  } else {
    disable(&app)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn escapes_native_menu_mnemonics_and_line_breaks() {
    assert_eq!(menu_text("A&B\nLogin"), "A&&B Login");
  }

  #[test]
  fn account_labels_match_the_main_list() {
    let account = TrayEntry {
      uuid: "id".into(),
      name: "Personal".into(),
      issuer: Some("Example".into()),
      secret: "secret".into(),
    };

    assert_eq!(account_label(&account), "Example (Personal)");
  }

  #[test]
  fn tray_is_opt_in() {
    assert!(!TrayEnabledState::default().0.load(Ordering::Relaxed));
  }
}
