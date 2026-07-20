import { configVariable, defineConfig } from 'hardhat/config'
import hardhatEthers from '@nomicfoundation/hardhat-ethers'
import hardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers'
import hardhatMocha from '@nomicfoundation/hardhat-mocha'
import hardhatTypechain from '@nomicfoundation/hardhat-typechain'

const hardhatCachePath = process.env.HARDHAT_CACHE_PATH || './.hardhat-cache'
const hardhatArtifactsPath = process.env.HARDHAT_ARTIFACTS_PATH || './artifacts'

export default defineConfig({
  plugins: [hardhatEthers, hardhatEthersChaiMatchers, hardhatMocha, hardhatTypechain],
  typechain: {
    outDir: './typechain-types',
  },
  paths: {
    artifacts: hardhatArtifactsPath,
    cache: hardhatCachePath,
    sources: './src',
  },
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia: {
      type: 'http',
      chainType: 'l1',
      url: configVariable('SEPOLIA_RPC_URL'),
      accounts: [configVariable('DEPLOYER_PRIVATE_KEY')],
    },
    goerli: {
      type: 'http',
      chainType: 'l1',
      url: configVariable('GOERLI_RPC_URL'),
      accounts: [configVariable('DEPLOYER_PRIVATE_KEY')],
    },
  },
})
