import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { runCloudEngineProof } from './document-scanner-engine-proof.mjs'
import { runOfferingOnce, recoverOfferingResult, signedRequest, TEST_ORIGIN } from './document-scanner-runner.mjs'

// This is a disposable PostgreSQL/Storage-HTTP fixture, NEVER hosted Storage,
// independent-human, signature-provider, malware-coverage or Stage3 acceptance.
const schemas = ['auth', 'storage', 'public', 'bx1_private', 'bx1_portal']
const actor = n => `ef840000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
const tables = ['offering_document_policy', 'offering_document_scanner_policy', 'offering_document_profiles',
  'offering_document_processing_jobs', 'offering_document_processing_attempts', 'offering_document_processing_claim_receipts',
  'offering_document_processing_events', 'offering_document_scan_events', 'offering_document_clean_receipts',
  'offering_document_intent_resolutions', 'offering_document_manifests', 'offering_document_command_receipts']
const roles = ['anon', 'authenticated', 'service_role', 'bx1_document_receipt_writer',
  'bx1_document_scanner_writer', 'bx1_document_processing_worker']
const worker = 'synthetic-offering-processing-worker', scanner = 'synthetic-offering-processing-scanner'
const clone = value => JSON.parse(JSON.stringify(value))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const normalized = value => value.replace(/\r\n/g, '\n').replace(/^[ \n\t]+|[ \n\t]+$/g, '')

function requireCloudFixture(db, clients) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.BX1_PORTAL_SQL_TEST_URL, 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
  assert.equal(process.platform, 'linux')
  assert.equal(clients.length, 2)
  for (const client of [db, ...clients]) {
    assert.equal(client.connectionParameters.statement_timeout, 15000)
    assert.equal(client.connectionParameters.query_timeout, 20000)
  }
}

export async function proveOfferingDocuments(db, clients, featureSql, proveConnectedSignatures) {
  requireCloudFixture(db, clients)
  let checks = 0, savepointSequence = 0, begun = false, phase = 'baseline', primaryFailure
  const proofStarted=Date.now()
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const truth = (value, label) => { assert.ok(value, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = async (client = db) => { await client.query('reset role'); eq(await scalar('select current_user', [], client), 'postgres', 'exact disposable fixture owner') }
  const begin = async () => { await admin(); await db.query('begin'); begun = true }
  const rollback = async () => { await db.query('rollback'); begun = false; await admin() }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const as = async (name, client = db) => { await admin(client); assert.ok(roles.includes(name)); await client.query(`set local role ${name}`) }
  const relationSpecs = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname,c.oid::text,
      array(select a.attname::text from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum) columns
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname=any($1) order by 1,2`, [schemas])).rows
  }
  const state = async (specs, client = db) => {
    await admin(client); const rows = {}
    for (const table of specs) {
      assert.match(table.nspname, /^[a-z0-9_]+$/); assert.match(table.relname, /^[a-z0-9_]+$/)
      rows[`${table.nspname}.${table.relname}`] = await scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table.nspname}.${table.relname} t`, [], client)
    }
    return rows
  }
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,p.oid::regprocedure::text signature,to_jsonb(p) catalog
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) order by p.oid`, [schemas])).rows
  }
  const security = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
      'edges',(select jsonb_agg(to_jsonb(r) order by roleid,member,grantor) from pg_auth_members r),
      'schemas',(select jsonb_agg(to_jsonb(r) order by oid) from pg_namespace r where nspname=any($1)),
      'relations',(select jsonb_agg(to_jsonb(r) order by oid) from (select c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1)) r),
      'policies',(select jsonb_agg(to_jsonb(r) order by schemaname,tablename,policyname) from pg_policies r where schemaname=any($1)),
      'triggers',(select jsonb_agg(to_jsonb(r) order by oid) from (select t.oid,t.tgrelid,t.tgname,t.tgenabled,t.tgfoid,pg_get_triggerdef(t.oid) definition
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and not t.tgisinternal) r),
      'constraints',(select jsonb_agg(to_jsonb(r) order by oid) from (select k.oid,k.conrelid,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid) definition
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1)) r),
      'defaults',(select jsonb_agg(to_jsonb(r) order by oid) from pg_default_acl r))`, [schemas])
  }
  const isolated = async run => {
    await admin(); const name = `pdf_isolated_${++savepointSequence}`; await db.query(`savepoint ${name}`)
    const journalLengths=[inputs.length,documentInputs.length,authoredFiles.length,products.length,appointed.length]
    const priorRevisions=new Map(revisions),priorResults=new Map(observedResults),priorMemory=new Map(memory),priorClean=new Map(cleanMemory),priorClaims=new Map(claimJournal),priorScans=new Map(scanJournal),priorPromotions=new Map(promotionJournal)
    try { return await run() } finally {
      await db.query(`rollback to savepoint ${name};release savepoint ${name}`); await admin()
      ;[inputs,documentInputs,authoredFiles,products,appointed].forEach((journal,index)=>{journal.length=journalLengths[index]})
      for(const [map,prior]of[[revisions,priorRevisions],[observedResults,priorResults],[memory,priorMemory],[cleanMemory,priorClean],[claimJournal,priorClaims],[scanJournal,priorScans],[promotionJournal,priorPromotions]]){map.clear();for(const [key,value]of prior)map.set(key,value)}
    }
  }
  const denied = async (label, run, code = '42501', specs = installedSpecs, message) => {
    const before = await state(specs), beforeFunctions = await functions(), beforeSecurity = await security()
    let failure
    await isolated(async () => { try { await run() } catch (error) { failure = error } })
    truth(failure, `${label}: must actually reject`); eq(failure.code, code, `${label}: SQLSTATE`)
    if(message!==undefined)eq(failure.message,message,`${label}: exact source producer`)
    eq(await state(specs), before, `${label}: all relation rows exact`)
    eq(await functions(), beforeFunctions, `${label}: every function/body/metadata exact`)
    eq(await security(), beforeSecurity, `${label}: complete security/catalog exact`)
  }
  const pinsMatch = featureSql.match(/\$pins\$([\s\S]*?)\$pins\$/)
  const resultsMatch = featureSql.match(/\$results\$([\s\S]*?)\$results\$/)
  truth(pinsMatch && resultsMatch, 'literal original/result pin manifests exist')
  const pins = JSON.parse(pinsMatch[1]), resultPins = JSON.parse(resultsMatch[1])
  eq(pins.length, 15, 'exact original target inventory'); eq(Object.keys(resultPins).length, 17, 'exact15 results plus2 authoritative writers')
  const helpersText = featureSql.match(/signatures text\[\]:=array\[([\s\S]*?)\];/)
  truth(helpersText, 'explicit new-helper ACL inventory exists')
  const helperSignatures = [...helpersText[1].matchAll(/'([^']+)'/g)].map(value => value[1])
  eq(helperSignatures.length, 37, 'exact explicit private-helper inventory')
  const helperDeclarations = new Map()
  for (const definition of featureSql.matchAll(/create function ([a-z0-9_.]+)\s*\(([\s\S]*?)\)\s*returns (jsonb|boolean|void|text|trigger)\s*language (sql|plpgsql) (immutable|stable|volatile) security definer set search_path=''/g)) {
    const args = definition[2].trim() ? definition[2].split(',').map(value => value.trim().split(/\s+/)) : []
    helperDeclarations.set(`${definition[1]}(${args.map(value => value[1]).join(',')})`, {
      result: definition[3], language: definition[4], volatility: { immutable: 'i', stable: 's', volatile: 'v' }[definition[5]],
      argnames: args.length ? args.map(value => value[0]) : null,
      bodyHash: digest(normalized(featureSql.slice(definition.index+definition[0].length).match(/^\s+as\s+(\$(?:[a-z_][a-z0-9_]*)?\$)([\s\S]*?)\1/i)[2])),
    })
  }
  for (const operation of ['reserve', 'register']) helperDeclarations.set(`bx1_private.${operation}_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)`, {
    result: 'jsonb', language: 'plpgsql', volatility: 'v',
    argnames: ['p_actor','p_session','p_aal','operating_context','target_product','target_revision','file_id','file_kind','file_title','file_sha256','file_size','p_attestation'],
    bodyHash: resultPins[`bx1_private.${operation}_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)`],
  })
  eq([...helperDeclarations.keys()].sort(), [...helperSignatures].sort(), 'every new private helper has independently declared source metadata')
  let originalSpecs, originalRows, originalFunctions, originalSecurity, installedSpecs, installedRows, installedFunctions, installedSecurity
  let manager, organisation, baseTerms
  const inputs = [], documentInputs = [], authoredFiles = [], products = [], revisions = new Map(), appointed = []
  const context = (role, organisationId = scope) => ({ mode: 'ROLE', organisationId, role })
  const attestation = n => { const at = Math.floor(Date.now()/1000); return { iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1',
    sub: actor(n), session_id: actor(100+n), role: 'authenticated', aal: 'aal1', exp: at+3600,
    is_anonymous: false, amr: [{ method: 'password', timestamp: at }] } }
  const claims = async (n, client = db) => { await admin(client); const a = attestation(n); await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(a)]); await as('authenticated',client); return a }
  const command = async (n, c, action, body, key = randomUUID(), client = db) => {
    await claims(n,client)
    const result=await scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',[action,key,JSON.stringify(body),JSON.stringify(c)],client)
    inputs.push({actor_id:actor(n),request_key:key,command:action,payload:clone(body),operating_context:clone(c)})
    return result
  }
  const snapshot = async (p, n = 1, c = manager, client = db) => { const a = attestation(n); await as('bx1_document_receipt_writer',client); return scalar('select bx1_private.read_offering_documents($1,$2,$3,$4::jsonb,$5,$6::jsonb)',[actor(n),actor(100+n),'aal1',JSON.stringify(c),p.current_offering_revision_id,JSON.stringify(a)],client) }
  const fileCommand = async (p, action, body, key = randomUUID(), client = db) => {
    const a=attestation(1); await as('bx1_document_receipt_writer',client)
    const result=await scalar('select bx1_private.execute_offering_document_command($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb)',[actor(1),actor(101),'aal1',JSON.stringify(manager),action,key,JSON.stringify(body),JSON.stringify(a)],client)
    documentInputs.push({actor_id:actor(1),request_key:key,command:action,payload:clone(body),operating_context:clone(manager)})
    return result
  }
  const find = (view,id) => { const p=view.products.find(row=>row.id===id); truth(p,'canonical product returned'); return p }
  const refreshProduct = async p => { await admin(); return scalar('select to_jsonb(p) from bx1_portal.products p where id=$1',[p.id]) }
  const create = async (asset, label) => {
    const terms=clone(baseTerms[asset]); terms.name=label
    const created=await command(1,manager,'create_product',{organisation_id:organisation,terms})
    let p=created.products.find(row=>row.terms.name===label); truth(p,'canonical creation finds exact authored terms')
    p=find(await command(1,manager,'submit_product',{product_id:p.id,expected_revision:p.revision}),p.id)
    const current=await refreshProduct(p)
    eq(await scalar('select profile from bx1_private.offering_document_profiles where offering_revision_id=$1',[current.current_offering_revision_id]),'PDF_SIGNATURE_REQUIRED_V1','new submitted revision acquires immutable profile')
    products.push(current.id); revisions.set(current.current_offering_revision_id, {product_id:current.id,terms:clone(terms)})
    return current
  }
  const appoint = async (p, role, n) => {
    await admin()
    const member=await scalar('select id from public.bx1_memberships where user_id=$1 and role=$2 and organisation_id=$3',[actor(n),role,scope])
    truth(member,'retained native candidate membership, not a invented person')
    let view=await command(1,manager,'request_product_service_appointment',{product_id:p.id,role,appointee_user_id:actor(n),
      native_membership_id:member,expected_product_revision:p.revision,evidence_reference:`SYNTHETIC-PDF-${role}`,
      requested_until:new Date(Date.now()+14*86400000).toISOString()})
    let a=view.product_appointments.find(row=>row.product_id===p.id&&row.role===role); truth(a,'canonical appointment nomination')
    view=await command(4,context('ComplianceOfficer'),'review_product_service_appointment',{appointment_id:a.id,expected_revision:a.revision,
      decision:'APPROVED',notes:'Synthetic independent review of exact PDF fixture appointment; no human identity or signature proof.',checks:{appointment:true,evidence:true,scope:true}})
    a=view.product_appointments.find(row=>row.id===a.id)
    view=await command(5,context('SuperAdmin'),'apply_product_service_appointment',{appointment_id:a.id,expected_revision:a.revision})
    a=view.product_appointments.find(row=>row.id===a.id); eq(a.effective,true,'canonical appointed role is current')
    appointed.push(a.id); return a
  }

  const memory = new Map(), cleanMemory = new Map(), observedResults = new Map(), claimJournal = new Map(), scanJournal = new Map(), promotionJournal = new Map()
  const reserve = async (p, kind, bytes, title = `Synthetic ${kind} exact private PDF`, fileId = randomUUID(), nativeLegacy = false) => {
    const a=attestation(1), args=[actor(1),actor(101),'aal1',JSON.stringify(manager),p.id,p.current_offering_revision_id,fileId,kind,title,digest(bytes),bytes.length]
    await as('bx1_document_receipt_writer')
    const receipt=await scalar(`select bx1_private.reserve_offering_file($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11${nativeLegacy?'':',$12::jsonb'})`,nativeLegacy?args:[...args,JSON.stringify(a)])
    eq(receipt,{id:fileId,path:`${p.current_offering_revision_id}/${actor(1)}/${fileId}`,revision_id:p.current_offering_revision_id,sha256:digest(bytes),size:bytes.length},'canonical reservation exact byte identity')
    authoredFiles.push({id:fileId,offering_revision_id:p.current_offering_revision_id,product_id:p.id,actor_id:actor(1),kind,title,
      storage_path:receipt.path,sha256:digest(bytes),byte_size:bytes.length,registered:false})
    return receipt
  }
  const register = async (p, kind, bytes) => {
    const receipt=await reserve(p,kind,bytes)
    await claims(1)
    await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata) values($1,$2,$3,$4::jsonb,$5::jsonb)',
      ['bx1-offering-quarantine',receipt.path,actor(1),JSON.stringify({size:bytes.length,mimetype:'application/pdf'}),JSON.stringify({sha256:receipt.sha256})])
    memory.set(receipt.path,Buffer.from(bytes))
    await db.query("select set_config('request.storage.operation','object.get_authenticated',true)")
    eq(await scalar('select count(*)::int from storage.objects where bucket_id=$1 and name=$2',['bx1-offering-quarantine',receipt.path]),1,'actual restrictive owner SELECT policy admits enrolled AAL1 owner')
    eq(digest(Buffer.from(memory.get(receipt.path))),receipt.sha256,'independently copied fixture download matches actual source bytes')
    const a=attestation(1); await as('bx1_document_receipt_writer')
    const item=authoredFiles.find(value=>value.id===receipt.id)
    const args=[actor(1),actor(101),'aal1',JSON.stringify(manager),p.id,p.current_offering_revision_id,receipt.id,kind,item.title,receipt.sha256,bytes.length,JSON.stringify(a)]
    const result=await scalar('select bx1_private.register_offering_file($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',args)
    eq(result.id,receipt.id,'sole register writer returns exact reserved identity'); eq(result.validation_state,'QUARANTINED','original quarantine remains explicitly unscanned')
    item.registered=true
    const before=await state(installedSpecs)
    await as('bx1_document_receipt_writer')
    eq(await scalar('select bx1_private.register_offering_file($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',args),result,'exact register retry has stable canonical receipt')
    eq(await state(installedSpecs),before,'register retry creates no second receipt/job/audit')
    return receipt
  }
  const processing = async (operation, args) => {
    await as(operation==='claim'||operation==='read'||operation==='fail'?'bx1_document_processing_worker':'bx1_document_scanner_writer')
    const sql={claim:'select bx1_private.claim_offering_document_processing($1,$2,$3)',read:'select bx1_private.read_offering_document_processing($1,$2,$3,$4,$5)',
      fail:'select bx1_private.fail_offering_document_processing($1,$2,$3,$4,$5,$6)',scanInput:'select bx1_private.read_offering_document_scan_input($1,$2,$3,$4,$5)',
      record:'select bx1_private.record_offering_document_scan($1,$2,$3,$4,$5,$6::timestamptz)',promote:'select bx1_private.promote_scanned_offering_document($1)'}[operation]
    return scalar(sql,args)
  }
  const jsonReply=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}})
  const byteReply=bytes=>new Response(bytes,{status:200,headers:{'content-type':'application/octet-stream','cache-control':'no-store'}})
  let lostAcknowledgement=false, callbackCount=0, byteReads=0, claimCount=0, failCount=0, corruptBytes=false
  const fixtureFetch = config => async (url,options) => {
    eq(options.redirect,'error','fixed callback rejects redirects'); eq(options.credentials,'omit','scanner sends no user credential/cookie')
    const isProcessing=url===`${TEST_ORIGIN}/api/portal/offering-documents/processing`
    truth(isProcessing||url===`${TEST_ORIGIN}/api/portal/offering-documents`,'fixed offering endpoint only')
    eq(options.method,isProcessing?'POST':'PATCH','fixed offering method only')
    const raw=Buffer.from(options.body),timestamp=options.headers['x-bx1-scanner-timestamp'],signature=options.headers['x-bx1-scanner-signature']
    const expected=createHmac('sha256',config.signingKey).update(isProcessing?'bx1-offering-document-processing-v1:':'bx1-offering-document-scan-v1:')
      .update(timestamp).update('.').update(raw).digest()
    truth(/^sha256=[0-9a-f]{64}$/.test(signature)&&timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')),'offering raw-body domain HMAC verified before decoding')
    truth(Math.abs(Date.now()-Number(timestamp)*1000)<=300000,'fixed bounded HMAC timestamp')
    const body=JSON.parse(raw.toString('utf8'))
    if(isProcessing&&body.command==='CLAIM'){
      eq(Object.keys(body).sort(),['command','request_id'],'exact CLAIM input'); claimCount++
      const job=await processing('claim',[worker,scanner,body.request_id])
      claimJournal.set(body.request_id,clone(job));return jsonReply({job})
    }
    if(isProcessing){
      eq(Object.keys(body).sort(),[...['command','file_id','attempt_id','authority_epoch','scanner_authority_epoch','sha256'],...(body.command==='FAIL'?['code']:[])].sort(),'exact BYTES/FAIL input')
      const manifest=await processing('read',[body.file_id,body.attempt_id,body.authority_epoch,worker,scanner])
      eq(manifest.scanner_authority_epoch,body.scanner_authority_epoch,'callback binds current scanner policy epoch'); eq(manifest.sha256,body.sha256,'callback binds immutable bytes')
      if(body.command==='FAIL'){failCount++;return jsonReply(await processing('fail',[body.file_id,body.attempt_id,body.authority_epoch,worker,scanner,body.code]))}
      eq(body.command,'BYTES','only exact leased BYTES supported'); byteReads++
      const bytes=Buffer.from(memory.get(manifest.storage_path)); eq(digest(bytes),manifest.sha256,'live-lease fixed-bucket original bytes are rehashed')
      await processing('read',[body.file_id,body.attempt_id,body.authority_epoch,worker,scanner])
      return byteReply(corruptBytes?Buffer.concat([bytes,Buffer.from('tamper')]):bytes)
    }
    eq(Object.keys(body).sort(),['file_id','sha256','verdict','reference','observed_at','authority_epoch','scanner_authority_epoch'].sort(),'exact result transport')
    callbackCount++
    const attempt=body.reference.slice('bx1-offering-scan:'.length)
    const input=await processing('scanInput',[body.file_id,attempt,body.authority_epoch,worker,scanner])
    eq(input.manifest.scanner_authority_epoch,body.scanner_authority_epoch,'scanner result current epoch')
    const bytes=Buffer.from(memory.get(input.manifest.storage_path)); eq(digest(bytes),body.sha256,'scanner callback rehashes immutable original bytes, even committed retry')
    const receipt=await processing('record',[body.file_id,body.sha256,scanner,body.reference,body.verdict,body.observed_at])
    truth(Number.isSafeInteger(receipt.scan_event_id)&&receipt.scan_event_id>0,'actual BIGINT scan event is a positive safe JSON number, never UUID')
    const committed=await processing('scanInput',[body.file_id,attempt,body.authority_epoch,worker,scanner])
    eq(committed.result.scan_event_id,receipt.scan_event_id,'post-record reread verifies exact committed event')
    for(const field of ['file_id','sha256','reference','verdict','authority_epoch','scanner_authority_epoch']) eq(committed.result[field],body[field],'full committed scanner result is exact')
    eq(Date.parse(committed.result.observed_at),Date.parse(body.observed_at),'database preserves exact observed instant')
    eq(Object.keys(committed.result).sort(),['file_id','attempt_id','scan_event_id','verdict','sha256','scanner_id','reference','observed_at','authority_epoch','scanner_authority_epoch'].sort(),'exact full recorded evidence wire shape')
    if(scanJournal.has(body.file_id))eq(committed.result,scanJournal.get(body.file_id),'same callback preserves exact originally observed result identity')
    else scanJournal.set(body.file_id,clone(committed.result))
    observedResults.set(body.file_id,clone(body))
    if(body.verdict==='CLEAN'){
      const copy=Buffer.from(bytes); eq(digest(copy),body.sha256,'actual fixture copy independently rehashed')
      await admin()
      await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata) values($1,$2,null,$3::jsonb,$4::jsonb) on conflict(bucket_id,name) do nothing',
        ['bx1-offering-documents',input.manifest.storage_path,JSON.stringify({size:copy.length,mimetype:'application/pdf'}),JSON.stringify({sha256:body.sha256})])
      cleanMemory.set(input.manifest.storage_path,copy)
      const clean=await processing('promote',[body.file_id]); eq(clean.sha256,digest(copy),'promotion binds independently verified clean copy'); eq(clean.state,'PROMOTED_CLEAN','promotion appends clean evidence, not quarantine relabel')
      truth(Number.isSafeInteger(clean.scan_event_id)&&clean.scan_event_id===receipt.scan_event_id,'promotion binds same actual numeric scan event ID')
      if(promotionJournal.has(body.file_id))eq(clean,promotionJournal.get(body.file_id),'same promotion retains the exact original clean receipt')
      else promotionJournal.set(body.file_id,clone(clean))
    }
    if(lostAcknowledgement){lostAcknowledgement=false;throw new Error('Synthetic response lost after exact native result and promotion')}
    return jsonReply({id:body.file_id,state:body.verdict==='CLEAN'?'PROMOTED_CLEAN':'REJECTED'})
  }
  const fileBody=(p,extra)=>({product_id:p.id,offering_revision_id:p.current_offering_revision_id,expected_revision:p.revision,...extra})
  const seal=async(p,ids,key=randomUUID(),client=db)=>fileCommand(p,'seal_offering_document_manifest',fileBody(p,{file_ids:ids,
    correspondence_statement:'Synthetic exact PDF content correspondence declaration only; not legal equivalence, signature or approval.'}),key,client)
  const reviewBody=(p,kind,decision)=>({product_id:p.id,expected_revision:p.revision,offering_revision_id:p.current_offering_revision_id,
    terms_hash:p.terms_hash,common_envelope_hash:awaitedHash(p,'common_envelope_hash'),deployment_configuration_hash:awaitedHash(p,'deployment_configuration_hash'),decision,
    notes:'Synthetic current review of exact PDF profile; genuine signature remains unavailable.',
    checks:kind==='ISSUER'?{issuer_authority:true,terms:true,rights:true}:{issuer:true,terms:true,disclosures:true,eligibility:true}})
  const revisionBindings=new Map()
  function awaitedHash(p,column){return revisionBindings.get(p.current_offering_revision_id)?.[column]??null}
  const bind=async p=>{await admin();revisionBindings.set(p.current_offering_revision_id,await scalar('select to_jsonb(r) from bx1_portal.offering_revisions r where id=$1',[p.current_offering_revision_id]))}
  const reopen=async p=>{
    const prior=clone(p),view=await command(1,manager,'reopen_offering_review',{product_id:p.id,expected_revision:p.revision,
      reason:'Synthetic same-terms PDF correction after every intent became terminal; historical evidence retained.'})
    const current=await refreshProduct(find(view,p.id)); eq(current.terms,prior.terms,'canonical correction retains exact full legal/economic/common terms')
    truth(current.current_offering_revision_id!==prior.current_offering_revision_id,'canonical correction creates a genuinely fresh revision')
    revisions.set(current.current_offering_revision_id,{product_id:current.id,terms:clone(current.terms)}); await bind(current)
    eq((await snapshot(current)).manifest,null,'fresh corrected revision never inherits old manifest/signatures'); return current
  }
  const sealWithUploadRace=async(p,files,key)=>{
    eq((await snapshot(p)).document_access.can_upload,true,'live manager upload capability exists BEFORE canonical seal')
    await commit()
    let pending,leaderCommitted=false,sealed,observed=false
    const late=randomUUID(),latePath=`${p.current_offering_revision_id}/${actor(1)}/${late}`
    await clients[1].query('begin');await clients[0].query('begin')
    try{
      const waiter=await scalar('select pg_backend_pid()',[],clients[0]),blocker=await scalar('select pg_backend_pid()',[],clients[1])
      truth(waiter!==blocker,'seal/upload race uses actual independent backends')
      sealed=await seal(p,files.map(file=>file.id),key,clients[1])
      await begin()
      eq((await snapshot(p)).state,'READY_TO_SEAL','independent app snapshot still sees READY before uncommitted seal')
      await commit()
      const a=attestation(1);await as('bx1_document_receipt_writer',clients[0])
      pending=scalar('select bx1_private.reserve_offering_file($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
        [actor(1),actor(101),'aal1',JSON.stringify(manager),p.id,p.current_offering_revision_id,late,'MEMORANDUM',
          'Synthetic late upload raced exact manifest seal',files[0].sha256,files[0].size,JSON.stringify(a)],clients[0]).then(value=>({value}),error=>({error}))
      const until=Date.now()+10000
      while(Date.now()<until){
        if(await scalar("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))",[waiter,blocker])){observed=true;break}
        await new Promise(resolve=>setTimeout(resolve,20))
      }
      truth(observed,'native late reservation actually waits behind uncommitted canonical seal')
      await clients[1].query('commit');leaderCommitted=true
      const completed=await pending
      eq(completed.error?.code,'42501','writer rechecks mutable revision after seal wins, before any late category/intent')
      eq(completed.value,undefined,'late upload receives no path/capability to stage bytes')
      console.log('BX1_OFFERING_DOCUMENT_UPLOAD_SEAL_WAIT',JSON.stringify({actual_distinct_backends:true,observed_database_lock:true,
        canonical_seal_committed_before_waiter:true,late_reserve_denied:'42501',late_intent:false,late_object:false}))
    }finally{
      await clients[1].query('rollback').catch(()=>{});await clients[0].query('rollback').catch(()=>{})
      if(pending)await pending
      await admin(clients[0]);await admin(clients[1]);await admin()
    }
    truth(leaderCommitted,'canonical sealed winner is really committed')
    await begin()
    eq(await scalar('select count(*)::int from bx1_portal.offering_file_upload_intents where id=$1',[late]),0,'actual rejected race leaves no late reservation')
    await denied('stale Storage upload cannot follow sealed race',async()=>{await claims(1);await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)',
      ['bx1-offering-quarantine',latePath,actor(1),JSON.stringify({size:files[0].size,mimetype:'application/pdf'})])})
    await denied('stale register cannot attach late bytes after sealed race',async()=>{
      const a=attestation(1);await as('bx1_document_receipt_writer');await scalar('select bx1_private.register_offering_file($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
        [actor(1),actor(101),'aal1',JSON.stringify(manager),p.id,p.current_offering_revision_id,late,'MEMORANDUM','Synthetic late upload raced exact manifest seal',files[0].sha256,files[0].size,JSON.stringify(a)])})
    eq(await scalar('select count(*)::int from storage.objects where name=$1',[latePath]),0,'actual restrictive upload rejection leaves no late object')
    return sealed
  }
  const sealWithPolicyRace=async(p,files,key)=>{
    await admin()
    const policy=await scalar('select to_jsonb(p) from bx1_private.offering_document_scanner_policy p where singleton')
    const beforeFunctions=await functions(),beforeSecurity=await security()
    const beforeRotation=await state(installedSpecs)
    const restoreCurrentPolicy=async()=>{
      await admin();await db.query('alter table bx1_private.offering_document_scanner_policy disable trigger offering_document_scanner_policy_guard')
      try{await db.query('update bx1_private.offering_document_scanner_policy set (singleton,state,worker_id,scanner_id,authority_epoch,changed_at)=(select singleton,state,worker_id,scanner_id,authority_epoch,changed_at from jsonb_populate_record(null::bx1_private.offering_document_scanner_policy,$1::jsonb)) where singleton',[JSON.stringify(policy)])}
      finally{await db.query('alter table bx1_private.offering_document_scanner_policy enable trigger offering_document_scanner_policy_guard')}
    }
    await commit()
    let staleSeal,rotationFirstCommitted=false
    await clients[1].query('begin');await clients[0].query('begin')
    try{
      const waiter=await scalar('select pg_backend_pid()',[],clients[0]),blocker=await scalar('select pg_backend_pid()',[],clients[1])
      truth(waiter!==blocker,'rotation-leading seal race uses actual independent PostgreSQL backends')
      await admin(clients[1]);await clients[1].query("update bx1_private.offering_document_scanner_policy set scanner_id='rotated-before-seal' where singleton")
      staleSeal=seal(p,files.map(file=>file.id),randomUUID(),clients[0]).then(value=>({value}),error=>({error}))
      let observed=false;const until=Date.now()+10000
      while(Date.now()<until){
        if(await scalar("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))",[waiter,blocker])){observed=true;break}
        await new Promise(resolve=>setTimeout(resolve,20))
      }
      truth(observed,'new seal actually waits on scanner policy row held by leading rotation')
      await clients[1].query('commit');rotationFirstCommitted=true
      const completed=await staleSeal
      eq(completed.error?.code,'23514','post-wait seal rejects all selected clean receipts from old epoch')
      eq(completed.value,undefined,'stale evidence yields no manifest or success receipt')
      console.log('BX1_OFFERING_DOCUMENT_ROTATION_SEAL_WAIT',JSON.stringify({actual_distinct_backends:true,observed_database_lock:true,
        rotation_committed_before_seal:true,post_wait_stale_evidence_denied:'23514',new_manifest:false}))
    }finally{
      await clients[1].query('rollback').catch(()=>{});await clients[0].query('rollback').catch(()=>{})
      if(staleSeal)await staleSeal
      await admin(clients[0]);await admin(clients[1]);await begin()
      if(rotationFirstCommitted)await restoreCurrentPolicy()
      eq(await state(installedSpecs),beforeRotation,'rotation-leading failed seal restores every row exactly, including no manifest/command/audit effect')
      eq(await functions(),beforeFunctions,'rotation-leading wait preserves every function row')
      eq(await security(),beforeSecurity,'rotation-leading wait restores exact policy guard/catalog')
      await commit()
    }
    let pending,sealed,observed=false,rotated=false,leaderCommitted=false
    await clients[1].query('begin');await clients[0].query('begin')
    try{
      const waiter=await scalar('select pg_backend_pid()',[],clients[0]),blocker=await scalar('select pg_backend_pid()',[],clients[1])
      truth(waiter!==blocker,'seal/policy race uses actual independent PostgreSQL backends')
      sealed=await seal(p,files.map(file=>file.id),key,clients[1])
      await admin(clients[0])
      pending=clients[0].query("update bx1_private.offering_document_scanner_policy set scanner_id='rotated-current-scanner' where singleton")
        .then(value=>({value}),error=>({error}))
      const until=Date.now()+10000
      while(Date.now()<until){
        if(await scalar("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))",[waiter,blocker])){observed=true;break}
        await new Promise(resolve=>setTimeout(resolve,20))
      }
      truth(observed,'ADMITTED-to-ADMITTED scanner rotation really waits behind seal policy SHARE lock')
      await clients[1].query('commit');leaderCommitted=true
      const completed=await pending;eq(completed.error,undefined,'rotation proceeds only after the sealed manifest commits')
      await clients[0].query('commit');rotated=true
      await begin()
      const current=await scalar('select to_jsonb(p) from bx1_private.offering_document_scanner_policy p where singleton')
      eq(current.authority_epoch,policy.authority_epoch+1,'actual policy rotation advances one current epoch')
      const closed=await snapshot(p,3,context('IssuerFundManager'))
      eq(closed.state,'SEALED_SIGNATURE_REQUIRED','immutable sealed evidence remains history after rotation')
      eq(closed.document_access.can_read_clean,false,'post-rotation old clean receipt grants no usable clean-byte capability')
      await denied('post-rotation current reviewer clean lookup closes',async()=>{await claims(3);await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',
        [JSON.stringify(context('IssuerFundManager')),p.current_offering_revision_id,files[0].id])},'P0002')
      await commit()
      console.log('BX1_OFFERING_DOCUMENT_SEAL_POLICY_WAIT',JSON.stringify({actual_distinct_backends:true,observed_database_lock:true,
        new_manifest_committed_before_rotation:true,policy_epoch_advanced:true,stale_clean_capability:false,provider_signature:false}))
    }finally{
      await clients[1].query('rollback').catch(()=>{});await clients[0].query('rollback').catch(()=>{})
      if(pending)await pending
      if(begun)await rollback()
      await admin(clients[0]);await admin(clients[1]);await begin()
      if(rotated)await restoreCurrentPolicy()
      eq(await scalar('select to_jsonb(p) from bx1_private.offering_document_scanner_policy p where singleton'),policy,'exact current policy fields/epoch/time restored after observed race')
      eq(await functions(),beforeFunctions,'policy race preserves every complete function row')
      eq(await security(),beforeSecurity,'policy race restores every role/ACL/RLS/trigger/constraint')
    }
    truth(leaderCommitted&&rotated,'real seal and blocked rotation both committed in observed order')
    eq((await snapshot(p)).document_access.can_read_clean,true,'exact policy restoration reopens only correctly bound sealed clean fixture')
    return sealed
  }

  const assertInheritedFunctions = async before => {
    const after=await functions()
    for(const row of before){
      const current=after.find(value=>value.oid===row.oid); truth(current,'every inherited function OID survives')
      const expected=clone(row)
      if(resultPins[row.signature]){
        eq(digest(normalized(current.catalog.prosrc)),resultPins[row.signature],'authorised replacement matches frozen RESULT body')
        expected.catalog.prosrc=current.catalog.prosrc
      }
      eq(current,expected,'complete inherited pg_proc differs only by an authorised exact body')
    }
    // regprocedure displays canonical type names (for example timestamptz as
    // timestamp with time zone). Resolve the unchanged explicit source list;
    // do not broaden it or compare differently rendered identity strings.
    const explicitHelpers=(await db.query(`select h.signature source_signature,
      pg_catalog.to_regprocedure(h.signature)::oid::text oid,
      pg_catalog.to_regprocedure(h.signature)::text canonical_signature
      from pg_catalog.unnest($1::text[]) h(signature)`,[helperSignatures])).rows
    eq(explicitHelpers.map(row=>row.source_signature).sort(),[...helperSignatures].sort(),'exact37 unchanged source helper signatures resolved')
    truth(explicitHelpers.every(row=>typeof row.oid==='string'&&/^[1-9][0-9]*$/.test(row.oid)),'all37 explicit helper identities are present')
    eq(new Set(explicitHelpers.map(row=>row.oid)).size,37,'all37 explicit helper identities are distinct')
    const addedOids=after.filter(row=>!before.some(old=>old.oid===row.oid)).map(row=>row.oid).sort()
    eq(addedOids,explicitHelpers.map(row=>row.oid).sort(),'no hidden helper/overload or alternate writer')
    const alias=explicitHelpers.find(row=>row.source_signature==='bx1_private.record_offering_document_scan(uuid,text,text,text,text,timestamptz)')
    truth(alias,'explicit timestamp-alias helper identity is retained')
    console.log('BX1_OFFERING_DOCUMENT_HELPER_IDENTITY_RECEIPT',JSON.stringify({explicit_source_count:explicitHelpers.length,
      resolved_distinct_count:new Set(explicitHelpers.map(row=>row.oid)).size,added_identity_count:addedOids.length,exact_added_set:true,
      source_signature:alias.source_signature,canonical_signature:alias.canonical_signature,identity_oid:alias.oid,
      fixture:'synthetic-cloud-PostgreSQL17',runtime_sql_changed:false}))
  }
  const assertInstalledSecurity=async()=>{
    const current=await security()
    for(const field of ['roles','edges','schemas','defaults'])eq(current[field],originalSecurity[field],`all inherited ${field} exact; no admission/role programme`)
    for(const field of ['relations','policies','triggers','constraints']){
      for(const row of originalSecurity[field]??[]){
        const found=(current[field]??[]).find(value=>field==='policies'?value.schemaname===row.schemaname&&value.tablename===row.tablename&&value.policyname===row.policyname:value.oid===row.oid)
        eq(found,row,`each inherited ${field} record exact`)
      }
    }
    const addedPolicies=(current.policies??[]).filter(row=>!originalSecurity.policies.some(old=>old.schemaname===row.schemaname&&old.tablename===row.tablename&&old.policyname===row.policyname))
    eq(addedPolicies.map(row=>row.policyname).sort(),['offering_document_clean_delete_restrict','offering_document_clean_insert_restrict','offering_document_clean_read_restrict','offering_document_clean_update_restrict'],'only4 fixed clean-bucket restrictive policies')
    for(const row of addedPolicies){eq(row.schemaname,'storage','fixed Storage schema');eq(row.tablename,'objects','fixed object relation');eq(row.permissive,'RESTRICTIVE','broad permissive policy cannot expose private clean bytes')}
    const oldOids=new Set(originalSpecs.map(row=>Number(row.oid))),newOids=new Set(installedSpecs.filter(row=>!oldOids.has(Number(row.oid))).map(row=>Number(row.oid)))
    const inheritedTriggers=(current.triggers??[]).filter(row=>oldOids.has(Number(row.tgrelid))&&!originalSecurity.triggers.some(old=>old.oid===row.oid))
    eq(inheritedTriggers.map(row=>row.tgname).sort(),['offering_document_processing_enqueue','offering_document_profile_new_revision'],'only exact additive offering triggers touch inherited tables')
    for(const row of (current.constraints??[]).filter(row=>!originalSecurity.constraints.some(old=>old.oid===row.oid))){truth(newOids.has(Number(row.conrelid)),'every new constraint belongs to explicitly owned new table');eq(row.convalidated,true,'no unvalidated constraint')}
  }
  const committed = []
  let configBefore, factorInserted=false, policiesBefore, sealedProducts=[]
  const restoreFixtures=async()=>{
    await admin()
    if(configBefore){
      await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=$1 where singleton',[configBefore.test_ordinary_entry_enabled])
      eq(await scalar('select to_jsonb(c) from bx1_portal.entry_configuration c where singleton'),configBefore,'exact captured ordinary-entry configuration restored')
    }
    if(factorInserted){await db.query('delete from auth.mfa_factors where id=$1 and user_id=$2',[actor(201),actor(1)]);factorInserted=false}
    if(policiesBefore){
      for(const [name,row]of Object.entries(policiesBefore)){
        assert.ok(['offering_document_policy','offering_document_scanner_policy'].includes(name))
        const trigger=name==='offering_document_policy'?'offering_document_policy_guard':'offering_document_scanner_policy_guard'
        await db.query(`alter table bx1_private.${name} disable trigger ${trigger}`)
        try{
          const fields=Object.keys(row);for(const field of fields)assert.match(field,/^[a-z_]+$/)
          await db.query(`update bx1_private.${name} p set (${fields.join(',')})=(select ${fields.join(',')} from jsonb_populate_record(null::bx1_private.${name},$1::jsonb)) where singleton`,[JSON.stringify(row)])
        }finally{await db.query(`alter table bx1_private.${name} enable trigger ${trigger}`)}
        eq(await scalar(`select to_jsonb(p) from bx1_private.${name} p where singleton`),row,'exact NOT_ADMITTED policy/epoch/time fixture restored')
      }
    }
  }
  try{
    await admin();eq(await scalar("select current_database()='bx1_demo_ci'"),true,'exact disposable database')
    truth(Number(await scalar('show server_version_num'))>=170000&&Number(await scalar('show server_version_num'))<180000,'pinned PostgreSQL17')
    eq(await scalar('show statement_timeout'),'15s','strict SQL deadline unchanged')
    originalSpecs=await relationSpecs();originalRows=await state(originalSpecs);originalFunctions=await functions();originalSecurity=await security()
    for(const pin of pins){const current=originalFunctions.find(row=>row.signature===pin.signature);truth(current,'accepted source target exists');eq(digest(normalized(current.catalog.prosrc)),pin.sha256,'complete old body equals explicit accepted-source pin')}
    const admitted=originalRows['bx1_portal.applications'].find(row=>row.user_id===actor(1)&&row.persona==='WEALTH_MANAGER'&&row.status==='APPROVED')
    truth(admitted,'reuse retained admitted manager fixture, not fabricated human');organisation=admitted.organisation_id
    const mandate=originalRows['bx1_portal.representative_mandates'].find(row=>row.application_id===admitted.id&&row.status==='APPLIED')
    truth(mandate,'reuse existing canonical applied mandate');manager=context('OfferingManager',mandate.native_organisation_id)
    baseTerms={};for(const asset of ['FUND','REAL_ESTATE']){
      const item=originalRows['bx1_portal.products'].find(row=>row.organisation_id===organisation&&row.terms.asset_type===asset&&row.terms.terms_version===3
        &&row.terms.common_envelope.issuer.declaration_revision===1)
      truth(item,`accepted existing full v3 ${asset} input`);baseTerms[asset]=clone(item.terms)
    }
    await begin();phase='installation-preflight-negatives'
    for(const [label,mutation]of[
      ['complete body',async()=>{const old=await scalar("select pg_get_functiondef('bx1_portal.offering_file_manager(uuid)'::regprocedure)");await db.query(old.replace('begin','begin\n  -- deliberately changed fixture body'))}],
      ['security',()=>db.query('alter function bx1_portal.offering_file_manager(uuid) security invoker')],
      ['search_path',()=>db.query("alter function bx1_portal.offering_file_manager(uuid) set search_path=public")],
      ['strictness',()=>db.query('alter function bx1_portal.offering_file_manager(uuid) strict')],
      ['ACL',()=>db.query('grant execute on function bx1_portal.offering_file_manager(uuid) to anon')],
      ['cost',()=>db.query('alter function bx1_portal.offering_file_manager(uuid) cost 101')],
    ])await isolated(async()=>{await mutation();await denied(`installer rejects ${label} drift atomically`,()=>db.query(featureSql),'55000',originalSpecs)})
    eq(await functions(),originalFunctions,'all metadata drift fixtures restore original function rows');eq(await security(),originalSecurity,'failed installs restore full security');eq(await state(originalSpecs),originalRows,'failed installs restore every original row')
    phase='install';await db.query(featureSql)
    installedSpecs=await relationSpecs();eq(installedSpecs.filter(row=>!originalSpecs.some(old=>old.oid===row.oid)).map(row=>`${row.nspname}.${row.relname}`).sort(),tables.map(name=>`bx1_private.${name}`).sort(),'exact12 additive private tables, no schema wildcard')
    installedRows=await state(installedSpecs)
    for(const [name,rows]of Object.entries(originalRows)){
      if(name==='storage.buckets')eq(installedRows[name],[...rows,{id:'bx1-offering-documents',name:'bx1-offering-documents',public:false,file_size_limit:4194304,allowed_mime_types:['application/pdf']}].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))), 'only exact private fixed clean bucket added')
      else eq(installedRows[name],rows,'installation retains every inherited row, no profile backfill')
    }
    for(const name of tables){
      eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',[`bx1_private.${name}`]),true,'every new table has RLS')
      for(const role of roles)eq(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",[role,`bx1_private.${name}`]),false,'all new data access is function-only')
    }
    for(const name of ['offering_document_policy','offering_document_scanner_policy']){eq(installedRows[`bx1_private.${name}`][0].state,'NOT_ADMITTED','installation does not admit scanner/upload');eq(installedRows[`bx1_private.${name}`][0].authority_epoch,1,'initial epoch exactly1')}
    await assertInheritedFunctions(originalFunctions);await assertInstalledSecurity()
    for(const signature of helperSignatures){
      const expected=helperDeclarations.get(signature)
      const actual=await scalar(`select jsonb_build_object('owner',r.rolname,'language',l.lanname,'volatility',p.provolatile,'security_definer',p.prosecdef,
        'config',p.proconfig,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,'defaults',p.pronargdefaults,
        'result',p.prorettype::regtype::text,'argnames',p.proargnames,'body',p.prosrc,
        'canonical',p.prokind='f' and not p.proretset and p.procost=100 and p.prorows=0 and p.provariadic=0 and p.prosupport=0
          and p.proargdefaults is null and p.proallargtypes is null and p.proargmodes is null and p.protrftypes is null
          and p.probin is null and p.prosqlbody is null)
        from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.oid=$1::regprocedure`,[signature])
      eq({...actual,body:digest(normalized(actual.body))},{owner:'postgres',language:expected.language,volatility:expected.volatility,security_definer:true,
        config:['search_path=""'],strict:false,leakproof:false,parallel:'u',defaults:0,result:expected.result,argnames:expected.argnames,body:expected.bodyHash,canonical:true},'every new helper exact independently source-defined metadata/body')
      const granted=await scalar(`select coalesce(jsonb_agg(r.rolname::text order by r.rolname::text),'[]') from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee where p.oid=$1::regprocedure`,[signature])
      const recipients=['postgres'];if(/\.(claim|read|fail)_offering_document_processing\(/.test(signature))recipients.push('bx1_document_processing_worker')
      if(/\.(read_offering_document_scan_input|record_offering_document_scan|promote_scanned_offering_document)\(/.test(signature))recipients.push('bx1_document_scanner_writer')
      if(/\.(reserve_offering_file|register_offering_file|read_offering_documents|execute_offering_document_command)\(/.test(signature))recipients.push('bx1_document_receipt_writer')
      eq(granted,recipients.sort(),'new helper exact function-only grant recipients; no public default EXECUTE')
      eq(await scalar(`select not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=$1::regprocedure and (a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable))`,[signature]),true,'new grantors/options/types exact')
    }
    installedFunctions=await functions();installedSecurity=await security();await commit()
    configBefore=clone(originalRows['bx1_portal.entry_configuration'][0])
    policiesBefore=Object.fromEntries(['offering_document_policy','offering_document_scanner_policy'].map(name=>[name,clone(installedRows[`bx1_private.${name}`][0])]))
    await begin();phase='connected-real-byte-flow'
    eq(await scalar("select count(*)::int from auth.mfa_factors where id=$1",[actor(201)]),0,'only absent manager fixture factor may be enrolled')
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[actor(201),actor(1)]);factorInserted=true
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
    await claims(1)
    const initialClaims=await scalar("select current_setting('request.jwt.claims')")
    await admin()
    eq(await scalar("select current_setting('request.jwt.claims')"),initialClaims,'RESET ROLE preserves exact initial authenticated JWT claims for owner-only observations')
    eq(await scalar('select bx1_portal.fresh_session()'),false,'enrolled AAL1 does NOT acquire native freshness')
    eq(await scalar('select bx1_portal.admission_password_session()'),true,'exact existing admitted TEST password path survives enrollment')
    eq(await scalar("select current_setting('request.jwt.claims')"),initialClaims,'both owner-only session observations preserve exact authenticated JWT claims')
    await admin()
    const first=await create('FUND','Synthetic real PDF fund connected flow')
    await denied('NOT_ADMITTED reserves no profile intent',()=>reserve(first,'MEMORANDUM',Buffer.from('%PDF-1.4\n%%EOF\n')))
    await denied('NOT_ADMITTED worker has no queue authority',()=>processing('claim',[worker,scanner,randomUUID()]))
    await admin();await db.query("update bx1_private.offering_document_policy set state='ADMITTED' where singleton")
    await db.query("update bx1_private.offering_document_scanner_policy set state='ADMITTED',worker_id=$1,scanner_id=$2 where singleton",[worker,scanner])
    await runCloudEngineProof(async fixture=>{
      const config={origin:TEST_ORIGIN,workerId:worker,scannerId:scanner,signingKey:Buffer.alloc(32,71),databasePath:fixture.databasePath,databaseSha256:fixture.databaseSha256}
      const fetchImpl=fixtureFetch(config)
      const variant=label=>{
        const bytes=Buffer.from(fixture.benignPdf),text='BlockXOne harmless clean scanner fixture',offset=bytes.indexOf(Buffer.from(text))
        truth(offset>=0,'independently produced valid uncompressed PDF contains expected text stream')
        truth(label.length<=text.length,'fixed-length text variation preserves PDF xref/stream lengths')
        Buffer.from(label.padEnd(text.length,' ')).copy(bytes,offset);return bytes
      }
      for(const asset of ['FUND','REAL_ESTATE']){
        let p=asset==='FUND'?first:await create(asset,'Synthetic real PDF property connected flow');await bind(p)
        await appoint(p,'IssuerFundManager',3);await appoint(p,'ComplianceOfficer',2)
        await denied('profile approval before files is blocked',()=>command(3,context('IssuerFundManager'),'review_offering_issuer',reviewBody(p,'ISSUER','APPROVED')),'23514',installedSpecs,'offering_document_signature_not_connected')
        const memor=await register(p,'MEMORANDUM',variant(`${asset} memorandum first revision`))
        const risk=await register(p,'RISKS',fixture.detectionPdf)
        const abandoned=await reserve(p,'SUBSCRIPTION_TERMS',variant(`${asset} abandoned reservation`))
        await denied('unresolved intents prevent canonical correction',()=>reopen(p),'23514')
        lostAcknowledgement=true
        const clean=await runOfferingOnce(config,{fetchImpl})
        eq(clean.outcome,'RESULT_ACCEPTED','real clean engine result recovers lost acknowledgement without FAIL/rescan')
        eq(clean.verdict,'CLEAN','actual pinned engine clean verdict');eq(clean.engine.byteSha256,memor.sha256,'real engine receipt binds exact first original bytes')
        const malicious=await runOfferingOnce(config,{fetchImpl})
        eq(malicious.outcome,'RESULT_ACCEPTED','actual harmless detection PDF is terminally rejected');eq(malicious.verdict,'MALICIOUS','real pinned custom fixture detection, not SQL injected')
        const resolveBody=fileBody(p,{intent_id:abandoned.id,reason:'Synthetic abandoned reservation intentionally excluded without uploading bytes or fabricating a scan.'}),resolveKey=randomUUID()
        const resolved=await fileCommand(p,'resolve_offering_file_intent',resolveBody,resolveKey)
        eq(resolved.files.find(file=>file.id===abandoned.id).intent_state,'EXCLUDED','abandoned intent receives append-only terminal exclusion')
        const resolvedState=await state(installedSpecs)
        eq(await fileCommand(p,'resolve_offering_file_intent',resolveBody,resolveKey),resolved,'exact resolution key returns current same snapshot')
        eq(await state(installedSpecs),resolvedState,'resolution retry has exactly one native effect')
        await denied('conflicting resolution key fails',()=>fileCommand(p,'resolve_offering_file_intent',{...resolveBody,reason:`${resolveBody.reason} conflict`},resolveKey),'23505')
        p=await reopen(p)
        const files=[]
        for(const kind of ['MEMORANDUM','RISKS','SUBSCRIPTION_TERMS'])files.push(await register(p,kind,variant(`${asset} ${kind} PDF`)))
        eq(new Set(files.map(file=>file.sha256)).size,3,'three actual PDF byte digests remain distinct')
        for(let index=0;index<3;index++){
          const result=await runOfferingOnce(config,{fetchImpl})
          eq(result.outcome,'RESULT_ACCEPTED','actual original PDF processed through real pinned engine/verified callback/copy');eq(result.verdict,'CLEAN','no injected CLEAN positive')
          eq(result.engine.databaseSha256,fixture.databaseSha256,'actual controlled fixture database hash pinned')
        }
        eq((await snapshot(p)).state,'READY_TO_SEAL','all3 clean receipts and terminal intents derive readiness')
        await denied('missing category cannot seal',()=>seal(p,[files[0].id,files[1].id]),'22023')
        await denied('duplicate categories/identities cannot seal',()=>seal(p,[files[0].id,files[0].id,files[2].id]),'23514')
        await denied('reordered canonical entries cannot seal',()=>seal(p,[files[1].id,files[0].id,files[2].id]),'23514')
        await isolated(async()=>{
          await admin();await db.query('create trigger offering_document_fixture_audit_failure before insert on bx1_portal.events for each row execute function bx1_portal.immutable_record()')
          await denied('audit refusal rolls seal/command receipt/manifest back atomically',()=>seal(p,files.map(file=>file.id)),'23514')
        })
        const sealKey=randomUUID(),sealed=await (asset==='FUND'?sealWithUploadRace:sealWithPolicyRace)(p,files,sealKey)
        eq(sealed.state,'SEALED_SIGNATURE_REQUIRED','sealed manifest does not invent a signature/approval');eq(sealed.document_access.approval_allowed,false,'approval remains blocked')
        eq(sealed.manifest.file_ids,files.map(file=>file.id),'manifest uses canonical exact ordered identities')
        const beforeRetry=await state(installedSpecs)
        eq(await seal(p,files.map(file=>file.id),sealKey),sealed,'same seal key returns current exact manifest even after sealed state')
        eq(await state(installedSpecs),beforeRetry,'one manifest/receipt/audit for exact repeated seal key')
        await denied('conflicting seal input cannot reuse committed key',()=>seal(p,[files[1].id,files[0].id,files[2].id],sealKey),'23505')
        await denied('profile issuer approval after sealing remains blocked',()=>command(3,context('IssuerFundManager'),'review_offering_issuer',reviewBody(p,'ISSUER','APPROVED')),'23514',installedSpecs,'offering_document_signature_not_connected')
        await denied('profile Compliance approval after sealing remains blocked',()=>command(2,context('ComplianceOfficer'),'review_product',reviewBody(p,'COMPLIANCE','APPROVED')),'23514',installedSpecs,'offering_document_signature_not_connected')
        await denied('old NULL writer signature cannot occupy profiled revision',()=>reserve(p,'RISKS',fixture.benignPdf,'legacy NULL bypass',randomUUID(),true))
        const manifestRow=await scalar('select to_jsonb(m) from bx1_private.offering_document_manifests m where id=$1',[sealed.manifest.id])
        eq(manifestRow.hash,await scalar("select encode(sha256(convert_to('bx1-offering-document-manifest-v1:'||$1::jsonb::text,'UTF8')),'hex')",[JSON.stringify(manifestRow.evidence)]),'independent full domain-separated manifest digest')
        eq(manifestRow.evidence.document_hashes,revisionBindings.get(p.current_offering_revision_id).document_hashes,'retained text hashes separate from original byte hashes')
        truth(files.every(file=>!Object.values(manifestRow.evidence.document_hashes).includes(file.sha256)),'text digest is never claimed as exact PDF digest')
        for(const [n,c]of [[1,manager],[2,context('ComplianceOfficer')],[3,context('IssuerFundManager')]]){
          await claims(n);const lookup=await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',[JSON.stringify(c),p.current_offering_revision_id,files[0].id])
          eq(lookup.bucket,'bx1-offering-documents','current appointed reviewer uses scoped clean proxy only');eq(lookup.uploader_id,actor(1),'uploader derives immutable original identity, not Storage owner')
          eq(lookup.manifest_id,sealed.manifest.id,'pre-download exact immutable manifest binding')
          const downloaded=Buffer.from(cleanMemory.get(lookup.storage_path));eq(digest(downloaded),lookup.sha256,'actual fixture clean bytes rehashed')
          await claims(n);eq(await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',[JSON.stringify(c),p.current_offering_revision_id,files[0].id]),lookup,'post-download exact current scoped binding rechecked')
          await db.query("select set_config('request.storage.operation','object.get_authenticated',true)")
          eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-offering-documents' and name=$1",[lookup.storage_path]),0,'even original owner/current reviewer cannot bypass proxy through clean Storage')
        }
        await claims(2);await db.query("select set_config('request.storage.operation','object.get_authenticated',true)")
        eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-offering-quarantine' and name=$1",[files[0].path]),0,'reviewer has no raw quarantine byte access')
        await denied('anonymous has no direct clean schema/object access',async()=>{await as('anon');await scalar("select count(*) from storage.objects where bucket_id='bx1-offering-documents'")})
        await denied('wrong organisation has no clean lookup',async()=>{await claims(3);await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',[JSON.stringify(context('IssuerFundManager',organisation)),p.current_offering_revision_id,files[0].id])})
        const result=observedResults.get(files[0].id),attempt=result.reference.slice('bx1-offering-scan:'.length)
        await denied('conflicting actual scan callback cannot change result',()=>processing('record',[result.file_id,'f'.repeat(64),scanner,result.reference,result.verdict,result.observed_at]))
        const priorResult=await state(installedSpecs)
        await processing('record',[result.file_id,result.sha256,scanner,result.reference,result.verdict,result.observed_at])
        eq(await state(installedSpecs),priorResult,'committed exact result retry changes no evidence/job/state')
        await isolated(async()=>{
          await admin();await db.query('alter table bx1_private.offering_document_processing_attempts disable trigger offering_document_attempt_identity')
          try{await db.query("update bx1_private.offering_document_processing_attempts set started_at=aged.expired_at,lease_expires_at=aged.expired_at+interval '120 seconds' from (select clock_timestamp()-interval '121 seconds' AS expired_at) aged where id=$1",[attempt])}
          finally{await db.query('alter table bx1_private.offering_document_processing_attempts enable trigger offering_document_attempt_identity')}
          const recovery=await processing('scanInput',[result.file_id,attempt,result.authority_epoch,worker,scanner]);eq(recovery.result.verdict,'CLEAN','committed current metadata remains readable after lease expiry')
          await denied('worker BYTES still rejects completed/expired input',()=>processing('read',[result.file_id,attempt,result.authority_epoch,worker,scanner]))
          const request=signedRequest(result,config,'offering-result')
          eq((await recoverOfferingResult({kind:'OFFERING_RESULT_RECOVERY',request,fileId:result.file_id,verdict:'CLEAN'},config,{fetchImpl})).outcome,'RESULT_ACCEPTED','actual immutable bytes rehashed for exact recorded recovery, not a rescan')
        })
        sealedProducts.push({p,files,sealKey,sealBody:fileBody(p,{file_ids:files.map(file=>file.id),correspondence_statement:sealed.manifest.correspondence_statement}),manifest:sealed.manifest})
      }
      eq(failCount,0,'lost successful callback never issues FAIL');truth(callbackCount>10,'lost acknowledgement recovery and exact native retries exercised');truth(byteReads>=10,'both assets actual leased original PDFs retrieved');truth(claimCount>=10,'bounded durable CLAIM handoff exercised')
      for(const [label,bytes,tamper,expectedCode]of[
        ['wrong downloaded bytes',fixture.benignPdf,true,'HASH_MISMATCH'],
        ['malformed PDF',Buffer.from('%PDF-1.4\nSynthetic missing end marker\n'),false,'INVALID_DOCUMENT'],
      ])await isolated(async()=>{
        const p=await create('FUND',`Synthetic ${label} processing fence`),file=await register(p,'MEMORANDUM',bytes)
        corruptBytes=tamper
        try{const result=await runOfferingOnce(config,{fetchImpl});eq(result.outcome,'PROCESSING_FAILED',`${label}: real wire-to-SQL processing fails closed`);eq(result.code,expectedCode,'specific byte-validation failure, not a mock verdict');eq(result.state,'EXHAUSTED','invalid immutable bytes cannot silently retry into CLEAN')}
        finally{corruptBytes=false}
        await admin()
        eq(await scalar('select count(*)::int from bx1_private.offering_document_scan_events where file_id=$1',[file.id]),0,'bad-byte processing creates no CLEAN/MALICIOUS scan attestation')
      })
      await isolated(async()=>{
        const p=await create('FUND','Synthetic register and exclusion audit atomicity'),file=await reserve(p,'MEMORANDUM',fixture.benignPdf)
        const abandoned=await reserve(p,'RISKS',fixture.benignPdf)
        await claims(1);await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata) values($1,$2,$3,$4::jsonb,$5::jsonb)',
          ['bx1-offering-quarantine',file.path,actor(1),JSON.stringify({size:fixture.benignPdf.length,mimetype:'application/pdf'}),JSON.stringify({sha256:file.sha256})])
        memory.set(file.path,Buffer.from(fixture.benignPdf));eq(digest(memory.get(file.path)),file.sha256,'audit-negative input is exact independently verified source bytes')
        await admin();await db.query('create trigger offering_document_fixture_audit_failure before insert on bx1_portal.events for each row execute function bx1_portal.immutable_record()')
        await denied('audit refusal rolls canonical file/job/event registration back',async()=>{
          const a=attestation(1);await as('bx1_document_receipt_writer');await scalar('select bx1_private.register_offering_file($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
            [actor(1),actor(101),'aal1',JSON.stringify(manager),p.id,p.current_offering_revision_id,file.id,'MEMORANDUM',authoredFiles.find(row=>row.id===file.id).title,file.sha256,file.size,JSON.stringify(a)])
        },'23514')
        await denied('audit refusal rolls intent resolution and command receipt back',()=>fileCommand(p,'resolve_offering_file_intent',fileBody(p,{intent_id:abandoned.id,
          reason:'Synthetic exclusion must leave no immutable resolution if its authoritative audit cannot be appended.'})),'23514')
      })
      await denied('cross-product current revision cannot return another package clean file',async()=>{await claims(3);await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',
        [JSON.stringify(context('IssuerFundManager')),sealedProducts[1].p.current_offering_revision_id,sealedProducts[0].files[0].id])},'P0002')
      const realResult=observedResults.get(sealedProducts[0].files[0].id)
      await denied('cross-file scan reference cannot claim another actual file',()=>processing('record',[sealedProducts[1].files[0].id,realResult.sha256,scanner,realResult.reference,realResult.verdict,realResult.observed_at]))
    })
    await commit();phase='real-observed-revocation-waits'
    const target=sealedProducts[0]
    for(const [n,c]of[[1,manager],[3,context('IssuerFundManager')],[2,context('ComplianceOfficer')]]){
      const before=await state(installedSpecs),beforeFunctions=await functions(),beforeSecurity=await security()
      const membership=await scalar('select to_jsonb(m) from public.bx1_memberships m where user_id=$1 and role=$2 and organisation_id=$3',[actor(n),c.role,c.organisationId])
      truth(membership,'exact retained current actor membership exists for observed wait')
      await begin();eq((await snapshot(target.p,n,c)).document_access.can_read_clean,true,'positive current clean capability before revocation wait');await commit()
      let pending,observed=false,changed=false
      await clients[1].query('begin');await admin(clients[1])
      await clients[0].query('begin');await admin(clients[0])
      try{
        const blocker=await scalar('select pg_backend_pid()',[],clients[1]),waiter=await scalar('select pg_backend_pid()',[],clients[0])
        truth(blocker!==waiter,'actual independent PostgreSQL backends, not a mocked lock')
        await clients[1].query('select id from auth.users where id=$1 for update',[actor(n)])
        pending=(n===1?fileCommand(target.p,'seal_offering_document_manifest',target.sealBody,target.sealKey,clients[0])
          :snapshot(target.p,n,c,clients[0])).then(value=>({value}),error=>({error}))
        const until=Date.now()+10000
        while(Date.now()<until){
          if(await scalar("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))",[waiter,blocker])){observed=true;break}
          await new Promise(resolve=>setTimeout(resolve,20))
        }
        truth(observed,'database reports real caller wait on exact authority row')
        await clients[1].query("update public.bx1_memberships set status='SUSPENDED' where id=$1",[membership.id])
        await clients[1].query('commit');changed=true
        const completed=await pending
        eq(completed.error?.code,'42501','post-wait native current manager/reviewer authority rejects before metadata/byte release')
        eq(completed.value,undefined,'revoked caller receives no usable clean capability or manifest disclosure')
        console.log('BX1_OFFERING_DOCUMENT_WAIT',JSON.stringify({role:c.role,actual_distinct_backends:true,observed_database_lock:true,
          native_membership_suspended_before_release:true,operation:n===1?'EXACT_SEAL_WRITE_REPLAY':'CURRENT_CLEAN_READ',
          denied:'42501',clean_bytes_released:false,independent_humans:false}))
      }finally{
        await clients[1].query('rollback').catch(()=>{});await clients[0].query('rollback').catch(()=>{})
        await admin(clients[0]);await admin(clients[1]);await admin()
        if(changed)await db.query('update public.bx1_memberships set status=$1 where id=$2',[membership.status,membership.id])
        if(pending)await pending
      }
      eq(await state(installedSpecs),before,'each observed wait restores every relation row without a wildcard waiver')
      eq(await functions(),beforeFunctions,'each wait preserves all function bodies/metadata');eq(await security(),beforeSecurity,'each wait restores every role/ACL/RLS/guard')
    }
    await begin();phase='recovery-and-fences'
    await isolated(async()=>{
      const p=await create('FUND','Synthetic bounded PDF failure retry fixture')
      const file=await register(p,'MEMORANDUM',Buffer.from('%PDF-1.4\nSynthetic engine-unavailable failure fixture\n%%EOF\n'))
      for(let attempt=1;attempt<=5;attempt++){
        const request=randomUUID(),manifest=await processing('claim',[worker,scanner,request])
        eq(manifest.file_id,file.id,'bounded retry claim binds same immutable file');eq(manifest.attempt_number,attempt,'attempt counter never resets')
        eq(await processing('claim',[worker,scanner,request]),manifest,'stable CLAIM key cannot fork attempt')
        if(attempt===1){
          await denied('changed scanner cannot reuse CLAIM key',()=>processing('claim',[worker,'wrong-scanner',request]),'23505',installedSpecs,'offering_document_claim_conflict')
          await isolated(async()=>{
            await admin();await db.query('alter table bx1_private.offering_document_processing_attempts disable trigger offering_document_attempt_identity')
            try{await db.query("update bx1_private.offering_document_processing_attempts set started_at=aged.expired_at,lease_expires_at=aged.expired_at+interval '120 seconds' from (select clock_timestamp()-interval '121 seconds' AS expired_at) aged where id=$1",[manifest.attempt_id])}
            finally{await db.query('alter table bx1_private.offering_document_processing_attempts enable trigger offering_document_attempt_identity')}
            await denied('uncommitted expired scanner metadata remains denied',()=>processing('scanInput',[file.id,manifest.attempt_id,manifest.authority_epoch,worker,scanner]))
            await denied('uncommitted expired result cannot become CLEAN',()=>processing('record',[file.id,file.sha256,scanner,manifest.reference,'CLEAN',new Date().toISOString()]))
          })
        }
        const failed=await processing('fail',[file.id,manifest.attempt_id,manifest.authority_epoch,worker,scanner,'ENGINE_UNAVAILABLE'])
        eq(failed.state,attempt===5?'EXHAUSTED':'RETRY_WAIT','5 attempts then terminal exhaustion')
        if(attempt<5){
          await admin()
          const delay=await scalar("select extract(epoch from j.next_attempt_at-a.finished_at)::int from bx1_private.offering_document_processing_jobs j join bx1_private.offering_document_processing_attempts a on a.id=j.current_attempt_id where j.file_id=$1",[file.id])
          eq(delay,30,'database derives exact30-second backoff')
          await admin();await db.query("update bx1_private.offering_document_processing_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where file_id=$1",[file.id])
        }
      }
      eq(await processing('claim',[worker,scanner,randomUUID()]),null,'exhausted job never receives sixth attempt')
      const row=await fileCommand(p,'resolve_offering_file_intent',fileBody(p,{intent_id:file.id,reason:'Synthetic exhausted engine-error job excluded; no clean scan or complete document is fabricated.'}))
      eq(row.files[0].intent_state,'EXCLUDED','manager can resolve exhausted unselected job without inventing scan')
      await admin()
      eq(await scalar('select count(*)::int from bx1_private.offering_document_scan_events where file_id=$1',[file.id]),0,'failure fixture creates no fake CLEAN result')
    })
    const retryState=await state(installedSpecs)
    await isolated(async()=>{
      await admin();await db.query("update bx1_private.offering_document_scanner_policy set scanner_id='different-current-scanner' where singleton")
      const result=observedResults.get(target.files[0].id)
      await denied('changed scanner-policy epoch invalidates exact old committed result',()=>processing('record',[result.file_id,result.sha256,scanner,result.reference,result.verdict,result.observed_at]))
      await claims(3);eq((await snapshot(target.p,3,context('IssuerFundManager'))).document_access.can_read_clean,false,'policy epoch drift closes old clean byte authority without erasing manifest')
    })
    eq(await state(installedSpecs),retryState,'policy epoch negative restores exact evidence and policy')
    if(proveConnectedSignatures) checks+=await proveConnectedSignatures(db,clients,{products:sealedProducts,manager})
    for(const item of sealedProducts){
      let p=item.p
      await bind(p)
      p=await refreshProduct(find(await command(3,context('IssuerFundManager'),'review_offering_issuer',reviewBody(p,'ISSUER','CHANGES_REQUIRED')),p.id))
      eq(p.status,'CHANGES_REQUIRED','genuine business CHANGES_REQUIRED remains available while signatures absent')
      const oldRevision=p.current_offering_revision_id
      p=await reopen(p)
      await denied('old clean file cannot leak through fresh corrected revision',async()=>{await claims(3);await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',[JSON.stringify(context('IssuerFundManager')),p.current_offering_revision_id,item.files[0].id])},'P0002')
      await denied('stale sealed revision has no reviewer clean bytes',async()=>{await claims(3);await scalar('select bx1_portal.lookup_offering_file($1::jsonb,$2,$3)',[JSON.stringify(context('IssuerFundManager')),oldRevision,item.files[0].id])},'P0002')
      committed.push({product_id:p.id,old_revision:oldRevision,current_revision:p.current_offering_revision_id,terms:clone(p.terms)})
    }
    await restoreFixtures();await commit();phase='complete-footprints'
    const finalRows=await state(installedSpecs)
    const additions={}
    for(const [name,old]of Object.entries(installedRows)){
      const remaining=[...finalRows[name]]
      for(const row of old){const index=remaining.findIndex(value=>JSON.stringify(value)===JSON.stringify(row));truth(index>=0,`${name}: every exact installed original row retained`);remaining.splice(index,1)}
      additions[name]=remaining
    }
    const nativeAllowed=new Set(['bx1_portal.products','bx1_portal.product_issuer_declarations','bx1_portal.offering_revisions','bx1_portal.offering_decisions',
      'bx1_portal.product_service_appointments','bx1_portal.product_service_appointment_requests','bx1_portal.product_service_appointment_receipts',
      'bx1_portal.requests','bx1_portal.scoped_requests','bx1_portal.events','bx1_portal.offering_review_reopen_receipts',
      'bx1_portal.offering_file_upload_intents','bx1_portal.offering_file_quarantine','storage.objects'])
    for(const [name,rows]of Object.entries(additions))if(!nativeAllowed.has(name)&&!tables.map(table=>`bx1_private.${table}`).includes(name))eq(rows,[],`${name}: no unrelated native/admission/provider/person/role/wallet/money mutation`)
    eq(additions['bx1_portal.products'].map(row=>row.id).sort(),[...products].sort(),'exact finite product input journal')
    for(const row of additions['bx1_portal.products']){const expected=committed.find(value=>value.product_id===row.id);truth(expected,'one connected final product record');eq(row.terms,expected.terms,'exact retained full terms');eq(row.current_offering_revision_id,expected.current_revision,'canonical fresh pointer');eq([row.status,row.reserved_units,row.published_at],['IN_REVIEW',0,null],'no funding/publication effect')}
    eq(additions['bx1_portal.offering_revisions'].map(row=>row.id).sort(),[...revisions.keys()].sort(),'exact finite canonical revision journal')
    for(const row of additions['bx1_portal.offering_revisions']){const expected=revisions.get(row.id);eq(row.product_id,expected.product_id,'revision product binding');eq(row.terms,expected.terms,'every full immutable legal/economic/common/configuration field exact');eq(row.document_hashes,await scalar('select bx1_portal.offering_document_hashes($1::jsonb)',[JSON.stringify(expected.terms)]),'original text-hash interface retained')}
    eq(additions['bx1_portal.product_service_appointments'].map(row=>row.id).sort(),[...appointed].sort(),'exact finite native appointment journal')
    eq(additions['bx1_portal.offering_file_upload_intents'].length,authoredFiles.length,'one immutable intent per exact reserved identity')
    for(const row of additions['bx1_portal.offering_file_upload_intents']){
      const file=authoredFiles.find(value=>value.id===row.id);truth(file,'no unauthored upload intent')
      for(const field of ['id','offering_revision_id','product_id','actor_id','kind','title','storage_path','sha256','byte_size'])eq(row[field],file[field],'intent full byte and authority tuple exact')
    }
    const registered=authoredFiles.filter(file=>file.registered)
    eq(additions['bx1_portal.offering_file_quarantine'].length,registered.length,'exact finite original quarantine receipts')
    for(const row of additions['bx1_portal.offering_file_quarantine']){const file=registered.find(value=>value.id===row.id);truth(file,'registered original file exists');for(const field of ['id','offering_revision_id','product_id','actor_id','kind','title','storage_path','sha256','byte_size'])eq(row[field],file[field],'quarantine exact original tuple');eq(row.validation_state,'QUARANTINED','immutable original never relabelled')}
    const unique = rows => [...new Map(rows.map(row=>[`${row.actor_id}:${row.request_key}`,row])).values()]
    const commandRows=unique(inputs),fileInputs=unique(documentInputs)
    const journal=(rows,expected,fields)=>{
      eq(rows.length,expected.length,'finite request journal exact count, not an actor wildcard')
      for(const row of rows){const input=expected.find(value=>value.actor_id===row.actor_id&&value.request_key===row.request_key);truth(input,'exact authored request identity');for(const field of fields)eq(row[field],input[field],'exact full action/context/input tuple')}
    }
    const appointmentCommands=new Set(['request_product_service_appointment','review_product_service_appointment','apply_product_service_appointment'])
    journal(additions['bx1_portal.product_service_appointment_requests'],commandRows.filter(row=>appointmentCommands.has(row.command)),['actor_id','request_key','command','operating_context','payload'])
    journal(additions['bx1_portal.scoped_requests'],commandRows.filter(row=>!appointmentCommands.has(row.command)),['actor_id','request_key','command','operating_context','payload'])
    journal(additions['bx1_private.offering_document_command_receipts'],fileInputs,['actor_id','request_key','command','operating_context','payload'])
    journal(additions['bx1_portal.requests'],commandRows.filter(row=>['create_product','submit_product'].includes(row.command)),['actor_id','request_key','command','payload'])
    const rowsOf=name=>additions[`bx1_private.${name}`]
    const native=name=>additions[`bx1_portal.${name}`]
    const fieldsEqual=(row,expected,fields,label)=>{for(const field of fields)eq(row[field],expected[field],`${label}: ${field}`)}
    const fileFor=id=>{const file=authoredFiles.find(row=>row.id===id);truth(file,'finite authored original identity exists');return file}
    const revisionFor=id=>{const revision=native('offering_revisions').find(row=>row.id===id);truth(revision,'finite canonical immutable revision exists');return revision}
    const claimFor=id=>{const manifest=[...claimJournal.values()].find(row=>row?.file_id===id);truth(manifest,'finite real signed CLAIM response exists');return manifest}
    const scanFor=id=>{const scan=rowsOf('offering_document_scan_events').find(row=>row.file_id===id);truth(scan,'finite real engine scan exists');return scan}
    const cleanFor=id=>{const clean=rowsOf('offering_document_clean_receipts').find(row=>row.file_id===id);truth(clean,'finite clean promotion receipt exists');return clean}
    for(const [name,rows]of Object.entries(additions))for(const row of rows){
      const columns=installedSpecs.find(spec=>`${spec.nspname}.${spec.relname}`===name).columns
      eq(Object.keys(row).sort(),[...columns].sort(),`${name}: complete row fields enumerated, no omitted columns`)
      for(const [field,value]of Object.entries(row))if(value!==null&&/_at$/.test(field)&&field!=='lease_expires_at'){
        const instant=Date.parse(value);truth(Number.isFinite(instant)&&instant>=proofStarted-60000&&instant<=Date.now()+60000,`${name}.${field}: genuine bounded generated time`)
      }
    }
    eq(native('product_issuer_declarations').length,products.length,'one immutable exact common-envelope declaration per new product')
    for(const row of native('product_issuer_declarations')){
      const p=native('products').find(value=>value.id===row.product_id);truth(p,'declaration binds only exact authored product')
      eq(row.declaration,p.terms.common_envelope.issuer,'full issuer declaration has no legal-field waiver')
      eq([row.issuer_reference,row.declaration_revision,row.declared_by],[row.declaration.issuer_reference,1,actor(1)],'original declaration identity/version/actor exact')
      eq(row.declaration_hash,await scalar('select bx1_portal.product_issuer_declaration_hash($1,$2::jsonb)',[p.id,JSON.stringify(row.declaration)]),'original domain-specific declaration hash exact')
    }
    for(const row of native('offering_revisions')){
      eq([row.package_number,row.origin,row.product_revision_at_submission,row.submitted_by,row.legacy_subscription_id],
        [row.package_number,'SUBMITTED',[2,3,5][row.package_number-1],actor(1),null],'only3 canonical submitted packages, no invented legacy history')
      truth(row.package_number>=1&&row.package_number<=3,'canonical package number within exact finite correction chain')
      eq(row.issuer_declaration_reference,row.terms.common_envelope.issuer.issuer_reference,'original v3 declaration pointer preserved')
      eq(row.issuer_declaration_revision,1,'same-terms correction does not amend issuer declaration')
      eq(row.terms_hash,await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')",[JSON.stringify(row.terms)]),'exact full terms hash retained')
    }
    eq(native('product_service_appointment_receipts').length,12,'exact3 normal appointment receipts per4 actual nominations')
    for(const row of native('product_service_appointment_receipts')){
      const request=native('product_service_appointment_requests').find(value=>value.receipt_id===row.id)
      truth(request,'no unrequested or automatic-expiry appointment receipt')
      fieldsEqual(row,{appointment_id:request.appointment_id,action:request.command,actor_id:request.actor_id,operating_context:request.operating_context,
        command_payload:request.payload,appointment_revision:{request_product_service_appointment:1,review_product_service_appointment:2,apply_product_service_appointment:3}[request.command],
        status_after:{request_product_service_appointment:'SUBMITTED',review_product_service_appointment:'APPROVED',apply_product_service_appointment:'APPLIED'}[request.command]},
        ['appointment_id','action','actor_id','operating_context','command_payload','appointment_revision','status_after'],'exact native appointment receipt')
    }
    for(const row of native('product_service_appointments')){
      const request=native('product_service_appointment_requests').find(value=>value.appointment_id===row.id&&value.command==='request_product_service_appointment')
      const review=native('product_service_appointment_requests').find(value=>value.appointment_id===row.id&&value.command==='review_product_service_appointment')
      const apply=native('product_service_appointment_requests').find(value=>value.appointment_id===row.id&&value.command==='apply_product_service_appointment')
      truth(request&&review&&apply,'exact3 independent synthetic-principal appointment commands')
      fieldsEqual(row,{product_id:request.payload.product_id,product_organisation_id:organisation,reviewer_scope_organisation_id:scope,
        role:request.payload.role,appointee_user_id:request.payload.appointee_user_id,native_membership_id:request.payload.native_membership_id,
        requested_by_user_id:actor(1),requested_in_context:manager,product_revision_at_request:request.payload.expected_product_revision,
        evidence_reference:request.payload.evidence_reference,status:'APPLIED',revision:3,reviewed_by_user_id:actor(4),review_notes:review.payload.notes,
        review_checks:review.payload.checks,approval_receipt_id:review.receipt_id,applied_by_user_id:actor(5),revoked_at:null,revoked_by_user_id:null,
        revoke_reason:null,provider_mode:'SYNTHETIC_TEST'},['product_id','product_organisation_id','reviewer_scope_organisation_id','role','appointee_user_id',
          'native_membership_id','requested_by_user_id','requested_in_context','product_revision_at_request','evidence_reference','status','revision',
          'reviewed_by_user_id','review_notes','review_checks','approval_receipt_id','applied_by_user_id','revoked_at','revoked_by_user_id','revoke_reason','provider_mode'],'exact appointment authority tuple')
      eq(Date.parse(row.requested_until),Date.parse(request.payload.requested_until),'exact finite nomination deadline')
      eq(row.terms_hash_at_request,native('offering_revisions').find(value=>value.product_id===row.product_id&&value.package_number===1).terms_hash,'appointment retained original terms hash')
    }
    eq(native('offering_review_reopen_receipts').length,4,'exact2 same-terms corrections per asset')
    for(const row of native('offering_review_reopen_receipts')){
      const input=commandRows.find(value=>value.command==='reopen_offering_review'&&value.actor_id===row.actor_id&&value.request_key===row.request_key)
      truth(input,'canonical correction is backed by exact authored public command')
      fieldsEqual(row,{actor_id:actor(1),product_id:input.payload.product_id,operating_context:manager,reason:input.payload.reason,
        product_revision_before:input.payload.expected_revision,product_revision_after:input.payload.expected_revision+1},
        ['actor_id','product_id','operating_context','reason','product_revision_before','product_revision_after'],'exact canonical correction receipt')
      const prior=revisionFor(row.prior_offering_revision_id),next=revisionFor(row.reopened_offering_revision_id)
      eq([next.product_id,next.package_number,next.product_revision_at_submission],[prior.product_id,prior.package_number+1,row.product_revision_after],'fresh exact canonical revision lineage')
      eq(next.terms,prior.terms,'same-terms correction retains every original term')
    }
    const decisions=commandRows.filter(row=>row.command==='review_offering_issuer')
    eq(native('offering_decisions').length,decisions.length,'no successful issuer/Compliance approval or forged signature decision')
    for(const row of native('offering_decisions')){
      const input=decisions.find(value=>value.payload.offering_revision_id===row.offering_revision_id),r=revisionFor(row.offering_revision_id)
      truth(input,'decision backed by exact current issuer command')
      fieldsEqual(row,{decision_kind:'ISSUER',decision:'CHANGES_REQUIRED',decision_basis:'MANUAL_TEST_REVIEW',actor_id:actor(3),operating_context:context('IssuerFundManager'),
        terms_hash:r.terms_hash,document_hashes:r.document_hashes,product_revision_at_decision:input.payload.expected_revision,notes:input.payload.notes,checks:input.payload.checks,
        common_envelope_hash:r.common_envelope_hash,deployment_configuration_hash:r.deployment_configuration_hash},
        ['decision_kind','decision','decision_basis','actor_id','operating_context','terms_hash','document_hashes','product_revision_at_decision','notes','checks',
          'common_envelope_hash','deployment_configuration_hash'],'exact immutable issuer current decision')
    }
    eq(additions['bx1_private.offering_document_processing_jobs'].map(row=>row.file_id).sort(),registered.map(row=>row.id).sort(),'one durable job per actual registered PDF')
    eq(additions['bx1_private.offering_document_scan_events'].length,observedResults.size,'one genuine engine callback result per actual original')
    for(const row of additions['bx1_private.offering_document_scan_events']){
      const result=observedResults.get(row.file_id);truth(result,'scan is backed by real runner engine receipt, not SQL injected verdict')
      for(const field of ['file_id','sha256','reference','verdict','authority_epoch','scanner_authority_epoch'])eq(row[field],result[field],'immutable scanner callback tuple exact')
      eq(Date.parse(row.observed_at),Date.parse(result.observed_at),'exact observed engine instant')
    }
    eq(additions['bx1_private.offering_document_manifests'].map(row=>row.id).sort(),sealedProducts.map(row=>row.manifest.id).sort(),'exact2 finite sealed manifests')
    eq(additions['bx1_private.offering_document_profiles'].map(row=>row.offering_revision_id).sort(),[...revisions.keys()].sort(),'no invented/backfilled evidence profile')
    eq(additions['storage.objects'].length,registered.length+[...cleanMemory.keys()].length,'only exact authenticated original and owner-null clean fixture objects')
    for(const row of additions['storage.objects']){
      const file=authoredFiles.find(value=>value.storage_path===row.name&&value.registered);truth(file,'object belongs to exact authored original identity')
      eq(row.owner_id,row.bucket_id==='bx1-offering-quarantine'?actor(1):null,'real authenticated/service ownership model')
      truth(['bx1-offering-quarantine','bx1-offering-documents'].includes(row.bucket_id),'no arbitrary source bucket')
      eq(row.metadata,{size:file.byte_size,mimetype:'application/pdf'},'exact file metadata');eq(row.user_metadata,{sha256:file.sha256},'exact independently checked hash metadata')
    }
    // Exact finite models cover every owned column. Only explicitly generated
    // timestamps/identities may be checked separately; no actor/table wildcard.
    const exactRows=(name,expected,generated)=>{
      const rows=rowsOf(name),columns=installedSpecs.find(spec=>spec.nspname==='bx1_private'&&spec.relname===name).columns
      const fields=columns.filter(field=>!generated.includes(field))
      for(const model of expected)eq(Object.keys(model).sort(),[...fields].sort(),`${name}: every nongenerated column has an input/evidence-derived model`)
      const projected=data=>data.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]])))
        .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
      eq(projected(rows),projected(expected),`${name}: exact complete finite row multiset`)
    }
    const uuidIdentity=value=>truth(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
      &&value!=='00000000-0000-0000-0000-000000000000','genuine nonzero generated UUID identity')
    const numericIdentity=value=>truth(Number.isSafeInteger(value)&&value>0,'genuine positive safe numeric evidence identity')
    const scanModel=file=>scanJournal.get(file.id)
    const cleanModel=file=>promotionJournal.get(file.id)
    for(const row of native('products')){
      const expected=committed.find(value=>value.product_id===row.id),terms=expected.terms
      const amounts=await scalar('select jsonb_build_object(\'cap_units\',$1::numeric,\'unit_price_minor\',$2::numeric,\'minimum_units\',$3::numeric)',
        [terms.cap_units,terms.unit_price_minor,terms.minimum_units])
      eq(await scalar('select jsonb_build_object(\'cap_units\',cap_units::text,\'unit_price_minor\',unit_price_minor::text,\'minimum_units\',minimum_units::text) from bx1_portal.products where id=$1',[row.id]),
        {cap_units:terms.cap_units,unit_price_minor:terms.unit_price_minor,minimum_units:terms.minimum_units},'native amounts retain exact canonical decimal text, not JS floating-point calculations')
      const model={id:row.id,organisation_id:organisation,created_by:actor(1),revision:5,status:'IN_REVIEW',terms,
        terms_hash:await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')",[JSON.stringify(terms)]),reserved_units:0,...amounts,
        reviewer_id:null,review_notes:null,reviewed_at:null,published_at:null,review_checks:{},current_offering_revision_id:expected.current_revision}
      eq(Object.keys(model).sort(),installedSpecs.find(spec=>spec.nspname==='bx1_portal'&&spec.relname==='products').columns.filter(field=>field!=='created_at').sort(),'every nongenerated native product column has an exact model')
      fieldsEqual(row,model,Object.keys(model),'complete input-derived final product')
    }
    for(const row of native('offering_revisions')){
      eq(row.common_envelope_hash,await scalar('select bx1_portal.product_common_envelope_hash($1,$2::jsonb)',[row.product_id,JSON.stringify(revisions.get(row.id).terms)]),'revision common envelope matches full original input')
      eq(row.deployment_configuration_hash,await scalar('select bx1_portal.product_deployment_configuration_hash($1,$2::jsonb)',[row.product_id,JSON.stringify(revisions.get(row.id).terms)]),'revision deployment configuration matches full original input')
    }
    eq(scanJournal.size,registered.length,'one independently observed exact scan result per actual retained file')
    eq(claimJournal.size,registered.length,'one independently observed bounded claim per actual retained file')
    eq(promotionJournal.size,registered.filter(file=>observedResults.get(file.id).verdict==='CLEAN').length,'one original promotion receipt per actual CLEAN result')
    exactRows('offering_document_policy',[],['changed_at'])
    exactRows('offering_document_scanner_policy',[],['changed_at'])
    exactRows('offering_document_profiles',native('offering_revisions').map(r=>({offering_revision_id:r.id,product_id:r.product_id,
      organisation_id:organisation,environment:'TESTNET',profile:'PDF_SIGNATURE_REQUIRED_V1',terms_hash:r.terms_hash,
      document_hashes:r.document_hashes,common_envelope_hash:r.common_envelope_hash,deployment_configuration_hash:r.deployment_configuration_hash})),['created_at'])
    exactRows('offering_document_command_receipts',fileInputs.map(input=>({...input,product_id:input.payload.product_id,
      offering_revision_id:input.payload.offering_revision_id})),['created_at'])
    const expectedJobs=[],expectedAttempts=[],expectedScans=[],expectedClean=[],expectedResolutions=[],expectedProcessing=[]
    for(const file of registered){
      const claim=claimFor(file.id),result=scanModel(file),clean=cleanModel(file)
      truth(result,'real callback yields an exact recorded result model');numericIdentity(result.scan_event_id)
      eq([claim.authority_epoch,claim.scanner_authority_epoch,claim.attempt_number,claim.worker_id,claim.scanner_id],
        [2,2,1,worker,scanner],'retained positive flow uses exactly the explicitly admitted initial policies and one attempt')
      uuidIdentity(claim.attempt_id)
      const terminal=result.verdict==='CLEAN'?'COMPLETED':'REJECTED'
      expectedJobs.push({file_id:file.id,product_id:file.product_id,offering_revision_id:file.offering_revision_id,uploader_id:file.actor_id,
        storage_path:file.storage_path,sha256:file.sha256,byte_size:file.byte_size,mime_type:'application/pdf',kind:file.kind,
        state:terminal,attempt_number:1,current_attempt_id:claim.attempt_id,next_attempt_at:null})
      expectedAttempts.push({id:claim.attempt_id,file_id:file.id,authority_epoch:2,scanner_authority_epoch:2,attempt_number:1,
        worker_id:worker,scanner_id:scanner,reference:`bx1-offering-scan:${claim.attempt_id}`,lease_expires_at:claim.lease_expires_at,
        outcome:result.verdict,failure_code:null})
      const attempt=rowsOf('offering_document_processing_attempts').find(row=>row.id===claim.attempt_id)
      truth(attempt,'exact claimed attempt exists')
      eq(Date.parse(attempt.lease_expires_at)-Date.parse(attempt.started_at),120000,'explicit lease expiry is exactly120 seconds, not a generic future-time waiver')
      eq(attempt.started_at,await scalar("select to_jsonb($1::timestamptz-interval '120 seconds')",[claim.lease_expires_at]),'full database-precision start instant derives from immutable claimed lease')
      truth(Date.parse(attempt.finished_at)>=Date.parse(attempt.started_at)&&Date.parse(attempt.finished_at)<=Date.parse(attempt.lease_expires_at),'completed attempt finishes within its actual live lease')
      const job=rowsOf('offering_document_processing_jobs').find(row=>row.file_id===file.id)
      truth(Date.parse(job.updated_at)>=Date.parse(job.created_at),'job update time follows its actual creation')
      expectedScans.push({id:result.scan_event_id,file_id:file.id,attempt_id:claim.attempt_id,scanner_id:scanner,
        reference:claim.reference,verdict:result.verdict,sha256:file.sha256,authority_epoch:2,scanner_authority_epoch:2,observed_at:result.observed_at})
      if(result.verdict==='CLEAN'){
        truth(clean,'actual CLEAN result has independently observed original promotion receipt');uuidIdentity(clean.clean_receipt_id)
        expectedClean.push({id:clean.clean_receipt_id,file_id:file.id,scan_event_id:result.scan_event_id,product_id:file.product_id,
          offering_revision_id:file.offering_revision_id,uploader_id:file.actor_id,storage_path:file.storage_path,sha256:file.sha256,
          byte_size:file.byte_size,mime_type:'application/pdf',authority_epoch:2,scanner_authority_epoch:2})
      }else eq(clean,undefined,'MALICIOUS result has no promotion model')
      expectedResolutions.push({intent_id:file.id,product_id:file.product_id,offering_revision_id:file.offering_revision_id,
        state:result.verdict==='CLEAN'?'PROMOTED_CLEAN':'REJECTED',actor_id:null,request_key:null,operating_context:null,reason:null,
        scan_event_id:result.scan_event_id,clean_receipt_id:clean?.clean_receipt_id??null})
      expectedProcessing.push({file_id:file.id,attempt_id:null,kind:'QUEUED',evidence:{file_id:file.id,product_id:file.product_id,
        offering_revision_id:file.offering_revision_id,sha256:file.sha256,storage_path:file.storage_path}},
      {file_id:file.id,attempt_id:claim.attempt_id,kind:'CLAIMED',evidence:claim},
      {file_id:file.id,attempt_id:claim.attempt_id,kind:result.verdict==='CLEAN'?'RESULT_RECORDED':'REJECTED',evidence:{
        scan_event_id:result.scan_event_id,verdict:result.verdict,sha256:file.sha256,reference:claim.reference,
        observed_at:result.observed_at,authority_epoch:2,scanner_authority_epoch:2}})
      if(clean)expectedProcessing.push({file_id:file.id,attempt_id:claim.attempt_id,kind:'COMPLETED',
        evidence:{clean_receipt_id:clean.clean_receipt_id,scan_event_id:result.scan_event_id,sha256:file.sha256}})
    }
    for(const file of authoredFiles.filter(row=>!row.registered)){
      const input=fileInputs.find(row=>row.command==='resolve_offering_file_intent'&&row.payload.intent_id===file.id)
      truth(input,'each retained abandoned intent has one exact user-requested exclusion')
      expectedResolutions.push({intent_id:file.id,product_id:file.product_id,offering_revision_id:file.offering_revision_id,state:'EXCLUDED',
        actor_id:input.actor_id,request_key:input.request_key,operating_context:input.operating_context,reason:input.payload.reason,
        scan_event_id:null,clean_receipt_id:null})
    }
    exactRows('offering_document_processing_jobs',expectedJobs,['created_at','updated_at'])
    exactRows('offering_document_processing_attempts',expectedAttempts,['started_at','finished_at'])
    exactRows('offering_document_processing_claim_receipts',[...claimJournal].map(([requestId,manifest])=>({
      worker_id:worker,request_id:requestId,scanner_id:scanner,authority_epoch:2,scanner_authority_epoch:2,manifest})),['created_at'])
    exactRows('offering_document_scan_events',expectedScans,['recorded_at'])
    exactRows('offering_document_clean_receipts',expectedClean,['created_at'])
    exactRows('offering_document_intent_resolutions',expectedResolutions,['created_at'])
    exactRows('offering_document_processing_events',expectedProcessing,['id','created_at'])
    for(const name of ['offering_document_scan_events','offering_document_processing_events']){
      rowsOf(name).forEach(row=>numericIdentity(row.id));eq(new Set(rowsOf(name).map(row=>row.id)).size,rowsOf(name).length,'each numeric evidence identity is unique')
    }
    const expectedManifests=[]
    for(const item of sealedProducts){
      const r=revisionFor(item.p.current_offering_revision_id)
      const entries=item.files.map(receipt=>{const file=fileFor(receipt.id),result=scanModel(file),clean=cleanModel(file)
        return {file_id:file.id,kind:file.kind,uploader_id:file.actor_id,size:file.byte_size,sha256:file.sha256,
          scan_event_id:result.scan_event_id,clean_receipt_id:clean.clean_receipt_id}})
      const evidence={manifest_version:1,profile:'PDF_SIGNATURE_REQUIRED_V1',environment:'TESTNET',product_id:r.product_id,
        organisation_id:organisation,offering_revision_id:r.id,terms_hash:r.terms_hash,document_hashes:r.document_hashes,
        common_envelope_hash:r.common_envelope_hash,deployment_configuration_hash:r.deployment_configuration_hash,files:entries,
        correspondence_statement:item.sealBody.correspondence_statement,actor_id:actor(1),operating_context:manager,sealed_at:item.manifest.sealed_at}
      const hash=await scalar("select encode(sha256(convert_to('bx1-offering-document-manifest-v1:'||$1::jsonb::text,'UTF8')),'hex')",[JSON.stringify(evidence)])
      eq(hash,item.manifest.hash,'independent full manifest model matches originally observed sealed hash');uuidIdentity(item.manifest.id)
      expectedManifests.push({id:item.manifest.id,offering_revision_id:r.id,product_id:r.product_id,organisation_id:organisation,
        environment:'TESTNET',file_ids:item.files.map(file=>file.id),evidence,hash,actor_id:actor(1),operating_context:manager,
        request_key:item.sealKey,correspondence_statement:item.sealBody.correspondence_statement,sealed_at:item.manifest.sealed_at})
    }
    exactRows('offering_document_manifests',expectedManifests,[])
    const expectedAudit=[]
    const audit=(kind,subjectId,actorId,summary)=>expectedAudit.push({subject_id:subjectId,application_id:null,organisation_id:organisation,
      investor_id:null,kind,actor_id:actorId,summary})
    for(const input of commandRows){
      let subjectId=input.payload.product_id,summary
      if(input.command==='create_product'){
        subjectId=native('products').find(p=>p.terms.name===input.payload.terms.name)?.id
        summary='Typed test product draft created. No assets or tokens issued.'
      }else if(input.command==='submit_product')summary='Test offering submitted for independent compliance review.'
      else if(appointmentCommands.has(input.command)){
        const request=native('product_service_appointment_requests').find(row=>row.actor_id===input.actor_id&&row.request_key===input.request_key)
        const appointment=native('product_service_appointments').find(row=>row.id===request.appointment_id)
        subjectId=appointment.id
        summary=`Synthetic TEST product service appointment ${appointment.role} ${ {request_product_service_appointment:'SUBMITTED',review_product_service_appointment:'APPROVED',apply_product_service_appointment:'APPLIED'}[input.command] }. No signing, funding or publication authority.`
      }else if(input.command==='review_offering_issuer'){
        subjectId=input.payload.offering_revision_id
        summary='Appointed issuer decided exact immutable test offering package: CHANGES_REQUIRED. No publication or chain deployment.'
      }else if(input.command==='reopen_offering_review')summary='Synthetic TEST offering reopened for fresh document, issuer and Compliance review. Prior terms, decisions and evidence preserved; no signature, publication, order or funding created.'
      else assert.fail('An unexpected public command has no exact audit model')
      truth(subjectId&&summary,'every exact public input has a finite audit subject and summary');audit(input.command,subjectId,input.actor_id,summary)
    }
    registered.forEach(file=>audit('offering_file_quarantined',file.offering_revision_id,actor(1),'Private unscanned offering file staged for immutable package. It is not approved or signed.'))
    for(const input of fileInputs)audit(input.command,input.payload.offering_revision_id,input.actor_id,input.command==='seal_offering_document_manifest'
      ?'Exact three-PDF manifest sealed. Signature is not connected; approval and business operations remain blocked.'
      :'Manager resolved an abandoned intent or acknowledged its immutable rejection; original evidence remains unchanged.')
    eq(expectedAudit.length,36,'exact finite input-derived public audit count')
    const auditFields=['subject_id','application_id','organisation_id','investor_id','kind','actor_id','summary']
    const auditProjection=rows=>rows.map(row=>Object.fromEntries(auditFields.map(field=>[field,row[field]])))
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
    eq(auditProjection(native('events')),auditProjection(expectedAudit),'every complete audit authority/input/summary tuple and multiplicity is exact')
    native('events').forEach(row=>uuidIdentity(row.id));eq(new Set(native('events').map(row=>row.id)).size,expectedAudit.length,'each generated public audit identity is unique')
    await assertInheritedFunctions(originalFunctions);eq(await functions(),installedFunctions,'all installed function bodies/metadata exact after connected flow/waits/cleanup')
    eq(await security(),installedSecurity,'all installed roles/edges/ACL/RLS/guards/constraints restored exactly')
    console.log('BX1_OFFERING_DOCUMENTS_PASS',JSON.stringify({assertions:checks,inherited_relations:originalSpecs.length,additional_private_tables:12,
      exact_historical_body_cutovers:15,new_private_helpers:37,assets:['FUND','REAL_ESTATE'],pdfs:registered.length,
      real_engine_scans:observedResults.size,engine:'PINNED_CLAMAV_1_4_6_CUSTOM_FIXTURE',storage:'SYNTHETIC_HTTP_AND_REAL_SQL_RLS',
      observed_revocation_waits:3,default_policy_restored:'NOT_ADMITTED',same_terms_correction:true,manifest_count:2,
      business_approval:false,provider_signature:false,hosted_acceptance:false,independent_humans:false,production_malware_coverage:false,
      cleanup:'EXACT_FACTOR_CONFIG_POLICY_MEMBERSHIP_AND_FULL_CATALOG;CALLER_DISPOSABLE_SCHEMAS'}))
    return checks
  }catch(error){primaryFailure=error;error.offeringDocumentProcessingPhase=phase;throw error}
  finally{
    if(begun){await db.query('rollback').catch(()=>{});begun=false}
    for(const client of clients){await client.query('rollback').catch(()=>{});await client.query('reset role').catch(()=>{})}
    await admin().catch(()=>{})
    if(configBefore&&installedSpecs){
      try{await begin();await restoreFixtures();await commit();eq(await security(),installedSecurity,'unconditional final guard restoration')}
      catch(error){if(begun)await db.query('rollback').catch(()=>{});console.error('BX1_OFFERING_DOCUMENTS_CLEANUP_FAILED');if(!primaryFailure)throw error}
    }
  }
}
