'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildDemoRequestPayload,
  createEmptyDemoRequestFormValues,
  DEMO_REQUEST_CONSENT_VERSION,
  DemoRequestSubmissionError,
  INSTRUMENT_INTEREST_OPTIONS,
  INVESTOR_CLASS_OPTIONS,
  isDemoRequestEnabled,
  resolveDemoRequestEndpoint,
  resolveDemoRequestPrivacyNoticeUrl,
  submitDemoRequest,
  TIMING_OPTIONS,
  type DemoRequestField,
  type DemoRequestFieldErrors,
  type DemoRequestFormValues,
  type DemoRequestResponse,
  type DemoRequestSubmissionIdentity,
  type InstrumentInterest,
  validateDemoRequestForm,
  VEHICLE_STAGE_OPTIONS,
} from '@/lib/demo-request'

const submissionStorageKey = 'blockxone.demo-request.submission.v1'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const fieldOrder: DemoRequestField[] = [
  'fullName',
  'workEmail',
  'organization',
  'roleTitle',
  'jurisdiction',
  'instrumentInterests',
  'vehicleStage',
  'investorClass',
  'timing',
  'currentSystems',
  'message',
  'consent',
]

const fieldIds: Record<Exclude<DemoRequestField, 'website'>, string> = {
  fullName: 'demo-full-name',
  workEmail: 'demo-work-email',
  organization: 'demo-organization',
  roleTitle: 'demo-role-title',
  jurisdiction: 'demo-jurisdiction',
  instrumentInterests: 'demo-instrument-interests',
  vehicleStage: 'demo-vehicle-stage',
  investorClass: 'demo-investor-class',
  currentSystems: 'demo-current-systems',
  timing: 'demo-timing',
  message: 'demo-message',
  consent: 'demo-consent',
}

function isSubmissionIdentity(value: unknown): value is DemoRequestSubmissionIdentity {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DemoRequestSubmissionIdentity>
  return (
    typeof candidate.idempotencyKey === 'string' &&
    uuidPattern.test(candidate.idempotencyKey) &&
    typeof candidate.formStartedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.formStartedAt))
  )
}

function createSubmissionIdentity(): DemoRequestSubmissionIdentity {
  return {
    idempotencyKey: window.crypto.randomUUID(),
    formStartedAt: new Date().toISOString(),
  }
}

function persistSubmissionIdentity(identity: DemoRequestSubmissionIdentity) {
  try {
    window.sessionStorage.setItem(submissionStorageKey, JSON.stringify(identity))
  } catch {
    // The in-memory identity still protects retries when storage is unavailable.
  }
}

function loadOrCreateSubmissionIdentity(): DemoRequestSubmissionIdentity {
  try {
    const stored = window.sessionStorage.getItem(submissionStorageKey)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (isSubmissionIdentity(parsed)) return parsed
    }
  } catch {
    // Replace unreadable or unavailable session storage with a fresh identity.
  }

  const identity = createSubmissionIdentity()
  persistSubmissionIdentity(identity)
  return identity
}

function clearSubmissionIdentity() {
  try {
    window.sessionStorage.removeItem(submissionStorageKey)
  } catch {
    // Success is authoritative even when browser storage cannot be cleared.
  }
}

function requiredMark() {
  return (
    <span className="ml-1 text-bxo-accent-primary" aria-hidden="true">
      *
    </span>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="mt-2 text-sm leading-6 text-bxo-danger-light" role="alert">
      {message}
    </p>
  )
}

function controlClass(hasError: boolean) {
  return [
    'mt-2 min-h-12 w-full rounded-md bg-bxo-bg-primary px-4 text-base text-bxo-text-primary',
    'placeholder:text-bxo-text-disabled transition-[border-color,box-shadow] duration-base',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bxo-bg-secondary',
    'disabled:cursor-not-allowed disabled:opacity-50',
    hasError
      ? 'border-bxo-danger-border focus-visible:border-bxo-danger focus-visible:ring-bxo-danger/40'
      : 'border-bxo-border-default focus-visible:border-bxo-accent-primary focus-visible:ring-bxo-accent-primary/35',
  ].join(' ')
}

function errorId(field: DemoRequestField) {
  return `demo-${field}-error`
}

