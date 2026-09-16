export const managedTestnets = [
  { chainId: 80002, name: 'Polygon Amoy' },
  { chainId: 84532, name: 'Base Sepolia' },
  { chainId: 11155111, name: 'Ethereum Sepolia' },
] as const

export type ManagedTestnetChainID = (typeof managedTestnets)[number]['chainId']

export function managedTestnet(chainId: number | null | undefined) {
  return managedTestnets.find((network) => network.chainId === chainId)
}

export function networkTargetLabel(chainId: number | null | undefined) {
  const network = managedTestnet(chainId)
  if (network) return `${network.name} target · chain ${network.chainId} · not deployment evidence`
  if (chainId === 31337) return 'Private validation network · chain 31337 · no real value'
  return `Configured chain ${chainId ?? 'none'}`
}
