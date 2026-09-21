import { z } from 'zod'
import type { PortalOperatingContext } from './operating-context'
import { fundingCommandOptions, type FundingSnapshot } from './funding-contracts'

/** One customer workflow; environment-specific providers never manufacture settlement. */
export const PORTAL_PATHS = ['/portal', '/portal/onboarding', '/portal/products', '/portal/products/new', '/portal/products/detail', '/portal/compliance', '/portal/compliance/detail', '/portal/opportunities', '/portal/opportunities/detail', '/portal/portfolio', '/portal/orders/detail'] as const
export type PortalPath = (typeof PORTAL_PATHS)[number]
export const applicationStatuses = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED'] as const
export const productStatuses = ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUIRED', 'APPROVED', 'PUBLISHED'] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]
export type ProductStatus = (typeof productStatuses)[number]
export type Persona = 'INVESTOR' | 'WEALTH_MANAGER'
export type InvestorType = 'INDIVIDUAL' | 'ENTITY'
export type EvidenceDocument = { id: string; kind: string; title: string; storage_path: string; sha256: string; size: number; mime_type: string }
export type LegacyApplicationDetails = {
  full_name: string; country: string; investor_type: InvestorType; company_name: string;
  registration_reference: string; source_of_funds: string; beneficial_owners: string;
  experience: string; documents: EvidenceDocument[]; test_data_acknowledged: true;
  details_version?: never; business_activities?: never; representative_position?: never; authority_basis?: never;
}
export type WealthManagerApplicationDetailsV2 = {
  details_version: 2; full_name: string; country: string; company_name: string;
  registration_reference: string; beneficial_owners: string; business_activities: string;
  representative_position: string; authority_basis: string; documents: EvidenceDocument[]; test_data_acknowledged: true;
  investor_type?: never; source_of_funds?: never; experience?: never;
}
export type ApplicationDetails = LegacyApplicationDetails | WealthManagerApplicationDetailsV2
export type AdmissionPurpose = 'INVESTOR_ADMISSION' | 'CUSTOMER_ORGANISATION_ADMISSION' | 'LEGACY_REHEARSAL'
/** A version discriminator only; request/read schemas still validate complete evidence. */
export function isWealthManagerDetailsV2(value: unknown): value is WealthManagerApplicationDetailsV2 {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { details_version?: unknown }).details_version === 2)
}
export type PortalApplication = {
  id: string; user_id: string; persona: Persona; status: ApplicationStatus; revision: number;
  details: ApplicationDetails; submitted_at: string | null; reviewed_at: string | null;
  reviewer_id: string | null; review_notes: string | null; organisation_id: string | null;
  review_checks: Record<string, boolean>; provider_mode: 'MANUAL_TEST_REVIEW'; approved_until: string | null;
  admission_purpose?: AdmissionPurpose;
}
export type PortalCapability = 'create_product' | 'save_product' | 'submit_product' | 'publish_product' | 'read_orders' | 'review_product'
  | 'propose_funding_route' | 'approve_funding_route' | 'revoke_funding_route' | 'open_funding_obligation' | 'propose_funding_acceptance' | 'reconcile_funding'
  | 'propose_funding_exception' | 'resolve_funding_exception' | 'propose_funding_reversal' | 'approve_funding_reversal'
