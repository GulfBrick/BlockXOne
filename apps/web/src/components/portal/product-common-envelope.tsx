'use client'

import type { PortalOfferingPackage } from '@/lib/portal/contracts'
import { COMMON_DEFAULT_EVENTS, COMMON_SIGNING_SLOTS, issuerDeclarationForEdit, readCommonEnvelopeProjection, syncCommonEnvelopeReferences, type CommonEnvelopeTerms, type ProductCommonEnvelope, type ProductDeploymentConfiguration } from '@/lib/portal/product-common-envelope'
import { DetailList, Field, Notice } from './portal-primitives'
import styles from './portal.module.css'

function PolicyInput({ label, value, onChange, max = 2400, fieldPath }: { label: string; value: string; fieldPath?: string; onChange: (value: string) => void; max?: number }) {
  return <Field label={label}><textarea data-product-field={fieldPath} required minLength={20} maxLength={max * 2} value={value} onChange={event => onChange(event.target.value)} /></Field>
}
function IntegerInput({ label, value, min, max, onChange, fieldPath }: { label: string; value: number; fieldPath?: string; min: number; max: number; onChange: (value: number) => void }) {
  return <Field label={label}><input data-product-field={fieldPath} required type="number" min={min} max={max} step={1} value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.valueAsNumber)} /></Field>
}
function Reference({ label, value }: { label: string; value: string }) { return <Field label={label}><input readOnly value={value} /></Field> }

