import { BX1_ROLES, type Bx1Role } from '../supabase/contracts'

// Data validation only. A parsed identifier, role, grant, or transition hint is
// not authority; the request-local server context and SQL must re-authorize it.
export const ADMIN_KINDS = [
  'ENTITY_DRAFT_CREATE', 'MEMBERSHIP_GRANT', 'MEMBERSHIP_REVOKE',
  'GOVERNANCE_GRANT', 'GOVERNANCE_REVOKE', 'PERSON_SCOPE_REVOKE',
] as const
export const ADMIN_STATES = [
  'PENDING_REVIEW', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INVALIDATED',
] as const
export const ADMIN_ERRORS = [
  'invalid_request', 'unauthorised', 'forbidden', 'unconfigured', 'mfa_required',
  'step_up_required', 'conflict', 'expired', 'governance_hold', 'rate_limited', 'unavailable',
] as const
export const ADMIN_ENTITY_KINDS = ['COMPANY', 'TRUST', 'FUND', 'OTHER'] as const
export const ADMIN_TRANSITIONS = ['approve', 'reject', 'apply', 'cancel'] as const

export type AdminKind = (typeof ADMIN_KINDS)[number]
export type AdminState = (typeof ADMIN_STATES)[number]
export type AdminError = (typeof ADMIN_ERRORS)[number]
export type AdminEntityKind = (typeof ADMIN_ENTITY_KINDS)[number]
export type AdminTransition = (typeof ADMIN_TRANSITIONS)[number]
export type AdminReason = 'routine' | 'security'
export type AdminPayloadByKind = {
  ENTITY_DRAFT_CREATE: { displayName: string; kind: AdminEntityKind; jurisdictionCode: string | null; registrationReference: string | null }
  MEMBERSHIP_GRANT: { principalId: string; role: Bx1Role }
  MEMBERSHIP_REVOKE: { membershipId: string; reason: AdminReason }
  GOVERNANCE_GRANT: { personId: string; validUntil: string }
  GOVERNANCE_REVOKE: { grantId: string; reason: AdminReason }
  PERSON_SCOPE_REVOKE: { personId: string; reason: AdminReason }
}
export type ValidatedAdminPayload = {
  [K in AdminKind]: { kind: K; payload: AdminPayloadByKind[K] }
}[AdminKind]
export type AdminIntent =
  | { intent: 'propose'; organisationId: string; requestKey: string; kind: AdminKind; payload: string; expectedScopeRevision: string }
  | { intent: 'review'; organisationId: string; requestKey: string; proposalId: string; expectedRevision: string; decision: 'approve' | 'reject' }
  | { intent: 'apply' | 'cancel'; organisationId: string; requestKey: string; proposalId: string; expectedRevision: string }
export type AdminResult =
  | { ok: true; proposalId: string; state: AdminState; revision: string; replayed: boolean; scopeState: 'READY' | 'HOLD'; scopeRevision: string }
  | { ok: false; error: AdminError }
