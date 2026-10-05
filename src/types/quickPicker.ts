export type QuickPickerEntry = {
  uuid: string
  name: string
  issuer?: string | null
  group?: string | null
  icon?: string | null
  code: string | null
}

export type QuickPickerSnapshot = { locked: boolean; entries: QuickPickerEntry[] }

export type QuickPickerResponse = {
  locked: boolean
  entries?: QuickPickerEntry[]
  codes?: Array<Pick<QuickPickerEntry, 'uuid' | 'code'>>
  expiresAtMs: number | null
}
