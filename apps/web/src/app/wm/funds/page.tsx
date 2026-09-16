'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { BadgeCheck, LockKeyhole, Plus, RefreshCw, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi } from '@/lib/api-client'
import { formatExactMoney } from '@/lib/exact-decimal'
import { networkTargetLabel } from '@/lib/managed-testnets'
import { presentPilotRecordName } from '@/lib/pilot-record-presentation'
import {
  activeInstrumentTerms,
  draftInstrumentTerms,
  termsCheckerStatus,
  type InstrumentRecord,
  type OfferingReadiness,
  type TypedOffering,
} from '@/lib/pilot-finance'

type OfferingWithReadiness = TypedOffering & { readiness: OfferingReadiness | null }

function prettyLabel(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function statusClass(ready: boolean) {
  return ready
    ? 'border-bxo-success/30 bg-bxo-success/10 text-bxo-success-light'
    : 'border-bxo-warning-border bg-bxo-warning/10 text-bxo-warning-light'
}

export default function OfferingManagerListPage() {
  const searchParams = useSearchParams()
  const createdInstrument = searchParams.get('instrument')
  const { user, loading: authLoading } = useAuth()
  const [instruments, setInstruments] = useState<InstrumentRecord[]>([])
  const [offerings, setOfferings] = useState<OfferingWithReadiness[]>([])
  const [instrumentsLoaded, setInstrumentsLoaded] = useState(false)
  const [offeringsLoaded, setOfferingsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [workingId, setWorkingId] = useState('')
  const [notice, setNotice] = useState('')

  const loadPipeline = useCallback(async () => {
    if (!user) return
    setIsLoading(true)
    setInstruments([])
    setOfferings([])
    setInstrumentsLoaded(false)
    setOfferingsLoaded(false)
    setError('')
    try {
      const [instrumentResult, offeringResult] = await Promise.allSettled([
        blockXOneApi.instrument.list(user.token),
        user.permissions?.['offering:view'] === true
          ? blockXOneApi.offering.listAll(user.token)
          : blockXOneApi.offering.list(user.token),
      ])
      const failures: string[] = []

      if (instrumentResult.status === 'fulfilled' && Array.isArray(instrumentResult.value)) {
        setInstruments(instrumentResult.value)
        setInstrumentsLoaded(true)
      } else {
        failures.push(
          instrumentResult.status === 'rejected' && instrumentResult.reason instanceof Error
            ? instrumentResult.reason.message
            : 'Authoritative instruments are unavailable.'
        )
      }

      if (offeringResult.status === 'fulfilled' && Array.isArray(offeringResult.value)) {
        const typedOfferings = offeringResult.value.filter((row) => row.instrument_id)
        const readinessResults = await Promise.allSettled(
          typedOfferings.map((offering) =>
            blockXOneApi.offering.readiness(user.token, offering.id)
          )
        )
        const readinessRows = typedOfferings.map((offering, index) => {
          const result = readinessResults[index]
          return {
            ...offering,
            readiness: result.status === 'fulfilled' ? result.value : null,
          }
        })
        if (readinessResults.some((result) => result.status === 'rejected')) {
          failures.push('One or more offering readiness records are unavailable.')
        }
        setOfferings(readinessRows)
        setOfferingsLoaded(true)
      } else {
        failures.push(
          offeringResult.status === 'rejected' && offeringResult.reason instanceof Error
            ? offeringResult.reason.message
            : 'Authoritative offerings are unavailable.'
        )
      }

      if (failures.length > 0) setError(failures.join(' '))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the controlled pipeline.')
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (authLoading) return
    void loadPipeline()
  }, [authLoading, loadPipeline])

  async function approveTerms(instrument: InstrumentRecord) {
    if (!user) return
    const terms = draftInstrumentTerms(instrument)
    if (!terms) return
    setWorkingId(terms.id)
    setError('')
    setNotice('')
    try {
      await blockXOneApi.instrument.approveTerms(user.token, instrument.id, terms.id)
      setNotice(`Terms ${terms.id} are ACTIVE. The maker can now prepare an offering against that exact version.`)
      await loadPipeline()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to approve the terms.')
    } finally {
      setWorkingId('')
    }
  }

  async function activateProfile(offering: OfferingWithReadiness) {
    if (!user || !offering.readiness?.financial_profile) return
    const profile = offering.readiness.financial_profile
    setWorkingId(profile.id)
    setError('')
    setNotice('')
    try {
      await blockXOneApi.offering.activateFinancialProfile(user.token, offering.id, profile.id)
      setNotice(`Financial profile ${profile.id} is ACTIVE. Deploy the zero-supply token and publish the offering before subscription intake becomes enabled.`)
      await loadPipeline()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to activate the financial profile.')
    } finally {
      setWorkingId('')
    }
  }

  async function publishOffering(offering: OfferingWithReadiness) {
    if (!user) return
    setWorkingId(offering.id)
    setError('')
    setNotice('')
    try {
      await blockXOneApi.offering.publish(user.token, offering.id)
      setNotice(`Offering ${offering.id} is LIVE in the controlled investor market.`)
      await loadPipeline()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to publish the offering.')
    } finally {
      setWorkingId('')
    }
  }

  const canApproveTerms = user?.permissions?.['offering:publish'] === true
  const canApproveProfile = user?.permissions?.['financial_profile:approve'] === true
  const canPrepareOffering = user?.permissions?.['offering:create'] === true
  const canPublishOffering = user?.permissions?.['offering:publish'] === true
  const createdInstrumentRecord =
    instrumentsLoaded && createdInstrument
      ? instruments.find((record) => record.id === createdInstrument)
      : null
  const createdInstrumentNotice =
    createdInstrumentRecord && draftInstrumentTerms(createdInstrumentRecord)
      ? `Instrument ${createdInstrumentRecord.id} has immutable DRAFT terms and now requires an independent checker.`
      : ''
  const displayedNotice = notice || createdInstrumentNotice

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-4">
            <div className="bxo-kicker">Multi-asset control plane</div>
            <div>
              <h1 className="font-display text-4xl font-bold tracking-tight">Instrument and offering pipeline</h1>
              <p className="mt-3 max-w-3xl leading-7 text-bxo-text-secondary">
                Immutable terms, financial profiles and publication each have a visible maker-checker boundary.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={isLoading} onClick={() => void loadPipeline()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {canPrepareOffering ? (
              <Button asChild className="bxo-primary-cta text-bxo-bg-primary">
                <Link href="/wm/funds/new"><Plus className="mr-2 h-4 w-4" />New instrument</Link>
              </Button>
            ) : null}
          </div>
        </header>

        {displayedNotice ? (
          <div role="status" className="flex gap-3 rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4 text-sm">
            <BadgeCheck className="h-5 w-5 shrink-0 text-bxo-accent-primary" />
            <span className="break-all">{displayedNotice}</span>
          </div>
        ) : null}
        {error ? <div role="alert" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{error}</div> : null}

        <section className="bxo-panel overflow-hidden">
          <div className="border-b border-bxo-border-subtle px-5 py-4">
            <h2 className="font-display text-xl font-bold">1. Governed instruments</h2>
            <p className="mt-1 text-sm text-bxo-text-tertiary">Three supported asset classes with immutable, versioned terms.</p>
          </div>
          {isLoading ? (
            <div className="p-8 text-bxo-text-secondary">Loading authoritative instruments…</div>
          ) : !instrumentsLoaded ? (
            <div className="p-8 text-center text-bxo-warning-light">Authoritative instruments are unavailable. Refresh before relying on this pipeline.</div>
          ) : instruments.length === 0 ? (
            <div className="p-8 text-center text-bxo-text-secondary">No typed instruments have been created.</div>
          ) : (
            <div className="divide-y divide-bxo-divider">
              {instruments.map((instrument) => {
                const active = activeInstrumentTerms(instrument)
                const draft = draftInstrumentTerms(instrument)
                const checker = draft && user ? termsCheckerStatus(draft, user.id) : null
                const presentation = presentPilotRecordName(instrument.name)
                return (
                  <article key={instrument.id} className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-xl font-bold">{presentation.displayName}</h3>
                        <span className="rounded-full border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-xs font-semibold text-bxo-accent-primary">{prettyLabel(instrument.asset_class)}</span>
                        <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs">{instrument.runtime_scope === 'TESTNET' ? 'Public testnet' : 'Private validation network'}</span>
                      </div>
                      <p className="break-all font-mono text-xs text-bxo-text-tertiary">
                        Instrument record: {instrument.id}
                      </p>
                      <p className="text-sm leading-6 text-bxo-text-secondary">{instrument.description}</p>
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(Boolean(active))}`}>
                          Terms {active ? `approved · v${active.version}` : `draft · v${draft?.version ?? 'Not available'}`}
                        </span>
                        {draft ? <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs">{checker === 'MAKER_CANNOT_APPROVE' ? 'A different authorised approver is required' : 'Independent approval required'}</span> : null}
                      </div>
                      <p className="break-all font-mono text-xs text-bxo-text-tertiary">Terms hash: {active?.terms_sha256 || draft?.terms_sha256 || 'Unavailable'}</p>
                    </div>
                    <div className="flex flex-wrap gap-3 lg:justify-end">
                      {draft ? (
                        <Button
                          disabled={!canApproveTerms || checker === 'MAKER_CANNOT_APPROVE' || workingId === draft.id}
                          onClick={() => void approveTerms(instrument)}
                        >
                          {workingId === draft.id ? 'Approving…' : 'Approve exact terms'}
                        </Button>
                      ) : null}
                      {active && canPrepareOffering ? (
                        <Button asChild variant="outline">
                          <Link href={`/wm/funds/new?instrument=${encodeURIComponent(instrument.id)}`}>Prepare offering</Link>
                        </Button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="bxo-panel overflow-hidden">
          <div className="border-b border-bxo-border-subtle px-5 py-4">
            <h2 className="font-display text-xl font-bold">2. Offerings and ledger profiles</h2>
            <p className="mt-1 text-sm text-bxo-text-tertiary">Approved terms and an active financial profile are required before subscriptions.</p>
          </div>
          {isLoading ? (
            <div className="p-8 text-bxo-text-secondary">Loading offering readiness…</div>
          ) : !offeringsLoaded ? (
            <div className="p-8 text-center text-bxo-warning-light">Authoritative offerings are unavailable. Refresh before relying on this pipeline.</div>
          ) : offerings.length === 0 ? (
            <div className="p-8 text-center text-bxo-text-secondary">No typed offerings have been prepared.</div>
          ) : (
            <div className="divide-y divide-bxo-divider">
              {offerings.map((offering) => {
                const readiness = offering.readiness
                const profile = readiness?.financial_profile
                const sameProfileMaker = profile?.prepared_by_user_id === user?.id
                const presentation = presentPilotRecordName(offering.name)
                return (
                  <article key={offering.id} className="grid gap-5 p-5 xl:grid-cols-[1fr_auto] xl:items-center">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/wm/funds/${offering.id}`} className="font-display text-xl font-bold hover:text-bxo-accent-primary">{presentation.displayName}</Link>
                        <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs font-semibold">{prettyLabel(offering.status)}</span>
                        <span className="rounded-full border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-xs text-bxo-accent-primary">{offering.runtime_scope === 'TESTNET' ? 'Public testnet' : 'Private validation network'}</span>
                      </div>
                      <p className="break-all font-mono text-xs text-bxo-text-tertiary">
                        Offering record: {offering.id}
                      </p>
                      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                        <div><dt className="inline text-bxo-text-tertiary">Price: </dt><dd className="inline font-mono">{formatExactMoney(offering.price, offering.currency)}</dd></div>
                        <div><dt className="inline text-bxo-text-tertiary">Network target: </dt><dd className="inline font-mono">{networkTargetLabel(offering.chain_id)}</dd></div>
                        <div><dt className="inline text-bxo-text-tertiary">Consideration mode: </dt><dd className="inline">{profile?.consideration_source === 'TEST_PROVIDER' ? 'Stripe TEST provider evidence' : profile?.consideration_source === 'SYNTHETIC_TEST' ? 'Independent synthetic evidence, no payment provider' : 'Not configured'} · no real funds accepted</dd></div>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        {readiness ? (
                          <>
                            <span className={`rounded-full border px-3 py-1 text-xs ${statusClass(readiness.terms_approved)}`}>Terms {readiness.terms_approved ? 'approved' : 'blocked'}</span>
                            <span className={`rounded-full border px-3 py-1 text-xs ${statusClass(readiness.financial_profile_active)}`}>Profile {readiness.financial_profile_active ? 'active' : profile?.status === 'DRAFT' ? 'draft' : 'missing'}</span>
                            <span className={`rounded-full border px-3 py-1 text-xs ${statusClass(readiness.subscription_enabled)}`}>Subscriptions {readiness.subscription_enabled ? 'enabled' : 'blocked'}</span>
                          </>
                        ) : (
                          <span className="rounded-full border border-bxo-warning-border bg-bxo-warning/10 px-3 py-1 text-xs text-bxo-warning-light">Readiness unavailable</span>
                        )}
                      </div>
                      {profile ? <p className="break-all font-mono text-xs text-bxo-text-tertiary">Profile {profile.id} · terms hash {profile.terms_sha256}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-3 xl:justify-end">
                      <Button asChild variant="outline"><Link href={`/wm/funds/${offering.id}`}>View evidence</Link></Button>
                      {readiness && !profile && offering.status === 'DRAFT' && canPrepareOffering ? (
                        <Button asChild variant="outline">
                          <Link href={`/wm/funds/new?offering=${encodeURIComponent(offering.id)}`}>
                            Complete financial profile
                          </Link>
                        </Button>
                      ) : null}
                      {profile?.status === 'DRAFT' ? (
                        <Button
                          disabled={!canApproveProfile || sameProfileMaker || workingId === profile.id}
                          onClick={() => void activateProfile(offering)}
                        >
                          {workingId === profile.id ? 'Activating…' : sameProfileMaker ? 'Checker required' : 'Activate profile'}
                        </Button>
                      ) : null}
                      {offering.status === 'DRAFT' ? (
                        <Button
                          disabled={!canPublishOffering || !readiness?.publish_ready || workingId === offering.id}
                          onClick={() => void publishOffering(offering)}
                        >
                          {workingId === offering.id ? 'Publishing…' : 'Publish'}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <div className="flex gap-3 rounded-xl border border-bxo-warning-border bg-bxo-surface p-4 text-sm leading-6 text-bxo-text-secondary">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-bxo-warning" />
          <p>
            Private validation records use independent synthetic evidence with no payment provider. Stripe TEST records are provider-backed test evidence, never proof of settled bank cash. A public testnet target is not a completed deployment; only a finalized chain operation with transaction and network finality evidence proves completion.
          </p>
        </div>
        {!canApproveTerms || !canApproveProfile || !canPrepareOffering || !canPublishOffering ? (
          <p className="flex items-center gap-2 text-xs text-bxo-text-tertiary"><LockKeyhole className="h-4 w-4" />Buttons remain capability-gated by the verified JWT permissions.</p>
        ) : null}
      </div>
    </main>
  )
}
