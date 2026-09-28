import { describe, expect, it } from 'vitest'
import { BX1_ROLES } from '../supabase/contracts'
import {
  ADMIN_ERRORS, ADMIN_KINDS, ADMIN_STATES, parseAdminIntent, parseAdminPayload,
  parseAdminPayloadJson, parseAdminResult, parseAdminReadProjection, type AdminPayloadByKind,
} from './contracts'

const organisationId = '10000000-0000-4000-8000-000000000001'
const principalId = '20000000-0000-4000-8000-000000000001'
const personId = '30000000-0000-4000-8000-000000000001'
const requestKey = '40000000-0000-4000-8000-000000000001'
const proposalId = '50000000-0000-4000-8000-000000000001'
const grantId = '60000000-0000-4000-8000-000000000001'
const membershipId = '70000000-0000-4000-8000-000000000001'
const hugeRevision = '9007199254740993'
const maximumRevision = '9223372036854775807'
const instant = '2026-09-19T12:00:00.123456Z'
const otherPersonId = '30000000-0000-4000-8000-000000000002'
const hash = 'a'.repeat(64)
const payloads: AdminPayloadByKind = {
  ENTITY_DRAFT_CREATE: { displayName: 'Synthetic party', kind: 'FUND', jurisdictionCode: null, registrationReference: null },
  MEMBERSHIP_GRANT: { principalId, role: 'Investor' },
  MEMBERSHIP_REVOKE: { membershipId, reason: 'routine' },
  GOVERNANCE_GRANT: { personId, validUntil: instant },
  GOVERNANCE_REVOKE: { grantId, reason: 'security' },
  PERSON_SCOPE_REVOKE: { personId, reason: 'security' },
}
const propose = (patch = {}) => ({ intent: 'propose', organisationId, requestKey, kind: 'ENTITY_DRAFT_CREATE', payload: JSON.stringify(payloads.ENTITY_DRAFT_CREATE), expectedScopeRevision: hugeRevision, ...patch })
const transition = (patch = {}) => ({ intent: 'review', organisationId, requestKey, proposalId, expectedRevision: hugeRevision, decision: 'approve', ...patch })
const result = (patch = {}) => ({ ok: true, proposalId, state: 'APPLIED', revision: hugeRevision, replayed: false, scopeState: 'HOLD', scopeRevision: maximumRevision, ...patch })

