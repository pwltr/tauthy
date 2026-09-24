# Tauthy sync format v1

Tauthy sync keeps encrypted files in a directory chosen by the user. A separate program such as
Nextcloud Desktop, Dropbox, OneDrive, iCloud Drive, or Syncthing is responsible for copying them
between devices. Tauthy does not receive provider credentials or send data to a provider API.

The local Stronghold snapshot remains authoritative while a device is offline. A missing or
temporarily unavailable sync location never prevents a local vault edit.

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

Each write uses a fresh XChaCha20 nonce and a temporary sibling file that atomically replaces
the device's previous file. Plaintext and ciphertext sizes are bounded before allocation or
decryption.

## Folder layout and migration

When creating sync, the user selects a cloud-synced parent directory. Tauthy creates a
`Tauthy Sync` folder there, containing an encrypted recovery anchor named `anchor.tauthy-sync`.
To join, select that `Tauthy Sync` folder. The anchor remains unchanged after creation. Each
device that makes a change writes its own `device-<32-character device ID>.tauthy-sync` file
inside the folder. All files use the same encrypted v1 envelope and wrapped sync key. Tauthy
reads and merges the anchor and every valid device file on each sync.
No device modifies another device's file. This avoids routine cloud-provider conflicts when two
devices edit simultaneously, which cannot be guaranteed with one mutable file and an asynchronous
folder-sync client.

Existing v1 sync configurations keep their file-based layout. Their selected path, recovery
password, encryption key, device ID, and local vault stay the same; on the next local change,
each updated device publishes a sibling named
`<anchor filename>.device-<32-character device ID>`. The Join screen has a separate option for
these older sync files. An existing connection is **not** silently moved into a folder, because
an older app version would keep reading and writing the old file and the devices would diverge.
All devices on an existing sync should update: older versions read only the anchor and cannot see
changes in device files. Keep the anchor and device files together; do not rename or remove them
while sync is connected. Moving an existing connection into a folder requires a deliberate
migration after all devices have updated.

If a folder-sync provider previously created a conflicted copy, tap the logo on the About screen
five times to enable developer settings for this session, then select **Merge a conflicted copy** in
Sync settings. Tauthy accepts it only if its encrypted key and vault ID match, then
merges its records into the local vault and publishes any recovered changes. The selected file is
not modified or deleted. Keep it until every device shows the recovered accounts.

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
Anyone who obtains the sync files and the recovery password can decrypt all synchronized OTP
secrets. Tauthy cannot recover a forgotten recovery password.

Authenticated encryption detects modification, but a folder provider can still delete files or
replace them with older valid copies. Existing devices retain their local revisions and will merge
them on a later sync. A brand-new device has no independent way to detect a rollback of all copies
it can access, so encrypted exports remain the recommended recovery backup.
