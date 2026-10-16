// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { Interface } from 'ethers'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformRelease } from '@/lib/platform-release'
import type { PortalApplication, PortalPath, PortalProduct, PortalSnapshot, PortalSubscription } from '@/lib/portal/contracts'
import { fundStageKeys, type FundLifecycleSnapshot, type FundProductLifecycle } from '@/lib/portal/fund-lifecycle-contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { PortalScreen } from './portal-screens'
import { PortalCommandProvider } from './portal-client'
import { ApplicationReview, SubscriptionForm } from './portal-workflows'
import { FundLifecycleOrder, FundLifecyclePortfolio } from './fund-lifecycle'
import { fictionalProductTerms } from './product-form'

// Real mounted components and durable command transport; every returned record
// and wallet response here is synthetic. This is not hosted financial or chain
// acceptance, a provider verdict, a real signature, or an actual investment.
const wallet = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(), removeListener: vi.fn(), stop: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))
vi.mock('@/components/workspace/metamask-wallet-link', () => ({
  discoverMetaMask: (_target: Window, receive: (choice: { id: string; provider: MetaMaskProvider }) => void) => {
    receive({ id: 'synthetic-investor-wallet', provider: wallet }); return wallet.stop
  },
  MetaMaskWalletLink: () => <p>Wallet ownership remains a separate guarded action.</p>,
}))

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const actor = id(1), organisation = id(2), nativeOrganisation = id(3), productId = id(4), packageId = id(5)
const applicationId = id(6), accountId = id(7), eligibilityId = id(8), orderId = id(9), other = id(10)
const digest = 'ab'.repeat(32), payer = `0x${'11'.repeat(20)}`, token = `0x${'22'.repeat(20)}`, beneficiary = `0x${'33'.repeat(20)}`
const context: PortalOperatingContext = { mode: 'ROLE', organisationId: nativeOrganisation, role: 'Investor' }
const release: PlatformRelease = { version: 'investor-journey-fixture', environment: 'TESTNET', source: 'synthetic-ui-only' }
const until = '2099-01-01T00:00:00Z', recorded = '2026-10-16T00:01:00Z'

