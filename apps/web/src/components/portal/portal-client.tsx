'use client'

import { createContext, useContext, useEffect, useRef, useState, type ContextType, type ReactNode } from 'react'
import { customerMonitoringSnapshotSchema, portalCommandSchema, type PortalCommand, type PortalSnapshot } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT, portalContextKey, portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { hasStage2CommandAccess, validatedStage2Access, type Stage2Access } from '@/lib/portal/stage2-access'
import { hasOfferingCommandAccess, isTestPasswordWorkflow, validatedOfferingAccess, type OfferingAccess } from '@/lib/portal/offering-access'
import { hasEvaluationCommandAccess, sameEvaluationGrant, validatedEvaluationAccess, type EvaluationAccess } from '@/lib/portal/evaluation-access'
import { fundLifecycleSnapshotSchema, fundOperationSchema, hasFundLifecycleCommand, isFundLifecycleCommand, validatedFundLifecycle, type FundLifecycleOperation } from '@/lib/portal/fund-lifecycle-contracts'
import { matchesAppointmentCommit } from '@/lib/portal/appointment-commit'
import { matchesFundPublicationCommit } from '@/lib/portal/fund-publication-commit'
import { matchesOfferingDecisionCommit } from '@/lib/portal/offering-decision-commit'
import { admissionCommitSnapshotMatches, matchesAdmissionCommit } from '@/lib/portal/admission-commit'
import { fundingSnapshotSchema } from '@/lib/portal/funding-contracts'
import { fundRoleplayAdmissionProjectionValid } from '@/lib/portal/fund-roleplay-admission'
import styles from './portal.module.css'

type Marker = { key: string; command: string; payloadHash: string }
type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type MarkerScope = { operatingContext: PortalOperatingContext; environment: PlatformEnvironment }
const markerKey = (actorId: string, scope?: MarkerScope) => scope
  ? `bx1-portal:${scope.environment}:${actorId}:${portalContextKey(scope.operatingContext)}:pending-request`
  : `bx1-portal:fegnnnlseuejkrusbbkv:${actorId}:pending-request`
