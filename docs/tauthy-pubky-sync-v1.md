# Tauthy Pubky sync v1

Pubky is an optional transport for Tauthy's [encrypted sync format](./tauthy-sync-v1.md).
It does not replace the local encrypted vault or the folder-sync option.

## Identity and setup

The user signs in through Pubky Ring. Tauthy requests a grant for
`/priv/tauthy/sync/v1/:rw` under client ID `com.pwltr.tauthy`; it never receives the user's
Pubky identity key. Ring selects the identity and its homeserver. Tauthy stores the resulting
grant session secret inside the local encrypted vault so it can sync after a restart. Disconnecting
removes that local secret but does not delete remote data; the grant can also be revoked in Ring.

On the first device, Tauthy generates a random 256-bit recovery code. It wraps a fresh random
sync key using the same Argon2id and XChaCha20-Poly1305 envelope as folder sync. The code is
needed to join another device and can be viewed again while the first device's vault is unlocked.
The Pubky identity key is **not** a decryption key. Joining therefore requires both Ring access
to the same Pubky identity and the Tauthy recovery code.

## Homeserver layout

- `/priv/tauthy/sync/v1/anchor.json`: the initial encrypted recovery anchor.
- `/priv/tauthy/sync/v1/devices/<32-character device ID>.json`: each device's encrypted
  sync payload.

All files use the authenticated envelope and merge rules described in the sync format document.
Devices write only their own file after setup, so simultaneous edits do not overwrite one shared
object. A failed or unavailable homeserver does not prevent a local account change. Sync retries
on a later change or when the user chooses **Sync now**.

## Security and limits

Pubky's `/priv` namespace requires authenticated reads with a matching capability.
Tauthy requests access only to its own sync directory, with no public-path fallback.
Access control is not end-to-end encryption: the homeserver operator can access stored
files and observe sizes, device IDs and activity. Tauthy therefore still encrypts all
account data independently. The random recovery code protects against offline guessing;
authenticated encryption rejects altered content.
The homeserver can still delete or replay older valid files. A new device cannot independently
detect a complete rollback, so an encrypted export remains important as a recovery backup.
Moving a Pubky identity to a different homeserver may require a new Ring grant and re-uploading
the local vault; Tauthy does not automate homeserver migration in v1.

The transport is separate from encryption and merge logic. A homeserver or Ring version
without private-path support must fail rather than fall back to public storage.
Earlier unpublished `/pub` test setups require reconnecting through Ring and creating
private sync; this change does not move or delete their existing public ciphertext files.
