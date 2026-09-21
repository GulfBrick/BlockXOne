'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, Layers3, Plus } from 'lucide-react'
import type { PortalCapability, PortalOrganisation, PortalPageData, PortalPath, PortalProduct, PortalSnapshot, PortalSubscription } from '@/lib/portal/contracts'
import type { PlatformRelease } from '@/lib/platform-release'
import type { DashboardScope } from '@/lib/portal/dashboard'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import { APPLICANT_CONTEXT, portalContextKey, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { OnboardingForm } from './onboarding-form'
import { PortalCommandProvider } from './portal-client'
import { ProductForm } from './product-form'
import { PortalShell, type PortalNavigationKey } from './portal-shell'
import { DetailList, EmptyState, Notice, Panel, Statistic, StatusBadge, dateLabel, money } from './portal-primitives'
import { ApplicationReview, InvestmentAccountPanel, OfferingDocuments, ProductActions, ProductFacts, ProductNarrative, ProductReview, SubscriptionCancel, SubscriptionForm, currentInvestorApplication } from './portal-workflows'
import { FundingOrderDetail, FundingWorkspace } from './funding-workflows'
import styles from './portal.module.css'

export function productManagementOrganisations(snapshot: PortalSnapshot, context?: PortalOperatingContext) {
  if (context?.mode === 'ROLE' && !['IssuerFundManager', 'OfferingManager'].includes(context.role)) return []
  return snapshot.organisations.filter(org => org.status === 'ACTIVE'
    && org.roles.some(role => ['IssuerFundManager', 'OfferingManager'].includes(role))
    && (!context || (context.mode === 'APPLICANT' ? org.authority_source === 'LEGACY_OWNER'
      : org.authority_source === 'NATIVE_BINDING' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role))))
}

function permits(org: PortalOrganisation, command: PortalCapability, context?: PortalOperatingContext): boolean {
  return org.capabilities?.includes(command) ?? !context
}

function ProductCard({ product, operatingContext }: { product: PortalProduct; operatingContext?: PortalOperatingContext }) {
  return <article className={styles.productCard}>
    <div className={styles.productVisual} data-kind={product.terms.asset_type}>{product.terms.asset_type === 'FUND' ? <Layers3 aria-hidden="true" /> : <Building2 aria-hidden="true" />}<p>{product.terms.asset_type === 'FUND' ? 'Investment fund' : 'Real-estate investment'} · Fictional product</p></div>
    <div className={styles.productCardBody}><h2>{product.terms.name}</h2><p>{product.terms.summary}</p>
      <DetailList rows={[{ label: 'Unit price', value: money(product.terms.unit_price_minor) }, { label: 'Minimum investment', value: money((BigInt(product.terms.minimum_units) * BigInt(product.terms.unit_price_minor)).toString()) }, { label: 'Share class', value: product.terms.share_class }]} />
      <div className={styles.productCardFoot}><StatusBadge status={product.status} /><Link href={portalScopeHref('/portal/opportunities/detail', operatingContext, product.id)} className={styles.textLink}>View opportunity <span aria-hidden="true">↗</span></Link></div>
    </div>
  </article>
}

function ProductRegister({ products, canCreate, operatingContext }: { products: PortalProduct[]; canCreate: boolean; operatingContext?: PortalOperatingContext }) {
  return <Panel title="Product register" description="Fund and real-estate offerings use the same product, review and order records." action={canCreate ? <Link href={portalScopeHref('/portal/products/new', operatingContext)} className={styles.button}><Plus aria-hidden="true" />Create a product</Link> : undefined} flush>
    {products.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Product</th><th scope="col">Template</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Workspace</th></tr></thead>
      <tbody>{products.map(product => <tr key={product.id}><td><strong>{product.terms.name}</strong><small>{product.terms.issuer_name}</small></td><td>{product.terms.asset_type === 'FUND' ? 'Fund' : 'Real estate'}</td><td>Revision {product.revision}</td><td><StatusBadge status={product.status} /></td><td><Link href={portalScopeHref('/portal/products/detail', operatingContext, product.id)}>Open product</Link></td></tr>)}</tbody>
    </table></div> : <EmptyState title={canCreate ? 'Build your first offering' : 'No products in this operating scope'} description={canCreate ? 'Start with the fund or real-estate template. The draft remains private until its exact terms have been independently reviewed and published.' : 'Only products covered by the current organisation and acting role appear here. No access is inferred from a similar organisation name.'} href={canCreate ? portalScopeHref('/portal/products/new', operatingContext) : undefined} action={canCreate ? 'Create a product' : undefined} />}
  </Panel>
}

