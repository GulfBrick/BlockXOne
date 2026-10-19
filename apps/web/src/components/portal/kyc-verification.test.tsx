import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryApplication, entryActorId, entryApplicationId } from '@/lib/portal/entry-test-fixtures'
import { entityInvestorApplicationDetailsV3Schema } from '@/lib/portal/contracts'
import { KycVerification, ProviderEvidenceReview, parseKycSession, providerEvidenceLabel } from './kyc-verification'
import { PortalIdentityProvider } from './portal-client'

const session = {
  token: 'opaque-one-application-token', expires_in_seconds: 600, level_name: 'test-individual',
  application_id: entryApplicationId, application_revision: 3, environment: 'TESTNET',
}
const event = {
  id: 'f1111111-1111-4111-8111-111111111111', application_id: entryApplicationId,
  application_revision: 3, environment: 'TESTNET' as const, event_type: 'applicantReviewed',
  event_at: '2026-09-24T10:00:00Z', received_at: '2026-09-24T10:00:01Z',
  ordering_state: 'CURRENT' as const, manual_webhook_test: false,
  applicant_type: 'individual' as const, level_name: 'test-individual',
  evidence_kind: 'LIFECYCLE' as const, projection_state: 'EFFECTIVE' as const,
}
function renderKyc(props: Parameters<typeof KycVerification>[0]) {
  return renderToStaticMarkup(
    <PortalIdentityProvider actorId={props.actorId} environment={props.environment}>
      <KycVerification {...props} />
    </PortalIdentityProvider>
  )
}
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED', undefined)
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_ENABLED', undefined)
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_COMPANY_ENABLED', undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('application-scoped sandbox identity verification', () => {
  it('accepts only an exact TEST session for the current application revision', () => {
    expect(parseKycSession(session, entryApplicationId, 3)).toBe(session.token)
    expect(parseKycSession({ ...session, environment: 'MAINNET' }, entryApplicationId, 3)).toBeNull()
    expect(parseKycSession({ ...session, application_revision: 2 }, entryApplicationId, 3)).toBeNull()
    expect(parseKycSession({ ...session, application_id: '22222222-2222-4222-8222-222222222223' }, entryApplicationId, 3)).toBeNull()
    expect(parseKycSession({ ...session, token: '' }, entryApplicationId, 3)).toBeNull()
  })

  it('distinguishes current signed events, sandbox simulations and stale history without approval', () => {
    expect(providerEvidenceLabel([], 3)).toBe('No provider evidence received yet')
    expect(providerEvidenceLabel([{ ...event, application_revision: 2 }], 3)).toBe('Only historical provider evidence is recorded')
    expect(providerEvidenceLabel([{ ...event, projection_state: 'MANUAL_TEST', ordering_state: 'MANUAL_TEST', manual_webhook_test: true }], 3)).toBe('Sandbox simulation received for this application revision')
    expect(providerEvidenceLabel([event], 3)).toBe('Provider verification in progress - no completed review')
    for (const label of [providerEvidenceLabel([event], 3), providerEvidenceLabel([{ ...event, manual_webhook_test: true }], 3)]) {
      expect(label.toLowerCase()).not.toContain('approved')
      expect(label.toLowerCase()).not.toContain('eligible')
    }
  })

  it('offers only the TEST applicant a provider session and keeps MAIN closed', () => {
    const application = entryApplication({ revision: 3, review_route: 'AVAILABLE', status: 'SUBMITTED', submitted_at: '2026-10-07T10:00:00Z',
      details: { full_name: 'Synthetic Individual', country: 'ZA', investor_type: 'INDIVIDUAL' } })
    const test = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: true, individualEnabled: true })
    expect(test).toContain('Start sandbox identity check')
    expect(test).toContain('Refresh recorded evidence')
    expect(test).toContain('never grants account, role, product eligibility or signing authority')
    expect(test).not.toContain(session.token)
    const unconfigured = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: false })
    expect(unconfigured).toContain('Identity verification is unavailable')
    expect(unconfigured).toContain('Your application and its saved review state are preserved')
    expect(unconfigured).not.toContain('credentials, webhook')
    expect(unconfigured).not.toContain('Start sandbox identity check')
    const main = renderKyc({ application, actorId: entryActorId, environment: 'MAINNET', sandboxEnabled: true, individualEnabled: true, companyEnabled: true })
    expect(main).toContain('Production identity provider not admitted')
    expect(main).not.toContain('Start sandbox identity check')
    expect(main).not.toContain('Refresh recorded evidence')
  })
  it('keeps customer task and read-only record presentation distinct without changing provider availability', () => {
    const application = entryApplication({ revision: 3, status: 'SUBMITTED', submitted_at: '2026-10-07T10:00:00Z',
      details: { full_name: 'Synthetic Individual', country: 'ZA', investor_type: 'INDIVIDUAL' } })
    const props = { application, actorId: entryActorId, environment: 'TESTNET' as const, sandboxEnabled: true, individualEnabled: true }
    const task = renderKyc(props)
    expect(task).toContain('Identity verification')
    expect(task).toContain('Start sandbox identity check')
    expect(task).not.toContain('Application reference')
    expect(task).not.toContain(entryApplicationId)
    expect(task).not.toMatch(/<(details|summary)\b/)
    const record = renderKyc({ ...props, presentation: 'record' })
    expect(record).toContain('Identity verification record')
    expect(record).toContain('Application reference')
    expect(record).toContain(entryApplicationId)
    expect(record).toContain('Refresh recorded evidence')
    expect(record).not.toContain('Start sandbox identity check')
    expect(record).not.toContain('Restart sandbox identity check')
    expect(record).not.toContain('Sumsub sandbox identity verification')
    expect(record).not.toMatch(/<(details|summary)\b/)
    const main = renderKyc({ ...props, environment: 'MAINNET', presentation: 'record' })
    expect(main).toContain('Production identity provider not admitted')
    expect(main).not.toContain('Start sandbox identity check')
    expect(main).not.toContain('Refresh recorded evidence')
  })
  it('requires the exact subject switch as well as the global gate, with absent switches denying availability', () => {
    const individual = entryApplication({ status: 'SUBMITTED', submitted_at: '2026-10-07T10:00:00Z',
      details: { full_name: 'Synthetic Applicant', country: 'ZA', investor_type: 'INDIVIDUAL' } })
    const company = entryApplication({ ...individual, details: { full_name: 'Synthetic Applicant', country: 'ZA', investor_type: 'ENTITY',
      details_version: 3, company_name: 'Synthetic Company', registration_reference: 'SYNTHETIC-REG' } })
    for (const application of [individual, company]) {
      const missing = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: true })
      expect(missing).not.toContain('Start sandbox identity check')
      expect(missing).toContain(application === company ? 'Company verification is unavailable' : 'Identity verification is unavailable')
      expect(missing).not.toContain('exact sandbox level')
      expect(missing).not.toContain('sandbox KYB entitlement')
      const globallyClosed = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: false,
        individualEnabled: true, companyEnabled: true })
      expect(globallyClosed).not.toContain('Start sandbox identity check')
    }
    const individualOnly = { actorId: entryActorId, environment: 'TESTNET' as const, sandboxEnabled: true, individualEnabled: true, companyEnabled: false }
    expect(renderKyc({ ...individualOnly, application: individual })).toContain('Start sandbox identity check')
    const companyClosed = renderKyc({ ...individualOnly, application: company })
    expect(companyClosed).not.toContain('Start sandbox identity check')
    expect(companyClosed).toContain('An individual check cannot verify this company application')
    const companyOnly = { ...individualOnly, individualEnabled: false, companyEnabled: true }
    expect(renderKyc({ ...companyOnly, application: company })).toContain('Start sandbox identity check')
    expect(renderKyc({ ...companyOnly, application: individual })).not.toContain('Start sandbox identity check')
  })
  it('uses only non-secret explicit subject flags and refuses unsupported/incomplete presentation subjects', () => {
    const application = entryApplication({ status: 'SUBMITTED', submitted_at: '2026-10-07T10:00:00Z',
      details: { full_name: 'Synthetic Applicant', country: 'ZA', investor_type: 'INDIVIDUAL' } })
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_ENABLED', 'true')
    expect(renderKyc({ application, actorId: entryActorId, environment: 'TESTNET' })).toContain('Start sandbox identity check')
    for (const details of [{}, { ...application.details, country: 'zz' }, { ...application.details, details_version: 3 },
      { ...application.details, investor_type: 'ENTITY' }]) {
      expect(renderKyc({ application: { ...application, details }, actorId: entryActorId, environment: 'TESTNET',
        sandboxEnabled: true, individualEnabled: true, companyEnabled: true })).not.toContain('Start sandbox identity check')
    }
    for (const detailsVersion of [2, 3] as const) {
      const company = entryApplication({ ...application, persona: 'WEALTH_MANAGER', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION',
        details: { full_name: 'Synthetic Applicant', country: 'ZA', details_version: detailsVersion,
          company_name: 'Synthetic Wealth Manager', registration_reference: 'SYNTHETIC-REG' } })
      expect(renderKyc({ application: company, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: true,
        companyEnabled: true })).toContain('Start sandbox identity check')
    }
  })

  it('does not restart an approved, rejected or historical application', () => {
    for (const application of [
      entryApplication({ status: 'APPROVED' }),
      entryApplication({ status: 'REJECTED' }),
      entryApplication({ admission_purpose: 'LEGACY_REHEARSAL' }),
      entryApplication({ context_kind: 'ORGANISATION' }),
    ]) {
      const html = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET' })
      expect(html).not.toContain('Start sandbox identity check')
      expect(html).toContain('Refresh recorded evidence')
    }
  })
  it('requires submitting or resubmitting before a provider session can be offered', () => {
    for (const status of ['DRAFT', 'CHANGES_REQUIRED'] as const) {
      const html = renderKyc({ application: entryApplication({ status }), actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: true })
      expect(html).not.toContain('Start sandbox identity check')
      expect(html).toContain(status === 'DRAFT' ? 'Submit the application for review first' : 'Update and resubmit the application first')
    }
  })

  it('shows the reviewer a separate provider-evidence panel, never an automatic decision', () => {
    const review = renderToStaticMarkup(createElement(ProviderEvidenceReview, { applicationId: entryApplicationId, revision: 3, environment: 'TESTNET' }))
    expect(review).toContain('Provider identity evidence')
    expect(review).toContain('Refresh signed provider evidence')
    expect(review).toContain('does not tick the review checks, admit the customer')
    expect(review).not.toContain('Record review decision')
    const main = renderToStaticMarkup(createElement(ProviderEvidenceReview, { applicationId: entryApplicationId, revision: 3, environment: 'MAINNET' }))
    expect(main).toContain('Production provider not admitted')
    expect(main).not.toContain('Refresh signed provider evidence')
  })

  it('offers optional manual TEST verification only for a submitted revision, keeping records and MAIN closed', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'CHANGES_REQUIRED'] as const) {
      const application = entryApplication({ status, revision: 3, submitted_at: status === 'DRAFT' ? null : '2026-10-07T10:00:00Z',
        details: { full_name: 'Synthetic Individual', country: 'ZA', investor_type: 'INDIVIDUAL' } })
      const html = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET', manualTestReview: true,
        sandboxEnabled: true, individualEnabled: true, companyEnabled: true })
      expect(html).toContain('Document review in the TEST application')
      expect(html).toContain('Optional Sumsub sandbox check')
      expect(html).toContain('Compliance still reviews your submitted documents independently')
      expect(html).toContain('This is not completed KYC or production clearance')
      expect(html).toContain('View recorded provider evidence')
      if (status === 'SUBMITTED') expect(html).toContain('Start sandbox identity check')
      else {
        expect(html).not.toContain('Start sandbox identity check')
        expect(html).toContain(status === 'DRAFT' ? 'Submit the application for review first' : 'Update and resubmit the application first')
      }
      expect(html).not.toContain('Sandbox identity check not connected')
      const record = renderKyc({ application, actorId: entryActorId, environment: 'TESTNET', manualTestReview: true,
        sandboxEnabled: true, individualEnabled: true, companyEnabled: true, presentation: 'record' })
      expect(record).toContain('KYC placeholder · manual sandbox review')
      expect(record).toContain('Sumsub is not required to complete this fictional sandbox application')
      expect(record).not.toContain('Start sandbox identity check')
      const main = renderKyc({ application, actorId: entryActorId, environment: 'MAINNET', manualTestReview: true })
      expect(main).toContain('Production identity provider not admitted')
      expect(main).not.toContain('KYC placeholder')
    }
    const review = renderToStaticMarkup(createElement(ProviderEvidenceReview, {
      applicationId: entryApplicationId, revision: 3, environment: 'TESTNET', manualTestReview: true,
    }))
    expect(review).toContain('Sumsub is not a required step for this manual TEST case')
    expect(review).toContain('View recorded provider evidence')
    expect(review).not.toContain('Record review decision')
  })

  it('keeps manual TEST optional checks closed without exact flags, submitted facts or a supported subject', () => {
    const application = entryApplication({ status: 'SUBMITTED', revision: 3, submitted_at: '2026-10-07T10:00:00Z',
      details: { full_name: 'Synthetic Individual', country: 'ZA', investor_type: 'INDIVIDUAL' } })
    const props = { application, actorId: entryActorId, environment: 'TESTNET' as const, manualTestReview: true,
      sandboxEnabled: true, individualEnabled: true, companyEnabled: false }
    const entityDetails = entityInvestorApplicationDetailsV3Schema.parse({
      details_version: 3, investor_type: 'ENTITY', full_name: 'Synthetic Applicant', country: 'ZA',
      company_name: 'Synthetic Company', registration_reference: 'SYNTHETIC-REG',
      source_of_funds: 'Fictional retained earnings for a synthetic entity.',
      beneficial_owners: 'The fictional direct owner holds the whole synthetic entity.',
      experience: 'Fictional long-term entity investment objectives.', test_data_acknowledged: true,
      documents: (['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] as const).map((kind, index) => ({
        id: `${index + 4}4444444-4444-4444-8444-444444444444`, kind, title: `Synthetic ${kind} evidence`,
        storage_path: `${entryActorId}/synthetic-entity-${index}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf',
      })),
      ownership_control: [{ id: 'f4444444-4444-4444-8444-444444444444', party_type: 'PERSON',
        legal_name: 'Synthetic Owner', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER',
        ownership_basis_points: 10_000, control_basis: 'Fictional direct ownership in the synthetic register.',
        effective_on: '2026-09-01', change_reason: 'Initial fictional entity ownership disclosure.',
        evidence_document_id: '64444444-4444-4444-8444-444444444444' }],
      ownership_change_reason: 'Initial fictional entity ownership disclosure.',
    })
    for (const overrides of [{ sandboxEnabled: false }, { individualEnabled: false },
      { application: { ...application, submitted_at: null } },
      { application: { ...application, context_kind: 'ORGANISATION' as const } },
      { application: { ...application, details: {} } },
      { application: { ...application, details: entityDetails } }]) {
      const html = renderKyc({ ...props, ...overrides })
      expect(html).not.toContain('Start sandbox identity check')
      expect(html).toContain('your manual TEST review can continue independently')
      expect(html).not.toContain('Sumsub sandbox identity verification')
    }
    const companyClosed = renderKyc({ ...props, application: { ...application, details: entityDetails } })
    expect(companyClosed).toContain('Company verification is unavailable')
    expect(companyClosed).toContain('An individual check cannot verify this company application')
    expect(companyClosed).toContain('this optional check does not block it')
  })
})
