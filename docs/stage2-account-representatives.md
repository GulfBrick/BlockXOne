# Stage 2 — representatives on one entity investment account

This extends the existing normal account workflow. It does not create another portal, investment account, organisation role or signing authority. The original architecture and eight-stage implementation plan remain authoritative.

## Connected workflow

1. The original applicant of a current, approved entity-investor application proposes a confirmed, already-admitted individual investor by email. The proposal identifies the existing legal-holder account, exact reviewed COMPANY appointment evidence, limited scope, zero transaction limit and expiry.
2. The named person sees its own proposal in the ordinary applicant account workspace. Only the exact appointment document is available: the entity's admission, provider history and other representatives are not disclosed. The person accepts or declines the saved revision and proposal hash.
3. Acceptance submits the unchanged proposal to the scoped Compliance queue. It grants no account access. Compliance must check whether the cited reviewed document actually appoints that named person; the proposer's assertion alone is insufficient.
4. A different scoped Super Admin applies the approved mandate. Only a currently effective applied mandate provides the stated account view and the ability to request eligibility when that separate product workflow is admitted. There is no trading, funding, token signing, organisation management or inherited product eligibility.

The original applicant can still request its own mandate with the unchanged payload and receipt semantics. Existing account-view representatives cannot appoint or delegate to others. A decline, expiry or revocation belongs to one representative/cycle, not to the whole account.

## Existing interfaces

- `request_investing_representative_mandate`: unchanged self payload; an additional proposal includes `representative_email`. The server resolves identity and current admission. Client-supplied user IDs, roles, scope and approval flags are rejected.
- `respond_investing_representative_proposal`: `mandate_id`, `expected_revision`, `proposal_hash`, `decision` (`ACCEPT` or `DECLINE`). Only the named person may respond to the exact current proposal.
- Existing review/apply/revoke commands retain their canonical guarded writers. Protected revocation is not part of the temporary TEST password admission exception.
- Existing private-document GET accepts mutually exclusive `mandate_id` and `id` with applicant context. `bx1_investing_proposal_document_lookup` rechecks the exact current proposal. A download repeats that lookup and verifies the private Storage bytes, size, type and hash. It does not produce a public link or reveal the entity application.

Proposals and responses are immutable cycle evidence. Changed appointment facts, changes-required or an expired/terminal cycle need a new proposal and new consent. A new document cannot silently replace the entity's previously reviewed evidence; an account/admission rebind is a separate reviewed operation.

## Verification and boundaries

The additive feature and proof run only in the existing disposable GitHub cloud PostgreSQL fixture. Retained rc.32 admission acceptance runs first, unchanged. The extension exercises one account and distinct target logins through proposal, consent, review, apply, current evidence checks, isolated expiry/revocation, idempotency, audit rollback and genuine two-backend concurrency. Normal mounted UI and document API tests cover the same handoff and target isolation in both configurations.

Source/cloud acceptance is not hosted activation or independent-human acceptance. No hosted role, account, factor, provider result, document-processing policy, customer approval, money or contract is changed by these tests. Synthetic unscanned evidence remains labelled `SYNTHETIC_UNSCANNED`; it is not relabelled malware-clean. MAIN and all financial, eligibility, signing and global security gates are unchanged. The matching generated release migration and separately reviewed environment release precede any installation.

The later rollout is compatibility-first: publish the reviewed web reader that accepts the retained eleven-command projection as well as the extended twelve-command projection, then atomically install the generated feature migration. The old rc.32 web reader rejects the new response command; database-first installation or rolling back to that reader after extension would break applicant portal reads. Before database installation, all new fields/actions are absent and the new web preserves the retained path. Do not resolve that mismatch by loosening projection validation or changing a global admission flag.

Positive modern product eligibility follows approved Stage 3 fund/property packages and Stage 4 technical readiness. This account extension does not manufacture either dependency or declare all Stage 2 requirements complete.
