import { describe, expect, it } from 'vitest'

import {
  defaultFundDistributionPolicy,
  defaultPrivateDebtDayCountConvention,
  evaluateChainCatalog,
  fundDistributionPolicies,
  instrumentExecutionConfiguration,
  localPilotAvailability,
  localPilotChainID,
  offeringExecutionConfiguration,
  privateDebtDayCountConventions,
  shouldBlockForMissingTestnetManifest,
} from './instrument-term-options'

const localReadyRow = {
  chain_id: 31337,
  execution_ready: true,
  availability: 'LOCAL_ONLY_NO_REAL_VALUE',
  network_tier: 'local',
}

describe('typed instrument term options', () => {
  it.each([null, 'MAINNET'] as const)('never uses the legacy execution lane for %s', scope => {
    expect(evaluateChainCatalog(scope, [localReadyRow])).toEqual({ localPilotReady: false, executionReadyTestnetChainIDs: [] })
    expect(() => instrumentExecutionConfiguration(scope, 80002)).toThrow('not admitted')
    expect(() => offeringExecutionConfiguration(scope, 80002, 'ZAR')).toThrow('not admitted')
    expect(shouldBlockForMissingTestnetManifest(true, scope, true)).toBe(true)
  })
  it('exposes only backend-valid private-debt day-count conventions', () => {
    expect(privateDebtDayCountConventions).toEqual([
      'ACT_365',
      'ACT_360',
      'THIRTY_360',
    ])
    expect(defaultPrivateDebtDayCountConvention).toBe('ACT_365')
    expect(privateDebtDayCountConventions).toContain(defaultPrivateDebtDayCountConvention)
  })

  it('exposes only backend-valid fund distribution policies', () => {
    expect(fundDistributionPolicies).toEqual([
      'ACCUMULATING',
      'DISTRIBUTING',
    ])
    expect(defaultFundDistributionPolicy).toBe('DISTRIBUTING')
    expect(fundDistributionPolicies).toContain(defaultFundDistributionPolicy)
  })

  it('requires an active testnet manifest only when creating the offering target', () => {
    expect(shouldBlockForMissingTestnetManifest(false, 'TESTNET', false)).toBe(false)
    expect(shouldBlockForMissingTestnetManifest(true, 'TESTNET', false)).toBe(true)
    expect(shouldBlockForMissingTestnetManifest(true, 'TESTNET', true)).toBe(false)
    expect(shouldBlockForMissingTestnetManifest(true, 'LOCAL_PILOT', false)).toBe(false)
  })

  it('accepts exactly one strict local-pilot row in a local frontend', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', [localReadyRow])).toEqual({
      localPilotReady: true,
      executionReadyTestnetChainIDs: [],
    })
    expect(localPilotChainID).toBe(31337)
    expect(localPilotAvailability).toBe('LOCAL_ONLY_NO_REAL_VALUE')
  })

  it('fails closed when local-pilot evidence is missing or the frontend is testnet', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', [])).toEqual({
      localPilotReady: false,
      executionReadyTestnetChainIDs: [],
    })
    expect(evaluateChainCatalog('TESTNET', [localReadyRow]).localPilotReady).toBe(false)
  })

  it('fails closed when local-pilot evidence is malformed', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', null).localPilotReady).toBe(false)
    expect(evaluateChainCatalog('LOCAL_PILOT', [{ ...localReadyRow, chain_id: '31337' }]).localPilotReady).toBe(false)
    expect(evaluateChainCatalog('LOCAL_PILOT', [localReadyRow, null]).localPilotReady).toBe(false)
  })

  it('fails closed when local-pilot evidence is duplicated', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', [localReadyRow, { ...localReadyRow }]).localPilotReady).toBe(false)
  })

  it('fails closed for a wrong local chain', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', [{ ...localReadyRow, chain_id: 1337 }]).localPilotReady).toBe(false)
  })

  it('fails closed for a wrong local network tier', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', [{ ...localReadyRow, network_tier: 'testnet' }]).localPilotReady).toBe(false)
  })

  it('fails closed for a wrong local availability value', () => {
    expect(evaluateChainCatalog('LOCAL_PILOT', [{ ...localReadyRow, availability: 'ACTIVE_MANIFEST' }]).localPilotReady).toBe(false)
  })

  it('admits only an active, execution-ready testnet manifest', () => {
    const activeTestnet = {
      chain_id: 80002,
      execution_ready: true,
      availability: 'ACTIVE_MANIFEST',
      network_tier: 'testnet',
      is_pilot: true,
    }
    expect(evaluateChainCatalog('TESTNET', [activeTestnet]).executionReadyTestnetChainIDs).toEqual([80002])
    expect(evaluateChainCatalog('TESTNET', [{ ...activeTestnet, availability: 'MANIFEST_NOT_ACTIVE' }]).executionReadyTestnetChainIDs).toEqual([])
  })

  it('builds the exact local offering target without a Stripe currency gate', () => {
    expect(offeringExecutionConfiguration('LOCAL_PILOT', null, 'JPY')).toEqual({
      runtime_scope: 'LOCAL_PILOT',
      chain_id: 31337,
      consideration_source: 'SYNTHETIC_TEST',
    })
  })

  it('binds a local instrument payload to chain 31337', () => {
    expect(instrumentExecutionConfiguration('LOCAL_PILOT', null)).toEqual({
      runtime_scope: 'LOCAL_PILOT',
      chain_id: 31337,
    })
  })

  it('binds a testnet instrument payload to the selected managed rail', () => {
    expect(instrumentExecutionConfiguration('TESTNET', 11155111)).toEqual({
      runtime_scope: 'TESTNET',
      chain_id: 11155111,
    })
  })

  it('never falls back from a testnet instrument payload to local or a default rail', () => {
    expect(() => instrumentExecutionConfiguration('TESTNET', null)).toThrow(
      'An admitted managed testnet chain is required.'
    )
    expect(() => instrumentExecutionConfiguration('TESTNET', 31337)).toThrow(
      'An admitted managed testnet chain is required.'
    )
    expect(() => instrumentExecutionConfiguration('TESTNET', 99999)).toThrow(
      'An admitted managed testnet chain is required.'
    )
  })

  it('builds the exact admitted testnet offering target with TEST_PROVIDER', () => {
    expect(offeringExecutionConfiguration('TESTNET', 84532, 'USD')).toEqual({
      runtime_scope: 'TESTNET',
      chain_id: 84532,
      consideration_source: 'TEST_PROVIDER',
    })
  })

  it('applies the Stripe currency gate only to test-provider offerings', () => {
    expect(() => offeringExecutionConfiguration('TESTNET', 80002, 'JPY')).toThrow(
      'Stripe TEST Checkout currently supports reviewed EUR, GBP, USD, or ZAR terms only.'
    )
    expect(() => offeringExecutionConfiguration('LOCAL_PILOT', null, 'JPY')).not.toThrow()
  })

  it('never falls back from a testnet offering to the local chain', () => {
    expect(() => offeringExecutionConfiguration('TESTNET', null, 'USD')).toThrow(
      'An admitted managed testnet chain is required.'
    )
    expect(() => offeringExecutionConfiguration('TESTNET', 31337, 'USD')).toThrow(
      'An admitted managed testnet chain is required.'
    )
  })

  it('rejects a testnet chain outside the managed catalog', () => {
    expect(() => offeringExecutionConfiguration('TESTNET', 99999, 'USD')).toThrow(
      'An admitted managed testnet chain is required.'
    )
  })
})
