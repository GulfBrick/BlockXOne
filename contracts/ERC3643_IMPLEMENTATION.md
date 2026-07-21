# ERC-3643 Gap Notes and Generation 3 Issuance Prototype

## Direct verdict

`BXOSecurityToken` is the only token contract reviewed as part of the bounded Generation 3 issuance packet. It is a local prototype under test, not a production contract, not the selected canonical BlockXOne token stack, and not an asserted ERC-3643 implementation.

The release verdict remains **NO-GO**. The target production network remains unselected. Legal, Registrar, MLRO, CISO, Blockchain, custody, external-audit, G5 and production approvals remain open.

The older `README.md` and `QUICK_START.md` descriptions that call this repository "Production Ready", a "Complete ERC-3643 Implementation", ERC-3643 compliant, audited, or ready for mainnet are stale and expressly superseded and disavowed by this document and `MANIFEST.md`. Those files are outside this packet's edit allowlist and are not release evidence.

## Bounded reviewed stack

The packet covers these production-shaped contracts only to the stated extent:

- `src/token/BXOSecurityToken.sol`: reviewed issuance prototype.
- `src/token/BXOSecurityTokenFactory.sol`: bounded deployment and role-handoff helper for the prototype.
- `src/identity/IdentityRegistry.sol`: the fail-closed identity predicate delivered by the preceding Generation 3 task.
- `src/compliance/IModularCompliance.sol` and `ModularCompliance.sol`: the existing compliance boundary used by the prototype; module governance and lifecycle callbacks are not closed here.
- `src/mocks/MockGovernanceExecutor.sol`: test-only role holder, reentrancy probe and malicious-returndata compliance doubles. It is never a production component.

`BXOAssetToken`, `RestrictedSecurityToken`, `TokenFactory`, every mock, and other parallel asset/token contracts are noncanonical and unapproved pending G5 canonical-stack selection and exact-release assurance.

## Issuance controls implemented in this packet

### Shared eligibility predicate

Standard mint, every item in batch mint, and forced issuance use the same authorization-free internal predicate. A successful issuance requires all of the following:

1. recipient is not the zero address;
2. amount is nonzero;
3. `IdentityRegistry.contains(recipient)` is true;
4. the hardened `IdentityRegistry.isVerified(recipient)` predicate is true;
5. `compliance.getModules()` returns an exact, canonical, nonempty address array containing no zero module address; and
6. an exact 32-byte Boolean `true` is returned by `compliance.canTransfer(address(0), recipient, amount)`.

Reverts, empty configuration, false decisions, short/oversized return data, invalid Boolean words, malformed array layouts, dirty address words and zero-address module entries fail closed.

This minimum-one-module rule prevents vacuous approval. It does not select or approve the eventual legal product, sanctions, investor-type, concentration, holding-period, jurisdiction or canonical G5 module set.

### Standard issuance

- `MINTER_ROLE` is separate from `AGENT_ROLE`.
- The constructor grants `MINTER_ROLE` to the named admin.
- `mint` and `batchMint` are paused-state aware and share the same `ReentrancyGuard` boundary with forced issuance.
- `batchMint` rejects empty arrays, length mismatches and more than 100 items.
- Items are checked sequentially, so duplicate recipients observe balances created by earlier items.
- Any later failure rolls back the entire batch.
- Every successful standard issuance emits `MintExecuted`.

### Forced issuance

- `FORCED_ISSUER_ROLE` is not assigned by the constructor or factory.
- The role can be granted only to an address with deployed code. This proves contract-held authority only; it does **not** prove multisig ownership, signer independence, approval thresholds, timelock policy, recovery quality or operating controls.
- `forcedIssue` requires a nonzero, previously unused operation ID and nonzero evidence hash.
- Replay state is marked before external eligibility calls and rolls back with any failed transaction.
- Forced issuance has no identity or compliance bypass.
- A success emits `ForcedIssuanceExecuted` with operation ID, operator, recipient, amount and evidence hash.

### Reentrancy boundary

`nonReentrant` is the first modifier on `mint`, `batchMint` and `forcedIssue`, before pause and role checks. The test-only claim issuer attempts both cross-function directions:

- standard mint to different-operation-ID forced issuance; and
- forced issuance to standard mint.

The probe accepts a claim only when the nested call reverts with the exact four-byte `ReentrancyGuardReentrantCall()` selector (`0x3ee5aeb5`). Arbitrary reverts are not accepted as proof.

### Factory handoff

The prototype factory:

- grants the caller default-admin, agent and minter roles;
- uses the standard mint path for optional initial supply;
- never grants forced-issuer authority;
- renounces its own minter, agent and default-admin roles; and
- records a deployment only after the entire deployment, optional issuance and handoff succeeds.

An ineligible initial recipient or empty compliance configuration reverts the transaction without recording a deployment.

### Adjacent supply hardening

The legacy `forcedTransfer` and `recoveryAddress` paths call `ERC20._update` directly. OpenZeppelin interprets a zero sender as mint and a zero recipient as burn. This packet therefore rejects either zero endpoint before that call, preventing `AGENT_ROLE` from creating or destroying supply through those two functions.

That correction does not make forced transfer or recovery production complete.

## Current role model

| Role | Current prototype power | Packet status |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Grant and revoke roles | Present; real governance/timelock policy open |
| `MINTER_ROLE` | Standard and batch issuance | Separated and eligibility-gated |
| `FORCED_ISSUER_ROLE` | Evidence-bound forced issuance | Contract-only holder, unassigned by default |
| `AGENT_ROLE` | Burn, pause, freeze, forced transfer, recovery, registry/compliance replacement | Over-broad legacy bundle; separation remains a G5 blocker |

No statement in this table approves an EOA, deployer, test executor, hot wallet or unaudited contract as a production role holder.

## Explicitly open blockers

The following are not closed by this packet:

- official ERC-3643 interface IDs, events, behavioral conformance and reference-suite testing;
- canonical token, registry, identity, compliance and factory selection across parallel stacks;
- transfer-time identity enforcement: the current normal transfer path checks pause, freeze and compliance but does not itself require registry verification;
- creation/destruction and other compliance lifecycle callbacks, module-to-token binding and callback-spoof resistance;
- canonical compliance-module selection and missing-data behavior for every legal/product rule;
- gas/returndata availability bounds: ordinary Solidity/staticcall paths still forward and copy
  unbounded gas/returndata, and registry/module arrays and loops are not gas-capped; adversarial
  callees or large results can therefore cause out-of-gas or revert, while the bounded malformed-
  returndata tests do not prove a gas or returndata cap;
- separation of burn, pause, freeze, recovery, forced transfer, registry replacement and compliance replacement from the broad `AGENT_ROLE`;
- multisig threshold, signer independence, timelock, transaction policy, HSM/MPC/KMS and maker-checker evidence;
- forced-transfer and recovery identity/compliance eligibility, legal/case approval, evidence binding, pause/freeze semantics and recovery of the legal identity relationship;
- governed and delayed registry/compliance replacement;
- factory validation of canonical registries/modules and atomic production deployment manifests;
- target chain, compiler provenance, verified bytecode, chain finality/reorg processing, indexer and reconciliation;
- fuzz, invariant, gas-bound, fork/testnet, official-conformance and independent external-audit evidence; and
- legal register, custody, accounting, tax, incident, operational and production approvals.

In particular, `forcedTransfer` and `recoveryAddress` still bypass ordinary transfer restrictions by design. Only the zero-endpoint supply vulnerability is contained here. They must not be represented as production-ready legal override workflows.

## Local verification contract

The packet's tests cover direct and factory deployments; public role grants; unauthorized, paused, zero, unregistered, unverified, empty-compliance, restricted-country, maximum-balance, rejecting, reverting and malformed issuance; bounded/atomic batches; replay and evidence; cross-function reentrancy; factory role residue; zero-endpoint forced transfer/recovery; retained lifecycle regressions; and supply reconciliation.

The pinned local commands are:

```powershell
npm run compile -- --force
npm run typecheck
npm test -- test/BXOSecurityToken.test.ts test/BXOSecurityTokenFactory.test.ts
npm test
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
```

Passing local tests is necessary evidence for this bounded packet. It is not G5 approval, standard conformance, an external audit, a deployment authorization or production readiness.
