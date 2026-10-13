// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAQ_TOPICS } from '@/lib/faq-content'

vi.mock('next/navigation', () => ({ usePathname: () => '/faq' }))
vi.mock('@/components/public/public-motion', () => ({ PublicMotion: ({ children }: { children: ReactNode }) => <>{children}</> }))
import FaqPage from './page'

afterEach(cleanup)

describe('public FAQ', () => {
  it('renders the real brand, one h1 and every answer without disclosure controls', () => {
    const view = render(<FaqPage />)
    const main = screen.getByRole('main')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Frequently asked questions')
    expect(view.container.querySelector('img[src*="blockxone-lockup-horizontal"]')).not.toBeNull()
    expect(main.querySelector('details, summary, select, button, [hidden], [aria-hidden="true"]')).toBeNull()
    for (const topic of FAQ_TOPICS) {
      for (const item of topic.questions) {
        expect(within(main).getByRole('heading', { level: 3, name: item.question })).toBeTruthy()
        expect(within(main).getByText(item.answer).closest('article')).not.toBeNull()
      }
    }
  })

  it('maps each topic to a labelled focusable section and uses the existing contact route', () => {
    const view = render(<FaqPage />)
    const navigation = screen.getByRole('navigation', { name: 'FAQ topics' })
    expect(new Set(FAQ_TOPICS.map(topic => topic.id)).size).toBe(FAQ_TOPICS.length)
    for (const topic of FAQ_TOPICS) {
      expect(within(navigation).getByRole('link', { name: topic.title }).getAttribute('href')).toBe(`#${topic.id}`)
      const section = view.container.querySelector(`#${topic.id}`)
      expect(section?.tagName).toBe('SECTION')
      expect(section?.getAttribute('aria-labelledby')).toBe(`${topic.id}-title`)
      expect(section?.getAttribute('tabindex')).toBe('-1')
      expect(screen.getByRole('region', { name: topic.title })).toBe(section)
    }
    expect(within(navigation).getByRole('link', { name: 'Contact / walkthrough' }).getAttribute('href')).toBe('/request-demo')
    expect(view.container.querySelector('a[href^="mailto:"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to top' }).getAttribute('href')).toBe('#main-content')
  })

  it('explains the product lifecycle without presenting later stages as completed capabilities', () => {
    const topic = FAQ_TOPICS.find(item => item.id === 'products-and-investing')
    expect(topic?.questions).toHaveLength(6)
    const content = topic?.questions.map(item => item.answer).join(' ') ?? ''
    for (const phrase of [
      'intended workflow', 'issuer, fund or property terms', 'ownership classes, pricing and dealing rights',
      'private supporting documents', 'appointed issuer and compliance reviewer', 'e-signature evidence',
      'technical readiness alone is not legal clearance', 'workspace shows which steps are enabled',
      'eligible published offerings', 'subscription or reservation', 'independently verified and reconciled',
      'authorised issuance and a recorded holding', 'does not automatically complete',
      'reviewed, dated valuations', 'Distributions and fees', 'Returns are not guaranteed',
      'no growth or return should be inferred or invented', 'dealing windows', 'permitted transfer',
      'asset sale and liquidation', 'does not promise instant cash-out', 'supported lifecycle',
      'not proof that any asset can be tokenised immediately', 'platform and product fees before accepting',
      'does not set a rate',
    ]) expect(content).toContain(phrase)
    expect(FAQ_TOPICS[0].questions[0].answer).toContain('structure or manage offerings for your organisation')
  })

  it('keeps applications, provider evidence, wallet authority and environments distinct', () => {
    const content = FAQ_TOPICS.flatMap(topic => topic.questions.map(item => item.answer)).join(' ')
    for (const phrase of [
      'Choose investor', 'Choose wealth manager', 'Save your draft', 'Saving is not submission',
      'submitted revision', 'request in your application', 'scoped to your organisation and role',
      'optional Sumsub sandbox step', 'Manual TEST review remains available independently',
      'not application approval', 'not a completed signature', 'MetaMask',
      'ownership evidence are separate records', 'environment-specific',
      'does not establish MAIN readiness', 'not investment offers, guaranteed returns or legal clearance',
    ]) expect(content).toContain(phrase)
    expect(content).not.toMatch(/provider (is|will always be) unavailable|support@|guaranteed profit/i)
  })
})
