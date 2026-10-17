import { describe, expect, it } from 'vitest'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'
import { OFFERING_COMMANDS, hasOfferingCommandAccess, isTestPasswordOffering, isTestPasswordWorkflow, offeringAccessSchema, validatedOfferingAccess } from './offering-access'
import type { PortalSnapshot } from './contracts'

const actor = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const manager: PortalOperatingContext = { mode: 'ROLE', organisationId: org, role: 'OfferingManager' }
const commands = {
  OfferingManager: ['create_product', 'save_product', 'submit_product', 'begin_offering_amendment', 'reopen_offering_review', 'request_product_service_appointment'],
  IssuerFundManager: ['review_offering_issuer'], ComplianceOfficer: ['review_product', 'review_product_service_appointment'], SuperAdmin: ['apply_product_service_appointment'],
}
function marker(role: keyof typeof commands = 'OfferingManager') {
  return { version: 1, environment: 'TESTNET', actor_id: actor, operating_context: { ...manager, role }, session_mode: 'TEST_PASSWORD', allowed_commands: commands[role] }
}
function snapshot(value: unknown = marker()) {
  return { actor: { id: actor }, operating_context: manager, offering_access: value }
}
describe('bounded sandbox offering projection', () => {
  it.each(Object.keys(commands) as (keyof typeof commands)[])('accepts only the %s command subset', role => {
    const value = marker(role), data = { ...snapshot(value), operating_context: value.operating_context }
    expect(validatedOfferingAccess(data, value.operating_context, 'TESTNET')).toEqual(value)
    for (const command of OFFERING_COMMANDS) expect(hasOfferingCommandAccess(data, command)).toBe(commands[role].includes(command))
    expect(offeringAccessSchema.safeParse({ ...value, allowed_commands: [] }).success).toBe(true)
    expect(offeringAccessSchema.safeParse({ ...value, allowed_commands: [value.allowed_commands[0]] }).success).toBe(true)
    expect(isTestPasswordOffering(data)).toBe(true)
  })
  it.each(BX1_ROLES.filter(role => !(role in commands)))('rejects the %s role even with an empty command family', role => {
    expect(offeringAccessSchema.safeParse({ ...marker(), operating_context: { ...manager, role }, allowed_commands: [] }).success).toBe(false)
  })
  it.each([undefined, null, [], {}, { ...marker(), version: 2 }, { ...marker(), environment: 'MAINNET' },
    { ...marker(), actor_id: 'not-actor' }, { ...marker(), session_mode: 'STANDARD' },
    { ...marker(), operating_context: APPLICANT_CONTEXT }, { ...marker(), extra: true },
    { ...marker(), operating_context: { ...manager, extra: true } },
    { ...marker(), allowed_commands: ['create_product', 'create_product'] },
    { ...marker(), allowed_commands: ['publish_product'] }, { ...marker(), allowed_commands: ['review_product'] },
    { ...marker(), allowed_commands: ['revoke_product_service_appointment'] }, { ...marker(), allowed_commands: ['subscribe'] },
    { ...marker(), allowed_commands: ['review_product_eligibility'] }, { ...marker(), allowed_commands: ['mint'] },
  ])('fails closed for malformed or expanded capability %#', value => {
    const invalid = { ...snapshot(), offering_access: value }
    expect(validatedOfferingAccess(invalid)).toBeNull()
    expect(hasOfferingCommandAccess(invalid, 'create_product')).toBe(false)
  })
  it('binds actor, snapshot context, selected context and environment', () => {
    expect(validatedOfferingAccess({ ...snapshot(), actor: { id: other } })).toBeNull()
    expect(validatedOfferingAccess({ ...snapshot(), operating_context: { ...manager, organisationId: other } })).toBeNull()
    expect(validatedOfferingAccess(snapshot(), APPLICANT_CONTEXT)).toBeNull()
    expect(validatedOfferingAccess(snapshot(), { ...manager, role: 'IssuerFundManager' })).toBeNull()
    expect(validatedOfferingAccess(snapshot(), manager, 'MAINNET')).toBeNull()
    expect(validatedOfferingAccess({ ...snapshot(), rehearsal: undefined })).toBeNull()
  })
  it('cross-validates the separate Stage2 projection without changing its command family', () => {
    const stage2 = { version: 1, environment: 'TESTNET', actor_id: actor, operating_context: manager, session_mode: 'TEST_PASSWORD', allowed_commands: [] }
    expect(validatedOfferingAccess({ ...snapshot(), stage2_access: stage2 })).not.toBeNull()
    for (const change of [{ actor_id: other }, { environment: 'MAINNET' }, { session_mode: 'STANDARD' },
      { operating_context: APPLICANT_CONTEXT }, { allowed_commands: ['create_product'] }, { extra: true }]) {
      expect(validatedOfferingAccess({ ...snapshot(), stage2_access: { ...stage2, ...change } })).toBeNull()
    }
  })
  it('keeps an unmarked standard snapshot unchanged and recognises admission-only password mode', () => {
    const base: PortalSnapshot = { actor: { id: actor, email: 'fictional@example.invalid', display_name: null, can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [] }
    expect(validatedOfferingAccess(base)).toBeNull(); expect(isTestPasswordWorkflow(base)).toBe(false)
    const admission: PortalSnapshot = { ...base, operating_context: APPLICANT_CONTEXT, stage2_access: { version: 1, environment: 'TESTNET', actor_id: actor, operating_context: APPLICANT_CONTEXT, session_mode: 'TEST_PASSWORD', allowed_commands: ['start_application'] } }
    expect(isTestPasswordWorkflow(admission)).toBe(true); expect(hasOfferingCommandAccess(admission, 'create_product')).toBe(false)
  })
})
