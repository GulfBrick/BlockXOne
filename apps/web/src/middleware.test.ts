import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'

describe('production middleware containment', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', '')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', '')
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
  ])('returns 404 for direct request to %s', (pathname) => {
    const response = middleware(new NextRequest(`https://app.blockxone.example${pathname}`))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps the guided lifecycle available as an explicitly public demonstration', () => {
    const productionResponse = middleware(new NextRequest('https://app.blockxone.example/guided-demo'))
    expect(productionResponse.status).toBe(200)

    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    const pilotResponse = middleware(new NextRequest('https://app.blockxone.example/guided-demo'))
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
  ])('allows the verified route %s only when pilot mode is explicit', (pathname) => {
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    const response = middleware(new NextRequest(`https://app.blockxone.example${pathname}`))
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
  ])('keeps %s contained in pilot mode', (pathname) => {
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    const response = middleware(new NextRequest(`https://app.blockxone.example${pathname}`))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
