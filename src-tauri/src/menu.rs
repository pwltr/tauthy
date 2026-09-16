use tauri::{
  menu::{MenuBuilder, SubmenuBuilder},
  App,
};

// macOS only
pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
  let app_menu = SubmenuBuilder::new(app, "Tauthy")
    .about(None)
    .separator()
    .quit()
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
  let menu = MenuBuilder::new(app)
    .items(&[&app_menu, &edit_menu])
    .build()?;

  app.set_menu(menu)?;
  Ok(())
}
