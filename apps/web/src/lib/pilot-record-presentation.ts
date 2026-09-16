const proofAssetLabels = {
  PRIVATE_DEBT_NOTE: 'Private debt note',
  FUND_INTEREST: 'Fund interest',
  REAL_ESTATE_SPV_INTEREST: 'Real estate SPV interest',
} as const

const generatedProofName = /^BlockXOne (PRIVATE DEBT NOTE|FUND INTEREST|REAL ESTATE SPV INTEREST) ([0-9a-f]{12})$/i

export type PilotRecordNamePresentation = {
  displayName: string
  persistedName: string
  proofRunReference: string | null
}

export function presentPilotRecordName(persistedName: string): PilotRecordNamePresentation {
  const match = generatedProofName.exec(persistedName)
  if (!match) {
    return {
      displayName: persistedName || 'Unnamed record',
      persistedName,
      proofRunReference: null,
    }
  }

  const assetClass = match[1].replaceAll(' ', '_').toUpperCase() as keyof typeof proofAssetLabels
  return {
    displayName: proofAssetLabels[assetClass],
    persistedName,
    proofRunReference: match[2],
  }
}

export function countDistinctNetworkTargets(
  rows: readonly { chain_id: number | null }[],
): number {
  const chainIds = new Set<number>()
  for (const row of rows) {
    if (row.chain_id != null) chainIds.add(row.chain_id)
  }
  return chainIds.size
}
