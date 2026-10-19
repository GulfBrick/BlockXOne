import { describe, expect, it } from 'vitest'
import { appointmentCommitSchema, matchesAppointmentCommit } from './appointment-commit'
import { portalCommandSchema, type PortalCommand } from './contracts'

const actorId = '11111111-1111-4111-8111-111111111111'
const organisationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const appointmentId = '44444444-4444-4444-8444-444444444444'
const otherId = '55555555-5555-4555-8555-555555555555'
const context = { mode: 'ROLE' as const, organisationId, role: 'OfferingManager' as const }
const instruction: PortalCommand = { command: 'request_product_service_appointment', key: otherId, payload: {
  product_id: productId, role: 'IssuerFundManager', appointee_user_id: actorId, native_membership_id: otherId,
  expected_product_revision: 2, evidence_reference: 'Synthetic appointment authority evidence for the unit fixture.', requested_until: '2026-12-01T12:00:00Z',
} }
function ack(request: PortalCommand = instruction) {
  return { kind: 'TEST_FUND_APPOINTMENT_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
    independence_proven: false, actor_id: actorId, session_id: otherId, operating_context: context,
    policy_id: otherId, authority_epoch: 2, product_id: productId, offering_revision_id: otherId,
    appointment_id: appointmentId, appointment_revision: 1, request, recorded_at: '2026-10-15T12:00:00Z' }
}
const expected = { actorId, context, request: instruction, environment: 'TESTNET' as const }

describe('strict TEST appointment commit receipt', () => {
  it('matches only the exact guarded command receipt without asserting independent approval or a current snapshot', () => {
    expect(appointmentCommitSchema.safeParse(ack()).success).toBe(true)
    expect(matchesAppointmentCommit(ack(), expected)).toBe(true)
    expect(appointmentCommitSchema.parse(ack()).independence_proven).toBe(false)
    expect(appointmentCommitSchema.parse(ack())).not.toHaveProperty('snapshot')
  })

  it('compares both requests through the existing strict schema, independent of JSONB object key order', () => {
    const reversePayload = Object.fromEntries(Object.entries(instruction.payload).reverse())
    const reordered = { ...ack(), request: { payload: reversePayload, key: instruction.key, command: instruction.command } }
    expect(JSON.stringify(reordered.request)).not.toBe(JSON.stringify(instruction))
    expect(matchesAppointmentCommit(reordered, expected)).toBe(true)
    expect(portalCommandSchema.parse(reordered.request)).toEqual(portalCommandSchema.parse(instruction))
  })

  it.each([
    { kind: 'UNRELATED_COMMIT' }, { version: 2 }, { environment: 'MAINNET' }, { execution_mode: 'STANDARD' },
    { independence_proven: true }, { actor_id: 'not-an-id' }, { session_id: null }, { policy_id: null },
    { product_id: null }, { offering_revision_id: null }, { appointment_id: null },
    { authority_epoch: 0 }, { authority_epoch: 1.5 }, { authority_epoch: Number.MAX_SAFE_INTEGER + 1 },
    { appointment_revision: 0 }, { appointment_revision: '1' }, { recorded_at: 'yesterday' },
    { recorded_at: null }, { extra: 'not-an-allowed-receipt-field' }, { snapshot: {} },
    { operating_context: { mode: 'APPLICANT' } }, { operating_context: { ...context, extra: true } },
  ])('rejects a malformed or enlarged receipt %#', change => {
    expect(appointmentCommitSchema.safeParse({ ...ack(), ...change }).success).toBe(false)
    expect(matchesAppointmentCommit({ ...ack(), ...change }, expected)).toBe(false)
  })

  it.each(['actor_id', 'session_id', 'policy_id', 'product_id', 'offering_revision_id', 'appointment_id'] as const)('rejects zero UUID for %s', field => {
    expect(appointmentCommitSchema.safeParse({ ...ack(), [field]: '00000000-0000-0000-0000-000000000000' }).success).toBe(false)
  })

  it.each([
    { actorId: otherId }, { context: { ...context, organisationId: otherId } },
    { context: { ...context, role: 'SuperAdmin' as const } }, { context: { mode: 'APPLICANT' as const } },
    { environment: 'MAINNET' as const }, { environment: undefined },
  ])('does not borrow another caller, capacity or environment %#', change => {
    expect(matchesAppointmentCommit(ack(), { ...expected, ...change })).toBe(false)
  })

  it('denies another product, operation key or payload even when all other receipt fields match', () => {
    expect(matchesAppointmentCommit({ ...ack(), product_id: otherId }, expected)).toBe(false)
    expect(matchesAppointmentCommit({ ...ack(), request: { ...instruction, key: productId } }, expected)).toBe(false)
    expect(matchesAppointmentCommit({ ...ack(), request: { ...instruction, payload: { ...instruction.payload, appointee_user_id: otherId } } }, expected)).toBe(false)
    expect(matchesAppointmentCommit({ ...ack(), request: { ...instruction, payload: { ...instruction.payload, extra: true } } }, expected)).toBe(false)
    expect(matchesAppointmentCommit({ ...ack(), request: { ...instruction, extra: true } }, expected)).toBe(false)
  })

  it.each([
    { command: 'review_product_service_appointment', key: otherId, payload: { appointment_id: appointmentId, expected_revision: 1,
      decision: 'APPROVED', notes: 'Synthetic exact review evidence for the unit fixture.', checks: { appointment: true, evidence: true, scope: true } } },
    { command: 'apply_product_service_appointment', key: otherId, payload: { appointment_id: appointmentId, expected_revision: 2 } },
    { command: 'revoke_product_service_appointment', key: otherId, payload: { appointment_id: appointmentId, expected_revision: 3,
      reason: 'Synthetic revocation reason for the unit fixture.' } },
  ] satisfies PortalCommand[])('binds %s to its exact appointment request', request => {
    expect(matchesAppointmentCommit(ack(request), { ...expected, request })).toBe(true)
    expect(matchesAppointmentCommit({ ...ack(request), appointment_id: otherId }, { ...expected, request })).toBe(false)
    expect(matchesAppointmentCommit(ack(request), expected)).toBe(false)
  })

  it('cannot turn a valid unrelated portal command into an appointment commit', () => {
    const unrelated: PortalCommand = { command: 'cancel_subscription', key: otherId, payload: { subscription_id: appointmentId } }
    expect(appointmentCommitSchema.safeParse(ack(unrelated)).success).toBe(false)
    expect(matchesAppointmentCommit(ack(unrelated), { ...expected, request: unrelated })).toBe(false)
    expect(matchesAppointmentCommit(null, expected)).toBe(false)
    expect(matchesAppointmentCommit(undefined, expected)).toBe(false)
  })
})
