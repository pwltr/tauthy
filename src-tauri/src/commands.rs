use std::time::{Duration, SystemTime, UNIX_EPOCH};

use data_encoding::BASE32_NOPAD;
use zeroize::Zeroizing;

const PERIOD_SECONDS: u64 = 30;
const PERIOD_MILLISECONDS: u128 = PERIOD_SECONDS as u128 * 1_000;
const SKEW: u64 = 2;
const SKEW_MILLISECONDS: u128 = SKEW as u128 * 1_000;

const INVALID_SECRET: &str = "could not generate totp; `secret` may be invalid.";

fn generate_totp_at(argument: &str, timestamp: u64) -> Result<String, String> {
  let normalized = Zeroizing::new(
    argument
      .chars()
      .filter(|character| !character.is_ascii_whitespace())
      .map(|character| character.to_ascii_uppercase())
      .collect::<String>(),
  );
  let secret = normalized.trim_end_matches('=');
  if secret.is_empty() {
    return Err(INVALID_SECRET.to_string());
  }
  let decoded_len = BASE32_NOPAD
    .decode_len(secret.len())
    .map_err(|_| INVALID_SECRET.to_string())?;
  // Own the output buffer before decoding so even partially decoded bytes are
  // wiped when malformed input returns an error.
  let mut decoded = Zeroizing::new(vec![0u8; decoded_len]);
  let written = BASE32_NOPAD
    .decode_mut(secret.as_bytes(), &mut decoded)
    .map_err(|_| INVALID_SECRET.to_string())?;
  decoded.truncate(written);

  Ok(crate::otp::generate_totp_sha1(&decoded, timestamp))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedTotps {
  pub(crate) codes: Vec<Option<String>>,
  pub(crate) expires_at_ms: u64,
}

fn current_time() -> Result<Duration, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|_| "system time was before the Unix epoch.".to_string())
}

fn timestamp_with_skew(duration: Duration) -> u64 {
  duration.as_secs().saturating_add(SKEW)
}

fn next_expiration_ms(elapsed_ms: u128) -> u64 {
  let adjusted_ms = elapsed_ms.saturating_add(SKEW_MILLISECONDS);
  let next_boundary = (adjusted_ms / PERIOD_MILLISECONDS + 1) * PERIOD_MILLISECONDS;
  next_boundary.saturating_sub(SKEW_MILLISECONDS) as u64
}

#[tauri::command]
pub fn generate_totp(argument: String) -> Result<String, String> {
  let argument = Zeroizing::new(argument);
  generate_totp_for(&argument)
}

pub(crate) fn generate_totp_for(argument: &str) -> Result<String, String> {
  if argument.is_empty() {
    return Err("`secret` was empty; it must be nonempty.".into());
  }

  generate_totp_at(argument, timestamp_with_skew(current_time()?))
}

#[tauri::command]
pub fn generate_totps(arguments: Vec<String>) -> Result<GeneratedTotps, String> {
  let arguments = Zeroizing::new(arguments);
  generate_totps_for(arguments.iter().map(String::as_str))
}

pub(crate) fn generate_totps_for<'a>(
  arguments: impl IntoIterator<Item = &'a str>,
) -> Result<GeneratedTotps, String> {
  let current_time = current_time()?;
  let timestamp = timestamp_with_skew(current_time);
  let codes = arguments
    .into_iter()
    .map(|argument| generate_totp_at(argument, timestamp).ok())
    .collect();

  Ok(GeneratedTotps {
    codes,
    expires_at_ms: next_expiration_ms(current_time.as_millis()),
  })
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
  fn invalid_suffix_after_a_valid_secret_prefix_fails() {
    // Exercise a decoder failure after part of the output has been written.
    assert_eq!(
      generate_totp_at("JBSWY3DPEHPK3PX!", 0),
      Err(INVALID_SECRET.to_string())
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

  #[test]
  fn batch_generation_preserves_invalid_entries() {
    let arguments: Vec<String> = vec!["BASE32SECRET3232".into(), "invalid_secret".into()];
    let results = arguments
      .iter()
      .map(|argument| generate_totp_at(argument, 0).ok())
      .collect::<Vec<_>>();

    assert_eq!(results, vec![Some("260182".into()), None]);
  }

  #[test]
  fn expiration_matches_the_skewed_totp_boundary() {
    assert_eq!(next_expiration_ms(0), 28_000);
    assert_eq!(next_expiration_ms(27_999), 28_000);
    assert_eq!(next_expiration_ms(28_000), 58_000);
  }
}