// Shared by mounted command hooks in this tab only. Never store an ACK, private
// payload or authority here; a held result still needs its explicit saved read.
const heldAdmissionRequests = new Map<string, Pick<Marker, 'key' | 'command'>>()
const PortalCommandContext = createContext<{ actorId: string; requests: { key: string; command: string }[]; snapshot?: PortalSnapshot; stage2Access?: Stage2Access; offeringAccess?: OfferingAccess; evaluationAccess?: EvaluationAccess; invalidAdmission?: boolean } & MarkerScope>({ actorId: '', requests: [], operatingContext: APPLICANT_CONTEXT, environment: 'TESTNET' })
export function PortalCommandProvider({ snapshot, children, operatingContext = APPLICANT_CONTEXT, environment = 'TESTNET' }: { snapshot: PortalSnapshot; children: ReactNode; operatingContext?: PortalOperatingContext; environment?: PlatformEnvironment }) {
  const stage2Access = validatedStage2Access(snapshot, operatingContext, environment)
  const offeringAccess = validatedOfferingAccess(snapshot, operatingContext, environment)
  const evaluationAccess = validatedEvaluationAccess(snapshot, operatingContext, environment)
  const invalidAdmission = 'rehearsal' in snapshot || snapshot.stage2_access !== undefined && !stage2Access
    || !fundRoleplayAdmissionProjectionValid(snapshot, environment)
    || snapshot.offering_access !== undefined && !offeringAccess
    || snapshot.evaluation_access !== undefined && !evaluationAccess
  return <PortalCommandContext.Provider value={{ actorId: snapshot.actor.id, requests: snapshot.requests ?? [], snapshot, operatingContext, environment, stage2Access: stage2Access ?? undefined, offeringAccess: offeringAccess ?? undefined, evaluationAccess: evaluationAccess ?? undefined, invalidAdmission }}>{children}</PortalCommandContext.Provider>
}
export function usePortalOperatingContext() { return useContext(PortalCommandContext).operatingContext }
export function usePortalActorId() { return useContext(PortalCommandContext).actorId }
export function usePortalEnvironment() { return useContext(PortalCommandContext).environment }
export function usePortalSnapshot() { return useContext(PortalCommandContext).snapshot }
function commandAllowed(context: ContextType<typeof PortalCommandContext>, command: string) {
  if (context.invalidAdmission) return false
  if (isFundLifecycleCommand(command)) {
    const fund = validatedFundLifecycle(context.snapshot?.fund_lifecycle, context.actorId, context.operatingContext, context.environment)
    return Boolean(fund && hasFundLifecycleCommand(fund, command))
  }
  if (context.snapshot?.evaluation_access !== undefined) return hasEvaluationCommandAccess(context.snapshot, command, context.operatingContext)
  return !context.snapshot || !isTestPasswordWorkflow(context.snapshot)
    || hasStage2CommandAccess(context.snapshot, command, context.operatingContext)
    || hasOfferingCommandAccess(context.snapshot, command, context.operatingContext)
}
/** A UI restriction only; current record flags and the canonical writer still decide. */
export function usePortalCommandAllowed(command: string) { return commandAllowed(useContext(PortalCommandContext), command) }
export function PortalIdentityProvider({ actorId, environment, children }: { actorId: string; environment: PlatformEnvironment; children: ReactNode }) {
  return <PortalCommandContext.Provider value={{ actorId, environment, operatingContext: APPLICANT_CONTEXT, requests: [] }}>{children}</PortalCommandContext.Provider>
}
function readMarker(raw: string | null): Marker | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('The saved request marker cannot be read. Do not start a replacement request; contact the platform operator.') }
  const value = parsed as Partial<Marker> | null
  if (!value || typeof value.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.key) || typeof value.command !== 'string' || typeof value.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.payloadHash)) throw new Error('The saved request marker is invalid. Do not start a replacement request.')
  return value as Marker
}
export function reconcilePortalMarker(storage: MarkerStorage, actorId: string, requests: { key: string; command: string }[], scope?: MarkerScope): Marker | null {
  if (scope && storage.getItem(markerKey(actorId))) throw new Error('A request from the previous platform version needs reconciliation. Contact the operator with its request reference before starting another action.')
  const storageKey = markerKey(actorId, scope), marker = readMarker(storage.getItem(storageKey))
  const held = heldAdmissionRequests.get(storageKey)
  if (held && (!marker || marker.key !== held.key || marker.command !== held.command)) heldAdmissionRequests.delete(storageKey)
  else if (held && marker) return marker
  if (marker && requests.some(request => request.key === marker.key && request.command === marker.command)) { storage.removeItem(storageKey); return null }
  return marker
}
export async function prepareDurablePortalCommand(storage: MarkerStorage, actorId: string, request: PortalCommand, requests: { key: string; command: string }[], scope?: MarkerScope): Promise<PortalCommand> {
  if (!actorId) throw new Error('Your authenticated account is unavailable. Reload before continuing.')
  const marker = reconcilePortalMarker(storage, actorId, requests, scope)
  const original = storage.getItem(markerKey(actorId, scope))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ command: request.command, payload: request.payload, ...(scope ? { environment: scope.environment, operating_context: scope.operatingContext } : {}) })))
  const payloadHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  if (marker && (marker.command !== request.command || marker.payloadHash !== payloadHash)) throw new Error(`A previous ${marker.command.replaceAll('_', ' ')} request is unresolved. Re-enter the original values to retry its saved key, or refresh to reconcile a committed result. No new request was sent.`)
  if (storage.getItem(markerKey(actorId, scope)) !== original) throw new Error('Another request was recorded while this action was preparing. Refresh before continuing.')
  const prepared = { ...request, key: marker?.key ?? request.key }
  // Only identifiers and a digest are persisted: never applicant details, evidence or document text.
  storage.setItem(markerKey(actorId, scope), JSON.stringify({ key: prepared.key, command: prepared.command, payloadHash }))
  return prepared
}
export function clearPortalMarker(storage: MarkerStorage, actorId: string, request: PortalCommand, scope?: MarkerScope) {
  const storageKey = markerKey(actorId, scope), marker = readMarker(storage.getItem(storageKey))
  if (marker?.key === request.key && marker.command === request.command) storage.removeItem(storageKey)
  const held = heldAdmissionRequests.get(storageKey)
  if (held?.key === request.key && held.command === request.command) heldAdmissionRequests.delete(storageKey)
}
/** A denial of a retry cannot prove that its earlier uncertain attempt failed. */
export function mayDiscardDeniedPortalRequest(definitive: boolean, hadPendingAttempt: boolean): boolean {
  return definitive && !hadPendingAttempt
}

