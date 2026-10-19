-- Additive TEST-only hashless trex_version recovery. No original function, row,
-- trigger, nonce, preparation expiry or intent is rewritten at installation.
-- Owner applies atomically. Provider facts enter only through the existing
-- restricted worker; this SQL never asserts that a transaction is FINAL.
do $setup_retry_install$
declare
  signature text; item record; existing_read oid; existing_write oid; present integer;
  read_source constant text:=$retry_read_source$
declare prior_claims text:=coalesce(pg_catalog.current_setting('request.jwt.claims',true),'');
  s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;deps jsonb;anchor jsonb;
  leases jsonb;active jsonb;retry_count integer;next_retry_at timestamptz;answer jsonb;
begin
  if sid is null or tid is null or actor is null or c is null or expected_revision is null or expected_revision<1 then
    raise exception 'fund_setup_retry_scope_required' using errcode='22023';end if;
  prior_claims:=bx1_portal.fund_setup_worker_enter(sid,actor,c,true);
  if not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_setup_retry_test_only' using errcode='42501';end if;
  select f.* into strict s from bx1_portal.fund_setups f where f.id=sid for update;
  select step.* into t from bx1_portal.fund_setup_steps step where step.id=tid and step.setup_id=s.id for update;
  if s.revision<>expected_revision or s.actor_id is distinct from actor or s.operating_context is distinct from c
    or t.id is null or t.step_key is distinct from 'trex_version' or t.ordinal<>11 or t.kind is distinct from 'CALL'
    or t.state not in ('UNKNOWN','BROADCAST','PENDING','FINAL') or t.intent is null or t.intent_hash is null
    or t.claimed_at is null or t.expires_at is null or t.actor_id is distinct from actor
    or s.configuration is null or s.setup_configuration_hash is null or s.safe_state is distinct from 'VERIFIED'
    or s.safe_observation_id is null or s.source_pin is distinct from 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4'
    or t.intent->'chain_id' is distinct from '80002'::jsonb or t.intent->>'step_key' is distinct from 'trex_version'
    or t.intent->>'kind' is distinct from 'CALL' or t.intent->>'sender' is distinct from t.sender
    or t.intent->>'nonce' is distinct from t.nonce::text or t.intent->>'value' is distinct from '0'
    or t.intent->>'configuration_hash' is distinct from s.setup_configuration_hash
    or bx1_portal.fund_digest(t.intent) is distinct from t.intent_hash
    or t.data_hash is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(pg_catalog.substr(t.intent->>'data',3),'hex')),'hex')
    or bx1_portal.fund_setup_wallet_current(actor,t.sender) is not true
    or exists(select 1 from bx1_portal.fund_setup_steps earlier where earlier.setup_id=s.id and earlier.ordinal<t.ordinal
      and (earlier.state<>'FINAL' or earlier.observation_id is null)) then
    raise exception 'fund_setup_retry_original_not_current' using errcode='42501';end if;
  select coalesce(pg_catalog.jsonb_object_agg(step.step_key,step.deployed_address),'{}'::jsonb) into deps
    from bx1_portal.fund_setup_steps step where step.setup_id=s.id and step.kind='CREATE' and step.state='FINAL';
  if t.intent->>'to' is distinct from deps->>'trex_authority' then
    raise exception 'fund_setup_retry_original_target_changed' using errcode='23514';end if;
  if exists(select 1 from bx1_private.fund_setup_retry_leases l where l.step_id=t.id
    and (l.setup_id,l.actor_id,l.operating_context,l.intent_hash,l.sender,l.nonce)
      is distinct from (s.id,actor,c,t.intent_hash,t.sender,t.nonce)) then
    raise exception 'fund_setup_retry_history_binding_invalid' using errcode='23514';end if;
  select coalesce(pg_catalog.jsonb_agg((pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text) order by l.created_at,l.id),'[]'::jsonb),
    count(*)::integer,max(l.created_at)+interval '30 seconds' into leases,retry_count,next_retry_at
    from bx1_private.fund_setup_retry_leases l where l.step_id=t.id;
  if retry_count>3 then raise exception 'fund_setup_retry_history_invalid' using errcode='23514';end if;
  select (pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text) into active from bx1_private.fund_setup_retry_leases l
    where l.step_id=t.id and l.expires_at>pg_catalog.clock_timestamp() order by l.created_at desc,l.id desc limit 1;
  select l.proof->'anchor' into anchor from bx1_private.fund_setup_retry_leases l
    where l.step_id=t.id order by l.created_at desc,l.id desc limit 1;
  if anchor is null then
    select pg_catalog.jsonb_build_object('block_number',o.result->>'block_number','block_hash',o.result->>'block_hash') into anchor
      from bx1_portal.fund_setup_steps earlier join bx1_portal.fund_setup_observations o on o.id=earlier.observation_id
        and o.setup_id=s.id and o.step_id=earlier.id
      where earlier.setup_id=s.id and earlier.ordinal<t.ordinal and earlier.state='FINAL'
        and o.result->>'status'='FINAL' and o.result_hash=bx1_portal.fund_digest(o.result)
      order by earlier.ordinal desc limit 1;
  end if;
  if anchor is null or pg_catalog.jsonb_typeof(anchor->'block_number') is distinct from 'string'
    or pg_catalog.jsonb_typeof(anchor->'block_hash') is distinct from 'string'
    or anchor->>'block_number' !~ '^(0|[1-9][0-9]{0,77})$'
    or anchor->>'block_hash' !~ '^0x[0-9a-f]{64}$' or anchor->>'block_hash' ~ '^0x0{64}$' then
    raise exception 'fund_setup_retry_anchor_unavailable' using errcode='23514';end if;
  answer:=pg_catalog.jsonb_build_object('setup_id',s.id,'expected_revision',s.revision,'actor_id',s.actor_id,'operating_context',s.operating_context,
    'environment','TESTNET','product_id',s.product_id,'offering_revision_id',s.offering_revision_id,'terms_hash',s.terms_hash,
    'configuration_hash',s.configuration_hash,'setup_configuration_hash',s.setup_configuration_hash,'source_pin',s.source_pin,'expires_at',s.expires_at,
    'step_id',t.id,'step_key',t.step_key,'expected_step_revision',t.revision,'sender',t.sender,'configuration',s.configuration,
    'safe_configuration',s.safe_configuration,'dependencies',deps,'roleplay_policy',s.roleplay_policy,'intent',t.intent,'intent_hash',t.intent_hash,
    'original_state',t.state,'original_transaction_hash',t.transaction_hash,'original_claimed_at',t.claimed_at,'original_expires_at',t.expires_at,
    'anchor',anchor,'retry_count',retry_count,'next_retry_at',next_retry_at,'active_lease',active,'leases',leases);
  if bx1_portal.fund_setup_context(c,s.product_id,true) is not true then
    raise exception 'fund_setup_retry_authority_changed' using errcode='42501';end if;
  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
