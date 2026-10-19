'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { applicationDraftAnswersSchema, applicationDraftEnvelopeSchema, applicationDraftRequestSchema, type ApplicationDraftAnswers, type ApplicationDraftEnvelope, type ApplicationDraftRequest } from '@/lib/portal/application-drafts'
import type { EntryApplication } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import type { OnboardingStepId } from '@/lib/portal/onboarding-flow'

type Status = 'LOADING' | 'READY' | 'SAVING' | 'ERROR' | 'CONFLICT' | 'UNAVAILABLE'
type SaveFlight = { promise: Promise<boolean>; confirmed: boolean }
const markerSchema = z.object({ key: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), expected_draft_revision: z.number().int().nonnegative() }).strict()
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Draft values must be JSON data.')
  return serialized
}
export function draftEnvelopeMatches(value: ApplicationDraftEnvelope, application: EntryApplication, actorId: string, environment: PlatformEnvironment): boolean {
  const saved = value.application
  return value.actor_id === actorId && value.environment === environment && value.base_application_revision === application.revision
    && saved.id === application.id && saved.persona === application.persona && saved.status === application.status
    && saved.context_kind === application.context_kind && saved.context_organisation_id === application.context_organisation_id
    && saved.origin === application.origin && saved.admission_purpose === application.admission_purpose
}
export function draftSaveConfirmed(value: ApplicationDraftEnvelope, request: ApplicationDraftRequest): boolean {
  const { key, ...payload } = request
  return Boolean(value.draft && value.receipt && value.draft_revision === request.expected_draft_revision + 1
    && value.receipt.key === key && value.receipt.draft_revision === value.draft_revision
    && value.receipt.saved_at === value.draft.saved_at && canonical(value.receipt.payload) === canonical(payload)
    && canonical(value.draft.answers) === canonical(request.answers) && value.draft.step === request.step)
}
export async function saveDraftBeforeExit(save: () => Promise<boolean>, onConfirmed: () => void): Promise<boolean> {
  if (!await save()) return false
  onConfirmed(); return true
}