function product(open = true): PortalProduct {
  return { id: productId, organisation_id: organisation, created_by: other, revision: 4, status: open ? 'PUBLISHED' : 'APPROVED',
    terms: { ...fictionalProductTerms('FUND'), name: 'Fictional investor journey fund', minimum_units: '1', cap_units: '100', unit_price_minor: '10000000' },
    terms_hash: digest, reserved_units: '0', created_at: recorded, reviewer_id: other, review_notes: null, reviewed_at: recorded,
    published_at: open ? recorded : null, review_checks: {}, allowed_actions: [], offering_history: [],
    offering_package: { id: packageId, package_number: 1, origin: 'SUBMITTED', terms_hash: digest,
      document_hashes: { memorandum: digest, risks: digest, subscription_terms: digest }, submitted_at: recorded,
      issuer_status: 'APPROVED', compliance_status: 'APPROVED', technical_readiness_status: open ? 'VERIFIED' : 'NOT_VERIFIED',
      publishable: false, subscribable: open, can_review_issuer: false, can_review_compliance: false } }
}
function application(approved = true): PortalApplication {
  return { id: applicationId, user_id: actor, persona: 'INVESTOR', status: approved ? 'APPROVED' : 'SUBMITTED', revision: 2,
    details: { full_name: 'Fictional Investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
      source_of_funds: 'Fictional savings, not actual customer funds.', beneficial_owners: '', experience: 'Fictional investment experience.', documents: [], test_data_acknowledged: true },
    submitted_at: recorded, reviewed_at: approved ? recorded : null, reviewer_id: approved ? other : null, review_notes: null,
    organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: approved ? until : null }
}
function order(change: Partial<PortalSubscription> = {}): PortalSubscription {
  return { id: orderId, product_id: productId, investor_id: actor, product_name: product().terms.name, organisation_id: organisation,
    product_revision: 4, offering_revision_id: packageId, terms_hash: digest, investment_account_id: accountId,
    units: '100', amount_minor: '1000000000', currency: 'TST', status: 'AWAITING_FUNDING', created_at: recorded, ...change }
}
function fund(): FundProductLifecycle {
  return { product_id: productId, organisation_id: organisation, native_organisation_id: nativeOrganisation, product_revision: 4,
    offering_revision_id: packageId, class_id: id(11), product_name: product().terms.name, terms_hash: digest, configuration_hash: digest,
    availability: 'AVAILABLE', stages: fundStageKeys.map(key => ({ key, state: key === 'DEPLOYMENT' ? 'WAITING' : 'NOT_STARTED',
      label: key, description: 'Synthetic current stage, not chain evidence.', reason_code: null, owner_role: 'OfferingManager', evidence_ids: [] })),
    next_action: { action_id: 'fixture-deployment', command: null, record_id: productId, expected_revision: 4,
      label: 'Request fund deployment', reason_code: null, owner_role: 'OfferingManager', can_execute: false, payload: null },
    actions: [], operations: [], orders: [], holdings: [] }
}
function lifecycle(value = fund(), selectedContext = context): FundLifecycleSnapshot {
  return { schema_version: 1, projection_revision: 1, actor_id: actor, environment: 'TESTNET', operating_context: selectedContext,
    observed_at: recorded, availability: 'AVAILABLE', reason_code: null, products: [value], requests: [] }
}
function snapshot(approved = true, open = true): PortalSnapshot {
  const app = application(approved), item = product(open)
  return { actor: { id: actor, email: 'investor.journey@example.invalid', display_name: 'Fictional Investor', can_review: false },
    operating_context: context, applications: [app], organisations: [], products: [item], subscriptions: [], events: [], requests: [],
    accounts: approved ? [{ id: accountId, holder_user_id: actor, application_id: applicationId, kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: recorded }] : [],
    product_eligibility: approved ? [{ id: eligibilityId, investment_account_id: accountId, product_id: productId, organisation_id: organisation,
      product_revision: item.revision, offering_revision_id: packageId, terms_hash: digest, application_revision: app.revision, revision: 1,
      status: 'APPROVED', investor_statement: 'Fictional product objectives and test source of funds.', submitted_at: recorded, reviewed_at: recorded,
      reviewer_id: other, review_notes: null, review_checks: {}, approved_until: until, effective: true, can_decide: false, can_approve: false,
      can_revoke: false, holder_user_id: actor, product_name: item.terms.name, account_kind: 'INDIVIDUAL', investor_application: app }] : [],
    fund_lifecycle: lifecycle() }
}
function mountPage(value: PortalSnapshot, view: PortalPath = '/portal', selectedId?: string) {
  return render(<PortalScreen data={{ user: { id: value.actor.id, email: value.actor.email }, snapshot: value }} view={view}
    id={selectedId} operatingContext={value.operating_context} release={release} />)
}
function form(value: PortalSnapshot, onSaved = vi.fn(), selectedRelease = release) {
  return <PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment={selectedRelease.environment}>
    <SubscriptionForm product={value.products[0]} snapshot={value} onSaved={onSaved} operatingContext={value.operating_context} />
  </PortalCommandProvider>
}
function acceptTerms() {
  fireEvent.change(screen.getByLabelText(/^Whole units/), { target: { value: '100' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /I have read and accept the memorandum/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I have read the risk disclosures/ }))
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear()
  fetcher.mockReset(); wallet.request.mockReset()
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetcher)
  fetcher.mockImplementation(async () => json({ error: 'Synthetic transport has no response for this operation.' }, 503))
  wallet.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [payer]
    if (method === 'eth_chainId') return '0x13882'
    throw new Error(`Unexpected wallet request: ${method}`)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear() })

