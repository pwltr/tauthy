import * as i18next from 'i18next'

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

declare global {
  interface Crypto {
    randomUUID: () => string
  }
}

// TEMP: Workaround for https://github.com/isaachinman/next-i18next/issues/1781
declare module 'react-i18next' {
  interface TFunction {
    <
      TKeys extends i18next.TFunctionKeys = string,
      TInterpolationMap extends object = i18next.StringMap,
    >(
      key: TKeys,
      options?: i18next.TOptions<TInterpolationMap> | string,
    ): string
  }
}
