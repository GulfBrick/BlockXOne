# Production Feature Limits

## Release-one allowlist

Only these capabilities may become production-enabled after their phase gates pass:

- one approved jurisdiction;
- one approved issuer/SPV;
- one approved golden instrument;
- approved professional/institutional/otherwise eligible investors;
- one settlement currency;
- one EVM network;
- one approved KYC/KYB provider, payment/bank route and custody/signing model;
- investor qualification and evidence;
- primary subscription and allocation;
- provider-confirmed and reconciled cash;
- governed issuance and legal-register update;
- statements, reports and one approved servicing model;
- controlled contractual redemption, amortisation or maturity.

## Disabled until later milestones

- public P2P or automated matching;
- secondary-market or liquidity claims;
- retail investors;
- anonymous participation;
- cross-border distribution;
- FX conversion;
- multiple production chains or bridges;
- DeFi integration;
- unsupported asset classes;
- uncontrolled self-custody;
- instant or discretionary redemption not present in signed terms.

## Production hard no-go modes

Production must refuse startup or the affected capability when any of these is present:

- mock KYC, payment, custody, chain or pricing provider;
- default/demo credentials or seeded development users;
- raw environment-held production private key;
- blank critical provider/chain/contract configuration;
- public identity-document storage or route;
- browser-local financial/KYC authority;
- debug bypass or fabricated provider event;
- direct immediate `SETTLED` state without authoritative legs and reconciliation;
- unsupported chain ID, ABI, bytecode or manifest;
- missing finality/reorganisation policy;
- unapproved instrument, jurisdiction, currency, investor class or provider.

## Enforcement rule

UI hiding is not enforcement. Limits must be represented in deployment configuration, service startup validation, authorization/policy, workflow state machines, database constraints, signer policy and contract invariants as applicable.
