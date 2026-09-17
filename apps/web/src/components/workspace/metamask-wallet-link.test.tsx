import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getBytes, Wallet } from 'ethers'
import {
  createWalletLinkController, discoverMetaMask, MetaMaskWalletLink,
  type MetaMaskProvider, type WalletLinkState,
} from './metamask-wallet-link'

vi.mock('server-only', () => ({}))
const integration = vi.hoisted(() => ({ client: vi.fn(), workspace: vi.fn(), configured: vi.fn(), database: vi.fn(), pageClient: vi.fn(), user: vi.fn() }))
vi.mock('@/lib/supabase/server', async (original) => ({
  ...await original<typeof import('@/lib/supabase/server')>(),
  createRequestSupabaseClient: integration.client, readWorkspace: integration.workspace, readVerifiedUser: integration.user,
}))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: integration.pageClient }))
vi.mock('@/lib/wallets/database', () => ({
  getWalletDatabase: integration.database, isWalletDatabaseConfigured: integration.configured,
  WalletDatabaseError: class extends Error {},
}))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({ redirect: () => { throw Error('redirect') }, notFound: () => { throw Error('not found') } }))
import { handleWalletRequest } from '@/lib/wallets/server'
import WorkspacePage from '@/app/workspace/page'
afterEach(() => { vi.unstubAllEnvs() })

const address = '0x1111111111111111111111111111111111111111'
const org = '11111111-1111-4111-8111-111111111111'
const now = Date.parse('2026-09-17T20:00:00.000Z')
const challenge = {
  challengeId: '22222222-2222-4222-8222-222222222222', address, chainId: 80002,
  domain: 'https://bx1.co.za', message: 'Link this wallet to BlockXOne. This is not a transaction or financial approval.\nTest fixture',
  issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(),
}
const wallet = { id: '33333333-3333-4333-8333-333333333333', organisationId: org, address, chainId: 80002 as const, verifiedAt: new Date(now).toISOString(), status: 'PENDING' as const }
const signature = `0x${'11'.repeat(65)}`

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  let accounts: string[] = [address]
  let chain = '0x13882'
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return accounts
    if (method === 'eth_chainId') return chain
    if (method === 'personal_sign') return signature
    throw Error('Unexpected provider method')
  })
  const provider: MetaMaskProvider = {
    request,
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn) },
    removeListener(event, fn) { listeners.get(event)?.delete(fn) },
  }
  const states: WalletLinkState[] = []
  const post = vi.fn(async (...args: [path: string, body: URLSearchParams, signal: AbortSignal]): Promise<unknown> =>
    args[0].endsWith('challenge') ? { ok: true, challenge } : { ok: true, wallet })
  const refresh = vi.fn()
  const controller = createWalletLinkController({ post, refresh, onChange: (state) => states.push(state), now: () => now })
  controller.select(provider, org)
  return {
    provider, request, post, refresh, controller, states, listeners,
    setAccounts(value: string[]) { accounts = value },
    setChain(value: string) { chain = value },
    emit(event: string) { listeners.get(event)?.forEach((fn) => fn()) },
  }
}