describe('exact bounded administration payloads', () => {
  it('exports exactly six kinds and seven persisted states', () => {
    expect(ADMIN_KINDS).toEqual(Object.keys(payloads))
    expect(ADMIN_STATES).toEqual(['PENDING_REVIEW', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INVALIDATED'])
  })
  it.each(ADMIN_KINDS)('parses and detaches %s without adding authority', (kind) => {
    const value = payloads[kind]
    const parsed = parseAdminPayload(kind, value)
    expect(parsed).toEqual({ kind, payload: value })
    expect(parsed?.payload).not.toBe(value)
  })
  it.each(ADMIN_KINDS)('rejects unknown or missing keys for %s', (kind) => {
    expect(parseAdminPayload(kind, { ...payloads[kind], actor: principalId })).toBeNull()
    const missing: Record<string, unknown> = { ...payloads[kind] }
    delete missing[Object.keys(missing)[0]]
    expect(parseAdminPayload(kind, missing)).toBeNull()
  })
  it.each(BX1_ROLES)('accepts existing membership role %s without granting governance', (role) => {
    expect(parseAdminPayload('MEMBERSHIP_GRANT', { principalId, role })).toEqual({ kind: 'MEMBERSHIP_GRANT', payload: { principalId, role } })
  })
  it.each(['admin', 'superadmin', 'ADMINISTRATION_V1', '', 'Investor '])('rejects role alias %j', (role) => {
    expect(parseAdminPayload('MEMBERSHIP_GRANT', { principalId, role })).toBeNull()
  })
  it('normalizes bounded textual facts without inventing null values', () => {
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { displayName: '  Synthetic party  ', kind: 'COMPANY', jurisdictionCode: 'ZA', registrationReference: '  ref-1  ' })).toEqual({ kind: 'ENTITY_DRAFT_CREATE', payload: { displayName: 'Synthetic party', kind: 'COMPANY', jurisdictionCode: 'ZA', registrationReference: 'ref-1' } })
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { displayName: 'Synthetic', kind: 'COMPANY' })).toBeNull()
  })
  it.each(['', ' ', 'a'.repeat(201), 'name\u0000suffix', 'name\nsuffix', '\ud800'])('rejects unsafe/unbounded display name %j', (displayName) => {
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { ...payloads.ENTITY_DRAFT_CREATE, displayName })).toBeNull()
  })
  it('counts Unicode code points consistently with database text limits', () => {
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { ...payloads.ENTITY_DRAFT_CREATE, displayName: '😀'.repeat(200) })).not.toBeNull()
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { ...payloads.ENTITY_DRAFT_CREATE, displayName: '😀'.repeat(201) })).toBeNull()
  })
  it.each(['za', 'USA', '', 12, {}, ['ZA']])('rejects malformed jurisdiction %j', (jurisdictionCode) => {
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { ...payloads.ENTITY_DRAFT_CREATE, jurisdictionCode })).toBeNull()
  })
  it.each(['', ' ', 'a'.repeat(101), false])('rejects malformed registration reference %j', (registrationReference) => {
    expect(parseAdminPayload('ENTITY_DRAFT_CREATE', { ...payloads.ENTITY_DRAFT_CREATE, registrationReference })).toBeNull()
  })
  it.each(['00000000-0000-0000-0000-000000000000', 'not-a-uuid', '', 1, null, principalId + 'x'])('rejects invalid/nonzero principal IDs %j', (id) => {
    expect(parseAdminPayload('MEMBERSHIP_GRANT', { principalId: id, role: 'Investor' })).toBeNull()
  })
  it('normalizes UUID case without inferring human independence', () => {
    const upper = 'ABCDEF00-0000-4000-8000-000000000001'
    expect(parseAdminPayload('GOVERNANCE_GRANT', { personId: upper, validUntil: instant })).toEqual({ kind: 'GOVERNANCE_GRANT', payload: { personId: upper.toLowerCase(), validUntil: instant } })
  })
  it.each(['ROUTINE', 'SECURITY', 'emergency', '', null])('rejects unsupported revocation reason %j', (reason) => {
    for (const kind of ['MEMBERSHIP_REVOKE', 'GOVERNANCE_REVOKE', 'PERSON_SCOPE_REVOKE'] as const) {
      expect(parseAdminPayload(kind, { ...payloads[kind], reason })).toBeNull()
    }
  })
  it.each(['2026-09-19', '2026-09-19T12:00:00+00:00', '2026-09-19T12:00:00z', '2026-02-30T12:00:00Z', '2025-02-29T00:00:00Z', '2026-09-19T24:00:00Z', '2026-09-19T12:00:60Z', '2026-09-19T12:00:00.1234567Z', '0000-01-01T00:00:00Z', 1])('rejects invalid UTC instant %j', (validUntil) => {
    expect(parseAdminPayload('GOVERNANCE_GRANT', { personId, validUntil })).toBeNull()
  })
  it.each(['2024-02-29T00:00:00Z', '2026-09-19T12:00:00.1Z', instant])('preserves strict UTC instant %s; SQL decides current admission', (validUntil) => {
    expect(parseAdminPayload('GOVERNANCE_GRANT', { personId, validUntil })).toEqual({ kind: 'GOVERNANCE_GRANT', payload: { personId, validUntil } })
  })
  it.each([null, [], true, 'text', 7, new Date(), Object.create({ principalId, role: 'Investor' })])('rejects non-plain payload %j', (value) => {
    expect(parseAdminPayload('MEMBERSHIP_GRANT', value)).toBeNull()
  })
  it('rejects symbols/accessors and prototype pollution keys without evaluating getters', () => {
    let read = false
    const accessor = { get principalId() { read = true; return principalId }, role: 'Investor' }
    expect(parseAdminPayload('MEMBERSHIP_GRANT', accessor)).toBeNull()
    expect(read).toBe(false)
    expect(parseAdminPayload('MEMBERSHIP_GRANT', { principalId, role: 'Investor', [Symbol('secret')]: 'hidden' })).toBeNull()
    expect(parseAdminPayloadJson('MEMBERSHIP_GRANT', `{"principalId":"${principalId}","role":"Investor","__proto__":null}`)).toBeNull()
  })
})

