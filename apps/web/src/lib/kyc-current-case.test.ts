import { afterEach, describe, expect, it, vi } from 'vitest'

import { blockXOneApi, type KycCurrentCaseResponse } from './api-client'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('durable investor KYC current-case client', () => {
  it('loads the authenticated principal current case without a browser case id', async () => {
    const response: KycCurrentCaseResponse = {
      case: {
        id: 'latest-case-id',
        user_id: 'investor-id',
        type: 'KYC',
        status: 'APPROVED',
        submitted_at: '2026-08-07T08:00:00Z',
        created_at: '2026-08-07T07:00:00Z',
      },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blockXOneApi.kyc.currentCase('investor-session')).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.blockxone.example/v1/kyc/cases/current')
    expect(request).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer investor-session',
      },
    })
    expect(request?.body).toBeUndefined()
  })

  it('preserves the backend no-case contract as case null', async () => {
    const response: KycCurrentCaseResponse = { case: null }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blockXOneApi.kyc.currentCase('investor-session')).resolves.toEqual({ case: null })
  })
})
