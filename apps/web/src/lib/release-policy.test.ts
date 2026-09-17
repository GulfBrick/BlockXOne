import { describe, expect, it } from 'vitest'

import {
  isPortalAccessAdvertised,
  isProductionWebPathBlocked,
  PILOT_ALLOWED_PATHS,
  PILOT_ALLOWED_PREFIXES,
  PRODUCTION_BLOCKED_PREFIXES
} from './release-policy'
import { resolveAuthMode, isLegacyClientAuthDisabled } from './auth-mode'

describe('native Auth admission', () => {
  it.each(['/login', '/auth/confirm', '/auth/login', '/auth/setup', '/auth/logout', '/workspace', '/workspace/access-denied', '/api/wallet/challenge', '/api/wallet/verify'])('admits only the exact native path %s', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production', 'pilot', 'pilot', 'supabase', 'supabase')).toBe(false)
    expect(isProductionWebPathBlocked(`${pathname}/extra`, 'production', 'pilot', 'pilot', 'supabase', 'supabase')).toBe(true)
    expect(isProductionWebPathBlocked(pathname, 'production', '', '', 'supabase', '')).toBe(true)
  })
  it.each([
    '/api/wallet', '/api/wallet/', '/api/wallet/*', '/api/wallet/finalize', '/api/wallet/read',
    '/api/wallet/challenge/', '/api/wallet/verify/', '/api/wallet/verify/extra',
    '/api/wallet/%76erify', '/api%2Fwallet/verify', '//api/wallet/verify', '/api//wallet/verify',
    '/api/wallet\\verify', '/api/wallet/VERIFY', '/api/wallet/verify.json',
    '/api/payments', '/api/mint', '/tokenisation-agent/mint', '/compliance/wallets', '/admin/wallets',
  ])('denies wallet lookalikes and financial route %s', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production', 'pilot', 'pilot', 'supabase', 'supabase')).toBe(true)
  })
  it.each(['/api/login', '/api/logout', '/api/auth/login', '/api/auth/signup', '/api/auth/user', '/investor/login', '/operator/login', '/wm/funds/new', '/admin', '/register', '/auth/signup', '/workspace/private', '/%61uth/login', '/auth%2Flogin', '//auth/login', '/auth/login/', '/auth\\login'])('denies %s despite development and pilot flags', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'development', 'pilot', 'pilot', 'supabase', 'supabase')).toBe(true)
  })
  it('keeps public routes and exact-mode navigation while invalid flags stay contained', () => {
    expect(isProductionWebPathBlocked('/', 'production', '', '', 'invalid', 'invalid')).toBe(false)
    expect(isPortalAccessAdvertised('production', '', '', 'supabase', 'supabase')).toBe(true)
    expect(isPortalAccessAdvertised('development', 'pilot', 'pilot', 'supabase', '')).toBe(false)
    expect(isProductionWebPathBlocked('/workspace', 'development', '', '', '', '')).toBe(true)
    expect(isProductionWebPathBlocked('/auth/confirm', 'development', '', '', '', '')).toBe(true)
  })
  it('never enables legacy browser Auth on any declared public mode', () => {
    expect(resolveAuthMode('', '')).toBe('legacy')
    expect(resolveAuthMode('supabase', 'supabase')).toBe('supabase')
    expect(resolveAuthMode('supabase', '')).toBe('invalid')
    expect(resolveAuthMode('Supabase', 'Supabase')).toBe('invalid')
    expect(isLegacyClientAuthDisabled('')).toBe(false)
    for (const value of ['supabase', 'unknown', 'Supabase', ' ']) expect(isLegacyClientAuthDisabled(value)).toBe(true)
  })
})

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
    '/guided-demo',
    '/how-it-works',
    '/security-and-compliance'
  ])('keeps approved production surface %s available', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production')).toBe(false)
  })

  it('preserves local development routes', () => {
    expect(isProductionWebPathBlocked('/investor/p2p', 'development')).toBe(false)
  })

  it('contains unfinished routes when the local functional stack explicitly runs in pilot mode', () => {
    expect(isProductionWebPathBlocked('/investor/market', 'development', 'pilot', 'pilot')).toBe(false)
    expect(isProductionWebPathBlocked('/wm/funds/new', 'development', 'pilot', 'pilot')).toBe(false)
    expect(isProductionWebPathBlocked('/tokenisation-agent/deploy', 'development', 'pilot', 'pilot')).toBe(false)
    expect(isProductionWebPathBlocked('/investor/p2p', 'development', 'pilot', 'pilot')).toBe(true)
    expect(isProductionWebPathBlocked('/wm/ledger', 'development', 'pilot', 'pilot')).toBe(true)
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

  it.each(PILOT_ALLOWED_PATHS)('opens the verified pilot surface %s only in explicit pilot mode', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production')).toBe(true)
    expect(isProductionWebPathBlocked(pathname, 'production', 'pilot', 'pilot')).toBe(false)
    expect(isProductionWebPathBlocked(pathname, 'production', 'pilot-share', 'pilot-share')).toBe(false)
  })

  it.each(PILOT_ALLOWED_PREFIXES)('opens dynamic routes below %s only in explicit pilot mode', (prefix) => {
    expect(isProductionWebPathBlocked(`${prefix}/verified-id`, 'production')).toBe(true)
    expect(isProductionWebPathBlocked(`${prefix}/verified-id`, 'production', 'pilot', 'pilot')).toBe(false)
  })

  it.each([
    '/register',
    '/investor/register',
    '/investor/p2p',
    '/investor/orders',
    '/admin',
    '/compliance/rules',
    '/compliance/audit',
    '/tokenisation-agent/burn',
    '/tokenisation-agent/freeze',
    '/tokenisation-agent/force-transfer',
    '/api/auth/signup',
    '/api/debug/subscriptions',
    '/test',
  ])('keeps unverified or invitation-breaking path %s closed in pilot mode', (pathname) => {
    expect(isProductionWebPathBlocked(pathname, 'production', 'pilot', 'pilot')).toBe(true)
  })

  it('allows the issuer compatibility route to redirect into the real pilot workspace', () => {
    expect(isProductionWebPathBlocked('/issuer', 'production', 'pilot', 'pilot')).toBe(false)
  })

  it.each(['', 'preview', 'staging', 'production'])('fails closed for release mode %s', (releaseMode) => {
    expect(isProductionWebPathBlocked('/investor/market', 'production', releaseMode, releaseMode)).toBe(true)
  })

  it('requires server and public pilot flags together', () => {
    expect(isProductionWebPathBlocked('/investor/market', 'production', 'pilot', '')).toBe(true)
    expect(isProductionWebPathBlocked('/investor/market', 'production', '', 'pilot')).toBe(true)
    expect(isProductionWebPathBlocked('/investor/market', 'production', 'pilot-share', '')).toBe(true)
    expect(isProductionWebPathBlocked('/investor/market', 'production', 'pilot-share', 'pilot')).toBe(true)
  })

  it('advertises portal access only in development or the explicit production pilot', () => {
    expect(isPortalAccessAdvertised('development')).toBe(true)
    expect(isPortalAccessAdvertised('test')).toBe(true)
    expect(isPortalAccessAdvertised('production')).toBe(false)
    expect(isPortalAccessAdvertised('production', 'pilot', 'pilot')).toBe(true)
    expect(isPortalAccessAdvertised('production', 'pilot-share', 'pilot-share')).toBe(true)
    expect(isPortalAccessAdvertised('production', 'pilot', '')).toBe(false)
    expect(isPortalAccessAdvertised('staging', 'pilot', 'pilot')).toBe(false)
  })
})
