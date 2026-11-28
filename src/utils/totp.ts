import type { TotpSettings, VaultEntry } from '~/types'

export const DEFAULT_TOTP: Readonly<TotpSettings> = { algorithm: 'SHA1', digits: 6, period: 30 }
export const MAX_TOTP_PERIOD = 3600

export const parseTotpSettings = (
  algorithm: unknown,
  digits: unknown,
  period: unknown,
): TotpSettings | undefined => {
  if (
    (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') ||
    (digits !== 6 && digits !== 7 && digits !== 8) ||
    typeof period !== 'number' ||
    !Number.isInteger(period) ||
    period < 1 ||
    period > MAX_TOTP_PERIOD
  ) {
    return undefined
  }
  return { algorithm, digits, period }
}

export const sameTotpSettings = (
  left: TotpSettings = DEFAULT_TOTP,
  right: TotpSettings = DEFAULT_TOTP,
) =>
  left.algorithm === right.algorithm && left.digits === right.digits && left.period === right.period

export const customTotp = (settings: TotpSettings): Pick<VaultEntry, 'totp'> =>
  sameTotpSettings(settings) ? {} : { totp: settings }

export const normalizeTotpSecret = (secret: string) =>
  secret.replace(/\s/g, '').toUpperCase().replace(/=+$/, '')

export const createOtpAuthUri = ({ name, secret, issuer, group, totp }: VaultEntry) => {
  const params = new URLSearchParams({ secret: normalizeTotpSecret(secret) })
  if (issuer) params.set('issuer', issuer)
  if (group) params.set('group', group)
  if (totp) {
    params.set('algorithm', totp.algorithm)
    params.set('digits', String(totp.digits))
    params.set('period', String(totp.period))
  }
  const label = issuer
    ? `${encodeURIComponent(issuer)}:${encodeURIComponent(name)}`
    : encodeURIComponent(name)
  return `otpauth://totp/${label}?${params}`
}
