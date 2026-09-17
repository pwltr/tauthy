use tauri::{
  menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder},
  App,
};

// macOS only
pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
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
