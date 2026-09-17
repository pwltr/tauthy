use std::time::{SystemTime, UNIX_EPOCH};

use data_encoding::BASE32_NOPAD;

const INTERVAL: u64 = 30;
const SKEW: u64 = 2;

const INVALID_SECRET: &str = "could not generate totp; `secret` may be invalid.";

fn generate_totp_at(argument: &str, timestamp: u64) -> Result<String, String> {
  // Decode independently from rust-otp so existing unpadded secrets keep
  // working. rust-otp 3.0.0 incorrectly rejects some valid Base32 lengths
  // while trying to add RFC 4648 padding itself.
  let normalized = argument
    .chars()
    .filter(|character| !character.is_ascii_whitespace())
    .map(|character| character.to_ascii_uppercase())
    .collect::<String>();
  let secret = normalized.trim_end_matches('=');
  if secret.is_empty() {
    return Err(INVALID_SECRET.to_string());
  }
  let secret = BASE32_NOPAD
    .decode(secret.as_bytes())
    .map_err(|_| INVALID_SECRET.to_string())?;

  let totp = rust_otp::TOTP::builder()
    .secret(secret)
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
  fn accepts_32_byte_unpadded_secret() {
    let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
    assert_eq!(generate_totp_at(secret, 0), Ok("670691".into()));
  }

  #[test]
  fn accepts_case_whitespace_and_padding() {
    let canonical = generate_totp_at("JBSWY3DPEHPK3PXP", 0);
    assert_eq!(generate_totp_at("jbsw y3dp ehpk 3pxp====", 0), canonical);
  }

  #[test]
  fn padding_without_a_secret_fails() {
    assert_eq!(generate_totp_at("====", 0), Err(INVALID_SECRET.into()));
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
