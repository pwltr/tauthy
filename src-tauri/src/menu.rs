use tauri::{AboutMetadata, Menu, MenuItem, Submenu};

// macOS only

pub(crate) fn menu() -> Menu {
  let about_menu = AboutMetadata::new()
    .version(String::from("0.2.5"))
    .authors(vec![String::from("Philipp Walter")])
    .comments(String::from("2FA authentication client"))
    .copyright(String::from("GPL-3.0 License"))
    .license(String::from("GPL-3.0 License"))
    .website(String::from("https://github.com/pwltr/tauthy"))
    .website_label(String::from("Source Code"));

  Menu::new()
    .add_submenu(Submenu::new(
      "Tauthy",
      Menu::new()
        .add_native_item(MenuItem::About("Tauthy".to_string(), about_menu))
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::Quit),
    ))
    .add_submenu(Submenu::new(
      "Edit",
      Menu::new()
        .add_native_item(MenuItem::Undo)
        .add_native_item(MenuItem::Redo)
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::Cut)
        .add_native_item(MenuItem::Copy)
        .add_native_item(MenuItem::Paste)
        .add_native_item(MenuItem::SelectAll),
    ))
}