export type AdminGrantView = {
  id: string; personId: string; capability: 'ADMINISTRATION_V1'; status: 'ACTIVE' | 'REVOKED';
  validFrom: string; validUntil: string; revision: string
}
export type AdminMembershipView = { id: string; principalId: string; personId: string; role: Bx1Role; status: 'ACTIVE' | 'SUSPENDED' }
export type AdminCallerView = { principalId: string; personId: string; grant: AdminGrantView }
export type AdminScopeView = { organisationId: string; state: 'READY' | 'HOLD'; revision: string; policyVersion: 1; trustRevision: string }
export type AdminProposalView = ValidatedAdminPayload & {
  id: string; state: AdminState; revision: string; requesterPersonId: string;
  beneficiaryPersonId: string | null; reviewerPersonId: string | null; payloadHash: string; expiresAt: string;
  expectedScopeRevision: string; expectedTrustRevision: string; policyVersion: 1; allowedTransitions: AdminTransition[]
}
export const ADMIN_AVAILABILITIES = ['ready', 'hold', 'unconfigured', 'forbidden', 'mfa_required', 'step_up_required', 'unavailable'] as const
export const ADMIN_EVENT_TYPES = ['PROPOSED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'INVALIDATED', 'APPLIED', 'GOVERNANCE_HOLD', 'BOOTSTRAP'] as const
export const ADMIN_SAFE_REASONS = ['routine', 'security', 'expired', 'stale_policy', 'stale_scope', 'stale_trust', 'stale_target', 'authority_lost', 'below_two_governors'] as const
export type AdminAvailability = (typeof ADMIN_AVAILABILITIES)[number]
export type AdminEventType = (typeof ADMIN_EVENT_TYPES)[number]
export type AdminSafeReason = (typeof ADMIN_SAFE_REASONS)[number]
export type AdminPrincipalView = { id: string; memberships: AdminMembershipView[] }
export type AdminPersonView = { id: string; label: string; principals: AdminPrincipalView[]; principalsTruncated: boolean }
export type AdminEntityView = AdminPayloadByKind['ENTITY_DRAFT_CREATE'] & { id: string; status: 'DRAFT'; revision: '1'; relationship: 'RECORDED_ONLY' }
export type AdminAuditEventView = {
  id: string; sequence: string; type: Exclude<AdminEventType, 'BOOTSTRAP'>; actorPersonId: string;
  beforeState: AdminState | null; afterState: AdminState; beforeRevision: string | null;
  afterRevision: string; payloadHash: string; reason: AdminSafeReason | null; createdAt: string
}
export type AdminSelectedProposalView = AdminProposalView & { events: AdminAuditEventView[]; historyTruncated: boolean }
export type AdminReadProjection = {
  availability: 'ready' | 'hold'; scopeRevision: string; policyVersion: 1; caller: AdminCallerView; scope: AdminScopeView;
  people: AdminPersonView[]; entities: AdminEntityView[]; proposals: AdminProposalView[];
  selectedProposal: AdminSelectedProposalView | null; truncated: { people: boolean; entities: boolean; proposals: boolean };
  governanceGrants: AdminGrantView[]; grantsTruncated: boolean
} | {
  availability: Exclude<AdminAvailability, 'ready' | 'hold'>; scopeRevision: null; policyVersion: 1; caller: null; scope: null;
  people: []; entities: []; proposals: []; selectedProposal: null;
  truncated: { people: false; entities: false; proposals: false }; governanceGrants: []; grantsTruncated: false
}
export type AdminReadExpectation = { organisationId: string; principalId: string; selectedProposalId?: string }

export const ADMIN_LIMITS = Object.freeze({ payloadBytes: 8192, list: 50, principals: 10, memberships: 9, history: 100 })
const MAX_REVISION = '9223372036854775807'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const GRANT_MAX_MICROSECONDS = 90n * 24n * 60n * 60n * 1_000_000n
type DataRecord = Record<string, unknown>

function attempt<T>(parse: () => T | null): T | null {
  try { return parse() } catch { return null }
}

function member<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && options.some((option) => option === value)
}

function record(value: unknown, keys: readonly string[]): DataRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null
  }
  return value as DataRecord
}

function uuid(value: unknown): string | null {
  if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return null
  const normalized = value.toLowerCase()
  return normalized === ZERO_UUID ? null : normalized
}

function revision(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_REVISION.length || !/^[1-9][0-9]*$/.test(value) || /[^0-9]/.test(value)) return null
  if (value.length === MAX_REVISION.length && value > MAX_REVISION) return null
  return value
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum * 2 + 8192) return null
  // Reject controls and unpaired surrogates, not valid supplementary characters.
  if (/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)) return null
  const normalized = value.trim()
  const length = Array.from(normalized).length
  return length >= 1 && length <= maximum ? normalized : null
}

function utcInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 27) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/.exec(value)
  if (!match || match[0] !== value) return null
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > days[month - 1]) return null
  return value
}

function instantMicroseconds(value: string): bigint {
  const milliseconds = Date.parse(`${value.slice(0, 19)}Z`)
  const fraction = value.includes('.') ? value.slice(20, -1).padEnd(6, '0') : '000000'
  return BigInt(milliseconds) * 1000n + BigInt(fraction)
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value)
}

function sameFlatData(input: unknown, parsed: object): boolean {
  const source = input as DataRecord
  return Object.entries(parsed).every(([key, value]) => source[key] === value)
}

