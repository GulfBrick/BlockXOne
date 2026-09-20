import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), rpc: vi.fn(), notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { mocks.notFound(); throw new Error('NEXT_NOT_FOUND') },
  redirect: (path: string) => { mocks.redirect(path); throw new Error(`NEXT_REDIRECT:${path}`) },
}))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.create }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))
vi.mock('@/components/portal/registration-form', () => ({ RegistrationForm: () => createElement('p', null, 'server-admitted registration') }))
vi.mock('@/components/portal/portal-screens', () => ({ PortalScreen: () => createElement('p', null, 'server-admitted portal') }))

import RegisterPage from '@/app/register/page'
import { PortalPage } from '@/components/portal/portal-page'
import { loadPortalPage } from './server'

const origin = 'https://block-x-one-admission-test.vercel.app'
const user = { id: 'd22789ee-7f73-4acf-a414-3de0b62ea801', email: 'applicant@example.test', email_confirmed_at: '2026-09-21T08:00:00Z', is_anonymous: false }
const snapshot = { actor: { id: user.id, email: user.email, display_name: null, can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [] }
const refusedConfigurations: [string, string][] = [
  ['VERCEL_ENV', 'production'], ['VERCEL_ENV', 'development'], ['VERCEL_ENV', ''],
  ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'],
  ['SUPABASE_URL', 'https://another-project.supabase.co'],
  ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'],
  ['BLOCKXONE_APP_ORIGIN', 'https://block-x-one.vercel.app'],
  ['BLOCKXONE_APP_ORIGIN', 'https://preview.example.test'],
  ['BLOCKXONE_TESTNET_FUND_DEMO', 'disabled'],
  ['BLOCKXONE_AUTH_MODE', ''], ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', ''],
]

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin)
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  mocks.create.mockResolvedValue({ rpc: mocks.rpc })
  mocks.user.mockResolvedValue(user)
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: snapshot, error: null }) })
})
afterEach(() => vi.unstubAllEnvs())

describe('actual customer page admission', () => {
  it.each(refusedConfigurations)('rejects registration and portal before backend access when %s=%s', async (name, value) => {
    vi.stubEnv(name, value)
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(PortalPage({ view: '/portal' })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(loadPortalPage()).rejects.toMatchObject({ status: 404 })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
  it('does not let development or legacy pilot flags bypass the production server gate', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(PortalPage({ view: '/portal/onboarding' })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('renders registration only with the complete hosted TEST configuration', async () => {
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('server-admitted registration')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('requires a verified caller and the authoritative portal RPC even in TEST', async () => {
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal' }))
    expect(html).toContain('server-admitted portal')
    expect(mocks.user).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_read')
  })
  it('does not let TEST configuration replace authentication', async () => {
    mocks.user.mockResolvedValueOnce(null)
    await expect(PortalPage({ view: '/portal/onboarding' })).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not render portal content when the live backend denies authority', async () => {
    mocks.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal' }))
    expect(html).not.toContain('server-admitted portal')
    expect(html).toContain('Complete your account access.')
  })
})
