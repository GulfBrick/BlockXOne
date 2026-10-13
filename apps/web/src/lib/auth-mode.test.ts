import { describe, expect, it } from 'vitest'
import { isSupabaseWebPathAllowed, SUPABASE_ALLOWED_PATHS } from './auth-mode'
import { isProductionWebPathBlocked } from './release-policy'

const service = '/api/portal/documents/processing'
const blocked = (path: string, server = 'supabase', browser = 'supabase') =>
  isProductionWebPathBlocked(path, 'production', 'production', 'production', server, browser)

describe('exact offering-document service routing', () => {
  const offeringServices = ['/api/portal/offering-documents', '/api/portal/offering-documents/processing'] as const

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