/** Normal form controls, not a JSON editor or an authority-granting configurator. */
export function ProductCommonEnvelopeFields({ terms, savedIssuer, disabled, onChange, section }: { terms: CommonEnvelopeTerms; savedIssuer?: ProductCommonEnvelope['issuer']; disabled: boolean; section?: string; onChange: (terms: CommonEnvelopeTerms) => void }) {
  const e = terms.common_envelope, c = terms.deployment_configuration
  const property = terms.asset_type === 'REAL_ESTATE' ? terms.real_estate : null
  function envelope(next: ProductCommonEnvelope) { onChange(syncCommonEnvelopeReferences({ ...terms, common_envelope: next } as CommonEnvelopeTerms)) }
  function configuration(next: ProductDeploymentConfiguration) { onChange({ ...terms, deployment_configuration: next }) }
  function issuer(next: ProductCommonEnvelope['issuer']) { const declared = issuerDeclarationForEdit(next, savedIssuer); onChange({ ...terms, issuer_name: declared.legal_name, common_envelope: { ...e, issuer: declared } }) }
  const mismatchedSpv = Boolean(property && (terms.issuer_name !== property.spv.legal_name || e.issuer.legal_name !== property.spv.legal_name || e.issuer.registration_reference !== property.spv.registration_reference || e.issuer.jurisdiction !== property.spv.jurisdiction))
  return <>
    <hr className={styles.divider} />
    <Notice title="Declared rights and proposed operating arrangements">These are TEST declarations for package review. They do not admit a legal issuer, verify custody/title, grant roles, approve a beneficiary, appoint signers or deploy a contract. Read and amend every proposal before saving.</Notice>
    <fieldset hidden={section !== undefined && section !== 'common-issuer'} disabled={disabled} className={styles.fieldset}><legend>Common package · Issuer declaration and classes</legend>
      <div className={styles.formRow}><Reference label="Product-local issuer reference" value={e.issuer.issuer_reference} /><Reference label="Issuer declaration revision" value={String(e.issuer.declaration_revision)} /></div>
      <Reference label="Managing organisation reference (product scope)" value={e.manager_organisation_id} />
      {property ? <>
        <Reference label="Declared issuer legal name" value={e.issuer.legal_name} /><Reference label="Declared issuer registration reference" value={e.issuer.registration_reference} /><Reference label="Declared issuer jurisdiction" value={e.issuer.jurisdiction} />
        {mismatchedSpv ? <Notice title="Resolve the issuer/SPV identity mismatch" tone="warning">The retained v2 issuer and property SPV describe different names or identity fields. Saved history is unchanged. Check the SPV fields above, then deliberately use that identity for this new v3 declaration.<div className={styles.sectionGap}><button type="button" className={styles.buttonSecondary} onClick={() => issuer({ ...e.issuer, legal_name: property.spv.legal_name, registration_reference: property.spv.registration_reference, jurisdiction: property.spv.jurisdiction })}>Use the reviewed SPV identity for this declaration</button></div></Notice> : null}
      </> : <>
        <Field label="Declared issuer legal name"><input required minLength={3} maxLength={320} data-product-field="common_envelope.issuer.legal_name" value={e.issuer.legal_name} onChange={event => issuer({ ...e.issuer, legal_name: event.target.value })} /></Field>
        <div className={styles.formRow}><Field label="Declared issuer registration reference"><input required minLength={3} maxLength={200} data-product-field="common_envelope.issuer.registration_reference" value={e.issuer.registration_reference} onChange={event => issuer({ ...e.issuer, registration_reference: event.target.value })} /></Field><Field label="Declared issuer jurisdiction"><input required pattern="[A-Z]{2}" maxLength={2} data-product-field="common_envelope.issuer.jurisdiction" value={e.issuer.jurisdiction} onChange={event => issuer({ ...e.issuer, jurisdiction: event.target.value })} /></Field></div>
      </>}
      <div className={styles.formRow}><Field label="Declared legal form"><input required minLength={3} maxLength={200} data-product-field="common_envelope.issuer.legal_form" value={e.issuer.legal_form} onChange={event => issuer({ ...e.issuer, legal_form: event.target.value })} /></Field><Field label="Declared governing law"><input required minLength={3} maxLength={320} data-product-field="common_envelope.issuer.governing_law" value={e.issuer.governing_law} onChange={event => issuer({ ...e.issuer, governing_law: event.target.value })} /></Field></div>
      <p className={styles.muted}>The primary class follows the authoritative class, rights and whole-unit economic fields above. A secondary class is declaration-only: no subscribed units, issued tokens or accounting positions are created.</p>
      {e.classes.map((item, index) => <div key={item.class_id} className={styles.stack}>
        <Reference label={`${item.primary ? 'Primary' : 'Secondary'} class reference`} value={item.class_id} />
        {item.primary ? <DetailList rows={[{ label: 'Primary class name', value: item.name }, { label: 'Primary class rights', value: item.rights }, { label: 'Whole-unit precision', value: '0 decimals' }, { label: 'Primary package economics', value: `${item.unit_price_minor} TST base units · capacity ${item.cap_units} · minimum ${item.minimum_units}` }]} /> : <>
          <Field label={`Secondary class ${index} name`}><input required minLength={1} maxLength={160} data-product-field={`common_envelope.classes.${index}.name`} value={item.name} onChange={event => envelope({ ...e, classes: e.classes.map(value => value.class_id === item.class_id ? { ...value, name: event.target.value } : value) })} /></Field>
          <PolicyInput label={`Secondary class ${index} declared rights`} fieldPath={`common_envelope.classes.${index}.rights`} value={item.rights} onChange={rights => envelope({ ...e, classes: e.classes.map(value => value.class_id === item.class_id ? { ...value, rights } : value) })} />
          <p className={styles.muted}>Declaration-only · price, capacity and minimum are NULL, not operational values.</p><button type="button" className={styles.buttonSecondary} onClick={() => envelope({ ...e, classes: e.classes.filter(value => value.class_id !== item.class_id) })}>Remove secondary declaration {index}</button>
        </>}
      </div>)}
      <button type="button" className={styles.buttonSecondary} disabled={e.classes.length >= 10} onClick={() => {
        const secondary: ProductCommonEnvelope['classes'][number] = { class_id: crypto.randomUUID(), primary: false, name: '', decimals: 0, rights: '', unit_price_minor: null, cap_units: null, minimum_units: null, operational_scope: 'DECLARATION_ONLY' }
        envelope({ ...e, classes: [e.classes[0], ...[...e.classes.slice(1), secondary].sort((a, b) => a.class_id < b.class_id ? -1 : a.class_id > b.class_id ? 1 : 0)] })
      }}>Add a declaration-only class</button>
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'common-control'} disabled={disabled} className={styles.fieldset}><legend>Common package · Asset control and legal register</legend>
      <Reference label="Declared title model" value={e.custody_title.asset_title_model} />
      <Field label="Declared control model"><select data-product-field="common_envelope.custody_title.asset_control_model" value={e.custody_title.asset_control_model} onChange={event => envelope({ ...e, custody_title: { ...e.custody_title, asset_control_model: event.target.value as ProductCommonEnvelope['custody_title']['asset_control_model'], custodian_legal_name: event.target.value === 'ISSUER_CONTROL_DECLARED' ? null : '' } })}><option value="ISSUER_CONTROL_DECLARED">Issuer control declared (unverified)</option><option value="CUSTODIAN_CONTROL_DECLARED">Custodian control declared (unverified)</option></select></Field>
      {e.custody_title.custodian_legal_name !== null ? <Field label="Declared custodian legal name"><input required minLength={3} maxLength={320} data-product-field="common_envelope.custody_title.custodian_legal_name" value={e.custody_title.custodian_legal_name} onChange={event => envelope({ ...e, custody_title: { ...e.custody_title, custodian_legal_name: event.target.value } })} /></Field> : null}
      {property ? <><Reference label="Declared title evidence reference" value={e.custody_title.title_evidence_reference} /><Reference label="Declared control evidence reference" value={e.custody_title.control_evidence_reference} /></> : <>{(['title_evidence_reference', 'control_evidence_reference'] as const).map(key => <Field key={key} label={key === 'title_evidence_reference' ? 'Declared title evidence reference' : 'Declared control evidence reference'}><input required minLength={10} maxLength={800} data-product-field={`common_envelope.custody_title.${key}`} value={e.custody_title[key]} onChange={event => envelope({ ...e, custody_title: { ...e.custody_title, [key]: event.target.value } })} /></Field>)}</>}
      {([{ key: 'segregation_policy', label: 'Asset segregation proposal' }, { key: 'control_policy', label: 'Asset control proposal' }, { key: 'recovery_policy', label: 'Asset-control recovery proposal' }] as const).map(item => <PolicyInput key={item.key} label={item.label} fieldPath={`common_envelope.custody_title.${item.key}`} value={e.custody_title[item.key]} onChange={value => envelope({ ...e, custody_title: { ...e.custody_title, [item.key]: value } })} />)}
      <Reference label="Declared legal register authority" value={e.register.authority} /><Reference label="Register evidence precedence" value={e.register.evidence_precedence} />
      <PolicyInput label="Register correction proposal" fieldPath="common_envelope.register.correction_policy" value={e.register.correction_policy} onChange={value => envelope({ ...e, register: { ...e.register, correction_policy: value } })} />
      <PolicyInput label="Register dispute proposal" fieldPath="common_envelope.register.dispute_policy" value={e.register.dispute_policy} onChange={value => envelope({ ...e, register: { ...e.register, dispute_policy: value } })} />
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'common-settlement'} disabled={disabled} className={styles.fieldset}><legend>Common package · Eligibility, transfer, taxes and settlement</legend>
      <Reference label="Eligible countries source" value={e.eligibility.countries_ref} /><Reference label="Investor types source" value={e.eligibility.investor_types_ref} />
      <PolicyInput label="Identity and eligibility proposal" fieldPath="common_envelope.eligibility.identity_policy" value={e.eligibility.identity_policy} onChange={value => envelope({ ...e, eligibility: { ...e.eligibility, identity_policy: value } })} />
      {property ? <><Field label="Interest-transfer policy source"><textarea readOnly data-product-field="common_envelope.transfer.eligible_transfer_policy" value={e.transfer.eligible_transfer_policy} /></Field><Field label="Holder-consent policy source"><textarea readOnly data-product-field="common_envelope.transfer.consent_policy" value={e.transfer.consent_policy} /></Field><Reference label="Lender consent source" value={e.transfer.lender_consent_policy_ref ?? ''} /></> : <><PolicyInput label="Fund holder-transfer restriction proposal" fieldPath="common_envelope.transfer.eligible_transfer_policy" value={e.transfer.eligible_transfer_policy} onChange={value => envelope({ ...e, transfer: { ...e.transfer, eligible_transfer_policy: value } })} /><PolicyInput label="Fund holder-transfer consent proposal" fieldPath="common_envelope.transfer.consent_policy" value={e.transfer.consent_policy} onChange={value => envelope({ ...e, transfer: { ...e.transfer, consent_policy: value } })} /></>}
      <div className={styles.formRow}>{property ? <IntegerInput label="Declared property lock-up days" fieldPath="common_envelope.transfer.lockup_days" value={e.transfer.lockup_days} min={0} max={3650} onChange={value => envelope({ ...e, transfer: { ...e.transfer, lockup_days: value } })} /> : <Reference label="Fund lock-up source (days)" value={String(e.transfer.lockup_days)} />}<IntegerInput label="Declared maximum holder concentration (bps)" fieldPath="common_envelope.transfer.maximum_holder_bps" value={e.transfer.maximum_holder_bps} min={1} max={10000} onChange={value => envelope({ ...e, transfer: { ...e.transfer, maximum_holder_bps: value } })} /></div>
      <Reference label="Fee schedule source" value={e.fees.schedule_ref} /><Reference label="Proposed rounding mode" value={e.fees.rounding_mode} />
      <PolicyInput label="Tax and withholding proposal" fieldPath="common_envelope.fees.tax_policy" value={e.fees.tax_policy} onChange={value => envelope({ ...e, fees: { ...e.fees, tax_policy: value } })} />
      <Notice title="Settlement route is not approved">TST · 6 decimals · Polygon Amoy 80002 · test-asset proposal only. Beneficiary instructions require independent approval. This form accepts no wallet or beneficiary address and enables no payment.</Notice>
      <PolicyInput label="Settlement reconciliation proposal" fieldPath="common_envelope.settlement.reconciliation_policy" value={e.settlement.reconciliation_policy} onChange={value => envelope({ ...e, settlement: { ...e.settlement, reconciliation_policy: value } })} />
      <PolicyInput label="Settlement exception proposal" fieldPath="common_envelope.settlement.exception_policy" value={e.settlement.exception_policy} onChange={value => envelope({ ...e, settlement: { ...e.settlement, exception_policy: value } })} />
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'common-servicing'} disabled={disabled} className={styles.fieldset}><legend>Common package · Reporting, defaults and termination</legend>
      <Field label="Proposed reporting frequency"><select data-product-field="common_envelope.servicing.reporting_frequency" value={e.servicing.reporting_frequency} onChange={event => envelope({ ...e, servicing: { ...e.servicing, reporting_frequency: event.target.value as ProductCommonEnvelope['servicing']['reporting_frequency'] } })}>{(['MONTHLY', 'QUARTERLY', 'ANNUALLY'] as const).map(value => <option key={value} value={value}>{value.toLowerCase()}</option>)}</select></Field>
      <PolicyInput label="Reporting proposal" fieldPath="common_envelope.servicing.reporting_policy" value={e.servicing.reporting_policy} onChange={value => envelope({ ...e, servicing: { ...e.servicing, reporting_policy: value } })} />
      <fieldset className={styles.fieldset}><legend>Declared default events (not automatic enforcement)</legend>{COMMON_DEFAULT_EVENTS.map(value => <label className={styles.check} key={value}><input type="checkbox" checked={e.servicing.default_events.includes(value)} onChange={event => envelope({ ...e, servicing: { ...e.servicing, default_events: COMMON_DEFAULT_EVENTS.filter(item => item === value ? event.target.checked : e.servicing.default_events.includes(item)) } })} />{value.toLowerCase().replaceAll('_', ' ')}</label>)}</fieldset>
      <div className={styles.formRow}><IntegerInput label="Default notice days" fieldPath="common_envelope.servicing.default_notice_days" value={e.servicing.default_notice_days} min={0} max={365} onChange={value => envelope({ ...e, servicing: { ...e.servicing, default_notice_days: value } })} /><IntegerInput label="Termination notice days" fieldPath="common_envelope.servicing.termination_notice_days" value={e.servicing.termination_notice_days} min={0} max={365} onChange={value => envelope({ ...e, servicing: { ...e.servicing, termination_notice_days: value } })} /></div>
      <PolicyInput label="Default response proposal" fieldPath="common_envelope.servicing.default_response_policy" value={e.servicing.default_response_policy} onChange={value => envelope({ ...e, servicing: { ...e.servicing, default_response_policy: value } })} />
      <Reference label="Required termination review" value={e.servicing.termination_approval} /><PolicyInput label="Termination proposal" fieldPath="common_envelope.servicing.termination_policy" value={e.servicing.termination_policy} onChange={value => envelope({ ...e, servicing: { ...e.servicing, termination_policy: value } })} />
      <Reference label="Distinct exit policy sources" value={e.exit_policy_refs.join(' · ')} />
    </fieldset>
    <hr className={styles.divider} />
    <fieldset hidden={section !== undefined && section !== 'common-configuration'} disabled={disabled} className={styles.fieldset}><legend>Proposed deployment · Signing and governance</legend>
      <Notice title="Proposed, not deployed">ERC-3643 family · conformance NOT VERIFIED · Amoy 80002. Routine authority is controller-only; MetaMask remains the human signing experience. Policy slots below are not appointed people, platform roles or wallet accounts.</Notice>
      <Reference label="Configuration class references" value={c.class_ids.join(' · ')} /><Reference label="Proposed routine authority" value={c.routine_authority} />
      <DetailList rows={Object.entries(c.policy_refs).map(([label, value]) => ({ label: `${label.replaceAll('_', ' ')} source`, value }))} />
      <Reference label="Required independent high-risk slots" value={c.signing.required_high_risk_slots.join(' · ')} />
      <label className={styles.check}><input type="checkbox" checked={c.signing.policy_slots.includes('RECOVERY_CUSTODIAN')} onChange={event => configuration({ ...c, signing: { ...c.signing, policy_slots: [...COMMON_SIGNING_SLOTS.slice(0, event.target.checked ? 4 : 3)] } })} />Declare an additional recovery-custodian policy slot</label>
      <Reference label="Proposed ordered policy slots" value={c.signing.policy_slots.join(' · ')} />
      <IntegerInput label="Proposed high-risk signing threshold" fieldPath="deployment_configuration.signing.threshold" value={c.signing.threshold} min={2} max={c.signing.policy_slots.length} onChange={value => configuration({ ...c, signing: { ...c.signing, threshold: value } })} />
      <PolicyInput label="Routine controller proposal" fieldPath="deployment_configuration.signing.routine_controller_policy" value={c.signing.routine_controller_policy} onChange={value => configuration({ ...c, signing: { ...c.signing, routine_controller_policy: value } })} />
      <PolicyInput label="Institutional key-recovery proposal" fieldPath="deployment_configuration.signing.key_recovery_policy" value={c.signing.key_recovery_policy} onChange={value => configuration({ ...c, signing: { ...c.signing, key_recovery_policy: value } })} />
      <Field label="Proposed release governance model"><select data-product-field="deployment_configuration.governance.model" value={c.governance.model} onChange={event => configuration({ ...c, governance: { ...c.governance, model: event.target.value as ProductDeploymentConfiguration['governance']['model'] } })}><option value="IMMUTABLE_RELEASE_GOVERNED_MIGRATION_PROPOSAL">Immutable release / governed migration proposal</option><option value="TIMELOCKED_UPGRADE_PROPOSAL">Timelocked upgrade proposal</option></select></Field>
      <IntegerInput label="Proposed governance timelock hours" fieldPath="deployment_configuration.governance.timelock_hours" value={c.governance.timelock_hours} min={24} max={720} onChange={value => configuration({ ...c, governance: { ...c.governance, timelock_hours: value } })} />
      <PolicyInput label="Controller replacement proposal" fieldPath="deployment_configuration.governance.controller_replacement_policy" value={c.governance.controller_replacement_policy} onChange={value => configuration({ ...c, governance: { ...c.governance, controller_replacement_policy: value } })} />
      {([{ key: 'role_grant_revoke', label: 'Contract role grant / revocation proposal' }, { key: 'mint_burn', label: 'Mint / burn governance proposal' }, { key: 'pause_freeze', label: 'Pause / freeze governance proposal' }, { key: 'force_transfer', label: 'Forced-transfer governance proposal' }, { key: 'recovery', label: 'Position-recovery governance proposal' }, { key: 'upgrade', label: 'Upgrade governance proposal' }] as const).map(item => <PolicyInput key={item.key} label={item.label} fieldPath={`deployment_configuration.governance.powers.${item.key}`} value={c.governance.powers[item.key]} onChange={value => configuration({ ...c, governance: { ...c.governance, powers: { ...c.governance.powers, [item.key]: value } } })} />)}
      <Reference label="Separate required admission decisions" value={c.required_decisions.join(' · ')} />
    </fieldset>
  </>
}

