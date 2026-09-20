// Closed data contracts, not authority. SQL re-authorizes every read and write.
export const RECOVERY_STATES = ['REQUESTED', 'PENDING_REVIEW', 'APPROVED', 'QUARANTINED', 'REJECTED', 'EXPIRED', 'INVALIDATED'] as const
export const RECOVERY_ERRORS = ['invalid_request', 'unauthorised', 'forbidden', 'step_up_required', 'conflict', 'expired', 'unavailable'] as const
export type RecoveryState = typeof RECOVERY_STATES[number]
export type RecoveryError = typeof RECOVERY_ERRORS[number]
export type RecoveryAction = 'propose' | 'approve' | 'reject' | 'apply'
export type RecoveryIntent =
  | { intent: 'request'; requestKey: string; reason: 'LOST_AUTHENTICATOR' }
  | { intent: 'propose'; requestKey: string; caseId: string; expectedRevision: string; evidenceReference: string }
  | { intent: 'review'; requestKey: string; caseId: string; expectedRevision: string; decision: 'approve' | 'reject' }
  | { intent: 'apply'; requestKey: string; caseId: string; expectedRevision: string }
export type RecoveryResult = { ok: true; caseId: string; state: RecoveryState; revision: string; replayed: boolean } | { ok: false; error: RecoveryError }
export type RecoveryCaseView = {
  caseId: string; targetPersonId: string; requesterPrincipalId: string; state: RecoveryState; revision: string;
  reason: 'LOST_AUTHENTICATOR'; createdAt: string; expiresAt: string;
  proposedByPersonId: string | null; reviewedByPersonId: string | null; evidenceReference: string | null;
  isOwn: boolean; requiresStepUp: boolean; allowedActions: RecoveryAction[];
}
export type RecoveryEventView = {
  sequence: string; eventType: 'REQUESTED' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'QUARANTINED' | 'EXPIRED' | 'INVALIDATED';
  at: string; actorPersonId: string | null; beforeState: RecoveryState | null; afterState: RecoveryState;
  beforeRevision: string | null; afterRevision: string;
}
export type RecoveryReadProjection = {
  availability: 'ready' | 'unauthorised' | 'unavailable'; policyVersion: 1;
  caller: { principalId: string; personId: string } | null; held: boolean; canRequest: boolean;
  cases: RecoveryCaseView[]; casesTruncated: boolean;
  selectedCase: (RecoveryCaseView & { events: RecoveryEventView[]; historyTruncated: boolean }) | null;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function recoveryUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) && value !== '00000000-0000-0000-0000-000000000000'
}
function revision(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
}
function evidence(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value) }
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
}
function state(value: unknown): value is RecoveryState { return RECOVERY_STATES.includes(value as RecoveryState) }
// Reject prototypes, accessors and symbols before looking at values.
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function nullableUuid(value: unknown): value is string | null { return value === null || recoveryUuid(value) }
export function parseRecoveryIntent(value: unknown): RecoveryIntent | null {
  try {
    if (!record(value) || !recoveryUuid(value.requestKey)) return null
    if (value.intent === 'request') return exact(value, ['intent', 'requestKey', 'reason']) && value.reason === 'LOST_AUTHENTICATOR'
      ? { intent: 'request', requestKey: value.requestKey, reason: value.reason } : null
    if (!recoveryUuid(value.caseId) || !revision(value.expectedRevision)) return null
    const base = { requestKey: value.requestKey, caseId: value.caseId, expectedRevision: value.expectedRevision }
    if (value.intent === 'propose' && exact(value, ['intent', 'requestKey', 'caseId', 'expectedRevision', 'evidenceReference']) && evidence(value.evidenceReference))
      return { intent: 'propose', ...base, evidenceReference: value.evidenceReference }
    if (value.intent === 'review' && exact(value, ['intent', 'requestKey', 'caseId', 'expectedRevision', 'decision']) && (value.decision === 'approve' || value.decision === 'reject'))
      return { intent: 'review', ...base, decision: value.decision }
    if (value.intent === 'apply' && exact(value, ['intent', 'requestKey', 'caseId', 'expectedRevision'])) return { intent: 'apply', ...base }
    return null
  } catch { return null }
}
export function parseRecoveryResult(value: unknown): RecoveryResult | null {
  try {
    if (exact(value, ['ok', 'error']) && value.ok === false && RECOVERY_ERRORS.includes(value.error as RecoveryError)) return { ok: false, error: value.error as RecoveryError }
    if (!exact(value, ['ok', 'caseId', 'state', 'revision', 'replayed']) || value.ok !== true || !recoveryUuid(value.caseId)
      || !state(value.state) || !revision(value.revision) || typeof value.replayed !== 'boolean') return null
    return { ok: true, caseId: value.caseId, state: value.state, revision: value.revision, replayed: value.replayed }
  } catch { return null }
}
export function parseRecoveryQuery(input: URLSearchParams | Record<string, string | string[] | undefined>): { caseId?: string } | null {
  try {
    if (!(input instanceof URLSearchParams) && !record(input)) return null
    const entries = input instanceof URLSearchParams ? [...input.entries()] : Object.entries(input)
    if (entries.length === 0) return {}
    if (entries.length !== 1 || entries[0][0] !== 'case') return null
    if (entries[0][1] === undefined && !(input instanceof URLSearchParams)) return {}
    return recoveryUuid(entries[0][1]) ? { caseId: entries[0][1] } : null
  } catch { return null }
}
const caseKeys = ['caseId', 'targetPersonId', 'requesterPrincipalId', 'state', 'revision', 'reason', 'createdAt', 'expiresAt', 'proposedByPersonId', 'reviewedByPersonId', 'evidenceReference', 'isOwn', 'requiresStepUp', 'allowedActions']
const allowedByState: Record<RecoveryState, readonly RecoveryAction[]> = {
  REQUESTED: ['propose'], PENDING_REVIEW: ['approve', 'reject'], APPROVED: ['apply'], QUARANTINED: [], REJECTED: [], EXPIRED: [], INVALIDATED: [],
}
function parseCase(value: unknown, personId: string, selected = false): RecoveryCaseView | null {
  if (!exact(value, selected ? [...caseKeys, 'events', 'historyTruncated'] : caseKeys)
    || !recoveryUuid(value.caseId) || !recoveryUuid(value.targetPersonId) || !recoveryUuid(value.requesterPrincipalId)
    || !state(value.state) || !revision(value.revision) || value.reason !== 'LOST_AUTHENTICATOR'
    || !date(value.createdAt) || !date(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
    || !nullableUuid(value.proposedByPersonId) || !nullableUuid(value.reviewedByPersonId)
    || (value.evidenceReference !== null && !evidence(value.evidenceReference))
    || typeof value.isOwn !== 'boolean' || value.isOwn !== (value.targetPersonId === personId)
    || typeof value.requiresStepUp !== 'boolean' || !Array.isArray(value.allowedActions) || value.allowedActions.length > 2
    || new Set(value.allowedActions).size !== value.allowedActions.length
    || value.allowedActions.some(action => !allowedByState[value.state as RecoveryState].includes(action as RecoveryAction))) return null
  if (value.isOwn && (value.evidenceReference !== null || value.proposedByPersonId !== null || value.reviewedByPersonId !== null || value.allowedActions.length || value.requiresStepUp)) return null
  if (value.requiresStepUp && value.allowedActions.length) return null
  return { caseId: value.caseId, targetPersonId: value.targetPersonId, requesterPrincipalId: value.requesterPrincipalId,
    state: value.state, revision: value.revision, reason: value.reason, createdAt: value.createdAt, expiresAt: value.expiresAt,
    proposedByPersonId: value.proposedByPersonId, reviewedByPersonId: value.reviewedByPersonId, evidenceReference: value.evidenceReference,
    isOwn: value.isOwn, requiresStepUp: value.requiresStepUp, allowedActions: value.allowedActions as RecoveryAction[] }
}
function parseEvent(value: unknown, ownPersonId: string | null): RecoveryEventView | null {
  if (!exact(value, ['sequence', 'eventType', 'at', 'actorPersonId', 'beforeState', 'afterState', 'beforeRevision', 'afterRevision'])
    || !revision(value.sequence) || typeof value.eventType !== 'string' || !['REQUESTED', 'PROPOSED', 'APPROVED', 'REJECTED', 'QUARANTINED', 'EXPIRED', 'INVALIDATED'].includes(value.eventType)
    || !date(value.at) || !nullableUuid(value.actorPersonId) || (ownPersonId !== null && value.actorPersonId !== null && value.actorPersonId !== ownPersonId)
    || (value.beforeState !== null && !state(value.beforeState)) || !state(value.afterState)
    || (value.beforeRevision !== null && !revision(value.beforeRevision)) || !revision(value.afterRevision)) return null
  return { sequence: value.sequence, eventType: value.eventType as RecoveryEventView['eventType'], at: value.at, actorPersonId: value.actorPersonId,
    beforeState: value.beforeState, afterState: value.afterState, beforeRevision: value.beforeRevision, afterRevision: value.afterRevision }
}
export function gatedRecovery(availability: 'unauthorised' | 'unavailable'): RecoveryReadProjection {
  return { availability, policyVersion: 1, caller: null, held: false, canRequest: false, cases: [], casesTruncated: false, selectedCase: null }
}
export function parseRecoveryReadProjection(value: unknown, expected: { principalId: string; selectedCaseId?: string }): RecoveryReadProjection | null {
  try {
    if (!exact(value, ['availability', 'policyVersion', 'caller', 'held', 'canRequest', 'cases', 'casesTruncated', 'selectedCase'])
      || value.policyVersion !== 1 || typeof value.held !== 'boolean' || typeof value.canRequest !== 'boolean'
      || typeof value.casesTruncated !== 'boolean' || !Array.isArray(value.cases) || value.cases.length > 50) return null
    if (value.availability === 'unauthorised' || value.availability === 'unavailable') return value.caller === null && !value.held && !value.canRequest
      && value.cases.length === 0 && !value.casesTruncated && value.selectedCase === null ? gatedRecovery(value.availability) : null
    if (value.availability !== 'ready' || !exact(value.caller, ['principalId', 'personId']) || !recoveryUuid(value.caller.personId)
      || !recoveryUuid(value.caller.principalId) || value.caller.principalId !== expected.principalId || (value.held && value.canRequest)) return null
    const personId = value.caller.personId
    const cases: RecoveryCaseView[] = []
    for (const candidate of value.cases) {
      const item = parseCase(candidate, personId)
      if (!item || cases.some(previous => previous.caseId === item.caseId)) return null
      if (cases.length && Date.parse(cases[cases.length - 1].createdAt) < Date.parse(item.createdAt)) return null
      cases.push(item)
    }
    let selectedCase: RecoveryReadProjection['selectedCase'] = null
    if (value.selectedCase !== null) {
      const item = parseCase(value.selectedCase, personId, true)
      if (!item || !record(value.selectedCase) || item.caseId !== expected.selectedCaseId
        || !Array.isArray(value.selectedCase.events) || value.selectedCase.events.length > 100 || typeof value.selectedCase.historyTruncated !== 'boolean') return null
      const events: RecoveryEventView[] = []
      for (const candidate of value.selectedCase.events) {
        const event = parseEvent(candidate, item.isOwn ? personId : null)
        if (!event || (events.length && BigInt(events[events.length - 1].sequence) >= BigInt(event.sequence))) return null
        events.push(event)
      }
      selectedCase = { ...item, events, historyTruncated: value.selectedCase.historyTruncated }
      const listed = cases.find(entry => entry.caseId === item.caseId)
      if (listed && JSON.stringify(listed) !== JSON.stringify(item)) return null
    }
    if (value.canRequest && [...cases, ...(selectedCase ? [selectedCase] : [])].some(item => item.isOwn && ['REQUESTED', 'PENDING_REVIEW', 'APPROVED', 'QUARANTINED'].includes(item.state))) return null
    if (value.held && [...cases, ...(selectedCase ? [selectedCase] : [])].some(item => !item.isOwn)) return null
    return { availability: 'ready', policyVersion: 1, caller: { principalId: value.caller.principalId, personId }, held: value.held,
      canRequest: value.canRequest, cases, casesTruncated: value.casesTruncated, selectedCase }
  } catch { return null }
}
