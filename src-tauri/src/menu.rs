use tauri::{
  menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, SubmenuBuilder},
  App, Emitter, Manager, State, Wry,
};

const MENU_EVENT: &str = "tauthy://menu-action";

pub(crate) struct ActionItems {
  search: MenuItem<Wry>,
  create: MenuItem<Wry>,
  import: MenuItem<Wry>,
  export: MenuItem<Wry>,
  settings: MenuItem<Wry>,
  lock: MenuItem<Wry>,
}

#[tauri::command]
pub(crate) fn menu_set_enabled(
  items: State<'_, ActionItems>,
  available: bool,
  can_lock: bool,
) -> Result<(), String> {
  for item in [
    &items.search,
    &items.create,
    &items.import,
    &items.export,
    &items.settings,
  ] {
    item
      .set_enabled(available)
      .map_err(|error| error.to_string())?;
  }
  items
    .lock
    .set_enabled(available && can_lock)
    .map_err(|error| error.to_string())
}

// macOS only. The native menu owns the accelerators; the frontend handles the
// resulting action with the same route and dialog guards used by its buttons.
pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
  let search = MenuItem::with_id(app, "search", "Search", false, Some("Cmd+F"))?;
  let create = MenuItem::with_id(app, "create", "New Account", false, Some("Cmd+N"))?;
  let import = MenuItem::with_id(app, "import", "Import Codes…", false, Some("Cmd+O"))?;
  let export = MenuItem::with_id(app, "export", "Export Codes…", false, Some("Cmd+Shift+E"))?;
  let settings = MenuItem::with_id(app, "settings", "Settings…", false, Some("Cmd+Comma"))?;
  let lock = MenuItem::with_id(app, "lock", "Lock Tauthy", false, Some("Cmd+Shift+L"))?;

  let about = AboutMetadataBuilder::new()
    .name(Some("Tauthy"))
    .version(Some(env!("CARGO_PKG_VERSION")))
    .copyright(Some("GPL-3.0 License"))
    .credits(Some(
      "2FA authentication client\nhttps://github.com/pwltr/tauthy",
    ))
    .build();
  let app_menu = SubmenuBuilder::new(app, "Tauthy")
    .about(Some(about))
    .separator()
    .item(&settings)
    .separator()
    .item(&lock)
    .separator()
    .quit()
    .build()?;
  let file_menu = SubmenuBuilder::new(app, "File")
    .item(&create)
    .item(&import)
    .item(&export)
    .build()?;
  let edit_menu = SubmenuBuilder::new(app, "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()?;
  let picker = MenuItem::with_id(app, "quick-copy", "Quick Copy…", true, None::<&str>)?;
  let view_menu = SubmenuBuilder::new(app, "View")
    .item(&search)
    .separator()
    .item(&picker)
    .build()?;
  let menu = MenuBuilder::new(app)
    .items(&[&app_menu, &file_menu, &edit_menu, &view_menu])
    .build()?;

  app.set_menu(menu)?;
  app.manage(ActionItems {
    search,
    create,
    import,
    export,
    settings,
    lock,
  });
  app.on_menu_event(|app, event| {
    let action = event.id().as_ref();
    if action == "quick-copy" {
      crate::quick_picker::show(app);
      return;
    }
    if matches!(
      action,
      "search" | "create" | "import" | "export" | "settings" | "lock"
    ) {
      let _ = app.emit(MENU_EVENT, action);
    }
  });
  Ok(())
}
