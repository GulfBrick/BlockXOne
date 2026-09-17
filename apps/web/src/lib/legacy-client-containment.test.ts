import { afterEach, describe, expect, it, vi } from 'vitest'
import { authApi, offeringApi, getStoredToken } from './api-client'

describe('legacy client fail-closed guard', () => {
  afterEach(() => vi.unstubAllEnvs())
  it.each(['supabase', 'unknown', 'Supabase', ' '])('blocks bearer APIs beforefetch for public flag %s', async (publicMode) => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', publicMode)
    const fetchProbe = vi.spyOn(globalThis, 'fetch')
    expect(getStoredToken()).toBeNull()
    await expect(authApi.meWithToken('nonsecret-forged-token')).rejects.toMatchObject({ status: 503, code: 'operation_unavailable' })
    await expect(offeringApi.list('nonsecret-forged-token')).rejects.toMatchObject({ status: 503 })
    expect(fetchProbe).not.toHaveBeenCalled()
  })
  it('blocks server calls on a server-only mismatched flag', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    await expect(authApi.me()).rejects.toMatchObject({ status: 503 })
  })
})
