import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSupabaseWebPathAllowed, SUPABASE_ALLOWED_PATHS } from './auth-mode'
import { isProductionWebPathBlocked } from './release-policy'

const service = '/api/portal/documents/processing'
const blocked = (path: string, server = 'supabase', browser = 'supabase') =>
  isProductionWebPathBlocked(path, 'production', 'production', 'production', server, browser)

describe('exact connected wallet context routing', () => {
  const path = '/api/wallet/context'

  it('admits only the three implemented wallet actions through paired Supabase auth', () => {
    expect(SUPABASE_ALLOWED_PATHS.filter(value => value.startsWith('/api/wallet/'))).toEqual([
      '/api/wallet/challenge', '/api/wallet/verify', path,
    ])
    expect(SUPABASE_ALLOWED_PATHS.filter(value => value === path)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(path)).toBe(true)
    expect(blocked(path)).toBe(false)
    // This reaches the existing wallet handler; it does not satisfy its actor,
    // origin, live session, MFA or native organisation/account ownership guard.
  })

  it.each([`${path}/`, `${path}/extra`, `${path}-admin`, `${path}.json`, path.toUpperCase(),
    '/api/wallet/Context', '/api/wallet/%63ontext', '/api/wallet//context', '//api/wallet/context',
    '/api\\wallet\\context', `${path}/../unknown`, `${path}/%2e%2e/unknown`, '/api/wallet', '/api/wallet/unknown',
  ])('denies unimplemented, nested or lookalike wallet context %s', value => {
    expect(isSupabaseWebPathAllowed(value)).toBe(false)
    expect(blocked(value)).toBe(true)
  })

  it.each([['supabase', ''], ['', 'supabase'], ['Supabase', 'Supabase'], ['supabase', 'legacy'],
    ['legacy', 'supabase'], ['invalid', 'supabase'], ['legacy', 'legacy'], ['', ''],
  ])('keeps context denied under unpaired or legacy auth %s/%s', (server, browser) => {
    expect(blocked(path, server, browser)).toBe(true)
  })
})

describe('complete exact native fund route inventory', () => {
  const paths = [
    '/api/portal/fund-lifecycle/admission', '/api/portal/fund-lifecycle/approval', '/api/portal/fund-lifecycle/execute',
    '/api/portal/fund-lifecycle/keys/bind', '/api/portal/fund-lifecycle/keys/read',
    '/api/portal/fund-lifecycle/payment', '/api/portal/fund-lifecycle/payment/receipt',
    '/api/portal/fund-lifecycle/payment/reference', '/api/portal/fund-lifecycle/payment/submit',
    '/api/portal/fund-lifecycle/read',
    '/api/portal/fund-lifecycle/recipient/claim', '/api/portal/fund-lifecycle/recipient/claim-preview',
    '/api/portal/fund-lifecycle/recipient/claim-signature', '/api/portal/fund-lifecycle/recipient/command',
    '/api/portal/fund-lifecycle/recipient/find', '/api/portal/fund-lifecycle/recipient/prepare',
    '/api/portal/fund-lifecycle/recipient/read', '/api/portal/fund-lifecycle/recipient/signature', '/api/portal/fund-lifecycle/recipient/verify',
    '/api/portal/fund-lifecycle/setup/command', '/api/portal/fund-lifecycle/setup/prepare',
    '/api/portal/fund-lifecycle/setup/read', '/api/portal/fund-lifecycle/setup/verify',
    '/api/portal/fund-lifecycle/signature', '/api/portal/fund-lifecycle/transaction', '/api/portal/fund-lifecycle/verify',
  ] as const

  it('matches all 26 existing route handlers without admitting a directory or wildcard', () => {
    const directory = resolve(process.cwd(), 'src/app/api/portal/fund-lifecycle')
    function routes(relative = ''): string[] {
      return readdirSync(resolve(directory, relative), { withFileTypes: true }).flatMap(entry => {
        if (entry.isDirectory()) return routes(relative ? `${relative}/${entry.name}` : entry.name)
        return entry.isFile() && entry.name === 'route.ts' ? [`/api/portal/fund-lifecycle/${relative}`] : []
      })
    }
    expect(paths).toHaveLength(26)
    expect(routes().sort()).toEqual([...paths].sort())
    expect(SUPABASE_ALLOWED_PATHS.filter(path => path.startsWith('/api/portal/fund-lifecycle'))).toEqual([...paths])
  })

  it.each(paths)('admits exact %s only through the existing paired Supabase boundary', path => {
    expect(SUPABASE_ALLOWED_PATHS.filter(value => value === path)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(path)).toBe(true)
    expect(blocked(path)).toBe(false)
    for (const [server, browser] of [['supabase', ''], ['', 'supabase'], ['Supabase', 'Supabase'],
      ['supabase', 'legacy'], ['legacy', 'supabase'], ['invalid', 'supabase'], ['legacy', 'legacy'], ['', '']]) {
      expect(blocked(path, server, browser)).toBe(true)
    }
    // Reachability is not setup, payment, signing, issuance or holding authority.
    // Those remain in the unchanged authenticated route and native writer.
  })

  it.each(paths.flatMap(path => [
    `${path}/`, `${path}/extra`, `${path}-admin`, `${path}.json`, path.toUpperCase(),
    path.replace('/portal/', '/Portal/'), path.replace('/fund-lifecycle/', '/%66und-lifecycle/'),
    path.replace('/portal/', '/portal//'), `/${path}`, path.replaceAll('/', '\\'),
    `${path}/../unknown`, `${path}/%2e%2e/unknown`, `${path}/*`,
  ]))('denies raw fund lookalike or nested path %s', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })

  it.each(['/api/portal/fund-lifecycle', '/api/portal/fund-lifecycle/', '/api/portal/fund-lifecycle/unknown',
    '/api/portal/fund-lifecycle/setup', '/api/portal/fund-lifecycle/keys', '/api/portal/fund-lifecycle/recipient',
    '/api/portal/fund-lifecycle/recipient/unknown', '/api/portal/fund-lifecycle/setup/deploy',
  ])('does not admit an unimplemented fund directory or action: %s', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })
})

