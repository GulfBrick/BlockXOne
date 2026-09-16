'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneApi } from '@/lib/api-client'
import {
  baseUnitsToExactDecimal,
  compareExactDecimals,
  exactDecimalToBaseUnits,
  isPositiveExactDecimal,
  parseExactDecimal,
} from '@/lib/exact-decimal'
import {
  defaultFundDistributionPolicy,
  defaultPrivateDebtDayCountConvention,
  evaluateChainCatalog,
  fundDistributionPolicies,
  instrumentExecutionConfiguration,
  offeringExecutionConfiguration,
  privateDebtDayCountConventions,
  shouldBlockForMissingTestnetManifest,
} from '@/lib/instrument-term-options'
import {
  activeInstrumentTerms,
  newIdempotencyKey,
  type CreateInstrumentRequest,
  type InstrumentRecord,
  type PilotAssetClass,
  type PilotRuntimeScope,
  type TypedOffering,
} from '@/lib/pilot-finance'
import {
  managedTestnet,
  managedTestnets,
  type ManagedTestnetChainID,
} from '@/lib/managed-testnets'
import { blockXOneRuntimeScope } from '@/lib/runtime-scope'

const fieldClass =
  'mt-2 h-12 w-full rounded-xl border border-bxo-border-default bg-bxo-bg-primary px-4 text-bxo-text-primary outline-none placeholder:text-bxo-text-disabled focus:border-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-muted'
const textAreaClass = `${fieldClass} h-auto py-3`
const frontendRuntimeScope = blockXOneRuntimeScope()

const assetClasses: Array<{ value: PilotAssetClass; label: string; summary: string }> = [
  {
    value: 'PRIVATE_DEBT_NOTE',
    label: 'Private debt note',
    summary: 'Face value, coupon, maturity, seniority, security and day-count terms.',
  },
  {
    value: 'FUND_INTEREST',
    label: 'Fund interest',
    summary: 'Share class, NAV, dealing, distributions and redemption notice terms.',
  },
  {
    value: 'REAL_ESTATE_SPV_INTEREST',
    label: 'Real-estate SPV interest',
    summary: 'SPV, property, valuation, ownership and distribution terms.',
  },
]

