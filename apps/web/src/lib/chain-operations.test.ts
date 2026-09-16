import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  blockXOneApi,
  type ChainOperationApprovalQueueItem,
  type ChainOperationRecord,
} from './api-client'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('governed chain-operation client', () => {
  it('discovers policy-role approvals without a maker permission parameter', async () => {
    const queue: ChainOperationApprovalQueueItem[] = [{
      id: 'operation-1',
      offering_id: 'offering-1',
      operation_kind: 'MINT_SUBSCRIPTION_UNITS',
      state: 'APPROVAL_PENDING',
      requested_by_user_id: 'maker-1',
      requested_by_subject: 'user:maker-1',
      case_reference: 'CASE-1',
      approver_roles: ['IssuerChecker'],
      policy_status: 'ACTIVE',
      decision_recorded: false,
      actionable: true,
      created_at: '2026-08-07T08:00:00Z',
      updated_at: '2026-08-07T08:00:00Z',
      finalized_at: null,
    }]
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(queue))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      blockXOneApi.chainOperation.approvalQueue('checker-session')
    ).resolves.toEqual(queue)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.blockxone.example/v1/chain-operations/approval-queue'
    )
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer checker-session',
      },
    })
  })

  it('throws an Error subclass with HTTP status and backend detail', async () => {
    const payload = { error: 'chain operation access denied', operation_id: 'operation-1' }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload, 403))
    )

    try {
      await blockXOneApi.chainOperation.get('checker-session', 'operation-1')
      throw new Error('expected the client request to fail')
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error)
      expect(caught).toBeInstanceOf(ApiError)
      expect(caught).toMatchObject({
        name: 'ApiError',
        code: 'API_ERROR',
        message: 'chain operation access denied',
        status: 403,
        details: payload,
      })
    }
  })

  it('preserves nullable numeric proof fields from the Go response contract', async () => {
    const operation: ChainOperationRecord = {
      id: 'operation-1',
      network_manifest_id: 'network-1',
      deployment_manifest_id: 'deployment-1',
      tenant_org_id: 'tenant-1',
      legal_entity_org_id: 'legal-entity-1',
      offering_id: 'offering-1',
      chain_id: 80002,
      network_tier: 'TESTNET',
      operation_kind: 'MINT_SUBSCRIPTION_UNITS',
      risk_tier: 'HIGH',
      state: 'APPROVAL_PENDING',
      contract_address: '0x1111111111111111111111111111111111111111',
      selector: '0x40c10f19',
      payload: {
        wallet_address: '0x2222222222222222222222222222222222222222',
        requested_asset_base_units: '100000000000000000001',
        transaction: {
          gas_limit: '1000000',
          max_fee_per_gas: '120000000000',
          max_priority_fee_per_gas: '80000000000',
        },
      },
      payload_hash: `0x${'1'.repeat(64)}`,
      idempotency_scope: 'subscription-mint:subscription-1',
      idempotency_key: 'mint-retry-safe-1',
      requested_by_user_id: 'maker-1',
      requested_by_subject: 'user:maker-1',
      case_reference: 'CASE-1',
      approval_policy_id: 'policy-1',
      approval_policy_hash: `0x${'2'.repeat(64)}`,
      valid_approvals: 0,
      required_approvals: 1,
      has_rejection: false,
      signer_address: '',
      nonce: null,
      transaction_hash: '',
      receipt_status: '',
      confirmations: 0,
      finality_target: 64,
      terminal_reason_code: '',
      terminal_reason_detail: '',
      version: 1,
      created_at: '2026-08-07T08:00:00Z',
      updated_at: '2026-08-07T08:00:00Z',
      finalized_at: null,
      proof: {
        available: true,
        receipt: {
          id: 'receipt-1',
          block_number: null,
          block_hash: '',
          payload_hash: '',
          canonical_state: '',
          evidence_sha256: '',
        },
        finality: {
          checkpoint_id: '',
          status: '',
          observed_head_number: null,
          observed_head_hash: '',
          safe_head_number: null,
          safe_head_hash: '',
          finalized_head_number: null,
          finalized_head_hash: '',
          provider_quorum_count: 0,
          provider_evidence_hash: '',
        },
        indexed_event: {
          id: '',
          log_index: null,
          name: '',
          payload: null,
          payload_hash: '',
        },
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(operation))
    )

    await expect(
      blockXOneApi.chainOperation.get('checker-session', 'operation-1')
    ).resolves.toEqual(operation)
  })

  it('sends rejection evidence and optional approval expiry exactly', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ decision: 'REJECTED', state: 'REJECTED' }))
      .mockResolvedValueOnce(jsonResponse({ decision: 'APPROVED', state: 'APPROVAL_PENDING' }))
    vi.stubGlobal('fetch', fetchMock)

    await blockXOneApi.chainOperation.decide('checker-session', 'operation-1', {
      decision: 'REJECTED',
      approver_role: 'IssuerChecker',
      expected_payload_hash: 'payload-hash',
      expected_policy_hash: 'policy-hash',
      reason: 'Target wallet does not match the reviewed case.',
      expires_at: null,
    })
    await blockXOneApi.chainOperation.decide('checker-session', 'operation-2', {
      decision: 'APPROVED',
      approver_role: 'IssuerChecker',
      expected_payload_hash: 'payload-hash-2',
      expected_policy_hash: 'policy-hash-2',
      reason: '',
      expires_at: '2026-08-08T08:00:00.000Z',
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      decision: 'REJECTED',
      reason: 'Target wallet does not match the reviewed case.',
      expires_at: null,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      decision: 'APPROVED',
      expires_at: '2026-08-08T08:00:00.000Z',
    })
  })

  it('binds typed offering creation to one runtime-neutral idempotency key', async () => {
    const response = { id: 'offering-1' }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response, 201))
    vi.stubGlobal('fetch', fetchMock)

    await blockXOneApi.offering.createTyped(
      'wealth-manager-session',
      {
        instrument_id: 'instrument-1',
        instrument_terms_id: 'terms-1',
        runtime_scope: 'TESTNET',
        chain_id: 80002,
        price: '10.00',
        currency: 'USD',
        tenant_org_id: 'tenant-1',
        legal_entity_org_id: 'legal-entity-1',
        transfer_agent_org_id: 'transfer-agent-1',
        tokenisation_agent_org_id: 'token-agent-1',
      },
      'typed-offering:retry-safe-1'
    )

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer wealth-manager-session',
      'Idempotency-Key': 'typed-offering:retry-safe-1',
    })
  })
})
