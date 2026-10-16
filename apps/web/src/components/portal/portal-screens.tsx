'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, Layers3, Plus } from 'lucide-react'
import { isOfferingSubscribable, isWealthManagerDetailsV2, representativeMandateNextOwnerLabel, validatedEntityProductEligibility, type PortalCapability, type PortalInvestingRepresentativeMandate, type PortalOrganisation, type PortalOrganisationMandate, type PortalPageData, type PortalPath, type PortalProduct, type PortalSnapshot, type PortalSubscription } from '@/lib/portal/contracts'
import type { PlatformEnvironment, PlatformRelease } from '@/lib/platform-release'
import type { DashboardScope } from '@/lib/portal/dashboard'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import { APPLICANT_CONTEXT, appointedIssuerProducts, hasFundOperatingProducts, isFundOperatingContext, portalContextKey, portalContextMatches, portalScopeHref, portalViewAllowed, standardTestIssuerProductAvailable, testOfferingReviewAvailable, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { validatedFundRoleplayEligibility } from '@/lib/portal/fund-roleplay-eligibility'
import { validatedFundRoleplayAdmission, validatedFundRoleplayApplicationReview } from '@/lib/portal/fund-roleplay-admission'
import { hasStage2CommandAccess, isTestPasswordAdmission, stage2AccessSchema } from '@/lib/portal/stage2-access'
import { hasOfferingCommandAccess, isTestPasswordOffering, isTestPasswordWorkflow, validatedOfferingAccess } from '@/lib/portal/offering-access'
import { sameEvaluationGrant, validatedEvaluationAccess } from '@/lib/portal/evaluation-access'
import { CommandFeedback, PortalCommandProvider, usePortalCommand } from './portal-client'
import { CustomerMonitoringDecision, CustomerMonitoringQueue } from './customer-monitoring'
import { ProductForm } from './product-form'
import { OfferingFilePanel } from './offering-file-panel'
import { OfferingSignatures } from './offering-signatures'
import { ProviderConnectionCheck } from './provider-connection-check'
import { ProductAppointmentDecision, ProductAppointmentQueue, ProductAppointmentRequest } from './product-service-appointments'
import { PrivateDocument } from './onboarding-form'
import { PortalShell, type PortalNavigationKey } from './portal-shell'
import { DetailList, EmptyState, Field, Notice, Panel, Statistic, StatusBadge, dateLabel, money } from './portal-primitives'
import { ApplicationReview, EntityProductEligibilityPanel, InvestmentAccountPanel, IssuerOfferingReview, OfferingPackageEvidence, OfferingDocuments, ProductActions, ProductEligibilityPanel, ProductEligibilityReview, ProductFacts, ProductNarrative, ProductReview, RepresentativeProposalInbox, SubscriptionCancel, SubscriptionForm, currentInvestorApplication, entityEligibilityNextOwner, investingRepresentativeLabel } from './portal-workflows'
import { FundingOrderDetail, FundingWorkspace } from './funding-workflows'
import { FundLifecycleDashboard, FundLifecycleOrder, FundLifecyclePortfolio, FundLifecycleWorkspace } from './fund-lifecycle'
import { FundSetup } from './fund-setup'
import { validatedFundLifecycle, type FundProductLifecycle } from '@/lib/portal/fund-lifecycle-contracts'
import styles from './portal.module.css'

function testRoleplayManagerProduct(snapshot: PortalSnapshot, product: PortalProduct, context?: PortalOperatingContext, environment?: PlatformEnvironment) {
  if (environment !== 'TESTNET' || context?.mode !== 'ROLE' || context.role !== 'OfferingManager'
    || validatedOfferingAccess(snapshot, context, environment)?.session_mode !== 'STANDARD'
    || !portalContextMatches(snapshot.operating_context, context)) return false
  const organisation = snapshot.organisations.find(org => org.id === product.organisation_id)
  return Boolean(organisation?.authority_source === 'TEST_ROLE_PLAY' && organisation.status === 'ACTIVE'
    && organisation.native_organisation_id === context.organisationId && organisation.roles.includes(context.role)
    && product.created_by === snapshot.actor.id && product.offering_package?.origin === 'SUBMITTED'
    && /^[0-9a-f]{64}$/.test(product.terms_hash) && product.offering_package.terms_hash === product.terms_hash)
}

export function productManagementOrganisations(snapshot: PortalSnapshot, context?: PortalOperatingContext, environment?: PlatformEnvironment) {
  if (context?.mode === 'ROLE' && !['IssuerFundManager', 'OfferingManager'].includes(context.role)) return []
  return snapshot.organisations.filter(org => org.status === 'ACTIVE'
    && org.roles.some(role => ['IssuerFundManager', 'OfferingManager'].includes(role))
    && (org.authority_source !== 'TEST_ROLE_PLAY'
      || snapshot.products.some(product => product.organisation_id === org.id && testRoleplayManagerProduct(snapshot, product, context, environment)))
    && (!context || (context.mode === 'APPLICANT' ? org.authority_source === 'LEGACY_OWNER'
      : org.native_organisation_id === context.organisationId && org.roles.includes(context.role)
        && (org.authority_source === 'NATIVE_BINDING' || org.authority_source === 'TEST_ROLE_PLAY'))))
}

function permits(org: PortalOrganisation, command: PortalCapability, context?: PortalOperatingContext): boolean {
  return org.capabilities?.includes(command) ?? !context
}

type ProductWorkspaceSection = 'DETAILS' | 'REVIEW' | 'DOCUMENTS' | 'APPOINTMENTS' | 'CHAIN_SETUP'

function ProductDetailWorkspace({ product, snapshot, organisations, operatingContext, environment, onSaved, onRefresh, availableCommands, canEdit, canViewIssuerRationale, canReviewIssuer, lifecycle }: {
  product: PortalProduct; snapshot: PortalSnapshot; organisations: PortalOrganisation[];
  operatingContext?: PortalOperatingContext; onSaved: (snapshot: PortalSnapshot) => void;
  environment?: PlatformEnvironment;
  availableCommands?: readonly string[]; canEdit: boolean; canViewIssuerRationale: boolean; canReviewIssuer: boolean;
  onRefresh: () => Promise<void>;
  lifecycle?: FundProductLifecycle;
}) {
  const [section, setSection] = useState<ProductWorkspaceSection>(canEdit ? 'DETAILS' : 'REVIEW')
  const [documentsMounted, setDocumentsMounted] = useState(false)
  const sectionContent = useRef<Record<ProductWorkspaceSection, HTMLDivElement | null>>({ DETAILS: null, REVIEW: null, DOCUMENTS: null, APPOINTMENTS: null, CHAIN_SETUP: null })
  const focusRequested = useRef(false)
  useEffect(() => {
    if (!focusRequested.current) return
    focusRequested.current = false
    sectionContent.current[section]?.focus()
  }, [section])
  function selectSection(next: ProductWorkspaceSection) {
    if (next === 'DOCUMENTS') setDocumentsMounted(true)
    if (next === section) { sectionContent.current[next]?.focus(); return }
    focusRequested.current = true
    setSection(next)
  }
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showTechnicalEvidence, setShowTechnicalEvidence] = useState(false)
  const pkg = product.offering_package
  const appointments = snapshot.product_appointments?.filter(item => item.product_id === product.id) ?? []
  const issuerAssigned = appointments.some(item => item.role === 'IssuerFundManager' && item.effective)
  const complianceAssigned = appointments.some(item => item.role === 'ComplianceOfficer' && item.effective)
  const signatureStatus = pkg?.document_evidence?.signature_status
  const nextStep: { message: string; section?: ProductWorkspaceSection } = ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status)
    ? { message: 'Complete and save the product details, then submit the saved version for review.', section: 'DETAILS' }
    : !pkg ? { message: 'The submitted package is not available. Refresh the saved record before taking another action.' }
    : !issuerAssigned || !complianceAssigned ? { message: 'Confirm the issuer and Compliance appointments for this product in Appointments. Submission alone does not assign a reviewer.', section: 'APPOINTMENTS' }
    : signatureStatus === 'NOT_CONNECTED' || signatureStatus === 'NOT_ADMITTED' ? { message: 'Document signing is not connected for this package yet. The submission is saved, but approval is not available.', section: 'DOCUMENTS' }
    : pkg.issuer_status !== 'APPROVED' ? { message: 'The appointed issuer must complete the document and package review.', section: 'DOCUMENTS' }
    : pkg.compliance_status !== 'APPROVED' ? { message: 'The appointed Compliance Officer must review the same submitted package.', section: 'DOCUMENTS' }
    : pkg.technical_readiness_status !== 'VERIFIED' ? { message: 'The package still needs verified blockchain deployment before it can open to investors.', section: 'CHAIN_SETUP' }
    : product.status !== 'PUBLISHED' ? { message: 'Use the authorised opening action when the backend confirms every requirement.' }
    : { message: 'The offering is published. Investor access remains subject to the current product and account requirements.' }
  const commands = hasUnsavedChanges ? (availableCommands ?? []).filter(command => command !== 'submit_product') : availableCommands
  const sections = [
    { id: 'DETAILS', label: canEdit ? 'Edit details' : 'Product details' },
    { id: 'REVIEW', label: 'Review & next step' },
    { id: 'DOCUMENTS', label: 'Documents & signing' },
    { id: 'APPOINTMENTS', label: 'Appointments' },
    ...(product.terms.asset_type === 'FUND' ? [{ id: 'CHAIN_SETUP', label: 'Blockchain setup' } as const] : []),
  ] as const
  const nextStepSection = sections.find(item => item.id === nextStep.section)
  return <div className={styles.stack}>
    <nav className={styles.actions} aria-label="Product workspace sections">
      {sections.map(item => <button key={item.id} id={`product-${product.id}-section-${item.id}`} type="button" className={section === item.id ? styles.button : styles.buttonSecondary}
        aria-pressed={section === item.id} aria-controls={`product-${product.id}-${item.id}`} onClick={() => selectSection(item.id)}>{item.label}</button>)}
    </nav>
    <div id={`product-${product.id}-DETAILS`} ref={node => { sectionContent.current.DETAILS = node }} role="region" aria-labelledby={`product-${product.id}-section-DETAILS`} tabIndex={-1} hidden={section !== 'DETAILS'}>
      {canEdit ? <ProductForm key={`${product.id}-${product.revision}`} organisations={organisations} product={product}
        onSaved={onSaved} operatingContext={operatingContext} onUnsavedChange={setHasUnsavedChanges} />
        : <div className={styles.stack}><ProductFacts product={product} /><ProductNarrative product={product} /></div>}
    </div>
    <div id={`product-${product.id}-REVIEW`} ref={node => { sectionContent.current.REVIEW = node }} role="region" aria-labelledby={`product-${product.id}-section-REVIEW`} tabIndex={-1} className={styles.stack} hidden={section !== 'REVIEW'}>
      {lifecycle && operatingContext ? <FundLifecycleWorkspace showTitle={false} lifecycle={lifecycle} actorId={snapshot.actor.id} operatingContext={operatingContext}
        onRefresh={onRefresh} handoff={nextStepSection ? { message: nextStep.message, label: `Open ${nextStepSection.label}`,
          regionId: `product-${product.id}-${nextStepSection.id}`, onSelect: () => selectSection(nextStepSection.id) } : undefined} /> : <Panel title="Your next step"><p>{nextStep.message}</p>
        {nextStepSection ? <button type="button" className={styles.buttonSecondary} aria-controls={`product-${product.id}-${nextStepSection.id}`} onClick={() => selectSection(nextStepSection.id)}>Open {nextStepSection.label}</button> : null}
        <p className={styles.muted}>This page acts on the saved product version.</p>
        {hasUnsavedChanges ? <p className={styles.fieldError} role="status">Save your changes in Edit details before submitting. They are not part of the saved package yet.</p> : null}
      </Panel>}
      {lifecycle && hasUnsavedChanges ? <p className={styles.fieldError} role="status">Save your changes in Edit details before submitting. They are not part of the saved package yet.</p> : null}
      <ProductActions compact={Boolean(lifecycle)} product={product} onSaved={onSaved} availableCommands={commands} />
      {canReviewIssuer && pkg && product.status === 'IN_REVIEW' ? <IssuerOfferingReview product={product} snapshot={snapshot} onSaved={onSaved} /> : null}
      {pkg ? <><button type="button" className={styles.buttonSecondary} aria-expanded={showTechnicalEvidence} onClick={() => setShowTechnicalEvidence(value => !value)}>{showTechnicalEvidence ? 'Hide recorded package evidence' : 'View recorded package evidence'}</button>{showTechnicalEvidence ? <OfferingPackageEvidence product={product} showIssuerRationale={canViewIssuerRationale} /> : null}</> : null}
    </div>
    {documentsMounted ? <div id={`product-${product.id}-DOCUMENTS`} ref={node => { sectionContent.current.DOCUMENTS = node }} role="region" aria-labelledby={`product-${product.id}-section-DOCUMENTS`} tabIndex={-1} className={styles.stack} hidden={section !== 'DOCUMENTS'}>
      {!pkg ? <Panel title="Documents & signing"><EmptyState title="Save and submit the product first" description="The submitted package connects its document versions, uploads and signature evidence. Saving a draft does not create signed documents." /></Panel>
        : <><OfferingDocuments product={product} /><OfferingFilePanel product={product} context={operatingContext} actorId={snapshot.actor.id} />
          <OfferingSignatures product={product} context={operatingContext} actorId={snapshot.actor.id} appointments={snapshot.product_appointments} environment={environment} /></>}
    </div> : null}
    <div id={`product-${product.id}-APPOINTMENTS`} ref={node => { sectionContent.current.APPOINTMENTS = node }} role="region" aria-labelledby={`product-${product.id}-section-APPOINTMENTS`} tabIndex={-1} hidden={section !== 'APPOINTMENTS'}>
      <ProductAppointmentRequest product={product} snapshot={snapshot} operatingContext={operatingContext} onSaved={onSaved} />
    </div>
    {section === 'CHAIN_SETUP' && product.terms.asset_type === 'FUND' && operatingContext ? <div id={`product-${product.id}-CHAIN_SETUP`} ref={node => { sectionContent.current.CHAIN_SETUP = node }} role="region" aria-labelledby={`product-${product.id}-section-CHAIN_SETUP`} tabIndex={-1}>
      <FundSetup key={`${snapshot.actor.id}:${product.id}:${portalContextKey(operatingContext)}`} productId={product.id} productRevision={product.revision}
        actorId={snapshot.actor.id} operatingContext={operatingContext} onRefresh={onRefresh} />
    </div> : null}
  </div>
}

