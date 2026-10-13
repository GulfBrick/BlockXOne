import type { ProductTerms } from './contracts'
import type { ZodIssue } from 'zod'
import { COMMON_DEFAULT_EVENTS, COMMON_SIGNING_SLOTS } from './product-common-envelope'

export function productEditorIssues(issues: ZodIssue[], kind: ProductTerms['asset_type'], version?: number): ZodIssue[] {
  return issues.flatMap(issue => issue.code === 'invalid_union'
    ? productEditorIssues(issue.unionErrors[version === 3 ? kind === 'FUND' ? 3 : 4 : version === 2 ? kind === 'FUND' ? 1 : 2 : 0]?.issues ?? [], kind, version)
    : [issue])
}
export function productIssuePath(path: (string | number)[]): string {
  if (path.join('.') === 'deployment_configuration.signing') return 'deployment_configuration.signing.policy_slots'
  if (path.join('.') === 'deployment_configuration.governance.powers') return 'deployment_configuration.governance.powers.role_grant_revoke'
  if (path.slice(0, 3).join('.') === 'common_envelope.servicing.default_events' || path.slice(0, 3).join('.') === 'deployment_configuration.signing.policy_slots') return path.slice(0, 3).join('.')
  return path[0] === 'eligible_countries' || path[0] === 'eligible_investor_types' ? String(path[0]) : path.join('.')
}

