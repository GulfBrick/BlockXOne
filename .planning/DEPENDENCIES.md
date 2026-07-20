# Production Dependency Graph

```mermaid
flowchart LR
    P0["0 Planning truth"] --> P1["1 Perimeter/product"]
    P1 --> P2["2 Architecture/IAM"]
    P2 --> P3["3 Financial core"]
    P2 --> P4["4 Compliance/providers"]
    P3 --> P5["5 Contracts/chain"]
    P4 --> P5
    P3 --> P6["6 Primary lifecycle"]
    P4 --> P6
    P5 --> P6
    P2 --> P7["7 Product surfaces"]
    P6 --> P7
    P3 --> P8["8 Reliability/operations"]
    P4 --> P8
    P5 --> P8
    P6 --> P8
    P7 --> P9["9 Assurance"]
    P8 --> P9
    P9 --> P10["10 Pilot"]
    P10 --> P11["11 Production"]
```

## Parallelism policy

- Phase 3 and Phase 4 may use separate planning/research packets after Phase 2 passes; integration remains controller-sequenced.
- Phase 7 UX research may proceed before Phase 6, but production implementation cannot bind to unfrozen APIs or states.
- Phase 8 infrastructure design may begin early, but G8/G9 cannot pass before Phases 3-6.
- No other dependency may be waived by an agent.

## Machine-readable source

`.planning/ROADMAP.md` uses the exact `**Depends on:**` field parsed by GSD. The controller reruns `roadmap analyze` after each phase and blocks any phase whose dependencies have not passed.
