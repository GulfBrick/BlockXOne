# Stage 1 first-time staff invitations — release contract

This increment adds one guarded route inside the existing BlockXOne web app.
It does not grant a role when an invitation is proposed, approved, queued,
sent, or email-confirmed. A current verified TOTP session must accept the
exact email-bound invitation before a scoped membership is created. Existing
memberships continue through the existing administration workflow.

## Dependencies before enabling a hosted send

1. Review/apply `20260924110911_stage1_staff_invitation_intents.sql` to TEST,
   then MAIN only after TEST checks. The migration is additive; it seeds no
   real person, invitation, role, email, or Auth credential. Run Supabase
   Security Advisor after applying it and review every new definer function.
2. Deploy `bx1-staff-invite-dispatch` to each corresponding Supabase project
   with JWT verification **enabled**. The handler independently calls
   `auth.getUser(bearer)` and a caller-JWT guarded claim RPC; a project API key
   alone cannot select an email or role. `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   and legacy `SUPABASE_SERVICE_ROLE_KEY` must be present as server-only Edge
   Function secrets. Do not copy a service key to Vercel or the browser.
   If the service credential is absent, dispatch fails closed.
3. In each Supabase Auth project, allow-list the exact corresponding URL
   `https://testnet.bx1.co.za/auth/confirm` or
   `https://bx1.co.za/auth/confirm`. Review the **Invite** email template so
   the actual link reaches that origin with `token_hash` and `type=invite` in
   the query. `redirectTo` alone is not proof of the delivered link format.
   Check the actual TEST mailbox link and callback first, without sharing its
   token in logs or chat. Preserve existing signup/recovery templates.
4. Verify Resend/Supabase SMTP receipt and the configured TEST sender; a
   successful Auth API response is not proof of mailbox delivery. MAIN sending
   requires a separately approved operational release.
5. Ship the same web source/routes on testnet.bx1.co.za and bx1.co.za. MAIN
   staff invitation commands remain inert until the migration and Edge
   function are both present and live governance is admitted.

## Hosted proof without a real invitation

The current cloud CI job uses only a disposable GitHub PostgreSQL 17 service,
synthetic Auth rows and fixed synthetic credentials. It proves SQL permission
boundaries, wrong email, exact scope, independent approvers, AAL1 denial,
revocation, expiry, audit rollback, idempotent replay, and a two-connection
duplicate race. It does **not** invoke Supabase Auth, send SMTP, or prove a
browser mailbox journey. No local database is required.

For hosted acceptance, perform a separately authorised TEST rehearsal with
different real operators: propose, independent approve, apply, send, inspect
actual email/redirect, verify email, set password, enroll/verify TOTP, accept,
then test staff dashboard at AAL2 and denial at AAL1 and across organisations.
Check the database event/outbox receipt and Auth `invited_at` evidence without
exposing credentials. Do not claim MAIN admission from a TEST rehearsal.

If send result is unknown, the invitation stays `DISPATCHING` and cannot be
automatically resent. An authorised operator may use **Reconcile unknown
send**; it reads the exact Auth invitation ID and lease marker, email, and
post-lease `invited_at`/`confirmation_sent_at`. Only matching provider evidence
links the user. Missing/ambiguous evidence stays unknown and requires an
incident decision, not a blind resend or manual database role grant.

## Remaining acceptance gap

Lost-authenticator recovery is **not** implemented by this increment. Password
recovery and deleting an unverified factor are not substitutes. A separate
guarded identity-verification, independent approval, session/factor revocation,
fresh enrollment, and audit procedure is required before claiming complete
Stage 1 recovery acceptance.
