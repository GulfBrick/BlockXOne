import { describe, expect, it } from 'vitest'
import type { PortalApplication, PortalSnapshot } from './contracts'
import { fundRoleplayAdmissionProjectionValid, fundRoleplayAdmissionSchema, fundRoleplayApplicationReviewSchema,
  validatedFundRoleplayAdmission, validatedFundRoleplayApplicationReview } from './fund-roleplay-admission'

const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const applicationId = '33333333-3333-4333-8333-333333333333', organisationId = '44444444-4444-4444-8444-444444444444'
const productId = '55555555-5555-4555-8555-555555555555', offeringId = '66666666-6666-4666-8666-666666666666'
const policyId = '77777777-7777-4777-8777-777777777777'
const context = { mode: 'ROLE' as const, organisationId, role: 'ComplianceOfficer' as const }
function fixture(): PortalSnapshot {
  const application: PortalApplication = { id: applicationId, user_id: actor, persona: 'INVESTOR', revision: 2, status: 'SUBMITTED',
    details: { full_name: 'Fictional applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
      source_of_funds: 'Fictional sandbox savings.', beneficial_owners: '', experience: 'Synthetic only.', documents: [], test_data_acknowledged: true },
    submitted_at: '2026-10-10T12:00:00Z', reviewed_at: null, reviewer_id: null, review_notes: null, organisation_id: null,
    review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: null, admission_purpose: 'INVESTOR_ADMISSION',
    test_roleplay_review: { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
      actor_id: actor, operating_context: context, policy_id: policyId, authority_epoch: 2, product_id: productId,
      offering_revision_id: offeringId, application_id: applicationId, application_revision: 2,
      command: 'review_application', can_review: true, valid_until: '2099-01-01T00:00:00Z' } }
  return { actor: { id: actor, email: 'fixture@example.invalid', display_name: null, can_review: true }, operating_context: context,
    stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'STANDARD', actor_id: actor, operating_context: context,
      allowed_commands: ['review_application'] }, applications: [application], products: [], organisations: [], subscriptions: [], events: [] }
}
function decided(): PortalApplication {
  const application = fixture().applications[0]
  delete application.test_roleplay_review
  application.status = 'APPROVED'; application.revision = 3; application.reviewer_id = actor; application.reviewed_at = '2026-10-15T12:00:00Z'
  application.test_roleplay_admission = { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
    policy_id: policyId, authority_epoch: 2, product_id: productId, offering_revision_id: offeringId, application_id: applicationId,
    submitted_revision: 2, decision_revision: 3, decision: 'APPROVED', reviewer_id: actor, reviewed_at: application.reviewed_at,
    valid_until: '2020-01-01T00:00:00Z' }
  return application
}
describe('case-specific TEST role-play admission presentation', () => {
  it('accepts only the native-marked exact own TEST case with current STANDARD Compliance access', () => {
    const value = fixture(), application = value.applications[0]
    expect(fundRoleplayApplicationReviewSchema.safeParse(application.test_roleplay_review).success).toBe(true)
    expect(validatedFundRoleplayApplicationReview(value, application, context, 'TESTNET')).toEqual(application.test_roleplay_review)
    expect(fundRoleplayAdmissionProjectionValid(value, 'TESTNET')).toBe(true)
    expect(validatedFundRoleplayApplicationReview(value, application, context, 'MAINNET')).toBeNull()
    expect(validatedFundRoleplayApplicationReview(value, application, context, undefined)).toBeNull()
    expect(fundRoleplayAdmissionProjectionValid(value, 'MAINNET')).toBe(false)
  })
  it.each(['missing marker', 'actor', 'context', 'role', 'marker actor', 'marker context', 'case', 'revision', 'status', 'owner',
    'persona', 'type', 'purpose', 'test data', 'expired', 'can review', 'missing access', 'password access', 'command access', 'duplicate'] as const)(
    'denies an unbound or unavailable own-case capability: %s', failure => {
      const value = fixture(), application = value.applications[0], marker = application.test_roleplay_review!
      if (failure === 'missing marker') delete application.test_roleplay_review
      if (failure === 'actor') value.actor.id = other
      if (failure === 'context') value.operating_context = { ...context, organisationId: other }
      if (failure === 'role') value.operating_context = { ...context, role: 'SuperAdmin' }
      if (failure === 'marker actor') marker.actor_id = other
      if (failure === 'marker context') marker.operating_context = { ...context, organisationId: other }
      if (failure === 'case') marker.application_id = other
      if (failure === 'revision') marker.application_revision = 1
      if (failure === 'status') application.status = 'APPROVED'
      if (failure === 'owner') application.user_id = other
      if (failure === 'persona') application.persona = 'WEALTH_MANAGER'
      if (failure === 'type') Object.assign(application.details, { investor_type: 'ENTITY' })
      if (failure === 'purpose') application.admission_purpose = 'LEGACY_REHEARSAL'
      if (failure === 'test data') Object.assign(application.details, { test_data_acknowledged: false })
      if (failure === 'expired') marker.valid_until = '2020-01-01T00:00:00Z'
      if (failure === 'can review') value.actor.can_review = false
      if (failure === 'missing access') delete value.stage2_access
      if (failure === 'password access') value.stage2_access!.session_mode = 'TEST_PASSWORD'
      if (failure === 'command access') value.stage2_access!.allowed_commands = []
      if (failure === 'duplicate') value.applications.push({ ...application })
      expect(validatedFundRoleplayApplicationReview(value, application, context, 'TESTNET')).toBeNull()
    })
  it.each([{ version: 2 }, { environment: 'MAINNET' }, { execution_mode: 'STANDARD' }, { independence_proven: true },
    { can_review: false }, { command: 'create_investment_account' }, { application_revision: 0 }, { authority_epoch: 0 },
    { policy_id: null }, { product_id: other + 'x' }, { offering_revision_id: null }, { valid_until: 'yesterday' }, { extra: true }])(
    'rejects enlarged or malformed current markers at the projection boundary %#', change => {
      const value = fixture(), application = value.applications[0]
      Object.assign(application.test_roleplay_review!, change)
      expect(fundRoleplayAdmissionProjectionValid(value, 'TESTNET')).toBe(false)
      expect(validatedFundRoleplayApplicationReview(value, application, context, 'TESTNET')).toBeNull()
    })
  it('allows correctly bound expired capability to be read without allowing review or erasing ordinary rows', () => {
    const value = fixture(), application = value.applications[0]
    application.test_roleplay_review!.valid_until = '2020-01-01T00:00:00Z'
    expect(fundRoleplayAdmissionProjectionValid(value, 'TESTNET')).toBe(true)
    expect(validatedFundRoleplayApplicationReview(value, application, context, 'TESTNET')).toBeNull()
    delete application.test_roleplay_review
    expect(fundRoleplayAdmissionProjectionValid(value, 'MAINNET')).toBe(true)
  })
  it('preserves expired immutable decision provenance without granting another review', () => {
    const value = fixture(), application = decided(); value.applications = [application]
    expect(fundRoleplayAdmissionSchema.safeParse(application.test_roleplay_admission).success).toBe(true)
    expect(validatedFundRoleplayAdmission(application, 'TESTNET')).toEqual(application.test_roleplay_admission)
    expect(fundRoleplayAdmissionProjectionValid(value, 'TESTNET')).toBe(true)
    expect(validatedFundRoleplayApplicationReview(value, application, context, 'TESTNET')).toBeNull()
    expect(validatedFundRoleplayAdmission(application, 'MAINNET')).toBeNull()
    expect(application.test_roleplay_admission).not.toHaveProperty('can_review')
    expect(application.test_roleplay_admission).not.toHaveProperty('provider_result')
  })
  it.each([{ application_id: other }, { decision_revision: 4 }, { submitted_revision: 1 }, { decision: 'REJECTED' },
    { reviewer_id: other }, { reviewed_at: '2026-10-14T12:00:00Z' }, { independence_proven: true }, { can_review: true }])(
    'rejects a fabricated or incorrectly bound historical decision %#', change => {
      const application = decided()
      Object.assign(application.test_roleplay_admission!, change)
      expect(validatedFundRoleplayAdmission(application, 'TESTNET')).toBeNull()
    })
})