export type ProductDraftValue = string | number | boolean | null | ProductDraftValue[] | { [key: string]: ProductDraftValue }
export type ProductDraft = { [key: string]: ProductDraftValue }
export type ProductStep = { id: string; title: string }
export const productChoices: Record<string, readonly string[]> = {
  'fund.nav.frequency': ['DAILY', 'WEEKLY', 'MONTHLY'],
  'fund.dealing.subscription_frequency': ['DAILY', 'WEEKLY', 'MONTHLY'],
  'fund.dealing.redemption_frequency': ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'],
  'fund.distributions.frequency': ['NONE', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'],
  'real_estate.property.valuation_frequency': ['QUARTERLY', 'ANNUALLY'],
  'common_envelope.custody_title.asset_control_model': ['ISSUER_CONTROL_DECLARED', 'CUSTODIAN_CONTROL_DECLARED'],
  'common_envelope.servicing.reporting_frequency': ['MONTHLY', 'QUARTERLY', 'ANNUALLY'],
  'common_envelope.servicing.default_events': COMMON_DEFAULT_EVENTS,
  'deployment_configuration.signing.policy_slots': COMMON_SIGNING_SLOTS,
  'deployment_configuration.governance.model': ['IMMUTABLE_RELEASE_GOVERNED_MIGRATION_PROPOSAL', 'TIMELOCKED_UPGRADE_PROPOSAL'],
}
const fixed = new Set(['asset_type', 'currency', 'terms_version', 'settlement_decimals', 'strategy', 'pricing_basis', 'fees', 'redemption_terms', 'rental_income_policy', 'fund.redemption.price_basis'])
const commonFixed = new Set([
  'common_envelope.envelope_version', 'common_envelope.posture', 'common_envelope.issuer.issuer_reference', 'common_envelope.issuer.declaration_revision', 'common_envelope.manager_organisation_id',
  'common_envelope.custody_title.asset_title_model', 'common_envelope.register.authority', 'common_envelope.register.evidence_precedence', 'common_envelope.eligibility.countries_ref', 'common_envelope.eligibility.investor_types_ref',
  'common_envelope.transfer.lender_consent_policy_ref', 'common_envelope.fees.schedule_ref', 'common_envelope.fees.rounding_mode',
  'common_envelope.settlement.status', 'common_envelope.settlement.currency', 'common_envelope.settlement.decimals', 'common_envelope.settlement.chain_id', 'common_envelope.settlement.funding_rail', 'common_envelope.settlement.beneficiary_policy',
  'common_envelope.servicing.termination_approval', 'common_envelope.exit_policy_refs',
  'deployment_configuration.configuration_version', 'deployment_configuration.state', 'deployment_configuration.standard_family', 'deployment_configuration.conformance', 'deployment_configuration.chain_id', 'deployment_configuration.network',
  'deployment_configuration.class_ids', 'deployment_configuration.primary_class_id', 'deployment_configuration.policy_refs', 'deployment_configuration.routine_authority',
  'deployment_configuration.signing.state', 'deployment_configuration.signing.threshold_scope', 'deployment_configuration.signing.required_high_risk_slots', 'deployment_configuration.required_decisions',
])
function cloneDraftValue(value: unknown): ProductDraftValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(cloneDraftValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneDraftValue(child)]))
  throw new Error('Unsupported product editor value.')
}
/** A browser editor model, never a ProductTerms assertion or a command payload. */
export function emptyProductDraft(template: ProductTerms): ProductDraft {
  function empty(value: unknown, path: string): ProductDraftValue {
    if (fixed.has(path) || commonFixed.has(path) || /^common_envelope\.classes\.\d+\.(class_id|primary|decimals|operational_scope)$/.test(path)
      || template.asset_type === 'FUND' && ['property_address', 'property_valuation_minor'].includes(path)) return cloneDraftValue(value)
    if (path === 'common_envelope.custody_title.custodian_legal_name') return null
    if (path === 'common_envelope.classes' && Array.isArray(value)) return value.map((item, index) => empty(item, `${path}.${index}`))
    if (Array.isArray(value)) return []
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, empty(item, path ? `${path}.${key}` : key)]))
    return ''
  }
  return synchronizeProductDraft(Object.fromEntries(Object.entries(template).map(([key, value]) => [key, empty(value, key)])))
}
function writeDraftValue(draft: ProductDraft, path: string, value: ProductDraftValue): ProductDraft {
  const [key, ...tail] = path.split('.')
  if (!tail.length) return { ...draft, [key]: value }
  const child = draft[key]
  if (Array.isArray(child)) {
    const [indexText, ...rest] = tail
    const index = Number(indexText), item = child[index]
    if (!Number.isInteger(index) || !item || typeof item !== 'object' || Array.isArray(item)) return draft
    return { ...draft, [key]: child.map((entry, position) => position === index ? writeDraftValue(item, rest.join('.'), value) : entry) }
  }
  if (!child || typeof child !== 'object') return draft
  return { ...draft, [key]: writeDraftValue(child, tail.join('.'), value) }
}
function readDraftValue(draft: ProductDraft, path: string): ProductDraftValue {
  let value: ProductDraftValue = draft
  for (const key of path.split('.')) { if (!value || typeof value !== 'object' || Array.isArray(value)) return ''; value = value[key] ?? '' }
  return value
}
/** Mirrors only authoritative references; never trims, reorders or invents human terms. */
function synchronizeProductDraft(draft: ProductDraft): ProductDraft {
  if (draft.terms_version !== 3) return draft
  const property = draft.asset_type === 'REAL_ESTATE'
  let next = draft
  const mirror = (target: string, source: string) => { next = writeDraftValue(next, target, readDraftValue(next, source)) }
  if (property) {
    for (const key of ['legal_name', 'registration_reference', 'jurisdiction']) mirror(`common_envelope.issuer.${key}`, `real_estate.spv.${key}`)
    for (const key of ['title_evidence_reference', 'control_evidence_reference']) mirror(`common_envelope.custody_title.${key}`, `real_estate.property.${key}`)
    mirror('common_envelope.transfer.eligible_transfer_policy', 'real_estate.exits.eligible_transfer_policy')
    mirror('common_envelope.transfer.consent_policy', 'real_estate.governance.consent_rights')
  } else mirror('common_envelope.transfer.lockup_days', 'fund.liquidity.lockup_days')
  mirror('issuer_name', 'common_envelope.issuer.legal_name')
  const envelope = next.common_envelope
  if (envelope && typeof envelope === 'object' && !Array.isArray(envelope) && Array.isArray(envelope.classes)) {
    const primary = envelope.classes[0]
    if (primary && typeof primary === 'object' && !Array.isArray(primary)) next = { ...next, common_envelope: { ...envelope, classes: [{ ...primary, name: next.share_class, rights: readDraftValue(next, property ? 'real_estate.spv.interest_rights' : 'fund.class_rights'), unit_price_minor: next.unit_price_minor, cap_units: next.cap_units, minimum_units: next.minimum_units }, ...envelope.classes.slice(1)] } }
  }
  const updatedEnvelope = next.common_envelope
  if (updatedEnvelope && typeof updatedEnvelope === 'object' && !Array.isArray(updatedEnvelope) && Array.isArray(updatedEnvelope.classes)) {
    next = writeDraftValue(next, 'deployment_configuration.class_ids', updatedEnvelope.classes.map(item => item && typeof item === 'object' && !Array.isArray(item) ? item.class_id : ''))
  }
  return next
}
export function addProductDraftClass(draft: ProductDraft, id: string): ProductDraft {
  const envelope = draft.common_envelope
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Array.isArray(envelope.classes) || envelope.classes.length >= 10) return draft
  const secondary = [...envelope.classes.slice(1), { class_id: id, primary: false, name: '', decimals: 0, rights: '', unit_price_minor: null, cap_units: null, minimum_units: null, operational_scope: 'DECLARATION_ONLY' }]
  secondary.sort((a, b) => String(a && typeof a === 'object' && !Array.isArray(a) ? a.class_id : '').localeCompare(String(b && typeof b === 'object' && !Array.isArray(b) ? b.class_id : '')))
  return synchronizeProductDraft({ ...draft, common_envelope: { ...envelope, classes: [envelope.classes[0], ...secondary] } })
}
export function removeProductDraftClass(draft: ProductDraft, index: number): ProductDraft {
  const envelope = draft.common_envelope
  if (index < 1 || !envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Array.isArray(envelope.classes)) return draft
  return synchronizeProductDraft({ ...draft, common_envelope: { ...envelope, classes: envelope.classes.filter((_, position) => position !== index) } })
}
export function productEditableIssuePath(path: (string | number)[], kind: ProductTerms['asset_type']): string {
  const key = productIssuePath(path)
  if (key.startsWith('common_envelope.classes.0.')) {
    const field = path[3]
    return field === 'name' ? 'share_class' : field === 'rights' ? kind === 'FUND' ? 'fund.class_rights' : 'real_estate.spv.interest_rights' : String(field)
  }
  if (key === 'issuer_name') return kind === 'FUND' ? 'common_envelope.issuer.legal_name' : 'real_estate.spv.legal_name'
  if (kind === 'REAL_ESTATE') {
    if (key === 'real_estate.exits') return 'real_estate.exits.disposal_liquidation_policy'
    if (/^common_envelope\.issuer\.(legal_name|registration_reference|jurisdiction)$/.test(key)) return key.replace('common_envelope.issuer.', 'real_estate.spv.')
    if (/^common_envelope\.custody_title\.(title_evidence_reference|control_evidence_reference)$/.test(key)) return key.replace('common_envelope.custody_title.', 'real_estate.property.')
    if (key === 'common_envelope.transfer.eligible_transfer_policy') return 'real_estate.exits.eligible_transfer_policy'
    if (key === 'common_envelope.transfer.consent_policy') return 'real_estate.governance.consent_rights'
  }
  return key
}
export function setProductDraftValue(draft: ProductDraft, path: string, value: ProductDraftValue): ProductDraft {
  let next = writeDraftValue(draft, path, value)
  if (path === 'common_envelope.custody_title.asset_control_model') next = writeDraftValue(next, 'common_envelope.custody_title.custodian_legal_name', value === 'CUSTODIAN_CONTROL_DECLARED' ? '' : null)
  return synchronizeProductDraft(next)
}
export function productFieldStep(path: string): string {
  if (path.startsWith('documents.')) return path
  if (path.startsWith('deployment_configuration.')) return 'common-configuration'
  if (path.startsWith('common_envelope.')) {
    if (/^common_envelope\.(issuer|classes|manager_organisation_id)/.test(path)) return 'common-issuer'
    if (/^common_envelope\.(custody_title|register)/.test(path)) return 'common-control'
    if (/^common_envelope\.(eligibility|transfer|fees|settlement)/.test(path)) return 'common-settlement'
    return 'common-servicing'
  }
  if (path.startsWith('eligible_')) return 'eligibility'
  if (/^(share_class|unit_price_minor|cap_units|minimum_units|pricing_basis|fees|redemption_terms)$/.test(path)) return 'economics'
  if (/^fund\.(mandate|class_rights)/.test(path) || path.startsWith('real_estate.spv.')) return 'rights'
  if (/^fund\.(nav|dealing)/.test(path) || /^real_estate\.(property|financing)/.test(path)) return 'valuation'
  if (/^real_estate\.(governance|exits)/.test(path)) return 'exits'
  if (path.startsWith('fund.') || path.startsWith('real_estate.cashflow.')) return 'income'
  return 'identity'
}
export function productSteps(kind: ProductTerms['asset_type'], typed: boolean, common: boolean): ProductStep[] {
  return [
    { id: 'identity', title: 'Product and issuer' }, { id: 'economics', title: 'Class and pricing' },
    ...(typed ? [{ id: 'rights', title: kind === 'FUND' ? 'Mandate and rights' : 'SPV and interest rights' }, { id: 'valuation', title: kind === 'FUND' ? 'NAV and dealing' : 'Valuation and financing' }, { id: 'income', title: kind === 'FUND' ? 'Fees, income and exit' : 'Rent and distributions' }, ...(kind === 'REAL_ESTATE' ? [{ id: 'exits', title: 'Consents and exits' }] : [])] : []),
    ...(common ? [{ id: 'common-issuer', title: 'Issuer declaration and classes' }, { id: 'common-control', title: 'Asset control and register' }, { id: 'common-settlement', title: 'Transfer and settlement' }, { id: 'common-servicing', title: 'Reporting and termination' }, { id: 'common-configuration', title: 'Signing and governance proposal' }] : []),
    { id: 'eligibility', title: 'Eligible investors' },
    { id: 'documents.memorandum', title: 'Offering memorandum' }, { id: 'documents.risks', title: 'Risk disclosures' }, { id: 'documents.subscription_terms', title: 'Subscription terms' },
    { id: 'review', title: 'Review and save' },
  ]
}
export function productDraftFields(value: unknown, prefix = ''): { path: string; value: unknown }[] {
  if (prefix === 'common_envelope.classes' && Array.isArray(value)) return value.flatMap((item, index) => productDraftFields(item, `${prefix}.${index}`))
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).flatMap(([key, child]) => productDraftFields(child, prefix ? `${prefix}.${key}` : key))
  return [{ path: prefix, value }]
}
export function editableProductField(path: string, kind: ProductTerms['asset_type']): boolean {
  return !fixed.has(path) && !commonFixed.has(path) && path !== 'issuer_name' && (!path.startsWith('common_envelope.classes') || /^common_envelope\.classes\.[1-9]\.(name|rights)$/.test(path)) && !path.startsWith('deployment_configuration.policy_refs.')
    && !(kind === 'FUND' && ['property_address', 'property_valuation_minor', 'common_envelope.transfer.lockup_days'].includes(path))
    && !(kind === 'REAL_ESTATE' && ['common_envelope.issuer.legal_name', 'common_envelope.issuer.registration_reference', 'common_envelope.issuer.jurisdiction', 'common_envelope.custody_title.title_evidence_reference', 'common_envelope.custody_title.control_evidence_reference', 'common_envelope.transfer.eligible_transfer_policy', 'common_envelope.transfer.consent_policy'].includes(path))
}
export const productNumberFields = new Set(['fund.dealing.notice_days', 'fund.dealing.settlement_days', 'fund.fees.management_bps', 'fund.fees.performance_bps', 'fund.liquidity.lockup_days', 'fund.liquidity.gate_bps', 'common_envelope.transfer.lockup_days', 'common_envelope.transfer.maximum_holder_bps', 'common_envelope.servicing.default_notice_days', 'common_envelope.servicing.termination_notice_days', 'deployment_configuration.signing.threshold', 'deployment_configuration.governance.timelock_hours'])
export function productSingleLineField(path: string): boolean {
  return ['name', 'issuer_name', 'share_class', 'property_address', 'unit_price_minor', 'cap_units', 'minimum_units', 'property_valuation_minor'].includes(path)
    || /\.(legal_name|registration_reference|jurisdiction|legal_form|governing_law|custodian_legal_name|title_evidence_reference|control_evidence_reference|pricing_cutoff)$/.test(path)
    || /^common_envelope\.classes\.\d+\.name$/.test(path)
}
export function customerReviewField(path: string, kind: ProductTerms['asset_type'], version?: number): boolean {
  if (version === 3) return editableProductField(path, kind)
  if (['asset_type', 'currency', 'terms_version', 'settlement_decimals'].includes(path)) return false
  if (kind === 'FUND' && ['property_address', 'property_valuation_minor', 'rental_income_policy'].includes(path)) return false
  return version !== 2 || !['strategy', 'pricing_basis', 'fees', 'redemption_terms', 'rental_income_policy'].includes(path)
}
export function productFieldLabel(path: string): string {
  const labels: Record<string, string> = { name: 'Product name', issuer_name: 'Issuing legal entity', summary: 'Investor-facing summary', share_class: 'Share / unit class', unit_price_minor: 'Initial price per unit (TST base units)', cap_units: 'Offering capacity (whole units)', minimum_units: 'Minimum subscription (whole units)', property_valuation_minor: 'Property valuation (TST base units)', eligible_countries: 'Eligible country codes (comma-separated)', eligible_investor_types: 'Eligible investor types', 'fund.fees.management_bps': 'Management fee (basis points)', 'fund.fees.performance_bps': 'Performance fee (basis points)', 'fund.liquidity.gate_bps': 'Redemption gate (basis points)' }
  const commonLabels: Record<string, string> = {
    'issuer.legal_name': 'Issuer legal name', 'issuer.registration_reference': 'Issuer registration reference', 'issuer.jurisdiction': 'Issuer country code', 'issuer.legal_form': 'Issuer legal form', 'issuer.governing_law': 'Governing law',
    'custody_title.asset_control_model': 'Who controls the assets?', 'custody_title.custodian_legal_name': 'Custodian legal name', 'custody_title.title_evidence_reference': 'Title evidence reference', 'custody_title.control_evidence_reference': 'Asset-control evidence reference', 'custody_title.segregation_policy': 'Asset segregation policy', 'custody_title.control_policy': 'Asset control policy', 'custody_title.recovery_policy': 'Asset-control recovery policy',
    'register.correction_policy': 'Register correction policy', 'register.dispute_policy': 'Register dispute policy', 'eligibility.identity_policy': 'Investor identity requirements',
    'transfer.eligible_transfer_policy': 'Eligible transfer policy', 'transfer.lockup_days': 'Transfer lock-up (calendar days)', 'transfer.maximum_holder_bps': 'Maximum holding per investor (basis points)', 'transfer.consent_policy': 'Transfer consent requirements', 'fees.tax_policy': 'Tax and withholding policy',
    'settlement.reconciliation_policy': 'Settlement reconciliation policy', 'settlement.exception_policy': 'Settlement exception handling',
    'servicing.reporting_frequency': 'Reporting frequency', 'servicing.reporting_policy': 'Investor reporting policy', 'servicing.default_events': 'Events of default', 'servicing.default_notice_days': 'Default notice (calendar days)', 'servicing.default_response_policy': 'Response to a default', 'servicing.termination_notice_days': 'Termination notice (calendar days)', 'servicing.termination_policy': 'Product termination policy',
    'signing.policy_slots': 'Proposed independent signing roles', 'signing.threshold': 'Required signing approvals', 'signing.routine_controller_policy': 'Routine controller authority policy', 'signing.key_recovery_policy': 'Signing-key recovery policy',
    'governance.model': 'Governance model', 'governance.timelock_hours': 'Governance delay (hours)', 'governance.controller_replacement_policy': 'Controller replacement policy',
    'governance.powers.role_grant_revoke': 'Granting and revoking roles', 'governance.powers.mint_burn': 'Issuing and cancelling tokens', 'governance.powers.pause_freeze': 'Pausing and freezing operations', 'governance.powers.force_transfer': 'Forced-transfer authority', 'governance.powers.recovery': 'Recovery authority', 'governance.powers.upgrade': 'Upgrade authority',
  }
  const short = path.replace(/^common_envelope\.|^deployment_configuration\./, '')
  const secondary = /^common_envelope\.classes\.(\d+)\.(name|rights)$/.exec(path)
  if (secondary) return `Additional class ${secondary[1]} ${secondary[2] === 'name' ? 'name' : 'declared rights'}`
  const label = labels[path] ?? commonLabels[short] ?? path.replace(/^fund\.|^real_estate\.|^documents\./, '').replaceAll('.', ' ').replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}
