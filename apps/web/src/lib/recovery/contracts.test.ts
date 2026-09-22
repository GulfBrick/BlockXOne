import { describe, expect, it } from 'vitest'
import { gatedRecovery, parseRecoveryIntent, parseRecoveryQuery, parseRecoveryReadProjection, parseRecoveryResult } from './contracts'
const principal = '10000000-0000-4000-8000-000000000001'
const person = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001'
const requestKey = '40000000-0000-4000-8000-000000000001'
const other = '50000000-0000-4000-8000-000000000001'
const request = { intent: 'request', requestKey, reason: 'LOST_AUTHENTICATOR' }
const item = { caseId, targetPersonId: person, requesterPrincipalId: principal, state: 'REQUESTED', revision: '1', reason: 'LOST_AUTHENTICATOR',
  createdAt: '2026-09-20T12:00:00Z', expiresAt: '2026-09-21T12:00:00Z', proposedByPersonId: null, reviewedByPersonId: null,
  evidenceReference: null, isOwn: true, requiresStepUp: false, allowedActions: [] }
function view(patch = {}) { return { availability: 'ready', policyVersion: 1, caller: { principalId: principal, personId: person }, held: false,
  canRequest: false, cases: [item], casesTruncated: false, selectedCase: null, ...patch } }
describe('closed recovery input boundaries', () => {
  it.each([request, { intent: 'propose', requestKey, caseId, expectedRevision: '1', evidenceReference: 'synthetic:incident-1' },
    { intent: 'review', requestKey, caseId, expectedRevision: '2', decision: 'approve' }, { intent: 'review', requestKey, caseId, expectedRevision: '2', decision: 'reject' },
    { intent: 'apply', requestKey, caseId, expectedRevision: '3' }])('accepts the exact intent %#', input => expect(parseRecoveryIntent(input)).toEqual(input))
  it.each([
    { ...request, target: other }, { ...request, personId: person }, { ...request, role: 'SuperAdmin' }, { ...request, reason: 'COMPROMISED_EMAIL' },
    { ...request, requestKey: '00000000-0000-0000-0000-000000000000' }, { ...request, reason: ['LOST_AUTHENTICATOR'] },
    { intent: 'release', requestKey, caseId, expectedRevision: '1' },
    ...['0', '01', '-1', '1e2', '9223372036854775808', 1].map(expectedRevision => ({ intent: 'apply', requestKey, caseId, expectedRevision })),
    { intent: 'propose', requestKey, caseId, expectedRevision: '1', evidenceReference: 'private document body\n' },
    { intent: 'propose', requestKey, caseId, expectedRevision: '1', evidenceReference: 'x'.repeat(201) },
  ])('rejects extra authority, malformed fields and unsupported operations %#', input => expect(parseRecoveryIntent(input)).toBeNull())
  it('rejects accessors/prototypes without evaluating them', () => {
    const input = Object.defineProperty({}, 'requestKey', { get() { throw new Error('getter invoked') } })
    expect(parseRecoveryIntent(input)).toBeNull()
    expect(parseRecoveryIntent(Object.create(request))).toBeNull()
    expect(parseRecoveryIntent({ ...request, [Symbol('extra')]: true })).toBeNull()
  })
  it('admits only the exact optional case selector', () => {
    expect(parseRecoveryQuery({})).toEqual({})
    expect(parseRecoveryQuery(new URLSearchParams({ case: caseId }))).toEqual({ caseId })
    for (const input of [new URLSearchParams(`case=${caseId}&case=${caseId}`), { case: [caseId] }, { case: other, token: 'private' }, { case: '' }]) expect(parseRecoveryQuery(input)).toBeNull()
  })
})
describe('minimal caller-bound projections', () => {
  it('accepts own AAL1 status, held status and closed gate projections', () => {
    expect(parseRecoveryReadProjection(view(), { principalId: principal })).toEqual(view())
    expect(parseRecoveryReadProjection(view({ held: true }), { principalId: principal })?.held).toBe(true)
    for (const gate of ['unauthorised', 'unavailable'] as const) expect(parseRecoveryReadProjection(gatedRecovery(gate), { principalId: principal })).toEqual(gatedRecovery(gate))
  })
  it.each([
    view({ caller: { principalId: other, personId: person } }), view({ held: true, canRequest: true }), view({ canRequest: true }),
    view({ cases: [{ ...item, evidenceReference: 'sensitive:ref' }] }), view({ cases: [{ ...item, proposedByPersonId: other }] }),
    view({ cases: [{ ...item, isOwn: false }] }), view({ cases: [{ ...item, allowedActions: ['propose'] }] }),
    view({ cases: [{ ...item, expiresAt: '2026-02-30T12:00:00Z' }] }), view({ cases: Array(51).fill(item) }), view({ cases: [item, item] }),
    view({ ...gatedRecovery('unavailable'), cases: [item] }), view({ secret: 'hidden' }),
  ])('rejects misbinding, own-only leaks, unsafe actions, invalid dates and excess rows %#', input => expect(parseRecoveryReadProjection(input, { principalId: principal })).toBeNull())
  it('independently validates selected history and masks other actors from own status', () => {
    const event = { sequence: '1', eventType: 'REQUESTED', at: item.createdAt, actorPersonId: person, beforeState: null, afterState: 'REQUESTED', beforeRevision: null, afterRevision: '1' }
    const selectedCase = { ...item, events: [event], historyTruncated: false }
    expect(parseRecoveryReadProjection(view({ selectedCase }), { principalId: principal, selectedCaseId: caseId })?.selectedCase).toEqual(selectedCase)
    expect(parseRecoveryReadProjection(view({ selectedCase }), { principalId: principal })).toBeNull()
    expect(parseRecoveryReadProjection(view({ selectedCase: { ...selectedCase, events: [{ ...event, actorPersonId: other }] } }), { principalId: principal, selectedCaseId: caseId })).toBeNull()
    expect(parseRecoveryReadProjection(view({ selectedCase: { ...selectedCase, events: [event, event] } }), { principalId: principal, selectedCaseId: caseId })).toBeNull()
  })
  it('permits bounded operator evidence and step-up without action authority', () => {
    const operator = { ...item, targetPersonId: other, isOwn: false, evidenceReference: 'synthetic:incident', requiresStepUp: true }
    expect(parseRecoveryReadProjection(view({ cases: [operator] }), { principalId: principal })?.cases).toEqual([operator])
    expect(parseRecoveryReadProjection(view({ cases: [{ ...operator, allowedActions: ['propose'] }] }), { principalId: principal })).toBeNull()
  })
  it('accepts only minimal typed results, never provider bodies', () => {
    const success = { ok: true, caseId, state: 'QUARANTINED', revision: '4', replayed: false }
    expect(parseRecoveryResult(success)).toEqual(success)
    expect(parseRecoveryResult({ ok: false, error: 'conflict' })).toEqual({ ok: false, error: 'conflict' })
    for (const invalid of [{ ...success, token: 'private' }, { ...success, state: 'RECOVERED' }, { ok: false, error: 'database_internal_error' }, { ...success, revision: 4 }]) expect(parseRecoveryResult(invalid)).toBeNull()
  })
})