function savedCommandSubject(command?: PortalCommand['command']) {
  return command === 'publish_product' ? 'Your publication request'
    : command === 'review_offering_issuer' || command === 'review_product' ? 'Your offering decision'
    : command === 'review_application' ? 'Your application decision'
    : command === 'create_investment_account' ? 'Your investment account' : 'Your appointment change'
}
class PortalCommittedRefreshRequiredError extends Error {
  readonly committed = true
  readonly definitive = false
  constructor(command?: PortalCommand['command']) { super(`${savedCommandSubject(command)} was saved. Refresh the saved result before continuing; do not create a replacement request.`) }
}
function snapshotConfirmsRequest(snapshot: PortalSnapshot, request: PortalCommand): boolean {
  return Array.isArray(snapshot.requests) && snapshot.requests.some(receipt => receipt?.key === request.key && receipt.command === request.command)
}
function completeCommitSnapshot(snapshot: PortalSnapshot, actorId: string, operatingContext: PortalOperatingContext, environment: PlatformEnvironment): boolean {
  return snapshot.actor?.id === actorId && typeof snapshot.actor.email === 'string' && typeof snapshot.actor.can_review === 'boolean'
    && portalContextMatches(snapshot.operating_context, operatingContext) && !('rehearsal' in snapshot)
    && (['applications', 'organisations', 'products', 'subscriptions', 'events'] as const).every(key => Array.isArray(snapshot[key]))
    && fundRoleplayAdmissionProjectionValid(snapshot, environment)
    && (snapshot.customer_monitoring === undefined || customerMonitoringSnapshotSchema.safeParse(snapshot.customer_monitoring).success)
    && (snapshot.funding === undefined || fundingSnapshotSchema.safeParse(snapshot.funding).success)
    && (snapshot.fund_lifecycle === undefined || Boolean(validatedFundLifecycle(snapshot.fund_lifecycle, actorId, operatingContext, environment)))
    && (snapshot.stage2_access === undefined || Boolean(validatedStage2Access(snapshot, operatingContext, environment)))
    && (snapshot.offering_access === undefined || Boolean(validatedOfferingAccess(snapshot, operatingContext, environment)))
    && (snapshot.evaluation_access === undefined || Boolean(validatedEvaluationAccess(snapshot, operatingContext, environment)))
}

