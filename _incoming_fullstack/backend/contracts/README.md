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