export function parseAdminPayload(kind: unknown, value: unknown): ValidatedAdminPayload | null {
  return attempt(() => {
    if (!member(kind, ADMIN_KINDS)) return null
    switch (kind) {
      case 'ENTITY_DRAFT_CREATE': {
        const input = record(value, ['displayName', 'kind', 'jurisdictionCode', 'registrationReference'])
        if (!input || !member(input.kind, ADMIN_ENTITY_KINDS)) return null
        const displayName = text(input.displayName, 200)
        const registrationReference = input.registrationReference === null ? null : text(input.registrationReference, 100)
        if (!displayName || (input.registrationReference !== null && !registrationReference)) return null
        if (input.jurisdictionCode !== null && (typeof input.jurisdictionCode !== 'string' || input.jurisdictionCode.length !== 2 || !/^[A-Z]{2}$/.test(input.jurisdictionCode))) return null
        return { kind, payload: { displayName, kind: input.kind, jurisdictionCode: input.jurisdictionCode, registrationReference } }
      }
      case 'MEMBERSHIP_GRANT': {
        const input = record(value, ['principalId', 'role'])
        if (!input || !member(input.role, BX1_ROLES)) return null
        const principalId = uuid(input.principalId)
        return principalId ? { kind, payload: { principalId, role: input.role } } : null
      }
      case 'GOVERNANCE_GRANT': {
        const input = record(value, ['personId', 'validUntil'])
        if (!input) return null
        const personId = uuid(input.personId)
        const validUntil = utcInstant(input.validUntil)
        // Current time, maximum admission duration and beneficiary eligibility
        // are rechecked by SQL; this pure parser cannot certify them.
        return personId && validUntil ? { kind, payload: { personId, validUntil } } : null
      }
      case 'MEMBERSHIP_REVOKE': {
        const input = record(value, ['membershipId', 'reason'])
        if (!input || !member(input.reason, ['routine', 'security'] as const)) return null
        const membershipId = uuid(input.membershipId)
        return membershipId ? { kind, payload: { membershipId, reason: input.reason } } : null
      }
      case 'GOVERNANCE_REVOKE': {
        const input = record(value, ['grantId', 'reason'])
        if (!input || !member(input.reason, ['routine', 'security'] as const)) return null
        const grantId = uuid(input.grantId)
        return grantId ? { kind, payload: { grantId, reason: input.reason } } : null
      }
      case 'PERSON_SCOPE_REVOKE': {
        const input = record(value, ['personId', 'reason'])
        if (!input || !member(input.reason, ['routine', 'security'] as const)) return null
        const personId = uuid(input.personId)
        return personId ? { kind, payload: { personId, reason: input.reason } } : null
      }
    }
  })
}

// Scan the bounded raw flat object before JSON.parse discards duplicate keys.
// String tokens are decoded independently so escaped equivalent keys collide.
function parseFlatJson(raw: unknown): DataRecord | null {
  if (typeof raw !== 'string' || raw.length > ADMIN_LIMITS.payloadBytes || new TextEncoder().encode(raw).byteLength > ADMIN_LIMITS.payloadBytes) return null
  let position = 0
  const skipWhitespace = () => { while (position < raw.length && /[ \t\r\n]/.test(raw[position])) position += 1 }
  const stringToken = (): string | null => {
    if (raw[position] !== '"') return null
    const start = position++
    while (position < raw.length) {
      const character = raw[position++]
      if (character === '\\') { position += 1; continue }
      if (character === '"') return JSON.parse(raw.slice(start, position)) as string
    }
    return null
  }
  skipWhitespace()
  if (raw[position++] !== '{') return null
  skipWhitespace()
  const keys = new Set<string>()
  if (raw[position] !== '}') {
    while (position < raw.length) {
      const key = stringToken()
      if (key === null || keys.has(key) || keys.size >= 4) return null
      keys.add(key)
      skipWhitespace()
      if (raw[position++] !== ':') return null
      skipWhitespace()
      if (raw[position] === '"') { if (stringToken() === null) return null }
      else if (raw.slice(position, position + 4) === 'null') position += 4
      else return null
      skipWhitespace()
      if (raw[position] === '}') break
      if (raw[position++] !== ',') return null
      skipWhitespace()
    }
  }
  if (raw[position++] !== '}') return null
  skipWhitespace()
  return position === raw.length ? JSON.parse(raw) as DataRecord : null
}

