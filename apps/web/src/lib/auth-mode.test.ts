import { describe, expect, it } from 'vitest'
import { isSupabaseWebPathAllowed, SUPABASE_ALLOWED_PATHS } from './auth-mode'
import { isProductionWebPathBlocked } from './release-policy'

const service = '/api/portal/documents/processing'
const blocked = (path: string, server = 'supabase', browser = 'supabase') =>
  isProductionWebPathBlocked(path, 'production', 'production', 'production', server, browser)

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
