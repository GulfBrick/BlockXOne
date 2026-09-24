// Safe UI contracts only. Auth tokens, session IDs and enrollment material must
// never be added to server-rendered props or persisted browser state.
// Enrollment SVGs can be substantially larger than verification responses.
// These are application safety bounds, not a promise about provider maxima.
export const MFA_ENROLL_QR_MAX_CHARACTERS = 524288
export const MFA_ENROLL_RESPONSE_MAX_BYTES = 1048576
export const MFA_RESPONSE_MAX_BYTES = 131072

export type MfaFactor = { id: string; status: 'verified' | 'unverified'; factorType: 'totp' }
export type MfaView = {
  state: 'unenrolled' | 'challenge_required' | 'verified' | 'unsupported_factor'
  factors: MfaFactor[]
  hasPendingTotp: boolean
}
export type MfaErrorCode = 'invalid_request' | 'unauthorised' | 'invalid_code'
  | 'rate_limited' | 'unavailable' | 'pending_setup_exists' | 'already_enrolled' | 'unsupported_factor' | 'step_up_required'
export type MfaContinuation = 'workspace' | 'setup' | 'security' | 'staff'
export type MfaNextPath = '/portal' | '/workspace' | '/login?setup=1' | '/workspace/security' | '/workspace/staff-invite'
export type MfaEnrollResponse = { ok: true; factorId: string; qrCode: string; secret: string } | { ok: false; error: MfaErrorCode }
export type MfaVerifyResponse = { ok: true; next: MfaNextPath } | { ok: false; error: MfaErrorCode }

export const MFA_CONTINUATIONS: Readonly<Record<MfaContinuation, MfaNextPath>> = Object.freeze({
  workspace: '/workspace', setup: '/login?setup=1', security: '/workspace/security', staff: '/workspace/staff-invite',
})
