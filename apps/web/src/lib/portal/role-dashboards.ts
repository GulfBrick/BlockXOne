import { BX1_ROLES, type Bx1Role } from '../supabase/contracts'

/** Screen integration only: never an authority decision or a user's completion state. */
export type RoleWorkflowStatus = 'available' | 'needs_setup' | 'not_connected'

export type RoleWorkflowStep = {
  id: string
  label: string
  description: string
  status: RoleWorkflowStatus
  href?: string
}

export type RoleDashboard = {
  role: Bx1Role
  title: string
  description: string
  responsibilities: string[]
  handoffs: string[]
  walletGuidance: string
  authorityBoundary: string
  workflow: RoleWorkflowStep[]
}

/**
 * One operating-role catalog for both environments and both product templates.
 * Responsibilities describe the role, not already-enabled permissions. Callers
 * must apply verified actor scope and environment gates before showing links;
 * every destination retains its own server-side authority checks. Nothing here
 * grants a role, changes a session, signs a transaction or supplies financial data.
 */
export const ROLE_DASHBOARDS: Record<Bx1Role, RoleDashboard> = {
  Investor: {
    role: 'Investor',
    title: 'Investor dashboard',
    description: 'Manage your investment relationship, review fund and real-estate offerings, and follow each instruction through to recorded ownership and exit.',
    responsibilities: [
      'Keep your identity, entity representation, eligibility and disclosures current.',
      'Accept the exact offering revision and instruct only investments you are authorised to make.',
      'Review funding, ownership, servicing and exit evidence for your investment account.',
    ],
    handoffs: [
      'Compliance reviews identity, representation and investment eligibility.',
      'Treasury and the Financial Controller verify and reconcile funding.',
      'The issuer, Tokenisation Agent and Transfer Agent complete authorised allocation and ownership recording.',
    ],
    walletGuidance: 'Use MetaMask to prove or sign for a self-custody wallet when that step is required. Browsing, identity checks and a custodial relationship do not automatically require a personal wallet; custody and representation must be recorded separately.',
    authorityBoundary: 'An Investor cannot approve their own eligibility, declare unverified funding settled, or issue tokens. A subscription instruction is not a funded holding.',
    workflow: [
      { id: 'onboarding', label: 'Identity and investment relationship', description: 'Submit personal or entity details and supporting documents for independent review.', status: 'available', href: '/portal/onboarding' },
      { id: 'opportunities', label: 'Review investment opportunities', description: 'Read published fund or real-estate terms, disclosures and eligibility requirements before subscribing.', status: 'available', href: '/portal/opportunities' },
      { id: 'instructions', label: 'Track subscription instructions', description: 'View saved instructions and cancellations. The current screen does not represent funded or issued holdings.', status: 'available', href: '/portal/portfolio' },
      { id: 'funding', label: 'Funding and settlement', description: 'Connect payment instructions, independently verified receipts and balanced accounting to the subscription.', status: 'not_connected' },
      { id: 'ownership', label: 'Confirmed ownership', description: 'Connect governed issuance and finality to the ownership register, holdings and ledger reconciliation.', status: 'not_connected' },
      { id: 'servicing-exit', label: 'Distributions, transfers and exit', description: 'Connect product-specific servicing, permitted transfers, redemption or liquidation to settlement and ownership updates.', status: 'not_connected' },
    ],
  },
  OfferingManager: {
    role: 'OfferingManager',
    title: 'Offering Manager dashboard',
    description: 'Structure and publish versioned offerings for the issuers and products covered by your mandate.',
    responsibilities: [
      'Prepare typed fund or real-estate product terms, fees, risks and offering documents.',
      'Submit the exact offering revision for independent review and manage approved publication.',
      'Coordinate investor communications and approved changes without silently replacing accepted terms.',
    ],
    handoffs: [
      'The Issuer Fund Manager accepts issuer responsibility and product economics.',
      'Compliance independently reviews disclosures, eligibility and restrictions.',
      'The Tokenisation Agent receives approved technical requirements; investors receive published terms.',
    ],
    walletGuidance: 'Drafting or publishing an offering does not itself require MetaMask. Any deployment or issuer signature needs a separate, scoped institutional signer mandate.',
    authorityBoundary: 'An Offering Manager cannot approve their own offering review, grant issuer authority to themselves, or mint tokens because they created the product.',
    workflow: [
      { id: 'mandate', label: 'Confirm organisation and product mandate', description: 'Product access requires an approved relationship and an active organisation-scoped role; this catalog does not assign either.', status: 'needs_setup' },
      { id: 'draft', label: 'Create a typed offering', description: 'Prepare a fund or real-estate draft with economics, eligibility rules and versioned disclosures.', status: 'available', href: '/portal/products/new' },
      { id: 'review-publication', label: 'Manage review and publication', description: 'Track saved product revisions and submit them for independent review before publishing an approved version.', status: 'available', href: '/portal/products' },
      { id: 'allocation', label: 'Subscription and allocation hand-off', description: 'Connect accepted subscriptions, verified funding and issuer allocation decisions to this same product record.', status: 'not_connected' },
      { id: 'lifecycle-changes', label: 'Manage lifecycle communications', description: 'Connect approved offering changes, servicing notices and product closure to the affected investor records.', status: 'not_connected' },
    ],
  },
  ComplianceOfficer: {
    role: 'ComplianceOfficer',
    title: 'Compliance Officer dashboard',
    description: 'Review client evidence and product disclosures independently, within your appointed organisation and product scope.',
    responsibilities: [
      'Review identity, beneficial ownership, representation, screening and investment eligibility evidence.',
      'Record reasoned, version-bound decisions and request changes or reject where necessary.',
      'Maintain restrictions, review expiry and escalation throughout the investment lifecycle.',
    ],
    handoffs: [
      'Applicants provide evidence and respond to review requests.',
      'Offering and issuer managers resolve product disclosure or eligibility issues.',
      'The Transfer Agent and authorised signers enforce approved restrictions at execution.',
    ],
    walletGuidance: 'Ordinary compliance review does not need a wallet. Signing an on-chain eligibility or restriction change through MetaMask requires separately assigned institutional authority.',
    authorityBoundary: 'A Compliance Officer cannot approve their own application or offering, invent provider checks, verify cash by assertion, or overwrite ownership records.',
    workflow: [
      { id: 'appointment', label: 'Confirm independent review appointment', description: 'Review access requires an active scoped appointment and a separate reviewer from the applicant or product creator.', status: 'needs_setup' },
      { id: 'review', label: 'Review applications and offerings', description: 'Read private evidence and record independent decisions. The current connected review supports manual rehearsal checks, not a live KYC-provider result.', status: 'available', href: '/portal/compliance' },
      { id: 'provider-screening', label: 'Provider-backed identity and screening', description: 'Connect genuine provider outcomes, provenance, failures and escalations to each reviewed case.', status: 'not_connected' },
      { id: 'ongoing-monitoring', label: 'Customer monitoring and restrictions', description: 'Inspect scoped admission expiry and record holds or renewal requirements with a reviewer-cited evidence reference. This is a guarded new-action restriction, not automatic provider monitoring or an existing-holding freeze.', status: 'available', href: '/portal/compliance' },
      { id: 'execution-review', label: 'Execution and exit compliance', description: 'Carry current decisions into governed issuance, transfer, servicing and exit checks.', status: 'not_connected' },
    ],
  },
  IssuerFundManager: {
    role: 'IssuerFundManager',
    title: 'Issuer Fund Manager dashboard',
    description: 'Manage the issuer responsibilities, economic terms and lifecycle of the funds or real-estate products you are mandated to operate.',
    responsibilities: [
      'Maintain the issuer mandate and approve the product economics and investor-facing obligations.',
      'Coordinate offering readiness, raise decisions and allocation instructions.',
      'Manage valuations, fees, distributions, redemption or liquidation under the approved product rules.',
    ],
    handoffs: [
      'The Offering Manager prepares versioned terms and investor communications.',
      'Compliance reviews investor and product eligibility independently.',
      'Treasury, the Financial Controller, Tokenisation Agent and Transfer Agent execute and reconcile approved lifecycle instructions.',
    ],
    walletGuidance: 'Use MetaMask for issuer transactions only under a verified institutional signer mandate. An issuer platform role does not make a personal wallet the issuer wallet.',
    authorityBoundary: 'An Issuer Fund Manager cannot self-certify investor compliance, treat unverified cash as settled, or use issuer access as unrestricted minting authority.',
    workflow: [
      { id: 'issuer-mandate', label: 'Establish issuer authority', description: 'Confirm the legal entity, representatives and product-scoped mandate before acting for an issuer.', status: 'needs_setup' },
      { id: 'products', label: 'Manage issuer products and terms', description: 'Open authorised fund and real-estate product records, their current revisions and offering-review state.', status: 'available', href: '/portal/products' },
      { id: 'allocation', label: 'Approve allocations', description: 'Connect issuer decisions to eligible subscriptions, verified funding and bounded issuance obligations.', status: 'not_connected' },
      { id: 'servicing', label: 'Manage valuations and distributions', description: 'Connect fund dealing or property income rules, fees and approved servicing instructions to accounting and payments.', status: 'not_connected' },
      { id: 'exit', label: 'Manage redemption or liquidation', description: 'Connect product-specific exit approvals to settlement, token adjustments and the final ownership record.', status: 'not_connected' },
    ],
  },
  TransferAgent: {
    role: 'TransferAgent',
    title: 'Transfer Agent dashboard',
    description: 'Maintain ownership-register integrity and coordinate authorised issuance, transfer and exit recording for appointed products.',
    responsibilities: [
      'Validate owner identity, restrictions and approved instructions before register changes.',
      'Record issuance, permitted transfers, redemption and justified corrections with an audit trail.',
      'Reconcile the ownership register against final chain events and accounting records.',
    ],
    handoffs: [
      'Compliance supplies current eligibility and restriction decisions.',
      'The issuer and Tokenisation Agent supply approved obligations and confirmed execution evidence.',
      'The Financial Controller resolves accounting or register breaks independently.',
    ],
    walletGuidance: 'Reading or reconciling a register does not require MetaMask. A register-changing chain transaction requires an explicit institutional signer mandate and the applicable approvals.',
    authorityBoundary: 'A Transfer Agent cannot change offering economics, fabricate cash, silently delete ownership history, or treat a submitted transaction as final ownership.',
    workflow: [
      { id: 'appointment', label: 'Confirm register appointment', description: 'Establish the exact organisations, products and permitted register actions covered by the appointment.', status: 'needs_setup' },
      { id: 'security', label: 'Review sign-in security', description: 'Manage account-security prerequisites without granting register or signing authority.', status: 'available', href: '/workspace/security' },
      { id: 'register', label: 'Ownership register', description: 'Connect the canonical product and investor accounts to confirmed issuance and ownership records.', status: 'not_connected' },
      { id: 'transfers', label: 'Transfers and ownership corrections', description: 'Connect current eligibility, independent approvals and traceable register changes to execution.', status: 'not_connected' },
      { id: 'reconciliation-exit', label: 'Reconcile and close ownership', description: 'Reconcile tokens, register and ledger; record approved redemption or liquidation after confirmed execution.', status: 'not_connected' },
    ],
  },
  TokenisationAgent: {
    role: 'TokenisationAgent',
    title: 'Tokenisation Agent dashboard',
    description: 'Translate approved product terms into governed token configuration and verifiable chain execution.',
    responsibilities: [
      'Prepare contract configuration, supply controls and restrictions from approved product requirements.',
      'Bind verified deployment evidence to the correct issuer, product and environment.',
      'Process approved issuance and exit obligations with durable transaction tracking and finality checks.',
    ],
    handoffs: [
      'The issuer and Offering Manager supply approved economic and technical requirements.',
      'Compliance and institutional approvers authorise relevant restrictions and execution.',
      'The Transfer Agent and Financial Controller reconcile confirmed chain outcomes with ownership and accounting.',
    ],
    walletGuidance: 'Use MetaMask for authorised deployment or execution signatures. The selected network, institutional account, mandate and transaction must all match; a connected personal wallet alone confers no execution authority.',
    authorityBoundary: 'A Tokenisation Agent cannot approve their own release, mint outside an approved obligation, invent funding or treat an unconfirmed receipt as completion.',
    workflow: [
      { id: 'signer-mandate', label: 'Confirm technical and signer mandates', description: 'Establish separate product-operation and institutional-signing authority with the required approvals.', status: 'needs_setup' },
      { id: 'security', label: 'Review sign-in security', description: 'Manage account-security prerequisites; wallet ownership and institutional authority remain separate checks.', status: 'available', href: '/workspace/security' },
      { id: 'contract-binding', label: 'Governed deployment and contract binding', description: 'Connect approved portal products to verified contract configuration and deployment evidence. Existing presenter-demo deployments are not a connected product lifecycle.', status: 'not_connected' },
      { id: 'issuance', label: 'Execute approved issuance', description: 'Connect funded allocations, bounded obligations and independent approvals to durable MetaMask transaction processing.', status: 'not_connected' },
      { id: 'recovery-exit', label: 'Transaction recovery and exit execution', description: 'Recover failed or replaced transactions, verify finality and connect servicing or exit to register and ledger reconciliation.', status: 'not_connected' },
    ],
  },
  TreasuryOperator: {
    role: 'TreasuryOperator',
    title: 'Treasury Operator dashboard',
    description: 'Manage funding evidence and prepare authorised settlement, refund and distribution payments within appointed accounts and limits.',
    responsibilities: [
      'Match funding instructions to externally verifiable bank or blockchain receipts.',
      'Prepare payments, refunds and distributions under account mandates and value limits.',
      'Hand settlement evidence to independent financial reconciliation and exception handling.',
    ],
    handoffs: [
      'Investors and issuers provide the underlying investment or servicing instructions.',
      'The Financial Controller independently reconciles receipts, payments and accounting.',
      'Authorised institutional approvers and signers release payments under the applicable policy.',
    ],
    walletGuidance: 'MetaMask is required for an authorised blockchain payment signature, not merely for recording bank evidence. Platform access never grants control of all organisation wallets.',
    authorityBoundary: 'A Treasury Operator cannot independently certify and reconcile their own receipt, edit posted journals or release issuance from unverified funding.',
    workflow: [
      { id: 'account-mandate', label: 'Confirm account and payment limits', description: 'Establish the organisation accounts, value limits and independent approval requirements covered by the mandate.', status: 'needs_setup' },
      { id: 'security', label: 'Review sign-in security', description: 'Manage account-security prerequisites without granting payment or wallet-signing authority.', status: 'available', href: '/workspace/security' },
      { id: 'funding-evidence', label: 'Funding evidence and matching', description: 'Connect subscription payment instructions to independently verifiable receipts and unresolved exceptions.', status: 'not_connected' },
      { id: 'payments', label: 'Prepare settlement and refunds', description: 'Connect approved instructions, reservations, payment authorisation and durable execution evidence.', status: 'not_connected' },
      { id: 'distributions', label: 'Distributions and exit payments', description: 'Connect approved servicing or redemption obligations to payments and independent reconciliation.', status: 'not_connected' },
    ],
  },
  FinancialController: {
    role: 'FinancialController',
    title: 'Financial Controller dashboard',
    description: 'Maintain independent accounting and reconciliation controls across funding, ownership, servicing and exit.',
    responsibilities: [
      'Review exact-precision, balanced accounting and the source evidence behind financial events.',
      'Independently reconcile bank or token balances, ownership registers and the ledger.',
      'Approve justified reversals and corrections without erasing posted history or unresolved breaks.',
    ],
    handoffs: [
      'Treasury supplies verifiable funding and settlement evidence.',
      'The issuer supplies approved economic obligations and servicing instructions.',
      'The Transfer Agent and Tokenisation Agent supply ownership and final chain evidence.',
    ],
    walletGuidance: 'Accounting review does not require MetaMask. A financial approval becomes a payment signature only where a separate institutional signer mandate explicitly permits it.',
    authorityBoundary: 'A Financial Controller cannot erase posted journals, approve their own correction as an independent checker, or treat a treasury assertion as external settlement evidence.',
    workflow: [
      { id: 'independence', label: 'Confirm independent financial appointment', description: 'Establish entity and account scope and separation from the maker of the item being reviewed.', status: 'needs_setup' },
      { id: 'security', label: 'Review sign-in security', description: 'Manage account-security prerequisites without granting journal or payment permissions.', status: 'available', href: '/workspace/security' },
      { id: 'ledger', label: 'Review balanced accounting', description: 'Connect economic obligations, exact-precision postings and source evidence to canonical product and investment accounts.', status: 'not_connected' },
      { id: 'reconciliation', label: 'Independent reconciliation', description: 'Connect bank or token evidence, ownership records and journals; expose differences instead of manufacturing a balanced outcome.', status: 'not_connected' },
      { id: 'corrections-reporting', label: 'Reversals, controls and reporting', description: 'Connect independently approved corrections and period controls to servicing, exit and auditable financial reports.', status: 'not_connected' },
    ],
  },
  SuperAdmin: {
    role: 'SuperAdmin',
    title: 'Super Admin dashboard',
    description: 'Operate platform access and organisation governance while preserving independent investment, compliance, accounting and signing authority.',
    responsibilities: [
      'Manage controlled organisation, person, role and mandate administration within verified scope.',
      'Coordinate revocation, account recovery, access incidents and audit review.',
      'Maintain environment boundaries and operational configuration without bypassing business approvals.',
    ],
    handoffs: [
      'Organisation representatives establish legitimate person, entity and mandate requests.',
      'Independent authorised reviewers approve controlled access and recovery changes.',
      'Business role holders retain responsibility for compliance, funding, issuance and reconciliation.',
    ],
    walletGuidance: 'Super Admin access does not include wallet custody or a MetaMask signing mandate. Any institutional signature needs separately authorised identity, scope and approval.',
    authorityBoundary: 'A Super Admin cannot bypass KYC, impersonate investors, seize wallets, manufacture funding, mint tokens or rewrite balances merely because they administer the platform.',
    workflow: [
      { id: 'appointment', label: 'Confirm scoped administration authority', description: 'A role label alone is insufficient: the administration backend checks live person, organisation, trust and mandate state.', status: 'needs_setup' },
      { id: 'administration', label: 'Controlled access administration', description: 'Open the guarded administration screen. Propose, review and apply actions remain subject to independent approval and live backend checks.', status: 'available', href: '/workspace/administration' },
      { id: 'security', label: 'Account security and recovery entry', description: 'Review account-security controls and the available recovery entry points; opening this screen does not complete recovery acceptance.', status: 'available', href: '/workspace/security' },
      { id: 'operations', label: 'Operational assurance', description: 'Connect monitoring, alert routing, backup restoration evidence and incident drills across the complete application.', status: 'not_connected' },
      { id: 'admission', label: 'Controlled production admission', description: 'Connect approved operational, provider, security and financial evidence to release admission without granting business or signer powers.', status: 'not_connected' },
    ],
  },
}

/** Canonical order; selecting a definition never selects or assigns an acting role. */
export const ROLE_DASHBOARD_LIST: RoleDashboard[] = BX1_ROLES.map(role => ROLE_DASHBOARDS[role])

export function isRoleDashboardRole(value: unknown): value is Bx1Role {
  return typeof value === 'string' && BX1_ROLES.some(role => role === value)
}

export function getRoleDashboard(role: unknown): RoleDashboard | undefined {
  return isRoleDashboardRole(role) ? ROLE_DASHBOARDS[role] : undefined
}
