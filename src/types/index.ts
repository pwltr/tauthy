export type VaultEntry = {
  uuid: string
  name: string
  secret: string
  issuer?: string
  group?: string
  icon?: string
}

declare global {
  interface Crypto {
    randomUUID: () => string
  }
}
