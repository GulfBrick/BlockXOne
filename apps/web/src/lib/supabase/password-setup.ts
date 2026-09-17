import type { PasswordSetupErrorCode } from './contracts'

// Shared by the browser and server. Never trim or normalize a password.
export function validateSetupPassword(password: string, confirmation: string): PasswordSetupErrorCode | undefined {
  if (password.length < 12 || password.length > 1024) return 'password_length'
  if (password !== confirmation) return 'password_mismatch'
  return undefined
}
