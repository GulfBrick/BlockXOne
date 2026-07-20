export type Fund = {
  id: string
  name: string
  symbol: string
  category: string
  strategy: string
  chain: string
  environment: 'mainnet' | 'testnet'
  nav: number
  aum: number
  performance: number
  minInvestment: number
  manager: string
  risk: 'Low' | 'Medium' | 'High' | 'Low-Medium' | 'Medium-High'
  investors: number
  totalSupply: number
  tokenAddress: string
  mintFeeBps: number
  burnFeeBps: number
  kycRequired: boolean
  managementFee?: number
  performanceFee?: number
  status?: 'Draft' | 'Published' | 'Live'
  depositAddress?: string
  contractAddress?: string
  contractChainId?: number
  pricePerTokenEth?: number
}

export const FUNDS_STORAGE_KEY = 'funds_v2'

export const demoFunds: Fund[] = [
  {
    id: 'helix-climate-credit',
    name: 'Helix Climate Credit',
    symbol: 'HCC',
    category: 'Sustainable Credit',
    strategy: 'Short-dated carbon-linked receivables with overcollateralised structures.',
    chain: 'Base Sepolia',
    environment: 'testnet',
    nav: 10.18,
    aum: 4_200_000,
    performance: 4.6,
    minInvestment: 5000,
    manager: 'Helix Digital Partners',
    risk: 'Low-Medium',
    investors: 128,
    totalSupply: 412_000,
    tokenAddress: '0xA112...B14C',
    mintFeeBps: 35,
    burnFeeBps: 20,
    kycRequired: true,
    managementFee: 1.5,
    performanceFee: 10,
    status: 'Published',
    depositAddress: '0x000000000000000000000000000000000000dEaD',
    contractAddress: '0x0000000000000000000000000000000000000000',
    contractChainId: 84532,
    pricePerTokenEth: 0.0001,
  },
  {
    id: 'signal-digital-income',
    name: 'Signal Digital Income',
    symbol: 'SDI',
    category: 'Private Credit',
    strategy: 'Income-focused private credit with institutional co-investors.',
    chain: 'Base',
    environment: 'mainnet',
    nav: 9.87,
    aum: 28_500_000,
    performance: 7.2,
    minInvestment: 25000,
    manager: 'Signal Ventures',
    risk: 'Medium',
    investors: 542,
    totalSupply: 2_888_000,
    tokenAddress: '0xB923...F09D',
    mintFeeBps: 25,
    burnFeeBps: 15,
    kycRequired: true,
    managementFee: 1.8,
    performanceFee: 15,
    status: 'Published',
    depositAddress: '0x000000000000000000000000000000000000dEaD',
    contractAddress: '0x0000000000000000000000000000000000000000',
    contractChainId: 84532,
    pricePerTokenEth: 0.0002,
  },
  {
    id: 'atlas-global-macro',
    name: 'Atlas Global Macro',
    symbol: 'AGM',
    category: 'Macro Hedge',
    strategy: 'Discretionary macro with on-chain NAV attestation and weekly liquidity.',
    chain: 'Arbitrum One',
    environment: 'mainnet',
    nav: 12.44,
    aum: 64_300_000,
    performance: 11.8,
    minInvestment: 100000,
    manager: 'Atlas Partners',
    risk: 'Medium-High',
    investors: 321,
    totalSupply: 5_166_000,
    tokenAddress: '0xC77E...9A21',
    mintFeeBps: 40,
    burnFeeBps: 25,
    kycRequired: true,
    managementFee: 2.2,
    performanceFee: 18,
    status: 'Live',
    depositAddress: '0x000000000000000000000000000000000000dEaD',
    contractAddress: '0x0000000000000000000000000000000000000000',
    contractChainId: 84532,
    pricePerTokenEth: 0.0003,
  },
  {
    id: 'aurora-real-yield',
    name: 'Aurora Real Yield',
    symbol: 'ARY',
    category: 'DeFi Yield',
    strategy: 'Delta-neutral DeFi vaults with circuit-breaker risk controls.',
    chain: 'Polygon Amoy',
    environment: 'testnet',
    nav: 8.31,
    aum: 6_800_000,
    performance: 9.1,
    minInvestment: 15000,
    manager: 'Aurora Labs',
    risk: 'Medium',
    investors: 267,
    totalSupply: 819_500,
    tokenAddress: '0xD51F...0C30',
    mintFeeBps: 30,
    burnFeeBps: 18,
    kycRequired: false,
    managementFee: 1.4,
    performanceFee: 12,
    status: 'Published',
    depositAddress: '0x000000000000000000000000000000000000dEaD',
    contractAddress: '0x0000000000000000000000000000000000000000',
    contractChainId: 84532,
    pricePerTokenEth: 0.00005,
  },
]

export function ensureFunds(): Fund[] {
  if (typeof window === 'undefined') return demoFunds

  try {
    const cached = window.localStorage.getItem(FUNDS_STORAGE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (Array.isArray(parsed) && parsed.length) {
        return parsed as Fund[]
      }
    }

    window.localStorage.setItem(FUNDS_STORAGE_KEY, JSON.stringify(demoFunds))
    return demoFunds
  } catch (error) {
    console.warn('Unable to load funds from storage; using demo funds', error)
    return demoFunds
  }
}

export function saveFunds(funds: Fund[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FUNDS_STORAGE_KEY, JSON.stringify(funds))
}
