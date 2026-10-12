import { z } from 'zod'
import type { FundTermsV2, FundTermsV3, RealEstateTermsV2, RealEstateTermsV3, PortalOfferingPackage, PortalProduct } from './contracts'

/** V3 is a proposed package, never provider, custody, signing or deployment admission. */
export const strictProductText = (min: number, max: number) => z.string().superRefine((value, ctx) => {
  const length = Array.from(value).length
  if (length < min || length > max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Use ${min} to ${max} Unicode characters.` })
  if (/^[\t\n\v\f\r ]|[\t\n\v\f\r ]$/.test(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Remove leading or trailing ASCII whitespace; values are not silently trimmed.' })
})
export const commonEnvelopeUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000', 'Use a non-zero canonical UUID.')
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const positive = z.string().regex(/^[1-9][0-9]{0,19}$/)
const integer = (min: number, max: number) => z.number().int().min(min).max(max)
const policy = strictProductText(20, 2400)
export const COMMON_DEFAULT_EVENTS = ['REPORTING_FAILURE', 'PAYMENT_FAILURE', 'MATERIAL_TERMS_BREACH', 'INSOLVENCY_EVENT', 'CUSTODY_OR_TITLE_DISPUTE'] as const
export const COMMON_SIGNING_SLOTS = ['CONTROLLER_OPERATOR', 'INDEPENDENT_GOVERNANCE', 'INDEPENDENT_COMPLIANCE', 'RECOVERY_CUSTODIAN'] as const
export const COMMON_REQUIRED_DECISIONS = ['ISSUER_PACKAGE_REVIEW', 'APPOINTED_COMPLIANCE_PACKAGE_REVIEW', 'SEPARATE_TECHNICAL_READINESS', 'SEPARATE_LEGAL_AND_SERVICE_ADMISSION'] as const
export const COMMON_CONFIGURATION_REFS = {
  eligibility: 'common_envelope.eligibility', transfer: 'common_envelope.transfer', identity: 'common_envelope.eligibility.identity_policy', fees: 'common_envelope.fees',
  custody_title: 'common_envelope.custody_title', register: 'common_envelope.register', servicing: 'common_envelope.servicing', exits: 'common_envelope.exit_policy_refs',
} as const
const classSchema = z.object({ class_id: commonEnvelopeUuidSchema, primary: z.boolean(), name: strictProductText(1, 80), decimals: z.literal(0), rights: strictProductText(20, 2400),
  unit_price_minor: positive.nullable(), cap_units: positive.nullable(), minimum_units: positive.nullable(), operational_scope: z.enum(['PRIMARY_PACKAGE_ONLY', 'DECLARATION_ONLY']) }).strict()
export const productCommonEnvelopeSchema = z.object({
  envelope_version: z.literal(1), posture: z.literal('SYNTHETIC_DECLARED'),
  issuer: z.object({ issuer_reference: commonEnvelopeUuidSchema, declaration_revision: integer(1, 999999999), legal_name: strictProductText(3, 160), registration_reference: strictProductText(3, 100), jurisdiction: z.string().regex(/^[A-Z]{2}$/), legal_form: strictProductText(3, 100), governing_law: strictProductText(3, 160) }).strict(),
  manager_organisation_id: commonEnvelopeUuidSchema,
  classes: z.array(classSchema).min(1).max(10),
  custody_title: z.object({ asset_title_model: z.enum(['FUND_PORTFOLIO_INTEREST_DECLARATION', 'PROPERTY_SPV_INTEREST_DECLARATION']), asset_control_model: z.enum(['ISSUER_CONTROL_DECLARED', 'CUSTODIAN_CONTROL_DECLARED']), custodian_legal_name: strictProductText(3, 160).nullable(), title_evidence_reference: strictProductText(10, 400), control_evidence_reference: strictProductText(10, 400), segregation_policy: policy, control_policy: policy, recovery_policy: policy }).strict(),
  register: z.object({ authority: z.enum(['DECLARED_ISSUER_REGISTER', 'DECLARED_SPV_REGISTER']), evidence_precedence: z.literal('REVIEWED_TERMS_AND_DECLARED_REGISTER_OVER_TOKEN_PROJECTION'), correction_policy: policy, dispute_policy: policy }).strict(),
  eligibility: z.object({ countries_ref: z.literal('eligible_countries'), investor_types_ref: z.literal('eligible_investor_types'), identity_policy: policy }).strict(),
  transfer: z.object({ eligible_transfer_policy: policy, lockup_days: integer(0, 3650), maximum_holder_bps: integer(1, 10000), consent_policy: policy, lender_consent_policy_ref: z.literal('real_estate.financing.lender_consent_policy').nullable() }).strict(),
  fees: z.object({ schedule_ref: z.enum(['fund.fees', 'real_estate.cashflow']), tax_policy: policy, rounding_mode: z.literal('DOWN') }).strict(),
  settlement: z.object({ status: z.literal('DECLARED_NOT_APPROVED'), currency: z.literal('TST'), decimals: z.literal(6), chain_id: z.literal(80002), funding_rail: z.literal('TEST_ASSET_PROPOSAL_ONLY'), beneficiary_policy: z.literal('INDEPENDENT_APPROVAL_REQUIRED'), reconciliation_policy: policy, exception_policy: policy }).strict(),
  servicing: z.object({ reporting_frequency: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUALLY']), reporting_policy: policy, default_events: z.array(z.enum(COMMON_DEFAULT_EVENTS)).min(1).max(5), default_notice_days: integer(0, 365), default_response_policy: policy, termination_notice_days: integer(0, 365), termination_approval: z.literal('ISSUER_AND_COMPLIANCE_REVIEW_REQUIRED'), termination_policy: policy }).strict(),
  exit_policy_refs: z.array(z.enum(['fund.redemption', 'fund.dealing', 'fund.liquidity', 'real_estate.exits.eligible_transfer_policy', 'real_estate.exits.disposal_liquidation_policy'])).min(2).max(3),
}).strict().superRefine((value, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  if (value.classes.filter(item => item.primary).length !== 1 || !value.classes[0]?.primary) issue(['classes'], 'Exactly one primary class must appear first.')
  const ids = new Set<string>()
  value.classes.forEach((item, index) => {
    if (ids.has(item.class_id)) issue(['classes', index, 'class_id'], 'Class references must be unique within the product.')
    ids.add(item.class_id)
    if (item.primary ? item.operational_scope !== 'PRIMARY_PACKAGE_ONLY' || item.unit_price_minor === null || item.cap_units === null || item.minimum_units === null
      : item.operational_scope !== 'DECLARATION_ONLY' || item.unit_price_minor !== null || item.cap_units !== null || item.minimum_units !== null) issue(['classes', index], 'Only the primary class carries package economics; secondary classes are declaration-only.')
    if (index > 1 && value.classes[index - 1].class_id >= item.class_id) issue(['classes', index, 'class_id'], 'Secondary class references must be in canonical order.')
  })
  const eventIndexes = value.servicing.default_events.map(event => COMMON_DEFAULT_EVENTS.indexOf(event))
  if (eventIndexes.some((event, index) => index > 0 && event <= eventIndexes[index - 1])) issue(['servicing', 'default_events'], 'Default events must be unique and in the displayed order.')
  if ((value.custody_title.asset_control_model === 'CUSTODIAN_CONTROL_DECLARED') !== (value.custody_title.custodian_legal_name !== null)) issue(['custody_title', 'custodian_legal_name'], 'Only declared custodian control requires a custodian name.')
  const property = value.custody_title.asset_title_model === 'PROPERTY_SPV_INTEREST_DECLARATION'
  if (value.register.authority !== (property ? 'DECLARED_SPV_REGISTER' : 'DECLARED_ISSUER_REGISTER') || value.fees.schedule_ref !== (property ? 'real_estate.cashflow' : 'fund.fees')
    || value.transfer.lender_consent_policy_ref !== (property ? 'real_estate.financing.lender_consent_policy' : null)
    || !sameJson(value.exit_policy_refs, property ? ['real_estate.exits.eligible_transfer_policy', 'real_estate.exits.disposal_liquidation_policy'] : ['fund.redemption', 'fund.dealing', 'fund.liquidity'])) issue(['exit_policy_refs'], 'The declared asset and its exact policy references must agree.')
  if (hasLegacyDenomination(value)) issue([], 'A v3 proposal cannot contain ZAR_TEST references.')
})
export const productDeploymentConfigurationSchema = z.object({
  configuration_version: z.literal(1), state: z.literal('PROPOSED_NOT_DEPLOYED'), standard_family: z.literal('ERC-3643'), conformance: z.literal('NOT_VERIFIED'), chain_id: z.literal(80002), network: z.literal('POLYGON_AMOY'),
  class_ids: z.array(commonEnvelopeUuidSchema).min(1).max(10), primary_class_id: commonEnvelopeUuidSchema,
  policy_refs: z.object({ eligibility: z.literal(COMMON_CONFIGURATION_REFS.eligibility), transfer: z.literal(COMMON_CONFIGURATION_REFS.transfer), identity: z.literal(COMMON_CONFIGURATION_REFS.identity), fees: z.literal(COMMON_CONFIGURATION_REFS.fees), custody_title: z.literal(COMMON_CONFIGURATION_REFS.custody_title), register: z.literal(COMMON_CONFIGURATION_REFS.register), servicing: z.literal(COMMON_CONFIGURATION_REFS.servicing), exits: z.literal(COMMON_CONFIGURATION_REFS.exits) }).strict(),
  routine_authority: z.literal('CONTROLLER_ONLY'),
  signing: z.object({ state: z.literal('PROPOSED_INSTITUTIONAL_POLICY'), threshold_scope: z.literal('HIGH_RISK_ONLY'), policy_slots: z.array(z.enum(COMMON_SIGNING_SLOTS)).min(3).max(4), threshold: integer(2, 4), required_high_risk_slots: z.tuple([z.literal('INDEPENDENT_GOVERNANCE'), z.literal('INDEPENDENT_COMPLIANCE')]), routine_controller_policy: policy, key_recovery_policy: policy }).strict(),
  governance: z.object({ model: z.enum(['IMMUTABLE_RELEASE_GOVERNED_MIGRATION_PROPOSAL', 'TIMELOCKED_UPGRADE_PROPOSAL']), timelock_hours: integer(24, 720), controller_replacement_policy: policy, powers: z.object({ role_grant_revoke: policy, mint_burn: policy, pause_freeze: policy, force_transfer: policy, recovery: policy, upgrade: policy }).strict() }).strict(),
  required_decisions: z.tuple([z.literal(COMMON_REQUIRED_DECISIONS[0]), z.literal(COMMON_REQUIRED_DECISIONS[1]), z.literal(COMMON_REQUIRED_DECISIONS[2]), z.literal(COMMON_REQUIRED_DECISIONS[3])]),
}).strict().superRefine((value, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  if (!sameJson(value.signing.policy_slots, COMMON_SIGNING_SLOTS.slice(0, value.signing.policy_slots.length)) || value.signing.threshold > value.signing.policy_slots.length) issue(['signing'], 'Use the ordered independent policy slots and a threshold within their count.')
  if (new Set(value.class_ids).size !== value.class_ids.length || value.primary_class_id !== value.class_ids[0]) issue(['class_ids'], 'Class references must be unique; the primary reference comes first.')
  const powers = [...Object.values(value.governance.powers), value.governance.controller_replacement_policy]
  if (new Set(powers).size === 1) issue(['governance', 'powers'], 'Do not use one identical catch-all policy for all six powers and controller replacement.')
  if (hasLegacyDenomination(value)) issue([], 'A v3 configuration cannot contain ZAR_TEST references.')
})
export type ProductCommonEnvelope = z.infer<typeof productCommonEnvelopeSchema>
export type ProductDeploymentConfiguration = z.infer<typeof productDeploymentConfigurationSchema>
export type CommonEnvelopeTerms = FundTermsV3 | RealEstateTermsV3

function hasLegacyDenomination(value: unknown): boolean {
  if (typeof value === 'string') return /ZAR_TEST/i.test(value)
  if (Array.isArray(value)) return value.some(hasLegacyDenomination)
  return Boolean(value && typeof value === 'object' && Object.values(value).some(hasLegacyDenomination))
}
/** Object key order is not evidence. Array order remains exact, as in JSONB. No hashing occurs here. */
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJson(value, right[index]))
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]))
}
export function validateCommonEnvelopeReferences(terms: CommonEnvelopeTerms, ctx: z.RefinementCtx) {
  const envelope = terms.common_envelope, configuration = terms.deployment_configuration
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  const primary = envelope.classes[0]
  if (terms.issuer_name !== envelope.issuer.legal_name) issue(['issuer_name'], 'Issuer name and declared legal name must match exactly.')
  if (new Set(terms.eligible_countries).size !== terms.eligible_countries.length || new Set(terms.eligible_investor_types).size !== terms.eligible_investor_types.length) issue(['eligible_countries'], 'Eligibility entries must be unique; their supplied order is preserved.')
  if (primary && (primary.name !== terms.share_class || primary.unit_price_minor !== terms.unit_price_minor || primary.cap_units !== terms.cap_units || primary.minimum_units !== terms.minimum_units)) issue(['common_envelope', 'classes', 0], 'Primary class name and whole-unit economics must match the product.')
  if (!sameJson(configuration.class_ids, envelope.classes.map(item => item.class_id)) || configuration.primary_class_id !== primary?.class_id) issue(['deployment_configuration', 'class_ids'], 'The proposed configuration must bind the exact ordered declared classes.')
  if (terms.asset_type === 'FUND') {
    if (envelope.custody_title.asset_title_model !== 'FUND_PORTFOLIO_INTEREST_DECLARATION' || primary?.rights !== terms.fund.class_rights || envelope.transfer.lockup_days !== terms.fund.liquidity.lockup_days) issue(['common_envelope'], 'Fund class rights, title model and lock-up must match the typed fund policies.')
  } else {
    const property = terms.real_estate
    if (envelope.custody_title.asset_title_model !== 'PROPERTY_SPV_INTEREST_DECLARATION' || envelope.issuer.legal_name !== property.spv.legal_name || envelope.issuer.registration_reference !== property.spv.registration_reference || envelope.issuer.jurisdiction !== property.spv.jurisdiction) issue(['common_envelope', 'issuer'], 'Resolve the issuer/SPV identity mismatch explicitly before saving.')
    if (primary?.rights !== property.spv.interest_rights || envelope.custody_title.title_evidence_reference !== property.property.title_evidence_reference || envelope.custody_title.control_evidence_reference !== property.property.control_evidence_reference
      || envelope.transfer.eligible_transfer_policy !== property.exits.eligible_transfer_policy || envelope.transfer.consent_policy !== property.governance.consent_rights) issue(['common_envelope'], 'Property rights, evidence, transfer and consent must match their authoritative typed policies.')
  }
}

/** Called only by an explicit editable-draft upgrade. V2 content is preserved, not silently corrected. */
export function prepareCommonEnvelopeUpgrade(terms: FundTermsV2 | RealEstateTermsV2, managerId: string, issuerReference: string, classId: string): CommonEnvelopeTerms {
  const property = terms.asset_type === 'REAL_ESTATE' ? terms.real_estate : null
  const proposal = (subject: string) => `FICTIONAL PROPOSAL: ${subject}. Separate issuer, Compliance and operating acceptance is required before actual operations.`
  const common: ProductCommonEnvelope = {
    envelope_version: 1, posture: 'SYNTHETIC_DECLARED',
    issuer: { issuer_reference: issuerReference, declaration_revision: 1, legal_name: terms.issuer_name, registration_reference: property?.spv.registration_reference ?? 'FICTIONAL-ISSUER-001', jurisdiction: property?.spv.jurisdiction ?? 'ZA', legal_form: 'Fictional test company', governing_law: 'Fictional South African test declaration' },
    manager_organisation_id: managerId,
    classes: [{ class_id: classId, primary: true, name: terms.share_class, decimals: 0, rights: terms.asset_type === 'FUND' ? terms.fund.class_rights : terms.real_estate.spv.interest_rights, unit_price_minor: terms.unit_price_minor, cap_units: terms.cap_units, minimum_units: terms.minimum_units, operational_scope: 'PRIMARY_PACKAGE_ONLY' }],
    custody_title: { asset_title_model: property ? 'PROPERTY_SPV_INTEREST_DECLARATION' : 'FUND_PORTFOLIO_INTEREST_DECLARATION', asset_control_model: 'ISSUER_CONTROL_DECLARED', custodian_legal_name: null, title_evidence_reference: property?.property.title_evidence_reference ?? 'FICTIONAL-FUND-TITLE-001', control_evidence_reference: property?.property.control_evidence_reference ?? 'FICTIONAL-FUND-CONTROL-001', segregation_policy: proposal('Segregate declared interests and supporting records'), control_policy: proposal('Record and independently review declared asset control'), recovery_policy: proposal('Investigate loss of control before any corrective operation') },
    register: { authority: property ? 'DECLARED_SPV_REGISTER' : 'DECLARED_ISSUER_REGISTER', evidence_precedence: 'REVIEWED_TERMS_AND_DECLARED_REGISTER_OVER_TOKEN_PROJECTION', correction_policy: proposal('Preserve register correction history and independent evidence'), dispute_policy: proposal('Refer disputed interests to the appointed independent decision owners') },
    eligibility: { countries_ref: 'eligible_countries', investor_types_ref: 'eligible_investor_types', identity_policy: proposal('Use separate current admission and product-specific eligibility evidence') },
    transfer: { eligible_transfer_policy: property?.exits.eligible_transfer_policy ?? proposal('Recheck holder eligibility and transfer restrictions before settlement'), lockup_days: terms.asset_type === 'FUND' ? terms.fund.liquidity.lockup_days : 0, maximum_holder_bps: 10000, consent_policy: property?.governance.consent_rights ?? proposal('Review material holder-transfer consents independently'), lender_consent_policy_ref: property ? 'real_estate.financing.lender_consent_policy' : null },
    fees: { schedule_ref: property ? 'real_estate.cashflow' : 'fund.fees', tax_policy: proposal('Review applicable withholding and tax treatment before liabilities or payouts'), rounding_mode: 'DOWN' },
    settlement: { status: 'DECLARED_NOT_APPROVED', currency: 'TST', decimals: 6, chain_id: 80002, funding_rail: 'TEST_ASSET_PROPOSAL_ONLY', beneficiary_policy: 'INDEPENDENT_APPROVAL_REQUIRED', reconciliation_policy: proposal('Independently reconcile settlement evidence against balanced accounting'), exception_policy: proposal('Suspend unresolved, duplicate, returned or third-party payment cases') },
    servicing: { reporting_frequency: 'QUARTERLY', reporting_policy: proposal('Deliver dated reviewed reporting against each declared holder snapshot'), default_events: ['REPORTING_FAILURE'], default_notice_days: 30, default_response_policy: proposal('Investigate a declared default and retain reviewed corrective evidence'), termination_notice_days: 30, termination_approval: 'ISSUER_AND_COMPLIANCE_REVIEW_REQUIRED', termination_policy: proposal('Review termination liabilities, liquidity, register and residuals separately') },
    exit_policy_refs: property ? ['real_estate.exits.eligible_transfer_policy', 'real_estate.exits.disposal_liquidation_policy'] : ['fund.redemption', 'fund.dealing', 'fund.liquidity'],
  }
  const configuration: ProductDeploymentConfiguration = {
    configuration_version: 1, state: 'PROPOSED_NOT_DEPLOYED', standard_family: 'ERC-3643', conformance: 'NOT_VERIFIED', chain_id: 80002, network: 'POLYGON_AMOY', class_ids: [classId], primary_class_id: classId, policy_refs: { ...COMMON_CONFIGURATION_REFS }, routine_authority: 'CONTROLLER_ONLY',
    signing: { state: 'PROPOSED_INSTITUTIONAL_POLICY', threshold_scope: 'HIGH_RISK_ONLY', policy_slots: ['CONTROLLER_OPERATOR', 'INDEPENDENT_GOVERNANCE', 'INDEPENDENT_COMPLIANCE'], threshold: 2, required_high_risk_slots: ['INDEPENDENT_GOVERNANCE', 'INDEPENDENT_COMPLIANCE'], routine_controller_policy: proposal('Routine controller operations use only admitted operation-bound authority'), key_recovery_policy: proposal('Recover institutional signing continuity through distinct authorised humans') },
    governance: { model: 'IMMUTABLE_RELEASE_GOVERNED_MIGRATION_PROPOSAL', timelock_hours: 48, controller_replacement_policy: proposal('Controller replacement follows separate reviewed governance and authority epochs'), powers: { role_grant_revoke: proposal('Grant or revoke contract roles only through distinct reviewed governance'), mint_burn: proposal('Mint or burn only against reconciled, operation-bound issuance or exit evidence'), pause_freeze: proposal('Pause or freeze with a reviewed scope, reason and restoration procedure'), force_transfer: proposal('Force transfer only on independently evidenced legal authority'), recovery: proposal('Recover lost-wallet positions using separately verified identity and register evidence'), upgrade: proposal('Admit a new reviewed contract release through separate conformance and governance') } },
    required_decisions: [...COMMON_REQUIRED_DECISIONS],
  }
  return { ...terms, terms_version: 3, common_envelope: common, deployment_configuration: configuration } as CommonEnvelopeTerms
}
/** Shared values follow an explicit editor change, never a parser, persistence or historic read. */
export function syncCommonEnvelopeReferences(terms: CommonEnvelopeTerms): CommonEnvelopeTerms {
  const property = terms.asset_type === 'REAL_ESTATE' ? terms.real_estate : null
  const common = terms.common_envelope
  const classes = common.classes.map(item => item.primary ? { ...item, name: terms.share_class, rights: terms.asset_type === 'FUND' ? terms.fund.class_rights : terms.real_estate.spv.interest_rights, unit_price_minor: terms.unit_price_minor, cap_units: terms.cap_units, minimum_units: terms.minimum_units } : item)
  return { ...terms, common_envelope: { ...common, classes, custody_title: property ? { ...common.custody_title, title_evidence_reference: property.property.title_evidence_reference, control_evidence_reference: property.property.control_evidence_reference } : common.custody_title,
    transfer: property ? { ...common.transfer, eligible_transfer_policy: property.exits.eligible_transfer_policy, consent_policy: property.governance.consent_rights } : { ...common.transfer, lockup_days: terms.asset_type === 'FUND' ? terms.fund.liquidity.lockup_days : common.transfer.lockup_days } },
    deployment_configuration: { ...terms.deployment_configuration, class_ids: classes.map(item => item.class_id), primary_class_id: classes[0].class_id } } as CommonEnvelopeTerms
}
export function issuerDeclarationForEdit(next: ProductCommonEnvelope['issuer'], saved?: ProductCommonEnvelope['issuer']): ProductCommonEnvelope['issuer'] {
  if (!saved) return { ...next, declaration_revision: 1 }
  const identity = (value: ProductCommonEnvelope['issuer']) => { const { declaration_revision: _revision, ...other } = value; return other }
  return { ...next, issuer_reference: saved.issuer_reference, declaration_revision: sameJson(identity(next), identity(saved)) ? saved.declaration_revision : saved.declaration_revision + 1 }
}

const projectionSchema = z.object({ common_envelope_hash: hash, deployment_configuration_hash: hash, common_envelope: productCommonEnvelopeSchema, deployment_configuration: productDeploymentConfigurationSchema }).strict().superRefine((value, ctx) => {
  if (!sameJson(value.deployment_configuration.class_ids, value.common_envelope.classes.map(item => item.class_id)) || value.deployment_configuration.primary_class_id !== value.common_envelope.classes[0]?.class_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Immutable declaration and configuration class references do not match.' })
})
export type CommonEnvelopeProjection = z.infer<typeof projectionSchema>
const projectionKeys = ['common_envelope_hash', 'deployment_configuration_hash', 'common_envelope', 'deployment_configuration'] as const
export function readCommonEnvelopeProjection(pkg: PortalOfferingPackage): { kind: 'LEGACY' } | { kind: 'V3'; value: CommonEnvelopeProjection } | null {
  const raw = pkg as unknown as Record<string, unknown>
  if (projectionKeys.every(key => raw[key] === undefined) || projectionKeys.every(key => raw[key] === null)) return { kind: 'LEGACY' }
  const parsed = projectionSchema.safeParse(Object.fromEntries(projectionKeys.map(key => [key, raw[key]])))
  return parsed.success ? { kind: 'V3', value: parsed.data } : null
}
/** The database owns the hashes. This checks projected structure/binding, not a client hash oracle. */
export function reviewCommonEnvelopeBindings(product: PortalProduct): { common_envelope_hash?: string; deployment_configuration_hash?: string } | null {
  const pkg = product.offering_package
  if (!pkg || pkg.origin !== 'SUBMITTED' || pkg.terms_hash !== product.terms_hash) return null
  const projection = readCommonEnvelopeProjection(pkg)
  if (product.terms.terms_version !== 3) return projection?.kind === 'LEGACY' ? {} : null
  if (projection?.kind !== 'V3' || projection.value.common_envelope.manager_organisation_id !== product.organisation_id
    || !sameJson(projection.value.common_envelope, product.terms.common_envelope) || !sameJson(projection.value.deployment_configuration, product.terms.deployment_configuration)) return null
  return { common_envelope_hash: projection.value.common_envelope_hash, deployment_configuration_hash: projection.value.deployment_configuration_hash }
}
