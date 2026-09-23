import { describe, expect, it } from 'vitest'
import { entryApplicationHref, entryCommandSchema, entrySnapshotSchema, selectEntryApplication } from './entry-contracts'
import { entryApplication, entryApplicationId, entryFixture, entryOrganisationId } from './entry-test-fixtures'

const key = '44444444-4444-4444-8444-444444444444'
describe('entry application identities and capacities', () => {
  it('preserves the exact server-recorded initial persona, never an investor fallback', () => {
    expect(selectEntryApplication(entryFixture([]), undefined)).toBeNull()
    expect(selectEntryApplication(entryFixture([entryApplication({ persona: 'WEALTH_MANAGER' })]), undefined)?.persona).toBe('WEALTH_MANAGER')
  })
  it('requires an exact selection when one person has multiple capacities', () => {
    const second = entryApplication({ id: key, persona: 'WEALTH_MANAGER' })
    const snapshot = entryFixture([entryApplication(), second])
    expect(selectEntryApplication(snapshot, undefined)).toBeNull()
    expect(selectEntryApplication(snapshot, key)).toEqual(second)
    expect(selectEntryApplication(snapshot, [key])).toBeNull()
    expect(selectEntryApplication(snapshot, entryOrganisationId)).toBeNull()
    expect(entryApplicationHref(key)).toContain(`application=${key}`)
  })
  it('preserves null historical creation times and accepts unassigned drafts without fabricated evidence', () => {
    const snapshot = entryFixture([entryApplication({ origin: 'LEGACY', created_at: null })])
    expect(entrySnapshotSchema.parse(snapshot).applications[0].details).toEqual({})
  })
  it('accepts only application preferences and an existing context selector when starting', () => {
    expect(entryCommandSchema.safeParse({ command: 'start_application', key, payload: { persona: 'WEALTH_MANAGER', context_key: entryOrganisationId } }).success).toBe(true)
    for (const payload of [{ persona: 'SuperAdmin' }, { persona: 'INVESTOR', role: 'SuperAdmin' }, { persona: 'INVESTOR', user_id: key }, { persona: 'INVESTOR', organisation_id: key }]) expect(entryCommandSchema.safeParse({ command: 'start_application', key, payload }).success).toBe(false)
  })
  it('requires exact application and revision for submission, never persona-only replacement', () => {
    expect(entryCommandSchema.safeParse({ command: 'submit_application', key, payload: { persona: 'INVESTOR', expected_revision: 1, details: {} } }).success).toBe(false)
    expect(entryCommandSchema.safeParse({ command: 'submit_application', key, payload: { application_id: entryApplicationId, expected_revision: 0, details: {} } }).success).toBe(false)
  })
  it('binds a synthetic mandate request to the application and never accepts a client-selected role', () => {
    const payload = { application_id: entryApplicationId, expected_revision: 0, evidence_reference: 'SYNTHETIC-APPOINTMENT-001 for test review', requested_until: '2026-10-01T12:00:00Z' }
    expect(entryCommandSchema.safeParse({ command: 'request_representative_mandate', key, payload }).success).toBe(true)
    for (const change of [{ application_id: undefined }, { expected_revision: -1 }, { evidence_reference: 'too short' }, { requested_until: 'not a date' }, { role: 'SuperAdmin' }]) {
      expect(entryCommandSchema.safeParse({ command: 'request_representative_mandate', key, payload: { ...payload, ...change } }).success).toBe(false)
    }
  })
  it('rejects manufactured staff roles and malformed environment admission', () => {
    expect(entrySnapshotSchema.safeParse({ ...entryFixture(), contexts: [{ context_key: key, organisation_id: key, name: 'Example', roles: ['WealthManager'] }] }).success).toBe(false)
    expect(entrySnapshotSchema.safeParse({ ...entryFixture(), admission: { manual_test_review: 'true' } }).success).toBe(false)
  })
  it('requires explicit purpose and privacy-safe review status in saved entry records', () => {
    expect(entrySnapshotSchema.parse(entryFixture([entryApplication({ persona: 'WEALTH_MANAGER', review_route: 'REVIEWER_UNAVAILABLE' })])).applications[0].admission_purpose).toBe('CUSTOMER_ORGANISATION_ADMISSION')
    for (const change of [{ admission_purpose: 'AUTO_APPROVED_MANAGER' }, { review_route: 'provider_verified' }]) expect(entrySnapshotSchema.safeParse(entryFixture([entryApplication(change as Partial<ReturnType<typeof entryApplication>>)])).success).toBe(false)
    const { review_route: _route, ...missing } = entryApplication()
    expect(entrySnapshotSchema.safeParse({ ...entryFixture(), applications: [missing] }).success).toBe(false)
  })
})