export function DemoRequestForm() {
  const endpoint = resolveDemoRequestEndpoint()
  const privacyNoticeUrl = resolveDemoRequestPrivacyNoticeUrl()

  if (!isDemoRequestEnabled() || !endpoint || !privacyNoticeUrl) {
    return (
      <div className="bxo-panel overflow-hidden p-6 sm:p-8 lg:p-10" role="status" aria-labelledby="demo-unavailable-title">
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-bxo-warning-border bg-bxo-warning-dark/20 text-bxo-warning-light">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-8 font-display text-xs font-semibold uppercase tracking-[0.18em] text-bxo-warning-light">
          Enquiries
        </p>
        <h2 id="demo-unavailable-title" className="mt-3 font-display text-3xl font-semibold text-bxo-text-primary">
          Online enquiries are temporarily unavailable.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-8 text-bxo-text-secondary">
          No information has been submitted. Please try again later or explore the platform now.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-bxo-text-tertiary">
          BlockXOne reviews institutional platform enquiries against asset, jurisdiction, integration, operating-control, and implementation requirements.
        </p>
        <Button asChild variant="outline" className="bxo-secondary-cta mt-8 h-12 rounded-sm px-6">
          <Link href="/how-it-works">Explore the platform</Link>
        </Button>
      </div>
    )
  }

  return <ConfiguredDemoRequestForm endpoint={endpoint} privacyNoticeUrl={privacyNoticeUrl} />
}

type SubmissionFailure = {
  title: string
  message: string
}

