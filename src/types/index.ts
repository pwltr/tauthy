export type FormData = {
  name: string
  issuer: string
  group: string
  secret: string
  icon: string
}

export type VaultEntry = {
  uuid: string
  name: string
  secret: string
  issuer?: string
  group?: string
  icon?: string
}

export type TauthyBackupEntryV1 = {
  id: string
  name: string
  issuer?: string
  group?: string
  icon?: {
    mimeType: 'image/svg+xml'
    base64: string
  }
  otp: {
    type: 'totp'
    secret: string
    algorithm: 'SHA1'
    digits: 6
    period: 30
  }
}

export type TauthyBackupV1 = {
  format: 'tauthy-backup'
  version: 1
  exportedAt: string
  entries: TauthyBackupEntryV1[]
}

export type AegisEntry = {
  type: string
  uuid: string
  name: string
  issuer: string
  note: string
  group?: string
  groups?: string[]
  icon?: string
  icon_mime?: string
  info: {
    secret: string
    algo: string
    digits: number
    period?: number
    counter?: number
  }
}

export type AegisDatabase = {
  entries?: AegisEntry[]
  groups?: Array<{ uuid?: string; name?: string }>
  version?: number
}

export type AuthyEntry = {
  name: string
  secret: string
  // contains type, name, secret, digits, period
  uri: string
}

export type TwoFasOtp = {
  account?: string
  algorithm?: string
  digits?: number
  issuer?: string
  label?: string
  link?: string
  period?: number
  source?: string
  tokenType?: string
}

export type TwoFasService = {
  groupId?: string
  name?: string
  otp?: TwoFasOtp
  secret?: string
}

export type TwoFasBackup = {
  groups?: Array<{ id?: string; name?: string }>
  services?: TwoFasService[]
  servicesEncrypted?: string
}

// i18next.d.ts
declare module 'i18next' {
  interface CustomTypeOptions {
    returnNull: false
  }
}