export function parseAdminPayloadJson(kind: unknown, raw: unknown): ValidatedAdminPayload | null {
  return attempt(() => parseAdminPayload(kind, parseFlatJson(raw)))
}

export function parseAdminIntent(value: unknown): AdminIntent | null {
  return attempt(() => {
    if (value === null || typeof value !== 'object') return null
    const descriptor = Object.getOwnPropertyDescriptor(value, 'intent')
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    const intent: unknown = descriptor.value
    const common = ['intent', 'organisationId', 'requestKey']
    const keys = intent === 'propose' ? [...common, 'kind', 'payload', 'expectedScopeRevision']
      : intent === 'review' ? [...common, 'proposalId', 'expectedRevision', 'decision']
        : intent === 'apply' || intent === 'cancel' ? [...common, 'proposalId', 'expectedRevision'] : null
    const input = keys && record(value, keys)
    if (!input) return null
    const organisationId = uuid(input.organisationId)
    const requestKey = uuid(input.requestKey)
    if (!organisationId || !requestKey) return null
    if (intent === 'propose') {
      const parsed = parseAdminPayloadJson(input.kind, input.payload)
      const expectedScopeRevision = revision(input.expectedScopeRevision)
      return parsed && expectedScopeRevision ? { intent, organisationId, requestKey, kind: parsed.kind, payload: JSON.stringify(parsed.payload), expectedScopeRevision } : null
    }
    const proposalId = uuid(input.proposalId)
    const expectedRevision = revision(input.expectedRevision)
    if (!proposalId || !expectedRevision) return null
    if (intent === 'review') return member(input.decision, ['approve', 'reject'] as const)
      ? { intent, organisationId, requestKey, proposalId, expectedRevision, decision: input.decision } : null
    return intent === 'apply' || intent === 'cancel' ? { intent, organisationId, requestKey, proposalId, expectedRevision } : null
  })
}

export function parseAdminResult(value: unknown): AdminResult | null {
  return attempt(() => {
    const error = record(value, ['ok', 'error'])
    if (error) return error.ok === false && member(error.error, ADMIN_ERRORS) ? { ok: false, error: error.error } : null
    const input = record(value, ['ok', 'proposalId', 'state', 'revision', 'replayed', 'scopeState', 'scopeRevision'])
    if (!input || input.ok !== true || !member(input.state, ADMIN_STATES) || typeof input.replayed !== 'boolean' || !member(input.scopeState, ['READY', 'HOLD'] as const)) return null
    const proposalId = uuid(input.proposalId)
    const parsedRevision = revision(input.revision)
    const scopeRevision = revision(input.scopeRevision)
    return proposalId && parsedRevision && scopeRevision ? { ok: true, proposalId, state: input.state, revision: parsedRevision, replayed: input.replayed, scopeState: input.scopeState, scopeRevision } : null
  })
}

function array(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return false
  if (Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false
  }
  return true
}

function rows<T extends { id: string }>(value: unknown, maximum: number, parse: (row: unknown) => T | null): T[] | null {
  if (!array(value, maximum)) return null
  const output: T[] = []
  const ids = new Set<string>()
  for (const row of value) {
    const parsed = parse(row)
    if (!parsed || ids.has(parsed.id)) return null
    ids.add(parsed.id)
    output.push(parsed)
  }
  return output
}

function grantView(value: unknown): AdminGrantView | null {
  const input = record(value, ['id', 'personId', 'capability', 'status', 'validFrom', 'validUntil', 'revision'])
  if (!input || input.capability !== 'ADMINISTRATION_V1' || !member(input.status, ['ACTIVE', 'REVOKED'] as const)) return null
  const id = uuid(input.id), personId = uuid(input.personId), parsedRevision = revision(input.revision)
  const validFrom = utcInstant(input.validFrom), validUntil = utcInstant(input.validUntil)
  if (!id || !personId || !parsedRevision || !validFrom || !validUntil) return null
  const duration = instantMicroseconds(validUntil) - instantMicroseconds(validFrom)
  if (duration <= 0n || duration > GRANT_MAX_MICROSECONDS) return null
  return { id, personId, capability: 'ADMINISTRATION_V1', status: input.status, validFrom, validUntil, revision: parsedRevision }
}