function ConfiguredDemoRequestForm({
  endpoint,
  privacyNoticeUrl,
}: {
  endpoint: string
  privacyNoticeUrl: string
}) {
  const [values, setValues] = useState<DemoRequestFormValues>(() => createEmptyDemoRequestFormValues())
  const [identity, setIdentity] = useState<DemoRequestSubmissionIdentity | null>(null)
  const [errors, setErrors] = useState<DemoRequestFieldErrors>({})
  const [touched, setTouched] = useState<Partial<Record<DemoRequestField, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submissionFailure, setSubmissionFailure] = useState<SubmissionFailure | null>(null)
  const [success, setSuccess] = useState<DemoRequestResponse | null>(null)
  const hasNetworkAttempt = useRef(false)
  const successRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIdentity(loadOrCreateSubmissionIdentity())
  }, [])

  useEffect(() => {
    if (success) successRef.current?.focus()
  }, [success])

  function rotateIdentityAfterRevision() {
    if (!hasNetworkAttempt.current) return
    hasNetworkAttempt.current = false
    const nextIdentity = createSubmissionIdentity()
    persistSubmissionIdentity(nextIdentity)
    setIdentity(nextIdentity)
  }

  function updateField<Field extends DemoRequestField>(field: Field, value: DemoRequestFormValues[Field]) {
    rotateIdentityAfterRevision()
    const nextValues = { ...values, [field]: value }
    setValues(nextValues)
    setSubmissionFailure(null)
    if (submitAttempted || touched[field]) {
      setErrors(validateDemoRequestForm(nextValues).errors)
    }
  }

  function markTouched(field: DemoRequestField) {
    setTouched((current) => ({ ...current, [field]: true }))
    setErrors(validateDemoRequestForm(values).errors)
  }

  function visibleError(field: DemoRequestField) {
    return submitAttempted || touched[field] ? errors[field] : undefined
  }

  function focusFirstError(nextErrors: DemoRequestFieldErrors) {
    const firstField = fieldOrder.find((field) => nextErrors[field])
    if (!firstField || firstField === 'website') return
    window.requestAnimationFrame(() => document.getElementById(fieldIds[firstField])?.focus())
  }

  function toggleInstrumentInterest(interest: InstrumentInterest) {
    const selected = values.instrumentInterests.includes(interest)
    if (!selected && values.instrumentInterests.length >= 3) return
    updateField(
      'instrumentInterests',
      selected
        ? values.instrumentInterests.filter((value) => value !== interest)
        : [...values.instrumentInterests, interest],
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    setSubmissionFailure(null)

    const validation = validateDemoRequestForm(values)
    setErrors(validation.errors)
    if (!validation.valid) {
      focusFirstError(validation.errors)
      return
    }

    const activeIdentity = identity ?? loadOrCreateSubmissionIdentity()
    if (!identity) setIdentity(activeIdentity)
    const payload = buildDemoRequestPayload(values, activeIdentity)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15_000)

    setSubmitting(true)
    hasNetworkAttempt.current = true
    try {
      const response = await submitDemoRequest(payload, { endpoint, signal: controller.signal })
      clearSubmissionIdentity()
      setSuccess(response)
    } catch (error) {
      setSubmitting(false)
      if (error instanceof DemoRequestSubmissionError) {
        if (error.kind === 'invalid_request') {
          const nextErrors = { ...validation.errors, ...error.fields }
          setErrors(nextErrors)
          setTouched((current) => {
            const next = { ...current }
            for (const field of Object.keys(error.fields) as DemoRequestField[]) next[field] = true
            return next
          })
          setSubmissionFailure({
            title: 'Request needs changes',
            message: 'The intake service did not accept this request. Review the highlighted fields and try again.',
          })
          focusFirstError(nextErrors)
          return
        }
        if (error.kind === 'rate_limited') {
          setSubmissionFailure({
            title: 'Request not accepted',
            message: 'The intake service is limiting requests. Please wait a few minutes, then try again.',
          })
          return
        }
      }
      setSubmissionFailure({
        title: 'Delivery not confirmed',
        message: 'This page did not receive a valid confirmation from the intake service. Your details remain in this browser form. Try again when the service is available; an unchanged retry is protected against duplicate entries.',
      })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  if (success) {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        className="bxo-panel overflow-hidden p-6 outline-none sm:p-8 lg:p-10"
        aria-labelledby="demo-success-title"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-bxo-accent-primary/30 bg-bxo-accent-soft text-bxo-accent-primary">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-8 font-display text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">
          Request confirmed
        </p>
        <h2 id="demo-success-title" className="mt-3 font-display text-3xl font-semibold text-bxo-text-primary">
          Thank you. The intake service accepted your request.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-8 text-bxo-text-secondary">
          We will review the scope you shared and contact you through your work email if BlockXOne is a relevant fit.
        </p>
        <div className="mt-8 rounded-md border border-bxo-border-subtle bg-bxo-bg-primary p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bxo-text-tertiary">Request reference</p>
          <p className="mt-2 break-all font-mono text-sm text-bxo-text-primary">{success.requestId}</p>
        </div>
        <Button asChild variant="outline" className="bxo-secondary-cta mt-8 h-12 rounded-sm px-6">
          <Link href="/">Return to overview</Link>
        </Button>
      </div>
    )
  }

  const instrumentError = visibleError('instrumentInterests')

  return (
    <form className="bxo-panel p-5 sm:p-8 lg:p-10" noValidate onSubmit={handleSubmit}>
      <div className="border-b border-bxo-border-subtle pb-7">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">
          Institutional platform enquiry
        </p>
        <h2 className="mt-3 font-display text-2xl font-semibold text-bxo-text-primary sm:text-3xl">
          Tell us about the first transaction you are evaluating.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-bxo-text-secondary">
          Share the asset, participants, jurisdiction, systems, and operating workflow you need to support. Required fields are marked with an asterisk. This form does not create an account, approve onboarding, or make an investment offer.
        </p>
      </div>

      {submitAttempted && Object.keys(errors).length > 0 ? (
        <div className="mt-6 rounded-md border border-bxo-danger-border bg-bxo-danger-soft p-4" role="alert" tabIndex={-1}>
          <p className="font-semibold text-bxo-danger-light">Check the highlighted fields.</p>
          <p className="mt-1 text-sm leading-6 text-bxo-text-secondary">Correct the details below, then send the request again.</p>
        </div>
      ) : null}

      {submissionFailure ? (
        <div className="mt-6 rounded-md border border-bxo-danger-border bg-bxo-danger-soft p-4" role="alert">
          <p className="font-semibold text-bxo-danger-light">{submissionFailure.title}</p>
          <p className="mt-1 text-sm leading-6 text-bxo-text-secondary">{submissionFailure.message}</p>
        </div>
      ) : null}

      <fieldset className="mt-8 space-y-10" disabled={submitting}>
        <legend className="sr-only">Platform enquiry details</legend>

        <section aria-labelledby="demo-contact-heading">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bxo-text-tertiary">01</p>
            <h3 id="demo-contact-heading" className="mt-2 text-lg font-semibold text-bxo-text-primary">Your details</h3>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={fieldIds.fullName} className="text-sm font-semibold text-bxo-text-secondary">
                Full name{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <Input
                id={fieldIds.fullName}
                name="fullName"
                autoComplete="name"
                maxLength={120}
                value={values.fullName}
                onChange={(event) => updateField('fullName', event.target.value)}
                onBlur={() => markTouched('fullName')}
                aria-invalid={Boolean(visibleError('fullName'))}
                aria-describedby={visibleError('fullName') ? errorId('fullName') : undefined}
                className={controlClass(Boolean(visibleError('fullName')))}
                required
              />
              <FieldError id={errorId('fullName')} message={visibleError('fullName')} />
            </div>

            <div>
              <label htmlFor={fieldIds.workEmail} className="text-sm font-semibold text-bxo-text-secondary">
                Work email{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <Input
                id={fieldIds.workEmail}
                name="workEmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                value={values.workEmail}
                onChange={(event) => updateField('workEmail', event.target.value)}
                onBlur={() => markTouched('workEmail')}
                aria-invalid={Boolean(visibleError('workEmail'))}
                aria-describedby={visibleError('workEmail') ? errorId('workEmail') : undefined}
                className={controlClass(Boolean(visibleError('workEmail')))}
                required
              />
              <FieldError id={errorId('workEmail')} message={visibleError('workEmail')} />
            </div>

            <div>
              <label htmlFor={fieldIds.organization} className="text-sm font-semibold text-bxo-text-secondary">
                Organization{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <Input
                id={fieldIds.organization}
                name="organization"
                autoComplete="organization"
                maxLength={160}
                value={values.organization}
                onChange={(event) => updateField('organization', event.target.value)}
                onBlur={() => markTouched('organization')}
                aria-invalid={Boolean(visibleError('organization'))}
                aria-describedby={visibleError('organization') ? errorId('organization') : undefined}
                className={controlClass(Boolean(visibleError('organization')))}
                required
              />
              <FieldError id={errorId('organization')} message={visibleError('organization')} />
            </div>

            <div>
              <label htmlFor={fieldIds.roleTitle} className="text-sm font-semibold text-bxo-text-secondary">
                Role or title{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <Input
                id={fieldIds.roleTitle}
                name="roleTitle"
                autoComplete="organization-title"
                maxLength={120}
                value={values.roleTitle}
                onChange={(event) => updateField('roleTitle', event.target.value)}
                onBlur={() => markTouched('roleTitle')}
                aria-invalid={Boolean(visibleError('roleTitle'))}
                aria-describedby={visibleError('roleTitle') ? errorId('roleTitle') : undefined}
                className={controlClass(Boolean(visibleError('roleTitle')))}
                required
              />
              <FieldError id={errorId('roleTitle')} message={visibleError('roleTitle')} />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor={fieldIds.jurisdiction} className="text-sm font-semibold text-bxo-text-secondary">
                Primary jurisdiction{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <Input
                id={fieldIds.jurisdiction}
                name="jurisdiction"
                autoComplete="country-name"
                maxLength={120}
                placeholder="Country or primary legal jurisdiction"
                value={values.jurisdiction}
                onChange={(event) => updateField('jurisdiction', event.target.value)}
                onBlur={() => markTouched('jurisdiction')}
                aria-invalid={Boolean(visibleError('jurisdiction'))}
                aria-describedby={visibleError('jurisdiction') ? errorId('jurisdiction') : undefined}
                className={controlClass(Boolean(visibleError('jurisdiction')))}
                required
              />
              <FieldError id={errorId('jurisdiction')} message={visibleError('jurisdiction')} />
            </div>
          </div>
        </section>

        <section aria-labelledby="demo-scope-heading">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bxo-text-tertiary">02</p>
            <h3 id="demo-scope-heading" className="mt-2 text-lg font-semibold text-bxo-text-primary">Transaction scope</h3>
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p id="demo-instrument-label" className="text-sm font-semibold text-bxo-text-secondary">
                Instrument interests{requiredMark()}<span className="sr-only"> (required)</span>
              </p>
              <p id="demo-instrument-hint" className="text-xs text-bxo-text-tertiary">
                Select 1 to 3 · {values.instrumentInterests.length}/3 selected
              </p>
            </div>
            <div
              id={fieldIds.instrumentInterests}
              role="group"
              aria-labelledby="demo-instrument-label"
              aria-describedby={`demo-instrument-hint${instrumentError ? ` ${errorId('instrumentInterests')}` : ''}`}
              tabIndex={-1}
              className="mt-3 grid gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary sm:grid-cols-2"
            >
              {INSTRUMENT_INTEREST_OPTIONS.map((option) => {
                const selected = values.instrumentInterests.includes(option.value)
                const disabled = !selected && values.instrumentInterests.length >= 3
                return (
                  <label
                    key={option.value}
                    className={`flex min-h-12 items-center gap-3 rounded-md border px-4 py-3 text-sm transition-[border-color,background-color,color] duration-base ${
                      selected
                        ? 'border-bxo-accent-primary bg-bxo-accent-soft text-bxo-text-primary'
                        : 'border-bxo-border-subtle bg-bxo-bg-primary text-bxo-text-secondary hover:border-bxo-border-default'
                    } ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      name="instrumentInterests"
                      value={option.value}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => toggleInstrumentInterest(option.value)}
                      onBlur={() => markTouched('instrumentInterests')}
                      className="h-5 w-5 rounded border-bxo-border-strong bg-bxo-bg-primary text-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-primary focus:ring-offset-2 focus:ring-offset-bxo-bg-secondary"
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>
            <FieldError id={errorId('instrumentInterests')} message={instrumentError} />
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={fieldIds.vehicleStage} className="text-sm font-semibold text-bxo-text-secondary">
                Vehicle stage{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <select
                id={fieldIds.vehicleStage}
                name="vehicleStage"
                value={values.vehicleStage}
                onChange={(event) => updateField('vehicleStage', event.target.value as DemoRequestFormValues['vehicleStage'])}
                onBlur={() => markTouched('vehicleStage')}
                aria-invalid={Boolean(visibleError('vehicleStage'))}
                aria-describedby={visibleError('vehicleStage') ? errorId('vehicleStage') : undefined}
                className={controlClass(Boolean(visibleError('vehicleStage')))}
                required
              >
                <option value="">Select a stage</option>
                {VEHICLE_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <FieldError id={errorId('vehicleStage')} message={visibleError('vehicleStage')} />
            </div>

            <div>
              <label htmlFor={fieldIds.investorClass} className="text-sm font-semibold text-bxo-text-secondary">
                Intended investor class{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <select
                id={fieldIds.investorClass}
                name="investorClass"
                value={values.investorClass}
                onChange={(event) => updateField('investorClass', event.target.value as DemoRequestFormValues['investorClass'])}
                onBlur={() => markTouched('investorClass')}
                aria-invalid={Boolean(visibleError('investorClass'))}
                aria-describedby={visibleError('investorClass') ? errorId('investorClass') : undefined}
                className={controlClass(Boolean(visibleError('investorClass')))}
                required
              >
                <option value="">Select an investor class</option>
                {INVESTOR_CLASS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <FieldError id={errorId('investorClass')} message={visibleError('investorClass')} />
            </div>

            <div>
              <label htmlFor={fieldIds.timing} className="text-sm font-semibold text-bxo-text-secondary">
                Intended timing{requiredMark()}<span className="sr-only"> (required)</span>
              </label>
              <select
                id={fieldIds.timing}
                name="timing"
                value={values.timing}
                onChange={(event) => updateField('timing', event.target.value as DemoRequestFormValues['timing'])}
                onBlur={() => markTouched('timing')}
                aria-invalid={Boolean(visibleError('timing'))}
                aria-describedby={visibleError('timing') ? errorId('timing') : undefined}
                className={controlClass(Boolean(visibleError('timing')))}
                required
              >
                <option value="">Select a timeframe</option>
                {TIMING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <FieldError id={errorId('timing')} message={visibleError('timing')} />
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-end justify-between gap-3">
                <label htmlFor={fieldIds.currentSystems} className="text-sm font-semibold text-bxo-text-secondary">
                  Current systems <span className="font-normal text-bxo-text-tertiary">(optional)</span>
                </label>
                <span className="text-xs tabular-nums text-bxo-text-tertiary">{values.currentSystems.length}/500</span>
              </div>
              <textarea
                id={fieldIds.currentSystems}
                name="currentSystems"
                rows={3}
                maxLength={500}
                placeholder="For example: CRM, transfer agency, fund administration or reporting tools"
                value={values.currentSystems}
                onChange={(event) => updateField('currentSystems', event.target.value)}
                onBlur={() => markTouched('currentSystems')}
                aria-invalid={Boolean(visibleError('currentSystems'))}
                aria-describedby={visibleError('currentSystems') ? errorId('currentSystems') : undefined}
                className={`${controlClass(Boolean(visibleError('currentSystems')))} min-h-28 py-3`}
              />
              <FieldError id={errorId('currentSystems')} message={visibleError('currentSystems')} />
            </div>
          </div>
        </section>

        <section aria-labelledby="demo-context-heading">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bxo-text-tertiary">03</p>
            <h3 id="demo-context-heading" className="mt-2 text-lg font-semibold text-bxo-text-primary">Additional context</h3>
          </div>

          <div className="mt-5 rounded-md border border-bxo-warning-border bg-bxo-warning-dark/20 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bxo-warning-light" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-bxo-warning-light">Keep this high level.</p>
                <p id="demo-sensitive-data-warning" className="mt-1 text-sm leading-6 text-bxo-text-secondary">
                  Do not include investor names, identity documents, account or bank details, wallet credentials, private keys, or confidential transaction documents.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-end justify-between gap-3">
              <label htmlFor={fieldIds.message} className="text-sm font-semibold text-bxo-text-secondary">
                What would a useful walkthrough cover? <span className="font-normal text-bxo-text-tertiary">(optional)</span>
              </label>
              <span className="text-xs tabular-nums text-bxo-text-tertiary">{values.message.length}/1,000</span>
            </div>
            <textarea
              id={fieldIds.message}
              name="message"
              rows={5}
              maxLength={1000}
              placeholder="Share the workflow, operating challenge, or decision you want the walkthrough to address."
              value={values.message}
              onChange={(event) => updateField('message', event.target.value)}
              onBlur={() => markTouched('message')}
              aria-invalid={Boolean(visibleError('message'))}
              aria-describedby={`demo-sensitive-data-warning${visibleError('message') ? ` ${errorId('message')}` : ''}`}
              className={`${controlClass(Boolean(visibleError('message')))} min-h-36 py-3`}
            />
            <FieldError id={errorId('message')} message={visibleError('message')} />
          </div>

          <div className="mt-5">
            <label
              htmlFor={fieldIds.consent}
              className={`flex cursor-pointer gap-3 rounded-md border p-4 transition-[border-color,background-color] duration-base ${
                visibleError('consent') ? 'border-bxo-danger-border bg-bxo-danger-soft' : 'border-bxo-border-subtle bg-bxo-bg-primary hover:border-bxo-border-default'
              }`}
            >
              <input
                id={fieldIds.consent}
                name="consent"
                type="checkbox"
                checked={values.consent}
                onChange={(event) => updateField('consent', event.target.checked)}
                onBlur={() => markTouched('consent')}
                aria-invalid={Boolean(visibleError('consent'))}
                aria-describedby={visibleError('consent') ? errorId('consent') : 'demo-consent-description'}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-bxo-border-strong bg-bxo-bg-primary text-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-primary focus:ring-offset-2 focus:ring-offset-bxo-bg-secondary"
                required
              />
              <span id="demo-consent-description" className="text-sm leading-6 text-bxo-text-secondary">
                I have read the{' '}
                <a
                  href={privacyNoticeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-bxo-accent-primary underline decoration-bxo-accent-primary/50 underline-offset-4 hover:text-bxo-accent-primary-light"
                >
                  platform enquiry privacy notice
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{' '}
                (version {DEMO_REQUEST_CONSENT_VERSION}) and consent to BlockXOne using these details to assess this request and contact me about the platform. I understand this is not an offer, onboarding approval, or investment advice.{requiredMark()}
                <span className="sr-only"> (required)</span>
              </span>
            </label>
            <FieldError id={errorId('consent')} message={visibleError('consent')} />
          </div>
        </section>

        <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor="demo-website">Website</label>
          <input
            id="demo-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(event) => updateField('website', event.target.value)}
          />
        </div>

        <div className="border-t border-bxo-border-subtle pt-7">
          <Button type="submit" className="bxo-primary-cta h-12 w-full rounded-sm px-6 sm:w-auto" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Sending request…
              </>
            ) : (
              <>
                Send request
                <ArrowRight className="ml-2 h-4 w-4" data-bxo-motion-arrow aria-hidden="true" />
              </>
            )}
          </Button>
          <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-bxo-text-tertiary">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-bxo-accent-primary" aria-hidden="true" />
            <p>Your request is reviewed for fit. BlockXOne does not ask for passwords, private keys, identity documents, or payment through this form.</p>
          </div>
        </div>
      </fieldset>
    </form>
  )
}
