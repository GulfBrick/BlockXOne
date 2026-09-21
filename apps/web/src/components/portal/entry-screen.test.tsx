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
})