describe('bounded flat JSON payload parsing before information is lost', () => {
  it.each(ADMIN_KINDS)('parses valid JSON for %s', (kind) => {
    expect(parseAdminPayloadJson(kind, JSON.stringify(payloads[kind]))).toEqual({ kind, payload: payloads[kind] })
  })
  it('supports escaped string values and commas without treating them as object syntax', () => {
    const payload = { ...payloads.ENTITY_DRAFT_CREATE, displayName: 'Synthetic ",{}\\ party' }
    expect(parseAdminPayloadJson('ENTITY_DRAFT_CREATE', JSON.stringify(payload))).toEqual({ kind: 'ENTITY_DRAFT_CREATE', payload })
  })
  it.each([
    `{"principalId":"${principalId}","role":"Investor","role":"SuperAdmin"}`,
    `{"principalId":"${principalId}","role":"Investor","\\u0072ole":"SuperAdmin"}`,
    `{"principalId":"${principalId}","role":{"role":"Investor"}}`,
    `{"principalId":"${principalId}","role":["Investor"]}`,
    `{"principalId":"${principalId}","role":true}`,
    `{"principalId":"${principalId}","role":12}`,
    `{"principalId":"${principalId}","role":"Investor",}`,
    `{"principalId":"${principalId}","role":"Investor"} {}`,
    `[{"principalId":"${principalId}","role":"Investor"}]`,
    '{', '', 'null',
  ])('rejects duplicate/nested/nonstring/malformed source %s', (raw) => {
    expect(parseAdminPayloadJson('MEMBERSHIP_GRANT', raw)).toBeNull()
  })
  it('enforces an 8192 UTF-8 byte limit before parsing, not just character count', () => {
    const raw = JSON.stringify(payloads.ENTITY_DRAFT_CREATE)
    expect(parseAdminPayloadJson('ENTITY_DRAFT_CREATE', raw + ' '.repeat(8192 - raw.length))).not.toBeNull()
    expect(parseAdminPayloadJson('ENTITY_DRAFT_CREATE', raw + ' '.repeat(8193 - raw.length))).toBeNull()
    expect(parseAdminPayloadJson('ENTITY_DRAFT_CREATE', JSON.stringify({ ...payloads.ENTITY_DRAFT_CREATE, displayName: '😀'.repeat(2200) }))).toBeNull()
  })
})

