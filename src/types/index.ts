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

export type AegisEntry = {
  type: 'totp'
  uuid: string
  name: string
  issuer: string
  note: string
  group?: string
  icon?: string
  icon_mime?: string
  info: {
    secret: string
    algo: 'SHA1'
    digits: number
    period: number
  }
}

export type AuthyEntry = {
  name: string
  secret: string
  // contains type, name, secret, digits, period
  uri: string
}

// i18next.d.ts
declare module 'i18next' {
  interface CustomTypeOptions {
    returnNull: false
  }
}
