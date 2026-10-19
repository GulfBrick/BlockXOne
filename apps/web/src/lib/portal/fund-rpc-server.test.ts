import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { createFundServerRpc } from './fund-rpc-server'
import { fundAdmissionRpc } from './fund-chain-admission'
import { readSetupNonce } from './fund-setup-chain'
import { FUNDING_RPC_URLS } from './funding-verifier'

const clientId = 'a'.repeat(32), secret = 'S'.repeat(88), rotated = 'R'.repeat(88), alchemySecret = 'A'.repeat(32), alchemyRotated = 'B'.repeat(32)
function configure() {
  vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'TESTNET')
  vi.stubEnv('BLOCKXONE_AMOY_RPC_CLIENT_ID', clientId)
  vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', secret)
  vi.stubEnv('BLOCKXONE_AMOY_ALCHEMY_RPC_SECRET_KEY', alchemySecret)
}
function provider() {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string }
    const result = request.method === 'eth_chainId' ? '0x13882'
      : request.method === 'eth_getTransactionCount' ? '0x7'
        : { number: '0x1', hash: '0x' + '4'.repeat(64), timestamp: '0x5', transactions: [] }
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  })
}
beforeEach(() => configure())
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('server-only Amoy RPC wiring - synthetic source proof only', () => {
  it.each(['MAINNET', '', 'TESTNET ', 'LOCAL_PILOT'])('rejects non-TEST environment %s before a fetch', environment => {
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', environment)
    const fetcher = provider()
    expect(() => createFundServerRpc(fetcher)).toThrowError(expect.objectContaining({ code: 'RPC_AUTH_NOT_ADMITTED', status: 409 }))
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['BLOCKXONE_AMOY_RPC_CLIENT_ID', 'BLOCKXONE_AMOY_RPC_SECRET_KEY', 'BLOCKXONE_AMOY_ALCHEMY_RPC_SECRET_KEY'])('fails closed when %s is absent', name => {
    vi.stubEnv(name, undefined)
    const fetcher = provider()
    expect(() => createFundServerRpc(fetcher)).toThrowError(expect.objectContaining({ code: 'RPC_AUTH_NOT_CONFIGURED', status: 503 }))
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reads configuration per operation and retains the captured credential within an operation', async () => {
    const fetcher = provider(), first = createFundServerRpc(fetcher)
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', rotated)
    await first(FUNDING_RPC_URLS[0], 'eth_chainId', [])
    await createFundServerRpc(fetcher)(FUNDING_RPC_URLS[0], 'eth_chainId', [])
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-secret-key')).toBe(secret)
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('x-secret-key')).toBe(rotated)
    vi.stubEnv('BLOCKXONE_AMOY_ALCHEMY_RPC_SECRET_KEY', alchemyRotated)
    await first(FUNDING_RPC_URLS[1], 'eth_chainId', [])
    await createFundServerRpc(fetcher)(FUNDING_RPC_URLS[1], 'eth_chainId', [])
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Authorization')).toBe(`Bearer ${alchemySecret}`)
    expect(new Headers(fetcher.mock.calls[3][1]?.headers).get('Authorization')).toBe(`Bearer ${alchemyRotated}`)
  })
  it('shares one captured default transport across both setup observers and all nonce reads', async () => {
    const fetcher = provider()
    vi.stubGlobal('fetch', fetcher)
    expect(await readSetupNonce('0x' + '1'.repeat(40))).toBe('7')
    expect(fetcher).toHaveBeenCalledTimes(10)
    const ids = fetcher.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { id: number }).id)
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1))
    for (const [url, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers)
      if (String(url) === `${FUNDING_RPC_URLS[0]}/${clientId}`) expect(headers.get('x-secret-key')).toBe(secret)
      else {
        expect(url).toBe(FUNDING_RPC_URLS[1])
        expect(headers.has('x-secret-key')).toBe(false)
        expect(headers.has('x-client-id')).toBe(false)
        expect(headers.get('Authorization')).toBe(`Bearer ${alchemySecret}`)
      }
    }
  })
  it('creates and caches the admission fallback only when the first non-injected request needs it', async () => {
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', undefined)
    const fetcher = provider()
    vi.stubGlobal('fetch', fetcher)
    const rpc = fundAdmissionRpc()
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', secret)
    await rpc(FUNDING_RPC_URLS[0], 'eth_chainId', [])
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', rotated)
    await rpc(FUNDING_RPC_URLS[0], 'eth_chainId', [])
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-secret-key'))).toEqual([secret, secret])
  })
  it('captures the shared setup fallback before a partially injected observer changes environment values', async () => {
    const fetcher = provider()
    vi.stubGlobal('fetch', fetcher)
    const secondary = vi.fn(async (_url: string, method: string) => {
      vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', rotated)
      return method === 'eth_chainId' ? '0x13882' : method === 'eth_getTransactionCount' ? '0x7'
        : { number: '0x1', hash: '0x' + '4'.repeat(64), timestamp: '0x5', transactions: [] }
    })
    expect(await readSetupNonce('0x' + '1'.repeat(40), { secondary })).toBe('7')
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(secondary).toHaveBeenCalledTimes(5)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(`${FUNDING_RPC_URLS[0]}/${clientId}`)
      expect(new Headers(init?.headers).get('x-secret-key')).toBe(secret)
    }
  })
  it('does not initialise an admission fallback for an injected first provider with missing credentials', async () => {
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', undefined)
    const fetcher = provider(), primary = vi.fn(async () => '0x13882')
    vi.stubGlobal('fetch', fetcher)
    const rpc = fundAdmissionRpc({ primary })
    expect(await rpc(FUNDING_RPC_URLS[0], 'eth_chainId', [])).toBe('0x13882')
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', secret)
    expect(await rpc(FUNDING_RPC_URLS[1], 'eth_chainId', [])).toBe('0x13882')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('x-secret-key')).toBe(false)
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe(`Bearer ${alchemySecret}`)
  })
  it('retains fully injected setup and admission transports without environment credentials', async () => {
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'MAINNET')
    vi.stubEnv('BLOCKXONE_AMOY_RPC_CLIENT_ID', undefined)
    vi.stubEnv('BLOCKXONE_AMOY_RPC_SECRET_KEY', undefined)
    vi.stubEnv('BLOCKXONE_AMOY_ALCHEMY_RPC_SECRET_KEY', undefined)
    const injected = vi.fn(async (_url: string, method: string) => method === 'eth_chainId' ? '0x13882'
      : method === 'eth_getTransactionCount' ? '0x7'
        : { number: '0x1', hash: '0x' + '4'.repeat(64), timestamp: '0x5', transactions: [] })
    expect(await readSetupNonce('0x' + '1'.repeat(40), { primary: injected, secondary: injected })).toBe('7')
    expect(await fundAdmissionRpc({ rpc: injected })(FUNDING_RPC_URLS[0], 'eth_chainId', [])).toBe('0x13882')
  })
  it('forwards the admission caller signal to queued secondary work without fetching after cancellation', async () => {
    const fetcher = provider(), abort = new AbortController()
    vi.stubGlobal('fetch', fetcher)
    const rpc = fundAdmissionRpc({}, abort.signal)
    abort.abort()
    await expect(rpc(FUNDING_RPC_URLS[1], 'eth_chainId', [])).rejects.toMatchObject({ code: 'ADMISSION_OBSERVATION_UNAVAILABLE' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
