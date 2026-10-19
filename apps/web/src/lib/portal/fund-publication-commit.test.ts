import { describe, expect, it } from 'vitest'
import { fundPublicationCommitSchema, matchesFundPublicationCommit } from './fund-publication-commit'
import { portalCommandSchema, type PortalCommand } from './contracts'

const actor = '11111111-1111-4111-8111-111111111111'
const organisation = '22222222-2222-4222-8222-222222222222'
const product = '33333333-3333-4333-8333-333333333333'
const other = '44444444-4444-4444-8444-444444444444'
const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'OfferingManager' as const }
const request: PortalCommand = { command: 'publish_product', key: other, payload: { product_id: product, expected_revision: 3 } }
const expected = { actorId: actor, context, request, environment: 'TESTNET' as const }
function ack() {
  return { kind: 'TEST_FUND_PUBLICATION_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
    independence_proven: false, actor_id: actor, session_id: other, operating_context: context, policy_id: other,
    authority_epoch: 2, product_id: product, offering_revision_id: other, product_revision: 4, request,
    recorded_at: '2026-10-15T12:00:00Z' }
}

describe('strict TEST fund publication commit receipt', () => {
  it('confirms only the saved request, not a current status, independent approval, deployment or snapshot', () => {
    expect(matchesFundPublicationCommit(ack(), expected)).toBe(true)
    const value = fundPublicationCommitSchema.parse(ack())
    expect(value.independence_proven).toBe(false)
    for (const field of ['snapshot', 'status', 'published_at', 'publication_event_id']) expect(value).not.toHaveProperty(field)
    // Replays may report the current revision, not the original expected+1.
    expect(matchesFundPublicationCommit({ ...ack(), product_revision: 7 }, expected)).toBe(true)
  })
  it('compares existing strict schema-normalised requests rather than JSONB key order', () => {
    const reordered = { ...ack(), request: { payload: { expected_revision: 3, product_id: product }, key: other, command: 'publish_product' } }
    expect(portalCommandSchema.parse(reordered.request)).toEqual(request)
    expect(matchesFundPublicationCommit(reordered, expected)).toBe(true)
  })
  it.each([
    { kind: 'TEST_FUND_APPOINTMENT_COMMIT' }, { version: 2 }, { environment: 'MAINNET' }, { execution_mode: 'STANDARD' },
    { independence_proven: true }, { actor_id: null }, { session_id: 'not-a-uuid' }, { policy_id: null },
    { product_id: other }, { offering_revision_id: null }, { product_revision: 0 }, { product_revision: 2 }, { product_revision: 3 }, { product_revision: '4' },
    { authority_epoch: 0 }, { authority_epoch: Number.MAX_SAFE_INTEGER + 1 }, { recorded_at: 'yesterday' },
    { operating_context: { ...context, role: 'SuperAdmin' } }, { operating_context: { mode: 'APPLICANT' } },
    { operating_context: { ...context, extra: true } }, { snapshot: {} }, { status: 'PUBLISHED' }, { extra: true },
  ])('rejects malformed, broadened or foreign evidence %#', change => {
    expect(fundPublicationCommitSchema.safeParse({ ...ack(), ...change }).success).toBe(false)
    expect(matchesFundPublicationCommit({ ...ack(), ...change }, expected)).toBe(false)
  })
  it.each(['actor_id', 'session_id', 'policy_id', 'product_id', 'offering_revision_id'] as const)('rejects zero %s', field => {
    expect(fundPublicationCommitSchema.safeParse({ ...ack(), [field]: '00000000-0000-0000-0000-000000000000' }).success).toBe(false)
  })
  it.each([
    { actorId: other }, { context: { ...context, organisationId: other } },
    { context: { ...context, role: 'IssuerFundManager' as const } }, { context: { mode: 'APPLICANT' as const } },
    { environment: 'MAINNET' as const }, { environment: undefined },
  ])('cannot borrow a receipt for another caller, scope or environment %#', change => {
    expect(matchesFundPublicationCommit(ack(), { ...expected, ...change })).toBe(false)
  })
  it.each([
    { ...request, key: product },
    { ...request, key: '00000000-0000-0000-0000-000000000000' },
    { ...request, payload: { product_id: other, expected_revision: 3 } },
    { ...request, payload: { product_id: product, expected_revision: 4 } },
    { ...request, payload: { product_id: product, expected_revision: Number.MAX_SAFE_INTEGER + 1 } },
    { ...request, payload: { product_id: product, expected_revision: 3, extra: true } },
    { ...request, extra: true },
    { command: 'submit_product', key: other, payload: { product_id: product, expected_revision: 3 } },
  ])('does not acknowledge another key, payload, revision or command %#', instruction => {
    expect(matchesFundPublicationCommit({ ...ack(), request: instruction }, expected)).toBe(false)
  })
  it('does not reinterpret an unrelated portal request as publication', () => {
    const unrelated: PortalCommand = { command: 'submit_product', key: other, payload: { product_id: product, expected_revision: 3 } }
    expect(matchesFundPublicationCommit({ ...ack(), request: unrelated }, { ...expected, request: unrelated })).toBe(false)
    expect(matchesFundPublicationCommit(null, expected)).toBe(false)
    expect(matchesFundPublicationCommit(undefined, expected)).toBe(false)
  })
})