function integer(value: string, name: string, minimum = 0, maximum = 1_000_000) {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be a whole number.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function required(value: string, name: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required.`)
  return normalized
}

export default function NewOfferingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const instrumentId = searchParams.get('instrument')
  const offeringId = searchParams.get('offering')
  const { user, loading: authLoading } = useAuth()
  const [instrument, setInstrument] = useState<InstrumentRecord | null>(null)
  const [existingOffering, setExistingOffering] = useState<TypedOffering | null>(null)
  const [isLoadingInstrument, setIsLoadingInstrument] = useState(Boolean(instrumentId || offeringId))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [localPilotExecutionReady, setLocalPilotExecutionReady] = useState(false)
  const [executionReadyTestnets, setExecutionReadyTestnets] = useState<ManagedTestnetChainID[]>([])
  const [selectedTestnetChainID, setSelectedTestnetChainID] = useState<ManagedTestnetChainID>(80002)
  const [assetClass, setAssetClass] = useState<PilotAssetClass>('PRIVATE_DEBT_NOTE')
  const [runtimeScope, setRuntimeScope] = useState<PilotRuntimeScope>(frontendRuntimeScope)
  const offeringIdempotencyKey = useRef('')
  const [form, setForm] = useState({
    name: '',
    description: '',
    currency: 'USD',
    tokenDecimals: '2',
    authorizedUnits: '100000',
    issueDate: '',
    governingLaw: '',
    faceValue: '1000.00',
    annualCouponBps: '800',
    couponFrequencyMonths: '3',
    dayCountConvention: defaultPrivateDebtDayCountConvention,
    maturityDate: '',
    seniority: 'SENIOR_SECURED',
    secured: true,
    shareClass: 'CLASS_A',
    navCurrency: 'USD',
    navFrequency: 'MONTHLY',
    dealingFrequency: 'QUARTERLY',
    distributionPolicy: defaultFundDistributionPolicy,
    redemptionNoticeDays: '90',
    spvName: '',
    propertyIdentifier: '',
    propertyJurisdiction: '',
    valuationCurrency: 'USD',
    valuation: '',
    valuationAsOf: '',
    ownershipRights: 'ECONOMIC_AND_VOTING',
    price: '',
    minimumUnits: '1',
    maximumUnits: '1000',
    allocationCapacityUnits: '100000',
    paymentDueDays: '7',
    tenantOrgId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    legalEntityOrgId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    transferAgentOrgId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    tokenisationAgentOrgId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  })

  useEffect(() => {
    const tenantOrgId = user?.orgId
    if (!tenantOrgId) return
    setForm((current) => ({
      ...current,
      tenantOrgId,
    }))
  }, [user?.orgId])

  useEffect(() => {
    const controller = new AbortController()
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
    void fetch(`${apiBase}/v1/chains`, { signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() : null)
      .then((chains: unknown) => {
        const readiness = evaluateChainCatalog(frontendRuntimeScope, chains)
        setLocalPilotExecutionReady(readiness.localPilotReady)
        const ready = readiness.executionReadyTestnetChainIDs.flatMap((chainID): ManagedTestnetChainID[] => {
          const profile = managedTestnet(chainID)
          return profile ? [profile.chainId] : []
        })
        setExecutionReadyTestnets(ready)
        if (ready.length > 0) {
          setSelectedTestnetChainID((current) => ready.includes(current) ? current : ready[0])
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLocalPilotExecutionReady(false)
          setExecutionReadyTestnets([])
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if ((!instrumentId && !offeringId) || authLoading) return
    if (!user) {
      setIsLoadingInstrument(false)
      return
    }

    let cancelled = false
    setError('')
    setInstrument(null)
    setExistingOffering(null)
    setIsLoadingInstrument(true)
    const loadRecords = async () => {
      const offering = offeringId
        ? await blockXOneApi.offering.get(user.token, offeringId)
        : null
      if (offering && instrumentId && offering.instrument_id !== instrumentId) {
        throw new Error('The requested instrument and DRAFT offering do not match.')
      }
      if (offering && offering.status !== 'DRAFT') {
        throw new Error('Only a DRAFT offering can resume missing financial-profile preparation.')
      }
      const record = await blockXOneApi.instrument.get(
        user.token,
        offering?.instrument_id || instrumentId || ''
      )
      return { offering, record }
    }
    void loadRecords()
      .then(({ offering, record }) => {
        if (!cancelled) {
          setInstrument(record)
          setExistingOffering(offering)
          const terms = activeInstrumentTerms(record)
          if (terms) {
            setRuntimeScope(record.runtime_scope)
            setAssetClass(record.asset_class)
            if (offering?.chain_id && managedTestnet(offering.chain_id)) {
              setSelectedTestnetChainID(offering.chain_id as ManagedTestnetChainID)
            }
            setForm((current) => ({
              ...current,
              tenantOrgId: offering?.tenant_org_id || record.tenant_org_id,
              legalEntityOrgId: offering?.legal_entity_org_id || record.legal_entity_org_id,
              transferAgentOrgId: offering?.transfer_agent_org_id || current.transferAgentOrgId,
              tokenisationAgentOrgId: offering?.tokenisation_agent_org_id || current.tokenisationAgentOrgId,
              currency: terms.common_terms.currency,
              price: offering?.price || current.price,
              tokenDecimals: String(terms.common_terms.token_decimals),
              allocationCapacityUnits:
                baseUnitsToExactDecimal(
                  terms.common_terms.authorized_units_base_units,
                  terms.common_terms.token_decimals
                ) || current.allocationCapacityUnits,
            }))
          }
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Unable to load the instrument.')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingInstrument(false)
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, instrumentId, offeringId, user])

  const activeTerms = useMemo(
    () => (instrument ? activeInstrumentTerms(instrument) : null),
    [instrument]
  )
  const creatingOffering = Boolean(instrumentId || offeringId)
  const selectedTestnet = managedTestnet(selectedTestnetChainID)
  const testnetExecutionReady = executionReadyTestnets.includes(selectedTestnetChainID)
  const runtimeScopeMatchesFrontend = runtimeScope === frontendRuntimeScope
  const offeringTargetReady = runtimeScopeMatchesFrontend && (
    runtimeScope === 'LOCAL_PILOT' ? localPilotExecutionReady : testnetExecutionReady
  )
  const offeringTargetBlockedMessage = !runtimeScopeMatchesFrontend
    ? `This ${runtimeScope === 'TESTNET' ? 'testnet' : 'private-network'} instrument cannot be offered from the ${frontendRuntimeScope === 'TESTNET' ? 'testnet' : 'private-network'} workspace.`
    : runtimeScope === 'LOCAL_PILOT'
      ? 'Local offering creation is blocked until the chain catalog supplies exactly one execution-ready local chain 31337 row with LOCAL_ONLY_NO_REAL_VALUE availability.'
      : 'Testnet offering creation is blocked until the selected managed network has an ACTIVE_MANIFEST.'

  function update(name: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function buildInstrumentRequest(): CreateInstrumentRequest {
    const tokenDecimals = integer(form.tokenDecimals, 'Token decimals', 0, 18)
    const authorizedUnits = exactDecimalToBaseUnits(form.authorizedUnits, tokenDecimals)
    if (!authorizedUnits || authorizedUnits === '0') {
      throw new Error('Authorized units must be a positive decimal at the selected token precision.')
    }

    const common = {
      currency: required(form.currency, 'Currency').toUpperCase(),
      token_decimals: tokenDecimals,
      authorized_units_base_units: authorizedUnits,
      issue_date: required(form.issueDate, 'Issue date'),
      governing_law: required(form.governingLaw, 'Governing law'),
    }
    const execution = instrumentExecutionConfiguration(
      runtimeScope,
      runtimeScope === 'TESTNET' ? selectedTestnetChainID : null
    )
    const base = {
      asset_class: assetClass,
      runtime_scope: execution.runtime_scope,
      chain_id: execution.chain_id,
      name: required(form.name, 'Instrument name'),
      description: required(form.description, 'Description'),
      tenant_org_id: required(form.tenantOrgId, 'Tenant organization ID'),
      legal_entity_org_id: required(form.legalEntityOrgId, 'Legal-entity organization ID'),
      common_terms: common,
    }

    if (assetClass === 'PRIVATE_DEBT_NOTE') {
      const faceValue = exactDecimalToBaseUnits(form.faceValue, 2)
      if (!faceValue || faceValue === '0') throw new Error('Face value must be a positive amount with at most two decimals.')
      return {
        ...base,
        private_debt_terms: {
          face_value_base_units: faceValue,
          annual_coupon_bps: integer(form.annualCouponBps, 'Annual coupon', 0, 100000),
          coupon_frequency_months: integer(form.couponFrequencyMonths, 'Coupon frequency', 1, 120),
          day_count_convention: required(form.dayCountConvention, 'Day-count convention'),
          maturity_date: required(form.maturityDate, 'Maturity date'),
          seniority: required(form.seniority, 'Seniority'),
          secured: form.secured,
        },
      }
    }
    if (assetClass === 'FUND_INTEREST') {
      return {
        ...base,
        fund_interest_terms: {
          share_class: required(form.shareClass, 'Share class'),
          nav_currency: required(form.navCurrency, 'NAV currency').toUpperCase(),
          nav_frequency: required(form.navFrequency, 'NAV frequency'),
          dealing_frequency: required(form.dealingFrequency, 'Dealing frequency'),
          distribution_policy: required(form.distributionPolicy, 'Distribution policy'),
          redemption_notice_days: integer(form.redemptionNoticeDays, 'Redemption notice', 0, 3650),
        },
      }
    }

    const valuation = exactDecimalToBaseUnits(form.valuation, 2)
    if (!valuation || valuation === '0') {
      throw new Error('Valuation must be a positive amount with at most two decimals.')
    }
    return {
      ...base,
      real_estate_spv_terms: {
        spv_name: required(form.spvName, 'SPV name'),
        property_identifier: required(form.propertyIdentifier, 'Property identifier'),
        property_jurisdiction: required(form.propertyJurisdiction, 'Property jurisdiction'),
        valuation_currency: required(form.valuationCurrency, 'Valuation currency').toUpperCase(),
        valuation_base_units: valuation,
        valuation_as_of: required(form.valuationAsOf, 'Valuation date'),
        ownership_rights: required(form.ownershipRights, 'Ownership rights'),
        distribution_policy: required(form.distributionPolicy, 'Distribution policy'),
      },
    }
  }

  async function createInstrument() {
    if (!user) throw new Error('Your verified session is required.')
    const created = await blockXOneApi.instrument.create(user.token, buildInstrumentRequest())
    router.push(`/wm/funds?instrument=${encodeURIComponent(created.id)}`)
  }

  async function createOffering() {
    if (!user || !instrument || !activeTerms) {
      throw new Error('Active checker-approved terms are required before an offering can be prepared.')
    }
    if (!user.orgId) throw new Error('Your verified session has no organization context.')

    if (instrument.runtime_scope !== frontendRuntimeScope) {
      throw new Error('The instrument network mode does not match this workspace network mode.')
    }
    if (instrument.runtime_scope === 'LOCAL_PILOT' && !localPilotExecutionReady) {
      throw new Error('Strict local chain 31337 execution evidence is required before an offering can be prepared.')
    }
    if (instrument.runtime_scope === 'TESTNET' && !testnetExecutionReady) {
      throw new Error('The selected testnet rail is not execution-ready. An exact ACTIVE network and factory manifest is required.')
    }

    const execution = offeringExecutionConfiguration(
      instrument.runtime_scope,
      instrument.runtime_scope === 'TESTNET' ? selectedTestnetChainID : null,
      activeTerms.common_terms.currency
    )

    const parsedPrice = parseExactDecimal(form.price)
    if (!isPositiveExactDecimal(parsedPrice)) throw new Error('Unit price must be a positive exact decimal.')
    if (compareExactDecimals(form.minimumUnits, form.maximumUnits) > 0) {
      throw new Error('Minimum subscription cannot exceed the maximum.')
    }
    if (compareExactDecimals(form.maximumUnits, form.allocationCapacityUnits) > 0) {
      throw new Error('Maximum subscription cannot exceed allocation capacity.')
    }

    const tokenDecimals = activeTerms.common_terms.token_decimals
    const priceBaseUnits = exactDecimalToBaseUnits(parsedPrice.canonical, 2)
    const minimumBaseUnits = exactDecimalToBaseUnits(form.minimumUnits, tokenDecimals)
    const maximumBaseUnits = exactDecimalToBaseUnits(form.maximumUnits, tokenDecimals)
    const capacityBaseUnits = exactDecimalToBaseUnits(form.allocationCapacityUnits, tokenDecimals)
    if (!priceBaseUnits || !minimumBaseUnits || !maximumBaseUnits || !capacityBaseUnits) {
      throw new Error('Price or allocation values exceed the approved decimal precision.')
    }

    if (!offeringIdempotencyKey.current) {
      offeringIdempotencyKey.current = newIdempotencyKey(
        `typed-offering:${instrument.id}`
      )
    }
    let offering = existingOffering
    if (offering) {
      if (
        offering.instrument_id !== instrument.id ||
        offering.instrument_terms?.id !== activeTerms.id ||
        offering.runtime_scope !== execution.runtime_scope ||
        offering.chain_id !== execution.chain_id ||
        offering.currency !== activeTerms.common_terms.currency ||
        offering.price !== parsedPrice.canonical
      ) {
        throw new Error('The DRAFT offering no longer matches its authoritative terms, network, or economics.')
      }
    } else {
      offering = await blockXOneApi.offering.createTyped(user.token, {
        instrument_id: instrument.id,
        instrument_terms_id: activeTerms.id,
        runtime_scope: execution.runtime_scope,
        chain_id: execution.chain_id,
        price: parsedPrice.canonical,
        currency: activeTerms.common_terms.currency,
        tenant_org_id: required(form.tenantOrgId, 'Tenant organization ID'),
        legal_entity_org_id: required(form.legalEntityOrgId, 'Legal-entity organization ID'),
        transfer_agent_org_id: required(form.transferAgentOrgId, 'Transfer-agent organization ID'),
        tokenisation_agent_org_id: required(form.tokenisationAgentOrgId, 'Tokenisation-agent organization ID'),
      }, offeringIdempotencyKey.current)
      setExistingOffering(offering)
      router.replace(
        `/wm/funds/new?offering=${encodeURIComponent(offering.id)}`,
        { scroll: false }
      )
    }
    await blockXOneApi.offering.prepareFinancialProfile(user.token, offering.id, {
      currency_scale: 2,
      price_per_whole_unit_base_units: priceBaseUnits,
      minimum_subscription_base_units: minimumBaseUnits,
      maximum_subscription_base_units: maximumBaseUnits,
      allocation_capacity_base_units: capacityBaseUnits,
      payment_due_seconds: integer(form.paymentDueDays, 'Payment due days', 1, 365) * 86400,
      consideration_source: execution.consideration_source,
    })
    router.push(`/wm/funds/${encodeURIComponent(offering.id)}`)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      if (creatingOffering && !runtimeScopeMatchesFrontend) {
        throw new Error('The instrument network mode does not match this workspace network mode.')
      }
      if (creatingOffering && runtimeScope === 'LOCAL_PILOT' && !localPilotExecutionReady) {
        throw new Error('Strict local chain 31337 execution evidence is required before an offering can be prepared.')
      }
      if (
        shouldBlockForMissingTestnetManifest(
          creatingOffering,
          runtimeScope,
          testnetExecutionReady
        )
      ) {
        throw new Error(
          'The selected testnet rail is not execution-ready. An exact ACTIVE network and factory manifest is required.'
        )
      }
      if (creatingOffering) await createOffering()
      else await createInstrument()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to prepare this instrument.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (authLoading || isLoadingInstrument) {
    return <main className="min-h-screen bg-bxo-bg-primary p-12 text-bxo-text-secondary">Loading verified workspace…</main>
  }

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <Link href="/wm/funds" className="inline-flex min-h-11 items-center gap-2 text-sm text-bxo-text-secondary hover:text-bxo-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to instrument pipeline
        </Link>

        <header className="space-y-4">
          <div className="bxo-kicker">{creatingOffering ? 'Step 3 · offering economics' : 'Steps 1 and 2 · instrument and terms'}</div>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            {creatingOffering ? 'Prepare the controlled offering.' : 'Define a multi-asset instrument.'}
          </h1>
          <p className="max-w-3xl leading-8 text-bxo-text-secondary">
            {creatingOffering
              ? existingOffering
                ? 'The DRAFT offering is loaded from the authoritative issuer record. This step completes its missing ledger-backed financial profile for a different checker to activate.'
                : 'The instrument terms are checker-approved. This step creates the offering and a draft ledger-backed financial profile for a different checker to activate.'
              : 'Create immutable common and class-specific terms. Another authorized operator must approve them before any offering can be created.'}
          </p>
        </header>

        {creatingOffering && (!instrument || !activeTerms) ? (
          <section className="bxo-panel p-8">
            <h2 className="font-display text-2xl font-bold">Instrument is not ready</h2>
            <p className="mt-3 text-bxo-text-secondary">
              {error || 'This instrument does not have ACTIVE checker-approved terms.'}
            </p>
            <Button asChild className="mt-5"><Link href="/wm/funds">Return to pipeline</Link></Button>
          </section>
        ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            {!creatingOffering ? (
              <>
                <section className="bxo-panel p-6 sm:p-8">
                  <h2 className="font-display text-2xl font-bold">1. Instrument identity</h2>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    <label className="sm:col-span-2 text-sm font-semibold text-bxo-text-secondary">
                      Instrument name
                      <input className={fieldClass} value={form.name} onChange={(event) => update('name', event.target.value)} required />
                    </label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">
                      Asset class
                      <select className={fieldClass} value={assetClass} onChange={(event) => setAssetClass(event.target.value as PilotAssetClass)}>
                        {assetClasses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">
                      Network
                      <select className={fieldClass} value={runtimeScope} disabled aria-readonly="true">
                        {frontendRuntimeScope === 'LOCAL_PILOT' ? (
                          <option value="LOCAL_PILOT">
                            {localPilotExecutionReady
                              ? 'Private validation network · execution ready'
                              : 'Private validation network unavailable · strict chain evidence missing'}
                          </option>
                        ) : (
                          <option value="TESTNET">
                            {executionReadyTestnets.length > 0
                              ? `Public testnet · ${executionReadyTestnets.length} rail${executionReadyTestnets.length === 1 ? '' : 's'} ready`
                              : 'Public testnet unavailable · no active network manifest'}
                          </option>
                        )}
                      </select>
                    </label>
                    <p className="sm:col-span-2 text-sm text-bxo-accent-primary">
                      {assetClasses.find((item) => item.value === assetClass)?.summary}
                    </p>
                    <label className="sm:col-span-2 text-sm font-semibold text-bxo-text-secondary">
                      Description
                      <textarea className={textAreaClass} rows={4} value={form.description} onChange={(event) => update('description', event.target.value)} required />
                    </label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">
                      Tenant organization ID
                      <input className={`${fieldClass} font-mono`} value={form.tenantOrgId} readOnly aria-readonly="true" required />
                    </label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">
                      Legal-entity organization ID
                      <input className={`${fieldClass} font-mono`} value={form.legalEntityOrgId} onChange={(event) => update('legalEntityOrgId', event.target.value)} required />
                    </label>
                  </div>
                </section>

                <section className="bxo-panel p-6 sm:p-8">
                  <h2 className="font-display text-2xl font-bold">2. Immutable terms</h2>
                  <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary">Common terms</h3>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-bxo-text-secondary">Currency<input className={fieldClass} maxLength={3} value={form.currency} onChange={(event) => update('currency', event.target.value.toUpperCase())} required /></label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">Token decimals<input className={fieldClass} inputMode="numeric" value={form.tokenDecimals} onChange={(event) => update('tokenDecimals', event.target.value)} required /></label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">Authorized units<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.authorizedUnits} onChange={(event) => update('authorizedUnits', event.target.value)} required /></label>
                    <label className="text-sm font-semibold text-bxo-text-secondary">Issue date<input className={fieldClass} type="date" value={form.issueDate} onChange={(event) => update('issueDate', event.target.value)} required /></label>
                    <label className="sm:col-span-2 text-sm font-semibold text-bxo-text-secondary">Governing law<input className={fieldClass} value={form.governingLaw} onChange={(event) => update('governingLaw', event.target.value)} required /></label>
                  </div>

                  <h3 className="mt-8 text-sm font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary">Class-specific terms</h3>
                  {assetClass === 'PRIVATE_DEBT_NOTE' ? (
                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-bxo-text-secondary">Face value ({form.currency})<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.faceValue} onChange={(event) => update('faceValue', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Annual coupon (basis points)<input className={fieldClass} inputMode="numeric" value={form.annualCouponBps} onChange={(event) => update('annualCouponBps', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Coupon frequency (months)<input className={fieldClass} inputMode="numeric" value={form.couponFrequencyMonths} onChange={(event) => update('couponFrequencyMonths', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">
                        Day-count convention
                        <select className={fieldClass} value={form.dayCountConvention} onChange={(event) => update('dayCountConvention', event.target.value)} required>
                          {privateDebtDayCountConventions.map((convention) => (
                            <option key={convention} value={convention}>{convention}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Maturity date<input className={fieldClass} type="date" value={form.maturityDate} onChange={(event) => update('maturityDate', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Seniority<input className={fieldClass} value={form.seniority} onChange={(event) => update('seniority', event.target.value)} required /></label>
                      <label className="flex min-h-12 items-center gap-3 text-sm font-semibold text-bxo-text-secondary">
                        <input type="checkbox" checked={form.secured} onChange={(event) => update('secured', event.target.checked)} />
                        Secured instrument
                      </label>
                    </div>
                  ) : null}
                  {assetClass === 'FUND_INTEREST' ? (
                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-bxo-text-secondary">Share class<input className={fieldClass} value={form.shareClass} onChange={(event) => update('shareClass', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">NAV currency<input className={fieldClass} maxLength={3} value={form.navCurrency} onChange={(event) => update('navCurrency', event.target.value.toUpperCase())} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">NAV frequency<input className={fieldClass} value={form.navFrequency} onChange={(event) => update('navFrequency', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Dealing frequency<input className={fieldClass} value={form.dealingFrequency} onChange={(event) => update('dealingFrequency', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">
                        Distribution policy
                        <select className={fieldClass} value={form.distributionPolicy} onChange={(event) => update('distributionPolicy', event.target.value)} required>
                          {fundDistributionPolicies.map((policy) => (
                            <option key={policy} value={policy}>{policy}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Redemption notice (days)<input className={fieldClass} inputMode="numeric" value={form.redemptionNoticeDays} onChange={(event) => update('redemptionNoticeDays', event.target.value)} required /></label>
                    </div>
                  ) : null}
                  {assetClass === 'REAL_ESTATE_SPV_INTEREST' ? (
                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-bxo-text-secondary">SPV name<input className={fieldClass} value={form.spvName} onChange={(event) => update('spvName', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Property identifier<input className={fieldClass} value={form.propertyIdentifier} onChange={(event) => update('propertyIdentifier', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Property jurisdiction<input className={fieldClass} value={form.propertyJurisdiction} onChange={(event) => update('propertyJurisdiction', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Valuation currency<input className={fieldClass} maxLength={3} value={form.valuationCurrency} onChange={(event) => update('valuationCurrency', event.target.value.toUpperCase())} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Valuation<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.valuation} onChange={(event) => update('valuation', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Valuation as of<input className={fieldClass} type="date" value={form.valuationAsOf} onChange={(event) => update('valuationAsOf', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Ownership rights<input className={fieldClass} value={form.ownershipRights} onChange={(event) => update('ownershipRights', event.target.value)} required /></label>
                      <label className="text-sm font-semibold text-bxo-text-secondary">Distribution policy<input className={fieldClass} value={form.distributionPolicy} onChange={(event) => update('distributionPolicy', event.target.value)} required /></label>
                    </div>
                  ) : null}
                </section>
              </>
            ) : (
              <section className="bxo-panel p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-bold">{instrument?.name}</h2>
                    <p className="mt-2 font-mono text-xs text-bxo-text-tertiary">{activeTerms?.terms_sha256}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-bxo-success/30 bg-bxo-success/10 px-3 py-1 text-xs font-semibold text-bxo-success-light">
                    <CheckCircle2 className="h-4 w-4" /> Terms approved · v{activeTerms?.version}
                  </span>
                </div>
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-bxo-text-secondary">Unit price ({activeTerms?.common_terms.currency})<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.price} onChange={(event) => update('price', event.target.value)} readOnly={Boolean(existingOffering)} aria-readonly={Boolean(existingOffering)} required /></label>
                  <label className="text-sm font-semibold text-bxo-text-secondary">Payment due (days)<input className={fieldClass} inputMode="numeric" value={form.paymentDueDays} onChange={(event) => update('paymentDueDays', event.target.value)} required /></label>
                  {runtimeScope === 'TESTNET' ? (
                    <label className="sm:col-span-2 text-sm font-semibold text-bxo-text-secondary">
                      Execution rail
                      <select
                        className={fieldClass}
                        value={selectedTestnetChainID}
                        onChange={(event) => setSelectedTestnetChainID(Number(event.target.value) as ManagedTestnetChainID)}
                        disabled={Boolean(existingOffering)}
                      >
                        {managedTestnets.map((network) => (
                          <option
                            key={network.chainId}
                            value={network.chainId}
                            disabled={!executionReadyTestnets.includes(network.chainId)}
                          >
                            {network.name} · {network.chainId} · {executionReadyTestnets.includes(network.chainId) ? 'execution ready' : 'manifest unavailable'}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="text-sm font-semibold text-bxo-text-secondary">Minimum subscription units<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.minimumUnits} onChange={(event) => update('minimumUnits', event.target.value)} required /></label>
                  <label className="text-sm font-semibold text-bxo-text-secondary">Maximum subscription units<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.maximumUnits} onChange={(event) => update('maximumUnits', event.target.value)} required /></label>
                  <label className="sm:col-span-2 text-sm font-semibold text-bxo-text-secondary">Allocation capacity units<input className={`${fieldClass} font-mono`} inputMode="decimal" value={form.allocationCapacityUnits} onChange={(event) => update('allocationCapacityUnits', event.target.value)} required /></label>
                  <label className="text-sm font-semibold text-bxo-text-secondary">Tenant organization ID<input className={`${fieldClass} font-mono`} value={form.tenantOrgId} onChange={(event) => update('tenantOrgId', event.target.value)} readOnly={Boolean(existingOffering)} aria-readonly={Boolean(existingOffering)} required /></label>
                  <label className="text-sm font-semibold text-bxo-text-secondary">Legal-entity organization ID<input className={`${fieldClass} font-mono`} value={form.legalEntityOrgId} onChange={(event) => update('legalEntityOrgId', event.target.value)} readOnly={Boolean(existingOffering)} aria-readonly={Boolean(existingOffering)} required /></label>
                  <label className="text-sm font-semibold text-bxo-text-secondary">Transfer-agent organization ID<input className={`${fieldClass} font-mono`} value={form.transferAgentOrgId} onChange={(event) => update('transferAgentOrgId', event.target.value)} readOnly={Boolean(existingOffering)} aria-readonly={Boolean(existingOffering)} required /></label>
                  <label className="text-sm font-semibold text-bxo-text-secondary">Tokenisation-agent organization ID<input className={`${fieldClass} font-mono`} value={form.tokenisationAgentOrgId} onChange={(event) => update('tokenisationAgentOrgId', event.target.value)} readOnly={Boolean(existingOffering)} aria-readonly={Boolean(existingOffering)} required /></label>
                </div>
                <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Network</dt><dd className="mt-2 text-sm font-medium">{instrument?.runtime_scope === 'TESTNET' ? 'Public testnet' : 'Private validation network'}</dd></div>
                  <div className="rounded-xl border border-bxo-border-subtle p-4"><dt className="text-xs text-bxo-text-tertiary">Network target</dt><dd className="mt-2 font-mono text-sm">{runtimeScope === 'TESTNET' ? `${selectedTestnet?.name ?? 'Managed testnet'} · ${selectedTestnetChainID}` : `Local EVM · 31337 · ${localPilotExecutionReady ? 'execution ready' : 'not ready'}`}</dd></div>
                  <div className="rounded-xl border border-bxo-border-subtle p-4">
                    <dt className="text-xs text-bxo-text-tertiary">Consideration evidence</dt>
                    <dd className="mt-2 text-sm font-medium">{runtimeScope === 'TESTNET' ? 'Stripe test mode' : 'Independent synthetic test evidence'}</dd>
                    <p className="mt-1 text-xs text-bxo-text-tertiary">
                      {runtimeScope === 'TESTNET'
                        ? 'No real funds are accepted or settled in test mode.'
                        : 'No bank cash, provider settlement, public-testnet execution, or real value is represented.'}
                    </p>
                  </div>
                </dl>
              </section>
            )}

            <div className="flex gap-3 rounded-xl border border-bxo-warning-border bg-bxo-surface p-4 text-sm leading-6 text-bxo-text-secondary">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-bxo-warning" aria-hidden="true" />
              {creatingOffering
                ? runtimeScope === 'TESTNET'
                  ? 'This creates a draft Stripe test-payment profile. The creator cannot activate it, and Stripe test mode does not accept or settle real funds.'
                  : 'This creates a draft profile for independent synthetic test evidence. The creator cannot activate it. It is not bank cash, provider settlement, public-testnet execution, or real value.'
                : 'Submitting creates immutable draft terms. The creator cannot approve them; a separate checker must approve the exact terms hash.'}
            </div>

            {creatingOffering && !offeringTargetReady ? <div role="alert" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{offeringTargetBlockedMessage}</div> : null}
            {error ? <div role="alert" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{error}</div> : null}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button asChild variant="outline" className="h-12"><Link href="/wm/funds">Cancel</Link></Button>
              <Button className="bxo-primary-cta h-12 px-7 text-bxo-bg-primary" disabled={isSubmitting || !user || (creatingOffering && !offeringTargetReady)} type="submit">
                {isSubmitting
                  ? 'Writing controlled records…'
                  : creatingOffering
                    ? existingOffering ? 'Complete draft financial profile' : 'Create offering and draft profile'
                    : 'Create immutable draft terms'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
