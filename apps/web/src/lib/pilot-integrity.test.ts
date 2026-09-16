import { afterEach, describe, expect, it, vi } from 'vitest'

import { blockXOneApi, type MintQueueItem } from './api-client'
import { persistedSessionToken, verifiedUser } from './auth-session'
import {
  isActionableWhitelistStatus,
  isMintQueueItemForRuntime,
  isMintQueueItemReady,
  localDeploymentIdempotencyKey,
  mintIdempotencyKey,
  mintOperationIDForSubscription,
} from './token-operations'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mintQueueItem(overrides: Partial<MintQueueItem> = {}): MintQueueItem {
  return {
    id: 'subscription-1',
    offering_id: 'offering-1',
    runtime_scope: 'LOCAL_PILOT',
    chain_id: 31337,
    user_id: 'investor-1',
    investor_email: 'investor@example.com',
    asset_name: 'Pilot Asset',
    units: '10',
    amount: '1000',
    currency: 'USD',
    status: 'PAID',
    wallet_id: 'wallet-1',
    wallet_address: '0x1234',
    wallet_status: 'APPROVED',
    whitelist_status: 'CONFIRMED',
    mint_chain_operation_id: '',
    created_at: '2026-07-26T00:00:00Z',
    updated_at: '2026-07-26T00:00:00Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('persisted authentication integrity', () => {
  it('extracts only a non-empty persisted bearer token', () => {
    expect(persistedSessionToken(JSON.stringify({ token: 'valid-token', id: 'stale-id' }))).toBe('valid-token')
    expect(persistedSessionToken(JSON.stringify({ token: '' }))).toBeNull()
    expect(persistedSessionToken('{not-json')).toBeNull()
    expect(persistedSessionToken(null)).toBeNull()
  })

  it('rebuilds identity from the verified /v1/me response, not stale storage fields', () => {
    expect(verifiedUser({
      user_id: 'verified-user',
      email: 'verified@example.com',
      roles: ['TokenisationAgent'],
      permissions: { 'tokenops:mint': true },
      org_id: 'verified-org',
    }, 'current-token')).toEqual({
      id: 'verified-user',
      email: 'verified@example.com',
      roles: ['TokenisationAgent'],
      permissions: { 'tokenops:mint': true },
      orgId: 'verified-org',
      walletId: undefined,
      token: 'current-token',
    })
  })

  it('rejects a malformed /v1/me identity', () => {
    expect(() => verifiedUser({ user_id: '', email: '', roles: [] }, 'token')).toThrow(
      'Invalid /v1/me response'
    )
  })
})

