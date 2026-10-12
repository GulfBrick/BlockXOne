import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ user: vi.fn(), current: vi.fn(), allowed: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user }))
vi.mock('@/lib/supabase/mfa', () => ({ isMfaContextCurrent: mocks.current }))
vi.mock('@/lib/supabase/test-ordinary-entry', () => ({ isTestOrdinaryEntryAllowed: mocks.allowed }))
import { readSyntheticCompliance } from './synthetic-compliance'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { VerifiedMfaContext } from '@/lib/supabase/mfa'
import type { PortalOperatingContext } from './operating-context'
const reviewer = '11111111-1111-4111-8111-111111111111'
const reviewContext: PortalOperatingContext = { mode: 'ROLE', organisationId: '44444444-4444-4444-8444-444444444444', role: 'ComplianceOfficer' }
const syntheticSnapshot = () => ({ rehearsal: { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: reviewer, operating_context: reviewContext }, actor: { id: reviewer, email: 'reviewer@example.invalid', display_name: null, can_review: true }, operating_context: reviewContext, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [] })
const client = { rpc: mocks.rpc } as unknown as SupabaseClient
const context = {} as VerifiedMfaContext
beforeEach(() => {
  vi.resetAllMocks()
  mocks.allowed.mockReturnValue(true); mocks.current.mockResolvedValue(true)
  mocks.user.mockResolvedValue({ id: reviewer, email: 'reviewer@example.invalid', email_confirmed_at: '2026-10-10', is_anonymous: false })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: syntheticSnapshot(), error: null }) })
})
afterEach(() => vi.unstubAllEnvs())
describe('server-derived synthetic review access', () => {
  it('uses only the narrow authenticated RPC and rechecks the same MFA session', async () => {
    expect((await readSyntheticCompliance(client, reviewContext, context)).snapshot.rehearsal?.mode).toBe('SYNTHETIC_COMPLIANCE')
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_synthetic_compliance_read', { operating_context: reviewContext })
    expect(mocks.current).toHaveBeenCalledTimes(2)
  })
  it('denies when ordinary TEST admission is disabled before reading', async () => {
    mocks.allowed.mockReturnValue(false)
    await expect(readSyntheticCompliance(client, reviewContext, context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('denies a changed session after the projection', async () => {
    mocks.current.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(readSyntheticCompliance(client, reviewContext, context)).rejects.toMatchObject({ status: 403 })
  })
  it('rejects broad or unverified responses', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...syntheticSnapshot(), accounts: [] }, error: null }) })
    await expect(readSyntheticCompliance(client, reviewContext, context)).rejects.toMatchObject({ status: 503 })
  })
  it.each([['42501', 403], ['57014', 503]])('reports %s without private diagnostics', async (code, status) => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code, message: 'private data' } }) })
    await expect(readSyntheticCompliance(client, reviewContext, context)).rejects.toMatchObject({ status })
  })
})
