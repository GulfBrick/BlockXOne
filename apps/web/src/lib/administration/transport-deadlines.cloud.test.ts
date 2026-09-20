import { createHash } from 'node:crypto'
import { channel } from 'node:diagnostics_channel'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createAdministrationController, type AdministrationCommandState } from '@/components/workspace/administration-controller'
import { ADMINISTRATION_RPC_TIMEOUT_MS, administrationRpc } from './context'
import { parseAdminIntent, parseAdminReadProjection, parseAdminResult, type AdminIntent, type AdminReadProjection } from './contracts'

// Packaging marker only. Every timer, AbortController, SDK RPC and HTTP socket
// under test is real. This file must only be executed by the hosted review lane.
vi.mock('server-only', () => ({}))
beforeAll(() => { vi.useRealTimers() })

const ORG = '4ef37ad9-31d3-447f-b1be-e8a7fc6a1528'
const PRINCIPAL = '289d5680-f0b7-4546-bc3e-f327d0cbf062'
const PERSON = '473a6b15-f4a2-4b19-97ee-e1569989dbdb'
const GRANT = 'c82410db-61d9-40c3-a0d1-194185302cf2'
const PROPOSAL = 'ad3ec346-1e9d-4e52-bce7-6224d5d73316'
const RPC_KEY = '6e1facf4-f80f-48dd-84bf-9bc5ffdb3d5a'
const ORIGINAL_KEY = '9fb7175f-c419-4a37-81d3-d616cda90179'
const REPLACEMENT_KEY = 'c32c132b-da87-441b-a967-7b864420bda3'
const BODY_LIMIT = 4096
const STALL_WATCHDOG_MS = 20_000
const PAYLOAD = Object.freeze({ displayName: 'SYNTHETIC H2f transport-only draft', kind: 'OTHER', jurisdictionCode: null, registrationReference: null })
const RPC_COMMAND = Object.freeze({ intent: 'propose', kind: 'ENTITY_DRAFT_CREATE', payload: PAYLOAD, expectedScopeRevision: '1' })
const syntheticIntent = (requestKey = ORIGINAL_KEY): AdminIntent => ({
  intent: 'propose', organisationId: ORG, requestKey, kind: 'ENTITY_DRAFT_CREATE', payload: JSON.stringify(PAYLOAD), expectedScopeRevision: '1',
})
const replayResult = () => ({ ok: true, proposalId: PROPOSAL, state: 'PENDING_REVIEW', revision: '1', replayed: true, scopeState: 'READY', scopeRevision: '1' })
function ready(): Extract<AdminReadProjection, { availability: 'ready' | 'hold' }> {
  const grant = { id: GRANT, personId: PERSON, capability: 'ADMINISTRATION_V1' as const, status: 'ACTIVE' as const,
    validFrom: '2026-09-20T00:00:00Z', validUntil: '2026-09-21T00:00:00Z', revision: '1' }
  return { availability: 'ready', scopeRevision: '1', policyVersion: 1, caller: { principalId: PRINCIPAL, personId: PERSON, grant },
    scope: { organisationId: ORG, state: 'READY', revision: '1', policyVersion: 1, trustRevision: '1' },
    people: [], entities: [], proposals: [], selectedProposal: null, governanceGrants: [grant], grantsTruncated: false,
    truncated: { people: false, entities: false, proposals: false } }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))
async function until(predicate: () => boolean, limit = 1000): Promise<void> {
  const end = performance.now() + limit
  while (!predicate() && performance.now() < end) await delay(10)
  expect(predicate()).toBe(true)
}
type Mode = 'rpc-read' | 'rpc-command' | 'controller'
type RequestEvidence = {
  method: string; path: string; receivedAt: number; bodyHash: string; bytes: number
  headersSentAt: number | null; socketClosedAt: number | null; responseClosedAt: number | null; watchdogFired: boolean
  peerEndAt: number | null; socketErrorAt: number | null; socketErrorCode: string | null
}
type FetchEvidence = { method: string; path: string; dispatchedAt: number; abortedAt: number | null; signal: AbortSignal | null
  clientHeadersAt: number | null; fetchRejectedAt: number | null; fetchErrorCode: string | null }
type TransportEvidence = { id: number; method: string; path: string; createdAt: number | null; sendHeadersAt: number | null
  headersAt: number | null; errorAt: number | null; errorCode: string | null; errorName: string | null
  clientSocketClosedAt: number | null; clientSocketEndAt: number | null }
