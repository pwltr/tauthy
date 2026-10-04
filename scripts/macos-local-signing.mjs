import { spawnSync } from 'node:child_process'

// Local development signing is never used for production builds. A valid
// certificate-backed identity keeps Keychain access stable across rebuilds.
export function localSigningIdentity() {
  const preferred = process.env.TAUTHY_LOCAL_SIGNING_IDENTITY
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  })

  if (result.status !== 0) return null

  const identities = result.stdout.split('\n').flatMap((line) => {
    const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"$/)
    return match ? [{ hash: match[1], name: match[2] }] : []
  })

  if (preferred) {
    const identity = identities.find(({ hash, name }) => hash === preferred || name === preferred)
    if (!identity) {
      throw new Error(`TAUTHY_LOCAL_SIGNING_IDENTITY is not a valid code-signing identity: ${preferred}`)
    }
    return identity
  }

  // If several development identities exist, choose the same one regardless
  // of Keychain's listing order. A caller can pin another via the env var.
  return (
    identities
      .filter(({ name }) => name.startsWith('Apple Development:'))
      .sort((a, b) => a.hash.localeCompare(b.hash))[0] ?? null
  )
}
