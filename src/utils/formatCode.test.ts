import { expect, it } from 'vitest'
import { formatCode } from './formatCode'

it.each<[string, boolean, string]>([
  ['123456', false, '123 456'],
  ['123456', true, '12 34 56'],
  ['', false, ''],
])('formats %s with pairs=%s', (code, pairs, expected) => {
  expect(formatCode(code, pairs)).toBe(expected)
})
