import type { EntryApplication, EntrySnapshot } from './entry-contracts'
export const entryActorId = '11111111-1111-4111-8111-111111111111'
export const entryApplicationId = '22222222-2222-4222-8222-222222222222'
export const entryOrganisationId = '33333333-3333-4333-8333-333333333333'
export function entryApplication(overrides: Partial<EntryApplication> = {}): EntryApplication {
  return { id: entryApplicationId, user_id: entryActorId, persona: 'INVESTOR', status: 'DRAFT', revision: 1, details: {}, submitted_at: null, reviewed_at: null, reviewer_id: null, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'UNASSIGNED', approved_until: null, context_kind: 'PERSONAL', context_organisation_id: null, origin: 'SIGNUP', created_at: '2026-09-21T10:00:00Z', admission_purpose: overrides.persona === 'WEALTH_MANAGER' ? 'CUSTOMER_ORGANISATION_ADMISSION' : 'INVESTOR_ADMISSION', review_route: 'NOT_ADMITTED', ...overrides }
}
export function entryFixture(applications: EntryApplication[] = [entryApplication()]): EntrySnapshot {
  return { entry_version: 1, actor: { id: entryActorId, email: 'synthetic@example.invalid' }, applications, contexts: [], admission: { manual_test_review: false } }
}
