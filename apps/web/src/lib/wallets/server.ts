import 'server-only'

import { randomBytes } from 'node:crypto'
import { getAddress, verifyMessage, ZeroAddress } from 'ethers'
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAuthMode } from '@/lib/auth-mode'
import { evaluateActionPermission } from '@/lib/authorization/policy'
import { canonicalAppOrigin, createRequestSupabaseClient, readWorkspace } from '@/lib/supabase/server'
import { hasCanonicalOrigin, readAuthForm, responseCookieAdapter } from '@/lib/supabase/http'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { WALLET_CHAIN_ID, WALLET_ORIGIN, type LinkedWallet, type WalletActor, type WalletChallenge, type WalletErrorCode } from './contracts'
import { getWalletDatabase, isWalletDatabaseConfigured, WalletDatabaseError } from './database'

type Context = { params: Promise<{ action: string }> }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const zeroUuid = '00000000-0000-0000-0000-000000000000'
const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const errorStatus: Record<WalletErrorCode, number> = {
  invalid_request: 400, unauthorised: 403, unavailable: 503, expired: 410,
  conflict: 409, invalid_signature: 400, rate_limited: 429,
}

class WalletRequestError extends Error {
  constructor(readonly code: WalletErrorCode, readonly status = errorStatus[code]) { super(code) }
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) && value !== zeroUuid
}

function normalizeAddress(value: string): string {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error()
    const address = getAddress(value)
    if (address === ZeroAddress) throw new Error()
    return address.toLowerCase()
  } catch { throw new WalletRequestError('invalid_request') }
}

function providerError(error: { status?: number; name?: string } | null): void {
  if (!error) return
  if ([400, 401, 403].includes(error.status ?? 0) || error.name === 'AuthSessionMissingError') throw new WalletRequestError('unauthorised', 401)
  throw new WalletRequestError('unavailable')
}

function requireUnexpired(exp: number): void {
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) throw new WalletRequestError('unauthorised', 401)
}

async function verifiedActor(client: SupabaseClient, organisationId: string, action: 'wallet.ownership.challenge' | 'wallet.ownership.verify'): Promise<{ actor: WalletActor; exp: number }> {
  // Session storage is only a token source. No claims below are trusted until
  // this exact token has been verified by Supabase Auth's user endpoint.
  const session = await client.auth.getSession()
  providerError(session.error)
  const accessToken = session.data.session?.access_token
  if (!accessToken || accessToken.length > 16384) throw new WalletRequestError('unauthorised', 401)
  const verified = await client.auth.getUser(accessToken)
  providerError(verified.error)
  const user = verified.data.user
  if (!user || !validUuid(user.id)) throw new WalletRequestError('unauthorised', 401)

  let claims: { sub: string; session_id: string; exp: number }
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error()
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(parts[1], 'base64url')))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error()
    const candidate = decoded as Record<string, unknown>
    if (candidate.sub !== user.id || !validUuid(candidate.session_id) || typeof candidate.exp !== 'number') throw new Error()
    claims = { sub: user.id, session_id: candidate.session_id, exp: candidate.exp }
  } catch { throw new WalletRequestError('unauthorised', 401) }
  requireUnexpired(claims.exp)

  // Ordinary ownership proofs remain available to unenrolled accounts. Once
  // ANY factor is verified, exact-token AAL and fresh session/factor authority
  // are required before resolving resources or acquiring the narrow verifier.
  const mfa = await readMfaContext(client)
  if (!mfa || !hasRequiredMfa(mfa)) throw new WalletRequestError('unauthorised', 403)

  // This uses only the caller's normal RLS client. The immutable platform UUID
  // comes from bx1_profiles, never email or editable user metadata.
  const workspace = await readWorkspace(client)
  if (!workspace || workspace.user.id !== user.id || !validUuid(workspace.user.platformUserId)
    || !workspace.organisations.some((organisation) => organisation.id === organisationId)) throw new WalletRequestError('unauthorised', 403)
  if (!evaluateActionPermission(workspace, action, { userId: user.id, organisationId }).allowed) throw new WalletRequestError('unauthorised', 403)
  if (!await isMfaContextCurrent(client, mfa)) throw new WalletRequestError('unauthorised', 401)
  const current = await client.auth.getSession()
  providerError(current.error)
  if (current.data.session?.access_token !== accessToken) throw new WalletRequestError('unauthorised', 401)
  requireUnexpired(claims.exp)
  return { actor: { userId: user.id, platformUserId: workspace.user.platformUserId, sessionId: claims.session_id, organisationId }, exp: claims.exp }
}

function canonicalSignature(value: string): void {
  // Accept only the standard 65-byte EOA representation emitted by MetaMask.
  // Reject compact, zero, high-s and noncanonical recovery forms explicitly.
  if (!/^0x[0-9a-fA-F]{128}(1b|1c)$/i.test(value)) throw new WalletRequestError('invalid_signature')
  const r = BigInt(`0x${value.slice(2, 66)}`)
  const s = BigInt(`0x${value.slice(66, 130)}`)
  if (r === 0n || r >= curveOrder || s === 0n || s > curveOrder / 2n) throw new WalletRequestError('invalid_signature')
}

