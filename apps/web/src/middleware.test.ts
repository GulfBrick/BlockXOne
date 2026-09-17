import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'
import { updateSupabaseSession } from './lib/supabase/middleware'

vi.mock('./lib/supabase/middleware', () => ({ updateSupabaseSession: vi.fn() }))

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

  it.each(['/login', '/login?setup=1', '/login?error=invalid_credentials', '/workspace', '/auth/confirm'])('permits Origin-bearing native forms only on the clean document %s', async (path) => {
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

  it.each(['/auth/confirm?token_hash=synthetic&type=invite', '/login?token=synthetic', '/workspace?code=synthetic', '/workspace/access-denied'])('retains no-referrer for token-bearing or non-form %s', async (path) => {
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

  it('fails closed when the writable refresh boundary fails', async () => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.mocked(updateSupabaseSession).mockRejectedValueOnce(new Error('fixture'))
    expect((await middleware(new NextRequest('https://bx1.co.za/workspace'))).status).toBe(503)
  })
})
