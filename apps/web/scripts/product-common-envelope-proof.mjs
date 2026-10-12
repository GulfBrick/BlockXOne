import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

// Additive cloud proof AFTER the accepted offering proof. Never reinstalls its
// fixture or invokes a local provider, Storage service, scanner or signer.
const clone = value => JSON.parse(JSON.stringify(value))
const normalize = value => value.replace(/\r\n/g, '\n').trim()
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')
const actor = n => `ef840000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fictional = n => `ce350000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
const reviewFields = ['product_id', 'expected_revision', 'offering_revision_id', 'terms_hash', 'decision', 'notes', 'checks']
const newReviewFields = ['common_envelope_hash', 'deployment_configuration_hash']
const addedColumns = {
  'bx1_portal.offering_revisions': ['common_envelope_hash', 'deployment_configuration_hash', 'issuer_declaration_reference', 'issuer_declaration_revision'],
  'bx1_portal.offering_decisions': ['common_envelope_hash', 'deployment_configuration_hash'],
}
const pins = {
  'validate_terms(jsonb)': '81e1acde7c54b79ccb156d8826b78fed6972fbed5902a11ad573a74fde4c064d',
  'save_fund_v2_scoped(jsonb,uuid,jsonb)': 'd363cc666efe673c63f4cc54cbc325d5ff06b76b7c7715c726ee86e386449879',
  'save_real_estate_v2_scoped(jsonb,uuid,jsonb)': 'd3c7a414f06c57eca679fc17067b5e53ee52a062200f884c4d786978b6a26fea',
  'guard_fund_v2_product()': '469bf99150dabdd5eebd124838c7cdc9eb12b5c506b1e005dc596b6465b7ea97',
  'guard_real_estate_v2_product()': '6b3787a70a63c1af688e449f45c3266c7593a539c54d531706d01035d9c5d551',
  'guard_fund_v2_subscription()': '1ec2a9e4cf9eb13ea820811e8d060236451aad137a56735ac613637e14e83472',
  'execute_scoped_pre_product_appointment(jsonb,text,uuid,jsonb)': 'b583a615e4cc279c887e9abcb368ac6eed14fa7b9307df8de9f62e3b72ff914c',
  'offering_workflow_command(jsonb,text,uuid,jsonb)': 'a6bae2735d6ef351a8067ccc4b62c5441446d8de0063f77d1749b3d5b6a5dc8f',
  'read_scoped_pre_handoff(jsonb)': 'e68aa36870e00e923cc6509a398091712c1c659d3160f4ecb5ec2087e4ace027',
  'execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)': '71368afe93a25122b3f9cc1c80d08b3d10afe96b8b009fd361c67f4836d81903',
  'execute_appointed_compliance_decision(jsonb,uuid,jsonb)': 'f74f8d5b1c0c2498588f379ecd6e4aa2fe8796e7722074228e9b15581ed4a9a3',
  'guard_offering_revision_product_lock()': '2bdecafe5af01707888c832894425ddc9276ff09997ecbef6f417e9d739a8c50',
  'guard_offering_decision_appointment()': '903ae5858adb1a4f4e65d298cd507d026d4911debf30b6f1ab4a1ef254f0a9f0',
  'offering_approved(uuid)': '32b10d36ba3587b86f56973c5a3a3464741354bfd935fae02dfd829c76b00300',
  'offering_workflow_approved(uuid)': '97f8c77550140d329aee65c6cfc11277882897f8fddaed215ea14d65ab9dd2e6',
  'offering_package_projection_pre_appointment(jsonb,uuid)': '5673f1d7f8556a48019f8ef7307f264b5697eff9e76cb52440f8ec253e44c5fc',
  'offering_workflow_package_projection_base(jsonb,uuid)': 'e8ecb175c0f00f2ecd1076494ed4eb44647cb3029da9ce43bab1f85fbcb8e9f7',
  'offering_history_projection(uuid)': 'aaec401a3b39dd746884e0ac7d26fe4ed9862df343d6bc447421eed9e2919312',
}
const helpers = {
  'product_common_envelope_economic_projection(jsonb)': ['jsonb', 'i'],
  'product_common_envelope_validate(jsonb)': ['void', 'v'],
  'product_issuer_declaration_hash(uuid,jsonb)': ['text', 'i'],
  'product_common_envelope_hash(uuid,jsonb)': ['text', 'i'],
  'product_deployment_configuration_hash(uuid,jsonb)': ['text', 'i'],
  'product_common_envelope_review_replay_authority(jsonb,text,jsonb)': ['void', 'v'],
  'guard_product_common_envelope_declaration()': ['trigger', 'v'],
}

function termsV3(base, productOrganisation, ordinal, name) {
  const value = { ...clone(base), terms_version: 3, name }
  const property = value.asset_type === 'REAL_ESTATE'
  const rights = property ? value.real_estate.spv.interest_rights : value.fund.class_rights
  if (property) value.issuer_name = value.real_estate.spv.legal_name
  const policies = ['role_grant_revoke', 'mint_burn', 'pause_freeze', 'force_transfer', 'recovery', 'upgrade']
  value.common_envelope = {
    envelope_version: 1, posture: 'SYNTHETIC_DECLARED',
    issuer: { issuer_reference: fictional(ordinal), declaration_revision: 1, legal_name: value.issuer_name,
      registration_reference: property ? value.real_estate.spv.registration_reference : 'FICTIONAL-CE-FUND-001',
      jurisdiction: property ? value.real_estate.spv.jurisdiction : 'ZA', legal_form: 'Fictional declared vehicle', governing_law: 'Fictional South African proposal' },
    manager_organisation_id: productOrganisation,
    classes: [{ class_id: fictional(ordinal + 1), primary: true, name: value.share_class, decimals: 0, rights,
      unit_price_minor: value.unit_price_minor, cap_units: value.cap_units, minimum_units: value.minimum_units,
      operational_scope: 'PRIMARY_PACKAGE_ONLY' },
    { class_id: fictional(ordinal + 2), primary: false, name: 'Fictional declaration-only class', decimals: 0,
      rights: 'Fictional secondary rights declaration only; no issued or subscribed balance.',
      unit_price_minor: null, cap_units: null, minimum_units: null, operational_scope: 'DECLARATION_ONLY' }],
    custody_title: { asset_title_model: property ? 'PROPERTY_SPV_INTEREST_DECLARATION' : 'FUND_PORTFOLIO_INTEREST_DECLARATION',
      asset_control_model: 'ISSUER_CONTROL_DECLARED', custodian_legal_name: null,
      title_evidence_reference: property ? value.real_estate.property.title_evidence_reference : 'FICTIONAL-FUND-TITLE-REFERENCE',
      control_evidence_reference: property ? value.real_estate.property.control_evidence_reference : 'FICTIONAL-FUND-CONTROL-REFERENCE',
      segregation_policy: 'Fictional segregation proposal requires independent admission before use.',
      control_policy: 'Fictional issuer control proposal is not admitted custody or actual title.',
      recovery_policy: 'Fictional custody recovery requires separate evidence and governed approval.' },
    register: { authority: property ? 'DECLARED_SPV_REGISTER' : 'DECLARED_ISSUER_REGISTER',
      evidence_precedence: 'REVIEWED_TERMS_AND_DECLARED_REGISTER_OVER_TOKEN_PROJECTION',
      correction_policy: 'Fictional register corrections require independently reviewed immutable evidence.',
      dispute_policy: 'Fictional register disputes are resolved through separately admitted governance.' },
    eligibility: { countries_ref: 'eligible_countries', investor_types_ref: 'eligible_investor_types',
      identity_policy: 'Fictional identity policy; no provider result, eligible investor or live admission.' },
    transfer: { eligible_transfer_policy: property ? value.real_estate.exits.eligible_transfer_policy : 'Fictional holder transfer requires separately reviewed recipient eligibility and authority.',
      lockup_days: property ? 30 : value.fund.liquidity.lockup_days, maximum_holder_bps: 5000,
      consent_policy: property ? value.real_estate.governance.consent_rights : 'Fictional transfer consent must be separately evidenced under the reviewed class rights.',
      lender_consent_policy_ref: property ? 'real_estate.financing.lender_consent_policy' : null },
    fees: { schedule_ref: property ? 'real_estate.cashflow' : 'fund.fees',
      tax_policy: 'Fictional tax proposal requires separately approved jurisdiction-specific treatment.', rounding_mode: 'DOWN' },
    settlement: { status: 'DECLARED_NOT_APPROVED', currency: 'TST', decimals: 6, chain_id: 80002,
      funding_rail: 'TEST_ASSET_PROPOSAL_ONLY', beneficiary_policy: 'INDEPENDENT_APPROVAL_REQUIRED',
      reconciliation_policy: 'Fictional reconciliation proposal; no payment or consideration is accepted.',
      exception_policy: 'Fictional settlement exceptions require independent review before execution.' },
    servicing: { reporting_frequency: 'QUARTERLY', reporting_policy: 'Fictional reports use a governed dated register and separately admitted source evidence.',
      default_events: ['REPORTING_FAILURE', 'MATERIAL_TERMS_BREACH'], default_notice_days: 30,
      default_response_policy: 'Fictional default response requires separately reviewed affected rights and evidence.',
      termination_notice_days: 60, termination_approval: 'ISSUER_AND_COMPLIANCE_REVIEW_REQUIRED',
      termination_policy: 'Fictional termination proposal does not execute liquidation, payouts or rights cancellation.' },
    exit_policy_refs: property ? ['real_estate.exits.eligible_transfer_policy', 'real_estate.exits.disposal_liquidation_policy']
      : ['fund.redemption', 'fund.dealing', 'fund.liquidity'],
  }
  value.deployment_configuration = { configuration_version: 1, state: 'PROPOSED_NOT_DEPLOYED',
    standard_family: 'ERC-3643', conformance: 'NOT_VERIFIED', chain_id: 80002, network: 'POLYGON_AMOY',
    class_ids: value.common_envelope.classes.map(item => item.class_id), primary_class_id: value.common_envelope.classes[0].class_id,
    policy_refs: { eligibility: 'common_envelope.eligibility', transfer: 'common_envelope.transfer',
      identity: 'common_envelope.eligibility.identity_policy', fees: 'common_envelope.fees', custody_title: 'common_envelope.custody_title',
      register: 'common_envelope.register', servicing: 'common_envelope.servicing', exits: 'common_envelope.exit_policy_refs' },
    routine_authority: 'CONTROLLER_ONLY', signing: { state: 'PROPOSED_INSTITUTIONAL_POLICY', threshold_scope: 'HIGH_RISK_ONLY',
      policy_slots: ['CONTROLLER_OPERATOR', 'INDEPENDENT_GOVERNANCE', 'INDEPENDENT_COMPLIANCE'], threshold: 2,
      required_high_risk_slots: ['INDEPENDENT_GOVERNANCE', 'INDEPENDENT_COMPLIANCE'],
      routine_controller_policy: 'Fictional routine controller operations remain separate from every high-risk authority.',
      key_recovery_policy: 'Fictional key recovery requires separately admitted institutional safeguards and evidence.' },
    governance: { model: 'IMMUTABLE_RELEASE_GOVERNED_MIGRATION_PROPOSAL', timelock_hours: 48,
      controller_replacement_policy: 'Fictional controller replacement requires separately approved migration and independent review.',
      powers: Object.fromEntries(policies.map(power => [power, `Fictional ${power} power proposal requires its own separately approved evidence and governed scope.`])) },
    required_decisions: ['ISSUER_PACKAGE_REVIEW', 'APPOINTED_COMPLIANCE_PACKAGE_REVIEW', 'SEPARATE_TECHNICAL_READINESS', 'SEPARATE_LEGAL_AND_SERVICE_ADMISSION'],
  }
  return value
}

