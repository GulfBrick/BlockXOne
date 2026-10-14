-- TEST-only persistent bootstrap for the existing product, not a new fund writer.
-- No release, Safe, governance receipt, person, role or chain effect is seeded.
-- Apply atomically; MAIN is deliberately rejected. Final release admission is
-- not implemented here: real conformance/governance/observation receipts are required.
do $baseline$
begin
  if current_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_portal.fund_audit(uuid,uuid,uuid,text,jsonb,integer,integer,uuid,jsonb)') is null
    or pg_catalog.to_regclass('bx1_portal.fund_setups') is not null then
    raise exception 'fund_setup_test_baseline_required' using errcode='55000'; end if;
end $baseline$;

create table bx1_portal.fund_setups (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null references bx1_portal.offering_revisions(id) on delete restrict,
  product_revision integer not null check(product_revision>0),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  configuration_hash text not null check(configuration_hash ~ '^[0-9a-f]{64}$'),
  source_pin text not null default 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4'
    check(source_pin='b6c5fabf86e733ede017fef754d59eeb8f80e3f4'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null, actor_claims jsonb not null,
  roleplay_policy jsonb, revision integer not null default 1 check(revision>0),
  expires_at timestamptz not null, revoked_at timestamptz,
  recovery_hold boolean not null default false,recovery_reason text,recovery_observation_id uuid,
  safe_address text check(safe_address ~ '^0x[0-9a-f]{40}$'),
  safe_state text not null default 'NOT_IMPORTED' check(safe_state in ('NOT_IMPORTED','REQUESTED','OBSERVED_NOT_ADMITTED','VERIFIED')),
  safe_owners jsonb not null default '[]', safe_threshold integer check(safe_threshold between 2 and 20),
  safe_observation_id uuid,
  safe_configuration jsonb,safe_configuration_hash text check(safe_configuration_hash ~ '^[0-9a-f]{64}$'),
  configuration jsonb, setup_configuration_hash text check(setup_configuration_hash ~ '^[0-9a-f]{64}$'),
  catalog_hash text check(catalog_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(product_id,offering_revision_id),
  check((configuration is null)=(setup_configuration_hash is null))
);
create table bx1_portal.fund_setup_steps (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
  step_key text not null, ordinal integer not null check(ordinal between 0 and 25),
  kind text not null check(kind in ('CREATE','CALL')), revision integer not null default 1 check(revision>0),
  state text not null default 'NOT_STARTED' check(state in ('NOT_STARTED','PREPARED','UNKNOWN','BROADCAST','PENDING','FINAL','REVERTED','REPLACED','REORGED')),
  actor_id uuid references auth.users(id) on delete restrict,
  sender text check(sender ~ '^0x[0-9a-f]{40}$'), nonce numeric(78,0) check(nonce>=0),
  intent jsonb, intent_hash text check(intent_hash ~ '^[0-9a-f]{64}$'),data_hash text check(data_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz, claimed_at timestamptz,
  transaction_hash text check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  deployed_address text check(deployed_address ~ '^0x[0-9a-f]{40}$'), observation_id uuid, reason_code text,
  unique(setup_id,step_key),unique(setup_id,ordinal),
  check((intent is null)=(intent_hash is null)),
  check(state='NOT_STARTED' or (intent is not null and data_hash is not null and actor_id is not null and sender is not null and nonce is not null)),
  check(state not in ('BROADCAST','PENDING','FINAL','REVERTED','REPLACED','REORGED') or transaction_hash is not null)
);
-- Holds UNKNOWN indefinitely. Timeouts never release or manufacture a new nonce.
create unique index fund_setup_nonce_lease on bx1_portal.fund_setup_steps(sender,nonce) where nonce is not null;
create table bx1_portal.fund_setup_requests (
  actor_id uuid not null references auth.users(id) on delete restrict, request_key uuid not null,
  setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
  command text not null, payload jsonb not null, operating_context jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),primary key(actor_id,request_key)
);
create table bx1_portal.fund_setup_transaction_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
  step_id uuid not null references bx1_portal.fund_setup_steps(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,operating_context jsonb not null,request_key uuid not null,
  candidate_hash text not null check(candidate_hash ~ '^0x[0-9a-f]{64}$'),prior_candidate_hash text,
  intent_hash text not null check(intent_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),unique(actor_id,request_key)
);
create table bx1_portal.fund_setup_observations (
  id uuid primary key default pg_catalog.gen_random_uuid(), setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
  step_id uuid references bx1_portal.fund_setup_steps(id) on delete restrict,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'), result_hash text not null check(result_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict, operating_context jsonb not null,
  result jsonb not null, created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(request_hash,result_hash)
);
create table bx1_portal.fund_setup_events (
  id uuid primary key default pg_catalog.gen_random_uuid(), setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
  step_id uuid references bx1_portal.fund_setup_steps(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict, operating_context jsonb not null,
  action text not null,before_revision integer not null,after_revision integer not null,details_hash text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table bx1_portal.fund_setups enable row level security;
alter table bx1_portal.fund_setup_steps enable row level security;
alter table bx1_portal.fund_setup_requests enable row level security;
alter table bx1_portal.fund_setup_transaction_attempts enable row level security;
alter table bx1_portal.fund_setup_observations enable row level security;
alter table bx1_portal.fund_setup_events enable row level security;
revoke all on bx1_portal.fund_setups,bx1_portal.fund_setup_steps,
  bx1_portal.fund_setup_requests,bx1_portal.fund_setup_transaction_attempts,bx1_portal.fund_setup_observations,bx1_portal.fund_setup_events
  from public,anon,authenticated,service_role,bx1_fund_execution_worker;
create trigger fund_setup_requests_immutable before update or delete on bx1_portal.fund_setup_requests for each row execute function bx1_portal.immutable_record();
create trigger fund_setup_attempts_immutable before update or delete on bx1_portal.fund_setup_transaction_attempts for each row execute function bx1_portal.immutable_record();
create trigger fund_setup_observations_immutable before update or delete on bx1_portal.fund_setup_observations for each row execute function bx1_portal.immutable_record();
create trigger fund_setup_events_immutable before update or delete on bx1_portal.fund_setup_events for each row execute function bx1_portal.immutable_record();

create function bx1_portal.fund_setup_mutation_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'fund_setup_history_preserved' using errcode='23514';end if;
  if TG_TABLE_NAME='fund_setups' then
    if pg_catalog.to_jsonb(NEW)-array['actor_claims','revision','revoked_at','safe_address','safe_state','safe_owners','safe_threshold',
      'safe_observation_id','safe_configuration','safe_configuration_hash','configuration','setup_configuration_hash','catalog_hash','recovery_hold','recovery_reason','recovery_observation_id']
      is distinct from pg_catalog.to_jsonb(OLD)-array['actor_claims','revision','revoked_at','safe_address','safe_state','safe_owners','safe_threshold',
      'safe_observation_id','safe_configuration','safe_configuration_hash','configuration','setup_configuration_hash','catalog_hash','recovery_hold','recovery_reason','recovery_observation_id']
      or (OLD.safe_configuration is not null and (NEW.safe_configuration,NEW.safe_configuration_hash) is distinct from (OLD.safe_configuration,OLD.safe_configuration_hash))
      or (OLD.catalog_hash is not null and NEW.catalog_hash is distinct from OLD.catalog_hash)
      or (OLD.recovery_hold and not NEW.recovery_hold)
      or NEW.revision not in (OLD.revision,OLD.revision+1) then raise exception 'fund_setup_identity_immutable' using errcode='23514';end if;
  else
    if (NEW.id,NEW.setup_id,NEW.step_key,NEW.ordinal,NEW.kind) is distinct from (OLD.id,OLD.setup_id,OLD.step_key,OLD.ordinal,OLD.kind)
      or NEW.revision<>OLD.revision+1
      or (OLD.intent is not null and (NEW.intent,NEW.intent_hash,NEW.data_hash,NEW.actor_id,NEW.sender,NEW.nonce)
        is distinct from (OLD.intent,OLD.intent_hash,OLD.data_hash,OLD.actor_id,OLD.sender,OLD.nonce))
      or (NEW.expires_at is distinct from OLD.expires_at and OLD.intent is not null and not(OLD.state='PREPARED' and NEW.state='PREPARED'
        and OLD.claimed_at is null and NEW.claimed_at is null and OLD.transaction_hash is null and NEW.transaction_hash is null
        and NEW.expires_at>OLD.expires_at and NEW.expires_at<=pg_catalog.clock_timestamp()+interval '5 minutes'
        and NEW.expires_at<=(select expires_at from bx1_portal.fund_setups where id=OLD.setup_id)))
      or (OLD.claimed_at is not null and NEW.claimed_at is distinct from OLD.claimed_at)
      or (OLD.state='FINAL' and NEW.transaction_hash is distinct from OLD.transaction_hash)
      or (OLD.state='FINAL' and NEW.state<>'FINAL') then raise exception 'fund_setup_prepared_identity_immutable' using errcode='23514';end if;
  end if;
  return NEW;
end $$;
create trigger fund_setups_guard before update or delete on bx1_portal.fund_setups for each row execute function bx1_portal.fund_setup_mutation_guard();
create trigger fund_setup_steps_guard before update or delete on bx1_portal.fund_setup_steps for each row execute function bx1_portal.fund_setup_mutation_guard();

create function bx1_portal.fund_setup_graph() returns table(step_key text,ordinal integer,kind text)
language sql immutable set search_path='' as $$
  select key,ord::integer,case when key in ('trex_version','trex_factory_binding','ia_factory_binding','oid_factory_binding',
    'factory_handoff','trex_authority_handoff','oid_authority_handoff','oid_factory_handoff') then 'CALL' else 'CREATE' end
  from pg_catalog.unnest(array['token_implementation','ctr_implementation','irs_implementation','ir_implementation',
    'tir_implementation','mc_implementation','oid_implementation','oid_authority','oid_factory','trex_authority',
    'trex_version','trex_factory','ia_factory','trex_factory_binding','ia_factory_binding','oid_factory_binding','controller',
    'factory_handoff','trex_authority_handoff','oid_authority_handoff','oid_factory_handoff','holding_module','claim_issuer','token_identity','settlement']) with ordinality as g(key,ord);
$$;
create function bx1_portal.fund_setup_roleplay(c jsonb,pid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare answer jsonb;
begin
  -- Installed only when its explicit TEST role-play policy overlay is present.
  -- A missing helper never grants authority or invents a human identity.
  if pg_catalog.to_regprocedure('bx1_private.test_roleplay_projection(jsonb,uuid)') is not null then
    execute 'select bx1_private.test_roleplay_projection($1,$2)' into answer using c,pid;
    if answer is not null and answer->'allowed_actions' ? 'FUND_SETUP' then
      return pg_catalog.jsonb_build_object('policy_id',answer->'policy_id','epoch',answer->'authority_epoch',
        'expires_at',answer->'expires_at','label','TEST ROLE PLAY — one operator; not independent human approval');
    end if;
  end if;
  return null;
end $$;
create function bx1_portal.fund_setup_context(c jsonb,pid uuid,protected boolean default false) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.jwt()->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or (bx1_portal.admission_context(c) is not true and bx1_portal.fund_setup_roleplay(c,pid) is null) or c->>'mode'<>'ROLE'
    or c->>'role' not in ('OfferingManager','TokenisationAgent')
    or (bx1_portal.offering_workflow_product_visible(c,pid) is not true
      and bx1_portal.fund_product_visible(c,pid) is not true
      and bx1_portal.fund_setup_roleplay(c,pid) is null) then return false; end if;
  if not protected then return true; end if;
  return bx1_portal.fresh_session() and auth.jwt()->>'aal'='aal2'
    and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and s.aal::text='aal2'
        and f.status::text='verified' and f.factor_type::text='totp');
exception when others then return false;
end $$;
create function bx1_portal.fund_setup_lock(c jsonb,pid uuid,protected boolean default false) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.fund_setup_context(c,pid,protected) is not true then raise exception 'fund_setup_context_denied' using errcode='42501'; end if;
  if bx1_portal.fund_setup_roleplay(c,pid) is not null then
    execute 'select bx1_private.test_roleplay_lock($1,$2,$3,$4)' using c,pid,'FUND_SETUP',null::text;
  else perform bx1_portal.admission_lock_actor(null,c);end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_setup:'||pid::text,0));
  perform id from bx1_portal.products where id=pid for update;
  perform r.id from bx1_portal.offering_revisions r join bx1_portal.products p on p.current_offering_revision_id=r.id where p.id=pid for share of r;
  if bx1_portal.fund_setup_roleplay(c,pid) is null then perform bx1_portal.offering_workflow_lock_product(c,pid);end if;
  if bx1_portal.fund_setup_context(c,pid,protected) is not true then raise exception 'fund_setup_authority_changed_after_wait' using errcode='42501'; end if;
end $$;
create function bx1_portal.fund_setup_current(sid uuid,c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_setups s join bx1_portal.products p on p.id=s.product_id
    join bx1_portal.offering_revisions r on r.id=s.offering_revision_id and r.product_id=p.id
    where s.id=sid and s.actor_id=auth.uid() and s.operating_context=c and s.revoked_at is null and not s.recovery_hold
      and s.expires_at>pg_catalog.clock_timestamp() and p.revision=s.product_revision
      and p.current_offering_revision_id=s.offering_revision_id and p.terms_hash=s.terms_hash
      and r.terms_hash=s.terms_hash and r.deployment_configuration_hash=s.configuration_hash
      and r.terms->>'asset_type'='FUND' and r.terms->>'terms_version'='3'
      and r.terms->>'currency'='TST' and r.terms->>'settlement_decimals'='6'
      and s.roleplay_policy is not distinct from bx1_portal.fund_setup_roleplay(c,p.id)
      and bx1_portal.fund_setup_context(c,p.id,false));
$$;
create function bx1_portal.fund_setup_audit(sid uuid,tid uuid,action text,before_rev integer,after_rev integer,details jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;
begin
  select * into strict s from bx1_portal.fund_setups where id=sid;
  if auth.uid() is distinct from s.actor_id then raise exception 'fund_setup_audit_actor_denied' using errcode='42501'; end if;
  insert into bx1_portal.fund_setup_events(setup_id,step_id,actor_id,operating_context,action,before_revision,after_revision,details_hash)
    values(s.id,tid,s.actor_id,s.operating_context,action,before_rev,after_rev,bx1_portal.fund_digest(details));
  perform bx1_portal.fund_audit(s.product_id,coalesce(tid,s.id),null,action,s.operating_context,before_rev,after_rev,null,
    details||pg_catalog.jsonb_build_object('setup_id',s.id,'actual_operator',s.actor_id,'roleplay_policy',s.roleplay_policy,'admitted',false));
end $$;
create function bx1_portal.fund_setup_package_approved(pid uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.offering_workflow_approved(pid) and exists(select 1 from bx1_portal.products p
    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id
    join bx1_portal.offering_decisions i on i.offering_revision_id=r.id and i.decision_kind='ISSUER' and i.decision='APPROVED'
    join bx1_portal.offering_decisions compliance on compliance.offering_revision_id=r.id and compliance.decision_kind='COMPLIANCE' and compliance.decision='APPROVED'
    where p.id=pid and p.terms_hash=r.terms_hash and r.deployment_configuration_hash is not null
      and bx1_private.offering_signature_decisions_current(r.id,i.id,compliance.id));
$$;
create function bx1_portal.fund_setup_projection(pid uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products;r bx1_portal.offering_revisions;s bx1_portal.fund_setups;
  next_step bx1_portal.fund_setup_steps;steps jsonb;deps jsonb;state text;record jsonb;
begin
  if bx1_portal.fund_setup_context(c,pid,false) is not true then raise exception 'fund_setup_read_denied' using errcode='42501'; end if;
  select * into strict p from bx1_portal.products where id=pid;
  select * into r from bx1_portal.offering_revisions where id=p.current_offering_revision_id;
  select * into s from bx1_portal.fund_setups where product_id=p.id and offering_revision_id=r.id;
  if s.id is not null then
    select * into next_step from bx1_portal.fund_setup_steps where setup_id=s.id and state<>'FINAL' order by ordinal limit 1;
    if s.safe_state<>'VERIFIED' and next_step.step_key is distinct from 'safe_creation' then next_step:=null;end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',t.id,'step_key',t.step_key,'ordinal',t.ordinal,'kind',t.kind,
      'revision',t.revision,'state',t.state,'actor_id',t.actor_id,'sender',t.sender,'nonce',t.nonce::text,
      'intent_hash',t.intent_hash,'intent',t.intent,'expires_at',t.expires_at,'claimed_at',t.claimed_at,
      'transaction_hash',t.transaction_hash,'deployed_address',t.deployed_address,'observation_id',t.observation_id,'reason_code',t.reason_code)
      order by t.ordinal),'[]') into steps from bx1_portal.fund_setup_steps t where t.setup_id=s.id and t.ordinal>0;
    select coalesce(pg_catalog.jsonb_object_agg(t.step_key,t.deployed_address),'{}') into deps
      from bx1_portal.fund_setup_steps t where t.setup_id=s.id and t.kind='CREATE' and t.state='FINAL';
    state:=case when s.revoked_at is not null then 'REVOKED' when s.expires_at<=pg_catalog.clock_timestamp() then 'EXPIRED' when s.recovery_hold then 'RECOVERY_REQUIRED'
      when bx1_portal.fund_setup_current(s.id,s.operating_context) is not true then 'STALE' when s.safe_state<>'VERIFIED' then 'AWAITING_SAFE'
      when next_step.id is null then 'COMPLETE_NOT_ADMITTED' when exists(select 1 from bx1_portal.fund_setup_steps where setup_id=s.id and state<>'NOT_STARTED') then 'IN_PROGRESS' else 'READY' end;
    record:=pg_catalog.jsonb_build_object('id',s.id,'revision',s.revision,'actor_id',s.actor_id,'operating_context',s.operating_context,
      'state',state,'recovery_hold',s.recovery_hold,'recovery_reason',s.recovery_reason,'recovery_observation_id',s.recovery_observation_id,
      'expires_at',s.expires_at,'safe_address',s.safe_address,'safe_state',s.safe_state,'safe_owners',s.safe_owners,
      'safe_threshold',s.safe_threshold,'configuration',s.configuration,'setup_configuration_hash',s.setup_configuration_hash,
      'safe_configuration',s.safe_configuration,'safe_creation',(select pg_catalog.jsonb_build_object('id',t.id,'step_key',t.step_key,'ordinal',t.ordinal,'kind',t.kind,
        'revision',t.revision,'state',t.state,'actor_id',t.actor_id,'sender',t.sender,'nonce',t.nonce::text,'intent_hash',t.intent_hash,'intent',t.intent,
        'expires_at',t.expires_at,'claimed_at',t.claimed_at,'transaction_hash',t.transaction_hash,'deployed_address',t.deployed_address,
        'observation_id',t.observation_id,'reason_code',t.reason_code) from bx1_portal.fund_setup_steps t where t.setup_id=s.id and t.ordinal=0),
      'dependencies',deps,'steps',steps,'next_step',next_step.step_key,'saved_intent',next_step.intent,
      'admission_reason','RELEASE_CONFORMANCE_AND_GOVERNANCE_RECEIPTS_REQUIRED');
  end if;
  return pg_catalog.jsonb_build_object('schema_version',1,'actor_id',auth.uid(),'environment','TESTNET','operating_context',c,
    'observed_at',pg_catalog.clock_timestamp(),'product_id',p.id,'product_revision',p.revision,'offering_revision_id',r.id,
    'terms_hash',p.terms_hash,'configuration_hash',r.deployment_configuration_hash,'source_pin','b6c5fabf86e733ede017fef754d59eeb8f80e3f4',
    'roleplay_policy',bx1_portal.fund_setup_roleplay(c,p.id),'availability',case when s.id is null and bx1_portal.fund_setup_package_approved(p.id) is not true then 'UNAVAILABLE' else 'AVAILABLE' end,
    'reason_code',case when s.id is null and bx1_portal.fund_setup_package_approved(p.id) is not true then 'CURRENT_APPROVED_SIGNED_PACKAGE_REQUIRED' else null end,'setup',record);
end $$;

create function bx1_portal.fund_setup_command(command text,key uuid,body jsonb,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;p bx1_portal.products;r bx1_portal.offering_revisions;
  prior bx1_portal.fund_setup_requests;pid uuid;cfg jsonb;before_rev integer;
begin
  if command is null or command not in ('CREATE','IMPORT_SAFE','CONFIGURE','CONFIGURE_SAFE','CLAIM_STEP','RECORD_HASH') or key is null
    or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then raise exception 'fund_setup_invalid_command' using errcode='22023'; end if;
  if command='CREATE' then perform bx1_portal.require_keys(body,array['product_id','expected_revision']);pid:=(body->>'product_id')::uuid;
  else select * into s from bx1_portal.fund_setups where id=(body->>'setup_id')::uuid and actor_id=auth.uid() and operating_context=c;pid:=s.product_id;end if;
  if pid is null then raise exception 'fund_setup_record_denied' using errcode='42501';end if;
  perform bx1_portal.fund_setup_lock(c,pid,command in ('CREATE','CLAIM_STEP'));
  select * into prior from bx1_portal.fund_setup_requests where actor_id=auth.uid() and request_key=key;
  if prior.actor_id is not null then
    if prior.command<>command or prior.payload<>body or prior.operating_context<>c then raise exception 'fund_setup_idempotency_conflict' using errcode='23505';end if;
    return bx1_portal.fund_setup_projection(pid,c);
  end if;
  if command='CREATE' then
    select * into strict p from bx1_portal.products where id=pid;
    select * into r from bx1_portal.offering_revisions where id=p.current_offering_revision_id and product_id=p.id;
    perform bx1_portal.funding_require_revision(p.revision,body->'expected_revision');
    if r.id is null or r.deployment_configuration_hash is null or r.terms_hash<>p.terms_hash
      or r.terms->>'asset_type'<>'FUND' or r.terms->>'terms_version'<>'3' or r.terms->>'currency'<>'TST'
      or r.terms->>'settlement_decimals'<>'6' then raise exception 'fund_setup_current_fund_package_required' using errcode='23514';end if;
    if bx1_portal.fund_setup_package_approved(p.id) is not true then
      raise exception 'fund_setup_current_approved_signed_package_required' using errcode='42501';end if;
    insert into bx1_portal.fund_setups(product_id,offering_revision_id,product_revision,terms_hash,configuration_hash,
      actor_id,operating_context,actor_claims,roleplay_policy,expires_at)
      values(p.id,r.id,p.revision,p.terms_hash,r.deployment_configuration_hash,auth.uid(),c,auth.jwt(),
        bx1_portal.fund_setup_roleplay(c,p.id),least(pg_catalog.clock_timestamp()+interval '7 days',
          coalesce((bx1_portal.fund_setup_roleplay(c,p.id)->>'expires_at')::timestamptz,pg_catalog.clock_timestamp()+interval '7 days'))) returning * into s;
    insert into bx1_portal.fund_setup_steps(setup_id,step_key,ordinal,kind)
      select s.id,g.step_key,g.ordinal,g.kind from bx1_portal.fund_setup_graph() g;
    before_rev:=0;
  else
    select * into strict s from bx1_portal.fund_setups where id=s.id for update;
    perform bx1_portal.funding_require_revision(s.revision,body->'expected_revision');
    if bx1_portal.fund_setup_current(s.id,c) is not true then raise exception 'fund_setup_expired_revoked_or_changed' using errcode='42501';end if;
    before_rev:=s.revision;
    if command='IMPORT_SAFE' then
      perform bx1_portal.require_keys(body,array['setup_id','expected_revision','safe_address']);
      if pg_catalog.jsonb_typeof(body->'safe_address') is distinct from 'string' or body->>'safe_address' !~* '^0x[0-9a-f]{40}$'
        or body->>'safe_address' ~* '^0x0{40}$' or exists(select 1 from bx1_portal.fund_setup_steps where setup_id=s.id and state<>'NOT_STARTED')
        then raise exception 'fund_setup_safe_import_invalid_or_started' using errcode='23514';end if;
      update bx1_portal.fund_setups set safe_address=pg_catalog.lower(body->>'safe_address'),safe_state='REQUESTED',safe_owners='[]',
        safe_threshold=null,safe_observation_id=null,configuration=null,setup_configuration_hash=null,revision=revision+1 where id=s.id returning * into s;
    elsif command='CONFIGURE_SAFE' then
      perform bx1_portal.require_keys(body,array['setup_id','expected_revision','owners','threshold']);
      if s.safe_state<>'NOT_IMPORTED' or s.safe_configuration is not null
        or pg_catalog.jsonb_typeof(body->'owners') is distinct from 'array' or pg_catalog.jsonb_array_length(body->'owners') not between 2 and 20
        or pg_catalog.jsonb_typeof(body->'threshold') is distinct from 'number' or body->>'threshold' !~ '^[1-9][0-9]?$'
        or (body->>'threshold')::integer<2 or (body->>'threshold')::integer>pg_catalog.jsonb_array_length(body->'owners')
        or exists(select 1 from pg_catalog.jsonb_array_elements(body->'owners') x where pg_catalog.jsonb_typeof(x) is distinct from 'string'
          or x#>>'{}' !~* '^0x[0-9a-f]{40}$' or x#>>'{}' ~* '^0x0{40}$')
        or (select count(distinct pg_catalog.lower(x#>>'{}')) from pg_catalog.jsonb_array_elements(body->'owners') x)<>pg_catalog.jsonb_array_length(body->'owners')
        or exists(select 1 from bx1_portal.fund_setup_steps where setup_id=s.id and state<>'NOT_STARTED') then
        raise exception 'fund_setup_safe_settings_invalid_or_already_bound' using errcode='23514';end if;
      cfg:=pg_catalog.jsonb_build_object('owners',(select pg_catalog.jsonb_agg(pg_catalog.lower(x#>>'{}') order by pg_catalog.lower(x#>>'{}')) from pg_catalog.jsonb_array_elements(body->'owners') x),
        'threshold',body->'threshold','salt_nonce',((('x'||pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,15))::bit(60))::bigint)::text);
      update bx1_portal.fund_setups set safe_configuration=cfg,safe_configuration_hash=bx1_portal.fund_digest(cfg),revision=revision+1 where id=s.id returning * into s;
      insert into bx1_portal.fund_setup_steps(setup_id,step_key,ordinal,kind) values(s.id,'safe_creation',0,'CALL');
    elsif command='CONFIGURE' then
      perform bx1_portal.require_keys(body,array['setup_id','expected_revision','configuration']);cfg:=body->'configuration';
      perform bx1_portal.require_keys(cfg,array['safe_address','identity_management_key','claim_management_key','token_management_key',
        'maximum_holding_base_units','tst_initial_holder','tst_initial_supply_base_units']);
      if exists(select 1 from pg_catalog.jsonb_each(cfg) x where pg_catalog.jsonb_typeof(x.value) is distinct from 'string')
        or exists(select 1 from pg_catalog.jsonb_each_text(cfg) x where
          (x.key in ('maximum_holding_base_units','tst_initial_supply_base_units') and x.value !~ '^[1-9][0-9]{0,77}$')
          or (x.key not in ('maximum_holding_base_units','tst_initial_supply_base_units') and (x.value !~* '^0x[0-9a-f]{40}$' or x.value ~* '^0x0{40}$')))
        or pg_catalog.lower(cfg->>'safe_address') is distinct from s.safe_address
        or exists(select 1 from bx1_portal.fund_setup_steps where setup_id=s.id and ordinal>0 and state<>'NOT_STARTED') then
        raise exception 'fund_setup_configuration_invalid_or_started' using errcode='23514';end if;
      update bx1_portal.fund_setups set configuration=cfg,setup_configuration_hash=bx1_portal.fund_digest(cfg),revision=revision+1 where id=s.id returning * into s;
    else
      perform bx1_portal.require_keys(body,case when command='CLAIM_STEP' then array['setup_id','expected_revision','step_id','expected_step_revision','intent_hash']
        else array['setup_id','expected_revision','step_id','expected_step_revision','transaction_hash'] end);
      select * into t from bx1_portal.fund_setup_steps where id=(body->>'step_id')::uuid and setup_id=s.id for update;
      if t.id is null then raise exception 'fund_setup_step_denied' using errcode='42501';end if;
      perform bx1_portal.funding_require_revision(t.revision,body->'expected_step_revision');
      if command='CLAIM_STEP' then
        if t.state<>'PREPARED' or t.expires_at<=pg_catalog.clock_timestamp() or t.intent_hash is distinct from body->>'intent_hash'
          or t.actor_id<>auth.uid() or (t.step_key<>'safe_creation' and (s.safe_state<>'VERIFIED' or s.safe_observation_id is null))
          or bx1_portal.fund_setup_wallet_current(auth.uid(),t.sender) is not true
          or exists(select 1 from bx1_portal.fund_setup_steps earlier where earlier.setup_id=s.id and earlier.ordinal<t.ordinal and earlier.state<>'FINAL')
          then raise exception 'fund_setup_claim_not_current' using errcode='42501';end if;
        -- Commit UNKNOWN before MetaMask is asked. Unknown outcome never enables resending.
        update bx1_portal.fund_setup_steps set state='UNKNOWN',claimed_at=pg_catalog.clock_timestamp(),revision=revision+1 where id=t.id;
      else
        if t.state not in ('UNKNOWN','BROADCAST','PENDING') or t.actor_id<>auth.uid() or pg_catalog.jsonb_typeof(body->'transaction_hash') is distinct from 'string'
          or body->>'transaction_hash' !~* '^0x[0-9a-f]{64}$' then raise exception 'fund_setup_hash_not_claimed' using errcode='23514';end if;
        insert into bx1_portal.fund_setup_transaction_attempts(setup_id,step_id,actor_id,operating_context,request_key,candidate_hash,prior_candidate_hash,intent_hash)
          values(s.id,t.id,auth.uid(),c,key,pg_catalog.lower(body->>'transaction_hash'),t.transaction_hash,t.intent_hash);
        update bx1_portal.fund_setup_steps set state='BROADCAST',transaction_hash=pg_catalog.lower(body->>'transaction_hash'),revision=revision+1 where id=t.id;
      end if;
      update bx1_portal.fund_setups set revision=revision+1 where id=s.id returning * into s;
    end if;
  end if;
  if bx1_portal.fund_setup_context(c,pid,command in ('CREATE','CLAIM_STEP')) is not true then raise exception 'fund_setup_authority_changed' using errcode='42501';end if;
  perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_'||command,before_rev,s.revision,body);
  insert into bx1_portal.fund_setup_requests(actor_id,request_key,setup_id,command,payload,operating_context) values(auth.uid(),key,s.id,command,body,c);
  return bx1_portal.fund_setup_projection(pid,c);
end $$;

create function public.bx1_portal_fund_setup_read(product_id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_setup_projection(product_id,operating_context); $$;
create function public.bx1_portal_fund_setup_command(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_setup_command(command,request_key,payload,operating_context); $$;

-- The restricted worker receives only a saved, user/session-bound request.
-- It cannot select tables, choose a client bytecode payload or invent AAL2.
create function bx1_portal.fund_setup_worker_enter(sid uuid,actor uuid,c jsonb,protected boolean) returns text
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;prior_claims text;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_setup_worker_denied' using errcode='42501';end if;
  select * into s from bx1_portal.fund_setups where id=sid and actor_id=actor and operating_context=c;
  if s.id is null or s.actor_claims->>'sub' is distinct from actor::text
    or s.actor_claims->>'session_id' is null or pg_catalog.jsonb_typeof(s.actor_claims->'exp') is distinct from 'number'
    or s.actor_claims->>'exp' !~ '^[0-9]{1,12}$'
    or (s.actor_claims->>'exp')::numeric<=pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()) then
    raise exception 'fund_setup_original_session_expired' using errcode='42501';end if;
  prior_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  perform pg_catalog.set_config('request.jwt.claims',s.actor_claims::text,true);
  perform bx1_portal.fund_setup_lock(c,s.product_id,protected);
  if bx1_portal.fund_setup_current(s.id,c) is not true then raise exception 'fund_setup_worker_authority_changed' using errcode='42501';end if;
  return coalesce(prior_claims,'');
end $$;
create function bx1_portal.fund_setup_wallet_current(actor uuid,sender text) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.bx1_wallets w join bx1_private.wallet_challenges q on q.id=w.last_proof_id
    where w.user_id=actor and w.address=pg_catalog.lower(sender) and w.chain_id=80002
      and q.user_id=actor and q.used_at is not null and q.proof_signature is not null);
$$;
create function bx1_portal.fund_setup_preparation(sid uuid,key text,expected integer,sender_address text,actor uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;deps jsonb;
begin
  select * into strict s from bx1_portal.fund_setups where id=sid;
  select * into t from bx1_portal.fund_setup_steps where setup_id=s.id and step_key=key;
  if s.revision<>expected or s.actor_id<>actor or s.operating_context<>c or t.id is null
    or (key='safe_creation' and s.safe_configuration is null)
    or (key<>'safe_creation' and (s.safe_state<>'VERIFIED' or s.safe_observation_id is null or s.configuration is null or s.setup_configuration_hash is null))
    or t.state not in ('NOT_STARTED','PREPARED') or sender_address !~* '^0x[0-9a-f]{40}$'
    or bx1_portal.fund_setup_wallet_current(actor,sender_address) is not true
    or exists(select 1 from bx1_portal.fund_setup_steps e where e.setup_id=s.id and e.ordinal<t.ordinal and e.state<>'FINAL') then
    raise exception 'fund_setup_preparation_not_ready' using errcode='42501';end if;
  if t.state='PREPARED' and t.sender<>pg_catalog.lower(sender_address) then
    raise exception 'fund_setup_prepared_intent_must_not_be_replaced' using errcode='23514';end if;
  select coalesce(pg_catalog.jsonb_object_agg(e.step_key,e.deployed_address),'{}') into deps
    from bx1_portal.fund_setup_steps e where e.setup_id=s.id and e.kind='CREATE' and e.state='FINAL';
  return pg_catalog.jsonb_build_object('setup_id',s.id,'expected_revision',s.revision,'actor_id',s.actor_id,'operating_context',s.operating_context,
    'environment','TESTNET','product_id',s.product_id,'offering_revision_id',s.offering_revision_id,'terms_hash',s.terms_hash,
    'configuration_hash',s.configuration_hash,'setup_configuration_hash',case when key='safe_creation' then s.safe_configuration_hash else s.setup_configuration_hash end,'source_pin',s.source_pin,'expires_at',s.expires_at,
    'step_id',t.id,'step_key',t.step_key,'expected_step_revision',t.revision,'sender',pg_catalog.lower(sender_address),
    'configuration',s.configuration,'safe_configuration',s.safe_configuration,'dependencies',deps,'roleplay_policy',s.roleplay_policy);
end $$;
create function bx1_portal.read_fund_setup_preparation(setup_id uuid,step_key text,expected_revision integer,sender text,actor_id uuid,operating_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior_claims text;answer jsonb;
begin
  prior_claims:=bx1_portal.fund_setup_worker_enter(setup_id,actor_id,operating_context,true);
  answer:=bx1_portal.fund_setup_preparation(setup_id,step_key,expected_revision,sender,actor_id,operating_context);
  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
end $$;
create function bx1_portal.prepare_fund_setup_step(preparation jsonb,intent jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior_claims text;expected jsonb;s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;answer jsonb;before_rev integer;
begin
  prior_claims:=bx1_portal.fund_setup_worker_enter((preparation->>'setup_id')::uuid,(preparation->>'actor_id')::uuid,preparation->'operating_context',true);
  expected:=bx1_portal.fund_setup_preparation((preparation->>'setup_id')::uuid,preparation->>'step_key',
    (preparation->>'expected_revision')::integer,preparation->>'sender',(preparation->>'actor_id')::uuid,preparation->'operating_context');
  if expected is distinct from preparation then raise exception 'fund_setup_preparation_changed' using errcode='23514';end if;
  select * into strict s from bx1_portal.fund_setups where id=(preparation->>'setup_id')::uuid for update;
  select * into strict t from bx1_portal.fund_setup_steps where id=(preparation->>'step_id')::uuid and setup_id=s.id for update;
  perform bx1_portal.require_keys(intent,array['version','chain_id','step_key','kind','sender','nonce','value','to','data','expected_address',
    'artifact_name','expected_runtime_hash','checks','configuration_hash','catalog_hash']);
  if intent->'version' is distinct from '1'::jsonb or intent->'chain_id' is distinct from '80002'::jsonb
    or intent->>'step_key' is distinct from t.step_key or intent->>'kind' is distinct from t.kind
    or intent->>'sender' is distinct from preparation->>'sender' or intent->>'value' is distinct from '0'
    or pg_catalog.jsonb_typeof(intent->'nonce') is distinct from 'string' or intent->>'nonce' !~ '^(0|[1-9][0-9]{0,77})$'
    or pg_catalog.jsonb_typeof(intent->'data') is distinct from 'string' or intent->>'data' !~ '^0x([0-9a-f]{2})+$'
    or char_length(intent->>'data')>262146 or pg_catalog.jsonb_typeof(intent->'expected_address') is distinct from 'string'
    or intent->>'expected_address' !~ '^0x[0-9a-f]{40}$' or intent->>'expected_address'='0x0000000000000000000000000000000000000000'
    or pg_catalog.jsonb_typeof(intent->'expected_runtime_hash') is distinct from 'string'
    or intent->>'expected_runtime_hash' !~ '^0x[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(intent->'catalog_hash') is distinct from 'string' or intent->>'catalog_hash' !~ '^[0-9a-f]{64}$'
    or intent->>'configuration_hash' is distinct from preparation->>'setup_configuration_hash'
    or pg_catalog.jsonb_typeof(intent->'checks') is distinct from 'array' or pg_catalog.jsonb_array_length(intent->'checks')>64
    or (t.kind='CREATE' and intent->'to'<>'null'::jsonb) or (t.kind='CALL' and (intent->>'to' !~ '^0x[0-9a-f]{40}$'
      or (t.step_key<>'safe_creation' and intent->>'to'<>intent->>'expected_address')
      or (t.step_key='safe_creation' and (intent->>'to' is distinct from '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67' or intent->>'artifact_name' is distinct from 'SafeProxy'))))
    or (s.catalog_hash is not null and s.catalog_hash<>intent->>'catalog_hash') then raise exception 'fund_setup_server_intent_invalid' using errcode='23514';end if;
  if t.state='PREPARED' then
    if t.intent is distinct from intent then raise exception 'fund_setup_intent_immutable' using errcode='23514';end if;
    if t.expires_at<=pg_catalog.clock_timestamp() then
      if t.claimed_at is not null or t.transaction_hash is not null then raise exception 'fund_setup_claimed_intent_cannot_renew' using errcode='23514';end if;
      before_rev:=s.revision;
      update bx1_portal.fund_setup_steps set expires_at=least(s.expires_at,pg_catalog.clock_timestamp()+interval '5 minutes'),revision=revision+1 where id=t.id;
      update bx1_portal.fund_setups set revision=revision+1 where id=s.id returning * into s;
      perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_REFRESH_STEP',before_rev,s.revision,pg_catalog.jsonb_build_object('intent_hash',t.intent_hash,'same_nonce',t.nonce::text));
    end if;
  else
    before_rev:=s.revision;
    update bx1_portal.fund_setup_steps set state='PREPARED',actor_id=s.actor_id,sender=preparation->>'sender',nonce=(intent->>'nonce')::numeric,
      intent=prepare_fund_setup_step.intent,intent_hash=bx1_portal.fund_digest(prepare_fund_setup_step.intent),
      data_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(pg_catalog.substr(prepare_fund_setup_step.intent->>'data',3),'hex')),'hex'),
      expires_at=least(s.expires_at,pg_catalog.clock_timestamp()+interval '5 minutes'),revision=revision+1 where id=t.id;
    update bx1_portal.fund_setups set catalog_hash=intent->>'catalog_hash',
      safe_address=case when t.step_key='safe_creation' then intent->>'expected_address' else safe_address end,
      safe_state=case when t.step_key='safe_creation' then 'REQUESTED' else safe_state end,
      revision=revision+1 where id=s.id returning * into s;
    perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_PREPARE_STEP',before_rev,s.revision,pg_catalog.jsonb_build_object('intent_hash',bx1_portal.fund_digest(intent)));
  end if;
  answer:=bx1_portal.fund_setup_projection(s.product_id,s.operating_context);
  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
end $$;
create function bx1_portal.fund_setup_observation_request(sid uuid,tid uuid,expected integer,actor uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;answer jsonb;
begin
  select * into strict s from bx1_portal.fund_setups where id=sid;
  if s.revision<>expected or s.actor_id<>actor or s.operating_context<>c then raise exception 'fund_setup_observation_scope_changed' using errcode='23514';end if;
  answer:=pg_catalog.jsonb_build_object('kind',case when tid is null then 'SAFE' else 'STEP' end,'setup_id',s.id,
    'expected_revision',s.revision,'actor_id',s.actor_id,'operating_context',s.operating_context,'product_id',s.product_id,
    'offering_revision_id',s.offering_revision_id,'terms_hash',s.terms_hash,'environment','TESTNET','expires_at',s.expires_at,
    'safe_address',s.safe_address,'configuration_hash',s.configuration_hash,'setup_configuration_hash',s.setup_configuration_hash);
  if tid is null then
    if s.safe_address is null or s.safe_state not in ('REQUESTED','OBSERVED_NOT_ADMITTED','VERIFIED') then raise exception 'fund_setup_safe_not_requested' using errcode='23514';end if;
    return answer||pg_catalog.jsonb_build_object('step_id',null,'expected_step_revision',null,'intent',null,'intent_hash',null,'transaction_hash',null);
  end if;
  select * into t from bx1_portal.fund_setup_steps where id=tid and setup_id=s.id;
  if t.id is null or t.state not in ('UNKNOWN','BROADCAST','PENDING','FINAL','REVERTED','REPLACED','REORGED') or t.intent is null then
    raise exception 'fund_setup_step_not_claimed' using errcode='23514';end if;
  return answer||pg_catalog.jsonb_build_object('step_id',t.id,'expected_step_revision',t.revision,
    'intent',t.intent,'intent_hash',t.intent_hash,'transaction_hash',t.transaction_hash);
end $$;
create function bx1_portal.read_fund_setup_observation(setup_id uuid,step_id uuid,expected_revision integer,actor_id uuid,operating_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior_claims text;answer jsonb;
begin
  prior_claims:=bx1_portal.fund_setup_worker_enter(setup_id,actor_id,operating_context,false);
  answer:=bx1_portal.fund_setup_observation_request(setup_id,step_id,expected_revision,actor_id,operating_context);
  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
end $$;

create function bx1_portal.fund_setup_observers_valid(result jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb;urls text[]:='{}';
begin
  if pg_catalog.jsonb_typeof(result->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'providers')<>2 then return false;end if;
  for entry in select value from pg_catalog.jsonb_array_elements(result->'providers') loop
    if pg_catalog.jsonb_typeof(entry) is distinct from 'object' or entry-array['url','finalized_block_number','finalized_block_hash']<>'{}'
      or not(entry ?& array['url','finalized_block_number','finalized_block_hash'])
      or entry->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com')
      or pg_catalog.jsonb_typeof(entry->'finalized_block_number') is distinct from 'string'
      or entry->>'finalized_block_number' !~ '^[1-9][0-9]{0,77}$'
      or entry->>'finalized_block_hash' !~ '^0x[0-9a-f]{64}$' then return false;end if;
    urls:=pg_catalog.array_append(urls,entry->>'url');
    if result->>'block_number' is not null and (result->>'block_number' !~ '^[1-9][0-9]{0,77}$'
      or (entry->>'finalized_block_number')::numeric<(result->>'block_number')::numeric) then return false;end if;
  end loop;
  return urls[1]<>urls[2];
exception when others then return false;
end $$;
create function bx1_portal.record_fund_setup_observation(observation_request jsonb,result jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior_claims text;expected jsonb;s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;
  observation uuid;before_rev integer;next_state text;answer jsonb;owner_count integer;unique_owners integer;
begin
  prior_claims:=bx1_portal.fund_setup_worker_enter((observation_request->>'setup_id')::uuid,(observation_request->>'actor_id')::uuid,
    observation_request->'operating_context',false);
  expected:=bx1_portal.fund_setup_observation_request((observation_request->>'setup_id')::uuid,(observation_request->>'step_id')::uuid,
    (observation_request->>'expected_revision')::integer,(observation_request->>'actor_id')::uuid,observation_request->'operating_context');
  if expected is distinct from observation_request or pg_catalog.jsonb_typeof(result) is distinct from 'object'
    or pg_catalog.octet_length(result::text)>65536 or result->'version' is distinct from '1'::jsonb
    or result->'chain_id' is distinct from '80002'::jsonb
    or (result->>'status' is distinct from 'RECOVERY_REQUIRED' and bx1_portal.fund_setup_observers_valid(result) is not true) then
    raise exception 'fund_setup_observation_invalid' using errcode='23514';end if;
  select * into strict s from bx1_portal.fund_setups where id=(expected->>'setup_id')::uuid for update;
  before_rev:=s.revision;
  if result->>'status'='RECOVERY_REQUIRED' then
    perform bx1_portal.require_keys(result,array['version','chain_id','status','step_key','intent_hash','transaction_hash','reason_code']);
    select * into t from bx1_portal.fund_setup_steps where id=(expected->>'step_id')::uuid and setup_id=s.id for update;
    if expected->>'kind' is distinct from 'STEP' or t.id is null or t.state<>'FINAL'
      or result->>'step_key' is distinct from t.step_key or result->>'intent_hash' is distinct from t.intent_hash
      or result->>'transaction_hash' is distinct from t.transaction_hash or result->>'reason_code' is null
      or result->>'reason_code' not in ('SETUP_REORG_AFTER_WAIT','SETUP_CANONICAL_BLOCK_CHANGED','SETUP_RUNTIME_MISMATCH','SETUP_EFFECT_MISMATCH',
        'SETUP_CREATED_ADDRESS_MISMATCH','SETUP_RECEIPT_MISMATCH','SETUP_OBSERVERS_DISAGREE','SETUP_TRANSACTION_MISMATCH',
        'SETUP_SAFE_CREATION_EVENT_AMBIGUOUS','SETUP_SAFE_CREATION_EVENT_MISMATCH','SETUP_SAFE_CREATION_EVENT_MISSING') then
      raise exception 'fund_setup_recovery_observation_denied' using errcode='23514';end if;
    insert into bx1_portal.fund_setup_observations(setup_id,step_id,request_hash,result_hash,actor_id,operating_context,result)
      values(s.id,t.id,bx1_portal.fund_digest(expected),bx1_portal.fund_digest(result),s.actor_id,s.operating_context,result) returning id into observation;
    update bx1_portal.fund_setups set recovery_hold=true,recovery_reason=result->>'reason_code',recovery_observation_id=observation,
      revision=revision+1 where id=s.id returning * into s;
    perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_RECOVERY_REQUIRED',before_rev,s.revision,
      pg_catalog.jsonb_build_object('observation_id',observation,'reason_code',result->>'reason_code','original_final_preserved',true));
    answer:=bx1_portal.fund_setup_projection(s.product_id,s.operating_context);
    perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
  end if;
  if expected->>'kind'='SAFE' then
    perform bx1_portal.require_keys(result,array['version','chain_id','status','release_version','release_source_commit','address','runtime_hash','singleton',
      'owners','threshold','nonce','modules','guard','fallback_handler','block_number','block_hash','catalog_hash','providers']);
    perform bx1_portal.require_keys(result->'singleton',array['address','runtime_hash']);
    if result->>'status' is distinct from 'VERIFIED_CODE_AND_STATE' or result->>'release_version' is distinct from '1.4.1'
      or result->>'release_source_commit' is distinct from '382117f5d97745f611e05f827603aadb493dc620'
      or result->>'address' is distinct from s.safe_address or result->>'runtime_hash' is distinct from '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'
      or not((result#>>'{singleton,address}'='0x41675c099f32341bf84bfc5382af534df5c7461a' and result#>>'{singleton,runtime_hash}'='0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4')
        or (result#>>'{singleton,address}'='0x29fcb43b46531bca003ddc8fcb67ffe91900c762' and result#>>'{singleton,runtime_hash}'='0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff'))
      or pg_catalog.jsonb_typeof(result->'owners') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'owners') not between 2 and 20
      or pg_catalog.jsonb_typeof(result->'threshold') is distinct from 'number' or result->>'threshold' !~ '^[1-9][0-9]?$'
      or result->'modules' is distinct from '[]'::jsonb or result->>'guard' is distinct from '0x0000000000000000000000000000000000000000'
      or result->>'fallback_handler' is distinct from '0x0000000000000000000000000000000000000000'
      or result->>'nonce' !~ '^(0|[1-9][0-9]{0,77})$' or result->>'block_hash' !~ '^0x[0-9a-f]{64}$'
      or result->>'block_number' !~ '^[1-9][0-9]{0,77}$' or result->>'catalog_hash' !~ '^[0-9a-f]{64}$'
      or (s.safe_configuration is not null and (result->'owners' is distinct from s.safe_configuration->'owners'
        or result->'threshold' is distinct from s.safe_configuration->'threshold'))
      or exists(select 1 from pg_catalog.jsonb_array_elements(result->'owners') owner where pg_catalog.jsonb_typeof(owner) is distinct from 'string'
        or owner#>>'{}' !~ '^0x[0-9a-f]{40}$' or owner#>>'{}'='0x0000000000000000000000000000000000000000') then
      raise exception 'fund_setup_safe_release_or_state_mismatch' using errcode='23514';end if;
    select count(*),count(distinct owner#>>'{}') into owner_count,unique_owners from pg_catalog.jsonb_array_elements(result->'owners') owner;
    if unique_owners<>owner_count or (result->>'threshold')::integer<2 or (result->>'threshold')::integer>owner_count then
      raise exception 'fund_setup_safe_threshold_invalid' using errcode='23514';end if;
  else
    perform bx1_portal.require_keys(result,array['version','chain_id','step_key','intent_hash','transaction_hash','status','reason_code',
      'block_number','block_hash','block_timestamp','contract_address','runtime_hash','checks','providers']);
    select * into strict t from bx1_portal.fund_setup_steps where id=(expected->>'step_id')::uuid and setup_id=s.id for update;
    if result->>'step_key' is distinct from t.step_key or result->>'intent_hash' is distinct from t.intent_hash
      or result->>'transaction_hash' is distinct from t.transaction_hash or result->>'status' is null
      or result->>'status' not in ('UNKNOWN','PENDING','FAILED','FINAL') then raise exception 'fund_setup_transaction_binding_mismatch' using errcode='23514';end if;
    next_state:=case result->>'status' when 'FAILED' then 'REVERTED' when 'FINAL' then 'FINAL' when 'PENDING' then 'PENDING' else 'UNKNOWN' end;
    if t.state='FINAL' and next_state<>'FINAL' then
      insert into bx1_portal.fund_setup_observations(setup_id,step_id,request_hash,result_hash,actor_id,operating_context,result)
        values(s.id,t.id,bx1_portal.fund_digest(expected),bx1_portal.fund_digest(result),s.actor_id,s.operating_context,result) returning id into observation;
      update bx1_portal.fund_setups set recovery_hold=true,recovery_reason='SETUP_FINALIZED_RECEIPT_CHANGED',recovery_observation_id=observation,
        revision=revision+1 where id=s.id returning * into s;
      perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_RECOVERY_REQUIRED',before_rev,s.revision,
        pg_catalog.jsonb_build_object('observation_id',observation,'original_final_preserved',true,'observed_status',result->>'status'));
      answer:=bx1_portal.fund_setup_projection(s.product_id,s.operating_context);
      perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
    end if;
    if result->>'status' in ('FAILED','FINAL') and (result->>'block_number' !~ '^[1-9][0-9]{0,77}$'
      or result->>'block_hash' !~ '^0x[0-9a-f]{64}$' or result->>'block_timestamp' is null) then
      raise exception 'fund_setup_final_block_required' using errcode='23514';end if;
    if result->>'status'='FINAL' and (result->>'runtime_hash' is distinct from t.intent->>'expected_runtime_hash'
      or result->'checks' is distinct from t.intent->'checks'
      or (t.kind='CREATE' and result->>'contract_address' is distinct from t.intent->>'expected_address')
      or (t.kind='CALL' and t.step_key<>'safe_creation' and result->'contract_address' is distinct from 'null'::jsonb)
      or (t.step_key='safe_creation' and result->>'contract_address' is distinct from t.intent->>'expected_address')) then
      raise exception 'fund_setup_final_effect_required' using errcode='23514';end if;
  end if;
  insert into bx1_portal.fund_setup_observations(setup_id,step_id,request_hash,result_hash,actor_id,operating_context,result)
    values(s.id,t.id,bx1_portal.fund_digest(expected),bx1_portal.fund_digest(result),s.actor_id,s.operating_context,result) returning id into observation;
  if expected->>'kind'='SAFE' then
    update bx1_portal.fund_setups set safe_state='VERIFIED',safe_owners=result->'owners',safe_threshold=(result->>'threshold')::integer,
      safe_observation_id=observation,revision=revision+1 where id=s.id returning * into s;
  else
    update bx1_portal.fund_setup_steps set state=next_state,reason_code=result->>'reason_code',observation_id=observation,
      deployed_address=case when next_state='FINAL' and (kind='CREATE' or step_key='safe_creation') then result->>'contract_address' else deployed_address end,
      revision=revision+1 where id=t.id;
    update bx1_portal.fund_setups set safe_address=case when t.step_key='safe_creation' and next_state='FINAL' then t.intent->>'expected_address' else safe_address end,
      safe_state=case when t.step_key='safe_creation' and next_state='FINAL' then 'REQUESTED' else safe_state end,
      revision=revision+1 where id=s.id returning * into s;
  end if;
  perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_OBSERVE',before_rev,s.revision,
    pg_catalog.jsonb_build_object('observation_id',observation,'kind',expected->>'kind','result_hash',bx1_portal.fund_digest(result)));
  answer:=bx1_portal.fund_setup_projection(s.product_id,s.operating_context);
  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
end $$;

create function bx1_portal.fund_setup_authorise(sid uuid,expected integer,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_setups;
begin
  select * into s from bx1_portal.fund_setups where id=sid and actor_id=auth.uid() and operating_context=c;
  if s.id is null then raise exception 'fund_setup_authorise_actor_denied' using errcode='42501';end if;
  perform bx1_portal.fund_setup_lock(c,s.product_id,true);
  select * into strict s from bx1_portal.fund_setups where id=sid for update;
  if s.revision<>expected or bx1_portal.fund_setup_current(s.id,c) is not true then raise exception 'fund_setup_authorise_revision_or_authority_changed' using errcode='42501';end if;
  -- A fresh legitimate session may resume the same original UNKNOWN transaction.
  -- This changes no business version, nonce, bytecode, claimed state or expiry.
  update bx1_portal.fund_setups set actor_claims=auth.jwt() where id=s.id;
  perform bx1_portal.fund_setup_audit(s.id,null,'FUND_SETUP_AUTHORISE',s.revision,s.revision,
    pg_catalog.jsonb_build_object('session_binding_hash',bx1_portal.fund_digest(pg_catalog.jsonb_build_object('actor_id',auth.uid(),
      'session_id',auth.jwt()->>'session_id','aal',auth.jwt()->>'aal'))));
  return bx1_portal.fund_setup_projection(s.product_id,c);
end $$;
create function public.bx1_portal_fund_setup_authorise(setup_id uuid,expected_revision integer,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_setup_authorise(setup_id,expected_revision,operating_context); $$;

-- Default function EXECUTE is removed explicitly for every new helper and lane.
do $acl$
declare item record;
begin
  for item in select p.oid::pg_catalog.regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='bx1_portal' and pg_catalog.left(p.proname,11)='fund_setup_')
      or (n.nspname='bx1_portal' and p.proname in ('read_fund_setup_preparation','prepare_fund_setup_step','read_fund_setup_observation','record_fund_setup_observation'))
      or (n.nspname='public' and p.proname in ('bx1_portal_fund_setup_read','bx1_portal_fund_setup_command','bx1_portal_fund_setup_authorise'))
  loop execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_fund_execution_worker',item.signature);end loop;
end $acl$;
grant usage on schema bx1_portal to authenticated;
grant execute on function bx1_portal.fund_setup_projection(uuid,jsonb),bx1_portal.fund_setup_command(text,uuid,jsonb,jsonb),
  bx1_portal.fund_setup_authorise(uuid,integer,jsonb),public.bx1_portal_fund_setup_authorise(uuid,integer,jsonb),
  public.bx1_portal_fund_setup_read(uuid,jsonb),public.bx1_portal_fund_setup_command(text,uuid,jsonb,jsonb) to authenticated;
grant execute on function bx1_portal.read_fund_setup_preparation(uuid,text,integer,text,uuid,jsonb),bx1_portal.prepare_fund_setup_step(jsonb,jsonb),
  bx1_portal.read_fund_setup_observation(uuid,uuid,integer,uuid,jsonb),bx1_portal.record_fund_setup_observation(jsonb,jsonb) to bx1_fund_execution_worker;
