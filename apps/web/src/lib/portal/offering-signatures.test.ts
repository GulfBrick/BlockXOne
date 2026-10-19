import { describe, expect, it } from 'vitest'
import { offeringSignatureCommandSchema, offeringSignatureRequestSchema, offeringSignatureSnapshotSchema, offeringSignatureResponseSchema,
  offeringSignatureScopeMatches, offeringSigningUrlSchema, readOfferingSignatureRetry, saveOfferingSignatureRetry, clearOfferingSignatureRetry,
  type OfferingSignatureCommand, type OfferingSignatureSnapshot } from './offering-signatures'

const actor = '11111111-1111-4111-8111-111111111111', product = '22222222-2222-4222-8222-222222222222', revision = '33333333-3333-4333-8333-333333333333'
const authorisation = '44444444-4444-4444-8444-444444444444', operation = '55555555-5555-4555-8555-555555555555'
const context = { mode: 'ROLE' as const, organisationId: product, role: 'IssuerFundManager' as const }
const scope = { actorId: actor, productId: product, revisionId: revision, context }
const target = { product_id: product, offering_revision_id: revision, expected_revision: 3 }
const request: OfferingSignatureCommand = { command: 'REQUEST_SIGNING_VIEW', key: actor, payload: { ...target, operation_id: operation } }
const snapshot: OfferingSignatureSnapshot = { version: 1, actor_id: actor, session_id: actor, context, environment: 'TESTNET', product_id: product, revision_id: revision,
  expected_revision: 3, purpose: 'ISSUER_PACKAGE_EXECUTION', admitted: true, blocker: null, allowed_commands: ['REQUEST_SIGNING_VIEW'],
  authorisations: [{ id: authorisation, signer_id: actor, signer_person_id: actor, appointment_id: authorisation, state: 'APPROVED', valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z', source_reference: 'Synthetic purpose evidence reference' }],
  operations: [{ id: operation, authorisation_id: authorisation, state: 'SENT', current: false, noncurrent_reason: null, envelope_id: operation, next_check_at: null, artifacts: [] }] }

describe('strict offering signature actor contracts', () => {
  it('accepts scoped references, not browser-provided provider or signer authority', () => {
    expect(offeringSignatureCommandSchema.parse(request)).toEqual(request)
    for (const extra of [{ signer_email: 'actor@example.invalid' }, { envelope_id: operation }, { completed: true }, { sha256: 'a'.repeat(64) }, { return_url: 'https://example.invalid' }, { bytes: 'PDF' }]) {
      expect(offeringSignatureCommandSchema.safeParse({ ...request, payload: { ...request.payload, ...extra } }).success).toBe(false)
    }
    expect(offeringSignatureRequestSchema.safeParse({ expected_actor: actor, operating_context: context, request }).success).toBe(true)
    expect(offeringSignatureCommandSchema.safeParse({ ...request, command: 'MARK_COMPLETED' }).success).toBe(false)
    expect(offeringSignatureCommandSchema.safeParse({ ...request, payload: { ...request.payload, expected_revision: '3' } }).success).toBe(false)
  })
  it('strictly separates purpose request/review/revoke from execution and preserves exact replay input', () => {
    const value = { command: 'REQUEST_PURPOSE', key: actor, payload: { ...target, appointment_id: authorisation,
      valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z', source_reference: '  Existing synthetic source  ', source_sha256: 'a'.repeat(64) } }
    expect(offeringSignatureCommandSchema.parse(value)).toEqual(value)
    expect(offeringSignatureCommandSchema.safeParse({ ...value, payload: { ...value.payload, valid_until: value.payload.valid_from } }).success).toBe(false)
    expect(offeringSignatureCommandSchema.safeParse({ command: 'REVIEW_PURPOSE', key: actor, payload: { ...target, authorisation_id: authorisation, decision: 'APPROVED', reason: 'Independent synthetic evidence reviewed.' } }).success).toBe(true)
    expect(offeringSignatureCommandSchema.safeParse({ command: 'PREPARE_EXECUTION', key: actor, payload: { ...target, authorisation_id: authorisation, decision: 'APPROVED' } }).success).toBe(false)
  })
  it('fails closed on unknown versions, contradictory state, duplicate records and leaked private fields', () => {
    expect(offeringSignatureSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    const invalid = [
      { ...snapshot, version: 2 }, { ...snapshot, environment: 'MAINNET' }, { ...snapshot, admitted: false },
      { ...snapshot, allowed_commands: ['REQUEST_SIGNING_VIEW', 'REQUEST_SIGNING_VIEW'] },
      { ...snapshot, authorisations: [...snapshot.authorisations, ...snapshot.authorisations] },
      { ...snapshot, operations: [{ ...snapshot.operations[0], authorisation_id: actor }] },
      { ...snapshot, operations: [{ ...snapshot.operations[0], current: true, noncurrent_reason: 'Revoked' }] },
      { ...snapshot, operations: [{ ...snapshot.operations[0], storage_path: 'private/path' }] },
      { ...snapshot, signing_url: 'https://demo.docusign.net/Signing/test' },
    ]
    for (const value of invalid) expect(offeringSignatureSnapshotSchema.safeParse(value).success).toBe(false)
    expect(offeringSignatureScopeMatches(snapshot, scope, 3)).toBe(true)
    expect(offeringSignatureScopeMatches(snapshot, { ...scope, actorId: product }, 3)).toBe(false)
    expect(offeringSignatureScopeMatches(snapshot, { ...scope, context: { ...context, role: 'ComplianceOfficer' } }, 3)).toBe(false)
    expect(offeringSignatureScopeMatches(snapshot, scope, 4)).toBe(false)
  })
  it('accepts only pinned ephemeral sandbox views and explicit command acknowledgements', () => {
    const signing_url = 'https://demo.docusign.net/Signing/start?token=synthetic'
    expect(offeringSignatureResponseSchema.safeParse({ snapshot, command: request.command, key: request.key, view_status: 'AVAILABLE', signing_url }).success).toBe(true)
    expect(offeringSignatureResponseSchema.safeParse({ snapshot, signing_url }).success).toBe(false)
    for (const url of ['https://demo.docusign.net.evil.invalid/Signing/start', 'https://account.docusign.com/Signing/start', 'http://demo.docusign.net/Signing/start', 'https://demo.docusign.net:444/Signing/start', 'https://u:p@demo.docusign.net/Signing/start', 'https://demo.docusign.net/Signing/start#token', 'https://demo.docusign.net/other']) expect(offeringSigningUrlSchema.safeParse(url).success).toBe(false)
  })
  it('journals the exact request across reload and refuses replacement or corrupted identity without storing a view', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    saveOfferingSignatureRetry(storage, scope, request)
    expect(readOfferingSignatureRetry(storage, scope)).toEqual(request)
    expect(readOfferingSignatureRetry(storage, { ...scope, actorId: product })).toBeNull()
    expect(() => saveOfferingSignatureRetry(storage, scope, { ...request, key: operation })).toThrow()
    expect(() => clearOfferingSignatureRetry(storage, scope, { ...request, key: operation })).toThrow()
    expect([...values.values()].join('')).not.toContain('signing_url')
    const journalKey = [...values.keys()][0]
    values.set(journalKey, JSON.stringify({ ...JSON.parse(values.get(journalKey)!), actor_id: product }))
    expect(() => readOfferingSignatureRetry(storage, scope)).toThrow()
    values.clear(); saveOfferingSignatureRetry(storage, scope, request); clearOfferingSignatureRetry(storage, scope, request)
    expect(values.size).toBe(0)
  })
})
