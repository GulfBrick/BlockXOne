import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDemoRequestPayload,
  createEmptyDemoRequestFormValues,
  DemoRequestSubmissionError,
  resolveDemoRequestEndpoint,
  resolveDemoRequestPrivacyNoticeUrl,
  submitDemoRequest,
  type DemoRequestFormValues,
  validateDemoRequestForm,
} from './demo-request'

const DEMO_REQUEST_ID = ['a6fd16fc', '0180', '4c0f', '93e0', '36e19d17cda4'].join('-')

function validValues(overrides: Partial<DemoRequestFormValues> = {}): DemoRequestFormValues {
  return {
    fullName: 'Amina Dlamini',
    workEmail: 'amina@example.com',
    organization: 'Example Capital',
    roleTitle: 'Managing Director',
    jurisdiction: 'South Africa',
    instrumentInterests: ['private_credit', 'real_estate'],
    vehicleStage: 'structuring',
    investorClass: 'institutional',
    currentSystems: '',
    timing: 'one_to_three_months',
    message: '',
    consent: true,
    website: '',
    ...overrides,
  }
}

function validPayload() {
  return buildDemoRequestPayload(validValues(), {
    idempotencyKey: DEMO_REQUEST_ID,
    formStartedAt: '2026-08-02T08:00:00.000Z',
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('demo-request client validation', () => {
  it('accepts the complete contract with optional fields empty', () => {
    expect(validateDemoRequestForm(validValues())).toEqual({ valid: true, errors: {} })
  })

  it('rejects missing required fields', () => {
    const result = validateDemoRequestForm(createEmptyDemoRequestFormValues())

    expect(result.valid).toBe(false)
    expect(result.errors).toMatchObject({
      fullName: expect.any(String),
      workEmail: expect.any(String),
      organization: expect.any(String),
      roleTitle: expect.any(String),
      jurisdiction: expect.any(String),
      instrumentInterests: expect.any(String),
      vehicleStage: expect.any(String),
      investorClass: expect.any(String),
      timing: expect.any(String),
      consent: expect.any(String),
    })
    expect(result.errors.currentSystems).toBeUndefined()
    expect(result.errors.message).toBeUndefined()
  })

  it('rejects malformed email and invalid or excessive enum selections', () => {
    const result = validateDemoRequestForm(validValues({
      workEmail: 'not-an-email',
      instrumentInterests: ['private_credit', 'private_credit'],
      vehicleStage: 'unknown' as DemoRequestFormValues['vehicleStage'],
      investorClass: 'unknown' as DemoRequestFormValues['investorClass'],
      timing: 'unknown' as DemoRequestFormValues['timing'],
    }))

    expect(result.errors).toMatchObject({
      workEmail: 'Enter a valid work email address.',
      instrumentInterests: 'Select up to three valid instrument interests.',
      vehicleStage: expect.any(String),
      investorClass: expect.any(String),
      timing: expect.any(String),
    })

    expect(validateDemoRequestForm(validValues({
      instrumentInterests: ['real_estate', 'private_funds', 'private_credit', 'infrastructure'],
    })).errors.instrumentInterests).toBe('Select up to three valid instrument interests.')
  })

  it('enforces every agreed text limit', () => {
    const result = validateDemoRequestForm(validValues({
      fullName: 'x'.repeat(121),
      workEmail: `${'x'.repeat(244)}@example.com`,
      organization: 'x'.repeat(161),
      roleTitle: 'x'.repeat(121),
      jurisdiction: 'x'.repeat(121),
      currentSystems: 'x'.repeat(501),
      message: 'x'.repeat(1001),
    }))

    expect(result.valid).toBe(false)
    expect(result.errors).toMatchObject({
      fullName: expect.any(String),
      workEmail: expect.any(String),
      organization: expect.any(String),
      roleTitle: expect.any(String),
      jurisdiction: expect.any(String),
      currentSystems: expect.any(String),
      message: expect.any(String),
    })
  })
})

describe('demo-request payload construction', () => {
  it('trims text and emits the exact public API contract', () => {
    const payload = buildDemoRequestPayload(validValues({
      fullName: '  Amina Dlamini  ',
      workEmail: '  amina@example.com ',
      organization: ' Example Capital ',
      roleTitle: ' Managing Director ',
      jurisdiction: ' South Africa ',
      currentSystems: ' Salesforce ',
      message: ' First private-credit vehicle. ',
    }), {
      idempotencyKey: DEMO_REQUEST_ID,
      formStartedAt: '2026-08-02T08:00:00.000Z',
    })

    expect(payload).toEqual({
      idempotencyKey: DEMO_REQUEST_ID,
      fullName: 'Amina Dlamini',
      workEmail: 'amina@example.com',
      organization: 'Example Capital',
      roleTitle: 'Managing Director',
      jurisdiction: 'South Africa',
      instrumentInterests: ['private_credit', 'real_estate'],
      vehicleStage: 'structuring',
      investorClass: 'institutional',
      currentSystems: 'Salesforce',
      timing: 'one_to_three_months',
      message: 'First private-credit vehicle.',
      consentVersion: '2026-08-02',
      consent: true,
      website: '',
      formStartedAt: '2026-08-02T08:00:00.000Z',
      source: 'website',
    })
  })
})

describe('demo-request delivery confirmation', () => {
  it('treats blank endpoint configuration as unavailable without making a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    expect(resolveDemoRequestEndpoint('  ')).toBeNull()
    await expect(submitDemoRequest(validPayload(), { endpoint: '  ' })).rejects.toBeInstanceOf(
      DemoRequestSubmissionError,
    )
    await expect(submitDemoRequest(validPayload(), { endpoint: '  ' })).rejects.toMatchObject({
      kind: 'unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts only an absolute public HTTPS privacy notice URL', () => {
    expect(resolveDemoRequestPrivacyNoticeUrl('https://www.blockxone.example/privacy')).toBe(
      'https://www.blockxone.example/privacy',
    )

    for (const invalid of [
      '',
      'not-a-url',
      'http://www.blockxone.example/privacy',
      'https://localhost/privacy',
      'https://127.0.0.1/privacy',
      'https://privacy.localdomain/notice',
      'https://privacy.local/notice',
      'https://user:password@www.blockxone.example/privacy',
      'https://www.blockxone.example/privacy?version=draft',
      'https://www.blockxone.example/privacy#draft',
    ]) {
      expect(resolveDemoRequestPrivacyNoticeUrl(invalid)).toBeNull()
    }
  })

  it('does not report success when the intake service cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'))

    await expect(submitDemoRequest(validPayload(), {
      endpoint: 'http://127.0.0.1:54321/functions/v1/demo-request',
    })).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it.each([
    ['a success-shaped body with the wrong status', 200, { requestId: 'lead-1', status: 'received', replayed: false }],
    ['an incomplete accepted response', 202, { status: 'received', replayed: false }],
  ] as const)('rejects %s', async (_caseName, status, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(status, body))

    await expect(submitDemoRequest(validPayload(), {
      endpoint: 'http://127.0.0.1:54321/functions/v1/demo-request',
    })).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('confirms success only for the exact accepted response contract', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(202, {
      requestId: 'lead-1',
      status: 'received',
      replayed: false,
    }))

    await expect(submitDemoRequest(validPayload(), {
      endpoint: 'http://127.0.0.1:54321/functions/v1/demo-request',
    })).resolves.toEqual({
      requestId: 'lead-1',
      status: 'received',
      replayed: false,
    })
  })
})