describe('MetaMask ownership controller', () => {
  it('never auto-connects and separates connection from signing and server reload', async () => {
    const f = fixture()
    expect(f.request).not.toHaveBeenCalled()
    await f.controller.connect()
    expect(f.controller.getState()).toMatchObject({ address, chainId: 80002, phase: 'connected' })
    expect(f.post).not.toHaveBeenCalled()
    await f.controller.verify()
    expect(f.request.mock.calls.map(([input]) => input.method)).toEqual([
      'eth_requestAccounts', 'eth_chainId', 'eth_accounts', 'eth_chainId',
      'personal_sign', 'eth_accounts', 'eth_chainId',
    ])
    const sign = f.request.mock.calls.find(([input]) => input.method === 'personal_sign')![0]
    expect(sign.params).toEqual([`0x${Buffer.from(challenge.message, 'utf8').toString('hex')}`, address])
    expect(f.post.mock.calls[0][1].toString()).toBe(`organisationId=${org}&address=${address}&chainId=80002`)
    expect([...f.post.mock.calls[1][1].keys()]).toEqual(['organisationId', 'challengeId', 'signature'])
    expect(f.refresh).toHaveBeenCalledOnce()
    expect(f.controller.getState().phase).toBe('refreshing')
    expect(f.controller.getState().message).not.toContain('Ownership verified')
    f.controller.acceptReload([wallet])
    expect(f.controller.getState().phase).toBe('connected')
  })

  it('requires a MetaMask provider and explicit organisation', async () => {
    const f = fixture()
    f.controller.select(null, '')
    await f.controller.connect()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.controller.getState().message).toContain('Select')
  })

  it('shows wrong network without switching or signing', async () => {
    const f = fixture(); f.setChain('0x1')
    await f.controller.connect(); await f.controller.verify()
    expect(f.controller.getState()).toMatchObject({ address, chainId: 1 })
    expect(f.controller.getState().message).toContain('80002')
    expect(f.post).not.toHaveBeenCalled()
    expect(f.request.mock.calls.some(([input]) => input.method.includes('switch') || input.method.includes('send'))).toBe(false)
  })

  it('handles locked wallets and rejection without raw provider errors', async () => {
    const f = fixture(); f.setAccounts([])
    await f.controller.connect()
    expect(f.controller.getState().message).toContain('Unlock')
    f.request.mockRejectedValueOnce({ code: 4001, message: 'sensitive provider detail' })
    await f.controller.connect()
    expect(f.controller.getState().message).toContain('cancelled')
    expect(JSON.stringify(f.states)).not.toContain('sensitive')
  })

  it('handles cancelled signatures without consuming', async () => {
    const f = fixture(); await f.controller.connect()
    f.request.mockImplementation(async ({ method }) => {
      if (method === 'personal_sign') throw { code: 4001, message: 'private provider error' }
      return method === 'eth_accounts' ? [address] : '0x13882'
    })
    await f.controller.verify()
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.controller.getState().message).toContain('cancelled')
  })

  it.each(['accountsChanged', 'chainChanged', 'disconnect'])('invalidates late signature after %s and aborts requests', async (event) => {
    const f = fixture(); await f.controller.connect()
    const late = deferred<unknown>(); const signing = deferred<void>()
    f.request.mockImplementation(async ({ method }) => {
      if (method === 'personal_sign') { signing.resolve(); return late.promise }
      return method === 'eth_accounts' ? [address] : '0x13882'
    })
    const verification = f.controller.verify(); await signing.promise
    f.emit(event); late.resolve(signature); await verification
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.post.mock.calls[0][2].aborted).toBe(true)
    expect(f.refresh).not.toHaveBeenCalled()
    expect(f.controller.getState().address).toBeNull()
  })

  it.each(['account', 'network'])('rechecks %s before signing even without provider event', async (kind) => {
    const f = fixture(); await f.controller.connect()
    if (kind === 'account') f.setAccounts(['0x2222222222222222222222222222222222222222'])
    else f.setChain('0x1')
    await f.controller.verify()
    expect(f.request.mock.calls.some(([input]) => input.method === 'personal_sign')).toBe(false)
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it('rechecks the account after signing even without provider event', async () => {
    const f = fixture(); await f.controller.connect()
    f.request.mockImplementation(async ({ method }) => {
      if (method === 'personal_sign') { f.setAccounts([]); return signature }
      return method === 'eth_accounts' ? [] : '0x13882'
    })
    // First pair stays stable, second pair has changed.
    f.request.mockResolvedValueOnce([address]).mockResolvedValueOnce('0x13882')
    await f.controller.verify()
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.refresh).not.toHaveBeenCalled()
  })

  it('suppresses late HTTP success and requires reload if identity changes during consume', async () => {
    const f = fixture(); await f.controller.connect()
    const late = deferred<unknown>(); const submitting = deferred<void>()
    f.post.mockImplementation(async (path) => {
      if (path.endsWith('challenge')) return { ok: true, challenge }
      submitting.resolve(); return late.promise
    })
    const verification = f.controller.verify(); await submitting.promise
    f.emit('accountsChanged'); late.resolve({ ok: true, wallet }); await verification
    expect(f.refresh).not.toHaveBeenCalled()
    expect(f.controller.getState().mustReload).toBe(true)
  })

  it('does not retry unknown consumption results', async () => {
    const f = fixture(); await f.controller.connect()
    f.post.mockResolvedValueOnce({ ok: true, challenge }).mockRejectedValueOnce(Error('secret network detail'))
    await f.controller.verify(); await f.controller.verify()
    expect(f.post).toHaveBeenCalledTimes(2)
    expect(f.controller.getState().mustReload).toBe(true)
    expect(f.controller.getState().message).toContain('Reload')
    expect(JSON.stringify(f.states)).not.toContain('secret')
  })

  it.each([{ ok: false, error: 'unavailable' }, { ok: false, error: 'unexpected_private_detail' }, { ok: true, wallet: null }])('requires reload on an unavailable or malformed consume acknowledgement: %s', async (result) => {
    const f = fixture(); await f.controller.connect()
    f.post.mockResolvedValueOnce({ ok: true, challenge }).mockResolvedValueOnce(result)
    await f.controller.verify(); await f.controller.verify(); await f.controller.connect()
    expect(f.post).toHaveBeenCalledTimes(2)
    expect(f.controller.getState().mustReload).toBe(true)
    expect(f.controller.getState().message).toContain('Reload')
    expect(JSON.stringify(f.states)).not.toContain('unexpected_private_detail')
  })

  it.each(['expired', 'rate_limited', 'unauthorised', 'unavailable', 'conflict'])('uses fixed actionable %s copy', async (error) => {
    const f = fixture(); await f.controller.connect(); f.post.mockResolvedValueOnce({ ok: false, error })
    await f.controller.verify()
    expect(f.controller.getState().phase).toBe('error')
    expect(f.controller.getState().message.length).toBeGreaterThan(15)
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it.each([
    { chainId: 1 }, { domain: 'https://attacker.invalid' }, { address: '0x2222222222222222222222222222222222222222' },
    { expiresAt: new Date(now - 1).toISOString() }, { message: '' },
  ])('rejects malformed or mismatched challenge before signing: %s', async (change) => {
    const f = fixture(); await f.controller.connect()
    f.post.mockResolvedValueOnce({ ok: true, challenge: { ...challenge, ...change } })
    await f.controller.verify()
    expect(f.request.mock.calls.some(([input]) => input.method === 'personal_sign')).toBe(false)
  })

  it('unmount removes all listeners and invalidates late connection results', async () => {
    const f = fixture(); const late = deferred<unknown>()
    f.request.mockReturnValueOnce(late.promise)
    const connection = f.controller.connect(); f.controller.dispose()
    const count = f.states.length; late.resolve([address]); await connection
    expect(f.states).toHaveLength(count)
    expect([...f.listeners.values()].every((set) => set.size === 0)).toBe(true)
  })

  it('ignores duplicate actions while an attempt is pending', async () => {
    const f = fixture(); const late = deferred<unknown>()
    f.request.mockReturnValueOnce(late.promise)
    const connection = f.controller.connect(); await f.controller.connect()
    expect(f.request).toHaveBeenCalledTimes(1)
    late.resolve([address]); await connection
  })
})

describe('EIP-6963 discovery', () => {
  it('reports only announced MetaMask providers, keeps two distinct choices and cleans up', () => {
    const target = new EventTarget(); const found: unknown[] = []
    const f = fixture(); const request = vi.fn()
    target.addEventListener('eip6963:requestProvider', request)
    const stop = discoverMetaMask(target, (value) => found.push(value))
    const announce = (uuid: string, rdns = 'io.metamask') => target.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid, name: 'MetaMask', rdns, icon: 'untrusted icon' }, provider: f.provider },
    }))
    announce('11111111-1111-4111-8111-111111111111', 'other.wallet')
    announce('11111111-1111-4111-8111-111111111111')
    announce('22222222-2222-4222-8222-222222222222')
    announce('11111111-1111-4111-8111-111111111111')
    expect(request).toHaveBeenCalledOnce(); expect(found).toHaveLength(2)
    stop(); announce('33333333-3333-4333-8333-333333333333')
    expect(found).toHaveLength(2)
  })
})

