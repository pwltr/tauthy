use std::time::{Duration, SystemTime, UNIX_EPOCH};

use data_encoding::BASE32_NOPAD;
use serde::Deserialize;
use zeroize::{Zeroize, Zeroizing};

use crate::otp::TotpSettings;

const INVALID_SECRET: &str = "could not generate totp; `secret` may be invalid.";

fn generate_totp_with_settings(
  argument: &str,
  timestamp: u64,
  settings: TotpSettings,
) -> Result<String, String> {
  if !settings.is_valid() {
    return Err("Unsupported TOTP settings".into());
  }
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

  Ok(settings.generate(&decoded, timestamp))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedTotps {
  pub(crate) codes: Vec<Option<String>>,
  pub(crate) expires_at_ms: u64,
  pub(crate) period_ms: u32,
}

fn current_time() -> Result<Duration, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|_| "system time was before the Unix epoch.".to_string())
}

fn skew_seconds(period: u32) -> u64 {
  u64::from((period.saturating_sub(1) / 2).min(2))
}

fn timestamp_with_skew(duration: Duration, period: u32) -> u64 {
  duration.as_secs().saturating_add(skew_seconds(period))
}

fn next_expiration_ms(elapsed_ms: u128, period: u32) -> u64 {
  let period_ms = u128::from(period) * 1_000;
  let skew_ms = u128::from(skew_seconds(period)) * 1_000;
  let next_boundary = ((elapsed_ms + skew_ms) / period_ms + 1) * period_ms;
  (next_boundary - skew_ms) as u64
}

#[tauri::command]
pub fn generate_totp(argument: String) -> Result<String, String> {
  let argument = Zeroizing::new(argument);
  generate_totp_for(&argument, TotpSettings::default())
}

pub(crate) fn generate_totp_for(argument: &str, settings: TotpSettings) -> Result<String, String> {
  if argument.is_empty() {
    return Err("`secret` was empty; it must be nonempty.".into());
  }

  generate_totp_with_settings(
    argument,
    timestamp_with_skew(current_time()?, settings.period),
    settings,
  )
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum TotpArgument {
  Secret(String),
  Account { secret: String, totp: TotpSettings },
}

impl Drop for TotpArgument {
  fn drop(&mut self) {
    match self {
      Self::Secret(secret) | Self::Account { secret, .. } => secret.zeroize(),
    }
  }
}

#[tauri::command]
pub fn generate_totps(arguments: Vec<TotpArgument>) -> Result<GeneratedTotps, String> {
  generate_totps_for(arguments.iter().map(|argument| match argument {
    TotpArgument::Secret(secret) => (secret.as_str(), TotpSettings::default()),
    TotpArgument::Account { secret, totp } => (secret.as_str(), *totp),
  }))
}

pub(crate) fn generate_totps_for<'a>(
  arguments: impl IntoIterator<Item = (&'a str, TotpSettings)>,
) -> Result<GeneratedTotps, String> {
  Ok(generate_totps_at(arguments, current_time()?))
}

fn generate_totps_at<'a>(
  arguments: impl IntoIterator<Item = (&'a str, TotpSettings)>,
  now: Duration,
) -> GeneratedTotps {
  let mut next_refresh = None;
  let codes = arguments
    .into_iter()
    .map(|(secret, settings)| {
      let code =
        generate_totp_with_settings(secret, timestamp_with_skew(now, settings.period), settings)
          .ok()?;
      let next = (
        next_expiration_ms(now.as_millis(), settings.period),
        settings.period * 1_000,
      );
      next_refresh = Some(next_refresh.map_or(next, |previous| next.min(previous)));
      Some(code)
    })
    .collect();

  let default_period = TotpSettings::default().period;
  let (expires_at_ms, period_ms) = next_refresh.unwrap_or_else(|| {
    (
      next_expiration_ms(now.as_millis(), default_period),
      default_period * 1_000,
    )
  });
  GeneratedTotps {
    codes,
    expires_at_ms,
    period_ms,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn generate_totp_at(argument: &str, timestamp: u64) -> Result<String, String> {
    generate_totp_with_settings(argument, timestamp, TotpSettings::default())
  }

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
    assert_eq!(next_expiration_ms(0, 30), 28_000);
    assert_eq!(next_expiration_ms(27_999, 30), 28_000);
    assert_eq!(next_expiration_ms(28_000, 30), 58_000);
  }

  #[test]
  fn mixed_accounts_refresh_at_the_earliest_actual_rollover() {
    let default = TotpSettings::default();
    let custom = TotpSettings {
      period: 20,
      digits: 8,
      ..default
    };
    let fast = TotpSettings {
      period: 1,
      ..default
    };
    let accounts = [
      ("JBSWY3DPEHPK3PXP", default),
      ("JBSWY3DPEHPK3PXP", custom),
      ("bad!", fast),
    ];
    let first = generate_totps_at(accounts, Duration::from_millis(17_999));
    assert_eq!((first.expires_at_ms, first.period_ms), (18_000, 20_000));
    assert_eq!(first.codes[1].as_ref().unwrap().len(), 8);
    assert_eq!(first.codes[2], None);
    let next = generate_totps_at(accounts, Duration::from_millis(18_000));
    assert_eq!((next.expires_at_ms, next.period_ms), (28_000, 30_000));
    assert_eq!(first.codes[0], next.codes[0]);
    assert_ne!(first.codes[1], next.codes[1]);
  }
}
