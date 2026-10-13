'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FUND_V2_CANONICAL_REFERENCES, REAL_ESTATE_V2_CANONICAL_REFERENCES, containsLegacyDenomination, isFundTermsV2, isRealEstateTermsV2, isFundTermsV3, isRealEstateTermsV3, isFundTermsTyped, isRealEstateTermsTyped, productTermsSchema, type FundTermsV2, type FundTermsV3, type LegacyProductTerms, type RealEstateTermsV2, type RealEstateTermsV3, type PortalOrganisation, type PortalProduct, type PortalSnapshot, type ProductTerms } from '@/lib/portal/contracts'
import { prepareCommonEnvelopeUpgrade, sameJson, syncCommonEnvelopeReferences, type CommonEnvelopeTerms } from '@/lib/portal/product-common-envelope'
import { ProductCommonEnvelopeFields } from './product-common-envelope'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { CommandFeedback, usePortalCommand, usePortalCommandAllowed } from './portal-client'
import { Field, Notice, Panel, money } from './portal-primitives'
import styles from './portal.module.css'
import flow from './product-form-flow.module.css'
import { addProductDraftClass, removeProductDraftClass, customerReviewField, productSingleLineField, editableProductField, emptyProductDraft, productChoices, productDraftFields, productEditableIssuePath, productEditorIssues, productFieldLabel, productFieldStep, productIssuePath, productNumberFields, productSteps, setProductDraftValue, type ProductDraft, type ProductDraftValue } from '@/lib/portal/product-form-flow'


function ProductReview({ value, kind, version }: { value: unknown; kind: ProductTerms['asset_type']; version?: number }) {
  const [technicalVisible, setTechnicalVisible] = useState(false)
  const technicalId = useId()
  const fields = productDraftFields(value)
  const customerFields = fields.filter(item => customerReviewField(item.path, kind, version))
  const technicalFields = fields.filter(item => !customerReviewField(item.path, kind, version))
  const currency = fields.find(item => item.path === 'currency')?.value
  const decimals = fields.find(item => item.path === 'settlement_decimals')?.value
  const renderValue = (item: unknown) => Array.isArray(item) ? item.join(', ') || 'Not entered' : item === null ? 'Not applicable' : String(item) || 'Not entered'
  return <>
    <p><strong>Settlement unit:</strong> {String(currency ?? 'Not declared')}{decimals !== undefined ? ` · ${String(decimals)} decimals` : ''}. TEST units have no real monetary value. Saving does not approve settlement or enable payment.</p>
    <dl className={flow.summary}>{customerFields.map(item => <div key={item.path}><dt>{productFieldLabel(item.path)}</dt><dd>{renderValue(item.value)}</dd></div>)}</dl>
    <button type="button" className={styles.buttonSecondary} aria-controls={technicalId} aria-expanded={technicalVisible} onClick={() => setTechnicalVisible(current => !current)}>{technicalVisible ? 'Hide technical references' : 'View technical references'}</button>
    {technicalVisible ? <section id={technicalId} aria-label="Technical references"><p>Generated references and fixed protocol declarations are retained in the same payload. They do not prove deployment or approval.</p><dl className={flow.summary}>{technicalFields.map(item => <div key={item.path}><dt>{productFieldLabel(item.path)}</dt><dd>{renderValue(item.value)}</dd></div>)}</dl></section> : null}
  </>
}