function ProductCard({ product, operatingContext }: { product: PortalProduct; operatingContext?: PortalOperatingContext }) {
  return <article className={styles.productCard}>
    <div className={styles.productVisual} data-kind={product.terms.asset_type}>{product.terms.asset_type === 'FUND' ? <Layers3 aria-hidden="true" /> : <Building2 aria-hidden="true" />}<p>{product.terms.asset_type === 'FUND' ? 'Investment fund' : 'Real-estate investment'} · Fictional product</p></div>
    <div className={styles.productCardBody}><h2>{product.terms.name}</h2><p>{product.terms.summary}</p>
      <DetailList rows={[{ label: 'Unit price', value: money(product.terms.unit_price_minor, product.terms.currency) }, { label: 'Minimum investment', value: money((BigInt(product.terms.minimum_units) * BigInt(product.terms.unit_price_minor)).toString(), product.terms.currency) }, { label: 'Share class', value: product.terms.share_class }]} />
      <div className={styles.productCardFoot}><StatusBadge status={product.status} /><Link href={portalScopeHref('/portal/opportunities/detail', operatingContext, product.id)} className={styles.textLink}>View opportunity <span aria-hidden="true">↗</span></Link></div>
    </div>
  </article>
}

function ProductRegister({ products, canCreate, operatingContext }: { products: PortalProduct[]; canCreate: boolean; operatingContext?: PortalOperatingContext }) {
  return <Panel title="Product register" description="Fund and real-estate products share one workflow; submitted packages keep separate immutable references." action={canCreate ? <Link href={portalScopeHref('/portal/products/new', operatingContext)} className={styles.button}><Plus aria-hidden="true" />Create a product</Link> : undefined} flush>
    {products.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Product</th><th scope="col">Template</th><th scope="col">Package</th><th scope="col">Status</th><th scope="col">Workspace</th></tr></thead>
      <tbody>{products.map(product => <tr key={product.id}><td><strong>{product.terms.name}</strong><small>{product.terms.issuer_name}</small></td><td>{product.terms.asset_type === 'FUND' ? 'Fund' : 'Real estate'}</td><td>{product.offering_package ? `Package ${product.offering_package.package_number}` : 'No current package'}<small>Workflow revision {product.revision}</small></td><td>{product.status === 'PUBLISHED' && !isOfferingSubscribable(product) ? 'Historical PUBLISHED state; opening not verified' : <StatusBadge status={product.status} />}</td><td><Link href={portalScopeHref('/portal/products/detail', operatingContext, product.id)}>Open product</Link></td></tr>)}</tbody>
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
        const recordedPackage = product?.offering_history?.find(item => item.id === subscription.offering_revision_id)
        const obligation = funding?.obligations.find(item => item.subscription_id === subscription.id)
        return <tr key={subscription.id}><td><strong>{subscription.product_name}</strong>{product ? <small>{product.terms.asset_type === 'FUND' ? 'Fund' : 'Real estate'}</small> : null}</td>
          <td><span className={styles.mono}>{subscription.id}</span><small>Recorded product workflow revision {subscription.product_revision} · {dateLabel(subscription.created_at)}</small><small>{subscription.offering_revision_id ? <>{recordedPackage?.origin === 'SUBMITTED' ? 'Submitted offering package' : recordedPackage ? 'Preserved historical terms snapshot; approval not inferred' : 'Terms package reference; origin unavailable'} <span className={styles.mono}>{subscription.offering_revision_id}</span></> : 'Historical instruction · no verified package reference'}</small><details><summary className={styles.textLink}>Accepted terms fingerprint</summary><p className={styles.mono}>{subscription.terms_hash}</p></details></td>
          <td>{subscription.investment_account_id ? <span className={styles.mono}>{subscription.investment_account_id}</span> : <span className={styles.muted}>Legacy instruction · account not linked</span>}</td>
          <td>{subscription.units}</td><td>{subscription.currency ? money(subscription.amount_minor, subscription.currency) : 'Currency not recorded'}</td><td><StatusBadge status={obligation && subscription.status === 'AWAITING_FUNDING' ? 'RESERVED' : subscription.status} />{obligation ? <div className={styles.sectionGap}><StatusBadge status={obligation.state} /><small>Funding state · not issued ownership</small></div> : null}</td>
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
  const approval = currentInvestorApplication(snapshot)
  const applications = snapshot.applications.filter(item => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR')
  const pending = applications.some(item => item.status === 'SUBMITTED')
  const expired = applications.some(item => item.status === 'APPROVED' && item.approved_until && Date.parse(item.approved_until) <= Date.now())
  const unverified = applications.some(item => item.status === 'APPROVED' && (!item.approved_until || !Number.isFinite(Date.parse(item.approved_until))))
  return <div className={styles.stack}>
    {!approval ? <Notice title={pending ? 'Your investor application is under review' : expired ? 'Your investor approval has expired' : unverified ? 'Investor approval could not be verified' : 'Complete your investor application'}>
      <p>{pending ? 'You can browse open offerings while your application is reviewed. You cannot reserve units or pay yet.' : expired ? 'Your application needs a current approval before you can open an account or invest.' : unverified ? 'Refresh your saved application before assuming that you can open an account or invest.' : 'An approved application, an active investment account and approval for the selected offering are required before you can invest.'}</p>
      <Link href={portalScopeHref('/portal/onboarding', operatingContext)} className={styles.textLink}>View my investor application</Link>
    </Notice> : null}
    {products.length ? <p className={styles.copy}>Choose an offering to review its terms, investment requirements and price. No returns or liquidity are guaranteed.</p> : null}
    {products.length ? <div className={styles.productGrid}>{products.map(product => <ProductCard key={product.id} product={product} operatingContext={operatingContext} />)}</div>
      : <Panel title="Investment opportunities"><EmptyState title="No offerings are open for investment yet" description="No offering returned for your account currently meets the publication and technical-readiness requirements. This is separate from your investor application. A fund still being prepared cannot accept your investment." /></Panel>}
  </div>
}

function scopedMandates(snapshot: PortalSnapshot, operatingContext?: PortalOperatingContext): PortalOrganisationMandate[] {
  if (snapshot.mandate_queue_available !== true || operatingContext?.mode !== 'ROLE' || !['ComplianceOfficer', 'SuperAdmin'].includes(operatingContext.role)) return []
  if (operatingContext.role === 'ComplianceOfficer' && snapshot.actor.can_review !== true) return []
  return (snapshot.organisation_mandates ?? []).filter(item => item.reviewer_scope_organisation_id === operatingContext.organisationId)
}

function scopedEntityMandates(snapshot: PortalSnapshot, operatingContext?: PortalOperatingContext): PortalInvestingRepresentativeMandate[] {
  if (snapshot.entity_mandate_queue_available !== true || operatingContext?.mode !== 'ROLE' || !['ComplianceOfficer', 'SuperAdmin'].includes(operatingContext.role)) return []
  if (operatingContext.role === 'ComplianceOfficer' && snapshot.actor.can_review !== true) return []
  return (snapshot.investing_representative_mandates ?? []).filter(item => item.reviewer_scope_organisation_id === operatingContext.organisationId)
}

function EntityInvestingMandateQueue({ snapshot, operatingContext }: { snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext }) {
  const cases = scopedEntityMandates(snapshot, operatingContext)
  const admin = operatingContext?.mode === 'ROLE' && operatingContext.role === 'SuperAdmin'
  return <Panel title={admin ? 'Entity investing mandates to apply' : 'Entity investing-representative review'} description="An entity investor account is the legal holder. Its representative requires a distinct case decision and application before limited account access is effective." flush>
    {snapshot.entity_mandate_queue_blocked_reason === 'MFA_REQUIRED' ? <Notice title="Authenticator required" tone="warning">Verify your staff authenticator before opening entity mandate cases. No case count or details are shown at this assurance level. <a href="/workspace/security">Open account security</a>.</Notice>
      : snapshot.entity_mandate_queue_blocked_reason === 'NOT_ADMITTED' ? <Notice title="Entity mandate review not admitted" tone="warning">This environment has not admitted the guarded review route. No cases or actions are shown.</Notice>
        : snapshot.entity_mandate_queue_available !== true || !Array.isArray(snapshot.investing_representative_mandates) ? <Notice title="Entity mandate queue unavailable" tone="warning">Refresh saved state before concluding that there are no appointment cases.</Notice>
          : cases.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Entity investor</th><th scope="col">Scope</th><th scope="col">Status</th><th scope="col">Next owner</th><th scope="col">Action</th></tr></thead><tbody>{cases.map(item => <tr key={item.id}><td><strong>{item.entity_name}</strong>{item.proposal_hash ? <small>Named representative: {investingRepresentativeLabel(item)}</small> : null}<small className={styles.mono}>{item.id}</small></td><td>Account view and guarded eligibility request · zero transaction authority</td><td><StatusBadge status={item.status} /></td><td>{representativeMandateNextOwnerLabel(item.next_owner)}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, item.id)}>{admin && item.can_apply ? 'Apply reviewed mandate' : !admin && item.can_review ? 'Review appointment' : item.can_revoke ? 'Inspect and revoke' : 'Inspect case'}</Link></td></tr>)}</tbody></table></div>
            : <EmptyState title="No entity investing mandate cases in this scope" description="Only cases in this exact reviewer or application scope appear here. Investor admission does not automatically grant representation." />}
  </Panel>
}

