import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

// Invoked only by the retained disposable GitHub PostgreSQL fixture, AFTER
// admission795 and the committed representatives proof. No parent reinstall.
const clone = value => JSON.parse(JSON.stringify(value))
const family = {
  OfferingManager: ['create_product', 'save_product', 'submit_product', 'begin_offering_amendment',
    'reopen_offering_review', 'request_product_service_appointment'],
  IssuerFundManager: ['review_offering_issuer'],
  ComplianceOfficer: ['review_product', 'review_product_service_appointment'],
  SuperAdmin: ['apply_product_service_appointment'],
}
const allCommands = Object.values(family).flat()
const admissionCommands = ['start_application', 'submit_application', 'review_application', 'create_investment_account',
  'create_entity_investment_account', 'request_representative_mandate', 'review_representative_mandate',
  'apply_representative_mandate', 'request_investing_representative_mandate', 'respond_investing_representative_proposal',
  'review_investing_representative_mandate', 'apply_investing_representative_mandate']
const timestamp = value => {
  assert.equal(typeof value, 'string', 'journal timestamp is explicit text')
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, 'journal timestamp has explicit offset')
  const parsed = Date.parse(value)
  assert.ok(Number.isFinite(parsed), 'journal timestamp parses')
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  assert.deepEqual([calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate()], [year, month, day], 'journal timestamp has a real calendar date')
  return parsed
}
function validateInputJournal(actual, expected, fields, window, allowedFields = [...fields, 'created_at']) {
  assert.equal(actual.length, expected.length, 'journal has exactly the captured successful inputs')
  const start = timestamp(window.start), end = timestamp(window.end)
  assert.ok(start <= end, 'bounded proof database time window')
  const keys = new Set()
  for (const row of actual) {
    assert.deepEqual(Object.keys(row).sort(), [...allowedFields].sort(), 'journal row has exact canonical fields')
    const key = `${row.actor_id}:${row.request_key}`
    assert.ok(!keys.has(key), 'no duplicate journal actor/key'); keys.add(key)
    const intent = expected.find(value => value.actor_id === row.actor_id && value.request_key === row.request_key)
    assert.ok(intent, 'journal row matches intended actor/key, not a permitted actor wildcard')
    assert.deepEqual(Object.fromEntries(fields.map(field => [field, row[field]])), intent, 'journal action/payload/context stays exact')
    const at = timestamp(row.created_at)
    assert.ok(at >= start && at <= end, 'journal row timestamp remains within database proof window')
  }
}
// Only the four added admission/account record families use this exact-tuple
// validator. Expectations are authored inputs plus canonical returned IDs;
// generated receipt IDs/times never excuse a different subject or payload.
function validateAdmissionRecords(actual, expected, timeFields, window, receiptIds = false) {
  assert.equal(actual.length, expected.length, 'admission records have only the intended additions')
  const start = timestamp(window.start), end = timestamp(window.end), seen = new Set(), ids = new Set()
  for (const row of actual) {
    const match = receiptIds ? `${row.mandate_id}:${row.mandate_revision}` : row.id
    assert.ok(!seen.has(match), 'admission record identity/revision occurs once'); seen.add(match)
    const intent = expected.find(value => (receiptIds ? `${value.mandate_id}:${value.mandate_revision}` : value.id) === match)
    assert.ok(intent, 'admission record matches exact intended subject, not actor/schema wildcard')
    const fields = [...new Set([...Object.keys(intent), ...timeFields, ...(receiptIds ? ['id'] : [])])]
    assert.deepEqual(Object.keys(row).sort(), fields.sort(), 'admission record has exact canonical fields')
    if (receiptIds) {
      assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'receipt has generated UUID')
      assert.notEqual(row.id, '00000000-0000-0000-0000-000000000000', 'receipt UUID is nonzero')
      assert.ok(!ids.has(row.id), 'receipt identity occurs once'); ids.add(row.id)
    }
    for (const field of fields) {
      if (timeFields.includes(field)) {
        if (Object.hasOwn(intent, field)) {
          if (intent[field] === null) assert.equal(row[field], null, 'terminal record retains null timestamp')
          else assert.equal(timestamp(row[field]), timestamp(intent[field]), 'record timestamp matches exact input/returned binding')
        } else {
          const at = timestamp(row[field])
          assert.ok(at >= start && at <= end, 'generated record timestamp is inside database proof window')
        }
      } else if (!(receiptIds && field === 'id' && !Object.hasOwn(intent, field))) assert.deepEqual(row[field], intent[field], 'admission field retains exact input-derived value')
    }
  }
}
const terms = (asset = 'FUND') => ({ asset_type: asset, name: `Synthetic ${asset} product`, issuer_name: 'Synthetic test issuer', summary: 'Fictional offering solely for testing a customer investment journey.', strategy: 'Fictional long-term diversified test strategy. This is not an investment offer.', share_class: 'Test Class A', currency: 'ZAR_TEST', unit_price_minor: '9007199254740993', cap_units: '10', minimum_units: '1', pricing_basis: 'Fixed synthetic unit price for workflow checks.', fees: 'No real fees or payments in this test.', redemption_terms: 'Future governed redemption service; not yet available for this test product.', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'], property_address: asset === 'REAL_ESTATE' ? '100 Fictional Test Street' : '', property_valuation_minor: asset === 'REAL_ESTATE' ? '1234567890' : '0', rental_income_policy: asset === 'REAL_ESTATE' ? 'Fictional rental income policy requiring future reconciliation.' : '', documents: { memorandum: 'Synthetic memorandum. No property, fund interest or investment is offered. '.repeat(2).trim(), risks: 'Synthetic risk disclosure. This test does not represent real investment or ownership. '.repeat(2).trim(), subscription_terms: 'Synthetic subscription terms. Reservations do not confirm funding, assets or token delivery. '.repeat(2).trim() } })
// These are the retained test-portal typed literals, not new permissive terms.
const fundV2Terms = (fundV2LegacyCrossrefs, name) => ({
  ...terms('FUND'), ...fundV2LegacyCrossrefs, name, terms_version: 2, currency: 'TST', settlement_decimals: 6,
  unit_price_minor: '10000000', cap_units: '100', minimum_units: '1',
  fund: {
    mandate: 'Fictional diversified fund mandate with no real portfolio or investable claim.',
    class_rights: 'Synthetic Class A equal economic rights, with no live ownership or transfer right.',
    nav: { valuation_method: 'Synthetic marked portfolio value divided by issued test units.', frequency: 'MONTHLY', pricing_cutoff: '16:00 UTC on last business day', correction_policy: 'Corrections require a reviewed replacement NAV version and disclosure.' },
    dealing: { subscription_frequency: 'MONTHLY', redemption_frequency: 'MONTHLY', notice_days: 10, settlement_days: 5 },
    fees: { management_bps: 100, performance_bps: 0, other_fees: 'No other synthetic fees are charged.' },
    liquidity: { lockup_days: 0, gate_bps: 10000, suspension_policy: 'A separately reviewed suspension decision is required before dealing stops.' },
    distributions: { frequency: 'NONE', policy: 'No distributions in this fictional initial fund class.' },
    redemption: { price_basis: 'NAV', conditions: 'Redemption depends on the reviewed dealing calendar and available liquidity.' },
  },
})
const propertyV2Terms = name => ({
  ...terms('REAL_ESTATE'), name, terms_version: 2, currency: 'TST', settlement_decimals: 6,
  unit_price_minor: '100000000', cap_units: '20', minimum_units: '1', property_valuation_minor: '3000000000',
  strategy: 'The real_estate.spv and real_estate.property policies define the property interest and control for this package.',
  pricing_basis: 'The real_estate.property valuation policy is the authoritative pricing basis for this package.',
  fees: 'The real_estate.cashflow expense and reserve policies govern charges for this package.',
  redemption_terms: 'The real_estate.exits policies distinguish eligible interest transfer from disposal and liquidation for this package.',
  rental_income_policy: 'The real_estate.cashflow rent and distribution policies govern income for this package.',
  real_estate: {
    spv: { legal_name: 'Fictional Property SPV', registration_reference: 'SYNTHETIC-SPV-001', jurisdiction: 'ZA',
      interest_rights: 'Each synthetic interest has the specified SPV class rights, not direct title to the fictional property.' },
    property: { title_evidence_reference: 'SYNTHETIC-TITLE-001', control_evidence_reference: 'SYNTHETIC-CONTROL-001',
      valuation_method: 'Illustrative synthetic appraisal, requiring separate dated independent review before actual pricing.',
      valuation_frequency: 'ANNUALLY', correction_policy: 'A material valuation error requires a reviewed correction version and treatment of affected holders.' },
    financing: { debt_policy: 'No actual debt is represented; any synthetic priority and covenant effects require reviewed terms.',
      lender_consent_policy: 'Required lender consent must be evidenced before a transfer, disposal or change of control.' },
    cashflow: { rent_policy: 'Synthetic rent claims are not distributable cash until independent settlement reconciliation.',
      expense_policy: 'Property expenses and taxes are recorded before a synthetic net income calculation.',
      reserve_policy: 'A reviewed maintenance and contingency reserve is retained before income distribution.',
      distribution_policy: 'Record-date entitlement, approved income and authorised payout evidence are required.' },
    governance: { consent_rights: 'Material disposal and financing changes require documented holder consent under the class terms.',
      voting_policy: 'Voting eligibility and threshold use a dated register snapshot, not a wallet connection.' },
    exits: { eligible_transfer_policy: 'Eligible interest transfer settles consideration and updates the holder while the product continues.',
      disposal_liquidation_policy: 'Property disposal and liquidation require a creditor and reserve waterfall, authorised payouts and supply closure.' },
  },
})

export async function proveOfferingWorkflow(db, clients, offeringSql) {
  if (process.env.GITHUB_ACTIONS !== 'true' || clients.length !== 2) throw new Error('Offering workflow proof requires retained cloud fixture')
  let checks = 0, sequence = 1000, begun = false, phase = 'baseline'
  const id = n => `ef840000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const key = () => id(++sequence)
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', otherScope = id(950)
  const role = (name, organisationId = scope) => ({ mode: 'ROLE', organisationId, role: name })
  const applicant = { mode: 'APPLICANT' }, reviewer = role('ComplianceOfficer'), issuer = role('IssuerFundManager'), applier = role('SuperAdmin')
  let manager, application, mandate, membership, binding, proofStartedAt, committedResponseLossFixture
  let individual, entity, individualAccount, entityAccount, investingMandate
  const inputs = [], productIds = new Set(), appointmentIds = new Set(), revisionIds = new Set(), documents = [], admissionCases = []
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = (client = db) => client.query('reset role')
  const begin = async () => { await admin(); await db.query('begin'); begun = true }
  const commit = async () => { await db.query('commit'); begun = false; await admin() }
  const claims = async (n, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id(n), session_id: id(100 + n),
      role: 'authenticated', aal: 'aal1', iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], ...extra })])
    await client.query('set local role authenticated')
  }
  const read = async (n, context, extra = {}, client = db) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)], client)
  }
  const command = async (n, context, action, payload, requestKey = key(), extra = {}, client = db) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',
      [action, requestKey, JSON.stringify(payload), JSON.stringify(context)], client)
  }
  const entry = async (n, action, payload, requestKey = key()) => {
    await claims(n)
    return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [action, requestKey, JSON.stringify(payload)])
  }
  const act = async (n, context, action, payload, requestKey = key()) => {
    if (admissionCommands.includes(action)) {
      await admin()
      eq(await scalar('select jsonb_build_object(\'user_id\',s.user_id,\'aal\',s.aal::text,\'factor_id\',s.factor_id) from auth.sessions s where s.id=$1', [id(100 + n)]),
        { user_id: id(n), aal: 'aal1', factor_id: null }, 'every public Stage2 positive command uses the original password-only native session, not receipt fixture assurance')
    }
    // Intent is copied BEFORE the RPC. Observed rows never define expectation.
    const intent = clone({ actor_id: id(n), request_key: requestKey, command: action, payload, operating_context: context })
    inputs.push(intent)
    const snapshot = context === applicant && ['start_application', 'submit_application', 'request_representative_mandate'].includes(action)
      ? await entry(n, action, payload, requestKey) : await command(n, context, action, payload, requestKey)
    if (action === 'start_application') intent.subject_id = snapshot.applications.find(a => a.user_id === id(n) && a.persona === payload.persona)?.id
    else if (action === 'create_product') intent.subject_id = snapshot.products.find(p => p.terms.name === payload.terms.name)?.id
    else if (action === 'request_product_service_appointment') intent.subject_id = snapshot.product_appointments.find(a => a.product_id === payload.product_id && a.role === payload.role)?.id
    else if (action === 'create_investment_account') intent.subject_id = snapshot.accounts.find(a => a.application_id === payload.application_id)?.id
    else if (action === 'create_entity_investment_account') intent.subject_id = snapshot.entity_investment_accounts.find(a => a.application_id === payload.application_id)?.id
    else if (action === 'request_investing_representative_mandate') intent.subject_id = snapshot.investing_representative_mandates.find(m => m.investment_account_id === payload.investment_account_id && m.representative_email === payload.representative_email)?.id
    else intent.subject_id = payload.appointment_id ?? payload.application_id ?? payload.product_id ?? payload.mandate_id
    truth(intent.subject_id, `${action} has an exact canonical returned/input subject`)
    return snapshot
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); await db.query('savepoint offering_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint offering_denial; release savepoint offering_denial'); await admin()
    truth((Array.isArray(expected) ? expected : [expected]).includes(code), `${label}: SQLSTATE=${code ?? 'none'}`)
  }
  const isolated = async run => {
    await admin(); await db.query('savepoint offering_isolation')
    try { await run() } finally { await db.query('rollback to savepoint offering_isolation; release savepoint offering_isolation'); await admin() }
  }
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,n.nspname,p.proname,p.oid::regprocedure::text signature,
      md5(pg_get_functiondef(p.oid)) body,p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('auth','public','bx1_private','bx1_portal') and p.prokind='f' order by p.oid`)).rows
  }
  const security = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,rolname,rolsuper,rolinherit,rolcreaterole,
        rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles) t),
      'edges',(select jsonb_agg(to_jsonb(t) order by roleid,member,grantor) from pg_auth_members t),
      'schemas',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,nspname,nspowner,nspacl from pg_namespace
        where nspname in ('auth','storage','public','bx1_private','bx1_portal')) t),
      'relations',(select jsonb_agg(to_jsonb(t) order by oid) from (select c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
          and n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) t),
      'policies',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t),
      'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from (select t.oid,t.tgrelid,t.tgname,t.tgenabled,t.tgfoid,pg_get_triggerdef(t.oid) definition
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where not t.tgisinternal and n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) t),
      'defaults',(select jsonb_agg(to_jsonb(t) order by oid) from pg_default_acl t))`)
  }
  const relations = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname,
      array(select a.attname::text from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum) columns,
      array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
        where i.indrelid=c.oid and i.indisprimary order by a.attnum) primary_key
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
        and (n.nspname in ('auth','storage','bx1_private','bx1_portal') or n.nspname='public' and c.relname like 'bx1_%') order by 1,2`)).rows
  }
  const rows = async specs => {
    await admin()
    const result = {}
    for (const spec of specs) {
      for (const name of [spec.nspname, spec.relname, ...spec.columns]) assert.match(name, /^[a-z0-9_]+$/)
      const projection = spec.columns.map(name => `'${name}',t.${name}`).join(',')
      result[`${spec.nspname}.${spec.relname}`] = await scalar(`select coalesce(jsonb_agg(v.value order by v.value::text),'[]'::jsonb)
        from ${spec.nspname}.${spec.relname} t cross join lateral (select jsonb_build_object(${projection}) value) v`)
    }
    return result
  }
  let baselineFunctions, installedFunctions, baselineSecurity, specs, baselineRows
  const state = () => rows(specs)
  const productFrom = (snapshot, productId) => snapshot.products.find(p => p.id === productId)
  const appointmentFrom = (snapshot, appointmentId) => snapshot.product_appointments.find(a => a.id === appointmentId)
  const access = (snapshot, n, context) => {
    eq(snapshot.operating_context, context, 'saved/read response preserves exact operating context')
    eq(snapshot.offering_access, { version: 1, environment: 'TESTNET', actor_id: id(n), operating_context: context,
      session_mode: 'TEST_PASSWORD', allowed_commands: family[context.role] }, 'strict offering marker binds actor/context/exact bounded role family')
    for (const p of snapshot.products) truth((p.allowed_actions ?? []).every(action => family[context.role].includes(action)), 'record actions never escape package command family')
    if (['OfferingManager', 'IssuerFundManager'].includes(context.role)) {
      for (const field of ['subscriptions', 'product_eligibility', 'entity_product_eligibility', 'investment_accounts', 'entity_investment_accounts'])
        if (field in snapshot) eq(snapshot[field], [], `package-only response exposes no ${field} financial/customer reader data`)
    }
    return snapshot
  }
  const issuerInput = (p, decision = 'APPROVED') => ({ product_id: p.id, expected_revision: p.revision,
    offering_revision_id: p.offering_package.id, terms_hash: p.offering_package.terms_hash, decision,
    notes: 'Synthetic appointed issuer reviewed exact immutable test package.', checks: { issuer_authority: true, terms: true, rights: true } })
  const complianceInput = (p, decision = 'APPROVED') => ({ product_id: p.id, expected_revision: p.revision,
    offering_revision_id: p.offering_package.id, terms_hash: p.offering_package.terms_hash, decision,
    notes: 'Synthetic independent Compliance decision on exact offering package.', checks: { issuer: true, terms: true, disclosures: true, eligibility: true } })
  const appointmentReview = a => ({ appointment_id: a.id, expected_revision: a.revision, decision: 'APPROVED',
    notes: 'Independent synthetic review of exact product appointment and cited scope.', checks: { appointment: true, evidence: true, scope: true } })
  const awaitLock = async (waiter, blocker) => {
    truth(waiter !== blocker, 'waiter/blocker are actual distinct backend PIDs')
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await scalar(`select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'
        and $2=any(pg_blocking_pids(pid)))`, [waiter, blocker], clients[1])) { checks++; return }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Offering workflow proof did not observe independent-backend lock wait')
  }
  const crossrefs = JSON.parse(await readFile(new URL('../src/lib/portal/fund-v2-legacy-crossrefs.json', import.meta.url), 'utf8'))
  const typedTerms = (asset, name) => asset === 'FUND' ? fundV2Terms(crossrefs, name) : propertyV2Terms(name)
  const admitManager = async () => {
    application = (await act(1, applicant, 'start_application', { persona: 'WEALTH_MANAGER' })).applications.find(a => a.persona === 'WEALTH_MANAGER')
    const applicationDocuments = ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, i) => ({ id: id(310 + i), kind,
      title: `Fictional offering manager ${kind}`, storage_path: `${id(1)}/${id(310 + i)}`, sha256: 'c'.repeat(64), size: 100, mime_type: 'application/pdf' }))
    await admin()
    for (const d of applicationDocuments) {
      documents.push(d)
      await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{"size":100,"mimetype":"application/pdf"}')`, [d.storage_path, id(1)])
      await scalar('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8)', [id(1), id(101), d.id, d.kind, d.title, d.sha256, d.size, d.mime_type])
    }
    const details = { full_name: 'Fictional Offering Workflow Manager', country: 'ZA', documents: applicationDocuments, test_data_acknowledged: true,
      company_name: 'Fictional Offering Workflow Company', registration_reference: 'FICTIONAL-OFFERING-001',
      beneficial_owners: 'One fictional controlling owner; no actual company or customer evidence.',
      business_activities: 'Fictional investment management activity for isolated TEST workflow checks.',
      representative_position: 'Fictional authorised director', authority_basis: 'Fictional board authority to submit this TEST application only; not platform signing authority.',
      details_version: 3, ownership_change_reason: 'Initial fictional structured ownership for TEST admission.',
      ownership_control: [{ id: id(501), party_type: 'PERSON', legal_name: 'Fictional Controlling Owner', registration_reference: '', country: 'ZA',
        relationship: 'DIRECT_OWNER', ownership_basis_points: 10000, control_basis: 'Fictional direct shareholding for disposable workflow proof only.',
        effective_on: '2026-09-01', change_reason: 'Initial fictional ownership disclosure.', evidence_document_id: applicationDocuments[2].id }] }
    application = (await act(1, applicant, 'submit_application', { application_id: application.id, expected_revision: application.revision, details })).applications.find(a => a.id === application.id)
    application = (await act(2, reviewer, 'review_application', { application_id: application.id, expected_revision: application.revision, decision: 'APPROVED',
      notes: 'Fictional cloud functional admission only; not provider/scanner or independent-human acceptance.',
      checks: { identity: true, ownership: true, screening: true, suitability: true } })).applications.find(a => a.id === application.id)
    eq(application.status, 'APPROVED', 'manager obtains canonical current customer admission')
    admissionCases.push({ actor: id(1), application: clone(application), details: clone(details), documents: clone(applicationDocuments) })
    mandate = (await act(1, applicant, 'request_representative_mandate', { application_id: application.id, expected_revision: 0,
      evidence_reference: 'Fictional board appointment evidence for exact TEST management scope only.', requested_until: new Date(Date.now() + 86400000).toISOString() }))
      .organisation_mandates.find(m => m.application_id === application.id)
    mandate = (await act(4, reviewer, 'review_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision, decision: 'APPROVED',
      notes: 'Fictional independent TEST role-scope review; not independent-human evidence.', checks: { appointment: true, evidence: true, scope: true } })).organisation_mandates.find(m => m.id === mandate.id)
    mandate = (await act(5, applier, 'apply_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision })).organisation_mandates.find(m => m.id === mandate.id)
    eq([mandate.status, mandate.effective], ['APPLIED', true], 'distinct canonical applier supplies only current OfferingManager authority')
    manager = role('OfferingManager', mandate.native_organisation_id)
    await admin()
    membership = await scalar('select native_membership_id from bx1_portal.representative_mandates where id=$1', [mandate.id])
    binding = await scalar('select authority_binding_id from bx1_portal.representative_mandates where id=$1', [mandate.id])
    eq(await scalar('select jsonb_agg(role order by role) from public.bx1_memberships where user_id=$1', [id(1)]), ['OfferingManager'], 'canonical mandate creates no reviewer/issuer role')
  }
  const admitInvestor = async (n, kind, documentBase) => {
    let a = (await act(n, applicant, 'start_application', { persona: 'INVESTOR' })).applications.find(value => value.persona === 'INVESTOR' && value.user_id === id(n))
    const company = kind === 'ENTITY'
    const evidence = (company ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((type, i) => ({
      id: id(documentBase + i), kind: type, title: `Fictional post-cutover ${kind} ${type}`,
      storage_path: `${id(n)}/${id(documentBase + i)}`, sha256: 'c'.repeat(64), size: 100, mime_type: 'application/pdf',
    }))
    await admin()
    const originalSession = await scalar('select to_jsonb(s) from auth.sessions s where s.id=$1 and s.user_id=$2', [id(100 + n), id(n)])
    const originalFactors = await scalar("select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from auth.mfa_factors f where f.user_id=$1", [id(n)])
    eq([originalSession.aal, originalSession.factor_id], ['aal1', null], 'receipt setup begins with exact password-only fixture session')
    await db.query('savepoint offering_receipt_assurance')
    try {
      if (n === 7) {
        // Native CI fixture prerequisite ONLY for the private receipt writer.
        // No MFA challenge, provider or actual-byte acceptance is represented.
        eq(originalFactors.filter(f => f.id === id(207) && f.user_id === id(7) && f.status === 'verified').length, 1,
          'receipt fixture binds the existing actor-seven verified own factor; no factor is removed or invented')
        await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2 and user_id=$3", [id(207), id(107), id(7)])
        eq(await scalar('select to_jsonb(s) from auth.sessions s where s.id=$1', [id(107)]),
          { ...originalSession, aal: 'aal2', factor_id: id(207) }, 'private receipt setup changes only native assurance and exact own factor binding')
      }
      for (const d of evidence) {
        documents.push(d)
        await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{"size":100,"mimetype":"application/pdf"}')`, [d.storage_path, id(n)])
        await scalar('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8)', [id(n), id(100 + n), d.id, d.kind, d.title, d.sha256, d.size, d.mime_type])
      }
    } catch (error) {
      // Recover an aborted private receipt transaction before restoration;
      // otherwise a cleanup query could mask the original receipt SQLSTATE.
      await db.query('rollback to savepoint offering_receipt_assurance')
      throw error
    } finally {
      if (n === 7) await db.query('update auth.sessions set aal=$1,factor_id=$2 where id=$3 and user_id=$4',
        [originalSession.aal, originalSession.factor_id, id(107), id(7)])
      eq(await scalar('select to_jsonb(s) from auth.sessions s where s.id=$1', [id(100 + n)]), originalSession,
        'exact full native session is restored before any public submit/review/account/consent command')
      eq(await scalar("select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from auth.mfa_factors f where f.user_id=$1", [id(n)]), originalFactors,
        'private receipt registration preserves every original own-factor field')
      await db.query('release savepoint offering_receipt_assurance')
    }
    // Same accepted individual/entity detail contracts as the representatives
    // proof, but distinct document IDs from the manager admission above.
    const details = { full_name: `Fictional Post-cutover Investor ${n}`, country: 'ZA', investor_type: kind,
      company_name: company ? 'Fictional Post-cutover Investor Entity' : '', registration_reference: company ? 'FICTIONAL-PARITY-001' : '',
      beneficial_owners: company ? 'One fictional controlling owner; no actual company evidence.' : '',
      source_of_funds: 'Fictional savings only; no customer money or personal information.',
      experience: 'Fictional experience for isolated functional workflow checks.', documents: evidence, test_data_acknowledged: true,
      ...(company ? { details_version: 3, ownership_change_reason: 'Initial fictional structured entity ownership.',
        ownership_control: [{ id: id(601), party_type: 'PERSON', legal_name: 'Fictional Parity Controlling Owner', registration_reference: '', country: 'ZA',
          relationship: 'DIRECT_OWNER', ownership_basis_points: 10000, control_basis: 'Fictional direct control for disposable functional proof only.',
          effective_on: '2026-09-01', change_reason: 'Initial fictional ownership disclosure.', evidence_document_id: evidence[2].id }] } : {}) }
    a = (await act(n, applicant, 'submit_application', { application_id: a.id, expected_revision: a.revision, details })).applications.find(value => value.id === a.id)
    a = (await act(2, reviewer, 'review_application', { application_id: a.id, expected_revision: a.revision, decision: 'APPROVED',
      notes: 'Fictional post-cutover admission parity only; no provider, scanned bytes or independent-human acceptance.',
      checks: { identity: true, ownership: true, screening: true, suitability: true } })).applications.find(value => value.id === a.id)
    eq([a.status, a.revision, a.organisation_id], ['APPROVED', 3, null], `${kind} investor obtains current admission, not a customer organisation or role`)
    const result = { actor: id(n), application: clone(a), details: clone(details), documents: clone(evidence) }
    admissionCases.push(result)
    return result
  }
  const appoint = async (p, targetRole, actorNumber) => {
    const body = { product_id: p.id, role: targetRole, appointee_user_id: id(actorNumber), native_membership_id: id(400 + actorNumber),
      expected_product_revision: p.revision, evidence_reference: `SYNTHETIC-APPOINTMENT-${targetRole}-2026-09-28`, requested_until: new Date(Date.now() + 14 * 86400000).toISOString() }
    const requestKey = key()
    await denied('missing native candidate membership denies appointment request', () => command(1, manager, 'request_product_service_appointment', { ...body, native_membership_id: id(999) }))
    await denied('mismatched candidate principal denies appointment request', () => command(1, manager, 'request_product_service_appointment', { ...body, appointee_user_id: id(7) }))
    let a = (await act(1, manager, 'request_product_service_appointment', body, requestKey)).product_appointments.find(value => value.product_id === p.id && value.role === targetRole)
    appointmentIds.add(a.id)
    eq([a.status, a.effective], ['SUBMITTED', false], 'nomination never grants appointment authority')
    eq(appointmentFrom(await command(1, manager, 'request_product_service_appointment', body, requestKey), a.id).revision, a.revision, 'nomination exact retry has one effect')
    await denied('appointment conflicting key reuse', () => command(1, manager, 'request_product_service_appointment', { ...body, evidence_reference: `${body.evidence_reference}-CONFLICT` }, requestKey), '23505')
    await denied('appointee cannot review own appointment', () => command(actorNumber, reviewer, 'review_product_service_appointment', appointmentReview(a)))
    a = appointmentFrom(await act(4, reviewer, 'review_product_service_appointment', appointmentReview(a)), a.id)
    eq([a.status, a.effective], ['APPROVED', false], 'review alone grants no product authority')
    const adminQueue = access(await read(5, applier), 5, applier)
    truth(adminQueue.product_appointments.some(value => value.id === a.id && value.can_apply), 'SuperAdmin receives exact approved apply handoff')
    eq(adminQueue.products, [], 'SuperAdmin receives no customer/product review queue')
    a = appointmentFrom(await act(5, applier, 'apply_product_service_appointment', { appointment_id: a.id, expected_revision: a.revision }), a.id)
    eq([a.status, a.effective], ['APPLIED', true], 'distinct applier activates exact pre-existing candidate membership')
    await admin()
    eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [id(actorNumber)]), 1, 'appointment application creates no native role')
    return a
  }
  const positive = async (n, context, action, body, productId, requestKey = key()) => {
    const snapshot = access(await act(n, context, action, body, requestKey), n, context)
    const p = productFrom(snapshot, productId)
    truth(p, `${action} returns exact package record`)
    if (action === 'save_product' && !committedResponseLossFixture) {
      committedResponseLossFixture = { pending: clone(inputs.at(-1)), boundaryResponse: clone(snapshot) }
    }
    if (p.offering_package?.id) revisionIds.add(p.offering_package.id)
    return p
  }
  const authorityMutation = async (label, sql, values, run, context = manager, actorNumber = 1) => isolated(async () => {
    await db.query(sql, values)
    await denied(`${label} denies canonical package writer`, run)
    let snapshot, code
    try { snapshot = await read(actorNumber, context) } catch (error) { code = error?.code }
    await admin()
    if (code) eq(code, '42501', `${label} fails closed on read`)
    else truth(!(snapshot.products ?? []).some(p => productIds.has(p.id)), `${label} hides affected package records`)
  })
  const samePerson = async (actors, run, status = 'TRUSTED') => isolated(async () => {
    await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional package identity negative','TRUSTED','fictional:offering-negative',$2)", [id(700), id(701)])
    for (const n of actors) await db.query('insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,$3,\'fictional:offering-negative\',$4)', [id(n), id(700), status, id(710 + n)])
    await run()
  })
  const auditFailure = async (n, context, action, body) => {
    const before = await state()
    await isolated(async () => {
      await db.query(`create function bx1_portal.offering_fixture_audit_failure() returns trigger language plpgsql as $$
        begin if new.actor_id='${id(n)}'::uuid and new.kind='${action}' then
          raise exception 'fictional mandatory offering audit failure' using errcode='23514'; end if; return new; end $$;
        create trigger offering_fixture_audit_failure before insert on bx1_portal.events
          for each row execute function bx1_portal.offering_fixture_audit_failure()`)
      await denied(`${action} fails atomically if mandatory event fails`, () => command(n, context, action, body), '23514')
      eq(await state(), before, `${action} audit failure changes no product/package/decision/request/receipt/financial row`)
    })
  }
  const products = []
  try {
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable cloud PostgreSQL owner')
    const version = Number(await scalar('show server_version_num'))
    truth(version >= 170000 && version < 180000, 'retained PostgreSQL17 fixture only')
    truth(await scalar(`select to_regprocedure('bx1_portal.account_representative_command(jsonb,text,uuid,jsonb)') is not null
      and to_regprocedure('bx1_portal.admission_password_session()') is not null`), 'accepted admission/representatives prerequisite remains installed')
    truth(await scalar("select exists(select 1 from bx1_portal.investing_representative_mandates where proposal_hash is not null and consent_decision='ACCEPT')"), 'committed preceding representative consent fiction is retained')
    eq(await scalar("select to_regprocedure('bx1_portal.offering_workflow_context(jsonb)') is null"), true, 'offering extension has not been independently installed')
    const pids = await Promise.all([db, ...clients].map(client => scalar('select pg_backend_pid()', [], client)))
    eq(new Set(pids).size, 3, 'three actual independent PostgreSQL backend PIDs')
    specs = await relations(); baselineRows = await state(); baselineFunctions = await functions(); baselineSecurity = await security()
    proofStartedAt = await scalar("select to_jsonb(clock_timestamp()) #>> '{}'")
    await begin()
    phase = 'drift-fenced-feature-install'
    // Exact inherited signature is perturbed only inside a rolled-back
    // savepoint. A drift-safe extension must reject rather than accept it.
    await isolated(async () => {
      const definition = await scalar("select pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure)")
      const anchor = 'BEGIN'
      truth(/\bBEGIN\b/i.test(definition), 'retained outer writer has one PL/pgSQL body')
      await db.query(definition.replace(/\bBEGIN\b/i, `${anchor}\n-- fictional drift-rejection sentinel`))
      await denied('feature refuses altered retained canonical writer', () => db.query(offeringSql), '55000')
    })
    eq(await functions(), baselineFunctions, 'drift probe fully rolls back all function changes')
    await db.query(offeringSql)
    installedFunctions = await functions()
    // Kept explicit: broadening this list requires independent source review.
    const changedFunctions = new Set([
      'bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)',
      'bx1_portal.execute_command_pre_entry(text,uuid,jsonb)',
      'bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)',
      'bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)', 'bx1_portal.read_scoped(jsonb)',
      'bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb)',
      'bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)',
      'bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)',
      'bx1_portal.guard_offering_decision_appointment()',
      'bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)',
      'bx1_portal.execute_begin_offering_amendment(jsonb,uuid,jsonb)',
      'bx1_portal.execute_reopen_offering_review(jsonb,uuid,jsonb)',
    ])
    for (const original of baselineFunctions) {
      const current = installedFunctions.find(f => f.oid === original.oid)
      truth(current, `inherited ${original.signature} retains its exact OID`)
      eq({ ...current, body: original.body }, original, `inherited ${original.signature} keeps signature/owner/ACL/security/search_path`)
      if (!changedFunctions.has(original.signature)) eq(current.body, original.body, `protected/out-of-scope ${original.signature} is byte-identical`)
    }
    eq(installedFunctions.filter(f => !baselineFunctions.some(original => original.oid === f.oid) && f.nspname === 'public'), [], 'extension creates no new public API or competing writer')
    for (const helper of installedFunctions.filter(f => !baselineFunctions.some(original => original.oid === f.oid))) {
      eq(helper.nspname, 'bx1_portal', 'new helpers remain private package implementation')
      eq(helper.proconfig, ['search_path=""'], `new ${helper.signature} pins empty search_path`)
      for (const r of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [r, helper.signature]), false, `${r} cannot directly invoke ${helper.signature}`)
    }
    eq(await security(), baselineSecurity, 'installation preserves global roles/edges/schema/table/default grants/RLS/triggers')
    eq(await state(), baselineRows, 'feature installation seeds no authority, package, financial or scanner rows')
    eq(await relations(), specs, 'feature creates no competing tables or columns')
    // Bounded source evidence for the explicit return-time guard. This is not
    // a claim that a concurrent read-return race has been exercised; the real
    // backend waits below exercise writer authority/revision revalidation.
    const readSource = (await scalar("select pg_get_functiondef('bx1_portal.offering_workflow_read_scoped(jsonb)'::regprocedure)"))
      .replace(/\s+/g, ' ')
    truth(readSource.includes('from bx1_portal.products p where bx1_portal.offering_workflow_product_visible(c,p.id)'), 'reader selects products through shared current visibility predicate')
    truth(readSource.includes('where v.value is not null and bx1_portal.offering_workflow_appointment_visible(c,a.id)'), 'reader selects appointments through shared current visibility predicate')
    const finalReadGuard = readSource.slice(readSource.lastIndexOf('if bx1_portal.offering_workflow_context(c) is not true'))
    for (const clause of [
      'jsonb_array_elements(products_json)',
      "offering_workflow_product_visible(c,(value->>'id')::uuid) is not true",
      "live.revision=(value->>'revision')::integer and live.status=value->>'status'",
      "live.terms_hash=value->>'terms_hash'",
      "live.current_offering_revision_id is not distinct from (value->>'current_offering_revision_id')::uuid",
      "offering_workflow_package_projection(c,(value->>'id')::uuid)",
      "is distinct from value->'offering_package'",
      "offering_history_projection((value->>'id')::uuid) is distinct from value->'offering_history'",
      'jsonb_array_elements(orgs_json)',
      "offering_workflow_operator(c,(value->>'id')::uuid) is not true",
      'jsonb_array_elements(appointments_json)',
      "offering_workflow_appointment_visible(c,(value->>'id')::uuid) is not true",
      "offering_workflow_appointment_projection(c,(value->>'id')::uuid) is distinct from value",
      'jsonb_array_elements(candidates_json)',
      "m.id=(value->>'membership_id')::uuid and m.user_id=(value->>'user_id')::uuid",
      'offering_workflow_operator(c,p.organisation_id)', 'native_membership_effective(m.id)',
      'offering_workflow_people_independent(auth.uid(),m.user_id)',
    ]) truth(finalReadGuard.includes(clause), `final reader guard explicitly rechecks emitted current projection: ${clause}`)
    truth(finalReadGuard.includes("raise exception 'offering_package_read_authority_changed' using errcode='42501'; end if; return result;"), 'final projection guard denies before returning cached package/history/appointment rows')
    truth(!/for (share|update)\b/i.test(finalReadGuard), 'final current reader guard does not add blanket row locks')
    truth(readSource.includes("journal.created_at>=pg_catalog.clock_timestamp()-interval '7 days'")
      && readSource.includes('order by created_at desc,request_key,command limit 1000'), 'offering recovery projection retains only the bounded seven-day/latest-thousand journal window')

    phase = 'canonical-fictional-manager-and-native-candidates'
    const originalLifecycle = baselineRows['bx1_private.document_lifecycle_policy'][0]
    eq(originalLifecycle.mode, 'SCANNER_REQUIRED', 'inherited scanner-required state is recorded, never relabelled clean')
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
    await db.query("insert into public.bx1_organisations(id,name,status) values($1,'Fictional unrelated offering staff tenant','ACTIVE')", [otherScope])
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [id(n), `offering-workflow-${n}@example.invalid`])
      await db.query("insert into auth.sessions(id,user_id,not_after,created_at,aal) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),'aal1')", [id(100 + n), id(n)])
      await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(n), `Fictional offering participant ${n}`])
      if (n >= 2) {
        await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(200 + n), id(n)])
        await db.query('insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,$4)',
          [id(400 + n), id(n), n === 6 ? otherScope : scope, n === 3 ? 'IssuerFundManager' : n === 5 ? 'SuperAdmin' : n === 7 ? 'Investor' : 'ComplianceOfficer'])
      }
    }
    const admissionBefore = (await read(2, reviewer)).stage2_access
    eq(admissionBefore, { version: 1, environment: 'TESTNET', actor_id: id(2), operating_context: reviewer,
      session_mode: 'TEST_PASSWORD', allowed_commands: ['review_application', 'review_representative_mandate', 'review_investing_representative_mandate'] }, 'original exact Compliance Stage2 marker is backward compatible')
    const stage2Applicant = (await read(1, applicant)).stage2_access
    eq(stage2Applicant.allowed_commands, ['start_application', 'submit_application', 'create_investment_account', 'create_entity_investment_account',
      'request_representative_mandate', 'request_investing_representative_mandate', 'respond_investing_representative_proposal'], 'original seven applicant admission/consent commands are retained')
    const stage2Admin = (await read(5, applier)).stage2_access
    eq(stage2Admin.allowed_commands, ['apply_representative_mandate', 'apply_investing_representative_mandate'], 'original two SuperAdmin admission commands remain exact')
    eq(new Set([...stage2Applicant.allowed_commands, ...admissionBefore.allowed_commands, ...stage2Admin.allowed_commands]).size, 12, 'existing twelve-command Stage2 family remains separate from the ten offering commands')
    await admitManager()
    phase = 'post-cutover-public-twelve-command-admission-delegation-parity'
    individual = await admitInvestor(7, 'INDIVIDUAL', 620)
    const individualBody = { application_id: individual.application.id }
    individualAccount = (await act(7, applicant, 'create_investment_account', individualBody)).accounts.find(a => a.application_id === individual.application.id)
    eq([individualAccount.kind, individualAccount.holder_user_id, individualAccount.status], ['INDIVIDUAL', id(7), 'ACTIVE'], 'post-cutover individual account uses its current personal approval')
    entity = await admitInvestor(1, 'ENTITY', 610)
    const entityBody = { application_id: entity.application.id }
    entityAccount = (await act(1, applicant, 'create_entity_investment_account', entityBody)).entity_investment_accounts.find(a => a.application_id === entity.application.id)
    truth(entityAccount.id !== individualAccount.id, 'post-cutover entity and individual have distinct unchanged legal-holder accounts')
    const proposalBody = { investment_account_id: entityAccount.id, expected_revision: 0,
      representative_email: 'offering-workflow-7@example.invalid', appointment_document_id: entity.documents[1].id,
      evidence_reference: 'Fictional reviewed COMPANY document proposes a named representative; it does not appoint or delegate authority.',
      requested_until: new Date(Date.now() + 86400000).toISOString() }
    const proposalKey = key()
    const investingFrom = (snapshot, mandateId) => snapshot.investing_representative_mandates.find(m => m.id === mandateId)
    investingMandate = (await act(1, applicant, 'request_investing_representative_mandate', proposalBody, proposalKey)).investing_representative_mandates.find(m => m.investment_account_id === entityAccount.id && m.representative_user_id === id(7))
    eq([investingMandate.status, investingMandate.revision, investingMandate.effective], ['PROPOSED', 1, false], 'post-cutover proposal alone grants no account authority')
    const targetProposal = await read(7, applicant)
    truth(investingFrom(targetProposal, investingMandate.id)?.can_respond, 'exact current target receives immutable proposal response action')
    truth(!targetProposal.applications.some(a => a.id === entity.application.id), 'proposal does not expose the target to the full entity application')
    truth(!targetProposal.entity_investment_accounts.some(a => a.id === entityAccount.id && a.can_view), 'proposal grants no early entity ACCOUNT_VIEW')
    eq(investingFrom(await command(1, applicant, 'request_investing_representative_mandate', proposalBody, proposalKey), investingMandate.id).revision, 1, 'proposal retry returns exact same immutable cycle')
    const responseBody = { mandate_id: investingMandate.id, expected_revision: 1, proposal_hash: investingMandate.proposal_hash, decision: 'ACCEPT' }
    await denied('proposer cannot consent on target behalf after package cutover', () => command(1, applicant, 'respond_investing_representative_proposal', responseBody))
    await denied('wrong-scope Compliance cannot review entity representative', () => command(6, role('ComplianceOfficer', otherScope), 'review_investing_representative_mandate', {
      mandate_id: investingMandate.id, expected_revision: 2, decision: 'APPROVED', notes: 'Fictional prohibited cross-scope review.', checks: { appointment: true, legal_entity: true, scope: true } }))
    const responseKey = key()
    investingMandate = investingFrom(await act(7, applicant, 'respond_investing_representative_proposal', responseBody, responseKey), investingMandate.id)
    eq([investingMandate.status, investingMandate.revision, investingMandate.effective], ['SUBMITTED', 2, false], 'explicit consent hands off to Compliance without account access')
    eq(investingFrom(await command(7, applicant, 'respond_investing_representative_proposal', responseBody, responseKey), investingMandate.id).revision, 2, 'consent exact-key retry has one effect')
    investingMandate = investingFrom(await act(2, reviewer, 'review_investing_representative_mandate', { mandate_id: investingMandate.id,
      expected_revision: investingMandate.revision, decision: 'APPROVED', notes: 'Fictional independent review of exact approved entity document and consenting investor; not independent-human proof.',
      checks: { appointment: true, legal_entity: true, scope: true } }), investingMandate.id)
    eq([investingMandate.status, investingMandate.revision, investingMandate.effective], ['APPROVED', 3, false], 'review alone gives no effective entity account authority')
    investingMandate = investingFrom(await act(5, applier, 'apply_investing_representative_mandate', { mandate_id: investingMandate.id, expected_revision: investingMandate.revision }), investingMandate.id)
    eq([investingMandate.status, investingMandate.revision, investingMandate.effective], ['APPLIED', 4, true], 'distinct SuperAdmin applies only exact consenting representative scope')
    const targetApplied = await read(7, applicant), targetAccount = targetApplied.entity_investment_accounts.find(a => a.id === entityAccount.id)
    eq([targetAccount.can_view, targetAccount.can_request_eligibility], [true, false], 'applied fixed mandate gives account view but no product eligibility or financial authority')
    eq([...new Set(inputs.filter(input => admissionCommands.includes(input.command)).map(input => input.command))].sort(), [...admissionCommands].sort(), 'all twelve inherited Stage2 commands actually execute through public APIs after offering cutover')
    await denied('manager ROLE cannot use delegated applicant account command', () => command(1, manager, 'create_entity_investment_account', entityBody))
    await denied('password representative cannot use protected revoke through delegation', () => command(7, applicant, 'revoke_investing_representative_mandate', { mandate_id: investingMandate.id, expected_revision: investingMandate.revision, reason: 'Fictional attempted password-only revocation.' }))
    eq((await read(2, reviewer)).stage2_access, admissionBefore, 'offering cutover preserves exact inherited Stage2 role capability projection')
    access(await read(1, manager), 1, manager)
    access(await read(3, issuer), 3, issuer)
    access(await read(2, reviewer), 2, reviewer)
    access(await read(5, applier), 5, applier)
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[1, 2, 3, 4, 5, 6, 7].map(id)]), 0, 'positive fiction creates no verified-person mapping')

    phase = 'rollback-only-post-cutover-standard-package-parity'
    const beforeStandard = await state()
    // pg8.20 Client.query uses connectionParameters.query_timeout for these
    // string queries; capture only deadlines, never the full credential config.
    const standardEngineConfig = async () => ({
      ...await scalar(`select jsonb_build_object(
        'server_version_num',current_setting('server_version_num'),
        'jit',current_setting('jit'),'jit_above_cost',current_setting('jit_above_cost'),
        'jit_inline_above_cost',current_setting('jit_inline_above_cost'),
        'jit_optimize_above_cost',current_setting('jit_optimize_above_cost'),
        'join_collapse_limit',current_setting('join_collapse_limit'),
        'from_collapse_limit',current_setting('from_collapse_limit'),
        'geqo_threshold',current_setting('geqo_threshold'),
        'statement_timeout',current_setting('statement_timeout'))`),
      client_query_timeout_ms: db.connectionParameters.query_timeout,
      client_statement_timeout_ms: db.connectionParameters.statement_timeout,
    })
    const standardEngineBefore = await standardEngineConfig()
    eq(standardEngineBefore.statement_timeout, '15s', 'STANDARD parity retains the actual fifteen-second server deadline')
    eq(standardEngineBefore.client_statement_timeout_ms, 15000, 'retained client startup config sets fifteen-second statement timeout')
    eq(standardEngineBefore.client_query_timeout_ms, 20000, 'STANDARD parity retains the actual pg twenty-second client deadline')
    let standardEngineScoped, initialStandardReadElapsedMs = null, initialStandardReadOutcome = 'NOT_STARTED'
    await isolated(async () => {
      // Observed hosted TEST/MAIN engine parity only, not a diagnosed JIT cause.
      // This is the sole setting change and rollback must restore its baseline.
      await db.query('set local jit=off')
      standardEngineScoped = await standardEngineConfig()
      eq(standardEngineScoped, { ...standardEngineBefore, jit: 'off' }, 'STANDARD savepoint changes only JIT and leaves both deadlines and all captured planner settings exact')
      // Retained CI fixture pattern only: stored AAL2 plus a verified own factor,
      // matching token assurance and distinct mapped fictional people. This is
      // not an actual MFA challenge or independently verified-human acceptance.
      for (const n of [1, 2, 3, 4, 5]) {
        await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:standard-package-parity-only',$3)", [id(800 + n), `Fictional STANDARD package person ${n}`, id(850 + n)])
        await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:standard-package-parity-only',$3)", [id(n), id(800 + n), id(870 + n)])
      }
      await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(201), id(1)])
      await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2", [id(201), id(101)])
      const assured = { aal: 'aal2', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) },
        { method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] }
      await claims(1, assured); await admin()
      eq(await scalar('select test_ordinary_entry_enabled from bx1_portal.entry_configuration where singleton'), true, 'STANDARD parity runs while ordinary TEST entry flag remains active')
      eq(await scalar('select count(distinct person_id)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[1, 2, 3, 4, 5].map(id)]), 5, 'STANDARD fixture maps distinct fictional people, not aliases of one reviewer')
      eq(await scalar('select bx1_private.has_token_mfa()'), true, 'STANDARD fixture satisfies original current own-factor/token assurance')
      eq(await scalar('select bx1_portal.valid_operating_context($1::jsonb)', [JSON.stringify(manager)]), true, 'STANDARD manager satisfies unchanged global operating-context predicate')
      eq(await scalar('select bx1_portal.admission_password_session()'), false, 'AAL2 STANDARD fixture never takes active ordinary-entry password exception')
      eq(await scalar('select bx1_portal.offering_workflow_context($1::jsonb)', [JSON.stringify(manager)]), false, 'STANDARD fixture does not use offering password context')
      eq(await scalar('select bx1_portal.representative_mandate_effective($1)', [mandate.id]), true, 'STANDARD fixture keeps unchanged global mandate authority effective')
      eq(await scalar('select bx1_portal.scoped_operator($1::jsonb,$2)', [JSON.stringify(manager), application.organisation_id]), true, 'STANDARD fixture passes unchanged scoped operator guard')
      eq(await scalar('select bx1_portal.is_operator($1)', [application.organisation_id]), true, 'STANDARD fixture passes unchanged core operator guard')
      const initialStandardReadStarted = performance.now()
      let standardRead
      try {
        standardRead = await read(1, manager, assured)
        initialStandardReadOutcome = 'RETURNED'
      } finally {
        initialStandardReadElapsedMs = performance.now() - initialStandardReadStarted
        if (initialStandardReadOutcome === 'NOT_STARTED') initialStandardReadOutcome = 'FAILED'
      }
      eq(standardRead.operating_context, manager, 'STANDARD read retains exact native manager context')
      eq(standardRead.stage2_access.session_mode, 'STANDARD', 'post-cutover public read retains STANDARD assurance marker')
      eq(standardRead.offering_access ?? null, null, 'STANDARD read does not advertise password-only offering exception')
      truth(standardRead.organisations.some(o => o.id === application.organisation_id), 'STANDARD read keeps exact globally authorised organisation visible')
      for (const asset of ['FUND', 'REAL_ESTATE']) {
        const name = `Fictional rollback-only STANDARD ${asset}`
        const originalTerms = typedTerms(asset, name)
        const draft = (await command(1, manager, 'create_product', { organisation_id: application.organisation_id,
          terms: originalTerms }, key(), assured)).products.find(p => p.terms.name === name)
        truth(draft?.id, `${asset} canonical existing create works through STANDARD route after cutover`)
        eq([draft.status, draft.terms], ['DRAFT', originalTerms], `${asset} STANDARD draft retains exact validated terms`)
        const revisedTerms = typedTerms(asset, `${name} revised`)
        const saved = productFrom(await command(1, manager, 'save_product', { product_id: draft.id,
          expected_revision: draft.revision, terms: revisedTerms }, key(), assured), draft.id)
        eq([saved.status, saved.revision, saved.terms], ['DRAFT', draft.revision + 1, revisedTerms], `${asset} canonical typed save retains STANDARD revision and terms`)
        eq(productFrom(await read(1, manager, assured), draft.id).terms, revisedTerms, `${asset} STANDARD canonical read returns saved package draft`)
      }
    }).finally(async () => {
      const standardEngineRestored = await standardEngineConfig()
      eq(standardEngineRestored, standardEngineBefore, 'STANDARD savepoint rollback restores exact prior JIT, planner settings and both deadlines even on failure')
      console.log('BX1_STANDARD_ENGINE_PARITY_RECEIPT', JSON.stringify({
        fixture: 'disposable-cloud-PostgreSQL17', before: standardEngineBefore,
        scoped: standardEngineScoped ?? null, restored: standardEngineRestored,
        initial_public_read_helper_outcome: initialStandardReadOutcome,
        initial_public_read_helper_elapsed_ms: initialStandardReadElapsedMs,
        timing_scope: 'CI-helper-wall-clock-including-claims-and-RPC-not-SQL-time-or-SLA',
        jit_causality: 'NOT_ESTABLISHED', hosted_performance: 'NOT_MEASURED',
      }))
    })
    eq(await state(), beforeStandard, 'STANDARD parity rollback removes every temporary factor, mapping, session upgrade, draft, journal and audit row')
    eq(await functions(), installedFunctions, 'STANDARD parity changes no original or installed authority function')
    eq(await security(), baselineSecurity, 'STANDARD parity changes no ACL, RLS, owner, role or trigger security')

    phase = 'both-typed-immutable-package-handoffs'
    for (const asset of ['FUND', 'REAL_ESTATE']) {
      const name = `Fictional normal offering ${asset}`
      const createBody = { organisation_id: application.organisation_id, terms: typedTerms(asset, name) }, createKey = key()
      let p = access(await act(1, manager, 'create_product', createBody, createKey), 1, manager).products.find(value => value.terms.name === name)
      truth(p?.id, `${asset} typed editor creates exact draft through canonical command`)
      productIds.add(p.id)
      eq([p.status, p.terms.terms_version, p.terms.asset_type], ['DRAFT', 2, asset], `${asset} draft retains exact typed version`)
      const afterCreate = await state()
      // Simulated lost response: retry the durable original key, not a new key.
      eq(productFrom(access(await command(1, manager, 'create_product', createBody, createKey), 1, manager), p.id).revision, p.revision, `${asset} durable unknown-result retry returns the same draft`)
      eq(await state(), afterCreate, `${asset} identical retry writes no second row/event/request`)
      await denied(`${asset} conflicting create reuse`, () => command(1, manager, 'create_product', { ...createBody, terms: typedTerms(asset, `${name} conflicting`) }, createKey), '23505')
      await denied(`${asset} stale save revision`, () => command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision + 1, terms: p.terms }), '23514')
      const saveBody = { product_id: p.id, expected_revision: p.revision, terms: typedTerms(asset, `${name} reviewed draft`) }
      await auditFailure(1, manager, 'save_product', saveBody)
      p = await positive(1, manager, 'save_product', saveBody, p.id)
      await isolated(async () => {
        const unappointed = productFrom(await command(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }), p.id)
        await denied(`${asset} native issuer role without exact product appointment cannot review`, () => command(3, issuer, 'review_offering_issuer', issuerInput(unappointed)))
        await denied(`${asset} native Compliance role without exact product appointment cannot review`, () => command(2, reviewer, 'review_product', complianceInput(unappointed)))
        eq((await read(3, issuer)).products.some(value => value.id === p.id), false, `${asset} native issuer role alone receives no package/history`)
      })
      const issuerAppointment = await appoint(p, 'IssuerFundManager', 3)
      const complianceAppointment = await appoint(p, 'ComplianceOfficer', 2)
      const candidatesBefore = await state()
      eq(await scalar('select count(*)::int from bx1_portal.organisation_authority_bindings where product_organisation_id=$1', [application.organisation_id]), 1, 'product appointments create no customer-wide reviewer or issuer binding')
      eq(await state(), candidatesBefore, 'appointment candidate/count reads are non-mutating')
      p = await positive(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }, p.id)
      const originalRevision = p.offering_package.id
      eq([p.status, p.offering_package.origin], ['IN_REVIEW', 'SUBMITTED'], `${asset} immutable submitted package starts pending`)
      await denied(`${asset} immutable package cannot be edited`, () => command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: p.terms }), '23514')
      await denied(`${asset} stale issuer package identifier`, () => command(3, issuer, 'review_offering_issuer', { ...issuerInput(p), offering_revision_id: id(999) }), '23514')
      await denied(`${asset} stale issuer hash`, () => command(3, issuer, 'review_offering_issuer', { ...issuerInput(p), terms_hash: 'b'.repeat(64) }), '23514')
      await denied(`${asset} stale Compliance revision`, () => command(2, reviewer, 'review_product', { ...complianceInput(p), expected_revision: p.revision + 1 }), '23514')
      await authorityMutation(`${asset} legal exact issuer appointment revoked`, `update bx1_portal.product_service_appointments set status='REVOKED',revision=revision+1,
        revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Fictional isolated appointed issuer withdrawal.' where id=$1`, [issuerAppointment.id, id(5)],
        () => command(3, issuer, 'review_offering_issuer', issuerInput(p)), issuer, 3)
      await isolated(async () => {
        await db.query('alter table bx1_portal.product_service_appointments disable trigger bx1_product_appointment_transition')
        await db.query("update bx1_portal.product_service_appointments set requested_until=clock_timestamp()-interval '1 minute' where id=$1", [issuerAppointment.id])
        await db.query('alter table bx1_portal.product_service_appointments enable trigger bx1_product_appointment_transition')
        await denied(`${asset} passively expired exact appointment denies issuer`, () => command(3, issuer, 'review_offering_issuer', issuerInput(p)))
        const expiredRead = access(await read(3, issuer), 3, issuer)
        eq(expiredRead.products.some(value => value.id === p.id), false, `${asset} expired appointment removes package read/history scope`)
      })
      await samePerson([1, 3], () => denied(`${asset} known manager/issuer alias denies independent review`, () => command(3, issuer, 'review_offering_issuer', issuerInput(p))))
      await samePerson([3], () => denied(`${asset} known revoked issuer identity cannot fall back to unknown`, () => command(3, issuer, 'review_offering_issuer', issuerInput(p))), 'REVOKED')
      await auditFailure(3, issuer, 'review_offering_issuer', issuerInput(p, 'CHANGES_REQUIRED'))
      p = await positive(3, issuer, 'review_offering_issuer', issuerInput(p, 'CHANGES_REQUIRED'), p.id)
      eq(p.status, 'CHANGES_REQUIRED', `${asset} issuer correction request reaches manager`)
      await denied(`${asset} unchanged terms cannot be resubmitted`, () => command(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }), '23514')
      p = await positive(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: typedTerms(asset, `${name} corrected package`) }, p.id)
      p = await positive(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }, p.id)
      truth(p.offering_package.id !== originalRevision, `${asset} correction creates a new immutable package identity`)
      eq(p.offering_package.issuer_status, 'PENDING', `${asset} prior correction decision is not borrowed`)
      const issuerBody = issuerInput(p), issuerKey = key()
      p = await positive(3, issuer, 'review_offering_issuer', issuerBody, p.id, issuerKey)
      const afterIssuer = await state()
      eq(productFrom(await command(3, issuer, 'review_offering_issuer', issuerBody, issuerKey), p.id).revision, p.revision, `${asset} issuer exact retry is idempotent`)
      eq(await state(), afterIssuer, `${asset} issuer retry keeps one immutable decision/event`)
      await samePerson([2, 3], () => denied(`${asset} known issuer/Compliance alias denies second decision`, () => command(2, reviewer, 'review_product', complianceInput(p))))
      await auditFailure(2, reviewer, 'review_product', complianceInput(p))
      p = await positive(2, reviewer, 'review_product', complianceInput(p), p.id)
      eq([p.status, p.offering_package.issuer_status, p.offering_package.compliance_status], ['APPROVED', 'APPROVED', 'APPROVED'], `${asset} independent exact package decision pair approves package only`)
      await admin()
      eq(await scalar('select bx1_portal.offering_workflow_approved($1)', [p.id]), true, `${asset} package-specific approved predicate recognises password review pair`)
      eq(await scalar('select bx1_portal.offering_operational($1)', [p.id]), false, `${asset} original operational/financial predicate remains sealed`)
      eq(await scalar('select jsonb_build_array(published_at is null,reserved_units::text) from bx1_portal.products where id=$1', [p.id]), [true, '0'], `${asset} stays unpublished and unopened`)
      eq(p.offering_package.technical_readiness_status, 'NOT_VERIFIED', `${asset} makes no technical deployment/file/e-signature readiness claim`)
      products.push({ asset, name, p, issuerAppointment, complianceAppointment })
    }

    phase = 'current-native-authority-and-excluded-families'
    const fund = products[0].p
    const createAnother = () => command(1, manager, 'create_product', { organisation_id: application.organisation_id, terms: typedTerms('FUND', 'Fictional negative creation') })
    const mutations = [
      ['unconfirmed actor', 'update auth.users set email_confirmed_at=null where id=$1', [id(1)]],
      ['banned actor', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [id(1)]],
      ['ended session', "update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1", [id(101)]],
      ['suspended profile', "update public.bx1_profiles set status='SUSPENDED' where id=$1", [id(1)]],
      ['suspended native organisation', "update public.bx1_organisations set status='SUSPENDED' where id=$1", [mandate.native_organisation_id]],
      ['suspended exact membership', "update public.bx1_memberships set status='SUSPENDED' where id=$1", [membership]],
      ['revoked exact authority binding', "update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [binding]],
      ['revoked exact organisation mandate', `update bx1_portal.representative_mandates set status='REVOKED',revision=revision+1,
        revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Fictional isolated organisation mandate withdrawal.' where id=$1`, [mandate.id, id(2)]],
      ['expired customer admission', "update bx1_portal.applications set reviewed_at=clock_timestamp()-interval '31 days',approved_until=clock_timestamp()-interval '1 day' where id=$1", [application.id]],
      ['changed customer admission revision', 'update bx1_portal.applications set revision=revision+1 where id=$1', [application.id]],
      ['changed approved customer facts', "update bx1_portal.applications set details=jsonb_set(details,'{business_activities}',to_jsonb('Altered fictional unreviewed activities.'::text)) where id=$1", [application.id]],
      ['monitoring hold', "insert into bx1_portal.customer_monitoring_cases(application_id,state,revision,decided_at,decided_by,last_receipt_id) values($1,'ON_HOLD',1,clock_timestamp(),$2,$3)", [application.id, id(2), id(900)]],
    ]
    for (const [label, sql, values] of mutations) await authorityMutation(label, sql, values, createAnother)
    await isolated(async () => {
      await db.query('alter table bx1_portal.representative_mandates disable trigger bx1_representative_mandate_guard')
      await db.query("update bx1_portal.representative_mandates set requested_until=clock_timestamp()-interval '1 minute' where id=$1", [mandate.id])
      await db.query('alter table bx1_portal.representative_mandates enable trigger bx1_representative_mandate_guard')
      await denied('expired exact organisation mandate denies creation', createAnother)
      let expiredRead, code
      try { expiredRead = await read(1, manager) } catch (error) { code = error?.code }
      if (code) eq(code, '42501', 'expired organisation mandate fails closed on native context read')
      else eq(expiredRead.products.some(p => productIds.has(p.id)), false, 'expired organisation mandate hides package records/history')
    })
    await samePerson([1], () => denied('known revoked manager identity denies package creation', createAnother), 'REVOKED')
    for (const context of [applicant, role('Investor'), role('SuperAdmin'), role('OfferingManager', otherScope), { ...manager, extra: true }, { mode: 'ROLE', role: 'OfferingManager' }])
      await denied('invented/malformed/wrong-role context cannot create package', () => command(1, context, 'create_product', { organisation_id: application.organisation_id, terms: typedTerms('FUND', 'Fictional denied context') }))
    for (const extra of [{ iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }, { session_id: id(999) }, { sub: id(999) }, { role: 'anon' }, { exp: 1 }, { amr: [{ method: 'otp', timestamp: 1 }] }])
      await denied('missing/mismatched MAIN actor/session marker denies package exception', () => command(1, manager, 'create_product', { organisation_id: application.organisation_id, terms: fund.terms }, key(), extra))
    for (const sql of ["update bx1_portal.entry_configuration set manual_test_review=false where singleton",
      "update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false where singleton",
      "update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false,test_ordinary_entry_enabled=false where singleton"])
      await isolated(async () => { await db.query(sql); await denied('MAIN/unadmitted configuration cannot use password package exception', createAnother) })
    for (const [n, context] of [[1, manager], [2, reviewer], [3, issuer], [5, applier], [7, role('Investor')]]) {
      for (const action of ['publish_product', 'subscribe', 'review_product_eligibility', 'open_funding_obligation', 'propose_funding_route',
        'review_funding_obligation', 'revoke_product_service_appointment', 'revoke_representative_mandate', 'revoke_investing_representative_mandate', 'cancel_subscription'])
        await denied(`${context.role} password package context excludes ${action}`, () => command(n, context, action, { product_id: fund.id, expected_revision: fund.revision }))
      for (const action of allCommands.filter(action => !(family[context.role] ?? []).includes(action)))
        await denied(`${context.role} cannot borrow package command ${action}`, () => command(n, context, action, { product_id: fund.id, expected_revision: fund.revision }))
    }
    await authorityMutation('issuer membership withdrawn', "update public.bx1_memberships set status='SUSPENDED' where id=$1", [id(403)],
      () => command(3, issuer, 'review_offering_issuer', issuerInput(fund)), issuer, 3)
    const outsider = await read(6, role('ComplianceOfficer', otherScope))
    eq(outsider.products, [], 'wrong staff tenant cannot read package records/history')
    eq(outsider.product_appointments, [], 'wrong staff tenant cannot read appointment records')
    await admin()
    for (const signature of ['bx1_portal.execute_command(text,uuid,jsonb)', 'bx1_portal.execute_command_pre_entry(text,uuid,jsonb)',
      'bx1_portal.execute_scoped_pre_offering(jsonb,text,uuid,jsonb)', 'bx1_portal.execute_scoped_pre_product_appointment(jsonb,text,uuid,jsonb)'])
      eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', ['authenticated', signature]), false, `${signature} is not an alternative client writer`)

    phase = 'both-assets-amendment-and-same-hash-reopen-lineage'
    for (const item of products) {
      let p = item.p
      const originalPackage = p.offering_package.id
      const originalDecisionRows = await scalar('select jsonb_agg(to_jsonb(d) order by d.id) from bx1_portal.offering_decisions d where offering_revision_id=$1', [originalPackage])
      const body = { product_id: p.id, expected_revision: p.revision, reason: 'Fictional approved package opened for governed corrected terms with fresh immutable review lineage.' }, requestKey = key()
      await auditFailure(1, manager, 'begin_offering_amendment', body)
      p = await positive(1, manager, 'begin_offering_amendment', body, p.id, requestKey)
      eq([p.status, p.offering_package], ['CHANGES_REQUIRED', null], `${item.asset} amendment detaches but never erases approved immutable package`)
      await denied(`${item.asset} unchanged first amendment save`, () => command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: item.p.terms }), '23514')
      p = await positive(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: typedTerms(item.asset, `${item.name} amended package`) }, p.id)
      p = await positive(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }, p.id)
      truth(p.offering_package.id !== originalPackage, `${item.asset} amendment has a fresh immutable revision`)
      eq([p.offering_package.issuer_status, p.offering_package.compliance_status], ['PENDING', 'PENDING'], `${item.asset} amended package borrows no prior decisions`)
      p = await positive(3, issuer, 'review_offering_issuer', issuerInput(p), p.id)
      p = await positive(2, reviewer, 'review_product', complianceInput(p), p.id)
      eq(p.status, 'APPROVED', `${item.asset} amended package receives a fresh independent pair`)
      await admin()
      eq(await scalar('select jsonb_agg(to_jsonb(d) order by d.id) from bx1_portal.offering_decisions d where offering_revision_id=$1', [originalPackage]), originalDecisionRows, `${item.asset} historical approved decisions remain exact`)
      const beforeReopen = p.offering_package.id, sameHash = p.terms_hash
      p = await positive(1, manager, 'reopen_offering_review', { product_id: p.id, expected_revision: p.revision, reason: 'Fictional exact same terms reopened for a new immutable independent review pair; prior decisions remain historical.' }, p.id)
      truth(p.offering_package.id !== beforeReopen, `${item.asset} same-hash reopen creates new lineage`)
      eq(p.terms_hash, sameHash, `${item.asset} reopen preserves immutable terms hash truthfully`)
      eq([p.offering_package.issuer_status, p.offering_package.compliance_status], ['PENDING', 'PENDING'], `${item.asset} same-hash reopen resets both decisions`)
      p = await positive(3, issuer, 'review_offering_issuer', issuerInput(p), p.id)
      p = await positive(2, reviewer, 'review_product', complianceInput(p), p.id)
      item.p = p
    }
    await commit()

    phase = 'fresh-committed-read-request-key-recovery'
    const beforeRecovery = await state(), recoveryInputCount = inputs.length, recoverySequence = sequence
    truth(committedResponseLossFixture?.pending?.command === 'save_product', 'client fixture retains a precise successful save input and original key before response loss')
    const lostSave = clone(committedResponseLossFixture.pending)
    // Deliberately discard this exact save response at the CI client-fixture
    // boundary AFTER the business transaction commits. This is not a claim of
    // actual network loss or UI acceptance. Reconcile by fresh read, not retry.
    committedResponseLossFixture.boundaryResponse = undefined
    eq(committedResponseLossFixture.boundaryResponse, undefined, 'simulated dropped committed response leaves no usable client response')
    await begin()
    const recoveryReads = new Map(), recoveredCommands = new Set()
    const byKey = (a, b) => a.key.localeCompare(b.key) || a.command.localeCompare(b.command)
    for (const [n, context] of [[1, manager], [2, reviewer], [3, issuer], [4, reviewer], [5, applier], [6, role('ComplianceOfficer', otherScope)]]) {
      const snapshot = access(await read(n, context), n, context)
      recoveryReads.set(n, snapshot)
      const ownInputs = inputs.filter(input => input.actor_id === id(n) && isDeepStrictEqual(input.operating_context, context))
      const expectedOffering = ownInputs.filter(input => family[context.role].includes(input.command))
        .map(input => ({ key: input.request_key, command: input.command }))
      for (const receipt of expectedOffering) recoveredCommands.add(receipt.command)
      const expectedStage2 = ownInputs.filter(input => ['review_application', 'review_representative_mandate', 'apply_representative_mandate',
        'review_investing_representative_mandate', 'apply_investing_representative_mandate'].includes(input.command))
        .map(input => ({ key: input.request_key, command: input.command }))
      truth(Array.isArray(snapshot.requests), `${context.role} fresh read has committed request-key projection`)
      for (const receipt of snapshot.requests) eq(Object.keys(receipt).sort(), ['command', 'key'], 'fresh receipt projection exposes only key/command, never payload, actor or foreign details')
      eq(new Set(snapshot.requests.map(receipt => receipt.key)).size, snapshot.requests.length, 'fresh receipt projection contains each actor/context key once')
      eq([...snapshot.requests].sort(byKey), [...expectedOffering, ...expectedStage2].sort(byKey), `${context.role} fresh read returns exact own/context current-role offering family plus preserved Stage2 keys`)
      for (const expected of expectedOffering) truth(snapshot.requests.some(receipt => isDeepStrictEqual(receipt, expected)), `${expected.command} committed input key is recovered before any new business command`)
      for (const expected of expectedStage2) truth(snapshot.requests.some(receipt => isDeepStrictEqual(receipt, expected)), `${expected.command} original Stage2 input key survives offering overlay`)
    }
    eq([...recoveredCommands].sort(), [...new Set(Object.values(family).flat())].sort(), 'fresh committed reads recover captured keys for every exact command in the ten-command offering family')
    eq(recoveryReads.get(1).requests.filter(receipt => receipt.key === lostSave.request_key),
      [{ key: lostSave.request_key, command: lostSave.command }], 'fresh committed manager read resolves dropped save response using exact original input key')
    eq(committedResponseLossFixture.pending, lostSave, 'fresh recovery never alters pending context, payload or original request key')
    committedResponseLossFixture.pending = null
    eq([committedResponseLossFixture.pending, inputs.length, sequence], [null, recoveryInputCount, recoverySequence], 'client reconciles committed save before generating any new key or business command')
    await commit()
    eq(await state(), beforeRecovery, 'fresh receipt recovery writes no row, journal, event or second business effect')

    phase = 'real-authority-monitoring-and-product-revision-waits'
    await begin()
    const monitoringId = id(920)
    await db.query(`insert into bx1_portal.customer_monitoring_cases(application_id,state,revision,decided_at,decided_by,last_receipt_id)
      values($1,'CURRENT',1,clock_timestamp(),$2,$3)`, [application.id, id(2), monitoringId])
    let waitingProduct = products[0].p
    waitingProduct = await positive(1, manager, 'reopen_offering_review', { product_id: waitingProduct.id, expected_revision: waitingProduct.revision,
      reason: 'Fictional fresh immutable offering revision for real authority and product-lock revalidation proof.' }, waitingProduct.id)
    await commit()
    const realWait = async (label, mutateSql, mutateValues, n, context, action, body, expected, restore, mutableFixtureTable = null) => {
      const before = await state(), requestKey = key()
      await begin()
      await db.query(mutateSql, mutateValues)
      const waiting = (async () => {
        await clients[0].query('begin')
        try {
          const result = await command(n, context, action, body, requestKey, {}, clients[0])
          await clients[0].query('rollback')
          return { result }
        } catch (error) {
          // ROLLBACK must precede RESET ROLE on an aborted transaction.
          await clients[0].query('rollback')
          return { code: error?.code }
        } finally { await admin(clients[0]) }
      })()
      try {
        await awaitLock(pids[1], pids[0])
        await commit()
        const outcome = await waiting
        eq(outcome.code, expected, `${label} revalidates current row AFTER observed real backend wait`)
      } finally {
        if (begun) { await db.query('rollback'); begun = false }
        await waiting
        await admin()
        await begin()
        await restore()
        await commit()
      }
      const after = await state()
      for (const name of Object.keys(before)) if (name !== mutableFixtureTable)
        eq(after[name], before[name], `${label} denies atomically and preserves exact ${name}`)
      eq(await scalar(`select (select count(*) from bx1_portal.requests where actor_id=$1 and request_key=$2)
        +(select count(*) from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2)
        +(select count(*) from bx1_portal.product_service_appointment_requests where actor_id=$1 and request_key=$2)`, [id(n), requestKey]), '0', `${label} rejected waiting call has no durable request`)
    }
    const originalApplication = await scalar('select to_jsonb(a) from bx1_portal.applications a where id=$1', [application.id])
    await realWait('manager admission expires while create waits', "update bx1_portal.applications set approved_until=clock_timestamp()-interval '1 minute',reviewed_at=clock_timestamp()-interval '31 days' where id=$1", [application.id],
      1, manager, 'create_product', { organisation_id: application.organisation_id, terms: typedTerms('FUND', 'Fictional waiting admission denial') }, '42501',
      () => db.query('update bx1_portal.applications set approved_until=$2,reviewed_at=$3 where id=$1', [application.id, originalApplication.approved_until, originalApplication.reviewed_at]))
    await realWait('manager live monitoring changes while create waits', "update bx1_portal.customer_monitoring_cases set state='ON_HOLD',revision=revision+1,decided_at=greatest(clock_timestamp(),decided_at+interval '1 microsecond') where application_id=$1", [application.id],
      1, manager, 'create_product', { organisation_id: application.organisation_id, terms: typedTerms('FUND', 'Fictional waiting monitoring denial') }, '42501',
      () => db.query("update bx1_portal.customer_monitoring_cases set state='CURRENT',revision=revision+1,decided_at=greatest(clock_timestamp(),decided_at+interval '1 microsecond') where application_id=$1", [application.id]),
      'bx1_portal.customer_monitoring_cases')
    eq(await scalar('select jsonb_build_array(state,revision,decided_by,last_receipt_id) from bx1_portal.customer_monitoring_cases where application_id=$1', [application.id]),
      ['CURRENT', 3, id(2), monitoringId], 'only exact own CI monitoring fixture advances monotonically; inherited monitoring cases are unchanged')
    await realWait('issuer exact native membership withdrawn while review waits', "update public.bx1_memberships set status='SUSPENDED' where id=$1", [id(403)],
      3, issuer, 'review_offering_issuer', issuerInput(waitingProduct), '42501', () => db.query("update public.bx1_memberships set status='ACTIVE' where id=$1", [id(403)]))
    await realWait('product revision changes while issuer review waits', 'update bx1_portal.products set revision=revision+1 where id=$1', [waitingProduct.id],
      3, issuer, 'review_offering_issuer', issuerInput(waitingProduct), '23514', () => db.query('update bx1_portal.products set revision=$2 where id=$1', [waitingProduct.id, waitingProduct.revision]))
    const appointmentId = products[0].issuerAppointment.id
    const originalAppointment = await scalar('select to_jsonb(a) from bx1_portal.product_service_appointments a where id=$1', [appointmentId])
    await realWait('exact product appointment revoked while issuer review waits', `update bx1_portal.product_service_appointments set status='REVOKED',revision=revision+1,
      revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Fictional protected negative fixture only.' where id=$1`, [appointmentId, id(5)],
      3, issuer, 'review_offering_issuer', issuerInput(waitingProduct), '42501', async () => {
        // Restore the exact disposable negative row under its CI-only fence.
        // No business RPC executes while the immutable transition guard is off.
        await db.query('alter table bx1_portal.product_service_appointments disable trigger bx1_product_appointment_transition')
        await db.query('update bx1_portal.product_service_appointments set status=$2,revision=$3,revoked_at=$4,revoked_by_user_id=$5,revoke_reason=$6 where id=$1',
          [appointmentId, originalAppointment.status, originalAppointment.revision, originalAppointment.revoked_at, originalAppointment.revoked_by_user_id, originalAppointment.revoke_reason])
        await db.query('alter table bx1_portal.product_service_appointments enable trigger bx1_product_appointment_transition')
      })
    await begin()
    waitingProduct = await positive(3, issuer, 'review_offering_issuer', issuerInput(waitingProduct), waitingProduct.id)
    waitingProduct = await positive(2, reviewer, 'review_product', complianceInput(waitingProduct), waitingProduct.id)
    products[0].p = waitingProduct

    phase = 'strict-inherited-and-input-correspondence-footprint'
    await admin()
    for (const item of products) {
      eq(await scalar('select bx1_portal.offering_workflow_approved($1)', [item.p.id]), true, 'both final amended/reopened packages remain independently approved in the exact TEST password context')
      eq(await scalar('select bx1_portal.offering_operational($1)', [item.p.id]), false, 'both final packages remain unpublished/unopened without Stage4 readiness')
      eq(item.p.offering_package.status, 'APPROVED_AWAITING_READINESS', 'saved response advertises package approval only, not platform readiness')
      eq([item.p.offering_package.publishable, item.p.offering_package.subscribable], [false, false], 'saved package never advertises publication or investor entry')
    }
    const originalConfiguration = baselineRows['bx1_portal.entry_configuration'][0]
    const originalReceiptPolicy = baselineRows['bx1_private.document_receipt_policy'][0]
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=$1 where singleton', [originalConfiguration.test_ordinary_entry_enabled])
    await db.query('update bx1_private.document_receipt_policy set enforced=$1 where singleton', [originalReceiptPolicy.enforced])
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton', [originalLifecycle.mode])
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_lifecycle_policy set changed_at=$1::timestamptz where singleton', [originalLifecycle.changed_at])
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    eq(await functions(), installedFunctions, 'temporary audit/drift fixtures are removed; installed function definitions/OIDs/ACLs stay exact')
    eq(await security(), baselineSecurity, 'all global security and transition trigger metadata restored exactly')
    const finalRows = await state(), added = {}, window = { start: proofStartedAt, end: await scalar("select to_jsonb(clock_timestamp()) #>> '{}'") }
    for (const spec of specs) {
      const name = `${spec.nspname}.${spec.relname}`, inherited = baselineRows[name], current = finalRows[name]
      for (const row of inherited) {
        const candidates = spec.primary_key.length ? current.filter(value => spec.primary_key.every(field => JSON.stringify(value[field]) === JSON.stringify(row[field]))) : current
        truth(candidates.some(value => JSON.stringify(value) === JSON.stringify(row)), `every inherited ${name} row remains byte/value-identical`)
      }
      added[name] = current.filter(value => !inherited.some(row => JSON.stringify(row) === JSON.stringify(value)))
    }
    const legacyActions = new Set(['review_application', 'create_investment_account', 'create_product', 'save_product', 'submit_product', 'review_product'])
    const scopedActions = new Set([...legacyActions, 'create_entity_investment_account', 'request_investing_representative_mandate',
      'respond_investing_representative_proposal', 'review_investing_representative_mandate', 'apply_investing_representative_mandate',
      'review_offering_issuer', 'begin_offering_amendment', 'reopen_offering_review'])
    const projectInput = (input, includeContext = false, stripped = false) => ({ actor_id: input.actor_id, request_key: input.request_key,
      command: input.command, payload: stripped ? Object.fromEntries(Object.entries(input.payload).filter(([field]) => !['offering_revision_id', 'terms_hash'].includes(field))) : clone(input.payload),
      ...(includeContext ? { operating_context: clone(input.operating_context) } : {}) })
    const legacyExpected = inputs.filter(input => legacyActions.has(input.command)).map(input => projectInput(input, false, input.command === 'review_product'))
    validateInputJournal(added['bx1_portal.requests'], legacyExpected, ['actor_id', 'request_key', 'command', 'payload'], window); checks++
    const scopedExpected = inputs.filter(input => scopedActions.has(input.command)).map(input => projectInput(input, true))
    validateInputJournal(added['bx1_portal.scoped_requests'], scopedExpected, ['actor_id', 'request_key', 'command', 'payload', 'operating_context'], window); checks++
    const entryExpected = inputs.filter(input => ['start_application', 'submit_application'].includes(input.command)).map(input => ({ ...projectInput(input), application_id: input.subject_id }))
    validateInputJournal(added['bx1_portal.entry_requests'], entryExpected, ['actor_id', 'request_key', 'command', 'payload', 'application_id'], window); checks++
    for (const [table, commands, subjectField, receiptTable, subjectSet] of [
      ['product_service_appointment_requests', ['request_product_service_appointment', 'review_product_service_appointment', 'apply_product_service_appointment'], 'appointment_id', 'product_service_appointment_receipts', appointmentIds],
      ['representative_mandate_requests', ['request_representative_mandate', 'review_representative_mandate', 'apply_representative_mandate'], 'mandate_id', 'representative_mandate_receipts', new Set([mandate.id])],
    ]) {
      const expected = inputs.filter(input => commands.includes(input.command)).map(input => projectInput(input, true)), requests = added[`bx1_portal.${table}`], receipts = added[`bx1_portal.${receiptTable}`]
      validateInputJournal(requests, expected, ['actor_id', 'request_key', 'command', 'payload', 'operating_context'], window,
        ['actor_id', 'request_key', 'command', 'payload', 'operating_context', 'created_at', subjectField, 'receipt_id']); checks++
      eq(receipts.length, expected.length, `${table} has exactly one immutable receipt per successful command`)
      eq(new Set(requests.map(row => row.receipt_id)).size, expected.length, `${table} references each receipt exactly once`)
      for (const request of requests) {
        truth(subjectSet.has(request[subjectField]), `${table} is confined to exact known fictional subject`)
        const receipt = receipts.find(row => row.id === request.receipt_id), intended = inputs.find(input => input.actor_id === request.actor_id && input.request_key === request.request_key)
        truth(receipt, `${table} receipt exists in same bounded footprint`)
        eq([receipt[subjectField], receipt.actor_id, receipt.action, receipt.operating_context, receipt.command_payload],
          [request[subjectField], request.actor_id, request.command, request.operating_context, request.payload], `${table} receipt corresponds to exact input/request`)
        if (intended.command !== 'request_representative_mandate') eq(request[subjectField], intended.subject_id, `${table} cannot substitute another record`)
        truth(timestamp(receipt.recorded_at) >= timestamp(window.start) && timestamp(receipt.recorded_at) <= timestamp(window.end), `${table} immutable receipt time is bounded`)
      }
    }
    const eventInputs = inputs.filter(input => !['request_representative_mandate', 'review_representative_mandate', 'apply_representative_mandate'].includes(input.command))
    eq(added['bx1_portal.events'].length, eventInputs.length, 'one canonical event for every intended event-producing command, no extra financial/wallet/scanner event')
    const remainingEvents = [...added['bx1_portal.events']]
    for (const input of eventInputs) {
      const subject = input.command === 'review_offering_issuer' ? input.payload.offering_revision_id : input.subject_id
      const index = remainingEvents.findIndex(e => e.actor_id === input.actor_id && e.kind === input.command && e.subject_id === subject)
      truth(index >= 0, 'canonical event corresponds to intended actor/action/exact application/product/appointment/revision')
      const [event] = remainingEvents.splice(index, 1)
      const admissionCase = admissionCases.find(value => value.application.id === input.subject_id || value.application.id === input.payload.application_id)
      const applicationCommand = ['start_application', 'submit_application', 'review_application'].includes(input.command)
      const accountCommand = ['create_investment_account', 'create_entity_investment_account'].includes(input.command)
      const investingCommand = ['request_investing_representative_mandate', 'respond_investing_representative_proposal',
        'review_investing_representative_mandate', 'apply_investing_representative_mandate'].includes(input.command)
      if (applicationCommand || accountCommand) truth(admissionCase, 'application/account audit dimensions come from exact authored case and returned ID')
      eq([event.investor_id, event.application_id, event.organisation_id], [
        input.command === 'create_investment_account' ? individual.actor : null,
        applicationCommand || accountCommand ? admissionCase.application.id : investingCommand ? entity.application.id : null,
        ['start_application', 'submit_application'].includes(input.command) || accountCommand || investingCommand ? null
          : input.command === 'review_application' ? admissionCase.application.organisation_id : application.organisation_id], 'event preserves per-case canonical subject dimensions')
      truth(timestamp(event.created_at) >= timestamp(window.start) && timestamp(event.created_at) <= timestamp(window.end), 'event timestamp is inside database proof window')
      const eventSummary = {
        start_application: 'Additional unapproved application capacity created; no role or eligibility granted.',
        submit_application: 'Exact personal application submitted to the admitted synthetic manual-review route.',
        review_application: 'Manual TEST_ONLY onboarding decision: APPROVED. Approval, when given, expires after 30 days and is not provider verification.',
        create_investment_account: 'Individual investment account opened from current reviewed application. No holding or funding created.',
        create_entity_investment_account: 'Reviewed synthetic entity investment account opened. No representative, order, holding, wallet or funding authority granted.',
        request_investing_representative_mandate: 'Additional representative proposed, not appointed. Target consent and independent appointment review required; zero transaction limit.',
        respond_investing_representative_proposal: 'Named representative response to exact immutable proposal: ACCEPT. No account access or financial authority granted.',
        review_investing_representative_mandate: 'Independent synthetic review of exact entity representative appointment: APPROVED. No trading granted.',
        apply_investing_representative_mandate: 'Separately approved entity representative mandate applied: account view and future eligibility request; zero transaction limit.',
        create_product: 'Typed test product draft created. No assets or tokens issued.',
        save_product: input.payload.terms?.asset_type === 'REAL_ESTATE' ? 'Synthetic property draft terms revised; earlier review no longer applies.' : 'Test product draft terms revised; earlier review no longer applies.',
        submit_product: 'Test offering submitted for independent compliance review.',
        review_product: `Independent test offering review: ${input.payload.decision}.`,
        review_offering_issuer: `Appointed issuer decided exact immutable test offering package: ${input.payload.decision}. No publication or chain deployment.`,
        begin_offering_amendment: 'Synthetic TEST approved package opened for a governed terms amendment. Prior decisions remain immutable; no order, funding or ownership changed.',
        reopen_offering_review: 'Synthetic TEST approved offering reopened for fresh issuer and Compliance review. Prior decisions preserved; no publication, order or funding created.',
      }[input.command]
      if (eventSummary) eq(event.summary, eventSummary, 'event retains exact canonical mandatory audit summary')
      else {
        const a = added['bx1_portal.product_service_appointments'].find(value => value.id === input.subject_id)
        truth(a, 'appointment event references its exact known record')
        const status = input.command === 'request_product_service_appointment' ? 'SUBMITTED' : input.command === 'review_product_service_appointment' ? input.payload.decision : 'APPLIED'
        eq(event.summary, `Synthetic TEST product service appointment ${a.role} ${status}. No signing, funding or publication authority.`, 'appointment event preserves bounded authority audit label')
      }
    }
    eq(remainingEvents, [], 'no unrelated event hidden behind permitted fixture actor')
    const memoryJournal = legacyExpected.map(value => ({ ...clone(value), created_at: window.start }))
    validateInputJournal(memoryJournal, legacyExpected, ['actor_id', 'request_key', 'command', 'payload'], window); checks++
    for (const [label, mutate] of [
      ['missing row', value => value.pop()], ['duplicate row', value => value.push(clone(value[0]))],
      ['extra row', value => value.push({ ...clone(value[0]), request_key: id(990) })],
      ['changed actor', value => { value[0].actor_id = id(7) }], ['changed key', value => { value[0].request_key = id(990) }],
      ['changed action', value => { value[0].command = 'subscribe' }], ['changed payload', value => { value[0].payload.unrelated = true }],
      ['extra field', value => { value[0].unrelated = true }], ['missing field', value => { delete value[0].payload }],
      ['invalid timestamp', value => { value[0].created_at = 'invalid' }],
      ['invalid calendar', value => { value[0].created_at = '2026-02-30T00:00:00Z' }],
      ['outside timestamp', value => { value[0].created_at = new Date(Date.parse(window.start) - 1000).toISOString() }],
    ]) {
      const negative = clone(memoryJournal); mutate(negative)
      assert.throws(() => validateInputJournal(negative, legacyExpected, ['actor_id', 'request_key', 'command', 'payload'], window), { code: 'ERR_ASSERTION' }, `pure footprint rejects ${label}`); checks++
    }
    const checked = new Set(['bx1_portal.requests', 'bx1_portal.scoped_requests', 'bx1_portal.entry_requests',
      'bx1_portal.representative_mandate_requests', 'bx1_portal.representative_mandate_receipts',
      'bx1_portal.product_service_appointment_requests', 'bx1_portal.product_service_appointment_receipts', 'bx1_portal.events'])
    const closed = (name, count, predicate) => {
      checked.add(name)
      eq(added[name].length, count, `${name} has only the exact bounded fictional additions`)
      for (const row of added[name]) truth(predicate(row), `${name} addition matches intended fixture identity/relationship, not just schema permission`)
    }
    const actors = new Set([1, 2, 3, 4, 5, 6, 7].map(id))
    closed('auth.users', 7, row => actors.has(row.id) && row.email === `offering-workflow-${Number(row.id.slice(-12))}@example.invalid` && row.is_anonymous === false)
    closed('auth.sessions', 7, row => actors.has(row.user_id) && row.id === id(100 + Number(row.user_id.slice(-12))) && row.aal === 'aal1')
    closed('auth.mfa_factors', 6, row => actors.has(row.user_id) && row.id === id(200 + Number(row.user_id.slice(-12))) && row.status === 'verified' && row.factor_type === 'totp')
    closed('public.bx1_profiles', 7, row => actors.has(row.id) && row.status === 'ACTIVE')
    closed('public.bx1_organisations', 2, row => [otherScope, mandate.native_organisation_id].includes(row.id) && row.status === 'ACTIVE')
    closed('public.bx1_memberships', 7, row => row.id === membership && row.user_id === id(1) && row.organisation_id === mandate.native_organisation_id && row.role === 'OfferingManager' && row.status === 'ACTIVE'
      || [2, 3, 4, 5, 6, 7].some(n => row.id === id(400 + n) && row.user_id === id(n) && row.organisation_id === (n === 6 ? otherScope : scope)
        && row.role === (n === 3 ? 'IssuerFundManager' : n === 5 ? 'SuperAdmin' : n === 7 ? 'Investor' : 'ComplianceOfficer') && row.status === 'ACTIVE'))
    closed('bx1_portal.applications', 3, row => admissionCases.some(value => row.id === value.application.id && row.user_id === value.actor
      && row.status === 'APPROVED' && row.persona === value.application.persona && row.revision === value.application.revision
      && row.context_kind === 'PERSONAL' && row.context_organisation_id === null && row.provider_mode === 'MANUAL_TEST_REVIEW'
      && row.reviewer_scope === scope && row.reviewer_id === id(2) && isDeepStrictEqual(row.details, value.details)))
    closed('bx1_portal.organisations', 1, row => row.id === application.organisation_id && row.application_id === application.id && row.owner_id === id(1) && row.reviewer_scope === scope && row.status === 'ACTIVE')
    const submissions = inputs.filter(input => input.command === 'submit_application')
    closed('bx1_portal.application_detail_versions', 3, row => submissions.some(input => row.application_id === input.payload.application_id
      && row.application_revision === input.payload.expected_revision + 1 && row.capture_kind === 'SUBMISSION' && isDeepStrictEqual(row.details, input.payload.details)))
    const detailsHashes = new Map()
    for (const input of submissions) detailsHashes.set(input.payload.application_id,
      await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')", [JSON.stringify(input.payload.details)]))
    closed('bx1_portal.application_ownership_control_versions', 2, row => submissions.some(input => (input.payload.details.ownership_control ?? []).some(owner =>
      row.application_id === input.payload.application_id && row.application_revision === input.payload.expected_revision + 1
      && row.relationship_id === owner.id && row.party_type === owner.party_type && row.legal_name === owner.legal_name
      && row.registration_reference === owner.registration_reference && row.country === owner.country && row.relationship === owner.relationship
      && row.ownership_basis_points === owner.ownership_basis_points && row.control_basis === owner.control_basis && row.effective_on === owner.effective_on
      && row.change_reason === owner.change_reason && row.ownership_change_reason === input.payload.details.ownership_change_reason
      && row.evidence_document_id === owner.evidence_document_id && row.submitted_details_sha256 === detailsHashes.get(input.payload.application_id))))
    const proposalInput = inputs.find(input => input.command === 'request_investing_representative_mandate')
    const consentInput = inputs.find(input => input.command === 'respond_investing_representative_proposal')
    const reviewInput = inputs.find(input => input.command === 'review_investing_representative_mandate')
    const applyInput = inputs.find(input => input.command === 'apply_investing_representative_mandate')
    const expectedParty = { id: entityAccount.entity_party_id, application_id: entity.application.id, admission_revision: entity.application.revision,
      submitted_revision: inputs.find(input => input.command === 'submit_application' && input.payload.application_id === entity.application.id).payload.expected_revision + 1,
      legal_name: entity.details.company_name, registration_reference: entity.details.registration_reference, country: entity.details.country,
      submitted_details_sha256: detailsHashes.get(entity.application.id) }
    const expectedAccounts = [
      { id: individualAccount.id, holder_user_id: individual.actor, application_id: individual.application.id, kind: 'INDIVIDUAL', status: 'ACTIVE', entity_party_id: null },
      { id: entityAccount.id, holder_user_id: null, application_id: entity.application.id, kind: 'ENTITY', status: 'ACTIVE', entity_party_id: expectedParty.id },
    ]
    const expectedInvesting = { id: investingMandate.id, investment_account_id: proposalInput.payload.investment_account_id,
      application_id: entity.application.id, entity_party_id: expectedParty.id, applicant_user_id: proposalInput.actor_id,
      representative_user_id: consentInput.actor_id, reviewer_scope_organisation_id: scope, admission_revision: entity.application.revision,
      cycle: 1, revision: applyInput.payload.expected_revision + 1, status: 'APPLIED', scope: ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'], transaction_limit_minor: 0,
      evidence_reference: proposalInput.payload.evidence_reference, appointment_document_id: proposalInput.payload.appointment_document_id,
      appointment_document_sha256: entity.documents[1].sha256, requested_until: proposalInput.payload.requested_until,
      reviewer_user_id: reviewInput.actor_id, review_notes: reviewInput.payload.notes, review_checks: clone(reviewInput.payload.checks),
      approval_receipt_id: investingMandate.approval_receipt_id, applied_by_user_id: applyInput.actor_id,
      revoked_at: null, revoked_by_user_id: null, revoke_reason: null, representative_email: proposalInput.payload.representative_email,
      representative_name: individual.details.full_name, representative_application_id: individual.application.id,
      representative_application_revision: individual.application.revision, representative_submitted_revision: 2,
      representative_details_sha256: detailsHashes.get(individual.application.id), proposal_hash: consentInput.payload.proposal_hash,
      consent_decision: consentInput.payload.decision, consent_receipt_id: investingMandate.consent_receipt_id }
    const receiptInputs = [proposalInput, consentInput, reviewInput, applyInput]
    const expectedInvestingReceipts = receiptInputs.map((input, index) => ({ mandate_id: investingMandate.id, mandate_revision: index + 1,
      action: input.command, actor_id: input.actor_id, operating_context: clone(input.operating_context), command_payload: clone(input.payload),
      admission_revision: entity.application.revision, status_after: ['PROPOSED', 'SUBMITTED', 'APPROVED', 'APPLIED'][index],
      ...(index === 1 ? { id: investingMandate.consent_receipt_id } : index === 2 ? { id: investingMandate.approval_receipt_id } : {}) }))
    for (const [table, expected, timeFields, receiptIds] of [
      ['legal_entity_parties', [expectedParty], ['created_at'], false],
      ['investment_accounts', expectedAccounts, ['created_at'], false],
      ['investing_representative_mandates', [expectedInvesting], ['created_at', 'submitted_at', 'reviewed_at', 'applied_at', 'responded_at', 'requested_until', 'revoked_at'], false],
      ['investing_representative_receipts', expectedInvestingReceipts, ['recorded_at'], true],
    ]) {
      checked.add(`bx1_portal.${table}`)
      validateAdmissionRecords(added[`bx1_portal.${table}`], expected, timeFields, window, receiptIds); checks++
    }
    const rawInvesting = added['bx1_portal.investing_representative_mandates'][0]
    eq(rawInvesting.submitted_at, rawInvesting.responded_at, 'explicit consent sets exact submitted handoff timestamp')
    truth(timestamp(rawInvesting.responded_at) <= timestamp(rawInvesting.reviewed_at) && timestamp(rawInvesting.reviewed_at) <= timestamp(rawInvesting.applied_at),
      'explicit consent, independent review and application retain their ordered finite handoff times')
    const memoryReceipts = expectedInvestingReceipts.map((value, index) => ({ ...clone(value), id: value.id ?? id(960 + index), recorded_at: window.start }))
    validateAdmissionRecords(memoryReceipts, expectedInvestingReceipts, ['recorded_at'], window, true); checks++
    for (const [label, mutate] of [
      ['missing receipt', value => value.pop()], ['extra receipt', value => value.push({ ...clone(value[0]), mandate_revision: 99 })],
      ['duplicate revision', value => { value[1].mandate_revision = 1 }], ['duplicate ID', value => { value[0].id = value[1].id }],
      ['foreign mandate', value => { value[0].mandate_id = id(990) }], ['wrong actor', value => { value[1].actor_id = id(1) }],
      ['wrong command', value => { value[0].action = 'subscribe' }], ['wrong scope', value => { value[2].operating_context.organisationId = otherScope }],
      ['changed proposal hash', value => { value[1].command_payload.proposal_hash = 'f'.repeat(64) }],
      ['changed decision', value => { value[1].command_payload.decision = 'DECLINE' }], ['wrong status', value => { value[1].status_after = 'APPLIED' }],
      ['wrong admission', value => { value[0].admission_revision++ }], ['wrong consent binding', value => { value[1].id = id(990) }],
      ['extra field', value => { value[0].unrelated = true }], ['missing payload', value => { delete value[0].command_payload }],
      ['invalid receipt time', value => { value[0].recorded_at = 'invalid' }],
      ['outside receipt time', value => { value[0].recorded_at = new Date(timestamp(window.start) - 1000).toISOString() }],
    ]) {
      const negative = clone(memoryReceipts); mutate(negative)
      assert.throws(() => validateAdmissionRecords(negative, expectedInvestingReceipts, ['recorded_at'], window, true), { code: 'ERR_ASSERTION' }, `pure admission footprint rejects ${label}`); checks++
    }
    closed('bx1_portal.representative_mandates', 1, row => row.id === mandate.id && row.application_id === application.id && row.applicant_user_id === id(1)
      && row.product_organisation_id === application.organisation_id && row.native_organisation_id === mandate.native_organisation_id && row.native_membership_id === membership
      && row.authority_binding_id === binding && row.status === 'APPLIED' && row.revision === mandate.revision)
    closed('bx1_portal.organisation_authority_bindings', 1, row => row.id === binding && row.product_organisation_id === application.organisation_id
      && row.native_organisation_id === mandate.native_organisation_id && row.role === 'OfferingManager' && row.status === 'ACTIVE')
    closed('bx1_portal.customer_monitoring_cases', 1, row => row.application_id === application.id && row.state === 'CURRENT' && row.revision === 3 && row.last_receipt_id === monitoringId && row.decided_by === id(2))
    closed('storage.objects', 7, row => row.bucket_id === 'bx1-portal-documents' && admissionCases.some(value => row.owner_id === value.actor
      && value.documents.some(d => d.storage_path === row.name && isDeepStrictEqual(row.metadata, { size: d.size, mimetype: d.mime_type }))))
    closed('bx1_private.document_upload_receipts', 7, row => admissionCases.some(value => row.actor_id === value.actor
      && row.session_id === id(100 + Number(value.actor.slice(-12))) && value.documents.some(d => row.id === d.id && row.storage_path === d.storage_path
        && row.kind === d.kind && row.sha256 === d.sha256 && row.title === d.title && row.byte_size === d.size && row.mime_type === d.mime_type))
      && row.validation_state === 'SYNTHETIC_UNSCANNED')
    closed('bx1_private.document_application_bindings', 7, row => submissions.some(input => row.application_id === input.payload.application_id
      && row.application_revision === input.payload.expected_revision + 1 && input.payload.details.documents.some(d => d.id === row.receipt_id)))
    closed('bx1_private.document_receipt_events', 14, row => documents.some(d => d.id === row.receipt_id)
      && (row.kind === 'REGISTERED' && row.application_id === null && row.application_revision === null
        || row.kind === 'BOUND' && submissions.some(input => row.application_id === input.payload.application_id
          && row.application_revision === input.payload.expected_revision + 1 && input.payload.details.documents.some(d => d.id === row.receipt_id))))
    closed('bx1_portal.products', 2, row => productIds.has(row.id) && row.organisation_id === application.organisation_id && row.created_by === id(1)
      && row.status === 'APPROVED' && row.published_at === null && String(row.reserved_units) === '0' && row.terms.terms_version === 2 && row.terms.currency === 'TST'
      && revisionIds.has(row.current_offering_revision_id))
    closed('bx1_portal.offering_revisions', revisionIds.size, row => revisionIds.has(row.id) && productIds.has(row.product_id) && row.origin === 'SUBMITTED' && row.submitted_by === id(1)
      && row.terms.terms_version === 2 && row.terms.currency === 'TST')
    const decisionInputs = inputs.filter(input => ['review_offering_issuer', 'review_product'].includes(input.command))
    closed('bx1_portal.offering_decisions', decisionInputs.length, row => decisionInputs.some(input => row.offering_revision_id === input.payload.offering_revision_id
      && row.actor_id === input.actor_id && row.decision_kind === (input.command === 'review_offering_issuer' ? 'ISSUER' : 'COMPLIANCE')
      && row.decision === input.payload.decision && row.terms_hash === input.payload.terms_hash && row.product_revision_at_decision === input.payload.expected_revision
      && row.notes === input.payload.notes && isDeepStrictEqual(row.checks, input.payload.checks)
      && isDeepStrictEqual(row.operating_context, input.operating_context)) && appointmentIds.has(row.product_appointment_id))
    closed('bx1_portal.product_service_appointments', 4, row => appointmentIds.has(row.id) && productIds.has(row.product_id) && row.product_organisation_id === application.organisation_id
      && row.reviewer_scope_organisation_id === scope && row.requested_by_user_id === id(1) && row.reviewed_by_user_id === id(4) && row.applied_by_user_id === id(5)
      && row.appointee_user_id === (row.role === 'IssuerFundManager' ? id(3) : id(2)) && row.native_membership_id === (row.role === 'IssuerFundManager' ? id(403) : id(402))
      && row.status === 'APPLIED' && row.revision === 3)
    for (const [table, action] of [['offering_amendment_begin_receipts', 'begin_offering_amendment'], ['offering_review_reopen_receipts', 'reopen_offering_review']]) {
      const intents = inputs.filter(input => input.command === action)
      closed(`bx1_portal.${table}`, intents.length, row => intents.some(input => row.actor_id === input.actor_id && row.request_key === input.request_key
        && row.product_id === input.payload.product_id && row.reason === input.payload.reason && row.product_revision_before === input.payload.expected_revision
        && row.product_revision_after === input.payload.expected_revision + 1 && isDeepStrictEqual(row.operating_context, input.operating_context))
        && revisionIds.has(row.prior_offering_revision_id) && (action !== 'reopen_offering_review' || revisionIds.has(row.reopened_offering_revision_id)))
    }
    for (const [name, additions] of Object.entries(added)) if (!checked.has(name))
      eq(additions, [], `all other ${name} provider/scanner/identity/wallet/funding/order/holding/configuration rows remain exact, no blanket waiver`)
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[...actors]]), 0, 'all temporary identity negatives are removed; no invented verified humans')
    eq(await scalar(`select count(*)::int from bx1_portal.offering_revisions where id=any($1::uuid[])
      and (terms_hash<>encode(sha256(convert_to(terms::text,'UTF8')),'hex') or document_hashes<>bx1_portal.offering_document_hashes(terms))`, [[...revisionIds]]), 0,
      'each immutable package hash/document text digest matches its own exact frozen terms; no actual e-signature or file-clean claim')
    await commit()
    console.log(`BX1_OFFERING_WORKFLOW_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 parent=admission795-and-committed-representatives-first assets=FUND-and-REAL_ESTATE commands=canonical-package-only postCutoverAdmission=12-public-commands-and-distinct-individual-entity-consent-accounts appointments=independently-reviewed-and-applied changesRequired=proven amendment=fresh-immutable-lineage reopen=same-hash-fresh-decisions replay=durable-exact-key auditRollback=proven concurrency=real-admission-monitoring-membership-product-revision-appointment-waits inheritedRows=exact inputJournals=exact globalSecurity=unchanged outcome=approved-unpublished-unopened cleanup=caller-exact-schema-required hostedAcceptance=not-proven documentBytes=not-proven fileScanning=not-proven eSignature=not-proven independentHumans=not-proven technicalReadiness=not-verified`)
    return checks
  } catch (error) {
    error.offeringWorkflowPhase = phase
    throw error
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
  }
}
