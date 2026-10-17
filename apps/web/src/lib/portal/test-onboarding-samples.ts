import type { EvidenceDocument, Persona } from './contracts'
import type { OnboardingAnswers } from './onboarding-flow'

/** Draft examples only. Evidence references must come from the normal upload receipt. */
export function fictionalTestAnswers(persona: Persona, investorType: OnboardingAnswers['investor_type'], documents: EvidenceDocument[]): OnboardingAnswers {
  const organisation = persona === 'WEALTH_MANAGER' || investorType === 'ENTITY'
  return {
    full_name: 'Alex Fictional Example', country: 'ZA', investor_type: investorType,
    company_name: organisation ? 'Fictional TEST Organisation' : '',
    registration_reference: organisation ? 'TEST-ONLY-NOT-REGISTERED' : '',
    source_of_funds: 'Fictional savings for a TEST demonstration. No real funds are involved.',
    experience: 'Fictional investor exploring fund and property workflows in TEST only.',
    beneficial_owners: organisation ? 'Alex Fictional Example owns 100% of this fictional TEST organisation.' : '',
    business_activities: 'Fictional organisation preparing TEST fund and property offering drafts.',
    representative_position: 'Fictional TEST director',
    authority_basis: 'Fictional board appointment for this TEST demonstration only. No real authority is claimed.',
    documents, test_data_acknowledged: true,
    ownership_control: organisation ? [{
      id: crypto.randomUUID(), party_type: 'PERSON', legal_name: 'Alex Fictional Example',
      registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10_000,
      control_basis: 'Fictional direct ownership of all shares for TEST only.', effective_on: '2026-01-01',
      change_reason: 'Initial fictional TEST ownership disclosure.',
      evidence_document_id: documents.find(item => item.kind === 'BENEFICIAL_OWNERS')?.id ?? '',
    }] : [],
    ownership_change_reason: organisation ? 'Initial fictional TEST disclosure of the sole direct owner.' : '',
  }
}

/** Deliberately not a realistic identity document or a verification certificate. */
export async function fictionalTestEvidence(kind: EvidenceDocument['kind']): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 1200; canvas.height = 700
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Sample generation is unavailable in this browser. You can upload your own fictional PNG instead.')
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#10253d'; context.font = 'bold 42px sans-serif'
  context.fillText('TEST ONLY / NOT A REAL DOCUMENT', 48, 85)
  context.font = '28px sans-serif'
  const lines = [
    `Fictional ${kind.replaceAll('_', ' ')} example`,
    'Person: Alex Fictional Example',
    'Organisation: Fictional TEST Organisation',
    'Reference: TEST-ONLY-NOT-REGISTERED',
    ...(kind === 'BENEFICIAL_OWNERS' ? ['Fictional sole direct owner: Alex Fictional Example (100%)'] : []),
    'No real identity, registration, address or ownership is certified.',
    'No KYC, scan result, investment eligibility or authority is granted.',
  ]
  lines.forEach((line, index) => context.fillText(line, 48, 165 + index * 55))
  context.font = 'bold 32px sans-serif'; context.fillText('FICTIONAL SAMPLE - TEST ONLY', 48, 650)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not generate the sample. Retry or upload a fictional PNG.')), 'image/png'))
  return new File([blob], `fictional-test-${kind.toLowerCase()}.png`, { type: 'image/png' })
}