describe('wallet workspace markup', () => {
  const organisations = [{ id: org, name: 'BlockXOne Internal' }, { id: 'other', name: 'Second organisation' }]
  it('keeps missing configuration safe and truthful', () => {
    const html = renderToStaticMarkup(<MetaMaskWalletLink organisations={organisations} wallets={[]} configured={false} />)
    expect(html).toContain('MetaMask wallet')
    expect(html).toContain('Wallet linking is being configured')
    expect(html).toContain('Ownership verification only. No payment, gas fee or token approval.')
    expect(html).not.toContain('Verify wallet ownership')
  })
  it('renders persisted pending ownership with full wrapped address, tenant, timestamp and network', () => {
    const html = renderToStaticMarkup(<MetaMaskWalletLink organisations={organisations} wallets={[wallet]} configured />)
    expect(html).toContain('Ownership verified: compliance pending')
    expect(html).toContain(address); expect(html).toContain('break-all')
    expect(html).toContain('80002'); expect(html).toContain('Polygon Amoy testnet')
    expect(html).toContain('BlockXOne Internal'); expect(html).toContain(wallet.verifiedAt)
    expect(html).toContain('aria-live="polite"'); expect(html).toContain('min-h-11')
    expect(html).toContain('for="wallet-organisation"'); expect(html).toContain('id="wallet-organisation"')
    expect(html).toContain('Connect MetaMask'); expect(html).toContain('Verify wallet ownership')
    expect(html).not.toMatch(/Ready to transact|>Approved</)
  })
})