function membershipView(value: unknown): AdminMembershipView | null {
  const input = record(value, ['id', 'principalId', 'personId', 'role', 'status'])
  if (!input || !member(input.role, BX1_ROLES) || !member(input.status, ['ACTIVE', 'SUSPENDED'] as const)) return null
  const id = uuid(input.id), principalId = uuid(input.principalId), personId = uuid(input.personId)
  return id && principalId && personId ? { id, principalId, personId, role: input.role, status: input.status } : null
}

function personView(value: unknown): AdminPersonView | null {
  const input = record(value, ['id', 'label', 'principals', 'principalsTruncated'])
  if (!input || typeof input.principalsTruncated !== 'boolean') return null
  const id = uuid(input.id), label = text(input.label, 200)
  if (!id || !label || label !== input.label) return null
  const principals = rows(input.principals, ADMIN_LIMITS.principals, (raw): AdminPrincipalView | null => {
    const principal = record(raw, ['id', 'memberships'])
    if (!principal) return null
    const principalId = uuid(principal.id)
    const memberships = rows(principal.memberships, ADMIN_LIMITS.memberships, membershipView)
    if (!principalId || !memberships || memberships.length === 0) return null
    if (memberships.some((membership) => membership.principalId !== principalId || membership.personId !== id)) return null
    if (new Set(memberships.map((membership) => membership.role)).size !== memberships.length) return null
    return { id: principalId, memberships }
  })
  return principals && principals.length > 0 ? { id, label, principals, principalsTruncated: input.principalsTruncated } : null
}

function entityView(value: unknown): AdminEntityView | null {
  const input = record(value, ['id', 'displayName', 'kind', 'jurisdictionCode', 'registrationReference', 'status', 'revision', 'relationship'])
  if (!input || input.status !== 'DRAFT' || input.revision !== '1' || input.relationship !== 'RECORDED_ONLY') return null
  const id = uuid(input.id)
  const parsed = parseAdminPayload('ENTITY_DRAFT_CREATE', { displayName: input.displayName, kind: input.kind, jurisdictionCode: input.jurisdictionCode, registrationReference: input.registrationReference })
  if (!id || parsed?.kind !== 'ENTITY_DRAFT_CREATE' || !sameFlatData(input, parsed.payload)) return null
  return { id, ...parsed.payload, status: 'DRAFT', revision: '1', relationship: 'RECORDED_ONLY' }
}

const PROPOSAL_KEYS = ['id', 'kind', 'state', 'revision', 'requesterPersonId', 'beneficiaryPersonId', 'reviewerPersonId', 'payload', 'payloadHash', 'expiresAt', 'expectedScopeRevision', 'expectedTrustRevision', 'policyVersion', 'allowedTransitions'] as const
function proposalView(value: unknown, hold: boolean): AdminProposalView | null {
  const input = record(value, PROPOSAL_KEYS)
  if (!input || !member(input.state, ADMIN_STATES) || input.policyVersion !== 1 || !sha256(input.payloadHash)) return null
  const id = uuid(input.id), parsedRevision = revision(input.revision), requesterPersonId = uuid(input.requesterPersonId)
  const beneficiaryPersonId = input.beneficiaryPersonId === null ? null : uuid(input.beneficiaryPersonId)
  const reviewerPersonId = input.reviewerPersonId === null ? null : uuid(input.reviewerPersonId)
  const expectedScopeRevision = revision(input.expectedScopeRevision), expectedTrustRevision = revision(input.expectedTrustRevision)
  const expiresAt = utcInstant(input.expiresAt), parsed = parseAdminPayload(input.kind, input.payload)
  if (!id || !parsedRevision || !requesterPersonId || !expectedScopeRevision || !expectedTrustRevision || !expiresAt || !parsed) return null
  if ((input.beneficiaryPersonId !== null && !beneficiaryPersonId) || (input.reviewerPersonId !== null && !reviewerPersonId)) return null
  if (!sameFlatData(input.payload, parsed.payload)) return null
  if (parsed.kind === 'ENTITY_DRAFT_CREATE' ? beneficiaryPersonId !== null : beneficiaryPersonId === null) return null
  if ((parsed.kind === 'GOVERNANCE_GRANT' || parsed.kind === 'PERSON_SCOPE_REVOKE') && parsed.payload.personId !== beneficiaryPersonId) return null
  if ((parsed.kind === 'GOVERNANCE_GRANT' || parsed.kind === 'MEMBERSHIP_GRANT') && beneficiaryPersonId === requesterPersonId) return null
  if (reviewerPersonId && (reviewerPersonId === requesterPersonId || reviewerPersonId === beneficiaryPersonId)) return null
  if (input.state === 'PENDING_REVIEW' && reviewerPersonId !== null) return null
  if (['APPROVED', 'APPLIED', 'REJECTED'].includes(input.state) && reviewerPersonId === null) return null
  if (!array(input.allowedTransitions, ADMIN_TRANSITIONS.length)) return null
  const allowedTransitions: AdminTransition[] = []
  const stateChoices: readonly string[] = hold ? [] : input.state === 'PENDING_REVIEW' ? ['approve', 'reject', 'cancel'] : input.state === 'APPROVED' ? ['apply', 'cancel'] : []
  for (const action of input.allowedTransitions) {
    if (!member(action, ADMIN_TRANSITIONS) || !stateChoices.includes(action) || allowedTransitions.includes(action)) return null
    allowedTransitions.push(action)
  }
  return { ...parsed, id, state: input.state, revision: parsedRevision, requesterPersonId, beneficiaryPersonId, reviewerPersonId, payloadHash: input.payloadHash, expiresAt, expectedScopeRevision, expectedTrustRevision, policyVersion: 1, allowedTransitions }
}

