'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, CircleDashed, LockKeyhole, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi } from '@/lib/api-client'
import { baseUnitsToExactDecimal, formatExactMoney, formatExactUnits } from '@/lib/exact-decimal'
import { managedTestnet, networkTargetLabel } from '@/lib/managed-testnets'
import { type OfferingReadiness, type TypedOffering } from '@/lib/pilot-finance'
import { localDeploymentIdempotencyKey } from '@/lib/token-operations'

function pretty(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function entries(value: object | null | undefined) {
  return value ? Object.entries(value) : []
}

export default function FundManagementPage() {
  const params = useParams()
  const offeringId = params.id as string
  const { user, loading: authLoading } = useAuth()
  const [offering, setOffering] = useState<TypedOffering | null>(null)
  const [readiness, setReadiness] = useState<OfferingReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [deploymentEvidence, setDeploymentEvidence] = useState<{
    tokenContract: string
    identityRegistry: string
    compliance: string
    transactionHash: string
  } | null>(null)
  const loadRequestId = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current
    if (!user) {
      setOffering(null)
      setReadiness(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setOffering(null)
    setReadiness(null)
    setDeploymentEvidence(null)
    setError('')
    try {
      const [offeringRecord, readinessRecord] = await Promise.all([
        blockXOneApi.offering.get(user.token, offeringId),
        blockXOneApi.offering.readiness(user.token, offeringId),
      ])
      if (requestId !== loadRequestId.current) return
      setOffering(offeringRecord)
      setReadiness(readinessRecord)
    } catch (caught) {
      if (requestId !== loadRequestId.current) return
      setOffering(null)
      setReadiness(null)
      setError(caught instanceof Error ? caught.message : 'Unable to load offering evidence.')
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [offeringId, user])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  const classTerms = useMemo(() => {
    const terms = offering?.instrument_terms
    if (!terms) return null
    return terms.private_debt_terms || terms.fund_interest_terms || terms.real_estate_spv_terms || null
  }, [offering])

  async function activateProfile() {
    if (!user || !readiness?.financial_profile || working) return
    setWorking(true)
    setError('')
    setMessage('')
    try {
      await blockXOneApi.offering.activateFinancialProfile(
        user.token,
        offeringId,
        readiness.financial_profile.id
      )
      setMessage('The financial profile is ACTIVE. The exact checker identity and timestamp are now part of the readiness record.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to activate the financial profile.')
    } finally {
      setWorking(false)
    }
  }

  async function deployLocalToken() {
    if (!user || !offering || !readiness || working) return
    setWorking(true)
    setError('')
    setMessage('')
    try {
      const prefix =
        readiness.asset_class === 'PRIVATE_DEBT_NOTE'
          ? 'BXOD'
          : readiness.asset_class === 'FUND_INTEREST'
            ? 'BXOF'
            : 'BXOR'
      const suffix = offering.id.replaceAll('-', '').slice(0, 6).toUpperCase()
      const result = await blockXOneApi.offering.deployLocalERC3643(
        user.token,
        offeringId,
        {
          symbol: `${prefix}${suffix}`,
          decimals: offering.instrument_terms.common_terms.token_decimals,
          idempotency_key: localDeploymentIdempotencyKey(offeringId),
        }
      )
      setDeploymentEvidence({
        tokenContract: result.token_contract,
        identityRegistry: result.identity_registry,
        compliance: result.compliance,
        transactionHash: result.tx_hash,
      })
      setMessage('The zero-supply ERC-3643 token was deployed on the private validation chain and bound to the bootstrap identity and compliance contracts.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to deploy the local ERC-3643 token.')
    } finally {
      setWorking(false)
    }
  }

  if (authLoading || loading) {
    return <main className="min-h-screen bg-bxo-bg-primary p-12 text-bxo-text-secondary">Loading authoritative terms and readiness…</main>
  }

  if (!offering || !readiness) {
    return (
      <main className="min-h-screen bg-bxo-bg-primary px-4 py-16 text-bxo-text-primary">
        <section className="mx-auto max-w-3xl bxo-panel p-8">
          <h1 className="font-display text-3xl font-bold">Offering evidence unavailable</h1>
          <p role="alert" className="mt-3 text-bxo-danger-light">{error || 'The API did not return a typed offering.'}</p>
          <Button asChild className="mt-6"><Link href="/wm/funds">Return to pipeline</Link></Button>
        </section>
      </main>
    )
  }

  const terms = offering.instrument_terms
  const profile = readiness.financial_profile
  const makerCannotApprove = profile?.prepared_by_user_id === user?.id
  const canActivate =
    profile?.status === 'DRAFT' &&
    user?.permissions?.['financial_profile:approve'] === true &&
    !makerCannotApprove
  const canDeploy =
    offering.status === 'DRAFT' &&
    readiness.runtime_scope === 'LOCAL_PILOT' &&
    !readiness.token_deployed &&
    user?.permissions?.['tokenops:deploy_erc3643'] === true
  const testnetTarget = managedTestnet(offering.chain_id)
  const hasLocalContractRecord = readiness.runtime_scope === 'LOCAL_PILOT' && readiness.token_deployed
  const hasTestnetContractRecord = readiness.runtime_scope === 'TESTNET' && readiness.token_deployed
  const hasDeploymentProof = hasLocalContractRecord || hasTestnetContractRecord

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <Link href="/wm/funds" className="inline-flex min-h-11 items-center gap-2 text-sm text-bxo-text-secondary hover:text-bxo-text-primary">
          <ArrowLeft className="h-4 w-4" />Back to pipeline
        </Link>

        <header className="bxo-panel p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-xs font-semibold text-bxo-accent-primary">{pretty(readiness.asset_class)}</span>
            <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs">{readiness.runtime_scope === 'TESTNET' ? 'Public testnet' : 'Private validation network'}</span>
            <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs">{pretty(offering.status)}</span>
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold">{offering.name}</h1>
          <p className="mt-3 max-w-3xl leading-7 text-bxo-text-secondary">{offering.description}</p>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Exact unit price</dt><dd className="mt-2 font-mono">{formatExactMoney(offering.price, offering.currency)}</dd></div>
            <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Network target</dt><dd className="mt-2 font-mono">{networkTargetLabel(offering.chain_id)}</dd></div>
            <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Payment mode</dt><dd className="mt-2">{profile?.consideration_source === 'TEST_PROVIDER' ? 'Stripe TEST provider evidence' : profile?.consideration_source === 'SYNTHETIC_TEST' ? 'Independent synthetic evidence, no payment provider' : 'Not configured'}</dd><p className="mt-1 text-xs text-bxo-warning-light">No real funds are accepted or settled</p></div>
          </dl>
        </header>

        {error ? <div role="alert" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{error}</div> : null}
        {message ? <div role="status" className="rounded-xl border border-bxo-success/30 bg-bxo-success/10 p-4 text-sm text-bxo-success-light">{message}</div> : null}

        <section className="grid gap-5 lg:grid-cols-3">
          {[
            { label: 'Terms approval', ready: readiness.terms_approved, detail: `v${readiness.instrument_terms_version}` },
            { label: 'Financial profile', ready: readiness.financial_profile_active, detail: profile?.status || 'MISSING' },
            { label: 'Subscription intake', ready: readiness.subscription_enabled, detail: readiness.subscription_enabled ? 'ENABLED' : 'BLOCKED' },
          ].map((item) => (
            <div key={item.label} className={`rounded-2xl border p-5 ${item.ready ? 'border-bxo-success/30 bg-bxo-success/10' : 'border-bxo-warning-border bg-bxo-warning/10'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">{item.ready ? <CheckCircle2 className="h-4 w-4 text-bxo-success-light" /> : <CircleDashed className="h-4 w-4 text-bxo-warning-light" />}{item.label}</div>
              <p className="mt-3 font-mono text-sm">{item.detail}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="bxo-panel p-6">
            <h2 className="font-display text-2xl font-bold">Immutable instrument terms</h2>
            <p className="mt-2 break-all font-mono text-xs text-bxo-text-tertiary">SHA-256 {readiness.instrument_terms_sha256}</p>
            <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary">Common</h3>
            <dl className="mt-3 divide-y divide-bxo-divider">
              {entries(terms.common_terms).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <dt className="text-bxo-text-tertiary">{pretty(label)}</dt>
                  <dd className="break-all text-right font-mono">
                    {label === 'authorized_units_base_units'
                      ? `${formatExactUnits(baseUnitsToExactDecimal(String(value), terms.common_terms.token_decimals))} units`
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary">Class-specific</h3>
            <dl className="mt-3 divide-y divide-bxo-divider">
              {entries(classTerms).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <dt className="text-bxo-text-tertiary">{pretty(label)}</dt>
                  <dd className="max-w-[55%] break-all text-right font-mono">{String(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 grid gap-2 text-xs text-bxo-text-tertiary">
              <p>Maker: <span className="break-all font-mono">{terms.prepared_by_user_id}</span></p>
              <p>Checker: <span className="break-all font-mono">{terms.approved_by_user_id || 'Not approved'}</span></p>
              <p>Approved: <span className="font-mono">{terms.approved_at || 'Not approved'}</span></p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="bxo-panel p-6">
              <h2 className="font-display text-2xl font-bold">Financial profile evidence</h2>
              {profile ? (
                <>
                  <dl className="mt-5 space-y-3 text-sm">
                    <div><dt className="text-bxo-text-tertiary">Profile ID</dt><dd className="mt-1 break-all font-mono">{profile.id}</dd></div>
                    <div><dt className="text-bxo-text-tertiary">Terms binding</dt><dd className="mt-1 break-all font-mono">v{profile.terms_version} · {profile.terms_sha256}</dd></div>
                    <div><dt className="text-bxo-text-tertiary">Payment mode</dt><dd className="mt-1">{profile.consideration_source === 'TEST_PROVIDER' ? 'Stripe TEST provider evidence' : profile.consideration_source === 'SYNTHETIC_TEST' ? 'Independent synthetic evidence, no payment provider' : 'Configured evidence source'}</dd></div>
                    <div><dt className="text-bxo-text-tertiary">Maker</dt><dd className="mt-1 break-all font-mono">{profile.prepared_by_user_id}</dd></div>
                    <div><dt className="text-bxo-text-tertiary">Checker</dt><dd className="mt-1 break-all font-mono">{profile.approved_by_user_id || 'Independent checker required'}</dd></div>
                  </dl>
                  {profile.status === 'DRAFT' ? (
                    <div className="mt-6">
                      <Button onClick={() => void activateProfile()} disabled={!canActivate || working}>
                        {working ? 'Activating…' : makerCannotApprove ? 'Maker cannot activate' : 'Activate exact profile'}
                      </Button>
                      {!canActivate ? <p className="mt-3 flex items-center gap-2 text-xs text-bxo-text-tertiary"><LockKeyhole className="h-4 w-4" />Requires financial_profile:approve and a different user.</p> : null}
                    </div>
                  ) : null}
                </>
              ) : <p className="mt-4 text-sm text-bxo-warning-light">No financial profile is bound to this offering.</p>}
            </div>

            <div className="bxo-panel p-6">
              <h2 className="font-display text-2xl font-bold">Chain evidence</h2>
              <div className={`mt-4 flex gap-3 rounded-xl border p-4 ${hasDeploymentProof ? 'border-bxo-success/30 bg-bxo-success/10' : 'border-bxo-warning-border bg-bxo-warning/10'}`}>
                <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${hasDeploymentProof ? 'text-bxo-success-light' : 'text-bxo-warning'}`} />
                <div className="text-sm leading-6 text-bxo-text-secondary">
                  <p className="font-semibold text-bxo-text-primary">{testnetTarget ? hasTestnetContractRecord ? `${testnetTarget.name} deployment evidenced` : `${testnetTarget.name} target configured. Deployment not yet evidenced` : hasLocalContractRecord ? 'Private validation token deployment evidenced' : 'Deployment required before publish'}</p>
                  <p className="mt-1">{testnetTarget ? hasTestnetContractRecord ? `Chain ${testnetTarget.chainId} has finalized deployment evidence bound to the active network, factory, and child-token manifests.` : `Chain ${testnetTarget.chainId} is configuration only on this page. Completion requires a finalized transaction, successful receipt, active manifests, and network finality evidence.` : hasLocalContractRecord ? 'The confirmed deployment operation, transaction, exact token address, identity registry, and compliance addresses are authoritative application records. Subscription issuance still requires its own exact mint receipt and legal-register evidence.' : 'A network target alone is not a deployment. A Tokenisation Agent must deploy zero initial supply against the configured identity and compliance manifest.'}</p>
                </div>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <div><dt className="text-bxo-text-tertiary">Token contract record</dt><dd className="mt-1 break-all font-mono">{offering.token_contract || 'None'}</dd></div>
                <div><dt className="text-bxo-text-tertiary">Compliance registry</dt><dd className="mt-1 break-all font-mono">{offering.compliance_registry || 'Not configured'}</dd></div>
                <div><dt className="text-bxo-text-tertiary">Deployment transaction record</dt><dd className="mt-1 break-all font-mono">{deploymentEvidence?.transactionHash || offering.deployment_transaction_hash || 'None'}</dd></div>
              </dl>
              {!readiness.token_deployed && readiness.runtime_scope === 'LOCAL_PILOT' ? (
                <div className="mt-6">
                  <Button onClick={() => void deployLocalToken()} disabled={!canDeploy || working}>
                    {working ? 'Deploying and waiting for receipt…' : canDeploy ? 'Deploy zero-supply token' : 'Tokenisation Agent required'}
                  </Button>
                  <p className="mt-3 text-xs text-bxo-text-tertiary">Private validation network only. The platform supplies the exact registry and compliance addresses from the configured manifest; callers cannot substitute them.</p>
                </div>
              ) : !readiness.token_deployed && readiness.runtime_scope === 'TESTNET' ? (
                <div className="mt-6 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4">
                  <p className="text-sm font-semibold text-bxo-text-primary">Governed deployment handoff required</p>
                  <p className="mt-2 text-xs leading-5 text-bxo-text-secondary">
                    An authorised Tokenisation Agent must create the bound deployment operation in its deployment queue. A different authorised checker must approve the immutable operation before signing and broadcast.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