/** Only request references/digests go to storage; answers stay on the server or in memory. */
export function useApplicationDraft({ application, actorId, environment, answers, step, enabled, onResume }: {
  application: EntryApplication; actorId: string; environment: PlatformEnvironment; answers: ApplicationDraftAnswers;
  step: OnboardingStepId; enabled: boolean; onResume: (answers: ApplicationDraftAnswers, step: OnboardingStepId) => void;
}) {
  const identity = `${environment}:${actorId}:${application.id}:${application.revision}`
  const storageKey = `bx1-application-draft:${identity}:pending`
  const [status, setStatus] = useState<Status>(enabled ? 'LOADING' : 'UNAVAILABLE')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const [savedContent, setSavedContent] = useState<string | null>(null)
  const latest = useRef({ answers, step }); latest.current = { answers, step }
  const initialContent = useRef(canonical({ answers, step }))
  const initialValues = useRef({ answers, step })
  const resume = useRef(onResume); resume.current = onResume
  const active = useRef<string | null>(identity); active.current = identity
  const generation = useRef(0)
  const revisionRef = useRef(0)
  const confirmedContent = useRef<string | null>(null)
  const original = useRef<ApplicationDraftRequest | null>(null)
  const unresolved = useRef<z.infer<typeof markerSchema> | null>(null)
  const inFlight = useRef<SaveFlight | null>(null)
  const recovering = useRef(false)
  const content = canonical({ answers, step })
  const changed = content !== (savedContent ?? initialContent.current)
  const saved = status === 'READY' && savedContent !== null && content === savedContent
  async function digest(body: Omit<ApplicationDraftRequest, 'key'>) {
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ identity, body })))
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  useEffect(() => {
    const scope = identity
    active.current = scope
    const epoch = ++generation.current
    let cancelled = false
    const current = () => !cancelled && active.current === scope && generation.current === epoch
    const loadingContent = canonical(latest.current)
    revisionRef.current = 0; confirmedContent.current = null; original.current = null; unresolved.current = null; inFlight.current = null; recovering.current = false
    initialValues.current = latest.current
    initialContent.current = canonical(latest.current); setRevision(0); setSavedContent(null)
    if (!enabled) { setStatus('UNAVAILABLE'); return () => { cancelled = true; if (generation.current === epoch) generation.current++; active.current = null } }
    setStatus('LOADING'); setMessage('')
    async function load() {
      try {
        const raw = sessionStorage.getItem(storageKey)
        const marker = raw ? markerSchema.parse(JSON.parse(raw)) : null
        unresolved.current = marker
        const query = new URLSearchParams({ application_id: application.id, expected_application_revision: String(application.revision) })
        if (marker) query.set('request_key', marker.key)
        const response = await fetch(`/api/portal/application-drafts?${query}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-bx1-expected-actor': actorId }, signal: AbortSignal.timeout(15000) })
        if (!current()) return
        if (!response.ok) {
          const error = new Error(response.status === 409 ? 'This draft changed in another tab. Your current answers have not been replaced. Choose Load saved draft to review and replace them deliberately.' : 'Draft saving is unavailable. Keep this page open; your new changes are not saved.') as Error & { conflict?: boolean }
          error.conflict = response.status === 409; throw error
        }
        const value = applicationDraftEnvelopeSchema.parse((await response.json()).draft)
        if (!current()) return
        if (!draftEnvelopeMatches(value, application, actorId, environment)) throw new Error('The saved draft could not be matched to this application. Nothing was replaced.')
        if (marker) {
          if (!value.receipt || value.receipt.key !== marker.key || await digest(value.receipt.payload) !== marker.hash
            || !draftSaveConfirmed(value, { key: marker.key, ...value.receipt.payload })) throw new Error('An earlier save is unconfirmed. Re-enter its original answers and retry; no replacement save will be sent.')
          if (!current()) return
          sessionStorage.removeItem(storageKey); unresolved.current = null
        }
        if (!current()) return
        revisionRef.current = value.draft_revision; setRevision(value.draft_revision)
        if (value.draft) {
          const verified = canonical({ answers: value.draft.answers, step: value.draft.step })
          confirmedContent.current = verified; setSavedContent(verified)
          if (canonical(latest.current) !== loadingContent) {
            setStatus('CONFLICT'); setMessage('Your saved draft arrived after you started editing. Your new answers are retained. Choose Load saved draft to replace them deliberately.'); return
          }
          resume.current(value.draft.answers, value.draft.step)
        }
        setStatus('READY')
      } catch (error) {
        if (current()) {
          setStatus(error instanceof Error && 'conflict' in error && error.conflict ? 'CONFLICT' : unresolved.current ? 'ERROR' : 'UNAVAILABLE')
          setMessage(error instanceof Error ? error.message : 'The saved draft could not be loaded. New answers have not been saved.')
        }
      }
    }
    void load()
    return () => { cancelled = true; if (generation.current === epoch) generation.current++; active.current = null }
    // The full immutable application identity is checked against each response.
  }, [identity, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCurrent(allowFollowup = true): Promise<boolean> {
    const scope = identity
    const epoch = generation.current
    const current = () => enabled && active.current === scope && generation.current === epoch
    if (!enabled || recovering.current || active.current !== identity || status === 'LOADING' || status === 'CONFLICT' || status === 'UNAVAILABLE') return false
    if (inFlight.current) {
      const flight = inFlight.current
      await flight.promise
      if (!current()) return false
      if (inFlight.current && inFlight.current !== flight) return saveCurrent(false)
      if (!flight.confirmed || original.current || unresolved.current) return false
      if (confirmedContent.current === canonical(latest.current)) return true
      if (!allowFollowup || confirmedContent.current === null) return false
      if (inFlight.current === flight) inFlight.current = null
      return saveCurrent(false)
    }
    if (confirmedContent.current === canonical(latest.current) && !original.current && !unresolved.current) return true
    const flight: SaveFlight = { promise: Promise.resolve(false), confirmed: false }
    const run = async (): Promise<boolean> => {
      let sent = false
      const hadPending = Boolean(original.current || unresolved.current)
      try {
        const parsed = applicationDraftAnswersSchema.parse(latest.current.answers)
        const body = { application_id: application.id, expected_application_revision: application.revision,
          expected_draft_revision: unresolved.current?.expected_draft_revision ?? revisionRef.current, answers: parsed, step: latest.current.step }
        const hash = await digest(body)
        if (!current()) return false
        const marker = unresolved.current
        if (!original.current && marker && marker.hash !== hash) throw new Error('An earlier save is unconfirmed. Retry that save before saving further changes; your current answers are retained.')
        const request = original.current ?? applicationDraftRequestSchema.parse({ key: marker?.key ?? crypto.randomUUID(), ...body })
        const capturedPayload = { application_id: request.application_id, expected_application_revision: request.expected_application_revision,
          expected_draft_revision: request.expected_draft_revision, answers: request.answers, step: request.step }
        const requestHash = await digest(capturedPayload)
        if (!current()) return false
        sessionStorage.setItem(storageKey, JSON.stringify({ key: request.key, hash: requestHash, expected_draft_revision: request.expected_draft_revision }))
        unresolved.current = { key: request.key, hash: requestHash, expected_draft_revision: request.expected_draft_revision }
        original.current = request
        if (!current()) return false
        setStatus('SAVING'); setMessage(''); sent = true
        const response = await fetch('/api/portal/application-drafts', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) })
        if (!current()) return false
        if (!response.ok) {
          const value = await response.json().catch(() => ({}))
          const error = new Error(typeof value.error === 'string' ? value.error : 'Couldn’t save your draft. Your answers are retained; retry.') as Error & { conflict?: boolean; definitive?: boolean }
          error.conflict = response.status === 409; error.definitive = response.status >= 400 && response.status < 500; throw error
        }
        const value = applicationDraftEnvelopeSchema.parse((await response.json()).draft)
        if (!current()) return false
        if (!draftEnvelopeMatches(value, application, actorId, environment) || !draftSaveConfirmed(value, request)) throw new Error('The save was not confirmed for these answers. Retry the original save; nothing is shown as saved.')
        if (!current()) return false
        const verified = canonical({ answers: request.answers, step: request.step })
        revisionRef.current = value.draft_revision; setRevision(value.draft_revision)
        confirmedContent.current = verified; setSavedContent(verified)
        sessionStorage.removeItem(storageKey); unresolved.current = null; original.current = null
        flight.confirmed = true
        setStatus('READY'); setMessage('')
        return canonical(latest.current) === verified
      } catch (error) {
        if (!current()) return false
        const definitive = error instanceof Error && 'definitive' in error && error.definitive
        if (definitive && !hadPending) { sessionStorage.removeItem(storageKey); unresolved.current = null; original.current = null }
        if (!sent && !original.current) { /* No network effect; keep the previous confirmed draft. */ }
        setStatus(error instanceof Error && 'conflict' in error && error.conflict ? 'CONFLICT' : 'ERROR')
        setMessage(error instanceof Error ? error.message : 'Couldn’t save your draft. Keep this page open and retry.')
        return false
      }
    }
    const promise = run(); flight.promise = promise; inFlight.current = flight
    let result: boolean
    try { result = await promise } finally { if (inFlight.current === flight) inFlight.current = null }
    if (!result && flight.confirmed && allowFollowup && current() && !original.current && !unresolved.current && confirmedContent.current !== null) return saveCurrent(false)
    return current() && result
  }
  async function recoverCurrent(confirmReplacement: () => boolean): Promise<boolean> {
    if (!enabled || inFlight.current || recovering.current || !['CONFLICT', 'ERROR'].includes(status)) return false
    const scope = identity, epoch = generation.current, previousStatus = status, previousMessage = message
    const current = () => enabled && active.current === scope && generation.current === epoch
    recovering.current = true; setStatus('LOADING'); setMessage('Checking the saved draft before replacing your current answers…')
    try {
      // A receipt may have been superseded. Read the current draft without replaying
      // that key, then require explicit consent before discarding local answers.
      const query = new URLSearchParams({ application_id: application.id, expected_application_revision: String(application.revision) })
      const response = await fetch(`/api/portal/application-drafts?${query}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-bx1-expected-actor': actorId }, signal: AbortSignal.timeout(15000) })
      if (!current()) return false
      if (!response.ok) throw new Error('The saved draft could not be checked. Your current answers are retained; retry later.')
      const value = applicationDraftEnvelopeSchema.parse((await response.json()).draft)
      if (!current()) return false
      if (!draftEnvelopeMatches(value, application, actorId, environment)) throw new Error('The saved draft did not match this application. Your answers were not replaced.')
      if (!confirmReplacement()) { if (current()) { setStatus(previousStatus); setMessage(previousMessage) }; return false }
      if (!current()) return false
      const restored = value.draft ?? initialValues.current
      const verified = value.draft ? canonical({ answers: value.draft.answers, step: value.draft.step }) : null
      sessionStorage.removeItem(storageKey); unresolved.current = null; original.current = null
      revisionRef.current = value.draft_revision; setRevision(value.draft_revision)
      confirmedContent.current = verified; setSavedContent(verified)
      resume.current(restored.answers, restored.step)
      setStatus('READY'); setMessage('')
      return true
    } catch (error) {
      if (current()) { setStatus(previousStatus); setMessage(error instanceof Error ? error.message : 'The saved draft could not be checked. Your answers are retained.') }
      return false
    } finally { if (current()) recovering.current = false }
  }
  useEffect(() => {
    if (!enabled || status !== 'READY' || !changed || original.current || unresolved.current) return
    const timer = window.setTimeout(() => { void saveCurrent() }, 750)
    return () => window.clearTimeout(timer)
  }, [content, enabled, changed, status]) // eslint-disable-line react-hooks/exhaustive-deps
  return { status, loading: status === 'LOADING', busy: status === 'SAVING', available: !['LOADING', 'UNAVAILABLE'].includes(status),
    saved, dirty: status === 'CONFLICT' || recovering.current || changed || Boolean(original.current) || Boolean(unresolved.current), message, revision, save: saveCurrent, recover: recoverCurrent }
}
