export type BlockXOneRuntimeScope = 'LOCAL_PILOT' | 'TESTNET'

export function blockXOneRuntimeScope(
  value: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE
): BlockXOneRuntimeScope {
  return value?.trim().toUpperCase() === 'TESTNET' ? 'TESTNET' : 'LOCAL_PILOT'
}

export function isManagedTestnetRuntime(value?: string): boolean {
  return blockXOneRuntimeScope(value) === 'TESTNET'
}