export function SubscriptionOrders({ subscriptions, products, incoming, onSaved, operatingContext, funding }: {
  subscriptions: PortalSubscription[]; products: PortalProduct[]; incoming: boolean; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext;
  funding?: PortalSnapshot['funding'];
}) {
  return <Panel title={incoming ? 'Incoming subscription orders' : 'Your subscription orders'} description="The investor and authorised issuer see the same saved order reference, accepted version and funding state." flush>
    {subscriptions.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Product</th><th scope="col">Order reference</th><th scope="col">Investment account</th><th scope="col">Units</th><th scope="col">Instruction value</th><th scope="col">Status</th><th scope="col">Next action</th></tr></thead><tbody>
      {subscriptions.map(subscription => {
        const product = products.find(item => item.id === subscription.product_id)
        const obligation = funding?.obligations.find(item => item.subscription_id === subscription.id)
        return <tr key={subscription.id}><td><strong>{subscription.product_name}</strong>{product ? <small>{product.terms.asset_type === 'FUND' ? 'Fund' : 'Real estate'}</small> : null}</td>
          <td><span className={styles.mono}>{subscription.id}</span><small>Terms revision {subscription.product_revision} · {dateLabel(subscription.created_at)}</small><details><summary className={styles.textLink}>Accepted terms fingerprint</summary><p className={styles.mono}>{subscription.terms_hash}</p></details></td>
          <td>{subscription.investment_account_id ? <span className={styles.mono}>{subscription.investment_account_id}</span> : <span className={styles.muted}>Legacy instruction · account not linked</span>}</td>
          <td>{subscription.units}</td><td>{money(subscription.amount_minor)}</td><td><StatusBadge status={obligation && subscription.status === 'AWAITING_FUNDING' ? 'RESERVED' : subscription.status} />{obligation ? <div className={styles.sectionGap}><StatusBadge status={obligation.state} /><small>Funding state · not issued ownership</small></div> : null}</td>
          <td><div className={styles.stack}><Link href={portalScopeHref('/portal/orders/detail', operatingContext, subscription.id)}>Open funding record</Link>{incoming && product ? <Link href={portalScopeHref('/portal/products/detail', operatingContext, product.id)}>Open product and order book</Link> : null}
            {!funding ? <span className={styles.muted}>Funding records unavailable. Do not send funds or infer settlement.</span> : !obligation ? <span className={styles.muted}>No funding obligation has been opened. This reservation is not payment or issuance.</span> : null}
            {!incoming && subscription.status === 'AWAITING_FUNDING' ? <SubscriptionCancel id={subscription.id} onSaved={onSaved} canCancel={subscription.can_cancel === true} /> : subscription.status === 'CANCELLED' ? <span className={styles.muted}>Reservation cancelled; inspect the funding record for any unresolved payment evidence.</span> : null}
          </div></td>
        </tr>
      })}
    </tbody></table></div> : <EmptyState title={incoming ? 'No incoming orders in this scope' : 'No subscription orders yet'} description={incoming ? 'An eligible investor’s saved subscription appears here against the same published product. A product draft or reservation count is not a received payment.' : 'Accept a published offering’s exact terms from your active investment account. The saved instruction will appear here and in the authorised issuer’s order book.'} href={incoming ? undefined : portalScopeHref('/portal/opportunities', operatingContext)} action={incoming ? undefined : 'Explore opportunities'} />}
  </Panel>
}

function Opportunities({ products, snapshot, operatingContext }: { products: PortalProduct[]; snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext }) {
  return <div className={styles.stack}>
    <Notice title="Read before you subscribe">Only published offerings available to your account are displayed. Current investor approval, an active investment account and matching eligibility are checked before a subscription. No returns or liquidity are guaranteed.</Notice>
    {products.length ? <div className={styles.productGrid}>{products.map(product => <ProductCard key={product.id} product={product} operatingContext={operatingContext} />)}</div>
      : <Panel title="Published opportunities"><EmptyState title={currentInvestorApplication(snapshot) ? 'No published offerings are available to your account' : 'Prepare your investor access'} description={currentInvestorApplication(snapshot) ? 'An authorised issuer must obtain an independent review and publish an eligible offering before it appears here.' : 'Complete your investor application and obtain a current independent approval. Product country and investor-classification rules still apply.'} href={portalScopeHref('/portal/onboarding', operatingContext)} action="Open my investor onboarding" /></Panel>}
  </div>
}

