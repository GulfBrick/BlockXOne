import { describe, expect, it } from 'vitest'

import {
  isPortalAccessAdvertised,
  isProductionWebPathBlocked,
  PILOT_ALLOWED_PATHS,
  PILOT_ALLOWED_PREFIXES,
  PRODUCTION_BLOCKED_PREFIXES
} from './release-policy'
import { resolveAuthMode, isLegacyClientAuthDisabled, SUPABASE_ALLOWED_PATHS } from './auth-mode'

describe('native Auth admission', () => {
  it('adds exactly the two administration paths without changing the prior allowlist', () => {
    expect([...SUPABASE_ALLOWED_PATHS]).toEqual([
      '/login', '/auth/confirm', '/auth/login', '/auth/setup', '/auth/logout',
      '/workspace', '/workspace/access-denied', '/api/wallet/challenge', '/api/wallet/verify',
      '/login/mfa', '/workspace/security', '/auth/mfa-enroll', '/auth/mfa-verify',
      '/workspace/administration', '/auth/admin-command',
    ])
  })
  it.each(['/workspace/administration', '/auth/admin-command'])('admits only exact administration path %s in paired mode', pathname => {
    expect(isProductionWebPathBlocked(pathname, 'production', '', '', 'supabase', 'supabase')).toBe(false)
    for (const variant of [`${pathname}/`, `${pathname}/extra`, `${pathname}.json`, pathname.toUpperCase(), pathname.replaceAll('/', '\\'), pathname.replace('admin', '%61dmin'), pathname.replace('/', '//'), `${pathname}/../private`]) expect(isProductionWebPathBlocked(variant, 'production', '', '', 'supabase', 'supabase'), `Blocked administration lookalike: ${variant}`).toBe(true)
    for (const [server, client] of [['supabase', ''], ['', 'supabase'], ['', ''], ['Supabase', 'Supabase']]) expect(isProductionWebPathBlocked(pathname, 'production', '', '', server, client)).toBe(true)
  })
  it.each(PRODUCTION_BLOCKED_PREFIXES)('never treats upper-case protected family %s as public or as an admitted alias', prefix => {
    for (const variant of [prefix.toUpperCase(), `${prefix.toUpperCase()}/UNKNOWN`, `${prefix[0]}${prefix[1].toUpperCase()}${prefix.slice(2)}/unknown`]) {
      expect(isProductionWebPathBlocked(variant, 'production', '', '', 'supabase', 'supabase'), `Protected family must fail closed: ${variant}`).toBe(true)
      expect(isProductionWebPathBlocked(variant, 'production', '', '', 'supabase', ''), `Invalid mode must not make lookalike public: ${variant}`).toBe(true)
    }
  })
  it.each(SUPABASE_ALLOWED_PATHS)('does not admit upper-case alias of exact native path %s', pathname => {
    expect(isProductionWebPathBlocked(pathname, 'production', '', '', 'supabase', 'supabase')).toBe(false)
    expect(isProductionWebPathBlocked(pathname.toUpperCase(), 'production', '', '', 'supabase', 'supabase'), `Not an alias: ${pathname.toUpperCase()}`).toBe(true)
  })
  it.each(['/AUTH', '/WORKSPACE', ...SUPABASE_ALLOWED_PATHS.filter(path => path.startsWith('/auth/') || path.startsWith('/workspace/')).map(path => path.toUpperCase())])('does not give native upper-case path %s a legacy development fallback', pathname => {
    for (const environment of ['production', 'development', 'dev', 'test']) {
      expect(isProductionWebPathBlocked(pathname, environment, '', '', '', ''), `${pathname} is native-only in ${environment}`).toBe(true)
      expect(isProductionWebPathBlocked(pathname, environment, 'pilot', 'pilot', '', ''), `${pathname} is not a pilot alias in ${environment}`).toBe(true)
    }
  })
  it.each(['/login/mfa', '/workspace/security', '/auth/mfa-enroll', '/auth/mfa-verify'])('admits MFA path %s only exactly in paired mode', pathname => {
    expect(isProductionWebPathBlocked(pathname, 'production', '', '', 'supabase', 'supabase')).toBe(false)
    for (const path of [`${pathname}/extra`, `${pathname}/`, pathname.replace('/', '//'), pathname.replaceAll('/', '\\'), pathname.replace('mfa', '%6dfa')]) {
      if (path !== pathname) expect(isProductionWebPathBlocked(path, 'production', '', '', 'supabase', 'supabase')).toBe(true)
    }
    expect(isProductionWebPathBlocked(pathname, 'production', '', '', 'supabase', '')).toBe(true)
    expect(isProductionWebPathBlocked(pathname, 'production', '', '', '', '')).toBe(true)
  })
  it.each(['/auth/mfa-unenroll', '/auth/mfa-reset', '/auth/mfa-cancel', '/auth/mfa/verify', '/login/MFA', '/workspace/security/reset', '/auth/mfa-verify.json'])('keeps MFA bypass/alias path %s blocked', pathname => {
    expect(isProductionWebPathBlocked(pathname, 'production', 'pilot', 'pilot', 'supabase', 'supabase')).toBe(true)
  })
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
