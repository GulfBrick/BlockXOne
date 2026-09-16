'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, BadgeCheck, CircleDashed, CreditCard, FileText, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi, investorCatalogApi } from '@/lib/api-client'
import {
  baseUnitsToExactDecimal,
  formatExactMoney,
  formatExactUnits,
  parseExactDecimal,
} from '@/lib/exact-decimal'
import { networkTargetLabel } from '@/lib/managed-testnets'
import {
  clearExactInvestorSubscriptionRetryIntent,
  createInvestorSubscriptionRetryIntent,
  investorSubscriptionIntentMatches,
  loadInvestorSubscriptionRetryIntent,
  persistInvestorSubscriptionRetryIntent,
  withAuthoritativeSubscriptionId,
  type InvestorSubscriptionRetryIntent,
} from '@/lib/investor-subscription-retry'
import {
  chainEvidenceLabel,
  newIdempotencyKey,
  quoteInvestorCatalogSubscription,
  type ControlledSubscription,
  type CreatedControlledSubscription,
  type InvestorCatalogOfferingDetail,
  type InvestorCatalogReadiness,
} from '@/lib/pilot-finance'

function pretty(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function evidenceValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  return String(value)
}

const SUBSCRIPTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function preserveSubscriptionIdInUrl(subscriptionId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('subscription_id', subscriptionId)
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    )
    return true
  } catch {
    return false
  }
}