function ComplianceQueue({ snapshot, operatingContext }: { snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext }) {
  const applications = snapshot.applications.filter(item => item.status === 'SUBMITTED')
  const products = snapshot.products.filter(item => item.status === 'IN_REVIEW')
  return <div className={styles.stack}>
    <div className={styles.statGrid}><Statistic label="Client applications" value={applications.length} hint="Submitted evidence packages in this review scope" /><Statistic label="Offering reviews" value={products.length} hint="Exact product revisions awaiting a decision" /><Statistic label="Review provider" value="Manual" hint="Rehearsal evidence review · no live KYC-provider claim" /></div>
    <Panel title="Compliance work queue" description="Open a saved case, review its evidence and record an independent decision." flush>
      {applications.length || products.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Case</th><th scope="col">Review type</th><th scope="col">Version</th><th scope="col">Independence</th><th scope="col">Action</th></tr></thead><tbody>
        {applications.map(application => <tr key={application.id}><td><strong>{application.details.full_name}</strong><small>Submitted {dateLabel(application.submitted_at)}</small></td><td>{application.persona === 'INVESTOR' ? 'Investor onboarding' : 'Wealth-manager onboarding'}</td><td>{application.revision}</td><td>{application.user_id === snapshot.actor.id ? 'Another reviewer required' : 'Backend rechecks independent authority'}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, application.id)}>Review case</Link></td></tr>)}
        {products.map(product => <tr key={product.id}><td><strong>{product.terms.name}</strong><small>{product.terms.asset_type === 'FUND' ? 'Fund' : 'Real estate'} · {product.terms.issuer_name}</small></td><td>Offering review</td><td>{product.revision}</td><td>{product.created_by === snapshot.actor.id ? 'Another reviewer required' : 'Backend rechecks independent authority'}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, product.id)}>Review offering</Link></td></tr>)}
      </tbody></table></div> : <EmptyState title="No cases are waiting for review" description="Submitted client applications and product disclosures appear here within your appointed review scope. Nothing is approved automatically." />}
    </Panel>
  </div>
}

function RoleHelp({ operatingContext }: { operatingContext?: PortalOperatingContext }) {
  const role = operatingContext?.mode === 'ROLE' ? getRoleDashboard(operatingContext.role) : undefined
  if (!role) return null
  return <details className={styles.panel}><summary className={styles.panelHeader}>Role, hand-offs and signing guidance</summary><div className={styles.panelBody}><h2>{role.title}</h2><p className={styles.copy}>{role.description}</p><ul>{role.responsibilities.map(item => <li key={item}>{item}</li>)}</ul><h3>Working with other roles</h3><ul>{role.handoffs.map(item => <li key={item}>{item}</li>)}</ul><h3>Wallet and signing</h3><p className={styles.copy}>{role.walletGuidance}</p><h3>Authority boundary</h3><p className={styles.copy}>{role.authorityBoundary}</p></div></details>
}

