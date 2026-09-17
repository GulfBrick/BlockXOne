import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as login } from './auth/login/route'
import { POST as signup } from './auth/signup/route'
import { GET as user } from './auth/user/route'
import { GET as fakeLogin } from './login/route'
import { GET as fakeLogout } from './logout/route'
import { proxyJsonToApi } from '@/lib/server-api'

vi.mock('@/lib/server-api', () => ({ proxyJsonToApi: vi.fn() }))

describe('direct legacy handler containment', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([['login', login], ['signup', signup], ['user', user], ['redirect', fakeLogin]])('blocks %s before parsing, proxying or redirecting', async (_name, handler) => {
    const request = new Request('https://bx1.co.za/api/login?returnTo=https://attacker.example', {
      method: handler === login || handler === signup ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer forged-nonsecret-fixture' },
    })
    const response = await handler(request)
    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(proxyJsonToApi).not.toHaveBeenCalled()
  })
  it('denies the old logout route rather than claiming remote revocation', async () => {
    expect((await fakeLogout()).status).toBe(404)
  })
  it('fails503 on an invalid configured mode before calling the API', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    expect((await user(new Request('https://bx1.co.za/api/auth/user'))).status).toBe(503)
    expect(proxyJsonToApi).not.toHaveBeenCalled()
  })
})
