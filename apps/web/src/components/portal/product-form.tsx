'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FUND_V2_CANONICAL_REFERENCES, containsLegacyDenomination, isFundTermsV2, productTermsSchema, type FundTermsV2, type PortalOrganisation, type PortalProduct, type PortalSnapshot, type ProductTerms } from '@/lib/portal/contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { CommandFeedback, usePortalCommand } from './portal-client'
import { Field, Notice, Panel, money } from './portal-primitives'
import styles from './portal.module.css'

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
  if (realEstate) return { ...common, asset_type: 'REAL_ESTATE', currency: 'ZAR_TEST', unit_price_minor: '10000', cap_units: '10000', minimum_units: '10' }
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

function FundPolicyFields({ terms, disabled, onChange }: {
  terms: FundTermsV2; disabled: boolean;
  onChange: <K extends keyof FundTermsV2['fund']>(name: K, value: FundTermsV2['fund'][K]) => void;
}) {
  const fund = terms.fund
  return <>
    <hr className={styles.divider} />
    <fieldset disabled={disabled} className={styles.fieldset}><legend>03 · Fund mandate and class rights</legend>
      <p className={styles.muted}>These are the fund-specific rights to be reviewed with the same offering package. Naming an issuer or manager does not appoint either one.</p>
      <Field label="Mandate, limits and permitted investments"><textarea required minLength={30} maxLength={4000} value={fund.mandate} onChange={event => onChange('mandate', event.target.value)} /></Field>
      <Field label="Unit-class rights and investor claim"><textarea required minLength={20} maxLength={2400} value={fund.class_rights} onChange={event => onChange('class_rights', event.target.value)} /></Field>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset disabled={disabled} className={styles.fieldset}><legend>04 · NAV and dealing rules</legend>
      <Field label="NAV valuation method"><textarea required minLength={20} maxLength={2000} value={fund.nav.valuation_method} onChange={event => onChange('nav', { ...fund.nav, valuation_method: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="NAV frequency"><select value={fund.nav.frequency} onChange={event => onChange('nav', { ...fund.nav, frequency: event.target.value as typeof fund.nav.frequency })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></Field><Field label="Pricing cutoff" hint="Include the time zone and business-day rule."><input required minLength={10} maxLength={300} value={fund.nav.pricing_cutoff} onChange={event => onChange('nav', { ...fund.nav, pricing_cutoff: event.target.value })} /></Field></div>
      <Field label="NAV error and correction policy"><textarea required minLength={20} maxLength={2000} value={fund.nav.correction_policy} onChange={event => onChange('nav', { ...fund.nav, correction_policy: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Subscription dealing"><select value={fund.dealing.subscription_frequency} onChange={event => onChange('dealing', { ...fund.dealing, subscription_frequency: event.target.value as typeof fund.dealing.subscription_frequency })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></Field><Field label="Redemption dealing"><select value={fund.dealing.redemption_frequency} onChange={event => onChange('dealing', { ...fund.dealing, redemption_frequency: event.target.value as typeof fund.dealing.redemption_frequency })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></Field></div>
      <div className={styles.formRow}><Field label="Redemption notice (calendar days)"><input required type="number" min={0} max={365} step={1} value={fund.dealing.notice_days} onChange={event => onChange('dealing', { ...fund.dealing, notice_days: Number(event.target.value) })} /></Field><Field label="Target settlement (days)" hint="A target, not proof of liquidity or payment."><input required type="number" min={0} max={30} step={1} value={fund.dealing.settlement_days} onChange={event => onChange('dealing', { ...fund.dealing, settlement_days: Number(event.target.value) })} /></Field></div>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset disabled={disabled} className={styles.fieldset}><legend>05 · Fees, liquidity, income and exit</legend>
      <div className={styles.formRow}><Field label="Management fee (basis points)" hint="100 bps = 1%. Enter 0 for the no-fee test fixture."><input required type="number" min={0} max={10000} step={1} value={fund.fees.management_bps} onChange={event => onChange('fees', { ...fund.fees, management_bps: Number(event.target.value) })} /></Field><Field label="Performance fee (basis points)"><input required type="number" min={0} max={10000} step={1} value={fund.fees.performance_bps} onChange={event => onChange('fees', { ...fund.fees, performance_bps: Number(event.target.value) })} /></Field></div>
      <Field label="Other fees and expenses"><textarea required minLength={10} maxLength={2000} value={fund.fees.other_fees} onChange={event => onChange('fees', { ...fund.fees, other_fees: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Lock-up (calendar days)"><input required type="number" min={0} max={3650} step={1} value={fund.liquidity.lockup_days} onChange={event => onChange('liquidity', { ...fund.liquidity, lockup_days: Number(event.target.value) })} /></Field><Field label="Redemption gate (basis points)" hint="10,000 bps = 100% of the permitted dealing amount."><input required type="number" min={0} max={10000} step={1} value={fund.liquidity.gate_bps} onChange={event => onChange('liquidity', { ...fund.liquidity, gate_bps: Number(event.target.value) })} /></Field></div>
      <Field label="Suspension and liquidity policy"><textarea required minLength={20} maxLength={2000} value={fund.liquidity.suspension_policy} onChange={event => onChange('liquidity', { ...fund.liquidity, suspension_policy: event.target.value })} /></Field>
      <div className={styles.formRow}><Field label="Income distribution schedule"><select value={fund.distributions.frequency} onChange={event => onChange('distributions', { ...fund.distributions, frequency: event.target.value as typeof fund.distributions.frequency })}><option value="NONE">Accumulation / none</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUALLY">Annually</option></select></Field><Field label="Redemption price basis"><input value="Reviewed NAV" readOnly /></Field></div>
      <Field label="Distribution and reinvestment policy"><textarea required minLength={20} maxLength={2000} value={fund.distributions.policy} onChange={event => onChange('distributions', { ...fund.distributions, policy: event.target.value })} /></Field>
      <Field label="Redemption conditions"><textarea required minLength={20} maxLength={2400} value={fund.redemption.conditions} onChange={event => onChange('redemption', { ...fund.redemption, conditions: event.target.value })} /></Field>
    </fieldset>
  </>
}

export function ProductForm({ organisations, product, onSaved, operatingContext }: { organisations: PortalOrganisation[]; product?: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const router = useRouter()
  const [terms, setTerms] = useState<ProductTerms>(() => product?.terms ?? fictionalProductTerms())
  const [organisationId, setOrganisationId] = useState(product?.organisation_id ?? organisations[0]?.id ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')
  const command = usePortalCommand(onSaved)
  const typedFund = isFundTermsV2(terms) ? terms : null
  const legacyFundDraft = terms.asset_type === 'FUND' && !typedFund
  const legacyReference = typedFund && containsLegacyDenomination(typedFund)
  function change<K extends keyof ProductTerms>(name: K, value: ProductTerms[K]) { setValidationMessage(''); setTerms(previous => ({ ...previous, [name]: value })) }
  function changeFund<K extends keyof FundTermsV2['fund']>(name: K, value: FundTermsV2['fund'][K]) { setValidationMessage(''); setTerms(previous => isFundTermsV2(previous) ? { ...previous, fund: { ...previous.fund, [name]: value } } : previous) }
  function changeKind(kind: ProductTerms['asset_type']) {
    if (kind === terms.asset_type) return
    if (!window.confirm('Changing asset template resets the unsaved form to a different fictional example. Continue?')) return
    setTerms(fictionalProductTerms(kind)); setAcknowledged(false); setValidationMessage('')
  }
  function upgradeLegacyFundDraft() {
    const sample = fictionalProductTerms('FUND') as FundTermsV2
    setTerms(previous => previous.asset_type !== 'FUND' || isFundTermsV2(previous) ? previous : {
      ...sample,
      name: previous.name, issuer_name: previous.issuer_name, summary: previous.summary,
      share_class: previous.share_class,
      eligible_countries: previous.eligible_countries,
      eligible_investor_types: previous.eligible_investor_types,
      documents: previous.documents,
    })
    setAcknowledged(false); setValidationMessage('')
  }
  const locked = command.busy || command.unknown || !organisations.length
  return <div className={styles.stack} id={product?.terms.asset_type === 'FUND' ? 'fund-draft-editor' : undefined}>
    <Notice title="Editable fictional example">The initial content is a clearly labelled test scenario, not a registered legal issuer or approved investment. Review every field before saving. Saving a draft does not publish the offering.</Notice>
    {legacyFundDraft ? <Notice title="Historical fund draft needs an explicit terms upgrade" tone="warning">This draft uses the old ZAR_TEST denomination. Its historical terms are preserved. To prepare a new six-decimal TST package, explicitly upgrade the editable draft; price, capacity, minimum and the old strategy summary reset to the new fund-policy references. Review every retained disclosure before saving.<div className={styles.sectionGap}><button type="button" className={styles.buttonSecondary} onClick={upgradeLegacyFundDraft}>Upgrade this fund draft to v2 TST terms</button></div></Notice> : null}
    <Panel title={product ? 'Edit product draft' : 'Create a product'} description="Prepare fund or real-estate terms. Submission seals an immutable offering package for separate decisions.">
      <CommandFeedback command={command} />
      {validationMessage ? <p className={styles.fieldError} role="alert">{validationMessage}</p> : null}
      <form className={styles.form} onSubmit={async event => {
        event.preventDefault()
        if (!acknowledged || legacyFundDraft || legacyReference) return
        const parsed = productTermsSchema.safeParse(terms)
        if (!parsed.success) { setValidationMessage(`Review the fund package fields: ${parsed.error.issues[0]?.message ?? 'the terms are incomplete'}`); return }
        const saved = await command.submit(product ? 'save_product' : 'create_product', product ? { product_id: product.id, expected_revision: product.revision, terms: parsed.data } : { organisation_id: organisationId, terms: parsed.data })
        if (saved && !product) router.push(portalScopeHref('/portal/products', operatingContext))
      }}>
        <fieldset disabled={locked} className={styles.fieldset}><legend>01 · Product and issuer</legend>
          <div className={styles.formRow}><Field label="Managing organisation"><select required disabled={Boolean(product)} value={organisationId} onChange={event => setOrganisationId(event.target.value)}>{organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></Field><Field label="Asset template" hint={product ? 'A saved product keeps its asset template; create a separate product for another asset.' : 'Switching templates resets this unsaved form.'}><select disabled={Boolean(product)} value={terms.asset_type} onChange={event => changeKind(event.target.value as ProductTerms['asset_type'])}><option value="FUND">Investment fund</option><option value="REAL_ESTATE">Real-estate investment</option></select></Field></div>
          <div className={styles.formRow}><Field label="Product name"><input required minLength={3} maxLength={120} value={terms.name} onChange={event => change('name', event.target.value)} /></Field><Field label="Issuing legal entity" hint="Test environment: use an explicitly fictional entity name."><input required minLength={3} maxLength={160} value={terms.issuer_name} onChange={event => change('issuer_name', event.target.value)} /></Field></div>
          <Field label="Investor-facing summary"><textarea required minLength={30} maxLength={600} value={terms.summary} onChange={event => change('summary', event.target.value)} /></Field>
          <Field label={typedFund ? 'Mandate source (generated reference)' : 'Investment strategy and mandate'} hint={typedFund ? 'Edit the authoritative fund mandate in section 03 below.' : undefined}><textarea required={!typedFund} readOnly={Boolean(typedFund)} minLength={30} maxLength={4000} value={terms.strategy} onChange={typedFund ? undefined : event => change('strategy', event.target.value)} /></Field>
          {terms.asset_type === 'REAL_ESTATE' ? <><div className={styles.formRow}><Field label="Property address / asset description"><input required minLength={10} maxLength={300} value={terms.property_address} onChange={event => change('property_address', event.target.value)} /></Field><Field label="Fictional property valuation (cents)"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.property_valuation_minor} onChange={event => change('property_valuation_minor', event.target.value)} /></Field></div><Field label="Rental-income policy"><textarea required minLength={20} maxLength={2000} value={terms.rental_income_policy} onChange={event => change('rental_income_policy', event.target.value)} /></Field></> : null}
        </fieldset>
        <hr className={styles.divider} />
        <fieldset disabled={locked} className={styles.fieldset}><legend>02 · Class and initial subscription terms</legend>
          <div className={styles.formRow}><Field label="Share / unit class"><input required maxLength={80} value={terms.share_class} onChange={event => change('share_class', event.target.value)} /></Field><Field label="Settlement unit"><input value={typedFund ? 'TST · valueless synthetic token · 6 decimals' : 'ZAR_TEST · synthetic test denomination · 2 decimals'} readOnly /></Field></div>
          <div className={styles.formRow}><Field label={typedFund ? 'Initial price per unit (TST base units)' : 'Price per unit (synthetic cents)'} hint={`${money(terms.unit_price_minor, terms.currency)} per whole unit. Enter the integer smallest units, not a decimal.`}><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.unit_price_minor} onChange={event => change('unit_price_minor', event.target.value)} /></Field><Field label="Offering capacity (whole units)"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.cap_units} onChange={event => change('cap_units', event.target.value)} /></Field></div>
          <Field label="Minimum subscription (whole units)"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.minimum_units} onChange={event => change('minimum_units', event.target.value)} /></Field>
          {typedFund ? <p className={styles.muted}>The following compatibility fields are fixed references. Change the detailed NAV, dealing, fees and exit policies below; no second economic schedule is editable here.</p> : null}
          <Field label={typedFund ? 'Pricing source (generated reference)' : 'Pricing and valuation basis'}><textarea required={!typedFund} readOnly={Boolean(typedFund)} minLength={10} maxLength={1200} value={terms.pricing_basis} onChange={typedFund ? undefined : event => change('pricing_basis', event.target.value)} /></Field>
          <Field label={typedFund ? 'Fee source (generated reference)' : 'Fees and expenses'}><textarea required={!typedFund} readOnly={Boolean(typedFund)} minLength={10} maxLength={1200} value={terms.fees} onChange={typedFund ? undefined : event => change('fees', event.target.value)} /></Field>
          <Field label={typedFund ? 'Exit source (generated reference)' : 'Redemption, liquidity and exit terms'}><textarea required={!typedFund} readOnly={Boolean(typedFund)} minLength={20} maxLength={2400} value={terms.redemption_terms} onChange={typedFund ? undefined : event => change('redemption_terms', event.target.value)} /></Field>
        </fieldset>
        {typedFund ? <FundPolicyFields terms={typedFund} disabled={locked} onChange={changeFund} /> : null}
        <hr className={styles.divider} />
        <fieldset disabled={locked} className={styles.fieldset}><legend>{typedFund ? '06' : '03'} · Eligible investors</legend>
          <Field label="Eligible country codes" hint="Comma-separated two-letter codes. Eligibility is checked again by the backend."><input required value={terms.eligible_countries.join(', ')} onChange={event => change('eligible_countries', event.target.value.toUpperCase().split(',').map(value => value.trim()))} placeholder="ZA, GB" /></Field>
          <div className={styles.actions}>{(['INDIVIDUAL', 'ENTITY'] as const).map(kind => <label key={kind} className={styles.check}><input type="checkbox" checked={terms.eligible_investor_types.includes(kind)} onChange={event => change('eligible_investor_types', event.target.checked ? [...terms.eligible_investor_types, kind] : terms.eligible_investor_types.filter(value => value !== kind))} />{kind === 'INDIVIDUAL' ? 'Individual investors' : 'Entity investors'}</label>)}</div>
        </fieldset>
        <hr className={styles.divider} />
        <fieldset disabled={locked} className={styles.fieldset}><legend>{typedFund ? '07' : '04'} · Offering documents</legend><p className={styles.muted}>These are in-form text disclosures, not uploaded, signed or independently verified documents. Submission records their content digests with the immutable package. E-signature evidence is a separate future requirement.</p>{([{ key: 'memorandum', label: 'Offering memorandum' }, { key: 'risks', label: 'Risk disclosures' }, { key: 'subscription_terms', label: 'Subscription agreement' }] as const).map(document => <Field key={document.key} label={document.label}><textarea required minLength={50} maxLength={12000} rows={7} value={terms.documents[document.key]} onChange={event => change('documents', { ...terms.documents, [document.key]: event.target.value })} /></Field>)}</fieldset>
        {legacyReference ? <p className={styles.fieldError} role="alert">This v2 fund still contains ZAR_TEST wording. Replace or remove old-denomination references throughout the fund policy, summary and disclosures before saving the TST package.</p> : null}
        <label className={styles.check}><input type="checkbox" required checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>I have reviewed this explicitly fictional product and understand it must receive an independent test review before publication. It is not a real investment offer.</span></label>
        <div className={styles.formFoot}><p>{product ? `Saving uses workflow revision ${product.revision}; stale edits will be rejected. This counter is not the offering package number.` : 'The draft will be scoped to the selected organisation. No reviewer authority is assigned by this form.'}</p><button type="submit" className={styles.button} disabled={locked || !acknowledged || legacyFundDraft || Boolean(legacyReference)}>{product ? 'Save revised draft' : 'Create product draft'}</button></div>
      </form>
    </Panel>
  </div>
}
