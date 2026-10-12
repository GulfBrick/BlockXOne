import { z } from 'zod'
import { applicationDetailsSchema, evidenceSchema, ownershipControlRelationshipSchema, type ApplicationDetails, type LegacyApplicationDetails, type OwnershipControlRelationship, type Persona, type WealthManagerApplicationDetailsV2 } from './contracts'
import type { EntryApplication, EntrySnapshot } from './entry-contracts'

export type OnboardingAnswers = Omit<LegacyApplicationDetails, 'details_version' | 'business_activities' | 'representative_position' | 'authority_basis'> & Pick<WealthManagerApplicationDetailsV2, 'business_activities' | 'representative_position' | 'authority_basis'> & {
  ownership_control: OwnershipControlRelationship[]; ownership_change_reason: string;
}
export type OnboardingStepId = 'identity' | 'organisation' | 'purpose' | 'evidence' | 'ownership' | 'review'
export type OnboardingStep = { id: OnboardingStepId; title: string }
export type OnboardingRemainingItem = { key: string; step: OnboardingStepId; message: string }

export function onboardingSteps(persona: Persona, investorType: LegacyApplicationDetails['investor_type']): OnboardingStep[] {
  const organisation = persona === 'WEALTH_MANAGER' || investorType === 'ENTITY'
  return [
    { id: 'identity', title: persona === 'WEALTH_MANAGER' ? 'Your details' : 'Investor details' },
    ...(organisation ? [{ id: 'organisation' as const, title: 'Organisation details' }] : []),
    { id: 'purpose', title: persona === 'WEALTH_MANAGER' ? 'Services and authority' : 'Funds and objectives' },
    { id: 'evidence', title: 'Supporting evidence' },
    ...(organisation ? [{ id: 'ownership' as const, title: 'Ownership and control' }] : []),
    { id: 'review', title: 'Check and submit' },
  ]
}

