import { describe, expect, it } from 'vitest'

import {
  normalizeInvestorCatalogList,
  normalizeInvestorCatalogOfferingDetail,
  normalizeInvestorCatalogReadiness,
  quoteInvestorCatalogSubscription,
  type InvestorCatalogListItem,
  type InvestorCatalogOfferingDetail,
  type InvestorCatalogReadiness,
} from './pilot-finance'

function catalogOffering(): InvestorCatalogOfferingDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'LIVE',
    runtime_scope: 'LOCAL_PILOT',
    asset_class: 'PRIVATE_DEBT_NOTE',
    name: 'Exact decimal note',
    description: 'Approved catalog description',
    chain_id: 31337,
    token_contract: '0x1111111111111111111111111111111111111111',
    price: '123456789.01234567',
    currency: 'USD',
    terms: {
      version: 2,
      terms_sha256: 'a'.repeat(64),
      common_terms: {
        currency: 'USD',
        token_decimals: 8,
        authorized_units_base_units: '99999999999999999999',
        issue_date: '2026-08-11',
        governing_law: 'Delaware',
      },
      private_debt_terms: {
        face_value_base_units: '100000000',
        annual_coupon_bps: 725,
        coupon_frequency_months: 3,
        day_count_convention: 'ACT/365',
        maturity_date: '2028-08-11',
        seniority: 'SENIOR_SECURED',
        secured: true,
      },
    },
    financial_profile: {
      price_per_whole_unit_base_units: '12345678901234567',
      minimum_subscription_asset_units: '100000000',
      maximum_subscription_asset_units: '100000000000',
      allocation_capacity_asset_units: '999999999999',
      currency_code: 'USD',
      currency_scale: 8,
      payment_method: 'SYNTHETIC_TEST',
      provider_kind: 'PAYMENT',
      provider_name: 'blockxone-local-pilot',
      provider_environment: 'TEST',
      consideration_source: 'SYNTHETIC_TEST',
      payment_due_seconds: 86400,
    },
    readiness: {
      offering_live: true,
      terms_active: true,
      financial_profile_active: true,
      token_deployed: true,
      subscription_ready: true,
    },
  }
}