export type PortalOrganisation = {
  id: string; name: string; roles: string[]; status: string;
  native_organisation_id?: string | null; capabilities?: PortalCapability[];
  authority_source?: 'NATIVE_BINDING' | 'LEGACY_OWNER';
}
export type PortalInvestmentAccount = {
  id: string; holder_user_id: string; application_id: string; kind: 'INDIVIDUAL';
  status: 'ACTIVE' | 'SUSPENDED'; created_at: string;
}
export type ProductTerms = {
  asset_type: 'FUND' | 'REAL_ESTATE'; name: string; issuer_name: string; summary: string;
  strategy: string; share_class: string; currency: 'ZAR_TEST'; unit_price_minor: string;
  cap_units: string; minimum_units: string; pricing_basis: string; fees: string;
  redemption_terms: string; eligible_countries: string[]; eligible_investor_types: InvestorType[];
  property_address: string; property_valuation_minor: string; rental_income_policy: string;
  documents: { memorandum: string; risks: string; subscription_terms: string };
}
export type PortalProduct = {
  id: string; organisation_id: string; created_by: string; revision: number; status: ProductStatus;
  terms: ProductTerms; terms_hash: string; reserved_units: string; created_at: string;
  reviewer_id: string | null; review_notes: string | null; reviewed_at: string | null;
  published_at: string | null; review_checks: Record<string, boolean>;
  allowed_actions?: string[];
}
export type PortalSubscription = {
  id: string; product_id: string; investor_id: string; product_name: string; organisation_id: string;
  product_revision: number; terms_hash: string; units: string; amount_minor: string;
  status: 'AWAITING_FUNDING' | 'CANCELLED'; created_at: string;
  investment_account_id?: string | null; currency?: 'ZAR_TEST';
  can_cancel?: boolean; funding_obligation_id?: string | null;
  allowed_actions?: string[];
}
export type PortalEvent = { id: string; subject_id: string; kind: string; actor_id: string; created_at: string; summary: string }
export type PortalSnapshot = {
  actor: { id: string; email: string; display_name: string | null; can_review: boolean };
  applications: PortalApplication[]; organisations: PortalOrganisation[];
  products: PortalProduct[]; subscriptions: PortalSubscription[]; events: PortalEvent[];
  requests?: { key: string; command: string }[];
  accounts?: PortalInvestmentAccount[]; operating_context?: PortalOperatingContext;
  funding?: FundingSnapshot;
}
export type PortalPageData = { user: { id: string; email: string }; snapshot: PortalSnapshot }