describe('exact password-reset request routing', () => {
  it.each(['/forgot-password', '/auth/recover'])('admits only the paired Supabase route %s', path => {
    expect(SUPABASE_ALLOWED_PATHS.filter(value => value === path)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(path)).toBe(true)
    expect(blocked(path)).toBe(false)
    expect(blocked(path, 'supabase', '')).toBe(true)
    expect(blocked(path, '', '')).toBe(true)
  })
  it.each(['/forgot-password/', '/forgot-password/extra', '/Forgot-password', '/%66orgot-password', '/auth/recover/', '/auth/recover/extra', '/auth/Recover'])('denies recovery lookalike %s', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })
})

describe('exact protected provider-readiness routing', () => {
  const paths = ['/api/portal/kyc/readiness', '/api/portal/offering-signatures/provider-status'] as const

  it.each(paths)('admits only the canonical route %s in paired Supabase mode', path => {
    expect(SUPABASE_ALLOWED_PATHS.filter(value => value === path)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(path)).toBe(true)
    expect(blocked(path)).toBe(false)
    // Admission only reaches the unchanged authenticated handlers. It does not
    // activate MAIN providers or grant an actor, product, session or MFA scope.
  })

  it.each(paths.flatMap(path => [
    `${path}/`, `${path}/extra`, `${path}-admin`, `${path}.json`, path.toUpperCase(),
    path.replace('/portal/', '/Portal/'), path.replace('/portal/', '/%70ortal/'),
    path.replace('/portal/', '/portal//'), `/${path}`, path.replaceAll('/', '\\'),
    `${path}/../command`, `${path}/%2e%2e/command`, `${path}/*`,
  ]))('denies readiness lookalike %s without admitting a provider prefix', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })

  it.each(paths.flatMap(path => [
    ['supabase', ''], ['', 'supabase'], ['Supabase', 'Supabase'],
    ['supabase', 'legacy'], ['legacy', 'supabase'], ['invalid', 'supabase'],
    ['legacy', 'legacy'], ['', ''],
  ].map(([server, browser]) => [path, server, browser])))('denies readiness route %s under mode %s/%s', (path, server, browser) => {
    expect(blocked(path, server, browser)).toBe(true)
  })
})

