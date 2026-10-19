import { describe, expect, it } from 'vitest'
import { applicationDraftAnswersSchema, applicationDraftContentMatches, applicationDraftEnvelopeSchema, applicationDraftRequestSchema } from './application-drafts'
import { entryActorId, entryApplicationId } from './entry-test-fixtures'

const answers = {
  full_name: ' A ', country: '', investor_type: 'ENTITY' as const, company_name: '', registration_reference: '', beneficial_owners: '',
  source_of_funds: 'unfinished ', experience: '', business_activities: '', representative_position: '', authority_basis: '',
  documents: [], ownership_change_reason: '',
  ownership_control: [{ id: '44444444-4444-4444-8444-444444444444', party_type: 'PERSON' as const, legal_name: '', registration_reference: '', country: '', relationship: 'DIRECT_OWNER' as const, ownership_basis_points: 0, control_basis: '', effective_on: '2026-', change_reason: '', evidence_document_id: '' }],
}
const request = { key: '55555555-5555-4555-8555-555555555555', application_id: entryApplicationId, expected_application_revision: 1, expected_draft_revision: 0, answers, step: 'ownership' as const }
const { key, ...payload } = request
const savedAt = '2026-10-12T12:00:00Z'
const envelope = { version: 1, environment: 'TESTNET', actor_id: entryActorId, application: { id: entryApplicationId, persona: 'INVESTOR', status: 'DRAFT', context_kind: 'PERSONAL', context_organisation_id: null, origin: 'SIGNUP', admission_purpose: 'INVESTOR_ADMISSION' }, base_application_revision: 1, draft_revision: 1, draft: { answers, step: 'ownership', saved_at: savedAt }, receipt: { key, payload, draft_revision: 1, saved_at: savedAt } }

describe('lossless server draft contracts', () => {
  it('round-trips empty, incomplete and whitespace answers without invented values', () => {
    expect(applicationDraftAnswersSchema.parse(answers)).toEqual(answers)
    expect(applicationDraftRequestSchema.parse(request)).toEqual(request)
  })
  it('does not rewrite complete private evidence reference strings', () => {
    const reference = { id: key, kind: 'IDENTITY', title: '  Existing private receipt title  ', storage_path: `${entryActorId}/existing.pdf `, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }
    const value = { ...answers, documents: [reference] }
    expect(applicationDraftAnswersSchema.parse(value)).toEqual(value)
  })
  it('never accepts persisted acknowledgement, identity claims or unbounded text', () => {
    for (const value of [{ ...answers, test_data_acknowledged: true }, { ...answers, user_id: entryActorId }, { ...answers, source_of_funds: 'x'.repeat(2001) }]) expect(applicationDraftAnswersSchema.safeParse(value).success).toBe(false)
    expect(applicationDraftRequestSchema.safeParse({ ...request, context_kind: 'PERSONAL' }).success).toBe(false)
  })
  it('preserves the existing maximum-length ownership control basis', () => {
    const maximum = { ...answers, ownership_control: [{ ...answers.ownership_control[0], control_basis: 'x'.repeat(1000) }] }
    expect(applicationDraftAnswersSchema.parse(maximum)).toEqual(maximum)
    expect(applicationDraftAnswersSchema.safeParse({ ...answers, ownership_control: [{ ...maximum.ownership_control[0], control_basis: 'x'.repeat(1001) }] }).success).toBe(false)
    expect(applicationDraftAnswersSchema.safeParse({ ...answers, ownership_control: [{ ...maximum.ownership_control[0], control_basis: '😀'.repeat(500) }] }).success).toBe(true)
    expect(applicationDraftAnswersSchema.safeParse({ ...answers, ownership_control: [{ ...maximum.ownership_control[0], control_basis: '😀'.repeat(501) }] }).success).toBe(false)
  })
  it('accepts empty current draft revision zero and a fully captured receipt', () => {
    expect(applicationDraftEnvelopeSchema.safeParse({ ...envelope, draft_revision: 0, draft: null, receipt: null }).success).toBe(true)
    expect(applicationDraftEnvelopeSchema.safeParse(envelope).success).toBe(true)
  })
  it('rejects a receipt for other facts, key-independent revision, time, application or base', () => {
    for (const changed of [
      { ...envelope, draft_revision: 0 },
      { ...envelope, receipt: { ...envelope.receipt, draft_revision: 2 } },
      { ...envelope, receipt: { ...envelope.receipt, saved_at: '2026-10-12T12:01:00Z' } },
      { ...envelope, receipt: { ...envelope.receipt, payload: { ...payload, application_id: key } } },
      { ...envelope, receipt: { ...envelope.receipt, payload: { ...payload, expected_application_revision: 2 } } },
      { ...envelope, receipt: { ...envelope.receipt, payload: { ...payload, answers: { ...answers, full_name: 'Changed' } } } },
    ]) expect(applicationDraftEnvelopeSchema.safeParse(changed).success).toBe(false)
  })
  it('ignores JSONB key order but preserves whitespace, ownership and array order differences', () => {
    expect(applicationDraftContentMatches(answers, Object.fromEntries(Object.entries(answers).reverse()))).toBe(true)
    expect(applicationDraftContentMatches(answers, { ...answers, full_name: answers.full_name.trim() })).toBe(false)
    expect(applicationDraftContentMatches(answers, { ...answers, ownership_control: [] })).toBe(false)
    expect(applicationDraftContentMatches(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})
