'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi, type KycCase } from '@/lib/api-client'

type KycCreateCaseResponse = {
  id?: string
  case_id?: string
  status?: KycCase['status']
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return fallback
}

export default function KycPage() {
  const { user } = useAuth()
  const [caseId, setCaseId] = useState<string | null>(null)
  const [caseStatus, setCaseStatus] = useState<KycCase['status'] | null>(null)
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingCurrent, setLoadingCurrent] = useState(false)
  const [currentLoadFailed, setCurrentLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const loggedIn = useMemo(() => Boolean(user?.id), [user])

  useEffect(() => {
    let active = true
    setCaseId(null)
    setCaseStatus(null)
    setStatus('')
    setCurrentLoadFailed(false)
    if (!user) return () => { active = false }

    setLoadingCurrent(true)
    void blockXOneApi.kyc
      .currentCase(user.token)
      .then((response) => {
        if (!active) return
        const kycCase = response.case
        if (!kycCase) {
          setStatus('No eligibility review exists for this account.')
          return
        }
        setCaseId(kycCase.id)
        setCaseStatus(kycCase.status)
        setStatus(`Authoritative case status: ${kycCase.status}.`)
      })
      .catch((error) => {
        if (!active) return
        setCurrentLoadFailed(true)
        setStatus(getErrorMessage(error, 'Unable to load the current case from the backend.'))
      })
      .finally(() => {
        if (active) setLoadingCurrent(false)
      })

    return () => {
      active = false
    }
  }, [loadAttempt, user])

  const startCase = async () => {
    if (!user) {
      setStatus('Login required before starting an eligibility review.')
      return
    }

    setCreating(true)
    setStatus('Creating eligibility review...')
    try {
      const response = await blockXOneApi.kyc.createCase(
        user.token,
        'KYC'
      ) as KycCreateCaseResponse
      const id = response.id || response.case_id || ''
      if (!id) throw new Error('Case ID missing in response')

      setCaseId(id)
      setCaseStatus(response.status || 'DRAFT')
      setStatus('Eligibility review created. It is ready to submit to the review queue.')
    } catch (error) {
      setStatus(getErrorMessage(error, 'Failed to create eligibility review'))
    } finally {
      setCreating(false)
    }
  }

  const submitCase = async () => {
    if (!user || !caseId) {
      setStatus('Create an eligibility review before submitting it.')
      return
    }

    setSubmitting(true)
    setStatus('Submitting eligibility review...')
    try {
      await blockXOneApi.kyc.submitCase(user.token, caseId)
      setCaseStatus('SUBMITTED')
      setStatus('Submitted. Awaiting authorised review.')
    } catch (error) {
      setStatus(getErrorMessage(error, 'Submit failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-16">
          <h1 className="font-display text-4xl font-bold">Investor qualification</h1>
          <p className="text-bxo-text-secondary">
            Sign in with an assigned investor account before starting the eligibility workflow.
          </p>
          <Button asChild>
            <Link href="/investor/login">Go to investor login</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-12">
        <div className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-sm font-medium text-bxo-accent-primary">
            <span className="h-2 w-2 rounded-full bg-bxo-accent-primary" />
            Investor qualification
          </div>
          <h1 className="font-display text-4xl font-bold">Investor eligibility review</h1>
          <p className="max-w-3xl leading-7 text-bxo-text-secondary">
            This environment records the eligibility workflow without collecting identity files, tax numbers,
            source-of-funds answers, or other sensitive personal data.
          </p>
        </div>

        <Card className="bxo-panel space-y-6 p-6 sm:p-8">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">
              Identity data boundary
            </div>
            <h2 className="font-display text-2xl font-semibold">No document upload in this environment</h2>
            <p className="text-sm leading-7 text-bxo-text-secondary">
              Use only the assigned test identity for this account. Do not submit real personal information.
              External identity verification and document retention are not connected in this environment.
            </p>
          </div>

          <div className="rounded-xl border border-bxo-border-subtle bg-bxo-surface p-4">
            <div className="text-xs uppercase tracking-[0.14em] text-bxo-text-tertiary">Current case</div>
            <div className="mt-2 break-all font-mono text-sm text-bxo-text-primary">
              {loadingCurrent
                ? 'Loading current case from PostgreSQL...'
                : caseId || 'No eligibility review created'}
            </div>
            {caseStatus ? (
              <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary">
                Backend status: {caseStatus}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={startCase}
              disabled={
                creating ||
                submitting ||
                loadingCurrent ||
                currentLoadFailed ||
                Boolean(caseId)
              }
            >
              {creating
                ? 'Creating...'
                : loadingCurrent
                  ? 'Checking current case...'
                  : caseId
                    ? 'Case created'
                    : 'Create review case'}
            </Button>
            <Button
              variant="secondary"
              onClick={submitCase}
              disabled={
                !caseId ||
                creating ||
                submitting ||
                (caseStatus !== 'DRAFT' && caseStatus !== 'REJECTED')
              }
            >
              {submitting ? 'Submitting...' : 'Submit for review'}
            </Button>
            {currentLoadFailed ? (
              <Button
                variant="secondary"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                disabled={loadingCurrent || creating || submitting}
              >
                Retry current case lookup
              </Button>
            ) : null}
          </div>

          {status ? (
            <div
              aria-live="polite"
              className="rounded-xl border border-bxo-accent-border bg-bxo-accent-soft px-4 py-3 text-sm text-bxo-text-secondary"
              role="status"
            >
              {status}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