const PAGE: Record<PortalPath, { title: string; eyebrow: string; description: string; active: PortalNavigationKey }> = {
  '/portal': { title: 'Your investment workspace.', eyebrow: 'Welcome to BlockXOne', description: 'Work with your saved accounts, offerings and subscription orders.', active: 'overview' },
  '/portal/onboarding': { title: 'Start with your identity.', eyebrow: 'Client onboarding', description: 'Apply as an investor or wealth manager. Your information, evidence and review decision stay connected.', active: 'onboarding' },
  '/portal/products': { title: 'Products & offerings.', eyebrow: 'Product management', description: 'Structure fund and real-estate offerings and follow their saved subscription orders.', active: 'products' },
  '/portal/products/new': { title: 'Structure a new product.', eyebrow: 'Product management / new product', description: 'Define the issuer, asset, economics and investor disclosures before submitting a single version for review.', active: 'products' },
  '/portal/products/detail': { title: 'Product workspace.', eyebrow: 'Product management / offering', description: 'One product record connects terms, independent review, publication and incoming orders.', active: 'products' },
  '/portal/compliance': { title: 'Review with context.', eyebrow: 'Compliance work queue', description: 'Review saved applicant evidence and offering terms within your appointed scope.', active: 'compliance' },
  '/portal/compliance/detail': { title: 'Review case.', eyebrow: 'Compliance / case review', description: 'Read the source evidence and record a reasoned decision against the current revision.', active: 'compliance' },
  '/portal/opportunities': { title: 'Explore investment opportunities.', eyebrow: 'Investor marketplace', description: 'Read published product terms and disclosures before submitting a subscription instruction.', active: 'opportunities' },
  '/portal/opportunities/detail': { title: 'Investment opportunity.', eyebrow: 'Investor marketplace / offering', description: 'Review the mandate, unit economics, eligibility rules and exact offering documents.', active: 'opportunities' },
  '/portal/portfolio': { title: 'Your investment instructions.', eyebrow: 'Investment account / orders', description: 'Track the same subscription orders seen by the authorised issuer. Reserved units are not funded ownership.', active: 'portfolio' },
  '/portal/orders/detail': { title: 'Subscription funding record.', eyebrow: 'Subscription / funding and reconciliation', description: 'Follow the same accepted order through funding instructions, verified evidence and independent accounting.', active: 'overview' },
}

type PortalScreenProps = { data: PortalPageData; view: PortalPath; id?: string; operatingContext?: PortalOperatingContext; release?: PlatformRelease; scope?: DashboardScope; scopes?: DashboardScope[] }

export function PortalScreen(props: PortalScreenProps) {
  // A role/organisation change must not retain another context's client snapshot.
  return <OperatingPortalScreen key={`${props.data.user.id}:${props.release?.environment ?? 'UNSPECIFIED'}:${portalContextKey(props.operatingContext ?? APPLICANT_CONTEXT)}:${props.view}:${props.id ?? ''}`} {...props} />
}

