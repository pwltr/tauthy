const INTERVAL: u64 = 30;
const SKEW: i64 = 2;

#[tauri::command]
pub fn generate_totp(argument: String) -> Result<String, String> {
  if argument.len() > 0 {
    match otp::make_totp(&(argument.to_ascii_uppercase()), INTERVAL, SKEW) {
      // pad with zeros
      Ok(totp) => Ok(format!("{:06}", totp)),
      Err(_err) => Err("could not generate totp; `secret` may be invalid.".into()),
    }
  } else {
    Err("`secret` was empty; it must be nonempty.".into())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn valid_argument_ok() {
    assert_eq!(generate_totp("BASE32SECRET3232".into()).is_ok(), true);
  }

  #[test]
  fn invalid_argument_fails() {
    assert_eq!(
      generate_totp("invalid_secret".into()),
      Err("could not generate totp; `secret` may be invalid.".into())
    );
  }

  #[test]
  fn empty_argument_fails() {
    assert_eq!(
      generate_totp("".into()),
      Err("`secret` was empty; it must be nonempty.".into())
    );
  }
}
