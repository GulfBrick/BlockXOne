import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthUnavailableError } from './server'
import type { MfaFactor, MfaView } from './mfa-contracts'

declare const verifiedMfaContext: unique symbol
export type VerifiedMfaContext = { readonly [verifiedMfaContext]: true }
type DatabaseStatus = {
  active: boolean
  requires_mfa: boolean
  session_aal: 'aal1' | 'aal2' | null
  session_is_mfa: boolean
  session_is_totp: boolean
}
type Factor = { id: string; status: 'verified' | 'unverified'; factorType: string }
type AuthenticationMethod = { method: string; timestamp: number | null }
type ContextData = {
  accessToken: string
  expiresAt: number
  aal: 'aal1' | 'aal2'
  factors: Factor[]
  methods: AuthenticationMethod[]
  status: DatabaseStatus
}
// Only contexts created by this module carry authority. No token, identity,
// provider user or database object is enumerable/serializable on the handle.
const contexts = new WeakMap<VerifiedMfaContext, ContextData>()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const zeroUuid = '00000000-0000-0000-0000-000000000000'
function uuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value) && value !== zeroUuid }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function providerIdentityError(error: { status?: number; name?: string } | null): boolean {
  if (!error) return false
  if ([400, 401, 403].includes(error.status ?? 0) || error.name === 'AuthSessionMissingError') return true
  throw new AuthUnavailableError()
}

function parseMethods(value: unknown): AuthenticationMethod[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) throw new Error()
  return value.map((entry) => {
    if (typeof entry === 'string' && /^[A-Za-z0-9_./-]{1,64}$/.test(entry)) return { method: entry, timestamp: null }
    if (!record(entry) || typeof entry.method !== 'string' || !/^[A-Za-z0-9_./-]{1,64}$/.test(entry.method)) throw new Error()
    // Missing or malformed timestamps never acquire recency authority. The
    // signed method may still describe an otherwise valid ordinary session.
    const timestamp = typeof entry.timestamp === 'number' && Number.isSafeInteger(entry.timestamp) && entry.timestamp >= 0 ? entry.timestamp : null
    return { method: entry.method, timestamp }
  })
}
function parseFactors(value: unknown): Factor[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) throw new AuthUnavailableError()
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!record(entry) || !uuid(entry.id) || seen.has(entry.id)
      || (entry.status !== 'verified' && entry.status !== 'unverified')
      || typeof entry.factor_type !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.factor_type)) throw new AuthUnavailableError()
    seen.add(entry.id)
    return { id: entry.id, status: entry.status, factorType: entry.factor_type }
  })
}
function parseStatus(value: unknown): DatabaseStatus {
  const keys = ['active', 'requires_mfa', 'session_aal', 'session_is_mfa', 'session_is_totp']
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
    || typeof value.active !== 'boolean' || typeof value.requires_mfa !== 'boolean'
    || typeof value.session_is_mfa !== 'boolean' || typeof value.session_is_totp !== 'boolean'
    || (value.session_aal !== null && value.session_aal !== 'aal1' && value.session_aal !== 'aal2')) throw new AuthUnavailableError()
  if (!value.active && (value.requires_mfa || value.session_aal !== null || value.session_is_mfa || value.session_is_totp)) throw new AuthUnavailableError()
  if (value.active && value.session_aal === null) throw new AuthUnavailableError()
  if (value.session_is_mfa && (!value.requires_mfa || value.session_aal !== 'aal2')) throw new AuthUnavailableError()
  if (value.session_is_totp && !value.session_is_mfa) throw new AuthUnavailableError()
  return { active: value.active, requires_mfa: value.requires_mfa, session_aal: value.session_aal, session_is_mfa: value.session_is_mfa, session_is_totp: value.session_is_totp }
}