describe('investor catalog response boundary', () => {
  it('accepts a complete live row without instrument_id and preserves exact decimals', () => {
    const normalized = normalizeInvestorCatalogList([catalogOffering()])

    expect(normalized).toHaveLength(1)
    expect(normalized?.[0].id).toBe('11111111-1111-4111-8111-111111111111')
    expect(normalized?.[0].price).toBe('123456789.01234567')
    expect(normalized?.[0].financial_profile.price_per_whole_unit_base_units).toBe(
      '12345678901234567'
    )
    expect(normalized?.[0]).not.toHaveProperty('instrument_id')

    const typedRow: InvestorCatalogListItem = normalized![0]
    // @ts-expect-error Investor catalog rows must not expose the operator instrument ID.
    expect(typedRow.instrument_id).toBeUndefined()
  })

  it('copies only allowlisted fields from list and detail payloads', () => {
    const payload = {
      ...catalogOffering(),
      instrument_id: 'forbidden-instrument',
      instrument_terms_id: 'forbidden-terms',
      tenant_org_id: 'forbidden-tenant',
      legal_entity_org_id: 'forbidden-legal-entity',
      transfer_agent_org_id: 'forbidden-transfer-agent',
      tokenisation_agent_org_id: 'forbidden-tokenisation-agent',
      offering_manager_user_id: 'forbidden-manager',
      terms: {
        ...catalogOffering().terms,
        id: 'forbidden-terms-record',
        prepared_by_user_id: 'forbidden-maker',
        approved_by_user_id: 'forbidden-checker',
      },
      financial_profile: {
        ...catalogOffering().financial_profile,
        id: 'forbidden-profile',
        prepared_by_user_id: 'forbidden-profile-maker',
        approved_by_user_id: 'forbidden-profile-checker',
        ledger_account_id: 'forbidden-ledger-account',
      },
    }

    const list = normalizeInvestorCatalogList([payload])
    const detail = normalizeInvestorCatalogOfferingDetail(payload)

    const expectedTopLevelKeys = [
      'asset_class',
      'chain_id',
      'currency',
      'description',
      'financial_profile',
      'id',
      'name',
      'price',
      'readiness',
      'runtime_scope',
      'status',
      'terms',
      'token_contract',
    ]
    expect(Object.keys(list![0]).sort()).toEqual(expectedTopLevelKeys)
    expect(Object.keys(detail!).sort()).toEqual(expectedTopLevelKeys)
    expect(detail?.terms).not.toHaveProperty('id')
    expect(detail?.terms).not.toHaveProperty('prepared_by_user_id')
    expect(detail?.terms).not.toHaveProperty('approved_by_user_id')
    expect(detail?.financial_profile).not.toHaveProperty('id')
    expect(detail?.financial_profile).not.toHaveProperty('prepared_by_user_id')
    expect(detail?.financial_profile).not.toHaveProperty('approved_by_user_id')
    expect(detail?.financial_profile).not.toHaveProperty('ledger_account_id')

    const typedDetail: InvestorCatalogOfferingDetail = detail!
    // @ts-expect-error Approved catalog terms deliberately have no record ID.
    expect(typedDetail.terms.id).toBeUndefined()
    // @ts-expect-error Active catalog economics deliberately have no profile ID.
    expect(typedDetail.financial_profile.id).toBeUndefined()
  })

  it('normalizes the standalone readiness response to five safe booleans', () => {
    const normalized = normalizeInvestorCatalogReadiness({
      offering_live: true,
      terms_active: true,
      financial_profile_active: true,
      token_deployed: true,
      subscription_ready: true,
      offering_id: 'forbidden-duplicate-identity',
      financial_profile_id: 'forbidden-profile',
    })

    expect(normalized).toEqual({
      offering_live: true,
      terms_active: true,
      financial_profile_active: true,
      token_deployed: true,
      subscription_ready: true,
    })
    const typedReadiness: InvestorCatalogReadiness = normalized!
    // @ts-expect-error Readiness has no profile identity.
    expect(typedReadiness.financial_profile_id).toBeUndefined()
  })

  it('fails closed when exact amounts or readiness fields have the wrong JSON type', () => {
    expect(
      normalizeInvestorCatalogList([
        { ...catalogOffering(), price: 123456789.01234567 },
      ])
    ).toBeNull()
    expect(
      normalizeInvestorCatalogReadiness({
        ...catalogOffering().readiness,
        subscription_ready: 'true',
      })
    ).toBeNull()
    expect(
      normalizeInvestorCatalogList([
        {
          ...catalogOffering(),
          financial_profile: {
            ...catalogOffering().financial_profile,
            consideration_source: 'REAL_PROVIDER',
          },
        },
      ])
    ).toBeNull()
    expect(
      normalizeInvestorCatalogList([
        {
          ...catalogOffering(),
          financial_profile: {
            ...catalogOffering().financial_profile,
            provider_name: 'stripe',
          },
        },
      ])
    ).toBeNull()
    const polygonTestnetOffering = {
      ...catalogOffering(),
      runtime_scope: 'TESTNET',
      chain_id: 80002,
      financial_profile: {
        ...catalogOffering().financial_profile,
        payment_method: 'STRIPE',
        provider_name: 'stripe',
        consideration_source: 'TEST_PROVIDER',
      },
    }
    expect(normalizeInvestorCatalogList([polygonTestnetOffering])).not.toBeNull()
    expect(
      normalizeInvestorCatalogList([
        { ...polygonTestnetOffering, chain_id: 99999 },
      ])
    ).toBeNull()
  })

  it('quotes at the approved scales and rejects inexact or out-of-range units', () => {
    const offering = catalogOffering()
    expect(
      quoteInvestorCatalogSubscription(
        '2',
        offering.terms,
        offering.financial_profile
      )
    ).toBe('246913578.02469134')
    expect(
      quoteInvestorCatalogSubscription(
        '0.5',
        offering.terms,
        offering.financial_profile
      )
    ).toBeNull()

    const inexactTerms = {
      ...offering.terms,
      common_terms: { ...offering.terms.common_terms, token_decimals: 3 },
    }
    const inexactProfile = {
      ...offering.financial_profile,
      price_per_whole_unit_base_units: '100',
      minimum_subscription_asset_units: '1',
      maximum_subscription_asset_units: '1000',
      currency_scale: 2,
    }
    expect(
      quoteInvestorCatalogSubscription('0.001', inexactTerms, inexactProfile)
    ).toBeNull()
  })
})