function OperatingPortalScreen({ data, view, id, operatingContext, release, scope, scopes }: PortalScreenProps) {
  const [snapshot, setSnapshot] = useState(data.snapshot)
  const organisations = productManagementOrganisations(snapshot, operatingContext)
  const createOrganisations = organisations.filter(org => permits(org, 'create_product', operatingContext))
  const canReview = snapshot.actor.can_review && (!operatingContext || (operatingContext.mode === 'ROLE' && operatingContext.role === 'ComplianceOfficer'))
  const canInvest = !operatingContext || operatingContext.mode === 'APPLICANT' || operatingContext.role === 'Investor'
  const capabilities = { manageProducts: organisations.length > 0, reviewCompliance: canReview, invest: canInvest }
  const role = operatingContext?.mode === 'ROLE' ? operatingContext.role : undefined
  const ownApplications = snapshot.applications.filter(item => item.user_id === snapshot.actor.id)
  const ownSubscriptions = snapshot.subscriptions.filter(item => item.investor_id === snapshot.actor.id)
  const managedProducts = snapshot.products.filter(product => organisations.some(org => org.id === product.organisation_id))
  const orderOrganisations = organisations.filter(org => permits(org, 'read_orders', operatingContext))
  const incomingSubscriptions = snapshot.subscriptions.filter(item => orderOrganisations.some(org => org.id === item.organisation_id) && managedProducts.some(product => product.id === item.product_id))
  const published = snapshot.products.filter(product => product.status === 'PUBLISHED')
  const detailProducts = view === '/portal/products/detail' ? managedProducts : view === '/portal/opportunities/detail' ? published : canReview ? snapshot.products : []
  const selected = id ? detailProducts.find(product => product.id === id) : undefined
  const selectedApplication = id && canReview ? snapshot.applications.find(application => application.id === id) : undefined
  const reviewSnapshot = canReview ? snapshot : { ...snapshot, actor: { ...snapshot.actor, can_review: false } }
  const config = PAGE[view]
  const roleTitle = role === 'Investor' ? 'Your investments and orders.' : role === 'OfferingManager' || role === 'IssuerFundManager' ? 'Your products and incoming orders.' : role === 'ComplianceOfficer' ? 'Your compliance work queue.' : role === 'TreasuryOperator' ? 'Your funding operations.' : role === 'FinancialController' ? 'Your independent reconciliation queue.' : undefined
  const title = selected && ['/portal/products/detail', '/portal/opportunities/detail'].includes(view) ? selected.terms.name : selectedApplication && view === '/portal/compliance/detail' ? selectedApplication.details.full_name : view === '/portal' && roleTitle ? roleTitle : config.title
  const href = (path: PortalPath, recordId?: string) => portalScopeHref(path, operatingContext, recordId)
  const parentPath: PortalPath = config.active === 'products' ? '/portal/products' : config.active === 'compliance' ? '/portal/compliance' : config.active === 'portfolio' ? '/portal/portfolio' : config.active === 'onboarding' ? '/portal/onboarding' : '/portal/opportunities'
  const breadcrumbs = view === '/portal' ? [] : view === '/portal/orders/detail' ? [{ label: 'My operating workspace', href: href('/portal') }, { label: 'Subscription funding' }] : [{ label: config.active === 'products' ? 'Products & offerings' : config.active === 'compliance' ? 'Compliance' : config.active === 'opportunities' ? 'Opportunities' : config.active === 'portfolio' ? 'My orders' : 'My onboarding', href: view.includes('/detail') || view.endsWith('/new') ? href(parentPath) : undefined }, ...(view.includes('/detail') ? [{ label: selected?.terms.name || selectedApplication?.details.full_name || 'Details' }] : view.endsWith('/new') ? [{ label: 'New product' }] : [])]

  function unavailable() { return <Panel title="Record unavailable"><EmptyState title="This record is not available in your current operating scope" description="It may have changed or belong to another organisation. No access is granted by a shared URL." href={href('/portal')} action="Return to dashboard" /></Panel> }
  const fundingOutstanding = (subscription: PortalSubscription) => subscription.status === 'AWAITING_FUNDING' && !snapshot.funding?.obligations.some(item => item.subscription_id === subscription.id && item.state === 'RECONCILED')
  function productStats() { return <div className={styles.statGrid}><Statistic label="Products in your scope" value={managedProducts.length} hint="Current organisation and acting role" /><Statistic label="Awaiting review" value={managedProducts.filter(product => product.status === 'IN_REVIEW').length} hint="Independent decision required" /><Statistic label="Incoming orders awaiting funding" value={orderOrganisations.length ? incomingSubscriptions.filter(fundingOutstanding).length : 'Unavailable'} hint={orderOrganisations.length ? 'Saved instructions, not settled investments' : 'Order-reading authority is not available in this scope'} /></div> }
  function orderStats() {
    const pending = ownSubscriptions.filter(fundingOutstanding)
    const amount = pending.reduce((sum, subscription) => sum + BigInt(subscription.amount_minor), 0n).toString()
    return <div className={styles.statGrid}><Statistic label="Subscription instructions" value={ownSubscriptions.length} hint="Your saved instructions" /><Statistic label="Awaiting funding" value={pending.length} hint="Reserved, not issued" /><Statistic label="Requested subscription amount" value={money(amount)} hint="Awaiting-funding instructions only" /></div>
  }
  function investorWork() {
    return <div className={styles.stack}>{orderStats()}<InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /><SubscriptionOrders subscriptions={ownSubscriptions} products={snapshot.products} incoming={false} onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /><Panel title="Investment opportunities" description="Explore the published products available to your approved relationship."><Opportunities products={published} snapshot={snapshot} operatingContext={operatingContext} /></Panel></div>
  }
  function productWork() {
    return <div className={styles.stack}>{productStats()}<ProductRegister products={managedProducts} canCreate={createOrganisations.length > 0} operatingContext={operatingContext} />{orderOrganisations.length ? <SubscriptionOrders subscriptions={incomingSubscriptions} products={managedProducts} incoming onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /> : <Notice title="Order access unavailable">Your current mandate does not provide an incoming-order view. This is not an empty order book or a zero balance.</Notice>}</div>
  }
  function content() {
    if (view === '/portal/orders/detail') {
      const subscription = snapshot.subscriptions.find(item => item.id === id)
      const context = operatingContext ?? APPLICANT_CONTEXT
      const allowedRole = context.mode === 'APPLICANT' || ['Investor', 'OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role)
      const owned = subscription?.investor_id === snapshot.actor.id && (context.mode === 'APPLICANT' || context.role === 'Investor')
      const assigned = subscription && context.mode === 'ROLE' && ['OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role) && snapshot.organisations.some(org => org.id === subscription.organisation_id && org.status === 'ACTIVE' && org.authority_source === 'NATIVE_BINDING' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role))
      const legacyOwner = subscription && context.mode === 'APPLICANT' && orderOrganisations.some(org => org.id === subscription.organisation_id)
      return subscription && allowedRole && (owned || assigned || legacyOwner) ? <FundingOrderDetail subscription={subscription} snapshot={snapshot} operatingContext={context} onSaved={setSnapshot} /> : unavailable()
    }
    if (view === '/portal/onboarding') return <div className={styles.stack}><OnboardingForm applications={ownApplications} onSaved={setSnapshot} />{canInvest ? <InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /> : null}</div>
    if (view === '/portal/products/new') return createOrganisations.length ? <ProductForm organisations={createOrganisations} onSaved={setSnapshot} operatingContext={operatingContext} /> : <Panel title="Product access"><EmptyState title="A scoped product-creation mandate is required" description="An organisation name or another role assignment does not grant product-creation access in this operating scope." href={href('/portal')} action="Return to dashboard" /></Panel>
    if (view === '/portal/products') return productWork()
    if (view === '/portal/products/detail') {
      if (!selected) return unavailable()
      const organisation = organisations.find(org => org.id === selected.organisation_id)
      const canEdit = organisation && permits(organisation, 'save_product', operatingContext)
      return <div className={styles.stack}><div className={styles.wideGrid}><div className={styles.stack}><ProductFacts product={selected} /><ProductNarrative product={selected} /><OfferingDocuments product={selected} /></div>{organisation ? <ProductActions product={selected} onSaved={setSnapshot} availableCommands={organisation.capabilities ?? (operatingContext ? [] : undefined)} /> : <Notice title="Read-only product access">No product-management mandate is available for this organisation.</Notice>}</div>{canEdit && ['DRAFT', 'CHANGES_REQUIRED'].includes(selected.status) ? <ProductForm key={`${selected.id}-${selected.revision}`} organisations={organisations.filter(org => permits(org, 'save_product', operatingContext))} product={selected} onSaved={setSnapshot} operatingContext={operatingContext} /> : null}{organisation && permits(organisation, 'read_orders', operatingContext) ? <SubscriptionOrders subscriptions={incomingSubscriptions.filter(item => item.product_id === selected.id)} products={[selected]} incoming onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /> : <Notice title="Order access unavailable">This product’s incoming-order book is not available under your current mandate.</Notice>}</div>
    }
    if (view === '/portal/compliance') return canReview ? <ComplianceQueue snapshot={reviewSnapshot} operatingContext={operatingContext} /> : unavailable()
    if (view === '/portal/compliance/detail') {
      if (!canReview) return unavailable()
      return selectedApplication ? <ApplicationReview key={`${selectedApplication.id}-${selectedApplication.revision}`} application={selectedApplication} snapshot={reviewSnapshot} onSaved={setSnapshot} /> : selected ? <ProductReview key={`${selected.id}-${selected.revision}`} product={selected} snapshot={reviewSnapshot} onSaved={setSnapshot} /> : unavailable()
    }
    if (view === '/portal/opportunities') return canInvest ? <Opportunities products={published} snapshot={snapshot} operatingContext={operatingContext} /> : unavailable()
    if (view === '/portal/opportunities/detail') return canInvest && selected?.status === 'PUBLISHED' ? <div className={styles.wideGrid}><div className={styles.stack}><Notice title="Fictional test offering">{selected.terms.summary}</Notice><ProductFacts product={selected} /><ProductNarrative product={selected} /><OfferingDocuments product={selected} /></div><SubscriptionForm product={selected} snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /></div> : unavailable()
    if (view === '/portal/portfolio') return canInvest ? <div className={styles.stack}>{orderStats()}<Notice title="Reservations are not holdings">These are subscription instructions with reserved units. A reservation does not confirm funding, token ownership or investment performance.</Notice><SubscriptionOrders subscriptions={ownSubscriptions} products={snapshot.products} incoming={false} onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /></div> : unavailable()
    if (role === 'ComplianceOfficer') return canReview ? <ComplianceQueue snapshot={reviewSnapshot} operatingContext={operatingContext} /> : unavailable()
    if (role === 'OfferingManager' || role === 'IssuerFundManager') return productWork()
    if (role === 'Investor') return investorWork()
    if ((role === 'TreasuryOperator' || role === 'FinancialController') && operatingContext) return <FundingWorkspace snapshot={snapshot} operatingContext={operatingContext} onSaved={setSnapshot} />
    if (role === 'SuperAdmin' && operatingContext?.mode === 'ROLE') return <Panel title="Controlled platform administration" description="Use the existing guarded administration workflow for the selected organisation. Business and wallet-signing powers remain separate."><div className={styles.actions}><Link href={`/workspace/administration?organisation=${encodeURIComponent(operatingContext.organisationId)}`} className={styles.button}>Open controlled administration</Link><Link href="/workspace/security" className={styles.buttonSecondary}>Account security</Link></div></Panel>
    if (role) return <Panel title="Operational records unavailable"><EmptyState title="No connected operating queue is available for this role" description="This release does not manufacture settlement, register or token operations. Your assigned organisation and sign-in remain unchanged." /></Panel>
    if (capabilities.manageProducts) return <div className={styles.stack}><Notice title="Approved applicant product relationship">These products use your existing approved owner relationship. This is not a native organisation role assignment.</Notice>{productWork()}</div>
    return <div className={styles.stack}><section className={styles.hero}><div><p className={styles.eyebrow}>Your BlockXOne relationship</p><h2>{currentInvestorApplication(snapshot) ? 'Review opportunities. Track every instruction.' : 'Complete your onboarding to get started.'}</h2><p>Keep identity review, your investment account and product instructions connected. Approval and funding remain separate recorded decisions.</p><Link href={href('/portal/onboarding')} className={styles.button}>Continue onboarding<ArrowRight aria-hidden="true" /></Link></div></section><Panel title="Your onboarding" action={<Link href={href('/portal/onboarding')} className={styles.textLink}>View application</Link>}>{ownApplications.length ? ownApplications.map(application => <div key={application.id}><DetailList rows={[{ label: application.persona === 'INVESTOR' ? 'Investor relationship' : 'Wealth-manager relationship', value: <StatusBadge status={application.status} /> }, { label: 'Review expiry', value: dateLabel(application.approved_until) }]} /></div>) : <EmptyState title="Introduce yourself" description="Submit your own applicant details and evidence for an independent review." href={href('/portal/onboarding')} action="Start onboarding" />}</Panel>{investorWork()}</div>
  }

  return <PortalCommandProvider snapshot={snapshot} operatingContext={operatingContext} environment={release?.environment}><PortalShell user={data.user} organisationName={scope?.organisationName ?? organisations[0]?.name} capabilities={capabilities} active={config.active} title={title} description={config.description} eyebrow={config.eyebrow} breadcrumbs={breadcrumbs} release={release} operatingContext={operatingContext} actions={<a href={href(view, id)} className={styles.buttonSecondary}>Refresh saved state</a>}>
    {scopes?.length ? <nav aria-label="Assigned role and organisation" className={`${styles.scopeSelector} ${styles.sectionGap}`}>
      {scope ? <p>Working as <strong>{getRoleDashboard(scope.role)?.title ?? scope.role}</strong> in <strong>{scope.organisationName}</strong></p> : <p>Working with your <strong>personal and applicant relationships</strong>. An approved product-owner relationship here does not grant a native organisation role.</p>}
      <div className={styles.actions}><Link href={portalScopeHref('/portal', APPLICANT_CONTEXT)} className={styles.buttonSecondary} aria-current={operatingContext?.mode === 'APPLICANT' ? 'page' : undefined}>My personal / applicant relationships</Link>{scopes.map(item => <Link key={`${item.organisationId}-${item.role}`} href={portalScopeHref('/portal', { mode: 'ROLE', organisationId: item.organisationId, role: item.role })} className={styles.buttonSecondary} aria-current={item.organisationId === scope?.organisationId && item.role === scope?.role ? 'page' : undefined}>{item.organisationName} · {getRoleDashboard(item.role)?.title ?? item.role}</Link>)}</div>
    </nav> : null}
    <div className={styles.stack}>{content()}<RoleHelp operatingContext={operatingContext} /></div>
  </PortalShell></PortalCommandProvider>
}
