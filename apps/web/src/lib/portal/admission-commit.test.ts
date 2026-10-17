import { describe, expect, it } from 'vitest'
import { accountCommitSchema, admissionCommitSchema, admissionOrAccountCommitSchema, admissionCommitSnapshotMatches, matchesAdmissionCommit } from './admission-commit'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from './contracts'
import type { PortalOperatingContext } from './operating-context'

const actor = '11111111-1111-4111-8111-111111111111', organisation = '22222222-2222-4222-8222-222222222222'
const application = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444'
const product = '55555555-5555-4555-8555-555555555555', zero = '00000000-0000-0000-0000-000000000000'
const modes = ['review', 'applicant', 'investor'] as const
function fixture(mode: typeof modes[number]) {
  const context: PortalOperatingContext = mode === 'applicant' ? { mode: 'APPLICANT' }
    : { mode: 'ROLE', organisationId: organisation, role: mode === 'review' ? 'ComplianceOfficer' : 'Investor' }
  const request = portalCommandSchema.parse(mode === 'review'
    ? { command: 'review_application', key: other, payload: { application_id: application, expected_revision: 2,
      decision: 'APPROVED', notes: 'Fictional manual TEST admission rationale.',
      checks: { identity: true, ownership: true, screening: true, suitability: true } } }
    : { command: 'create_investment_account', key: other, payload: { application_id: application } })
  const common = { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
    actor_id: actor, session_id: other, operating_context: context, policy_id: other, authority_epoch: 2,
    product_id: product, offering_revision_id: other, application_id: application, event_id: other,
    request, recorded_at: '2026-10-16T13:30:00Z' }
  const ack = mode === 'review'
    ? { ...common, kind: 'TEST_FUND_ADMISSION_COMMIT', decision_id: other, submitted_revision: 2, decision_revision: 3, decision: 'APPROVED' }
    : { ...common, kind: 'TEST_FUND_ACCOUNT_COMMIT', account_id: other, application_revision: 3, admission_decision_id: other }
  return { ack, request, context, expected: { actorId: actor, context, request, environment: 'TESTNET' as const } }
}

function refreshedResult(mode: typeof modes[number]): PortalSnapshot {
  const { ack: value, request, context } = fixture(mode), ack = admissionOrAccountCommitSchema.parse(value)
  const reviewedAt = mode === 'review' ? ack.recorded_at : '2026-10-16T13:00:00Z'
  const review = fixture('review').request
  if (review.command !== 'review_application') throw new Error('Review fixture required.')
  return { actor: { id: actor, email: 'fixture@example.invalid', display_name: null, can_review: true }, operating_context: context,
    applications: [{ id: application, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 3,
      details: { full_name: 'Fictional investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
        source_of_funds: 'Fictional TEST funds only.', beneficial_owners: '', experience: 'Synthetic experience.', documents: [], test_data_acknowledged: true },
      submitted_at: '2026-10-16T12:00:00Z', reviewed_at: reviewedAt, reviewer_id: actor, review_notes: review.payload.notes,
      organisation_id: null, review_checks: review.payload.checks, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z',
      admission_purpose: 'INVESTOR_ADMISSION', test_roleplay_admission: { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
        independence_proven: false, policy_id: other, authority_epoch: 2, product_id: product, offering_revision_id: other,
        application_id: application, submitted_revision: 2, decision_revision: 3, decision: 'APPROVED', reviewer_id: actor,
        reviewed_at: reviewedAt, valid_until: '2099-01-01T00:00:00Z' } }],
    accounts: mode === 'review' ? [] : [{ id: other, holder_user_id: actor, application_id: application, kind: 'INDIVIDUAL',
      status: 'ACTIVE', created_at: '2026-10-16T13:30:01Z' }], organisations: [], products: [], subscriptions: [],
    events: [{ id: other, subject_id: mode === 'review' ? application : other, kind: request.command, actor_id: actor,
      created_at: mode === 'review' ? '2026-10-16T13:29:59Z' : ack.recorded_at, summary: 'Synthetic original event.' }],
    requests: [{ key: request.key, command: request.command }] }
}

