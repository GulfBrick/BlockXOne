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
  '/login', '/forgot-password', '/auth/recover', '/auth/confirm', '/auth/login', '/auth/setup', '/auth/logout',
  '/workspace', '/workspace/access-denied',
  '/api/wallet/challenge', '/api/wallet/verify', '/api/wallet/context',
  '/login/mfa', '/workspace/security', '/auth/mfa-enroll', '/auth/mfa-verify', '/auth/mfa-restart-setup',
  '/workspace/administration', '/workspace/administration/staff-invitations', '/auth/admin-command', '/auth/staff-invite', '/workspace/staff-invite',
  '/workspace/testnet-fund', '/api/testnet-fund/command',
  '/register', '/auth/register', '/portal', '/portal/onboarding',
  '/portal/products', '/portal/products/new', '/portal/products/detail',
  '/portal/compliance', '/portal/compliance/detail', '/portal/opportunities',
  '/portal/opportunities/detail', '/portal/portfolio', '/portal/orders/detail',
  '/api/portal/command', '/api/portal/documents', '/api/portal/funding/verify', '/api/portal/entry',
  '/api/portal/kyc/session', '/api/portal/kyc/webhook', '/api/portal/kyc/evidence', '/api/portal/kyc/readiness',
  '/api/portal/documents/processing',
  '/api/portal/offering-documents', '/api/portal/offering-documents/processing',
  '/api/portal/offering-signatures', '/api/portal/offering-signatures/processing', '/api/portal/offering-signatures/provider-status',
  '/api/portal/application-drafts',
  // Exact native fund routes only. Their existing handlers still enforce live
  // identity, environment, scope, MFA, evidence and command authority.
  '/api/portal/fund-lifecycle/admission', '/api/portal/fund-lifecycle/approval', '/api/portal/fund-lifecycle/execute',
  '/api/portal/fund-lifecycle/keys/bind', '/api/portal/fund-lifecycle/keys/read',
  '/api/portal/fund-lifecycle/payment', '/api/portal/fund-lifecycle/payment/receipt',
  '/api/portal/fund-lifecycle/payment/reference', '/api/portal/fund-lifecycle/payment/submit',
  '/api/portal/fund-lifecycle/read',
  '/api/portal/fund-lifecycle/recipient/claim', '/api/portal/fund-lifecycle/recipient/claim-preview',
  '/api/portal/fund-lifecycle/recipient/claim-signature', '/api/portal/fund-lifecycle/recipient/command',
  '/api/portal/fund-lifecycle/recipient/find', '/api/portal/fund-lifecycle/recipient/prepare',
  '/api/portal/fund-lifecycle/recipient/read', '/api/portal/fund-lifecycle/recipient/signature', '/api/portal/fund-lifecycle/recipient/verify',
  '/api/portal/fund-lifecycle/setup/command', '/api/portal/fund-lifecycle/setup/prepare',
  '/api/portal/fund-lifecycle/setup/read', '/api/portal/fund-lifecycle/setup/verify',
  '/api/portal/fund-lifecycle/setup/retry',
  '/api/portal/fund-lifecycle/signature', '/api/portal/fund-lifecycle/transaction', '/api/portal/fund-lifecycle/verify',
] as const

export function isSupabaseWebPathAllowed(pathname: string): boolean {
  // No aliases, percent-encoded variants, nested actions or trailing slashes.
  const path = pathname.split(/[?#]/, 1)[0]
  return SUPABASE_ALLOWED_PATHS.some((allowed) => path === allowed)
}
