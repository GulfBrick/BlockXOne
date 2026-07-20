# Repository History Credential-Exposure Incident

**Incident ID:** BX1-SEC-2026-07-19-01
**Status:** Open — local working-tree containment applied; credential rotation and remote-history response require authorised humans
**Severity:** P0 for Phase 0 exit
**First affected commit:** `df3e1698f28891e7d23489a144eae2733bc8b79d`
**Affected remote ref confirmed 2026-07-19:** `origin/main` at `df3e1698f28891e7d23489a144eae2733bc8b79d`

Human owners should record references and sign-offs in `2026-07-19-REPOSITORY-HISTORY-INCIDENT-ACTION-RECORD.md`; never put secret values in that record.

## Executive finding

The inherited Git baseline tracked `BlockXOne-fullstack.zip`. A name-only archive inspection found an entry named `BlockXOne-fullstack/apps/web/.env.local`. No environment values were inspected, copied or printed during this review.

Because the opaque archive is reachable from the configured GitHub remote's `main` branch, every credential that may have been present in that runtime environment file must be treated as exposed until an authorised secret owner proves it was a non-secret placeholder or rotates/revokes it. Deleting the archive from the current checkout does not remove it from Git history, clones, caches or pull-request references.

The same baseline also tracked two generated executables:

- `api.exe` — 20,768,256 bytes; SHA-256 `B1D1E4C66FD9F8DD371E7EB193F2C8D4CD2DC41C0959F9B873A3AA7CDCC41449`
- `bin/api.exe` — 20,497,408 bytes; SHA-256 `498FECF42FCA658128057BA1A2B2D49C15FA4D4C9A5C40601A583D437943D9A8`

The archive was 3,524,634 bytes with SHA-256 `3B3E28C60ECD0BF438C5D094F2278DFAF448B8CA8388104FE5ED85F32C979EC8`.

## Containment completed locally

- Removed the archive and both executables from the active Phase 0 working tree. They remain recoverable from the quarantined contaminated Git history, subject to the incident-retention decision. A name-only check confirmed that the separately created external source-recovery archive excluded these three paths.
- Expanded `.gitignore` to reject runtime `.env.*`, private-key/certificate material, executables and opaque archives while retaining reviewed environment examples.
- Added `.planning/scripts/validate-repository-artifacts.ps1` to reject prohibited path classes in both the checked-out tree and all history reachable from `HEAD`.
- Added the artifact/history validator as a mandatory CI planning gate.
- Kept deployment, remote push, production access, provider calls, wallet/RPC activity and history rewriting blocked.

These controls prevent a clean replacement branch from silently reintroducing the contaminated ancestry. They do not remediate credentials or the existing remote.

## Immediate human actions — rotate before rewriting history

The incident owner and authorised provider administrators must review the archived environment in a secured incident workspace outside Git, chat, tickets and build logs. Do not paste secret values into this repository or an agent conversation.

At minimum, determine whether the archived file contained live values for these secret classes suggested by the reviewed example contract, then revoke/rotate them wherever they exist:

- Firebase Admin private key and service-account credentials;
- tokenisation or blockchain signing private key;
- KYC provider API key and secret;
- custody provider API key or signing credential;
- payment provider secret;
- webhook shared secret;
- App Check debug token;
- authenticated RPC endpoint tokens embedded in URLs;
- Sentry/telemetry ingestion credentials if the provider treats them as sensitive.

Review `NEXT_PUBLIC_*` identifiers separately. They are client-visible by design, but their provider restrictions, allowed origins, quotas and abuse logs still require confirmation.

Inventory Docker builders, remote build caches, registries, CI artifacts and software-bill-of-materials/provenance records that processed an affected commit. The tracked archive may have entered a Docker build context even when it was not copied into a final image. Inspect and invalidate or expire affected caches and artifacts under the authorised incident-retention policy; do not silently delete evidence.

For each secret class, capture outside the repository:

1. provider/account owner;
2. environment and privilege scope;
3. whether the archived value was live or placeholder;
4. revoke/rotation timestamp and new secret-store reference;
5. dependent services updated and restarted;
6. provider audit-log review from 2026-01-22 through rotation;
7. evidence reviewer and sign-off.

If any privileged signing key was live, treat every address, role and transaction it could authorise as a separate blockchain incident scope. Revoke on-chain roles or migrate control through the authorised key ceremony before relying on a replacement key.

## Remote-history decision gate

After rotation, the repository owner, incident lead and legal/privacy owner must choose and sign one response:

### Option A — new clean repository or clean-root production lineage (recommended)

- Freeze the contaminated repository against new pushes.
- Create a root snapshot containing only reviewed source and evidence.
- Prove the snapshot and its reachable history pass the repository-artifact validator and a redacted dedicated secret scan.
- Move collaborators and automation to fresh clones; archive the old repository under restricted access and retention policy.
- Preserve a controlled evidence mapping from old commits to the new root without copying the prohibited archive.

This avoids merging contaminated ancestors into the production lineage. It does not erase copies that already exist.

### Option B — coordinated GitHub history rewrite

- Follow GitHub's sensitive-data-removal procedure using a disposable mirror clone and `git-filter-repo --sensitive-data-removal`.
- Remove `BlockXOne-fullstack.zip`, `api.exe` and `bin/api.exe` from every affected branch, tag and ref.
- Inventory affected pull requests, forks, caches and collaborator clones.
- Obtain explicit approval before disabling branch protection or force-pushing rewritten refs.
- Coordinate fresh clones or careful rebases; never merge an old contaminated branch into cleaned history.
- Contact GitHub Support when cached views or pull-request refs require server-side removal.

GitHub explicitly recommends revoking or rotating credentials first and warns that history rewriting changes commit hashes, can disrupt collaborators and can be recontaminated by old clones. See [Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

## Exit evidence

This incident blocks Phase 0 until all of the following are captured:

- signed credential inventory and rotation/revocation record, or provider-owner proof that each archived value was non-secret;
- approved remote-history response and named incident owner;
- clean production ref/repository whose full reachable history passes `validate-repository-artifacts.ps1`;
- redacted dedicated secret scan of the clean exact commit and reachable history;
- confirmation that GitHub refs/caches, forks and collaborator clones were handled according to the chosen option;
- independent verification and Phase 0 human approval.

## Non-claims

- This report does not assert that a credential was used maliciously.
- It does not assert the GitHub repository was publicly visible.
- It does not certify that deletion from the working tree removed remote or cloned copies.
- It is not legal advice and does not replace an incident-response, privacy or regulatory assessment by qualified owners.
