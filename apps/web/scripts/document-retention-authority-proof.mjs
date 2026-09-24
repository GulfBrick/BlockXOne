import assert from 'node:assert/strict'

// Invoked only after the lifecycle and retention migrations inside the
// existing disposable GitHub PostgreSQL17 transaction. No network or browser
// provider is contacted; no hosted customer document is read or deleted.
export async function proveDocumentRetentionAuthority(db) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Document retention proof requires exact disposable cloud fixture')

  const doc = 'ed420000-0000-4000-8000-000000000001'
  const applicant = 'ed400000-0000-4000-8000-000000000001'
  const applicantSession = 'ed410000-0000-4000-8000-000000000001'
  const application = 'ed430000-0000-4000-8000-000000000001'
  const compliance = 'e1000000-0000-4000-8000-000000000002'
  const adminId = 'e1000000-0000-4000-8000-000000000010'
  const sameHumanAdmin = 'e1000000-0000-4000-8000-000000000017'
  const unmappedCompliance = 'e1000000-0000-4000-8000-000000000018'
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const wrongScope = 'e3000000-0000-4000-8000-000000000002'
  const reviewerContext = { mode: 'ROLE', organisationId: scope, role: 'ComplianceOfficer' }
  const approverContext = { mode: 'ROLE', organisationId: scope, role: 'SuperAdmin' }
  const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  let sequence = 0, checks = 0
  const key = () => `ef710000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  const admin = async () => db.query('reset role')
  const actor = async (id, sessionId, assured = true) => {
    await admin()
    const claim = { sub: id, session_id: sessionId, role: 'authenticated',
      aal: assured ? 'aal2' : 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 }
    if (assured) claim.amr = [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }]
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claim)])
    await db.query('set local role authenticated')
  }
  const governance = async (id, sessionId, context, action, related = null, retention = null, requestKey = key()) => {
    await actor(id, sessionId)
    return scalar('select public.bx1_document_governance_command($1::uuid,$2::jsonb,$3::uuid,$4,$5,$6::timestamptz,$7::bigint)',
      [doc, JSON.stringify(context), requestKey, action,
        `Synthetic ${action.toLowerCase().replaceAll('_', ' ')} rationale`, retention, related])
  }
  const denied = async (label, operation, code = '42501') => {
    await db.query('savepoint retention_expected_denial')
    let failure
    try { await operation() } catch (error) { failure = error }
    await db.query('rollback to savepoint retention_expected_denial; release savepoint retention_expected_denial')
    await admin()
    eq(failure?.code, code, label)
  }
  const future = () => new Date(Date.now() + 15000).toISOString()

  await admin()
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true,
    'exact disposable PostgreSQL fixture')
  eq(await scalar("select mode='SCANNER_REQUIRED' from bx1_private.document_lifecycle_policy where singleton"),
    true, 'clean scanner-required fixture remains active')
  eq(await scalar('select count(*)::int from bx1_private.document_governance_events'), 0,
    'migration seeds no governance approvals')

  // The clean scanned fixture's draft is submitted through the real guarded
  // applicant entry command, binding the exact promoted receipt to one case.
  const manifest = { id: doc, kind: 'IDENTITY', title: 'Synthetic clean evidence',
    storage_path: `${applicant}/${doc}`, sha256: 'b'.repeat(64), size: 25,
    mime_type: 'application/pdf' }
  const details = { full_name: 'Synthetic Retention Applicant', country: 'ZA',
    investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
    source_of_funds: 'Fictional test capital only, with no real customer money.',
    beneficial_owners: '', experience: 'Synthetic investment experience for workflow testing only.',
    documents: [manifest], test_data_acknowledged: true }
  await actor(applicant, applicantSession, false)
  await scalar('select public.bx1_entry_command($1,$2::uuid,$3::jsonb)',
    ['submit_application', key(), JSON.stringify({ application_id: application,
      expected_revision: 1, details })])
  await admin()
  eq(await scalar('select count(*)::int from bx1_private.document_application_bindings where receipt_id=$1 and application_id=$2',
    [doc, application]), 1, 'guarded applicant submission bound exact scanned receipt')
  eq(await scalar('select bx1_private.document_disposal_authorised($1::uuid)', [doc]), false,
    'a clean receipt alone cannot authorise disposal')

  // Same person, different Auth principal: both accounts are real synthetic
  // sessions and roles, but the second login cannot become an approver.
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'same-human-retention-admin@example.invalid',clock_timestamp(),false),($2,'unmapped-retention-reviewer@example.invalid',clock_timestamp(),false)",
    [sameHumanAdmin, unmappedCompliance])
  for (const n of [17, 18]) {
    await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp())", [sid(n), uid(n)])
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(n + 70), uid(n)])
    await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2", [sid(n + 70), sid(n)])
    await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)',
      [uid(n), `Synthetic retention actor ${n}`])
  }
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'SuperAdmin'),($3,$2,'ComplianceOfficer')",
    [sameHumanAdmin, scope, unmappedCompliance])
  await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) select $1,p.person_id,'TRUSTED','synthetic:same-human-retention-principal',$2 from bx1_private.person_principals p where p.auth_user_id=$3",
    [sameHumanAdmin, sid(89), compliance])
  eq(await scalar('select count(distinct person_id)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])',
    [[compliance, sameHumanAdmin]]), 1, 'distinct logins map to one attested human')
  await denied('unmapped Compliance principal cannot request retention',
    () => governance(unmappedCompliance, sid(18), reviewerContext, 'RETENTION_REQUESTED', null, future()))
  await denied('wrong tenant cannot request retention',
    () => governance(compliance, sid(2),
      { ...reviewerContext, organisationId: wrongScope }, 'RETENTION_REQUESTED', null, future()))
  await denied('AAL1 cannot request retention', async () => {
    await actor(compliance, sid(2), false)
    await scalar('select public.bx1_document_governance_command($1::uuid,$2::jsonb,$3::uuid,$4,$5,$6::timestamptz,$7::bigint)',
      [doc, JSON.stringify(reviewerContext), key(), 'RETENTION_REQUESTED',
        'Synthetic AAL1 denial rationale', future(), null])
  })

  const retentionUntil = future()
  const requested = await governance(compliance, sid(2), reviewerContext,
    'RETENTION_REQUESTED', null, retentionUntil)
  eq(requested.disposal_authorised, false, 'retention request alone cannot authorise disposal')
  await denied('same human under a second login cannot approve retention',
    () => governance(sameHumanAdmin, sid(17), approverContext,
      'RETENTION_APPROVED', requested.event_id))
  eq(await scalar("select count(*)::int from bx1_private.document_governance_events where action='RETENTION_APPROVED'"),
    0, 'same-person rejection made no approval event')
  await denied('another tenant context cannot approve retention',
    () => governance(adminId, sid(10), { ...approverContext, organisationId: wrongScope },
      'RETENTION_APPROVED', requested.event_id))
  await db.query('savepoint retention_revocation_case')
  await admin()
  await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and organisation_id=$2 and role='ComplianceOfficer'",
    [compliance, scope])
  await denied('revoked requester Compliance role blocks later approval',
    () => governance(adminId, sid(10), approverContext, 'RETENTION_APPROVED', requested.event_id))
  await db.query('rollback to savepoint retention_revocation_case; release savepoint retention_revocation_case')
  await db.query('savepoint retention_revision_case')
  // The synthetic revision bump still crosses the receipt trigger. Present
  // the original applicant's JWT while fixture-owned postgres mutates it.
  await actor(applicant, applicantSession, false)
  await admin()
  await db.query('update bx1_portal.applications set revision=revision+1 where id=$1', [application])
  await denied('changed application revision blocks stale approval',
    () => governance(adminId, sid(10), approverContext, 'RETENTION_APPROVED', requested.event_id))
  await db.query('rollback to savepoint retention_revision_case; release savepoint retention_revision_case')
  const approved = await governance(adminId, sid(10), approverContext,
    'RETENTION_APPROVED', requested.event_id)
  eq(approved.disposal_authorised, false, 'future retention date still blocks disposal')
  eq(await scalar('select retention_until from bx1_private.document_quarantine_items where id=$1', [doc]),
    new Date(retentionUntil), 'independent approval stores exact retention date')
  await denied('one request cannot receive a second decision',
    () => governance(adminId, sid(10), approverContext, 'RETENTION_REJECTED', requested.event_id))

  const waitMs = Math.max(0, new Date(retentionUntil).getTime() - Date.now() + 100)
  await new Promise(resolve => setTimeout(resolve, waitMs))
  eq(await scalar('select bx1_private.document_disposal_eligible($1::uuid)', [doc]), true,
    'approved retention has passed and no hold remains')
  const held = await governance(compliance, sid(2), reviewerContext, 'HOLD_PLACED')
  eq(held.disposal_authorised, false, 'legal hold blocks disposal')
  await denied('disposal request requires admitted retention policy even while held',
    () => governance(compliance, sid(2), reviewerContext, 'DISPOSAL_REQUESTED'), '55000')
  const releaseRequest = await governance(compliance, sid(2), reviewerContext,
    'HOLD_RELEASE_REQUESTED', held.event_id)
  await governance(adminId, sid(10), approverContext, 'HOLD_RELEASED', releaseRequest.event_id)
  eq(await scalar('select bx1_private.document_disposal_eligible($1::uuid)', [doc]), true,
    'independently released hold restores eligibility only')

  await denied('expired retention date alone cannot start disposal',
    () => governance(compliance, sid(2), reviewerContext, 'DISPOSAL_REQUESTED'), '55000')
  await denied('disposal approval cannot bypass absent policy',
    () => governance(adminId, sid(10), approverContext, 'DISPOSAL_APPROVED', requested.event_id), '55000')
  await actor(adminId, sid(10))
  const state = await scalar('select public.bx1_document_governance_state($1::uuid,$2::jsonb)',
    [doc, JSON.stringify(approverContext)])
  eq(state.disposal_completed, false, 'reviewed date does not claim Storage deletion')
  eq(state.disposal_authorised, false, 'unadmitted retention policy blocks disposal')
  await admin()
  eq(await scalar('select count(*)::int from storage.objects where bucket_id=$1 and name=$2',
    ['bx1-portal-documents', manifest.storage_path]), 1,
  'reviewed date leaves exact Storage object intact')
  await denied('other tenant cannot read document governance history', async () => {
    await actor(adminId, sid(10))
    await scalar('select public.bx1_document_governance_state($1::uuid,$2::jsonb)',
      [doc, JSON.stringify({ ...approverContext, organisationId: wrongScope })])
  })
  await db.query('savepoint retention_expired_request_case')
  await admin()
  const expiredRequest = await scalar(`with prior as (
    select e.*,clock_timestamp()-interval '25 hours' as started
    from bx1_private.document_governance_events e where e.id=$2)
    insert into bx1_private.document_governance_events
    (document_id,application_id,reviewer_scope,actor_id,actor_person_id,actor_membership_id,
      application_revision,request_key,action,reason,retention_until,storage_path,sha256,
      created_at,review_expires_at)
    select document_id,application_id,reviewer_scope,actor_id,actor_person_id,actor_membership_id,
      application_revision,$1::uuid,'RETENTION_REQUESTED','Synthetic expired request denied',
      retention_until,storage_path,sha256,started,started+interval '24 hours'
    from prior returning id`,
  [key(), requested.event_id])
  await denied('expired request cannot receive a late approval',
    () => governance(adminId, sid(10), approverContext, 'RETENTION_APPROVED', expiredRequest))
  await db.query('rollback to savepoint retention_expired_request_case; release savepoint retention_expired_request_case')

  // The audit event is written before any mutable hold change. A failing
  // append must roll back the whole command without a hold or completion flag.
  await db.query('savepoint disposal_audit_failure_case')
  await db.query(`create function bx1_private.reject_test_governance_audit() returns trigger
    language plpgsql as $$ begin raise exception 'synthetic_audit_unavailable' using errcode='55000'; end $$`)
  await db.query('create trigger reject_test_governance_audit before insert on bx1_private.document_governance_events for each row execute function bx1_private.reject_test_governance_audit()')
  await denied('audit failure blocks governance action',
    () => governance(compliance, sid(2), reviewerContext, 'HOLD_PLACED'), '55000')
  await db.query('rollback to savepoint disposal_audit_failure_case; release savepoint disposal_audit_failure_case')
  eq(await scalar('select bx1_private.document_disposal_authorised($1::uuid)', [doc]), false,
    'audit failure cannot activate disposal')
  return checks
}
