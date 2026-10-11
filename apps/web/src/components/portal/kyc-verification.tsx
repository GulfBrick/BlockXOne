'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { EntryApplication } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { portalContextKey } from '@/lib/portal/operating-context'
import { usePortalActorId, usePortalOperatingContext } from './portal-client'
import { DetailList, Notice, Panel, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

// The vendor SDK touches browser globals when it mounts. Keep it out of SSR.
const SumsubWebSdk = dynamic(() => import('@sumsub/websdk-react'), { ssr: false })

const id = z.string().uuid()
const sessionSchema = z.object({
  token: z.string().min(1).max(1024),
  expires_in_seconds: z.number().int().positive().max(900),
  level_name: z.string().min(1).max(120),
  application_id: id,
  application_revision: z.number().int().positive(),
  environment: z.literal('TESTNET'),
}).strict()
const eventSchema = z.object({
  id,
  application_id: id,
  application_revision: z.number().int().positive(),
  environment: z.literal('TESTNET'),
  event_type: z.string().min(1).max(100),
  event_at: z.string(),
  received_at: z.string(),
  ordering_state: z.enum(['CURRENT', 'STALE', 'MANUAL_TEST']),
  manual_webhook_test: z.boolean(),
  review_status: z.string().max(60).nullish(),
  review_answer: z.string().max(60).nullish(),
  review_reject_type: z.string().max(60).nullish(),
  applicant_type: z.enum(['individual', 'company']).nullable(),
  level_name: z.string().min(1).max(120).nullable(),
  evidence_kind: z.enum(['LIFECYCLE', 'COMPLETED_REVIEW', 'LEGACY_UNQUALIFIED']),
  projection_state: z.enum(['EFFECTIVE', 'SUPERSEDED', 'MANUAL_TEST', 'LEGACY_UNQUALIFIED', 'REVISION_STALE', 'CONFLICT']),
}).passthrough().superRefine((event, context) => {
  const qualified = event.applicant_type !== null && event.level_name !== null
  if ((event.evidence_kind === 'LEGACY_UNQUALIFIED') === qualified
    || (event.projection_state === 'EFFECTIVE' && (event.ordering_state !== 'CURRENT' || event.manual_webhook_test || !qualified))
    || (event.manual_webhook_test && event.projection_state !== 'MANUAL_TEST' && event.projection_state !== 'LEGACY_UNQUALIFIED')
    || (event.evidence_kind === 'COMPLETED_REVIEW' && (event.event_type !== 'applicantReviewed' || event.review_status !== 'completed'
      || !((event.review_answer === 'GREEN' && !event.review_reject_type)
        || (event.review_answer === 'RED' && ['RETRY', 'FINAL'].includes(event.review_reject_type ?? ''))))))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The provider evidence projection is not qualified.' })
})
const evidenceSchema = z.object({ application_id: id, events: z.array(eventSchema) }).strict()
type ProviderEvent = z.infer<typeof eventSchema>

export function parseKycSession(value: unknown, applicationId: string, revision: number): string | null {
  const result = sessionSchema.safeParse(value)
  return result.success && result.data.application_id === applicationId && result.data.application_revision === revision
    ? result.data.token : null
}

function effectiveEvent(events: ProviderEvent[], revision: number): ProviderEvent | null {
  if (events.some(event => event.application_revision === revision && event.projection_state === 'CONFLICT')) return null
  const current = events.filter(event => event.application_revision === revision && event.projection_state === 'EFFECTIVE')
  return current.length === 1 ? current[0] : null
}
export function providerEvidenceLabel(events: ProviderEvent[], revision: number): string {
  if (events.some(event => event.application_revision === revision && event.projection_state === 'CONFLICT'))
    return 'Provider evidence conflict - no effective completed review'
  const latest = effectiveEvent(events, revision)
  if (latest?.evidence_kind === 'COMPLETED_REVIEW')
    return latest.review_answer === 'GREEN' ? 'Provider review completed: GREEN - independent BlockXOne review required'
      : latest.review_reject_type === 'RETRY' ? 'Provider review completed: RED RETRY - provider evidence changes required'
        : 'Provider review completed: RED FINAL - contact the provider/reviewer'
  if (latest) {
    const labels: Record<string, string> = {
      applicantPending: 'Provider review pending', applicantOnHold: 'Provider review on hold',
      applicantAwaitingUser: 'Provider is awaiting your evidence', applicantReset: 'Provider verification reset',
      applicantDeactivated: 'Provider verification inactive', applicantDeleted: 'Provider verification deleted',
    }
    return labels[latest.event_type] ?? 'Provider verification in progress - no completed review'
  }
  if (events.some(event => event.application_revision === revision && event.projection_state === 'MANUAL_TEST'))
    return 'Sandbox simulation received for this application revision'
  if (events.length) return 'Only historical provider evidence is recorded'
  return 'No provider evidence received yet'
}

function ProviderEvidenceDetails({ events, revision }: { events: ProviderEvent[]; revision: number }) {
  const latest = effectiveEvent(events, revision)
  const conflict = events.some(event => event.application_revision === revision && event.projection_state === 'CONFLICT')
  const next = conflict ? 'Contact the provider/reviewer to resolve conflicting events. A later unambiguous signed event is required; no completed clearance can be inferred.'
    : !latest ? 'Simulations, unqualified legacy records and previous revisions are historical only; no current provider completion is established.'
      : ['applicantDeactivated', 'applicantDeleted'].includes(latest.event_type) ? 'Contact the provider/reviewer. This genuine lifecycle event invalidates any earlier apparent provider completion.'
        : latest.event_type === 'applicantOnHold' ? 'The provider must review this case. Contact the provider/reviewer if further information is needed.'
          : latest.event_type === 'applicantPending' ? 'Await the provider review; BlockXOne has not made an admission decision.'
            : latest.event_type === 'applicantAwaitingUser' || latest.event_type === 'applicantReset'
              || (latest.evidence_kind === 'COMPLETED_REVIEW' && latest.review_reject_type === 'RETRY')
              ? 'Complete or resubmit the requested provider evidence. The BlockXOne application review remains separate.'
              : latest.evidence_kind === 'COMPLETED_REVIEW' && latest.review_reject_type === 'FINAL'
                ? 'Contact the provider/reviewer about the final provider result. No BlockXOne decision was made by this event.'
                : latest.evidence_kind === 'COMPLETED_REVIEW' ? 'Await independent BlockXOne review of this submitted application; the provider result grants no admission or authority.'
                  : 'Continue the provider check or await provider progress. No completed review is recorded.'
  return <>
    <p className={styles.muted}>{next}</p>
    {latest ? <DetailList rows={[
      { label: 'Provider event', value: latest.event_type },
      { label: 'Qualified applicant type', value: latest.applicant_type ?? 'Legacy: not qualified' },
      { label: 'Exact verification level', value: latest.level_name ?? 'Legacy: not qualified' },
      { label: 'Evidence kind', value: latest.evidence_kind },
      { label: 'Evidence projection', value: latest.projection_state },
      { label: 'Event received', value: dateLabel(latest.received_at) },
      ...(latest.evidence_kind === 'COMPLETED_REVIEW' ? [
        { label: 'Provider answer only', value: latest.review_answer || 'Not recorded' },
        { label: 'Provider rejection type only', value: latest.review_reject_type || 'None' },
      ] : []),
    ]} /> : null}
    {events.length ? <details className={styles.sectionGap}><summary>Provider evidence history ({events.length})</summary>
      {events.map(event => <section key={event.id} className={styles.sectionGap} aria-label="Historical provider event"><DetailList rows={[
        { label: 'Application revision', value: String(event.application_revision) },
        { label: 'Provider event', value: event.event_type },
        { label: 'Qualified applicant type', value: event.applicant_type ?? 'Legacy: not qualified' },
        { label: 'Exact verification level', value: event.level_name ?? 'Legacy: not qualified' },
        { label: 'Evidence kind', value: event.evidence_kind },
        { label: 'Evidence projection', value: event.projection_state },
        { label: 'Authority', value: event.projection_state === 'MANUAL_TEST' ? 'Sandbox simulation only' : event.projection_state === 'EFFECTIVE' ? 'Current provider evidence only' : 'Not effective; historical/conflicting evidence only' },
      ]} /></section>)}
    </details> : null}
  </>
}

async function loadProviderEvidence(applicationId: string): Promise<ProviderEvent[]> {
  const response = await fetch(`/api/portal/kyc/evidence?application_id=${encodeURIComponent(applicationId)}`, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to view provider evidence.' : 'Provider evidence could not be checked. Retry shortly.')
  const parsed = evidenceSchema.safeParse(await response.json())
  if (!parsed.success || parsed.data.application_id !== applicationId
    || parsed.data.events.some(event => event.application_id !== applicationId)) throw new Error('The provider evidence response did not match this application.')
  return parsed.data.events
}

// Presentation only: the server/database independently derive and bind the
// immutable submitted subject and its exact provider level before any token.
function presentationApplicantType(application: EntryApplication): 'individual' | 'company' | null {
  const details = application.details
  const person = z.object({ full_name: z.string().trim().min(2).max(120), country: z.string().regex(/^[A-Z]{2}$/) }).safeParse(details)
  if (!person.success) return null
  const unversioned = !Object.prototype.hasOwnProperty.call(details, 'details_version')
  const company = z.object({ company_name: z.string().trim().min(3).max(160),
    registration_reference: z.string().trim().min(3).max(100) }).safeParse(details).success
  if (application.persona === 'INVESTOR' && application.admission_purpose === 'INVESTOR_ADMISSION') {
    if (details.investor_type === 'INDIVIDUAL' && unversioned) return 'individual'
    if (details.investor_type === 'ENTITY' && company && (unversioned || details.details_version === 3)) return 'company'
  }
  if (application.persona === 'WEALTH_MANAGER' && application.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION'
    && company && (details.details_version === 2 || details.details_version === 3)) return 'company'
  return null
}
type Props = { application: EntryApplication; environment: PlatformEnvironment; actorId: string; sandboxEnabled?: boolean;
  individualEnabled?: boolean; companyEnabled?: boolean }
type Session = { scope: string; token: string }
type Evidence = { scope: string; events: ProviderEvent[] }

export function KycVerification({ application, environment, actorId,
  sandboxEnabled = process.env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED === 'true',
  individualEnabled = process.env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_ENABLED === 'true',
  companyEnabled = process.env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_COMPANY_ENABLED === 'true' }: Props) {
  const operatingContext = usePortalOperatingContext(), liveActor = usePortalActorId()
  const applicantContext = operatingContext.mode === 'APPLICANT' && liveActor === actorId
  const applicantType = presentationApplicantType(application)
  const subjectEnabled = applicantType === 'individual' ? individualEnabled : applicantType === 'company' ? companyEnabled : false
  const scope = `${environment}:${actorId}:${liveActor}:${portalContextKey(operatingContext)}:${application.id}:${application.revision}:${application.status}:${application.context_kind}:${application.admission_purpose}:${application.persona}:${application.submitted_at}:${application.details.investor_type ?? ''}:${application.details.details_version ?? ''}:${sandboxEnabled}:${individualEnabled}:${companyEnabled}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  const evidenceRequest = useRef(0)
  const sessionRequest = useRef(0)
  const busyLock = useRef(false)
  const sdkContainer = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [starting, setStarting] = useState(false)
  const [sessionMessage, setSessionMessage] = useState('')
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [evidenceBusy, setEvidenceBusy] = useState(false)
  const [evidenceMessage, setEvidenceMessage] = useState('')
  const testnet = environment === 'TESTNET'
  const mayRead = testnet && applicantContext && Boolean(actorId)
  const mayStart = mayRead && sandboxEnabled && subjectEnabled && application.context_kind === 'PERSONAL'
    && application.status === 'SUBMITTED' && Boolean(application.submitted_at)
    && ['INVESTOR_ADMISSION', 'CUSTOMER_ORGANISATION_ADMISSION'].includes(application.admission_purpose)

  const refreshEvidence = useCallback(async () => {
    if (!mayRead) return
    const attempt = ++evidenceRequest.current
    setEvidenceBusy(true)
    setEvidence(null)
    setEvidenceMessage('')
    try {
      const events = await loadProviderEvidence(application.id)
      if (activeScope.current === scope && evidenceRequest.current === attempt) setEvidence({ scope, events })
    } catch (error) {
      if (activeScope.current === scope && evidenceRequest.current === attempt)
        setEvidenceMessage(error instanceof Error ? error.message : 'Provider evidence could not be checked.')
    } finally {
      if (activeScope.current === scope && evidenceRequest.current === attempt) setEvidenceBusy(false)
    }
  }, [application.id, scope, mayRead])

  useEffect(() => {
    evidenceRequest.current += 1
    sessionRequest.current += 1
    busyLock.current = false
    setSession(null)
    setStarting(false)
    setSessionMessage('')
    setEvidence(null)
    setEvidenceMessage('')
    setEvidenceBusy(false)
    if (mayRead) void refreshEvidence()
    return () => { evidenceRequest.current += 1; sessionRequest.current += 1 }
  }, [scope, mayRead, refreshEvidence])

  // The SDK's iframe does not provide its own title. Add one for assistive technology.
  useEffect(() => {
    if (!session || session.scope !== scope || !sdkContainer.current) return
    const container = sdkContainer.current
    const titleFrame = () => container.querySelector('iframe')?.setAttribute('title', 'Sumsub sandbox identity verification')
    titleFrame()
    const observer = new MutationObserver(titleFrame)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [scope, session])

  const requestToken = useCallback(async (): Promise<string> => {
    if (!mayStart || activeScope.current !== scope) throw new Error('This application is no longer available for sandbox identity verification.')
    const attempt = ++sessionRequest.current
    const response = await fetch('/api/portal/kyc/session', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId },
      body: JSON.stringify({ application_id: application.id, expected_revision: application.revision }),
      signal: AbortSignal.timeout(15000),
    })
    if (activeScope.current !== scope || attempt !== sessionRequest.current) throw new Error('The active application changed. Reload its current revision.')
    if (!response.ok) {
      let message = 'The sandbox identity check could not start. Retry this application later.'
      try {
        const result: unknown = await response.json()
        if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') message = result.error
      } catch { /* The generic message deliberately avoids provider internals. */ }
      throw new Error(message)
    }
    const token = parseKycSession(await response.json(), application.id, application.revision)
    if (!token || activeScope.current !== scope || attempt !== sessionRequest.current)
      throw new Error('The sandbox identity session did not match this application. Reload before retrying.')
    return token
  }, [actorId, application.id, application.revision, mayStart, scope])

  async function start() {
    if (busyLock.current || !mayStart) return
    busyLock.current = true
    setStarting(true)
    setSessionMessage('')
    setSession(null)
    try {
      const token = await requestToken()
      if (activeScope.current === scope) {
        setSession({ scope, token })
        setSessionMessage('Sandbox verification opened. Completion is not an admission decision; refresh recorded evidence after the provider finishes.')
      }
    } catch (error) {
      if (activeScope.current === scope) setSessionMessage(error instanceof Error ? error.message : 'The sandbox identity check could not start.')
    } finally {
      if (activeScope.current === scope) { busyLock.current = false; setStarting(false) }
    }
  }

  async function renewToken(): Promise<string> {
    try { return await requestToken() }
    catch (error) {
      if (activeScope.current === scope) {
        setSession(null)
        setSessionMessage(error instanceof Error ? error.message : 'The sandbox identity session expired. Start a new session for this application.')
      }
      throw error
    }
  }

  const currentSession = mayStart && session?.scope === scope ? session : null
  const currentEvidence = evidence?.scope === scope ? evidence.events : null
  return <Panel title="Identity verification evidence" description="A sandbox provider check and the BlockXOne admission decision are separate records.">
    {testnet ? <>
      <Notice title="Sandbox: fictional identity information only">When enabled, the Sumsub check opens inside your application. Do not submit a real identity document here. A provider result is evidence for an independent reviewer; it never grants account, role, product eligibility or signing authority.</Notice>
      {!sandboxEnabled ? <Notice title="Sandbox identity check not connected">The provider session is unavailable until the TEST sandbox credentials, webhook and evidence writer are verified. Your application and its recorded review state remain available.</Notice> : null}
      {sandboxEnabled && applicantType && !subjectEnabled ? <Notice title={applicantType === 'company'
        ? 'Company sandbox verification unavailable' : 'Individual sandbox verification unavailable'}>
        {applicantType === 'company'
          ? 'Company verification remains unavailable until sandbox KYB entitlement, the exact company level and its evidence connection are verified. An individual check cannot verify this company application.'
          : 'Individual verification remains unavailable until its exact sandbox level and evidence connection are verified.'}
        {' Your application and historical provider evidence remain available; no clearance is inferred.'}
      </Notice> : null}
      <div className={styles.sectionGap} role="status" aria-live="polite">
        <strong>{currentEvidence ? providerEvidenceLabel(currentEvidence, application.revision) : evidenceBusy ? 'Checking provider evidence...' : 'Provider evidence has not been checked'}</strong>
        {currentEvidence ? <ProviderEvidenceDetails events={currentEvidence} revision={application.revision} /> : null}
        {evidenceMessage ? <p className={styles.fieldError}>{evidenceMessage}</p> : null}
      </div>
      <div className={`${styles.actions} ${styles.sectionGap}`}>
        {mayStart ? <button type="button" className={styles.button} disabled={starting} onClick={() => void start()}>{starting ? 'Starting sandbox verification...' : currentSession ? 'Restart sandbox identity check' : 'Start sandbox identity check'}</button> : null}
        <button type="button" className={styles.buttonSecondary} disabled={evidenceBusy || !mayRead} onClick={() => void refreshEvidence()}>{evidenceBusy ? 'Checking evidence...' : 'Refresh recorded evidence'}</button>
      </div>
      {!mayStart ? <p className={`${styles.muted} ${styles.sectionGap}`}>{['DRAFT', 'CHANGES_REQUIRED'].includes(application.status)
        ? application.status === 'DRAFT' ? 'Submit the application for review first. Identity verification must use its immutable submitted revision.' : 'Update and resubmit the application first. Identity verification cannot use an editable changes-required revision.'
        : !applicantContext ? 'Return to this signed-in applicant context before starting verification. No result from another account or capacity is retained.'
          : 'A new provider session is not available for this application state or configuration. Historical evidence remains visible to authorised readers.'}</p> : null}
      {sessionMessage ? <p className={`${styles.muted} ${styles.sectionGap}`} role="status">{sessionMessage}</p> : null}
      {currentSession ? <div ref={sdkContainer} className={`${styles.kycWidget} ${styles.sectionGap}`} role="region" aria-label="Sumsub sandbox identity verification">
        <SumsubWebSdk accessToken={currentSession.token} expirationHandler={renewToken}
          config={{ lang: 'en', theme: 'dark' }} options={{ addViewportTag: false, adaptIframeHeight: true }}
          onError={() => { if (activeScope.current === scope) setSessionMessage('The provider widget reported a problem. Restart this application check or refresh recorded evidence.') }} />
      </div> : null}
    </> : <Notice title="Production identity provider not admitted">The same identity workflow will run here when the live provider and operating controls are approved. No sandbox session or verification claim is available on MAINNET.</Notice>}
  </Panel>
}

/** Read-only provider material for the independently authorised Compliance reviewer. */
export function ProviderEvidenceReview({ applicationId, revision, environment }: { applicationId: string; revision: number; environment?: PlatformEnvironment }) {
  const operatingContext = usePortalOperatingContext(), actorId = usePortalActorId()
  const scope = `${environment ?? 'UNAVAILABLE'}:${actorId}:${portalContextKey(operatingContext)}:${applicationId}:${revision}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  const request = useRef(0)
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const testnet = environment === 'TESTNET'
  const refresh = useCallback(async () => {
    if (!testnet) return
    const attempt = ++request.current
    setBusy(true); setMessage(''); setEvidence(null)
    try {
      const events = await loadProviderEvidence(applicationId)
      if (activeScope.current === scope && request.current === attempt) setEvidence({ scope, events })
    } catch (error) {
      if (activeScope.current === scope && request.current === attempt)
        setMessage(error instanceof Error ? error.message : 'Provider evidence could not be checked.')
    } finally { if (activeScope.current === scope && request.current === attempt) setBusy(false) }
  }, [applicationId, scope, testnet])
  useEffect(() => {
    request.current += 1
    setEvidence(null); setMessage(''); setBusy(false)
    if (testnet) void refresh()
    return () => { request.current += 1 }
  }, [scope, testnet, refresh])

  const events = evidence?.scope === scope ? evidence.events : null
  return <Panel title="Provider identity evidence" description="Signed provider events are evidence for this exact customer case, not the BlockXOne admission decision.">
    {testnet ? <>
      <Notice title="Independent reviewer decision required">A Sumsub sandbox event, including a positive provider answer, does not tick the review checks, admit the customer, grant a role or establish product eligibility. Record your own decision and rationale against the submitted application revision.</Notice>
      <div className={styles.sectionGap} role="status" aria-live="polite">
        <strong>{events ? providerEvidenceLabel(events, revision) : busy ? 'Checking provider evidence...' : 'Provider evidence has not been checked'}</strong>
        {events ? <ProviderEvidenceDetails events={events} revision={revision} /> : null}
        {message ? <p className={styles.fieldError}>{message} Do not infer a clear result while evidence is unavailable.</p> : null}
      </div>
      <button type="button" className={`${styles.buttonSecondary} ${styles.sectionGap}`} disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking signed evidence...' : 'Refresh signed provider evidence'}</button>
    </> : <Notice title="Production provider not admitted">No live provider evidence is available in this environment. The customer admission workflow remains sealed until its provider and operating controls are approved.</Notice>}
  </Panel>
}
