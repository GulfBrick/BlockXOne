import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ user: vi.fn(), sufficient: vi.fn(), current: vi.fn(), rpc: vi.fn(), passwordSession: vi.fn() }))
vi.mock('./server', () => ({ readVerifiedUser: mocks.user }))
vi.mock('./mfa', () => ({ hasOrdinaryPasswordSession: mocks.passwordSession, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
import { readTestOrdinaryEntry, testOrdinaryEntryMfaPaused, isTestOrdinaryEntryAllowed } from './test-ordinary-entry'
import { entryActorId, entryFixture, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'

const user = { id: entryActorId, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-21', is_anonymous: false }
const context = {} as never
const client = { rpc: mocks.rpc } as unknown as SupabaseClient
const configuration = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED: 'enabled' }
function envelope() {
  const entry = entryFixture()
  entry.workflow!.scoped_read_available = false
  entry.contexts = [{ context_key: entryOrganisationId, organisation_id: entryOrganisationId, name: 'Fictional own organisation', roles: ['ComplianceOfficer'] }]
  entry.requests = []; entry.organisation_mandates = []
  return { version: 1, entry, workspace: { user: { id: entryActorId, email: user.email, platformUserId: 'historical-person-reference', displayName: null }, organisations: [{ id: entryOrganisationId, name: 'Fictional own organisation', roles: ['ComplianceOfficer'] }] } }
}
function rpc(data: unknown = envelope(), error: unknown = null) { mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error }) }) }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries(configuration)) vi.stubEnv(key, value)
  mocks.user.mockResolvedValue(user); mocks.sufficient.mockReturnValue(false); mocks.passwordSession.mockReturnValue(true); mocks.current.mockResolvedValue(true); rpc()
})
afterEach(() => vi.unstubAllEnvs())

describe('temporary TEST ordinary entry is not MFA authority', () => {
  it('requires the explicit server flag and a fully validated TEST release', () => {
    expect(testOrdinaryEntryMfaPaused(configuration)).toBe(true)
    for (const change of [{ BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED: undefined }, { BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED: 'true' }, { SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co' }, { VERCEL_ENV: 'production' }, { BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' }, { BLOCKXONE_APP_ORIGIN: 'https://block-x-one-review.vercel.app' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }, { BLOCKXONE_ENVIRONMENT: 'MAINNET' }, { NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'legacy' }]) {
      expect(testOrdinaryEntryMfaPaused({ ...configuration, ...change })).toBe(false)
    }
    expect(testOrdinaryEntryMfaPaused({ ...configuration, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co', VERCEL_ENV: 'production', BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' })).toBe(false)
  })
  it('uses only the own-only RPC and retains native identity contracts', async () => {
    const result = await readTestOrdinaryEntry(client, context)
    expect(result.entry.applications[0].status).toBe('DRAFT')
    expect(result.workspace?.organisations[0].roles).toEqual(['ComplianceOfficer'])
    expect(result.entry.workflow?.scoped_read_available).toBe(false)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_test_ordinary_entry_read')
    expect(mocks.current).toHaveBeenCalledTimes(2)
  })
  it('does not reroute an already sufficient MFA context', async () => {
    mocks.sufficient.mockReturnValue(true)
    expect(isTestOrdinaryEntryAllowed(context)).toBe(false)
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not use the exception for recovery/OAuth/missing or other authentication methods', async () => {
    mocks.passwordSession.mockReturnValue(false)
    expect(isTestOrdinaryEntryAllowed(context)).toBe(false)
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([null, { ...user, email_confirmed_at: undefined }, { ...user, is_anonymous: true }])('rejects unverified/anonymous identity %#', async value => {
    mocks.user.mockResolvedValue(value)
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not carry authority across a changed or manufactured context', async () => {
    mocks.current.mockResolvedValueOnce(false)
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.current.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: 403 })
  })
  it.each([42501, 'XX000'])('retains backend denial/unavailability %s without private details', async code => {
    rpc(null, { code: String(code), message: 'private database details' })
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: code === 42501 ? 403 : 503, message: 'Ordinary Testnet access is unavailable.' })
  })
  it.each(['actor', 'environment', 'business', 'admission', 'application-owner', 'details', 'review-route', 'mandate', 'request', 'workspace-owner', 'organisation', 'roles'])('rejects a contradictory or capability-bearing projection: %s', async field => {
    const value = envelope()
    if (field === 'actor') value.entry.actor.id = entryOrganisationId
    if (field === 'environment') value.entry.workflow!.environment = 'MAINNET'
    if (field === 'business') value.entry.workflow!.scoped_read_available = true
    if (field === 'admission') value.entry.admission.manual_test_review = true
    if (field === 'application-owner') value.entry.applications[0].user_id = entryOrganisationId
    if (field === 'details') value.entry.applications[0].details = { full_name: 'Private details not admitted to this projection' }
    if (field === 'review-route') value.entry.applications[0].review_route = 'AVAILABLE'
    if (field === 'mandate') value.entry.applications[0].can_request_mandate = true
    if (field === 'request') value.entry.requests!.push({ key: entryOrganisationId, command: 'start_application', application_id: value.entry.applications[0].id })
    if (field === 'workspace-owner') value.workspace.user.id = entryOrganisationId
    if (field === 'organisation') value.workspace.organisations[0].id = entryActorId
    if (field === 'roles') value.workspace.organisations[0].roles = ['SuperAdmin']
    rpc(value)
    await expect(readTestOrdinaryEntry(client, context)).rejects.toMatchObject({ status: 503 })
  })
})
