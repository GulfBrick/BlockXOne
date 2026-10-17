'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { portalContextKey, type PortalOperatingContext } from '@/lib/portal/operating-context'
import styles from './portal.module.css'

const reference = z.string().uuid()
const subjectSchema = z.object({ configured: z.boolean(), enabled: z.boolean(), level_present: z.boolean().nullable(),
  provider_subject_type: z.enum(['individual', 'company', 'UNKNOWN']).nullable(),
  classifier: z.enum(['LEVEL_NOT_CONFIGURED', 'SUBJECT_DISABLED', 'CONNECTION_NOT_VERIFIED', 'LEVEL_NOT_FOUND',
    'LEVEL_AMBIGUOUS', 'LEVEL_SUBJECT_MISMATCH', 'LEVEL_SUBJECT_UNCONFIRMED', 'LEVEL_PRESENT']),
}).strict()
const sumsubSchema = z.object({ actor_id: reference, provider: z.literal('SUMSUB'), environment: z.literal('TESTNET'),
  status: z.enum(['CONNECTED', 'NOT_CONFIGURED', 'UNAVAILABLE']),
  classifier: z.enum(['AUTHENTICATED_LEVELS_READ', 'CREDENTIALS_NOT_CONFIGURED', 'CREDENTIALS_REJECTED',
    'PROVIDER_ACCESS_DENIED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE_INVALID']),
  sandbox_enabled: z.boolean(), individual: subjectSchema, company: subjectSchema,
  available_levels: z.array(z.object({ name: z.string().min(1).max(120), applicant_type: z.enum(['individual', 'company', 'UNKNOWN']) }).strict()).max(200),
  webhook: z.object({ configured: z.boolean(), delivery_proved: z.literal(false) }).strict(),
  evidence_writer: z.object({ configured: z.boolean(), connection_proved: z.literal(false) }).strict(),
  verification_proved: z.literal(false), admission_granted: z.literal(false),
}).strict().refine(value => (value.status === 'CONNECTED') === (value.classifier === 'AUTHENTICATED_LEVELS_READ'))
const docusignSchema = z.object({ environment: z.literal('TESTNET'), provider: z.literal('DOCUSIGN'),
  check: z.literal('SANDBOX_AUTHENTICATION_ONLY'), status: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  classifier: z.enum(['AUTHENTICATED', 'NOT_CONFIGURED', 'AUTHENTICATION_UNAVAILABLE', 'ACCOUNT_MISMATCH',
    'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE_INVALID', 'THROTTLED']), checkedAt: z.string().datetime(),
}).strict().refine(value => (value.status === 'AVAILABLE') === (value.classifier === 'AUTHENTICATED'))
type Result = z.infer<typeof sumsubSchema> | z.infer<typeof docusignSchema>
type Props = { provider: 'SUMSUB' | 'DOCUSIGN'; actorId: string; context?: PortalOperatingContext;
  environment?: PlatformEnvironment; productId?: string; revisionId?: string; productRevision?: number }
type CheckState = { identity: string; status: 'BUSY' | 'COMPLETE' | 'FAILED'; result?: Result; message?: string }
const responseLimit = 65_536

async function boundedJson(response: Response): Promise<unknown> {
  if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error()
  const length = response.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > responseLimit)) throw new Error()
  const reader = response.body?.getReader()
  if (!reader) throw new Error()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > responseLimit) throw new Error()
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

function subjectStatus(subject: z.infer<typeof subjectSchema>, type: 'individual' | 'company') {
  if (!subject.enabled) return 'Not enabled in this sandbox.'
  if (!subject.configured) return 'Verification level is not configured.'
  if (subject.classifier === 'LEVEL_PRESENT' && subject.level_present === true && subject.provider_subject_type === type)
    return 'Configured level confirmed. An applicant must still complete verification.'
  if (subject.level_present === false) return 'Configured verification level was not found. The integration owner must correct it.'
  return 'Verification level or subject type is not confirmed. The integration owner must check it.'
}

function unavailableMessage(result: Result) {
  if (result.classifier === 'NOT_CONFIGURED' || result.classifier === 'CREDENTIALS_NOT_CONFIGURED')
    return 'The sandbox connection is not configured. The integration owner must finish setup.'
  if (['CREDENTIALS_REJECTED', 'PROVIDER_ACCESS_DENIED', 'AUTHENTICATION_UNAVAILABLE', 'ACCOUNT_MISMATCH'].includes(result.classifier))
    return 'The provider could not authenticate the configured sandbox account. The integration owner must check its connection.'
  if (result.classifier === 'THROTTLED' || result.classifier === 'PROVIDER_RATE_LIMITED')
    return 'The provider has temporarily limited requests. Wait before checking again.'
  return 'The sandbox connection could not be confirmed. Try again; contact the integration owner if it continues.'
}