describe('exact administration intents', () => {
  it('normalizes proposed payload and preserves revisions beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseAdminIntent(propose())).toEqual(propose())
  })
  it.each(['approve', 'reject'])('accepts independent review intent %s without deciding authorization', (decision) => {
    expect(parseAdminIntent(transition({ decision }))).toEqual(transition({ decision }))
  })
  it.each(['apply', 'cancel'])('accepts exact %s intent', (intent) => {
    const value = { intent, organisationId, requestKey, proposalId, expectedRevision: maximumRevision }
    expect(parseAdminIntent(value)).toEqual(value)
    expect(parseAdminIntent({ ...value, decision: 'approve' })).toBeNull()
  })
  it.each(['0', '-1', '01', '1.0', '1e3', ' 1', '1\n', '9223372036854775808', '9'.repeat(1000), 1, 9007199254740992, null])('rejects invalid/lossy revision %j', (revision) => {
    expect(parseAdminIntent(propose({ expectedScopeRevision: revision }))).toBeNull()
    expect(parseAdminIntent(transition({ expectedRevision: revision }))).toBeNull()
  })
  it.each(['actorId', 'personId', 'aal', 'policyVersion', 'expiresAt', 'payloadHash', 'resourceId'])('rejects client-selected authority/immutable extra %s', (key) => {
    expect(parseAdminIntent(propose({ [key]: 'invented' }))).toBeNull()
  })
  it('rejects unknown kind, intent, decision, malformed IDs and duplicate payload keys', () => {
    expect(parseAdminIntent(propose({ kind: 'access.role.grant' }))).toBeNull()
    expect(parseAdminIntent(propose({ intent: 'bootstrap' }))).toBeNull()
    expect(parseAdminIntent(transition({ decision: 'APPLIED' }))).toBeNull()
    expect(parseAdminIntent(transition({ proposalId: '00000000-0000-0000-0000-000000000000' }))).toBeNull()
    expect(parseAdminIntent(propose({ payload: '{"kind":"FUND","kind":"COMPANY"}' }))).toBeNull()
  })
})

describe('safe authoritative results', () => {
  it('accepts APPLIED plus HOLD as a successful restriction, not an error', () => {
    expect(parseAdminResult(result())).toEqual(result())
  })
  it.each(ADMIN_STATES)('accepts exact state %s without making effects up', (state) => {
    expect(parseAdminResult(result({ state }))).toEqual(result({ state }))
  })
  it.each(ADMIN_ERRORS)('accepts only bounded error %s', (error) => {
    expect(parseAdminResult({ ok: false, error })).toEqual({ ok: false, error })
  })
  it.each([{ ok: false, error: 'permission denied for table auth.sessions' }, { ok: false, error: 'forbidden', email: 'not-projected' }, result({ access_token: 'not-projected' }), result({ state: 'DONE' }), result({ revision: 1 }), result({ replayed: 'true' }), result({ scopeState: 'ACTIVE' }), { ...result(), ok: 'true' }, null])('rejects unknown/extra/lossy result', (value) => {
    expect(parseAdminResult(value)).toBeNull()
  })
})

const grant = (patch = {}) => ({ id: grantId, personId, capability: 'ADMINISTRATION_V1', status: 'ACTIVE', validFrom: '2026-09-01T00:00:00Z', validUntil: instant, revision: hugeRevision, ...patch })
const membership = (patch = {}) => ({ id: membershipId, principalId, personId, role: 'SuperAdmin', status: 'ACTIVE', ...patch })
const person = (patch = {}) => ({ id: personId, label: 'Synthetic governor', principals: [{ id: principalId, memberships: [membership()] }], principalsTruncated: false, ...patch })
const proposal = (patch = {}) => ({
  id: proposalId, kind: 'ENTITY_DRAFT_CREATE', state: 'PENDING_REVIEW', revision: '1',
  requesterPersonId: personId, beneficiaryPersonId: null, reviewerPersonId: null,
  payload: { ...payloads.ENTITY_DRAFT_CREATE }, payloadHash: hash, expiresAt: instant,
  expectedScopeRevision: hugeRevision, expectedTrustRevision: '1', policyVersion: 1,
  allowedTransitions: ['cancel'], ...patch,
})
const event = (patch = {}) => ({
  id: '80000000-0000-4000-8000-000000000001', sequence: hugeRevision, type: 'PROPOSED', actorPersonId: personId,
  beforeState: null, afterState: 'PENDING_REVIEW', beforeRevision: null, afterRevision: '1',
  payloadHash: hash, reason: null, createdAt: '2026-09-18T12:00:00Z', ...patch,
})
const entity = (patch = {}) => ({ id: '90000000-0000-4000-8000-000000000001', ...payloads.ENTITY_DRAFT_CREATE, status: 'DRAFT', revision: '1', relationship: 'RECORDED_ONLY', ...patch })
const view = (patch = {}) => ({
  availability: 'ready', scopeRevision: hugeRevision, policyVersion: 1,
  caller: { principalId, personId, grant: grant() },
  scope: { organisationId, state: 'READY', revision: hugeRevision, policyVersion: 1, trustRevision: '1' },
  people: [person()], entities: [entity()], proposals: [proposal()], selectedProposal: null,
  truncated: { people: false, entities: false, proposals: false }, governanceGrants: [grant()], grantsTruncated: false,
  ...patch,
})
const gate = (availability = 'unconfigured') => ({
  availability, scopeRevision: null, policyVersion: 1, caller: null, scope: null,
  people: [], entities: [], proposals: [], selectedProposal: null,
  truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false,
})
const expected = { organisationId, principalId }
const idAt = (prefix: string, index: number) => `${prefix}0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`