function auditEventView(value: unknown, payloadHash: string): AdminAuditEventView | null {
  const input = record(value, ['id', 'sequence', 'type', 'actorPersonId', 'beforeState', 'afterState', 'beforeRevision', 'afterRevision', 'payloadHash', 'reason', 'createdAt'])
  if (!input || !member(input.type, ADMIN_EVENT_TYPES) || input.type === 'BOOTSTRAP' || !member(input.afterState, ADMIN_STATES)) return null
  if (input.beforeState !== null && !member(input.beforeState, ADMIN_STATES)) return null
  if (input.reason !== null && !member(input.reason, ADMIN_SAFE_REASONS)) return null
  if (input.payloadHash !== payloadHash) return null
  const id = uuid(input.id), sequence = revision(input.sequence), actorPersonId = uuid(input.actorPersonId)
  const beforeRevision = input.beforeRevision === null ? null : revision(input.beforeRevision)
  const afterRevision = revision(input.afterRevision), createdAt = utcInstant(input.createdAt)
  if (!id || !sequence || !actorPersonId || !afterRevision || !createdAt) return null
  if ((input.beforeRevision !== null && !beforeRevision) || (input.beforeState === null) !== (beforeRevision === null)) return null
  return { id, sequence, type: input.type, actorPersonId, beforeState: input.beforeState, afterState: input.afterState, beforeRevision, afterRevision, payloadHash, reason: input.reason, createdAt }
}

function selectedProposalView(value: unknown, hold: boolean): AdminSelectedProposalView | null {
  const input = record(value, [...PROPOSAL_KEYS, 'events', 'historyTruncated'])
  if (!input || typeof input.historyTruncated !== 'boolean') return null
  const core: DataRecord = {}
  for (const key of PROPOSAL_KEYS) core[key] = input[key]
  const proposal = proposalView(core, hold)
  if (!proposal) return null
  const events = rows(input.events, ADMIN_LIMITS.history, (event) => auditEventView(event, proposal.payloadHash))
  if (!events || events.some((event, index) => index > 0 && BigInt(events[index - 1].sequence) <= BigInt(event.sequence))) return null
  return { ...proposal, events, historyTruncated: input.historyTruncated }
}