export default function InvestorOfferingDetailPage() {
  const params = useParams()
  const offeringId = params.id as string
  const { user, loading: authLoading } = useAuth()
  const [offering, setOffering] = useState<InvestorCatalogOfferingDetail | null>(null)
  const [readiness, setReadiness] = useState<InvestorCatalogReadiness | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [units, setUnits] = useState('1')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [created, setCreated] = useState<CreatedControlledSubscription | null>(null)
  const [controlled, setControlled] = useState<ControlledSubscription | null>(null)
  const [refreshingEvidence, setRefreshingEvidence] = useState(false)
  const [openingCheckout, setOpeningCheckout] = useState(false)
  const [checkoutReturn, setCheckoutReturn] = useState<'success' | 'cancelled' | ''>('')
  const [retryReady, setRetryReady] = useState(false)
  const [pendingRetry, setPendingRetry] = useState<InvestorSubscriptionRetryIntent | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setOffering(null)
      setReadiness(null)
      setCreated(null)
      setControlled(null)
      setPendingRetry(null)
      setRetryReady(false)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setOffering(null)
    setReadiness(null)
    setCreated(null)
    setControlled(null)
    setPendingRetry(null)
    setRetryReady(false)
    setSubmitError('')
    setCheckoutReturn('')
    setLoadError('')
    void Promise.all([
      investorCatalogApi.get(user.token, offeringId),
      investorCatalogApi.readiness(user.token, offeringId),
    ])
      .then(([offeringRecord, readinessRecord]) => {
        if (!cancelled) {
          setOffering(offeringRecord)
          setReadiness(readinessRecord)
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setOffering(null)
          setReadiness(null)
          setLoadError(caught instanceof Error ? caught.message : 'Unable to load this offering.')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, offeringId, user])

  const parsedUnits = useMemo(() => parseExactDecimal(units), [units])
  const totalAmount = useMemo(() => {
    if (!offering || !parsedUnits) return null
    return quoteInvestorCatalogSubscription(
      parsedUnits.canonical,
      offering.terms,
      offering.financial_profile
    )
  }, [offering, parsedUnits])
  const minimumUnits = offering
    ? baseUnitsToExactDecimal(
        offering.financial_profile.minimum_subscription_asset_units,
        offering.terms.common_terms.token_decimals
      )
    : null
  const maximumUnits = offering
    ? baseUnitsToExactDecimal(
        offering.financial_profile.maximum_subscription_asset_units,
        offering.terms.common_terms.token_decimals
      )
    : null
  const pendingRetryMatchesCurrent = pendingRetry === null || (
    user !== null &&
    offering !== null &&
    parsedUnits !== null &&
    totalAmount !== null &&
    pendingRetry.subscriptionId === undefined &&
    investorSubscriptionIntentMatches(pendingRetry, {
      userId: user.id,
      offeringId: offering.id,
      units: parsedUnits.canonical,
      amount: totalAmount,
    })
  )
  const canSubscribe =
    readiness?.offering_live === true &&
    readiness.subscription_ready === true &&
    parsedUnits !== null &&
    totalAmount !== null &&
    created === null &&
    controlled === null &&
    pendingRetryMatchesCurrent &&
    retryReady &&
    !refreshingEvidence &&
    !isSubmitting

  const refreshControlled = useCallback(async (subscriptionId: string) => {
    if (!user) return null
    setRefreshingEvidence(true)
    setControlled(null)
    setSubmitError('')
    try {
      const record = await blockXOneApi.subscription.getControlled(user.token, subscriptionId)
      if (record.offering_id !== offeringId) throw new Error('Subscription does not belong to this offering.')
      if (record.user_id !== user.id) throw new Error('Subscription does not belong to this investor.')
      setControlled(record)
      return record
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Unable to refresh subscription evidence.')
      return null
    } finally {
      setRefreshingEvidence(false)
    }
  }, [offeringId, user])

  useEffect(() => {
    if (!user || !offering || typeof window === 'undefined') return
    const query = new URLSearchParams(window.location.search)
    const returnState = query.get('checkout')
    const querySubscriptionId = query.get('subscription_id') || ''
    const storedRetry = loadInvestorSubscriptionRetryIntent(localStorage, user.id, offeringId)
    setPendingRetry(storedRetry)
    if (storedRetry) setUnits(storedRetry.units)
    if (returnState === 'success' || returnState === 'cancelled') {
      setCheckoutReturn(returnState)
    }
    const subscriptionId = storedRetry?.subscriptionId ?? (
      SUBSCRIPTION_ID_PATTERN.test(querySubscriptionId) ? querySubscriptionId : ''
    )
    if (storedRetry?.subscriptionId && storedRetry.subscriptionId !== querySubscriptionId) {
      preserveSubscriptionIdInUrl(storedRetry.subscriptionId)
    }
    setRetryReady(true)
    if (SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
      void refreshControlled(subscriptionId).then((record) => {
        if (
          !record ||
          !storedRetry ||
          (storedRetry.subscriptionId !== undefined && storedRetry.subscriptionId !== subscriptionId) ||
          !investorSubscriptionIntentMatches(storedRetry, {
            userId: record.user_id,
            offeringId: record.offering_id,
            units: record.units,
            amount: record.amount,
          })
        ) {
          return
        }
        if (clearExactInvestorSubscriptionRetryIntent(localStorage, storedRetry)) {
          setPendingRetry(null)
        }
      })
    }
  }, [offering, offeringId, refreshControlled, user])

  async function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !offering || !canSubscribe || !parsedUnits || totalAmount === null) return

    setIsSubmitting(true)
    setSubmitError('')
    setCreated(null)
    setControlled(null)
    let requestRetry: InvestorSubscriptionRetryIntent
    try {
      const storedRetry = loadInvestorSubscriptionRetryIntent(localStorage, user.id, offering.id)
      if (storedRetry) {
        if (
          storedRetry.subscriptionId ||
          !investorSubscriptionIntentMatches(storedRetry, {
            userId: user.id,
            offeringId: offering.id,
            units: parsedUnits.canonical,
            amount: totalAmount,
          })
        ) {
          throw new Error('A different unresolved subscription request exists. Restore its exact units and amount before retrying.')
        }
        requestRetry = storedRetry
      } else {
        requestRetry = createInvestorSubscriptionRetryIntent({
          userId: user.id,
          offeringId: offering.id,
          units: parsedUnits.canonical,
          amount: totalAmount,
          idempotencyKey: newIdempotencyKey(`subscription:${offering.id}`),
        })
      }
      persistInvestorSubscriptionRetryIntent(localStorage, requestRetry)
      setPendingRetry(requestRetry)
    } catch (caught) {
      setSubmitError(
        caught instanceof Error
          ? `${caught.message} The subscription was not sent.`
          : 'Safe request recovery is unavailable in this browser. The subscription was not sent.'
      )
      setIsSubmitting(false)
      return
    }

    try {
      const response = await blockXOneApi.subscription.createControlled(
        user.token,
        offering.id,
        { units: parsedUnits.canonical, amount: totalAmount },
        requestRetry.idempotencyKey
      )
      preserveSubscriptionIdInUrl(response.id)
      setCreated(response)
      const completedRetry = withAuthoritativeSubscriptionId(requestRetry, response.id)
      let retryForCleanup = requestRetry
      try {
        persistInvestorSubscriptionRetryIntent(localStorage, completedRetry)
        retryForCleanup = completedRetry
        setPendingRetry(completedRetry)
      } catch {
        setPendingRetry(requestRetry)
      }
      const record = await refreshControlled(response.id)
      if (
        record &&
        investorSubscriptionIntentMatches(requestRetry, {
          userId: record.user_id,
          offeringId: record.offering_id,
          units: record.units,
          amount: record.amount,
        })
      ) {
        if (clearExactInvestorSubscriptionRetryIntent(localStorage, retryForCleanup)) {
          setPendingRetry(null)
        }
      } else if (record) {
        setSubmitError('The authoritative subscription does not match the exact request. Retry recovery was retained.')
      }
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Unable to create the subscription.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleOpenCheckout() {
    if (!user || !controlled || controlled.status !== 'FUNDING_PENDING' || controlled.consideration_source !== 'TEST_PROVIDER') return
    setOpeningCheckout(true)
    setSubmitError('')
    try {
      const response = await blockXOneApi.subscription.createTestCheckout(user.token, controlled.id)
      const target = new URL(response.checkout_url)
      if (target.protocol !== 'https:' || (target.hostname !== 'checkout.stripe.com' && !target.hostname.endsWith('.checkout.stripe.com'))) {
        throw new Error('Stripe returned an invalid Checkout destination.')
      }
      window.location.assign(target.toString())
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Unable to open Stripe test Checkout.')
      setOpeningCheckout(false)
    }
  }

  if (isLoading || authLoading) {
    return <main className="min-h-screen bg-bxo-bg-primary p-12 text-bxo-text-secondary">Loading verified offering readiness…</main>
  }
  if (!user) {
    return (
      <main className="min-h-screen bg-bxo-bg-primary px-4 py-16 text-bxo-text-primary">
        <div className="mx-auto max-w-2xl space-y-5 text-center">
          <h1 className="font-display text-3xl font-bold">Sign in before reviewing an offering.</h1>
          <Button asChild><Link href="/investor/login">Investor login</Link></Button>
        </div>
      </main>
    )
  }
  if (!offering || !readiness) {
    return (
      <main className="min-h-screen bg-bxo-bg-primary px-4 py-16 text-bxo-text-primary">
        <div className="mx-auto max-w-3xl bxo-panel p-8">
          <h1 className="font-display text-3xl font-bold">Offering unavailable</h1>
          <p role="alert" className="mt-3 text-bxo-danger-light">{loadError || 'This typed offering could not be loaded.'}</p>
        </div>
      </main>
    )
  }

  const terms = offering.terms
  const eligibilityLabel = created?.eligibility_decision
    ? `Allowed · evidence ${created.eligibility_decision}`
    : 'Evaluated authoritatively when you submit'
  const usesTestProvider = offering.financial_profile.consideration_source === 'TEST_PROVIDER'
  const networkLabel = offering.runtime_scope === 'LOCAL_PILOT'
    ? 'Private validation network · chain 31337 · no real value'
    : networkTargetLabel(offering.chain_id)

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <Link href="/investor/market" className="inline-flex min-h-11 items-center gap-2 text-sm text-bxo-text-secondary hover:text-bxo-text-primary">
          <ArrowLeft className="h-4 w-4" />Back to marketplace
        </Link>

        <section className="bxo-panel p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-xs font-semibold text-bxo-accent-primary">{pretty(offering.asset_class)}</span>
            <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs">{offering.runtime_scope === 'TESTNET' ? 'Public testnet' : 'Private validation network'}</span>
            <span className="rounded-full border border-bxo-border-default px-3 py-1 text-xs">{pretty(offering.status)}</span>
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold sm:text-5xl">{offering.name}</h1>
          <p className="mt-4 max-w-3xl leading-8 text-bxo-text-secondary">{offering.description}</p>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Price per unit</dt><dd className="mt-2 font-mono text-lg">{formatExactMoney(offering.price, offering.currency)}</dd></div>
            <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Network configuration</dt><dd className="mt-2 font-mono text-sm">{networkLabel}</dd><p className="mt-1 text-xs text-bxo-text-tertiary">A configured target is not deployment or issuance evidence.</p></div>
            <div className="rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4"><dt className="text-xs text-bxo-text-tertiary">Payment mode</dt><dd className="mt-2 text-sm font-medium">{usesTestProvider ? 'Stripe test mode' : 'Recorded synthetic evidence'}</dd><p className="mt-1 text-xs text-bxo-warning-light">{usesTestProvider ? 'Provider-backed test evidence only. No real funds are accepted or settled.' : 'Independent local test evidence only. No payment provider or real funds are involved.'}</p></div>
          </dl>
        </section>

        <section aria-label="Investor eligibility and offering readiness" className="grid gap-3 lg:grid-cols-4">
          {[
            ['Terms', readiness.terms_active, `ACTIVE v${terms.version}`],
            ['Financial profile', readiness.financial_profile_active, readiness.financial_profile_active ? 'ACTIVE' : 'BLOCKED'],
            ['Subscription intake', readiness.subscription_ready, readiness.subscription_ready ? 'ENABLED' : 'BLOCKED'],
            ['Your eligibility', Boolean(created?.eligibility_decision), eligibilityLabel],
          ].map(([label, ready, detail]) => (
            <div key={String(label)} className={`rounded-xl border p-4 ${ready ? 'border-bxo-success/30 bg-bxo-success/10' : 'border-bxo-border-default bg-bxo-surface'}`}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-bxo-text-tertiary">
                {ready ? <BadgeCheck className="h-4 w-4 text-bxo-success-light" /> : <CircleDashed className="h-4 w-4" />}
                {String(label)}
              </div>
              <p className="mt-2 text-sm">{String(detail)}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_23rem]">
          <div className="space-y-5">
            <div className="bxo-card p-6">
              <h2 className="font-display text-2xl font-bold">Approved terms</h2>
              <p className="mt-2 break-all font-mono text-xs text-bxo-text-tertiary">SHA-256 {terms.terms_sha256}</p>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Currency</dt><dd className="mt-2 font-mono">{terms.common_terms.currency}</dd></div>
                <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Issue date</dt><dd className="mt-2 font-mono">{terms.common_terms.issue_date}</dd></div>
                <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Governing law</dt><dd className="mt-2">{terms.common_terms.governing_law}</dd></div>
                <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Token precision</dt><dd className="mt-2 font-mono">{terms.common_terms.token_decimals} decimals</dd></div>
              </dl>
              <p className="mt-5 text-sm leading-6 text-bxo-text-secondary">
                This screen shows operational terms and their immutable hash. It is not a prospectus and does not invent a legal document that the API has not supplied.
              </p>
            </div>

            {controlled ? (
              <div className="bxo-panel p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-bold">Controlled subscription evidence</h2>
                    <p className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">{controlled.id}</p>
                  </div>
                  <Button variant="outline" disabled={refreshingEvidence} onClick={() => void refreshControlled(controlled.id)}>
                    {refreshingEvidence ? 'Refreshing…' : 'Refresh evidence'}
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4"><div className="text-xs text-bxo-text-tertiary">Controlled state</div><div className="mt-2 font-mono text-sm">{controlled.status}</div></div>
                  <div className="rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4"><div className="text-xs text-bxo-text-tertiary">Cash flags</div><div className="mt-2 font-mono text-sm">real=false · settled=false</div></div>
                  <div className="rounded-xl border border-bxo-border-default p-4"><div className="text-xs text-bxo-text-tertiary">Chain state</div><div className="mt-2 text-sm">{chainEvidenceLabel(controlled)}</div></div>
                </div>
                {checkoutReturn === 'success' ? (
                  <div role="status" className="mt-5 rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4 text-sm">
                    The browser returned through the configured Stripe TEST return URL. That navigation is not funding evidence. Funding remains pending until BlockXOne verifies the signed webhook, re-fetches the PaymentIntent from Stripe, and posts the exact ledger entry.
                  </div>
                ) : null}
                {checkoutReturn === 'cancelled' ? (
                  <div role="status" className="mt-5 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm text-bxo-warning-light">
                    The browser returned with a checkout-cancelled navigation state. Authoritative funding status is shown only after the controlled subscription is refreshed from the server.
                  </div>
                ) : null}
                {controlled.status === 'FUNDING_PENDING' && controlled.consideration_source === 'TEST_PROVIDER' ? (
                  <div className="mt-5 rounded-xl border border-bxo-border-default bg-bxo-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4 text-bxo-accent-primary" />Stripe TEST Checkout</div>
                        <p className="mt-2 max-w-2xl text-sm text-bxo-text-secondary">The server fixes the amount, currency, reference, investor, and payment instruction. Test Checkout cannot mark this subscription funded by itself.</p>
                      </div>
                      <Button type="button" disabled={openingCheckout} onClick={() => void handleOpenCheckout()}>
                        {openingCheckout ? 'Opening Checkout...' : 'Pay with Stripe test card'}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  {Object.entries(controlled.evidence).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs uppercase tracking-[0.08em] text-bxo-text-tertiary">{pretty(key)}</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{evidenceValue(value)}</dd>
                    </div>
                  ))}
                  <div><dt className="text-xs uppercase tracking-[0.08em] text-bxo-text-tertiary">Chain operation</dt><dd className="mt-1 break-all font-mono text-xs">{evidenceValue(controlled.mint_chain_operation_id)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-[0.08em] text-bxo-text-tertiary">Transaction hash</dt><dd className="mt-1 break-all font-mono text-xs">{evidenceValue(controlled.transaction_hash)}</dd></div>
                </dl>
              </div>
            ) : null}
          </div>

          <aside className="h-fit rounded-2xl border border-bxo-border-default bg-bxo-bg-primary p-5">
            <div className="bxo-kicker">Subscription request</div>
            <p className="mt-3 text-sm leading-6 text-bxo-text-secondary">
              {usesTestProvider
                ? 'This creates a controlled obligation. After approval, the test subscription can open Stripe test checkout. Tokens are issued only after provider verification, ledger posting, reconciliation, wallet admission, and chain finality.'
                : 'This creates a controlled obligation. Tokens are issued only after independent synthetic funding evidence, ledger posting, reconciliation, wallet admission, and local-chain finality.'}
            </p>
            <form className="mt-6 space-y-5" onSubmit={handleSubscribe}>
              <label htmlFor="subscription-units" className="block text-sm font-semibold text-bxo-text-secondary">
                Units
                <input
                  id="subscription-units"
                  inputMode="decimal"
                  value={units}
                  onChange={(event) => setUnits(event.target.value)}
                  className="mt-2 h-12 w-full rounded-xl border border-bxo-border-default bg-bxo-surface px-4 font-mono outline-none focus:border-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-muted"
                  required
                />
              </label>
              <p className="text-xs leading-5 text-bxo-text-tertiary">
                Approved range {formatExactUnits(minimumUnits)} to {formatExactUnits(maximumUnits)} units. The request must produce an exact amount at the approved currency scale.
              </p>
              {units.length > 0 && totalAmount === null ? (
                <div role="alert" className="rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-3 text-xs text-bxo-warning-light">
                  Enter units within the approved range that resolve to an exact currency amount.
                </div>
              ) : null}
              <div className="rounded-xl border border-bxo-border-subtle bg-bxo-surface p-4">
                <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Exact request amount</div>
                <div className="mt-2 font-mono text-xl font-semibold">{formatExactMoney(totalAmount, offering.currency)}</div>
              </div>
              {pendingRetry ? (
                <div role="status" className="rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4 text-sm">
                  {pendingRetry.subscriptionId
                    ? `Recovering authoritative subscription ${pendingRetry.subscriptionId}. A second request is blocked.`
                    : pendingRetryMatchesCurrent
                      ? 'A prior exact request is ready for safe recovery. Submitting the unchanged units and amount reuses its original request key.'
                      : `A prior request for ${pendingRetry.units} units and ${formatExactMoney(pendingRetry.amount, offering.currency)} is unresolved. Restore those exact values before retrying.`}
                </div>
              ) : null}
              {submitError ? <div role="alert" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{submitError}</div> : null}
              {created ? (
                <div role="status" className="rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-bxo-accent-primary"><BadgeCheck className="h-4 w-4" />Subscription recorded</div>
                  <p className="mt-2 break-all font-mono text-xs">ID {created.id}</p>
                  <p className="mt-1 break-all font-mono text-xs">Control {created.control_id}</p>
                  <p className="mt-2">State {created.status} · eligibility {created.eligibility_decision}</p>
                </div>
              ) : null}
              <Button className="bxo-primary-cta h-12 w-full text-bxo-bg-primary" disabled={!canSubscribe} type="submit">
                {isSubmitting ? 'Recording exact request…' : readiness.subscription_ready ? 'Submit controlled subscription' : 'Subscription intake blocked'}
              </Button>
            </form>
          </aside>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="bxo-card p-6"><FileText className="h-5 w-5 text-bxo-accent-primary" /><h2 className="mt-3 font-display text-xl font-bold">Documents</h2><p className="mt-3 text-sm leading-7 text-bxo-text-secondary">No offering document is supplied by this API. The terms hash is evidence of approved structured data, not evidence that a prospectus exists.</p></div>
          <div className="bxo-card p-6"><ShieldCheck className="h-5 w-5 text-bxo-accent-primary" /><h2 className="mt-3 font-display text-xl font-bold">Chain truth</h2><p className="mt-3 text-sm leading-7 text-bxo-text-secondary">Network configuration alone is not issuance. Until a durable operation supplies a transaction hash, receipt, confirmations and FINAL state, this position remains not issued.</p></div>
        </div>
      </div>
    </main>
  )
}
