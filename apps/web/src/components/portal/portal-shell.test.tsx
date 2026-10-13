// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import { PortalShell } from './portal-shell'

afterEach(cleanup)
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'actor@example.invalid' }
const capabilities = { manageProducts: false, reviewCompliance: false, invest: false }

describe('FAQ access in mounted portal shells', () => {
  it('exposes FAQ from the compact applicant account menu without changing the application path', () => {
    render(<PortalShell user={user} capabilities={capabilities} active="onboarding" title="My applications" applicantOnboarding operatingContext={{ mode: 'APPLICANT' }}><p>Application content</p></PortalShell>)
    fireEvent.click(screen.getByRole('button', { name: /^Account$/ }))
    const account = screen.getByRole('navigation', { name: 'Account navigation' })
    expect(within(account).getByRole('link', { name: 'FAQ' }).getAttribute('href')).toBe('/faq')
    expect(screen.getByRole('main').textContent).toContain('Application content')
  })

  it.each(BX1_ROLES)('keeps FAQ unscoped and mounted in desktop and mobile account navigation for %s', role => {
    const view = render(<PortalShell user={user} capabilities={capabilities} active="overview" title="Workspace" operatingContext={{ mode: 'ROLE', organisationId: '22222222-2222-4222-8222-222222222222', role }}><p>Role content</p></PortalShell>)
    const faqLinks = view.container.querySelectorAll('a[href="/faq"]')
    expect(faqLinks).toHaveLength(2)
    const mobile = view.container.querySelector('details')
    expect(mobile?.querySelector('nav[aria-label="Account navigation"] a[href="/faq"]')).not.toBeNull()
    expect(Array.from(faqLinks).filter(link => !link.closest('details'))).toHaveLength(1)
    expect(view.container.querySelector('a[href="/workspace/security"]')).not.toBeNull()
    expect(view.container.querySelector('a[href="/workspace"]')).not.toBeNull()
    expect(view.container.querySelector('form[action="/auth/logout"]')?.getAttribute('method')).toBe('post')
    expect(view.container.querySelector('a[href*="/portal?organisation="]')).not.toBeNull()
  })

  it('also provides FAQ in the non-compact applicant shell', () => {
    const view = render(<PortalShell user={user} capabilities={capabilities} active="overview" title="Account" operatingContext={{ mode: 'APPLICANT' }}><p>Content</p></PortalShell>)
    expect(view.container.querySelectorAll('a[href="/faq"]')).toHaveLength(2)
  })
})
