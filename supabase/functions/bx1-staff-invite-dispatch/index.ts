import { createClient } from '@supabase/supabase-js'

// This function must be deployed with JWT verification enabled. It verifies a
// real user again itself because an API key alone is not an invited operator.
// Only the user-JWT RPC may claim an approved outbox item; service credentials
// can send and record the Auth result but cannot select a recipient or role.
const environments = new Map([
  ['https://fegnnnlseuejkrusbbkv.supabase.co', 'https://testnet.bx1.co.za'],
  ['https://oqkevkjbkpugjotihtda.supabase.co', 'https://bx1.co.za'],
])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function reply(body: unknown, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
}
async function boundedBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length && (!/^\d{1,5}$/.test(length) || Number(length) > 2048)) throw new Error('invalid')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 2048) { await reader.cancel(); throw new Error('invalid') }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as unknown
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== 'POST' || new URL(request.url).search) return reply({ ok: false, error: 'invalid_request' }, 405)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
      return reply({ ok: false, error: 'invalid_request' }, 400)
    }
    const base = Deno.env.get('SUPABASE_URL') ?? ''
    const redirectOrigin = environments.get(base)
    const anon = Deno.env.get('SUPABASE_ANON_KEY')
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!redirectOrigin || !anon || !service) return reply({ ok: false, error: 'unavailable' }, 503)
    const authorization = request.headers.get('authorization') ?? ''
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)
      || authorization.length > 16384) return reply({ ok: false, error: 'unauthorised' }, 401)
    const input = await boundedBody(request)
    if (!object(input) || Object.keys(input).length !== 2 || !uuid.test(String(input.organisationId))
      || !uuid.test(String(input.invitationId))) return reply({ ok: false, error: 'invalid_request' }, 400)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
    const scopedFetch: typeof fetch = (url, init) => fetch(url, {
      ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    })
    const caller = createClient(base, anon, {
      global: { headers: { Authorization: authorization }, fetch: scopedFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const verified = await caller.auth.getUser(authorization.slice(7))
    if (verified.error || !verified.data.user?.id || !verified.data.user.email_confirmed_at
      || verified.data.user.is_anonymous) return reply({ ok: false, error: 'unauthorised' }, 401)
    // The RPC rechecks the signed session, current TOTP, distinct approvers,
    // scope and exact queued invitation after serializing authority rows.
    const claimed = await caller.rpc('bx1_staff_invitation_claim', {
      target_organisation: input.organisationId as string,
      invitation_id: input.invitationId as string,
    }).abortSignal(signal)
    if (claimed.error || !object(claimed.data) || claimed.data.ok !== true
      || Object.keys(claimed.data).sort().join(',') !== 'email,invitationId,leaseId,ok'
      || claimed.data.invitationId !== input.invitationId || !uuid.test(String(claimed.data.leaseId))
      || typeof claimed.data.email !== 'string' || claimed.data.email.length > 254) {
      return reply({ ok: false, error: claimed.error?.code === '42501' ? 'forbidden' : 'unavailable' },
        claimed.error?.code === '42501' ? 403 : 503)
    }
    const admin = createClient(base, service, {
      global: { fetch: scopedFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    // Auth Admin sends the provider invitation. The custom Supabase Invite
    // template must use /auth/confirm?token_hash=...&type=invite; redirectTo is
    // separately allow-listed in the project's Auth URL configuration.
    const sent = await admin.auth.admin.inviteUserByEmail(claimed.data.email, {
      redirectTo: `${redirectOrigin}/auth/confirm`,
      data: { bx1_staff_invitation_id: input.invitationId, bx1_staff_lease_id: claimed.data.leaseId },
    })
    const delivered = !sent.error && Boolean(sent.data.user?.id)
    const recorded = await admin.rpc('bx1_staff_invitation_dispatch_result', {
      invitation_id: input.invitationId as string,
      lease_id: claimed.data.leaseId as string,
      auth_user_id: delivered ? sent.data.user!.id : null,
      delivered,
    }).abortSignal(signal)
    if (recorded.error || !object(recorded.data) || recorded.data.ok !== true
      || recorded.data.state !== (delivered ? 'INVITED' : 'DELIVERY_UNKNOWN')) {
      return reply({ ok: false, error: 'outcome_unknown' }, 503)
    }
    return delivered ? reply({ ok: true, state: 'INVITED' }, 200)
      : reply({ ok: false, error: 'delivery_unknown' }, 503)
  } catch {
    // A timeout after claim/send is an unknown outcome, not a retry signal.
    // Never log or return JWTs, email addresses, service keys or provider text.
    return reply({ ok: false, error: 'outcome_unknown' }, 503)
  }
})
