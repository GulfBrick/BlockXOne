import { describe, expect, it } from 'vitest'

import {
  isProductionWebPathBlocked,
  PRODUCTION_BLOCKED_PREFIXES
} from './release-policy'

describe('release-one web policy', () => {
  it.each(PRODUCTION_BLOCKED_PREFIXES)('blocks %s in production', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production')).toBe(true)
    expect(isProductionWebPathBlocked(`${pathname}/direct`, 'production')).toBe(true)
  })

  it('normalizes trailing and duplicate slashes', () => {
    expect(isProductionWebPathBlocked('//investor//p2p/', 'production')).toBe(true)
  })

  it.each([
    '/',
    '/request-demo',
    '/asset-classes',
    '/for-investors',
    '/for-operators',
    '/how-it-works',
    '/security-and-compliance'
  ])('keeps approved production surface %s available', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production')).toBe(false)
  })

  it('preserves local development routes', () => {
    expect(isProductionWebPathBlocked('/investor/p2p', 'development')).toBe(false)
  })

  it.each(['', 'prodution', 'staging'])('fails closed for unknown environment %s', (environment) => {
    expect(isProductionWebPathBlocked('/investor/p2p', environment)).toBe(true)
  })

  it.each([
    '/investor/login',
    '/investor/market',
    '/operator/login',
    '/admin',
    '/compliance/queue',
    '/api/auth/signup'
  ])('does not expose an unapproved application surface at %s', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production')).toBe(true)
  })
})
