import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PortalProduct } from '@/lib/portal/contracts'
import { OfferingFilePanel } from './offering-file-panel'

const actorId = '11111111-1111-4111-8111-111111111111'
const context = { mode: 'ROLE' as const, organisationId: '22222222-2222-4222-8222-222222222222', role: 'OfferingManager' as const }
const product = { id: '33333333-3333-4333-8333-333333333333', status: 'IN_REVIEW',
  offering_package: { id: '44444444-4444-4444-8444-444444444444', origin: 'SUBMITTED',
    issuer_status: 'PENDING', compliance_status: 'PENDING' } } as PortalProduct

describe('offering file intake', () => {
  it('warns before upload that quarantine blocks approval and proves neither scan nor signature', () => {
    const html = renderToStaticMarkup(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    expect(html).toContain('Staging a PDF blocks approval of this exact revision')
    expect(html).toContain('not an approved offering disclosure')
    expect(html).toContain('Stage in quarantine')
    expect(html).not.toContain('Mark clean')
    expect(html).not.toContain('Approve file')
  })

  it('does not offer a late staging action once either review has been recorded', () => {
    const reviewed = { ...product, offering_package: { ...product.offering_package!, issuer_status: 'APPROVED' as const } }
    const html = renderToStaticMarkup(<OfferingFilePanel product={reviewed} context={context} actorId={actorId} />)
    expect(html).not.toContain('Stage in quarantine')
    expect(html).toContain('A corrected file requires a new offering revision')
  })
})
