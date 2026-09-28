import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { entryApplication, entryActorId, entryApplicationId } from '@/lib/portal/entry-test-fixtures'
import { KycVerification, ProviderEvidenceReview, parseKycSession, providerEvidenceLabel } from './kyc-verification'

const session = {
  token: 'opaque-one-application-token', expires_in_seconds: 600, level_name: 'test-individual',
  application_id: entryApplicationId, application_revision: 3, environment: 'TESTNET',
}
const event = {
  id: 'f1111111-1111-4111-8111-111111111111', application_id: entryApplicationId,
  application_revision: 3, environment: 'TESTNET' as const, event_type: 'applicantReviewed',
  event_at: '2026-09-24T10:00:00Z', received_at: '2026-09-24T10:00:01Z',
  ordering_state: 'CURRENT' as const, manual_webhook_test: false,
}

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
    expect(providerEvidenceLabel([{ ...event, ordering_state: 'MANUAL_TEST', manual_webhook_test: true }], 3)).toBe('Sandbox simulation received for this application revision')
    expect(providerEvidenceLabel([event], 3)).toBe('Provider evidence received for this application revision')
    for (const label of [providerEvidenceLabel([event], 3), providerEvidenceLabel([{ ...event, manual_webhook_test: true }], 3)]) {
      expect(label.toLowerCase()).not.toContain('approved')
      expect(label.toLowerCase()).not.toContain('eligible')
    }
  })

  it('offers only the TEST applicant a provider session and keeps MAIN closed', () => {
    const application = entryApplication({ revision: 3, review_route: 'AVAILABLE' })
    const test = renderToStaticMarkup(createElement(KycVerification, { application, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: true }))
    expect(test).toContain('Start sandbox identity check')
    expect(test).toContain('Refresh recorded evidence')
    expect(test).toContain('never grants account, role, product eligibility or signing authority')
    expect(test).not.toContain(session.token)
    const unconfigured = renderToStaticMarkup(createElement(KycVerification, { application, actorId: entryActorId, environment: 'TESTNET', sandboxEnabled: false }))
    expect(unconfigured).toContain('Sandbox identity check not connected')
    expect(unconfigured).not.toContain('Start sandbox identity check')
    const main = renderToStaticMarkup(createElement(KycVerification, { application, actorId: entryActorId, environment: 'MAINNET' }))
    expect(main).toContain('Production identity provider not admitted')
    expect(main).not.toContain('Start sandbox identity check')
    expect(main).not.toContain('Refresh recorded evidence')
  })

  it('does not restart an approved, rejected or historical application', () => {
    for (const application of [
      entryApplication({ status: 'APPROVED' }),
      entryApplication({ status: 'REJECTED' }),
      entryApplication({ admission_purpose: 'LEGACY_REHEARSAL' }),
      entryApplication({ context_kind: 'ORGANISATION' }),
    ]) {
      const html = renderToStaticMarkup(createElement(KycVerification, { application, actorId: entryActorId, environment: 'TESTNET' }))
      expect(html).not.toContain('Start sandbox identity check')
      expect(html).toContain('Refresh recorded evidence')
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
})