export async function readMfaContext(client: SupabaseClient): Promise<VerifiedMfaContext | null> {
  try {
    const session = await client.auth.getSession()
    if (providerIdentityError(session.error)) return null
    const accessToken = session.data.session?.access_token
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 16384) return null
    // The token is only an opaque source until this exact value is verified.
    const verified = await client.auth.getUser(accessToken)
    if (providerIdentityError(verified.error)) return null
    const user = verified.data.user
    if (!user || !uuid(user.id) || typeof user.email !== 'string' || !user.email) return null
    let claims: { expiresAt: number; aal: 'aal1' | 'aal2'; methods: AuthenticationMethod[] }
    try {
      const parts = accessToken.split('.')
      if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(parts[1], 'base64url')))
      if (!record(value) || value.sub !== user.id || !uuid(value.session_id) || typeof value.exp !== 'number'
        || !Number.isSafeInteger(value.exp) || value.exp <= Math.floor(Date.now() / 1000)
        || (value.aal !== 'aal1' && value.aal !== 'aal2')) return null
      claims = { expiresAt: value.exp, aal: value.aal, methods: parseMethods(value.amr) }
    } catch { return null }
    const factors = parseFactors(user.factors)
    const result = await client.rpc('bx1_mfa_status')
    if (result.error) throw new AuthUnavailableError()
    const status = parseStatus(result.data)
    const current = await client.auth.getSession()
    if (providerIdentityError(current.error)) return null
    if (current.data.session?.access_token !== accessToken) throw new AuthUnavailableError()
    if (claims.expiresAt <= Math.floor(Date.now() / 1000)) return null
    if (!status.active) return null
    const verifiedFactors = factors.filter((factor) => factor.status === 'verified')
    if (status.requires_mfa !== Boolean(verifiedFactors.length)
      || (status.session_is_totp && !verifiedFactors.some((factor) => factor.factorType === 'totp'))
      || (status.session_is_mfa && !status.session_is_totp && verifiedFactors.every((factor) => factor.factorType === 'totp'))) throw new AuthUnavailableError()
    const context: VerifiedMfaContext = Object.freeze(Object.create(null))
    contexts.set(context, { ...claims, accessToken, factors, status })
    return context
  } catch { throw new AuthUnavailableError() }
}

// Resource reads may trigger an SDK refresh. Do not carry assurance from the
// earlier token across that boundary or mutate an account with mixed context.
export async function isMfaContextCurrent(client: SupabaseClient, context: VerifiedMfaContext): Promise<boolean> {
  const data = contexts.get(context)
  if (!data || data.expiresAt <= Math.floor(Date.now() / 1000)) return false
  try {
    const current = await client.auth.getSession()
    if (providerIdentityError(current.error)) return false
    return current.data.session?.access_token === data.accessToken && data.expiresAt > Math.floor(Date.now() / 1000)
  } catch { throw new AuthUnavailableError() }
}

export function hasRequiredMfa(context: VerifiedMfaContext): boolean {
  const data = contexts.get(context)
  return Boolean(data && data.expiresAt > Math.floor(Date.now() / 1000)
    && (!data.status.requires_mfa || (data.aal === 'aal2' && data.status.session_is_mfa)))
}

export function toMfaView(context: VerifiedMfaContext): MfaView {
  const data = contexts.get(context)
  if (!data) throw new AuthUnavailableError()
  const factors: MfaFactor[] = data.factors.filter((factor) => factor.factorType === 'totp')
    .map(({ id, status }) => ({ id, status, factorType: 'totp' }))
  const state = !data.status.requires_mfa ? 'unenrolled'
    : hasRequiredMfa(context) ? 'verified'
      : factors.some((factor) => factor.status === 'verified') ? 'challenge_required' : 'unsupported_factor'
  return { state, factors, hasPendingTotp: factors.some((factor) => factor.status === 'unverified') }
}

// Privileged reads require a live, verified OWN TOTP binding, even when
// ordinary login is permitted without enrollment. Recency is command-only.
export function hasCurrentTotp(context: VerifiedMfaContext): boolean {
  const data = contexts.get(context)
  return Boolean(data && hasRequiredMfa(context) && data.aal === 'aal2' && data.status.session_is_totp
    && data.factors.some((factor) => factor.factorType === 'totp' && factor.status === 'verified'))
}

export function requireRecentTotp(context: VerifiedMfaContext, nowEpochSeconds: number):
  { allowed: true } | { allowed: false; reason: 'mfa_required' | 'step_up_required' } {
  const data = contexts.get(context)
  if (!data || !hasCurrentTotp(context)) return { allowed: false, reason: 'mfa_required' }
  if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0 || data.expiresAt <= nowEpochSeconds) return { allowed: false, reason: 'step_up_required' }
  const timestamps = data.methods.filter((entry) => entry.method === 'totp').map((entry) => entry.timestamp)
  if (!timestamps.length || timestamps.some((timestamp) => timestamp === null || timestamp > nowEpochSeconds)) return { allowed: false, reason: 'step_up_required' }
  return timestamps.some((timestamp) => timestamp !== null && nowEpochSeconds - timestamp <= 300)
    ? { allowed: true } : { allowed: false, reason: 'step_up_required' }
}
