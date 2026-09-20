# Tauthy backup format v1

Tauthy exports its portable, unencrypted backups as UTF-8 JSON. The document is deliberately
independent of Tauthy's local storage and of any future encrypted-backup envelope.

Backups contain authentication secrets. Store plaintext exports securely and delete them when they
are no longer needed.

## Example

```json
{
  "format": "tauthy-backup",
  "version": 1,
  "exportedAt": "2026-09-20T12:30:00.000Z",
  "entries": [
    {
      "id": "a47b8ef0-74d1-4d32-a711-b38245bd568b",
      "name": "alice@example.com",
      "issuer": "Example",
      "group": "Personal",
      "icon": {
        "mimeType": "image/svg+xml",
        "base64": "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg=="
      },
      "otp": {
        "type": "totp",
        "secret": "JBSWY3DPEHPK3PXP",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30
      }
    }
  ]
}
```

## Top-level fields

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | string | Always `tauthy-backup`. |
| `version` | integer | The backup schema version. This document describes version `1`. |
| `exportedAt` | string | The export time as an ISO 8601 UTC timestamp. |
| `entries` | array | One or more OTP entries, in their display order. |

## Entry fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable, unique identifier for the entry. |
| `name` | yes | Account label shown to the user. |
| `issuer` | no | Service or provider name. |
| `group` | no | Group name. Tauthy v1 does not assign stable IDs to groups. |
| `icon` | no | Self-contained icon data described below. Importers may ignore it. |
| `otp` | yes | OTP configuration described below. |

## Icon fields

Tauthy embeds the selected icon so a restored backup does not depend on a particular version of an
external icon pack. The maximum accepted encoded size is 512 KiB.

| Field | Value |
| --- | --- |
| `mimeType` | `image/svg+xml` |
| `base64` | Non-empty, standard Base64-encoded SVG bytes. |

## OTP fields

Version 1 records all OTP parameters explicitly. Tauthy currently accepts only the following values:

| Field | Value |
| --- | --- |
| `type` | `totp` |
| `secret` | Non-empty Base32 secret. Tauthy accepts either case, whitespace, and optional padding. |
| `algorithm` | `SHA1` |
| `digits` | `6` |
| `period` | `30` |

Importers should ignore unknown fields so compatible metadata can be added later. They must not
silently reinterpret unsupported OTP settings. A breaking schema change will use a new top-level
`version`.

## Compatibility

Tauthy continues to import its legacy unversioned top-level array format. New exports always use the
versioned format documented here.

Password-encrypted backups use a separate authenticated-encryption envelope whose decrypted payload
is a complete `tauthy-backup` document. See
[Tauthy encrypted backup format v1](./tauthy-encrypted-backup-v1.md).
