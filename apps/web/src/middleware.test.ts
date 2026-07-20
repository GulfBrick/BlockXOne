import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'

describe('production middleware containment', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'production'))
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
})
