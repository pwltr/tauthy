# Tauthy encrypted backup format v1

Tauthy encrypted backups are UTF-8 JSON files with the `.tauthy` extension. The authenticated
ciphertext decrypts to a complete [Tauthy backup v1](./tauthy-backup-v1.md) document.

Keep the backup password safe. Tauthy cannot recover a forgotten password.

## Envelope

```json
{
  "format": "tauthy-backup-encrypted",
  "version": 1,
  "kdf": {
    "algorithm": "argon2id",
    "memoryKib": 65536,
    "iterations": 3,
    "parallelism": 1,
    "salt": "Base64-encoded 16-byte random salt"
  },
  "cipher": {
    "algorithm": "xchacha20-poly1305",
    "nonce": "Base64-encoded 24-byte random nonce"
  },
  "ciphertext": "Base64-encoded authenticated ciphertext"
}
```

## Cryptography

1. Encode the complete plaintext backup as UTF-8 JSON.
2. Derive a 32-byte key from the password and random salt using Argon2id v1.3 with the parameters
   stored in `kdf`.
3. Encrypt the JSON with XChaCha20-Poly1305 using the random nonce and the associated data
   `tauthy-backup-encrypted:v1`.
4. Store the salt, nonce, and ciphertext using standard padded Base64.

Every export uses a new random salt and nonce. Authentication failure means the password is wrong or
the backup has been damaged or modified; these cases cannot be distinguished safely.

## Import limits

Tauthy bounds untrusted KDF parameters before deriving a key. Version 1 accepts at most 256 MiB of
Argon2 memory, 10 iterations, and parallelism 4. Decrypted backups are limited to 64 MiB;
ciphertext may be up to 64 MiB plus the 16-byte Poly1305 authentication tag.

Unknown envelope versions or algorithms are rejected rather than interpreted with different
cryptographic settings.
