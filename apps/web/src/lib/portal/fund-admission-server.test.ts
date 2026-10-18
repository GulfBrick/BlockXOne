import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({ build: vi.fn(), authorise: vi.fn(), worker: vi.fn() }))
vi.mock('./fund-chain-admission', async importOriginal => ({
  ...await importOriginal<typeof import('./fund-chain-admission')>(), buildFundAdmissionCandidate: mocks.build,
}))
vi.mock('./fund-authority-alignment-server', () => ({ authoriseFundAuthorityPhase: mocks.authorise }))
vi.mock('./fund-lifecycle-worker', () => ({ callFundWorker: mocks.worker }))

import { admitFundRelease } from './fund-admission-server'
import { canonicalAdmissionFixture, testId } from './fund-chain-test-fixtures'
import { predictFundSuite } from './fund-setup-chain'

const actor = testId(1), requestId = testId(40), readReceipt = testId(41), writeReceipt = testId(42)
const requestKey = testId(43), signerPolicyId = testId(44)
const context = { mode: 'ROLE' as const, organisationId: testId(2), role: 'TokenisationAgent' as const }

function fixture() {
  const input = canonicalAdmissionFixture().input
  input.authority_epoch = 2
  input.setup.roleplay_policy = { policy_id: testId(45), epoch: 2, expires_at: '2100-01-01T00:00:00Z',
    label: 'TEST ROLE PLAY - one operator; not independent human approval' }
  const { manifest_id: _manifest, product_binding_hash: _binding, proof_refs, ...rest } = input
  const seed = { ...rest, conformance_receipt_id: proof_refs.conformance_receipt_id }
  const setup = input.setup.setup!, expected = predictFundSuite(setup.dependencies.trex_factory!, input.deployment_salt,
    setup.dependencies.trex_authority!, { name: input.token_name, symbol: input.token_symbol,
      decimals: input.security_unit_decimals, onchain_id: setup.dependencies.token_identity! })
  const candidate = { manifest: { status: 'NOT_ADMITTED', suite: { token: { address: expected.token } } } }
  return { input, seed, candidate }
}
function client(seed: unknown, reservation: unknown, events: string[]) {
  const rpc = vi.fn((name: string) => ({ abortSignal: () => {
    events.push(`rpc:${name}`)
    return Promise.resolve({ data: name === 'bx1_portal_fund_admission_seed' ? seed : reservation, error: null })
  } }))
  return { rpc } as unknown as Parameters<typeof admitFundRelease>[0]
}

beforeEach(() => { vi.clearAllMocks() })

describe('fund admission genuine reauthorisation phases', () => {
  it('uses a fresh ADMISSION_READ receipt and waits until provider completion before authorising the exact write', async () => {
    const events: string[] = [], { input, seed, candidate } = fixture()
    const reservation = { request_id: requestId, status: 'RESERVED_NOT_ADMITTED' as const, input }
    let finish!: (value: unknown) => void
    mocks.authorise.mockImplementation(async (_client, _actor, _scope, purpose: string) => {
      events.push(`authorise:${purpose}`)
      return { admission_request_id: requestId, input, authorisation_receipt_id: purpose === 'ADMISSION_READ' ? readReceipt : writeReceipt }
    })
    mocks.worker.mockImplementation(async (name: string, args: unknown[]) => {
      events.push(`worker:${name}`)
      if (name === 'read_fund_admission_authorised') return reservation
      if (name === 'record_fund_admission_authorised') return { request_id: requestId, status: 'ADMITTED', manifest_id: input.manifest_id, signer_policy_id: signerPolicyId }
      throw new Error(`Unexpected worker ${name}:${JSON.stringify(args)}`)
    })
    mocks.build.mockImplementationOnce(() => { events.push('provider:admission'); return new Promise(resolve => { finish = resolve }) })
    const pending = admitFundRelease(client(seed, reservation, events), actor,
      { setup_id: input.setup.setup!.id, expected_revision: input.setup.setup!.revision, request_key: requestKey, operating_context: context })
    await vi.waitFor(() => expect(events).toContain('provider:admission'))
    expect(events).toEqual([
      'rpc:bx1_portal_fund_admission_seed', 'rpc:bx1_portal_fund_admission_reserve',
      'authorise:ADMISSION_READ', 'worker:read_fund_admission_authorised', 'provider:admission',
    ])
    expect(mocks.authorise).not.toHaveBeenCalledWith(expect.anything(), actor, expect.anything(), 'ADMISSION_WRITE')
    finish(candidate)
    await expect(pending).resolves.toEqual({ request_id: requestId, status: 'ADMITTED', manifest_id: input.manifest_id, signer_policy_id: signerPolicyId })
    expect(events.slice(-2)).toEqual(['authorise:ADMISSION_WRITE', 'worker:record_fund_admission_authorised'])
    expect(mocks.worker).toHaveBeenCalledWith('read_fund_admission_authorised', [requestId, readReceipt])
    expect(mocks.worker).toHaveBeenCalledWith('record_fund_admission_authorised', [requestId, candidate, expect.stringMatching(/^[0-9a-f]{64}$/), writeReceipt])
  })

  it('does not invoke the writer when the post-provider authority input changed', async () => {
    const events: string[] = [], { input, seed, candidate } = fixture()
    const reservation = { request_id: requestId, status: 'RESERVED_NOT_ADMITTED' as const, input }
    mocks.build.mockResolvedValue(candidate)
    mocks.authorise.mockImplementation(async (_client, _actor, _scope, purpose: string) => ({
      admission_request_id: requestId, input: purpose === 'ADMISSION_WRITE' ? { ...input, token_symbol: 'OTHER' } : input,
      authorisation_receipt_id: purpose === 'ADMISSION_READ' ? readReceipt : writeReceipt,
    }))
    mocks.worker.mockImplementation(async (name: string) => {
      events.push(name)
      if (name === 'read_fund_admission_authorised') return reservation
      throw new Error('Changed authority must not reach the writer.')
    })
    await expect(admitFundRelease(client(seed, reservation, []), actor,
      { setup_id: input.setup.setup!.id, expected_revision: input.setup.setup!.revision, request_key: requestKey, operating_context: context }))
      .rejects.toMatchObject({ code: 'ADMISSION_AUTHORITY_CHANGED' })
    expect(events).toEqual(['read_fund_admission_authorised'])
    expect(mocks.worker).not.toHaveBeenCalledWith('record_fund_admission_authorised', expect.anything())
  })
})