describe('authenticated pilot API contracts', () => {
  it('creates only a typed instrument through bearer auth with exact base-unit strings', async () => {
    const response = {
      id: 'instrument-1',
      tenant_org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      legal_entity_org_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      asset_class: 'PRIVATE_DEBT_NOTE',
      runtime_scope: 'LOCAL_PILOT',
      name: 'Pilot note',
      description: 'Controlled note',
      terms: {
        id: 'terms-1',
        version: 1,
        status: 'DRAFT',
        terms_sha256: 'abc',
      },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response, 201))
    vi.stubGlobal('fetch', fetchMock)

    await blockXOneApi.instrument.create('maker-token', {
      asset_class: 'PRIVATE_DEBT_NOTE',
      runtime_scope: 'LOCAL_PILOT',
      chain_id: 31337,
      name: 'Pilot note',
      description: 'Controlled note',
      tenant_org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      legal_entity_org_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      common_terms: {
        currency: 'USD',
        token_decimals: 2,
        authorized_units_base_units: '900719925474099301',
        issue_date: '2026-07-28',
        governing_law: 'Delaware',
      },
      private_debt_terms: {
        face_value_base_units: '100000',
        annual_coupon_bps: 800,
        coupon_frequency_months: 3,
        day_count_convention: 'ACT_365',
        maturity_date: '2028-07-28',
        seniority: 'SENIOR_SECURED',
        secured: true,
      },
    })

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.blockxone.example/v1/instruments')
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer maker-token',
      'Content-Type': 'application/json',
    })
    expect(request?.headers).not.toHaveProperty('X-Dev-User-Id')
    expect(request?.headers).not.toHaveProperty('X-Dev-Email')
    expect(request?.headers).not.toHaveProperty('X-Dev-Roles')
    expect(JSON.parse(String(request?.body))).toMatchObject({
      asset_class: 'PRIVATE_DEBT_NOTE',
      runtime_scope: 'LOCAL_PILOT',
      chain_id: 31337,
      tenant_org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      legal_entity_org_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      common_terms: {
        authorized_units_base_units: '900719925474099301',
      },
      private_debt_terms: {
        face_value_base_units: '100000',
      },
    })
  })

  it('keeps controlled subscription decimals as strings and binds retries to an idempotency key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'subscription-1',
        control_id: 'control-1',
        status: 'SUBMITTED',
        units: '9007199254740993.01',
        amount: '900719925474099301.00',
        currency: 'USD',
        eligibility_decision: 'decision-1',
        idempotent_replay: false,
      }, 201)
    )
    vi.stubGlobal('fetch', fetchMock)

    await blockXOneApi.subscription.createControlled(
      'investor-token',
      'offering-1',
      {
        units: '9007199254740993.01',
        amount: '900719925474099301.00',
      },
      'subscription:retry-safe-1'
    )

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.blockxone.example/v1/offerings/offering-1/subscribe')
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer investor-token',
      'Idempotency-Key': 'subscription:retry-safe-1',
    })
    expect(JSON.parse(String(request?.body))).toEqual({
      units: '9007199254740993.01',
      amount: '900719925474099301.00',
    })
  })

  it('uses the ledger-backed synthetic funding boundary without claiming real cash', async () => {
    const response = {
      intake_id: 'intake-1',
      status: 'APPLIED',
      subscription_state: 'FUNDS_RECEIVED',
      consideration_source: 'SYNTHETIC_TEST',
      cash_real: false,
      cash_settled: false,
      provider_receipt_id: 'receipt-1',
      provider_event_id: 'event-1',
      funding_reservation_id: 'reservation-1',
      funding_journal_entry_id: 'journal-1',
      idempotent_replay: false,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response, 202))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      blockXOneApi.payment.applySyntheticFunding(
        'settlement-token',
        'subscription-1',
        {
          provider_event_id: 'event-1',
          provider_object_id: 'object-1',
          amount_base_units: '900719925474099301',
          currency: 'USD',
          occurred_at: '2026-07-28T10:00:00.000Z',
        },
        'synthetic-funding:retry-safe-1'
      )
    ).resolves.toEqual(response)

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.blockxone.example/v1/local-pilot/subscriptions/subscription-1/synthetic-funding'
    )
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer settlement-token',
      'Idempotency-Key': 'synthetic-funding:retry-safe-1',
    })
    expect(JSON.parse(String(request?.body))).toMatchObject({
      amount_base_units: '900719925474099301',
      currency: 'USD',
    })
  })

  it('submits controlled local issuance with bearer auth and a retry-safe key', async () => {
    const response = {
      issuance: {
        id: 'issuance-1',
        subscription_id: 'subscription-1',
        control_id: 'control-1',
        offering_id: 'offering-1',
        instrument_terms_id: 'terms-1',
        asset_class: 'FUND_INTEREST',
        runtime_scope: 'LOCAL_PILOT',
        investor_user_id: 'investor-1',
        wallet_id: 'wallet-1',
        wallet_address: '0x1234',
        chain_id: 31337,
        token_contract: '0xabcd',
        amount_base_units: '900719925474099301',
        payload_hash: 'payload-sha256',
        idempotency_key: 'controlled-mint:retry-safe-1',
        state: 'FINAL',
        transaction_hash: '0xtx',
        block_number: '42',
        block_hash: '0xblock',
        transaction_index: 0,
        log_index: 1,
        receipt_evidence_sha256: 'receipt-sha256',
        recovery_error_code: null,
        recovery_error_detail: null,
        prepared_at: '2026-07-28T10:00:00.000Z',
        finalized_at: '2026-07-28T10:00:05.000Z',
        recovery_required_at: null,
        created: true,
      },
      consideration_source: 'SYNTHETIC_TEST',
      cash_real: false,
      cash_settled: false,
      chain_evidence_class: 'LOCAL_FINALIZED_MINT',
      testnet_broadcast: false,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      blockXOneApi.token.controlledMint(
        'tokenops-session',
        'subscription-1',
        'controlled-mint:retry-safe-1'
      )
    ).resolves.toEqual(response)

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.blockxone.example/v1/local-pilot/subscriptions/subscription-1/mint'
    )
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer tokenops-session',
        'Idempotency-Key': 'controlled-mint:retry-safe-1',
      },
      body: '{}',
    })
  })

  it('loads only the authenticated investor controlled-position register', async () => {
    const response = {
      positions: [{
        id: 'position-1',
        subscription_id: 'subscription-1',
        control_id: 'control-1',
        offering_id: 'offering-1',
        instrument_terms_id: 'terms-1',
        instrument_terms_sha256: 'terms-sha256',
        asset_class: 'REAL_ESTATE_SPV_INTEREST',
        instrument_name: 'Pilot property SPV',
        holder_user_id: 'investor-1',
        wallet_id: 'wallet-1',
        wallet_address: '0x1234',
        chain_id: 31337,
        token_contract: '0xabcd',
        balance_base_units: '900719925474099301',
        token_decimals: 2,
        transaction_hash: '0xtx',
        block_number: '42',
        block_hash: '0xblock',
        log_index: 1,
        receipt_evidence_sha256: 'receipt-sha256',
        register_sequence: 1,
        register_entry_sha256: 'register-sha256',
        status: 'FINAL',
        created_at: '2026-07-28T10:00:05.000Z',
      }],
      consideration_source: 'SYNTHETIC_TEST',
      cash_real: false,
      cash_settled: false,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      blockXOneApi.portfolio.controlledPositions('investor-session')
    ).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.blockxone.example/v1/controlled-positions'
    )
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer investor-session',
    })
  })

  it('requests a bearer-bound server challenge before submitting its exact signed message', async () => {
    const challenge = {
      challenge_id: 'challenge-1',
      message: 'exact server-issued message',
      expires_at: '2026-07-26T00:05:00Z',
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(challenge, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'wallet-1', status: 'PENDING' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blockXOneApi.wallet.challenge('current-session-token', {
      address: '0x1234',
      chainId: 31337,
      domain: 'app.blockxone.example',
    })).resolves.toEqual(challenge)

    await blockXOneApi.wallet.connect('current-session-token', {
      challengeId: challenge.challenge_id,
      address: '0x1234',
      chainId: 31337,
      message: challenge.message,
      signature: '0xsigned',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [challengeUrl, challengeRequest] = fetchMock.mock.calls[0]
    expect(challengeUrl).toBe('https://api.blockxone.example/v1/wallets/challenge')
    expect(challengeRequest?.headers).toMatchObject({ Authorization: 'Bearer current-session-token' })
    expect(JSON.parse(String(challengeRequest?.body))).toEqual({
      address: '0x1234',
      chain_id: 31337,
      domain: 'app.blockxone.example',
    })

    const [connectUrl, connectRequest] = fetchMock.mock.calls[1]
    expect(connectUrl).toBe('https://api.blockxone.example/v1/wallets/connect')
    expect(connectRequest?.headers).toMatchObject({ Authorization: 'Bearer current-session-token' })
    expect(JSON.parse(String(connectRequest?.body))).toEqual({
      challenge_id: 'challenge-1',
      address: '0x1234',
      chain_id: 31337,
      message: 'exact server-issued message',
      signature: '0xsigned',
    })
  })

  it('loads the role-correct paid mint queue with bearer auth', async () => {
    const queue = [mintQueueItem()]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(queue))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blockXOneApi.token.mintQueue('tokenops-session', 'PAID')).resolves.toEqual(queue)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.blockxone.example/v1/token-operations/mint-queue?status=PAID')
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer tokenops-session' })
  })

  it('loads and approves only through the transfer-agent subscription queue', async () => {
    const queue = [{
      id: 'subscription-1',
      offering_id: 'offering-1',
      user_id: 'investor-1',
      investor_email: 'investor@example.com',
      asset_name: 'Pilot Asset',
      units: '10',
      amount: '1000',
      currency: 'USD',
      status: 'REQUESTED' as const,
      created_at: '2026-07-26T00:00:00Z',
    }]
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(queue))
      .mockResolvedValueOnce(jsonResponse({ id: 'subscription-1', status: 'APPROVED' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blockXOneApi.subscription.approvalQueue('transfer-session')).resolves.toEqual(queue)
    await blockXOneApi.subscription.approve('transfer-session', 'subscription-1')

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.blockxone.example/v1/subscription-operations/approval-queue?status=CREATED'
    )
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer transfer-session',
    })
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.blockxone.example/v1/subscriptions/subscription-1/approve'
    )
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer transfer-session',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  })

  it('loads the role-correct whitelist queue without a debug endpoint', async () => {
    const queue = [{
      id: 'whitelist-1',
      offering_id: 'offering-1',
      wallet_id: 'wallet-1',
      status: 'REQUESTED' as const,
      address: '0x1234',
    }]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(queue))
    vi.stubGlobal('fetch', fetchMock)

    await expect(blockXOneApi.token.whitelistQueue('tokenops-session')).resolves.toEqual(queue)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.blockxone.example/v1/token-operations/whitelist-queue'
    )
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer tokenops-session',
    })
  })
})