function RepresentativeMandateQueue({ snapshot, operatingContext }: { snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext }) {
  const mandates = scopedMandates(snapshot, operatingContext)
  const admin = operatingContext?.mode === 'ROLE' && operatingContext.role === 'SuperAdmin'
  return <Panel title={admin ? 'Approved representative mandates to apply' : 'Representative mandate review'} description="This queue governs each customer organisation's initial applying representative. Customer admission, independent appointment review and role application remain distinct saved decisions; adding other representatives is not supported here." flush>
    {snapshot.mandate_queue_blocked_reason === 'MFA_REQUIRED' ? <Notice title="Authenticator required" tone="warning">Complete authenticator verification for this staff operating context before checking the mandate queue. No case count or status is shown at this assurance level. <a href="/workspace/security">Open account security</a>.</Notice>
      : snapshot.mandate_queue_blocked_reason === 'NOT_ADMITTED' ? <Notice title="Mandate review route not admitted" tone="warning">This environment has not admitted the guarded representative-mandate review route. No cases or actions are shown.</Notice>
      : snapshot.mandate_queue_available !== true || !Array.isArray(snapshot.organisation_mandates) ? <Notice title="Mandate queue unavailable" tone="warning">Refresh saved state before concluding there are no appointment cases.</Notice>
      : mandates.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Customer organisation</th><th scope="col">Role requested</th><th scope="col">Status</th><th scope="col">Next owner</th><th scope="col">Action</th></tr></thead><tbody>{mandates.map(item => <tr key={item.id}><td><strong>{item.organisation_name}</strong><small className={styles.mono}>{item.id}</small></td><td>Offering Manager</td><td><StatusBadge status={item.status} /></td><td>{representativeMandateNextOwnerLabel(item.next_owner)}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, item.id)}>{admin && item.can_apply && item.reviewer_user_id && item.reviewer_user_id !== snapshot.actor.id && item.applicant_user_id !== snapshot.actor.id ? 'Apply reviewed appointment' : !admin && item.can_review && item.applicant_user_id !== snapshot.actor.id ? 'Review appointment' : item.can_revoke ? 'Inspect and revoke' : 'Inspect status'}</Link></td></tr>)}</tbody></table></div>
      : <EmptyState title="No representative mandate cases in this scope" description="Only the exact reviewer or role-application scope returned by the backend appears here. Customer admission does not automatically create one." />}
  </Panel>
}

