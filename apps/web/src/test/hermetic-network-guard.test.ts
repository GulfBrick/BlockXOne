import { describe, expect, it, vi } from 'vitest'

import {
  assertHermeticHttpUrlAllowed,
  createHermeticFetch,
  isNormalizedLoopbackHostname,
} from './hermetic-network-guard'

const strippedEnvironmentNames = [
  'DATABASE_URL',
  'RPC_URL',
  'PROVIDER_TOKEN',
  'SIGNING_SECRET',
  'PASSWORD',
  'CREDENTIAL',
  'PRIVATE_KEY',
  'PRODUCTION_URL',
  'AWS_SECRET_ACCESS_KEY',
  'AZURE_CLIENT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GITHUB_TOKEN',
  'NODE_OPTIONS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'npm_config_registry',
  'VITE_API_URL',
  'NEXT_PUBLIC_UNEXPECTED',
]

describe('hermetic fetch-level guard', () => {
  it.each([
    'localhost',
    'localhost.',
    'LOCALHOST',
    '127.0.0.1',
    '127.255.255.254',
    '::1',
    '[::1]',
  ])('accepts normalized loopback hostname %s', (hostname) => {
    expect(isNormalizedLoopbackHostname(hostname)).toBe(true)
  })

  it.each([
    'example.com',
    'api.localhost',
    'localhost..',
    '126.255.255.255',
    '128.0.0.1',
    '127.256.0.1',
    '127.0.0.999',
    '10.0.0.1',
    '::',
    '::2',
    '::ffff:127.0.0.1',
  ])('rejects non-loopback hostname %s', (hostname) => {
    expect(isNormalizedLoopbackHostname(hostname)).toBe(false)
  })

  it.each([
    'http://localhost:3000/',
    'https://localhost./',
    'http://127.1/',
    'https://127.255.255.254/',
    'http://[::1]:8080/',
  ])('allows WHATWG-normalized HTTP(S) loopback URL %s', (value) => {
    expect(() => assertHermeticHttpUrlAllowed(new URL(value))).not.toThrow()
  })

  it.each([
    'http://example.com/',
    'https://10.0.0.1/',
    'http://[fd00::1]/',
    'https://api.localhost/',
  ])('blocks non-loopback HTTP(S) URL %s before native fetch', async (value) => {
    const nativeFetch = vi.fn<typeof fetch>()
    const guardedFetch = createHermeticFetch(nativeFetch)

    await expect(guardedFetch(value)).rejects.toThrow(/blocked non-loopback HTTP\(S\) origin/)
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('handles string, URL, and Request inputs without weakening the boundary', async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const guardedFetch = createHermeticFetch(nativeFetch)

    await guardedFetch('http://127.0.0.1/')
    await guardedFetch(new URL('https://localhost./'))
    await guardedFetch(new Request('http://[::1]/'))

    expect(nativeFetch).toHaveBeenCalledTimes(3)
  })

  it('does not allow automatic redirects to become an egress path', async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://example.com/escape' } })
    )
    const guardedFetch = createHermeticFetch(nativeFetch)

    await expect(guardedFetch('http://127.0.0.1/start')).rejects.toThrow(/blocked non-loopback/)
    expect(nativeFetch).toHaveBeenCalledOnce()
    expect(nativeFetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it('preserves explicit manual redirects without following them', async () => {
    const redirect = new Response(null, { status: 302, headers: { location: 'https://example.com/escape' } })
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(redirect)
    const guardedFetch = createHermeticFetch(nativeFetch)

    await expect(guardedFetch('http://localhost/start', { redirect: 'manual' })).resolves.toBe(redirect)
  })

  it('leaves non-HTTP schemes to native fetch behavior', async () => {
    const response = new Response('ok')
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response)
    const guardedFetch = createHermeticFetch(nativeFetch)

    await expect(guardedFetch('data:text/plain,ok')).resolves.toBe(response)
    expect(nativeFetch).toHaveBeenCalledWith('data:text/plain,ok', undefined)
  })

  it('installs the guard globally before tests execute', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow(/blocked non-loopback/)
  })
})

describe('hermetic child environment', () => {
  it.each(strippedEnvironmentNames)('does not forward hostile variable %s', (name) => {
    expect(process.env[name]).toBeUndefined()
  })

  it('sets only the documented fixed public test configuration', () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect(process.env.TZ).toBe('UTC')
    expect(process.env.LANG).toBe('C')
    expect(process.env.LC_ALL).toBe('C')
    expect(process.env.NEXT_PUBLIC_API_URL).toBe('https://api.blockxone.example')
    expect(process.env.SERVER_ACTION_ALLOWED_ORIGINS).toBe('app.blockxone.example')
    expect(process.env.BLOCKXONE_HERMETIC_RUNNER).toBe('1')
  })
})
