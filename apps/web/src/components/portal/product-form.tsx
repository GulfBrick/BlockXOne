'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PortalOrganisation, PortalProduct, PortalSnapshot, ProductTerms } from '@/lib/portal/contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { CommandFeedback, usePortalCommand } from './portal-client'
import { Field, Notice, Panel, money } from './portal-primitives'
import styles from './portal.module.css'

export function fictionalProductTerms(kind: ProductTerms['asset_type'] = 'FUND'): ProductTerms {
  const realEstate = kind === 'REAL_ESTATE'
  return {
    asset_type: kind, name: realEstate ? 'Example Property Investment (Test)' : 'Example Multi-Asset Fund (Test)', issuer_name: 'Example Issuer (fictional test entity)',
    summary: realEstate ? 'A fictional investment in a demonstration rental property. This product exists only to test the customer investment journey.' : 'A fictional diversified fund for demonstrating onboarding, offering review and investor subscription. No real assets or investment returns are represented.',
    strategy: realEstate ? 'The fictional issuer holds a single synthetic property. The example strategy is long-term rental income and an eventual governed exit. No real property is being offered.' : 'The fictional fund allocates synthetic capital across a diversified investment mandate. All allocations and performance are illustrative descriptions, not live holdings or forecasts.',
    share_class: 'Class A (Test)', currency: 'ZAR_TEST', unit_price_minor: '10000', cap_units: '10000', minimum_units: '10',
    pricing_basis: 'Fixed synthetic subscription price of 100.00 ZAR_TEST per whole unit. No independent valuation is represented.',
    fees: 'Illustrative management fee: 0% during this test. No real fee will be charged. Production fees require a separately approved schedule.',
    redemption_terms: 'Redemption is subject to the fictional product terms, available synthetic liquidity and a separately governed approval process. This offering does not promise immediate liquidity or a production exit.',
    eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'],
    property_address: realEstate ? '1 Example Avenue, Fictional District, Test City (not a real property)' : '',
    property_valuation_minor: realEstate ? '100000000' : '0',
    rental_income_policy: realEstate ? 'Any rental income recorded in this test is synthetic. Net fictional income is allocated according to approved investor entitlements; no real tenant rent or bank payment is represented.' : '',
    documents: {
      memorandum: 'FICTIONAL TEST MEMORANDUM. This example product is not an offer of securities or a representation that a real issuer or asset exists. It demonstrates a multi-asset platform workflow using synthetic currency. The issuer, strategy, unit terms and eligibility rules must be reviewed as one version before publication. No live investment performance is shown.',
      risks: 'FICTIONAL TEST RISK DISCLOSURE. Tokenised investments can involve loss of capital, liquidity constraints, valuation uncertainty, counterparty risk, legal uncertainty, smart-contract risk and operational failure. This test does not evaluate or remove those risks. A test review is not regulated advice, legal clearance or an independent contract audit.',
      subscription_terms: 'FICTIONAL TEST SUBSCRIPTION TERMS. The applicant accepts the exact published offering revision and its document hash. A subscription reserves whole units and creates an obligation in synthetic currency only. Acceptance does not constitute funding, token issuance, legal ownership or a bank payment. Settlement and issuance require separately verified workflow evidence.',
    },
  }
}

