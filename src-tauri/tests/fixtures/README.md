# Legacy vault fixture

`legacy-vault.stronghold` was generated through Tauthy's original vendored Stronghold plugin code,
using `iota_stronghold` 0.4.1 and `stronghold_engine` 0.4.0. It was not constructed by the current
migration implementation.

The fixture contains dummy data only:

- password: `correct horse`
- record: `[{"id":"legacy-fixture","secret":"JBSWY3DPEHPK3PXP"}]`

The compatibility tests use it to verify the legacy PBKDF2 derivation, v2 snapshot decryption, and
end-to-end migration into a current Stronghold snapshot.