/** A user-triggered connection read, never a provider result or activation action. */
export function ProviderConnectionCheck({ provider, actorId, context, environment, productId, revisionId, productRevision }: Props) {
  const eligible = environment === 'TESTNET' && reference.safeParse(actorId).success && context?.mode === 'ROLE'
    && reference.safeParse(context.organisationId).success && (provider === 'SUMSUB' ? context.role === 'ComplianceOfficer'
      : context.role === 'OfferingManager' && reference.safeParse(productId).success && reference.safeParse(revisionId).success
        && Number.isSafeInteger(productRevision) && Number(productRevision) > 0)
  const identity = JSON.stringify([provider, actorId, environment, context && portalContextKey(context), productId, revisionId, productRevision, eligible])
  const identityRef = useRef(identity); identityRef.current = identity
  const generation = useRef(0), controllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<CheckState | null>(null)
  const current = state?.identity === identity ? state : null
  useEffect(() => {
    ++generation.current; controllerRef.current?.abort(); controllerRef.current = null; setState(null)
    return () => { ++generation.current; controllerRef.current?.abort(); controllerRef.current = null }
  }, [identity])

  async function check() {
    if (!eligible || context?.mode !== 'ROLE' || current?.status === 'BUSY') return
    const expectedIdentity = identity, attempt = ++generation.current, controller = new AbortController()
    controllerRef.current?.abort(); controllerRef.current = controller
    const timeout = setTimeout(() => controller.abort(), 30_000)
    const stillCurrent = () => identityRef.current === expectedIdentity && generation.current === attempt && !controller.signal.aborted
    setState({ identity: expectedIdentity, status: 'BUSY' })
    try {
      const query = new URLSearchParams({ product_id: productId ?? '', revision_id: revisionId ?? '', organisation: context.organisationId,
        role: 'OfferingManager', expected_actor: actorId })
      const url = provider === 'SUMSUB' ? '/api/portal/kyc/readiness' : `/api/portal/offering-signatures/provider-status?${query}`
      const response = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'x-bx1-expected-actor': actorId }, signal: controller.signal })
      if (response.status === 401 || response.status === 403) {
        if (stillCurrent()) setState({ identity: expectedIdentity, status: 'FAILED', message: 'Your session or access changed. Refresh this workspace and complete sign-in verification before checking again.' })
        return
      }
      const body = await boundedJson(response)
      const parsed = provider === 'SUMSUB' ? sumsubSchema.safeParse(body) : docusignSchema.safeParse(body)
      if (!parsed.success || parsed.data.provider === 'SUMSUB' && parsed.data.actor_id !== actorId
        || provider === 'SUMSUB' && !response.ok
        || provider === 'DOCUSIGN' && response.status !== (parsed.data.status === 'AVAILABLE' ? 200 : 503)) throw new Error()
      if (stillCurrent()) setState({ identity: expectedIdentity, status: 'COMPLETE', result: parsed.data })
    } catch {
      if (identityRef.current === expectedIdentity && generation.current === attempt)
        setState({ identity: expectedIdentity, status: 'FAILED', message: 'The connection check could not finish. Try again from this workspace; no verification or signing action was sent.' })
    } finally {
      clearTimeout(timeout)
      if (generation.current === attempt) controllerRef.current = null
    }
  }

  if (!eligible) return null
  const name = provider === 'SUMSUB' ? 'Sumsub' : 'DocuSign'
  const result = current?.status === 'COMPLETE' ? current.result : undefined
  const connected = result?.provider === 'SUMSUB' ? result.status === 'CONNECTED' : result?.status === 'AVAILABLE'
  return <section className={styles.stack} aria-label={`${name} sandbox connection`}>
    <h3>{name} sandbox connection</h3>
    <div className={styles.actions}><button type="button" className={styles.buttonSecondary} disabled={current?.status === 'BUSY'} onClick={() => void check()}>
      {current?.status === 'BUSY' ? `Checking ${name} connection…` : `Check ${name} sandbox connection`}
    </button></div>
    <div role="status" aria-live="polite">
      {current?.status === 'BUSY' ? <p>Checking the configured sandbox account…</p> : null}
      {current?.status === 'FAILED' ? <p className={styles.fieldError}>{current.message}</p> : null}
      {result ? <>
        <p>{connected ? `${name} sandbox authentication confirmed.` : unavailableMessage(result)}</p>
        {result.provider === 'SUMSUB' ? <>
          {!result.sandbox_enabled ? <p>Sumsub verification is not enabled in this TEST application.</p> : null}
          <p><strong>Individual verification:</strong> {subjectStatus(result.individual, 'individual')}</p>
          <p><strong>Company verification:</strong> {subjectStatus(result.company, 'company')}</p>
        </> : null}
      </> : null}
    </div>
    <p className={styles.muted}>{provider === 'SUMSUB'
      ? 'A connection check does not verify an applicant or approve an application.'
      : 'Authentication does not enable signature processing, create an envelope or prove a completed signature.'}</p>
  </section>
}
