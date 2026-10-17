import { managedTestnet } from './managed-testnets'
import type { BlockXOneRuntimeScope } from './runtime-scope'

export const privateDebtDayCountConventions = [
  'ACT_365',
  'ACT_360',
  'THIRTY_360',
] as const

export const defaultPrivateDebtDayCountConvention = 'ACT_365' as const

export const fundDistributionPolicies = [
  'ACCUMULATING',
  'DISTRIBUTING',
] as const

export const defaultFundDistributionPolicy = 'DISTRIBUTING' as const

export const localPilotChainID = 31337 as const

export const localPilotAvailability = 'LOCAL_ONLY_NO_REAL_VALUE' as const

export const stripeTestCurrencies = ['EUR', 'GBP', 'USD', 'ZAR'] as const

type RuntimeScope = 'LOCAL_PILOT' | 'TESTNET'
type RequestedRuntimeScope = RuntimeScope | BlockXOneRuntimeScope | null

type ChainCatalogRow = {
  chain_id: number
  execution_ready: boolean
  availability: string
  network_tier: string
  is_pilot?: unknown
}

export type ChainCatalogReadiness = {
  localPilotReady: boolean
  executionReadyTestnetChainIDs: number[]
}

export type OfferingExecutionConfiguration = {
  runtime_scope: RuntimeScope
  chain_id: number
  consideration_source: 'SYNTHETIC_TEST' | 'TEST_PROVIDER'
}

export type InstrumentExecutionConfiguration = Pick<
  OfferingExecutionConfiguration,
  'runtime_scope' | 'chain_id'
>

function parseChainCatalog(value: unknown): ChainCatalogRow[] | null {
  if (!Array.isArray(value)) return null

  const rows: ChainCatalogRow[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const row = candidate as Record<string, unknown>
    if (
      typeof row.chain_id !== 'number' ||
      !Number.isSafeInteger(row.chain_id) ||
      row.chain_id <= 0 ||
      typeof row.execution_ready !== 'boolean' ||
      typeof row.availability !== 'string' ||
      typeof row.network_tier !== 'string'
    ) {
      return null
    }
    rows.push({
      chain_id: row.chain_id,
      execution_ready: row.execution_ready,
      availability: row.availability,
      network_tier: row.network_tier,
      is_pilot: row.is_pilot,
    })
  }
  return rows
}

function isPotentialLocalPilotRow(row: ChainCatalogRow): boolean {
  return row.chain_id === localPilotChainID ||
    row.network_tier === 'local' ||
    row.availability === localPilotAvailability
}

export function evaluateChainCatalog(
  frontendRuntimeScope: RequestedRuntimeScope,
  value: unknown
): ChainCatalogReadiness {
  const rows = parseChainCatalog(value)
  if (!rows || (frontendRuntimeScope !== 'LOCAL_PILOT' && frontendRuntimeScope !== 'TESTNET')) {
    return { localPilotReady: false, executionReadyTestnetChainIDs: [] }
  }

  const localCandidates = rows.filter(isPotentialLocalPilotRow)
  const localPilotReady = frontendRuntimeScope === 'LOCAL_PILOT' &&
    localCandidates.length === 1 &&
    localCandidates[0].chain_id === localPilotChainID &&
    localCandidates[0].execution_ready === true &&
    localCandidates[0].availability === localPilotAvailability &&
    localCandidates[0].network_tier === 'local'

  const testnetCounts = new Map<number, number>()
  for (const row of rows) {
    if (
      row.is_pilot === true &&
      row.execution_ready === true &&
      row.availability === 'ACTIVE_MANIFEST' &&
      row.network_tier === 'testnet'
    ) {
      testnetCounts.set(row.chain_id, (testnetCounts.get(row.chain_id) ?? 0) + 1)
    }
  }

  return {
    localPilotReady,
    executionReadyTestnetChainIDs: Array.from(testnetCounts)
      .filter(([, count]) => count === 1)
      .map(([chainID]) => chainID),
  }
}

export function offeringExecutionConfiguration(
  runtimeScope: RequestedRuntimeScope,
  selectedTestnetChainID: number | null,
  currency: string
): OfferingExecutionConfiguration {
  const target = instrumentExecutionConfiguration(runtimeScope, selectedTestnetChainID)
  if (target.runtime_scope === 'LOCAL_PILOT') {
    return {
      ...target,
      consideration_source: 'SYNTHETIC_TEST',
    }
  }

  if (!stripeTestCurrencies.some((supported) => supported === currency.trim().toUpperCase())) {
    throw new Error('Stripe TEST Checkout currently supports reviewed EUR, GBP, USD, or ZAR terms only.')
  }

  return {
    ...target,
    consideration_source: 'TEST_PROVIDER',
  }
}

export function instrumentExecutionConfiguration(
  runtimeScope: RequestedRuntimeScope,
  selectedTestnetChainID: number | null
): InstrumentExecutionConfiguration {
  if (runtimeScope === 'LOCAL_PILOT') {
    return {
      runtime_scope: 'LOCAL_PILOT',
      chain_id: localPilotChainID,
    }
  }

  if (runtimeScope !== 'TESTNET') throw new Error('This legacy execution path is not admitted for the configured environment.')

  if (
    selectedTestnetChainID === null ||
    !Number.isSafeInteger(selectedTestnetChainID) ||
    selectedTestnetChainID <= 0 ||
    !managedTestnet(selectedTestnetChainID)
  ) {
    throw new Error('An admitted managed testnet chain is required.')
  }

  return {
    runtime_scope: 'TESTNET',
    chain_id: selectedTestnetChainID,
  }
}

export function shouldBlockForMissingTestnetManifest(
  creatingOffering: boolean,
  runtimeScope: RequestedRuntimeScope,
  testnetExecutionReady: boolean
): boolean {
  return creatingOffering && (runtimeScope === 'TESTNET' ? !testnetExecutionReady : runtimeScope !== 'LOCAL_PILOT')
}
