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
  it('rejects manufactured staff roles and malformed environment admission', () => {
    expect(entrySnapshotSchema.safeParse({ ...entryFixture(), contexts: [{ context_key: key, organisation_id: key, name: 'Example', roles: ['WealthManager'] }] }).success).toBe(false)
    expect(entrySnapshotSchema.safeParse({ ...entryFixture(), admission: { manual_test_review: 'true' } }).success).toBe(false)
  })
})
