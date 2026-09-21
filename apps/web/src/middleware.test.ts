import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'
import { updateSupabaseSession } from './lib/supabase/middleware'

vi.mock('./lib/supabase/middleware', () => ({ updateSupabaseSession: vi.fn() }))

describe('branded TEST legacy entry cutover', () => {
  const branded = 'https://testnet.bx1.co.za'
  const legacyHost = 'block-x-one-git-codex-testnet-961d10-danielswart-4443s-projects.vercel.app'
  const legacy = `https://${legacyHost}`

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', '')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', '')
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
    vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', branded)
    vi.mocked(updateSupabaseSession).mockReset()
    vi.mocked(updateSupabaseSession).mockResolvedValue(NextResponse.next())
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    '/', '/login', '/register', '/portal?mode=applicant',
    '/auth/confirm?token_hash=synthetic&type=signup',
    '/auth/confirm?token_hash=synthetic&type=invite',
    '/auth/confirm?token_hash=synthetic&type=recovery',
    '/auth/confirm?token_hash=one&token_hash=two&type=signup',
  ])('moves legacy GET %s before session refresh or callback cookie handling', async path => {
    const response = await middleware(new NextRequest(`${legacy}${path}`, { headers: { host: legacyHost } }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${branded}${path}`)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it('redirects HEAD without refreshing a session', async () => {
    const response = await middleware(new NextRequest(`${legacy}/login?setup=1`, { method: 'HEAD', headers: { host: legacyHost } }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${branded}/login?setup=1`)
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('refuses legacy %s without replaying a body or refreshing cookies', async method => {
    const request = new NextRequest(`${legacy}/auth/login`, {
      method, headers: { host: legacyHost, origin: legacy, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=synthetic%40example.test&password=synthetic-not-a-secret',
    })
    const response = await middleware(request)
    expect(response.status).toBe(403)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(request.bodyUsed).toBe(false)
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it('preserves the canonical refreshed response/cookies without a redirect loop', async () => {
    const refreshed = NextResponse.next()
    refreshed.cookies.set('fixture-refresh', 'nonsecret', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    vi.mocked(updateSupabaseSession).mockResolvedValueOnce(refreshed)
    const response = await middleware(new NextRequest(`${branded}/login`, { headers: { host: 'testnet.bx1.co.za' } }))
    expect(response).toBe(refreshed)
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.get('fixture-refresh')?.value).toBe('nonsecret')
    expect(updateSupabaseSession).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'evil.test', 'testnet.bx1.co.za', `${legacyHost}:444`])('refuses a mismatched legacy Host %s instead of trusting forwarded headers', async host => {
    const headers: Record<string, string> = { 'x-forwarded-host': legacyHost, forwarded: `host=${legacyHost};proto=https` }
    if (host) headers.host = host
    const response = await middleware(new NextRequest(`${legacy}/auth/confirm?token_hash=synthetic&type=signup`, { headers }))
    expect(response.status).toBe(403)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it('never lets a path, query or forwarded authority select the destination host', async () => {
    const path = '//evil.test/login?next=https%3A%2F%2Fevil.test%2F&returnTo=%2F%2Fevil.test'
    const response = await middleware(new NextRequest(`${legacy}${path}`, {
      headers: { host: legacyHost, 'x-forwarded-host': 'evil.test', forwarded: 'host=evil.test;proto=http' },
    }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`${branded}${path}`)
    expect(new URL(response.headers.get('location')!).origin).toBe(branded)
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it.each([
    'https://bx1.co.za', 'https://block-x-one.vercel.app', 'https://other-preview.vercel.app',
    `https://${legacyHost}.evil.test`, 'https://evil.test', 'http://localhost:3000',
  ])('never promotes a different request origin %s into the legacy redirect', async origin => {
    const response = await middleware(new NextRequest(`${origin}/`, {
      headers: { host: legacyHost, 'x-forwarded-host': legacyHost, forwarded: `host=${legacyHost};proto=https` },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it.each([
    ['BLOCKXONE_APP_ORIGIN', legacy],
    ['BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za.evil.test'],
    ['BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za:444'],
    ['BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za/'],
    ['BLOCKXONE_TESTNET_FUND_DEMO', 'disabled'],
    ['BLOCKXONE_AUTH_MODE', 'legacy'], ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'legacy'],
    ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'],
    ['VERCEL_ENV', 'production'], ['VERCEL_ENV', 'development'],
  ])('keeps cutover inactive with invalid branded TEST configuration %s=%s', async (key, value) => {
    vi.stubEnv(key, value)
    const response = await middleware(new NextRequest(`${legacy}/`, { headers: { host: legacyHost } }))
    expect(response.headers.get('location')).toBeNull()
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })
})

describe('production middleware containment', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', '')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', '')
    vi.stubEnv('BLOCKXONE_AUTH_MODE', '')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    '/investor/p2p',
    '/investor/orders/direct',
    '/investor/funds/demo-fund',
    '/wm/funds/new',
    '/tokenisation-agent/mint',
    '/admin/features',
    '/investor/portfolio',
    '/operator/login',
    '/api/auth/signup'
  ])('returns 404 for direct request to %s', async (pathname) => {
    const response = await middleware(new NextRequest(`https://app.blockxone.example${pathname}`))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps the guided lifecycle available as an explicitly public demonstration', async () => {
    const productionResponse = await middleware(new NextRequest('https://app.blockxone.example/guided-demo'))
    expect(productionResponse.status).toBe(200)

    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    const pilotResponse = await middleware(new NextRequest('https://app.blockxone.example/guided-demo'))
    expect(pilotResponse.status).toBe(200)
  })

  it.each([
    '/investor/login',
    '/operator/login',
    '/investor/market',
    '/investor/funds/verified-id',
    '/wm/funds/new',
    '/wm/subscriptions',
    '/compliance/queue',
    '/tokenisation-agent/whitelist',
    '/tokenisation-agent/mint',
    '/api/auth/login',
  ])('allows the verified route %s only when pilot mode is explicit', async (pathname) => {
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    const response = await middleware(new NextRequest(`https://app.blockxone.example${pathname}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
  })

  it.each([
    '/investor/register',
    '/investor/p2p',
    '/admin',
    '/api/auth/signup',
    '/tokenisation-agent/force-transfer',
  ])('keeps %s contained in pilot mode', async (pathname) => {
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    const response = await middleware(new NextRequest(`https://app.blockxone.example${pathname}`))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('preserves the exact refreshed response and its cookies, including redirects', async () => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    const refreshed = NextResponse.redirect(new URL('https://bx1.co.za/login'), 303)
    refreshed.cookies.set('fixture-refresh', 'nonsecret', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    vi.mocked(updateSupabaseSession).mockResolvedValueOnce(refreshed)
    const response = await middleware(new NextRequest('https://bx1.co.za/workspace'))
    expect(response).toBe(refreshed)
    expect(response.cookies.get('fixture-refresh')?.value).toBe('nonsecret')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it.each(['/login', '/login?setup=1', '/login?error=invalid_credentials', '/workspace', '/auth/confirm', '/login/mfa', '/login/mfa?continue=setup', '/workspace/security', '/workspace/administration', '/workspace/administration?organisation=11111111-1111-4111-8111-111111111111', '/workspace/administration?organisation=11111111-1111-4111-8111-111111111111&proposal=22222222-2222-4222-8222-222222222222'])('permits Origin-bearing native forms only on the clean document %s', async (path) => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    const refreshed = NextResponse.next()
    refreshed.headers.set('Referrer-Policy', 'no-referrer')
    refreshed.cookies.set('fixture-refresh', 'nonsecret', { httpOnly: true })
    vi.mocked(updateSupabaseSession).mockResolvedValueOnce(refreshed)
    const response = await middleware(new NextRequest(`https://bx1.co.za${path}`))
    expect(response).toBe(refreshed)
    expect(response.headers.get('referrer-policy')).toBe('strict-origin')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.cookies.get('fixture-refresh')?.value).toBe('nonsecret')
  })

  it.each(['/auth/confirm?token_hash=synthetic&type=invite', '/login?token=synthetic', '/workspace?code=synthetic', '/workspace/access-denied', '/login/mfa?continue=setup&continue=setup', '/login/mfa?code=synthetic', '/workspace/security?token=synthetic', '/workspace/administration?token=synthetic', '/workspace/administration?proposal=invalid', '/workspace/administration?organisation=11111111-1111-4111-8111-111111111111&organisation=11111111-1111-4111-8111-111111111111'])('retains no-referrer for token-bearing or non-form %s', async (path) => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.mocked(updateSupabaseSession).mockResolvedValueOnce(NextResponse.next())
    expect((await middleware(new NextRequest(`https://bx1.co.za${path}`))).headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('does not override no-referrer on refresh errors or POST responses', async () => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.mocked(updateSupabaseSession).mockResolvedValueOnce(NextResponse.json({ error: 'unavailable' }, { status: 503 }))
    expect((await middleware(new NextRequest('https://bx1.co.za/login'))).headers.get('referrer-policy')).toBe('no-referrer')
    vi.mocked(updateSupabaseSession).mockResolvedValueOnce(NextResponse.next())
    expect((await middleware(new NextRequest('https://bx1.co.za/auth/login', { method: 'POST' }))).headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('does not call refresh on public or denied routes, and returns503 on invalid mode', async () => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    expect((await middleware(new NextRequest('https://bx1.co.za/'))).status).toBe(200)
    expect((await middleware(new NextRequest('https://bx1.co.za/api/logout'))).status).toBe(404)
    expect(updateSupabaseSession).not.toHaveBeenCalled()
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    const response = await middleware(new NextRequest('https://bx1.co.za/workspace'))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })
  it.each(['/WORKSPACE/ADMINISTRATION', '/AUTH/ADMIN-COMMAND', '/API/MINT', '/ADMIN'])('returns a private denial for uppercase protected lookalike %s without refreshing a session', async path => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    const response = await middleware(new NextRequest(`https://bx1.co.za${path}`))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(updateSupabaseSession).not.toHaveBeenCalled()
  })

  it('fails closed when the writable refresh boundary fails', async () => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.mocked(updateSupabaseSession).mockRejectedValueOnce(new Error('fixture'))
    expect((await middleware(new NextRequest('https://bx1.co.za/workspace'))).status).toBe(503)
  })
})
