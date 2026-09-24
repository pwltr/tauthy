const DEVELOPER_SETTINGS_FLAG = 'tauthy:developer-settings'

export const enableDeveloperSettings = () => {
  window.sessionStorage.setItem(DEVELOPER_SETTINGS_FLAG, 'true')
}

export const developerSettingsEnabled = () =>
  window.sessionStorage.getItem(DEVELOPER_SETTINGS_FLAG) === 'true'