function summaryRows(value: unknown, prefix = ''): { label: string; value: string }[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => summaryRows(item, `${prefix} ${index + 1}`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => summaryRows(item, `${prefix ? `${prefix} · ` : ''}${key.replaceAll('_', ' ')}`))
  return [{ label: prefix, value: value === null ? 'NULL · not operational / not appointed' : String(value) }]
}
export function ImmutableCommonEnvelopeSummary({ pkg, expectedV3 = false }: { pkg: PortalOfferingPackage; expectedV3?: boolean }) {
  const projection = readCommonEnvelopeProjection(pkg)
  if (!projection || expectedV3 && projection.kind !== 'V3') return <Notice title="Immutable common package unavailable" tone="warning">This projection is incomplete or invalid. No v3 review decision is available; refresh the saved package. Nothing is inferred from current editable terms.</Notice>
  if (projection.kind === 'LEGACY') return <p className={styles.muted}>Preserved earlier package: no v3 common-envelope or deployment-configuration bindings were recorded. Its existing terms and text digests are unchanged.</p>
  const { value } = projection
  return <div className={styles.stack}>
    <Notice title="Immutable declared common package">SYNTHETIC DECLARED · proposed configuration NOT DEPLOYED · legal/title/custody/provider and technical admission are not proven by these declarations. Secondary classes are declaration-only.</Notice>
    <DetailList rows={[{ label: 'Common-envelope fingerprint', value: value.common_envelope_hash }, { label: 'Proposed deployment-configuration fingerprint', value: value.deployment_configuration_hash }]} />
    <details><summary className={styles.textLink}>Read the full immutable common declaration</summary><DetailList rows={summaryRows(value.common_envelope)} /></details>
    <details><summary className={styles.textLink}>Read the full immutable proposed deployment configuration</summary><DetailList rows={summaryRows(value.deployment_configuration)} /></details>
  </div>
}
