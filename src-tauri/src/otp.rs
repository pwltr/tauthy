use ring::hmac;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TotpAlgorithm {
  #[default]
  Sha1,
  Sha256,
  Sha512,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TotpSettings {
  pub algorithm: TotpAlgorithm,
  pub digits: u8,
  pub period: u32,
}

impl Default for TotpSettings {
  fn default() -> Self {
    Self {
      algorithm: TotpAlgorithm::Sha1,
      digits: 6,
      period: 30,
    }
  }
}

impl TotpSettings {
  pub(crate) fn is_valid(self) -> bool {
    (6..=8).contains(&self.digits) && (1..=3600).contains(&self.period)
  }

  pub(crate) fn generate(self, secret: &[u8], timestamp: u64) -> String {
    let algorithm = match self.algorithm {
      TotpAlgorithm::Sha1 => hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY,
      TotpAlgorithm::Sha256 => hmac::HMAC_SHA256,
      TotpAlgorithm::Sha512 => hmac::HMAC_SHA512,
    };
    let counter = timestamp / u64::from(self.period);
    let value = hotp(secret, counter, algorithm) % 10_u32.pow(self.digits.into());
    format!("{value:0width$}", width = usize::from(self.digits))
  }
}

fn hotp(secret: &[u8], counter: u64, algorithm: hmac::Algorithm) -> u32 {
  let key = hmac::Key::new(algorithm, secret);
  let digest = hmac::sign(&key, &counter.to_be_bytes());
  let digest = digest.as_ref();
  let offset = (digest[digest.len() - 1] & 0x0f) as usize;
  let truncated = u32::from_be_bytes([
    digest[offset],
    digest[offset + 1],
    digest[offset + 2],
    digest[offset + 3],
  ]);

  truncated & 0x7fff_ffff
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
      assert_eq!(
        hotp(
          RFC_SECRET,
          counter as u64,
          hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY
        ) % 1_000_000,
        code
      );
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
      assert_eq!(
        TotpSettings::default().generate(RFC_SECRET, timestamp),
        code
      );
    }
  }

  #[test]
  fn matches_rfc_6238_eight_digit_vectors() {
    for (algorithm, secret, early, late) in [
      (TotpAlgorithm::Sha1, RFC_SECRET, "94287082", "07081804"),
      (
        TotpAlgorithm::Sha256,
        b"12345678901234567890123456789012".as_slice(),
        "46119246",
        "68084774",
      ),
      (
        TotpAlgorithm::Sha512,
        b"1234567890123456789012345678901234567890123456789012345678901234".as_slice(),
        "90693936",
        "25091201",
      ),
    ] {
      let settings = TotpSettings {
        algorithm,
        digits: 8,
        period: 30,
      };
      assert_eq!(settings.generate(secret, 59), early);
      assert_eq!(settings.generate(secret, 1_111_111_109), late);
    }
  }
}