export async function postPortalCommand(command: PortalCommand, operatingContext: PortalOperatingContext = APPLICANT_CONTEXT, expectedActor?: string, expectedStage2Access?: Stage2Access, expectedOfferingAccess?: OfferingAccess, expectedEvaluationAccess?: EvaluationAccess, expectedEnvironment: PlatformEnvironment = 'TESTNET'): Promise<PortalSnapshot> {
  const response = await fetch('/api/portal/command', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(expectedActor ? { 'x-bx1-expected-actor': expectedActor } : {}) }, body: JSON.stringify({ ...command, operating_context: operatingContext }), signal: AbortSignal.timeout(45000) })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) throw new Error('The platform did not confirm the outcome. Retry the saved request, not a new application.')
  const result = await response.json()
  let committed = false
  let admissionCommit = false
  if (result?.committed !== undefined) {
    const expected = { actorId: expectedActor ?? '', context: operatingContext, request: command, environment: expectedEnvironment }
    if (!response.ok || ![200, 202].includes(response.status) || result.error !== undefined
      || !(matchesAppointmentCommit(result.committed, expected) || matchesFundPublicationCommit(result.committed, expected)
        || matchesOfferingDecisionCommit(result.committed, expected) || matchesAdmissionCommit(result.committed, expected))) {
      throw new Error('The platform did not confirm this request in the expected context. Refresh to reconcile the original request.')
    }
    committed = true
    admissionCommit = matchesAdmissionCommit(result.committed, expected)
    if (response.status === 202 || result.refresh_required === true || !result.snapshot) throw new PortalCommittedRefreshRequiredError(command.command)
  }
  if (!response.ok || result.error || !result.snapshot) {
    const error = new Error(typeof result.error === 'string' ? result.error : 'The platform could not confirm this request.') as Error & { definitive?: boolean }
    error.definitive = response.status >= 400 && response.status < 500
    throw error
  }
  try {
  if (committed && !completeCommitSnapshot(result.snapshot, expectedActor ?? '', operatingContext, expectedEnvironment)) throw new PortalCommittedRefreshRequiredError(command.command)
  if (admissionCommit && !admissionCommitSnapshotMatches(result.snapshot, result.committed)) throw new PortalCommittedRefreshRequiredError(command.command)
  if (!portalContextMatches(result.snapshot.operating_context, operatingContext) || (expectedActor && result.snapshot.actor?.id !== expectedActor)) throw new Error('The saved result belongs to an unverified operating context. Refresh to reconcile the original request.')
  if ('rehearsal' in result.snapshot) throw new Error('The saved result is not a normal admission record. Refresh to reconcile the original request.')
  if (!fundRoleplayAdmissionProjectionValid(result.snapshot, expectedEnvironment)) throw new Error('The saved TEST admission context could not be verified. Refresh to reconcile the original request.')
  const savedAccess = validatedStage2Access(result.snapshot, operatingContext)
  const savedOfferingAccess = validatedOfferingAccess(result.snapshot, operatingContext)
  const savedEvaluation = validatedEvaluationAccess(result.snapshot, operatingContext)
  const fundCommand = isFundLifecycleCommand(command.command)
  if (fundCommand) {
    const fund = fundLifecycleSnapshotSchema.safeParse(result.snapshot.fund_lifecycle)
    if (!fund.success || !validatedFundLifecycle(fund.data, result.snapshot.actor.id, operatingContext, expectedEnvironment)) throw new Error('The saved fund result could not be verified. Refresh the original request before retrying.')
  }
  if (result.snapshot.evaluation_access !== undefined && (!savedEvaluation || !fundCommand && !hasEvaluationCommandAccess(result.snapshot, command.command, operatingContext))) throw new Error('The saved TEST workspace result could not be verified. Refresh to reconcile the original request.')
  if (expectedEvaluationAccess && (!savedEvaluation || !sameEvaluationGrant(expectedEvaluationAccess, savedEvaluation))) throw new Error('Your TEST workspace access changed. Refresh to reconcile the original request.')
  if (result.snapshot.stage2_access !== undefined && !savedAccess) throw new Error('The saved admission context could not be verified. Refresh to reconcile the original request.')
  if (result.snapshot.offering_access !== undefined && !savedOfferingAccess) throw new Error('The saved offering context could not be verified. Refresh to reconcile the original request.')
  if (!fundCommand && isTestPasswordWorkflow(result.snapshot) && !hasStage2CommandAccess(result.snapshot, command.command, operatingContext)
    && !hasOfferingCommandAccess(result.snapshot, command.command, operatingContext)) throw new Error('The saved result did not confirm this workflow action. Refresh to reconcile the original request.')
  if (expectedStage2Access && (!savedAccess || savedAccess.actor_id !== expectedStage2Access.actor_id
    || savedAccess.environment !== expectedStage2Access.environment || savedAccess.session_mode !== expectedStage2Access.session_mode
    || !portalContextMatches(savedAccess.operating_context, expectedStage2Access.operating_context))) throw new Error('The saved result changed admission context. Refresh to reconcile the original request.')
  if (expectedOfferingAccess && (!savedOfferingAccess || savedOfferingAccess.actor_id !== expectedOfferingAccess.actor_id
    || savedOfferingAccess.environment !== expectedOfferingAccess.environment || savedOfferingAccess.session_mode !== expectedOfferingAccess.session_mode
    || !portalContextMatches(savedOfferingAccess.operating_context, expectedOfferingAccess.operating_context))) throw new Error('The saved result changed offering context. Refresh to reconcile the original request.')
  if (committed && !snapshotConfirmsRequest(result.snapshot, command)) throw new PortalCommittedRefreshRequiredError(command.command)
  return result.snapshot as PortalSnapshot
  } catch (error) {
    // A genuine command receipt proves the write, not the readback. Never pass
    // the acknowledgement (or an invalid snapshot) to an application's onSaved.
    if (committed) throw new PortalCommittedRefreshRequiredError(command.command)
    throw error
  }
}

