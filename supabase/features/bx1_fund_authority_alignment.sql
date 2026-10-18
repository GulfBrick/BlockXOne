-- S4A: one existing TEST Safe authority-epoch transition. No original setup,
-- admission input/claims, role, epoch, observation, or chain outcome is rewritten.
-- Apply atomically as TEST owner. New functions are closed except finite wrappers.
do $alignment_preflight$
declare p pg_catalog.pg_proc;spec jsonb;signature text;found_count integer;
  expected constant jsonb:=$alignment_sources$[{"signature":"bx1_private.fund_alignment_operation_guard()","definer":false,"sha256":"bf643f17e7026edbd0465bd075d98eaeabaa885322462b57fbed4d70cca85d1e"},{"signature":"bx1_private.fund_alignment_binding(uuid)","definer":true,"sha256":"0b9aa9fb9f02bd8915ce9c23c9a13ebb89ac17031b0c5740135f16ff10e03812"},{"signature":"bx1_private.fund_alignment_snapshot_valid(jsonb)","definer":true,"sha256":"25c5320755fde3f8efd3fe914a6b3cc24b46366e99dc95e001253ba470f1dd5d"},{"signature":"bx1_private.fund_alignment_view(uuid,uuid,boolean)","definer":true,"sha256":"c08987000be5dc2ca33cf12572cfcb2d41121bc210d927c7bbf12b1299b1672a"},{"signature":"bx1_private.fund_alignment_execution_data(uuid)","definer":true,"sha256":"151ce7b10b4e7100fc853e1110bdc830252579087f3446866960316a0e8057ee"},{"signature":"bx1_private.fund_alignment_enter(uuid,uuid,text)","definer":true,"sha256":"9bc75c6e1784d4486a40e618651b5a7d07a19359be82ed1e3a2ae80d19567dca"},{"signature":"bx1_private.fund_alignment_consume(uuid,uuid,text)","definer":true,"sha256":"37acae3589d890881a101fda9aa24dd1a6176f208dc6d6ba6122878a174ebe66"},{"signature":"public.bx1_portal_fund_alignment_authorise(uuid,integer,jsonb,text)","definer":true,"sha256":"63828cea69e82644c8c16754c1abbae15492880480905027ce1a8f5a9c770fbe"},{"signature":"bx1_portal.read_fund_authority_alignment(uuid,uuid,jsonb,uuid)","definer":true,"sha256":"345c15b05ffebcc1a5308e24b7e26c689087b4e7332392cb2d9e4e60e6a1c24e"},{"signature":"bx1_portal.record_fund_authority_alignment(jsonb,text,uuid,jsonb,uuid)","definer":true,"sha256":"ee2e89dc3cc0a4c0caa3167d1efa93ffdd5d55c16273b6d8b69b186c66ad1dc2"},{"signature":"bx1_portal.read_fund_admission_authorised(uuid,uuid)","definer":true,"sha256":"a7400ab9955307343c9dbf8b03d0bd1d14765fb9f01cb02396cd8780a43e8ac0"},{"signature":"bx1_portal.record_fund_admission_authorised(uuid,jsonb,text,uuid)","definer":true,"sha256":"5cb502738f6b49ed65e0949aece6586e4da3143698db785a973229c0e07f00d3"}]$alignment_sources$;