type Closure = { listenerClosed: boolean; sockets: number; timers: number; handlers: number; refreshes: number
  diagnosticSubscriptions: number; diagnosticSocketListeners: number; elapsedMs: number }
const safeErrorCode = (error: unknown): string => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && ['ABORT_ERR', 'UND_ERR_ABORTED', 'UND_ERR_SOCKET', 'UND_ERR_DESTROYED',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code) ? code : 'OTHER'
}
const safeErrorName = (error: unknown): string => {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : null
  return typeof name === 'string' && ['AbortError', 'TimeoutError', 'SocketError', 'TypeError', 'Error'].includes(name) ? name : 'OTHER'
}

async function fixture(mode: Mode) {
  const startedAt = new Date().toISOString()
  const sockets = new Set<Socket>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const handlers = new Set<Promise<void>>()
  const refreshControllers = new Set<AbortController>()
  const failures: string[] = []
  const requests: RequestEvidence[] = []
  const fetches: FetchEvidence[] = []
  const transport: TransportEvidence[] = []
  const diagnosticUnsubscribers = new Set<() => void>()
  const diagnosticSocketUnsubscribers = new Set<() => void>()
  let cleanupStartedAt: number | null = null
  let accepting = true
  let posts = 0
  let gets = 0
  let receipts = 0
  let originalBody: string | null = null
  const nativeGuardedFetch = globalThis.fetch
  expect((nativeGuardedFetch as typeof fetch & { [key: symbol]: boolean | undefined })[Symbol.for('blockxone.hermeticFetchGuard')]).toBe(true)
  const expectedRpcPath = mode === 'rpc-read' ? '/rest/v1/rpc/bx1_administration_read' : '/rest/v1/rpc/bx1_administration_command'
  const routeAllowed = (method: string, path: string) => mode === 'controller'
    ? ((method === 'POST' && path === '/auth/admin-command') || (method === 'GET' && path === '/fixture/status'))
    : method === 'POST' && path === expectedRpcPath
  const fail = (code: string) => { failures.push(code); return new Error('H2F_FIXTURE_REJECTED') }
  function schedule(callback: () => void, milliseconds: number) {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, milliseconds)
    timers.add(timer)
    return timer
  }
  function cancel(timer: ReturnType<typeof setTimeout>) { clearTimeout(timer); timers.delete(timer) }
  function sendJson(response: ServerResponse, value: unknown) {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (!accepting || !request.method || !request.url || !routeAllowed(request.method, request.url)) throw fail('ROUTE_DENIED')
    const method = request.method, path = request.url
    const parts: Buffer[] = []
    let bytes = 0
    for await (const part of request) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      bytes += chunk.length
      if (bytes > BODY_LIMIT) throw fail('BODY_LIMIT')
      parts.push(chunk)
    }
    const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))
    const entry: RequestEvidence = { method, path, receivedAt: performance.now(), bodyHash: hash(body), bytes,
      headersSentAt: null, socketClosedAt: null, responseClosedAt: null, watchdogFired: false,
      peerEndAt: null, socketErrorAt: null, socketErrorCode: null }
    requests.push(entry)
    request.socket.once('close', () => { entry.socketClosedAt = performance.now() })
    request.socket.once('end', () => { entry.peerEndAt = performance.now() })
    request.socket.once('error', error => { entry.socketErrorAt = performance.now(); entry.socketErrorCode = safeErrorCode(error) })
    response.once('close', () => { entry.responseClosedAt = performance.now() })
    if (method === 'GET') {
      gets += 1
      if (mode !== 'controller' || gets > 2 || body !== '' || receipts !== 1 || originalBody === null) throw fail('STATUS_DENIED')
      sendJson(response, { synthetic: true, receiptCount: receipts, requestKey: ORIGINAL_KEY, bodyHash: hash(originalBody), view: ready() })
      return
    }
    posts += 1
    if (posts > (mode === 'controller' ? 2 : 1)) throw fail('POST_LIMIT')
    if (mode === 'controller') {
      const form = new URLSearchParams(body)
      if ([...form].length !== 6 || new Set([...form.keys()]).size !== 6) throw fail('FORM_SHAPE')
      const parsed = parseAdminIntent(Object.fromEntries(form))
      if (canonical(parsed) !== canonical(syntheticIntent())) throw fail('INTENT_CHANGED')
    } else {
      const expected = mode === 'rpc-read' ? { target_organisation: ORG, selected_command: null }
        : { target_organisation: ORG, request_key: RPC_KEY, command: RPC_COMMAND }
      if (canonical(JSON.parse(body)) !== canonical(expected)) throw fail('RPC_BODY_CHANGED')
    }
    if (posts === 2) {
      if (body !== originalBody || receipts !== 1) throw fail('ORIGINAL_BODY_CHANGED')
      sendJson(response, replayResult())
      return
    }
    originalBody = body
    receipts = mode === 'rpc-read' ? 0 : 1
    // The request has been completely received. Headers and an incomplete body
    // are real bytes; completion is withheld until the APPLICATION aborts.
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.flushHeaders()
    response.write('{"')
    entry.headersSentAt = performance.now()
    const watchdog = schedule(() => { entry.watchdogFired = true; failures.push('STALL_WATCHDOG'); response.destroy() }, STALL_WATCHDOG_MS)
    response.once('close', () => cancel(watchdog))
  }
  const server = createServer((request, response) => {
    const task = handle(request, response).catch(() => { failures.push('HANDLER_FAILED'); response.destroy() })
    handlers.add(task)
    void task.finally(() => handlers.delete(task))
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.on('clientError', (_error, socket) => { if (accepting) failures.push('CLIENT_PROTOCOL_ERROR'); socket.destroy() })
  server.on('error', () => { failures.push('SERVER_ERROR') })
  await new Promise<void>((resolve, reject) => {
    const bad = () => reject(new Error('H2F_LISTEN_FAILED'))
    server.once('error', bad)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', bad); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw fail('LISTEN_ADDRESS') }
  const origin = 'http://127.0.0.1:' + address.port

  // Passive diagnostics for this exact loopback fixture only. Never retain or
  // export Undici request/header/error objects, and never alter their signals,
  // body streams, socket state or dispatcher. Weak identity correlates retries.
  const transportByRequest = new WeakMap<object, TransportEvidence>()
  const clientSocketsObserved = new WeakSet<object>()
  const subscribe = (name: string, observe: (message: Record<string, unknown>, entry: TransportEvidence) => void) => {
    const diagnostic = channel(name)
    const listener = (value: unknown) => {
      try {
        if (!value || typeof value !== 'object') return
        const message = value as Record<string, unknown>
        const request = message.request
        if (!request || typeof request !== 'object') return
        const descriptor = request as Record<string, unknown>
        if (descriptor.origin !== origin || typeof descriptor.method !== 'string' || typeof descriptor.path !== 'string'
          || !routeAllowed(descriptor.method, descriptor.path)) return
        let entry = transportByRequest.get(request)
        if (!entry) {
          if (transport.length >= 16) { if (!failures.includes('DIAGNOSTIC_LIMIT')) failures.push('DIAGNOSTIC_LIMIT'); return }
          entry = { id: transport.length + 1, method: descriptor.method, path: descriptor.path, createdAt: null,
            sendHeadersAt: null, headersAt: null, errorAt: null, errorCode: null, errorName: null,
            clientSocketClosedAt: null, clientSocketEndAt: null }
          transportByRequest.set(request, entry)
          transport.push(entry)
        }
        observe(message, entry)
      } catch {
        // A diagnostic subscriber must never throw into the real transport.
        if (!failures.includes('DIAGNOSTIC_OBSERVER_FAILED')) failures.push('DIAGNOSTIC_OBSERVER_FAILED')
      }
    }
    diagnostic.subscribe(listener)
    diagnosticUnsubscribers.add(() => diagnostic.unsubscribe(listener))
  }
  subscribe('undici:request:create', (_message, entry) => { entry.createdAt ??= performance.now() })
  subscribe('undici:request:headers', (_message, entry) => { entry.headersAt ??= performance.now() })
  subscribe('undici:request:error', (message, entry) => {
    entry.errorAt ??= performance.now()
    entry.errorCode = safeErrorCode(message.error)
    entry.errorName = safeErrorName(message.error)
  })
  subscribe('undici:client:sendHeaders', (message, entry) => {
    entry.sendHeadersAt ??= performance.now()
    const socket = message.socket
    if (!socket || typeof socket !== 'object' || clientSocketsObserved.has(socket)) return
    clientSocketsObserved.add(socket)
    const ownedSocket = socket as Socket
    const ended = () => { entry.clientSocketEndAt ??= performance.now() }
    const closed = () => { entry.clientSocketClosedAt ??= performance.now() }
    ownedSocket.once('end', ended)
    ownedSocket.once('close', closed)
    diagnosticSocketUnsubscribers.add(() => { ownedSocket.removeListener('end', ended); ownedSocket.removeListener('close', closed) })
  })

  const observedFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow')
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !routeAllowed(method, url.pathname) || redirect !== 'error') throw fail('OUTBOUND_DENIED')
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null)
    const entry: FetchEvidence = { method, path: url.pathname, dispatchedAt: performance.now(), abortedAt: null, signal,
      clientHeadersAt: null, fetchRejectedAt: null, fetchErrorCode: null }
    fetches.push(entry)
    signal?.addEventListener('abort', () => { entry.abortedAt = performance.now() }, { once: true })
    // Observation only: preserve input/body/signal and use the existing guard.
    try {
      const response = await nativeGuardedFetch(input, init)
      entry.clientHeadersAt = performance.now()
      return response
    } catch (error) {
      entry.fetchRejectedAt = performance.now()
      entry.fetchErrorCode = safeErrorCode(error)
      throw error
    }
  }
  // Supabase sets no redirect option. Supplying "error" once at this transparent
  // boundary is transport confinement, not a response/deadline stub.
  const sdkFetch: typeof fetch = (input, init) => observedFetch(input, { ...init, redirect: 'error' })

  async function refreshStatus(): Promise<unknown> {
    if (!accepting) throw fail('STATUS_AFTER_CLOSE')
    const controller = new AbortController()
    refreshControllers.add(controller)
    let rejectAbort: (() => void) | null = null
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error('H2F_STATUS_ABORTED'))
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    const watchdog = schedule(() => { failures.push('STATUS_WATCHDOG'); controller.abort() }, 4000)
    const request = (async () => {
      const response = await observedFetch(origin + '/fixture/status', {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
      })
      return await response.json()
    })()
    try {
      // The deadline covers BOTH headers and body consumption. The rejection
      // branch also settles on fixture closure, independent of fetch behavior.
      return await Promise.race([request, aborted])
    } finally {
      cancel(watchdog)
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
      refreshControllers.delete(controller)
    }
  }

  async function close(): Promise<Closure> {
    accepting = false
    const beginning = performance.now()
    cleanupStartedAt = beginning
    for (const controller of refreshControllers) controller.abort()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    let listenerClosed = false
    server.close(() => { listenerClosed = true })
    server.closeIdleConnections()
    for (const socket of sockets) socket.destroy()
    try {
      await until(() => listenerClosed && sockets.size === 0 && handlers.size === 0 && refreshControllers.size === 0, 2000)
    } finally {
      for (const unsubscribe of diagnosticUnsubscribers) unsubscribe()
      diagnosticUnsubscribers.clear()
      for (const unsubscribe of diagnosticSocketUnsubscribers) unsubscribe()
      diagnosticSocketUnsubscribers.clear()
    }
    const closed = { listenerClosed, sockets: sockets.size, timers: timers.size, handlers: handlers.size, refreshes: refreshControllers.size,
      diagnosticSubscriptions: diagnosticUnsubscribers.size, diagnosticSocketListeners: diagnosticSocketUnsubscribers.size, elapsedMs: performance.now() - beginning }
    expect(server.listening).toBe(false)
    expect(closed.elapsedMs).toBeLessThanOrEqual(2000)
    return closed
  }
  return { mode, startedAt, origin, requests, fetches, transport, failures, sdkFetch, observedFetch, refreshStatus, close,
    diagnosticState: () => ({ cleanupStartedAt }),
    stats: () => ({ posts, gets, receipts, originalBodyHash: originalBody === null ? null : hash(originalBody) }) }
}

