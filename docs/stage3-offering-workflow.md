# Stage 3 — connected sandbox offering packages

This increment extends the existing portal, typed FUND and REAL_ESTATE products,
immutable offering packages, service appointments and command boundary. It does
not introduce a second application or a rehearsal workspace. The original
eight-stage architecture remains the delivery authority.

## Normal hand-offs

1. An admitted wealth-manager representative acts as Offering Manager in the
   selected, active native organisation and its current product-organisation
   binding. They create/edit the existing typed product and request already
   eligible issuer/compliance appointments.
2. A scoped Compliance Officer reviews the appointment request. A different,
   scoped Super Admin applies that approved appointment. Application does not
   create a native role or replace a person's existing authority.
3. The manager submits an immutable package revision. The currently appointed
   issuer and Compliance Officer review that exact revision. Changes-required
   returns to preparation; corrections produce a new submitted package with
   fresh decisions, not an edit of the old approved package.
4. Completed review remains visible to the current appointed issuer. The issuer
   is not the manager editor; no artificial native/customer-organisation ID
   mapping is created to make their page work.
5. Approval produces **approved awaiting technical readiness**, not publication,
   funding instructions, investment eligibility, issued units or holdings.

## Temporary TEST password boundary

The optional strict `offering_access` version1 projection is bound to the current
actor, TESTNET environment, selected ROLE context and `TEST_PASSWORD` session.
It is a command-family projection, not record authority. Current server/database
membership, mandate, admission, appointment, monitoring, revision, independent
approval and session checks remain required at the actual operation, including
after lock waits.

| Role | Exact allowed package commands |
| --- | --- |
| Offering Manager | create_product, save_product, submit_product, begin_offering_amendment, reopen_offering_review, request_product_service_appointment |
| Issuer Fund Manager | review_offering_issuer |
| Compliance Officer | review_product, review_product_service_appointment |
| Super Admin | apply_product_service_appointment |

No investor/applicant package command, role grant, revocation, subscription,
publication, funding, recovery or signing command is admitted by this marker.
The retained Stage2 command projection stays separate. If both projections are
present they must agree on actor/context/environment/session. Malformed,
cross-role, expanded or duplicated commands fail closed. A saved command result
must preserve the validated package projection; an uncertain result is retried
with its original request key, not recreated as another operation.

## Scoped screens

- Offering Manager: current bound product list, existing create page and editor.
- Issuer: current appointment-backed list/detail and review/history readback;
  no create/editor authority.
- Compliance: exact scoped review queue and case detail, not a manager editor.
- Super Admin: exact approved appointment apply detail and own applied receipt,
  not a blanket review/product queue.

Existing standard assured-session behavior is retained except that an issuer
does not receive the manager's product-create affordance. Existing protected
actions are not turned into ordinary TEST password actions.

## Compatible cutover

This work package is source plus isolated cloud proof only. It does not install
a hosted feature, deploy a site, alter roles/factors/customer decisions, activate
a provider/scanner policy, move funds or deploy a contract.

For a separately reviewed release, publish the compatible web boundary before
the expanded database projection. The older web rejects unknown extended command
projections, so database-first installation or rollback to that older web can
break signed-in reads. An exact older-reader `admission_read_scope_denied`
signal is not sufficient to infer a deployment version: the web re-reads guarded
entry and the current session/context before returning only ordinary entry. It
never borrows old package data or upgrades a generic denial into authority.
The matching release migration must be generated through Supabase CLI and
reviewed against this exact feature before installation.

## Common product configuration (v3)

The next additive increment preserves the v1 `ZAR_TEST` and v2 `TST` packages.
An editable typed draft upgrades to v3 only by an explicit manager action. Saved
history is never relabelled or silently rewritten. Property issuer and SPV
identity must agree; an existing mismatch needs an explicit correction.

V3 adds the shared issuer declaration, product-local classes and rights,
custody/title proposal, legal-register authority, investor and transfer
restrictions, fee/tax/rounding references, settlement proposal, servicing/default
and asset-specific exit policy, plus a proposed governed deployment configuration.
These are reviewed declarations, not evidence of an admitted issuer, verified
title/custody, an approved beneficiary, appointed human signer or deployed token.
Additional classes are declaration-only until their actual Stage4 operations
are implemented. Fund redemption remains distinct from property interest
transfer and property disposal/liquidation.

Canonical create/save commands atomically create immutable, product-scoped issuer
declaration snapshots. Immutable offering revisions carry database-derived
`common_envelope_hash` and `deployment_configuration_hash`, alongside the original
full-terms and disclosure-text hashes. Both appointed reviewers must bind their
decision to those exact projected fingerprints. Common/configuration amendments
require new revisions and fresh decisions; accepted historical orders remain
attached to their original terms. A historical retry rechecks current authority,
without appending another decision or treating the old revision as current.

The additive common-envelope proof follows the unchanged accepted package proof
in the existing cloud harness, before accepted-receipt post-overlay verification.
It retains original SQL/client deadlines, exact legacy records and protected
functions/security. The new source is not runtime or hosted acceptance until its
exact-head cloud gates and independent complete-diff/log reviews pass.

## Proof and remaining Stage 3 scope

The existing cloud harness runs the retained admission and accepted Stage2
representatives proofs first, followed by the unchanged accepted rc33 receipt
proof. That proof restores its receipt functions on return; a separate,
transactional inheritance helper therefore installs the exact accepted rc33
receipt feature before Stage3 captures its protected baseline. It permits no
row/relation/security drift and does not put receipt functions in the Stage3
changed-function allowlist. A rollback-only nine-argument TEST receipt sample
then proves the inherited runtime remains usable after the offering overlay;
its metadata is fictional trusted-server attestation, not real private bytes.

New proofs cover both templates, the connected
appointment/package cycle, revision-bound decisions, actual two-connection
waits, unknown-result continuity, expired/revoked authority, audit rollback and
preservation of inherited records/roles/global definitions. The exact source
push, all mandatory cloud jobs and branded build are recorded separately from
hosted acceptance; no local runtime is used.

The first STANDARD candidate read reproduced a 15-second timeout in both cloud
configurations. The measured correction narrows necessary organisation binding
inputs before expanding reviewer candidates, materialises current scoped
authority per organisation, retains every existing membership/person predicate
and output rule, and rechecks every returned product/organisation immediately
before the final context guard. It does not extend the timeout, shrink fixtures,
change global authority, or treat planning-only EXPLAIN as actual execution.
Failed receipts remain in the native acceptance record; the rc34 source/cloud
candidate is distinct from the accepted hosted rc33 baseline.

This increment does **not** claim complete Stage3 acceptance. Current disclosure
text digests are not authenticated supplier e-signature evidence. Actual offering
file intake/processing, complete common rights/custody/register/governance
configuration and configuration-bound approvals remain named following work.
Quarantined evidence does not become clean or approved because package review
passed. Technical readiness and financial opening remain Stage4 work. MAIN stays
unactivated and genuine provider/customer admission is not simulated as real.

DocuSign's developer sandbox is the selected signing supplier. Supplier choice
does not imply an account, credentials or a completed envelope. The integration
must bind the original document hashes, immutable offering revision, person and
active capacity; authenticate supplier evidence; and retain completed documents
and certificate/audit evidence. A signing-page return parameter alone is not
signature acceptance. No hosted signing credentials or envelope are created by
this source/cloud increment.
