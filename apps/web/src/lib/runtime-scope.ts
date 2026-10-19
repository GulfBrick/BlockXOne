export type BlockXOneRuntimeScope = 'TESTNET' | 'MAINNET'

export function blockXOneRuntimeScope(
  value: string | undefined = process.env.NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE
): BlockXOneRuntimeScope | null {
  if (value === 'TESTNET' || value === 'MAINNET') return value
  // Historical LOCAL_PILOT records remain readable, but are not an execution
  // environment. Unknown or absent configuration must never enable that lane.
  return null
}

export function isManagedTestnetRuntime(value?: string): boolean {
  return blockXOneRuntimeScope(value) === 'TESTNET'
}