describe('exact offering-document service routing', () => {
  const offeringServices = ['/api/portal/offering-documents', '/api/portal/offering-documents/processing',
    '/api/portal/offering-signatures', '/api/portal/offering-signatures/processing'] as const

  it.each(offeringServices)('admits only canonical offering service %s in paired Supabase mode', path => {
    expect(SUPABASE_ALLOWED_PATHS.filter(value => value === path)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(path)).toBe(true)
    expect(blocked(path)).toBe(false)
    // Reachability does not grant document access, a scanner verdict or business
    // authority; the unchanged scoped/session/origin/HMAC handlers still decide.
  })

  it.each(offeringServices.flatMap(path => [
    `${path}/`, `${path}/extra`, `${path}-admin`, `${path}.json`, path.toUpperCase(),
    path.replace('/offering', '/Offering'), path.replace('/offering', '/%6fffering'),
    path.replace('/portal/', '/portal//'), `/${path}`, path.replaceAll('/', '\\'),
    `${path}/../command`, `${path}/%2e%2e/command`, `${path}/*`,
  ]))('denies raw offering lookalike %s without a document-service wildcard', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })

  it.each(offeringServices.flatMap(path => [
    ['supabase', ''], ['', 'supabase'], ['Supabase', 'Supabase'],
    ['supabase', 'legacy'], ['legacy', 'supabase'], ['invalid', 'supabase'],
    ['legacy', 'legacy'], ['', ''],
  ].map(([server, browser]) => [path, server, browser])))('denies offering service %s under mode %s/%s', (path, server, browser) => {
    expect(blocked(path, server, browser)).toBe(true)
  })
})

describe('exact applicant draft service routing', () => {
  const draftService = '/api/portal/application-drafts'

  it('admits the one canonical route without granting draft preparation authority', () => {
    expect(SUPABASE_ALLOWED_PATHS.filter(path => path === draftService)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(draftService)).toBe(true)
    expect(blocked(draftService)).toBe(false)
    // The unchanged handler still verifies identity, ownership, preparation,
    // current revisions and origin before the guarded database operation.
  })

  it.each([
    `${draftService}/`, `${draftService}/save`, `${draftService}-admin`, `${draftService}.json`,
    '/api/portal/Application-drafts', '/API/portal/application-drafts',
    '/api/portal/%61pplication-drafts', '/api/portal//application-drafts',
    '//api/portal/application-drafts', '/api\\portal\\application-drafts',
    '/api/portal/application-drafts/../command', '/api/portal/arbitrary',
  ])('keeps raw draft lookalike %s denied without a portal API wildcard', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })

  it.each([
    ['supabase', ''], ['', 'supabase'], ['Supabase', 'Supabase'], ['', ''],
  ])('keeps draft service denied in unpaired or legacy mode %s/%s', (server, browser) => {
    expect(blocked(draftService, server, browser)).toBe(true)
  })
})

describe('exact document-processing service routing', () => {
  it('admits the single canonical service path through the existing paired Supabase boundary', () => {
    expect(SUPABASE_ALLOWED_PATHS.filter(path => path === service)).toHaveLength(1)
    expect(isSupabaseWebPathAllowed(service)).toBe(true)
    expect(blocked(service)).toBe(false)
    // Route admission does not grant processing authority. Its HMAC, current
    // database policy and live lease remain required by the actual handler.
  })

  it.each([
    `${service}/`, `${service}/claim`, `${service}-admin`,
    '/api/portal/documents/Processing', '/API/portal/documents/processing',
    '/api/portal/documents/%70rocessing', '/api/portal/documents//processing',
    '//api/portal/documents/processing', '/api\\portal\\documents\\processing',
    '/api/portal/documents/processing/../command', '/api/portal/documents/engine',
  ])('does not expand admission to lookalike or nested path %s', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(false)
    expect(blocked(path)).toBe(true)
  })

  it.each([
    ['supabase', 'legacy'], ['legacy', 'supabase'],
    ['invalid', 'supabase'], ['legacy', 'legacy'],
  ])('does not admit service under unpaired or legacy mode %s/%s', (server, browser) => {
    expect(blocked(service, server, browser)).toBe(true)
  })

  it('preserves existing document and provider route admission without a general portal API prefix', () => {
    for (const path of ['/api/portal/documents', '/api/portal/kyc/session', '/api/portal/kyc/webhook', '/api/portal/kyc/evidence']) {
      expect(isSupabaseWebPathAllowed(path)).toBe(true)
    }
    expect(isSupabaseWebPathAllowed('/api/portal/arbitrary')).toBe(false)
    expect(blocked('/api/portal/arbitrary')).toBe(true)
  })
})