const id = z.string().uuid()
const text = (min: number, max: number) => z.string().trim().min(min).max(max)
const positive = z.string().regex(/^[1-9][0-9]{0,19}$/)
const country = z.string().regex(/^[A-Z]{2}$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
export const evidenceSchema = z.object({ id, kind: z.enum(['IDENTITY', 'ADDRESS', 'COMPANY', 'BENEFICIAL_OWNERS']), title: text(1, 160), storage_path: text(1, 400), sha256: hash, size: z.number().int().min(1).max(4_194_304), mime_type: z.enum(['application/pdf', 'image/png', 'image/jpeg']) }).strict()
export const legacyApplicationDetailsSchema = z.object({ full_name: text(2, 120), country, investor_type: z.enum(['INDIVIDUAL', 'ENTITY']), company_name: text(0, 160), registration_reference: text(0, 100), source_of_funds: text(20, 2000), beneficial_owners: text(0, 2000), experience: text(10, 2000), documents: z.array(evidenceSchema).min(1).max(8), test_data_acknowledged: z.literal(true), details_version: z.never().optional(), business_activities: z.never().optional(), representative_position: z.never().optional(), authority_basis: z.never().optional() }).strict()
export const wealthManagerApplicationDetailsV2Schema = z.object({ details_version: z.literal(2), full_name: text(2, 120), country, company_name: text(3, 160), registration_reference: text(3, 100), beneficial_owners: text(20, 2000), business_activities: text(20, 2000), representative_position: text(2, 160), authority_basis: text(20, 2000), documents: z.array(evidenceSchema).min(1).max(8), test_data_acknowledged: z.literal(true), investor_type: z.never().optional(), source_of_funds: z.never().optional(), experience: z.never().optional() }).strict()
export const applicationDetailsSchema = z.union([legacyApplicationDetailsSchema, wealthManagerApplicationDetailsV2Schema])
export const applicationDraftDetailsSchema = z.union([legacyApplicationDetailsSchema.partial(), wealthManagerApplicationDetailsV2Schema.partial()])
export const productTermsSchema = z.object({ asset_type: z.enum(['FUND', 'REAL_ESTATE']), name: text(3, 120), issuer_name: text(3, 160), summary: text(30, 600), strategy: text(30, 4000), share_class: text(1, 80), currency: z.literal('ZAR_TEST'), unit_price_minor: positive, cap_units: positive, minimum_units: positive, pricing_basis: text(10, 1200), fees: text(10, 1200), redemption_terms: text(20, 2400), eligible_countries: z.array(country).min(1).max(30), eligible_investor_types: z.array(z.enum(['INDIVIDUAL', 'ENTITY'])).min(1).max(2), property_address: text(0, 300), property_valuation_minor: z.string().regex(/^(0|[1-9][0-9]{0,19})$/), rental_income_policy: text(0, 2000), documents: z.object({ memorandum: text(50, 12000), risks: text(50, 12000), subscription_terms: text(50, 12000) }).strict() }).strict().superRefine((v, ctx) => {
  if (/^[1-9][0-9]{0,19}$/.test(v.minimum_units) && /^[1-9][0-9]{0,19}$/.test(v.cap_units) && BigInt(v.minimum_units) > BigInt(v.cap_units)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minimum_units'], message: 'Minimum subscription must fit within the fund capacity.' })
  if (v.asset_type === 'REAL_ESTATE' && (v.property_address.length < 10 || !/^[1-9][0-9]{0,19}$/.test(v.property_valuation_minor) || v.rental_income_policy.length < 20)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['property_address'], message: 'Provide property, valuation and rental-income terms.' })
})
export const reviewChecks = z.object({ identity: z.boolean(), ownership: z.boolean(), screening: z.boolean(), suitability: z.boolean() }).strict()
export const offeringChecks = z.object({ issuer: z.boolean(), terms: z.boolean(), disclosures: z.boolean(), eligibility: z.boolean() }).strict()
export const portalCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('submit_application'), key: id, payload: z.object({ persona: z.enum(['INVESTOR', 'WEALTH_MANAGER']), expected_revision: z.number().int().min(0), details: applicationDetailsSchema }).strict() }).strict(),
  z.object({ command: z.literal('review_application'), key: id, payload: z.object({ application_id: id, expected_revision: z.number().int().positive(), decision: z.enum(['APPROVED', 'CHANGES_REQUIRED', 'REJECTED']), notes: text(20, 3000), checks: reviewChecks }).strict() }).strict(),
  z.object({ command: z.literal('create_investment_account'), key: id, payload: z.object({ application_id: id }).strict() }).strict(),
  z.object({ command: z.literal('create_product'), key: id, payload: z.object({ organisation_id: id, terms: productTermsSchema }).strict() }).strict(),
  z.object({ command: z.literal('save_product'), key: id, payload: z.object({ product_id: id, expected_revision: z.number().int().positive(), terms: productTermsSchema }).strict() }).strict(),
  z.object({ command: z.literal('submit_product'), key: id, payload: z.object({ product_id: id, expected_revision: z.number().int().positive() }).strict() }).strict(),
  z.object({ command: z.literal('review_product'), key: id, payload: z.object({ product_id: id, expected_revision: z.number().int().positive(), decision: z.enum(['APPROVED', 'CHANGES_REQUIRED']), notes: text(20, 3000), checks: offeringChecks }).strict() }).strict(),
  z.object({ command: z.literal('publish_product'), key: id, payload: z.object({ product_id: id, expected_revision: z.number().int().positive() }).strict() }).strict(),
  z.object({ command: z.literal('subscribe'), key: id, payload: z.object({ product_id: id, investment_account_id: id.optional(), expected_revision: z.number().int().positive(), terms_hash: hash, units: positive, accepted_documents: z.literal(true), accepted_risks: z.literal(true) }).strict() }).strict(),
  z.object({ command: z.literal('cancel_subscription'), key: id, payload: z.object({ subscription_id: id }).strict() }).strict(),
  ...fundingCommandOptions,
])
export type PortalCommand = z.infer<typeof portalCommandSchema>
export function formatTestMoney(minor: string): string {
  if (!/^[0-9]+$/.test(minor)) return 'Unavailable'
  const amount = BigInt(minor)
  return `${(amount / 100n).toLocaleString('en-ZA')}.${(amount % 100n).toString().padStart(2, '0')} ZAR_TEST`
}
export function subscriptionQuote(product: PortalProduct, units: string): { amount_minor: string } | { error: string } {
  if (!/^[1-9][0-9]{0,19}$/.test(units)) return { error: 'Enter a positive whole-unit quantity.' }
  if (product.status !== 'PUBLISHED') return { error: 'This offering is not open for subscriptions.' }
  const quantity = BigInt(units)
  if (quantity < BigInt(product.terms.minimum_units)) return { error: 'The requested quantity is below the minimum subscription.' }
  if (quantity + BigInt(product.reserved_units) > BigInt(product.terms.cap_units)) return { error: 'The requested quantity exceeds the remaining capacity.' }
  return { amount_minor: (quantity * BigInt(product.terms.unit_price_minor)).toString() }
}
