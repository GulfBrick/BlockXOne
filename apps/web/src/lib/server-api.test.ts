import { afterEach, describe, expect, it, vi } from 'vitest'

import { getServerApiBase } from './server-api'

describe('server API routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the private container URL without exposing it to the browser', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://127.0.0.1:18080/')
    vi.stubEnv('BLOCKXONE_API_INTERNAL_URL', 'http://api:8080/')

    expect(getServerApiBase()).toBe('http://api:8080')
  })

  it('falls back to the browser API URL outside a container network', () => {
    vi.stubEnv('BLOCKXONE_API_INTERNAL_URL', '')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://127.0.0.1:18080/')

    expect(getServerApiBase()).toBe('http://127.0.0.1:18080')
  })
})
