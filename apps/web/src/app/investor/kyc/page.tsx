'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi } from '@/lib/api-client'

const STORAGE_KEY = 'bx_kyc_case_id'

type Questionnaire = {
  residency: string
  pep: string
  sourceOfFunds: string
  employmentStatus: string
  taxNumber: string
}

const DEFAULT_Q: Questionnaire = {
  residency: '',
  pep: '',
  sourceOfFunds: '',
  employmentStatus: '',
  taxNumber: '',
}

export default function KycPage() {
  const { user } = useAuth()
  const [caseId, setCaseId] = useState<string | null>(null)
  const [frontId, setFrontId] = useState<File | null>(null)
  const [backId, setBackId] = useState<File | null>(null)
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(DEFAULT_Q)
  const [status, setStatus] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingCase, setLoadingCase] = useState(false)

  const loggedIn = useMemo(() => Boolean(user?.id), [user])

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (stored) setCaseId(stored)
  }, [])

  const handleFile = (fileList: FileList | null, setter: (f: File | null) => void) => {
    const f = fileList && fileList[0]
    setter(f || null)
  }

  const startCase = async (): Promise<string | null> => {
    if (!user) {
      setStatus('Login required before starting KYC')
      return null
    }
    setLoadingCase(true)
    setStatus('Creating case...')
    try {
      const res = await blockXOneApi.kyc.createCase(user.id, user.email, 'KYC')
      const id = (res as any)?.id || (res as any)?.case_id || ''
      if (!id) throw new Error('Case id missing in response')
      setCaseId(id)
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id)
      setStatus('Case created. Upload documents and submit.')
      return id
    } catch (e: any) {
      setStatus(e?.message || 'Failed to create case')
      return null
    } finally {
      setLoadingCase(false)
    }
  }

  const submitCase = async () => {
    if (!user) {
      setStatus('Login required before submitting')
      return
    }
    if (!frontId || !backId) {
      setStatus('Upload front and back of your ID')
      return
    }
    if (!questionnaire.residency || !questionnaire.sourceOfFunds || !questionnaire.employmentStatus) {
      setStatus('Please complete all questionnaire answers')
      return
    }
    const currentCaseId = caseId || (await startCase())
    if (!currentCaseId) return

    setSubmitting(true)
    setStatus('Submitting to Compliance...')
    try {
      await blockXOneApi.kyc.submitCase(user.id, user.email, currentCaseId)
      setStatus('Submitted. Awaiting Compliance review.')
    } catch (e: any) {
      setStatus(e?.message || 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const resetCase = () => {
    setFrontId(null)
    setBackId(null)
    setQuestionnaire(DEFAULT_Q)
    setStatus('')
    setCaseId(null)
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-[#0D0F14] text-white">
        <div className="max-w-3xl mx-auto px-4 py-16 space-y-6">
          <h1 className="text-4xl font-bold">Investor KYC</h1>
          <p className="text-muted-foreground">Login as an Investor to start KYC and unlock funding workflows.</p>
          <Button asChild>
            <Link href="/login">Go to login</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
        <div className="flex flex-col gap-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Investor onboarding
          </div>
          <h1 className="text-4xl font-bold">KYC verification</h1>
          <p className="text-muted-foreground max-w-3xl">
            Upload your ID (front and back) and answer a short questionnaire. We will route the case to Compliance.
          </p>
          <div className="text-sm text-muted-foreground">Case: {caseId || 'not created yet'}</div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="p-6 space-y-4 bg-white/5 border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Identity documents</h2>
                <p className="text-sm text-muted-foreground">Accepted: PNG, JPG, PDF up to 10 MB.</p>
              </div>
              <Button variant="secondary" onClick={startCase} disabled={loadingCase}>
                {caseId ? 'Recreate case' : 'Create case'}
              </Button>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">ID front</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleFile(e.target.files, setFrontId)}
                className="w-full text-sm"
              />
              {frontId ? <div className="text-xs text-muted-foreground">Selected: {frontId.name}</div> : null}
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">ID back</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleFile(e.target.files, setBackId)}
                className="w-full text-sm"
              />
              {backId ? <div className="text-xs text-muted-foreground">Selected: {backId.name}</div> : null}
            </div>

            <div className="rounded-lg bg-white/5 border border-white/10 p-3 text-xs text-muted-foreground">
              Files stay on your device for this demo; submission calls the backend KYC case endpoint.
            </div>
          </Card>

          <Card className="p-6 space-y-4 bg-white/5 border-white/10">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Questionnaire</h2>
              <Button variant="ghost" size="sm" onClick={resetCase}>Reset</Button>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Country of tax residency</label>
              <Input
                placeholder="e.g. South Africa"
                value={questionnaire.residency}
                onChange={(e) => setQuestionnaire({ ...questionnaire, residency: e.target.value })}
              />
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Politically Exposed Person (PEP)?</label>
              <Input
                placeholder="No / Yes (details)"
                value={questionnaire.pep}
                onChange={(e) => setQuestionnaire({ ...questionnaire, pep: e.target.value })}
              />
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Source of funds</label>
              <Input
                placeholder="Salary, investments, etc"
                value={questionnaire.sourceOfFunds}
                onChange={(e) => setQuestionnaire({ ...questionnaire, sourceOfFunds: e.target.value })}
              />
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Employment status</label>
              <Input
                placeholder="Employed, self-employed, retired"
                value={questionnaire.employmentStatus}
                onChange={(e) => setQuestionnaire({ ...questionnaire, employmentStatus: e.target.value })}
              />
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium">Tax number</label>
              <Input
                placeholder="Optional"
                value={questionnaire.taxNumber}
                onChange={(e) => setQuestionnaire({ ...questionnaire, taxNumber: e.target.value })}
              />
            </div>
          </Card>
        </div>

        <Card className="p-6 bg-white/5 border-white/10 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Ready to submit?</div>
              <div className="text-lg font-semibold">Send to Compliance once docs and answers are in.</div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={startCase} disabled={loadingCase}>
                {caseId ? 'Case created' : 'Create case'}
              </Button>
              <Button onClick={submitCase} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit to Compliance'}
              </Button>
            </div>
          </div>
          {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
        </Card>
      </div>
    </div>
  )
}