function RepresentativeMandateDecision({ mandate, snapshot, operatingContext, onSaved }: { mandate: PortalOrganisationMandate; snapshot: PortalSnapshot; operatingContext: PortalOperatingContext; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'>('CHANGES_REQUIRED')
  const [notes, setNotes] = useState('')
  const [checks, setChecks] = useState({ appointment: false, evidence: false, scope: false })
  const [revokeReason, setRevokeReason] = useState('')
  const command = usePortalCommand(onSaved)
  const exactScope = operatingContext.mode === 'ROLE' && mandate.reviewer_scope_organisation_id === operatingContext.organisationId
  const compliance = exactScope && operatingContext.mode === 'ROLE' && operatingContext.role === 'ComplianceOfficer'
  const admin = exactScope && operatingContext.mode === 'ROLE' && operatingContext.role === 'SuperAdmin'
  const source = snapshot.applications.find(item => item.id === mandate.application_id && item.user_id === mandate.applicant_user_id && item.persona === 'WEALTH_MANAGER' && isWealthManagerDetailsV2(item.details) && item.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION' && item.status === 'APPROVED' && item.revision === mandate.admission_revision && item.organisation_id === mandate.product_organisation_id)
  const approvalCurrent = mandate.admission_status === 'APPROVED' && mandate.admission_approved_until !== null && Date.parse(mandate.admission_approved_until) > Date.now()
    && Date.parse(mandate.requested_until) > Date.now()
  const canReview = compliance && snapshot.actor.can_review && mandate.can_review && mandate.status === 'SUBMITTED' && mandate.applicant_user_id !== snapshot.actor.id && approvalCurrent && Boolean(source)
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'review_representative_mandate', operatingContext))
  const canApply = admin && mandate.can_apply && mandate.status === 'APPROVED' && mandate.applicant_user_id !== snapshot.actor.id
    && mandate.reviewer_user_id !== null && mandate.reviewer_user_id !== snapshot.actor.id && approvalCurrent
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'apply_representative_mandate', operatingContext))
  const canRevoke = !isTestPasswordWorkflow(snapshot) && (compliance && snapshot.actor.can_review || admin) && mandate.can_revoke && mandate.status === 'APPLIED' && mandate.applicant_user_id !== snapshot.actor.id
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Notice title="Manual test appointment evidence">This case concerns a fictional customer organisation. Its appointment reference is not live KYC, a product-compliance appointment or institutional signing authority.</Notice>
    <Panel title="Representative appointment case" action={<StatusBadge status={mandate.status} />}><DetailList rows={[{ label: 'Mandate reference', value: mandate.id }, { label: 'Customer organisation', value: mandate.organisation_name }, { label: 'Requested role', value: 'Offering Manager' }, { label: 'Case revision', value: mandate.revision }, { label: 'Admission revision', value: mandate.admission_revision }, { label: 'Requested expiry', value: dateLabel(mandate.requested_until) }, { label: 'Next responsible owner', value: representativeMandateNextOwnerLabel(mandate.next_owner) }, { label: 'Compliance reviewer', value: mandate.reviewer_user_id ?? 'Awaiting review' }, { label: 'Role applied by', value: mandate.applied_by_user_id ?? 'Not yet applied' }]} /><h3 className={styles.sectionGap}>Synthetic appointment evidence reference</h3><p className={styles.copy}>{mandate.evidence_reference}</p>{mandate.review_notes ? <><h3>Recorded decision rationale</h3><p className={styles.copy}>{mandate.review_notes}</p></> : null}</Panel>
    {source ? <Panel title="Approved customer admission source"><DetailList rows={[{ label: 'Representative', value: source.details.full_name }, { label: 'Customer organisation', value: source.details.company_name }, { label: 'Admission reference', value: source.id }, { label: 'Source evidence files', value: source.details.documents.length }]} /><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, source.id)}>Inspect original admission and private evidence</Link></Panel> : compliance && mandate.status === 'SUBMITTED' ? <Notice title="Source admission unavailable" tone="warning">The approved source application is not in this review scope or no longer matches the appointment. No decision is available from this screen.</Notice> : null}
  </div><div className={styles.stack}>
    {canReview ? <Panel title="Independent compliance decision" description="Review the source admission, appointment evidence and exact organisation scope before deciding."><form className={styles.form} onSubmit={event => { event.preventDefault(); if (decision !== 'APPROVED' || Object.values(checks).every(Boolean)) void command.submit('review_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Appointment checks</legend>{([{ key: 'appointment', label: 'Synthetic representative appointment examined' }, { key: 'evidence', label: 'Source admission and appointment reference examined' }, { key: 'scope', label: 'Customer organisation and requested role scope confirmed' }] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="CHANGES_REQUIRED">Request changes</option><option value="APPROVED">Approve appointment for separate role application</option><option value="REJECTED">Reject appointment</option></select></Field><Field label="Decision rationale" hint="20 to 3000 characters. Explain the evidence and scope considered."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button className={styles.button} type="submit" disabled={decision === 'APPROVED' && !Object.values(checks).every(Boolean)}>Record appointment decision</button></fieldset></form></Panel> : null}
    {canApply ? <Panel title="Super Admin role application" description="A separate authorised Super Admin applies the already reviewed appointment. This creates only the exact Offering Manager organisation context."><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('apply_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision })}>Apply reviewed Offering Manager mandate</button></Panel> : null}
    {canRevoke ? <Panel title="Revoke operating appointment" description="This protective action removes this exact mandate and operating assignment; it does not delete customer admission."><form className={styles.form} onSubmit={event => { event.preventDefault(); void command.submit('revoke_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision, reason: revokeReason }) }}><Field label="Revocation reason" hint="20 to 1000 characters. Explain why operating authority must stop."><textarea required minLength={20} maxLength={1000} value={revokeReason} disabled={command.busy || command.unknown} onChange={event => setRevokeReason(event.target.value)} /></Field><button className={styles.buttonSecondary} type="submit" disabled={command.busy || command.unknown}>Revoke this appointment</button></form></Panel> : null}
    {!canReview && !canApply && !canRevoke ? <Notice title="No action available">{mandate.applicant_user_id === snapshot.actor.id ? 'You cannot decide or apply your own appointment.' : 'This case is not awaiting an action under your current role and organisation scope.'}</Notice> : null}
    <CommandFeedback command={command} />
  </div></div>
}

function EntityInvestingMandateDecision({ mandate, snapshot, operatingContext, onSaved }: { mandate: PortalInvestingRepresentativeMandate; snapshot: PortalSnapshot; operatingContext: PortalOperatingContext; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'>('CHANGES_REQUIRED')
  const [notes, setNotes] = useState('')
  const [checks, setChecks] = useState({ appointment: false, legal_entity: false, scope: false })
  const [revokeReason, setRevokeReason] = useState('')
  const command = usePortalCommand(onSaved)
  const exactScope = operatingContext.mode === 'ROLE' && mandate.reviewer_scope_organisation_id === operatingContext.organisationId
  const compliance = exactScope && operatingContext.mode === 'ROLE' && operatingContext.role === 'ComplianceOfficer' && snapshot.actor.can_review
  const admin = exactScope && operatingContext.mode === 'ROLE' && operatingContext.role === 'SuperAdmin'
  const source = snapshot.applications.find(item => item.id === mandate.application_id && item.user_id === mandate.applicant_user_id
    && item.persona === 'INVESTOR' && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === 'ENTITY'
    && item.status === 'APPROVED' && item.revision === mandate.admission_revision && item.approved_until && Date.parse(item.approved_until) > Date.now())
  const appointmentDocument = source?.details.documents.find(document => document.id === mandate.appointment_document_id && document.kind === 'COMPANY')
  const admissionCurrent = mandate.admission_current_revision === mandate.admission_revision && Boolean(mandate.admission_approved_until)
    && Date.parse(mandate.admission_approved_until!) > Date.now() && Date.parse(mandate.requested_until) > Date.now()
  const independent = mandate.applicant_user_id !== snapshot.actor.id && mandate.representative_user_id !== snapshot.actor.id
  const additionalProposal = mandate.representative_user_id !== mandate.applicant_user_id || Boolean(mandate.proposal_hash)
  const consentCurrent = !additionalProposal || Boolean(mandate.consent_decision === 'ACCEPT' && mandate.consent_receipt_id
    && mandate.responded_at && mandate.representative_application_id && mandate.representative_application_revision
    && typeof mandate.proposal_hash === 'string' && /^[0-9a-f]{64}$/.test(mandate.proposal_hash))
  const canReview = compliance && mandate.can_review && mandate.status === 'SUBMITTED' && admissionCurrent && independent && Boolean(source && appointmentDocument)
    && consentCurrent
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'review_investing_representative_mandate', operatingContext))
  const canApply = admin && mandate.can_apply && mandate.status === 'APPROVED' && admissionCurrent && independent
    && Boolean(mandate.reviewer_user_id) && mandate.reviewer_user_id !== snapshot.actor.id
    && consentCurrent
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'apply_investing_representative_mandate', operatingContext))
  const canRevoke = !isTestPasswordWorkflow(snapshot) && (compliance || admin) && mandate.can_revoke && mandate.status === 'APPLIED' && independent
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Notice title="Limited entity-investing mandate">An effective appointment permits account viewing and guarded eligibility requests only when the exact offering and current authority qualify. The transaction limit is zero. This case does not approve a product, permit a subscription, move funds or grant wallet authority.</Notice>
    <Panel title="Entity representative case" action={<StatusBadge status={mandate.status} />}><DetailList rows={[{ label: 'Case reference', value: <span className={styles.mono}>{mandate.id}</span> }, { label: 'Legal entity', value: mandate.entity_name }, { label: 'Investment account', value: <span className={styles.mono}>{mandate.investment_account_id}</span> }, { label: 'Case revision', value: mandate.revision }, { label: 'Source admission revision', value: mandate.admission_revision }, { label: 'Requested expiry', value: dateLabel(mandate.requested_until) }, { label: 'Next responsible owner', value: representativeMandateNextOwnerLabel(mandate.next_owner) }, { label: 'Current scope', value: 'Account view; eligibility requests require the exact qualified offering' }, { label: 'Transaction limit', value: 'Zero' }, { label: 'Compliance reviewer', value: mandate.reviewer_user_id ?? 'Awaiting review' }, { label: 'Applied by', value: mandate.applied_by_user_id ?? 'Not yet applied' }]} /><h3 className={styles.sectionGap}>Appointment evidence reference</h3><p className={styles.copy}>{mandate.evidence_reference}</p>{mandate.review_notes ? <><h3>Recorded review rationale</h3><p className={styles.copy}>{mandate.review_notes}</p></> : null}</Panel>
    {additionalProposal ? <Panel title="Named representative and consent"><DetailList rows={[{ label: 'Entity applicant / proposer', value: <span className={styles.mono}>{mandate.applicant_user_id}</span> }, { label: 'Named representative', value: investingRepresentativeLabel(mandate) }, { label: 'Representative admission', value: <span className={styles.mono}>{mandate.representative_application_id ?? 'Unavailable'}</span> }, { label: 'Representative admission revision', value: mandate.representative_application_revision ?? 'Unavailable' }, { label: 'Proposal fingerprint', value: <span className={styles.mono}>{mandate.proposal_hash}</span> }, { label: 'Consent decision', value: mandate.consent_decision ?? 'Awaiting named representative' }, { label: 'Consent receipt', value: mandate.consent_receipt_id ?? 'Not recorded' }, { label: 'Responded at', value: dateLabel(mandate.responded_at) }]} />{mandate.status === 'PROPOSED' ? <Notice title="Named representative consent pending">Compliance cannot decide this proposal until the named person accepts its exact immutable facts.</Notice> : null}</Panel> : null}
    {source && appointmentDocument ? <Panel title="Approved entity admission and appointment evidence"><DetailList rows={[{ label: 'Source application', value: <span className={styles.mono}>{source.id}</span> }, { label: 'Entity name', value: source.details.company_name }, { label: 'Registration reference', value: source.details.registration_reference }, { label: 'Entity applicant', value: source.details.full_name }, { label: 'Admission expiry', value: dateLabel(source.approved_until) }, { label: 'Appointment document', value: appointmentDocument.title }]} /><div className={styles.sectionGap}><PrivateDocument document={appointmentDocument} /></div></Panel>
      : compliance && mandate.status === 'SUBMITTED' ? <Notice title="Source appointment evidence unavailable" tone="warning">The exact approved entity application or bound COMPANY document is not available in this review scope. Approval is disabled until it can be inspected.</Notice> : null}
  </div><div className={styles.stack}>
    {compliance ? <Panel title="Independent representative decision" description="The server rechecks current admission, document binding, MFA, review scope and principal separation."><CommandFeedback command={command} />
      {canReview ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (decision !== 'APPROVED' || Object.values(checks).every(Boolean)) void command.submit('review_investing_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Evidence checks</legend>{([
        { key: 'appointment', label: 'Bound COMPANY document and appointment evidence inspected' },
        { key: 'legal_entity', label: 'Legal entity, ownership and source admission checked' },
        { key: 'scope', label: 'Account-view and guarded eligibility-request scope, zero transaction limit and expiry checked' },
      ] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="CHANGES_REQUIRED">Request changes</option><option value="APPROVED">Approve for separate Super Admin application</option><option value="REJECTED">Reject appointment</option></select></Field><Field label="Decision rationale" hint="20 to 3,000 characters explaining the evidence and scope considered."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={decision === 'APPROVED' && !Object.values(checks).every(Boolean)}>Record entity mandate decision</button></fieldset></form>
        : <Notice title="Decision unavailable">{!independent ? 'You cannot review or apply your own representative case.' : mandate.status !== 'SUBMITTED' ? 'This case is not awaiting a Compliance decision.' : !admissionCurrent ? 'The admission or requested expiry is no longer current.' : !consentCurrent ? 'The named representative’s exact consent and bound appointment document must be current before a decision.' : 'Current independent review authority and the exact source evidence are required.'}</Notice>}
    </Panel> : null}
    {canApply ? <Panel title="Apply reviewed entity mandate" description="A separately authorised Super Admin activates only the reviewed limited scope."><CommandFeedback command={command} /><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('apply_investing_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision })}>Apply account-view mandate</button></Panel> : null}
    {canRevoke ? <Panel title="Revoke entity mandate" description="Revocation ends the representative's effective account access."><CommandFeedback command={command} /><form className={styles.form} onSubmit={event => { event.preventDefault(); if (revokeReason.trim().length >= 20) void command.submit('revoke_investing_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision, reason: revokeReason.trim() }) }}><Field label="Revocation reason" hint="20 to 1,000 characters. Record why the appointment is ending."><textarea required minLength={20} maxLength={1000} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={command.busy || command.unknown || revokeReason.trim().length < 20}>Revoke account-view mandate</button></form></Panel> : null}
  </div></div>
}

function ApplicationCaseRows({ snapshot, applications, operatingContext, environment }: { snapshot: PortalSnapshot; applications: PortalSnapshot['applications']; operatingContext?: PortalOperatingContext; environment?: PlatformEnvironment }) {
  return <>{applications.map(application => {
    const roleplayReview = validatedFundRoleplayApplicationReview(snapshot, application, operatingContext, environment)
    const roleplayAdmission = validatedFundRoleplayAdmission(application, environment)
    return <tr key={application.id}><td><strong>{application.persona === 'WEALTH_MANAGER' ? application.details.company_name || 'Customer organisation application' : application.details.full_name}</strong>{application.persona === 'WEALTH_MANAGER' ? <small>Representative: {application.details.full_name}</small> : null}<small>Submitted {dateLabel(application.submitted_at)}</small><small className={styles.mono}>{application.id}</small></td><td>{application.persona === 'INVESTOR' ? 'Investor admission' : application.admission_purpose === 'LEGACY_REHEARSAL' ? 'Historical rehearsal relationship' : 'Customer organisation admission'}{roleplayReview || roleplayAdmission ? <small>TEST role-play · not independent approval</small> : null}</td><td>{application.revision}</td><td><StatusBadge status={application.status} /><small>{roleplayReview ? 'TEST role-play Compliance decision' : roleplayAdmission ? application.status === 'APPROVED' ? 'Applicant: fund-scoped TEST account' : 'Applicant' : application.user_id === snapshot.actor.id ? 'Another reviewer required' : application.status === 'SUBMITTED' ? 'Compliance reviewer' : application.status === 'CHANGES_REQUIRED' || application.status === 'REJECTED' ? 'Applicant' : application.persona === 'WEALTH_MANAGER' ? 'Applicant: representative appointment' : 'Applicant: investment account'}</small></td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, application.id)}>{application.status !== 'SUBMITTED' ? 'Inspect saved decision' : roleplayReview ? 'Review TEST role-play case' : 'Review case'}</Link></td></tr>
  })}</>
}

function ComplianceQueue({ snapshot, operatingContext, environment }: { snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext; environment?: PlatformEnvironment }) {
  const passwordWorkflow = isTestPasswordWorkflow(snapshot)
  const applications = snapshot.applications.filter(item => item.status === 'SUBMITTED')
  const applicationHistory = snapshot.applications.filter(item => ['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'].includes(item.status))
  const products = snapshot.products.filter(item => item.status === 'IN_REVIEW'
    && item.offering_package?.compliance_status === 'PENDING'
    && item.offering_package.can_review_compliance === true
    && item.allowed_actions?.includes('review_product') === true
    && (!isTestPasswordWorkflow(snapshot) || hasOfferingCommandAccess(snapshot, 'review_product', operatingContext)))
  const entityRecords = validatedEntityProductEligibility(snapshot)
  const eligibilityUnavailable = !Array.isArray(snapshot.product_eligibility) || entityRecords === undefined
  const eligibilityCases = !passwordWorkflow && Array.isArray(snapshot.product_eligibility) ? snapshot.product_eligibility.filter(item => (item.status === 'SUBMITTED' || item.status === 'APPROVED' && item.can_revoke === true)
    && snapshot.products.some(product => product.id === item.product_id && product.organisation_id === item.organisation_id)) : []
  const entityEligibilityCases = !passwordWorkflow ? entityRecords?.filter(item => (item.status === 'SUBMITTED' || item.status === 'APPROVED' && item.can_revoke)
    && snapshot.products.some(product => product.id === item.product_id && product.organisation_id === item.organisation_id)) ?? []
    : []
  return <div className={styles.stack}>
    <div className={styles.statGrid}><Statistic label="Client applications" value={applications.length} hint="Submitted evidence packages in this review scope" /><Statistic label="Offering reviews" value={products.length} hint="Immutable offering packages awaiting Compliance" /><Statistic label="Product eligibility actions" value={eligibilityUnavailable ? 'Unavailable' : eligibilityCases.length + entityEligibilityCases.length} hint="Submitted cases and revocable approvals in this review scope" /><Statistic label="Product appointments" value={Array.isArray(snapshot.product_appointments) ? snapshot.product_appointments.filter(item => item.can_review || item.can_revoke).length : 'Unavailable'} hint="Exact-product service appointments requiring this role" /><Statistic label="Representative mandates" value={snapshot.mandate_queue_available === true && Array.isArray(snapshot.organisation_mandates) ? scopedMandates(snapshot, operatingContext).filter(item => item.can_review || item.can_revoke).length : 'Unavailable'} hint="Independent customer-role appointment cases" /><Statistic label="Entity investing mandates" value={snapshot.entity_mandate_queue_available === true && Array.isArray(snapshot.investing_representative_mandates) ? scopedEntityMandates(snapshot, operatingContext).filter(item => item.can_review || item.can_revoke).length : 'Unavailable'} hint="Separate legal-holder representative cases" /><Statistic label="Admission decision" value="BlockXOne reviewer" hint="Provider evidence and the platform decision are separate" /></div>
    {snapshot.actor.can_review && operatingContext?.mode === 'ROLE' && operatingContext.role === 'ComplianceOfficer'
      ? <ProviderConnectionCheck provider="SUMSUB" actorId={snapshot.actor.id} context={operatingContext} environment={environment} /> : null}
    <RepresentativeMandateQueue snapshot={snapshot} operatingContext={operatingContext} />
    <EntityInvestingMandateQueue snapshot={snapshot} operatingContext={operatingContext} />
    <ProductAppointmentQueue snapshot={snapshot} operatingContext={operatingContext} />
    <CustomerMonitoringQueue snapshot={snapshot} operatingContext={operatingContext} />
    <Panel title="Compliance work queue" description="Open a saved case, review its evidence and record an independent decision." flush>
      {eligibilityUnavailable ? <Notice title="Product eligibility records are unavailable" tone="warning">Refresh saved state before concluding that no product eligibility cases need review.</Notice> : null}
      {applications.length || products.length || eligibilityCases.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Case</th><th scope="col">Review type</th><th scope="col">Version</th><th scope="col">Status / next owner</th><th scope="col">Action</th></tr></thead><tbody>
        <ApplicationCaseRows snapshot={snapshot} applications={applications} operatingContext={operatingContext} environment={environment} />
        {products.map(product => <tr key={product.id}><td><strong>{product.terms.name}</strong><small>{product.terms.asset_type === 'FUND' ? 'Fund' : 'Real estate'} · {product.terms.issuer_name}</small></td><td>Offering Compliance</td><td>{product.offering_package ? `Package ${product.offering_package.package_number}` : 'No current package'}</td><td>{operatingContext && testOfferingReviewAvailable(snapshot, operatingContext, environment, product, 'review_product') ? 'TEST role-play review available' : product.created_by === snapshot.actor.id ? 'Another reviewer required' : 'Backend rechecks independent authority'}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, product.id)}>Review offering</Link></td></tr>)}
        {eligibilityCases.map(item => <tr key={item.id}><td><strong>{item.product_name ?? snapshot.products.find(product => product.id === item.product_id)?.terms.name ?? 'Published offering'}</strong><small>Investment account {item.investment_account_id}</small><small>Submitted {dateLabel(item.submitted_at)}</small><small className={styles.mono}>{item.id}</small></td><td>Product eligibility · {item.status === 'APPROVED' ? 'revocation available' : 'review requested'}</td><td>{item.revision}</td><td>{environment === 'TESTNET' && (item.status === 'APPROVED' ? validatedFundRoleplayEligibility(item, snapshot)?.revoke_allowed : validatedFundRoleplayEligibility(item, snapshot)?.review_allowed) ? 'TEST role-play review available' : item.holder_user_id === snapshot.actor.id ? 'Another reviewer required' : 'Backend rechecks independent authority'}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, item.id)}>{item.status === 'APPROVED' ? 'Inspect approval' : 'Review eligibility'}</Link></td></tr>)}
      </tbody></table></div> : eligibilityUnavailable || entityEligibilityCases.length ? null : <EmptyState title="No cases are waiting for review" description="Submitted customer, offering and product eligibility cases appear here within your appointed review scope. Nothing is approved automatically." />}
    </Panel>
    {applicationHistory.length ? <Panel title="Saved application decisions" description="Information requests, rejections and approvals stay on the same case. Only a resubmitted revision can receive a new decision." flush><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Case</th><th scope="col">Review type</th><th scope="col">Version</th><th scope="col">Status / next owner</th><th scope="col">Action</th></tr></thead><tbody><ApplicationCaseRows snapshot={snapshot} applications={applicationHistory} operatingContext={operatingContext} environment={environment} /></tbody></table></div></Panel> : null}
    {!passwordWorkflow ? <Panel title="Entity product eligibility queue" description="Separate legal-holder cases for the current issuer review scope. These decisions do not grant entity transaction authority." flush>
      {entityRecords === undefined ? <Notice title="Entity eligibility queue unavailable" tone="warning">Missing, invalid or ambiguous projections are unavailable, not an empty queue. Refresh saved state.</Notice>
        : entityEligibilityCases.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Legal holder / representative</th><th scope="col">Exact case and offering</th><th scope="col">Review state</th><th scope="col">Next owner</th><th scope="col">Action</th></tr></thead><tbody>{entityEligibilityCases.map(item => <tr key={item.id}><td><strong>{item.entity_name}</strong><small>Representative <span className={styles.mono}>{item.representative_user_id}</span></small></td><td><span className={styles.mono}>{item.id}</span><small>Case revision {item.revision} · mandate cycle {item.mandate_cycle} / revision {item.mandate_revision}</small><small className={styles.mono}>{item.offering_revision_id}</small></td><td><StatusBadge status={item.status} /><small>{item.status === 'APPROVED' ? item.effective ? 'Decision only; no transaction authority' : 'Stale decision; protective revocation available' : 'Independent review requested'}</small></td><td>{entityEligibilityNextOwner(item)}</td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, item.id)}>{item.status === 'APPROVED' ? 'Inspect entity approval' : 'Review entity eligibility'}</Link></td></tr>)}</tbody></table></div>
          : <EmptyState title="No entity eligibility cases in this scope" description="Only exact-issuer entity cases returned under your appointed scope appear here. Visibility is not a decision or document-sharing permission." />}
    </Panel> : null}
  </div>
}

function RoleHelp({ operatingContext }: { operatingContext?: PortalOperatingContext }) {
  const role = operatingContext?.mode === 'ROLE' ? getRoleDashboard(operatingContext.role) : undefined
  if (!role) return null
  return <details className={styles.panel}><summary className={styles.panelHeader}>Role, hand-offs and signing guidance</summary><div className={styles.panelBody}><h2>{role.title}</h2><p className={styles.copy}>{role.description}</p><ul>{role.responsibilities.map(item => <li key={item}>{item}</li>)}</ul><h3>Working with other roles</h3><ul>{role.handoffs.map(item => <li key={item}>{item}</li>)}</ul><h3>Wallet and signing</h3><p className={styles.copy}>{role.walletGuidance}</p><h3>Authority boundary</h3><p className={styles.copy}>{role.authorityBoundary}</p></div></details>
}

const PAGE: Record<PortalPath, { title: string; eyebrow: string; description: string; active: PortalNavigationKey }> = {
  '/portal': { title: 'Your BlockXOne workspace.', eyebrow: 'Welcome to BlockXOne', description: 'Your saved relationships, assignments and work queues are kept separate.', active: 'overview' },
  '/portal/onboarding': { title: 'Start with your identity.', eyebrow: 'Client onboarding', description: 'Apply as an investor or wealth manager. Your information, evidence and review decision stay connected.', active: 'onboarding' },
  '/portal/products': { title: 'Products & offerings.', eyebrow: 'Product management', description: 'Structure fund and real-estate offerings and follow their saved subscription orders.', active: 'products' },
  '/portal/products/new': { title: 'Structure a new product.', eyebrow: 'Product management / new product', description: 'Define the issuer, asset, economics and investor disclosures before submitting a single version for review.', active: 'products' },
  '/portal/products/detail': { title: 'Product workspace.', eyebrow: 'Product management / offering', description: 'One product record connects terms, independent review, publication and incoming orders.', active: 'products' },
  '/portal/compliance': { title: 'Review with context.', eyebrow: 'Compliance work queue', description: 'Review saved applicant evidence and offering terms within your appointed scope.', active: 'compliance' },
  '/portal/compliance/detail': { title: 'Review case.', eyebrow: 'Compliance / case review', description: 'Read the source evidence and record a reasoned decision against the current revision.', active: 'compliance' },
  '/portal/opportunities': { title: 'Explore investment opportunities.', eyebrow: 'Investor marketplace', description: 'Read published product terms and disclosures before submitting a subscription instruction.', active: 'opportunities' },
  '/portal/opportunities/detail': { title: 'Investment opportunity.', eyebrow: 'Investor marketplace / offering', description: 'Review the mandate, unit economics, eligibility rules and exact offering documents.', active: 'opportunities' },
  '/portal/portfolio': { title: 'Your investment account and instructions.', eyebrow: 'Investment account / orders', description: 'Open or review your investment account and track the same subscription orders seen by the authorised issuer. Reserved units are not funded ownership.', active: 'portfolio' },
  '/portal/orders/detail': { title: 'Subscription funding record.', eyebrow: 'Subscription / funding and reconciliation', description: 'Follow the same accepted order through funding instructions, verified evidence and independent accounting.', active: 'overview' },
}

type PortalScreenProps = { data: PortalPageData; view: PortalPath; id?: string; operatingContext?: PortalOperatingContext; release?: PlatformRelease; scope?: DashboardScope; scopes?: DashboardScope[] }

export function PortalScreen(props: PortalScreenProps) {
  // A role/organisation change must not retain another context's client snapshot.
  return <OperatingPortalScreen key={`${props.data.user.id}:${props.release?.environment ?? 'UNSPECIFIED'}:${portalContextKey(props.operatingContext ?? APPLICANT_CONTEXT)}:${props.view}:${props.id ?? ''}`} {...props} />
}

function OperatingPortalScreen({ data, view, id, operatingContext, release, scope, scopes }: PortalScreenProps) {
  const [snapshot, setSnapshot] = useState(data.snapshot)
  const [refreshMessage, setRefreshMessage] = useState('')
  const [appointmentHandoff, setAppointmentHandoff] = useState<{ id: string; actorId: string; environment: PlatformEnvironment; context: string } | null>(null)
  const appointmentHandoffRegion = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (appointmentHandoff && !snapshot.product_appointments?.some(item => item.id === appointmentHandoff.id)) appointmentHandoffRegion.current?.focus()
  }, [appointmentHandoff, snapshot.product_appointments])
  const [signerSetupOpen, setSignerSetupOpen] = useState(false), [signerSetupMounted, setSignerSetupMounted] = useState(false)
  const [investorEvidenceOpen, setInvestorEvidenceOpen] = useState(false)
  const signerSetupRegion = useRef<HTMLDivElement | null>(null)
  useEffect(() => { if (signerSetupOpen) signerSetupRegion.current?.focus() }, [signerSetupOpen])
  const context = operatingContext ?? APPLICANT_CONTEXT
  const fundLifecycle = release ? validatedFundLifecycle(snapshot.fund_lifecycle, data.user.id, context, release.environment) : null
  const fundOperatingProducts = Boolean(fundLifecycle && release && hasFundOperatingProducts(snapshot, context, release.environment))
  async function refreshFund() {
    setRefreshMessage('Refreshing saved fund progress…')
    try {
      const response = await fetch('/api/portal/fund-lifecycle/read', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': data.user.id }, body: JSON.stringify({ operating_context: context }), signal: AbortSignal.timeout(25000) })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The saved progress could not be read. No new transaction was started.')
      const result = await response.json()
      if (!response.ok || result.error || !result.snapshot || result.snapshot.actor?.id !== data.user.id
        || !portalContextMatches(result.snapshot.operating_context, context) || !release
        || !validatedFundLifecycle(result.snapshot.fund_lifecycle, data.user.id, context, release.environment)) throw new Error(typeof result.error === 'string' ? result.error : 'Saved progress could not be verified. Keep the existing request and refresh again.')
      setSnapshot(result.snapshot); setRefreshMessage('Saved fund progress updated.')
    } catch (error) { setRefreshMessage(error instanceof Error ? error.message : 'Progress could not be refreshed. No new transaction was started.') }
  }
  const access = snapshot.stage2_access === undefined ? null : stage2AccessSchema.safeParse(snapshot.stage2_access)
  const invalidAccess = access && (!access.success || access.data.actor_id !== data.user.id || access.data.actor_id !== snapshot.actor.id
    || access.data.environment !== release?.environment || !operatingContext
    || !portalContextMatches(access.data.operating_context, operatingContext) || !portalContextMatches(snapshot.operating_context, operatingContext))
  const lostAccess = data.snapshot.stage2_access !== undefined && (snapshot.stage2_access === undefined
    || snapshot.stage2_access.session_mode !== data.snapshot.stage2_access.session_mode)
  const offeringAccess = validatedOfferingAccess(snapshot, operatingContext, release?.environment)
  const evaluation = validatedEvaluationAccess(snapshot, operatingContext, release?.environment)
  const initialEvaluation = validatedEvaluationAccess(data.snapshot, operatingContext, release?.environment)
  const invalidEvaluation = snapshot.evaluation_access !== undefined && (!evaluation || !release || !operatingContext || evaluation.actor_id !== data.user.id
    || !evaluation.allowed_views.some(path => path === view))
  const lostEvaluation = data.snapshot.evaluation_access !== undefined && (!initialEvaluation || !evaluation
    || !sameEvaluationGrant(evaluation, initialEvaluation))
  const invalidOfferingAccess = snapshot.offering_access !== undefined && (!offeringAccess || !operatingContext || !release
    || offeringAccess.actor_id !== data.user.id || !portalContextMatches(snapshot.operating_context, operatingContext))
  const initialOfferingAccess = validatedOfferingAccess(data.snapshot, operatingContext, release?.environment)
  const lostOfferingAccess = data.snapshot.offering_access !== undefined && (!initialOfferingAccess || !offeringAccess
    || offeringAccess.actor_id !== initialOfferingAccess.actor_id || offeringAccess.environment !== initialOfferingAccess.environment
    || offeringAccess.session_mode !== initialOfferingAccess.session_mode
    || !portalContextMatches(offeringAccess.operating_context, initialOfferingAccess.operating_context))
  if ('rehearsal' in data.snapshot || 'rehearsal' in snapshot || invalidAccess || lostAccess || invalidOfferingAccess || lostOfferingAccess || invalidEvaluation || lostEvaluation) return <Notice title="Saved admission state unavailable" tone="warning">The saved state does not match this signed-in person, environment and operating capacity. Refresh saved state before continuing; your application history is unchanged.</Notice>
  const passwordAdmission = isTestPasswordAdmission(snapshot)
  const passwordOffering = isTestPasswordOffering(snapshot)
  const passwordWorkflow = isTestPasswordWorkflow(snapshot)
  const workflowPermits = (command: string) => evaluation ? evaluation.allowed_commands.some(allowed => allowed === command) : !passwordWorkflow || hasStage2CommandAccess(snapshot, command, operatingContext) || hasOfferingCommandAccess(snapshot, command, operatingContext)
  if (!evaluation && passwordWorkflow && operatingContext?.mode === 'ROLE' && !['ComplianceOfficer', 'SuperAdmin'].includes(operatingContext.role)
    && !(passwordOffering && ['OfferingManager', 'IssuerFundManager'].includes(operatingContext.role))) return <Notice title="Action unavailable in this capacity" tone="warning">Password-only workflow access does not open this operating role. Open your personal application capacity; financial and signing powers remain separately guarded.</Notice>
  if (passwordWorkflow && (!operatingContext || !portalViewAllowed(view, operatingContext, snapshot, id, release?.environment))) return <Notice title="Action unavailable in this capacity" tone="warning">Open your assigned workflow workspace. Financial and signing actions are not granted by customer admission or package preparation.</Notice>
  const organisations = evaluation ? snapshot.organisations.filter(org => evaluation.operating_context.role === 'OfferingManager'
    && org.id === evaluation.product_organisation_id && org.authority_source === 'TEST_EVALUATION' && org.status === 'ACTIVE'
    && org.native_organisation_id === evaluation.operating_context.organisationId && org.roles.includes('OfferingManager')) : productManagementOrganisations(snapshot, operatingContext, release?.environment)
  const managerContext = operatingContext?.mode !== 'ROLE' || operatingContext.role === 'OfferingManager'
  const createOrganisations = managerContext && workflowPermits('create_product') && (!evaluation || evaluation.allowed_views.includes('/portal/products/new')) ? organisations.filter(org => org.authority_source !== 'TEST_ROLE_PLAY' && permits(org, 'create_product', operatingContext)) : []
  const canReview = snapshot.actor.can_review && operatingContext?.mode === 'ROLE' && operatingContext.role === 'ComplianceOfficer'
  const role = operatingContext?.mode === 'ROLE' ? operatingContext.role : undefined
  const ownApplications = snapshot.applications.filter(item => item.user_id === snapshot.actor.id)
  // An applicant route is not an Investor role. Only an explicit investor
  // application (or a server-returned Investor operating role) opens these
  // surfaces; a wealth-manager-only relationship must not fall into them.
  const hasInvestorCapacity = ownApplications.some(item => item.persona === 'INVESTOR')
  const investorView = role === 'Investor' || operatingContext?.mode === 'APPLICANT' && hasInvestorCapacity
  const hasCurrentIndividualInvestor = ownApplications.some(item => item.persona === 'INVESTOR' && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === 'INDIVIDUAL'
    && item.status === 'APPROVED' && Boolean(item.approved_until) && Date.parse(item.approved_until!) > Date.now())
  const hasEntityInvestorCapacity = ownApplications.some(item => item.persona === 'INVESTOR' && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === 'ENTITY')
  const hasEntityAccountView = (snapshot.entity_investment_accounts ?? []).some(item => item?.can_view === true || item?.can_request_eligibility === true)
  const hasNamedRepresentativeProposal = operatingContext?.mode === 'APPLICANT' && snapshot.investing_representative_mandates?.some(item => item.representative_user_id === snapshot.actor.id && item.applicant_user_id !== snapshot.actor.id && Boolean(item.proposal_hash))
  const entityOnly = !hasCurrentIndividualInvestor && (hasEntityInvestorCapacity || hasEntityAccountView)
  const canInvest = role === 'Investor' || (operatingContext?.mode !== 'ROLE' && (hasInvestorCapacity || hasEntityAccountView))
  const standardIssuerProducts = snapshot.products.filter(product => standardTestIssuerProductAvailable(snapshot, context, release?.environment, product))
  const capabilities = evaluation ? { manageProducts: role === 'OfferingManager' && organisations.length > 0, reviewCompliance: false, invest: false, evaluationInvestor: role === 'Investor', evaluationViews: evaluation.allowed_views }
    : { manageProducts: !passwordWorkflow && organisations.length > 0 || standardIssuerProducts.length > 0 || passwordOffering && (role === 'OfferingManager' || role === 'IssuerFundManager'), reviewCompliance: canReview, invest: !passwordWorkflow && canInvest }
  const ownSubscriptions = snapshot.subscriptions.filter(item => item.investor_id === snapshot.actor.id)
  const managedProducts = standardIssuerProducts.length ? standardIssuerProducts : passwordOffering && operatingContext?.mode === 'ROLE' && role === 'IssuerFundManager'
    ? appointedIssuerProducts(snapshot, operatingContext)
    : snapshot.products.filter(product => organisations.some(org => org.id === product.organisation_id
      && (org.authority_source !== 'TEST_ROLE_PLAY' || testRoleplayManagerProduct(snapshot, product, operatingContext, release?.environment))))
  const orderOrganisations = passwordWorkflow ? [] : organisations.filter(org => permits(org, 'read_orders', operatingContext))
  const incomingSubscriptions = snapshot.subscriptions.filter(item => orderOrganisations.some(org => org.id === item.organisation_id) && managedProducts.some(product => product.id === item.product_id))
  const published = snapshot.products.filter(isOfferingSubscribable)
  const detailProducts = view === '/portal/products/detail' ? managedProducts : view === '/portal/opportunities/detail' ? published : canReview ? snapshot.products : []
  const selected = id ? detailProducts.find(product => product.id === id) : undefined
  const selectedApplication = id && canReview ? snapshot.applications.find(application => application.id === id) : undefined
  const matchingEligibility = id && canReview && !passwordWorkflow ? [...(Array.isArray(snapshot.product_eligibility) ? snapshot.product_eligibility : []), ...(validatedEntityProductEligibility(snapshot) ?? [])].filter(item => item.id === id
    && snapshot.products.some(product => product.id === item.product_id && product.organisation_id === item.organisation_id)) : []
  const selectedEligibility = matchingEligibility.length === 1 ? matchingEligibility[0] : undefined
  const selectedMandate = id ? scopedMandates(snapshot, operatingContext).find(item => item.id === id) : undefined
  const selectedEntityMandate = id ? scopedEntityMandates(snapshot, operatingContext).find(item => item.id === id) : undefined
  const selectedProductAppointment = id ? snapshot.product_appointments?.find(item => item.id === id) : undefined
  const reviewSnapshot = canReview ? snapshot : { ...snapshot, actor: { ...snapshot.actor, can_review: false } }
  const config = PAGE[view]
  const roleTitle = evaluation ? role === 'OfferingManager' ? 'Your TEST fund and property drafts.' : 'Your TEST investor workspace.' : role === 'Investor' ? 'Your investments and orders.' : passwordOffering && role === 'OfferingManager' ? 'Your products and offering packages.' : passwordOffering && role === 'IssuerFundManager' ? 'Your appointed offering packages.' : role === 'OfferingManager' || role === 'IssuerFundManager' ? 'Your products and incoming orders.' : role === 'ComplianceOfficer' ? 'Your compliance work queue.' : role === 'SuperAdmin' ? 'Your platform administration queue.' : role === 'TreasuryOperator' ? 'Your funding operations.' : role === 'FinancialController' ? 'Your independent reconciliation queue.' : undefined
  const title = selected && ['/portal/products/detail', '/portal/opportunities/detail'].includes(view) ? selected.terms.name : selectedApplication && view === '/portal/compliance/detail' ? selectedApplication.details.full_name : selectedEligibility && view === '/portal/compliance/detail' ? `Eligibility: ${selectedEligibility.product_name ?? snapshot.products.find(product => product.id === selectedEligibility.product_id)?.terms.name ?? 'offering'}` : selectedEntityMandate && view === '/portal/compliance/detail' ? `Entity mandate: ${selectedEntityMandate.entity_name}` : selectedMandate && view === '/portal/compliance/detail' ? `Representative appointment: ${selectedMandate.organisation_name}` : selectedProductAppointment && view === '/portal/compliance/detail' ? 'Product service appointment' : view === '/portal' && roleTitle ? roleTitle : config.title
  const href = (path: PortalPath, recordId?: string) => portalScopeHref(path, operatingContext, recordId)
  const parentPath: PortalPath = config.active === 'products' ? '/portal/products' : config.active === 'compliance' ? '/portal/compliance' : config.active === 'portfolio' ? '/portal/portfolio' : config.active === 'onboarding' ? '/portal/onboarding' : '/portal/opportunities'
  const breadcrumbs = view === '/portal' ? [] : view === '/portal/orders/detail' ? [{ label: 'My operating workspace', href: href('/portal') }, { label: 'Subscription funding' }] : [{ label: config.active === 'products' ? 'Products & offerings' : config.active === 'compliance' ? 'Compliance' : config.active === 'opportunities' ? 'Opportunities' : config.active === 'portfolio' ? 'My orders' : 'My onboarding', href: view.includes('/detail') || view.endsWith('/new') ? href(parentPath) : undefined }, ...(view.includes('/detail') ? [{ label: selected?.terms.name || selectedApplication?.details.full_name || (selectedEntityMandate ? 'Entity investing mandate' : selectedMandate ? 'Representative appointment' : selectedEligibility ? 'Product eligibility case' : selectedProductAppointment ? 'Product service appointment' : 'Details') }] : view.endsWith('/new') ? [{ label: 'New product' }] : [])]

  function unavailable() { return <Panel title="Record unavailable"><EmptyState title="This record is not available in your current operating scope" description="It may have changed or belong to another organisation. No access is granted by a shared URL." href={href('/portal')} action="Return to dashboard" /></Panel> }
  const fundingOutstanding = (subscription: PortalSubscription) => subscription.status === 'AWAITING_FUNDING' && !snapshot.funding?.obligations.some(item => item.subscription_id === subscription.id && item.state === 'RECONCILED')
  function productStats() { return <div className={styles.statGrid}><Statistic label="Products in your scope" value={managedProducts.length} hint="Current organisation and acting role" /><Statistic label="Awaiting review" value={managedProducts.filter(product => product.status === 'IN_REVIEW').length} hint="Independent decision required" />{passwordWorkflow ? <Statistic label="Approved unopened packages" value={managedProducts.filter(product => product.status === 'APPROVED').length} hint="Not published, funded or issued ownership" /> : <Statistic label="Incoming orders awaiting funding" value={orderOrganisations.length ? incomingSubscriptions.filter(fundingOutstanding).length : 'Unavailable'} hint={orderOrganisations.length ? 'Saved instructions, not settled investments' : 'Order-reading authority is not available in this scope'} />}</div> }
  function orderStats() {
    const pending = ownSubscriptions.filter(fundingOutstanding)
    const totals = new Map<'TST' | 'ZAR_TEST', bigint>()
    for (const subscription of pending) if (subscription.currency) totals.set(subscription.currency, (totals.get(subscription.currency) ?? 0n) + BigInt(subscription.amount_minor))
    const amount = !pending.length ? 'No pending amount' : pending.some(item => !item.currency) ? 'Currency unavailable; inspect each order'
      : [...totals.entries()].map(([currency, total]) => money(total.toString(), currency)).join(' · ')
    return <div className={styles.statGrid}><Statistic label="Subscription instructions" value={ownSubscriptions.length} hint="Your saved investment orders" /><Statistic label="Awaiting funding" value={pending.length} hint="Reserved, not issued" /><Statistic label="Requested subscription amount" value={amount} hint="Pending instructions only; different assets are shown separately" /></div>
  }
  function investorWork() {
    if (passwordAdmission) return <InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} />
    return entityOnly
      ? <div className={styles.stack}><InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /><Panel title="Entity offering access" description="A legal-holder account and limited representative appointment do not create a product qualification or order."><Notice title="Entity orders are not enabled">Product eligibility has a separate guarded request and independent decision. Entity subscription, settlement and ownership workflows remain unavailable. Existing individual orders, if any, are separate records.</Notice><Link href={href('/portal/opportunities')} className={styles.textLink}>Review published entity offerings and eligibility</Link></Panel></div>
      : <div className={styles.stack}>
        <Panel title="Your investing workspace" description="Browse an offering, reserve your investment, then follow its payment and issued units in one saved order.">
          <div className={styles.actions}><Link href={href('/portal/opportunities')} className={styles.button}>Browse investment opportunities</Link><Link href={href('/portal/portfolio')} className={styles.buttonSecondary}>View my orders and holdings</Link></div>
        </Panel>
        {orderStats()}
        <InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} />
        <Opportunities products={published} snapshot={snapshot} operatingContext={operatingContext} />
        {fundLifecycle?.availability === 'AVAILABLE' && fundLifecycle.products.some(item => !published.some(product => product.id === item.product_id)) ? <Panel title="Funds preparing to open" description="These are scoped progress records, not offers you can buy."><ul>{fundLifecycle.products.filter(item => !published.some(product => product.id === item.product_id)).map(item => <li key={item.product_id}><strong>{item.product_name}</strong><p>Not open for investment. The issuer and its appointed operators must finish the fund opening requirements. No payment is available.</p></li>)}</ul></Panel> : null}
        {!fundLifecycle || fundLifecycle.availability !== 'AVAILABLE' ? <Notice title="Fund payment and holdings status unavailable">The current fund records could not be verified. This is not an empty portfolio or confirmation that no investment exists.</Notice> : null}
        <SubscriptionOrders subscriptions={ownSubscriptions} products={snapshot.products} incoming={false} onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} />
      </div>
  }
  function productWork() {
    const issuerCases = role === 'IssuerFundManager' && workflowPermits('review_offering_issuer') ? managedProducts.filter(product => product.offering_package?.can_review_issuer === true && product.allowed_actions?.includes('review_offering_issuer')) : []
    return <div className={styles.stack}>{productStats()}{role === 'IssuerFundManager' ? <Panel title="Packages awaiting your issuer decision" description="Only server-authorised packages appear; preparing a product does not grant the right to approve it.">{issuerCases.length ? <ul>{issuerCases.map(product => <li key={product.id}><Link href={href('/portal/products/detail', product.id)} className={styles.textLink}>{product.terms.name} · package {product.offering_package?.package_number}</Link></li>)}</ul> : <p className={styles.muted}>No package is currently assigned to this issuer context for a decision. An issuer appointment is separate from a manager relationship.</p>}</Panel> : null}<ProductRegister products={managedProducts} canCreate={createOrganisations.length > 0} operatingContext={operatingContext} />{passwordWorkflow ? <Notice title="Package preparation and review">This connected workflow prepares and reviews the exact offering package. An approved package is still unopened; actual e-signature evidence and verified technical readiness remain separate requirements before payment or issuance.</Notice> : orderOrganisations.length ? <SubscriptionOrders subscriptions={incomingSubscriptions} products={managedProducts} incoming onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /> : <Notice title="Order access unavailable">Your current mandate does not provide an incoming-order view. This is not an empty order book or a zero balance.</Notice>}</div>
  }
  function content() {
    if (view === '/portal/compliance/detail' && id && appointmentHandoff?.id === id
      && appointmentHandoff.actorId === data.user.id && snapshot.actor.id === data.user.id
      && appointmentHandoff.environment === release?.environment && appointmentHandoff.context === portalContextKey(context)
      && portalContextMatches(snapshot.operating_context, context) && !selectedProductAppointment) return <div ref={appointmentHandoffRegion} role="status" aria-live="polite" tabIndex={-1}><Notice title="Appointment change saved">
      <p>Your change was saved. This case is no longer shown in your current role. Return to your work queue for your next task.</p>
      {role === 'ComplianceOfficer' ? <p>Approved appointments require Super Admin application before they become effective.</p> : null}
      <Link href={href(role === 'ComplianceOfficer' ? '/portal/compliance' : '/portal')} className={styles.buttonSecondary}>
        {role === 'ComplianceOfficer' ? 'Return to Compliance work queue' : 'Return to Super Admin dashboard'}
      </Link>
    </Notice></div>
    if (fundLifecycle?.availability === 'AVAILABLE') {
      const fund = fundLifecycle.products.find(item => item.product_id === id)
      const orderFund = fundLifecycle.products.find(item => item.orders.some(order => order.subscription_id === id))
      if (view === '/portal/products/detail' && fund && !selected) return <div className={styles.stack}>
        <FundLifecycleWorkspace lifecycle={fund} actorId={snapshot.actor.id} operatingContext={context} onRefresh={refreshFund} />
        {release?.environment === 'TESTNET' && context.mode === 'ROLE' && context.role === 'TokenisationAgent'
          && snapshot.actor.id === data.user.id && portalContextMatches(snapshot.operating_context, context) ? <>
          <button id={`fund-${fund.product_id}-signer-setup-toggle`} type="button" className={styles.buttonSecondary}
            aria-expanded={signerSetupOpen} aria-controls={`fund-${fund.product_id}-signer-setup`}
            onClick={() => { setSignerSetupMounted(true); setSignerSetupOpen(value => !value) }}>
            {signerSetupOpen ? 'Hide signer wallets and blockchain setup' : 'Open signer wallets and blockchain setup'}
          </button>
          {signerSetupMounted ? <div id={`fund-${fund.product_id}-signer-setup`} ref={signerSetupRegion} role="region"
            aria-labelledby={`fund-${fund.product_id}-signer-setup-toggle`} tabIndex={-1} hidden={!signerSetupOpen}>
            <FundSetup key={`${data.user.id}:${fund.product_id}:${portalContextKey(context)}`} productId={fund.product_id}
              productRevision={fund.product_revision} actorId={data.user.id} operatingContext={context} onRefresh={refreshFund} />
          </div> : null}
        </> : null}
      </div>
      if (view === '/portal/orders/detail' && orderFund && id) {
        const subscription = snapshot.subscriptions.find(item => item.id === id)
        return <div className={styles.stack}><FundLifecycleOrder lifecycle={orderFund} subscriptionId={id} actorId={snapshot.actor.id} operatingContext={context} onRefresh={refreshFund} offeringOpen={published.some(product => product.id === orderFund.product_id)} />
          {subscription && snapshot.funding ? <section aria-label="Payment reference and reconciliation"><FundingOrderDetail subscription={subscription} snapshot={snapshot} operatingContext={context} onSaved={setSnapshot} fundFlow={{ allocationBasisCurrent: orderFund.orders.find(order => order.subscription_id === id)?.payment_allocation_basis?.current === true }} /></section> : null}</div>
      }
      if (view === '/portal/products' && fundOperatingProducts) return <FundLifecycleDashboard snapshot={fundLifecycle} role={role} actorId={snapshot.actor.id} operatingContext={context} onRefresh={refreshFund} />
      const currentLimitedPackage = view === '/portal/products/detail' && selected
        && (testRoleplayManagerProduct(snapshot, selected, context, release?.environment)
          || standardTestIssuerProductAvailable(snapshot, context, release?.environment, selected))
      if (snapshot.base_records_available === false && !currentLimitedPackage) return investorView ? <Notice title="Investor account records are unavailable">The current account, offering and order records could not be verified. Refresh saved state before investing; the fund progress record does not establish investor access.</Notice> : view === '/portal/products' && isFundOperatingContext(context) && !fundOperatingProducts ? unavailable()
        : <FundLifecycleDashboard snapshot={fundLifecycle} role={role} actorId={snapshot.actor.id} operatingContext={context} onRefresh={refreshFund} />
    }
    if (evaluation) {
      if (view === '/portal/onboarding') return <Link href="/portal/onboarding?mode=applicant" className={styles.button}>View my separate application</Link>
      if (role === 'OfferingManager') {
        if (!organisations.length) return unavailable()
        if (view === '/portal/products/new') return createOrganisations.length ? <ProductForm organisations={createOrganisations} onSaved={setSnapshot} operatingContext={operatingContext} /> : unavailable()
        if (view === '/portal/products/detail') {
          if (!selected) return unavailable()
          const organisation = organisations.find(org => org.id === selected.organisation_id)
          if (!organisation) return unavailable()
          const commands = (organisation.capabilities ?? []).filter(command => workflowPermits(command) && ['create_product', 'save_product', 'submit_product', 'request_product_service_appointment'].includes(command))
          const canEdit = commands.includes('save_product') && selected.allowed_actions?.includes('save_product') === true && ['DRAFT', 'CHANGES_REQUIRED'].includes(selected.status)
          return <ProductDetailWorkspace key={selected.id} product={selected} snapshot={snapshot} organisations={[organisation]} operatingContext={operatingContext}
            onSaved={setSnapshot} onRefresh={refreshFund} availableCommands={commands} canEdit={canEdit} canViewIssuerRationale canReviewIssuer={false}
            lifecycle={fundLifecycle?.products.find(item => item.product_id === selected.id)} />
        }
        if (view === '/portal' || view === '/portal/products') return <ProductRegister products={managedProducts} canCreate={createOrganisations.length > 0} operatingContext={operatingContext} />
      }
      if (role === 'Investor') {
        if (view === '/portal/portfolio') return <Panel title="Your TEST portfolio"><EmptyState title="Holdings are not enabled in this TEST workspace" description="Evaluation access does not create investments, balances or performance history. Buying, funding and issuance are not enabled here." href={href('/portal/opportunities')} action="Browse TEST offerings" /></Panel>
        if (view === '/portal/opportunities/detail') return selected && isOfferingSubscribable(selected) ? <div className={styles.stack}><ProductFacts product={selected} /><ProductNarrative product={selected} /><Notice title="Read-only TEST offering">Purchasing, eligibility requests and investment-account creation are not enabled in this evaluation workspace.</Notice></div> : unavailable()
        if (view === '/portal' || view === '/portal/opportunities') return <Panel title="Browse TEST offerings" description="Only currently published, technically verified offerings returned by the server appear. Browsing does not grant purchase eligibility.">{published.length ? <div className={styles.productGrid}>{published.map(product => <ProductCard key={product.id} product={product} operatingContext={operatingContext} />)}</div> : <EmptyState title="No published TEST offerings yet" description="Managers can prepare fund and property drafts. Those drafts are not investments and will not appear here until the existing publication requirements are met." />}</Panel>
      }
      return unavailable()
    }
    if (view === '/portal/orders/detail') {
      const subscription = snapshot.subscriptions.find(item => item.id === id)
      const context = operatingContext ?? APPLICANT_CONTEXT
      const allowedRole = context.mode === 'APPLICANT' || ['Investor', 'OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role)
      const owned = subscription?.investor_id === snapshot.actor.id && (context.mode === 'APPLICANT' || context.role === 'Investor')
      const assigned = subscription && context.mode === 'ROLE' && ['OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role) && snapshot.organisations.some(org => org.id === subscription.organisation_id && org.status === 'ACTIVE' && org.authority_source === 'NATIVE_BINDING' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role))
      const legacyOwner = subscription && context.mode === 'APPLICANT' && orderOrganisations.some(org => org.id === subscription.organisation_id)
      return subscription && allowedRole && (owned || assigned || legacyOwner) ? <FundingOrderDetail subscription={subscription} snapshot={snapshot} operatingContext={context} onSaved={setSnapshot} /> : unavailable()
    }
    if (view === '/portal/onboarding') return <Link href="/portal/onboarding?mode=applicant" className={styles.button}>Open my application capacities</Link>
    if (view === '/portal/products/new') return createOrganisations.length ? <ProductForm organisations={createOrganisations} onSaved={setSnapshot} operatingContext={operatingContext} /> : <Panel title="Product access"><EmptyState title="A scoped product-creation mandate is required" description="An organisation name or another role assignment does not grant product-creation access in this operating scope." href={href('/portal')} action="Return to dashboard" /></Panel>
    if (view === '/portal/products') return productWork()
    if (view === '/portal/products/detail') {
      if (!selected) return unavailable()
      const organisation = organisations.find(org => org.id === selected.organisation_id)
      const canViewIssuerRationale = Boolean(managerContext && organisation && permits(organisation, 'save_product', operatingContext))
      const canEdit = Boolean(managerContext && workflowPermits('save_product') && organisation && permits(organisation, 'save_product', operatingContext)
        && selected.allowed_actions?.includes('save_product') === true)
      return <div className={styles.stack}><ProductDetailWorkspace key={selected.id} product={selected} snapshot={snapshot}
        organisations={organisations.filter(org => permits(org, 'save_product', operatingContext))} operatingContext={operatingContext} environment={release?.environment} onSaved={setSnapshot} onRefresh={refreshFund}
        availableCommands={managerContext && organisation ? organisation.capabilities ?? (operatingContext ? [] : undefined) : []} canEdit={canEdit && ['DRAFT', 'CHANGES_REQUIRED'].includes(selected.status)}
        canViewIssuerRationale={canViewIssuerRationale} canReviewIssuer={role === 'IssuerFundManager'}
        lifecycle={fundLifecycle?.products.find(item => item.product_id === selected.id)} />
        {!passwordWorkflow ? organisation && permits(organisation, 'read_orders', operatingContext) ? <SubscriptionOrders subscriptions={incomingSubscriptions.filter(item => item.product_id === selected.id)} products={[selected]} incoming onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /> : <Notice title="Order access unavailable">This product’s incoming-order book is not available under your current mandate.</Notice> : null}</div>
    }
    if (view === '/portal/compliance') return canReview ? <ComplianceQueue snapshot={reviewSnapshot} operatingContext={operatingContext} environment={release?.environment} /> : role === 'SuperAdmin' ? <div className={styles.stack}><RepresentativeMandateQueue snapshot={snapshot} operatingContext={operatingContext} /><EntityInvestingMandateQueue snapshot={snapshot} operatingContext={operatingContext} /><ProductAppointmentQueue snapshot={snapshot} operatingContext={operatingContext} /></div> : unavailable()
    if (view === '/portal/compliance/detail') {
      if (selectedEntityMandate) return <EntityInvestingMandateDecision key={`${selectedEntityMandate.id}-${selectedEntityMandate.revision}`} mandate={selectedEntityMandate} snapshot={snapshot} operatingContext={operatingContext ?? APPLICANT_CONTEXT} onSaved={setSnapshot} />
      if (selectedMandate) return <RepresentativeMandateDecision key={`${selectedMandate.id}-${selectedMandate.revision}`} mandate={selectedMandate} snapshot={snapshot} operatingContext={operatingContext ?? APPLICANT_CONTEXT} onSaved={setSnapshot} />
      if (selectedProductAppointment && (role === 'ComplianceOfficer' || role === 'SuperAdmin')) return <ProductAppointmentDecision key={`${selectedProductAppointment.id}-${selectedProductAppointment.revision}`} appointment={selectedProductAppointment} snapshot={snapshot} onSaved={value => {
        if (!release || value.actor.id !== data.user.id || !portalContextMatches(value.operating_context, context)) return
        // This callback runs only after the command client confirms its result.
        // Remember the handoff, not the old case or an inferred decision status.
        setAppointmentHandoff({ id: selectedProductAppointment.id, actorId: data.user.id, environment: release.environment, context: portalContextKey(context) })
        setSnapshot(value)
      }} />
      if (!canReview) return unavailable()
      return selectedApplication ? <div className={styles.stack}><ApplicationReview key={`${selectedApplication.id}-${selectedApplication.revision}`} application={selectedApplication} snapshot={reviewSnapshot} onSaved={setSnapshot} environment={release?.environment} />{!passwordWorkflow && selectedApplication.status === 'APPROVED' ? <CustomerMonitoringDecision key={`${selectedApplication.id}:${snapshot.customer_monitoring?.find(item => item.application_id === selectedApplication.id)?.case_revision ?? 'unavailable'}`} application={selectedApplication} snapshot={reviewSnapshot} operatingContext={operatingContext} onSaved={setSnapshot} /> : null}</div> : selectedEligibility ? <ProductEligibilityReview key={`${selectedEligibility.id}-${selectedEligibility.revision}`} eligibility={selectedEligibility} product={snapshot.products.find(product => product.id === selectedEligibility.product_id)} snapshot={reviewSnapshot} onSaved={setSnapshot} /> : selected ? <div className={styles.stack}><ProductReview key={`${selected.id}-${selected.revision}`} product={selected} snapshot={reviewSnapshot} onSaved={setSnapshot} /><OfferingFilePanel product={selected} context={operatingContext} actorId={snapshot.actor.id} /><OfferingSignatures product={selected} context={operatingContext} actorId={snapshot.actor.id} appointments={snapshot.product_appointments} /></div> : unavailable()
    }
    if (view === '/portal/opportunities') return canInvest ? <div className={styles.stack}>{entityOnly ? <Notice title="Entity eligibility is separate">Review published terms and request a separate entity eligibility decision only with current admission, account and effective representative mandate. Entity subscriptions remain unavailable. Inspect account and appointment records in <Link href={href('/portal/portfolio')} className={styles.textLink}>your investment workspace</Link>.</Notice> : null}<Opportunities products={published} snapshot={snapshot} operatingContext={operatingContext} /></div> : unavailable()
    if (view === '/portal/opportunities/detail') {
      if (!canInvest || !selected || !isOfferingSubscribable(selected)) return unavailable()
      const fund = fundLifecycle?.products.find(item => item.product_id === selected.id)
      return <div className={styles.stack}>
        {fund && !investorView ? <FundLifecycleWorkspace lifecycle={fund} actorId={snapshot.actor.id} operatingContext={context} onRefresh={refreshFund} /> : null}
        <div className={styles.wideGrid}><div className={styles.stack}>
          <Notice title="Offering summary">{selected.terms.summary}</Notice><ProductFacts product={selected} />
          <ProductNarrative product={selected} /><OfferingDocuments product={selected} />
          {investorView ? <button type="button" className={styles.buttonSecondary} aria-expanded={investorEvidenceOpen} onClick={() => setInvestorEvidenceOpen(value => !value)}>{investorEvidenceOpen ? 'Hide offering verification details' : 'View offering verification details'}</button> : null}
          {!investorView || investorEvidenceOpen ? <OfferingPackageEvidence product={selected} /> : null}
        </div><div className={styles.stack}>
          {hasEntityInvestorCapacity || hasEntityAccountView ? <EntityProductEligibilityPanel product={selected} snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /> : null}
          {entityOnly ? <Notice title="Entity subscriptions are unavailable" tone="warning">An entity account, appointment and eligibility decision do not authorise a transaction. This offering cannot receive an entity order through the current workflow.</Notice>
            : <><SubscriptionForm product={selected} snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /><ProductEligibilityPanel product={selected} snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /></>}
        </div></div>
      </div>
    }
    if (view === '/portal/portfolio') return canInvest ? passwordAdmission || entityOnly ? <InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /> : <div className={styles.stack}>{orderStats()}<InvestmentAccountPanel snapshot={snapshot} onSaved={setSnapshot} operatingContext={operatingContext} /><Notice title="Reservations are not holdings">These are subscription instructions with reserved units. A reservation does not confirm funding, token ownership or investment performance.</Notice><SubscriptionOrders subscriptions={ownSubscriptions} products={snapshot.products} incoming={false} onSaved={setSnapshot} operatingContext={operatingContext} funding={snapshot.funding} /></div> : hasNamedRepresentativeProposal ? <Notice title="Representative consent is separate from account access">Respond to your named proposal above. No investment account, entity onboarding evidence or transaction controls are available from a proposal.</Notice> : unavailable()
    if (role === 'ComplianceOfficer') return canReview ? <ComplianceQueue snapshot={reviewSnapshot} operatingContext={operatingContext} environment={release?.environment} /> : unavailable()
    if (role === 'OfferingManager' || role === 'IssuerFundManager') return productWork()
    if (role === 'Investor') return investorWork()
    if ((role === 'TreasuryOperator' || role === 'FinancialController') && operatingContext) return <FundingWorkspace snapshot={snapshot} operatingContext={operatingContext} onSaved={setSnapshot} />
    if (role === 'SuperAdmin' && operatingContext?.mode === 'ROLE') return <div className={styles.stack}><RepresentativeMandateQueue snapshot={snapshot} operatingContext={operatingContext} /><EntityInvestingMandateQueue snapshot={snapshot} operatingContext={operatingContext} /><ProductAppointmentQueue snapshot={snapshot} operatingContext={operatingContext} />{!passwordWorkflow ? <Panel title="Separate gated administration service" description="The mandate queues above are connected appointment handoffs. The broader administration service requires its own configured authority root and may be unavailable in this environment. Business and wallet-signing powers remain separate."><div className={styles.actions}><Link href={`/workspace/administration?organisation=${encodeURIComponent(operatingContext.organisationId)}`} className={styles.buttonSecondary}>Open gated administration, if configured</Link><a href="/workspace/security" className={styles.buttonSecondary}>Account security</a></div></Panel> : null}</div>
    if (role) return view === '/portal' && fundOperatingProducts ? null : <Panel title="Operational records unavailable"><EmptyState title="No connected operating queue is available for this role" description="This release does not manufacture settlement, register or token operations. Your assigned organisation and sign-in remain unchanged." /></Panel>
    if (capabilities.manageProducts) return <div className={styles.stack}><Notice title="Approved applicant product relationship">These products use your existing approved owner relationship. This is not a native organisation role assignment.</Notice>{productWork()}</div>
    return <div className={styles.stack}><section className={styles.hero}><div><p className={styles.eyebrow}>Your BlockXOne relationship</p><h2>{entityOnly ? hasEntityAccountView ? 'View your represented entity account.' : 'Follow your entity admission and appointment.' : hasInvestorCapacity ? currentInvestorApplication(snapshot) ? 'Review opportunities. Track every instruction.' : 'Complete your investor onboarding.' : ownApplications.some(item => item.persona === 'WEALTH_MANAGER') ? 'Continue your customer organisation application.' : 'Choose the capacity you want to apply for.'}</h2><p>Your applicant records and operating assignments are separate. Customer admission does not grant a platform role or permission to create products.</p><Link href={href('/portal/onboarding')} className={styles.button}>Continue onboarding<ArrowRight aria-hidden="true" /></Link></div></section><Panel title="Your onboarding" action={<Link href={href('/portal/onboarding')} className={styles.textLink}>View application</Link>}>{ownApplications.length ? ownApplications.map(application => <div key={application.id}><DetailList rows={[{ label: application.persona === 'INVESTOR' ? 'Investor relationship' : 'Customer organisation relationship', value: <StatusBadge status={application.status} /> }, { label: 'Review expiry', value: dateLabel(application.approved_until) }, ...(application.persona === 'WEALTH_MANAGER' ? [{ label: 'Next owner', value: application.status === 'APPROVED' ? 'BlockXOne mandate reviewer and authorised role administrator' : application.status === 'SUBMITTED' ? 'BlockXOne independent compliance reviewer' : 'Applicant' }] : [])]} /></div>) : <EmptyState title="Introduce yourself" description="Submit your own applicant details and evidence for an independent review." href={href('/portal/onboarding')} action="Start onboarding" />}</Panel>{canInvest ? investorWork() : null}</div>
  }

  return <PortalCommandProvider snapshot={snapshot} operatingContext={operatingContext} environment={release?.environment}><PortalShell user={data.user} organisationName={scope?.organisationName ?? organisations[0]?.name} capabilities={{ ...capabilities, manageFundOperations: fundOperatingProducts }} active={config.active} title={title} description={config.description} eyebrow={config.eyebrow} breadcrumbs={breadcrumbs} release={release} operatingContext={operatingContext} actions={fundLifecycle?.availability === 'AVAILABLE' ? undefined : <a href={href(view, id)} className={styles.buttonSecondary}>Refresh saved state</a>}>
    {evaluation && view === '/portal' ? <Notice title="Your TEST workspace">{role === 'OfferingManager' ? 'Prepare your fund or property and follow its review progress.' : 'Browse published TEST offerings and inspect the portfolio workspace without placing orders.'} This access is separate from your application decision; identity verification, production admission and signing authority are not implied. <Link href="/portal/onboarding?mode=applicant" className={styles.textLink}>View my application status</Link></Notice> : null}
    {operatingContext?.mode !== 'ROLE' && scopes?.length ? <nav aria-label={evaluation ? 'TEST workspace and organisation' : 'Assigned role and organisation'} className={`${styles.scopeSelector} ${styles.sectionGap}`}>
      {scope ? <p>Working as <strong>{getRoleDashboard(scope.role)?.title ?? scope.role}</strong> in <strong>{scope.organisationName}</strong></p> : <p>Working with your <strong>personal and applicant relationships</strong>. An approved product-owner relationship here does not grant a native organisation role.</p>}
      <div className={styles.actions}><Link href={portalScopeHref('/portal', APPLICANT_CONTEXT)} className={styles.buttonSecondary} aria-current={operatingContext?.mode === 'APPLICANT' ? 'page' : undefined}>My personal / applicant relationships</Link>{scopes.map(item => <Link key={`${item.organisationId}-${item.role}`} href={portalScopeHref('/portal', { mode: 'ROLE', organisationId: item.organisationId, role: item.role })} className={styles.buttonSecondary} aria-current={item.organisationId === scope?.organisationId && item.role === scope?.role ? 'page' : undefined}>{item.organisationName} · {getRoleDashboard(item.role)?.title ?? item.role}</Link>)}</div>
    </nav> : null}
    <div className={styles.stack}>
      {refreshMessage ? <p role="status" aria-live="polite">{refreshMessage}</p> : null}
      {operatingContext?.mode === 'APPLICANT' && (view === '/portal' || view === '/portal/portfolio') ? <RepresentativeProposalInbox snapshot={snapshot} operatingContext={operatingContext} onSaved={setSnapshot} /> : null}
      {view === '/portal' && !investorView && fundLifecycle?.availability === 'AVAILABLE' && snapshot.base_records_available !== false ? <FundLifecycleDashboard snapshot={fundLifecycle} role={role} actorId={snapshot.actor.id} operatingContext={context} onRefresh={refreshFund} /> : null}
      {view === '/portal/portfolio' && fundLifecycle?.availability === 'AVAILABLE' ? <FundLifecyclePortfolio snapshot={fundLifecycle} operatingContext={context} /> : null}
      {content()}{!evaluation && fundLifecycle?.availability !== 'AVAILABLE' ? <RoleHelp operatingContext={operatingContext} /> : null}
    </div>
  </PortalShell></PortalCommandProvider>
}
