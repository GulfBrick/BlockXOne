# BlockXOne Contracts (v1)

These Solidity sources correspond to the MVP requirements:
- Restricted ERC-20 security token with transfer restrictions
- Whitelist registry
- Role-based controller actions: mint, burn, freeze, force-transfer

This repository does **not** ship compiled artifacts because dependency installation is done in your environment.

## Recommended toolchain
- Foundry OR Hardhat
- OpenZeppelin Contracts

## Contract set (suggested)
- `WhitelistRegistry.sol`
- `RestrictedSecurityToken.sol`

## How the platform uses these contracts
- Offering publish: deploy per-offering token + registry
- Compliance approval: approve investor wallet in platform DB
- Tokenisation Agent: whitelist wallet on-chain; mint/burn
- Transfer Agent: freeze/unfreeze; force transfer (court order / admin action)

Once you compile and deploy, implement the EVM adapter in:
- `internal/chain/evm.go`

## Testnet sale demo (new)
- `FundSale.sol`: fixed-price sale with built-in ERC20 mock; accepts ETH, forwards to treasury, splits fee bps to owner.

Deploy with Foundry (example Base Sepolia):
- Prereq: foundry, funded deployer, RPC URL.
- `forge create --rpc-url $RPC --private-key $PK contracts/src/FundSale.sol:FundSale --constructor-args <pricePerTokenWei> <feeBps> <treasury>`
	- pricePerTokenWei: e.g., `100000000000000` (0.0001 ETH)
	- feeBps: e.g., `50` (0.5%)
	- treasury: your payable address

Frontend wiring:
- Update `apps/web/src/lib/demo-funds.ts` per fund: `contractAddress`, `contractChainId` (e.g., 84532 for Base Sepolia), `pricePerTokenEth` (= pricePerTokenWei / 1e18), optional `depositAddress`.
- The investor Subscribe flow will call `purchase(uint256)` via MetaMask on that chain and show gas/fees.
