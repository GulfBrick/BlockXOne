import assert from 'node:assert/strict'

// Called only by the existing disposable GitHub PostgreSQL17 fixture, after
// the customer-monitoring migration and the synthetic v3 customer approval.
// This module opens no connection, sends no email and modifies no cloud app.
export async function proveCustomerMonitoring(db, {
  applicationId, organisationId, draftProductId, managerMandateId,
  investorApplicationId, investorAccountId, entityApplicationId,
  entityAccountId, entityMandateId, eligibilityCaseId,
}) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Customer monitoring proof requires the disposable cloud fixture')

  const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const reviewer = { mode: 'ROLE', organisationId: scope, role: 'ComplianceOfficer' }
  const checks = { identity: true, ownership: true, screening: true, suitability: true }
  const key = n => `e1490000-0000-4000-8000-${String(n).padStart(12, '0')}`
  let passed = 0
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++ }
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  const admin = async () => db.query('reset role')
  const actor = async (n, aal = 'aal2') => {
    await admin()
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', aal,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })])
    await db.query('set local role authenticated')
  }
  const command = async (n, payload, requestKey, aal = 'aal2', context = reviewer) => {
    await actor(n, aal)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',
      ['set_customer_monitoring', requestKey, JSON.stringify(payload), JSON.stringify(context)])
  }
  const denied = async (label, action, expectedCode = '42501') => {
    await db.query('savepoint monitoring_expected_denial')
    let code
    try { await action() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint monitoring_expected_denial; release savepoint monitoring_expected_denial')
    await admin()
    eq(code, expectedCode, label)
  }
  const payload = (state, revision, suffix) => ({
    application_id: applicationId,
    expected_revision: revision,
    state,
    evidence_reference: `synthetic-cloud-review:${suffix}:immutable-case-reference`,
    reason: `Independent synthetic reviewer records ${suffix} for a fictional customer only.`,
    checks: state === 'CURRENT' ? checks : {},
  })

  await admin()
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true,
    'monitoring proof uses disposable postgres only')
  eq(await scalar('select bx1_portal.monitoring_new_action_allowed($1)', [applicationId]), true,
    'historical customer is not automatically held')
  eq(await scalar('select count(*)::int from bx1_portal.customer_monitoring_cases where application_id=$1', [applicationId]), 0,
    'no monitoring case is invented for existing admission')
  eq(await scalar("select has_table_privilege('authenticated','bx1_portal.customer_monitoring_cases','SELECT,INSERT,UPDATE,DELETE')"), false,
    'browser cannot edit monitoring cases directly')
  eq(await scalar("select has_table_privilege('authenticated','bx1_portal.customer_monitoring_receipts','SELECT,INSERT,UPDATE,DELETE')"), false,
    'browser cannot edit monitoring receipts directly')
  eq(await scalar("select has_function_privilege('authenticated','bx1_portal.install_customer_monitoring_funding_hooks()','EXECUTE')"), false,
    'browser cannot install or replace monitoring funding gates')
  await db.query('select bx1_portal.assert_customer_monitoring_funding_hooks()')
  eq(await scalar("select to_regclass('bx1_portal.funding_routes') is null"), true,
    'MAIN-compatible monitoring migration permits absent TEST-only funding tables')
  await db.query('savepoint monitoring_late_funding_install')
  await db.query(`create table bx1_portal.funding_routes(id uuid,organisation_id uuid,status text);
    create table bx1_portal.funding_obligations(id uuid,investment_account_id uuid,
      investor_id uuid,organisation_id uuid);
    create table bx1_portal.funding_references(id uuid,obligation_id uuid);
    create table bx1_portal.funding_acceptances(id uuid,kind text,approved_by uuid,reference_id uuid);
    create table bx1_portal.funding_journals(id uuid,kind text,obligation_id uuid)`)
  await denied('late funding install fails closed before hooks are present',
    () => db.query('select bx1_portal.assert_customer_monitoring_funding_hooks()'), '55000')
  await db.query('select bx1_portal.install_customer_monitoring_funding_hooks()')
  await db.query('select bx1_portal.assert_customer_monitoring_funding_hooks()')
  eq(await scalar(`select count(*)::int from pg_catalog.pg_trigger t
    where t.tgname like 'bx1_monitoring_funding_%' and not t.tgisinternal`), 4,
  'late-installed funding requires all four monitoring hooks')
  await db.query('rollback to savepoint monitoring_late_funding_install; release savepoint monitoring_late_funding_install')
  eq(await scalar("select to_regclass('bx1_portal.funding_routes') is null"), true,
    'synthetic late-install proof leaves no funding table in the portal-only fixture')
  // The customer operating organisation already has an OfferingManager
  // appointment. A reviewer in the same native scope still needs a separate
  // product-organisation Compliance appointment; role/scope alone is not it.
  await actor(2)
  eq(await scalar("select bx1_portal.scoped_reviewer($1::jsonb,$2::uuid,$3::uuid)",
    [JSON.stringify(reviewer), scope, organisationId]), false,
  'native Compliance role alone does not bypass product-organisation appointment')
  await admin()
  await db.query(`insert into bx1_portal.organisation_authority_bindings
    (product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,
      evidence_reference,approval_receipt_id)
    values($1,$2,'ComplianceOfficer','ACTIVE',clock_timestamp()-interval '1 hour',
      clock_timestamp()+interval '1 hour','synthetic-cloud-monitoring:appointed-compliance',
      pg_catalog.gen_random_uuid())`, [organisationId, scope])
  const baseline = await scalar(`select jsonb_build_object(
    'application_revision',a.revision,'approval_expires',a.approved_until,
    'org_count',(select count(*) from bx1_portal.organisations where application_id=a.id),
    'native_count',(select count(*) from public.bx1_organisations))
    from bx1_portal.applications a where a.id=$1`, [applicationId])
  eq(baseline.org_count, 1, 'approved customer has one existing organisation')
  const hold = payload('ON_HOLD', 0, 'hold')
  await denied('AAL1 Compliance cannot impose a hold', () => command(2, hold, key(1), 'aal1'))
  await denied('customer cannot impose own hold', () => command(14, hold, key(2), 'aal2', { mode: 'APPLICANT' }))
  await denied('other-organisation role cannot impose hold', () => command(5, hold, key(3), 'aal2',
    { mode: 'ROLE', organisationId: 'e3000000-0000-4000-8000-000000000002', role: 'ComplianceOfficer' }))

  const first = await command(2, hold, key(4))
  eq(first.customer_monitoring.find(c => c.application_id === applicationId)?.state, 'ON_HOLD',
    'reviewed hold appears in scoped Compliance queue')
  const retry = await command(2, hold, key(4))
  eq(retry.customer_monitoring.find(c => c.application_id === applicationId)?.case_revision, 1,
    'same request key replays one monitoring decision')
  await admin()
  eq(await scalar('select bx1_portal.monitoring_new_action_allowed($1)', [applicationId]), false,
    'hold blocks new customer activity at database boundary')
  eq(await scalar('select bx1_portal.current_product_organisation($1)', [organisationId]), false,
    'held customer cannot appear as an operational product organisation')
  if (managerMandateId) eq(await scalar('select bx1_portal.representative_mandate_effective($1)',
    [managerMandateId]), false, 'held wealth-manager appointment no longer projects effective')
  await actor(5)
  eq((await scalar('select public.bx1_portal_read_scoped($1::jsonb)',
    [JSON.stringify({ mode: 'ROLE', organisationId: 'e3000000-0000-4000-8000-000000000002', role: 'ComplianceOfficer' })]))
    .customer_monitoring.some(c => c.application_id === applicationId), false,
  'other-organisation reviewer cannot read the held customer case')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.customer_monitoring_receipts where application_id=$1', [applicationId]), 1,
    'hold has one immutable receipt')
  await denied('stale reviewer revision cannot replace hold', () => command(2, payload('RENEWAL_REQUIRED', 0, 'stale'), key(5)), '23514')
  await denied('monitoring receipt cannot be rewritten', () => db.query(
    "update bx1_portal.customer_monitoring_receipts set reason='forged' where application_id=$1", [applicationId]), '23514')
  await denied('direct new product insert is stopped, not just the UI command', () => db.query(`
    insert into bx1_portal.products(organisation_id,created_by,terms,terms_hash,cap_units,unit_price_minor,minimum_units)
    select organisation_id,created_by,terms,terms_hash,cap_units,unit_price_minor,minimum_units
    from bx1_portal.products where id=$1`, [draftProductId]))
  const decision = await command(2, payload('RENEWAL_REQUIRED', 1, 'renewal-required'), key(6))
  eq(decision.customer_monitoring.find(c => c.application_id === applicationId)?.state, 'RENEWAL_REQUIRED',
    'renewal requirement is a separate reviewed state, not an approval')
  await denied('lifting a hold requires complete renewed checks', () => command(2,
    { ...payload('CURRENT', 2, 'unchecked-release'), checks: {} }, key(7)), '22023')
  const cleared = await command(2, payload('CURRENT', 2, 'cleared-before-underlying-expiry'), key(8))
  eq(cleared.customer_monitoring.find(c => c.application_id === applicationId)?.new_actions_allowed, true,
    'independently reviewed release restores only the still-current admission')
  if (managerMandateId) eq(await scalar('select bx1_portal.representative_mandate_effective($1)',
    [managerMandateId]), true, 'clearance restores only the unchanged approved appointment')
  await admin()
  const after = await scalar(`select jsonb_build_object(
    'application_revision',a.revision,'approval_expires',a.approved_until,
    'org_count',(select count(*) from bx1_portal.organisations where application_id=a.id),
    'native_count',(select count(*) from public.bx1_organisations))
    from bx1_portal.applications a where a.id=$1`, [applicationId])
  eq(after, baseline, 'hold and release neither extend admission nor create another organisation')
  eq(await scalar('select count(*)::int from bx1_portal.customer_monitoring_receipts where application_id=$1', [applicationId]), 3,
    'hold, renewal-required, and clearance have distinct immutable receipts')
  eq(await scalar('select exists(select 1 from bx1_portal.products where id=$1)', [draftProductId]), true,
    'existing product record was preserved through hold')

  // Expiry must still win over a CURRENT monitoring decision. Rewind only the
  // synthetic application's original reviewed_at/approved_until, then roll it
  // back so subsequent fixture assertions see the original admission.
  await db.query('savepoint monitoring_expiry_probe')
  await db.query("update bx1_portal.applications set reviewed_at='2026-08-01 00:00:00+00'::timestamptz, approved_until='2026-08-31 00:00:00+00'::timestamptz where id=$1", [applicationId])
  eq(await scalar('select bx1_portal.monitoring_new_action_allowed($1)', [applicationId]), false,
    'expired original admission cannot be refreshed by CURRENT monitoring state')
  await command(2, payload('ON_HOLD', 3, 'expired-hold'), key(9))
  await denied('reviewer cannot clear into an expired underlying approval', () => command(2,
    payload('CURRENT', 4, 'expired-clear'), key(10)), '23514')
  await db.query('rollback to savepoint monitoring_expiry_probe; release savepoint monitoring_expiry_probe')
  await admin()

  if (investorApplicationId && investorAccountId) {
    await actor(3, 'aal1')
    eq(await scalar('select bx1_portal.account_usable($1::jsonb,$2::uuid)',
      [JSON.stringify({ mode: 'APPLICANT' }), investorAccountId]),
    true, 'approved investor account is usable before its separate monitoring hold')
    await admin()
    const investorHold = payload('ON_HOLD', 0, 'investor-on-hold')
    investorHold.application_id = investorApplicationId
    const investorState = await command(2, investorHold, key(11))
    eq(investorState.customer_monitoring.find(c => c.application_id === investorApplicationId)?.state,
      'ON_HOLD', 'a separate investor has an independently reviewed hold')
    await actor(3, 'aal1')
    eq(await scalar('select bx1_portal.account_usable($1::jsonb,$2::uuid)',
      [JSON.stringify({ mode: 'APPLICANT' }), investorAccountId]),
    false, 'held investor account cannot be used for another subscription')
    await admin()
    if (eligibilityCaseId) eq(await scalar('select bx1_portal.product_eligibility_current($1)',
      [eligibilityCaseId]), false, 'product eligibility never projects effective for held investor')
    await denied('held investor cannot open another investment account', async () => {
      await admin()
      await db.query(`insert into bx1_portal.investment_accounts
        (holder_user_id,application_id,status,kind)
        select holder_user_id,application_id,status,kind from bx1_portal.investment_accounts
        where id=$1`, [investorAccountId])
    })
  }
  if (entityApplicationId && entityAccountId && entityMandateId) {
    eq(await scalar('select bx1_portal.investing_mandate_effective($1)', [entityMandateId]), true,
      'independent entity representative is effective before its customer hold')
    const entityHold = payload('ON_HOLD', 0, 'entity-investor-on-hold')
    entityHold.application_id = entityApplicationId
    await command(2, entityHold, key(12))
    eq(await scalar('select bx1_portal.entity_account_admission_current($1)', [entityAccountId]), false,
      'held entity admission no longer opens a new mandate')
    eq(await scalar('select bx1_portal.investing_mandate_effective($1)', [entityMandateId]), false,
      'held entity mandate is not projected as usable')
  }
  return passed
}

