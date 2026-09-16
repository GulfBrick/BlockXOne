import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DemoRequestForm } from './demo-request-form'

afterEach(() => vi.unstubAllEnvs())

describe('disabled public enquiry surface', () => {
  it.each(['', 'false'])('collects no data when enabled is %s, even with configured URLs', (enabled) => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_REQUEST_ENABLED', enabled)
    vi.stubEnv('NEXT_PUBLIC_DEMO_REQUEST_ENDPOINT', 'https://forms.example.com/demo-request')
    vi.stubEnv('NEXT_PUBLIC_DEMO_PRIVACY_NOTICE_URL', 'https://legal.example.com/privacy')
    const html = renderToStaticMarkup(<DemoRequestForm />)
    expect(html).toContain('Online enquiries are temporarily unavailable.')
    expect(html).toContain('No information has been submitted.')
    expect(html).not.toMatch(/<(form|input|select|textarea)\b/)
    expect(html).not.toContain('type="submit"')
  })
})
