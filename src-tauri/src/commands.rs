use std::time::{SystemTime, UNIX_EPOCH};

use data_encoding::BASE32_NOPAD;

const SKEW: u64 = 2;

const INVALID_SECRET: &str = "could not generate totp; `secret` may be invalid.";

fn generate_totp_at(argument: &str, timestamp: u64) -> Result<String, String> {
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

  Ok(crate::otp::generate_totp_sha1(&secret, timestamp))
}

fn current_timestamp() -> Result<u64, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|_| "system time was before the Unix epoch.".to_string())
    .map(|duration| duration.as_secs().saturating_add(SKEW))
}

#[tauri::command]
pub fn generate_totp(argument: String) -> Result<String, String> {
  if argument.is_empty() {
    return Err("`secret` was empty; it must be nonempty.".into());
  }

  generate_totp_at(&argument, current_timestamp()?)
}

#[tauri::command]
pub fn generate_totps(arguments: Vec<String>) -> Result<Vec<Option<String>>, String> {
  let timestamp = current_timestamp()?;
  Ok(
    arguments
      .iter()
      .map(|argument| generate_totp_at(argument, timestamp).ok())
      .collect(),
  )
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

  #[test]
  fn batch_generation_preserves_invalid_entries() {
    let arguments: Vec<String> = vec!["BASE32SECRET3232".into(), "invalid_secret".into()];
    let results = arguments
      .iter()
      .map(|argument| generate_totp_at(argument, 0).ok())
      .collect::<Vec<_>>();

    assert_eq!(results, vec![Some("260182".into()), None]);
  }
}
