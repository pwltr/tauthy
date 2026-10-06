//! Conceal the startup window without suppressing WebView2's first paint.
//! https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute
use tauri::WebviewWindow;
use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};

fn set_cloaked(window: &WebviewWindow, cloaked: bool) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|error| error.to_string())?;
  // Win32 BOOL is a 32-bit integer.
  let value = i32::from(cloaked);
  // SAFETY: Tauri owns the live HWND; the BOOL pointer is valid for the duration
  // of this synchronous call and its size matches the attribute contract.
  let result = unsafe {
    DwmSetWindowAttribute(
      hwnd.0,
      DWMWA_CLOAK as u32,
      (&value as *const i32).cast(),
      std::mem::size_of_val(&value) as u32,
    )
  };
  if result < 0 {
    return Err(format!("Windows startup cloak failed: {result:#x}"));
  }
  Ok(())
}

pub(crate) fn prepare(window: &WebviewWindow) -> Result<(), String> {
  // Apply the cloak while the HWND is still hidden, avoiding an initial flash.
  set_cloaked(window, true)?;
  if let Err(error) = window.show() {
    let _ = set_cloaked(window, false);
    return Err(error.to_string());
  }
  Ok(())
}

pub(crate) fn reveal(window: &WebviewWindow) -> Result<(), String> {
  window.show().map_err(|error| error.to_string())?;
  set_cloaked(window, false)?;
  let _ = window.set_focus();
  Ok(())
}