describe('strict scoped administration read projection', () => {
  it('returns detached safe data bound to the verified workspace actor and selected organisation', () => {
    const input = view()
    const parsed = parseAdminReadProjection(input, expected)
    expect(parsed).toEqual(input)
    expect(parsed?.people).not.toBe(input.people)
    expect(parsed?.caller).not.toBe(input.caller)
  })
  it.each(['unconfigured', 'forbidden', 'mfa_required', 'step_up_required', 'unavailable'])('accepts safe empty gate %s', (availability) => {
    expect(parseAdminReadProjection(gate(availability), expected)).toEqual(gate(availability))
  })
  it.each(['caller', 'scope', 'people', 'entities', 'proposals', 'governanceGrants', 'scopeRevision'])('rejects private data in gate field %s', (key) => {
    expect(parseAdminReadProjection({ ...gate(), [key]: view()[key as keyof ReturnType<typeof view>] }, expected)).toBeNull()
  })
  it('rejects hidden selected history or truncation/count signals in gate responses', () => {
    expect(parseAdminReadProjection({ ...gate(), selectedProposal: { ...proposal(), events: [], historyTruncated: false } }, expected)).toBeNull()
    expect(parseAdminReadProjection({ ...gate(), grantsTruncated: true }, expected)).toBeNull()
    expect(parseAdminReadProjection({ ...gate(), truncated: { people: true, entities: false, proposals: false } }, expected)).toBeNull()
    expect(parseAdminReadProjection({ ...gate(), total: 3 }, expected)).toBeNull()
  })
  it.each([
    { caller: null }, { scope: null }, { availability: 'admin' }, { scopeRevision: '1' }, { policyVersion: 2 },
    { caller: { principalId: requestKey, personId, grant: grant() } },
    { caller: { principalId, personId: otherPersonId, grant: grant() } },
    { caller: { principalId, personId, grant: grant({ status: 'REVOKED' }) } },
    { caller: { principalId, personId, grant: grant({ capability: 'ALL_ACTIONS' }) } },
    { scope: { organisationId: requestKey, state: 'READY', revision: hugeRevision, policyVersion: 1, trustRevision: '1' } },
    { scope: { organisationId, state: 'HOLD', revision: hugeRevision, policyVersion: 1, trustRevision: '1' } },
  ])('rejects mismatched/invalid caller or scope %#', (patch) => {
    expect(parseAdminReadProjection(view(patch), expected)).toBeNull()
  })
  it('accepts HOLD with no mutation hints and rejects an actionable HOLD', () => {
    const held = view({ availability: 'hold', scope: { organisationId, state: 'HOLD', revision: hugeRevision, policyVersion: 1, trustRevision: '1' }, proposals: [proposal({ allowedTransitions: [] })] })
    expect(parseAdminReadProjection(held, expected)).toEqual(held)
    expect(parseAdminReadProjection({ ...held, proposals: [proposal()] }, expected)).toBeNull()
  })
  it('rejects extra private keys at every representative nesting depth', () => {
    for (const patch of [
      { token: 'not-projected' }, { caller: { ...view().caller, sessionId: requestKey } },
      { people: [person({ email: 'not-projected' })] }, { governanceGrants: [grant({ evidenceReference: 'not-projected' })] },
      { entities: [entity({ approvedIssuer: true })] }, { proposals: [proposal({ actorClaims: {} })] },
    ]) expect(parseAdminReadProjection(view(patch), expected)).toBeNull()
  })
  it('rejects inconsistent nested person/principal/membership relationships and duplicate roles', () => {
    for (const principals of [
      [{ id: principalId, memberships: [membership({ personId: otherPersonId })] }],
      [{ id: principalId, memberships: [membership({ principalId: requestKey })] }],
      [{ id: principalId, memberships: [membership(), membership({ id: requestKey })] }],
      [{ id: principalId, memberships: [membership()] }, { id: principalId, memberships: [membership()] }],
    ]) expect(parseAdminReadProjection(view({ people: [person({ principals })] }), expected)).toBeNull()
  })
  it('does not equate distinct principal IDs with distinct humans', () => {
    const input = view({ people: [person({ principals: [{ id: principalId, memberships: [membership()] }, { id: requestKey, memberships: [membership({ id: proposalId, principalId: requestKey })] }] })] })
    expect(parseAdminReadProjection(input, expected)).toEqual(input)
  })
  it('rejects duplicate top-level records and cross-person reused principals', () => {
    expect(parseAdminReadProjection(view({ people: [person(), person()] }), expected)).toBeNull()
    expect(parseAdminReadProjection(view({ governanceGrants: [grant(), grant()] }), expected)).toBeNull()
    expect(parseAdminReadProjection(view({ entities: [entity(), entity()] }), expected)).toBeNull()
    expect(parseAdminReadProjection(view({ proposals: [proposal(), proposal()] }), expected)).toBeNull()
    expect(parseAdminReadProjection(view({ people: [person(), person({ id: otherPersonId, principals: [{ id: principalId, memberships: [membership({ personId: otherPersonId })] }] })] }), expected)).toBeNull()
  })
  it('accepts bounded newest lists and preserves truncation without implying completeness', () => {
    const input = view({ entities: Array.from({ length: 50 }, (_, i) => entity({ id: idAt('9', i) })), truncated: { people: false, entities: true, proposals: false }, grantsTruncated: true })
    expect(parseAdminReadProjection(input, expected)).toEqual(input)
    expect(parseAdminReadProjection({ ...input, entities: [...input.entities, entity({ id: idAt('9', 50) })] }, expected)).toBeNull()
  })
  it.each(['people', 'entities', 'proposals', 'governanceGrants'] as const)('accepts 49/50 and rejects 51 valid unique %s records', (key) => {
    const makeRow = (index: number) => {
      if (key === 'entities') return entity({ id: idAt('9', index) })
      if (key === 'proposals') return proposal({ id: idAt('5', index) })
      if (key === 'governanceGrants') return grant({ id: idAt('6', index), personId: idAt('3', index) })
      return person({ id: idAt('3', index), principals: [{ id: idAt('2', index), memberships: [membership({ id: idAt('7', index), principalId: idAt('2', index), personId: idAt('3', index) })] }] })
    }
    for (const count of [49, 50]) {
      const input = view({ [key]: Array.from({ length: count }, (_, index) => makeRow(index)) })
      expect(parseAdminReadProjection(input, expected)).toEqual(input)
    }
    expect(parseAdminReadProjection(view({ [key]: Array.from({ length: 51 }, (_, index) => makeRow(index)) }), expected)).toBeNull()
  })
  it('enforces ten principals and nine unique existing membership role rows', () => {
    const principalAt = (index: number) => ({ id: idAt('2', index), memberships: [membership({ id: idAt('7', index), principalId: idAt('2', index) })] })
    for (const count of [9, 10]) {
      const input = view({ people: [person({ principals: Array.from({ length: count }, (_, index) => principalAt(index)) })] })
      expect(parseAdminReadProjection(input, expected)).toEqual(input)
    }
    expect(parseAdminReadProjection(view({ people: [person({ principals: Array.from({ length: 11 }, (_, index) => principalAt(index)) })] }), expected)).toBeNull()
    const allRoles = BX1_ROLES.map((role, i) => membership({ role, id: idAt('7', i) }))
    expect(parseAdminReadProjection(view({ people: [person({ principals: [{ id: principalId, memberships: allRoles }] })] }), expected)).not.toBeNull()
    // The domain has exactly nine roles, so a tenth row cannot simultaneously
    // satisfy the unique-role invariant. No tenth role is invented for a test.
    expect(parseAdminReadProjection(view({ people: [person({ principals: [{ id: principalId, memberships: [...allRoles, membership({ id: idAt('7', 9) })] }] })] }), expected)).toBeNull()
  })
  it.each([{ status: 'ACTIVE' }, { relationship: 'ISSUER' }, { revision: '2' }, { kind: 'APPROVED_ISSUER' }])('keeps recorded entities DRAFT-only %#', (patch) => {
    expect(parseAdminReadProjection(view({ entities: [entity(patch)] }), expected)).toBeNull()
  })
  it.each([{ validUntil: '2026-08-01T00:00:00Z' }, { validUntil: '2027-08-01T00:00:00Z' }, { revision: 1 }, { personId: 'zero' }])('rejects malformed grant interval/revision/identity %#', (patch) => {
    expect(parseAdminReadProjection(view({ governanceGrants: [grant(patch)] }), expected)).toBeNull()
  })
  it.each([
    { kind: 'MEMBERSHIP_GRANT' }, { payloadHash: 'a'.repeat(63) }, { expectedScopeRevision: 1 },
    { policyVersion: 2 }, { expiresAt: '2026-02-30T00:00:00Z' }, { allowedTransitions: ['elevate'] },
    { allowedTransitions: ['cancel', 'cancel'] }, { state: 'APPLIED', allowedTransitions: ['apply'] },
    { kind: 'GOVERNANCE_GRANT', payload: payloads.GOVERNANCE_GRANT, beneficiaryPersonId: otherPersonId },
  ])('rejects inconsistent proposal payload/metadata %#', (patch) => {
    expect(parseAdminReadProjection(view({ proposals: [proposal(patch)] }), expected)).toBeNull()
  })
  it('parses separately selected proposal/history even when it is outside the newest proposal list', () => {
    const selectedProposal = { ...proposal(), events: [event()], historyTruncated: true }
    const input = view({ proposals: [], selectedProposal })
    expect(parseAdminReadProjection(input, { ...expected, selectedProposalId: proposalId })).toEqual(input)
    expect(parseAdminReadProjection(input, { ...expected, selectedProposalId: requestKey })).toBeNull()
    expect(parseAdminReadProjection(input, expected)).toBeNull()
  })
  it('enforces newest-first unique audit sequence, bounded safe reasons and no bootstrap history', () => {
    for (const events of [
      [event({ type: 'BOOTSTRAP' })], [event({ reason: 'raw database error' })], [event({ afterRevision: 1 })],
      [event({ sequence: 1 })], [event({ payloadHash: 'b'.repeat(64) })], [event({ evidenceReference: 'private' })],
      [event(), event()], [event(), event({ id: requestKey, sequence: '9007199254740994' })],
    ]) expect(parseAdminReadProjection(view({ selectedProposal: { ...proposal(), events, historyTruncated: false } }), { ...expected, selectedProposalId: proposalId })).toBeNull()
  })
  it('accepts 99/100 ordered valid audit rows and rejects 101, retaining string precision and truncation', () => {
    for (const count of [99, 100, 101]) {
      const events = Array.from({ length: count }, (_, i) => event({ id: idAt('8', i), sequence: String(BigInt(hugeRevision) - BigInt(i)) }))
      const input = view({ selectedProposal: { ...proposal(), events, historyTruncated: true } })
      const parsed = parseAdminReadProjection(input, { ...expected, selectedProposalId: proposalId })
      if (count <= 100) expect(parsed).toEqual(input)
      else expect(parsed).toBeNull()
    }
  })
})
