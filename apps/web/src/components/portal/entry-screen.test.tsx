import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/image', () => ({ default: (props: { src: string; alt: string }) => createElement('img', { src: props.src, alt: props.alt }) }))
import { EntryScreen } from './entry-screen'
import { entryApplication, entryFixture, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'
const release = { version: 'test', environment: 'TESTNET' as const, source: 'fixture' }
describe('connected pending application workspaces', () => {
  it('renders the wealth-manager workspace from its saved persona, not an investor default', () => {
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([entryApplication({ persona: 'WEALTH_MANAGER' })]), release }))
    expect(html).toContain('Your organisation and representative application.')
    expect(html).toContain('Wealth managers are platform clients')
    expect(html).not.toContain('Your investor application.')
    expect(html).toContain('Active capacity:')
  })
  it('requires older users with no recorded choice to choose a capacity explicitly', () => {
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([]), release }))
    expect(html).toContain('No application type has been chosen')
    expect(html).toContain('Choose a capacity')
    expect(html).not.toContain('Your investor application.')
  })
  it('does not render test review forms on MAINNET even with misleading admission data', () => {
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture(), admission: { manual_test_review: true } }, release: { ...release, environment: 'MAINNET' } }))
    expect(html).toContain('admission pending')
    expect(html).not.toContain('Submit for review')
  })
  it('does not offer personal manual-review submission for an organisation-scoped draft', () => {
    const application = entryApplication({ context_kind: 'ORGANISATION', context_organisation_id: entryOrganisationId })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), admission: { manual_test_review: true } }, release }))
    expect(html).toContain('admission pending')
    expect(html).not.toContain('Submit for review')
  })
  it('retains role links only for the exact server-returned scope', () => {
    const initial = { ...entryFixture([]), contexts: [{ context_key: entryOrganisationId, organisation_id: entryOrganisationId, name: 'Fictional appointed organisation', roles: ['ComplianceOfficer' as const] }] }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, chooseContext: true }))
    expect(html).toContain(`organisation=${entryOrganisationId}&amp;role=ComplianceOfficer`)
    expect(html).not.toContain('role=SuperAdmin')
  })
  it('offers refresh for submitted and decided records, never while application fields are editable', () => {
    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      const initial = { ...entryFixture([entryApplication({ status, review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
      expect(renderToStaticMarkup(createElement(EntryScreen, { initial, release }))).toContain('Refresh application status')
    }
    for (const status of ['DRAFT', 'CHANGES_REQUIRED'] as const) {
      const initial = { ...entryFixture([entryApplication({ status, review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
      expect(renderToStaticMarkup(createElement(EntryScreen, { initial, release }))).not.toContain('Refresh application status')
    }
  })
  it('does not expose product-owner links after new WM customer admission even with an organisation identifier', () => {
    const initial = { ...entryFixture([entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, operationsAvailable: true }))
    expect(html).toContain('Customer admission approved; operating assignment pending')
    expect(html).not.toContain('/portal/products?mode=applicant')
    expect(html).not.toContain('Existing customer workflows')
  })
  it('preserves explicitly identified historical rehearsal links', () => {
    const initial = entryFixture([entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', organisation_id: entryOrganisationId, admission_purpose: 'LEGACY_REHEARSAL' })])
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, operationsAvailable: true }))
    expect(html).toContain('/portal/products?mode=applicant')
    expect(html).toContain('Historical rehearsal products and offerings')
  })
  it('keeps multi-capacity application selection exact while showing separate statuses', () => {
    const investor = entryApplication({ status: 'SUBMITTED' })
    const manager = entryApplication({ id: '55555555-5555-4555-8555-555555555555', persona: 'WEALTH_MANAGER', status: 'DRAFT' })
    const initial = { ...entryFixture([investor, manager]), admission: { manual_test_review: true } }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, applicationId: manager.id }))
    expect(html).toContain('Your organisation and representative application.')
    expect(html).toContain('Draft: not submitted')
    expect(html).not.toContain('Refresh application status')
  })
})