type Fixture = Awaited<ReturnType<typeof fixture>>
function evidence(f: Fixture, extra: Record<string, unknown>, closure: Closure | null, passed: boolean) {
  // All values are fixed synthetic DTOs or measurements. Never output signals,
  // request headers, SDK objects, environment contents or raw exceptions.
  console.info('BX1_H2F_EVIDENCE ' + JSON.stringify({ version: 1, case: f.mode, startedAt: f.startedAt,
    scope: 'NODE_REAL_HTTP_SYNTHETIC_ONLY', node: process.version, sdk: '2.116.0', vitest: '4.1.11',
    rpcDeadlineMs: ADMINISTRATION_RPC_TIMEOUT_MS, controllerDeadlineMs: 15000, fixtureWatchdogMs: STALL_WATCHDOG_MS,
    ...f.stats(), requests: f.requests, fetches: f.fetches.map(({ method, path, dispatchedAt, abortedAt, signal, clientHeadersAt, fetchRejectedAt, fetchErrorCode }) => ({
      method, path, dispatchedAt, abortedAt, clientHeadersAt, fetchRejectedAt, fetchErrorCode, signalAborted: signal?.aborted ?? false,
    })), transport: f.transport, ...f.diagnosticState(), failures: f.failures, ...extra, closure, passed, browserProven: false, providerProven: false, wholeA4Passed: false }))
}
async function abortedStall(f: Fixture, start: number, minimum: number, maximum: number) {
  expect(f.requests).toHaveLength(1)
  expect(f.fetches).toHaveLength(1)
  expect(f.requests[0].headersSentAt).not.toBeNull()
  expect(f.requests[0].receivedAt).toBeLessThanOrEqual(f.requests[0].headersSentAt!)
  expect(f.fetches[0].signal?.aborted).toBe(true)
  expect(f.fetches[0].abortedAt).not.toBeNull()
  expect(f.requests[0].receivedAt).toBeLessThan(f.fetches[0].abortedAt!)
  expect(f.requests[0].headersSentAt!).toBeLessThan(f.fetches[0].abortedAt!)
  await until(() => f.requests[0].socketClosedAt !== null && f.requests[0].responseClosedAt !== null)
  for (const time of [f.fetches[0].abortedAt!, f.requests[0].socketClosedAt!, f.requests[0].responseClosedAt!]) {
    expect(time - start).toBeGreaterThanOrEqual(minimum)
    expect(time - start).toBeLessThanOrEqual(maximum)
  }
  expect(f.requests[0].watchdogFired).toBe(false)
  expect(f.failures).toEqual([])
}
async function rpcCase(mode: 'rpc-read' | 'rpc-command') {
  const f = await fixture(mode)
  let closure: Closure | null = null, passed = false
  const measured: Record<string, unknown> = {}
  try {
    expect(ADMINISTRATION_RPC_TIMEOUT_MS).toBe(12000)
    const client = createClient(f.origin, 'sb_publishable_00000000000000000000000000000000', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { fetch: f.sdkFetch },
    })
    const start = performance.now(), wallStart = Date.now()
    const result = mode === 'rpc-read'
      ? await administrationRpc(client, 'bx1_administration_read', { target_organisation: ORG, selected_command: null })
      : await administrationRpc(client, 'bx1_administration_command', { target_organisation: ORG, request_key: RPC_KEY, command: RPC_COMMAND })
    Object.assign(measured, { elapsedMs: performance.now() - start, wallElapsedMs: Date.now() - wallStart, result })
    expect(result).toEqual({ data: null, failed: true })
    expect(measured.elapsedMs).toBeGreaterThanOrEqual(11500)
    expect(measured.elapsedMs).toBeLessThanOrEqual(14500)
    await abortedStall(f, start, 11500, 14500)
    await delay(500)
    expect(f.stats()).toMatchObject({ posts: 1, gets: 0, receipts: mode === 'rpc-read' ? 0 : 1 })
    expect(f.fetches).toHaveLength(1)
    expect(f.failures).toEqual([])
    passed = true
  } finally {
    try { closure = await f.close() } finally { evidence(f, measured, closure, passed && closure !== null) }
  }
}

