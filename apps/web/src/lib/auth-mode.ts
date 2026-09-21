// Pure helpers shared by server admission and legacy browser isolation.
// A public flag alone must never turn the legacy bearer-token client back on.
export type AuthMode = 'legacy' | 'supabase' | 'invalid'

export function resolveAuthMode(
  serverMode: string | undefined = process.env.BLOCKXONE_AUTH_MODE,
  publicMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE
): AuthMode {
  if (!serverMode && !publicMode) return 'legacy'
  return serverMode === 'supabase' && publicMode === 'supabase' ? 'supabase' : 'invalid'
}

export function isSupabaseAuthMode(
  serverMode: string | undefined = process.env.BLOCKXONE_AUTH_MODE,
  publicMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE
): boolean {
  return resolveAuthMode(serverMode, publicMode) === 'supabase'
}

export function isLegacyClientAuthDisabled(
  publicMode: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_AUTH_MODE
): boolean {
  return Boolean(publicMode)
}

export const SUPABASE_ALLOWED_PATHS = [
  '/login', '/auth/confirm', '/auth/login', '/auth/setup', '/auth/logout',
  '/workspace', '/workspace/access-denied',
  '/api/wallet/challenge', '/api/wallet/verify',
  '/login/mfa', '/workspace/security', '/auth/mfa-enroll', '/auth/mfa-verify',
  '/workspace/administration', '/auth/admin-command',
  '/workspace/testnet-fund', '/api/testnet-fund/command',
  '/register', '/auth/register', '/portal', '/portal/onboarding',
  '/portal/products', '/portal/products/new', '/portal/products/detail',
  '/portal/compliance', '/portal/compliance/detail', '/portal/opportunities',
  '/portal/opportunities/detail', '/portal/portfolio', '/portal/orders/detail',
  '/api/portal/command', '/api/portal/documents', '/api/portal/funding/verify', '/api/portal/entry',
] as const

export function isSupabaseWebPathAllowed(pathname: string): boolean {
  // No aliases, percent-encoded variants, nested actions or trailing slashes.
  const path = pathname.split(/[?#]/, 1)[0]
  return SUPABASE_ALLOWED_PATHS.some((allowed) => path === allowed)
}
