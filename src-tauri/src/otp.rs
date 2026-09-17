use ring::hmac;

const TOTP_PERIOD_SECONDS: u64 = 30;
const SIX_DIGIT_MODULUS: u32 = 1_000_000;

/// Generates the six-digit, SHA-1 TOTP format used by existing Tauthy vaults.
pub(crate) fn generate_totp_sha1(secret: &[u8], timestamp: u64) -> String {
  let counter = timestamp / TOTP_PERIOD_SECONDS;
  format!("{:06}", generate_hotp_sha1(secret, counter))
}

fn generate_hotp_sha1(secret: &[u8], counter: u64) -> u32 {
  let key = hmac::Key::new(hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret);
  let digest = hmac::sign(&key, &counter.to_be_bytes());
  let digest = digest.as_ref();
  let offset = (digest[digest.len() - 1] & 0x0f) as usize;
  let truncated = u32::from_be_bytes([
    digest[offset],
    digest[offset + 1],
    digest[offset + 2],
    digest[offset + 3],
  ]);

  (truncated & 0x7fff_ffff) % SIX_DIGIT_MODULUS
}

#[cfg(test)]
mod tests {
  use super::*;

  const RFC_SECRET: &[u8] = b"12345678901234567890";

  #[test]
  fn matches_rfc_4226_hotp_vectors() {
    let expected = [
      755224, 287082, 359152, 969429, 338314, 254676, 287922, 162583, 399871, 520489,
    ];

    for (counter, code) in expected.into_iter().enumerate() {
      assert_eq!(generate_hotp_sha1(RFC_SECRET, counter as u64), code);
    }
  }

  #[test]
  fn matches_rfc_6238_sha1_vectors() {
    let expected = [
      (59, "287082"),
      (1_111_111_109, "081804"),
      (1_111_111_111, "050471"),
      (1_234_567_890, "005924"),
      (2_000_000_000, "279037"),
      (20_000_000_000, "353130"),
    ];

    for (timestamp, code) in expected {
      assert_eq!(generate_totp_sha1(RFC_SECRET, timestamp), code);
    }
  }
}
