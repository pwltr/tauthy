export const vaultErrorCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : 'vaultTaskFailed'
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Please try another password.')) return 'vaultAuthenticationFailed'
  if (message.includes('record not found')) return 'vaultRecordMissing'
  return 'vaultTaskFailed'
}

export const vaultErrorMessage = (error: unknown, t: (key: string) => string): string => {
  const code = vaultErrorCode(error)
  const groups: Record<string, string> = {
    vaultAuthenticationFailed: 'authentication',
    vaultCorrupt: 'corrupt',
    vaultLegacyCorrupt: 'corrupt',
    vaultUnsupportedEnvelope: 'unsupported',
    vaultLegacyUnsupported: 'unsupported',
    vaultUnsupportedDurability: 'platform',
    vaultIdentityMismatch: 'identity',
    vaultMissing: 'missing',
    vaultCredentialMissing: 'credentialMissing',
    vaultCredentialUnavailable: 'credentialUnavailable',
    vaultCredentialAccessDenied: 'credentialDenied',
    vaultCredentialMalformed: 'credentialMalformed',
    vaultReconciliationFailed: 'reconciliation',
    vaultSourceChanged: 'reconciliation',
    vaultStagedCleanupFailed: 'stagedCleanup',
    vaultLegacyCopyCleanupFailed: 'copyCleanup',
    vaultNeedsPreparation: 'preparation',
    vaultPendingUnlock: 'preparation',
    vaultTooLarge: 'tooLarge',
    vaultEmptyPassword: 'emptyPassword',
    vaultLocked: 'locked',
    vaultIo: 'io',
    vaultForeignCredentialRequired: 'foreignCredential',
  }
  const key = `vaultErrors.${groups[code] ?? 'generic'}`
  const translated = t(key)
  return translated === key ? t('vaultErrors.generic') : translated
}