export function ProductForm({ organisations, product, onSaved, operatingContext }: { organisations: PortalOrganisation[]; product?: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const router = useRouter()
  const [terms, setTerms] = useState<ProductTerms>(() => product?.terms ?? fictionalProductTerms())
  const [organisationId, setOrganisationId] = useState(product?.organisation_id ?? organisations[0]?.id ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const command = usePortalCommand(onSaved)
  function change<K extends keyof ProductTerms>(name: K, value: ProductTerms[K]) { setTerms(previous => ({ ...previous, [name]: value })) }
  function changeKind(kind: ProductTerms['asset_type']) { const sample = fictionalProductTerms(kind); setTerms(current => ({ ...current, asset_type: kind, property_address: kind === 'REAL_ESTATE' ? current.property_address || sample.property_address : '', property_valuation_minor: kind === 'REAL_ESTATE' && current.property_valuation_minor === '0' ? sample.property_valuation_minor : current.property_valuation_minor, rental_income_policy: kind === 'REAL_ESTATE' ? current.rental_income_policy || sample.rental_income_policy : '' })) }
  const locked = command.busy || command.unknown || !organisations.length
  return <div className={styles.stack}>
    <Notice title="Editable fictional example">The initial content is a clearly labelled test scenario, not a registered legal issuer or approved investment. Review every field before saving. Saving a draft does not publish the offering.</Notice>
    <Panel title={product ? 'Edit product draft' : 'Create a product'} description="Typed asset terms, eligibility and versioned disclosures belong to a single offering record.">
      <CommandFeedback command={command} />
      <form className={styles.form} onSubmit={async event => { event.preventDefault(); if (!acknowledged) return; const saved = await command.submit(product ? 'save_product' : 'create_product', product ? { product_id: product.id, expected_revision: product.revision, terms } : { organisation_id: organisationId, terms }); if (saved && !product) router.push(portalScopeHref('/portal/products', operatingContext)) }}>
        <fieldset disabled={locked} className={styles.fieldset}><legend>01 · Product and issuer</legend>
          <div className={styles.formRow}><Field label="Managing organisation"><select required disabled={Boolean(product)} value={organisationId} onChange={event => setOrganisationId(event.target.value)}>{organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></Field><Field label="Asset template"><select value={terms.asset_type} onChange={event => changeKind(event.target.value as ProductTerms['asset_type'])}><option value="FUND">Investment fund</option><option value="REAL_ESTATE">Real-estate investment</option></select></Field></div>
          <div className={styles.formRow}><Field label="Product name"><input required minLength={3} maxLength={120} value={terms.name} onChange={event => change('name', event.target.value)} /></Field><Field label="Issuing legal entity" hint="Test environment: use an explicitly fictional entity name."><input required minLength={3} maxLength={160} value={terms.issuer_name} onChange={event => change('issuer_name', event.target.value)} /></Field></div>
          <Field label="Investor-facing summary"><textarea required minLength={30} maxLength={600} value={terms.summary} onChange={event => change('summary', event.target.value)} /></Field>
          <Field label="Investment strategy and mandate"><textarea required minLength={30} maxLength={4000} value={terms.strategy} onChange={event => change('strategy', event.target.value)} /></Field>
          {terms.asset_type === 'REAL_ESTATE' ? <><div className={styles.formRow}><Field label="Property address / asset description"><input required minLength={10} maxLength={300} value={terms.property_address} onChange={event => change('property_address', event.target.value)} /></Field><Field label="Fictional property valuation (cents)"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.property_valuation_minor} onChange={event => change('property_valuation_minor', event.target.value)} /></Field></div><Field label="Rental-income policy"><textarea required minLength={20} maxLength={2000} value={terms.rental_income_policy} onChange={event => change('rental_income_policy', event.target.value)} /></Field></> : null}
        </fieldset>
        <hr className={styles.divider} />
        <fieldset disabled={locked} className={styles.fieldset}><legend>02 · Subscription economics</legend>
          <div className={styles.formRow}><Field label="Share / unit class"><input required maxLength={80} value={terms.share_class} onChange={event => change('share_class', event.target.value)} /></Field><Field label="Settlement unit"><input value="ZAR_TEST · synthetic currency only" readOnly /></Field></div>
          <div className={styles.formRow}><Field label="Price per unit (synthetic cents)" hint={money(terms.unit_price_minor)}><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.unit_price_minor} onChange={event => change('unit_price_minor', event.target.value)} /></Field><Field label="Offering capacity (whole units)"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.cap_units} onChange={event => change('cap_units', event.target.value)} /></Field></div>
          <Field label="Minimum subscription (whole units)"><input required inputMode="numeric" pattern="[1-9][0-9]*" value={terms.minimum_units} onChange={event => change('minimum_units', event.target.value)} /></Field>
          <Field label="Pricing and valuation basis"><textarea required minLength={10} maxLength={1200} value={terms.pricing_basis} onChange={event => change('pricing_basis', event.target.value)} /></Field>
          <Field label="Fees and expenses"><textarea required minLength={10} maxLength={1200} value={terms.fees} onChange={event => change('fees', event.target.value)} /></Field>
          <Field label="Redemption, liquidity and exit terms"><textarea required minLength={20} maxLength={2400} value={terms.redemption_terms} onChange={event => change('redemption_terms', event.target.value)} /></Field>
        </fieldset>
        <hr className={styles.divider} />
        <fieldset disabled={locked} className={styles.fieldset}><legend>03 · Eligible investors</legend>
          <Field label="Eligible country codes" hint="Comma-separated two-letter codes. Eligibility is checked again by the backend."><input required value={terms.eligible_countries.join(', ')} onChange={event => change('eligible_countries', event.target.value.toUpperCase().split(',').map(value => value.trim()))} placeholder="ZA, GB" /></Field>
          <div className={styles.actions}>{(['INDIVIDUAL', 'ENTITY'] as const).map(kind => <label key={kind} className={styles.check}><input type="checkbox" checked={terms.eligible_investor_types.includes(kind)} onChange={event => change('eligible_investor_types', event.target.checked ? [...terms.eligible_investor_types, kind] : terms.eligible_investor_types.filter(value => value !== kind))} />{kind === 'INDIVIDUAL' ? 'Individual investors' : 'Entity investors'}</label>)}</div>
        </fieldset>
        <hr className={styles.divider} />
        <fieldset disabled={locked} className={styles.fieldset}><legend>04 · Offering documents</legend><p className={styles.muted}>The full text is held with the product revision and hashed with the terms. The investor accepts that exact published version.</p>{([{ key: 'memorandum', label: 'Offering memorandum' }, { key: 'risks', label: 'Risk disclosures' }, { key: 'subscription_terms', label: 'Subscription agreement' }] as const).map(document => <Field key={document.key} label={document.label}><textarea required minLength={50} maxLength={12000} rows={7} value={terms.documents[document.key]} onChange={event => change('documents', { ...terms.documents, [document.key]: event.target.value })} /></Field>)}</fieldset>
        <label className={styles.check}><input type="checkbox" required checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>I have reviewed this explicitly fictional product and understand it must receive an independent test review before publication. It is not a real investment offer.</span></label>
        <div className={styles.formFoot}><p>{product ? `Saving uses the current revision ${product.revision}; stale edits will be rejected.` : 'The draft will be scoped to the selected organisation. No reviewer authority is assigned by this form.'}</p><button type="submit" className={styles.button} disabled={locked || !acknowledged}>{product ? 'Save revised draft' : 'Create product draft'}</button></div>
      </form>
    </Panel>
  </div>
}
