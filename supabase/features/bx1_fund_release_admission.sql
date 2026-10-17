-- TEST-only setup -> release handoff. No synthetic chain/provider/financial
-- facts are seeded. Selected conformance is not an audit or MAIN admission.
do $preflight$ begin
  if current_user<>'postgres' or not bx1_private.test_roleplay_environment()
    or to_regprocedure('bx1_private.fund_roleplay_control_proof_current(uuid,integer,text,uuid)') is null
    or to_regclass('bx1_portal.fund_contract_release_receipts') is not null then
    raise exception 'fund_release_admission_baseline_required' using errcode='55000';end if;
end $preflight$;

create table bx1_portal.fund_contract_release_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  source_pin text not null check(source_pin='b6c5fabf86e733ede017fef754d59eeb8f80e3f4'),
  catalog_hash text not null check(catalog_hash='2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2'),
  application_commit text not null check(application_commit ~ '^[0-9a-f]{40}$'),
  harness_hash text not null check(harness_hash ~ '^[0-9a-f]{64}$'),
  dependency_lock_hash text not null check(dependency_lock_hash ~ '^[0-9a-f]{64}$'),
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  run_id bigint not null unique check(run_id>0),
  evidence_url text not null check(evidence_url='https://github.com/GulfBrick/BlockXOne/actions/runs/'||run_id::text),
  coverage jsonb not null check(pg_catalog.jsonb_typeof(coverage)='array' and pg_catalog.jsonb_array_length(coverage)>=13),
  assurance text not null default 'SELECTED_CANONICAL_EVM_CONFORMANCE_NOT_AUDIT' check(assurance='SELECTED_CANONICAL_EVM_CONFORMANCE_NOT_AUDIT'),
  independent_audit_proven boolean not null default false check(not independent_audit_proven),
  reviewed_by text not null check(char_length(reviewed_by) between 10 and 400),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  valid_until timestamptz not null check(pg_catalog.isfinite(valid_until)),
  check(valid_until>recorded_at)
);
create table bx1_portal.fund_admission_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  request_key uuid not null,
  setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
  setup_revision integer not null check(setup_revision>0),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null,
  actor_claims jsonb not null,
  roleplay_policy_id uuid not null references bx1_private.roleplay_policies(id) on delete restrict,
  roleplay_epoch integer not null check(roleplay_epoch>0),
  conformance_receipt_id uuid not null references bx1_portal.fund_contract_release_receipts(id) on delete restrict,
  manifest_id uuid not null unique default pg_catalog.gen_random_uuid(),
  signer_policy_id uuid not null unique default pg_catalog.gen_random_uuid(),
  input jsonb not null,
  input_hash text not null check(input_hash=bx1_portal.fund_digest(input)),
  status text not null default 'RESERVED_NOT_ADMITTED' check(status in ('RESERVED_NOT_ADMITTED','ADMITTED')),
  result_hash text,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  admitted_at timestamptz,
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  unique(actor_id,request_key),unique(setup_id,setup_revision),
  check((status='ADMITTED')=(result_hash is not null and admitted_at is not null))
);
create table bx1_portal.fund_admission_receipts (
  id uuid primary key,
  request_id uuid not null references bx1_portal.fund_admission_requests(id) on delete restrict,
  kind text not null check(kind in ('CONFORMANCE','GOVERNANCE','OBSERVATION_POLICY','ROLE_STATE')),
  evidence jsonb not null,
  evidence_hash text not null check(evidence_hash=bx1_portal.fund_digest(evidence)),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(request_id,kind)
);
create index fund_admission_requests_policy on bx1_portal.fund_admission_requests(roleplay_policy_id);
create index fund_admission_requests_product on bx1_portal.fund_admission_requests(product_id);
create index fund_admission_requests_conformance on bx1_portal.fund_admission_requests(conformance_receipt_id);
do $private_tables$ declare relation text;begin
  foreach relation in array array['fund_contract_release_receipts','fund_admission_requests','fund_admission_receipts'] loop
    execute pg_catalog.format('alter table bx1_portal.%I enable row level security',relation);
    execute pg_catalog.format('revoke all on bx1_portal.%I from public,anon,authenticated,service_role,bx1_fund_execution_worker',relation);
  end loop;
end $private_tables$;
create trigger fund_contract_release_receipt_immutable before update or delete on bx1_portal.fund_contract_release_receipts
  for each row execute function bx1_portal.immutable_record();
