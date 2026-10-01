import { invoke } from '@tauri-apps/api/core'

// Do not pass arbitrary exception text to the local diagnostic log. Some
// provider errors include paths or other user-controlled values.
const safeCodes = new Set([
  'vaultAuthenticationFailed',
  'vaultCorrupt',
  'vaultCredentialAccessDenied',
  'vaultCredentialMalformed',
  'vaultCredentialMissing',
  'vaultCredentialUnavailable',
  'vaultIdentityMismatch',
  'vaultIo',
  'vaultLegacyCorrupt',
  'vaultLegacyUnsupported',
  'vaultMissing',
  'vaultNeedsPreparation',
  'vaultPendingUnlock',
  'vaultReconciliationFailed',
  'vaultSourceChanged',
  'vaultStagedCleanupFailed',
  'vaultUnsupportedDurability',
  'syncAuthenticationFailed',
  'syncConflict',
  'syncCorrupt',
  'syncDeviceFileLimit',
  'syncFileExists',
  'syncLocalConflict',
  'syncMultipleFiles',
  'syncNotConfigured',
  'syncRemoteDeleteIncomplete',
  'syncRemoteDeleteUnsafe',
  'syncUnavailable',
  'syncUnsupported',
  'importEncryptedAuthenticationFailed',
  'importEncryptedCorrupt',
  'importEncryptedNoPasswordKey',
  'importEncryptedUnsupported',
  'importEncryptedWrongPassword',
  'importFailed',
  'importIdConflict',
  'importOtpAuthTooLarge',
  'importOtpAuthTooMany',
  'importTauthyDuplicateIds',
  'importTauthyIdConflict',
  'importTauthyNewerVersion',
  'importUnsupportedOtp',
])

const safeCode = (error: unknown): string => {
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined
  return typeof raw === 'string' && safeCodes.has(raw) ? raw : 'other'
}

let queue = Promise.resolve()

export const recordDiagnostic = (stage: string, error?: unknown) => {
  const code = error === undefined ? null : safeCode(error)
  queue = queue
    .then(() => invoke('diagnostics_record', { stage, code }))
    .then(() => undefined)
    .catch(() => undefined)
}

export const exportDiagnostics = async () => {
  await queue
  return invoke<string>('diagnostics_export')
}
