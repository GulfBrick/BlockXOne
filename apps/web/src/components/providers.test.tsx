import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from './providers'

const state = vi.hoisted(() => ({ pathname: '/', providerCalls: 0, authReads: 0 }))
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('@/lib/auth-context-v2', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => { state.providerCalls += 1; return children },
  useAuth: () => { state.authReads += 1; return { user: null, loading: false } },
}))
vi.mock('next-themes', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('framer-motion', () => ({ MotionConfig: ({ children }: { children: ReactNode }) => children, motion: {} }))
vi.mock('./motion/page-transition', () => ({ PageTransition: ({ children }: { children: ReactNode }) => children }))
vi.mock('./effects/loading-animation', () => ({ LoadingAnimation: () => null }))
vi.mock('./ui/navbar', () => ({ Navbar: () => null }))

describe('provider Auth isolation during rendering', () => {
  beforeEach(() => { state.providerCalls = 0; state.authReads = 0 })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['/login', '/auth/confirm', '/auth/setup', '/workspace', '/workspace/access-denied', '/'])('never mounts or reads legacy Auth for native %s', (pathname) => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    state.pathname = pathname
    const markup = renderToStaticMarkup(<Providers><span>approved-child</span></Providers>)
    expect(markup).toContain('approved-child')
    expect(state.providerCalls).toBe(0)
    expect(state.authReads).toBe(0)
  })
  it.each(['/investor/portfolio', '/wm/funds/new', '/admin', '/register', '/auth/unknown', '/workspace/unknown'])('does not render unported protected children at %s', (pathname) => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    state.pathname = pathname
    const markup = renderToStaticMarkup(<Providers><span>must-not-render</span></Providers>)
    expect(markup).not.toContain('must-not-render')
    expect(markup).toContain('This operation is not enabled.')
    expect(state.providerCalls).toBe(0)
    expect(state.authReads).toBe(0)
  })
  it('retains existing legacy public behavior only when the public mode is absent', () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    state.pathname = '/'
    expect(renderToStaticMarkup(<Providers><span>legacy-child</span></Providers>)).toContain('legacy-child')
    expect(state.providerCalls).toBe(1)
  })
  it('unknown public Auth mode cannot restore the old provider or render workspace content', () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'unknown')
    state.pathname = '/workspace'
    expect(renderToStaticMarkup(<Providers><span>must-not-render</span></Providers>)).not.toContain('must-not-render')
    expect(state.providerCalls).toBe(0)
    expect(state.authReads).toBe(0)
  })
})