describe('token-operations readiness', () => {
  it('derives one durable local deployment key from the offering identity', () => {
    expect(localDeploymentIdempotencyKey(' 11111111-1111-4111-8111-111111111111 ')).toBe(
      'local-token-deploy:11111111-1111-4111-8111-111111111111'
    )
    expect(() => localDeploymentIdempotencyKey('not-an-offering')).toThrow(
      'exact offering UUID'
    )
  })

  it('derives durable mint keys from the exact subscription and runtime', () => {
    const subscriptionID = ' 22222222-2222-4222-8222-222222222222 '
    expect(mintIdempotencyKey(subscriptionID, false)).toBe(
      'controlled-local-mint:22222222-2222-4222-8222-222222222222'
    )
    expect(mintIdempotencyKey(subscriptionID, true)).toBe(
      'managed-testnet-mint:22222222-2222-4222-8222-222222222222'
    )
    expect(() => mintIdempotencyKey('not-a-subscription', false)).toThrow(
      'exact subscription UUID'
    )
  })

  it('shows REQUESTED whitelist work and permits FAILED retries', () => {
    expect(isActionableWhitelistStatus('REQUESTED')).toBe(true)
    expect(isActionableWhitelistStatus('FAILED')).toBe(true)
    expect(isActionableWhitelistStatus('EXECUTING')).toBe(false)
    expect(isActionableWhitelistStatus('CONFIRMED')).toBe(false)
  })

  it('allows mint selection only after wallet and whitelist confirmation', () => {
    expect(isMintQueueItemReady(mintQueueItem())).toBe(true)
    expect(isMintQueueItemReady(mintQueueItem({ wallet_status: 'PENDING' }))).toBe(false)
    expect(isMintQueueItemReady(mintQueueItem({ whitelist_status: 'REQUESTED' }))).toBe(false)
    expect(isMintQueueItemReady(mintQueueItem({ status: 'MINTED' }))).toBe(false)
  })

  it('admits mint queue rows only for the compiled runtime family', () => {
    expect(isMintQueueItemForRuntime(mintQueueItem(), false)).toBe(true)
    expect(isMintQueueItemForRuntime(mintQueueItem({ chain_id: 80002 }), false)).toBe(false)
    expect(isMintQueueItemForRuntime(mintQueueItem({ runtime_scope: 'TESTNET', chain_id: 80002 }), true)).toBe(true)
    expect(isMintQueueItemForRuntime(mintQueueItem({ runtime_scope: 'TESTNET', chain_id: 99999 }), true)).toBe(false)
    expect(isMintQueueItemForRuntime(mintQueueItem(), true)).toBe(false)
  })

  it('recovers a governed mint operation from the authorized mint queue', () => {
    const queue = [
      mintQueueItem({
        id: 'subscription-with-operation',
        mint_chain_operation_id: 'operation-1',
      }),
    ]

    expect(
      mintOperationIDForSubscription(queue, ' subscription-with-operation ')
    ).toBe('operation-1')
    expect(mintOperationIDForSubscription(queue, 'missing-subscription')).toBeNull()
  })
})