/** Client feedback only; the existing command schema and server retain authority. */
export function onboardingRemainingItems(persona: Persona, answers: OnboardingAnswers, acknowledged: boolean, pendingCount = 0): OnboardingRemainingItem[] {
  const items: OnboardingRemainingItem[] = []
  const add = (key: string, step: OnboardingStepId, message: string) => items.push({ key, step, message })
  const length = (key: keyof OnboardingAnswers, step: OnboardingStepId, label: string, min: number, max: number) => {
    const value = answers[key]
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) add(key, step, `${label}: enter ${min}-${max} characters.`)
  }
  length('full_name', 'identity', persona === 'WEALTH_MANAGER' ? 'Representative full name' : 'Full name', 2, 120)
  if (!/^[A-Z]{2}$/.test(answers.country)) add('country', 'identity', 'Country of residence: enter a two-letter country code, for example ZA.')
  const organisation = persona === 'WEALTH_MANAGER' || answers.investor_type === 'ENTITY'
  if (persona === 'INVESTOR' && !['INDIVIDUAL', 'ENTITY'].includes(answers.investor_type)) add('investor_type', 'identity', 'Choose an investor classification.')
  if (organisation) {
    length('company_name', 'organisation', persona === 'WEALTH_MANAGER' ? 'Customer organisation legal name' : 'Investing entity name', 3, 160)
    length('registration_reference', 'organisation', 'Registration reference', 3, 100)
    length('beneficial_owners', 'organisation', 'Ownership context', 20, 2000)
  }
  if (persona === 'WEALTH_MANAGER') {
    length('business_activities', 'purpose', 'Business activities and requested services', 20, 2000)
    length('representative_position', 'purpose', 'Your position in the organisation', 2, 160)
    length('authority_basis', 'purpose', 'Basis of your representative authority', 20, 2000)
  } else {
    length('source_of_funds', 'purpose', 'Source of funds', 20, 2000)
    length('experience', 'purpose', 'Investment experience and objectives', 10, 2000)
  }
  const requiredEvidence = organisation
    ? [{ kind: 'IDENTITY', label: 'Representative identity evidence' }, { kind: 'COMPANY', label: 'Organisation registration evidence' }, { kind: 'BENEFICIAL_OWNERS', label: 'Beneficial ownership evidence' }]
    : [{ kind: 'IDENTITY', label: 'Identity evidence' }]
  for (const item of requiredEvidence) if (!answers.documents.some(document => document.kind === item.kind && evidenceSchema.safeParse(document).success)) add(`evidence.${item.kind}`, 'evidence', `${item.label}: upload and select this evidence type.`)
  if (answers.documents.length > 8 || answers.documents.some(document => !evidenceSchema.safeParse(document).success)) add('documents', 'evidence', 'Selected evidence: use no more than eight files with confirmed valid receipts.')
  if (pendingCount > 0) add('pending_documents', 'evidence', `${pendingCount} uploaded file${pendingCount === 1 ? '' : 's'} still await${pendingCount === 1 ? 's' : ''} a clean receipt or exclusion. Check the private scan queue.`)
  if (organisation) {
    if (answers.ownership_control.length === 0) add('ownership_control', 'ownership', 'Add at least one person or legal entity to the ownership and control disclosure.')
    if (answers.ownership_control.length > 20) add('ownership_control', 'ownership', 'Ownership and control disclosure: use no more than 20 relationships.')
    const seen = new Set<string>()
    let directOwnership = 0
    answers.ownership_control.forEach((relationship, index) => {
      const parsed = ownershipControlRelationshipSchema.safeParse(relationship)
      if (!parsed.success) for (const issue of parsed.error.issues) add(`ownership_control.${index}.${issue.path.join('.')}`, 'ownership', `Relationship ${index + 1}: ${ownershipFieldLabel(issue.path[0])} needs a valid answer${typeof issue.message === 'string' && issue.code === 'custom' ? ` (${issue.message})` : ''}.`)
      if (seen.has(relationship.id)) add(`ownership_control.${index}.id`, 'ownership', `Relationship ${index + 1}: each relationship must have a unique reference; remove the duplicate record.`)
      seen.add(relationship.id)
      if (relationship.relationship === 'DIRECT_OWNER') directOwnership += relationship.ownership_basis_points
      if (!answers.documents.some(document => document.id === relationship.evidence_document_id && document.kind === 'BENEFICIAL_OWNERS' && evidenceSchema.safeParse(document).success)) add(`ownership_control.${index}.evidence_document_id`, 'ownership', `Relationship ${index + 1}: link a selected beneficial-ownership evidence file.`)
    })
    if (directOwnership > 10_000) add('ownership_control', 'ownership', 'Direct ownership exceeds 100%. Correct the disclosed percentages.')
    length('ownership_change_reason', 'ownership', 'Ownership declaration or changes', 20, 500)
  }
  if (!acknowledged) add('acknowledged', 'review', 'Confirm that this application and all evidence are fictional test data.')
  return items.filter((item, index, all) => all.findIndex(other => other.key === item.key) === index)
}

function ownershipFieldLabel(field: string | number | undefined) {
  return ({ legal_name: 'legal name', country: 'country', registration_reference: 'registration reference', ownership_basis_points: 'economic ownership percentage', effective_on: 'effective date', evidence_document_id: 'linked ownership evidence', control_basis: 'basis of ownership or control', change_reason: 'reason for this relationship record' } as Record<string, string>)[String(field)] ?? 'relationship details'
}

export function onboardingHasUnsavedAnswers(saved: OnboardingAnswers, current: OnboardingAnswers, acknowledged: boolean, uploadTitle: string, hasFile: boolean, pendingCount: number): boolean {
  return JSON.stringify(saved) !== JSON.stringify(current) || acknowledged || Boolean(uploadTitle.trim()) || hasFile || pendingCount > 0
}

/** Compare schema-normalized values structurally, not raw JSON property order. */
function sameNormalizedValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameNormalizedValue(value, right[index]))
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>, rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return keys.length === Object.keys(rightRecord).length && keys.every(key => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameNormalizedValue(leftRecord[key], rightRecord[key]))
}