begin
  if current_user<>'postgres' or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'alignment_exact_test_owner_required' using errcode='55000';end if;
  select * into strict p from pg_catalog.pg_proc where oid='bx1_portal.fund_admission_worker_enter(uuid)'::regprocedure;
  if p.proowner<>'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=""']
    or p.proacl::text is distinct from '{postgres=X/postgres}' or p.provolatile<>'v' or p.proargnames is distinct from array['request']
    or p.procost<>100 or p.proparallel<>'u' or p.prokind<>'f' or p.proisstrict or p.proleakproof or p.proretset
    or p.prorettype<>'text'::regtype or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') not in
      ('3e238a44526efa202e243db0f9a1465e7448f77e8c803e53e4af4192f6e84ec7','2e85e284036dd632e186c963bb698ec7f67bb550e0d6e9359eec0516b6a756ec') then
    raise exception 'alignment_worker_preimage_changed' using errcode='55000';end if;
  foreach signature in array array['bx1_portal.fund_setup_lock(jsonb,uuid,boolean)','bx1_portal.fund_setup_current(uuid,jsonb)',
    'bx1_portal.fund_setup_context(jsonb,uuid,boolean)','bx1_portal.fund_admission_seed(uuid,integer,jsonb)',
    'bx1_portal.fund_setup_audit(uuid,uuid,text,integer,integer,jsonb)','bx1_portal.fund_setup_wallet_current(uuid,text)',
    'bx1_portal.fund_digest(jsonb)','bx1_portal.require_keys(jsonb,text[])','bx1_portal.immutable_record()',
    'bx1_portal.read_fund_admission(uuid)','bx1_portal.record_fund_admission(uuid,jsonb,text)'] loop
    if pg_catalog.to_regprocedure(signature) is null then raise exception 'alignment_dependency_required: %',signature using errcode='55000';end if;
  end loop;
  select count(*) into found_count from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='bx1_private' and c.relkind='r' and c.relname in ('fund_alignment_operations','fund_alignment_signatures',
      'fund_alignment_authorisations','fund_alignment_consumptions','fund_alignment_requests','fund_alignment_attempts','fund_alignment_observations');
  if found_count not in (0,7) then raise exception 'alignment_partial_installation' using errcode='55000';end if;
  for spec in select value from pg_catalog.jsonb_array_elements(expected) loop
    select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(spec->>'signature');
    if (found_count=0 and p.oid is not null) or (found_count=7 and (p.oid is null or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""'] or p.prosecdef is distinct from (spec->>'definer')::boolean
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') is distinct from spec->>'sha256')) then
      raise exception 'alignment_existing_helper_changed: %',spec->>'signature' using errcode='55000';end if;
  end loop;
end $alignment_preflight$;

create table if not exists bx1_private.fund_alignment_operations(
  id uuid primary key default pg_catalog.gen_random_uuid(),request_id uuid not null unique references bx1_portal.fund_admission_requests(id) on delete restrict,
  revision integer not null default 1 check(revision>0),state text not null default 'NEW'
    check(state in ('NEW','PREPARED','SIGNING','UNKNOWN','BROADCAST','PENDING','FINAL','REVERTED','RECOVERY_REQUIRED')),
  intent jsonb,intent_hash text check(intent_hash ~ '^[0-9a-f]{64}$'),executor_nonce numeric(78,0),
  safe_address text,safe_nonce numeric(78,0),executor_address text,execution jsonb,
  transaction_hash text check(transaction_hash ~ '^0x[0-9a-f]{64}$'),claimed_at timestamptz,claim_key uuid,observation jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check((intent is null)=(intent_hash is null)),check((claimed_at is null)=(claim_key is null)),
  check(intent is null or intent_hash=bx1_portal.fund_digest(intent))
);
create unique index if not exists fund_alignment_safe_nonce on bx1_private.fund_alignment_operations(safe_address,safe_nonce) where claimed_at is not null;
create unique index if not exists fund_alignment_executor_nonce on bx1_private.fund_alignment_operations(executor_address,executor_nonce) where claimed_at is not null;
create table if not exists bx1_private.fund_alignment_signatures(
  operation_id uuid not null references bx1_private.fund_alignment_operations(id) on delete restrict,signer text not null,
  signature text not null,request_key uuid not null,recorded_at timestamptz not null default pg_catalog.clock_timestamp(),primary key(operation_id,signer)
);
create table if not exists bx1_private.fund_alignment_authorisations(
  id uuid primary key default pg_catalog.gen_random_uuid(),request_id uuid not null references bx1_portal.fund_admission_requests(id) on delete restrict,
  actor_id uuid not null,operating_context jsonb not null,session_id uuid not null,purpose text not null
    check(purpose in ('ALIGNMENT_READ','ALIGNMENT_WRITE','ADMISSION_READ','ADMISSION_WRITE')),
  input_hash text not null,native_binding_hash text not null,reason_hash text not null,
  operation_id uuid references bx1_private.fund_alignment_operations(id) on delete restrict,operation_revision integer,intent_hash text,
  claims jsonb not null,created_at timestamptz not null,expires_at timestamptz not null,
  check(expires_at>created_at and expires_at<=created_at+interval '60 seconds'),
  check((operation_id is null)=(purpose in ('ADMISSION_READ','ADMISSION_WRITE')))
);
create table if not exists bx1_private.fund_alignment_consumptions(
  receipt_id uuid primary key references bx1_private.fund_alignment_authorisations(id) on delete restrict,purpose text not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table if not exists bx1_private.fund_alignment_requests(
  actor_id uuid not null,request_key uuid not null,operation_id uuid not null references bx1_private.fund_alignment_operations(id) on delete restrict,
  action text not null,evidence jsonb not null,evidence_hash text not null,recorded_at timestamptz not null default pg_catalog.clock_timestamp(),primary key(actor_id,request_key,action)
);
create table if not exists bx1_private.fund_alignment_attempts(
  id uuid primary key default pg_catalog.gen_random_uuid(),operation_id uuid not null references bx1_private.fund_alignment_operations(id) on delete restrict,
  transaction_hash text not null,prior_candidate_hash text,request_key uuid not null,recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table if not exists bx1_private.fund_alignment_observations(
  id uuid primary key default pg_catalog.gen_random_uuid(),operation_id uuid not null references bx1_private.fund_alignment_operations(id) on delete restrict,
  request_key uuid not null,evidence jsonb not null,evidence_hash text not null,recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create or replace function bx1_private.fund_alignment_operation_guard() returns trigger
language plpgsql set search_path='' as $fn$
begin
  if tg_op='DELETE' or (new.id,new.request_id,new.created_at) is distinct from (old.id,old.request_id,old.created_at)
    or new.revision<>old.revision+1 or (old.intent is not null and
      (new.intent,new.intent_hash,new.executor_nonce,new.safe_address,new.safe_nonce,new.executor_address)
      is distinct from (old.intent,old.intent_hash,old.executor_nonce,old.safe_address,old.safe_nonce,old.executor_address))
    or (old.claimed_at is not null and (new.claimed_at,new.claim_key,new.execution) is distinct from (old.claimed_at,old.claim_key,old.execution))
    or (old.state='FINAL' and (new.state,new.transaction_hash,new.observation) is distinct from (old.state,old.transaction_hash,old.observation)) then
    raise exception 'alignment_operation_history_immutable' using errcode='23514';end if;
  return new;
end $fn$;

create or replace function bx1_private.fund_alignment_binding(rid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare r bx1_portal.fund_admission_requests;safe text;controller text;identity jsonb;reason text;
begin
  select * into strict r from bx1_portal.fund_admission_requests where id=rid;
  safe:=r.input#>>'{setup,setup,safe_address}';controller:=r.input#>>'{setup,setup,dependencies,controller}';
  if r.input_hash is distinct from bx1_portal.fund_digest(r.input) or r.roleplay_epoch<1
    or r.input->'authority_epoch' is distinct from pg_catalog.to_jsonb(r.roleplay_epoch)
    or safe !~ '^0x[0-9a-f]{40}$' or controller !~ '^0x[0-9a-f]{40}$' or safe is null or controller is null then
    raise exception 'alignment_original_binding_invalid' using errcode='23514';end if;
  identity:=pg_catalog.jsonb_build_array('BX1_AUTHORITY_ALIGNMENT_BINDING_V1',80002,r.id,r.request_key,r.input_hash,r.setup_id,r.setup_revision,
    r.product_id,r.offering_revision_id,r.roleplay_policy_id,r.roleplay_epoch,r.actor_id,r.operating_context,safe,controller);
  reason:='0x'||bx1_portal.fund_digest(pg_catalog.jsonb_build_array('BX1_AUTHORITY_ALIGNMENT_V1',80002,safe,controller,
    r.id,r.request_key,r.input_hash,r.setup_id,r.product_id,r.roleplay_policy_id,r.roleplay_epoch-1,r.roleplay_epoch));
  return pg_catalog.jsonb_build_object('native_binding_hash',bx1_portal.fund_digest(identity),'reason_hash',reason);
end $fn$;

create or replace function bx1_private.fund_alignment_snapshot_valid(v jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $fn$
declare p jsonb;urls text[]:='{}';
begin
  perform bx1_portal.require_keys(v,array['block','providers']);perform bx1_portal.require_keys(v->'block',array['number','hash','timestamp']);
  if pg_catalog.jsonb_typeof(v#>'{block,number}') is distinct from 'string' or v#>>'{block,number}' !~ '^(0|[1-9][0-9]{0,77})$'
    or pg_catalog.jsonb_typeof(v#>'{block,hash}') is distinct from 'string' or v#>>'{block,hash}' !~ '^0x[0-9a-f]{64}$' or v#>>'{block,hash}' ~ '^0x0{64}$'
    or pg_catalog.jsonb_typeof(v#>'{block,timestamp}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(v->'providers')<>2 then return false;end if;
  perform (v#>>'{block,timestamp}')::timestamptz;
  for p in select value from pg_catalog.jsonb_array_elements(v->'providers') loop
    perform bx1_portal.require_keys(p,array['url','finalized_block_number','finalized_block_hash']);
    if p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co') or p->>'url' is null
      or pg_catalog.jsonb_typeof(p->'finalized_block_number') is distinct from 'string' or p->>'finalized_block_number' !~ '^(0|[1-9][0-9]{0,77})$'
      or pg_catalog.jsonb_typeof(p->'finalized_block_hash') is distinct from 'string' or p->>'finalized_block_hash' !~ '^0x[0-9a-f]{64}$' or p->>'finalized_block_hash' ~ '^0x0{64}$'
      or (p->>'finalized_block_number')::numeric<(v#>>'{block,number}')::numeric
      or ((p->>'finalized_block_number')::numeric=(v#>>'{block,number}')::numeric and p->>'finalized_block_hash' is distinct from v#>>'{block,hash}') then return false;end if;
    urls:=pg_catalog.array_append(urls,p->>'url');
  end loop;
  return urls[1] is distinct from urls[2];
exception when others then return false;
end $fn$;

create or replace function bx1_private.fund_alignment_view(rid uuid,aid uuid,private_operation boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare r bx1_portal.fund_admission_requests;a bx1_private.fund_alignment_authorisations;o bx1_private.fund_alignment_operations;op jsonb;b jsonb;
begin
  select * into strict r from bx1_portal.fund_admission_requests where id=rid;
  select * into strict a from bx1_private.fund_alignment_authorisations where id=aid and request_id=rid;
  b:=bx1_private.fund_alignment_binding(r.id);
  if private_operation then
    select * into strict o from bx1_private.fund_alignment_operations where request_id=r.id;
    op:=pg_catalog.jsonb_build_object('id',o.id,'revision',o.revision,'state',o.state,'intent',o.intent,'intent_hash',o.intent_hash,
      'signatures',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer',x.signer,'signature',x.signature) order by x.signer)
        from bx1_private.fund_alignment_signatures x where x.operation_id=o.id),'[]'::jsonb),
      'executor_nonce',o.executor_nonce::text,'transaction_hash',o.transaction_hash,'claimed_at',o.claimed_at,'claim_key',o.claim_key,'observation',o.observation);
  end if;
  return pg_catalog.jsonb_build_object('schema_version',1,'environment','TESTNET','actor_id',r.actor_id,'operating_context',r.operating_context,
    'admission_request_id',r.id,'setup_id',r.setup_id,'setup_revision',r.setup_revision,'input_hash',r.input_hash,
    'native_binding_hash',b->>'native_binding_hash','reason_hash',b->>'reason_hash','authority_expires_at',a.expires_at,
    'authorisation_receipt_id',a.id,'input',r.input,'operation',op);
end $fn$;

create or replace function bx1_private.fund_alignment_execution_data(oid uuid) returns text
language plpgsql volatile security definer set search_path='' as $fn$
declare i jsonb;data_hex text;signature_hex text;data_tail text;signature_tail text;signature_offset integer;
begin
  select x.intent into strict i from bx1_private.fund_alignment_operations x where x.id=oid;
  data_hex:=pg_catalog.substr(i#>>'{safe_transaction,data}',3);
  select pg_catalog.string_agg(pg_catalog.substr(x.signature,3),'' order by x.signer) into signature_hex
    from bx1_private.fund_alignment_signatures x where x.operation_id=oid;
  if data_hex is null or signature_hex is null then raise exception 'alignment_execution_signatures_required' using errcode='23514';end if;
  data_tail:=pg_catalog.lpad(pg_catalog.to_hex(pg_catalog.length(data_hex)/2),64,'0')
    ||pg_catalog.rpad(data_hex,((pg_catalog.length(data_hex)+63)/64)*64,'0');
  signature_offset:=320+pg_catalog.length(data_tail)/2;
  signature_tail:=pg_catalog.lpad(pg_catalog.to_hex(pg_catalog.length(signature_hex)/2),64,'0')
    ||pg_catalog.rpad(signature_hex,((pg_catalog.length(signature_hex)+63)/64)*64,'0');
  -- Canonical ABI encoding of Safe.execTransaction(address,uint256,bytes,uint8,
  -- uint256,uint256,uint256,address,address,bytes), deterministic owner ordering.
  return '0x6a761202'||pg_catalog.lpad(pg_catalog.substr(i->>'controller_address',3),64,'0')||pg_catalog.repeat('0',64)
    ||pg_catalog.lpad(pg_catalog.to_hex(320),64,'0')||pg_catalog.repeat('0',64*6)
    ||pg_catalog.lpad(pg_catalog.to_hex(signature_offset),64,'0')||data_tail||signature_tail;
end $fn$;

create or replace function bx1_private.fund_alignment_enter(rid uuid,aid uuid,phase text) returns text
language plpgsql volatile security definer set search_path='' as $fn$
declare a bx1_private.fund_alignment_authorisations;r bx1_portal.fund_admission_requests;prior text;b jsonb;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') or phase not in ('ALIGNMENT_READ','ALIGNMENT_WRITE','ADMISSION_READ','ADMISSION_WRITE')
    or phase is null or aid is null then raise exception 'alignment_exact_receipt_required' using errcode='42501';end if;
  select * into a from bx1_private.fund_alignment_authorisations where id=aid and request_id=rid and purpose=phase;
  select * into r from bx1_portal.fund_admission_requests where id=rid;
  if a.id is null or r.id is null then raise exception 'alignment_receipt_denied' using errcode='42501';end if;
  b:=bx1_private.fund_alignment_binding(r.id);
  if (a.actor_id,a.operating_context,a.input_hash,a.native_binding_hash,a.reason_hash) is distinct from
      (r.actor_id,r.operating_context,r.input_hash,b->>'native_binding_hash',b->>'reason_hash')
    or a.expires_at<=pg_catalog.clock_timestamp() or a.claims->>'sub' is distinct from a.actor_id::text
    or a.claims->>'session_id' is distinct from a.session_id::text or a.claims->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or a.claims->>'aal' is distinct from 'aal2' or pg_catalog.jsonb_typeof(a.claims->'exp') is distinct from 'number'
    or a.claims->>'exp' !~ '^[0-9]{1,12}$' or (a.claims->>'exp')::numeric<=pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())
    or exists(select 1 from bx1_private.fund_alignment_consumptions x where x.receipt_id=a.id) then
    raise exception 'alignment_receipt_expired_used_or_foreign' using errcode='42501';end if;
  prior:=pg_catalog.current_setting('request.jwt.claims',true);
  perform pg_catalog.set_config('request.jwt.claims',a.claims::text,true);
  return coalesce(prior,'');
end $fn$;

create or replace function bx1_private.fund_alignment_consume(rid uuid,aid uuid,phase text) returns void
language plpgsql volatile security definer set search_path='' as $fn$
declare a bx1_private.fund_alignment_authorisations;r bx1_portal.fund_admission_requests;o bx1_private.fund_alignment_operations;b jsonb;
begin
  select * into strict r from bx1_portal.fund_admission_requests where id=rid for update;
  select * into a from bx1_private.fund_alignment_authorisations where id=aid and request_id=rid and purpose=phase;
  b:=bx1_private.fund_alignment_binding(r.id);
  if a.id is null or a.expires_at<=pg_catalog.clock_timestamp() or a.actor_id is distinct from auth.uid()
    or a.session_id::text is distinct from auth.jwt()->>'session_id' or a.claims is distinct from auth.jwt()
    or (a.input_hash,a.native_binding_hash,a.reason_hash) is distinct from (r.input_hash,b->>'native_binding_hash',b->>'reason_hash')
    or bx1_portal.fund_setup_context(r.operating_context,r.product_id,true) is not true
    or bx1_portal.fund_setup_current(r.setup_id,r.operating_context) is not true then
    raise exception 'alignment_authority_changed_after_wait' using errcode='42501';end if;
  if phase in ('ALIGNMENT_READ','ALIGNMENT_WRITE') then
    select * into o from bx1_private.fund_alignment_operations where id=a.operation_id and request_id=rid for update;
    if o.id is null or (a.operation_revision,a.intent_hash) is distinct from (o.revision,o.intent_hash) then
      raise exception 'alignment_receipt_subject_changed' using errcode='42501';end if;
  elsif a.operation_id is not null then raise exception 'alignment_receipt_wrong_subject' using errcode='42501';end if;
  insert into bx1_private.fund_alignment_consumptions(receipt_id,purpose) values(a.id,phase)
    on conflict on constraint fund_alignment_consumptions_pkey do nothing;
  if not found then raise exception 'alignment_receipt_already_used' using errcode='42501';end if;
  perform bx1_portal.fund_setup_audit(r.setup_id,null,'AUTHORITY_PHASE_CONSUMED',r.setup_revision,r.setup_revision,
    pg_catalog.jsonb_build_object('request_id',r.id,'receipt_id',a.id,'purpose',phase,'independence_proven',false));
  if a.expires_at<=pg_catalog.clock_timestamp() or bx1_portal.fund_setup_context(r.operating_context,r.product_id,true) is not true then
    raise exception 'alignment_receipt_expired_after_audit' using errcode='42501';end if;
end $fn$;

create or replace function public.bx1_portal_fund_alignment_authorise(setup_id uuid,expected_setup_revision integer,operating_context jsonb,purpose text) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare s bx1_portal.fund_setups;r bx1_portal.fund_admission_requests;o bx1_private.fund_alignment_operations;
  a bx1_private.fund_alignment_authorisations;j jsonb:=auth.jwt();b jsonb;now_at timestamptz;expires timestamptz;seed jsonb;
begin
  if auth.uid() is null or j->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or j->>'sub' is distinct from auth.uid()::text or j->>'aal' is distinct from 'aal2'
    or j->>'role' is distinct from 'authenticated' or j->>'session_id' is null
    or pg_catalog.jsonb_typeof(j->'exp') is distinct from 'number' or j->>'exp' !~ '^[0-9]{1,12}$'
    or (j->>'exp')::numeric<=pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())
    or purpose not in ('ALIGNMENT_READ','ALIGNMENT_WRITE','ADMISSION_READ','ADMISSION_WRITE') or purpose is null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'alignment_genuine_test_aal2_required' using errcode='42501';end if;
  select * into s from bx1_portal.fund_setups f where f.id=bx1_portal_fund_alignment_authorise.setup_id;
  if s.id is null or s.actor_id is distinct from auth.uid() or s.operating_context is distinct from operating_context
    or s.revision is distinct from expected_setup_revision then raise exception 'alignment_setup_scope_denied' using errcode='42501';end if;
  perform bx1_portal.fund_setup_lock(operating_context,s.product_id,true);
  seed:=bx1_portal.fund_admission_seed(s.id,expected_setup_revision,operating_context);
  select * into r from bx1_portal.fund_admission_requests q where q.setup_id=s.id and q.setup_revision=expected_setup_revision for update;
  if r.id is null or (purpose like 'ALIGNMENT_%' and r.status<>'RESERVED_NOT_ADMITTED')
    or (purpose like 'ADMISSION_%' and r.status not in ('RESERVED_NOT_ADMITTED','ADMITTED')) or (r.actor_id,r.operating_context,r.product_id,r.offering_revision_id)
    is distinct from (auth.uid(),operating_context,s.product_id,s.offering_revision_id)
    or r.roleplay_policy_id::text is distinct from s.roleplay_policy->>'policy_id'
    or r.roleplay_epoch is distinct from (s.roleplay_policy->>'epoch')::integer then raise exception 'alignment_original_admission_required' using errcode='42501';end if;
  b:=bx1_private.fund_alignment_binding(r.id);
  if purpose like 'ALIGNMENT_%' then
    if r.roleplay_epoch<2 then raise exception 'alignment_positive_one_step_epoch_required' using errcode='42501';end if;
    insert into bx1_private.fund_alignment_operations(request_id) values(r.id) on conflict(request_id) do nothing;
    select * into strict o from bx1_private.fund_alignment_operations x where x.request_id=r.id for update;
  end if;
  now_at:=pg_catalog.clock_timestamp();expires:=least(now_at+interval '60 seconds',pg_catalog.to_timestamp((j->>'exp')::double precision),s.expires_at,
    (s.roleplay_policy->>'expires_at')::timestamptz);
  if expires<=now_at or bx1_portal.fund_setup_context(operating_context,s.product_id,true) is not true then
    raise exception 'alignment_current_authority_expired' using errcode='42501';end if;
  insert into bx1_private.fund_alignment_authorisations(request_id,actor_id,operating_context,session_id,purpose,input_hash,native_binding_hash,reason_hash,
    operation_id,operation_revision,intent_hash,claims,created_at,expires_at)
    values(r.id,auth.uid(),operating_context,(j->>'session_id')::uuid,purpose,r.input_hash,b->>'native_binding_hash',b->>'reason_hash',
      case when purpose like 'ALIGNMENT_%' then o.id else null end,case when purpose like 'ALIGNMENT_%' then o.revision else null end,
      case when purpose like 'ALIGNMENT_%' then o.intent_hash else null end,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('sub',j->'sub','session_id',j->'session_id','aal',j->'aal',
        'exp',j->'exp','role',j->'role','amr',j->'amr','iss',j->'iss')),now_at,expires) returning * into a;
  perform bx1_portal.fund_setup_audit(s.id,null,'AUTHORITY_PHASE_AUTHORISED',s.revision,s.revision,
    pg_catalog.jsonb_build_object('request_id',r.id,'receipt_id',a.id,'purpose',purpose,'independence_proven',false));
  if a.expires_at<=pg_catalog.clock_timestamp() or bx1_portal.fund_setup_context(operating_context,s.product_id,true) is not true then
    raise exception 'alignment_authorisation_changed_at_commit' using errcode='42501';end if;
  return bx1_private.fund_alignment_view(r.id,a.id,false);
end $fn$;

create or replace function bx1_portal.read_fund_authority_alignment(request_id uuid,actor_id uuid,c jsonb,receipt_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare prior text;r bx1_portal.fund_admission_requests;answer jsonb;
begin
  prior:=bx1_private.fund_alignment_enter(request_id,receipt_id,'ALIGNMENT_READ');
  select * into strict r from bx1_portal.fund_admission_requests where id=request_id;
  if (r.actor_id,r.operating_context) is distinct from (actor_id,c) then raise exception 'alignment_reader_scope_denied' using errcode='42501';end if;
  perform bx1_portal.fund_setup_lock(c,r.product_id,true);perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,c);
  perform bx1_private.fund_alignment_consume(r.id,receipt_id,'ALIGNMENT_READ');
  answer:=bx1_private.fund_alignment_view(r.id,receipt_id,true);
  perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $fn$;

create or replace function bx1_portal.record_fund_authority_alignment(preparation jsonb,action text,request_key uuid,evidence jsonb,receipt_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare prior text;r bx1_portal.fund_admission_requests;o bx1_private.fund_alignment_operations;old_request bx1_private.fund_alignment_requests;
  b jsonb;i jsonb;tx jsonb;signature text;v_signer text;obs jsonb;owners jsonb;runtime text;answer jsonb;before_rev integer;candidate text;current_read jsonb;
begin
  if action not in ('PREPARE','SIGNATURE','CLAIM','HASH','OBSERVE') or action is null or request_key is null
    or request_key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(preparation) is distinct from 'object'
    or pg_catalog.jsonb_typeof(evidence) is distinct from 'object' or pg_catalog.octet_length(evidence::text)>524288 then
    raise exception 'alignment_invalid_worker_request' using errcode='22023';end if;
  prior:=bx1_private.fund_alignment_enter((preparation->>'admission_request_id')::uuid,receipt_id,'ALIGNMENT_WRITE');
  select * into strict r from bx1_portal.fund_admission_requests where id=(preparation->>'admission_request_id')::uuid;
  perform bx1_portal.fund_setup_lock(r.operating_context,r.product_id,true);perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);
  perform bx1_private.fund_alignment_consume(r.id,receipt_id,'ALIGNMENT_WRITE');
  select * into strict o from bx1_private.fund_alignment_operations where request_id=r.id for update;
  b:=bx1_private.fund_alignment_binding(r.id);current_read:=bx1_private.fund_alignment_view(r.id,receipt_id,true);
  if preparation-array['operation','authority_expires_at','authorisation_receipt_id'] is distinct from
    current_read-array['operation','authority_expires_at','authorisation_receipt_id']
    or preparation#>>'{operation,id}' is distinct from o.id::text then raise exception 'alignment_preparation_binding_changed' using errcode='23514';end if;
  if action='CLAIM' and o.claimed_at is not null then raise exception 'alignment_execution_already_claimed' using errcode='42501';end if;
  select * into old_request from bx1_private.fund_alignment_requests q where q.actor_id=r.actor_id and q.request_key=record_fund_authority_alignment.request_key and q.action=record_fund_authority_alignment.action;
  if old_request.actor_id is not null then
    if old_request.operation_id is distinct from o.id or old_request.action is distinct from action or old_request.evidence is distinct from evidence then
      raise exception 'alignment_idempotency_conflict' using errcode='23505';end if;
    answer:=current_read;perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
  end if;
  if action<>'HASH' and preparation#>'{operation,revision}' is distinct from pg_catalog.to_jsonb(o.revision) then
    raise exception 'alignment_stale_operation_revision' using errcode='23514';end if;
  if action='HASH' and ((preparation#>>'{operation,revision}')::integer>o.revision or preparation#>>'{operation,intent_hash}' is distinct from o.intent_hash) then
    raise exception 'alignment_late_hash_wrong_operation' using errcode='23514';end if;
  before_rev:=o.revision;
  if action='PREPARE' then
    perform bx1_portal.require_keys(evidence,array['already_aligned','intent']);
    if evidence->'already_aligned'='true'::jsonb then
      if evidence->'intent' is distinct from 'null'::jsonb or o.state<>'NEW' or o.claimed_at is not null then
        raise exception 'alignment_getter_not_execution_proof' using errcode='23514';end if;
    else
      i:=evidence->'intent';
      perform bx1_portal.require_keys(i,array['version','chain_id','admission_request_id','native_binding_hash','reason_hash','previous_epoch','target_epoch',
        'controller_address','controller_runtime_hash','factory_address','safe_address','safe_owners','safe_threshold','executor_address','executor_nonce',
        'safe_transaction','safe_transaction_hash','snapshot','valid_until']);
      owners:=r.input#>'{setup,setup,safe_owners}';
      select step#>>'{intent,expected_runtime_hash}' into runtime from pg_catalog.jsonb_array_elements(r.input#>'{setup,setup,steps}') step where step->>'step_key'='controller';
      tx:=i->'safe_transaction';perform bx1_portal.require_keys(tx,array['to','value','data','operation','safeTxGas','baseGas','gasPrice','gasToken','refundReceiver','nonce']);
      if evidence->'already_aligned' is distinct from 'false'::jsonb or i->'version' is distinct from '1'::jsonb or i->'chain_id' is distinct from '80002'::jsonb
        or i->>'admission_request_id' is distinct from r.id::text or i->>'native_binding_hash' is distinct from b->>'native_binding_hash'
        or i->>'reason_hash' is distinct from b->>'reason_hash' or i->'previous_epoch' is distinct from pg_catalog.to_jsonb(r.roleplay_epoch-1)
        or i->'target_epoch' is distinct from pg_catalog.to_jsonb(r.roleplay_epoch) or i->>'safe_address' is distinct from r.input#>>'{setup,setup,safe_address}'
        or i->>'controller_address' is distinct from r.input#>>'{setup,setup,dependencies,controller}' or i->>'controller_runtime_hash' is distinct from runtime
        or i->>'factory_address' is distinct from r.input#>>'{setup,setup,dependencies,trex_factory}' or i->'safe_owners' is distinct from owners
        or i->'safe_threshold' is distinct from r.input#>'{setup,setup,safe_threshold}' or pg_catalog.jsonb_array_length(owners)<2
        or i->>'executor_address' is distinct from r.input->>'signer_address' or not (owners ? (i->>'executor_address'))
        or pg_catalog.jsonb_typeof(i->'executor_nonce') is distinct from 'string' or i->>'executor_nonce' !~ '^(0|[1-9][0-9]{0,19})$'
        or (i->>'executor_nonce')::numeric>=18446744073709551616::numeric
        or tx->>'to' is distinct from i->>'controller_address' or tx->>'value' is distinct from '0' or tx->'operation' is distinct from '0'::jsonb
        or tx->>'data' is distinct from '0x6c76176b'||pg_catalog.lpad(pg_catalog.to_hex(r.roleplay_epoch),64,'0')||pg_catalog.substr(b->>'reason_hash',3)
        or tx->>'safeTxGas' is distinct from '0' or tx->>'baseGas' is distinct from '0' or tx->>'gasPrice' is distinct from '0'
        or tx->>'gasToken' is distinct from '0x0000000000000000000000000000000000000000'
        or tx->>'refundReceiver' is distinct from '0x0000000000000000000000000000000000000000'
        or pg_catalog.jsonb_typeof(tx->'nonce') is distinct from 'string' or tx->>'nonce' !~ '^(0|[1-9][0-9]{0,77})$'
        or pg_catalog.jsonb_typeof(i->'safe_transaction_hash') is distinct from 'string' or i->>'safe_transaction_hash' !~ '^0x[0-9a-f]{64}$' or i->>'safe_transaction_hash' ~ '^0x0{64}$'
        or bx1_private.fund_alignment_snapshot_valid(i->'snapshot') is not true
        or pg_catalog.jsonb_typeof(i->'valid_until') is distinct from 'string'
        or (i->>'valid_until')::timestamptz<=pg_catalog.clock_timestamp()
        or (i->>'valid_until')::timestamptz>(r.input#>>'{setup,setup,expires_at}')::timestamptz
        or (i->>'valid_until')::timestamptz>(r.input#>>'{setup,roleplay_policy,expires_at}')::timestamptz then
        raise exception 'alignment_exact_one_step_intent_required' using errcode='23514';end if;
      if o.intent is not null then
        if o.intent is distinct from i then raise exception 'alignment_original_intent_preserved' using errcode='23505';end if;
      elsif o.state<>'NEW' then raise exception 'alignment_preparation_state_denied' using errcode='23514';
      else update bx1_private.fund_alignment_operations x set intent=i,intent_hash=bx1_portal.fund_digest(i),state='PREPARED',
        executor_nonce=(i->>'executor_nonce')::numeric,executor_address=i->>'executor_address',safe_address=i->>'safe_address',safe_nonce=(tx->>'nonce')::numeric,
        revision=x.revision+1 where x.id=o.id;end if;
    end if;
  elsif action='SIGNATURE' then
    perform bx1_portal.require_keys(evidence,array['signer','signature']);v_signer:=evidence->>'signer';signature:=evidence->>'signature';
    if o.state not in ('PREPARED','SIGNING') or o.claimed_at is not null or o.intent is null or (o.intent->>'valid_until')::timestamptz<=pg_catalog.clock_timestamp()
      or not (o.intent->'safe_owners' ? v_signer) or bx1_portal.fund_setup_wallet_current(r.actor_id,v_signer) is not true
      or signature is null or signature !~ '^0x[0-9a-f]{130}$' or pg_catalog.substr(signature,131,2) not in ('1b','1c')
      or pg_catalog.substr(signature,3,64) ~ '^0{64}$' or pg_catalog.substr(signature,67,64) ~ '^0{64}$'
      or pg_catalog.decode(pg_catalog.substr(signature,67,64),'hex')>pg_catalog.decode('7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0','hex')
      or exists(select 1 from bx1_private.fund_alignment_signatures x where x.operation_id=o.id and x.signer=v_signer) then
      raise exception 'alignment_signature_owner_or_canonical_form_denied' using errcode='23514';end if;
    -- Cryptographic recovery is performed by the sealed chain worker, never by a public DTO.
    insert into bx1_private.fund_alignment_signatures(operation_id,signer,signature,request_key) values(o.id,v_signer,signature,record_fund_authority_alignment.request_key);
    update bx1_private.fund_alignment_operations x set state='SIGNING',revision=x.revision+1 where x.id=o.id;
  elsif action='CLAIM' then
    perform bx1_portal.require_keys(evidence,array['intent','execution']);tx:=evidence->'execution';
    perform bx1_portal.require_keys(tx,array['chain_id','from','to','value','data','nonce']);
    if o.state not in ('PREPARED','SIGNING') or o.intent is null or o.intent is distinct from evidence->'intent'
      or (o.intent->>'valid_until')::timestamptz<=pg_catalog.clock_timestamp() or o.claimed_at is not null
      or (select count(*) from bx1_private.fund_alignment_signatures x where x.operation_id=o.id)<(o.intent->>'safe_threshold')::integer
      or tx->'chain_id' is distinct from '80002'::jsonb or tx->>'from' is distinct from o.executor_address
      or tx->>'to' is distinct from o.safe_address or tx->>'value' is distinct from '0' or tx->>'nonce' is distinct from o.executor_nonce::text
      or pg_catalog.jsonb_typeof(tx->'data') is distinct from 'string' or tx->>'data' !~ '^0x[0-9a-f]+$' or pg_catalog.char_length(tx->>'data')>16386
      or tx->>'data' is distinct from bx1_private.fund_alignment_execution_data(o.id)
      or exists(select 1 from bx1_private.fund_alignment_signatures x where x.operation_id=o.id and bx1_portal.fund_setup_wallet_current(r.actor_id,x.signer) is not true) then
      raise exception 'alignment_single_flight_claim_denied' using errcode='23514';end if;
    update bx1_private.fund_alignment_operations x set state='UNKNOWN',claimed_at=pg_catalog.clock_timestamp(),claim_key=record_fund_authority_alignment.request_key,
      execution=tx,revision=x.revision+1 where x.id=o.id;
  elsif action='HASH' then
    perform bx1_portal.require_keys(evidence,array['transaction_hash']);candidate:=evidence->>'transaction_hash';
    if o.claimed_at is null or candidate is null or candidate !~ '^0x[0-9a-f]{64}$' or candidate ~ '^0x0{64}$' then
      raise exception 'alignment_original_claim_required' using errcode='23514';end if;
    insert into bx1_private.fund_alignment_attempts(operation_id,transaction_hash,prior_candidate_hash,request_key)
      values(o.id,candidate,o.transaction_hash,record_fund_authority_alignment.request_key);
    if o.state='UNKNOWN' and o.transaction_hash is null then
      update bx1_private.fund_alignment_operations x set state='BROADCAST',transaction_hash=candidate,revision=x.revision+1 where x.id=o.id;end if;
  else
    obs:=evidence;perform bx1_portal.require_keys(obs,array['schema_version','chain_id','status','admission_request_id','native_binding_hash','safe_transaction_hash',
      'reason_hash','transaction_hash','executor_address','executor_nonce','safe_address','safe_nonce','controller_address','previous_epoch','target_epoch',
      'block_number','block_hash','confirmations','required_confirmations','snapshot','receipt_hashes','reason_code','inner_execution_success','epoch_verified','observed_epoch','epoch_event']);
    if o.claimed_at is null or o.intent is null or obs->'schema_version' is distinct from '1'::jsonb or obs->'chain_id' is distinct from '80002'::jsonb
      or obs->>'admission_request_id' is distinct from r.id::text or obs->>'native_binding_hash' is distinct from b->>'native_binding_hash'
      or obs->>'reason_hash' is distinct from b->>'reason_hash' or obs->>'safe_transaction_hash' is distinct from o.intent->>'safe_transaction_hash'
      or obs->>'executor_address' is distinct from o.executor_address or obs->>'executor_nonce' is distinct from o.executor_nonce::text
      or obs->>'safe_address' is distinct from o.safe_address or obs->>'safe_nonce' is distinct from o.safe_nonce::text
      or obs->>'controller_address' is distinct from o.intent->>'controller_address'
      or obs->'previous_epoch' is distinct from o.intent->'previous_epoch' or obs->'target_epoch' is distinct from o.intent->'target_epoch'
      or pg_catalog.jsonb_typeof(obs->'transaction_hash') is distinct from 'string' or obs->>'transaction_hash' !~ '^0x[0-9a-f]{64}$' or obs->>'transaction_hash' ~ '^0x0{64}$'
      or obs->'required_confirmations' is distinct from r.input->'required_confirmations'
      or bx1_private.fund_alignment_snapshot_valid(obs->'snapshot') is not true
      or obs->>'status' not in ('PENDING','FINAL','REVERTED') or obs->>'status' is null
      or pg_catalog.jsonb_typeof(obs->'inner_execution_success') is distinct from 'boolean' or pg_catalog.jsonb_typeof(obs->'epoch_verified') is distinct from 'boolean' then
      raise exception 'alignment_observation_binding_denied' using errcode='23514';end if;
    if obs->>'status'='FINAL' and (obs->'inner_execution_success' is distinct from 'true'::jsonb or obs->'epoch_verified' is distinct from 'true'::jsonb
      or obs->'observed_epoch' is distinct from o.intent->'target_epoch'
      or obs->'epoch_event' is distinct from pg_catalog.jsonb_build_object('previous_epoch',o.intent->'previous_epoch','target_epoch',o.intent->'target_epoch','reason_hash',o.intent->'reason_hash')
      or pg_catalog.jsonb_typeof(obs->'block_number') is distinct from 'string' or obs->>'block_number' !~ '^(0|[1-9][0-9]{0,77})$'
      or pg_catalog.jsonb_typeof(obs->'block_hash') is distinct from 'string' or obs->>'block_hash' !~ '^0x[0-9a-f]{64}$' or obs->>'block_hash' ~ '^0x0{64}$'
      or pg_catalog.jsonb_typeof(obs->'confirmations') is distinct from 'string' or obs->>'confirmations' !~ '^(0|[1-9][0-9]{0,77})$'
      or (obs->>'confirmations')::numeric<(r.input->>'required_confirmations')::numeric or obs->'reason_code' is distinct from 'null'::jsonb
      or pg_catalog.jsonb_typeof(obs->'receipt_hashes') is distinct from 'array' or pg_catalog.jsonb_array_length(obs->'receipt_hashes')<>2
      or pg_catalog.jsonb_typeof(obs#>'{receipt_hashes,0}') is distinct from 'string' or obs#>>'{receipt_hashes,0}' !~ '^[0-9a-f]{64}$' or obs#>'{receipt_hashes,0}' is distinct from obs#>'{receipt_hashes,1}'
      or (obs#>>'{snapshot,block,number}')::numeric<(obs->>'block_number')::numeric+(r.input->>'required_confirmations')::numeric-1) then
      raise exception 'alignment_exact_final_effects_required' using errcode='23514';end if;
    if obs->>'status'='REVERTED' and (obs->>'reason_code' not in ('ALIGNMENT_OUTER_REVERTED','ALIGNMENT_SAFE_INNER_FAILED') or obs->>'reason_code' is null) then
      raise exception 'alignment_reverted_reason_required' using errcode='23514';end if;
    insert into bx1_private.fund_alignment_observations(operation_id,request_key,evidence,evidence_hash)
      values(o.id,record_fund_authority_alignment.request_key,obs,bx1_portal.fund_digest(obs));
    if o.state='FINAL' then
      if o.transaction_hash is distinct from obs->>'transaction_hash' or obs->>'status'<>'FINAL' then
        raise exception 'alignment_final_history_preserved' using errcode='23514';end if;
    else update bx1_private.fund_alignment_operations x set state=obs->>'status',transaction_hash=obs->>'transaction_hash',observation=obs,revision=x.revision+1 where x.id=o.id;end if;
  end if;
  insert into bx1_private.fund_alignment_requests(actor_id,request_key,operation_id,action,evidence,evidence_hash)
    values(r.actor_id,record_fund_authority_alignment.request_key,o.id,action,evidence,bx1_portal.fund_digest(evidence));
  select * into strict o from bx1_private.fund_alignment_operations where id=o.id;
  perform bx1_portal.fund_setup_audit(r.setup_id,null,'AUTHORITY_ALIGNMENT_'||action,before_rev,o.revision,
    pg_catalog.jsonb_build_object('request_id',r.id,'operation_id',o.id,'request_key',request_key,'evidence_hash',bx1_portal.fund_digest(evidence),'independence_proven',false));
  if bx1_portal.fund_setup_context(r.operating_context,r.product_id,true) is not true
    or (select x.expires_at<=pg_catalog.clock_timestamp() from bx1_private.fund_alignment_authorisations x where x.id=receipt_id) then
    raise exception 'alignment_authority_changed_at_commit' using errcode='42501';end if;
  answer:=bx1_private.fund_alignment_view(r.id,receipt_id,true);perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $fn$;

create or replace function bx1_portal.read_fund_admission_authorised(request_id uuid,receipt_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare prior_receipt text:=pg_catalog.current_setting('bx1.authority_receipt',true);prior_phase text:=pg_catalog.current_setting('bx1.authority_phase',true);answer jsonb;
begin
  perform pg_catalog.set_config('bx1.authority_receipt',receipt_id::text,true);perform pg_catalog.set_config('bx1.authority_phase','ADMISSION_READ',true);
  answer:=bx1_portal.read_fund_admission(request_id);
  if (select x.expires_at<=pg_catalog.clock_timestamp() from bx1_private.fund_alignment_authorisations x where x.id=receipt_id) then
    raise exception 'alignment_admission_receipt_expired_after_wait' using errcode='42501';end if;
  perform pg_catalog.set_config('bx1.authority_receipt',coalesce(prior_receipt,''),true);perform pg_catalog.set_config('bx1.authority_phase',coalesce(prior_phase,''),true);return answer;
end $fn$;
create or replace function bx1_portal.record_fund_admission_authorised(request_id uuid,candidate jsonb,admitted_hash text,receipt_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare prior_receipt text:=pg_catalog.current_setting('bx1.authority_receipt',true);prior_phase text:=pg_catalog.current_setting('bx1.authority_phase',true);answer jsonb;
begin
  perform pg_catalog.set_config('bx1.authority_receipt',receipt_id::text,true);perform pg_catalog.set_config('bx1.authority_phase','ADMISSION_WRITE',true);
  answer:=bx1_portal.record_fund_admission(request_id,candidate,admitted_hash);
  if (select x.expires_at<=pg_catalog.clock_timestamp() from bx1_private.fund_alignment_authorisations x where x.id=receipt_id) then
    raise exception 'alignment_admission_receipt_expired_after_wait' using errcode='42501';end if;
  perform pg_catalog.set_config('bx1.authority_receipt',coalesce(prior_receipt,''),true);perform pg_catalog.set_config('bx1.authority_phase',coalesce(prior_phase,''),true);return answer;
end $fn$;

do $alignment_finish_install$
declare item record;signature text;relation text;p_before jsonb;p_after jsonb;original text;final_source text;
begin
  select pg_catalog.to_jsonb(p),p.prosrc into p_before,original from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_admission_worker_enter(uuid)'::regprocedure;
  final_source:=$alignment_worker_final$
declare r bx1_portal.fund_admission_requests;prior text;receipt uuid;phase text;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_admission_worker_only' using errcode='42501';end if;
  select * into r from bx1_portal.fund_admission_requests where id=request;
  phase:=pg_catalog.current_setting('bx1.authority_phase',true);
  if r.id is null or phase not in ('ADMISSION_READ','ADMISSION_WRITE') or phase is null
    or nullif(pg_catalog.current_setting('bx1.authority_receipt',true),'') is null then
    raise exception 'fund_admission_exact_authorisation_required' using errcode='42501';end if;
  receipt:=pg_catalog.current_setting('bx1.authority_receipt',true)::uuid;
  prior:=bx1_private.fund_alignment_enter(r.id,receipt,phase);
  perform bx1_portal.fund_setup_lock(r.operating_context,r.product_id,true);
  perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);
  perform bx1_private.fund_alignment_consume(r.id,receipt,phase);
  return coalesce(prior,'');
end $alignment_worker_final$;
  if original is distinct from final_source then
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original,'UTF8')),'hex')<>'3e238a44526efa202e243db0f9a1465e7448f77e8c803e53e4af4192f6e84ec7' then
      raise exception 'alignment_worker_inverse_preimage_changed' using errcode='55000';end if;
    execute pg_catalog.format('create or replace function bx1_portal.fund_admission_worker_enter(request uuid) returns text language plpgsql volatile security definer set search_path='''' as %L',final_source);
  end if;
  select pg_catalog.to_jsonb(p) into p_after from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_admission_worker_enter(uuid)'::regprocedure;
  if p_before-'prosrc' is distinct from p_after-'prosrc' or p_after->>'prosrc' is distinct from final_source then
    raise exception 'alignment_original_worker_metadata_changed' using errcode='55000';end if;
  foreach relation in array array['fund_alignment_operations','fund_alignment_signatures','fund_alignment_authorisations','fund_alignment_consumptions',
    'fund_alignment_requests','fund_alignment_attempts','fund_alignment_observations'] loop
    execute pg_catalog.format('alter table bx1_private.%I enable row level security',relation);
    for item in select distinct a.grantee from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      where c.oid=pg_catalog.to_regclass('bx1_private.'||relation) and a.grantee<>c.relowner loop
      execute pg_catalog.format('revoke all on table bx1_private.%I from %s',relation,case when item.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) end);end loop;
    if relation<>'fund_alignment_operations' and not exists(select 1 from pg_catalog.pg_trigger where tgrelid=pg_catalog.to_regclass('bx1_private.'||relation) and tgname=relation||'_immutable') then
      execute pg_catalog.format('create trigger %I before update or delete on bx1_private.%I for each row execute function bx1_portal.immutable_record()',relation||'_immutable',relation);end if;
    if exists(select 1 from pg_catalog.pg_policy where polrelid=pg_catalog.to_regclass('bx1_private.'||relation)) then raise exception 'alignment_private_policy_drift' using errcode='55000';end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_private.fund_alignment_operations'::regclass and tgname='fund_alignment_operation_guard') then
    create trigger fund_alignment_operation_guard before update or delete on bx1_private.fund_alignment_operations for each row execute function bx1_private.fund_alignment_operation_guard();end if;
  for item in select p.oid,p.oid::regprocedure::text signature,p.proowner from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='bx1_private' and p.proname like 'fund_alignment_%') or (n.nspname='bx1_portal' and p.proname in
      ('read_fund_authority_alignment','record_fund_authority_alignment','read_fund_admission_authorised','record_fund_admission_authorised'))
      or (n.nspname='public' and p.proname='bx1_portal_fund_alignment_authorise') loop
    for signature in select case when a.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) end
      from pg_catalog.aclexplode(coalesce((select proacl from pg_catalog.pg_proc where oid=item.oid),pg_catalog.acldefault('f',item.proowner))) a where a.grantee<>item.proowner loop
      execute pg_catalog.format('revoke all on function %s from %s',item.signature,signature);end loop;
  end loop;
end $alignment_finish_install$;
grant execute on function public.bx1_portal_fund_alignment_authorise(uuid,integer,jsonb,text) to authenticated;
grant execute on function bx1_portal.read_fund_authority_alignment(uuid,uuid,jsonb,uuid),
  bx1_portal.record_fund_authority_alignment(jsonb,text,uuid,jsonb,uuid),bx1_portal.read_fund_admission_authorised(uuid,uuid),
  bx1_portal.record_fund_admission_authorised(uuid,jsonb,text,uuid) to bx1_fund_execution_worker;