describe.each(modes)('strict %s saved admission/account result', mode => {
  it('recognises only the exact historical result, without a current authority or holding claim', () => {
    const { ack, expected } = fixture(mode)
    expect(matchesAdmissionCommit(ack, expected)).toBe(true)
    const parsed = admissionOrAccountCommitSchema.parse(ack)
    expect(parsed.independence_proven).toBe(false)
    for (const field of ['snapshot', 'status', 'provider_result', 'holdings', 'balance', 'can_review']) expect(parsed).not.toHaveProperty(field)
  })
  it('normalises strict typed payloads independently of JSONB key order', () => {
    const { ack, expected, request } = fixture(mode)
    expect(matchesAdmissionCommit({ ...ack, request: { payload: Object.fromEntries(Object.entries(request.payload).reverse()),
      key: request.key, command: request.command } }, expected)).toBe(true)
  })
  it.each([
    { kind: 'TEST_FUND_OFFERING_DECISION_COMMIT' }, { version: 2 }, { environment: 'MAINNET' }, { execution_mode: 'STANDARD' },
    { independence_proven: true }, { actor_id: null }, { session_id: null }, { policy_id: null }, { event_id: null },
    { authority_epoch: 0 }, { authority_epoch: Number.MAX_SAFE_INTEGER + 1 }, { recorded_at: 'yesterday' },
    { operating_context: { mode: 'ROLE', organisationId: organisation, role: 'SuperAdmin' } },
    { operating_context: { mode: 'APPLICANT', extra: true } }, { status: 'ACTIVE' }, { snapshot: {} }, { extra: true },
  ])('rejects malformed or authority-like fields %#', change => {
    const { ack, expected } = fixture(mode)
    expect(admissionOrAccountCommitSchema.safeParse({ ...ack, ...change }).success).toBe(false)
    expect(matchesAdmissionCommit({ ...ack, ...change }, expected)).toBe(false)
  })
  it.each(['actor_id', 'session_id', 'policy_id', 'product_id', 'offering_revision_id', 'application_id', 'event_id'] as const)(
    'rejects a zero %s', field => expect(admissionOrAccountCommitSchema.safeParse({ ...fixture(mode).ack, [field]: zero }).success).toBe(false))
  it('matches current actual actor/context and runtime, not a different caller or selected capacity', () => {
    const { ack, expected } = fixture(mode)
    for (const change of [{ actorId: other }, { context: { mode: 'ROLE' as const, organisationId: product, role: 'Investor' as const } },
      { environment: 'MAINNET' as const }, { environment: undefined }]) expect(matchesAdmissionCommit(ack, { ...expected, ...change })).toBe(false)
  })
  it('requires the original application, request key, command and exact payload', () => {
    const { ack, expected, request } = fixture(mode)
    for (const change of [{ key: product }, { key: zero }, { extra: true },
      { payload: { ...request.payload, application_id: other } }, { payload: { ...request.payload, extra: true } }]) {
      expect(matchesAdmissionCommit({ ...ack, request: { ...request, ...change } }, expected)).toBe(false)
    }
    const wrong: PortalCommand = { command: 'create_entity_investment_account', key: other, payload: { application_id: application } }
    expect(matchesAdmissionCommit({ ...ack, request: wrong }, { ...expected, request: wrong })).toBe(false)
    expect(matchesAdmissionCommit(null, expected)).toBe(false)
  })
  it('treats session_id as current-session evidence without inventing an original session or refreshing original time', () => {
    const { ack, expected } = fixture(mode)
    expect(matchesAdmissionCommit({ ...ack, session_id: product }, expected)).toBe(true)
    expect(admissionOrAccountCommitSchema.parse(ack).recorded_at).toBe('2026-10-16T13:30:00Z')
  })
})

