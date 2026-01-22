import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import {
  mainnet,
  sepolia,
  polygon,
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
} from 'wagmi/chains'

// Polygon testnet (Amoy is the current Polygon PoS testnet)
export const polygonAmoy = {
  id: 80002,
  name: 'Polygon Amoy',
  nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-amoy.polygon.technology'] },
    public: { http: ['https://rpc-amoy.polygon.technology'] },
  },
  blockExplorers: {
    default: { name: 'OKLink', url: 'https://www.oklink.com/amoy' },
  },
} as const

export const supportedChains = [
  mainnet,
  sepolia,
  polygon,
  polygonAmoy,
  base,
  baseSepolia,
  arbitrum,
  arbitrumSepolia,
] as const

export const wagmiConfig = createConfig({
  chains: supportedChains as any,
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [polygon.id]: http(),
    [polygonAmoy.id]: http('https://rpc-amoy.polygon.technology'),
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrum.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
})
