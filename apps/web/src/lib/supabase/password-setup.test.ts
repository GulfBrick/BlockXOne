import { describe, expect, it } from 'vitest'
import { validateSetupPassword } from './password-setup'

describe('password setup validation', () => {
  it.each([0, 1, 11, 1025])('rejects length %i without including input in the error', (length) => {
    expect(validateSetupPassword('a'.repeat(length), 'a'.repeat(length))).toBe('password_length')
  })
  it.each([12, 64, 1024])('accepts matching passwords of length %i', (length) => {
    expect(validateSetupPassword('a'.repeat(length), 'a'.repeat(length))).toBeUndefined()
  })
  it('rejects unequal confirmation and never trims or normalizes passwords', () => {
    expect(validateSetupPassword('synthetic-password', 'synthetic-passworD')).toBe('password_mismatch')
    expect(validateSetupPassword('synthetic-password ', 'synthetic-password')).toBe('password_mismatch')
    expect(validateSetupPassword('synthetic-password ', 'synthetic-password ')).toBeUndefined()
  })
})
