# Contracts Manifest — Generation 3 Issuance Packet

## Status

**Release verdict: NO-GO.** `BXOSecurityToken` is the only token contract treated as this packet's reviewed prototype. No contract in this repository is designated canonical for production, approved for mainnet, or asserted to conform to ERC-3643.

The production network remains unselected. G5 canonical-stack selection, professional approvals, exact-release assurance and independent audit/retest remain mandatory.

Stale "Production Ready", "Complete ERC-3643 Implementation", compliance, audit and mainnet-readiness claims in `README.md` and `QUICK_START.md` are superseded and expressly disavowed. Those files were not allowlisted for this packet and are not release evidence.

## Packet inventory

| Path | Classification | Bounded purpose |
| --- | --- | --- |
| `src/token/BXOSecurityToken.sol` | Reviewed prototype only | Standard, batch and evidence-bound forced issuance containment |
| `src/token/BXOSecurityTokenFactory.sol` | Supporting prototype helper | Atomic deployment, optional standard mint and role handoff |
| `src/identity/IdentityRegistry.sol` | Upstream Generation 3 dependency | Fail-closed cryptographic identity predicate |
| `src/compliance/IModularCompliance.sol` | Existing boundary | Module enumeration and issuance decision interface |
| `src/compliance/ModularCompliance.sol` | Existing prototype dependency | Aggregates current test modules; governance/callback gaps remain |
| `src/mocks/MockGovernanceExecutor.sol` | Test only, noncanonical | Contract role holder, exact-selector reentry issuer and malformed-compliance doubles |
| `test/BXOSecurityToken.test.ts` | Local evidence | Issuance, reentrancy, lifecycle regression and supply tests |
| `test/BXOSecurityTokenFactory.test.ts` | Local evidence | Factory atomicity and role-residue tests |
| `ERC3643_IMPLEMENTATION.md` | Gap/status document | Accurate bounded controls and explicit open blockers |

## Noncanonical parallel and test stacks

The following are explicitly noncanonical pending G5 and exact-release review:

- `src/BXOAssetToken.sol`;
- `src/RestrictedSecurityToken.sol`;
- `src/TokenFactory.sol`;
- `src/token/BXOSecurityTokenFactory.sol` beyond its bounded prototype tests;
- every contract under `src/mocks/`, including `MockClaimIssuer`, `MockRegistryFailures`, `MockGovernanceExecutor`, `MockIssuanceReentryClaimIssuer` and `MockIssuanceCompliance`; and
- other asset, sale, escrow, whitelist and registry contracts not admitted by a later canonical-stack decision.

Mocks must never appear in a production deployment manifest, production bytecode set, signer workflow or runtime dependency graph.

## Enforced prototype invariants

- Standard mint requires `MINTER_ROLE`.
- Forced issuance requires the separate `FORCED_ISSUER_ROLE`, which starts unassigned and can only be granted to deployed code.
- Mint, batch mint and forced issue share one first-executed `ReentrancyGuard` boundary.
- All three routes require nonzero amount and recipient, registration, hardened identity verification, nonempty/nonzero exact module configuration and exact compliance approval for `(address(0), recipient, amount)`.
- Forced issuance requires a nonzero one-time operation ID and nonzero evidence hash.
- Batch mint is nonempty, length-matched, capped at 100 and transaction-atomic.
- Factory initial supply uses standard mint and leaves the factory with no default-admin, agent, minter or forced-issuer role.
- Forced transfer and recovery reject either zero endpoint, so those paths cannot mint or burn through `ERC20._update`.
- Tested supply equals successful issuance minus burns across the covered sequences.

These invariants are bounded local implementation evidence only. Contract code at a forced-role holder proves neither multisig quality nor approval governance.

## Open release blockers

- Official ERC-3643 interfaces and behavioral conformance are not proven.
- Transfer identity checks and compliance lifecycle callbacks are incomplete.
- Ordinary Solidity/staticcall paths still forward and copy unbounded gas/returndata, while
  registry/module arrays and loops are not gas-capped; adversarial callees or large results can
  cause out-of-gas or revert, and bounded malformed-return tests do not establish availability
  caps.
- `AGENT_ROLE` still combines burn, pause, freeze, forced transfer, recovery and registry/compliance replacement.
- Forced transfer and recovery still lack ordinary identity/compliance enforcement, legal/case evidence, maker-checker approval and complete recovery semantics.
- Registry and compliance replacement have no approved timelock/multisig policy.
- The canonical compliance-module set and product/jurisdiction rules are unapproved.
- No actual multisig/timelock/HSM/MPC/KMS configuration is selected or evidenced.
- Production chain, finality/reorg model, deployment manifest and bytecode verification are absent.
- Fuzz/invariant/gas/fork/testnet, independent audit/retest and human G5 approval remain absent.
- Legal-register, custody, accounting and reconciliation controls remain outside this packet.

Any one of these remains sufficient to prevent a production or ERC-3643-conformance claim.

## Admission checklist for a later G5 candidate

- [ ] Name one canonical token/identity/compliance/factory stack and remove parallel ambiguity.
- [ ] Pin official standard/interface sources and pass conformance tests.
- [ ] Close transfer, mint, burn, forced-transfer and recovery callbacks and eligibility invariants.
- [ ] Separate privileged roles and bind them to approved governance controls.
- [ ] Approve the legal product, jurisdiction, investor class and compliance modules.
- [ ] Select the network and finality/reorg/reconciliation policies.
- [ ] Produce reproducible bytecode and an immutable network/deployment manifest.
- [ ] Run property, fuzz, invariant, gas-bound, malicious-contract and fork/testnet tests.
- [ ] Complete external audit, remediation and exact-bytecode retest.
- [ ] Obtain named Legal, Registrar, MLRO, CISO, Blockchain, custody, Risk and production approvals.

Until every applicable item has evidence against the exact release, this repository remains a local prototype and **NO-GO**.
