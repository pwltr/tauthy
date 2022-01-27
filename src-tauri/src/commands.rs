const INTERVAL: u64 = 30;
const SKEW: i64 = 2;

#[tauri::command]
pub fn make_totp(argument: String) -> Result<String, ()> {
  (!argument.is_empty())
    .then(|| {
      match otp::make_totp(&(argument.to_ascii_uppercase()), INTERVAL, SKEW) {
        // pad with zeros
        Ok(totp) => format!("{:06}", totp),
        Err(_err) => panic!("could not generate totp from secret"),
      }
    })
    .ok_or_else(|| println!("no secret provided"))
}