describe('one existing investor workspace', () => {
  it.each(['SUBMITTED', 'CHANGES_REQUIRED', 'APPROVED'] as const)('uses an exact submission version only for a %s review document', async status => {
    const value = snapshot(), app = application(false), documentId = id(80)
    const reviewerContext: PortalOperatingContext = { mode: 'ROLE', organisationId: nativeOrganisation, role: 'ComplianceOfficer' }
    app.status = status
    app.details.documents = [{ id: documentId, kind: 'IDENTITY', title: 'Fictional review evidence', size: 128,
      mime_type: 'image/png', sha256: digest, storage_path: `${actor}/${applicationId}/${documentId}` }]
    value.actor = { ...value.actor, id: other, can_review: true }; value.operating_context = reviewerContext; value.applications = [app]
    render(<PortalCommandProvider snapshot={value} operatingContext={reviewerContext} environment="TESTNET"><ApplicationReview
      application={app} snapshot={value} onSaved={vi.fn()} environment="TESTNET" /></PortalCommandProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'View document' }))
    const target = status === 'SUBMITTED' ? `/api/portal/documents?application_id=${applicationId}&revision=2&id=${documentId}` : `/api/portal/documents?id=${documentId}`
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url) === portalScopeHref(target, reviewerContext))).toBe(true))
    if (status === 'SUBMITTED') expect((screen.getByRole('checkbox', { name: 'Identity evidence reviewed' }) as HTMLInputElement).checked).toBe(false)
    else expect(screen.queryByRole('checkbox', { name: 'Identity evidence reviewed' })).toBeNull()
  })
  it('separates pending admission and no open offerings without deployment controls or a broken pre-opening link', () => {
    mountPage(snapshot(false, false))
    expect(screen.getByRole('heading', { name: 'Your investing workspace' })).toBeTruthy()
    expect(screen.getByText('Your investor application is under review')).toBeTruthy()
    expect(screen.getByText('No offerings are open for investment yet').tagName).toBe('STRONG')
    expect(screen.queryByRole('heading', { name: 'Your investment account' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your subscription orders' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Funds preparing to open' })).toBeTruthy()
    expect(screen.queryByText('Your fund handoffs')).toBeNull()
    expect(screen.queryByText('Request fund deployment')).toBeNull()
    expect(screen.getByRole('link', { name: 'View fund progress' }).getAttribute('href')).toBe(portalScopeHref('/portal/opportunities/detail', context, productId))
    expect(screen.queryByRole('button', { name: /reserve|buy|transfer.*MetaMask/i })).toBeNull()
    expect(screen.getByRole('link', { name: 'Browse investment opportunities' }).getAttribute('href')).toBe(portalScopeHref('/portal/opportunities', context))
    expect(screen.getByRole('link', { name: 'View my orders and holdings' }).getAttribute('href')).toBe(portalScopeHref('/portal/portfolio', context))
    expect(screen.getByText('No pending amount')).toBeTruthy()
    expect(screen.queryByText('R0.00 test')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled(); expect(wallet.request).not.toHaveBeenCalled()
  })
  it('keeps the same dependency-not-admitted fund discoverable from home and opportunities to a private progress-only detail', () => {
    const value = snapshot(true, false), progress = fund()
    value.products = []
    progress.availability = 'DEPENDENCY_NOT_ADMITTED'
    progress.stages.find(stage => stage.key === 'APPROVAL')!.state = 'COMPLETE'
    progress.stages[0] = { ...progress.stages[0], label: 'PRIVATE OPERATOR STAGE', description: 'PRIVATE GOVERNANCE CONFIGURATION', evidence_ids: [id(70)] }
    progress.actions = [{ ...progress.next_action!, label: 'PRIVATE OPERATOR ACTION', can_execute: true }]
    value.fund_lifecycle = lifecycle(progress)
    let page = mountPage(value)
    const target = portalScopeHref('/portal/opportunities/detail', context, productId)
    expect(screen.getByRole('link', { name: 'View fund progress' }).getAttribute('href')).toBe(target)
    page.unmount(); page = mountPage(value, '/portal/opportunities')
    expect(screen.getByRole('link', { name: 'View fund progress' }).getAttribute('href')).toBe(target)
    expect(screen.getByText(progress.product_name)).toBeTruthy()
    page.unmount(); page = mountPage(value, '/portal/opportunities/detail', productId)
    expect(screen.getByRole('heading', { name: progress.product_name, level: 1 })).toBeTruthy()
    expect(screen.getByText('Preparing to open')).toBeTruthy()
    expect(screen.getByText('Blockchain setup is still in progress. This fund is not open for investment.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to investment opportunities' }).getAttribute('href')).toBe(portalScopeHref('/portal/opportunities', context))
    expect(screen.getByRole('link', { name: 'View my orders and holdings' }).getAttribute('href')).toBe(portalScopeHref('/portal/portfolio', context))
    for (const hidden of ['PRIVATE OPERATOR STAGE', 'PRIVATE GOVERNANCE CONFIGURATION', 'PRIVATE OPERATOR ACTION', id(70), digest, packageId]) expect(page.container.textContent).not.toContain(hidden)
    expect(screen.queryByRole('heading', { name: 'Offering terms' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Choose your investment' })).toBeNull()
    expect(screen.queryByRole('button', { name: /buy|reserve|pay|deploy|approve/i })).toBeNull()
    expect(fetcher).not.toHaveBeenCalled(); expect(wallet.request).not.toHaveBeenCalled()
  })
  it('never exposes accidentally supplied unpublished terms or disclosures through the progress route', () => {
    const value = snapshot(true, false)
    value.products[0].terms.summary = 'PRIVATE UNPUBLISHED SUMMARY'
    value.products[0].terms.documents.memorandum = 'PRIVATE UNPUBLISHED MEMORANDUM'
    const page = mountPage(value, '/portal/opportunities/detail', productId)
    expect(screen.getByText('Preparing to open')).toBeTruthy()
    expect(page.container.textContent).not.toContain('PRIVATE UNPUBLISHED')
    expect(screen.queryByRole('heading', { name: 'Offering documents' })).toBeNull()
    expect(screen.queryByLabelText(/^Whole units/)).toBeNull()
    expect(screen.queryByRole('button', { name: /buy|reserve|pay/i })).toBeNull()
    expect(fetcher).not.toHaveBeenCalled(); expect(wallet.request).not.toHaveBeenCalled()
  })
  it.each(['missing', 'unavailable', 'actor', 'environment', 'context', 'role', 'applicant', 'unknown fund', 'duplicate fund'] as const)('does not create a fund preview from %s lifecycle data', failure => {
    const value = snapshot(true, false)
    value.products = []
    if (failure === 'missing') delete value.fund_lifecycle
    else if (failure === 'unavailable') value.fund_lifecycle!.availability = 'UNAVAILABLE'
    else if (failure === 'actor') value.fund_lifecycle!.actor_id = other
    else if (failure === 'environment') value.fund_lifecycle!.environment = 'MAINNET'
    else if (failure === 'context') value.fund_lifecycle!.operating_context = { ...context, organisationId: other }
    else if (failure === 'role') {
      const otherRole: PortalOperatingContext = { mode: 'ROLE', organisationId: nativeOrganisation, role: 'ComplianceOfficer' }
      value.operating_context = otherRole; value.fund_lifecycle!.operating_context = otherRole
    } else if (failure === 'applicant') {
      value.operating_context = { mode: 'APPLICANT' }; value.fund_lifecycle!.operating_context = { mode: 'APPLICANT' }
    } else if (failure === 'unknown fund') value.fund_lifecycle!.products[0].product_id = other
    else value.fund_lifecycle!.products.push({ ...value.fund_lifecycle!.products[0] })
    mountPage(value, '/portal/opportunities/detail', productId)
    expect(screen.queryByText('Preparing to open')).toBeNull()
    expect(screen.queryByRole('link', { name: 'View fund progress' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Choose your investment' })).toBeNull()
    expect(screen.queryByRole('button', { name: /buy|reserve|pay/i })).toBeNull()
    expect(fetcher).not.toHaveBeenCalled(); expect(wallet.request).not.toHaveBeenCalled()
  })
  it.each(['current approval', 'saved account', 'saved order', 'foreign account'] as const)('keeps only relevant home panels for %s', state => {
    const value = snapshot(false, false)
    if (state === 'current approval') value.applications = [application()]
    if (state === 'saved account' || state === 'foreign account') value.accounts = [{ id: accountId, holder_user_id: state === 'saved account' ? actor : other,
      application_id: applicationId, kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: recorded }]
    if (state === 'saved order') value.subscriptions = [order()]
    mountPage(value)
    expect(Boolean(screen.queryByRole('heading', { name: 'Your investment account' }))).toBe(state === 'current approval' || state === 'saved account')
    expect(Boolean(screen.queryByRole('heading', { name: 'Your subscription orders' }))).toBe(state === 'saved order')
    if (state === 'current approval') expect(screen.getByRole('button', { name: 'Open individual investment account' })).toBeTruthy()
    else expect(screen.queryByRole('button', { name: 'Open individual investment account' })).toBeNull()
    if (state === 'saved order') expect(screen.getByRole('link', { name: 'Open funding record' }).getAttribute('href')).toBe(portalScopeHref('/portal/orders/detail', context, orderId))
    expect(fetcher).not.toHaveBeenCalled(); expect(wallet.request).not.toHaveBeenCalled()
  })
  it('retains the account and empty-order explanations on the separate portfolio page', () => {
    mountPage(snapshot(false, false), '/portal/portfolio')
    expect(screen.getByRole('heading', { name: 'Your investment account' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your subscription orders' })).toBeTruthy()
    expect(screen.getByText('No subscription orders yet')).toBeTruthy()
    expect(screen.getByText('Reservations are not holdings')).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled(); expect(wallet.request).not.toHaveBeenCalled()
  })
  it('shows unavailable fund records as unavailable rather than an empty portfolio', () => {
    const value = snapshot(); delete value.fund_lifecycle
    mountPage(value)
    expect(screen.getByText('Fund payment and holdings status unavailable')).toBeTruthy()
    expect(screen.queryByText('No reconciled holdings are recorded')).toBeNull()
  })
  it.each(['expired', 'unverified'] as const)('separately explains %s admission and no open offerings', state => {
    const value = snapshot(true, false)
    value.applications[0].approved_until = state === 'expired' ? '2020-01-01T00:00:00Z' : null
    mountPage(value, '/portal/opportunities')
    expect(screen.getByText(state === 'expired' ? 'Your investor approval has expired' : 'Investor approval could not be verified')).toBeTruthy()
    expect(screen.getByText('No offerings are open for investment yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /reserve|buy/i })).toBeNull()
  })
  it('does not invent customer account records from a limited lifecycle projection', () => {
    const value = snapshot(); value.base_records_available = false
    mountPage(value)
    expect(screen.getByText('Investor account records are unavailable')).toBeTruthy()
    expect(screen.queryByText('Your investing workspace')).toBeNull()
  })
  it('keeps separate asset totals without adding TST to rand', () => {
    const value = snapshot(); value.subscriptions = [order({ amount_minor: '10000000', units: '1' }), order({ id: id(50), currency: 'ZAR_TEST', amount_minor: '2000', units: '1' })]
    mountPage(value)
    const statistic = screen.getByText('Requested subscription amount').closest('article') ?? screen.getByText('Requested subscription amount').parentElement!
    expect(statistic.textContent).toContain('10.000000 TST · R20.00 test')
    expect(statistic.textContent).not.toContain('100,020')
  })
  it('does not infer a currency for an order with no denomination', () => {
    const value = snapshot(); value.subscriptions = [order({ currency: undefined })]
    mountPage(value)
    expect(screen.getByText('Currency unavailable; inspect each order')).toBeTruthy()
  })
  it('opens the exact published offering and puts investment before operator evidence', () => {
    const value = snapshot(), page = mountPage(value, '/portal/opportunities')
    expect(screen.getByRole('link', { name: /View opportunity/ }).getAttribute('href')).toBe(portalScopeHref('/portal/opportunities/detail', context, productId))
    page.unmount(); mountPage(value, '/portal/opportunities/detail', productId)
    expect(screen.getByRole('heading', { name: 'Choose your investment' })).toBeTruthy()
    expect(screen.queryByText('Fund operating record')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Contract and issuance evidence' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View offering verification details' })).toBeTruthy()
    acceptTerms()
    expect(screen.getByText('1,000.000000 TST')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept terms and reserve units' }).closest('fieldset')?.disabled).toBe(false)
    expect(wallet.request).not.toHaveBeenCalled()
  })
  it.each(['technical', 'issuer', 'compliance'] as const)('does not advertise a PUBLISHED label with missing %s approval', missing => {
    const value = snapshot(), pkg = value.products[0].offering_package!
    if (missing === 'technical') pkg.technical_readiness_status = 'NOT_VERIFIED'
    if (missing === 'issuer') pkg.issuer_status = 'PENDING'
    if (missing === 'compliance') pkg.compliance_status = 'PENDING'
    mountPage(value, '/portal/opportunities')
    expect(screen.getByText('No offerings are open for investment yet')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /View opportunity/ })).toBeNull()
  })
  it.each(['account', 'eligibility'] as const)('does not reserve without current %s', missing => {
    const value = snapshot()
    if (missing === 'account') value.accounts = []
    else value.product_eligibility = []
    render(form(value))
    expect(screen.queryByRole('button', { name: 'Accept terms and reserve units' })).toBeNull()
    expect(screen.getByText(missing === 'account' ? 'An active individual investment account is required' : 'Product eligibility review required')).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('canonical reservation continuation, never a guessed order', () => {
  function respond(value: PortalSnapshot, subscriptions: PortalSubscription[], withReceipt = true) {
    fetcher.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      expect(request.command).toBe('subscribe'); expect(request.payload.units).toBe('100')
      expect(request.payload.amount_minor).toBeUndefined()
      return json({ snapshot: { ...value, subscriptions, requests: withReceipt ? [{ key: request.key, command: request.command }] : [] } })
    })
  }
  it('links exactly one newly returned owned order only after the canonical response', async () => {
    const value = snapshot(), onSaved = vi.fn(); respond(value, [order()])
    render(form(value, onSaved)); acceptTerms(); fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    const link = await screen.findByRole('link', { name: 'Continue with this order' })
    expect(link.getAttribute('href')).toBe(portalScopeHref('/portal/orders/detail', context, orderId))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Accept terms and reserve units' })).toBeNull()
    expect(sessionStorage.length).toBe(0); expect(wallet.request).not.toHaveBeenCalled()
  })
  it.each(['duplicate', 'missing', 'old', 'no receipt', 'foreign holder', 'wrong account', 'wrong package', 'wrong terms', 'wrong units', 'wrong amount', 'wrong currency', 'stale revision'] as const)('withholds an exact order link for %s', async mode => {
    const value = snapshot(); let rows = [order()]
    if (mode === 'duplicate') rows.push(order({ id: id(51) }))
    if (mode === 'missing') rows = []
    if (mode === 'old') value.subscriptions = [order()]
    if (mode === 'foreign holder') rows = [order({ investor_id: other })]
    if (mode === 'wrong account') rows = [order({ investment_account_id: id(52) })]
    if (mode === 'wrong package') rows = [order({ offering_revision_id: id(53) })]
    if (mode === 'wrong terms') rows = [order({ terms_hash: 'cd'.repeat(32) })]
    if (mode === 'wrong units') rows = [order({ units: '99' })]
    if (mode === 'wrong amount') rows = [order({ amount_minor: '999999999' })]
    if (mode === 'wrong currency') rows = [order({ currency: 'ZAR_TEST' })]
    if (mode === 'stale revision') rows = [order({ product_revision: 3 })]
    respond(value, rows, mode !== 'no receipt')
    render(form(value)); acceptTerms(); fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    await screen.findByText('Check your saved orders')
    expect(screen.queryByRole('link', { name: 'Continue with this order' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept terms and reserve units' })).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1); expect(wallet.request).not.toHaveBeenCalled()
  })
  it('retains the original unresolved request key and only offers the order after its confirmed retry', async () => {
    const value = snapshot(); fetcher.mockRejectedValueOnce(new Error('Synthetic interrupted transport.'))
    render(form(value)); acceptTerms(); fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    await screen.findByRole('button', { name: 'Retry the original saved request' })
    const first = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(screen.queryByRole('link', { name: 'Continue with this order' })).toBeNull(); expect(sessionStorage.length).toBe(1)
    respond(value, [order()]); fireEvent.click(screen.getByRole('button', { name: 'Retry the original saved request' }))
    await screen.findByRole('link', { name: 'Continue with this order' })
    const second = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(second.key).toBe(first.key); expect(second.payload).toEqual(first.payload)
    expect(fetcher).toHaveBeenCalledTimes(2); expect(sessionStorage.length).toBe(0)
  })
  it('does not reopen reservation after a genuine save when the same offering revision advances in flight', async () => {
    const value = snapshot(); let finish!: (response: Response) => void
    fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const onSaved = vi.fn(), page = render(form(value, onSaved)); acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    const updated = snapshot()
    updated.products[0].revision = 5
    updated.product_eligibility![0].product_revision = 5
    page.rerender(form(updated, onSaved))
    await act(async () => { finish(json({ snapshot: { ...value, subscriptions: [order()], requests: [{ key: request.key, command: 'subscribe' }] } })); await Promise.resolve() })
    await screen.findByText('Check your saved orders')
    expect(screen.queryByRole('button', { name: 'Accept terms and reserve units' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Continue with this order' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View my subscription orders' }).getAttribute('href')).toBe(portalScopeHref('/portal/portfolio', context))
    expect(onSaved).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
    expect(fetcher).toHaveBeenCalledTimes(1); expect(wallet.request).not.toHaveBeenCalled()
  })
  it.each(['actor', 'context', 'environment', 'A to B to A'] as const)('does not borrow a late result across %s', async change => {
    const value = snapshot(); let finish!: (response: Response) => void
    fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const onSaved = vi.fn(), page = render(form(value, onSaved)); acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    const changed = snapshot(); let selectedRelease = release
    if (change === 'actor') changed.actor = { ...changed.actor, id: other }
    if (change === 'context' || change === 'A to B to A') changed.operating_context = { mode: 'ROLE', role: 'Investor', organisationId: id(60) }
    if (change === 'environment') selectedRelease = { ...release, environment: 'MAINNET' }
    page.rerender(form(changed, onSaved, selectedRelease))
    if (change === 'A to B to A') page.rerender(form(value, onSaved))
    await act(async () => { finish(json({ snapshot: { ...value, subscriptions: [order()], requests: [{ key: request.key, command: 'subscribe' }] } })); await Promise.resolve() })
    expect(screen.queryByRole('link', { name: 'Continue with this order' })).toBeNull()
    expect(onSaved).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(1)
  })
})

describe('same order: approved payment and actual returned holdings', () => {
  function ordered(approved: boolean, posted = false) {
    const value = fund()
    value.orders = [{ subscription_id: orderId, product_id: productId, investment_account_id: accountId, allocation_id: null,
      allocation_revision: null, units_base: '100', security_unit_decimals: 0, delivery_wallet: null, issuance_operation_id: null, actions: [],
      payment_allocation_basis: { id: id(70), revision: approved ? 2 : 1, basis_hash: digest, status: approved ? 'APPROVED' : 'REQUESTED',
        current: approved, approved_at: approved ? recorded : null, approved_until: approved ? until : null, units_base: '100', amount_base_units: '1000000000' },
      funding: { obligation_id: id(71), obligation_revision: 1, route_id: id(72), route_revision: 1, currency: 'TST', settlement_decimals: 6,
        chain_id: 80002, settlement_token_address: token, beneficiary_address: beneficiary, required_base_units: '1000000000',
        verified_base_units: posted ? '1000000000' : '0', posted_base_units: posted ? '1000000000' : '0', evidence_set_hash: digest,
        state: posted ? 'RECONCILED' : 'AWAITING_FUNDING', can_pay: approved && !posted } }]
    return value
  }
  function mountOrder(value: FundProductLifecycle) {
    const records = snapshot(); records.fund_lifecycle = lifecycle(value)
    return render(<PortalCommandProvider snapshot={records} operatingContext={context} environment="TESTNET"><FundLifecycleOrder
      lifecycle={value} subscriptionId={orderId} actorId={actor} operatingContext={context} onRefresh={vi.fn()} /></PortalCommandProvider>)
  }
  it('does not offer a payment before issuer approval and does not link an unopened offering', () => {
    mountOrder(ordered(false))
    expect(screen.getByText(/Payment instructions remain unavailable until/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review the exact TST payment' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Browse open offerings' }).getAttribute('href')).toBe(portalScopeHref('/portal/opportunities', context))
    expect(screen.queryByRole('link', { name: 'View fund progress' })).toBeNull()
    expect(wallet.request).not.toHaveBeenCalled()
  })
  it('reviews the exact server-bound amount and requires a separate explicit MetaMask transfer', async () => {
    const value = ordered(true)
    fetcher.mockImplementation(async url => String(url) === '/api/portal/fund-lifecycle/payment' ? json({ intent: {
      payment_id: id(73), subscription_id: orderId, obligation_id: id(71), obligation_revision: 1, route_id: id(72), route_revision: 1,
      actor_id: actor, payer_address: payer, chain_id: 80002, token_address: token, beneficiary_address: beneficiary,
      amount_base_units: '1000000000', decimals: 6, currency: 'TST', state: 'PREPARED', transaction_hash: null, expires_at: until,
      data: new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [beneficiary, 1000000000n]),
    } }) : json({ error: 'Synthetic wallet-context read unavailable.' }, 503))
    mountOrder(value)
    const connect = await screen.findByRole('button', { name: 'Connect MetaMask on chain 80002' })
    await waitFor(() => expect(connect.hasAttribute('disabled')).toBe(false))
    fireEvent.click(connect)
    await screen.findByText('MetaMask is connected. No signature or transaction has been requested.')
    fireEvent.click(screen.getByRole('button', { name: 'Review the exact TST payment' }))
    await screen.findByRole('heading', { name: 'Review this test-token transfer' })
    expect(screen.getByRole('button', { name: 'Transfer the approved TST amount in MetaMask' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByText('1,000 TST').length).toBeGreaterThan(0)
    expect(wallet.request.mock.calls.some(([request]) => ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4'].includes(request.method))).toBe(false)
  })
  it('retains an UNKNOWN original payment reference without offering a replacement send', () => {
    localStorage.setItem(`bx1-fund:${actor}:${nativeOrganisation}:Investor:payment:${orderId}`, JSON.stringify({ intentId: id(73), hash: null, unknown: true }))
    mountOrder(ordered(true))
    expect(screen.getByText('Use the existing payment; do not pay again')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review the exact TST payment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Transfer the approved TST amount in MetaMask' })).toBeNull()
    expect(wallet.request).not.toHaveBeenCalled()
  })
  it('does not manufacture holdings from reconciled payment or a final operation without the returned register projection', () => {
    const value = ordered(true, true)
    value.operations = [{ id: id(74), product_id: productId, offering_revision_id: packageId, subscription_id: orderId, allocation_id: id(75),
      revision: 3, kind: 'ISSUANCE', state: 'FINAL', chain_id: 80002, transaction_hash: `0x${'44'.repeat(32)}`, token_address: token,
      controller_address: beneficiary, manifest_id: id(76), manifest_hash: digest, intent_hash: digest, expires_at: until,
      confirmations: 64, required_confirmations: 64, reason_code: null, intent: null, actions: [] }]
    const page = render(<FundLifecyclePortfolio snapshot={lifecycle(value)} operatingContext={context} />)
    expect(screen.getByText('No reconciled holdings are recorded')).toBeTruthy()
    value.holdings = [{ id: id(77), product_id: productId, investment_account_id: accountId, subscription_id: orderId, register_entry_id: id(78),
      issuance_operation_id: id(74), product_name: product().terms.name, class_name: 'Fictional primary class', units_base: '100', security_unit_decimals: 0,
      token_address: token, wallet_address: payer, chain_id: 80002, transaction_hash: `0x${'44'.repeat(32)}`, recorded_at: recorded, state: 'RECONCILED', valuation: null }]
    page.rerender(<FundLifecyclePortfolio snapshot={lifecycle(value)} operatingContext={context} />)
    expect(screen.queryByText('No reconciled holdings are recorded')).toBeNull()
    expect(screen.getByText('100 units')).toBeTruthy()
    expect(screen.getByText('No reviewed valuation recorded')).toBeTruthy()
    expect(screen.queryByText(/growth|return earned/i)).toBeNull()
  })
})