export function usePortalCommand(onSaved: (snapshot: PortalSnapshot) => void) {
  const context = useContext(PortalCommandContext)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [unknown, setUnknown] = useState(false)
  const [committedRequest, setCommittedRequest] = useState<{ identity: string; key: string; command: string } | null>(null)
  const lock = useRef(false)
  const savedRequest = useRef<PortalCommand | null>(null)
  const identity = `${context.environment}:${context.actorId}:${portalContextKey(context.operatingContext)}`
  const activeIdentity = useRef<string | null>(identity)
  const identityGeneration = useRef({ identity, epoch: 0 })
  if (identityGeneration.current.identity !== identity) identityGeneration.current = { identity, epoch: identityGeneration.current.epoch + 1 }
  activeIdentity.current = identity
  useEffect(() => {
    activeIdentity.current = identity
    // Durable markers remain in their original scope. In-memory state and late
    // responses must not borrow the acknowledgement in another actor/capacity.
    savedRequest.current = null; lock.current = false; setBusy(false); setUnknown(false); setCommittedRequest(null); setMessage('')
    return () => { activeIdentity.current = null }
  }, [identity])
  useEffect(() => {
    if (!context.actorId) return
    try {
      if (committedRequest?.identity === identity && (context.invalidAdmission || !context.snapshot
        || !completeCommitSnapshot(context.snapshot, context.actorId, context.operatingContext, context.environment))) return
      const marker = reconcilePortalMarker(sessionStorage, context.actorId, context.requests, context)
      if (!marker && committedRequest?.identity === identity && savedRequest.current && context.snapshot
        && snapshotConfirmsRequest(context.snapshot, savedRequest.current)) {
        savedRequest.current = null; setCommittedRequest(null); setUnknown(false); setMessage('Saved to your hosted workspace.')
      }
      if (marker && !savedRequest.current) setMessage(`A previous ${marker.command.replaceAll('_', ' ')} request needs reconciliation. Re-enter its original values to retry the same saved key, or refresh saved state.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request recovery is unavailable.') }
  }, [context.actorId, context.requests, context.snapshot, context.invalidAdmission, committedRequest, identity])
  async function dispatch(request: PortalCommand, executionLease?: FundLifecycleOperation) {
    if (lock.current) return false
    let originalFundReplay = false
    if (isFundLifecycleCommand(request.command)) {
      try {
        const marker = reconcilePortalMarker(sessionStorage, context.actorId, context.requests, context)
        originalFundReplay = Boolean(marker && marker.command === request.command)
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Original request recovery is unavailable.'); return false }
    }
    // Retained markers are scoped by actor/environment/context. The durable
    // preparation checks the payload hash; the database rechecks live authority.
    const leased = fundOperationSchema.safeParse(executionLease)
    const reference = request.command === 'record_fund_transaction' ? request.payload : null
    const leasedMetadata = Boolean(reference && leased.success && leased.data.state === 'UNKNOWN'
      && leased.data.id === reference.operation_id && leased.data.revision === reference.expected_revision
      && context.operatingContext.mode === 'ROLE' && context.operatingContext.role === 'TokenisationAgent'
      && context.snapshot?.fund_lifecycle?.availability === 'AVAILABLE'
      && context.snapshot.fund_lifecycle.products.some(product => product.product_id === leased.data.product_id
        && product.operations.some(operation => operation.id === leased.data.id && operation.intent_hash === leased.data.intent_hash)))
    // The returned one-time UNKNOWN lease may be newer than the displayed
    // SIGNING record. It permits recording the already-broadcast hash only;
    // it supplies neither a signature nor an executable transaction.
    const committedReplay = committedRequest?.identity === identity && committedRequest.key === request.key
      && committedRequest.command === request.command && savedRequest.current?.key === request.key
    if (!originalFundReplay && !committedReplay && !leasedMetadata && !commandAllowed(context, request.command)) {
      setMessage('This action is not available in your current workflow capacity. Refresh saved state or contact the responsible BlockXOne owner.')
      return false
    }
    lock.current = true; setBusy(true); setMessage('')
    let sent = false
    let hadPendingAttempt = Boolean(savedRequest.current)
    const attemptIdentity = identity
    const attemptGeneration = identityGeneration.current.epoch
    const isCurrent = () => activeIdentity.current === attemptIdentity && identityGeneration.current.epoch === attemptGeneration
    try {
      hadPendingAttempt ||= Boolean(reconcilePortalMarker(sessionStorage, context.actorId, context.requests, context))
      const prepared = await prepareDurablePortalCommand(sessionStorage, context.actorId, request, context.requests, context)
      if (!isCurrent()) return false
      savedRequest.current = prepared
      sent = true
      const snapshot = await postPortalCommand(prepared, context.operatingContext, context.actorId, context.stage2Access, context.offeringAccess, context.evaluationAccess, context.environment)
      if (!isCurrent()) return false
      if (committedReplay && (!completeCommitSnapshot(snapshot, context.actorId, context.operatingContext, context.environment)
        || !snapshotConfirmsRequest(snapshot, prepared))) throw new PortalCommittedRefreshRequiredError(prepared.command)
      clearPortalMarker(sessionStorage, context.actorId, prepared, context)
      savedRequest.current = null; setUnknown(false); setCommittedRequest(null); onSaved(snapshot); setMessage('Saved to your hosted workspace.'); return true
    } catch (error) {
      const definitive = typeof error === 'object' && error !== null && 'definitive' in error && error.definitive === true
      if (!isCurrent()) return false
      if (error instanceof PortalCommittedRefreshRequiredError && savedRequest.current) {
        if (context.environment === 'TESTNET' && ['review_application', 'create_investment_account'].includes(savedRequest.current.command)) {
          heldAdmissionRequests.set(markerKey(context.actorId, context), { key: savedRequest.current.key, command: savedRequest.current.command })
        }
        setCommittedRequest({ identity, key: savedRequest.current.key, command: savedRequest.current.command })
        setUnknown(false); setMessage(error.message); return false
      }
      if (committedReplay) {
        setUnknown(false); setMessage(`${savedCommandSubject(request.command)} was saved, but the updated workspace is still unavailable. Refresh the saved result before continuing.`); return false
      }
      if (mayDiscardDeniedPortalRequest(definitive, hadPendingAttempt) && savedRequest.current) { clearPortalMarker(sessionStorage, context.actorId, savedRequest.current, context); savedRequest.current = null }
      setUnknown(Boolean(savedRequest.current) && (hadPendingAttempt || (sent && !definitive)))
      setMessage(error instanceof Error ? error.message : 'The platform did not confirm the outcome. Retry the original saved request.')
      return false
    } finally { if (isCurrent()) { lock.current = false; setBusy(false) } }
  }
  async function submit(command: PortalCommand['command'], payload: Record<string, unknown>) {
    if (savedRequest.current) { setMessage('Resolve the original saved request before starting a new action.'); return false }
    const parsed = portalCommandSchema.safeParse({ command, key: crypto.randomUUID(), payload })
    if (!parsed.success) { setMessage(parsed.error.issues.map(issue => `${issue.path.filter(part => part !== 'payload').join(' ')}: ${issue.message}`).slice(0, 4).join(' · ')); return false }
    return dispatch(parsed.data)
  }
  async function recordFundTransaction(payload: Record<string, unknown>, lease: FundLifecycleOperation) {
    if (savedRequest.current) { setMessage('Resolve the original saved request before starting a new action.'); return false }
    const parsed = portalCommandSchema.safeParse({ command: 'record_fund_transaction', key: crypto.randomUUID(), payload })
    if (!parsed.success) { setMessage('The existing transaction hash and leased operation do not match. Refresh without executing again.'); return false }
    return dispatch(parsed.data, lease)
  }
  return { busy, message, unknown, committed: committedRequest?.identity === identity, submit, recordFundTransaction, retry: () => savedRequest.current ? dispatch(savedRequest.current) : Promise.resolve(false) }
}

export function CommandFeedback({ command }: { command: Pick<ReturnType<typeof usePortalCommand>, 'busy' | 'message' | 'unknown' | 'retry'> & { committed?: boolean } }) {
  return <div className={styles.statusRegion} role="status" aria-live="polite">{command.busy ? command.committed ? 'Refreshing the saved result…' : 'Saving securely to the hosted platform…' : command.message}{command.committed ? <div className={styles.sectionGap}><p className={styles.muted}>The change is saved. The updated workspace still needs to be confirmed; the original request is retained.</p><button className={styles.buttonSecondary} disabled={command.busy} type="button" onClick={() => void command.retry()}>Refresh saved result</button></div> : command.unknown ? <div className={styles.sectionGap}><p className={styles.muted}>The result is uncertain. Keep this page open; the original request key is retained so the action is not duplicated.</p><button className={styles.buttonSecondary} disabled={command.busy} type="button" onClick={() => void command.retry()}>Retry the original saved request</button></div> : null}</div>
}
