import { describe, expect, it } from 'vitest'
import { offeringDecisionCommitSchema, matchesOfferingDecisionCommit } from './offering-decision-commit'
import { portalCommandSchema, type PortalCommand } from './contracts'

const actor = '11111111-1111-4111-8111-111111111111', organisation = '22222222-2222-4222-8222-222222222222'
const product = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444'
const offering = '55555555-5555-4555-8555-555555555555', hash = 'a'.repeat(64)
const cases = [
  { command: 'review_offering_issuer', role: 'IssuerFundManager', kind: 'ISSUER', checks: { issuer_authority: true, terms: true, rights: true } },
  { command: 'review_product', role: 'ComplianceOfficer', kind: 'COMPLIANCE', checks: { issuer: true, terms: true, disclosures: true, eligibility: true } },
] as const
function fixture(item: typeof cases[number] = cases[0]) {
  const context = { mode: 'ROLE' as const, organisationId: organisation, role: item.role }
  const request = portalCommandSchema.parse({ command: item.command, key: other, payload: { product_id: product,
    offering_revision_id: offering, expected_revision: 3, terms_hash: hash, common_envelope_hash: hash,
    deployment_configuration_hash: hash, decision: 'APPROVED', notes: 'Fictional reviewed package decision rationale.', checks: item.checks } })
  return { context, request, expected: { actorId: actor, context, request, environment: 'TESTNET' as const },
    ack: { kind: 'TEST_FUND_OFFERING_DECISION_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
      independence_proven: false, actor_id: actor, session_id: other, operating_context: context, policy_id: other,
      authority_epoch: 2, product_id: product, offering_revision_id: offering, decision_id: other, decision_kind: item.kind,
      request, recorded_at: '2026-10-15T22:00:00Z' } }
}

describe.each(cases)('strict $kind offering decision receipt', item => {
  it('acknowledges only the exact saved decision, not current approval, publication, readiness or holdings', () => {
    const { ack, expected } = fixture(item)
    expect(matchesOfferingDecisionCommit(ack, expected)).toBe(true)
    const value = offeringDecisionCommitSchema.parse(ack)
    expect(value.independence_proven).toBe(false)
    for (const field of ['snapshot', 'status', 'product_revision', 'published_at', 'holdings']) expect(value).not.toHaveProperty(field)
  })
  it('compares strict normalised requests independent of JSONB property order', () => {
    const { ack, expected, request } = fixture(item)
    const reordered = { ...ack, request: { payload: Object.fromEntries(Object.entries(request.payload).reverse()), key: request.key, command: request.command } }
    expect(portalCommandSchema.parse(reordered.request)).toEqual(request)
    expect(matchesOfferingDecisionCommit(reordered, expected)).toBe(true)
  })
  it('supports the same recorded changes-required decision without claiming approval', () => {
    const { ack, expected, request } = fixture(item)
    const changed = portalCommandSchema.parse({ ...request, payload: { ...request.payload, decision: 'CHANGES_REQUIRED' } })
    expect(matchesOfferingDecisionCommit({ ...ack, request: changed }, { ...expected, request: changed })).toBe(true)
  })
  it.each([
    { kind: 'TEST_FUND_PUBLICATION_COMMIT' }, { version: 2 }, { environment: 'MAINNET' }, { execution_mode: 'STANDARD' },
    { independence_proven: true }, { actor_id: null }, { session_id: 'invalid' }, { policy_id: null },
    { authority_epoch: 0 }, { authority_epoch: Number.MAX_SAFE_INTEGER + 1 }, { product_id: other }, { offering_revision_id: other },
    { decision_id: null }, { decision_kind: 'OTHER' }, { recorded_at: 'yesterday' },
    { operating_context: { mode: 'APPLICANT' } }, { operating_context: { mode: 'ROLE', organisationId: organisation, role: 'SuperAdmin' } },
    { snapshot: {} }, { status: 'APPROVED' }, { product_revision: 3 }, { extra: true },
  ])('rejects malformed or broadened evidence %#', change => {
    const { ack, expected } = fixture(item)
    expect(offeringDecisionCommitSchema.safeParse({ ...ack, ...change }).success).toBe(false)
    expect(matchesOfferingDecisionCommit({ ...ack, ...change }, expected)).toBe(false)
  })
  it.each(['actor_id', 'session_id', 'policy_id', 'product_id', 'offering_revision_id', 'decision_id'] as const)('rejects zero %s', field => {
    expect(offeringDecisionCommitSchema.safeParse({ ...fixture(item).ack, [field]: '00000000-0000-0000-0000-000000000000' }).success).toBe(false)
  })
  it('rejects crossed command, role and decision-kind combinations', () => {
    const { ack, expected, context } = fixture(item)
    const crossed = item.kind === 'ISSUER' ? cases[1] : cases[0]
    for (const change of [{ decision_kind: crossed.kind }, { operating_context: { ...context, role: crossed.role } },
      { operating_context: { ...context, extra: true } }]) expect(matchesOfferingDecisionCommit({ ...ack, ...change }, expected)).toBe(false)
  })
  it('does not borrow another caller, role, organisation or runtime environment', () => {
    const { ack, expected, context } = fixture(item)
    const crossed = item.kind === 'ISSUER' ? cases[1] : cases[0]
    for (const change of [{ actorId: other }, { context: { ...context, organisationId: other } },
      { context: { ...context, role: crossed.role } }, { context: { mode: 'APPLICANT' as const } },
      { environment: 'MAINNET' as const }, { environment: undefined }]) expect(matchesOfferingDecisionCommit(ack, { ...expected, ...change })).toBe(false)
  })
  it('requires the original key and every original payload binding', () => {
    const { ack, expected, request } = fixture(item)
    const replacements = [{ key: product }, { key: '00000000-0000-0000-0000-000000000000' },
      ...[{ product_id: other }, { offering_revision_id: other }, { expected_revision: 4 }, { expected_revision: Number.MAX_SAFE_INTEGER + 1 },
        { terms_hash: 'b'.repeat(64) }, { common_envelope_hash: 'b'.repeat(64) }, { deployment_configuration_hash: 'b'.repeat(64) },
        { decision: 'CHANGES_REQUIRED' }, { notes: 'A different fictional decision rationale.' }, { checks: {} }, { extra: true }]
        .map(change => ({ payload: { ...request.payload, ...change } })), { extra: true }]
    for (const change of replacements) expect(matchesOfferingDecisionCommit({ ...ack, request: { ...request, ...change } }, expected)).toBe(false)
  })
  it('cannot reinterpret another valid portal command as a decision', () => {
    const { ack, expected } = fixture(item)
    const request: PortalCommand = { command: 'publish_product', key: other, payload: { product_id: product, expected_revision: 3 } }
    expect(matchesOfferingDecisionCommit({ ...ack, request }, { ...expected, request })).toBe(false)
    expect(matchesOfferingDecisionCommit(null, expected)).toBe(false)
  })
})
