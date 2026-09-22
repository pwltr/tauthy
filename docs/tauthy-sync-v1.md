# Tauthy sync format v1

Tauthy sync keeps an encrypted file in a directory chosen by the user. A separate program such as
Nextcloud Desktop, Dropbox, OneDrive, iCloud Drive, or Syncthing is responsible for copying that
file between devices. Tauthy does not receive provider credentials or send data to a provider API.

The local Stronghold snapshot remains authoritative while a device is offline. A missing or
temporarily unavailable sync file never prevents a local vault edit.

## Encrypted envelope

The JSON envelope has `format: "tauthy-sync-encrypted"` and `version: 1`. It contains:

- `key.kdf`: Argon2id parameters and a random 16-byte salt;
- `key.cipher`: a random 32-byte sync key encrypted with XChaCha20-Poly1305;
- `payload`: the sync document encrypted with that sync key and a fresh random nonce.

Binary values are standard padded Base64. Version 1 uses Argon2id with 64 MiB of memory, three
iterations, and one lane. Key wrapping uses the associated data `tauthy-sync-key:v1`; payload
encryption uses `tauthy-sync-payload:v1`.

The recovery password is needed only to unwrap the sync key when creating or joining the sync.
Afterward, the sync key and selected path are stored inside the device's local Stronghold vault.
Routine synchronization therefore neither retains the password nor repeats Argon2.

Every rewrite uses a fresh XChaCha20 nonce and a temporary sibling file that atomically replaces
the previous file. Plaintext and ciphertext sizes are bounded before allocation or decryption.

## Decrypted document

The authenticated payload has `format: "tauthy-sync"`, `version: 1`, a random vault ID, a Lamport
clock, and a list of records. Each record contains:

- the stable Tauthy account ID;
- a revision consisting of a counter and random device ID;
- either the complete account or a deletion tombstone.

Tombstones are retained so a deletion made while another device is offline is not mistaken for a
new account when that device returns.

## Merge rules

Devices first turn local differences into new record revisions and then merge records by stable ID.
The higher counter wins. Equal counters are ordered by device ID, giving every device the same
result for concurrent changes without relying on synchronized clocks. Records with an identical
revision but different contents are rejected as corrupt or conflicting.

Changes to different accounts are preserved independently. Concurrent changes to the same account
use deterministic last-writer-wins semantics; version 1 does not include an interactive conflict
resolution interface.

## Security boundary and limitations

The folder provider sees the filename, size, and modification timing, but not account contents.
Anyone who obtains both the sync file and its recovery password can decrypt all synchronized OTP
secrets. Tauthy cannot recover a forgotten recovery password.

Authenticated encryption detects modification, but a folder provider can still delete the file or
replace it with an older valid copy. Existing devices retain their local revisions and will merge
them on a later sync. A brand-new device has no independent way to detect a rollback of the only
copy it can access, so encrypted exports remain the recommended recovery backup.
