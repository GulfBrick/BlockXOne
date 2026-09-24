'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { EntryApplication } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
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
}).passthrough()
const evidenceSchema = z.object({ application_id: id, events: z.array(eventSchema) }).strict()
type ProviderEvent = z.infer<typeof eventSchema>

export function parseKycSession(value: unknown, applicationId: string, revision: number): string | null {
  const result = sessionSchema.safeParse(value)
  return result.success && result.data.application_id === applicationId && result.data.application_revision === revision
    ? result.data.token : null
}

export function providerEvidenceLabel(events: ProviderEvent[], revision: number): string {
  if (events.some(event => event.application_revision === revision && event.ordering_state === 'CURRENT' && !event.manual_webhook_test))
    return 'Provider evidence received for this application revision'
  if (events.some(event => event.application_revision === revision && (event.manual_webhook_test || event.ordering_state === 'MANUAL_TEST')))
    return 'Sandbox simulation received for this application revision'
  if (events.length) return 'Only historical provider evidence is recorded'
  return 'No provider evidence received yet'
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

type Props = { application: EntryApplication; environment: PlatformEnvironment; actorId: string; sandboxEnabled?: boolean }
type Session = { scope: string; token: string }
type Evidence = { scope: string; events: ProviderEvent[] }

export function KycVerification({ application, environment, actorId,
  sandboxEnabled = process.env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED === 'true' }: Props) {
  const scope = `${environment}:${actorId}:${application.id}:${application.revision}`
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
  const mayStart = testnet && sandboxEnabled && Boolean(actorId) && application.context_kind === 'PERSONAL'
    && ['DRAFT', 'SUBMITTED', 'CHANGES_REQUIRED'].includes(application.status)
    && ['INVESTOR_ADMISSION', 'CUSTOMER_ORGANISATION_ADMISSION'].includes(application.admission_purpose)

  const refreshEvidence = useCallback(async () => {
    if (!testnet) return
    const attempt = ++evidenceRequest.current
    setEvidenceBusy(true)
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
  }, [application.id, scope, testnet])

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
    if (testnet) void refreshEvidence()
    return () => { evidenceRequest.current += 1; sessionRequest.current += 1 }
  }, [scope, testnet, refreshEvidence])

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

  const currentSession = session?.scope === scope ? session : null
  const currentEvidence = evidence?.scope === scope ? evidence.events : null
  const currentEvents = currentEvidence?.filter(event => event.application_revision === application.revision
    && event.ordering_state === 'CURRENT' && !event.manual_webhook_test) ?? []
  const latest = currentEvents.at(-1)
  return <Panel title="Identity verification evidence" description="A sandbox provider check and the BlockXOne admission decision are separate records.">
    {testnet ? <>
      <Notice title="Sandbox: fictional identity information only">When enabled, the Sumsub check opens inside your application. Do not submit a real identity document here. A provider result is evidence for an independent reviewer; it never grants account, role, product eligibility or signing authority.</Notice>
      {!sandboxEnabled ? <Notice title="Sandbox identity check not connected">The provider session is unavailable until the TEST sandbox credentials, webhook and evidence writer are verified. Your application and its recorded review state remain available.</Notice> : null}
      <div className={styles.sectionGap} role="status" aria-live="polite">
        <strong>{currentEvidence ? providerEvidenceLabel(currentEvidence, application.revision) : evidenceBusy ? 'Checking provider evidence...' : 'Provider evidence has not been checked'}</strong>
        {latest ? <p className={styles.muted}>Latest recorded event: {dateLabel(latest.received_at)}. The compliance reviewer must still make a separate decision.</p> : null}
        {evidenceMessage ? <p className={styles.fieldError}>{evidenceMessage}</p> : null}
      </div>
      <div className={`${styles.actions} ${styles.sectionGap}`}>
        {mayStart ? <button type="button" className={styles.button} disabled={starting} onClick={() => void start()}>{starting ? 'Starting sandbox verification...' : currentSession ? 'Restart sandbox identity check' : 'Start sandbox identity check'}</button> : null}
        <button type="button" className={styles.buttonSecondary} disabled={evidenceBusy} onClick={() => void refreshEvidence()}>{evidenceBusy ? 'Checking evidence...' : 'Refresh recorded evidence'}</button>
      </div>
      {!mayStart ? <p className={`${styles.muted} ${styles.sectionGap}`}>A new provider session is not available for this application state. Historical evidence remains visible to authorised readers.</p> : null}
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
  const scope = `${environment ?? 'UNAVAILABLE'}:${applicationId}:${revision}`
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
    setBusy(true); setMessage('')
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
  const current = events?.filter(event => event.application_revision === revision
    && event.ordering_state === 'CURRENT' && !event.manual_webhook_test) ?? []
  const latest = current.at(-1)
  return <Panel title="Provider identity evidence" description="Signed provider events are evidence for this exact customer case, not the BlockXOne admission decision.">
    {testnet ? <>
      <Notice title="Independent reviewer decision required">A Sumsub sandbox event, including a positive provider answer, does not tick the review checks, admit the customer, grant a role or establish product eligibility. Record your own decision and rationale against the submitted application revision.</Notice>
      <div className={styles.sectionGap} role="status" aria-live="polite">
        <strong>{events ? providerEvidenceLabel(events, revision) : busy ? 'Checking provider evidence...' : 'Provider evidence has not been checked'}</strong>
        {latest ? <DetailList rows={[
          { label: 'Provider event', value: latest.event_type },
          { label: 'Event received', value: dateLabel(latest.received_at) },
          { label: 'Provider review status only', value: latest.review_status || 'No provider review status recorded' },
          { label: 'Provider answer only', value: latest.review_answer || 'No provider answer recorded' },
        ]} /> : null}
        {events && !latest ? <p className={styles.muted}>No current, non-simulated provider outcome is recorded for revision {revision}. Treat simulations and previous revisions as historical context only.</p> : null}
        {message ? <p className={styles.fieldError}>{message} Do not infer a clear result while evidence is unavailable.</p> : null}
      </div>
      <button type="button" className={`${styles.buttonSecondary} ${styles.sectionGap}`} disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking signed evidence...' : 'Refresh signed provider evidence'}</button>
    </> : <Notice title="Production provider not admitted">No live provider evidence is available in this environment. The customer admission workflow remains sealed until its provider and operating controls are approved.</Notice>}
  </Panel>
}
