export const BX1_ROLES = [
  'Investor', 'OfferingManager', 'ComplianceOfficer', 'IssuerFundManager',
  'TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin',
] as const

export type Bx1Role = (typeof BX1_ROLES)[number]

export type Bx1Workspace = {
  user: { id: string; email: string; platformUserId: string; displayName: string | null }
  organisations: Array<{ id: string; name: string; roles: Bx1Role[] }>
}

export type AuthErrorCode = 'invalid_credentials' | 'access_denied' | 'unavailable' | 'invalid_request'
export type AuthResult = { ok: true } | { ok: false; error: AuthErrorCode }

export const AUTH_ERROR_COPY: Record<AuthErrorCode, string> = {
  invalid_credentials: 'Unable to sign in. Check your details and try again.',
  access_denied: 'Workspace access is unavailable.',
  unavailable: 'Access is temporarily unavailable. Please try again.',
  invalid_request: 'Unable to complete this request. Check your details and try again.',
}

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === 'string' && Object.hasOwn(AUTH_ERROR_COPY, value)
}
