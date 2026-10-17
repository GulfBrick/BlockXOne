import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupPost, SetupRequestError } from './fund-setup-client'

const actor = '988d46c4-a585-4793-92b3-f1ae964e63bd'
const context = { mode: 'ROLE' as const, organisationId: '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', role: 'TokenisationAgent' as const }
afterEach(() => vi.unstubAllGlobals())
describe('saved fund setup web handoff', () => {
  it('uses the same authenticated canonical API and explicit actual actor/context', async () => {
    const fetcher = vi.fn(async () => Response.json({ saved: true }))
    vi.stubGlobal('fetch', fetcher)
    await expect(setupPost('/api/portal/fund-lifecycle/setup/read', { product_id: 'fixture' }, actor, context)).resolves.toEqual({ saved: true })
    const [path, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/portal/fund-lifecycle/setup/read')
    expect(options).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', method: 'POST', headers: { 'x-bx1-expected-actor': actor } })
    expect(JSON.parse(String(options.body))).toEqual({ product_id: 'fixture', operating_context: context })
  })
  it('treats a confirmed denial as a denial, not a phantom saved request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Current scope denied.' }, { status: 403 })))
    await expect(setupPost('/api/portal/fund-lifecycle/setup/command', {}, actor, context)).rejects.toMatchObject({ uncertain: false, message: 'Current scope denied.' })
  })
  it.each([
    () => { throw new Error('timeout') },
    () => new Response('<html>upstream</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ error: 'Action not confirmed.' }, { status: 503 }),
  ])('retains uncertain outcomes instead of authorising a new request %#', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    await expect(setupPost('/api/portal/fund-lifecycle/setup/command', {}, actor, context)).rejects.toMatchObject({ uncertain: true })
  })
  it('never exposes a credential-bearing network exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('password=do-not-expose') }))
    try { await setupPost('/api/portal/fund-lifecycle/setup/read', {}, actor, context) } catch (error) {
      expect(error).toBeInstanceOf(SetupRequestError); expect(String(error)).not.toContain('password')
    }
  })
})
