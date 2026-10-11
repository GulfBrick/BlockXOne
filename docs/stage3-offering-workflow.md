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

## Proof and remaining Stage 3 scope

The existing cloud harness runs the retained rc32 admission and accepted Stage2
representatives proofs first. New proofs cover both templates, the connected
appointment/package cycle, revision-bound decisions, actual two-connection
waits, unknown-result continuity, expired/revoked authority, audit rollback and
preservation of inherited records/roles/global definitions. The exact source
push, all mandatory cloud jobs and branded build are recorded separately from
hosted acceptance; no local runtime is used.

This increment does **not** claim complete Stage3 acceptance. Current disclosure
text digests are not authenticated supplier e-signature evidence. Actual offering
file intake/processing, complete common rights/custody/register/governance
configuration and configuration-bound approvals remain named following work.
Quarantined evidence does not become clean or approved because package review
passed. Technical readiness and financial opening remain Stage4 work. MAIN stays
unactivated and genuine provider/customer admission is not simulated as real.
