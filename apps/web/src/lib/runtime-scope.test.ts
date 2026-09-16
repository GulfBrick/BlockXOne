import { describe, expect, it } from 'vitest'

import { blockXOneRuntimeScope, isManagedTestnetRuntime } from './runtime-scope'

describe('BlockXOne web runtime scope', () => {
  it('fails closed to the local pilot when no explicit testnet build scope exists', () => {
    expect(blockXOneRuntimeScope(undefined)).toBe('LOCAL_PILOT')
    expect(isManagedTestnetRuntime(undefined)).toBe(false)
  })

  it('enables managed testnet controls only for the exact TESTNET value', () => {
    expect(blockXOneRuntimeScope(' TESTNET ')).toBe('TESTNET')
    expect(isManagedTestnetRuntime('testnet')).toBe(true)
    expect(isManagedTestnetRuntime('mainnet')).toBe(false)
  })
})
