-- TEST-only additive Alchemy pair compatibility. Contract EAA56F67...D0BCB5EF.
-- Seven existing bodies / eleven literal provider-only cuts. No runtime helpers,
-- grants, schemas, roles, business writes, or historical source rewrites.
do $amoy_archive_alchemy_pair$
declare
  targets constant jsonb:=$alchemy_pair_targets$[
  {
    "oid": 24934,
    "signature": "bx1_portal.record_funding_observation(uuid,jsonb)",
    "sha": "0537e0578f0516cda9484f5ea4648af5b74e93f44fbf5b644bd76448546305fb",
    "metadata": {
      "oid": "24934",
      "proacl": [
        "postgres=X/postgres",
        "service_role=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_funding_observation",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "eid",
        "facts"
      ],
      "proargtypes": [
        "2950",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare e bx1_portal.funding_verification_expectations; r bx1_portal.funding_routes; f bx1_portal.funding_references; o bx1_portal.funding_obligations;\n  prior bx1_portal.funding_observations; inserted bx1_portal.funding_observations; claimed uuid; c jsonb; old_claims text:=current_setting('request.jwt.claims',true);\n  expected_route jsonb; source jsonb; source_urls text[]; in_policy boolean; result jsonb; amount numeric; observed_block numeric;\nbegin\n  select * into e from bx1_portal.funding_verification_expectations where id=eid;\n  if e.id is null or e.expires_at<=clock_timestamp() or jsonb_typeof(facts) is distinct from 'object' or octet_length(facts::text)>16384 then raise exception 'funding_expectation_expired' using errcode='42501'; end if;\n  -- Only minimal claims captured by the authenticated mint are restored. Never\n  -- copy a service/browser actor from observation payload into authorization.\n  perform set_config('request.jwt.claims',e.trusted_claims::text,true); c:=e.operating_context;\n  if bx1_portal.funding_session() is not true or auth.uid() is distinct from e.actor_id or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_verifier_actor_expired' using errcode='42501'; end if;\n  if e.kind='ROUTE' then select * into r from bx1_portal.funding_routes where id=e.target_id;\n  else\n    select * into f from bx1_portal.funding_references where id=e.target_id;\n    select * into o from bx1_portal.funding_obligations where id=f.obligation_id;\n    select * into r from bx1_portal.funding_routes where id=o.route_id;\n  end if;\n  if r.id is null then raise exception 'funding_expectation_target_missing' using errcode='42501'; end if;\n  perform bx1_portal.funding_lock(c,r.organisation_id,r.product_id,o.subscription_id,o.id);\n  select * into r from bx1_portal.funding_routes where id=r.id for update;\n  if e.kind='REFERENCE' then select * into f from bx1_portal.funding_references where id=f.id; end if;\n  -- Idempotent replay is allowed only for identical immutable observations,\n  -- after fresh caller and context checks, without re-consuming the receipt.\n  select * into inserted from bx1_portal.funding_observations where expectation_id=e.id;\n  if inserted.id is not null then\n    if inserted.facts is distinct from facts then raise exception 'funding_observation_replay_conflict' using errcode='23505'; end if;\n    result:=jsonb_build_object('observation_id',inserted.id,'status',inserted.status);\n    perform set_config('request.jwt.claims',coalesce(old_claims,''),true); return result;\n  end if;\n  if e.expires_at<=clock_timestamp() or e.version is distinct from (case when e.kind='ROUTE' then r.revision else f.revision end)\n    or not(bx1_portal.funding_actions(c,e.kind,e.target_id)?case when e.kind='ROUTE' then 'verify_funding_route' else 'verify_funding_reference' end) then raise exception 'funding_expectation_stale' using errcode='42501'; end if;\n  expected_route:=e.expected->'route';\n  if expected_route is distinct from jsonb_build_object('id',r.id,'revision',case when e.kind='REFERENCE' then f.claim_route_revision else r.revision end,\n    'environment','TESTNET','chain_id',80002,'token_address',r.token_address,'token_runtime_hash',r.token_runtime_hash,'token_decimals',r.token_decimals,'receiving_address',r.receiving_address)\n    or e.expectation_hash is distinct from encode(sha256(convert_to(e.expected::text,'UTF8')),'hex') then raise exception 'funding_expectation_identity_changed' using errcode='23514'; end if;\n  if e.kind='REFERENCE' and e.expected->'reference' is distinct from jsonb_build_object('id',f.id,'obligation_id',o.id,'investment_account_id',o.investment_account_id,\n    'actor_id',f.actor_id,'payer_address',f.payer_address,'transaction_hash',f.transaction_hash,'log_index',f.log_index,'claim_signature',f.claim_signature,'created_at',f.created_at,'obligation_created_at',o.created_at) then raise exception 'funding_expectation_identity_changed' using errcode='23514'; end if;\n  if facts->'version' is distinct from '1'::jsonb or facts->>'kind' is distinct from e.kind or facts->'chain_id' is distinct from '80002'::jsonb\n    or coalesce(facts->>'status','') not in ('VERIFIED','INVALID') or facts->>'token_address' is distinct from r.token_address\n    or facts->>'token_runtime_hash' is distinct from r.token_runtime_hash or facts->'token_decimals' is distinct from to_jsonb(r.token_decimals)\n    or facts->>'receiving_address' is distinct from r.receiving_address or coalesce(facts->>'block_number','') !~ '^[0-9]{1,78}$'\n    or coalesce(facts->>'block_hash','') !~ '^0x[0-9a-f]{64}$' or facts->>'block_timestamp' is null\n    or jsonb_typeof(facts->'providers') is distinct from 'array' or jsonb_array_length(facts->'providers')<>2 then raise exception 'funding_invalid_observation' using errcode='22023'; end if;\n  observed_block:=(facts->>'block_number')::numeric;\n  if not isfinite((facts->>'block_timestamp')::timestamptz) or (facts->>'block_timestamp')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'funding_invalid_block_time' using errcode='22023'; end if;\n  select array_agg(x->>'url' order by x->>'url') into source_urls from jsonb_array_elements(facts->'providers') x;\n  if (source_urls is distinct from array['https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.drpc.org']::text[]\n    and source_urls is distinct from array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) then raise exception 'funding_invalid_sources' using errcode='22023'; end if;\n  for source in select value from jsonb_array_elements(facts->'providers') loop\n    if coalesce(source->>'finalized_block_number','') !~ '^[0-9]{1,78}$' or coalesce(source->>'finalized_block_hash','') !~ '^0x[0-9a-f]{64}$'\n      or (source->>'finalized_block_number')::numeric<observed_block then raise exception 'funding_not_finalized' using errcode='22023'; end if;\n  end loop;\n  if e.kind='ROUTE' then\n    if facts->>'status' is distinct from 'VERIFIED' then raise exception 'funding_invalid_route_observation' using errcode='22023'; end if;\n  else\n    if facts->>'transaction_hash' is distinct from f.transaction_hash or facts->'log_index' is distinct from to_jsonb(f.log_index)\n      or facts->>'payer_address' is distinct from f.payer_address or coalesce(facts->>'transaction_index','') !~ '^[0-9]{1,10}$'\n      or coalesce(facts->>'claim_hash','') !~ '^0x[0-9a-f]{64}$' then raise exception 'funding_receipt_mismatch' using errcode='22023'; end if;\n    prior:=bx1_portal.funding_last_observation(f.id);\n    if facts->>'status'='INVALID' then\n      if facts->>'reason_code' is distinct from 'RECEIPT_REVERTED' or facts?'amount_base_units' or exists(select 1 from bx1_portal.funding_receipt_claims where reference_id=f.id) then raise exception 'funding_not_conclusively_unpaid' using errcode='23514'; end if;\n    else\n      if coalesce(facts->>'amount_base_units','') !~ '^[1-9][0-9]{0,77}$' then raise exception 'funding_invalid_amount' using errcode='22023'; end if;\n      amount:=(facts->>'amount_base_units')::numeric;\n      if amount>=power(2::numeric,256) then raise exception 'funding_amount_overflow' using errcode='22023'; end if;\n      if prior.status='VERIFIED' and (prior.amount_base_units is distinct from amount or prior.block_hash is distinct from facts->>'block_hash') then raise exception 'funding_verified_fact_conflict' using errcode='23514'; end if;\n    end if;\n  end if;\n  insert into bx1_portal.funding_observations(expectation_id,route_id,reference_id,status,facts,amount_base_units,block_number,block_hash)\n    values(e.id,r.id,f.id,facts->>'status',facts,amount,observed_block,facts->>'block_hash') returning * into inserted;\n  if e.kind='REFERENCE' then\n    if facts->>'status'='VERIFIED' then\n      insert into bx1_portal.funding_receipt_claims(chain_id,transaction_hash,log_index,reference_id,first_observation_id)\n        values(80002,f.transaction_hash,f.log_index,f.id,inserted.id) on conflict(chain_id,transaction_hash,log_index) do nothing;\n      select reference_id into claimed from bx1_portal.funding_receipt_claims where chain_id=80002 and transaction_hash=f.transaction_hash and log_index=f.log_index;\n      if claimed is distinct from f.id then raise exception 'funding_receipt_already_claimed' using errcode='23505'; end if;\n      in_policy:=bx1_portal.funding_route_current(r.id) and bx1_portal.funding_account_current(o.id)\n        and (facts->>'block_timestamp')::timestamptz>o.created_at and facts->>'policy_status' is distinct from 'UNAPPLIED'\n        and not exists(select 1 from bx1_portal.subscriptions where id=o.subscription_id and status='CANCELLED');\n      update bx1_portal.funding_references set revision=revision+1,status=case when status='POSTED' then 'POSTED' when status='UNAPPLIED' or in_policy is not true then 'UNAPPLIED' else 'VERIFIED' end where id=f.id;\n    else\n      update bx1_portal.funding_references set revision=revision+1,status=case when status in ('UNAPPLIED','REJECTED_UNPAID') then status else 'SUBMITTED' end where id=f.id;\n    end if;\n    update bx1_portal.funding_obligations set revision=revision+1 where id=o.id;\n  end if;\n  insert into bx1_portal.events(subject_id,organisation_id,investor_id,kind,actor_id,summary)\n    values(coalesce(f.id,r.id),r.organisation_id,o.investor_id,'funding_observation',e.actor_id,'Server-verified finalized TESTNET evidence recorded; no production money or issued holding.');\n  if e.expires_at<=clock_timestamp() or bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true\n    or not(bx1_portal.funding_actions(c,e.kind,e.target_id)?case when e.kind='ROUTE' then 'verify_funding_route' else 'verify_funding_reference' end) then raise exception 'funding_observation_authority_expired' using errcode='42501'; end if;\n  result:=jsonb_build_object('observation_id',inserted.id,'status',inserted.status);\n  perform set_config('request.jwt.claims',coalesce(old_claims,''),true); return result;\nexception when others then\n  perform set_config('request.jwt.claims',coalesce(old_claims,''),true); raise;\nend ",
    "cuts": [
      {
        "name": "funding_pair",
        "from": "and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[])",
        "to": "and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[])",
        "count": 1
      }
    ],
    "final_sha": "a76dc61a37cee8ef51fa2770ab0d1d7152467bc7000ef820c14f3a29a5e561af"
  },
  {
    "oid": 33625,
    "signature": "bx1_portal.fund_setup_observers_valid(jsonb)",
    "sha": "c9eda9d4cdf1b1e50c28e66e91911a590909e6fa49d7035e6f953bae993d001c",
    "metadata": {
      "oid": "33625",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_setup_observers_valid",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "result"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare entry jsonb;urls text[]:='{}';\nbegin\n  if pg_catalog.jsonb_typeof(result->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'providers')<>2 then return false;end if;\n  for entry in select value from pg_catalog.jsonb_array_elements(result->'providers') loop\n    if pg_catalog.jsonb_typeof(entry) is distinct from 'object' or entry-array['url','finalized_block_number','finalized_block_hash']<>'{}'\n      or not(entry ?& array['url','finalized_block_number','finalized_block_hash'])\n      or pg_catalog.jsonb_typeof(entry->'url') is distinct from 'string'\n      or entry->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com')\n      or pg_catalog.jsonb_typeof(entry->'finalized_block_number') is distinct from 'string'\n      or entry->>'finalized_block_number' !~ '^[1-9][0-9]{0,77}$'\n      or pg_catalog.jsonb_typeof(entry->'finalized_block_hash') is distinct from 'string'\n      or entry->>'finalized_block_hash' !~ '^0x[0-9a-f]{64}$' then return false;end if;\n    urls:=pg_catalog.array_append(urls,entry->>'url');\n    if result->>'block_number' is not null and (result->>'block_number' !~ '^[1-9][0-9]{0,77}$'\n      or (entry->>'finalized_block_number')::numeric<(result->>'block_number')::numeric) then return false;end if;\n  end loop;\n  return urls[1]<>urls[2] and (urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com']::text[]\n    or urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) is true;\nexception when others then return false;\nend ",
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "a5e330b4d8d77c5bc6e3d24c123bb7ae9ac0747a6289744cf24d67384a6d8335"
  },
  {
    "oid": 36424,
    "signature": "bx1_portal.record_fund_admission(uuid,jsonb,text)",
    "sha": "22002bab1e1930ea79f32db15e76260a2e1746e448839d01b45b77cdfeae43da",
    "metadata": {
      "oid": "36424",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_admission",
      "prorows": 0,
      "pronargs": 3,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "request_id",
        "candidate",
        "admitted_manifest_hash"
      ],
      "proargtypes": [
        "2950",
        "3802",
        "25"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare prior text;r bx1_portal.fund_admission_requests;s bx1_portal.fund_setups;p bx1_private.roleplay_policies;\n  manifest jsonb;proof_refs jsonb;receipt_kind text;receipt_id uuid;evidence jsonb;capacity record;slot record;expiry timestamptz;policy_hash text;provider jsonb;\nbegin\n  prior:=bx1_portal.fund_admission_worker_enter(request_id);\n  select * into r from bx1_portal.fund_admission_requests where id=request_id for update;\n  if r.status='ADMITTED' then\n    if r.result_hash is distinct from bx1_portal.fund_digest(candidate) then raise exception 'fund_admission_result_conflict' using errcode='23505';end if;\n    perform set_config('request.jwt.claims',prior,true);return jsonb_build_object('request_id',r.id,'status',r.status,'manifest_id',r.manifest_id,'signer_policy_id',r.signer_policy_id);\n  end if;\n  select * into s from bx1_portal.fund_setups where id=r.setup_id for share;\n  select * into p from bx1_private.roleplay_policies where id=r.roleplay_policy_id for share;\n  manifest:=candidate->'manifest';proof_refs:=r.input->'proof_refs';expiry:=least(s.expires_at,p.valid_until,\n    (select valid_until from bx1_portal.fund_contract_release_receipts where id=r.conformance_receipt_id));\n  -- Missing/JSON-null observations must fail before casts or nullable SQL time\n  -- comparisons. They cannot be upgraded to a governance/network receipt.\n  if jsonb_typeof(candidate->'observed') is distinct from 'object'\n    or jsonb_typeof(candidate#>'{observed,block}') is distinct from 'object'\n    or jsonb_typeof(candidate#>'{observed,providers}') is distinct from 'array'\n    or jsonb_typeof(candidate#>'{observed,block,number}') is distinct from 'string'\n    or coalesce(candidate#>>'{observed,block,number}','') !~ '^(0|[1-9][0-9]{0,12})$'\n    or jsonb_typeof(candidate#>'{observed,block,hash}') is distinct from 'string'\n    or coalesce(candidate#>>'{observed,block,hash}','') !~ '^0x[0-9a-f]{64}$'\n    or candidate#>>'{observed,block,hash}'='0x'||repeat('0',64)\n    or jsonb_typeof(candidate#>'{observed,block,timestamp}') is distinct from 'string'\n    or coalesce(candidate#>>'{observed,block,timestamp}','')='' then\n    raise exception 'fund_admission_complete_observation_required' using errcode='23514';end if;\n  perform bx1_portal.require_keys(candidate#>'{observed,block}',array['number','hash','timestamp']);\n  if not pg_catalog.isfinite((candidate#>>'{observed,block,timestamp}')::timestamptz) then\n    raise exception 'fund_admission_finite_observation_required' using errcode='23514';end if;\n  for provider in select value from jsonb_array_elements(candidate#>'{observed,providers}') loop\n    if jsonb_typeof(provider) is distinct from 'object'\n      or jsonb_typeof(provider->'url') is distinct from 'string'\n      or jsonb_typeof(provider->'finalized_block_number') is distinct from 'string'\n      or coalesce(provider->>'finalized_block_number','') !~ '^(0|[1-9][0-9]{0,12})$'\n      or jsonb_typeof(provider->'finalized_block_hash') is distinct from 'string'\n      or coalesce(provider->>'finalized_block_hash','') !~ '^0x[0-9a-f]{64}$'\n      or provider->>'finalized_block_hash'='0x'||repeat('0',64) then\n      raise exception 'fund_admission_complete_provider_observation_required' using errcode='23514';end if;\n    perform bx1_portal.require_keys(provider,array['url','finalized_block_number','finalized_block_hash']);\n    if (provider->>'finalized_block_number')::numeric<(candidate#>>'{observed,block,number}')::numeric then\n      raise exception 'fund_admission_observation_not_finalized' using errcode='23514';end if;\n  end loop;\n  if jsonb_typeof(candidate) is distinct from 'object' or candidate->>'status' is distinct from 'NOT_ADMITTED'\n    or candidate->>'environment' is distinct from 'TESTNET' or candidate->>'chain_id' is distinct from '80002'\n    or candidate->>'setup_id' is distinct from s.id::text or candidate->>'setup_revision' is distinct from s.revision::text\n    or candidate->>'product_id' is distinct from s.product_id::text or candidate->>'offering_revision_id' is distinct from s.offering_revision_id::text\n    or candidate->>'terms_hash' is distinct from s.terms_hash or candidate->>'configuration_hash' is distinct from s.configuration_hash\n    or candidate->>'product_binding_hash' is distinct from r.input->>'product_binding_hash'\n    or candidate->>'source_pin' is distinct from s.source_pin or candidate->>'catalog_hash' is distinct from s.catalog_hash\n    or candidate->'proof_refs' is distinct from proof_refs or candidate->'roleplay_policy' is distinct from s.roleplay_policy\n    or candidate->'independent_audit_proven' is distinct from 'false'::jsonb or candidate->'standard_claim_expiry_enforced' is distinct from 'false'::jsonb\n    or candidate->>'authority_epoch' is distinct from p.authority_epoch::text or admitted_manifest_hash !~ '^[0-9a-f]{64}$'\n    or manifest->>'id' is distinct from r.manifest_id::text or manifest#>'{safe,owners}' is distinct from s.safe_owners\n    or manifest#>>'{safe,address}' is distinct from s.safe_address or manifest#>>'{safe,threshold}' is distinct from s.safe_threshold::text\n    or ((candidate#>>'{observed,providers,0,url}' is distinct from 'https://polygon-amoy.drpc.org'\n      or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy-bor-rpc.publicnode.com'\n        and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))\n      and (candidate#>>'{observed,providers,0,url}' is distinct from 'https://80002.rpc.thirdweb.com'\n        or candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))\n    or jsonb_array_length(candidate#>'{observed,providers}')<>2\n    or expiry<=clock_timestamp() or (candidate#>>'{observed,block,timestamp}')::timestamptz>clock_timestamp()+interval '30 seconds'\n    or (candidate#>>'{observed,block,timestamp}')::timestamptz<clock_timestamp()-interval '20 minutes' then\n    raise exception 'fund_admission_exact_evidence_required' using errcode='23514';end if;\n  if manifest#>>'{token_details,name}' is distinct from r.input->>'token_name' or manifest#>>'{token_details,symbol}' is distinct from r.input->>'token_symbol'\n    or manifest#>>'{token_details,decimals}' is distinct from r.input->>'security_unit_decimals'\n    or manifest->'token_details'->'claim_topics' is distinct from r.input->'claim_topics'\n    or candidate->>'class_id' is distinct from r.input->>'class_id' or candidate->>'class_name' is distinct from r.input->>'class_name'\n    or manifest->>'product_binding_hash' is distinct from r.input->>'product_binding_hash'\n    or candidate#>>'{deployment_expectation,deployment,salt}' is distinct from r.input->>'deployment_salt'\n    or candidate#>'{deployment_expectation,manifest}' is distinct from manifest or candidate#>'{issuance_expectation,manifest}' is distinct from manifest then\n    raise exception 'fund_admission_current_terms_required' using errcode='23514';end if;\n  perform bx1_private.fund_roleplay_enter(r.operating_context,r.product_id,'admit_fund_release',r.request_key);\n  foreach receipt_kind in array array['CONFORMANCE','GOVERNANCE','OBSERVATION_POLICY','ROLE_STATE'] loop\n    receipt_id:=(proof_refs->>case receipt_kind when 'CONFORMANCE' then 'conformance_receipt_id' when 'GOVERNANCE' then 'governance_receipt_id'\n      when 'OBSERVATION_POLICY' then 'observation_policy_receipt_id' else 'role_state_receipt_id' end)::uuid;\n    evidence:=jsonb_build_object('kind',receipt_kind,'setup_id',s.id,'setup_revision',s.revision,'product_id',r.product_id,'offering_revision_id',r.offering_revision_id,\n      'terms_hash',s.terms_hash,'configuration_hash',s.configuration_hash,'catalog_hash',s.catalog_hash,'source_pin',s.source_pin,\n      'roleplay_policy_id',p.id,'authority_epoch',p.authority_epoch,'independence_proven',false,'audit_proven',false,'expiry_enforced_on_chain',false,\n      'conformance_receipt_id',r.conformance_receipt_id,'observed',candidate->'observed','safe',manifest->'safe','candidate_hash',bx1_portal.fund_digest(candidate));\n    insert into bx1_portal.fund_admission_receipts(id,request_id,kind,evidence,evidence_hash) values(receipt_id,r.id,receipt_kind,evidence,bx1_portal.fund_digest(evidence));\n  end loop;\n  manifest:=manifest||jsonb_build_object('status','ADMITTED','hash',admitted_manifest_hash);\n  insert into bx1_portal.fund_release_manifests(id,product_id,offering_revision_id,native_organisation_id,environment,chain_id,release_version,source_commit,\n    manifest_hash,configuration_hash,product_binding_hash,terms_hash,authority_epoch,expected_token_address,controller_address,execution_account,required_confirmations,\n    security_unit_decimals,class_id,class_name,deployment_expectation,issuance_expectation,status,conformance_receipt_id,governance_receipt_id,observation_policy_receipt_id,admitted_by,admitted_until)\n    values(r.manifest_id,r.product_id,r.offering_revision_id,p.native_organisation_id,'TESTNET',80002,'ERC3643_4.1.3',s.source_pin,admitted_manifest_hash,\n      s.configuration_hash,r.input->>'product_binding_hash',s.terms_hash,p.authority_epoch,manifest#>>'{suite,token,address}',manifest#>>'{controller,address}',s.safe_address,\n      (r.input->>'required_confirmations')::integer,(r.input->>'security_unit_decimals')::integer,(r.input->>'class_id')::uuid,r.input->>'class_name',\n      jsonb_set(candidate->'deployment_expectation','{manifest}',manifest),jsonb_set(candidate->'issuance_expectation','{manifest}',manifest),'ADMITTED',\n      (proof_refs->>'conformance_receipt_id')::uuid,(proof_refs->>'governance_receipt_id')::uuid,(proof_refs->>'observation_policy_receipt_id')::uuid,auth.uid(),expiry);\n  policy_hash:=bx1_portal.fund_digest(jsonb_build_object('manifest',r.manifest_id,'manifest_hash',admitted_manifest_hash,'roleplay_policy_id',p.id,\n    'epoch',p.authority_epoch,'owners',s.safe_owners,'threshold',s.safe_threshold,'role_state_receipt',proof_refs->>'role_state_receipt_id'));\n  insert into bx1_portal.fund_signer_policies(id,manifest_id,authority_policy_hash,authority_epoch,approval_threshold,safe_threshold,status,admission_receipt_id,admitted_until)\n    values(r.signer_policy_id,r.manifest_id,policy_hash,p.authority_epoch,s.safe_threshold,s.safe_threshold,'ADMITTED',(proof_refs->>'role_state_receipt_id')::uuid,expiry);\n  for capacity in select * from bx1_private.roleplay_capacities where policy_id=p.id and user_id=r.actor_id\n    and role in ('IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController') order by role loop\n    if capacity.role='TokenisationAgent' then\n      for slot in select * from bx1_private.roleplay_wallet_slots where policy_id=p.id and user_id=r.actor_id and role='TokenisationAgent' order by wallet_address loop\n        if not bx1_private.fund_roleplay_control_proof_current(p.id,p.authority_epoch,slot.slot,r.actor_id) then raise exception 'fund_admission_key_proof_changed' using errcode='42501';end if;\n        insert into bx1_portal.fund_authorities(signer_policy_id,user_id,native_membership_id,person_id,role,can_approve,can_sign,signer_address,authority_receipt_id,valid_from,valid_until,status)\n          values(r.signer_policy_id,r.actor_id,capacity.native_membership_id,p.actual_operator_person_id,capacity.role,true,true,slot.wallet_address,\n            (proof_refs->>'role_state_receipt_id')::uuid,clock_timestamp(),expiry,'ADMITTED');\n      end loop;\n    else\n      insert into bx1_portal.fund_authorities(signer_policy_id,user_id,native_membership_id,person_id,role,can_approve,can_sign,authority_receipt_id,valid_from,valid_until,status)\n        values(r.signer_policy_id,r.actor_id,capacity.native_membership_id,p.actual_operator_person_id,capacity.role,true,false,\n          (proof_refs->>'role_state_receipt_id')::uuid,clock_timestamp(),expiry,'ADMITTED');\n    end if;\n  end loop;\n  if not bx1_portal.fund_manifest_current(r.manifest_id) then raise exception 'fund_admission_manifest_not_current' using errcode='23514';end if;\n  update bx1_portal.fund_admission_requests set status='ADMITTED',result_hash=bx1_portal.fund_digest(candidate),admitted_at=clock_timestamp() where id=r.id;\n  perform bx1_portal.fund_audit(r.product_id,r.manifest_id,null,'RELEASE_ADMITTED',r.operating_context,1,1,(proof_refs->>'governance_receipt_id')::uuid,candidate);\n  perform bx1_private.fund_roleplay_finish(r.operating_context,r.product_id,'admit_fund_release',r.request_key);\n  perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);\n  perform set_config('request.jwt.claims',prior,true);\n  return jsonb_build_object('request_id',r.id,'status','ADMITTED','manifest_id',r.manifest_id,'signer_policy_id',r.signer_policy_id);\nend ",
    "cuts": [
      {
        "name": "ordered_admission",
        "from": "or candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))",
        "to": "or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'\n          and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.g.alchemy.com/v2')))",
        "count": 1
      }
    ],
    "final_sha": "14a917d8a77ebe165c613ed3dd632805471b6dde8b2037b1342aeb0dda3ff176"
  },
  {
    "oid": 36708,
    "signature": "bx1_portal.fund_recipient_result_shape(jsonb)",
    "sha": "6e6fa46f5383f172df9a811b7020c04effc51e7015398a6da5ccada1d1400c3f",
    "metadata": {
      "oid": "36708",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_recipient_result_shape",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "result"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare field text;provider jsonb;urls text[]:='{}';\nbegin\n if pg_catalog.jsonb_typeof(result) is distinct from 'object' or result->'version' is distinct from '1'::jsonb or result->'chain_id' is distinct from '80002'::jsonb\n  or result->'expiry_enforced_on_chain' is distinct from 'false'::jsonb or pg_catalog.jsonb_typeof(result->'operation_revision') is distinct from 'number'\n  or (result->>'operation_revision' ~ '^[1-9][0-9]{0,8}$') is not true\n  or result->>'phase' is null or result->>'phase' not in ('CREATE_IDENTITY','ADD_CLAIM','REGISTER_IDENTITY','REVOKE_CLAIM')\n  or result->>'status' is null or result->>'status' not in ('UNKNOWN','PENDING','FAILED','FINAL') then return false;end if;\n foreach field in array array['transaction_hash','claim_data_hash','claim_id'] loop\n  if pg_catalog.jsonb_typeof(result->field) is distinct from 'string' or (result->>field ~ '^0x[0-9a-f]{64}$') is not true or result->>field='0x'||pg_catalog.repeat('0',64) then return false;end if;\n end loop;\n if pg_catalog.jsonb_typeof(result->'operation_id') is distinct from 'string' or (result->>'operation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true\n  or pg_catalog.jsonb_typeof(result->'expectation_hash') is distinct from 'string' or (result->>'expectation_hash' ~ '^[0-9a-f]{64}$') is not true\n  or pg_catalog.jsonb_typeof(result->'identity_address') is distinct from 'string' or (result->>'identity_address' ~ '^0x[0-9a-f]{40}$') is not true\n  or result->>'identity_address'='0x'||pg_catalog.repeat('0',40)\n  or pg_catalog.jsonb_typeof(result->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'providers')<>2 then return false;end if;\n for provider in select value from pg_catalog.jsonb_array_elements(result->'providers') loop\n  if pg_catalog.jsonb_typeof(provider->'url') is distinct from 'string' or provider->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com')\n   or pg_catalog.jsonb_typeof(provider->'finalized_block_number') is distinct from 'string' or (provider->>'finalized_block_number' ~ '^[1-9][0-9]{0,77}$') is not true\n   or pg_catalog.jsonb_typeof(provider->'finalized_block_hash') is distinct from 'string' or (provider->>'finalized_block_hash' ~ '^0x[0-9a-f]{64}$') is not true\n   or provider->>'finalized_block_hash'='0x'||pg_catalog.repeat('0',64) then return false;end if;\n  urls:=pg_catalog.array_append(urls,provider->>'url');\n end loop;\n if urls[1]=urls[2] or (urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com']::text[]\n    or urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) is not true then return false;end if;\n if result->>'status' in ('FINAL','FAILED') then\n  if pg_catalog.jsonb_typeof(result->'block_number') is distinct from 'string' or (result->>'block_number' ~ '^[1-9][0-9]{0,77}$') is not true\n   or pg_catalog.jsonb_typeof(result->'block_hash') is distinct from 'string' or (result->>'block_hash' ~ '^0x[0-9a-f]{64}$') is not true or result->>'block_hash'='0x'||pg_catalog.repeat('0',64)\n   or pg_catalog.jsonb_typeof(result->'block_timestamp') is distinct from 'string' or not pg_catalog.isfinite((result->>'block_timestamp')::timestamptz)\n   or pg_catalog.jsonb_typeof(result->'transaction_index') is distinct from 'number' or (result->>'transaction_index' ~ '^(0|[1-9][0-9]{0,9})$') is not true\n   or (result->>'transaction_index')::numeric>2147483647 or pg_catalog.jsonb_typeof(result->'inner_execution_success') is distinct from 'boolean'\n   or pg_catalog.jsonb_typeof(result->'registry_verified') is distinct from 'boolean' then return false;end if;\n end if;\n return true;exception when others then return false;\nend ",
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "84cefa54ec6e792231b08f22362dedbf7fdf732444d938e3a6536b81da85b295"
  },
  {
    "oid": 36709,
    "signature": "bx1_portal.record_fund_recipient_observation(jsonb,jsonb)",
    "sha": "93bdb1489699bf4dd5b554fb85fe55c2b6fd697955832a328a8844578f531a99",
    "metadata": {
      "oid": "36709",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_recipient_observation",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "request",
        "result"
      ],
      "proargtypes": [
        "3802",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare prior text;expected jsonb;o bx1_portal.fund_recipient_operations;r bx1_portal.fund_recipient_cases;obs uuid;answer jsonb;item jsonb;urls text[]:='{}';next_state text;\nbegin\n prior:=bx1_portal.fund_recipient_worker_enter((request->>'operation_id')::uuid,(request->>'actor_id')::uuid,request->'operating_context');\n expected:=bx1_portal.read_fund_recipient_observation((request->>'operation_id')::uuid,(request->>'expected_revision')::integer,(request->>'actor_id')::uuid,request->'operating_context');\n select * into strict o from bx1_portal.fund_recipient_operations where id=(request->>'operation_id')::uuid for update;select * into strict r from bx1_portal.fund_recipient_cases where id=o.case_id;\n if expected is distinct from request or bx1_portal.fund_recipient_result_shape(result) is not true or pg_catalog.octet_length(result::text)>65536\n  or result->'version' is distinct from '1'::jsonb or result->'chain_id' is distinct from '80002'::jsonb\n  or result->>'operation_id' is distinct from o.id::text or result->>'operation_revision' is distinct from o.expectation->>'revision'\n  or result->>'phase' is distinct from o.phase or result->>'expectation_hash' is distinct from o.intent->>'expectation_hash'\n  or result->>'transaction_hash' is distinct from o.transaction_hash or result->>'identity_address' is distinct from o.intent->>'expected_identity_address'\n  or result->>'claim_data_hash' is distinct from o.intent->>'claim_data_hash' or result->>'claim_id' is distinct from o.intent->>'claim_id'\n  or result->'expiry_enforced_on_chain' is distinct from 'false'::jsonb or result->>'status' is null or result->>'status' not in ('UNKNOWN','PENDING','FAILED','FINAL')\n  or pg_catalog.jsonb_typeof(result->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'providers')<>2 then raise exception 'fund_recipient_observation_binding_invalid' using errcode='23514';end if;\n for item in select value from pg_catalog.jsonb_array_elements(result->'providers') loop\n  if pg_catalog.jsonb_typeof(item->'url') is distinct from 'string' or item->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com')\n   or pg_catalog.jsonb_typeof(item->'finalized_block_hash') is distinct from 'string' or (item->>'finalized_block_hash' ~ '^0x[0-9a-f]{64}$') is not true\n   or pg_catalog.jsonb_typeof(item->'finalized_block_number') is distinct from 'string' or (item->>'finalized_block_number' ~ '^[1-9][0-9]{0,77}$') is not true then raise exception 'fund_recipient_independent_provider_required' using errcode='23514';end if;\n  urls:=pg_catalog.array_append(urls,item->>'url');\n end loop;\n if urls[1]=urls[2] or (urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com']::text[]\n    or urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) is not true then raise exception 'fund_recipient_duplicate_provider_denied';end if;\n if result->>'status' in ('FINAL','FAILED') and (pg_catalog.jsonb_typeof(result->'block_number') is distinct from 'string'\n  or (result->>'block_number' ~ '^[1-9][0-9]{0,77}$') is not true or pg_catalog.jsonb_typeof(result->'block_hash') is distinct from 'string'\n  or (result->>'block_hash' ~ '^0x[0-9a-f]{64}$') is not true or pg_catalog.jsonb_typeof(result->'block_timestamp') is distinct from 'string'\n  or not pg_catalog.isfinite((result->>'block_timestamp')::timestamptz)) then raise exception 'fund_recipient_final_canonical_block_required';end if;\n if result->>'status'='FINAL' and (result->'inner_execution_success' is distinct from 'true'::jsonb\n  or (result->>'block_timestamp')::timestamptz>o.expires_at or (o.phase<>'REVOKE_CLAIM' and (result->>'block_timestamp')::timestamptz>r.claim_valid_until)\n  or (o.phase='REGISTER_IDENTITY' and result->'registry_verified' is distinct from 'true'::jsonb)\n  or (o.phase='REVOKE_CLAIM' and result->'registry_verified' is distinct from 'false'::jsonb)) then raise exception 'fund_recipient_final_effect_required';end if;\n select id into obs from bx1_portal.fund_recipient_observations where operation_id=o.id and result_hash=bx1_portal.fund_digest(result);\n if obs is not null then answer:=bx1_portal.fund_recipient_projection(r.id,o.operating_context);perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;end if;\n if o.state in ('FINAL','FAILED') then raise exception 'fund_recipient_terminal_observation_changed_recovery_required' using errcode='23514';end if;\n insert into bx1_portal.fund_recipient_observations(operation_id,result,result_hash) values(o.id,result,bx1_portal.fund_digest(result)) returning id into obs;\n next_state:=result->>'status';update bx1_portal.fund_recipient_operations set state=next_state,observation_id=obs,revision=revision+1 where id=o.id;\n if next_state='FINAL' then\n  update bx1_portal.fund_recipient_cases set state=case o.phase when 'CREATE_IDENTITY' then 'CLAIM_SIGNATURE_REQUIRED' when 'ADD_CLAIM' then 'REGISTRATION_REQUIRED' when 'REGISTER_IDENTITY' then 'READY' else 'REVOKED' end,\n   identity_address=case when o.phase='CREATE_IDENTITY' then result->>'identity_address' else identity_address end,\n   registration_observation_id=case when o.phase='REGISTER_IDENTITY' then obs else registration_observation_id end,revision=revision+1 where id=r.id;\n end if;\n perform bx1_portal.fund_recipient_audit(r.id,o.id,'FUND_RECIPIENT_CHAIN_OBSERVED',o.operating_context,pg_catalog.jsonb_build_object('observation_id',obs,'status',next_state));\n if bx1_portal.fund_recipient_current(r.id,o.operating_context,o.phase) is not true then raise exception 'fund_recipient_observation_authority_changed_at_commit' using errcode='42501';end if;\n answer:=bx1_portal.fund_recipient_projection(r.id,o.operating_context);perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;\nend ",
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "32de9e76002e8bff1baa821fd6e23a9fc0ee5f78dd9eac60da1c6cf1777ab69f"
  },
  {
    "oid": 38526,
    "signature": "bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)",
    "sha": "e3c353516b891c419d95f52b25cca4ed8368e313a6efa046af6a41147fb94f5a",
    "metadata": {
      "oid": "38526",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_setup_retry",
      "prorows": 0,
      "pronargs": 4,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "preparation",
        "action",
        "request_key",
        "details"
      ],
      "proargtypes": [
        "3802",
        "25",
        "2950",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare prior_claims text:=coalesce(pg_catalog.current_setting('request.jwt.claims',true),'');\n  s bx1_portal.fund_setups;t bx1_portal.fund_setup_steps;l bx1_private.fund_setup_retry_leases;\n  prior bx1_portal.fund_setup_requests;actor uuid;c jsonb;current_read jsonb;identity jsonb;proof jsonb;provider jsonb;\n  public_lease jsonb;answer jsonb;checked_at timestamptz;now_at timestamptz;before_rev integer;retry_count integer;\n  last_grant timestamptz;lease_id uuid;candidate text;winner jsonb;is_mismatch boolean;provider_index integer;\n  mutable_fields text[]:=array['expected_revision','expected_step_revision','original_state','original_transaction_hash',\n    'anchor','retry_count','next_retry_at','active_lease','leases'];\nbegin\n  if action is null or action not in ('CLAIM','HASH','OUTCOME','HOLD') or request_key is null\n    or request_key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(preparation) is distinct from 'object' or pg_catalog.jsonb_typeof(details) is distinct from 'object'\n    or pg_catalog.octet_length(preparation::text)>524288 or pg_catalog.octet_length(details::text)>524288 then\n    raise exception 'fund_setup_retry_invalid_request' using errcode='22023';end if;\n  actor:=(preparation->>'actor_id')::uuid;c:=preparation->'operating_context';\n  prior_claims:=bx1_portal.fund_setup_worker_enter((preparation->>'setup_id')::uuid,actor,c,true);\n  select f.* into strict s from bx1_portal.fund_setups f where f.id=(preparation->>'setup_id')::uuid for update;\n  select step.* into strict t from bx1_portal.fund_setup_steps step where step.id=(preparation->>'step_id')::uuid and step.setup_id=s.id for update;\n  current_read:=bx1_portal.read_fund_setup_retry(s.id,t.id,s.revision,actor,c);\n  if preparation-mutable_fields is distinct from current_read-mutable_fields then\n    raise exception 'fund_setup_retry_immutable_read_changed' using errcode='23514';end if;\n  if action='CLAIM' and bx1_portal.fund_setup_package_approved(s.product_id) is not true then\n    raise exception 'fund_setup_retry_current_package_required' using errcode='42501';end if;\n  if action='CLAIM' then\n    perform bx1_portal.require_keys(details,array['proof']);\n    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,\n      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,\n      'expected_revision',preparation->'expected_revision','expected_step_revision',preparation->'expected_step_revision');\n    proof:=details->'proof';\n  elsif action='HASH' then\n    perform bx1_portal.require_keys(details,array['lease_id','transaction_hash','discovery_proof']);\n    if pg_catalog.jsonb_typeof(details->'transaction_hash') is distinct from 'string'\n      or details->>'transaction_hash' !~ '^0x[0-9a-f]{64}$' or details->>'transaction_hash' ~ '^0x0{64}$' then\n      raise exception 'fund_setup_retry_hash_invalid' using errcode='23514';end if;\n    lease_id:=(details->>'lease_id')::uuid;candidate:=details->>'transaction_hash';proof:=nullif(details->'discovery_proof','null'::jsonb);\n    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,\n      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,'lease_id',lease_id,'transaction_hash',candidate);\n  elsif action='OUTCOME' then\n    perform bx1_portal.require_keys(details,array['lease_id','outcome']);lease_id:=(details->>'lease_id')::uuid;\n    if lease_id is null or pg_catalog.jsonb_typeof(details->'outcome') is distinct from 'string'\n      or details->>'outcome' not in ('REJECTED','PENDING_PROMPT','UNKNOWN') then\n      raise exception 'fund_setup_retry_outcome_invalid' using errcode='23514';end if;\n    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,\n      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,'lease_id',lease_id,'outcome',details->>'outcome');\n  else\n    perform bx1_portal.require_keys(details,array['proof']);proof:=details->'proof';\n    identity:=pg_catalog.jsonb_build_object('action',action,'setup_id',s.id,'step_id',t.id,'actor_id',actor,'operating_context',c,\n      'intent_hash',t.intent_hash,'sender',t.sender,'nonce',t.nonce::text,'proof',proof-'checked_at');\n  end if;\n  -- Replay precedes CAS/fresh-provider checks, but follows current real authority\n  -- and immutable-operation checks. It never renews a lease or repeats a write.\n  select r.* into prior from bx1_portal.fund_setup_requests r where r.actor_id=actor and r.request_key=record_fund_setup_retry.request_key;\n  if prior.actor_id is not null then\n    if prior.setup_id is distinct from s.id or prior.command is distinct from 'RETRY_'||action\n      or prior.operating_context is distinct from c or prior.payload->'retry_identity' is distinct from identity then\n      raise exception 'fund_setup_retry_idempotency_conflict' using errcode='23505';end if;\n    if action='CLAIM' then select lease.* into strict l from bx1_private.fund_setup_retry_leases lease\n      where lease.actor_id=actor and lease.request_key=record_fund_setup_retry.request_key and lease.step_id=t.id;\n    elsif lease_id is not null then select lease.* into strict l from bx1_private.fund_setup_retry_leases lease where lease.id=lease_id\n      and lease.actor_id=actor and lease.setup_id=s.id and lease.step_id=t.id and lease.operating_context=c and lease.intent_hash=t.intent_hash;end if;\n    public_lease:=case when l.id is null then null else (pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text) end;\n    answer:=pg_catalog.jsonb_build_object('lease',public_lease,'snapshot',bx1_portal.fund_setup_projection(s.product_id,c));\n    perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;\n  end if;\n  if lease_id is not null then\n    select lease.* into l from bx1_private.fund_setup_retry_leases lease where lease.id=lease_id and lease.setup_id=s.id and lease.step_id=t.id\n      and lease.actor_id=actor and lease.operating_context=c and lease.intent_hash=t.intent_hash and lease.sender=t.sender and lease.nonce=t.nonce;\n    if l.id is null then raise exception 'fund_setup_retry_lease_denied' using errcode='42501';end if;\n    public_lease:=(pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text);\n  end if;\n  -- Only grants and authoritative discovery/hold require a fresh server proof.\n  if action in ('CLAIM','HOLD') or (action='HASH' and lease_id is null) then\n    perform bx1_portal.require_keys(proof,array['version','chain_id','checked_at','status','reason_code','sender','nonce','intent_hash',\n      'anchor','providers','finalized_nonce','transaction_hash','retry_checks','winner']);\n    if proof->'version' is distinct from '1'::jsonb or proof->'chain_id' is distinct from '80002'::jsonb\n      or proof->>'sender' is distinct from t.sender or proof->>'nonce' is distinct from t.nonce::text\n      or proof->>'intent_hash' is distinct from t.intent_hash or pg_catalog.jsonb_typeof(proof->'checked_at') is distinct from 'string'\n      or pg_catalog.jsonb_typeof(proof->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(proof->'providers')<>2 then\n      raise exception 'fund_setup_retry_proof_binding_invalid' using errcode='23514';end if;\n    begin checked_at:=(proof->>'checked_at')::timestamptz;\n    exception when others then raise exception 'fund_setup_retry_proof_time_invalid' using errcode='23514';end;\n    now_at:=pg_catalog.clock_timestamp();\n    if checked_at>now_at or checked_at<now_at-interval '30 seconds' then raise exception 'fund_setup_retry_proof_stale' using errcode='23514';end if;\n    perform bx1_portal.require_keys(proof->'anchor',array['block_number','block_hash']);\n    if pg_catalog.jsonb_typeof(proof#>'{anchor,block_number}') is distinct from 'string'\n      or proof#>>'{anchor,block_number}' !~ '^(0|[1-9][0-9]{0,77})$'\n      or pg_catalog.jsonb_typeof(proof#>'{anchor,block_hash}') is distinct from 'string'\n      or proof#>>'{anchor,block_hash}' !~ '^0x[0-9a-f]{64}$' or proof#>>'{anchor,block_hash}' ~ '^0x0{64}$' then\n      raise exception 'fund_setup_retry_anchor_invalid' using errcode='23514';end if;\n    provider_index:=0;\n    for provider in select value from pg_catalog.jsonb_array_elements(proof->'providers') loop\n      perform bx1_portal.require_keys(provider,array['url','finalized_block_number','finalized_block_hash','latest_nonce','pending_nonce']);\n      if provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]\n        or pg_catalog.jsonb_typeof(provider->'finalized_block_number') is distinct from 'string'\n        or provider->>'finalized_block_number' !~ '^(0|[1-9][0-9]{0,77})$'\n        or pg_catalog.jsonb_typeof(provider->'finalized_block_hash') is distinct from 'string'\n        or provider->>'finalized_block_hash' !~ '^0x[0-9a-f]{64}$' or provider->>'finalized_block_hash' ~ '^0x0{64}$'\n        or pg_catalog.jsonb_typeof(provider->'latest_nonce') is distinct from 'string' or provider->>'latest_nonce' !~ '^(0|[1-9][0-9]{0,77})$'\n        or pg_catalog.jsonb_typeof(provider->'pending_nonce') is distinct from 'string' or provider->>'pending_nonce' !~ '^(0|[1-9][0-9]{0,77})$'\n        or (provider->>'finalized_block_number')::numeric<(proof#>>'{anchor,block_number}')::numeric\n        or ((provider->>'finalized_block_number')::numeric=(proof#>>'{anchor,block_number}')::numeric\n          and provider->>'finalized_block_hash' is distinct from proof#>>'{anchor,block_hash}') then\n        raise exception 'fund_setup_retry_provider_invalid' using errcode='23514';end if;\n      provider_index:=provider_index+1;\n    end loop;\n    -- Latest/pending nonce alone is not finalized evidence of consumption.\n    -- Bind the agreed nonce to the common (minimum) finalized provider head.\n    perform bx1_portal.require_keys(proof->'finalized_nonce',array['block_number','block_hash','nonce']);\n    if pg_catalog.jsonb_typeof(proof#>'{finalized_nonce,block_number}') is distinct from 'string'\n      or proof#>>'{finalized_nonce,block_number}' !~ '^(0|[1-9][0-9]{0,77})$'\n      or pg_catalog.jsonb_typeof(proof#>'{finalized_nonce,block_hash}') is distinct from 'string'\n      or proof#>>'{finalized_nonce,block_hash}' !~ '^0x[0-9a-f]{64}$' or proof#>>'{finalized_nonce,block_hash}' ~ '^0x0{64}$'\n      or pg_catalog.jsonb_typeof(proof#>'{finalized_nonce,nonce}') is distinct from 'string'\n      or proof#>>'{finalized_nonce,nonce}' !~ '^(0|[1-9][0-9]{0,77})$'\n      or (proof#>>'{finalized_nonce,block_number}')::numeric is distinct from\n        least((proof#>>'{providers,0,finalized_block_number}')::numeric,(proof#>>'{providers,1,finalized_block_number}')::numeric)\n      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p\n        where (p->>'finalized_block_number')::numeric=(proof#>>'{finalized_nonce,block_number}')::numeric\n          and p->>'finalized_block_hash' is distinct from proof#>>'{finalized_nonce,block_hash}')\n      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p\n        where (p->>'latest_nonce')::numeric<(proof#>>'{finalized_nonce,nonce}')::numeric\n          or (p->>'pending_nonce')::numeric<(p->>'latest_nonce')::numeric) then\n      raise exception 'fund_setup_retry_finalized_nonce_invalid' using errcode='23514';end if;\n  elsif action='HASH' and proof is not null then\n    raise exception 'fund_setup_retry_lease_hash_has_discovery_proof' using errcode='23514';\n  end if;\n  before_rev:=s.revision;\n  if action='CLAIM' then\n    perform bx1_portal.funding_require_revision(s.revision,preparation->'expected_revision');\n    perform bx1_portal.funding_require_revision(t.revision,preparation->'expected_step_revision');\n    if t.state is distinct from 'UNKNOWN' or t.transaction_hash is not null or proof->>'status' is distinct from 'RETRY_AVAILABLE'\n      or proof->'transaction_hash' is distinct from 'null'::jsonb or proof->'winner' is distinct from 'null'::jsonb\n      or proof->'reason_code' is distinct from 'null'::jsonb then raise exception 'fund_setup_retry_grant_not_available' using errcode='23514';end if;\n    perform bx1_portal.require_keys(proof->'retry_checks',array['runtime_hash','owner','before_version','simulation_succeeded']);\n    if proof#>>'{retry_checks,runtime_hash}' is distinct from t.intent->>'expected_runtime_hash'\n      or proof#>>'{retry_checks,owner}' is distinct from t.sender\n      or proof#>'{retry_checks,simulation_succeeded}' is distinct from 'true'::jsonb\n      or pg_catalog.jsonb_typeof(proof#>'{retry_checks,before_version}') is distinct from 'string'\n      or char_length(proof#>>'{retry_checks,before_version}') not between 1 and 32\n      or proof#>>'{retry_checks,before_version}'='4.1.3'\n      or proof#>>'{finalized_nonce,nonce}' is distinct from t.nonce::text\n      or proof#>'{finalized_nonce,block_number}' is distinct from proof#>'{anchor,block_number}'\n      or proof#>'{finalized_nonce,block_hash}' is distinct from proof#>'{anchor,block_hash}'\n      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p\n        where p->>'latest_nonce' is distinct from t.nonce::text or p->>'pending_nonce' is distinct from t.nonce::text) then\n      raise exception 'fund_setup_retry_pre_effect_invalid' using errcode='23514';end if;\n    select count(*)::integer,max(lease.created_at) into retry_count,last_grant from bx1_private.fund_setup_retry_leases lease where lease.step_id=t.id;\n    if retry_count>=3 or last_grant>pg_catalog.clock_timestamp()-interval '30 seconds'\n      or exists(select 1 from bx1_private.fund_setup_retry_leases lease where lease.step_id=t.id and lease.expires_at>pg_catalog.clock_timestamp()) then\n      raise exception 'fund_setup_retry_limit_or_active_lease' using errcode='23514';end if;\n    now_at:=pg_catalog.clock_timestamp();\n    insert into bx1_private.fund_setup_retry_leases(setup_id,step_id,actor_id,operating_context,intent_hash,sender,nonce,request_key,\n      created_at,expires_at,expected_revision,expected_step_revision,proof,proof_hash)\n      values(s.id,t.id,actor,c,t.intent_hash,t.sender,t.nonce,record_fund_setup_retry.request_key,now_at,now_at+interval '120 seconds',\n        s.revision,t.revision,proof,bx1_portal.fund_digest(proof)) returning * into l;\n    update bx1_portal.fund_setup_steps step set revision=step.revision+1 where step.id=t.id;\n    update bx1_portal.fund_setups f set revision=f.revision+1 where f.id=s.id returning * into s;\n    public_lease:=(pg_catalog.to_jsonb(l)-array['proof','proof_hash'])||pg_catalog.jsonb_build_object('nonce',l.nonce::text);\n  elsif action='HASH' then\n    if lease_id is null then\n      winner:=proof->'winner';\n      perform bx1_portal.require_keys(winner,array['block_number','block_hash','transaction_hash','from','to','value','data','nonce','chain_id']);\n      if proof->>'status' is distinct from 'WINNER' or proof->>'transaction_hash' is distinct from candidate\n        or winner->>'transaction_hash' is distinct from candidate or winner->>'from' is distinct from t.sender\n        or winner->>'to' is distinct from t.intent->>'to' or winner->>'value' is distinct from '0'\n        or winner->>'data' is distinct from t.intent->>'data' or winner->>'nonce' is distinct from t.nonce::text\n        or winner->'chain_id' is distinct from '80002'::jsonb or pg_catalog.jsonb_typeof(winner->'block_number') is distinct from 'string'\n        or winner->>'block_number' !~ '^(0|[1-9][0-9]{0,77})$'\n        or pg_catalog.jsonb_typeof(winner->'block_hash') is distinct from 'string'\n        or winner->>'block_hash' !~ '^0x[0-9a-f]{64}$' or winner->>'block_hash' ~ '^0x0{64}$'\n        or (proof#>>'{finalized_nonce,nonce}')::numeric<=t.nonce\n        or (proof#>>'{finalized_nonce,block_number}')::numeric<(winner->>'block_number')::numeric\n        or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p\n          where (p->>'finalized_block_number')::numeric<(winner->>'block_number')::numeric) then\n        raise exception 'fund_setup_retry_discovery_invalid' using errcode='23514';end if;\n    end if;\n    insert into bx1_portal.fund_setup_transaction_attempts(setup_id,step_id,actor_id,operating_context,request_key,candidate_hash,prior_candidate_hash,intent_hash)\n      values(s.id,t.id,actor,c,record_fund_setup_retry.request_key,candidate,t.transaction_hash,t.intent_hash);\n    -- A delayed wallet response is candidate history, not authority to replace\n    -- an already tracked candidate or regress PENDING. Only an untracked\n    -- original, or canonical server discovery, may select a non-FINAL hash.\n    if t.state<>'FINAL' and (lease_id is null or (t.state='UNKNOWN' and t.transaction_hash is null)) then\n      update bx1_portal.fund_setup_steps step set state='BROADCAST',transaction_hash=candidate,revision=step.revision+1 where step.id=t.id;\n      update bx1_portal.fund_setups f set revision=f.revision+1 where f.id=s.id returning * into s;\n    end if;\n  elsif action='HOLD' then\n    winner:=nullif(proof->'winner','null'::jsonb);\n    if proof->>'status' is distinct from 'HOLD' or pg_catalog.jsonb_typeof(proof->'reason_code') is distinct from 'string'\n      or proof->>'reason_code' not in ('SETUP_RETRY_NONCE_WINNER_MISMATCH','SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION') then\n      raise exception 'fund_setup_retry_hold_invalid' using errcode='23514';end if;\n    if winner is not null then\n      perform bx1_portal.require_keys(winner,array['block_number','block_hash','transaction_hash','from','to','value','data','nonce','chain_id']);\n      is_mismatch:=winner->>'to' is distinct from t.intent->>'to' or winner->>'value' is distinct from '0'\n        or winner->>'data' is distinct from t.intent->>'data' or winner->'chain_id' is distinct from '80002'::jsonb;\n      if proof->>'reason_code' is distinct from 'SETUP_RETRY_NONCE_WINNER_MISMATCH'\n        or winner->>'from' is distinct from t.sender or winner->>'nonce' is distinct from t.nonce::text or not is_mismatch\n        or winner->>'transaction_hash' is distinct from proof->>'transaction_hash'\n        or pg_catalog.jsonb_typeof(winner->'transaction_hash') is distinct from 'string'\n        or winner->>'transaction_hash' !~ '^0x[0-9a-f]{64}$' or winner->>'transaction_hash' ~ '^0x0{64}$'\n        or pg_catalog.jsonb_typeof(winner->'block_number') is distinct from 'string'\n        or winner->>'block_number' !~ '^(0|[1-9][0-9]{0,77})$'\n        or pg_catalog.jsonb_typeof(winner->'block_hash') is distinct from 'string'\n        or winner->>'block_hash' !~ '^0x[0-9a-f]{64}$' or winner->>'block_hash' ~ '^0x0{64}$'\n        or (proof#>>'{finalized_nonce,nonce}')::numeric<=t.nonce\n        or (proof#>>'{finalized_nonce,block_number}')::numeric<(winner->>'block_number')::numeric\n        or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p\n          where (p->>'finalized_block_number')::numeric<(winner->>'block_number')::numeric) then\n        raise exception 'fund_setup_retry_hold_not_authoritative' using errcode='23514';end if;\n    elsif proof->>'reason_code' is distinct from 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION' or proof->'transaction_hash' is distinct from 'null'::jsonb\n      or (proof#>>'{finalized_nonce,nonce}')::numeric<=t.nonce\n      or (proof#>>'{finalized_nonce,block_number}')::numeric<(proof#>>'{anchor,block_number}')::numeric\n      or exists(select 1 from pg_catalog.jsonb_array_elements(proof->'providers') p\n        where (p->>'latest_nonce')::numeric<=t.nonce or (p->>'pending_nonce')::numeric<=t.nonce) then\n      raise exception 'fund_setup_retry_hold_no_winner_invalid' using errcode='23514';end if;\n    update bx1_portal.fund_setups f set recovery_hold=true,recovery_reason='FUND_SETUP_RETRY_'||(proof->>'reason_code'),revision=f.revision+1\n      where f.id=s.id returning * into s;\n  end if;\n  if bx1_portal.fund_setup_context(c,s.product_id,true) is not true or bx1_portal.fund_setup_wallet_current(actor,t.sender) is not true\n    or (action='CLAIM' and bx1_portal.fund_setup_package_approved(s.product_id) is not true) then\n    raise exception 'fund_setup_retry_authority_changed_after_wait' using errcode='42501';end if;\n  perform bx1_portal.fund_setup_audit(s.id,t.id,'FUND_SETUP_RETRY_'||action,before_rev,s.revision,\n    pg_catalog.jsonb_build_object('retry_identity',identity,'lease_id',coalesce(l.id,lease_id),'proof_hash',case when proof is null then null else bx1_portal.fund_digest(proof) end));\n  insert into bx1_portal.fund_setup_requests(actor_id,request_key,setup_id,command,payload,operating_context)\n    values(actor,record_fund_setup_retry.request_key,s.id,'RETRY_'||action,\n      pg_catalog.jsonb_build_object('retry_identity',identity,'server_proof',proof),c);\n  answer:=pg_catalog.jsonb_build_object('lease',public_lease,'snapshot',bx1_portal.fund_setup_projection(s.product_id,c));\n  perform pg_catalog.set_config('request.jwt.claims',prior_claims,true);return answer;\nend\n",
    "cuts": [
      {
        "name": "ordered_retry",
        "from": "provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]",
        "to": "(provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]\n        and provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'])[provider_index+1])",
        "count": 1
      }
    ],
    "final_sha": "f5c9e7853e9b3815dd4edabf678055d255c2ceb02dd45c9c0bfe63f7cc544612"
  },
  {
    "oid": 38760,
    "signature": "bx1_private.fund_alignment_snapshot_valid(jsonb)",
    "sha": "25c5320755fde3f8efd3fe914a6b3cc24b46366e99dc95e001253ba470f1dd5d",
    "metadata": {
      "oid": "38760",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_alignment_snapshot_valid",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "v"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "original": "\ndeclare p jsonb;urls text[]:='{}';\nbegin\n  perform bx1_portal.require_keys(v,array['block','providers']);perform bx1_portal.require_keys(v->'block',array['number','hash','timestamp']);\n  if pg_catalog.jsonb_typeof(v#>'{block,number}') is distinct from 'string' or v#>>'{block,number}' !~ '^(0|[1-9][0-9]{0,77})$'\n    or pg_catalog.jsonb_typeof(v#>'{block,hash}') is distinct from 'string' or v#>>'{block,hash}' !~ '^0x[0-9a-f]{64}$' or v#>>'{block,hash}' ~ '^0x0{64}$'\n    or pg_catalog.jsonb_typeof(v#>'{block,timestamp}') is distinct from 'string'\n    or pg_catalog.jsonb_typeof(v->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(v->'providers')<>2 then return false;end if;\n  perform (v#>>'{block,timestamp}')::timestamptz;\n  for p in select value from pg_catalog.jsonb_array_elements(v->'providers') loop\n    perform bx1_portal.require_keys(p,array['url','finalized_block_number','finalized_block_hash']);\n    if p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co') or p->>'url' is null\n      or pg_catalog.jsonb_typeof(p->'finalized_block_number') is distinct from 'string' or p->>'finalized_block_number' !~ '^(0|[1-9][0-9]{0,77})$'\n      or pg_catalog.jsonb_typeof(p->'finalized_block_hash') is distinct from 'string' or p->>'finalized_block_hash' !~ '^0x[0-9a-f]{64}$' or p->>'finalized_block_hash' ~ '^0x0{64}$'\n      or (p->>'finalized_block_number')::numeric<(v#>>'{block,number}')::numeric\n      or ((p->>'finalized_block_number')::numeric=(v#>>'{block,number}')::numeric and p->>'finalized_block_hash' is distinct from v#>>'{block,hash}') then return false;end if;\n    urls:=pg_catalog.array_append(urls,p->>'url');\n  end loop;\n  return urls[1] is distinct from urls[2];\nexception when others then return false;\nend ",
    "cuts": [
      {
        "name": "alignment_members",
        "from": "p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co')",
        "to": "p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co','https://polygon-amoy.g.alchemy.com/v2')",
        "count": 1
      },
      {
        "name": "alignment_pairs",
        "from": "return urls[1] is distinct from urls[2];",
        "to": "return urls[1] is distinct from urls[2] and (urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls = array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]) is true;",
        "count": 1
      }
    ],
    "final_sha": "7b314b7a47839d6f87b8798ad6629569308c3c37ddd33d243f45109f8cb47566"
  }
]$alchemy_pair_targets$::jsonb;
  target_spec jsonb;cut jsonb;metadata jsonb;original_body text;next_body text;inverse_body text;definition text;
  originals integer:=0;finals integer:=0;cut_count integer:=0;untouched_before jsonb;untouched_after jsonb;
  claims_before text:=pg_catalog.current_setting('request.jwt.claims',true);
  sub_before text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or (select environment from bx1_portal.entry_configuration where singleton) is distinct from 'TESTNET' then
    raise exception 'alchemy_pair_test_owner_without_claims_required' using errcode='42501';end if;
  if jsonb_array_length(targets)<>7 then raise exception 'alchemy_pair_scope_changed';end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]'::jsonb) into untouched_before
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_portal','bx1_private','public','auth')
      and not exists(select 1 from jsonb_array_elements(targets) s where p.oid=(s->>'oid')::oid);

  -- Preflight every source AND complete pg_proc row before any replacement.
  for target_spec in select value from jsonb_array_elements(targets) loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata is null or pg_catalog.to_regprocedure(target_spec->>'signature')::oid is distinct from (target_spec->>'oid')::oid
      or metadata-'prosrc' is distinct from target_spec->'metadata' then
      raise exception 'alchemy_pair_metadata_changed: %',target_spec->>'oid';end if;
    original_body:=target_spec->>'original';next_body:=original_body;
    if encode(sha256(convert_to(original_body,'UTF8')),'hex') is distinct from target_spec->>'sha' then
      raise exception 'alchemy_pair_original_pin_changed';end if;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') loop
      if cut->>'from'='' or cut->>'to'='' or (cut->>'count')::integer<>1
        or (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>1 then
        raise exception 'alchemy_pair_forward_cut_not_unique';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');cut_count:=cut_count+1;
    end loop;
    if encode(sha256(convert_to(next_body,'UTF8')),'hex') is distinct from target_spec->>'final_sha' then
      raise exception 'alchemy_pair_final_pin_changed';end if;
    inverse_body:=next_body;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') with ordinality item(value,position) order by position desc loop
      if (length(inverse_body)-length(replace(inverse_body,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'alchemy_pair_reverse_cut_not_unique';end if;
      inverse_body:=replace(inverse_body,cut->>'to',cut->>'from');
    end loop;
    if inverse_body is distinct from original_body then raise exception 'alchemy_pair_inverse_changed';end if;
    if metadata->>'prosrc'=original_body then originals:=originals+1;
    elsif metadata->>'prosrc'=next_body then finals:=finals+1;
    else raise exception 'alchemy_pair_unknown_preimage: %',target_spec->>'oid';end if;
  end loop;
  if cut_count<>11 or (originals<>7 and finals<>7) then raise exception 'alchemy_pair_partial_baseline';end if;
  if originals=7 then
    for target_spec in select value from jsonb_array_elements(targets) loop
      select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
      if metadata-'prosrc' is distinct from target_spec->'metadata'
        or metadata->>'prosrc' is distinct from target_spec->>'original' then
        raise exception 'alchemy_pair_changed_before_replace';end if;
      original_body:=metadata->>'prosrc';next_body:=original_body;
      for cut in select value from jsonb_array_elements(target_spec->'cuts') loop
        next_body:=replace(next_body,cut->>'from',cut->>'to');
      end loop;
      definition:=pg_catalog.pg_get_functiondef((target_spec->>'oid')::oid);
      if (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1 then
        raise exception 'alchemy_pair_definition_body_not_unique';end if;
      execute replace(definition,original_body,next_body);
    end loop;
  end if;
  for target_spec in select value from jsonb_array_elements(targets) loop
    next_body:=target_spec->>'original';
    for cut in select value from jsonb_array_elements(target_spec->'cuts') loop next_body:=replace(next_body,cut->>'from',cut->>'to');end loop;
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata-'prosrc' is distinct from target_spec->'metadata' or metadata->>'prosrc' is distinct from next_body then
      raise exception 'alchemy_pair_target_preservation_failed';end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]'::jsonb) into untouched_after
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_portal','bx1_private','public','auth')
      and not exists(select 1 from jsonb_array_elements(targets) s where p.oid=(s->>'oid')::oid);
  if untouched_after is distinct from untouched_before then raise exception 'alchemy_pair_non_target_changed';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims_before
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from sub_before or auth.uid() is not null then
    raise exception 'alchemy_pair_claims_changed';end if;

end $amoy_archive_alchemy_pair$;

/*
CHECKED INVERSE: NOT EXECUTED by this installer.
Root may extract the paired alchemy_pair_inverse tag only after the same review
and preservation checkpoint. It requires all seven exact final bodies (or all
seven originals for a no-op), and preserves metadata and unrelated functions.
$alchemy_pair_inverse$
do $amoy_archive_alchemy_inverse$
declare
  targets constant jsonb:=$alchemy_inverse_targets$[
  {
    "oid": 24934,
    "signature": "bx1_portal.record_funding_observation(uuid,jsonb)",
    "sha": "0537e0578f0516cda9484f5ea4648af5b74e93f44fbf5b644bd76448546305fb",
    "metadata": {
      "oid": "24934",
      "proacl": [
        "postgres=X/postgres",
        "service_role=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_funding_observation",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "eid",
        "facts"
      ],
      "proargtypes": [
        "2950",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "funding_pair",
        "from": "and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[])",
        "to": "and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[])",
        "count": 1
      }
    ],
    "final_sha": "a76dc61a37cee8ef51fa2770ab0d1d7152467bc7000ef820c14f3a29a5e561af"
  },
  {
    "oid": 33625,
    "signature": "bx1_portal.fund_setup_observers_valid(jsonb)",
    "sha": "c9eda9d4cdf1b1e50c28e66e91911a590909e6fa49d7035e6f953bae993d001c",
    "metadata": {
      "oid": "33625",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_setup_observers_valid",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "result"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "a5e330b4d8d77c5bc6e3d24c123bb7ae9ac0747a6289744cf24d67384a6d8335"
  },
  {
    "oid": 36424,
    "signature": "bx1_portal.record_fund_admission(uuid,jsonb,text)",
    "sha": "22002bab1e1930ea79f32db15e76260a2e1746e448839d01b45b77cdfeae43da",
    "metadata": {
      "oid": "36424",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_admission",
      "prorows": 0,
      "pronargs": 3,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "request_id",
        "candidate",
        "admitted_manifest_hash"
      ],
      "proargtypes": [
        "2950",
        "3802",
        "25"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "ordered_admission",
        "from": "or candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))",
        "to": "or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'\n          and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.g.alchemy.com/v2')))",
        "count": 1
      }
    ],
    "final_sha": "14a917d8a77ebe165c613ed3dd632805471b6dde8b2037b1342aeb0dda3ff176"
  },
  {
    "oid": 36708,
    "signature": "bx1_portal.fund_recipient_result_shape(jsonb)",
    "sha": "6e6fa46f5383f172df9a811b7020c04effc51e7015398a6da5ccada1d1400c3f",
    "metadata": {
      "oid": "36708",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_recipient_result_shape",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "result"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "84cefa54ec6e792231b08f22362dedbf7fdf732444d938e3a6536b81da85b295"
  },
  {
    "oid": 36709,
    "signature": "bx1_portal.record_fund_recipient_observation(jsonb,jsonb)",
    "sha": "93bdb1489699bf4dd5b554fb85fe55c2b6fd697955832a328a8844578f531a99",
    "metadata": {
      "oid": "36709",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_recipient_observation",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "request",
        "result"
      ],
      "proargtypes": [
        "3802",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "32de9e76002e8bff1baa821fd6e23a9fc0ee5f78dd9eac60da1c6cf1777ab69f"
  },
  {
    "oid": 38526,
    "signature": "bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)",
    "sha": "e3c353516b891c419d95f52b25cca4ed8368e313a6efa046af6a41147fb94f5a",
    "metadata": {
      "oid": "38526",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_setup_retry",
      "prorows": 0,
      "pronargs": 4,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "preparation",
        "action",
        "request_key",
        "details"
      ],
      "proargtypes": [
        "3802",
        "25",
        "2950",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "ordered_retry",
        "from": "provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]",
        "to": "(provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]\n        and provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'])[provider_index+1])",
        "count": 1
      }
    ],
    "final_sha": "f5c9e7853e9b3815dd4edabf678055d255c2ceb02dd45c9c0bfe63f7cc544612"
  },
  {
    "oid": 38760,
    "signature": "bx1_private.fund_alignment_snapshot_valid(jsonb)",
    "sha": "25c5320755fde3f8efd3fe914a6b3cc24b46366e99dc95e001253ba470f1dd5d",
    "metadata": {
      "oid": "38760",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_alignment_snapshot_valid",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "v"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "alignment_members",
        "from": "p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co')",
        "to": "p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co','https://polygon-amoy.g.alchemy.com/v2')",
        "count": 1
      },
      {
        "name": "alignment_pairs",
        "from": "return urls[1] is distinct from urls[2];",
        "to": "return urls[1] is distinct from urls[2] and (urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls = array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]) is true;",
        "count": 1
      }
    ],
    "final_sha": "7b314b7a47839d6f87b8798ad6629569308c3c37ddd33d243f45109f8cb47566"
  }
]$alchemy_inverse_targets$::jsonb;
  target_spec jsonb;cut jsonb;metadata jsonb;current_body text;original_body text;definition text;
  originals integer:=0;finals integer:=0;cut_count integer:=0;untouched_before jsonb;untouched_after jsonb;
  claims_before text:=pg_catalog.current_setting('request.jwt.claims',true);
  sub_before text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or (select environment from bx1_portal.entry_configuration where singleton) is distinct from 'TESTNET' then
    raise exception 'alchemy_pair_test_owner_without_claims_required' using errcode='42501';end if;
  if jsonb_array_length(targets)<>7 then raise exception 'alchemy_pair_scope_changed';end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]'::jsonb) into untouched_before
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_portal','bx1_private','public','auth')
      and not exists(select 1 from jsonb_array_elements(targets) s where p.oid=(s->>'oid')::oid);

  for target_spec in select value from jsonb_array_elements(targets) loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata is null or pg_catalog.to_regprocedure(target_spec->>'signature')::oid is distinct from (target_spec->>'oid')::oid
      or metadata-'prosrc' is distinct from target_spec->'metadata' then
      raise exception 'alchemy_pair_inverse_metadata_changed';end if;
    current_body:=metadata->>'prosrc';
    if encode(sha256(convert_to(current_body,'UTF8')),'hex')=target_spec->>'sha' then originals:=originals+1;
    elsif encode(sha256(convert_to(current_body,'UTF8')),'hex')=target_spec->>'final_sha' then
      finals:=finals+1;original_body:=current_body;
      for cut in select value from jsonb_array_elements(target_spec->'cuts') with ordinality item(value,position) order by position desc loop
        if (length(original_body)-length(replace(original_body,cut->>'to','')))/length(cut->>'to')<>1 then
          raise exception 'alchemy_pair_inverse_cut_not_unique';end if;
        original_body:=replace(original_body,cut->>'to',cut->>'from');cut_count:=cut_count+1;
      end loop;
      if encode(sha256(convert_to(original_body,'UTF8')),'hex') is distinct from target_spec->>'sha' then
        raise exception 'alchemy_pair_inverse_original_changed';end if;
    else raise exception 'alchemy_pair_inverse_unknown_source';end if;
  end loop;
  if (originals<>7 and finals<>7) or (finals=7 and cut_count<>11) then raise exception 'alchemy_pair_inverse_partial_baseline';end if;
  if finals=7 then
    for target_spec in select value from jsonb_array_elements(targets) loop
      select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
      current_body:=metadata->>'prosrc';
      if metadata-'prosrc' is distinct from target_spec->'metadata'
        or encode(sha256(convert_to(current_body,'UTF8')),'hex') is distinct from target_spec->>'final_sha' then
        raise exception 'alchemy_pair_inverse_changed_before_replace';end if;
      original_body:=current_body;
      for cut in select value from jsonb_array_elements(target_spec->'cuts') with ordinality item(value,position) order by position desc loop
        original_body:=replace(original_body,cut->>'to',cut->>'from');
      end loop;
      definition:=pg_catalog.pg_get_functiondef((target_spec->>'oid')::oid);
      if (length(definition)-length(replace(definition,current_body,'')))/length(current_body)<>1 then
        raise exception 'alchemy_pair_inverse_definition_not_unique';end if;
      execute replace(definition,current_body,original_body);
    end loop;
  end if;
  for target_spec in select value from jsonb_array_elements(targets) loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata-'prosrc' is distinct from target_spec->'metadata'
      or encode(sha256(convert_to(metadata->>'prosrc','UTF8')),'hex') is distinct from target_spec->>'sha' then
      raise exception 'alchemy_pair_inverse_preservation_failed';end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]'::jsonb) into untouched_after
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_portal','bx1_private','public','auth')
      and not exists(select 1 from jsonb_array_elements(targets) s where p.oid=(s->>'oid')::oid);
  if untouched_after is distinct from untouched_before then raise exception 'alchemy_pair_non_target_changed';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims_before
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from sub_before or auth.uid() is not null then
    raise exception 'alchemy_pair_claims_changed';end if;

end $amoy_archive_alchemy_inverse$;
$alchemy_pair_inverse$
*/