end
$retry_read_source$;
  write_source constant text:=$retry_write_source$
declare prior_claims text:=coalesce(pg_catalog.current_setting('request.jwt.claims',true),'');
  s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;l bx1_private.fund_setup_retry_leases;
  prior bx1_portal.fund_setup_requests;actor uuid;c jsonb;current_read jsonb;identity jsonb;proof jsonb;provider jsonb;
  public_lease jsonb;answer jsonb;checked_at timestamptz;now_at timestamptz;before_rev integer;retry_count integer;
  last_grant timestamptz;lease_id uuid;candidate text;winner jsonb;is_mismatch boolean;provider_index integer;
  mutable_fields text[]:=array['expected_revision','expected_step_revision','original_state','original_transaction_hash',
    'anchor','retry_count','next_retry_at','active_lease','leases'];
begin
  if action is null or action not in ('CLAIM','HASH','OUTCOME','HOLD') or request_key is null
    or request_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(preparation) is distinct from 'object' or pg_catalog.jsonb_typeof(details) is distinct from 'object'
    or pg_catalog.octet_length(preparation::text)>524288 or pg_catalog.octet_length(details::text)>524288 then
    raise exception 'fund_setup_retry_invalid_request' using errcode='22023';end if;
  actor:=(preparation->>'actor_id')::uuid;c:=preparation->'operating_context';
  prior_claims:=bx1_portal.fund_setup_worker_enter((preparation->>'setup_id')::uuid,actor,c,true);
  select f.* into strict s from bx1_portal.fund_setups f where f.id=(preparation->>'setup_id')::uuid for update;
  select step.* into strict t from bx1_portal.fund_setup_steps step where step.id=(preparation->>'step_id')::uuid and step.setup_id=s.id for update;
  current_read:=bx1_portal.read_fund_setup_retry(s.id,t.id,s.revision,actor,c);
  if preparation-mutable_fields is distinct from current_read-mutable_fields then
    raise exception 'fund_setup_retry_immutable_read_changed' using errcode='23514';end if;
  if action='CLAIM' and bx1_portal.fund_setup_package_approved(s.product_id) is not true then
    raise exception 'fund_setup_retry_current_package_required' using errcode='42501';end if;
  if action='CLAIM' then
    perform bx1_portal.require_keys(details,array['proof']);
    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,
      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,
      'expected_revision',preparation->'expected_revision','expected_step_revision',preparation->'expected_step_revision');
    proof:=details->'proof';
  elsif action='HASH' then
    perform bx1_portal.require_keys(details,array['lease_id','transaction_hash','discovery_proof']);
    if pg_catalog.jsonb_typeof(details->'transaction_hash') is distinct from 'string'
      or details->>'transaction_hash' !~ '^0x[0-9a-f]{64}$' or details->>'transaction_hash' ~ '^0x0{64}$' then
      raise exception 'fund_setup_retry_hash_invalid' using errcode='23514';end if;
    lease_id:=(details->>'lease_id')::uuid;candidate:=details->>'transaction_hash';proof:=nullif(details->'discovery_proof','null'::jsonb);
    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,
      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,'lease_id',lease_id,'transaction_hash',candidate);
  elsif action='OUTCOME' then
    perform bx1_portal.require_keys(details,array['lease_id','outcome']);lease_id:=(details->>'lease_id')::uuid;
    if lease_id is null or pg_catalog.jsonb_typeof(details->'outcome') is distinct from 'string'
      or details->>'outcome' not in ('REJECTED','PENDING_PROMPT','UNKNOWN') then
      raise exception 'fund_setup_retry_outcome_invalid' using errcode='23514';end if;
    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,
      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,'lease_id',lease_id,'outcome',details->>'outcome');
  else
    perform bx1_portal.require_keys(details,array['proof']);proof:=details->'proof';
    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,
      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,'proof',proof-'checked_at');
  end if;
  -- Replay precedes CAS/fresh-provider checks, but follows current real authority
  -- and immutable-operation checks. It never renews a lease or repeats a write.
  select r.* into prior from bx1_portal.fund_setup_requests r where r.actor_id=actor and r.request_key=record_fund_setup_retry.request_key;
  if prior.actor_id is not null then
    if prior.setup_id is distinct from s.id or prior.command is distinct from 'RETRY_'||action
      or prior.operating_context is distinct from c or prior.payload->'retry_identity' is distinct from identity then
      raise exception 'fund_setup_retry_idempotency_conflict' using errcode='23505';end if;
    if action='CLAIM' then select lease.* into strict l from bx1_private.fund_setup_retry_leases lease
      where lease.actor_id=actor and lease.request_key=record_fund_setup_retry.request_key and lease.step_id=t.id;
    elsif lease_id is not null then select lease.* into strict l from bx1_private.fund_setup_retry_leases lease where lease.id=lease_id
      and lease.actor_id=actor and lease.setup_id=s.id and lease.step_id=t.id and lease.operating_context=c and lease.intent_hash=t.intent_hash;end if;
    public_lease:=case when l.id is null then null else (pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text) end;
    answer:=pg_catalog.jsonb_build_object('lease',public_lease,'snapshot',bx1_portal.fund_setup_projection(s.product_id,c));
    perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
  end if;
  if lease_id is not null then
    select lease.* into l from bx1_private.fund_setup_retry_leases lease where lease.id=lease_id and lease.setup_id=s.id and lease.step_id=t.id
      and lease.actor_id=actor and lease.operating_context=c and lease.intent_hash=t.intent_hash and lease.sender=t.sender and lease.nonce=t.nonce;
    if l.id is null then raise exception 'fund_setup_retry_lease_denied' using errcode='42501';end if;
    public_lease:=(pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text);
  end if;
  -- Only grants and authoritative discovery/hold require a fresh server proof.
  if action in ('CLAIM','HOLD') or (action='HASH' and lease_id is null) then
    perform bx1_portal.require_keys(proof,array['version','chain_id','checked_at','status','reason_code','sender','nonce','intent_hash',
      'anchor','providers','finalized_nonce','transaction_hash','retry_checks','winner']);
    if proof->'version' is distinct from '1'::jsonb or proof->'chain_id' is distinct from '80002'::jsonb
      or proof->>'sender' is distinct from t.sender or proof->>'nonce' is distinct from t.nonce::text
      or proof->>'intent_hash' is distinct from t.intent_hash or pg_catalog.jsonb_typeof(proof->'checked_at') is distinct from 'string'
      or pg_catalog.jsonb_typeof(proof->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(proof->'providers')<>2 then
      raise exception 'fund_setup_retry_proof_binding_invalid' using errcode='23514';end if;
    begin checked_at:=(proof->>'checked_at')::timestamptz;
    exception when others then raise exception 'fund_setup_retry_proof_time_invalid' using errcode='23514';end;
    now_at:=pg_catalog.clock_timestamp();
    if checked_at>now_at or checked_at<now_at-interval '30 seconds' then raise exception 'fund_setup_retry_proof_stale' using errcode='23514';end if;
    perform bx1_portal.require_keys(proof->'anchor',array['block_number','block_hash']);
    if pg_catalog.jsonb_typeof(proof#>'{anchor,block_number}') is distinct from 'string'
      or proof#>>'{anchor,block_number}' !~ '^(0|[1-9][0-9]{0,77})$'
      or pg_catalog.jsonb_typeof(proof#>'{anchor,block_hash}') is distinct from 'string'
      or proof#>>'{anchor,block_hash}' !~ '^0x[0-9a-f]{64}$' or proof#>>'{anchor,block_hash}' ~ '^0x0{64}$' then
      raise exception 'fund_setup_retry_anchor_invalid' using errcode='23514';end if;
    provider_index:=0;
    for provider in select value from pg_catalog.jsonb_array_elements(proof->'providers') loop
      perform bx1_portal.require_keys(provider,array['url','finalized_block_number','finalized_block_hash','latest_nonce','pending_nonce']);
      if provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]
        or pg_catalog.jsonb_typeof(provider->'finalized_block_number') is distinct from 'string'
        or provider->>'finalized_block_number' !~ '^(0|[1-9][0-9]{0,77})$'
        or pg_catalog.jsonb_typeof(provider->'finalized_block_hash') is distinct from 'string'
        or provider->>'finalized_block_hash' !~ '^0x[0-9a-f]{64}$' or provider->>'finalized_block_hash' ~ '^0x0{64}$'
        or pg_catalog.jsonb_typeof(provider->'latest_nonce') is distinct from 'string' or provider->>'latest_nonce' !~ '^(0|[1-9][0-9]{0,77})$'
        or pg_catalog.jsonb_typeof(provider->'pending_nonce') is distinct from 'string' or provider->>'pending_nonce' !~ '^(0|[1-9][0-9]{0,77})$'
        or (provider->>'finalized_block_number')::numeric<(proof#>>'{anchor,block_number}')::numeric
        or ((provider->>'finalized_block_number')::numeric=(proof#>>'{anchor,block_number}')::numeric
          and provider->>'finalized_block_hash' is distinct from proof#>>'{anchor,block_hash}') then
        raise exception 'fund_setup_retry_provider_invalid' using errcode='23514';end if;
      provider_index:=provider_index+1;
    end loop;
    -- Latest/pending nonce alone is not finalized evidence of consumption.
    -- Bind the agreed nonce to the common (minimum) finalized provider head.
    perform bx1_portal.require_keys(proof->'finalized_nonce',array['block_number','block_hash','nonce']);
    if pg_catalog.jsonb_typeof(proof#>'{finalized_nonce,block_number}') is distinct from 'string'
      or proof#>>'{finalized_nonce,block_number}' !~ '^(0|[1-9][0-9]{0,77})$'
      or pg_catalog.jsonb_typeof(proof#>'{finalized_nonce,block_hash}') is distinct from 'string'
      or proof#>>'{finalized_nonce,block_hash}' !~ '^0x[0-9a-f]{64}$' or proof#>>'{finalized_nonce,block_hash}' ~ '^0x0{64}$'
      or pg_catalog.jsonb_typeof(proof#>'{finalized_nonce,nonce}') is distinct from 'string'
      or proof#>>'{finalized_nonce,nonce}' !~ '^(0|[1-9][0-9]{0,77})$'
      or (proof#>>'{finalized_nonce,block_number}')::numeric is distinct from
        least((proof#>>'{providers,0,finalized_block_number}')::numeric,(proof#>>'{providers,1,finalized_block_number}')::numeric)
      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p
        where (p->>'finalized_block_number')::numeric=(proof#>>'{finalized_nonce,block_number}')::numeric
          and p->>'finalized_block_hash' is distinct from proof#>>'{finalized_nonce,block_hash}')
      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p
        where (p->>'latest_nonce')::numeric<(proof#>>'{finalized_nonce,nonce}')::numeric
          or (p->>'pending_nonce')::numeric<(p->>'latest_nonce')::numeric) then
      raise exception 'fund_setup_retry_finalized_nonce_invalid' using errcode='23514';end if;
  elsif action='HASH' and proof is not null then
    raise exception 'fund_setup_retry_lease_hash_has_discovery_proof' using errcode='23514';
  end if;
  before_rev:=s.revision;
  if action='CLAIM' then
    perform bx1_portal.funding_require_revision(s.revision,preparation->'expected_revision');
    perform bx1_portal.funding_require_revision(t.revision,preparation->'expected_step_revision');
    if t.state is distinct from 'UNKNOWN' or t.transaction_hash is not null or proof->>'status' is distinct from 'RETRY_AVAILABLE'
      or proof->'transaction_hash' is distinct from 'null'::jsonb or proof->'winner' is distinct from 'null'::jsonb
      or proof->'reason_code' is distinct from 'null'::jsonb then raise exception 'fund_setup_retry_grant_not_available' using errcode='23514';end if;
    perform bx1_portal.require_keys(proof->'retry_checks',array['runtime_hash','owner','before_version','simulation_succeeded']);
    if proof#>>'{retry_checks,runtime_hash}' is distinct from t.intent->>'expected_runtime_hash'
      or proof#>>'{retry_checks,owner}' is distinct from t.sender
      or proof#>'{retry_checks,simulation_succeeded}' is distinct from 'true'::jsonb
      or pg_catalog.jsonb_typeof(proof#>'{retry_checks,before_version}') is distinct from 'string'
      or char_length(proof#>>'{retry_checks,before_version}') not between 1 and 32
      or proof#>>'{retry_checks,before_version}'='4.1.3'
      or proof#>>'{finalized_nonce,nonce}' is distinct from t.nonce::text
      or proof#>'{finalized_nonce,block_number}' is distinct from proof#>'{anchor,block_number}'
      or proof#>'{finalized_nonce,block_hash}' is distinct from proof#>'{anchor,block_hash}'
      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p
        where p->>'latest_nonce' is distinct from t.nonce::text or p->>'pending_nonce' is distinct from t.nonce::text) then
      raise exception 'fund_setup_retry_pre_effect_invalid' using errcode='23514';end if;
    select count(*)::integer,max(lease.created_at) into retry_count,last_grant from bx1_private.fund_setup_retry_leases lease where lease.step_id=t.id;
    if retry_count>=3 or last_grant>pg_catalog.clock_timestamp()-interval '30 seconds'
      or exists(select 1 from bx1_private.fund_setup_retry_leases lease where lease.step_id=t.id and lease.expires_at>pg_catalog.clock_timestamp()) then
      raise exception 'fund_setup_retry_limit_or_active_lease' using errcode='23514';end if;
    now_at:=pg_catalog.clock_timestamp();
    insert into bx1_private.fund_setup_retry_leases(setup_id,step_id,actor_id,operating_context,intent_hash,sender,nonce,request_key,
      created_at,expires_at,expected_revision,expected_step_revision,proof,proof_hash)
      values(s.id,t.id,actor,c,t.intent_hash,t.sender,t.nonce,record_fund_setup_retry.request_key,now_at,now_at+interval '120 seconds',
        s.revision,t.revision,proof,bx1_portal.fund_digest(proof)) returning * into l;
    update bx1_portal.fund_setup_steps step set revision=step.revision+1 where step.id=t.id;
    update bx1_portal.fund_setups f set revision=f.revision+1 where f.id=s.id returning * into s;
    public_lease:=(pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text);
  elsif action='HASH' then
    if lease_id is null then
      winner:=proof->'winner';
      perform bx1_portal.require_keys(winner,array['block_number','block_hash','transaction_hash','from','to','value','data','nonce','chain_id']);
      if proof->>'status' is distinct from 'WINNER' or proof->>'transaction_hash' is distinct from candidate
        or winner->>'transaction_hash' is distinct from candidate or winner->>'from' is distinct from t.sender
        or winner->>'to' is distinct from t.intent->>'to' or winner->>'value' is distinct from '0'
        or winner->>'data' is distinct from t.intent->>'data' or winner->>'nonce' is distinct from t.nonce::text
        or winner->'chain_id' is distinct from '80002'::jsonb or pg_catalog.jsonb_typeof(winner->'block_number') is distinct from 'string'
        or winner->>'block_number' !~ '^(0|[1-9][0-9]{0,77})$'
        or pg_catalog.jsonb_typeof(winner->'block_hash') is distinct from 'string'
        or winner->>'block_hash' !~ '^0x[0-9a-f]{64}$' or winner->>'block_hash' ~ '^0x0{64}$'
        or (proof#>>'{finalized_nonce,nonce}')::numeric<=t.nonce
        or (proof#>>'{finalized_nonce,block_number}')::numeric<(winner->>'block_number')::numeric
        or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p
          where (p->>'finalized_block_number')::numeric<(winner->>'block_number')::numeric) then
        raise exception 'fund_setup_retry_discovery_invalid' using errcode='23514';end if;
    end if;
    insert into bx1_portal.fund_setup_transaction_attempts(setup_id,step_id,actor_id,operating_context,request_key,candidate_hash,prior_candidate_hash,intent_hash)
      values(s.id,t.id,actor,c,record_fund_setup_retry.request_key,candidate,t.transaction_hash,t.intent_hash);
    -- A delayed wallet response is candidate history, not authority to replace
    -- an already tracked candidate or regress PENDING. Only an untracked
    -- original, or canonical server discovery, may select a non-FINAL hash.
    if t.state<>'FINAL' and (lease_id is null or (t.state='UNKNOWN' and t.transaction_hash is null)) then
      update bx1_portal.fund_setup_steps step set state='BROADCAST',transaction_hash=candidate,revision=step.revision+1 where step.id=t.id;
      update bx1_portal.fund_setups f set revision=f.revision+1 where f.id=s.id returning * into s;
    end if;
  elsif action='HOLD' then
    winner:=nullif(proof->'winner','null'::jsonb);
    if proof->>'status' is distinct from 'HOLD' or pg_catalog.jsonb_typeof(proof->'reason_code') is distinct from 'string'
      or proof->>'reason_code' not in ('SETUP_RETRY_NONCE_WINNER_MISMATCH','SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION') then
      raise exception 'fund_setup_retry_hold_invalid' using errcode='23514';end if;
    if winner is not null then
      perform bx1_portal.require_keys(winner,array['block_number','block_hash','transaction_hash','from','to','value','data','nonce','chain_id']);
      is_mismatch:=winner->>'to' is distinct from t.intent->>'to' or winner->>'value' is distinct from '0'
        or winner->>'data' is distinct from t.intent->>'data' or winner->'chain_id' is distinct from '80002'::jsonb;
      if proof->>'reason_code' is distinct from 'SETUP_RETRY_NONCE_WINNER_MISMATCH'
        or winner->>'from' is distinct from t.sender or winner->>'nonce' is distinct from t.nonce::text or not is_mismatch
        or winner->>'transaction_hash' is distinct from proof->>'transaction_hash'
        or pg_catalog.jsonb_typeof(winner->'transaction_hash') is distinct from 'string'
        or winner->>'transaction_hash' !~ '^0x[0-9a-f]{64}$' or winner->>'transaction_hash' ~ '^0x0{64}$'
        or pg_catalog.jsonb_typeof(winner->'block_number') is distinct from 'string'
        or winner->>'block_number' !~ '^(0|[1-9][0-9]{0,77})$'
        or pg_catalog.jsonb_typeof(winner->'block_hash') is distinct from 'string'
        or winner->>'block_hash' !~ '^0x[0-9a-f]{64}$' or winner->>'block_hash' ~ '^0x0{64}$'
        or (proof#>>'{finalized_nonce,nonce}')::numeric<=t.nonce
        or (proof#>>'{finalized_nonce,block_number}')::numeric<(winner->>'block_number')::numeric
        or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p
          where (p->>'finalized_block_number')::numeric<(winner->>'block_number')::numeric) then
        raise exception 'fund_setup_retry_hold_not_authoritative' using errcode='23514';end if;
    elsif proof->>'reason_code' is distinct from 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION' or proof->'transaction_hash' is distinct from 'null'::jsonb
      or (proof#>>'{finalized_nonce,nonce}')::numeric<=t.nonce
      or (proof#>>'{finalized_nonce,block_number}')::numeric<(proof#>>'{anchor,block_number}')::numeric
      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p
        where (p->>'latest_nonce')::numeric<=t.nonce or (p->>'pending_nonce')::numeric<=t.nonce) then
      raise exception 'fund_setup_retry_hold_no_winner_invalid' using errcode='23514';end if;
    update bx1_portal.fund_setups f set recovery_hold=true,recovery_reason='FUND_SETUP_RETRY_'||(proof->>'reason_code'),revision=f.revision+1
      where f.id=s.id returning * into s;
  end if;
  if bx1_portal.fund_setup_context(c,s.product_id,true) is not true or bx1_portal.fund_setup_wallet_current(actor,t.sender) is not true
    or (action='CLAIM' and bx1_portal.fund_setup_package_approved(s.product_id) is not true) then
    raise exception 'fund_setup_retry_authority_changed_after_wait' using errcode='42501';end if;
  perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_RETRY_'||action,before_rev,s.revision,
    pg_catalog.jsonb_build_object('retry_identity',identity,'lease_id',coalesce(l.id,lease_id),'proof_hash',case when proof is null then null else bx1_portal.fund_digest(proof) end));
  insert into bx1_portal.fund_setup_requests(actor_id,request_key,setup_id,command,payload,operating_context)
    values(actor,record_fund_setup_retry.request_key,s.id,'RETRY_'||action,
      pg_catalog.jsonb_build_object('retry_identity',identity,'server_proof',proof),c);
  answer:=pg_catalog.jsonb_build_object('lease',public_lease,'snapshot',bx1_portal.fund_setup_projection(s.product_id,c));
  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;
end
$retry_write_source$;
begin
  if current_user<>'postgres' or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or not exists(select 1 from pg_catalog.pg_roles where rolname='bx1_fund_execution_worker') then
    raise exception 'fund_setup_retry_exact_test_owner_required' using errcode='55000';end if;
  foreach signature in array array['bx1_portal.fund_setup_worker_enter(uuid,uuid,jsonb,boolean)',
    'bx1_portal.fund_setup_lock(jsonb,uuid,boolean)','bx1_portal.fund_setup_current(uuid,jsonb)',
    'bx1_portal.fund_setup_context(jsonb,uuid,boolean)','bx1_portal.fund_setup_wallet_current(uuid,text)',
    'bx1_portal.fund_setup_package_approved(uuid)',
    'bx1_portal.fund_setup_projection(uuid,jsonb)','bx1_portal.fund_setup_audit(uuid,uuid,text,integer,integer,jsonb)',
    'bx1_portal.fund_audit(uuid,uuid,uuid,text,jsonb,integer,integer,uuid,jsonb)','bx1_portal.fund_digest(jsonb)',
    'bx1_portal.immutable_record()','bx1_portal.funding_require_revision(integer,jsonb)','bx1_portal.require_keys(jsonb,text[])'] loop
    if pg_catalog.to_regprocedure(signature) is null then raise exception 'fund_setup_retry_dependency_required: %',signature using errcode='55000';end if;
  end loop;
  if pg_catalog.to_regclass('bx1_portal.fund_setup_nonce_lease') is null
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_portal.fund_setup_steps'::regclass
      and tgname='fund_setup_steps_guard' and not tgisinternal and tgfoid='bx1_portal.fund_setup_mutation_guard()'::regprocedure) then
    raise exception 'fund_setup_retry_original_guards_required' using errcode='55000';end if;
  existing_read:=pg_catalog.to_regprocedure('bx1_portal.read_fund_setup_retry(uuid,uuid,integer,uuid,jsonb)');
  existing_write:=pg_catalog.to_regprocedure('bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)');
  present:=(existing_read is not null)::integer+(existing_write is not null)::integer
    +(pg_catalog.to_regclass('bx1_private.fund_setup_retry_leases') is not null)::integer;
  if present not in (0,3) then raise exception 'fund_setup_retry_partial_installation' using errcode='55000';end if;
  if present=3 then
    if (select prosrc from pg_catalog.pg_proc where oid=existing_read) is distinct from read_source
      or (select prosrc from pg_catalog.pg_proc where oid=existing_write) is distinct from write_source then
      raise exception 'fund_setup_retry_existing_source_changed' using errcode='55000';end if;
  else
    execute $table$create table bx1_private.fund_setup_retry_leases(
      id uuid primary key default pg_catalog.gen_random_uuid(),
      setup_id uuid not null references bx1_portal.fund_setups(id) on delete restrict,
      step_id uuid not null references bx1_portal.fund_setup_steps(id) on delete restrict,
      actor_id uuid not null,operating_context jsonb not null,intent_hash text not null check(intent_hash ~ '^[0-9a-f]{64}$'),
      sender text not null check(sender ~ '^0x[0-9a-f]{40}$'),nonce numeric(78,0) not null check(nonce>=0),request_key uuid not null,
      created_at timestamptz not null,expires_at timestamptz not null check(expires_at=created_at+interval '120 seconds'),
      expected_revision integer not null check(expected_revision>0),expected_step_revision integer not null check(expected_step_revision>0),
      proof jsonb not null,proof_hash text not null check(proof_hash ~ '^[0-9a-f]{64}$'),unique(actor_id,request_key),
      foreign key(actor_id,request_key) references bx1_portal.fund_setup_requests(actor_id,request_key) deferrable initially deferred
    )$table$;
    execute 'create index fund_setup_retry_step_created on bx1_private.fund_setup_retry_leases(step_id,created_at desc)';
    execute 'alter table bx1_private.fund_setup_retry_leases enable row level security';
    execute 'create trigger fund_setup_retry_leases_immutable before update or delete on bx1_private.fund_setup_retry_leases for each row execute function bx1_portal.immutable_record()';
    execute pg_catalog.format('create function bx1_portal.read_fund_setup_retry(sid uuid,tid uuid,expected_revision integer,actor uuid,c jsonb) returns jsonb language plpgsql volatile security definer set search_path='''' as %L',read_source);
    execute pg_catalog.format('create function bx1_portal.record_fund_setup_retry(preparation jsonb,action text,request_key uuid,details jsonb) returns jsonb language plpgsql volatile security definer set search_path='''' as %L',write_source);
  end if;
  -- Close PUBLIC and every current non-owner default grantee, not just familiar roles.
  for item in select distinct acl.grantee from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
    where c.oid='bx1_private.fund_setup_retry_leases'::regclass and acl.grantee<>c.relowner loop
    execute pg_catalog.format('revoke all on table bx1_private.fund_setup_retry_leases from %s',
      case when item.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) end);
  end loop;
  foreach signature in array array['bx1_portal.read_fund_setup_retry(uuid,uuid,integer,uuid,jsonb)',
    'bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)'] loop
    for item in select distinct acl.grantee from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid=pg_catalog.to_regprocedure(signature) and acl.grantee<>p.proowner loop
      execute pg_catalog.format('revoke all on function %s from %s',signature,
        case when item.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) end);
    end loop;
    execute pg_catalog.format('grant execute on function %s to bx1_fund_execution_worker',signature);
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(signature)
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""'] and p.provolatile='v'
      and p.prorettype='jsonb'::regtype and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')) then
      raise exception 'fund_setup_retry_helper_metadata_changed' using errcode='55000';end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_class where oid='bx1_private.fund_setup_retry_leases'::regclass
    and relowner='postgres'::regrole and relrowsecurity and not relforcerowsecurity)
    or exists(select 1 from pg_catalog.pg_policy where polrelid='bx1_private.fund_setup_retry_leases'::regclass)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_private.fund_setup_retry_leases'::regclass
      and tgname='fund_setup_retry_leases_immutable' and tgfoid='bx1_portal.immutable_record()'::regprocedure and not tgisinternal)
    or (select array_agg(attname::text order by attnum) from pg_catalog.pg_attribute where attrelid='bx1_private.fund_setup_retry_leases'::regclass and attnum>0 and not attisdropped)
      is distinct from array['id','setup_id','step_id','actor_id','operating_context','intent_hash','sender','nonce','request_key','created_at','expires_at',
        'expected_revision','expected_step_revision','proof','proof_hash'] then
    raise exception 'fund_setup_retry_lease_schema_changed' using errcode='55000';end if;
end $setup_retry_install$;
