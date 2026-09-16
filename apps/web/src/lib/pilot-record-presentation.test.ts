import { describe, expect, it } from 'vitest'

import {
  countDistinctNetworkTargets,
  presentPilotRecordName,
} from './pilot-record-presentation'

describe('pilot record presentation', () => {
  it.each([
    ['BlockXOne PRIVATE DEBT NOTE cba12fe39a25', 'Private debt note'],
    ['BlockXOne FUND INTEREST cba12fe39a25', 'Fund interest'],
    ['BlockXOne REAL ESTATE SPV INTEREST cba12fe39a25', 'Real estate SPV interest'],
  ] as const)('separates the readable label and proof reference for %s', (persistedName, displayName) => {
    expect(presentPilotRecordName(persistedName)).toEqual({
      displayName,
      persistedName,
      proofRunReference: 'cba12fe39a25',
    })
  })

  it('leaves user-authored and non-matching persisted names unchanged', () => {
    expect(presentPilotRecordName('Riverside Private Credit Fund')).toEqual({
      displayName: 'Riverside Private Credit Fund',
      persistedName: 'Riverside Private Credit Fund',
      proofRunReference: null,
    })
    expect(presentPilotRecordName('Riverside Fund cba12fe39a25')).toEqual({
      displayName: 'Riverside Fund cba12fe39a25',
      persistedName: 'Riverside Fund cba12fe39a25',
      proofRunReference: null,
    })
  })
})

describe('network target count', () => {
  it('counts distinct non-null chain IDs rather than offering rows', () => {
    expect(countDistinctNetworkTargets([
      { chain_id: 31337 },
      { chain_id: 31337 },
      { chain_id: null },
      { chain_id: 80002 },
      { chain_id: 11155111 },
      { chain_id: 80002 },
    ])).toBe(3)
  })

  it('reports one target for the nine persisted local proof offerings', () => {
    expect(countDistinctNetworkTargets(
      Array.from({ length: 9 }, () => ({ chain_id: 31337 })),
    )).toBe(1)
  })
})
