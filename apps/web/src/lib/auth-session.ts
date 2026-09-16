export type AuthenticatedUser = {
  id: string
  email: string
  roles: string[]
  permissions: Record<string, boolean>
  orgId?: string
  walletId?: string
  token: string
}

export type AuthMeResponse = {
  user_id: string
  email: string
  roles?: string[]
  permissions?: Record<string, boolean>
  org_id?: string
  wallet_id?: string
}

export function persistedSessionToken(raw: string | null): string | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as { token?: unknown } | null
    return parsed && typeof parsed.token === 'string' && parsed.token.length > 0
      ? parsed.token
      : null
  } catch {
    return null
  }
}

export function verifiedUser(me: AuthMeResponse, token: string): AuthenticatedUser {
  if (
    typeof me.user_id !== 'string' ||
    me.user_id.length === 0 ||
    typeof me.email !== 'string' ||
    me.email.length === 0
  ) {
    throw new Error('Invalid /v1/me response')
  }

  return {
    id: me.user_id,
    email: me.email,
    roles: Array.isArray(me.roles) ? me.roles : [],
    permissions:
      me.permissions && typeof me.permissions === 'object'
        ? me.permissions
        : {},
    orgId: me.org_id,
    walletId: me.wallet_id,
    token,
  }
}
