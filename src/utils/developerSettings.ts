const DEVELOPER_SETTINGS_FLAG = 'tauthy:developer-settings'
const DEVELOPER_SETTINGS_CHANGED = 'tauthy:developer-settings-changed'

export const enableDeveloperSettings = () => {
  window.sessionStorage.setItem(DEVELOPER_SETTINGS_FLAG, 'true')
  window.dispatchEvent(new Event(DEVELOPER_SETTINGS_CHANGED))
}

export const developerSettingsEnabled = () =>
  window.sessionStorage.getItem(DEVELOPER_SETTINGS_FLAG) === 'true'

export const subscribeDeveloperSettings = (listener: () => void) => {
  window.addEventListener(DEVELOPER_SETTINGS_CHANGED, listener)
  return () => window.removeEventListener(DEVELOPER_SETTINGS_CHANGED, listener)
}