describe.each(modes)('%s visible saved-result completeness', mode => {
  it('requires actual same-application provenance, original event and actual account, without granting eligibility', () => {
    const value = refreshedResult(mode), ack = fixture(mode).ack
    expect(admissionCommitSnapshotMatches(value, ack)).toBe(true)
    if (mode !== 'review') {
      value.accounts![0].status = 'SUSPENDED'
      expect(admissionCommitSnapshotMatches(value, ack)).toBe(true)
    }
  })
  it.each((['missing application', 'foreign holder', 'duplicate application', 'later revision', 'wrong policy', 'wrong epoch', 'wrong product',
    'wrong package', 'missing marker', 'missing event', 'duplicate event', 'wrong event actor', 'wrong event subject', 'wrong event command',
    'missing request', 'missing account', 'foreign account', 'duplicate account', 'wrong decision', 'wrong review time', 'wrong event time', 'wrong rationale', 'wrong checks'] as const)
    .filter(failure => mode === 'review' ? !['missing account', 'foreign account', 'duplicate account', 'wrong event time'].includes(failure)
      : !['wrong review time', 'wrong rationale', 'wrong checks'].includes(failure)))(
    'does not pass %s as a completed refreshed result', failure => {
      const value = refreshedResult(mode), app = value.applications[0], marker = app.test_roleplay_admission!
      if (failure === 'missing application') value.applications = []
      if (failure === 'foreign holder') app.user_id = other
      if (failure === 'duplicate application') value.applications.push({ ...app })
      if (failure === 'later revision') app.revision = 4
      if (failure === 'wrong policy') marker.policy_id = actor
      if (failure === 'wrong epoch') marker.authority_epoch = 3
      if (failure === 'wrong product') marker.product_id = other
      if (failure === 'wrong package') marker.offering_revision_id = product
      if (failure === 'missing marker') delete app.test_roleplay_admission
      if (failure === 'missing event') value.events = []
      if (failure === 'duplicate event') value.events.push({ ...value.events[0] })
      if (failure === 'wrong event actor') value.events[0].actor_id = other
      if (failure === 'wrong event subject') value.events[0].subject_id = actor
      if (failure === 'wrong event command') value.events[0].kind = 'subscribe'
      if (failure === 'missing request') value.requests = []
      if (failure === 'missing account') value.accounts = []
      if (failure === 'foreign account') value.accounts![0].holder_user_id = other
      if (failure === 'duplicate account') value.accounts!.push({ ...value.accounts![0] })
      if (failure === 'wrong decision') { app.status = 'REJECTED'; marker.decision = 'REJECTED' }
      if (failure === 'wrong review time') { app.reviewed_at = '2026-10-16T13:00:01Z'; marker.reviewed_at = app.reviewed_at }
      if (failure === 'wrong event time') value.events[0].created_at = '2026-10-16T13:30:01Z'
      if (failure === 'wrong rationale') app.review_notes = 'A different fictional review rationale.'
      if (failure === 'wrong checks') app.review_checks = { ...app.review_checks, identity: false }
      expect(admissionCommitSnapshotMatches(value, fixture(mode).ack)).toBe(false)
    })
  it('does not require unexposed decision IDs or current expiry to be invented by a client', () => {
    const value = refreshedResult(mode)
    value.applications[0].test_roleplay_admission!.valid_until = '2020-01-01T00:00:00Z'
    expect(admissionCommitSnapshotMatches(value, fixture(mode).ack)).toBe(true)
    expect(value.applications[0]).not.toHaveProperty('decision_id')
  })
})

describe('distinct admission and actual account evidence', () => {
  it.each(['APPROVED', 'CHANGES_REQUIRED', 'REJECTED'] as const)('binds the recorded %s decision and consecutive exact revisions', decision => {
    const { ack, request, expected } = fixture('review')
    if (request.command !== 'review_application') throw new Error('Review fixture required.')
    const changed = { ...request, payload: { ...request.payload, decision } }
    expect(matchesAdmissionCommit({ ...ack, request: changed, decision }, { ...expected, request: changed })).toBe(true)
    for (const change of [{ submitted_revision: 1 }, { decision_revision: 2 }, { decision_revision: 4 },
      { decision_revision: Number.MAX_SAFE_INTEGER + 1 }, { decision_id: zero }, { decision: 'OTHER' },
      { account_id: other }, { admission_decision_id: other },
      { request: { ...request, payload: { ...request.payload, expected_revision: 3 } } },
      { request: { ...request, payload: { ...request.payload, notes: 'A different fictional review rationale.' } } },
      { request: { ...request, payload: { ...request.payload, checks: { identity: false, ownership: true, screening: true, suitability: true } } } }]) {
      expect(matchesAdmissionCommit({ ...ack, ...change }, expected)).toBe(false)
    }
    expect(admissionCommitSchema.safeParse({ ...ack, submitted_revision: Number.MAX_SAFE_INTEGER,
      decision_revision: Number.MAX_SAFE_INTEGER, request: { ...request, payload: { ...request.payload, expected_revision: Number.MAX_SAFE_INTEGER } } }).success).toBe(false)
  })
  it('never reinterprets an admission decision as proof that an account was created', () => {
    expect(accountCommitSchema.safeParse(fixture('review').ack).success).toBe(false)
    expect(admissionCommitSchema.safeParse(fixture('investor').ack).success).toBe(false)
    for (const change of [{ account_id: zero }, { application_revision: 0 }, { admission_decision_id: zero },
      { decision_id: other }, { submitted_revision: 2 }, { decision: 'APPROVED' }]) {
      expect(accountCommitSchema.safeParse({ ...fixture('investor').ack, ...change }).success).toBe(false)
    }
  })
})