export function parseAdminReadProjection(value: unknown, expected: AdminReadExpectation): AdminReadProjection | null {
  return attempt(() => {
    const expectedOrganisationId = uuid(expected.organisationId), expectedPrincipalId = uuid(expected.principalId)
    const expectedProposalId = expected.selectedProposalId === undefined ? null : uuid(expected.selectedProposalId)
    if (!expectedOrganisationId || !expectedPrincipalId || (expected.selectedProposalId !== undefined && !expectedProposalId)) return null
    const input = record(value, ['availability', 'scopeRevision', 'policyVersion', 'caller', 'scope', 'people', 'entities', 'proposals', 'selectedProposal', 'truncated', 'governanceGrants', 'grantsTruncated'])
    if (!input || !member(input.availability, ADMIN_AVAILABILITIES) || input.policyVersion !== 1 || typeof input.grantsTruncated !== 'boolean') return null
    const truncation = record(input.truncated, ['people', 'entities', 'proposals'])
    if (!truncation || typeof truncation.people !== 'boolean' || typeof truncation.entities !== 'boolean' || typeof truncation.proposals !== 'boolean') return null
    const truncated = { people: truncation.people, entities: truncation.entities, proposals: truncation.proposals }
    if (input.availability !== 'ready' && input.availability !== 'hold') {
      if (input.caller !== null || input.scope !== null || input.scopeRevision !== null || input.selectedProposal !== null || input.grantsTruncated || Object.values(truncated).some(Boolean)) return null
      if (![input.people, input.entities, input.proposals, input.governanceGrants].every((list) => array(list, 0))) return null
      return { availability: input.availability, scopeRevision: null, policyVersion: 1, caller: null, scope: null, people: [], entities: [], proposals: [], selectedProposal: null, truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false }
    }
    const rawCaller = record(input.caller, ['principalId', 'personId', 'grant'])
    const rawScope = record(input.scope, ['organisationId', 'state', 'revision', 'policyVersion', 'trustRevision'])
    if (!rawCaller || !rawScope || rawScope.policyVersion !== 1) return null
    const principalId = uuid(rawCaller.principalId), personId = uuid(rawCaller.personId), grant = grantView(rawCaller.grant)
    const organisationId = uuid(rawScope.organisationId), scopeRevision = revision(input.scopeRevision)
    const scopeRowRevision = revision(rawScope.revision), trustRevision = revision(rawScope.trustRevision)
    const hold = input.availability === 'hold'
    const state = hold ? 'HOLD' : 'READY'
    if (!principalId || !personId || !grant || principalId !== expectedPrincipalId || grant.personId !== personId || grant.status !== 'ACTIVE') return null
    if (!organisationId || organisationId !== expectedOrganisationId || !scopeRevision || scopeRevision !== scopeRowRevision || !trustRevision || rawScope.state !== state) return null
    const people = rows(input.people, ADMIN_LIMITS.list, personView)
    const entities = rows(input.entities, ADMIN_LIMITS.list, entityView)
    const proposals = rows(input.proposals, ADMIN_LIMITS.list, (proposal) => proposalView(proposal, hold))
    const governanceGrants = rows(input.governanceGrants, ADMIN_LIMITS.list, grantView)
    if (!people || !entities || !proposals || !governanceGrants) return null
    const principals = new Set<string>(), memberships = new Set<string>(), activeGrants = new Set<string>()
    for (const person of people) for (const principal of person.principals) {
      if (principals.has(principal.id) || (principal.id === principalId && person.id !== personId)) return null
      principals.add(principal.id)
      for (const membership of principal.memberships) {
        if (memberships.has(membership.id)) return null
        memberships.add(membership.id)
      }
    }
    for (const row of governanceGrants) {
      if (row.status === 'ACTIVE') {
        if (activeGrants.has(row.personId)) return null
        activeGrants.add(row.personId)
      }
      if (row.id === grant.id && JSON.stringify(row) !== JSON.stringify(grant)) return null
    }
    const selectedProposal = input.selectedProposal === null ? null : selectedProposalView(input.selectedProposal, hold)
    if (input.selectedProposal !== null && (!selectedProposal || selectedProposal.id !== expectedProposalId)) return null
    if (selectedProposal) {
      const listed = proposals.find((proposal) => proposal.id === selectedProposal.id)
      if (listed && PROPOSAL_KEYS.some((key) => JSON.stringify(listed[key]) !== JSON.stringify(selectedProposal[key]))) return null
    }
    return { availability: input.availability, scopeRevision, policyVersion: 1, caller: { principalId, personId, grant }, scope: { organisationId, state, revision: scopeRevision, policyVersion: 1, trustRevision }, people, entities, proposals, selectedProposal, truncated, governanceGrants, grantsTruncated: input.grantsTruncated }
  })
}
