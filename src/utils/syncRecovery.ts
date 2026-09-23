const RECOVERY_FLAG = 'tauthy:sync-recovery-tools'

export const enableSyncRecoveryTools = () => {
  window.sessionStorage.setItem(RECOVERY_FLAG, 'true')
}

export const syncRecoveryToolsEnabled = () =>
  window.sessionStorage.getItem(RECOVERY_FLAG) === 'true'