// Executed in the separate disposable funding fixture after the full funding
// feature, eligibility, entity-MFA boundary and offering migration. The
// reviewer is a synthetic, independently mapped human. No provider or chain
// claim is invented by this proof.
export async function proveCustomerMonitoringFunding(db, {
  investorApplicationId, heldObligationId, otherObligationId, unpostedReferenceId,
}) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_FUNDING_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Monitoring funding proof requires the disposable cloud fixture')
  const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const reviewer = { mode: 'ROLE', organisationId: scope, role: 'ComplianceOfficer' }
  const treasury = { mode: 'ROLE', organisationId: scope, role: 'TreasuryOperator' }
  const checks = { identity: true, ownership: true, screening: true, suitability: true }
  const key = n => `e2490000-0000-4000-8000-${String(n).padStart(12, '0')}`
  let passed = 0
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++ }
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  const admin = async () => db.query('reset role')
  const actor = async (n, aal = 'aal2') => {
    await admin()
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', aal,
      iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })])
    await db.query('set local role authenticated')
  }
  const command = async (n, state, revision, number, aal = 'aal2', c = reviewer) => {
    await actor(n, aal)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [
      'set_customer_monitoring', key(number), JSON.stringify({
        application_id: investorApplicationId, expected_revision: revision, state,
        evidence_reference: `synthetic-funding-hold:${number}:immutable-review-reference`,
        reason: `Independent synthetic reviewer records ${state} before funding acceptance or reconciliation.`,
        checks: state === 'CURRENT' ? checks : {},
      }), JSON.stringify(c),
    ])
  }
  const denied = async (label, action, expectedCode = '42501') => {
    await db.query('savepoint monitoring_funding_denied')
    let code
    try { await action() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint monitoring_funding_denied; release savepoint monitoring_funding_denied')
    await admin()
    eq(code, expectedCode, label)
  }

  await admin()
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true,
    'funding hold proof uses disposable CI role and database')
  await db.query('select bx1_portal.assert_customer_monitoring_funding_hooks()')
  eq(await scalar('select bx1_portal.funding_account_current($1)', [heldObligationId]), true,
    'existing investor obligation starts with current customer admission')
  eq(await scalar('select bx1_portal.funding_account_current($1)', [otherObligationId]), true,
    'unrelated investor obligation independently starts current')
  const before = await scalar(`select pg_catalog.jsonb_build_object(
    'journals',(select count(*) from bx1_portal.funding_journals),
    'lines',(select count(*) from bx1_portal.funding_journal_lines),
    'claims',(select count(*) from bx1_portal.funding_receipt_claims))`)
  // The funding-only fixture previously had no staff authenticator because
  // its financial tests predated the Stage 2 reviewer-MFA boundary.
  await db.query(`insert into auth.mfa_factors(id,user_id,status,factor_type)
    values($1,$2,'verified','totp') on conflict(id) do nothing`, [sid(82), uid(2)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2 and user_id=$3",
    [sid(82), sid(2), uid(2)])
  eq(await scalar('select bx1_portal.entity_people_independent($1,$2)', [uid(2), uid(3)]), true,
    'synthetic reviewer and held investor are distinct trusted people')
  await denied('AAL1 reviewer cannot hold an investor with an open funding obligation',
    () => command(2, 'ON_HOLD', 0, 1, 'aal1'))
  await denied('investor cannot hold own funding admission',
    () => command(3, 'ON_HOLD', 0, 2, 'aal2', { mode: 'APPLICANT' }))
  await denied('reviewer context from another organisation cannot hold investor',
    () => command(2, 'ON_HOLD', 0, 3, 'aal2', {
      mode: 'ROLE', organisationId: 'e3000000-0000-4000-8000-000000000002', role: 'ComplianceOfficer',
    }))
  const held = await command(2, 'ON_HOLD', 0, 4)
  eq(held.customer_monitoring.find(row => row.application_id === investorApplicationId)?.state,
    'ON_HOLD', 'independent authenticated reviewer records an investor hold')
  await admin()
  eq(await scalar('select bx1_portal.funding_account_current($1)', [heldObligationId]), false,
    'existing investor obligation loses funding acceptance eligibility immediately')
  eq(await scalar('select bx1_portal.funding_account_current($1)', [otherObligationId]), true,
    'another investor is not held by the first investor decision')
  await denied('held obligation cannot receive a newly proposed funding acceptance', () => db.query(`
    insert into bx1_portal.funding_acceptances(reference_id,kind,proposed_by,proposed_person,
      proposed_context,reference_revision,evidence_set_hash)
    select f.id,'ACCEPTANCE',$2,pp.person_id,$3::jsonb,f.revision,
      bx1_portal.funding_evidence_hash(o.id)
    from bx1_portal.funding_references f
      join bx1_portal.funding_obligations o on o.id=f.obligation_id
      join bx1_private.person_principals pp on pp.auth_user_id=$2
    where f.id=$1`, [unpostedReferenceId, uid(5), JSON.stringify(treasury)]))
  await denied('held obligation cannot post a funding journal directly', () => db.query(`
    insert into bx1_portal.funding_journals(obligation_id,reference_id,kind,
      amount_base_units,token_address,token_decimals,evidence_set_hash,posted_by,posted_person)
    select o.id,f.id,'FUNDING',obs.amount_base_units,r.token_address,r.token_decimals,
      bx1_portal.funding_evidence_hash(o.id),$2,pp.person_id
    from bx1_portal.funding_references f
      join bx1_portal.funding_obligations o on o.id=f.obligation_id
      join bx1_portal.funding_routes r on r.id=o.route_id
      join bx1_private.person_principals pp on pp.auth_user_id=$2
      cross join lateral bx1_portal.funding_last_observation(f.id) obs
    where f.id=$1`, [unpostedReferenceId, uid(2)]))
  await db.query('savepoint monitoring_exception_allowed')
  eq((await db.query(`insert into bx1_portal.funding_acceptances
    (reference_id,kind,decision,reason,proposed_by,proposed_person,proposed_context,
      reference_revision,evidence_set_hash)
    select f.id,'EXCEPTION','UNAPPLIED',
      'Synthetic exception remains reviewable during the investor hold.',
      $2,pp.person_id,$3::jsonb,f.revision,bx1_portal.funding_evidence_hash(o.id)
    from bx1_portal.funding_references f
      join bx1_portal.funding_obligations o on o.id=f.obligation_id
      join bx1_private.person_principals pp on pp.auth_user_id=$2
    where f.id=$1 returning id`, [unpostedReferenceId, uid(5), JSON.stringify(treasury)])).rowCount,
  1, 'hold does not obstruct exception or return-path evidence')
  await db.query('rollback to savepoint monitoring_exception_allowed; release savepoint monitoring_exception_allowed')
  const afterHold = await scalar(`select pg_catalog.jsonb_build_object(
    'journals',(select count(*) from bx1_portal.funding_journals),
    'lines',(select count(*) from bx1_portal.funding_journal_lines),
    'claims',(select count(*) from bx1_portal.funding_receipt_claims))`)
  eq(afterHold, before, 'hold cannot create or erase settlement claims or posted journal entries')
  await db.query('savepoint monitoring_missing_hook_probe')
  await db.query('drop trigger bx1_monitoring_funding_acceptance on bx1_portal.funding_acceptances')
  await denied('missing acceptance hook is detected before a feature release',
    () => db.query('select bx1_portal.assert_customer_monitoring_funding_hooks()'), '55000')
  await db.query('rollback to savepoint monitoring_missing_hook_probe; release savepoint monitoring_missing_hook_probe')
  await db.query('select bx1_portal.assert_customer_monitoring_funding_hooks()')
  const cleared = await command(2, 'CURRENT', 1, 5)
  eq(cleared.customer_monitoring.find(row => row.application_id === investorApplicationId)?.new_actions_allowed,
    true, 'reviewed clearance restores only still-current admission')
  await admin()
  eq(await scalar('select bx1_portal.funding_account_current($1)', [heldObligationId]), true,
    'historical obligation regains funding eligibility after current review')
  eq(await scalar(`select count(*)::int from bx1_portal.customer_monitoring_receipts
    where application_id=$1`, [investorApplicationId]), 2,
  'hold and release have separate immutable receipts')
  return passed
}
