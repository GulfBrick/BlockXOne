// Safe UI contracts only. Auth tokens, session IDs and enrollment material must
// never be added to server-rendered props or persisted browser state.
export type MfaFactor = { id: string; status: 'verified' | 'unverified'; factorType: 'totp' }
export type MfaView = {
  state: 'unenrolled' | 'challenge_required' | 'verified' | 'unsupported_factor'
  factors: MfaFactor[]
  hasPendingTotp: boolean
}
export type MfaErrorCode = 'invalid_request' | 'unauthorised' | 'invalid_code'
  | 'rate_limited' | 'unavailable' | 'pending_setup_exists' | 'already_enrolled' | 'unsupported_factor'
export type MfaContinuation = 'workspace' | 'setup' | 'security'
export type MfaNextPath = '/workspace' | '/login?setup=1' | '/workspace/security'
export type MfaEnrollResponse = { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; error: MfaErrorCode }
export type MfaVerifyResponse = { ok: true; next: MfaNextPath } | { ok: false; error: MfaErrorCode }

export const MFA_CONTINUATIONS: Readonly<Record<MfaContinuation, MfaNextPath>> = Object.freeze({
  workspace: '/workspace', setup: '/login?setup=1', security: '/workspace/security',
})
