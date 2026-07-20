# Phase 0 Control Map

| Control ID | Risk | Control | Type | Evidence | Owner |
| --- | --- | --- | --- | --- | --- |
| P0-C01 | Loss of uncommitted WIP | External non-secret source archive and hash | Prevent/detect | Recovery manifest | Controller |
| P0-C02 | Secrets or machine state enter baseline | Working-tree plus full reachable-history artifact validator and dedicated secret scan | Prevent/detect | `EV-P0-012`; clean-candidate scan pending | Controller/CISO review |
| P0-C03 | Unsafe bulk deletion enters baseline | No `git add -A`; zero staged deletions | Prevent | Commit diff | Controller/verifier |
| P0-C04 | Planning reports false progress | 89 active requirements and 12 new phases start at 0 | Prevent | GSD outputs | Program Council |
| P0-C05 | Dependency bypass | Parser-visible `Depends on` plus controller recheck | Prevent | Roadmap analysis | Controller |
| P0-C06 | Evidence disappears | `commit_docs: true` and artifact policy | Prevent | Git history/config | CTO/Program Council |
| P0-C07 | CI masks failure | Mandatory commands preserve exit codes; mutation tests | Prevent/detect | CI evidence | Platform/CISO |
| P0-C08 | Unsupported toolchain changes results | Pinned Node/Go/Solidity/container versions | Prevent | Toolchain evidence | Platform/Blockchain |
| P0-C09 | Mock/dev mode reaches production | Startup allowlist and negative configuration tests | Prevent | Config test matrix | CTO/CISO |
| P0-C10 | Excluded product remains callable | Server policy and route/API tests | Prevent/detect | Feature-policy test | Product/Security |
| P0-C11 | Builder self-approves | Separate verifier and adversarial reviewer | Prevent | Verification attribution | Controller |
| P0-C12 | Gap repeatedly loops | Two-repair ceiling and escalation states | Corrective | Work-packet history | Controller |
| P0-C13 | Contaminated history is treated as cleaned by deletion | CI rejects prohibited paths in every commit reachable from candidate HEAD | Prevent | Repository-artifact validator | Repository owner/CISO |
| P0-C14 | Demo credentials seed a remote database | Explicit opt-in plus loopback PostgreSQL validation | Prevent | Seed negative tests | Backend/CISO |
| P0-C15 | Ignored secret/archive material enters Docker context/cache | Broad Docker context excludes plus incident cache inventory | Prevent/corrective | `.dockerignore`; incident response | Platform/CISO |
| P0-C16 | Worker receives unnecessary regulated/API secrets | Dedicated worker config contract with exact rendered-environment check | Prevent | Compose policy and config tests | Platform/CTO |
| P0-C17 | Source scan misses reachable dependency CVEs | Pinned `govulncheck` mandatory CI gate | Detect | Go vulnerability scan | Platform/CISO |
