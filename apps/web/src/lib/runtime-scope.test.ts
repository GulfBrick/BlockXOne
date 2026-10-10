import { describe, expect, it } from 'vitest'

import { blockXOneRuntimeScope, isManagedTestnetRuntime } from './runtime-scope'

describe('BlockXOne web runtime scope', () => {
  it('does not invent a local pilot when no explicit hosted scope exists', () => {
    expect(blockXOneRuntimeScope(undefined)).toBeNull()
    expect(isManagedTestnetRuntime(undefined)).toBe(false)
  })

  it('enables managed testnet controls only for the exact TESTNET value', () => {
    expect(blockXOneRuntimeScope('TESTNET')).toBe('TESTNET')
    expect(isManagedTestnetRuntime('TESTNET')).toBe(true)
    expect(isManagedTestnetRuntime('mainnet')).toBe(false)
  })
  it('recognises mainnet without enabling a legacy testnet lane', () => {
    expect(blockXOneRuntimeScope('MAINNET')).toBe('MAINNET')
    expect(isManagedTestnetRuntime('MAINNET')).toBe(false)
  })
  it.each(['LOCAL_PILOT', '', 'testnet', ' TESTNET ', 'mainnet', 'unknown'])('rejects unsupported or noncanonical scope %s', value => {
    expect(blockXOneRuntimeScope(value)).toBeNull()
    expect(isManagedTestnetRuntime(value)).toBe(false)
  })
})
