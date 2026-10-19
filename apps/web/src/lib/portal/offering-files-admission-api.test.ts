import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
import { POST } from '@/app/api/portal/offering-documents/route'

const origin = 'https://block-x-one-offering-file-test.vercel.app'

beforeEach(() => {
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', VERCEL_ENV: 'preview',
    BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', BLOCKXONE_AUTH_MODE: 'supabase',
    NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin,
    SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
})
afterEach(() => vi.unstubAllEnvs())

describe('offering PDF admission', () => {
  it('rejects an unscoped direct POST before any reservation, even when a browser supplies an enabled flag', async () => {
    const request = new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'POST',
      headers: { origin, host: new URL(origin).host, 'content-type': 'multipart/form-data; boundary=x',
        'x-bx1-document-intake-enabled': 'true', 'x-bx1-document-status': 'CLEAN' },
      body: '--x--' })
    const response = await POST(request)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('operating context')
  })
})
