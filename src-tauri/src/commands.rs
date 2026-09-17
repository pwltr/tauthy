use std::time::{SystemTime, UNIX_EPOCH};

const INTERVAL: u64 = 30;
const SKEW: u64 = 2;

const INVALID_SECRET: &str = "could not generate totp; `secret` may be invalid.";

fn generate_totp_at(argument: &str, timestamp: u64) -> Result<String, String> {
  let totp = rust_otp::TOTP::builder()
    .base32_secret(&argument.to_ascii_uppercase())
    .map_err(|_| INVALID_SECRET.to_string())?
    .digits(6)
    .time_step(INTERVAL)
    .build()
    .map_err(|_| INVALID_SECRET.to_string())?;

  Ok(totp.generate_formatted_at(timestamp))
}

#[tauri::command]
pub fn generate_totp(argument: String) -> Result<String, String> {
  if argument.is_empty() {
    return Err("`secret` was empty; it must be nonempty.".into());
  }

  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|_| "system time was before the Unix epoch.".to_string())?
    .as_secs()
    .saturating_add(SKEW);

  generate_totp_at(&argument, timestamp)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn valid_argument_ok() {
    assert_eq!(generate_totp_at("BASE32SECRET3232", 0), Ok("260182".into()));
  }

  #[test]
  fn matches_rfc_6238_sha1_vector() {
    assert_eq!(
      generate_totp_at("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59),
      Ok("287082".into())
    );
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