/** The returned case must preserve the original scope and every normalized fact/evidence sent. */
export function onboardingSubmissionConfirmed(snapshot: EntrySnapshot, application: EntryApplication, actorId: string, submittedDetails: ApplicationDetails): boolean {
  const saved = snapshot.applications.find(item => item.id === application.id)
  if (snapshot.actor.id !== actorId || application.user_id !== actorId || !saved || saved.user_id !== actorId || saved.persona !== application.persona
    || saved.status !== 'SUBMITTED' || saved.revision <= application.revision || !z.string().datetime({ offset: true }).safeParse(saved.submitted_at).success
    || saved.context_kind !== application.context_kind || saved.context_organisation_id !== application.context_organisation_id
    || saved.origin !== application.origin || saved.admission_purpose !== application.admission_purpose) return false
  if (application.submitted_at && (!z.string().datetime({ offset: true }).safeParse(application.submitted_at).success || Date.parse(saved.submitted_at!) <= Date.parse(application.submitted_at))) return false
  const expected = applicationDetailsSchema.safeParse(submittedDetails)
  const returned = applicationDetailsSchema.safeParse(saved.details)
  return expected.success && returned.success && sameNormalizedValue(expected.data, returned.data)
}

export const onboardingDiscardMessage = 'Leave this application? Your unsubmitted answers and evidence selections will be discarded. There is no automatic draft save.'

export function onboardingLinkDiscardsAnswers(href: string, currentHref: string): boolean {
  const current = new URL(currentHref)
  const next = new URL(href, current)
  // Same-page anchors do not discard the mounted form; query/application changes do.
  return ['http:', 'https:'].includes(next.protocol) && (next.origin !== current.origin || next.pathname !== current.pathname || next.search !== current.search)
}

export type OnboardingHistoryEntry = { key: string; index: number; url: string | null }
export type OnboardingNavigateEvent = Event & {
  navigationType: string;
  destination: OnboardingHistoryEntry & { sameDocument: boolean };
}
/** Minimal feature-detected platform interface, not a replacement for Next's router. */
export type OnboardingNavigation = EventTarget & {
  readonly currentEntry: OnboardingHistoryEntry | null;
  traverseTo: (key: string) => { committed: Promise<unknown>; finished: Promise<unknown> };
}

export function onboardingNavigationFor(target: Window): OnboardingNavigation | null {
  const navigation = (target as Window & { navigation?: OnboardingNavigation }).navigation
  return navigation && typeof navigation.addEventListener === 'function' && typeof navigation.removeEventListener === 'function'
    && typeof navigation.traverseTo === 'function' && validHistoryEntry(navigation.currentEntry) ? navigation : null
}

function validHistoryEntry(entry: OnboardingHistoryEntry | null | undefined): entry is OnboardingHistoryEntry & { url: string } {
  return Boolean(entry && typeof entry.key === 'string' && entry.key && Number.isInteger(entry.index) && entry.index >= 0 && typeof entry.url === 'string')
}

export const onboardingHistoryUnavailableMessage = 'Browser Back/Forward protection is unavailable in this browser. Your answers are not saved automatically. Use this form\'s Back/Next controls and submit before leaving.'
export const onboardingHistoryRestoreFailureMessage = 'Browser history could not be restored to this application. Your answers are still on this page, but the intended location could not be confirmed. Do not leave or submit again; ask the onboarding owner to reconcile the application.'

/**
 * Cancel before traversal commits where supported. For a noncancelable
 * same-document traversal, suppress Next 15's noncapture popstate handling and
 * traverse back to the exact original key, checking both key and index.
 * No entry is inserted/replaced and no Next state or forward trail is changed.
 */
