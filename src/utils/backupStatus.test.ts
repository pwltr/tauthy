import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backupFingerprint,
  getBackupStatus,
  recordBackupExport,
  resetBackupStatus,
  BACKUP_STATUS_KEY,
  WEEK_MS,
} from './backupStatus'

const entries = [
  { uuid: 'a', name: 'Dropbox', secret: 'JBSWY3DPEHPK3PXP' },
  { uuid: 'b', name: 'GitHub', secret: 'ABC234' },
]
describe('local backup receipts and reminders', () => {
  beforeEach(() => localStorage.clear())

  it('ignores ordering, code usage and transient token fields', async () => {
    await recordBackupExport(entries, true, 100)
    expect((await getBackupStatus([...entries].reverse(), WEEK_MS * 2)).state).toBe('current')
    expect(
      await backupFingerprint(entries.map((e) => ({ ...e, token: '123456', count: 50 }))),
    ).toBe(await backupFingerprint(entries))
    expect((await getBackupStatus(entries, WEEK_MS * 2)).reminder).toBe(false)
  })

  it('tracks content edits, imports and deletions, not sync configuration', async () => {
    await recordBackupExport(entries, false, 100)
    for (const next of [
      [{ ...entries[0], name: 'Work' }, entries[1]],
      [entries[0]],
      [...entries, { uuid: 'c', name: 'Other', secret: 'DEF567' }],
    ]) {
      const status = await getBackupStatus(next, 100 + WEEK_MS)
      expect(status.state).toBe('changed')
      expect(status.reminder).toBe(true)
    }
    const stored = localStorage.getItem(BACKUP_STATUS_KEY)!
    expect(stored).not.toContain('Dropbox')
    expect(stored).not.toContain(entries[0].secret)
  })

  it('gives accounts without an export a week and does not remind on empty vaults', async () => {
    expect((await getBackupStatus([], 100)).reminder).toBe(false)
    expect((await getBackupStatus(entries, 100)).reminder).toBe(false)
    expect((await getBackupStatus(entries, 100 + WEEK_MS)).reminder).toBe(true)
  })

  it('snoozes a week, dismisses this content, and allows reminders after another edit', async () => {
    await getBackupStatus(entries, 0)
    const due = await getBackupStatus(entries, WEEK_MS)
    due.snooze()
    expect((await getBackupStatus(entries, WEEK_MS + 1)).reminder).toBe(false)
    const later = await getBackupStatus(entries, WEEK_MS * 2)
    expect(later.reminder).toBe(true)
    later.dismiss()
    expect((await getBackupStatus(entries, WEEK_MS * 3)).reminder).toBe(false)
    expect(
      (await getBackupStatus([{ ...entries[0], name: 'Changed' }], WEEK_MS * 3)).reminder,
    ).toBe(true)
  })

  it('refreshes receipts after an export and resets them on vault deletion', async () => {
    await recordBackupExport(entries, true, 100)
    const status = await getBackupStatus(entries, 101)
    expect(status).toMatchObject({
      exportedAt: 100,
      encrypted: true,
      state: 'current',
      reminder: false,
    })
    resetBackupStatus()
    expect((await getBackupStatus(entries, 200)).state).toBe('never')
  })

  it('tolerates malformed or unavailable preference storage', async () => {
    localStorage.setItem(BACKUP_STATUS_KEY, 'broken')
    expect((await getBackupStatus(entries, 100)).state).toBe('never')
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('full')
    })
    await expect(recordBackupExport(entries, true)).resolves.toBeUndefined()
    write.mockRestore()
  })
})