describe('H2f hosted real-clock HTTP transport proof (not browser or provider acceptance)', () => {
  // The existing tooling checks execute four successful complete suites and a
  // deliberate-failure suite, before the workflow's explicit sixth run. Independent
  // ports/state let real12s/12s/15s waits overlap without shortening a deadline,
  // disabling a case, or altering existing120s aggregate/cloud job limits.
  it.concurrent('RPC read aborts an actual stalled response at12s without resubmission', () => rpcCase('rpc-read'), 25000)
  it.concurrent('RPC command preserves uncertainty after a real12s response stall', () => rpcCase('rpc-command'), 25000)
  it.concurrent('controller remains unknown at15s and only explicitly retries its original body/key', async () => {
    const f = await fixture('controller')
    let closure: Closure | null = null, passed = false
    let controller: ReturnType<typeof createAdministrationController> | null = null
    const states: Array<AdministrationCommandState & { at: number }> = []
    const refreshes: Promise<void>[] = []
    let refreshErrors = 0
    const measured: Record<string, unknown> = { states }
    try {
      const initial = ready()
      controller = createAdministrationController(initial, {
        post: async (body, signal) => {
          const response = await f.observedFetch(f.origin + '/auth/admin-command', {
            method: 'POST', redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal,
          })
          return response.json()
        },
        refresh: () => {
          // First refresh is the explicit status check; the second is the
          // controller's legitimate post-confirmation refresh. Neither posts.
          const work = (async () => {
            const status = await f.refreshStatus()
            expect(status).toMatchObject({ synthetic: true, receiptCount: 1, requestKey: ORIGINAL_KEY, bodyHash: f.stats().originalBodyHash })
            const view = parseAdminReadProjection((status as { view: unknown }).view, { organisationId: ORG, principalId: PRINCIPAL })
            expect(view).not.toBeNull()
            controller!.update(view!)
          })().catch(() => { refreshErrors += 1 })
          refreshes.push(work)
        },
        onChange: state => states.push({ ...state, at: performance.now() }),
      })
      const start = performance.now(), wallStart = Date.now()
      await controller.submit(syntheticIntent())
      Object.assign(measured, { elapsedMs: performance.now() - start, wallElapsedMs: Date.now() - wallStart })
      expect(measured.elapsedMs).toBeGreaterThanOrEqual(14500)
      expect(measured.elapsedMs).toBeLessThanOrEqual(17500)
      expect(states.map(s => s.phase)).toEqual(['pending', 'unknown'])
      expect(controller.getState()).toEqual({ phase: 'unknown', result: null, retryReady: false, refreshing: false })
      await abortedStall(f, start, 14500, 17500)
      await controller.retryOriginal()
      await controller.submit(syntheticIntent(REPLACEMENT_KEY))
      await delay(500)
      expect(f.stats()).toMatchObject({ posts: 1, gets: 0, receipts: 1 })
      expect(refreshes).toHaveLength(0)
      controller.checkRecordedStatus()
      expect(refreshes).toHaveLength(1)
      await refreshes[0]
      expect(refreshErrors).toBe(0)
      expect(controller.getState()).toEqual({ phase: 'unknown', result: null, retryReady: true, refreshing: false })
      expect(f.stats()).toMatchObject({ posts: 1, gets: 1, receipts: 1 })
      await delay(100)
      expect(f.stats().posts).toBe(1)
      await controller.retryOriginal()
      expect(refreshes).toHaveLength(2)
      await refreshes[1]
      expect(refreshErrors).toBe(0)
      expect(controller.getState()).toMatchObject({ phase: 'confirmed', retryReady: false, refreshing: false, result: replayResult() })
      const posted = f.requests.filter(r => r.method === 'POST')
      expect(posted).toHaveLength(2)
      expect(posted[1].bodyHash).toBe(posted[0].bodyHash)
      expect(f.stats()).toMatchObject({ posts: 2, gets: 2, receipts: 1 })
      expect(parseAdminResult(controller.getState().result)).toEqual(replayResult())
      controller.dispose()
      await controller.submit(syntheticIntent(REPLACEMENT_KEY))
      await controller.retryOriginal()
      controller.checkRecordedStatus()
      await delay(500)
      expect(f.stats()).toMatchObject({ posts: 2, gets: 2, receipts: 1 })
      expect(f.fetches).toHaveLength(4)
      expect(f.failures).toEqual([])
      Object.assign(measured, { originalKey: ORIGINAL_KEY, replacementKeySuppressed: true,
        retryBodyHash: posted[1].bodyHash, exactOriginalBodyCheckedByFixture: true, refreshCount: refreshes.length, disposedNoDispatch: true })
      passed = true
    } finally {
      controller?.dispose()
      try { closure = await f.close(); await Promise.all(refreshes) }
      finally { evidence(f, measured, closure, passed && closure !== null) }
    }
  }, 30000)
})