function NewProductEditor({ organisations, onSaved, operatingContext, onUnsavedChange }: { organisations: PortalOrganisation[]; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext; onUnsavedChange?: (hasUnsaved: boolean) => void }) {
  const router = useRouter()
  const command = usePortalCommand(onSaved)
  const allowed = usePortalCommandAllowed('create_product')
  const [kind, setKind] = useState<ProductTerms['asset_type']>('FUND')
  const [drafts, setDrafts] = useState<Record<ProductTerms['asset_type'], ProductDraft>>(() => {
    const blank = (asset: ProductTerms['asset_type']) => {
      const template = fictionalProductTerms(asset)
      if (!isFundTermsV2(template) && !isRealEstateTermsV2(template)) throw new Error('Typed product template unavailable.')
      return emptyProductDraft(prepareCommonEnvelopeUpgrade(template, organisations[0]?.id ?? '', crypto.randomUUID(), crypto.randomUUID()))
    }
    return { FUND: blank('FUND'), REAL_ESTATE: blank('REAL_ESTATE') }
  })
  const [organisationId, setOrganisationId] = useState(organisations[0]?.id ?? '')
  const [step, setStep] = useState('identity')
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const [focusPath, setFocusPath] = useState('')
  const [created, setCreated] = useState(false)
  useEffect(() => { onUnsavedChange?.(!created) }, [created, onUnsavedChange])
  const container = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const steps = productSteps(kind, true, true), index = steps.findIndex(item => item.id === step)
  const draft = drafts[kind]
  const fields = productDraftFields(draft).filter(item => editableProductField(item.path, kind) && item.value !== null)
  const organisation = organisations.find(item => item.id === organisationId)
  const locked = command.busy || command.unknown || !allowed || !organisation || Boolean(operatingContext && !organisation.capabilities?.includes('create_product')) || Boolean(operatingContext?.mode === 'ROLE' && operatingContext.role !== 'OfferingManager')
  useEffect(() => {
    if (focusPath) container.current?.querySelector<HTMLElement>(`[data-product-field="${focusPath}"]`)?.focus()
    else heading.current?.focus()
  }, [step, focusPath])
  function update(path: string, value: ProductDraftValue) {
    setDrafts(current => ({ ...current, [kind]: setProductDraftValue(current[kind], path, value) }))
    setAcknowledged(false); setError('')
  }
  function navigate(next: string) { if (locked) return; setFocusPath(''); setStep(next) }
  async function save() {
    if (locked || !acknowledged) return
    const parsed = productTermsSchema.safeParse(draft)
    if (!parsed.success) {
      const issues = productEditorIssues(parsed.error.issues, kind, 3)
      const issue = issues.find(item => fields.some(field => field.path === productEditableIssuePath(item.path, kind)))
      const path = issue ? productEditableIssuePath(issue.path, kind) : fields.find(item => item.value === '' || Array.isArray(item.value) && !item.value.length)?.path ?? 'name'
      setStep(productFieldStep(path)); setFocusPath(path); setError(`${productFieldLabel(path)}: ${issue?.message ?? issues[0]?.message ?? 'complete this required field and review the remaining terms.'}`)
      return
    }
    const saved = await command.submit('create_product', { organisation_id: organisationId, terms: parsed.data })
    if (saved) { setCreated(true); router.push(portalScopeHref('/portal/products', operatingContext)) }
  }
  return <div ref={container} className={flow.flow}><Panel title="Create a product" description="Enter your own fund or property terms. TEST uses valueless TST; it does not invent an issuer, fees or legal rights.">
    <CommandFeedback command={command} />
    <p className={flow.status}>Not saved yet. Back and Continue keep answers in this open page only. Complete all sections before creating the server draft.</p>
    <ol className={flow.steps} aria-label="Product setup steps">{steps.map((item, position) => <li key={item.id}><button type="button" disabled={locked} aria-current={step === item.id ? 'step' : undefined} onClick={() => navigate(item.id)}>{position + 1}. {item.title}</button></li>)}</ol>
    <form noValidate className={styles.form} onSubmit={event => { event.preventDefault(); if (step === 'review') void save(); else navigate(steps[index + 1].id) }}>
      <p className={flow.status}>Step {index + 1} of {steps.length}</p><h2 ref={heading} tabIndex={-1} className={flow.heading}>{steps[index]?.title}</h2>
      {error ? <p role="alert" className={styles.fieldError}>{error}</p> : null}
      {step === 'identity' ? <div className={styles.formRow}><Field label="Managing organisation"><select disabled={locked} value={organisationId} onChange={event => { const id = event.target.value; setOrganisationId(id); setDrafts(current => ({ FUND: setProductDraftValue(current.FUND, 'common_envelope.manager_organisation_id', id), REAL_ESTATE: setProductDraftValue(current.REAL_ESTATE, 'common_envelope.manager_organisation_id', id) })); setAcknowledged(false) }}>{organisations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Asset template" hint="Switching keeps both unsaved templates in this open page."><select disabled={locked} value={kind} onChange={event => { if (event.target.value === 'FUND' || event.target.value === 'REAL_ESTATE') { setKind(event.target.value); setAcknowledged(false); setError('') } }}><option value="FUND">Investment fund</option><option value="REAL_ESTATE">Real-estate investment</option></select></Field></div> : null}
      {step === 'economics' ? <p>TST uses 6 decimals. Enter prices as integer base units. Whole-unit capacity and minimum subscription are separate.</p> : null}
      {step === 'common-issuer' ? <><p>The primary class mirrors your class name, rights and pricing. Additional classes declare rights only; they do not create another live investment product.</p><button type="button" className={styles.buttonSecondary} disabled={locked || fields.filter(item => /^common_envelope\.classes\.\d+\.name$/.test(item.path)).length >= 9} onClick={() => { setDrafts(current => ({ ...current, [kind]: addProductDraftClass(current[kind], crypto.randomUUID()) })); setAcknowledged(false) }}>Add declaration-only class</button></> : null}
      {step === 'common-issuer' ? fields.filter(item => /^common_envelope\.classes\.\d+\.name$/.test(item.path)).map(item => <button key={item.path} type="button" className={styles.buttonSecondary} disabled={locked} onClick={() => { setDrafts(current => ({ ...current, [kind]: removeProductDraftClass(current[kind], Number(item.path.split('.')[2])) })); setAcknowledged(false) }}>Remove additional class {item.path.split('.')[2]}{item.value ? `: ${String(item.value)}` : ''}</button>) : null}
      {step === 'common-configuration' ? <p>Select controller operator, independent governance and independent compliance, plus recovery custodian if proposed. The threshold must be between 2 and the selected slot count. These declarations do not grant signing authority or deploy a contract.</p> : null}
      {step === 'eligibility' ? <p>Enter uppercase two-letter country codes separated by commas without spaces. Your values and order are preserved exactly.</p> : null}
      {step !== 'review' ? <fieldset disabled={locked} className={styles.fieldset}><legend>{steps[index]?.title}</legend>{fields.filter(item => productFieldStep(item.path) === step).map(item => {
        const choice = productChoices[item.path]
        const value = typeof item.value === 'string' || typeof item.value === 'number' ? item.value : ''
        return <Field key={item.path} label={productFieldLabel(item.path)}>{item.path === 'eligible_investor_types' ? <select multiple data-product-field={item.path} value={Array.isArray(item.value) ? item.value.filter((entry): entry is string => typeof entry === 'string') : []} onChange={event => update(item.path, [...event.target.selectedOptions].map(option => option.value))}><option value="INDIVIDUAL">Individual investors</option><option value="ENTITY">Entity investors</option></select> : item.path === 'eligible_countries' ? <input data-product-field={item.path} value={Array.isArray(item.value) ? item.value.join(',') : ''} onChange={event => update(item.path, event.target.value.split(','))} /> : choice && Array.isArray(item.value) ? <select multiple data-product-field={item.path} value={item.value.filter((entry): entry is string => typeof entry === 'string')} onChange={event => update(item.path, [...event.target.selectedOptions].map(option => option.value))}>{choice.map(option => <option key={option} value={option}>{option.toLowerCase().replaceAll('_', ' ')}</option>)}</select> : choice ? <select data-product-field={item.path} value={value} onChange={event => update(item.path, event.target.value)}><option value="">Choose explicitly</option>{choice.map(option => <option key={option} value={option}>{option.toLowerCase()}</option>)}</select> : productNumberFields.has(item.path) ? <input data-product-field={item.path} inputMode="numeric" value={value} onChange={event => update(item.path, /^\d+$/.test(event.target.value) && Number.isSafeInteger(Number(event.target.value)) ? Number(event.target.value) : event.target.value)} /> : productSingleLineField(item.path) ? <input data-product-field={item.path} value={value} onChange={event => update(item.path, event.target.value)} /> : <textarea data-product-field={item.path} rows={item.path.startsWith('documents.') ? 8 : 3} value={value} onChange={event => update(item.path, event.target.value)} />}</Field>
      })}</fieldset> : <><ProductReview value={draft} kind={kind} version={3} /><label className={styles.check}><input type="checkbox" disabled={locked} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed these TEST terms. Saving does not submit, publish, sign or fund this product.</label></>}
      <div className={flow.navigation}><button type="button" className={styles.buttonSecondary} disabled={locked || index === 0} onClick={() => navigate(steps[index - 1].id)}>Back</button>{step === 'review' ? <button className={styles.button} disabled={locked || !acknowledged}>{command.busy ? 'Saving…' : 'Create product draft'}</button> : <button className={styles.button} disabled={locked}>Continue</button>}</div>
    </form>
  </Panel></div>
}

export function fictionalProductTerms(kind: ProductTerms['asset_type'] = 'FUND'): ProductTerms {
  const realEstate = kind === 'REAL_ESTATE'
  const common = {
    asset_type: kind, name: realEstate ? 'Example Property Investment (Test)' : 'Example Multi-Asset Fund (Test)', issuer_name: 'Example Issuer (fictional test entity)',
    summary: realEstate ? 'A fictional investment in a demonstration rental property. This product exists only to test the customer investment journey.' : 'A fictional diversified fund for demonstrating onboarding, offering review and investor subscription. No real assets or investment returns are represented.',
    strategy: realEstate ? 'The fictional issuer holds a single synthetic property. The example strategy is long-term rental income and an eventual governed exit. No real property is being offered.' : 'The fictional fund allocates synthetic capital across a diversified investment mandate. All allocations and performance are illustrative descriptions, not live holdings or forecasts.',
    share_class: 'Class A (Test)',
    pricing_basis: realEstate ? 'Fixed synthetic subscription price of 100.00 ZAR_TEST per whole unit. No independent valuation is represented.' : 'Initial subscription reference is 10.000000 valueless TST per whole fund unit. Subsequent NAV pricing needs a dated, independently reviewed valuation before dealing.',
    fees: 'Illustrative management fee: 0% during this test. No real fee will be charged. Production fees require a separately approved schedule.',
    redemption_terms: 'Redemption is subject to the fictional product terms, available synthetic liquidity and a separately governed approval process. This offering does not promise immediate liquidity or a production exit.',
    eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'] as ProductTerms['eligible_investor_types'],
    property_address: realEstate ? '1 Example Avenue, Fictional District, Test City (not a real property)' : '',
    property_valuation_minor: realEstate ? '100000000' : '0',
    rental_income_policy: realEstate ? 'Any rental income recorded in this test is synthetic. Net fictional income is allocated according to approved investor entitlements; no real tenant rent or bank payment is represented.' : '',
    documents: {
      memorandum: 'FICTIONAL TEST MEMORANDUM. This example product is not an offer of securities or a representation that a real issuer or asset exists. It demonstrates a multi-asset platform workflow using synthetic currency. The issuer, strategy, unit terms and eligibility rules must be reviewed as one version before publication. No live investment performance is shown.',
      risks: 'FICTIONAL TEST RISK DISCLOSURE. Tokenised investments can involve loss of capital, liquidity constraints, valuation uncertainty, counterparty risk, legal uncertainty, smart-contract risk and operational failure. This test does not evaluate or remove those risks. A test review is not regulated advice, legal clearance or an independent contract audit.',
      subscription_terms: 'FICTIONAL TEST SUBSCRIPTION TERMS. The applicant accepts the exact published offering revision and its document hash. A subscription reserves whole units and records the requested subscription amount in synthetic currency only. Acceptance does not constitute funding, token issuance, legal ownership or a bank payment. Settlement and issuance require separately verified workflow evidence.',
    },
  }
  if (realEstate) return {
    ...common, ...REAL_ESTATE_V2_CANONICAL_REFERENCES,
    asset_type: 'REAL_ESTATE', currency: 'TST', terms_version: 2, settlement_decimals: 6,
    unit_price_minor: '100000000', cap_units: '20', minimum_units: '1',
    property_valuation_minor: '3000000000',
    real_estate: {
      spv: {
        legal_name: 'Example Property SPV (fictional test entity)', registration_reference: 'FICTIONAL-SPV-001', jurisdiction: 'ZA',
        interest_rights: 'Each test interest represents a stated class right against the fictional SPV under approved terms, not direct title to the underlying property or proof of a legal claim.',
      },
      property: {
        title_evidence_reference: 'FICTIONAL-TITLE-001', control_evidence_reference: 'FICTIONAL-CONTROL-001',
        valuation_method: 'Illustrative property appraisal supplied as a synthetic fixture; a dated independent valuation and any financing liabilities require review before real pricing.',
        valuation_frequency: 'ANNUALLY',
        correction_policy: 'A material property valuation error requires a dated correction version and reviewed treatment of affected investors and distributions.',
      },
      financing: {
        debt_policy: 'No real borrowing is represented. Any proposed property debt, priority, security and covenant effects require a separately approved schedule.',
        lender_consent_policy: 'If financing exists, the issuer must evidence required lender consents before transfer, disposal or change of control; none is presumed here.',
      },
      cashflow: {
        rent_policy: 'Only fictional rent events may be used in this test. A receipt claim is not distributable cash until independently reconciled.',
        expense_policy: 'Property operating expenses and taxes are reviewed and recorded before calculating any net distributable amount.',
        reserve_policy: 'A reviewed maintenance and contingency reserve is retained before any synthetic income distribution.',
        distribution_policy: 'Record-date entitlements, approved net income, available test liquidity and authorised payment evidence are required for distributions.',
      },
      governance: {
        consent_rights: 'The interest class may require a documented holder consent for material property disposals, financing changes and amendments to economic rights.',
        voting_policy: 'Voting eligibility and threshold are recorded against a dated holder snapshot; no vote or consent is inferred from this template.',
      },
      exits: {
        eligible_transfer_policy: 'An eligible interest transfer settles consideration and updates the approved holder register while the property product continues; eligibility and restrictions are rechecked.',
        disposal_liquidation_policy: 'A property disposal and SPV liquidation require reviewed proceeds, creditor and reserve waterfall, authorised payouts and reconciled closure of interests and supply.',
      },
    },
  }
  return {
    ...common, asset_type: 'FUND', currency: 'TST', terms_version: 2, settlement_decimals: 6,
    ...FUND_V2_CANONICAL_REFERENCES,
    unit_price_minor: '10000000', cap_units: '100', minimum_units: '1',
    fund: {
      mandate: 'Illustrative diversified mandate using synthetic test positions only. Asset selection, concentration and risk limits require an appointed issuer approval before any real product.',
      class_rights: 'Each fictional Class A unit represents a pro-rata test entitlement under the approved fund register; it is not direct ownership of an underlying asset or an independently verified legal claim.',
      nav: { valuation_method: 'Illustrative marked-to-model NAV from synthetic positions and accrued liabilities, subject to dated independent review.', frequency: 'MONTHLY', pricing_cutoff: 'Last business day of each calendar month at 16:00 Africa/Johannesburg.', correction_policy: 'A material NAV error requires a reviewed correction version and explicit treatment of affected subscriptions or redemptions.' },
      dealing: { subscription_frequency: 'MONTHLY', redemption_frequency: 'MONTHLY', notice_days: 5, settlement_days: 5 },
      fees: { management_bps: 0, performance_bps: 0, other_fees: 'No additional fees are charged in this synthetic test fixture.' },
      liquidity: { lockup_days: 0, gate_bps: 10000, suspension_policy: 'Dealing may be suspended when NAV, available liquidity or settlement evidence is unavailable; any decision requires governed review.' },
      distributions: { frequency: 'QUARTERLY', policy: 'A fictional quarterly income event requires a reviewed record-date entitlement, available test liquidity and authorised payout; this package does not calculate or pay income by itself.' },
      redemption: { price_basis: 'NAV', conditions: 'A redemption request follows the approved dealing date, reviewed NAV, available test liquidity and final unit protection before any payout.' },
    },
  }
}

/** Historical free text can hide old prices without saying ZAR_TEST. Copy no v1 fields into a new TST draft. */
export function upgradeLegacyDraftTerms(legacy: LegacyProductTerms): FundTermsV2 | RealEstateTermsV2 {
  return fictionalProductTerms(legacy.asset_type) as FundTermsV2 | RealEstateTermsV2
}

function FundPolicyFields({ terms, disabled, onChange, section }: {
  terms: FundTermsV2 | FundTermsV3; disabled: boolean; section?: string;
  onChange: <K extends keyof FundTermsV2['fund']>(name: K, value: FundTermsV2['fund'][K]) => void;
}) {
  const fund = terms.fund
  return <>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'rights'} disabled={disabled} className={styles.fieldset}><legend>03 · Fund mandate and class rights</legend>
      <p className={styles.muted}>These are the fund-specific rights to be reviewed with the same offering package. Naming an issuer or manager does not appoint either one.</p>
      <Field label="Mandate, limits and permitted investments"><textarea required minLength={30} maxLength={terms.terms_version === 3 ? 8000 : 4000} data-product-field="fund.mandate" value={fund.mandate} onChange={event => onChange('mandate', event.target.value)} /></Field>
      <Field label="Unit-class rights and investor claim"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4800 : 2400} data-product-field="fund.class_rights" value={fund.class_rights} onChange={event => onChange('class_rights', event.target.value)} /></Field>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'valuation'} disabled={disabled} className={styles.fieldset}><legend>04 · NAV and dealing rules</legend>
      <Field label="NAV valuation method"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="fund.nav.valuation_method" value={fund.nav.valuation_method} onChange={event => onChange('nav', { ...fund.nav, valuation_method: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="NAV frequency"><select data-product-field="fund.nav.frequency" value={fund.nav.frequency} onChange={event => onChange('nav', { ...fund.nav, frequency: event.target.value as typeof fund.nav.frequency })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></Field><Field label="Pricing cutoff" hint="Include the time zone and business-day rule."><input required minLength={10} maxLength={terms.terms_version === 3 ? 600 : 300} data-product-field="fund.nav.pricing_cutoff" value={fund.nav.pricing_cutoff} onChange={event => onChange('nav', { ...fund.nav, pricing_cutoff: event.target.value })} /></Field></div>
      <Field label="NAV error and correction policy"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="fund.nav.correction_policy" value={fund.nav.correction_policy} onChange={event => onChange('nav', { ...fund.nav, correction_policy: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Subscription dealing"><select data-product-field="fund.dealing.subscription_frequency" value={fund.dealing.subscription_frequency} onChange={event => onChange('dealing', { ...fund.dealing, subscription_frequency: event.target.value as typeof fund.dealing.subscription_frequency })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></Field><Field label="Redemption dealing"><select data-product-field="fund.dealing.redemption_frequency" value={fund.dealing.redemption_frequency} onChange={event => onChange('dealing', { ...fund.dealing, redemption_frequency: event.target.value as typeof fund.dealing.redemption_frequency })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></Field></div>
      <div className={styles.formRow}><Field label="Redemption notice (calendar days)"><input required type="number" min={0} max={365} step={1} data-product-field="fund.dealing.notice_days" value={fund.dealing.notice_days} onChange={event => onChange('dealing', { ...fund.dealing, notice_days: Number(event.target.value) })} /></Field><Field label="Target settlement (days)" hint="A target, not proof of liquidity or payment."><input required type="number" min={0} max={30} step={1} data-product-field="fund.dealing.settlement_days" value={fund.dealing.settlement_days} onChange={event => onChange('dealing', { ...fund.dealing, settlement_days: Number(event.target.value) })} /></Field></div>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'income'} disabled={disabled} className={styles.fieldset}><legend>05 · Fees, liquidity, income and exit</legend>
      <div className={styles.formRow}><Field label="Management fee (basis points)" hint="100 bps = 1%. Enter 0 for the no-fee test fixture."><input required type="number" min={0} max={10000} step={1} data-product-field="fund.fees.management_bps" value={fund.fees.management_bps} onChange={event => onChange('fees', { ...fund.fees, management_bps: Number(event.target.value) })} /></Field><Field label="Performance fee (basis points)"><input required type="number" min={0} max={10000} step={1} data-product-field="fund.fees.performance_bps" value={fund.fees.performance_bps} onChange={event => onChange('fees', { ...fund.fees, performance_bps: Number(event.target.value) })} /></Field></div>
      <Field label="Other fees and expenses"><textarea required minLength={10} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="fund.fees.other_fees" value={fund.fees.other_fees} onChange={event => onChange('fees', { ...fund.fees, other_fees: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Lock-up (calendar days)"><input required type="number" min={0} max={3650} step={1} data-product-field="fund.liquidity.lockup_days" value={fund.liquidity.lockup_days} onChange={event => onChange('liquidity', { ...fund.liquidity, lockup_days: Number(event.target.value) })} /></Field><Field label="Redemption gate (basis points)" hint="10,000 bps = 100% of the permitted dealing amount."><input required type="number" min={0} max={10000} step={1} data-product-field="fund.liquidity.gate_bps" value={fund.liquidity.gate_bps} onChange={event => onChange('liquidity', { ...fund.liquidity, gate_bps: Number(event.target.value) })} /></Field></div>
      <Field label="Suspension and liquidity policy"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="fund.liquidity.suspension_policy" value={fund.liquidity.suspension_policy} onChange={event => onChange('liquidity', { ...fund.liquidity, suspension_policy: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Income distribution schedule"><select data-product-field="fund.distributions.frequency" value={fund.distributions.frequency} onChange={event => onChange('distributions', { ...fund.distributions, frequency: event.target.value as typeof fund.distributions.frequency })}><option value="NONE">Accumulation / none</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUALLY">Annually</option></select></Field><Field label="Redemption price basis"><input value="Reviewed NAV" readOnly /></Field></div>
      <Field label="Distribution and reinvestment policy"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="fund.distributions.policy" value={fund.distributions.policy} onChange={event => onChange('distributions', { ...fund.distributions, policy: event.target.value })} /></Field>
      <Field label="Redemption conditions"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4800 : 2400} data-product-field="fund.redemption.conditions" value={fund.redemption.conditions} onChange={event => onChange('redemption', { ...fund.redemption, conditions: event.target.value })} /></Field>
    </fieldset>
  </>
}

function PropertyPolicyFields({ terms, disabled, onChange, section }: {
  terms: RealEstateTermsV2 | RealEstateTermsV3; disabled: boolean; section?: string;
  onChange: <K extends keyof RealEstateTermsV2['real_estate']>(name: K, value: RealEstateTermsV2['real_estate'][K]) => void;
}) {
  const property = terms.real_estate
  return <>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'rights'} disabled={disabled} className={styles.fieldset}><legend>03 · SPV and investor interest</legend>
      <p className={styles.muted}>These are proposed rights in a fictional SPV. Naming an SPV, issuer or property does not establish legal title, custody or an appointment.</p>
      <div className={styles.formRow}><Field label="SPV legal name"><input required minLength={3} maxLength={terms.terms_version === 3 ? 320 : 160} data-product-field="real_estate.spv.legal_name" value={property.spv.legal_name} onChange={event => onChange('spv', { ...property.spv, legal_name: event.target.value })} /></Field><Field label="SPV registration reference"><input required minLength={3} maxLength={terms.terms_version === 3 ? 200 : 100} data-product-field="real_estate.spv.registration_reference" value={property.spv.registration_reference} onChange={event => onChange('spv', { ...property.spv, registration_reference: event.target.value })} /></Field></div>
      <Field label="SPV jurisdiction" hint="Uppercase two-letter country code."><input required minLength={2} maxLength={2} data-product-field="real_estate.spv.jurisdiction" value={property.spv.jurisdiction} onChange={event => onChange('spv', { ...property.spv, jurisdiction: terms.terms_version === 3 ? event.target.value : event.target.value.toUpperCase() })} /></Field>
      <Field label="Interest-class rights" hint="Explain the claim against the SPV; do not describe an interest as direct property title unless that is legally established."><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4800 : 2400} data-product-field="real_estate.spv.interest_rights" value={property.spv.interest_rights} onChange={event => onChange('spv', { ...property.spv, interest_rights: event.target.value })} /></Field>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'valuation'} disabled={disabled} className={styles.fieldset}><legend>04 · Property evidence, valuation and financing</legend>
      <p className={styles.muted}>Evidence references describe documents to be checked. Entering a reference does not upload, verify or sign the underlying document.</p>
      <div className={styles.formRow}><Field label="Title evidence reference"><input required minLength={10} maxLength={terms.terms_version === 3 ? 800 : 400} data-product-field="real_estate.property.title_evidence_reference" value={property.property.title_evidence_reference} onChange={event => onChange('property', { ...property.property, title_evidence_reference: event.target.value })} /></Field><Field label="Control evidence reference"><input required minLength={10} maxLength={terms.terms_version === 3 ? 800 : 400} data-product-field="real_estate.property.control_evidence_reference" value={property.property.control_evidence_reference} onChange={event => onChange('property', { ...property.property, control_evidence_reference: event.target.value })} /></Field></div>
      <Field label="Valuation method"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.property.valuation_method" value={property.property.valuation_method} onChange={event => onChange('property', { ...property.property, valuation_method: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Valuation frequency"><select data-product-field="real_estate.property.valuation_frequency" value={property.property.valuation_frequency} onChange={event => onChange('property', { ...property.property, valuation_frequency: event.target.value as typeof property.property.valuation_frequency })}><option value="QUARTERLY">Quarterly</option><option value="ANNUALLY">Annually</option></select></Field><Field label="Valuation corrections"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.property.correction_policy" value={property.property.correction_policy} onChange={event => onChange('property', { ...property.property, correction_policy: event.target.value })} /></Field></div>
      <Field label="Debt and security policy"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.financing.debt_policy" value={property.financing.debt_policy} onChange={event => onChange('financing', { ...property.financing, debt_policy: event.target.value })} /></Field>
      <Field label="Lender consent policy"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.financing.lender_consent_policy" value={property.financing.lender_consent_policy} onChange={event => onChange('financing', { ...property.financing, lender_consent_policy: event.target.value })} /></Field>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'income'} disabled={disabled} className={styles.fieldset}><legend>05 · Rent, expenses, reserves and income</legend>
      <Field label="Rent evidence and collection"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.cashflow.rent_policy" value={property.cashflow.rent_policy} onChange={event => onChange('cashflow', { ...property.cashflow, rent_policy: event.target.value })} /></Field>
      <Field label="Operating expenses and taxes"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.cashflow.expense_policy" value={property.cashflow.expense_policy} onChange={event => onChange('cashflow', { ...property.cashflow, expense_policy: event.target.value })} /></Field>
      <Field label="Property reserves"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.cashflow.reserve_policy" value={property.cashflow.reserve_policy} onChange={event => onChange('cashflow', { ...property.cashflow, reserve_policy: event.target.value })} /></Field>
      <Field label="Distribution policy"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.cashflow.distribution_policy" value={property.cashflow.distribution_policy} onChange={event => onChange('cashflow', { ...property.cashflow, distribution_policy: event.target.value })} /></Field>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'exits'} disabled={disabled} className={styles.fieldset}><legend>06 · Consents and distinct exits</legend>
      <Field label="Holder consent rights"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.governance.consent_rights" value={property.governance.consent_rights} onChange={event => onChange('governance', { ...property.governance, consent_rights: event.target.value })} /></Field>
      <Field label="Voting rules"><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4000 : 2000} data-product-field="real_estate.governance.voting_policy" value={property.governance.voting_policy} onChange={event => onChange('governance', { ...property.governance, voting_policy: event.target.value })} /></Field>
      <Field label="Eligible interest transfer" hint="A transfer changes the holder; the property product continues."><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4800 : 2400} data-product-field="real_estate.exits.eligible_transfer_policy" value={property.exits.eligible_transfer_policy} onChange={event => onChange('exits', { ...property.exits, eligible_transfer_policy: event.target.value })} /></Field>
      <Field label="Property disposal and liquidation" hint="A disposal requires a proceeds waterfall and product closure; it is not the same as an interest transfer."><textarea required minLength={20} maxLength={terms.terms_version === 3 ? 4800 : 2400} data-product-field="real_estate.exits.disposal_liquidation_policy" value={property.exits.disposal_liquidation_policy} onChange={event => onChange('exits', { ...property.exits, disposal_liquidation_policy: event.target.value })} /></Field>
    </fieldset>
  </>
}

function SavedProductEditor({ organisations, product, onSaved, operatingContext, onUnsavedChange }: { organisations: PortalOrganisation[]; product?: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext; onUnsavedChange?: (hasUnsaved: boolean) => void }) {
  const router = useRouter()
  const [step, setStep] = useState('identity')
  const [focusPath, setFocusPath] = useState('')
  const editor = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [terms, setTerms] = useState<ProductTerms>(() => product?.terms ?? fictionalProductTerms())
  const [organisationId, setOrganisationId] = useState(product?.organisation_id ?? organisations[0]?.id ?? '')
  const hasUnsaved = !product || organisationId !== product.organisation_id || !sameJson(terms, product.terms)
  useEffect(() => { onUnsavedChange?.(hasUnsaved) }, [hasUnsaved, onUnsavedChange])
  const [acknowledged, setAcknowledged] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')
  const command = usePortalCommand(onSaved)
  const commandAvailable = usePortalCommandAllowed(product ? 'save_product' : 'create_product')
  const typedFund = isFundTermsTyped(terms) ? terms : null
  const typedProperty = isRealEstateTermsTyped(terms) ? terms : null
  const commonTerms = isFundTermsV3(terms) || isRealEstateTermsV3(terms) ? terms : null
  const steps = productSteps(terms.asset_type, Boolean(typedFund || typedProperty), Boolean(commonTerms))
  const stepIndex = Math.max(0, steps.findIndex(item => item.id === step))
  useEffect(() => {
    if (focusPath) {
      const fields = Array.from(editor.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea') ?? []).filter(field => !field.closest('[hidden]') && !field.disabled)
      const target = fields.find(field => field.dataset.productField === focusPath) ?? fields.find(field => !field.validity.valid) ?? fields.find(field => !('readOnly' in field) || !field.readOnly)
      target?.focus()
    }
    else heading.current?.focus()
  }, [step, focusPath])
  const typedPolicy = Boolean(typedFund || typedProperty)
  const legacyFundDraft = terms.asset_type === 'FUND' && terms.currency === 'ZAR_TEST'
  const legacyPropertyDraft = terms.asset_type === 'REAL_ESTATE' && terms.currency === 'ZAR_TEST'
  const legacyReference = typedPolicy && containsLegacyDenomination(terms)
  function changed(next: ProductTerms): ProductTerms { return isFundTermsV3(next) || isRealEstateTermsV3(next) ? syncCommonEnvelopeReferences(next) : next }
  function change<K extends keyof ProductTerms>(name: K, value: ProductTerms[K]) { setValidationMessage(''); setTerms(previous => changed({ ...previous, [name]: value })) }
  function changeFund<K extends keyof FundTermsV2['fund']>(name: K, value: FundTermsV2['fund'][K]) { setValidationMessage(''); setTerms(previous => isFundTermsTyped(previous) ? changed({ ...previous, fund: { ...previous.fund, [name]: value } }) : previous) }
  function changeProperty<K extends keyof RealEstateTermsV2['real_estate']>(name: K, value: RealEstateTermsV2['real_estate'][K]) { setValidationMessage(''); setTerms(previous => isRealEstateTermsTyped(previous) ? changed({ ...previous, real_estate: { ...previous.real_estate, [name]: value } }) : previous) }
  function changeKind(kind: ProductTerms['asset_type']) {
    if (kind === terms.asset_type) return
    if (product) return
    setTerms(fictionalProductTerms(kind)); setAcknowledged(false); setValidationMessage('')
  }
  function upgradeLegacyFundDraft() {
    setTerms(previous => previous.asset_type !== 'FUND' || previous.currency !== 'ZAR_TEST' ? previous : upgradeLegacyDraftTerms(previous))
    setAcknowledged(false); setValidationMessage('')
  }
  function upgradeLegacyPropertyDraft() {
    setTerms(previous => previous.asset_type !== 'REAL_ESTATE' || previous.currency !== 'ZAR_TEST' ? previous : upgradeLegacyDraftTerms(previous))
    setAcknowledged(false); setValidationMessage('')
  }
  const selectedOrganisation = organisations.find(item => item.id === organisationId)
  const recordAvailable = Boolean(selectedOrganisation && (!operatingContext || selectedOrganisation.capabilities?.includes(product ? 'save_product' : 'create_product'))
    && (!product || ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status) && product.allowed_actions?.includes('save_product')))
  const locked = command.busy || command.unknown || !recordAvailable || !commandAvailable
    || operatingContext?.mode === 'ROLE' && operatingContext.role !== 'OfferingManager'
  function upgradeCommonEnvelope() {
    if (locked || !(isFundTermsV2(terms) || isRealEstateTermsV2(terms))) return
    setTerms(prepareCommonEnvelopeUpgrade(terms, organisationId, crypto.randomUUID(), crypto.randomUUID()))
    setAcknowledged(false); setValidationMessage('')
  }
  return <div ref={editor} className={`${styles.stack} ${flow.flow}`} id={product?.terms.asset_type === 'FUND' ? 'fund-draft-editor' : product?.terms.asset_type === 'REAL_ESTATE' ? 'property-draft-editor' : undefined}>
    <p className={flow.status}>Editing saved workflow revision {product?.revision}. Changes on this page are not saved until Save revised draft succeeds. Continuing does not submit or publish.</p>
    {legacyFundDraft ? <Notice title="Historical fund draft needs an explicit terms upgrade" tone="warning">This draft uses the old ZAR_TEST denomination. Upgrading replaces every editable field, including old prices, names, summary and disclosure text, with a fictional six-decimal TST template. Nothing is saved until you choose Save. Re-author and review the entire new package; no old promise or disclosure is copied across.<div className={styles.sectionGap}><button type="button" className={styles.buttonSecondary} onClick={upgradeLegacyFundDraft}>Upgrade this fund draft to v2 TST terms</button></div></Notice> : null}
    {legacyPropertyDraft ? <Notice title="Historical property draft needs an explicit terms upgrade" tone="warning">This draft uses the old ZAR_TEST denomination. Upgrading replaces every editable field, including old valuation, names, address, summary and disclosure text, with a fictional six-decimal TST template. The old valuation is not converted or treated as offering capacity. Nothing is saved until you choose Save. Re-author and review the whole SPV, property, cashflow and exit package.<div className={styles.sectionGap}><button type="button" className={styles.buttonSecondary} onClick={upgradeLegacyPropertyDraft}>Upgrade this property draft to v2 TST terms</button></div></Notice> : null}
    {typedPolicy && !commonTerms ? <Notice title="Issuer and operating arrangements are incomplete">This saved package remains readable and writable unchanged. Completing the arrangements preserves its TST economics and disclosures and adds proposal text for you to re-author and review, stable product-local references and separately reviewed configuration. No saved history is changed until Save. Complete these arrangements before submitting.<div className={styles.sectionGap}><button type="button" disabled={locked} className={styles.buttonSecondary} onClick={upgradeCommonEnvelope}>Complete issuer and operating arrangements</button></div></Notice> : null}
    <Panel title={product ? 'Edit product draft' : 'Create a product'} description="Prepare fund or real-estate terms. Submission seals an immutable offering package for separate decisions.">
      <CommandFeedback command={command} />
      {validationMessage ? <p className={styles.fieldError} role="alert">{validationMessage}</p> : null}
      <ol className={flow.steps} aria-label="Product setup steps">{steps.map((item, index) => <li key={item.id}><button type="button" disabled={locked} aria-current={step === item.id ? 'step' : undefined} onClick={() => { setStep(item.id); setFocusPath('') }}>{index + 1}. {item.title}</button></li>)}</ol>
      <p className={flow.status}>Step {stepIndex + 1} of {steps.length}</p><h2 ref={heading} tabIndex={-1} className={flow.heading}>{steps[stepIndex].title}</h2>
      <form noValidate className={styles.form} onSubmit={async event => {
        event.preventDefault()
        if (locked) return
        if (step !== 'review') { setStep(steps[stepIndex + 1].id); setFocusPath(''); return }
        if (locked || !acknowledged || legacyFundDraft || legacyPropertyDraft || legacyReference) return
        const parsed = productTermsSchema.safeParse(terms)
        if (!parsed.success) { const issue = productEditorIssues(parsed.error.issues, terms.asset_type, 'terms_version' in terms ? terms.terms_version : undefined)[0]; const path = issue ? commonTerms ? productEditableIssuePath(issue.path, terms.asset_type) : productIssuePath(issue.path) : 'name'; setStep(productFieldStep(path)); setFocusPath(path); setValidationMessage(`Review ${productFieldLabel(path)}: ${issue?.message ?? 'the terms are incomplete'}`); return }
        if (commonTerms && commonTerms.common_envelope.manager_organisation_id !== organisationId) { setValidationMessage('The declared manager must match this exact product organisation.'); return }
        const saved = await command.submit(product ? 'save_product' : 'create_product', product ? { product_id: product.id, expected_revision: product.revision, terms: parsed.data } : { organisation_id: organisationId, terms: parsed.data })
        if (saved && !product) router.push(portalScopeHref('/portal/products', operatingContext))
      }}>
        <fieldset hidden={step !== 'identity'} disabled={locked} className={styles.fieldset}><legend>01 · Product and issuer</legend>
          <div className={styles.formRow}><Field label="Managing organisation"><select required disabled={Boolean(product)} value={organisationId} onChange={event => { const value = event.target.value; setOrganisationId(value); setTerms(previous => isFundTermsV3(previous) || isRealEstateTermsV3(previous) ? { ...previous, common_envelope: { ...previous.common_envelope, manager_organisation_id: value } } : previous) }}>{organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></Field><Field label="Asset template" hint={product ? 'A saved product keeps its asset template; create a separate product for another asset.' : 'Switching templates resets this unsaved form.'}><select disabled={Boolean(product)} data-product-field="asset_type" value={terms.asset_type} onChange={event => changeKind(event.target.value as ProductTerms['asset_type'])}><option value="FUND">Investment fund</option><option value="REAL_ESTATE">Real-estate investment</option></select></Field></div>
          <div className={styles.formRow}><Field label="Product name"><input required minLength={3} maxLength={commonTerms ? 240 : 120} data-product-field="name" value={terms.name} onChange={event => change('name', event.target.value)} /></Field><Field label="Issuing legal entity" hint={commonTerms ? 'Read-only link to the explicit issuer declaration below.' : 'Test environment: use an explicitly fictional entity name.'}><input required readOnly={Boolean(commonTerms)} minLength={3} maxLength={commonTerms ? 320 : 160} data-product-field="issuer_name" value={terms.issuer_name} onChange={commonTerms ? undefined : event => change('issuer_name', event.target.value)} /></Field></div>
          <Field label="Investor-facing summary"><textarea required minLength={30} maxLength={commonTerms ? 1200 : 600} data-product-field="summary" value={terms.summary} onChange={event => change('summary', event.target.value)} /></Field>
          <Field label={typedPolicy ? 'Mandate source (generated reference)' : 'Investment strategy and mandate'} hint={typedFund ? 'Edit the authoritative fund mandate in section 03 below.' : typedProperty ? 'Edit the authoritative SPV and property rights in section 03 below.' : undefined}><textarea required={!typedPolicy} readOnly={typedPolicy} minLength={30} maxLength={commonTerms ? 8000 : 4000} data-product-field="strategy" value={terms.strategy} onChange={typedPolicy ? undefined : event => change('strategy', event.target.value)} /></Field>
          {terms.asset_type === 'REAL_ESTATE' ? <><div className={styles.formRow}><Field label="Property address / asset description"><input required minLength={10} maxLength={commonTerms ? 600 : 300} data-product-field="property_address" value={terms.property_address} onChange={event => change('property_address', event.target.value)} /></Field><Field label={typedProperty ? 'Illustrative property valuation (TST base units)' : 'Historical property valuation (synthetic cents)'} hint={typedProperty ? `${money(terms.property_valuation_minor, 'TST')} reference value; not the offering cap, a verified appraisal or available cash.` : undefined}><input required inputMode="numeric" pattern="[1-9][0-9]*" data-product-field="property_valuation_minor" value={terms.property_valuation_minor} onChange={event => change('property_valuation_minor', event.target.value)} /></Field></div>{typedProperty ? <p className={styles.muted}>This property valuation is independent of the offering capacity and price per interest below. Any real valuation must be dated and independently reviewed.</p> : <Field label="Historical rental-income policy"><textarea required minLength={20} maxLength={commonTerms ? 4000 : 2000} data-product-field="rental_income_policy" value={terms.rental_income_policy} onChange={event => change('rental_income_policy', event.target.value)} /></Field>}</> : null}
        </fieldset>
        <hr className={styles.divider} />
        <fieldset hidden={step !== 'economics'} disabled={locked} className={styles.fieldset}><legend>02 · Class and initial subscription terms</legend>
          <div className={styles.formRow}><Field label="Share / unit class"><input required maxLength={commonTerms ? 160 : 80} data-product-field="share_class" value={terms.share_class} onChange={event => change('share_class', event.target.value)} /></Field><Field label="Settlement unit"><input value={typedPolicy ? 'TST · valueless synthetic token · 6 decimals' : 'ZAR_TEST · historical test denomination · 2 decimals'} readOnly /></Field></div>
          <div className={styles.formRow}><Field label={typedPolicy ? 'Initial price per unit (TST base units)' : 'Historical price per unit (synthetic cents)'} hint={`${money(terms.unit_price_minor, terms.currency)} per whole unit. Enter the integer smallest units, not a decimal.`}><input required inputMode="numeric" pattern="[1-9][0-9]*" data-product-field="unit_price_minor" value={terms.unit_price_minor} onChange={event => change('unit_price_minor', event.target.value)} /></Field><Field label="Offering capacity (whole units)"><input required inputMode="numeric" pattern="[1-9][0-9]*" data-product-field="cap_units" value={terms.cap_units} onChange={event => change('cap_units', event.target.value)} /></Field></div>
          <Field label="Minimum subscription (whole units)"><input required inputMode="numeric" pattern="[1-9][0-9]*" data-product-field="minimum_units" value={terms.minimum_units} onChange={event => change('minimum_units', event.target.value)} /></Field>
          {typedPolicy ? <p className={styles.muted}>The following compatibility fields are fixed references. Change the detailed {typedFund ? 'NAV, dealing, fees and redemption' : 'valuation, rent, reserves and exit'} policies below; no second economic schedule is editable here.</p> : null}
          <Field label={typedPolicy ? 'Pricing source (generated reference)' : 'Pricing and valuation basis'}><textarea required={!typedPolicy} readOnly={typedPolicy} minLength={10} maxLength={commonTerms ? 2400 : 1200} data-product-field="pricing_basis" value={terms.pricing_basis} onChange={typedPolicy ? undefined : event => change('pricing_basis', event.target.value)} /></Field>
          <Field label={typedPolicy ? 'Fee source (generated reference)' : 'Fees and expenses'}><textarea required={!typedPolicy} readOnly={typedPolicy} minLength={10} maxLength={commonTerms ? 2400 : 1200} data-product-field="fees" value={terms.fees} onChange={typedPolicy ? undefined : event => change('fees', event.target.value)} /></Field>
          <Field label={typedPolicy ? 'Exit source (generated reference)' : 'Redemption, liquidity and exit terms'}><textarea required={!typedPolicy} readOnly={typedPolicy} minLength={20} maxLength={commonTerms ? 4800 : 2400} data-product-field="redemption_terms" value={terms.redemption_terms} onChange={typedPolicy ? undefined : event => change('redemption_terms', event.target.value)} /></Field>
          {typedProperty ? <Field label="Rental-income source (generated reference)"><textarea readOnly data-product-field="rental_income_policy" value={terms.rental_income_policy} /></Field> : null}
        </fieldset>
        {typedFund ? <FundPolicyFields section={step} terms={typedFund} disabled={locked} onChange={changeFund} /> : null}
        {typedProperty ? <PropertyPolicyFields section={step} terms={typedProperty} disabled={locked} onChange={changeProperty} /> : null}
        {commonTerms && step.startsWith('common-') ? <ProductCommonEnvelopeFields section={step} terms={commonTerms} savedIssuer={product && (isFundTermsV3(product.terms) || isRealEstateTermsV3(product.terms)) ? product.terms.common_envelope.issuer : undefined} disabled={locked} onChange={(next: CommonEnvelopeTerms) => { setTerms(next); setValidationMessage('') }} /> : null}
        <hr className={styles.divider} />
        <fieldset hidden={step !== 'eligibility'} disabled={locked} className={styles.fieldset}><legend>{typedFund ? '06' : typedProperty ? '07' : '03'} · Eligible investors</legend>
          <Field label="Eligible country codes" hint={commonTerms ? 'Comma-separated uppercase codes without spaces. V3 preserves the supplied values and order.' : 'Comma-separated two-letter codes. Eligibility is checked again by the backend.'}><input data-product-field="eligible_countries" required value={terms.eligible_countries.join(commonTerms ? ',' : ', ')} onChange={event => change('eligible_countries', commonTerms ? event.target.value.split(',') : event.target.value.toUpperCase().split(',').map(value => value.trim()))} placeholder={commonTerms ? 'ZA,GB' : 'ZA, GB'} /></Field>
          <div className={styles.actions}>{(['INDIVIDUAL', 'ENTITY'] as const).map(kind => <label key={kind} className={styles.check}><input data-product-field="eligible_investor_types" type="checkbox" checked={terms.eligible_investor_types.includes(kind)} onChange={event => change('eligible_investor_types', event.target.checked ? [...terms.eligible_investor_types, kind] : terms.eligible_investor_types.filter(value => value !== kind))} />{kind === 'INDIVIDUAL' ? 'Individual investors' : 'Entity investors'}</label>)}</div>
        </fieldset>
        <hr className={styles.divider} />
        <fieldset hidden={!step.startsWith('documents.')} disabled={locked} className={styles.fieldset}><legend>Offering documents</legend><p className={styles.muted}>These are in-form text disclosures, not uploaded, signed or independently verified documents. Submission records their content digests with the immutable package. E-signature evidence is a separate future requirement.</p>{([{ key: 'memorandum', label: 'Offering memorandum' }, { key: 'risks', label: 'Risk disclosures' }, { key: 'subscription_terms', label: 'Subscription agreement' }] as const).filter(document => step === `documents.${document.key}`).map(document => <Field key={document.key} label={document.label}><textarea data-product-field={`documents.${document.key}`} required minLength={50} maxLength={commonTerms ? 24000 : 12000} rows={7} value={terms.documents[document.key]} onChange={event => change('documents', { ...terms.documents, [document.key]: event.target.value })} /></Field>)}</fieldset>
        {legacyReference ? <p className={styles.fieldError} role="alert">This v2 {typedFund ? 'fund' : 'property'} still contains ZAR_TEST wording. Replace or remove old-denomination references throughout the policy, summary and disclosures before saving the TST package.</p> : null}
        {step === 'review' ? <ProductReview value={terms} kind={terms.asset_type} version={'terms_version' in terms ? terms.terms_version : undefined} /> : null}
        <label hidden={step !== 'review'} className={styles.check}><input type="checkbox" required checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>I have reviewed this explicitly fictional product and understand it must receive an independent test review before publication. It is not a real investment offer.</span></label>
        <div hidden={step !== 'review'} className={styles.formFoot}><p>{product ? `Saving uses workflow revision ${product.revision}; stale edits will be rejected. This counter is not the offering package number.` : 'The draft will be scoped to the selected organisation. No reviewer authority is assigned by this form.'}</p><button type="submit" className={styles.button} disabled={locked || !acknowledged || legacyFundDraft || legacyPropertyDraft || Boolean(legacyReference)}>{product ? 'Save revised draft' : 'Create product draft'}</button></div>
        <div className={flow.navigation}><button type="button" className={styles.buttonSecondary} disabled={locked || stepIndex === 0} onClick={() => { setStep(steps[stepIndex - 1].id); setFocusPath('') }}>Back</button>{step !== 'review' ? <button type="submit" disabled={locked} className={styles.button}>Continue</button> : null}</div>
      </form>
    </Panel>
  </div>
}


export function ProductForm(props: { organisations: PortalOrganisation[]; product?: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext; onUnsavedChange?: (hasUnsaved: boolean) => void }) {
  return props.product ? <SavedProductEditor {...props} /> : <NewProductEditor {...props} />
}
