# Contract Toolchain Dependency Overrides

**Status:** Temporary, mandatory and fail-closed
**Added:** 2026-07-19

The contract toolchain pins three patched transitive packages through npm `overrides`:

| Parent tool | Upstream declared range | Required override | Reason |
| --- | --- | --- | --- |
| Hardhat 3.10.0 | `adm-zip ^0.4.16` | `adm-zip 0.6.0` | Versions below 0.6.0 are affected by the tracked crafted-ZIP memory-allocation advisory. |
| Mocha 11.7.6 | `diff ^7.0.0` | `diff 8.0.3` | Earlier accepted versions are affected by the tracked patch-processing denial-of-service advisory. |
| Mocha 11.7.6 | `serialize-javascript ^6.0.2` | `serialize-javascript 7.0.7` | Earlier accepted versions are affected by the tracked code-execution/CPU-exhaustion advisories. |

These are patched published packages, not audit exclusions. The mandatory full audit remains enabled at moderate severity.

## Compatibility evidence

- Exact Node 22.23.1 and npm 10.9.8.
- Clean `npm ci --ignore-scripts` installed 209 packages.
- Hardhat compiled the complete contract set and generated TypeChain types.
- TypeScript typecheck passed after generation.
- All 57 contract tests passed.
- Direct smoke tests exercised the Hardhat ZIP extraction API and the Mocha diff/serialization APIs used by the installed tools.
- Full and runtime npm audits reported zero findings.
- Preflight tests reject a missing or drifted override.

This evidence is working-tree evidence only until hosted CI reproduces it on the approved exact clean commit. It does not resolve the separate smart-contract invariant, conformance or external-audit gates.

## Removal policy

Review upstream Hardhat and Mocha dependency ranges during every dependency update. Remove one override only when:

1. the upstream lock graph resolves that dependency to a non-vulnerable compatible version without the override;
2. clean install, preflight, compile/type generation, typecheck, all tests and full audit pass;
3. the exact-candidate CI evidence is reviewed; and
4. the override documentation and preflight requirement are updated in the same change.

Never broaden a version range or use an npm audit exclusion to make this gate green.
