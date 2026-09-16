import { describe, expect, it } from 'vitest'

import {
  activeInstrumentTerms,
  chainEvidenceLabel,
  draftInstrumentTerms,
  isPilotAssetClass,
  termsCheckerStatus,
  type ControlledSubscription,
  type InstrumentRecord,
} from './pilot-finance'

const instrument: InstrumentRecord = {
  id: 'instrument-1',
  tenant_org_id: 'tenant-1',
  legal_entity_org_id: 'legal-entity-1',
  asset_class: 'PRIVATE_DEBT_NOTE',
  runtime_scope: 'LOCAL_PILOT',
  name: 'Debt note',
  description: 'Controlled test note',
  active_terms: null,
  draft_terms: {
    id: 'terms-1',
    version: 1,
    status: 'DRAFT',
    terms_sha256: 'abc',
    common_terms: {
      currency: 'USD',
      token_decimals: 2,
      authorized_units_base_units: '10000',
      issue_date: '2026-07-28',
      governing_law: 'Delaware',
    },
    prepared_by_user_id: 'maker-1',
    approved_by_user_id: null,
    approved_at: null,
  },
}

function controlledSubscription(
  overrides: Partial<ControlledSubscription> = {}
): ControlledSubscription {
  return {
    id: 'subscription-1',
    control_id: 'control-1',
    offering_id: 'offering-1',
    user_id: 'investor-1',
    units: '10',
    amount: '100.00',
    currency: 'USD',
    currency_base_units: '10000',
    asset_base_units: '1000',
    status: 'SUBMITTED',
    runtime_scope: 'LOCAL_PILOT',
    asset_class: 'PRIVATE_DEBT_NOTE',
    consideration_source: 'SYNTHETIC_TEST',
    cash_real: false,
    cash_settled: false,
    terms_version: 1,
    terms_sha256: 'abc',
    evidence: {
      provider_receipt_id: null,
      provider_event_id: null,
      funding_reservation_id: null,
      funding_journal_entry_id: null,
      statement_evidence_id: null,
      test_provider_evidence_id: null,
      reconciliation_run_id: null,
      provider_snapshot_sha256: null,
      statement_snapshot_sha256: null,
      ledger_snapshot_sha256: null,
      transaction_hash: null,
      block_hash: null,
      receipt_evidence_sha256: null,
      confirmations: 0,
      cash_real: false,
      cash_settled: false,
    },
    mint_chain_operation_id: null,
    chain_finalized_at: null,
    transaction_hash: null,
    block_hash: null,
    confirmations: 0,
    ...overrides,
  }
}

describe('typed local-pilot finance presentation', () => {
  it('accepts only the three supported asset classes', () => {
    expect(isPilotAssetClass('PRIVATE_DEBT_NOTE')).toBe(true)
    expect(isPilotAssetClass('FUND_INTEREST')).toBe(true)
    expect(isPilotAssetClass('REAL_ESTATE_SPV_INTEREST')).toBe(true)
    expect(isPilotAssetClass('PRIVATE_CREDIT')).toBe(false)
  })

  it('keeps draft and active terms distinct and enforces visible checker state', () => {
    expect(activeInstrumentTerms(instrument)).toBeNull()
    expect(draftInstrumentTerms(instrument)?.id).toBe('terms-1')
    expect(termsCheckerStatus(instrument.draft_terms!, 'maker-1')).toBe(
      'MAKER_CANNOT_APPROVE'
    )
    expect(termsCheckerStatus(instrument.draft_terms!, 'checker-1')).toBe(
      'CHECKER_REQUIRED'
    )

    const historicalList: InstrumentRecord = {
      ...instrument,
      draft_terms: undefined,
      terms: [instrument.draft_terms!],
    }
    expect(activeInstrumentTerms(historicalList)).toBeNull()
    expect(draftInstrumentTerms(historicalList)).toBeNull()
  })

  it('does not imply issuance without finalized chain evidence', () => {
    expect(chainEvidenceLabel(controlledSubscription())).toBe(
      'Not issued. No transaction evidence'
    )
    expect(
      chainEvidenceLabel(
        controlledSubscription({ mint_chain_operation_id: 'operation-1' })
      )
    ).toBe('Issuance operation pending')
    expect(
      chainEvidenceLabel(
        controlledSubscription({
          transaction_hash: '0xtx',
          block_hash: '0xblock',
          chain_finalized_at: '2026-07-28T10:00:00Z',
          confirmations: 12,
        })
      )
    ).toBe('Finalized with 12 confirmations')
  })
})