function checkedChallenge(value: WalletChallenge, expectedId?: string, expectedAddress?: string): WalletChallenge {
  if (!value || !validUuid(value.challengeId) || (expectedId && value.challengeId !== expectedId)
    || value.domain !== WALLET_ORIGIN || value.chainId !== WALLET_CHAIN_ID
    || typeof value.message !== 'string' || !value.message || value.message.length > 4096) throw new WalletRequestError('invalid_request')
  const address = normalizeAddress(value.address)
  if (expectedAddress && expectedAddress !== address) throw new WalletRequestError('invalid_request')
  const issuedAt = Date.parse(value.issuedAt)
  const expiresAt = Date.parse(value.expiresAt)
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) throw new WalletRequestError('invalid_request')
  if (expiresAt <= Date.now()) throw new WalletRequestError('expired')
  if (expiresAt - issuedAt !== 300000) throw new WalletRequestError('invalid_request')
  // Project the response; private evidence returned accidentally by a future
  // database change must not be serialized to the browser.
  return { challengeId: value.challengeId, address, chainId: WALLET_CHAIN_ID, domain: WALLET_ORIGIN, message: value.message, issuedAt: value.issuedAt, expiresAt: value.expiresAt }
}

function checkedWallet(value: LinkedWallet, actor: WalletActor, challenge: WalletChallenge): LinkedWallet {
  if (!value || !validUuid(value.id) || value.organisationId !== actor.organisationId
    || value.chainId !== WALLET_CHAIN_ID || value.status !== 'PENDING'
    || normalizeAddress(value.address) !== challenge.address || !Number.isFinite(Date.parse(value.verifiedAt))) throw new WalletRequestError('unavailable')
  return { id: value.id, organisationId: actor.organisationId, address: challenge.address, chainId: WALLET_CHAIN_ID, verifiedAt: value.verifiedAt, status: 'PENDING' }
}

export async function handleWalletRequest(request: NextRequest, context: Context): Promise<NextResponse> {
  const jar = responseCookieAdapter(request)
  const fail = (code: WalletErrorCode, status = errorStatus[code]) => jar.finish(NextResponse.json({ ok: false, error: code }, { status }))
  try {
    const mode = resolveAuthMode()
    if (mode !== 'supabase') return fail(mode === 'invalid' ? 'unavailable' : 'unauthorised', mode === 'invalid' ? 503 : 404)
    const { action } = await context.params
    if (action !== 'challenge' && action !== 'verify') return fail('invalid_request', 404)
    if (request.method !== 'POST') {
      const response = fail('invalid_request', 405)
      response.headers.set('Allow', 'POST')
      return response
    }
    if (canonicalAppOrigin() !== WALLET_ORIGIN) return fail('unavailable')
    if (!hasCanonicalOrigin(request)) return fail('invalid_request', 403)
    let form: URLSearchParams
    try { form = await readAuthForm(request) } catch { return fail('invalid_request') }
    const fields = action === 'challenge' ? ['organisationId', 'address', 'chainId'] : ['organisationId', 'challengeId', 'signature']
    if ([...form.keys()].some((key) => !fields.includes(key)) || fields.some((key) => !form.has(key))) return fail('invalid_request')
    const organisationId = form.get('organisationId')!
    if (!validUuid(organisationId)) return fail('invalid_request')
    let address: string | undefined
    const challengeId = form.get('challengeId')
    const signature = form.get('signature')
    if (action === 'challenge') {
      if (form.get('chainId') !== String(WALLET_CHAIN_ID)) return fail('invalid_request')
      address = normalizeAddress(form.get('address')!)
    } else {
      if (!validUuid(challengeId)) return fail('invalid_request')
      canonicalSignature(signature!)
    }
    if (!isWalletDatabaseConfigured()) return fail('unavailable')
    const client = createRequestSupabaseClient(jar.adapter)
    const { actor, exp } = await verifiedActor(client, organisationId, action === 'challenge' ? 'wallet.ownership.challenge' : 'wallet.ownership.verify')
    const database = getWalletDatabase()
    if (action === 'challenge') {
      requireUnexpired(exp)
      const challenge = checkedChallenge(await database.issueChallenge(actor, address!, WALLET_CHAIN_ID, randomBytes(32).toString('hex')), undefined, address)
      return jar.finish(NextResponse.json({ ok: true, challenge }, { status: 201 }))
    }
    const challenge = checkedChallenge(await database.readChallenge(actor, challengeId!), challengeId!)
    let recovered: string
    try { recovered = getAddress(verifyMessage(challenge.message, signature!)).toLowerCase() } catch { throw new WalletRequestError('invalid_signature') }
    if (recovered !== challenge.address) return fail('invalid_signature')
    requireUnexpired(exp)
    // SQL repeats the fresh session/tenant, expiry and one-use guard under its
    // locks. Recovery here never implies compliance or transaction authority.
    const wallet = checkedWallet(await database.consumeChallenge(actor, challengeId!, challenge.message, signature!), actor, challenge)
    return jar.finish(NextResponse.json({ ok: true, wallet }))
  } catch (error) {
    if (error instanceof WalletRequestError) return fail(error.code, error.status)
    if (error instanceof WalletDatabaseError && Object.hasOwn(errorStatus, error.code)) return fail(error.code)
    return fail('unavailable')
  }
}