describe('actual controller / HTTP / workspace integration', () => {
  function configure() {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    integration.configured.mockReturnValue(true)
    const userId = '44444444-4444-4444-8444-444444444444'
    const platformUserId = '55555555-5555-4555-8555-555555555555'
    integration.workspace.mockResolvedValue({ user: { id: userId, platformUserId, email: 'fixture@example.test', displayName: null }, organisations: [{ id: org, name: 'Fixture organisation', roles: ['Investor'] }] })
    integration.user.mockResolvedValue({ id: userId, email: 'fixture@example.test' })
    const token = ['header', Buffer.from(JSON.stringify({ sub: userId, session_id: '66666666-6666-4666-8666-666666666666', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url'), 'fixture'].join('.')
    integration.client.mockReturnValue({ auth: {
      getSession: async () => ({ data: { session: { access_token: token } }, error: null }),
      getUser: async (exact: string) => ({ data: { user: exact === token ? { id: userId } : null }, error: null }),
    } })
    return { userId, platformUserId }
  }

  it('passes real EIP-191 signing through the actual HTTP handler and then reads saved workspace projection', async () => {
    configure()
    const signer = Wallet.createRandom() // Ephemeral fixture, never a user key.
    const liveAddress = signer.address.toLowerCase(); const issued = Date.now()
    const stored = { ...challenge, address: liveAddress, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 300_000).toISOString() }
    const saved = { ...wallet, address: liveAddress, verifiedAt: new Date(issued).toISOString() }
    let persisted = false
    const consume = vi.fn(async () => { persisted = true; return saved })
    integration.database.mockReturnValue({ issueChallenge: async () => stored, readChallenge: async () => stored, consumeChallenge: consume })
    const query = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn(async () => ({ error: null, data: persisted ? [{ id: saved.id, organisation_id: org, address: liveAddress, chain_id: 80002, verified_at: saved.verifiedAt, status: 'PENDING' }] : [] })) }
    const from = vi.fn(() => query); integration.pageClient.mockResolvedValue({ from })
    const refresh = vi.fn()
    const controller = createWalletLinkController({ onChange: () => {}, refresh, post: async (path, body, signal) => {
      const action = path.split('/').at(-1)!
      const response = await handleWalletRequest(new NextRequest(`https://bx1.co.za${path}`, {
        method: 'POST', body, signal, headers: { origin: 'https://bx1.co.za', host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' },
      }), { params: Promise.resolve({ action }) })
      expect(response.status).toBe(action === 'challenge' ? 201 : 200)
      expect(response.headers.get('cache-control')).toContain('no-store')
      return response.json()
    } })
    controller.select({
      request: async ({ method, params }) => method === 'personal_sign' ? signer.signMessage(getBytes(params![0] as string)) : method === 'eth_chainId' ? '0x13882' : [liveAddress],
      on: () => {}, removeListener: () => {},
    }, org)
    const before = renderToStaticMarkup(await WorkspacePage())
    expect(before).not.toContain('Ownership verified: compliance pending')
    await controller.connect(); await controller.verify()
    expect(consume).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce()
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('Ownership verified: compliance pending'); expect(html).toContain(liveAddress)
    expect(html).toContain('Financial and token operations are not enabled.')
    expect(from).toHaveBeenCalledWith('bx1_wallets')
    expect(query.select).toHaveBeenCalledWith('id,organisation_id,address,chain_id,verified_at,status')
    expect(query.in).toHaveBeenCalledWith('organisation_id', [org])
    expect(html).not.toContain('session_id'); expect(html).not.toContain('private_key')
    controller.dispose()
  })

  it('does not query wallet tables without verifier configuration', async () => {
    configure(); integration.configured.mockReturnValue(false)
    const from = vi.fn(); integration.pageClient.mockResolvedValue({ from })
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(from).not.toHaveBeenCalled()
    expect(html).toContain('Wallet linking is being configured')
    expect(html).toContain('fixture@example.test')
  })

  it.each([
    { error: { message: 'private-query-detail' }, data: null },
    { error: null, data: [{ ...wallet, organisation_id: 'foreign', chain_id: 80002, verified_at: wallet.verifiedAt }] },
    { error: null, data: [{ ...wallet, organisation_id: org, chain_id: 80002, verified_at: wallet.verifiedAt, status: 'APPROVED' }] },
  ])('contains wallet read failure without breaking sign-in or leaking raw records', async (result) => {
    configure()
    const query = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue(result) }
    integration.pageClient.mockResolvedValue({ from: () => query })
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('fixture@example.test'); expect(html).toContain('Wallet records are temporarily unavailable')
    expect(html).not.toContain('private-query-detail'); expect(html).not.toContain('Ownership verified: compliance pending')
  })
})
