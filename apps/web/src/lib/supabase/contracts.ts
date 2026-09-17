export const BX1_ROLES = [
  'Investor', 'OfferingManager', 'ComplianceOfficer', 'IssuerFundManager',
  'TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin',
] as const

export type Bx1Role = (typeof BX1_ROLES)[number]

export type Bx1Workspace = {
  user: { id: string; email: string; platformUserId: string; displayName: string | null }
  organisations: Array<{ id: string; name: string; roles: Bx1Role[] }>
}

export type PasswordSetupErrorCode = 'password_length' | 'password_mismatch' | 'password_rejected' | 'password_same' | 'password_reauthentication' | 'setup_request_invalid'
export type AuthErrorCode = 'invalid_credentials' | 'access_denied' | 'unavailable' | 'invalid_request' | PasswordSetupErrorCode
export type AuthResult = { ok: true } | { ok: false; error: AuthErrorCode }

export const AUTH_ERROR_COPY: Record<AuthErrorCode, string> = {
  invalid_credentials: 'Unable to sign in. Check your details and try again.',
  access_denied: 'Workspace access is unavailable.',
  unavailable: 'Access is temporarily unavailable. Please try again.',
  invalid_request: 'Unable to complete this request. Check your details and try again.',
  password_length: 'Your password was not saved. Use between 12 and 1024 characters.',
  password_mismatch: 'Your password was not saved. The two passwords do not match. Enter the same password in both fields.',
  password_rejected: 'Your password was not accepted. Try a different, unique password. If this continues, contact your workspace administrator.',
  password_same: 'Choose a password different from your current password.',
  password_reauthentication: 'Your password was not saved. Please request a fresh password recovery email from your workspace administrator.',
  setup_request_invalid: 'Your password was not saved because the form could not be read. Re-enter both password fields and try again.',
}

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && Object.hasOwn(AUTH_ERROR_COPY, value)
}