export async function proveProductCommonEnvelope(db, clients, featureSql, fundV2LegacyCrossrefs) {
  if (process.env.GITHUB_ACTIONS !== 'true' || clients.length !== 2) throw new Error('CE proof requires retained disposable cloud fixture')
  let checks = 0, sequence = 10000, begun = false, phase = 'baseline', mode = 'TEST_PASSWORD', primaryFailure
  let standardCommitted = false, standardPrior, standardFixture, settingsBefore, proofStartedAt
  const key = () => fictional(++sequence)
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (value, label) => { assert.ok(value, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = async (client = db) => { await client.query('reset role'); eq(await scalar('select current_user', [], client), 'postgres', 'exact fixture owner before owner-only operation') }
  const begin = async () => { await admin(); await db.query('begin'); begun = true }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const claims = async (n, client = db, extra = {}) => {
    await admin(client)
    const at = Math.floor(Date.now() / 1000)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor(n), session_id: actor(100 + n),
      role: 'authenticated', aal: mode === 'STANDARD' ? 'aal2' : 'aal1', iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1',
      exp: at + 3600, amr: mode === 'STANDARD' ? [{ method: 'password', timestamp: at }, { method: 'totp', timestamp: at }]
        : [{ method: 'password', timestamp: at }], ...extra })])
    await client.query('set local role authenticated')
  }
  const role = (name, organisationId = scope) => ({ mode: 'ROLE', organisationId, role: name })
  let manager, managerApplication, managerMandate, organisation, originalSpecs, installedSpecs, originalRows, originalFunctions, originalSecurity, installedFunctions, installedSecurity
  const reviewer = role('ComplianceOfficer'), issuer = role('IssuerFundManager'), applier = role('SuperAdmin')
  const records = [], inputs = [], products = new Set(), appointments = new Set(), revisions = new Set()
  const modelTerms = new Map(), revisionTerms = new Map()
  const read = async (n, context, client = db) => { await claims(n, client); return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)], client) }
  const command = async (n, context, action, body, requestKey = key(), client = db, extra = {}) => {
    await claims(n, client, extra)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [action, requestKey, JSON.stringify(body), JSON.stringify(context)], client)
  }
  const funcs = async () => {
    await admin()
    return (await db.query(`select p.oid::text,p.oid::regprocedure::text signature,n.nspname,
      to_jsonb(p) catalog,pg_get_functiondef(p.oid) definition,p.prorettype::regtype::text result
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('auth','storage','public','bx1_private','bx1_portal') order by p.oid`)).rows
  }
  const specs = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname,c.oid::text,
      array(select a.attname::text from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum) columns,
      array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
        where i.indrelid=c.oid and i.indisprimary order by a.attnum) primary_key
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
      and (n.nspname in ('auth','storage','bx1_private','bx1_portal') or n.nspname='public' and c.relname like 'bx1_%') order by 1,2`)).rows
  }
  const state = async (tableSpecs = installedSpecs ?? originalSpecs, client = db) => {
    await admin(client); const result = {}
    for (const table of tableSpecs) {
      for (const name of [table.nspname, table.relname, ...table.columns]) assert.match(name, /^[a-z0-9_]+$/)
      result[`${table.nspname}.${table.relname}`] = await scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table.nspname}.${table.relname} t`, [], client)
    }
    return result
  }
  const security = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(v) order by oid) from (select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles) v),
      'edges',(select jsonb_agg(to_jsonb(v) order by roleid,member,grantor) from pg_auth_members v),
      'schemas',(select jsonb_agg(to_jsonb(v) order by oid) from (select oid,nspname,nspowner,nspacl from pg_namespace where nspname in ('auth','storage','public','bx1_private','bx1_portal')) v),
      'relations',(select jsonb_agg(to_jsonb(v) order by oid) from (select c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) v),
      'policies',(select jsonb_agg(to_jsonb(v) order by schemaname,tablename,policyname) from pg_policies v),
      'triggers',(select jsonb_agg(to_jsonb(v) order by oid) from (select t.oid,t.tgrelid,t.tgname,t.tgenabled,t.tgfoid,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) v),
      'constraints',(select jsonb_agg(to_jsonb(v) order by oid) from (select k.oid,k.conrelid,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) v),
      'defaults',(select jsonb_agg(to_jsonb(v) order by oid) from pg_default_acl v))`)
  }
  const isolated = async run => {
    await admin(); const savepoint = `ce_isolated_${++sequence}`; await db.query(`savepoint ${savepoint}`)
    let primary
    try { return await run() } catch (error) { primary = error; throw error }
    finally {
      try { await db.query(`rollback to savepoint ${savepoint}; release savepoint ${savepoint}`); await admin() }
      catch (cleanupError) { if (!primary) throw cleanupError; console.error('BX1_PRODUCT_COMMON_ENVELOPE_CLEANUP_FAILED code=SAVEPOINT_RECOVERY'); throw primary }
    }
  }
  const denied = async (label, run, expected = '42501', expectedMessage = null) => {
    await admin(); const savepoint = `ce_denial_${++sequence}`; await db.query(`savepoint ${savepoint}`)
    let code, message, primary
    try { await run() } catch (error) { code = error?.code; message = error?.message; if (!code) primary = error }
    finally {
      try { await db.query(`rollback to savepoint ${savepoint}; release savepoint ${savepoint}`); await admin() }
      catch (cleanupError) { if (!primary) throw cleanupError; console.error('BX1_PRODUCT_COMMON_ENVELOPE_CLEANUP_FAILED code=DENIAL_RECOVERY'); throw primary }
    }
    if (primary) throw primary
    truth((Array.isArray(expected) ? expected : [expected]).includes(code), `${label}: expected SQLSTATE, received ${code ?? 'none'}`)
    if (expectedMessage !== null) eq(message, expectedMessage, 'denial is the exact preserved producer guard, not an earlier unrelated gate')
  }
  const intent = async (n, context, action, body, requestKey = key()) => {
    const input = clone({ actor_id: actor(n), request_key: requestKey, command: action, payload: body, operating_context: context })
    if (action === 'request_product_service_appointment') input.product_terms_at_request = clone(modelTerms.get(body.product_id))
    const snapshot = await command(n, context, action, body, requestKey)
    eq(snapshot.operating_context, context, 'canonical saved response preserves selected context')
    if (mode === 'TEST_PASSWORD') eq(snapshot.offering_access?.session_mode, 'TEST_PASSWORD', 'positive TEST uses password package path')
    else { await admin(); await claims(n); await admin(); eq(await scalar('select bx1_portal.offering_workflow_context($1::jsonb)', [JSON.stringify(context)]), false, 'positive STANDARD never takes password helper') }
    input.subject_id = action === 'create_product' ? snapshot.products.find(p => p.terms.name === body.terms.name)?.id
      : action === 'request_product_service_appointment' ? snapshot.product_appointments.find(a => a.product_id === body.product_id && a.role === body.role)?.id
        : body.appointment_id ?? body.product_id
    truth(input.subject_id, 'successful command has exact input/canonical returned subject')
    if (action === 'create_product' || action === 'save_product') modelTerms.set(input.subject_id, clone(body.terms))
    const productId = action === 'create_product' || action === 'save_product' ? input.subject_id : body.product_id
    const returnedProduct = snapshot.products.find(p => p.id === productId)
    if (returnedProduct && modelTerms.has(productId)) {
      eq(returnedProduct.terms, modelTerms.get(productId), 'each canonical response retains the exact latest authored full terms')
      if (returnedProduct.offering_package?.id) {
        revisions.add(returnedProduct.offering_package.id)
        revisionTerms.set(returnedProduct.offering_package.id, clone(modelTerms.get(productId)))
      }
    }
    inputs.push(input)
    return snapshot
  }
  const findProduct = (snapshot, id) => { const p = snapshot.products.find(value => value.id === id); truth(p, 'exact canonical product is returned'); return p }
  const positive = async (n, context, action, body, id, requestKey = key()) => findProduct(await intent(n, context, action, body, requestKey), id)
  const snapshotData = async (p, expectedTerms) => {
    await admin()
    eq(p.terms, expectedTerms, 'full v3 input persists without normalization or economic projection')
    eq(p.terms_hash, await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')", [JSON.stringify(expectedTerms)]), 'full terms hash is PostgreSQL original JSONB hash')
    if (!p.offering_package) return
    const r = await scalar('select to_jsonb(r) from bx1_portal.offering_revisions r where id=$1', [p.offering_package.id])
    revisions.add(r.id)
    eq(r.terms, expectedTerms, 'immutable package retains full source terms')
    eq(r.terms_hash, p.terms_hash, 'immutable terms hash matches exact original input')
    for (const [column, fn] of [['common_envelope_hash', 'product_common_envelope_hash'], ['deployment_configuration_hash', 'product_deployment_configuration_hash']])
      eq(r[column], await scalar(`select bx1_portal.${fn}($1::uuid,$2::jsonb)`, [p.id, JSON.stringify(expectedTerms)]), 'server-derived immutable binding matches exact source terms')
    const refs = Object.fromEntries(['issuer_name', 'share_class', 'currency', 'settlement_decimals', 'unit_price_minor', 'cap_units', 'minimum_units',
      'eligible_countries', 'eligible_investor_types', 'property_address', 'property_valuation_minor'].map(field => [field, expectedTerms[field]]))
    refs.asset_policies = expectedTerms.asset_type === 'FUND' ? { fund: expectedTerms.fund } : { real_estate: expectedTerms.real_estate }
    const commonInput = { domain: 'BX1_COMMON_ENVELOPE_V3_1', product_id: p.id, asset_type: expectedTerms.asset_type,
      common_envelope: expectedTerms.common_envelope, authoritative_references: refs }
    const commonHash = await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')", [JSON.stringify(commonInput)])
    eq(r.common_envelope_hash, commonHash, 'independent domain-separated projection reproduces common hash, not just same helper twice')
    eq(r.deployment_configuration_hash, await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')", [JSON.stringify({
      domain: 'BX1_DEPLOYMENT_CONFIGURATION_V3_1', product_id: p.id, common_envelope_hash: commonHash,
      deployment_configuration: expectedTerms.deployment_configuration })]), 'configuration hash independently binds full configuration plus common hash')
    eq(p.offering_package.common_envelope, expectedTerms.common_envelope, 'review projection uses immutable common summary')
    eq(p.offering_package.deployment_configuration, expectedTerms.deployment_configuration, 'review projection uses immutable configuration summary')
    for (const column of newReviewFields) eq(p.offering_package[column], r[column], 'review fingerprint comes from exact immutable package')
    eq([r.issuer_declaration_reference, r.issuer_declaration_revision], [expectedTerms.common_envelope.issuer.issuer_reference, expectedTerms.common_envelope.issuer.declaration_revision], 'revision binds exact product-local issuer declaration')
  }
  const reviewBody = (p, kind, decision = 'APPROVED') => ({ product_id: p.id, expected_revision: p.revision,
    offering_revision_id: p.offering_package.id, terms_hash: p.offering_package.terms_hash,
    common_envelope_hash: p.offering_package.common_envelope_hash, deployment_configuration_hash: p.offering_package.deployment_configuration_hash,
    decision, notes: 'Fictional exact immutable common configuration reviewed; no legal, signing, custody or deployment admission.',
    checks: kind === 'ISSUER' ? { issuer_authority: true, terms: true, rights: true } : { issuer: true, terms: true, disclosures: true, eligibility: true } })
  const approve = async p => {
    p = await positive(3, issuer, 'review_offering_issuer', reviewBody(p, 'ISSUER'), p.id)
    p = await positive(2, reviewer, 'review_product', reviewBody(p, 'COMPLIANCE'), p.id)
    eq([p.status, p.published_at], ['APPROVED', null], 'both independent reviews approve, never publish or open')
    await snapshotData(p, p.terms)
    return p
  }
  const inherited = (before, after, tableSpecs, installation = false) => {
    const additions = {}
    for (const table of tableSpecs) {
      const name = `${table.nspname}.${table.relname}`, columns = addedColumns[name] ?? []
      const old = before[name], current = after[name]
      truth(Array.isArray(current), 'inherited relation remains present')
      const matches = (left, right) => table.primary_key.length
        ? table.primary_key.every(field => isDeepStrictEqual(left[field], right[field])) : isDeepStrictEqual(left, right)
      for (const row of old) {
        const found = current.filter(value => matches(row, value))
        eq(found.length, 1, 'each exact inherited primary identity remains once')
        const projection = Object.fromEntries(Object.keys(row).map(field => [field, found[0][field]]))
        eq(projection, row, 'every inherited original field remains exact, including full terms, orders and hashes')
        for (const column of columns) if (!Object.hasOwn(row, column)) eq(found[0][column], null, 'only admitted new columns are NULL on old v1/v2 rows')
        eq(Object.keys(found[0]).sort(), [...new Set([...Object.keys(row), ...columns])].sort(), 'no hidden row-shape alteration')
      }
      additions[name] = current.filter(value => !old.some(row => matches(row, value)))
      if (installation) eq(additions[name], [], 'installation creates no inherited business row')
    }
    return additions
  }
  const auditFailure = async (n, context, action, body) => {
    const before = await state()
    await isolated(async () => {
      await db.query(`create function bx1_portal.ce_fixture_audit_failure() returns trigger language plpgsql as $$
        begin if new.actor_id='${actor(n)}'::uuid and new.kind='${action}' then
          raise exception 'fictional CE mandatory audit failure' using errcode='23514'; end if; return new; end $$;
        create trigger ce_fixture_audit_failure before insert on bx1_portal.events for each row execute function bx1_portal.ce_fixture_audit_failure()`)
      await denied('mandatory audit failure rolls back every CE state/receipt/snapshot', () => command(n, context, action, body), '23514')
      eq(await state(), before, 'audit failure has no business/declaration/request/decision effect')
    })
  }
  const appoint = async (p, targetRole, n) => {
    const body = { product_id: p.id, role: targetRole, appointee_user_id: actor(n), native_membership_id: actor(400 + n),
      expected_product_revision: p.revision, evidence_reference: `FICTIONAL-CE-${targetRole}-APPOINTMENT`, requested_until: new Date(Date.now() + 14 * 86400000).toISOString() }
    let snapshot = await intent(1, manager, 'request_product_service_appointment', body)
    let a = snapshot.product_appointments.find(value => value.product_id === p.id && value.role === targetRole)
    truth(a, 'current canonical appointment request returns exact role/product'); appointments.add(a.id)
    eq(a.status, 'SUBMITTED', 'request grants no appointment')
    snapshot = await intent(4, reviewer, 'review_product_service_appointment', { appointment_id: a.id, expected_revision: a.revision,
      decision: 'APPROVED', notes: 'Fictional independently staffed appointment review; no human independence or legal authority claim.',
      checks: { appointment: true, evidence: true, scope: true } })
    a = snapshot.product_appointments.find(value => value.id === a.id)
    eq(a.status, 'APPROVED', 'review does not automatically apply appointment')
    snapshot = await intent(5, applier, 'apply_product_service_appointment', { appointment_id: a.id, expected_revision: a.revision })
    a = snapshot.product_appointments.find(value => value.id === a.id)
    eq([a.status, a.effective], ['APPLIED', true], 'distinct canonical applier activates only the exact existing native membership')
    return a
  }
  const exactReplay = async (n, context, action, body, requestKey, p) => {
    const before = await state()
    const returned = findProduct(await command(n, context, action, body, requestKey), p.id)
    eq(returned.id, p.id, 'historical exact retry returns fresh scoped view of same product')
    eq(await state(), before, 'exact retry adds no decision/snapshot/revision/event/request')
    await denied('changed new hash with same key conflicts before legacy input could collide',
      () => command(n, context, action, { ...body, common_envelope_hash: '0'.repeat(64) }, requestKey), '23505')
  }
  const revokedReplay = async (n, context, action, body, requestKey, appointment) => {
    const before = await state()
    for (const mutation of [
      () => db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1", [actor(100 + n)]),
      () => db.query("update public.bx1_memberships set status='SUSPENDED' where id=$1", [actor(400 + n)]),
      () => db.query("update public.bx1_profiles set status='SUSPENDED' where id=$1", [actor(n)]),
      () => db.query("update bx1_portal.product_service_appointments set status='REVOKED',revision=revision+1,revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Fictional replay revocation boundary only.' where id=$1", [appointment.id, actor(5)]),
      () => db.query("with expiry as materialized (select clock_timestamp()-interval '1 day' at) update bx1_portal.applications a set reviewed_at=e.at-interval '30 days',approved_until=e.at from expiry e where a.id=$1", [managerApplication.id]),
      () => db.query("update bx1_portal.representative_mandates set status='REVOKED',revision=revision+1,revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Fictional exact CE source mandate revoked.' where id=$1", [managerMandate.id, actor(2)]),
      () => db.query(`insert into bx1_portal.customer_monitoring_cases(application_id,state,revision,decided_at,decided_by,last_receipt_id)
        values($1,'ON_HOLD',1,clock_timestamp(),$2,$3) on conflict(application_id) do update
        set state='ON_HOLD',revision=bx1_portal.customer_monitoring_cases.revision+1,decided_at=clock_timestamp(),decided_by=$2,last_receipt_id=$3`,
      [managerApplication.id, actor(2), fictional(9450)]),
    ]) await isolated(async () => {
      await mutation()
      await denied('exact historical replay still requires current session/profile/member/appointment/admission/mandate/monitoring', () => command(n, context, action, body, requestKey), '42501')
    })
    for (const [table, trigger, id] of [
      ['product_service_appointments', 'bx1_product_appointment_transition', appointment.id],
      ['representative_mandates', 'bx1_representative_mandate_guard', managerMandate.id],
    ]) await isolated(async () => {
      await db.query(`alter table bx1_portal.${table} disable trigger ${trigger}`)
      await db.query(`update bx1_portal.${table} set requested_until=clock_timestamp()-interval '1 minute' where id=$1`, [id])
      await db.query(`alter table bx1_portal.${table} enable trigger ${trigger}`)
      eq(await security(), installedSecurity, 'passive expiry fixture reenables every guard before the tested public RPC')
      await denied('exact replay denies passive expiry of its appointment or source mandate', () => command(n, context, action, body, requestKey), '42501')
    })
    if (mode === 'STANDARD') await isolated(async () => {
      await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1", [actor(n)])
      await denied('known revoked person blocks historical replay before fresh disclosure', () => command(n, context, action, body, requestKey), '42501')
    })
    else for (const other of n === 2 ? [1, 3] : [1]) await isolated(async () => {
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional CE current replay alias','TRUSTED','fictional:CE-replay-alias-only',$2)", [fictional(9460), fictional(9461)])
      for (const participant of [n, other]) await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:CE-replay-alias-only',$3)", [actor(participant), fictional(9460), fictional(9470 + participant)])
      await denied('known manager/issuer/Compliance alias denies historical disclosure', () => command(n, context, action, body, requestKey), '42501')
    })
    eq(await state(), before, 'every current-authority historical replay negative restores exact complete baseline')
  }
  const checkReviews = async p => {
    await admin()
    const rows = (await db.query('select to_jsonb(d) value from bx1_portal.offering_decisions d where offering_revision_id=$1 order by decision_kind', [p.offering_package.id])).rows.map(row => row.value)
    eq(rows.length, 2, 'exact revision receives only issuer and independently appointed Compliance decisions')
    for (const d of rows) {
      eq(d.terms_hash, p.offering_package.terms_hash, 'decision binds full immutable terms hash')
      for (const column of newReviewFields) eq(d[column], p.offering_package[column], 'decision binding is server immutable revision hash')
    }
  }
  const pendingNegatives = async p => {
    const before = await state()
    for (const [n, context, action, kind] of [[3, issuer, 'review_offering_issuer', 'ISSUER'], [2, reviewer, 'review_product', 'COMPLIANCE']]) {
      const body = reviewBody(p, kind)
      for (const field of newReviewFields) {
        await denied('v3 decision rejects wrong immutable binding', () => command(n, context, action, { ...body, [field]: '0'.repeat(64) }), '23514')
        const missing = clone(body); delete missing[field]
        await denied('v3 decision rejects one missing binding', () => command(n, context, action, missing), ['22023', '23514'])
      }
      const legacy = Object.fromEntries(reviewFields.map(field => [field, body[field]]))
      await denied('v3 decision rejects seven-field legacy shape', () => command(n, context, action, legacy), ['22023', '23514'])
      await denied('stale expected revision rejects before decision', () => command(n, context, action, { ...body, expected_revision: p.revision + 1 }), '23514')
      await denied('stale full original terms hash rejects', () => command(n, context, action, { ...body, terms_hash: '0'.repeat(64) }), '23514')
      await denied('unknown decision field rejects', () => command(n, context, action, { ...body, signing_authority: true }), ['22023', '23514'])
      await denied('wrong product scope cannot decide another immutable package', () => command(n, context, action, { ...body, product_id: fictional(99990) }), '42501')
    }
    await denied('manager cannot decide own issuer package', () => command(1, issuer, 'review_offering_issuer', reviewBody(p, 'ISSUER')))
    await denied('foreign Compliance native scope cannot decide package', () => command(6, role('ComplianceOfficer', actor(950)), 'review_product', reviewBody(p, 'COMPLIANCE')))
    if (mode === 'STANDARD') {
      await denied('old private STANDARD v3 Compliance path is not a second full-input writer', async () => {
        await claims(2); await admin()
        return scalar('select bx1_portal.execute_scoped_pre_monitoring($1::jsonb,$2,$3::uuid,$4::jsonb)',
          [JSON.stringify(reviewer), 'review_product', key(), JSON.stringify(reviewBody(p, 'COMPLIANCE'))])
      }, '42501')
      await isolated(async () => {
        await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1", [actor(3)])
        await denied('known revoked STANDARD issuer cannot decide', () => command(3, issuer, 'review_offering_issuer', reviewBody(p, 'ISSUER')))
      })
    } else await isolated(async () => {
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional CE alias negative','TRUSTED','fictional:CE-alias-only',$2)", [fictional(9300), fictional(9301)])
      for (const n of [1, 3]) await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:CE-alias-only',$3)", [actor(n), fictional(9300), fictional(9310 + n)])
      await denied('known manager/issuer alias denies independent decision', () => command(3, issuer, 'review_offering_issuer', reviewBody(p, 'ISSUER')))
    })
    await isolated(async () => {
      const changed = clone(p.terms); changed.summary += ' Structurally valid but not the locked full source.'
      await claims(1); await admin()
      await denied('privileged v3 submission cannot substitute different full source terms', () => db.query(`insert into bx1_portal.offering_revisions
        (product_id,package_number,origin,product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)
        select $1,1+(select max(package_number) from bx1_portal.offering_revisions where product_id=$1),'SUBMITTED',$2,
          $3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),bx1_portal.offering_document_hashes($3::jsonb),$4,clock_timestamp()`,
      [p.id, p.revision, JSON.stringify(changed), actor(1)]), '23514')
      await denied('privileged revision cannot supply wrong new hashes', () => db.query(`insert into bx1_portal.offering_revisions
        (product_id,package_number,origin,product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at,common_envelope_hash,deployment_configuration_hash)
        select $1,1+(select max(package_number) from bx1_portal.offering_revisions where product_id=$1),'SUBMITTED',$2,
          $3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),bx1_portal.offering_document_hashes($3::jsonb),$4,clock_timestamp(),$5,$5`,
      [p.id, p.revision, JSON.stringify(p.terms), actor(1), '0'.repeat(64)]), '23514')
      for (const [column, supplied] of [['issuer_declaration_reference', fictional(99994)], ['issuer_declaration_revision', 2]])
        await denied('privileged current revision rejects supplied wrong issuer declaration binding', () => db.query(`insert into bx1_portal.offering_revisions
          (product_id,package_number,origin,product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at,${column})
          select $1,1+(select max(package_number) from bx1_portal.offering_revisions where product_id=$1),'SUBMITTED',$2,
            $3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),bx1_portal.offering_document_hashes($3::jsonb),$4,clock_timestamp(),$5`,
        [p.id, p.revision, JSON.stringify(p.terms), actor(1), supplied]), '23514', 'common_envelope_revision_binding')
      await denied('v3 cannot masquerade as legacy revision', () => db.query(`insert into bx1_portal.offering_revisions
        (product_id,package_number,origin,product_revision_at_submission,terms,terms_hash,document_hashes,submitted_at)
        select $1,1+(select max(package_number) from bx1_portal.offering_revisions where product_id=$1),'LEGACY_PRODUCT_SNAPSHOT',$2,
          $3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),bx1_portal.offering_document_hashes($3::jsonb),clock_timestamp()`,
      [p.id, p.revision, JSON.stringify(p.terms)]), '23514')
      await claims(3); await admin()
      await denied('privileged decision cannot borrow supplied configuration hash', () => db.query(`insert into bx1_portal.offering_decisions
        (offering_revision_id,decision_kind,decision,actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks,common_envelope_hash,deployment_configuration_hash)
        values($1,'ISSUER','APPROVED',$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$9)`, [p.offering_package.id, actor(3), JSON.stringify(issuer),
        p.offering_package.terms_hash, JSON.stringify(p.offering_package.document_hashes), p.revision,
        'Fictional invalid supplied immutable decision binding only.', JSON.stringify({ issuer_authority: true, terms: true, rights: true }), '0'.repeat(64)]), '23514')
    })
    eq(await state(), before, 'all pending hash/provenance/authority negatives preserve complete state')
  }
  const loop = async (asset, base, ordinal) => {
    const expected = termsV3(base, organisation, ordinal, `Fictional ${mode} CE ${asset}`)
    const start = inputs.length
    const create = { organisation_id: organisation, terms: expected }, createKey = key()
    await auditFailure(1, manager, 'create_product', create)
    let snapshot = await intent(1, manager, 'create_product', create, createKey)
    let p = findProduct(snapshot, inputs.at(-1).subject_id); products.add(p.id)
    eq(p.status, 'DRAFT', 'full v3 creates only a draft')
    await snapshotData(p, expected)
    const afterCreate = await state()
    eq(findProduct(await command(1, manager, 'create_product', create, createKey), p.id).id, p.id, 'create retry keeps canonical product identity')
    eq(await state(), afterCreate, 'create retry has one issuer snapshot and audit effect')
    const commonConflict = clone(create)
    commonConflict.terms.common_envelope.register.correction_policy += ' Conflicting original-key common policy.'
    await denied('create key cannot substitute changed common policy', () => command(1, manager, 'create_product', commonConflict, createKey), '23505')
    const configurationConflict = clone(create)
    configurationConflict.terms.deployment_configuration.signing.key_recovery_policy += ' Conflicting original-key configuration policy.'
    await denied('create key cannot substitute configuration-only policy change', () => command(1, manager, 'create_product', configurationConflict, createKey), '23505')
    const saved = clone(expected); saved.summary += ' Deliberately saved original full v3 values.'
    const save = { product_id: p.id, expected_revision: p.revision, terms: saved }, saveKey = key()
    await auditFailure(1, manager, 'save_product', save)
    p = await positive(1, manager, 'save_product', save, p.id, saveKey)
    await snapshotData(p, saved)
    const afterSave = await state(); await command(1, manager, 'save_product', save, saveKey)
    eq(await state(), afterSave, 'save retry retains one declaration/receipt effect')
    const issuerAppointment = await appoint(p, 'IssuerFundManager', 3), complianceAppointment = await appoint(p, 'ComplianceOfficer', 2)
    p = findProduct(await read(1, manager), p.id)
    const submit = { product_id: p.id, expected_revision: p.revision }
    await auditFailure(1, manager, 'submit_product', submit)
    p = await positive(1, manager, 'submit_product', submit, p.id)
    await snapshotData(p, saved)
    const firstRevision = p.offering_package.id
    await auditFailure(3, issuer, 'review_offering_issuer', reviewBody(p, 'ISSUER', 'CHANGES_REQUIRED'))
    p = await positive(3, issuer, 'review_offering_issuer', reviewBody(p, 'ISSUER', 'CHANGES_REQUIRED'), p.id)
    eq(p.status, 'CHANGES_REQUIRED', 'appointed issuer correction reaches canonical manager editor')
    const corrected = clone(saved); corrected.common_envelope.servicing.reporting_policy += ' This corrected common proposal needs fresh review.'
    p = await positive(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: corrected }, p.id)
    p = await positive(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }, p.id)
    truth(p.offering_package.id !== firstRevision, 'correction creates a fresh immutable revision')
    eq([p.offering_package.issuer_status, p.offering_package.compliance_status], ['PENDING', 'PENDING'], 'corrected package borrows no decision')
    await snapshotData(p, corrected)
    await pendingNegatives(p)
    const issuerInput = reviewBody(p, 'ISSUER'), issuerKey = key()
    await auditFailure(3, issuer, 'review_offering_issuer', issuerInput)
    p = await positive(3, issuer, 'review_offering_issuer', issuerInput, p.id, issuerKey)
    const complianceInput = reviewBody(p, 'COMPLIANCE'), complianceKey = key()
    await auditFailure(2, reviewer, 'review_product', complianceInput)
    p = await positive(2, reviewer, 'review_product', complianceInput, p.id, complianceKey)
    await checkReviews(p); await exactReplay(3, issuer, 'review_offering_issuer', issuerInput, issuerKey, p)
    await exactReplay(2, reviewer, 'review_product', complianceInput, complianceKey, p)
    await revokedReplay(3, issuer, 'review_offering_issuer', issuerInput, issuerKey, issuerAppointment)
    await revokedReplay(2, reviewer, 'review_product', complianceInput, complianceKey, complianceAppointment)
    eq(p.status, 'APPROVED', 'full initial pair approves exact v3 common configuration')
    for (const change of ['COMMON_ONLY', 'CONFIGURATION_ONLY']) {
      const old = clone(p), previousRows = await scalarAfterOwner('select to_jsonb(r) from bx1_portal.offering_revisions r where id=$1', [p.offering_package.id])
      p = await positive(1, manager, 'begin_offering_amendment', { product_id: p.id, expected_revision: p.revision,
        reason: 'Fictional governed common configuration amendment; prior decisions and orders remain historical.' }, p.id)
      eq([p.status, p.offering_package], ['CHANGES_REQUIRED', null], 'amendment detaches current review without deleting history')
      const next = clone(old.terms)
      if (change === 'COMMON_ONLY') next.common_envelope.servicing.termination_policy += ' Reviewed amendment changes only the common proposal.'
      else next.deployment_configuration.signing.key_recovery_policy += ' Reviewed amendment changes only the proposed recovery configuration.'
      p = await positive(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: next }, p.id)
      p = await positive(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }, p.id)
      truth(p.offering_package.id !== old.offering_package.id, 'common/configuration-only correction creates fresh revision')
      eq([p.offering_package.issuer_status, p.offering_package.compliance_status], ['PENDING', 'PENDING'], 'both approvals are invalidated')
      eq(p.offering_package.document_hashes, old.offering_package.document_hashes, 'original disclosure text digests are not relabelled actual PDFs')
      if (change === 'COMMON_ONLY') {
        truth(p.offering_package.common_envelope_hash !== old.offering_package.common_envelope_hash, 'common-only change alters common binding')
        truth(p.offering_package.deployment_configuration_hash !== old.offering_package.deployment_configuration_hash, 'configuration binding incorporates changed common binding')
      } else {
        eq(p.offering_package.common_envelope_hash, old.offering_package.common_envelope_hash, 'configuration-only change preserves common binding')
        truth(p.offering_package.deployment_configuration_hash !== old.offering_package.deployment_configuration_hash, 'configuration-only change alters configuration binding')
      }
      await snapshotData(p, next); p = await approve(p); await checkReviews(p)
      eq(await scalarAfterOwner('select to_jsonb(r) from bx1_portal.offering_revisions r where id=$1', [old.offering_package.id]), previousRows, 'historical full revision remains exact')
      await exactReplay(3, issuer, 'review_offering_issuer', issuerInput, issuerKey, p)
      await exactReplay(2, reviewer, 'review_product', complianceInput, complianceKey, p)
    }
    const beforeReopen = clone(p)
    p = await positive(1, manager, 'reopen_offering_review', { product_id: p.id, expected_revision: p.revision,
      reason: 'Fictional same full immutable configuration reopened for a fresh independent review pair.' }, p.id)
    truth(p.offering_package.id !== beforeReopen.offering_package.id, 'same-hash reopen creates fresh package')
    eq([p.terms_hash, p.offering_package.common_envelope_hash, p.offering_package.deployment_configuration_hash],
      [beforeReopen.terms_hash, beforeReopen.offering_package.common_envelope_hash, beforeReopen.offering_package.deployment_configuration_hash], 'same full terms reopen preserves all three terms/configuration bindings')
    eq([p.offering_package.issuer_status, p.offering_package.compliance_status], ['PENDING', 'PENDING'], 'same-hash reopen requires fresh issuer and Compliance decisions')
    p = await approve(p); await checkReviews(p)
    await admin()
    eq(await scalar('select bx1_portal.offering_technical_ready($1)', [p.offering_package.id]), false, 'technical readiness remains sealed')
    eq(await scalar("select count(*)::int from bx1_portal.product_issuer_declarations where product_id=$1", [p.id]), 1, 'unchanged issuer has one immutable declaration across workflow revisions')
    eq(p.terms.unit_price_minor, asset === 'FUND' ? '10000000' : '100000000', 'original six-decimal exact asset price is retained')
    eq(p.terms.cap_units, asset === 'FUND' ? '100' : '20', 'original whole-unit asset capacity is retained')
    eq((BigInt(p.terms.unit_price_minor) * BigInt(p.terms.cap_units)).toString(), asset === 'FUND' ? '1000000000' : '2000000000', 'exact TST cap is integer minor units, never floating point')
    await isolated(async () => {
      const definition = await scalar("select pg_get_functiondef('bx1_portal.offering_technical_ready(uuid)'::regprocedure)")
      eq(definition.split('select false;').length - 1, 1, 'synthetic readiness probe replaces only exact false literal')
      await db.query(definition.replace('select false;', 'select true;'))
      await denied('canonical publication remains outside v3 even under synthetic readiness', () => command(1, manager, 'publish_product', { product_id: p.id, expected_revision: p.revision }), mode === 'STANDARD' ? '23514' : '42501')
      await claims(1); await admin()
      await denied('privileged product publication remains sealed', () => db.query("update bx1_portal.products set status='PUBLISHED',published_at=clock_timestamp() where id=$1", [p.id]), '23514',
        asset === 'FUND' ? 'fund_v2_settlement_route_not_admitted' : 'property_v2_settlement_route_not_admitted')
      const investorAccount = originalRows['bx1_portal.investment_accounts'].find(account => account.holder_user_id === actor(7))
      truth(investorAccount, 'public refusal reuses exact retained actor-seven account without adding financial authority')
      await denied('canonical v3 subscription is refused under retained closed admission, not positive financial authority', () => command(7, role('Investor'), 'subscribe', {
        product_id: p.id, offering_revision_id: p.offering_package.id, investment_account_id: investorAccount.id,
        expected_revision: p.revision, terms_hash: p.terms_hash, units: '1', accepted_documents: true, accepted_risks: true,
      }), mode === 'STANDARD' ? ['42501', '23514'] : '42501')
      await claims(1); await admin()
      await denied('shared direct subscription guard covers v3 for both assets', () => db.query(`insert into bx1_portal.subscriptions
        (product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor,offering_revision_id)
        values($1,$2,$3,$4,$5,$6::jsonb,true,true,1,$7,$8)`, [p.id, actor(7), organisation, p.revision,
        p.terms_hash, JSON.stringify(p.terms), p.terms.unit_price_minor, p.offering_package.id]), '23514', 'fund_v2_settlement_route_not_admitted')
    })
    const record = { asset, p: clone(p), terms: clone(p.terms), issuerAppointment, complianceAppointment,
      issuerInput: clone(issuerInput), issuerKey, complianceInput: clone(complianceInput), complianceKey }
    records.push(record)
    console.log('BX1_COMMON_ENVELOPE_TEMPLATE_RECEIPT', JSON.stringify({ asset, mode, commands: inputs.length - start,
      outcome: 'APPROVED_UNPUBLISHED_UNOPENED', changes_required: true, common_amendment: true, configuration_amendment: true,
      same_hash_reopen: true, actual_files: false, provider_signature: false }))
    return record
  }
  const scalarAfterOwner = async (sql, values = []) => { await admin(); return scalar(sql, values) }
  const settings = async () => ({ ...await scalarAfterOwner(`select jsonb_build_object('jit',current_setting('jit'),
    'statement_timeout',current_setting('statement_timeout'),'lock_timeout',current_setting('lock_timeout'),
    'join_collapse_limit',current_setting('join_collapse_limit'),'from_collapse_limit',current_setting('from_collapse_limit'),
    'jit_above_cost',current_setting('jit_above_cost'),'jit_inline_above_cost',current_setting('jit_inline_above_cost'),
    'jit_optimize_above_cost',current_setting('jit_optimize_above_cost'),'geqo_threshold',current_setting('geqo_threshold'))`),
    client_query_timeout: db.connectionParameters.query_timeout, client_statement_timeout: db.connectionParameters.statement_timeout })
  const standardSetup = async () => {
    await begin(); standardPrior = await state()
    for (const n of [1, 2, 3, 4, 5]) {
      eq(standardPrior['bx1_private.person_principals'].filter(row => row.auth_user_id === actor(n)), [], 'no prior principal is overwritten by committed STANDARD fixture')
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:CE-committed-waits-only',$3)", [fictional(9000 + n), `Fictional CE waited STANDARD person ${n}`, fictional(9050 + n)])
      await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:CE-committed-waits-only',$3)", [actor(n), fictional(9000 + n), fictional(9070 + n)])
    }
    eq(standardPrior['auth.mfa_factors'].filter(row => row.id === actor(201)), [], 'only missing own factor201 may be inserted')
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [actor(201), actor(1)])
    for (const n of [1, 2, 3, 4, 5]) {
      eq(await scalar("select exists(select 1 from auth.mfa_factors where id=$1 and user_id=$2 and status::text='verified')", [actor(200 + n), actor(n)]), true, 'committed wait native assurance uses exact own verified fictional factor')
      await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2 and user_id=$3", [actor(200 + n), actor(100 + n), actor(n)])
    }
    standardFixture = await state()
    for (const name of Object.keys(standardPrior)) if (!['bx1_private.persons', 'bx1_private.person_principals', 'auth.mfa_factors', 'auth.sessions'].includes(name))
      eq(standardFixture[name], standardPrior[name], 'committed assurance fixture alters no other table')
    const ownPersons = standardFixture['bx1_private.persons'].filter(row => [1, 2, 3, 4, 5].some(n => row.id === fictional(9000 + n)))
    eq(ownPersons.length, 5, 'exact five fictional person rows, no new user or role')
    for (const n of [1, 2, 3, 4, 5]) {
      const principal = standardFixture['bx1_private.person_principals'].find(row => row.auth_user_id === actor(n))
      eq([principal.person_id, principal.status, principal.evidence_reference, principal.bootstrap_receipt_id],
        [fictional(9000 + n), 'TRUSTED', 'fictional:CE-committed-waits-only', fictional(9070 + n)], 'exact committed fictional principal tuple')
      eq(standardFixture['auth.sessions'].find(row => row.id === actor(100 + n)),
        { ...standardPrior['auth.sessions'].find(row => row.id === actor(100 + n)), aal: 'aal2', factor_id: actor(200 + n) }, 'only exact stored assurance/factor fields change')
    }
    const withoutFixtures = clone(standardFixture)
    withoutFixtures['bx1_private.persons'] = withoutFixtures['bx1_private.persons'].filter(row => !ownPersons.some(own => own.id === row.id))
    withoutFixtures['bx1_private.person_principals'] = withoutFixtures['bx1_private.person_principals'].filter(row => ![1, 2, 3, 4, 5].some(n => row.auth_user_id === actor(n)))
    withoutFixtures['auth.mfa_factors'] = withoutFixtures['auth.mfa_factors'].filter(row => row.id !== actor(201))
    withoutFixtures['auth.sessions'] = clone(standardPrior['auth.sessions'])
    eq(withoutFixtures, standardPrior, 'committed prerequisites have an exact finite footprint')
    await commit(); standardCommitted = true; mode = 'STANDARD'
    await begin(); await claims(1); await admin()
    eq(await scalar('select bx1_private.has_token_mfa()'), true, 'real waited STANDARD token and native own-factor path is admitted')
    eq(await scalar('select bx1_portal.offering_workflow_context($1::jsonb)', [JSON.stringify(manager)]), false, 'waited STANDARD never uses password exception')
    await commit()
  }
  const standardCleanup = async () => {
    if (!standardCommitted) return
    if (begun) { await db.query('rollback'); begun = false }
    await begin()
    let cleanupFailure
    try {
      const current = await state()
      for (const name of ['bx1_private.persons', 'bx1_private.person_principals', 'auth.mfa_factors', 'auth.sessions'])
        eq(current[name], standardFixture[name], 'waits preserve every exact committed assurance fixture and inherited native row before cleanup')
      // Owner-only deletion of the ten precisely captured fictional identity rows.
      // No RPC runs while either immutable guard is suspended. Transaction failure
      // rolls back both deletion and trigger state; the whole catalog is checked.
      await db.query('alter table bx1_private.person_principals disable trigger bx1_person_principals_immutable')
      await db.query('alter table bx1_private.persons disable trigger bx1_persons_immutable')
      const removedPrincipals = await db.query('delete from bx1_private.person_principals where auth_user_id=any($1::uuid[]) and person_id=any($2::uuid[]) returning auth_user_id', [[1, 2, 3, 4, 5].map(actor), [1, 2, 3, 4, 5].map(n => fictional(9000 + n))])
      eq(removedPrincipals.rowCount, 5, 'only exact newly inserted principal rows are removed')
      const removedPersons = await db.query('delete from bx1_private.persons where id=any($1::uuid[]) returning id', [[1, 2, 3, 4, 5].map(n => fictional(9000 + n))])
      eq(removedPersons.rowCount, 5, 'only exact newly inserted fictional people are removed')
      await db.query('alter table bx1_private.person_principals enable trigger bx1_person_principals_immutable')
      await db.query('alter table bx1_private.persons enable trigger bx1_persons_immutable')
      for (const n of [1, 2, 3, 4, 5]) {
        const old = standardPrior['auth.sessions'].find(row => row.id === actor(100 + n))
        await db.query('update auth.sessions set aal=$1,factor_id=$2 where id=$3 and user_id=$4', [old.aal, old.factor_id, old.id, old.user_id])
      }
      eq((await db.query('delete from auth.mfa_factors where id=$1 and user_id=$2 returning id', [actor(201), actor(1)])).rowCount, 1, 'only temporary own factor201 is removed')
      const after = await state()
      for (const name of ['bx1_private.persons', 'bx1_private.person_principals', 'auth.mfa_factors', 'auth.sessions']) eq(after[name], standardPrior[name], 'exact full native/identity/factor baseline restored')
      eq(await security(), installedSecurity, 'exact trigger and security restoration before cleanup commit')
      await commit(); standardCommitted = false
    } catch (error) { cleanupFailure = error; throw error }
    finally {
      if (begun) { await db.query('rollback'); begun = false }
      await admin()
      // Unconditional: a failed cleanup cannot hide disabled immutable guards.
      try { eq(await security(), installedSecurity, 'unconditional exact catalog/guard restoration on cleanup success or failure') }
      catch (error) { if (!cleanupFailure) throw error; console.error('BX1_PRODUCT_COMMON_ENVELOPE_CLEANUP_FAILED code=GUARD_RESTORATION'); throw cleanupFailure }
    }
    eq(await settings(), settingsBefore, 'all original engine/deadline settings remain exactly captured')
    mode = 'TEST_PASSWORD'
    console.log('BX1_COMMON_ENVELOPE_STANDARD_FIXTURE_RECEIPT', JSON.stringify({ fictional_persons: 5, temporary_own_factor: 1,
      native_sessions: 5, restored: true, cleanup: 'EXACT_CAPTURED_IDENTITY_ROWS_AND_GUARDS', actual_mfa_challenge: false, independent_humans: false }))
  }
  const waitForProduct = async (waiter, blocker, productId) => {
    truth(waiter !== blocker, 'actual wait uses independent backend PIDs')
    const until = Date.now() + 10000
    while (Date.now() < until) {
      if (await scalar(`select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'
        and $2=any(pg_blocking_pids(pid)))`, [waiter, blocker], clients[1])) {
        eq(await scalar('select exists(select 1 from pg_locks where pid=$1 and relation=\'bx1_portal.products\'::regclass and granted)', [blocker], clients[1]), true, 'blocker actually holds the product relation lock')
        truth(products.has(productId), 'wait targets exact CE product'); checks++; return
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('CE proof did not observe product-first independent-backend wait')
  }
  const races = async lane => {
    mode = lane
    const pids = await Promise.all([db, ...clients].map(client => scalar('select pg_backend_pid()', [], client)))
    eq(new Set(pids).size, 3, 'actual three distinct CE proof connections')
    for (const kind of ['ISSUER', 'COMPLIANCE']) for (const outcome of ['STALE_FRESH', 'REVOKED_AUTHORITY', 'HISTORICAL_REPLAY', 'REVOKED_HISTORICAL_REPLAY']) {
      const item = records[(kind === 'ISSUER' ? 0 : 1)], n = kind === 'ISSUER' ? 3 : 2, context = kind === 'ISSUER' ? issuer : reviewer
      const action = kind === 'ISSUER' ? 'review_offering_issuer' : 'review_product'
      const historicalInput = outcome === 'HISTORICAL_REPLAY' || outcome === 'REVOKED_HISTORICAL_REPLAY'
      let p = item.p
      await begin()
      if (!historicalInput) {
        p = await positive(1, manager, 'reopen_offering_review', { product_id: p.id, expected_revision: p.revision,
          reason: 'Fictional pending revision for an observed current-authority CE decision race.' }, p.id)
        item.p = p
      }
      await commit()
      const body = historicalInput ? clone(kind === 'ISSUER' ? item.issuerInput : item.complianceInput) : reviewBody(p, kind)
      const requestKey = historicalInput ? (kind === 'ISSUER' ? item.issuerKey : item.complianceKey) : key()
      const before = await state()
      await begin()
      eq((await db.query('select id from bx1_portal.products where id=$1 for update', [p.id])).rows, [{ id: p.id }], 'blocker locks exactly the existing intended CE product row')
      // The public call is started only after the exact product lock exists.
      const waiting = (async () => {
        await clients[0].query('begin')
        try {
          const result = await command(n, context, action, body, requestKey, clients[0])
          const observedRows = await state(installedSpecs, clients[0])
          await clients[0].query('rollback')
          return { result, observedRows }
        } catch (error) {
          await clients[0].query('rollback')
          if (!error?.code) throw error
          return { code: error.code }
        } finally { await admin(clients[0]) }
      })()
      let completed, expectedAfter
      try {
        await waitForProduct(pids[1], pids[0], p.id)
        if (outcome === 'STALE_FRESH') await db.query('update bx1_portal.products set revision=revision+1 where id=$1', [p.id])
        if (outcome === 'REVOKED_AUTHORITY' || outcome === 'REVOKED_HISTORICAL_REPLAY') {
          const a = kind === 'ISSUER' ? item.issuerAppointment : item.complianceAppointment
          await db.query("update bx1_portal.product_service_appointments set status='REVOKED',revision=revision+1,revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Fictional waited CE authority revocation only.' where id=$1", [a.id, actor(5)])
        }
        if (outcome === 'HISTORICAL_REPLAY') {
          p = await positive(1, manager, 'begin_offering_amendment', { product_id: p.id, expected_revision: p.revision,
            reason: 'Fictional authorised revision-only amendment while exact historical replay waits.' }, p.id)
          const changed = clone(item.p.terms); changed.deployment_configuration.governance.controller_replacement_policy += ` Fictional ${lane} ${kind} waited amendment.`
          p = await positive(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: changed }, p.id)
          p = await positive(1, manager, 'submit_product', { product_id: p.id, expected_revision: p.revision }, p.id)
          await snapshotData(p, changed); item.p = p
        }
        await commit(); expectedAfter = await state(); completed = await waiting
        if (outcome === 'HISTORICAL_REPLAY') {
          truth(completed.result, 'current-authority exact historical replay returns after authorised amendment')
          const returned = findProduct(completed.result, p.id)
          eq(returned.offering_package.id, p.offering_package.id, 'historical retry returns fresh current scoped package, not cached old package')
          eq(completed.observedRows, expectedAfter, 'inside successful replay transaction, no hidden decision/request/snapshot/audit effect')
          eq(await state(), expectedAfter, 'historical replay adds no committed second effect')
        } else {
          eq(completed.code, outcome === 'STALE_FRESH' ? '23514' : '42501', 'fresh stale decision and revoked fresh/historical authority retain strict original failure codes')
          if (outcome === 'REVOKED_HISTORICAL_REPLAY') eq(completed.result, undefined, 'revoked exact historical key returns no fresh scoped disclosure')
        }
      } finally {
        if (begun) { await db.query('rollback'); begun = false }
        // Release blocker before joining/cleaning the waiting backend.
        await waiting
        await admin()
      }
      await begin()
      if (outcome === 'STALE_FRESH') await db.query('update bx1_portal.products set revision=$2 where id=$1', [item.p.id, item.p.revision])
      if (outcome === 'REVOKED_AUTHORITY' || outcome === 'REVOKED_HISTORICAL_REPLAY') {
        const a = kind === 'ISSUER' ? item.issuerAppointment : item.complianceAppointment
        const old = before['bx1_portal.product_service_appointments'].find(row => row.id === a.id)
        // Exact CI-only revocation-row restoration, with no RPC while suspended.
        await db.query('alter table bx1_portal.product_service_appointments disable trigger bx1_product_appointment_transition')
        await db.query('update bx1_portal.product_service_appointments set status=$2,revision=$3,revoked_at=$4,revoked_by_user_id=$5,revoke_reason=$6 where id=$1',
          [old.id, old.status, old.revision, old.revoked_at, old.revoked_by_user_id, old.revoke_reason])
        await db.query('alter table bx1_portal.product_service_appointments enable trigger bx1_product_appointment_transition')
      }
      if (outcome !== 'HISTORICAL_REPLAY') {
        eq(await state(), before, 'negative waited call has no durable effect beyond exact restored owner mutation')
        if (!historicalInput) eq(await scalar(`select (select count(*) from bx1_portal.requests where actor_id=$1 and request_key=$2)
          +(select count(*) from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2)`, [actor(n), requestKey]), '0', 'rejected waited command has no request journal')
      }
      if (outcome !== 'REVOKED_HISTORICAL_REPLAY') {
        p = await approve(item.p); item.p = p; item.terms = clone(p.terms)
      }
      await commit()
      eq(await security(), installedSecurity, 'every real-wait cleanup restores all catalog/trigger states')
      console.log('BX1_COMMON_ENVELOPE_WAIT_RECEIPT', JSON.stringify({ lane, asset: item.asset, reviewer_kind: kind, outcome,
        actual_distinct_backends: true, product_first_wait_observed: true, current_after_wait: true,
        sqlstate: outcome === 'HISTORICAL_REPLAY' ? null : outcome === 'STALE_FRESH' ? '23514' : '42501', duplicate_effect: false }))
    }
  }
  try {
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci'"), true, 'only exact disposable database')
    truth(Number(await scalar('show server_version_num')) >= 170000 && Number(await scalar('show server_version_num')) < 180000, 'pinned PostgreSQL17 proof')
    eq(await scalar("select current_setting('statement_timeout')"), '15s', 'original SQL deadline remains unchanged')
    eq(db.connectionParameters.query_timeout, 20000, 'original client deadline remains unchanged')
    for (const client of [db, ...clients]) eq([client.connectionParameters.statement_timeout, client.connectionParameters.query_timeout], [15000, 20000], 'every proof connection retains original SQL/client deadlines')
    settingsBefore = await settings()
    proofStartedAt = await scalar('select clock_timestamp()::text')
    eq(await scalar("select to_regclass('bx1_portal.product_issuer_declarations') is null"), true, 'CE has not been separately installed')
    originalSpecs = await specs(); originalRows = await state(); originalFunctions = await funcs(); originalSecurity = await security()
    managerApplication = await scalar("select to_jsonb(a) from bx1_portal.applications a where user_id=$1 and persona='WEALTH_MANAGER' and status='APPROVED'", [actor(1)])
    truth(managerApplication, 'accepted committed manager admission exists'); organisation = managerApplication.organisation_id
    managerMandate = await scalar("select to_jsonb(m) from bx1_portal.representative_mandates m where application_id=$1 and status='APPLIED'", [managerApplication.id])
    truth(managerMandate, 'accepted applied manager mandate exists'); manager = role('OfferingManager', managerMandate.native_organisation_id)
    truth(manager.organisationId !== organisation, 'fixture has distinct native and portal organisation IDs for exact manager-binding negative')
    const base = {}
    for (const asset of ['FUND', 'REAL_ESTATE']) {
      base[asset] = await scalar("select p.terms from bx1_portal.products p where p.created_by=$1 and p.terms->>'asset_type'=$2 and p.terms->'terms_version'='2'::jsonb and p.status='APPROVED' order by p.id limit 1", [actor(1), asset])
      truth(base[asset], 'accepted committed typed v2 asset fixture exists')
    }
    for (const [field, value] of Object.entries(fundV2LegacyCrossrefs)) eq(base.FUND[field], value, 'retained fund canonical cross-reference input')
    const recipesMatch = featureSql.match(/\$ce_recipes\$([\s\S]*?)\$ce_recipes\$/)
    truth(recipesMatch, 'feature includes one explicit drift recipe block')
    const recipes = JSON.parse(recipesMatch[1])
    eq(recipes.map(r => r.signature).sort(), Object.keys(pins).map(name => `bx1_portal.${name}`).sort(), 'only exact eighteen accepted existing bodies may change')
    const expectedBodies = new Map()
    for (const recipe of recipes) {
      const before = originalFunctions.find(f => f.signature === recipe.signature)
      truth(before, 'each exact renamed target is present')
      const originalBody = normalize(before.catalog.prosrc)
      eq(digest(originalBody), pins[recipe.signature.slice('bx1_portal.'.length)], 'full original source-derived body pin')
      eq(recipe.expected_sha256, digest(originalBody), 'feature pin equals independently specified current body')
      let after = originalBody
      for (const change of recipe.changes) {
        eq(after.split(change.from).length - 1, change.count, 'each original callsite count is exact')
        after = after.split(change.from).join(change.to)
      }
      expectedBodies.set(recipe.signature, normalize(after))
    }
    await begin()
    for (const corrupt of [featureSql.replace(recipes[0].expected_sha256, '0'.repeat(64)), featureSql.replace(/"count"\s*:\s*\d+/, '"count":999')]) {
      await denied('source pin/count drift rejects atomic feature installation', () => db.query(corrupt), ['55000', '23514'])
      eq(await funcs(), originalFunctions, 'failed installation leaves every function exact')
      eq(await state(), originalRows, 'failed installation leaves every original row exact')
      eq(await security(), originalSecurity, 'failed installation leaves security/catalog exact')
    }
    const baselineTarget = originalFunctions.find(f => f.signature === 'bx1_portal.validate_terms(jsonb)')
    const authenticatedExecute = await scalar("select has_function_privilege('authenticated','bx1_portal.validate_terms(jsonb)','EXECUTE')")
    for (const [label, statement, field] of [
      ['OWNER', 'alter function bx1_portal.validate_terms(jsonb) owner to bx1_authority_owner', 'proowner'],
      ['CONFIG', "alter function bx1_portal.validate_terms(jsonb) set search_path='public'", 'proconfig'],
      ['ACL', `${authenticatedExecute ? 'revoke' : 'grant'} execute on function bx1_portal.validate_terms(jsonb) ${authenticatedExecute ? 'from' : 'to'} authenticated`, 'proacl'],
      ['SECURITY', `alter function bx1_portal.validate_terms(jsonb) security ${baselineTarget.catalog.prosecdef ? 'invoker' : 'definer'}`, 'prosecdef'],
      ['VOLATILITY', `alter function bx1_portal.validate_terms(jsonb) ${baselineTarget.catalog.provolatile === 'v' ? 'stable' : 'volatile'}`, 'provolatile'],
      ['STRICTNESS', `alter function bx1_portal.validate_terms(jsonb) ${baselineTarget.catalog.proisstrict ? 'called on null input' : 'returns null on null input'}`, 'proisstrict'],
    ]) {
      await isolated(async () => {
        await db.query(statement)
        const altered = (await funcs()).find(f => f.oid === baselineTarget.oid)
        eq(altered.catalog.prosrc, baselineTarget.catalog.prosrc, 'baseline metadata negative retains exact untouched body')
        truth(!isDeepStrictEqual(altered.catalog[field], baselineTarget.catalog[field]), 'exact selected metadata field actually changes before install')
        await denied(`unchanged-body ${label} drift fails the installer baseline gate`, () => db.query(featureSql), '55000', 'common_envelope_metadata_changed: bx1_portal.validate_terms(jsonb)')
        eq((await funcs()).find(f => f.oid === baselineTarget.oid), altered, 'rejected installer does not silently repair or rewrite drifted function')
        eq(await state(), originalRows, 'metadata rejection creates no inherited row or declaration')
      })
      eq(await funcs(), originalFunctions, 'metadata fixture rollback restores every exact function identity/body/metadata')
      eq(await state(), originalRows, 'metadata fixture rollback restores every original row')
      eq(await security(), originalSecurity, 'metadata fixture rollback restores complete roles/grants/relations/guards')
      console.log('BX1_COMMON_ENVELOPE_INSTALL_DRIFT_RECEIPT', JSON.stringify({ drift: label, body_unchanged: true, sqlstate: '55000', restored: true }))
    }
    await db.query(featureSql)
    installedFunctions = await funcs(); installedSpecs = await specs(); installedSecurity = await security()
    eq(installedFunctions.length, originalFunctions.length + 7, 'exactly seven private function identities added')
    for (const old of originalFunctions) {
      const current = installedFunctions.find(f => f.oid === old.oid)
      truth(current, 'every inherited function identity remains')
      if (expectedBodies.has(old.signature)) {
        eq(normalize(current.catalog.prosrc), expectedBodies.get(old.signature), 'installed prosrc is exact frozen recipe replacement')
        const { prosrc: oldSource, ...oldMetadata } = old.catalog, { prosrc: newSource, ...metadata } = current.catalog
        eq(metadata, oldMetadata, 'all original pg_proc metadata, language, assurance, defaults, ACL and owner remain exact')
        eq(current.signature, old.signature, 'original signature remains exact')
      } else eq(current, old, 'out-of-scope function full definition and metadata remain exact')
    }
    const newFunctions = installedFunctions.filter(f => !originalFunctions.some(old => old.oid === f.oid))
    eq(newFunctions.map(f => f.signature).sort(), Object.keys(helpers).map(name => `bx1_portal.${name}`).sort(), 'no eighth helper/public RPC introduced')
    for (const f of newFunctions) {
      const name = f.signature.slice('bx1_portal.'.length), [result, volatility] = helpers[name]
      eq(f.result, result, 'new helper exact return type'); eq(f.catalog.provolatile, volatility, 'new helper exact volatility')
      eq([f.catalog.prosecdef, f.catalog.proisstrict, f.catalog.proleakproof, f.catalog.proretset, f.catalog.proparallel, f.catalog.procost],
        [false, false, false, false, 'u', 100], 'new helper has only frozen invoker metadata')
      eq(f.catalog.proowner, originalFunctions.find(old => old.signature === 'bx1_portal.validate_terms(jsonb)').catalog.proowner, 'trusted installer owner retained')
      eq(f.catalog.proconfig, ['search_path=""'], 'empty helper search path')
      eq([f.catalog.pronargdefaults, f.catalog.proargdefaults, f.catalog.provariadic], [0, null, 0], 'no new helper default or variadic argument acquires another calling contract')
      const localName = name.slice(0, name.indexOf('('))
      const definition = [...featureSql.matchAll(new RegExp(`create\\s+function\\s+bx1_portal\\.${localName}\\([\\s\\S]*?\\)\\s+returns\\s+${result}\\b[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'gi'))]
      eq(definition.length, 1, 'helper has exactly one authoritative source definition')
      eq(normalize(f.catalog.prosrc), normalize(definition[0][1]), 'installed helper body equals exact reviewed source')
      for (const r of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [r, f.signature]), false, 'untrusted role cannot execute private CE helper')
      eq(await scalar("select count(*)::int from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::oid and a.grantee=0 and a.privilege_type='EXECUTE'", [f.oid]), 0, 'PUBLIC has no implicit helper execution')
      eq(await scalar("select jsonb_agg(to_jsonb(a) order by a.grantee,a.grantor,a.privilege_type) from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::oid", [f.oid]),
        [{ grantor: f.catalog.proowner, grantee: f.catalog.proowner, privilege_type: 'EXECUTE', is_grantable: false }], 'new helper has exact owner-only execute ACL, not merely three selected denials')
    }
    eq(installedSpecs.length, originalSpecs.length + 1, 'only one private declaration table added')
    for (const old of originalSpecs) {
      const current = installedSpecs.find(value => value.oid === old.oid), name = `${old.nspname}.${old.relname}`
      eq(current, { ...old, columns: [...old.columns, ...(addedColumns[name] ?? [])] }, 'only exact admitted nullable columns appended; inherited table identity and primary key unchanged')
    }
    const declaration = installedSpecs.find(value => value.nspname === 'bx1_portal' && value.relname === 'product_issuer_declarations')
    truth(declaration, 'exact private declaration table exists')
    eq(declaration.columns, ['product_id', 'issuer_reference', 'declaration_revision', 'declaration', 'declaration_hash', 'declared_by', 'declared_at'], 'exact frozen declaration columns')
    eq(await scalar(`select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef) order by a.attnum)
      from pg_attribute a where a.attrelid='bx1_portal.product_issuer_declarations'::regclass and a.attnum>0 and not a.attisdropped`),
    [['product_id', 'uuid', true, false], ['issuer_reference', 'uuid', true, false], ['declaration_revision', 'integer', true, false],
      ['declaration', 'jsonb', true, false], ['declaration_hash', 'text', true, false], ['declared_by', 'uuid', true, false],
      ['declared_at', 'timestamp with time zone', true, false]], 'private declaration column type/nullability/default inventory is exact')
    for (const [relation, columns] of Object.entries(addedColumns)) {
      const shape = await scalar(`select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef) order by a.attnum)
        from pg_attribute a where a.attrelid=$1::regclass and a.attname=any($2::text[]) and not a.attisdropped`, [relation, columns])
      eq(shape, columns.map(name => [name, name === 'issuer_declaration_reference' ? 'uuid' : name === 'issuer_declaration_revision' ? 'integer' : 'text', false, false]), 'only admitted nullable no-default bindings are appended')
    }
    for (const r of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_table_privilege($1,\'bx1_portal.product_issuer_declarations\',\'SELECT,INSERT,UPDATE,DELETE\')', [r]), false, 'no direct declaration table privilege')
    eq(await scalar("select relrowsecurity from pg_class where oid='bx1_portal.product_issuer_declarations'::regclass"), true, 'private declaration table has RLS enabled')
    inherited(originalRows, await state(), originalSpecs, true)
    eq((await state())['bx1_portal.product_issuer_declarations'], [], 'install seeds no issuer declaration')
    for (const field of ['roles', 'edges', 'schemas', 'policies', 'defaults']) eq(installedSecurity[field], originalSecurity[field], 'no global grant/role/schema/default/RLS policy change')
    for (const field of ['relations', 'triggers', 'constraints']) {
      const old = originalSecurity[field] ?? [], current = installedSecurity[field] ?? []
      for (const row of old) eq(current.find(value => value.oid === row.oid), row, 'each inherited relation/trigger/constraint remains exact')
      const additions = current.filter(row => !old.some(value => value.oid === row.oid))
      if (field === 'relations') eq(additions.map(row => row.relname), ['product_issuer_declarations'], 'only private declaration relation addition')
      if (field === 'triggers') {
        eq(additions.length, 2, 'only declaration immutability and product metadata trigger added')
        truth(additions.some(row => row.tgrelid === Number(declaration.oid)), 'declaration trigger is confined to exact new table')
        truth(additions.some(row => row.definition.includes('AFTER INSERT OR UPDATE OF terms ON bx1_portal.products')), 'snapshot trigger is metadata-only after canonical product DML')
      }
      if (field === 'constraints') {
        const revisionOid = Number(installedSpecs.find(t => t.relname === 'offering_revisions' && t.nspname === 'bx1_portal').oid)
        const decisionOid = Number(installedSpecs.find(t => t.relname === 'offering_decisions' && t.nspname === 'bx1_portal').oid)
        eq(additions.filter(row => row.conrelid === revisionOid).map(row => row.conname).sort(),
          ['bx1_ce_revision_binding_shape', 'bx1_ce_revision_declaration', 'bx1_ce_revision_hash_identity', 'offering_revisions_common_envelope_hash_check', 'offering_revisions_deployment_configuration_hash_check'].sort(), 'exact five new revision constraints')
        eq(additions.filter(row => row.conrelid === decisionOid).map(row => row.conname).sort(),
          ['bx1_ce_decision_binding_shape', 'bx1_ce_decision_revision_binding', 'offering_decisions_common_envelope_hash_check', 'offering_decisions_deployment_configuration_hash_check'].sort(), 'exact four new decision constraints')
        const declarationConstraints = additions.filter(row => row.conrelid === Number(declaration.oid))
        eq(declarationConstraints.length, 10, 'exact declaration ten constraints: two identity, two foreign keys and six checks')
        eq(Object.fromEntries(['p', 'u', 'f', 'c'].map(type => [type, declarationConstraints.filter(row => row.contype === type).length])), { p: 1, u: 1, f: 2, c: 6 }, 'private declaration constraints have exact frozen kinds')
        eq(declarationConstraints.filter(row => row.contype === 'p' || row.contype === 'u').map(row => row.conname).sort(), ['bx1_ce_declaration_identity', 'bx1_ce_declaration_pk'], 'declaration identity keys have exact bounded names')
        for (const row of additions) truth([Number(declaration.oid), revisionOid, decisionOid].includes(row.conrelid) && row.convalidated, 'no other relation constraint or unvalidated constraint is admitted')
      }
    }
    await commit()
    phase = 'both-assurance-both-asset-canonical-loops'
    const beforeStandard = await state()
    await begin()
    await isolated(async () => {
      mode = 'STANDARD'
      for (const n of [1, 2, 3, 4, 5]) {
        await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:CE-standard-only',$3)", [fictional(800 + n), `Fictional CE STANDARD person ${n}`, fictional(850 + n)])
        await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:CE-standard-only',$3)", [actor(n), fictional(800 + n), fictional(870 + n)])
      }
      eq(await scalar('select count(*)::int from auth.mfa_factors where id=$1', [actor(201)]), 0, 'actor-one assurance factor is absent before rollback fixture')
      await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [actor(201), actor(1)])
      for (const n of [1, 2, 3, 4, 5]) {
        eq(await scalar("select exists(select 1 from auth.mfa_factors where id=$1 and user_id=$2 and status::text='verified')", [actor(200 + n), actor(n)]), true, 'STANDARD session links exact own verified fixture factor')
        await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2 and user_id=$3", [actor(200 + n), actor(100 + n), actor(n)])
      }
      const keep = [inputs.length, records.length]
      for (const [asset, ordinal] of [['FUND', 100], ['REAL_ESTATE', 200]]) await loop(asset, base[asset], ordinal)
      inputs.splice(keep[0]); records.splice(keep[1])
    })
    mode = 'TEST_PASSWORD'
    eq(await state(), beforeStandard, 'complete STANDARD loops restore every native/person/factor/business row exactly')
    eq(await funcs(), installedFunctions, 'STANDARD loops preserve all installed/protected definitions and identities')
    eq(await security(), installedSecurity, 'STANDARD loops preserve every security/catalog field')
    products.clear(); appointments.clear(); revisions.clear(); modelTerms.clear(); revisionTerms.clear()
    for (const [asset, ordinal] of [['FUND', 300], ['REAL_ESTATE', 400]]) await loop(asset, base[asset], ordinal)
    phase = 'strict-shape-hash-provenance-and-legacy-boundaries'
    const strictBefore = await state()
    for (const asset of ['FUND', 'REAL_ESTATE']) {
      const template = termsV3(base[asset], organisation, asset === 'FUND' ? 500 : 600, `Fictional invalid ${asset} common proposal`)
      const cases = [
        ['missing common envelope', t => { delete t.common_envelope }],
        ['unknown top-level field', t => { t.unreviewed_authority = true }],
        ['unknown nested issuer field', t => { t.common_envelope.issuer.verified = true }],
        ['missing required issuer field', t => { delete t.common_envelope.issuer.legal_form }],
        ['wrong terms version type', t => { t.terms_version = '3' }],
        ['wrong nested integer string', t => { t.deployment_configuration.signing.threshold = '2' }],
        ['wrong nested integer boolean', t => { t.common_envelope.servicing.default_notice_days = true }],
        ['wrong nested integer fraction', t => { t.common_envelope.transfer.lockup_days = 0.5 }],
        ['required field null', t => { t.common_envelope.register.correction_policy = null }],
        ['zero issuer UUID', t => { t.common_envelope.issuer.issuer_reference = '00000000-0000-0000-0000-000000000000' }],
        ['noncanonical uppercase UUID', t => { t.common_envelope.issuer.issuer_reference = t.common_envelope.issuer.issuer_reference.toUpperCase() }],
        ['native rather than portal manager', t => { t.common_envelope.manager_organisation_id = manager.organisationId }],
        ['different portal manager', t => { t.common_envelope.manager_organisation_id = fictional(99999) }],
        ['issuer name contradiction', t => { t.issuer_name = 'Contradictory fictional issuer identity' }],
        ['custodian missing', t => { t.common_envelope.custody_title.asset_control_model = 'CUSTODIAN_CONTROL_DECLARED' }],
        ['issuer control has custodian', t => { t.common_envelope.custody_title.custodian_legal_name = 'Unadmitted fictional custodian' }],
        ['duplicate class IDs', t => { t.common_envelope.classes[1].class_id = t.common_envelope.classes[0].class_id }],
        ['eleven classes', t => { for (let i = 2; i <= 10; i++) t.common_envelope.classes.push({ ...clone(t.common_envelope.classes[1]), class_id: fictional(99000 + i) }); t.deployment_configuration.class_ids = t.common_envelope.classes.map(value => value.class_id) }],
        ['zero primary classes', t => { t.common_envelope.classes[0].primary = false }],
        ['two primary classes', t => { t.common_envelope.classes[1].primary = true }],
        ['primary not first', t => { t.common_envelope.classes.reverse() }],
        ['primary price mismatch', t => { t.common_envelope.classes[0].unit_price_minor = '1' }],
        ['primary cap mismatch', t => { t.common_envelope.classes[0].cap_units = '1' }],
        ['primary minimum mismatch', t => { t.common_envelope.classes[0].minimum_units = '2' }],
        ['primary rights mismatch', t => { t.common_envelope.classes[0].rights = 'Different unreviewed fictional rights contradict the authoritative template.' }],
        ['secondary operational economics', t => { t.common_envelope.classes[1].unit_price_minor = '1' }],
        ['fractional class precision', t => { t.common_envelope.classes[0].decimals = 6 }],
        ['configuration class ordering', t => { t.deployment_configuration.class_ids.reverse() }],
        ['configuration primary substitution', t => { t.deployment_configuration.primary_class_id = t.common_envelope.classes[1].class_id }],
        ['duplicate default events', t => { t.common_envelope.servicing.default_events.push(t.common_envelope.servicing.default_events[0]) }],
        ['default event order', t => { t.common_envelope.servicing.default_events.reverse() }],
        ['duplicate eligibility countries', t => { t.eligible_countries.push(t.eligible_countries[0]) }],
        ['duplicate eligibility investor types', t => { t.eligible_investor_types.push(t.eligible_investor_types[0]) }],
        ['wrong fixed fees reference', t => { t.common_envelope.fees.schedule_ref = 'client.selected.fees' }],
        ['wrong fixed eligibility reference', t => { t.common_envelope.eligibility.countries_ref = 'different.countries' }],
        ['invalid signing threshold', t => { t.deployment_configuration.signing.threshold = 4 }],
        ['missing independent slot', t => { t.deployment_configuration.signing.policy_slots.pop() }],
        ['actual signer address', t => { t.deployment_configuration.signing.address = '0x0000000000000000000000000000000000000001' }],
        ['invalid timelock', t => { t.deployment_configuration.governance.timelock_hours = 0 }],
        ['identical governance catchall', t => { const value = 'Identical fictional catch-all text for every high-risk policy is not a distinct declaration.'; t.deployment_configuration.governance.controller_replacement_policy = value; for (const name of Object.keys(t.deployment_configuration.governance.powers)) t.deployment_configuration.governance.powers[name] = value }],
        ['deployed configuration claim', t => { t.deployment_configuration.state = 'DEPLOYED' }],
        ['verified issuer claim', t => { t.common_envelope.posture = 'VERIFIED' }],
        ['provider endpoint injection', t => { t.deployment_configuration.provider_url = 'https://example.invalid' }],
        ['legacy currency', t => { t.currency = 'ZAR_TEST' }],
        ['legacy common reference', t => { t.common_envelope.servicing.reporting_policy += ' ZAR_TEST' }],
        ['leading ASCII whitespace', t => { t.common_envelope.issuer.legal_form = ` ${t.common_envelope.issuer.legal_form}` }],
        ['trailing ASCII whitespace', t => { t.common_envelope.issuer.legal_form += '\t' }],
        ['overbound Unicode code points', t => { t.common_envelope.issuer.legal_form = '💼'.repeat(101) }],
      ]
      if (asset === 'FUND') cases.push(['fund lockup contradiction', t => { t.common_envelope.transfer.lockup_days = t.fund.liquidity.lockup_days + 1 }])
      else cases.push(['SPV identity contradiction', t => { t.common_envelope.issuer.registration_reference += '-DIFFERENT' }],
        ['property title contradiction', t => { t.common_envelope.custody_title.title_evidence_reference += '-DIFFERENT' }],
        ['property transfer contradiction', t => { t.common_envelope.transfer.eligible_transfer_policy += ' Different proposal.' }],
        ['property exits collapsed', t => { t.real_estate.exits.disposal_liquidation_policy = t.real_estate.exits.eligible_transfer_policy }])
      for (const [label, change] of cases) {
        const value = clone(template); change(value)
        await denied(`${asset} strict ${label}`, () => command(1, manager, 'create_product', { organisation_id: organisation, terms: value }), ['22023', '23514'])
      }
      await isolated(async () => {
        const value = clone(template); value.common_envelope.issuer.legal_form = '💼💼💼'
        const returned = await command(1, manager, 'create_product', { organisation_id: organisation, terms: value })
        const p = returned.products.find(item => item.terms.name === value.name)
        truth(p, 'valid code-point boundary traverses actual canonical writer')
        eq(p.terms.common_envelope.issuer.legal_form, value.common_envelope.issuer.legal_form, 'valid Unicode survives without normalization or truncation')
      })
      await isolated(async () => {
        const value = clone(template); value.name += ' declared custody policy'
        value.common_envelope.custody_title.asset_control_model = 'CUSTODIAN_CONTROL_DECLARED'
        value.common_envelope.custody_title.custodian_legal_name = 'Fictional declared custodian, not admitted'
        value.deployment_configuration.signing.policy_slots.push('RECOVERY_CUSTODIAN')
        value.deployment_configuration.signing.threshold = 4
        const returned = await command(1, manager, 'create_product', { organisation_id: organisation, terms: value })
        eq(returned.products.find(p => p.terms.name === value.name)?.terms, value, 'named custody and four-slot threshold remain exact declarations, not operational grants')
      })
      const overflow = clone(template)
      for (const field of Object.keys(overflow.documents)) overflow.documents[field] = 'F'.repeat(12000)
      for (const field of Object.keys(overflow.deployment_configuration.governance.powers)) overflow.deployment_configuration.governance.powers[field] = `Fictional ${field} ${'P'.repeat(2350)}`
      overflow.common_envelope.custody_title.segregation_policy = 'S'.repeat(2400)
      overflow.common_envelope.custody_title.control_policy = 'C'.repeat(2400)
      overflow.common_envelope.custody_title.recovery_policy = 'R'.repeat(2400)
      truth(Buffer.byteLength(JSON.stringify({ organisation_id: organisation, terms: overflow }), 'utf8') > 65536, 'aggregate overflow fixture exceeds original full-command limit')
      await denied('aggregate payload overflow cannot drop individually valid fields', () => command(1, manager, 'create_product', { organisation_id: organisation, terms: overflow }), ['22023', '23514'])
      await isolated(async () => {
        let p = (await command(1, manager, 'create_product', { organisation_id: organisation, terms: template })).products.find(item => item.terms.name === template.name)
        const original = clone(p.terms)
        for (const [label, change] of [
          ['issuer reference replacement', t => { t.common_envelope.issuer.issuer_reference = fictional(8000) }],
          ['issuer changed without revision', t => { t.common_envelope.issuer.legal_form += ' changed' }],
          ['issuer skipped declaration revision', t => { t.common_envelope.issuer.legal_form += ' changed'; t.common_envelope.issuer.declaration_revision = 3 }],
          ['primary immutable class replacement', t => { t.common_envelope.classes[0].class_id = fictional(8001); t.deployment_configuration.class_ids[0] = fictional(8001); t.deployment_configuration.primary_class_id = fictional(8001) }],
        ]) {
          const t = clone(original); change(t)
          await denied(label, () => command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: t }), ['22023', '23514'])
        }
        const t = clone(original); t.common_envelope.issuer.legal_form += ' revised declaration'; t.common_envelope.issuer.declaration_revision = 2
        p = findProduct(await command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: t }), p.id)
        eq(p.terms, t, 'exact next immutable issuer declaration traverses canonical save')
        await admin()
        eq(await scalar('select count(*)::int from bx1_portal.product_issuer_declarations where product_id=$1', [p.id]), 2, 'issuer change appends one immutable snapshot, never overwrites revision one')
        await denied('v3 cannot silently downgrade to v2', () => command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: base[asset] }), ['22023', '23514'])
      })
    }
    eq(await state(), strictBefore, 'strict/positive-boundary probes are exactly rollback-isolated')
    for (const item of records) await isolated(async () => {
      await claims(1); await admin()
      await denied('unconditional manager binding rejects organisation-only internal update', () => db.query('update bx1_portal.products set organisation_id=$2 where id=$1', [item.p.id, fictional(99995)]), '23514')
      await denied('immutable declaration cannot be rewritten', () => db.query("update bx1_portal.product_issuer_declarations set declaration=jsonb_set(declaration,'{legal_name}',to_jsonb('Changed fictional identity'::text)) where product_id=$1", [item.p.id]), '23514')
      await denied('immutable declaration cannot be deleted', () => db.query('delete from bx1_portal.product_issuer_declarations where product_id=$1', [item.p.id]), '23514')
    })
    await isolated(async () => {
      const value = termsV3(base.FUND, organisation, 700, 'Fictional allowed repeated governance clause')
      value.deployment_configuration.governance.powers.mint_burn = value.deployment_configuration.governance.powers.role_grant_revoke
      const snapshot = await command(1, manager, 'create_product', { organisation_id: organisation, terms: value })
      eq(snapshot.products.find(p => p.terms.name === value.name)?.terms, value, 'two shared review clauses are allowed; only all-identical catchall is rejected')
    })
    await isolated(async () => {
      const value = clone(records[0].terms); value.name = 'Fictional same issuer reference, separate product declaration'
      const snapshot = await command(1, manager, 'create_product', { organisation_id: organisation, terms: value })
      const p = snapshot.products.find(item => item.terms.name === value.name)
      truth(p && p.id !== records[0].p.id, 'same issuer name/reference/class IDs never merge products')
      await admin()
      eq(await scalar('select count(distinct product_id)::int from bx1_portal.product_issuer_declarations where issuer_reference=$1', [value.common_envelope.issuer.issuer_reference]), 2, 'every issuer-reference declaration and lookup remains product-scoped')
    })
    for (const [asset, original] of Object.entries(base)) await isolated(async () => {
      let p = (await command(1, manager, 'create_product', { organisation_id: organisation, terms: { ...clone(original), name: `Fictional deliberate ${asset} upgrade` } })).products.find(value => value.terms.name === `Fictional deliberate ${asset} upgrade`)
      truth(p && p.terms.terms_version === 2, 'new legacy-compatible v2 draft is not silently upgraded')
      const full = termsV3(p.terms, organisation, asset === 'FUND' ? 720 : 740, p.terms.name)
      p = findProduct(await command(1, manager, 'save_product', { product_id: p.id, expected_revision: p.revision, terms: full }), p.id)
      eq(p.terms, full, 'deliberate complete editable-draft upgrade uses canonical writer and exact v3 input')
      await admin()
      eq(await scalar('select count(*)::int from bx1_portal.product_issuer_declarations where product_id=$1 and declaration_revision=1', [p.id]), 1, 'upgrade atomically creates only declaration revision one')
    })
    // Legacy schema/denomination/approval history remains unchanged in every
    // original field; new NULL fields are explicit, never borrowed from current.
    for (const old of originalRows['bx1_portal.products']) {
      await admin()
      const history = await scalar('select bx1_portal.offering_history_projection($1)', [old.id])
      for (const entry of history) for (const field of [...newReviewFields, 'common_envelope', 'deployment_configuration']) eq(entry[field], null, 'old immutable history retains explicit NULL CE bindings')
    }
    const legacyDecisionAssets = new Set()
    for (const old of originalRows['bx1_portal.offering_revisions'].filter(row => row.origin === 'SUBMITTED')) await isolated(async () => {
      const p = originalRows['bx1_portal.products'].find(value => value.id === old.product_id)
      if (!p || p.created_by !== actor(1)) return
      const body = { product_id: p.id, expected_revision: p.revision, offering_revision_id: old.id, terms_hash: old.terms_hash,
        decision: 'APPROVED', notes: 'Fictional invalid new hashes on historical v2 input only.', checks: { issuer_authority: true, terms: true, rights: true },
        common_envelope_hash: '0'.repeat(64), deployment_configuration_hash: '0'.repeat(64) }
      await denied('legacy v2 review rejects new hash fields', () => command(3, issuer, 'review_offering_issuer', body), ['22023', '23514'])
      if (p.current_offering_revision_id === old.id && old.terms.terms_version === 2) {
        await claims(3); await admin()
        await denied('legacy v2 privileged decision rejects non-null CE bindings at exact producer', () => db.query(`insert into bx1_portal.offering_decisions
          (offering_revision_id,decision_kind,decision,actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks,common_envelope_hash,deployment_configuration_hash)
          values($1,'ISSUER','APPROVED',$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$9)`, [old.id, actor(3), JSON.stringify(issuer), old.terms_hash,
          JSON.stringify(old.document_hashes), p.revision, 'Fictional non-null binding on otherwise exact current legacy v2 decision only.',
          JSON.stringify({ issuer_authority: true, terms: true, rights: true }), '0'.repeat(64)]), '23514', 'common_envelope_legacy_decision_binding')
        legacyDecisionAssets.add(old.terms.asset_type)
      }
      await claims(1); await admin()
      await denied('legacy revision rejects non-null CE columns', () => db.query(`insert into bx1_portal.offering_revisions
        (product_id,package_number,origin,product_revision_at_submission,terms,terms_hash,document_hashes,submitted_at,common_envelope_hash,deployment_configuration_hash)
        select $1,1+(select max(package_number) from bx1_portal.offering_revisions where product_id=$1),'LEGACY_PRODUCT_SNAPSHOT',$2,$3::jsonb,$4,$5::jsonb,clock_timestamp(),$6,$6`,
      [p.id, p.revision, JSON.stringify(old.terms), old.terms_hash, JSON.stringify(old.document_hashes), '0'.repeat(64)]), '23514')
    })
    eq([...legacyDecisionAssets].sort(), ['FUND', 'REAL_ESTATE'].sort(), 'both exact current legacy asset revisions execute non-null decision binding negatives')
    eq(await state(), strictBefore, 'all metadata/upgrade/legacy/schema probes have no retained state effect')
    eq(await funcs(), installedFunctions, 'all synthetic readiness/audit helpers are removed with exact original function restoration')
    eq(await security(), installedSecurity, 'all synthetic trigger/schema probes restore exact installed catalog')
    await commit()
    phase = 'committed-both-assurance-current-authority-races'
    await races('TEST_PASSWORD')
    await standardSetup()
    await races('STANDARD')
    await standardCleanup()
    phase = 'strict-input-correspondence-final-preservation'
    await begin()
    eq(await funcs(), installedFunctions, 'final complete pg_proc manifests remain exact after every path and wait')
    eq(await security(), installedSecurity, 'final all roles/edges/ACL/RLS/triggers/constraints remain exact')
    eq(await settings(), settingsBefore, 'final original deadlines and engine settings unchanged')
    const finalRows = await state(), additions = inherited(originalRows, finalRows, originalSpecs)
    additions['bx1_portal.product_issuer_declarations'] = finalRows['bx1_portal.product_issuer_declarations']
    const end = await scalar("select clock_timestamp()::text"), start = proofStartedAt
    const inWindow = value => {
      eq(typeof value, 'string', 'generated time has explicit textual representation')
      const at = Date.parse(value)
      truth(Number.isFinite(at) && at >= Date.parse(start) && at <= Date.parse(end), 'exact added row time remains inside captured database window')
    }
    const tupleJournal = (actual, expected, fields, extra = []) => {
      eq(actual.length, expected.length, 'journal has exact captured successful input count')
      const seen = new Set()
      for (const row of actual) {
        eq(Object.keys(row).sort(), [...fields, ...extra, 'created_at'].sort(), 'journal exact canonical field inventory')
        const joined = `${row.actor_id}:${row.request_key}`
        truth(!seen.has(joined), 'journal actor/key appears once'); seen.add(joined)
        const intended = expected.find(value => value.actor_id === row.actor_id && value.request_key === row.request_key)
        truth(intended, 'journal cannot hide behind a fixture-actor wildcard')
        eq(Object.fromEntries(fields.map(field => [field, row[field]])), intended, 'journal preserves full exact authored action/payload/context')
        inWindow(row.created_at)
      }
    }
    const project = (input, context = false, strip = false) => ({ actor_id: input.actor_id, request_key: input.request_key, command: input.command,
      payload: strip ? Object.fromEntries(Object.entries(input.payload).filter(([name]) => !['offering_revision_id', 'terms_hash', ...newReviewFields].includes(name))) : clone(input.payload),
      ...(context ? { operating_context: clone(input.operating_context) } : {}) })
    const legacyCommands = new Set(['create_product', 'save_product', 'submit_product', 'review_product'])
    const legacyExpected = inputs.filter(input => legacyCommands.has(input.command)).map(input => project(input, false, input.command === 'review_product'))
    tupleJournal(additions['bx1_portal.requests'], legacyExpected,
      ['actor_id', 'request_key', 'command', 'payload'])
    const memoryExpected = clone(legacyExpected.slice(0, 2)), memoryJournal = memoryExpected.map(input => ({ ...clone(input), created_at: start }))
    tupleJournal(memoryJournal, memoryExpected, ['actor_id', 'request_key', 'command', 'payload'])
    for (const [label, mutate] of [
      ['missing row', value => { value.pop() }], ['extra row', value => { value.push(clone(value[0])) }],
      ['duplicate key', value => { value[1] = clone(value[0]) }], ['foreign actor', value => { value[0].actor_id = fictional(99997) }],
      ['changed key', value => { value[0].request_key = fictional(99996) }], ['changed action', value => { value[0].command = 'publish_product' }],
      ['changed full payload', value => { value[0].payload.terms.common_envelope.register.authority = 'UNREVIEWED' }],
      ['extra column', value => { value[0].unrelated = true }], ['missing column', value => { delete value[0].payload }],
      ['invalid time', value => { value[0].created_at = 'invalid' }],
      ['outside database window', value => { value[0].created_at = new Date(Date.parse(start) - 1000).toISOString() }],
    ]) {
      const negative = clone(memoryJournal); mutate(negative)
      assert.throws(() => tupleJournal(negative, memoryExpected, ['actor_id', 'request_key', 'command', 'payload']), { code: 'ERR_ASSERTION' }, `strict finite journal validator rejects ${label}`); checks++
    }
    const appointmentCommands = new Set(['request_product_service_appointment', 'review_product_service_appointment', 'apply_product_service_appointment'])
    tupleJournal(additions['bx1_portal.scoped_requests'], inputs.filter(input => !appointmentCommands.has(input.command)).map(input => project(input, true)),
      ['actor_id', 'request_key', 'command', 'payload', 'operating_context'])
    tupleJournal(additions['bx1_portal.product_service_appointment_requests'], inputs.filter(input => appointmentCommands.has(input.command)).map(input => project(input, true)),
      ['actor_id', 'request_key', 'command', 'payload', 'operating_context'], ['appointment_id', 'receipt_id'])
    eq(additions['bx1_portal.product_service_appointment_receipts'].length, inputs.filter(input => appointmentCommands.has(input.command)).length, 'one exact immutable receipt for each authored appointment operation')
    const receiptIds = new Set()
    for (const request of additions['bx1_portal.product_service_appointment_requests']) {
      truth(appointments.has(request.appointment_id), 'appointment request refers only to exact returned appointment identity')
      truth(!receiptIds.has(request.receipt_id), 'appointment receipt is referenced once'); receiptIds.add(request.receipt_id)
      const receipt = additions['bx1_portal.product_service_appointment_receipts'].find(value => value.id === request.receipt_id)
      truth(receipt, 'matched scoped receipt exists')
      eq([receipt.appointment_id, receipt.actor_id, receipt.action, receipt.operating_context, receipt.command_payload],
        [request.appointment_id, request.actor_id, request.command, request.operating_context, request.payload], 'receipt cannot change actor/context/action/subject/full payload')
      eq([receipt.appointment_revision, receipt.status_after], request.command === 'request_product_service_appointment' ? [1, 'SUBMITTED']
        : request.command === 'review_product_service_appointment' ? [2, request.payload.decision] : [3, 'APPLIED'], 'appointment receipt binds exact canonical transition revision/status')
      inWindow(receipt.recorded_at)
    }
    for (const input of inputs.filter(value => value.command === 'review_product')) {
      eq(Object.keys(input.payload).sort(), [...reviewFields, ...newReviewFields].sort(), 'outer v3 Compliance input has exact nine fields')
      const outer = additions['bx1_portal.scoped_requests'].find(row => row.actor_id === input.actor_id && row.request_key === input.request_key)
      const inner = additions['bx1_portal.requests'].find(row => row.actor_id === input.actor_id && row.request_key === input.request_key)
      eq(outer.payload, input.payload, 'outer receipt retains both original expected hashes')
      eq(Object.keys(inner.payload).sort(), ['product_id', 'expected_revision', 'decision', 'notes', 'checks'].sort(), 'legacy transition receipt is exactly five-field projection, not falsely claimed original full payload')
    }
    const summaries = input => ({
      create_product: 'Typed test product draft created. No assets or tokens issued.',
      save_product: input.payload.terms?.asset_type === 'REAL_ESTATE' ? 'Synthetic property draft terms revised; earlier review no longer applies.' : 'Test product draft terms revised; earlier review no longer applies.',
      submit_product: 'Test offering submitted for independent compliance review.',
      review_product: `Independent test offering review: ${input.payload.decision}.`,
      review_offering_issuer: `Appointed issuer decided exact immutable test offering package: ${input.payload.decision}. No publication or chain deployment.`,
      begin_offering_amendment: 'Synthetic TEST approved package opened for a governed terms amendment. Prior decisions remain immutable; no order, funding or ownership changed.',
      reopen_offering_review: 'Synthetic TEST approved offering reopened for fresh issuer and Compliance review. Prior decisions preserved; no publication, order or funding created.',
    })[input.command]
    eq(additions['bx1_portal.events'].length, inputs.length, 'one canonical event per intended successful operation, no provider/financial hidden event')
    const remaining = [...additions['bx1_portal.events']]
    for (const input of inputs) {
      const subject = input.command === 'review_offering_issuer' ? input.payload.offering_revision_id : input.subject_id
      let summary = summaries(input)
      if (appointmentCommands.has(input.command)) {
        const a = additions['bx1_portal.product_service_appointments'].find(row => row.id === input.subject_id)
        truth(a, 'appointment audit role is tied to exact input/returned appointment')
        const status = input.command === 'request_product_service_appointment' ? 'SUBMITTED' : input.command === 'apply_product_service_appointment' ? 'APPLIED' : input.payload.decision
        summary = `Synthetic TEST product service appointment ${a.role} ${status}. No signing, funding or publication authority.`
      }
      const index = remaining.findIndex(event => event.actor_id === input.actor_id && event.kind === input.command && event.subject_id === subject && event.summary === summary)
      truth(index >= 0, 'audit matches exact input actor/action/subject/mandatory summary, not ambiguous first same-kind event')
      const [event] = remaining.splice(index, 1)
      eq([event.organisation_id, event.application_id, event.investor_id], [organisation, null, null], 'canonical product audit dimensions remain exact')
      inWindow(event.created_at)
    }
    eq(remaining, [], 'no extra audit effect is hidden')
    const closed = (name, count, check) => {
      const rows = additions[name]; eq(rows.length, count, 'record family has exact finite input-derived cardinality')
      for (const row of rows) truth(check(row), 'every added record binds intended input/canonical returned identity, no schema/actor blanket waiver')
    }
    closed('bx1_portal.products', records.length, row => records.some(item => row.id === item.p.id && row.organisation_id === organisation && row.created_by === actor(1)
      && row.status === 'APPROVED' && row.published_at === null && String(row.reserved_units) === '0' && isDeepStrictEqual(row.terms, item.p.terms)
      && row.terms_hash === item.p.terms_hash && row.current_offering_revision_id === item.p.offering_package.id))
    const submitted = inputs.filter(input => input.command === 'submit_product' || input.command === 'reopen_offering_review')
    closed('bx1_portal.offering_revisions', submitted.length, row => revisions.has(row.id) && products.has(row.product_id) && row.origin === 'SUBMITTED' && row.submitted_by === actor(1)
      && row.terms.terms_version === 3 && isDeepStrictEqual(row.terms, revisionTerms.get(row.id))
      && row.terms.common_envelope.manager_organisation_id === organisation && row.common_envelope_hash && row.deployment_configuration_hash)
    const decisionInputs = inputs.filter(input => ['review_product', 'review_offering_issuer'].includes(input.command))
    closed('bx1_portal.offering_decisions', decisionInputs.length, row => decisionInputs.some(input => row.offering_revision_id === input.payload.offering_revision_id
      && row.actor_id === input.actor_id && row.decision_kind === (input.command === 'review_product' ? 'COMPLIANCE' : 'ISSUER')
      && row.decision === input.payload.decision && row.terms_hash === input.payload.terms_hash && row.common_envelope_hash === input.payload.common_envelope_hash
      && row.deployment_configuration_hash === input.payload.deployment_configuration_hash && row.notes === input.payload.notes && isDeepStrictEqual(row.checks, input.payload.checks)
      && isDeepStrictEqual(row.operating_context, input.operating_context) && row.product_revision_at_decision === input.payload.expected_revision)
      && records.some(item => item.p.id === additions['bx1_portal.offering_revisions'].find(r => r.id === row.offering_revision_id)?.product_id
        && row.product_appointment_id === (row.decision_kind === 'ISSUER' ? item.issuerAppointment.id : item.complianceAppointment.id)))
    for (const row of additions['bx1_portal.offering_decisions']) {
      const revision = additions['bx1_portal.offering_revisions'].find(value => value.id === row.offering_revision_id)
      eq(row.document_hashes, revision.document_hashes, 'decision derives exact immutable revision disclosure hashes')
      inWindow(row.decided_at)
    }
    closed('bx1_portal.product_service_appointments', 4, row => appointments.has(row.id) && products.has(row.product_id) && row.product_organisation_id === organisation
      && row.reviewer_scope_organisation_id === scope && row.status === 'APPLIED' && row.revision === 3 && row.requested_by_user_id === actor(1)
      && row.reviewed_by_user_id === actor(4) && row.applied_by_user_id === actor(5) && row.appointee_user_id === (row.role === 'IssuerFundManager' ? actor(3) : actor(2)))
    for (const row of additions['bx1_portal.product_service_appointments']) {
      const request = inputs.find(input => input.command === 'request_product_service_appointment' && input.subject_id === row.id)
      const review = inputs.find(input => input.command === 'review_product_service_appointment' && input.subject_id === row.id)
      const receipt = additions['bx1_portal.product_service_appointment_receipts'].find(value => value.appointment_id === row.id && value.action === 'review_product_service_appointment')
      eq([row.role, row.appointee_user_id, row.native_membership_id, row.requested_in_context, row.product_revision_at_request, row.evidence_reference],
        [request.payload.role, request.payload.appointee_user_id, request.payload.native_membership_id, request.operating_context, request.payload.expected_product_revision, request.payload.evidence_reference], 'appointment preserves exact original author/appointee/native/context/revision/evidence tuple')
      eq(row.terms_hash_at_request, await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')", [JSON.stringify(request.product_terms_at_request)]), 'appointment terms reference binds captured original full terms, not mutable final terms')
      eq(Date.parse(row.requested_until), Date.parse(request.payload.requested_until), 'appointment expiry equals exact original timestamp input')
      eq([row.review_notes, row.review_checks, row.approval_receipt_id, row.provider_mode, row.revoked_at, row.revoked_by_user_id, row.revoke_reason],
        [review.payload.notes, review.payload.checks, receipt.id, 'SYNTHETIC_TEST', null, null, null], 'appointment review/approval/provenance/null revocation fields remain exact')
      for (const field of ['requested_at', 'reviewed_at', 'applied_at']) inWindow(row[field])
    }
    for (const row of additions['bx1_portal.products']) inWindow(row.created_at)
    for (const row of additions['bx1_portal.offering_revisions']) inWindow(row.submitted_at)
    closed('bx1_portal.product_issuer_declarations', records.length, row => records.some(item => row.product_id === item.p.id && row.issuer_reference === item.p.terms.common_envelope.issuer.issuer_reference
      && row.declaration_revision === 1 && isDeepStrictEqual(row.declaration, item.p.terms.common_envelope.issuer) && row.declared_by === actor(1)))
    for (const row of additions['bx1_portal.product_issuer_declarations']) {
      inWindow(row.declared_at)
      eq(row.declaration_hash, await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')", [JSON.stringify({
        domain: 'BX1_ISSUER_DECLARATION_V3_1', product_id: row.product_id, posture: 'SYNTHETIC_DECLARED', declaration: row.declaration })]), 'issuer declaration exact domain-separated product binding')
    }
    for (const [table, action] of [['offering_amendment_begin_receipts', 'begin_offering_amendment'], ['offering_review_reopen_receipts', 'reopen_offering_review']]) {
      const intents = inputs.filter(input => input.command === action)
      closed(`bx1_portal.${table}`, intents.length, row => intents.some(input => row.actor_id === input.actor_id && row.request_key === input.request_key
        && row.product_id === input.payload.product_id && row.reason === input.payload.reason && row.product_revision_before === input.payload.expected_revision
        && row.product_revision_after === input.payload.expected_revision + 1 && isDeepStrictEqual(row.operating_context, input.operating_context))
        && revisions.has(row.prior_offering_revision_id) && (action !== 'reopen_offering_review' || revisions.has(row.reopened_offering_revision_id)))
      for (const row of additions[`bx1_portal.${table}`]) inWindow(row.recorded_at)
    }
    const allowed = new Set(['bx1_portal.products', 'bx1_portal.offering_revisions', 'bx1_portal.offering_decisions', 'bx1_portal.product_service_appointments',
      'bx1_portal.product_issuer_declarations', 'bx1_portal.requests', 'bx1_portal.scoped_requests', 'bx1_portal.events',
      'bx1_portal.product_service_appointment_requests', 'bx1_portal.product_service_appointment_receipts',
      'bx1_portal.offering_amendment_begin_receipts', 'bx1_portal.offering_review_reopen_receipts'])
    for (const [name, rows] of Object.entries(additions)) if (!allowed.has(name)) eq(rows, [], 'all other identity/role/admission/receipt/provider/scanner/wallet/order/funding rows remain exact')
    for (const item of records) {
      await snapshotData(item.p, item.p.terms); await checkReviews(item.p)
      const snapshot = await read(1, manager), current = findProduct(snapshot, item.p.id)
      eq(current.offering_package.common_envelope, item.p.terms.common_envelope, 'fresh final read uses exact immutable common proposal')
      eq(current.offering_package.deployment_configuration, item.p.terms.deployment_configuration, 'fresh final read uses exact immutable configuration')
      for (const entry of current.offering_history) {
        await admin()
        const frozen = await scalar('select to_jsonb(r) from bx1_portal.offering_revisions r where id=$1', [entry.id])
        eq(entry.common_envelope, frozen.terms.common_envelope, 'each historical entry uses its own immutable common terms')
        eq(entry.deployment_configuration, frozen.terms.deployment_configuration, 'history cannot borrow mutable current configuration')
        for (const field of newReviewFields) eq(entry[field], frozen[field], 'each historical fingerprint belongs to that immutable revision')
      }
    }
    await admin()
    eq(await funcs(), installedFunctions, 'final full functions exact after final scoped reads')
    eq(await security(), installedSecurity, 'final full security/catalog exact after cleanup and final reads')
    await commit()
    console.log(`BX1_PRODUCT_COMMON_ENVELOPE_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 assets=FUND-and-REAL_ESTATE assurance=STANDARD-and-TEST_PASSWORD writer=canonical-only declarations=product-local-immutable fullTerms=exact additionalHashes=server-derived reviewReceipts=full-nine-and-strict-five changesRequired=proven commonAmendment=proven configurationAmendment=proven reopen=fresh-decisions replay=current-authority-and-exact-input waits=three-outcomes-both-lanes-and-both-reviewers inheritedOriginalFields=exact legacyNewBindings=NULL metadata=exact-eighteen-body-seven-private-helper footprint=exact-input-tuples standardFixture=exact-restored cleanup=caller-exact-schema-required publication=denied settlement=denied actualPDFs=not-proven eSignature=not-proven hostedAcceptance=not-proven independentHumans=not-proven technicalReadiness=not-verified`)
    return checks
  } catch (error) {
    primaryFailure = error
    error.productCommonEnvelopePhase = phase
    throw error
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
    for (const client of clients) { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }
    if (standardCommitted) {
      try { await standardCleanup() }
      catch (cleanupError) {
        console.error('BX1_PRODUCT_COMMON_ENVELOPE_CLEANUP_FAILED code=COMMITTED_STANDARD_FIXTURE')
        if (!primaryFailure) throw cleanupError
        throw primaryFailure
      }
    }
  }
}