create trigger fund_admission_receipt_immutable before update or delete on bx1_portal.fund_admission_receipts
  for each row execute function bx1_portal.immutable_record();
create function bx1_portal.fund_admission_request_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' or (to_jsonb(NEW)-array['status','result_hash','admitted_at']) is distinct from
    (to_jsonb(OLD)-array['status','result_hash','admitted_at']) or OLD.status<>'RESERVED_NOT_ADMITTED'
    or NEW.status<>'ADMITTED' then raise exception 'fund_admission_request_immutable' using errcode='23514';end if;
  return NEW;
end $$;
create trigger fund_admission_request_immutable before update or delete on bx1_portal.fund_admission_requests
  for each row execute function bx1_portal.fund_admission_request_guard();

-- Caller is the reviewed SQL owner, not a web identity or evidence worker.
create function bx1_private.fund_record_conformance(body jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if session_user<>'postgres' or pg_catalog.current_setting('role',true) not in ('none','postgres')
    or not bx1_private.test_roleplay_environment() then raise exception 'conformance_owner_only' using errcode='42501';end if;
  perform bx1_portal.require_keys(body,array['application_commit','harness_hash','dependency_lock_hash','evidence_hash','run_id','coverage','reviewed_by','valid_until']);
  if exists(select 1 from jsonb_array_elements(body->'coverage') item where item->>'result' is distinct from 'PASSED') then
    raise exception 'conformance_failed_case' using errcode='23514';end if;
  insert into bx1_portal.fund_contract_release_receipts(source_pin,catalog_hash,application_commit,harness_hash,dependency_lock_hash,evidence_hash,run_id,evidence_url,coverage,reviewed_by,valid_until)
    values('b6c5fabf86e733ede017fef754d59eeb8f80e3f4','2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2',
      body->>'application_commit',body->>'harness_hash',body->>'dependency_lock_hash',body->>'evidence_hash',(body->>'run_id')::bigint,
      'https://github.com/GulfBrick/BlockXOne/actions/runs/'||(body->>'run_id'),body->'coverage',body->>'reviewed_by',(body->>'valid_until')::timestamptz)
    returning id into result;
  return result;
end $$;

create function bx1_portal.fund_admission_seed(sid uuid,expected integer,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;r bx1_portal.offering_revisions;p bx1_private.roleplay_policies;
  proof bx1_portal.fund_contract_release_receipts;owners jsonb;wallet record;classes jsonb;limit_units numeric;
begin
  select * into s from bx1_portal.fund_setups where id=sid;
  if s.id is null or s.revision<>expected or not bx1_portal.fund_setup_current(s.id,c)
    or not bx1_portal.fund_setup_context(c,s.product_id,true) or not bx1_portal.fund_setup_package_approved(s.product_id)
    or s.safe_state<>'VERIFIED' or s.recovery_hold or s.configuration is null
    or (select count(*) from bx1_portal.fund_setup_steps where setup_id=s.id and state='FINAL' and observation_id is not null)<>25 then
    raise exception 'fund_admission_current_verified_setup_required' using errcode='42501';end if;
  select * into p from bx1_private.roleplay_policies where id=(s.roleplay_policy->>'policy_id')::uuid;
  if p.id is null or not bx1_private.test_roleplay_current(p.id,s.product_id,s.offering_revision_id,auth.uid(),c,'admit_fund_release',null,p.authority_epoch)
    or p.authority_epoch<>(s.roleplay_policy->>'epoch')::integer then
    raise exception 'fund_admission_explicit_test_policy_required' using errcode='42501';end if;
  select * into r from bx1_portal.offering_revisions where id=s.offering_revision_id and product_id=s.product_id;
  select * into proof from bx1_portal.fund_contract_release_receipts where source_pin=s.source_pin and catalog_hash=s.catalog_hash
    and valid_until>pg_catalog.clock_timestamp() order by recorded_at desc limit 1;
  if proof.id is null then raise exception 'fund_admission_real_conformance_receipt_required' using errcode='23514';end if;
  owners:='[]'::jsonb;
  for wallet in select * from bx1_private.roleplay_wallet_slots where policy_id=p.id and user_id=auth.uid() and role='TokenisationAgent' order by wallet_address loop
    if not bx1_private.fund_roleplay_control_proof_current(p.id,p.authority_epoch,wallet.slot,auth.uid()) then
      raise exception 'fund_admission_actual_signing_key_proof_required' using errcode='42501';end if;
    owners:=owners||to_jsonb(wallet.wallet_address);
  end loop;
  if jsonb_array_length(owners)<2 or owners is distinct from s.safe_owners or s.safe_threshold<2
    or s.safe_threshold is distinct from (r.terms#>>'{deployment_configuration,signing,threshold}')::integer
    or s.safe_threshold>jsonb_array_length(owners) then raise exception 'fund_admission_exact_safe_quorum_required' using errcode='23514';end if;
  if (select count(distinct role) from bx1_private.roleplay_capacities where policy_id=p.id and user_id=auth.uid()
    and role in ('IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController')
    and bx1_portal.native_membership_effective(native_membership_id))<>6 then
    raise exception 'fund_admission_operating_capacities_required' using errcode='42501';end if;
  classes:=r.terms#>'{common_envelope,classes,0}';limit_units:=(r.terms->>'cap_units')::numeric*power(10::numeric,(classes->>'decimals')::integer);
  return jsonb_build_object('setup',bx1_portal.fund_setup_projection(s.product_id,c),'conformance_receipt_id',proof.id,
    'class_id',classes->>'class_id','class_name',classes->>'name','security_unit_decimals',(classes->>'decimals')::integer,
    'token_name',r.terms->>'name','token_symbol','BX1F','cap_units',r.terms->>'cap_units','maximum_operation_units',limit_units::numeric(78,0)::text,
    'claim_topics',jsonb_build_array('1'),'deployment_salt','bx1:'||r.id::text,'signer_address',owners->>0,
    'authority_epoch',p.authority_epoch,'required_confirmations',64);
end $$;
create function public.bx1_portal_fund_admission_seed(setup_id uuid,expected_revision integer,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_admission_seed(setup_id,expected_revision,operating_context); $$;

create function bx1_portal.fund_reserve_admission(sid uuid,expected integer,key uuid,predicted_token text,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;old bx1_portal.fund_admission_requests;seed jsonb;input jsonb;
  request_id uuid:=pg_catalog.gen_random_uuid();manifest_id uuid:=pg_catalog.gen_random_uuid();refs jsonb;
begin
  select * into s from bx1_portal.fund_setups where id=sid;
  perform bx1_portal.fund_setup_lock(c,s.product_id,true);
  select * into s from bx1_portal.fund_setups where id=sid for update;
  seed:=bx1_portal.fund_admission_seed(sid,expected,c);
  if key is null or predicted_token !~ '^0x[0-9a-f]{40}$' or predicted_token='0x0000000000000000000000000000000000000000' then
    raise exception 'fund_admission_reservation_invalid' using errcode='22023';end if;
  select * into old from bx1_portal.fund_admission_requests where actor_id=auth.uid() and request_key=key;
  if old.id is null then select * into old from bx1_portal.fund_admission_requests where setup_id=sid and setup_revision=expected;end if;
  if old.id is not null then
    if old.setup_id<>sid or old.setup_revision<>expected or old.operating_context<>c or old.actor_id<>auth.uid()
      or old.input->>'product_binding_hash'<>bx1_portal.fund_digest(jsonb_build_object('product',s.product_id,'offering',s.offering_revision_id,
        'terms',s.terms_hash,'configuration',s.configuration_hash,'class',seed->>'class_id','token',predicted_token)) then
      raise exception 'fund_admission_reservation_conflict' using errcode='23505';end if;
    return jsonb_build_object('request_id',old.id,'status',old.status,'input',old.input);
  end if;
  refs:=jsonb_build_object('conformance_receipt_id',pg_catalog.gen_random_uuid(),'governance_receipt_id',pg_catalog.gen_random_uuid(),
    'observation_policy_receipt_id',pg_catalog.gen_random_uuid(),'role_state_receipt_id',pg_catalog.gen_random_uuid());
  input:=(seed-'conformance_receipt_id')||jsonb_build_object('manifest_id',manifest_id,'proof_refs',refs,
    'product_binding_hash',bx1_portal.fund_digest(jsonb_build_object('product',s.product_id,'offering',s.offering_revision_id,'terms',s.terms_hash,
      'configuration',s.configuration_hash,'class',seed->>'class_id','token',predicted_token)));
  insert into bx1_portal.fund_admission_requests(id,request_key,setup_id,setup_revision,product_id,offering_revision_id,actor_id,operating_context,actor_claims,
    roleplay_policy_id,roleplay_epoch,conformance_receipt_id,manifest_id,input,input_hash)
    values(request_id,key,s.id,s.revision,s.product_id,s.offering_revision_id,auth.uid(),c,auth.jwt(),
      (s.roleplay_policy->>'policy_id')::uuid,(seed->>'authority_epoch')::integer,(seed->>'conformance_receipt_id')::uuid,manifest_id,input,bx1_portal.fund_digest(input));
  perform bx1_portal.fund_setup_audit(s.id,null,'RELEASE_ADMISSION_RESERVED',s.revision,s.revision,jsonb_build_object('request_id',request_id,'input_hash',bx1_portal.fund_digest(input)));
  if not bx1_portal.fund_setup_context(c,s.product_id,true) then raise exception 'fund_admission_authority_changed_at_commit' using errcode='42501';end if;
  return jsonb_build_object('request_id',request_id,'status','RESERVED_NOT_ADMITTED','input',input);
end $$;
create function public.bx1_portal_fund_admission_reserve(setup_id uuid,expected_revision integer,request_key uuid,predicted_token text,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_reserve_admission(setup_id,expected_revision,request_key,predicted_token,operating_context); $$;

create function bx1_portal.fund_admission_worker_enter(request uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_admission_requests;prior text;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_admission_worker_only' using errcode='42501';end if;
  select * into r from bx1_portal.fund_admission_requests where id=request;
  if r.id is null or r.actor_claims->>'sub' is distinct from r.actor_id::text
    or (r.actor_claims->>'exp')::numeric<=date_part('epoch',clock_timestamp()) then raise exception 'fund_admission_original_session_expired' using errcode='42501';end if;
  prior:=current_setting('request.jwt.claims',true);perform set_config('request.jwt.claims',r.actor_claims::text,true);
  perform bx1_portal.fund_setup_lock(r.operating_context,r.product_id,true);
  perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);
  return coalesce(prior,'');
end $$;
create function bx1_portal.read_fund_admission(request_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior text;r bx1_portal.fund_admission_requests;begin
  prior:=bx1_portal.fund_admission_worker_enter(request_id);
  select * into r from bx1_portal.fund_admission_requests where id=request_id;
  perform set_config('request.jwt.claims',prior,true);
  return jsonb_build_object('request_id',r.id,'status',r.status,'input',r.input);
end $$;

create function bx1_portal.record_fund_admission(request_id uuid,candidate jsonb,admitted_manifest_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior text;r bx1_portal.fund_admission_requests;s bx1_portal.fund_setups;p bx1_private.roleplay_policies;
  manifest jsonb;proof_refs jsonb;receipt_kind text;receipt_id uuid;evidence jsonb;capacity record;slot record;expiry timestamptz;policy_hash text;provider jsonb;
begin
  prior:=bx1_portal.fund_admission_worker_enter(request_id);
  select * into r from bx1_portal.fund_admission_requests where id=request_id for update;
  if r.status='ADMITTED' then
    if r.result_hash is distinct from bx1_portal.fund_digest(candidate) then raise exception 'fund_admission_result_conflict' using errcode='23505';end if;
    perform set_config('request.jwt.claims',prior,true);return jsonb_build_object('request_id',r.id,'status',r.status,'manifest_id',r.manifest_id,'signer_policy_id',r.signer_policy_id);
  end if;
  select * into s from bx1_portal.fund_setups where id=r.setup_id for share;
  select * into p from bx1_private.roleplay_policies where id=r.roleplay_policy_id for share;
  manifest:=candidate->'manifest';proof_refs:=r.input->'proof_refs';expiry:=least(s.expires_at,p.valid_until,
    (select valid_until from bx1_portal.fund_contract_release_receipts where id=r.conformance_receipt_id));
  -- Missing/JSON-null observations must fail before casts or nullable SQL time
  -- comparisons. They cannot be upgraded to a governance/network receipt.
  if jsonb_typeof(candidate->'observed') is distinct from 'object'
    or jsonb_typeof(candidate#>'{observed,block}') is distinct from 'object'
    or jsonb_typeof(candidate#>'{observed,providers}') is distinct from 'array'
    or jsonb_typeof(candidate#>'{observed,block,number}') is distinct from 'string'
    or coalesce(candidate#>>'{observed,block,number}','') !~ '^(0|[1-9][0-9]{0,12})$'
    or jsonb_typeof(candidate#>'{observed,block,hash}') is distinct from 'string'
    or coalesce(candidate#>>'{observed,block,hash}','') !~ '^0x[0-9a-f]{64}$'
    or candidate#>>'{observed,block,hash}'='0x'||repeat('0',64)
    or jsonb_typeof(candidate#>'{observed,block,timestamp}') is distinct from 'string'
    or coalesce(candidate#>>'{observed,block,timestamp}','')='' then
    raise exception 'fund_admission_complete_observation_required' using errcode='23514';end if;
  perform bx1_portal.require_keys(candidate#>'{observed,block}',array['number','hash','timestamp']);
  if not pg_catalog.isfinite((candidate#>>'{observed,block,timestamp}')::timestamptz) then
    raise exception 'fund_admission_finite_observation_required' using errcode='23514';end if;
  for provider in select value from jsonb_array_elements(candidate#>'{observed,providers}') loop
    if jsonb_typeof(provider) is distinct from 'object'
      or jsonb_typeof(provider->'url') is distinct from 'string'
      or jsonb_typeof(provider->'finalized_block_number') is distinct from 'string'
      or coalesce(provider->>'finalized_block_number','') !~ '^(0|[1-9][0-9]{0,12})$'
      or jsonb_typeof(provider->'finalized_block_hash') is distinct from 'string'
      or coalesce(provider->>'finalized_block_hash','') !~ '^0x[0-9a-f]{64}$'
      or provider->>'finalized_block_hash'='0x'||repeat('0',64) then
      raise exception 'fund_admission_complete_provider_observation_required' using errcode='23514';end if;
    perform bx1_portal.require_keys(provider,array['url','finalized_block_number','finalized_block_hash']);
    if (provider->>'finalized_block_number')::numeric<(candidate#>>'{observed,block,number}')::numeric then
      raise exception 'fund_admission_observation_not_finalized' using errcode='23514';end if;
  end loop;
  if jsonb_typeof(candidate) is distinct from 'object' or candidate->>'status' is distinct from 'NOT_ADMITTED'
    or candidate->>'environment' is distinct from 'TESTNET' or candidate->>'chain_id' is distinct from '80002'
    or candidate->>'setup_id' is distinct from s.id::text or candidate->>'setup_revision' is distinct from s.revision::text
    or candidate->>'product_id' is distinct from s.product_id::text or candidate->>'offering_revision_id' is distinct from s.offering_revision_id::text
    or candidate->>'terms_hash' is distinct from s.terms_hash or candidate->>'configuration_hash' is distinct from s.configuration_hash
    or candidate->>'product_binding_hash' is distinct from r.input->>'product_binding_hash'
    or candidate->>'source_pin' is distinct from s.source_pin or candidate->>'catalog_hash' is distinct from s.catalog_hash
    or candidate->'proof_refs' is distinct from proof_refs or candidate->'roleplay_policy' is distinct from s.roleplay_policy
    or candidate->'independent_audit_proven' is distinct from 'false'::jsonb or candidate->'standard_claim_expiry_enforced' is distinct from 'false'::jsonb
    or candidate->>'authority_epoch' is distinct from p.authority_epoch::text or admitted_manifest_hash !~ '^[0-9a-f]{64}$'
    or manifest->>'id' is distinct from r.manifest_id::text or manifest#>'{safe,owners}' is distinct from s.safe_owners
    or manifest#>>'{safe,address}' is distinct from s.safe_address or manifest#>>'{safe,threshold}' is distinct from s.safe_threshold::text
    or ((candidate#>>'{observed,providers,0,url}' is distinct from 'https://polygon-amoy.drpc.org'
      or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy-bor-rpc.publicnode.com'
        and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))
      and (candidate#>>'{observed,providers,0,url}' is distinct from 'https://80002.rpc.thirdweb.com'
        or candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))
    or jsonb_array_length(candidate#>'{observed,providers}')<>2
    or expiry<=clock_timestamp() or (candidate#>>'{observed,block,timestamp}')::timestamptz>clock_timestamp()+interval '30 seconds'
    or (candidate#>>'{observed,block,timestamp}')::timestamptz<clock_timestamp()-interval '20 minutes' then
    raise exception 'fund_admission_exact_evidence_required' using errcode='23514';end if;
  if manifest#>>'{token_details,name}' is distinct from r.input->>'token_name' or manifest#>>'{token_details,symbol}' is distinct from r.input->>'token_symbol'
    or manifest#>>'{token_details,decimals}' is distinct from r.input->>'security_unit_decimals'
    or manifest->'token_details'->'claim_topics' is distinct from r.input->'claim_topics'
    or candidate->>'class_id' is distinct from r.input->>'class_id' or candidate->>'class_name' is distinct from r.input->>'class_name'
    or manifest->>'product_binding_hash' is distinct from r.input->>'product_binding_hash'
    or candidate#>>'{deployment_expectation,deployment,salt}' is distinct from r.input->>'deployment_salt'
    or candidate#>'{deployment_expectation,manifest}' is distinct from manifest or candidate#>'{issuance_expectation,manifest}' is distinct from manifest then
    raise exception 'fund_admission_current_terms_required' using errcode='23514';end if;
  perform bx1_private.fund_roleplay_enter(r.operating_context,r.product_id,'admit_fund_release',r.request_key);
  foreach receipt_kind in array array['CONFORMANCE','GOVERNANCE','OBSERVATION_POLICY','ROLE_STATE'] loop
    receipt_id:=(proof_refs->>case receipt_kind when 'CONFORMANCE' then 'conformance_receipt_id' when 'GOVERNANCE' then 'governance_receipt_id'
      when 'OBSERVATION_POLICY' then 'observation_policy_receipt_id' else 'role_state_receipt_id' end)::uuid;
    evidence:=jsonb_build_object('kind',receipt_kind,'setup_id',s.id,'setup_revision',s.revision,'product_id',r.product_id,'offering_revision_id',r.offering_revision_id,
      'terms_hash',s.terms_hash,'configuration_hash',s.configuration_hash,'catalog_hash',s.catalog_hash,'source_pin',s.source_pin,
      'roleplay_policy_id',p.id,'authority_epoch',p.authority_epoch,'independence_proven',false,'audit_proven',false,'expiry_enforced_on_chain',false,
      'conformance_receipt_id',r.conformance_receipt_id,'observed',candidate->'observed','safe',manifest->'safe','candidate_hash',bx1_portal.fund_digest(candidate));
    insert into bx1_portal.fund_admission_receipts(id,request_id,kind,evidence,evidence_hash) values(receipt_id,r.id,receipt_kind,evidence,bx1_portal.fund_digest(evidence));
  end loop;
  manifest:=manifest||jsonb_build_object('status','ADMITTED','hash',admitted_manifest_hash);
  insert into bx1_portal.fund_release_manifests(id,product_id,offering_revision_id,native_organisation_id,environment,chain_id,release_version,source_commit,
    manifest_hash,configuration_hash,product_binding_hash,terms_hash,authority_epoch,expected_token_address,controller_address,execution_account,required_confirmations,
    security_unit_decimals,class_id,class_name,deployment_expectation,issuance_expectation,status,conformance_receipt_id,governance_receipt_id,observation_policy_receipt_id,admitted_by,admitted_until)
    values(r.manifest_id,r.product_id,r.offering_revision_id,p.native_organisation_id,'TESTNET',80002,'ERC3643_4.1.3',s.source_pin,admitted_manifest_hash,
      s.configuration_hash,r.input->>'product_binding_hash',s.terms_hash,p.authority_epoch,manifest#>>'{suite,token,address}',manifest#>>'{controller,address}',s.safe_address,
      (r.input->>'required_confirmations')::integer,(r.input->>'security_unit_decimals')::integer,(r.input->>'class_id')::uuid,r.input->>'class_name',
      jsonb_set(candidate->'deployment_expectation','{manifest}',manifest),jsonb_set(candidate->'issuance_expectation','{manifest}',manifest),'ADMITTED',
      (proof_refs->>'conformance_receipt_id')::uuid,(proof_refs->>'governance_receipt_id')::uuid,(proof_refs->>'observation_policy_receipt_id')::uuid,auth.uid(),expiry);
  policy_hash:=bx1_portal.fund_digest(jsonb_build_object('manifest',r.manifest_id,'manifest_hash',admitted_manifest_hash,'roleplay_policy_id',p.id,
    'epoch',p.authority_epoch,'owners',s.safe_owners,'threshold',s.safe_threshold,'role_state_receipt',proof_refs->>'role_state_receipt_id'));
  insert into bx1_portal.fund_signer_policies(id,manifest_id,authority_policy_hash,authority_epoch,approval_threshold,safe_threshold,status,admission_receipt_id,admitted_until)
    values(r.signer_policy_id,r.manifest_id,policy_hash,p.authority_epoch,s.safe_threshold,s.safe_threshold,'ADMITTED',(proof_refs->>'role_state_receipt_id')::uuid,expiry);
  for capacity in select * from bx1_private.roleplay_capacities where policy_id=p.id and user_id=r.actor_id
    and role in ('IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController') order by role loop
    if capacity.role='TokenisationAgent' then
      for slot in select * from bx1_private.roleplay_wallet_slots where policy_id=p.id and user_id=r.actor_id and role='TokenisationAgent' order by wallet_address loop
        if not bx1_private.fund_roleplay_control_proof_current(p.id,p.authority_epoch,slot.slot,r.actor_id) then raise exception 'fund_admission_key_proof_changed' using errcode='42501';end if;
        insert into bx1_portal.fund_authorities(signer_policy_id,user_id,native_membership_id,person_id,role,can_approve,can_sign,signer_address,authority_receipt_id,valid_from,valid_until,status)
          values(r.signer_policy_id,r.actor_id,capacity.native_membership_id,p.actual_operator_person_id,capacity.role,true,true,slot.wallet_address,
            (proof_refs->>'role_state_receipt_id')::uuid,clock_timestamp(),expiry,'ADMITTED');
      end loop;
    else
      insert into bx1_portal.fund_authorities(signer_policy_id,user_id,native_membership_id,person_id,role,can_approve,can_sign,authority_receipt_id,valid_from,valid_until,status)
        values(r.signer_policy_id,r.actor_id,capacity.native_membership_id,p.actual_operator_person_id,capacity.role,true,false,
          (proof_refs->>'role_state_receipt_id')::uuid,clock_timestamp(),expiry,'ADMITTED');
    end if;
  end loop;
  if not bx1_portal.fund_manifest_current(r.manifest_id) then raise exception 'fund_admission_manifest_not_current' using errcode='23514';end if;
  update bx1_portal.fund_admission_requests set status='ADMITTED',result_hash=bx1_portal.fund_digest(candidate),admitted_at=clock_timestamp() where id=r.id;
  perform bx1_portal.fund_audit(r.product_id,r.manifest_id,null,'RELEASE_ADMITTED',r.operating_context,1,1,(proof_refs->>'governance_receipt_id')::uuid,candidate);
  perform bx1_private.fund_roleplay_finish(r.operating_context,r.product_id,'admit_fund_release',r.request_key);
  perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);
  perform set_config('request.jwt.claims',prior,true);
  return jsonb_build_object('request_id',r.id,'status','ADMITTED','manifest_id',r.manifest_id,'signer_policy_id',r.signer_policy_id);
end $$;

do $close_helpers$ declare proc record;begin
  for proc in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_portal','bx1_private') and p.proname in ('fund_record_conformance','fund_admission_request_guard','fund_admission_seed',
      'fund_reserve_admission','fund_admission_worker_enter','read_fund_admission','record_fund_admission') loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_fund_execution_worker',proc.signature);
  end loop;
end $close_helpers$;
revoke all on function public.bx1_portal_fund_admission_seed(uuid,integer,jsonb),public.bx1_portal_fund_admission_reserve(uuid,integer,uuid,text,jsonb) from public,anon,authenticated,service_role,bx1_fund_execution_worker;
grant execute on function public.bx1_portal_fund_admission_seed(uuid,integer,jsonb),public.bx1_portal_fund_admission_reserve(uuid,integer,uuid,text,jsonb),
  bx1_portal.fund_admission_seed(uuid,integer,jsonb),bx1_portal.fund_reserve_admission(uuid,integer,uuid,text,jsonb) to authenticated;
grant execute on function bx1_portal.read_fund_admission(uuid),bx1_portal.record_fund_admission(uuid,jsonb,text) to bx1_fund_execution_worker;
