# BlockXOne Contracts (v2)

This directory includes production-grade contracts for asset-backed tokenization:
- Compliance registry (whitelist + blacklist)
- Restricted ERC-20 asset token with mint/burn, pause, force transfer
- TokenFactory for multi-asset deployments
- AssetRegistry for metadata + ownership references
- P2P escrow trading contract

This repository does **not** ship compiled artifacts because dependency installation is done in your environment.

## Toolchain
- Node 20.x or 22.x LTS (`.node-version` and `.nvmrc` currently pin `20.10.0`)
- npm 10.x
- Hardhat (TypeScript)
- OpenZeppelin Contracts

Run the contracts package with a supported Node version. On this Windows workstation,
the local passing toolchain is available at `C:\nodejs\node-v20.10.0-win-x64`:

```powershell
$env:PATH='C:\nodejs\node-v20.10.0-win-x64;' + $env:PATH
npm run preflight -- --require-hardhat
npm run compile
npm test
```

The default system Node may be newer than the contracts support window. If preflight
reports Node 25.x, switch to Node 20.x or 22.x before compiling or testing.

## Contract set
- `BXOComplianceRegistry.sol`
- `BXOAssetToken.sol`
- `TokenFactory.sol`
- `AssetRegistry.sol`
- `P2PTradeEscrow.sol`

## Deployment flow (recommended)
1. Deploy `AssetRegistry`
2. Deploy `TokenFactory` pointing to registry
3. Deploy `P2PTradeEscrow` with fee recipient + fee bps
4. For each asset: call `TokenFactory.createAssetToken(...)`

## Backend integration
Once you compile and deploy, complete the EVM adapter in:
- `internal/chain/evm.go`

## Demo-only contract (non-production)
- `FundSale.sol`: fixed-price sale with built-in ERC20 mock; accepts ETH, forwards to treasury, splits fee bps to owner.

## Frontend wiring for demo fund sales
- Update `apps/web/src/lib/demo-funds.ts` per fund: `contractAddress`, `contractChainId` (e.g., 84532 for Base Sepolia), `pricePerTokenEth` (= pricePerTokenWei / 1e18), optional `depositAddress`.
- The investor Subscribe flow calls `purchase(uint256)` via MetaMask on that chain and shows gas/fees.
