# Legacy vault fixture

`legacy-vault.stronghold` was generated through Tauthy's original vendored Stronghold plugin code,
using `iota_stronghold` 0.4.1 and `stronghold_engine` 0.4.0. It was not constructed by the current
migration implementation.

The fixture contains dummy data only:

- password: `correct horse`
- record: `[{"id":"legacy-fixture","secret":"JBSWY3DPEHPK3PXP"}]`

The compatibility tests use it to verify the legacy PBKDF2 derivation, v2 snapshot decryption, and
end-to-end migration into a current Stronghold snapshot.

# Encrypted 2FAS fixture

`2fas_encrypted_minimal.json` and `2fas_encrypted_android.json` contain dummy TOTP entries and
represent the 32-byte iOS salt and 256-byte Android salt respectively. They were generated with
Node's crypto module, independently of Tauthy's decryptor, using 2FAS's PBKDF2-HMAC-SHA256
(10,000 rounds) and AES-256-GCM scheme. Their password is `correct horse battery staple`. The fixed
salts and nonces are test vectors only and must never be used for real backups.

# Encrypted Ente Auth fixture

`ente_encrypted_minimal.json` contains two dummy `otpauth://` entries and uses the password `test`.
It was generated independently with libsodium's Argon2id and XChaCha20-Poly1305 secretstream
implementations. Its 8 MiB KDF cost keeps the interoperability test fast; real Ente exports can
specify a much higher memory cost. The fixed salt is for testing only.

# Encrypted Proton Authenticator fixtures

`proton_encrypted_upstream.json` is the public interoperability vector from
[Aegis' test suite](https://github.com/beemdevelopment/Aegis/blob/master/app/src/test/resources/com/beemdevelopment/aegis/importers/proton_authenticator_encrypted.json),
blob `40d5281198383637eedf13c5e045833b9579addd` (GPL-3.0). Password: `test`.
It independently verifies Proton v1 decryption, including its fixed Argon2id
parameters (19 MiB, two iterations, one lane), nonce prefix and AES-GCM AAD.
Some entries use OTP settings not yet supported by Tauthy; the frontend rejects
such imports rather than changing their settings.

`proton_encrypted_minimal.json` is a deterministic Rust-generated fixture with one
supported dummy Dropbox account and password `test`, also available in the local
debug samples. Its fixed salt and nonce are only for tests, never real backups.