export function installOnboardingTraversalGuard(target: Window, navigation: OnboardingNavigation, options: {
  isDirty: () => boolean;
  confirmDeparture: () => boolean;
  consumeConfirmedDeparture: (url: string) => boolean;
  onFailure: (message: string) => void;
  onRestoringChange?: (restoring: boolean) => void;
}): () => void {
  let active = true
  let generation = 0
  type PendingRestoration = { original: Readonly<OnboardingHistoryEntry & { url: string }>; destination: OnboardingHistoryEntry & { url: string }; restoring: boolean; observedOriginal: boolean; committed: boolean; finished: boolean }
  let pending: PendingRestoration | null = null
  const fail = () => { pending = null; generation += 1; if (active) { options.onRestoringChange?.(false); options.onFailure(onboardingHistoryRestoreFailureMessage) } }
  const atOriginal = (restoring: PendingRestoration) => {
    const current = navigation.currentEntry
    return validHistoryEntry(current) && current.key === restoring.original.key && current.index === restoring.original.index && current.url === restoring.original.url
  }
  const complete = (restoring: PendingRestoration) => {
    if (pending !== restoring || !restoring.committed || !restoring.finished || !restoring.observedOriginal) return
    if (!atOriginal(restoring)) { fail(); return }
    pending = null; options.onRestoringChange?.(false)
  }
  const navigate = (baseEvent: Event) => {
    const event = baseEvent as OnboardingNavigateEvent
    if (event.navigationType !== 'traverse' || !event.destination?.sameDocument || event.defaultPrevented) return
    if (pending) {
      if (pending.restoring && event.destination.key === pending.original.key && event.destination.index === pending.original.index && event.destination.url === pending.original.url) return
      // The original entry stays pinned until both restoration promises settle.
      // A second traversal may abort the queued first restoration. Cancel it
      // where possible; otherwise lock Next at capture and retry the same key.
      if (event.cancelable) { event.preventDefault(); return }
      if (!validHistoryEntry(event.destination)) { fail(); return }
      generation += 1
      pending.destination = { key: event.destination.key, index: event.destination.index, url: event.destination.url }
      pending.restoring = false; pending.observedOriginal = false; pending.committed = false; pending.finished = false
      return
    }
    if (!options.isDirty() || !event.destination.url || !onboardingLinkDiscardsAnswers(event.destination.url, target.location.href)) return
    if (options.consumeConfirmedDeparture(event.destination.url) || options.confirmDeparture()) return
    if (event.cancelable) { event.preventDefault(); return }
    const original = navigation.currentEntry
    if (!validHistoryEntry(original) || !validHistoryEntry(event.destination) || original.key === event.destination.key || original.index === event.destination.index) { fail(); return }
    pending = {
      original: { key: original.key, index: original.index, url: original.url },
      destination: { key: event.destination.key, index: event.destination.index, url: event.destination.url },
      restoring: false, observedOriginal: false, committed: false, finished: false,
    }
    options.onRestoringChange?.(true)
  }
  const popstate = (event: Event) => {
    const restoring = pending
    if (!restoring) return
    const current = navigation.currentEntry
    // Capture runs before Next's noncapture listener. preventDefault() on
    // popstate would not cancel the browser traversal and is not used here.
    event.stopImmediatePropagation()
    if (atOriginal(restoring)) {
      restoring.observedOriginal = true; complete(restoring)
      return
    }
    if (!validHistoryEntry(current) || current.key !== restoring.destination.key || current.index !== restoring.destination.index || current.url !== restoring.destination.url) { fail(); return }
    if (restoring.restoring) return
    restoring.restoring = true
    const request = ++generation
    try {
      const result = navigation.traverseTo(restoring.original.key)
      // NavigationResult rejects committed and finished independently. Attach
      // both rejection handlers immediately, including aborted older attempts.
      void result.committed.then(() => {
        if (!active || pending !== restoring || request !== generation) return
        restoring.committed = true; complete(restoring)
      }, () => { if (active && pending === restoring && request === generation) fail() })
      void result.finished.then(() => {
        if (!active || pending !== restoring || request !== generation) return
        restoring.finished = true
        if (!atOriginal(restoring)) { fail(); return }
        complete(restoring)
      }, () => { if (active && pending === restoring && request === generation) fail() })
    } catch { fail() }
  }
  navigation.addEventListener('navigate', navigate)
  target.addEventListener('popstate', popstate, true)
  return () => { active = false; pending = null; generation += 1; options.onRestoringChange?.(false); navigation.removeEventListener('navigate', navigate); target.removeEventListener('popstate', popstate, true) }
}
