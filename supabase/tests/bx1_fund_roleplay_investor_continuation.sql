-- Query-only native proof. No actors, sessions, claims or business rows are created.
-- Installation and forced rollback are performed only by the reviewed cloud envelope.
do $fund_investor_continuation_proof$
declare spec jsonb;cut jsonb;dependency jsonb;sample jsonb;current_row jsonb;original text;restored text;source text;
  target oid;helper oid;actual boolean;predicate text;query text;candidate jsonb;graph_rows jsonb;step_rows jsonb;
  observation_rows jsonb;setup_row jsonb;first_result jsonb;row_value jsonb;case_name text;
  product_row jsonb;policy_row jsonb;fixture_row jsonb;input_row jsonb;lane_row jsonb;
  op_count integer:=0;lane_count integer:=0;coverage_count integer:=0;old_rejected boolean;extra jsonb;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  specs constant jsonb:=$specs$[
  {
    "oid": 36417,
    "signature": "bx1_portal.fund_admission_seed(uuid,integer,jsonb)",
    "sha": "0607cb0ff25e24bf5d3dd9f838d1e463228dfa1e4da79a516011aa1d3f5ca6d6",
    "cuts": [
      {
        "from": "(select count(*) from bx1_portal.fund_setup_steps where setup_id=s.id and state='FINAL' and observation_id is not null)<>25",
        "to": "(select count(*) from bx1_portal.fund_setup_graph())<>25\n    or exists(select 1 from bx1_portal.fund_setup_graph() graph\n      left join bx1_portal.fund_setup_steps step on step.setup_id=s.id and step.step_key=graph.step_key\n        and step.ordinal=graph.ordinal and step.kind=graph.kind\n      left join bx1_portal.fund_setup_observations observed on observed.id=step.observation_id\n        and observed.setup_id=s.id and observed.step_id=step.id\n      where step.id is null or step.state is distinct from 'FINAL' or observed.id is null\n        or observed.actor_id is distinct from s.actor_id or observed.operating_context is distinct from s.operating_context\n        or observed.result_hash is distinct from bx1_portal.fund_digest(observed.result)\n        or observed.result->>'status' is distinct from 'FINAL' or observed.result->>'chain_id' is distinct from '80002'\n        or observed.result->>'step_key' is distinct from step.step_key\n        or step.intent_hash is null or observed.result->>'intent_hash' is distinct from step.intent_hash\n        or step.transaction_hash is null or observed.result->>'transaction_hash' is distinct from step.transaction_hash\n        or observed.result->>'runtime_hash' is distinct from step.intent->>'expected_runtime_hash'\n        or observed.result->'checks' is distinct from step.intent->'checks'\n        or (step.kind='CREATE' and observed.result->>'contract_address' is distinct from step.intent->>'expected_address')\n        or (step.kind='CALL' and observed.result->'contract_address' is distinct from 'null'::jsonb))\n    or exists(select 1 from bx1_portal.fund_setup_steps step where step.setup_id=s.id\n      and not (step.step_key='safe_creation' and step.ordinal=0 and step.kind='CALL')\n      and not exists(select 1 from bx1_portal.fund_setup_graph() graph\n        where graph.step_key=step.step_key and graph.ordinal=step.ordinal and graph.kind=step.kind))\n    or not exists(select 1 from bx1_portal.fund_setup_observations observed\n      where observed.id=s.safe_observation_id and observed.setup_id=s.id and observed.step_id is null\n        and observed.actor_id=s.actor_id and observed.operating_context=s.operating_context\n        and observed.result_hash=bx1_portal.fund_digest(observed.result)\n        and observed.result->>'status'='VERIFIED_CODE_AND_STATE'\n        and observed.result->>'address'=s.safe_address and observed.result->'owners'=s.safe_owners\n        and observed.result->>'threshold'=s.safe_threshold::text)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "36417",
      "proacl": [
        "postgres=X/postgres",
        "authenticated=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_admission_seed",
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
        "sid",
        "expected",
        "c"
      ],
      "proargtypes": [
        "2950",
        "23",
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
    }
  },
  {
    "oid": 31496,
    "signature": "bx1_portal.fund_manifest_current(uuid)",
    "sha": "b06a74fa8f0a1ad435d678af5a62cde193f3242db0446922b9491fd052c2d153",
    "cuts": [
      {
        "from": "bx1_portal.current_product_organisation(p.organisation_id)",
        "to": "(case when m.roleplay_policy_id is not null then bx1_private.fund_roleplay_eligibility_organisation_current(m.roleplay_policy_id,m.roleplay_epoch,m.product_id) else bx1_portal.current_product_organisation(p.organisation_id) end)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "31496",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_manifest_current",
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
        "target"
      ],
      "proargtypes": [
        "2950"
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
    }
  },
  {
    "oid": 25738,
    "signature": "bx1_portal.guard_offering_publication()",
    "sha": "16998557a368f6f8847082838f58f8256e7ccfeea36b9f20c338d38df7b3feb2",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(new.id)",
        "to": "(case when new.review_roleplay_policy_id is not null then\n    (old.status='APPROVED' and new.revision=old.revision+1 and exists(\n      select 1 from bx1_private.fund_roleplay_command_lanes lane\n      where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n        and lane.product_id=new.id and lane.action='publish_product'\n        and bx1_private.fund_roleplay_investor_write_lane(new.id,'publish_product',lane.request_key,lane.operating_context)\n        and bx1_private.fund_roleplay_manager_publish_lane(new.id,lane.request_key,lane.operating_context)))\n    else bx1_portal.offering_operational(new.id) end)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "25738",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "guard_offering_publication",
      "prorows": 0,
      "pronargs": 0,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "2279",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": null,
      "proargtypes": [],
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
    }
  },
  {
    "oid": 37275,
    "signature": "bx1_private.fund_roleplay_eligibility_source(uuid)",
    "sha": "de227ad3391f1c8e67ce91c0d78a1de16a8bad533aebe1ab46c33864f845f2ee",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "bx1_private.fund_roleplay_investor_operational(p.id,rp.id,rp.authority_epoch)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "37275",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_eligibility_source",
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
        "target"
      ],
      "proargtypes": [
        "2950"
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
    }
  },
  {
    "oid": 37285,
    "signature": "bx1_private.fund_roleplay_eligibility_product_visible(jsonb,uuid)",
    "sha": "2404e8bc14047e15674b6173951cb4e40cce0ab9d0bd0fe427e049c817cae100",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "bx1_private.fund_roleplay_investor_operational(p.id,rp.id,rp.authority_epoch)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "37285",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_eligibility_product_visible",
      "prorows": 0,
      "pronargs": 2,
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
        "c",
        "product"
      ],
      "proargtypes": [
        "3802",
        "2950"
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
    }
  },
  {
    "oid": 25748,
    "signature": "bx1_portal.guard_offering_eligibility()",
    "sha": "b4f35ee1d594ee8066aa737c4226acc8c4cfc9db7d8f3f56bbb9bc1c05d21503",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "(case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,case when TG_OP='INSERT' or new.status='SUBMITTED' then 'request_product_eligibility' when new.status='APPROVED' then 'review_product_eligibility' else null end,null,null) else bx1_portal.offering_operational(p.id) end)",
        "count": 3
      }
    ],
    "metadata": {
      "oid": "25748",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "guard_offering_eligibility",
      "prorows": 0,
      "pronargs": 0,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "2279",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": null,
      "proargtypes": [],
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
    }
  },
  {
    "oid": 25754,
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "sha": "9232b76d3431030228b386dcab7deffc19220960b9f113052705de6f95e4e80b",
    "cuts": [
      {
        "from": "  elsif action='subscribe' then\n    if body->>'offering_revision_id'",
        "to": "  elsif action='subscribe' then\n    perform bx1_private.fund_roleplay_eligibility_enter(c,action,key,body-'offering_revision_id');\n    if body->>'offering_revision_id'",
        "count": 1
      },
      {
        "from": "or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true",
        "to": "or p.status<>'PUBLISHED' or (case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',key,c) else bx1_portal.offering_operational(p.id) end) is not true",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "25754",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "execute_scoped_pre_monitoring",
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
        "c",
        "action",
        "key",
        "body"
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
    }
  },
  {
    "oid": 24447,
    "signature": "bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)",
    "sha": "867d71f86ac7bf3fb96c3c5f6eb38f890b4769ab363f00f2404a02886cb16ea2",
    "cuts": [
      {
        "from": "bx1_portal.current_product_organisation(v_org)",
        "to": "(case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',key,c) else bx1_portal.current_product_organisation(v_org) end)",
        "count": 2
      }
    ],
    "metadata": {
      "oid": "24447",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "execute_scoped_p2",
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
        "c",
        "action",
        "key",
        "body"
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
    }
  },
  {
    "oid": 25740,
    "signature": "bx1_portal.guard_offering_subscription()",
    "sha": "35b757ba2fcac1e946146554dfbfd1ffaae47d45734d6b0a19bc53e1d92f2078",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "(case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',null,null) else bx1_portal.offering_operational(p.id) end)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "25740",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "guard_offering_subscription",
      "prorows": 0,
      "pronargs": 0,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "2279",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": null,
      "proargtypes": [],
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
    }
  },
  {
    "oid": 25744,
    "signature": "bx1_portal.guard_offering_funding_commitment()",
    "sha": "574c7104b69ac52775f789ff6f5f1baf0690f1361e3798352570e0e196992ac9",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(new.product_id)",
        "to": "(case when exists(select 1 from bx1_portal.products product_row where product_row.id=new.product_id\n    and product_row.review_roleplay_policy_id is not null) then\n    (case when TG_TABLE_NAME='funding_routes' and TG_OP='INSERT' then\n      bx1_private.fund_roleplay_investor_write_lane(new.product_id,'propose_funding_route',null,null)\n    when TG_TABLE_NAME='funding_routes' and TG_OP='UPDATE' then\n      bx1_private.fund_roleplay_investor_write_lane(new.product_id,'approve_funding_route',null,null)\n    when TG_TABLE_NAME='funding_obligations' and TG_OP='INSERT' then\n      bx1_private.fund_roleplay_investor_write_lane(new.product_id,'open_funding_obligation',null,null)\n    else false end) else bx1_portal.offering_operational(new.product_id) end)",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "25744",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "guard_offering_funding_commitment",
      "prorows": 0,
      "pronargs": 0,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "2279",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": null,
      "proargtypes": [],
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
    }
  },
  {
    "oid": 37279,
    "signature": "bx1_private.fund_roleplay_eligibility_enter(jsonb,text,uuid,jsonb)",
    "sha": "402db4c2d6f6ff1bd1306919411c1faf585fe481741104b9ce46b51881552c63",
    "cuts": [
      {
        "from": "begin\n  if action='request_product_eligibility'",
        "to": "begin\n  if action='subscribe' then\n    product:=(body->>'product_id')::uuid;\n    -- Never relabel a retained ordinary request with new role-play provenance.\n    if exists(select 1 from bx1_portal.scoped_requests prior\n      where prior.actor_id=auth.uid() and prior.request_key=key)\n      and not exists(select 1 from bx1_private.fund_roleplay_command_receipts receipt\n        join bx1_portal.scoped_requests prior on prior.actor_id=receipt.actual_actor_id\n          and prior.request_key=receipt.request_key and prior.command=receipt.action\n        where receipt.actual_actor_id=auth.uid() and receipt.request_key=key and receipt.action='subscribe'\n          and receipt.product_id=product and receipt.operating_context=c\n          and prior.operating_context=c and prior.command='subscribe' and prior.payload=body\n          and bx1_private.fund_roleplay_record_current(receipt.policy_id,receipt.authority_epoch,receipt.product_id,\n            receipt.offering_revision_id,receipt.actual_actor_id,receipt.operating_context,receipt.action)) then return;end if;\n    if bx1_private.fund_roleplay_current_policy(c,product,action) is null then return;end if;\n    if not exists(select 1 from bx1_portal.investment_accounts account_row\n      join bx1_portal.product_eligibility_cases eligibility on eligibility.investment_account_id=account_row.id\n        and eligibility.holder_user_id=account_row.holder_user_id\n      where account_row.id=(body->>'investment_account_id')::uuid and account_row.holder_user_id=auth.uid()\n        and eligibility.product_id=product and bx1_portal.account_usable(c,account_row.id)\n        and bx1_portal.product_eligibility_current(eligibility.id)\n        and bx1_private.fund_roleplay_admission_product(account_row.application_id,product)) then\n      raise exception 'fund_roleplay_subscribe_exact_account_required' using errcode='42501';end if;\n    perform bx1_private.fund_roleplay_enter(c,product,action,key,null);\n    return;\n  end if;\n  if action='request_product_eligibility'",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "37279",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_roleplay_eligibility_enter",
      "prorows": 0,
      "pronargs": 4,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2278",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "c",
        "action",
        "key",
        "body"
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
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    }
  },
  {
    "oid": 37280,
    "signature": "bx1_private.fund_roleplay_eligibility_finish(jsonb,text,uuid,jsonb)",
    "sha": "4a008d265fa9baefd278eae274d4db5816808bdcf00416c64d6807cdc50ab467",
    "cuts": [
      {
        "from": "  if action='request_product_eligibility' then product:=(body->>'product_id')::uuid;",
        "to": "  if action in ('request_product_eligibility','subscribe') then product:=(body->>'product_id')::uuid;",
        "count": 1
      }
    ],
    "metadata": {
      "oid": "37280",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_roleplay_eligibility_finish",
      "prorows": 0,
      "pronargs": 4,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2278",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "c",
        "action",
        "key",
        "body"
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
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    }
  }
]$specs$::jsonb;
  dependencies constant jsonb:=$dependencies$[
  {
    "oid": 16542,
    "signature": "auth.uid()",
    "metadata": {
      "oid": "16542",
      "proacl": [
        "=X/supabase_auth_admin",
        "supabase_auth_admin=X/supabase_auth_admin",
        "dashboard_user=X/supabase_auth_admin"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "uid",
      "prorows": 0,
      "pronargs": 0,
      "proowner": "16545",
      "proconfig": null,
      "proretset": false,
      "prosecdef": false,
      "prorettype": "2950",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": null,
      "proargtypes": [],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "s",
      "proleakproof": false,
      "pronamespace": "16498",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "sha": "09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16"
  },
  {
    "oid": 16714,
    "signature": "auth.jwt()",
    "metadata": {
      "oid": "16714",
      "proacl": [
        "=X/supabase_auth_admin",
        "postgres=X/supabase_auth_admin",
        "supabase_auth_admin=X/supabase_auth_admin",
        "dashboard_user=X/supabase_auth_admin"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "jwt",
      "prorows": 0,
      "pronargs": 0,
      "proowner": "16545",
      "proconfig": null,
      "proretset": false,
      "prosecdef": false,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": null,
      "proargtypes": [],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "s",
      "proleakproof": false,
      "pronamespace": "16498",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "sha": "f2899304329d35e79c3f0bd0bfe249faf4cb20c8540d4ef391848b40fb0890ca"
  },
  {
    "oid": 25732,
    "signature": "bx1_portal.offering_technical_ready(uuid)",
    "metadata": {
      "oid": "25732",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "offering_technical_ready",
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
        "target_revision"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "3912da2f9d8d38913d2bfd2f9c65f86f320170e21ad12aa244fe879023bc9889"
  },
  {
    "oid": 33388,
    "signature": "bx1_private.test_roleplay_environment()",
    "metadata": {
      "oid": "33388",
      "proacl": [
        "postgres=X/postgres",
        "bx1_authority_owner=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "test_roleplay_environment",
      "prorows": 0,
      "pronargs": 0,
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
      "proargnames": null,
      "proargtypes": [],
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
    "sha": "df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21"
  },
  {
    "oid": 33389,
    "signature": "bx1_private.test_roleplay_protected_session()",
    "metadata": {
      "oid": "33389",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "test_roleplay_protected_session",
      "prorows": 0,
      "pronargs": 0,
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
      "proargnames": null,
      "proargtypes": [],
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
    "sha": "0cef4c386c389bb403f99fbae76f82a20faa874a1d7d9749d795c292b2822e14"
  },
  {
    "oid": 33604,
    "signature": "bx1_portal.fund_setup_graph()",
    "metadata": {
      "oid": "33604",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_setup_graph",
      "prorows": 1000,
      "pronargs": 0,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": true,
      "prosecdef": false,
      "prorettype": "2249",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": [
        "t",
        "t",
        "t"
      ],
      "proargnames": [
        "step_key",
        "ordinal",
        "kind"
      ],
      "proargtypes": [],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": [
        "25",
        "23",
        "25"
      ],
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "sha": "83c0643c314a0c0580b52cab8d02348c81f0e5b718048f15c32b86fd5e56cfac"
  },
  {
    "oid": 33605,
    "signature": "bx1_portal.fund_setup_roleplay(jsonb,uuid)",
    "metadata": {
      "oid": "33605",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_setup_roleplay",
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
        "c",
        "pid"
      ],
      "proargtypes": [
        "3802",
        "2950"
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
    "sha": "3e86684b7939d7d2ba414cac54e8322051949cb86aa9a635d6fdec8783074b37"
  },
  {
    "oid": 33609,
    "signature": "bx1_portal.fund_setup_audit(uuid,uuid,text,integer,integer,jsonb)",
    "metadata": {
      "oid": "33609",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_setup_audit",
      "prorows": 0,
      "pronargs": 6,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2278",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "sid",
        "tid",
        "action",
        "before_rev",
        "after_rev",
        "details"
      ],
      "proargtypes": [
        "2950",
        "2950",
        "25",
        "23",
        "23",
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
    "sha": "43ffcdcd8b87c51241331fb5712f9ff94c95cf8c9cd2c2d260999ee36c41c4b6"
  },
  {
    "oid": 33610,
    "signature": "bx1_portal.fund_setup_package_approved(uuid)",
    "metadata": {
      "oid": "33610",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_setup_package_approved",
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
        "pid"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "06e64c075c99b1172fe96e2a6f0581e7b1cc3021615b744e742f2e3af7a573f1"
  },
  {
    "oid": 36060,
    "signature": "bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)",
    "metadata": {
      "oid": "36060",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_record_current",
      "prorows": 0,
      "pronargs": 7,
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
        "policy",
        "epoch",
        "product",
        "offering",
        "actor",
        "c",
        "action"
      ],
      "proargtypes": [
        "2950",
        "23",
        "2950",
        "2950",
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
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "sha": "fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8"
  },
  {
    "oid": 36065,
    "signature": "bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)",
    "metadata": {
      "oid": "36065",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_lane_current",
      "prorows": 0,
      "pronargs": 3,
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
        "c",
        "product",
        "action"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "25"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": "({CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})",
      "pronargdefaults": 1
    },
    "sha": "e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177"
  },
  {
    "oid": 36066,
    "signature": "bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)",
    "metadata": {
      "oid": "36066",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_roleplay_enter",
      "prorows": 0,
      "pronargs": 5,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2950",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "c",
        "product",
        "action",
        "key",
        "signing_address"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "25",
        "2950",
        "25"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": "({CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})",
      "pronargdefaults": 1
    },
    "sha": "07bebb9b24e5676b24b78af98ce14d50929f4b997e300b7d06223aa350d771ec"
  },
  {
    "oid": 36067,
    "signature": "bx1_private.fund_roleplay_finish(jsonb,uuid,text,uuid)",
    "metadata": {
      "oid": "36067",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_roleplay_finish",
      "prorows": 0,
      "pronargs": 4,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2278",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "c",
        "product",
        "action",
        "key"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "25",
        "2950"
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
    "sha": "3168472a61298bb600ccc544cecbd18c490fa4154fa45044bf7ef32ff2056302"
  },
  {
    "oid": 36224,
    "signature": "bx1_private.fund_roleplay_approved(uuid)",
    "metadata": {
      "oid": "36224",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_approved",
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
        "product"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "2c791e438e062fbf0745494dfa654df665d3d22442fa11966c1d9da59285f74a"
  },
  {
    "oid": 37217,
    "signature": "bx1_private.fund_roleplay_manager_publish_lane(uuid,uuid,jsonb)",
    "metadata": {
      "oid": "37217",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_manager_publish_lane",
      "prorows": 0,
      "pronargs": 3,
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
        "product",
        "key",
        "c"
      ],
      "proargtypes": [
        "2950",
        "2950",
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
      "proargdefaults": "({CONST :consttype 3802 :consttypmod -1 :constcollid 0 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})",
      "pronargdefaults": 1
    },
    "sha": "261f4c1c7df4a400e51445ee0f0386cdd21d10c75fada9fd4ba8c1eea191338a"
  },
  {
    "oid": 37274,
    "signature": "bx1_private.fund_roleplay_eligibility_organisation_current(uuid,integer,uuid)",
    "metadata": {
      "oid": "37274",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_eligibility_organisation_current",
      "prorows": 0,
      "pronargs": 3,
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
        "policy",
        "epoch",
        "product"
      ],
      "proargtypes": [
        "2950",
        "23",
        "2950"
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
    "sha": "c80a4b154ec273a6db5e8281347d694375728f935dd145b3378700da00a26dc5"
  },
  {
    "oid": 24441,
    "signature": "bx1_portal.current_product_organisation(uuid)",
    "metadata": {
      "oid": "24441",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "current_product_organisation",
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
        "target_org"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "c5fe072a746a8fad60a9706e072dd4ee0ed715917e9ee44c918fdb53bf8b777f"
  },
  {
    "oid": 25733,
    "signature": "bx1_portal.offering_approved(uuid)",
    "metadata": {
      "oid": "25733",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "offering_approved",
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
        "target_product"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "ab18307440fc29e6554dad3fc8051a394b10a6c15e1bcd823529094012c67d06"
  },
  {
    "oid": 25734,
    "signature": "bx1_portal.offering_operational(uuid)",
    "metadata": {
      "oid": "25734",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "offering_operational",
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
        "target_product"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "ce138ffe4c21e992116678f0f0295c009c5240f20512e46956b07ca811802978"
  },
  {
    "oid": 36061,
    "signature": "bx1_private.fund_roleplay_current_policy(jsonb,uuid,text)",
    "metadata": {
      "oid": "36061",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_current_policy",
      "prorows": 0,
      "pronargs": 3,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2950",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "c",
        "product",
        "action"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "25"
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
    "sha": "f9e7bba1ac261a2d66dd46f81466a3d838e70894174bbb8ed6f9c0bed46f7ed7"
  },
  {
    "oid": 36062,
    "signature": "bx1_private.fund_roleplay_person_for(uuid,uuid)",
    "metadata": {
      "oid": "36062",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_person_for",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "2950",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "product",
        "actor"
      ],
      "proargtypes": [
        "2950",
        "2950"
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
    "sha": "94923b9b32fb15bc705423ac088794d17b5f4b573a6ea61acb2c57e258037a01"
  },
  {
    "oid": 36431,
    "signature": "bx1_private.fund_roleplay_finance_context(jsonb,uuid,text)",
    "metadata": {
      "oid": "36431",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_finance_context",
      "prorows": 0,
      "pronargs": 3,
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
        "c",
        "product",
        "action"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "25"
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
    "sha": "49d75660c88d92c53e3778204efe48da6a9add06b53d39e3a930a966f29cdd65"
  },
  {
    "oid": 37277,
    "signature": "bx1_private.fund_roleplay_eligibility_request(jsonb,uuid,uuid)",
    "metadata": {
      "oid": "37277",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_eligibility_request",
      "prorows": 0,
      "pronargs": 3,
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
        "c",
        "product",
        "account"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "2950"
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
    "sha": "2eced5d1578e9b58d4931ee4c178ed19ff2ae5b1a5a2dd9bf4633dc699c1323a"
  },
  {
    "oid": 38189,
    "signature": "bx1_private.fund_roleplay_admission_product(uuid,uuid)",
    "metadata": {
      "oid": "38189",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_roleplay_admission_product",
      "prorows": 0,
      "pronargs": 2,
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
        "p_application",
        "p_product"
      ],
      "proargtypes": [
        "2950",
        "2950"
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
    "sha": "9959a8d00b80d0d0c7d6861e016f1b7b31bc89ee758452fe0c58ee1cb49477c1"
  },
  {
    "oid": 24444,
    "signature": "bx1_portal.account_usable(jsonb,uuid)",
    "metadata": {
      "oid": "24444",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "account_usable",
      "prorows": 0,
      "pronargs": 2,
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
        "c",
        "target_account"
      ],
      "proargtypes": [
        "3802",
        "2950"
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
    "sha": "2bc4db89d70ab7ee3f30f9d4a3b05828a0be23aa3a6410c2867dd232b46a19a1"
  },
  {
    "oid": 26216,
    "signature": "bx1_portal.product_eligibility_current(uuid)",
    "metadata": {
      "oid": "26216",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "product_eligibility_current",
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
        "target_case"
      ],
      "proargtypes": [
        "2950"
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
    "sha": "404909ba3f710ce4628853f63565eafcdfe061cd9fe8ed4b7682e6132d7b8b97"
  },
  {
    "oid": 31491,
    "signature": "bx1_portal.fund_digest(jsonb)",
    "metadata": {
      "oid": "31491",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_digest",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "25",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "value"
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
    "sha": "99544fb448759bcc906694ad6c7bb7c6cd09a3e0568eaeb961d1d49726d90c95"
  },
  {
    "oid": 33606,
    "signature": "bx1_portal.fund_setup_context(jsonb,uuid,boolean)",
    "metadata": {
      "oid": "33606",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_setup_context",
      "prorows": 0,
      "pronargs": 3,
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
        "c",
        "pid",
        "protected"
      ],
      "proargtypes": [
        "3802",
        "2950",
        "16"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": "({CONST :consttype 16 :consttypmod -1 :constcollid 0 :constlen 1 :constbyval true :constisnull false :location -1 :constvalue 1 [ 0 0 0 0 0 0 0 0 ]})",
      "pronargdefaults": 1
    },
    "sha": "37fbe5160c2d29ff366c027738c2966f3994df1ff6bc8c88424e51d00029d9ff"
  },
  {
    "oid": 33608,
    "signature": "bx1_portal.fund_setup_current(uuid,jsonb)",
    "metadata": {
      "oid": "33608",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "14",
      "proname": "fund_setup_current",
      "prorows": 0,
      "pronargs": 2,
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
        "sid",
        "c"
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
    "sha": "004b507cf7a970cf3d86ba2a5e6a7cfdfe43bbc04fdc4a84ad3b68b80c5bb48c"
  }
]$dependencies$::jsonb;
  expected_triggers constant jsonb:=$expected_triggers$[
  {
    "oid": "25739",
    "tgargs": "\\x",
    "tgattr": [
      5,
      6,
      7,
      18
    ],
    "tgfoid": "25738",
    "tgname": "bx1_offering_publication_gate",
    "tgqual": null,
    "tgtype": 23,
    "tgnargs": 0,
    "tgrelid": "24210",
    "tgenabled": "O",
    "tgnewtable": null,
    "tgoldtable": null,
    "tgparentid": "0",
    "tgconstraint": "0",
    "tgdeferrable": false,
    "tgisinternal": false,
    "tgconstrindid": "0",
    "tgconstrrelid": "0",
    "tginitdeferred": false
  },
  {
    "oid": "25741",
    "tgargs": "\\x",
    "tgattr": [],
    "tgfoid": "25740",
    "tgname": "bx1_offering_subscription_gate",
    "tgqual": null,
    "tgtype": 7,
    "tgnargs": 0,
    "tgrelid": "24250",
    "tgenabled": "O",
    "tgnewtable": null,
    "tgoldtable": null,
    "tgparentid": "0",
    "tgconstraint": "0",
    "tgdeferrable": false,
    "tgisinternal": false,
    "tgconstrindid": "0",
    "tgconstrrelid": "0",
    "tginitdeferred": false
  },
  {
    "oid": "25745",
    "tgargs": "\\x",
    "tgattr": [],
    "tgfoid": "25744",
    "tgname": "bx1_offering_route_creation_gate",
    "tgqual": null,
    "tgtype": 7,
    "tgnargs": 0,
    "tgrelid": "24539",
    "tgenabled": "O",
    "tgnewtable": null,
    "tgoldtable": null,
    "tgparentid": "0",
    "tgconstraint": "0",
    "tgdeferrable": false,
    "tgisinternal": false,
    "tgconstrindid": "0",
    "tgconstrrelid": "0",
    "tginitdeferred": false
  },
  {
    "oid": "25746",
    "tgargs": "\\x",
    "tgattr": [
      7
    ],
    "tgfoid": "25744",
    "tgname": "bx1_offering_route_approval_gate",
    "tgqual": "{BOOLEXPR :boolop and :args ({OPEXPR :opno 98 :opfuncid 67 :opresulttype 16 :opretset false :opcollid 0 :inputcollid 100 :args ({VAR :varno 2 :varattno 7 :vartype 25 :vartypmod -1 :varcollid 100 :varnullingrels (b) :varlevelsup 0 :varnosyn 2 :varattnosyn 7 :location -1} {CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull false :location -1 :constvalue 12 [ 48 0 0 0 65 80 80 82 79 86 69 68 ]}) :location -1} {DISTINCTEXPR :opno 98 :opfuncid 67 :opresulttype 16 :opretset false :opcollid 0 :inputcollid 100 :args ({VAR :varno 1 :varattno 7 :vartype 25 :vartypmod -1 :varcollid 100 :varnullingrels (b) :varlevelsup 0 :varnosyn 1 :varattnosyn 7 :location -1} {CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull false :location -1 :constvalue 12 [ 48 0 0 0 65 80 80 82 79 86 69 68 ]}) :location -1}) :location -1}",
    "tgtype": 19,
    "tgnargs": 0,
    "tgrelid": "24539",
    "tgenabled": "O",
    "tgnewtable": null,
    "tgoldtable": null,
    "tgparentid": "0",
    "tgconstraint": "0",
    "tgdeferrable": false,
    "tgisinternal": false,
    "tgconstrindid": "0",
    "tgconstrrelid": "0",
    "tginitdeferred": false
  },
  {
    "oid": "25747",
    "tgargs": "\\x",
    "tgattr": [],
    "tgfoid": "25744",
    "tgname": "bx1_offering_obligation_creation_gate",
    "tgqual": null,
    "tgtype": 7,
    "tgnargs": 0,
    "tgrelid": "24599",
    "tgenabled": "O",
    "tgnewtable": null,
    "tgoldtable": null,
    "tgparentid": "0",
    "tgconstraint": "0",
    "tgdeferrable": false,
    "tgisinternal": false,
    "tgconstrindid": "0",
    "tgconstrrelid": "0",
    "tginitdeferred": false
  },
  {
    "oid": "25749",
    "tgargs": "\\x",
    "tgattr": [],
    "tgfoid": "25748",
    "tgname": "bx1_offering_eligibility_gate",
    "tgqual": null,
    "tgtype": 23,
    "tgnargs": 0,
    "tgrelid": "25116",
    "tgenabled": "O",
    "tgnewtable": null,
    "tgoldtable": null,
    "tgparentid": "0",
    "tgconstraint": "0",
    "tgdeferrable": false,
    "tgisinternal": false,
    "tgconstrindid": "0",
    "tgconstrrelid": "0",
    "tginitdeferred": false
  }
]$expected_triggers$::jsonb;
  operational_body constant text:=$operational_body$  select coalesce(exists(select 1
    from bx1_portal.products product_row cross join bx1_private.roleplay_policies policy
    where /* investor_operational_begin */
      product_row.id=p_product and policy.id=p_policy and policy.authority_epoch=p_epoch and p_epoch>0
      and policy.product_id=product_row.id and policy.product_organisation_id=product_row.organisation_id
      and policy.offering_revision_id=product_row.current_offering_revision_id and policy.terms_hash=product_row.terms_hash
      and product_row.review_roleplay_policy_id=policy.id and product_row.review_roleplay_epoch=policy.authority_epoch
      and product_row.created_by is not null and product_row.reviewer_id=product_row.created_by
      and product_row.status in ('APPROVED','PUBLISHED') and product_row.terms->>'asset_type'='FUND'
      and product_row.terms->>'terms_version'='3' and product_row.terms->>'currency'='TST'
      and product_row.terms->>'settlement_decimals'='6'
      and policy.status='ACTIVE' and policy.valid_until>pg_catalog.clock_timestamp()
      and policy.actual_operator_person_id=bx1_private.fund_roleplay_person_for(product_row.id,product_row.created_by)
      and bx1_private.test_roleplay_environment() is true
      and bx1_private.fund_roleplay_eligibility_organisation_current(policy.id,policy.authority_epoch,product_row.id) is true
      and bx1_private.fund_roleplay_approved(product_row.id) is true
      and bx1_portal.offering_technical_ready(product_row.current_offering_revision_id) is true
    /* investor_operational_end */),false);
$operational_body$;
  lane_body constant text:=$lane_body$  select coalesce(exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
    where /* investor_write_lane_begin */
      p_product is not null and p_action in ('publish_product','request_product_eligibility','review_product_eligibility',
        'revoke_product_eligibility','subscribe','propose_funding_route','approve_funding_route','open_funding_obligation')
      and auth.uid() is not null and lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.product_id=p_product and lane.action=p_action
      and lane.policy_id is not null and lane.authority_epoch>0
      and lane.request_key is not null and lane.request_key<>'00000000-0000-0000-0000-000000000000'::uuid
      and (p_key is null or lane.request_key=p_key) and (p_context is null or lane.operating_context=p_context)
      and lane.operating_context->>'mode'='ROLE'
      and (case when p_action='open_funding_obligation' then lane.operating_context->>'role' in ('Investor','TreasuryOperator')
        else lane.operating_context->>'role'=case p_action
          when 'publish_product' then 'OfferingManager' when 'request_product_eligibility' then 'Investor'
          when 'subscribe' then 'Investor' when 'review_product_eligibility' then 'ComplianceOfficer'
          when 'revoke_product_eligibility' then 'ComplianceOfficer' when 'propose_funding_route' then 'TreasuryOperator'
          when 'approve_funding_route' then 'FinancialController' end end) is true
      and bx1_private.test_roleplay_protected_session() is true
      and bx1_private.fund_roleplay_lane_current(lane.operating_context,lane.product_id,lane.action) is true
      and bx1_private.fund_roleplay_investor_operational(lane.product_id,lane.policy_id,lane.authority_epoch) is true
    /* investor_write_lane_end */),false);
$lane_body$;
  operational_metadata constant jsonb:=$operational_metadata${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_investor_operational","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_product","p_policy","p_epoch"],"proargtypes":["2950","2950","23"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$operational_metadata$::jsonb;
  lane_metadata constant jsonb:=$lane_metadata${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_investor_write_lane","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_product","p_action","p_key","p_context"],"proargtypes":["2950","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$lane_metadata$::jsonb;
  operational_baseline constant jsonb:=$operational_baseline${"product":{"id":"10000000-0000-4000-8000-000000000001","organisation_id":"10000000-0000-4000-8000-000000000002","current_offering_revision_id":"10000000-0000-4000-8000-000000000003","terms_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","review_roleplay_policy_id":"10000000-0000-4000-8000-000000000004","review_roleplay_epoch":2,"created_by":"10000000-0000-4000-8000-000000000005","reviewer_id":"10000000-0000-4000-8000-000000000005","status":"PUBLISHED","terms":{"asset_type":"FUND","terms_version":3,"currency":"TST","settlement_decimals":6}},"policy":{"id":"10000000-0000-4000-8000-000000000004","authority_epoch":2,"product_id":"10000000-0000-4000-8000-000000000001","product_organisation_id":"10000000-0000-4000-8000-000000000002","offering_revision_id":"10000000-0000-4000-8000-000000000003","terms_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"ACTIVE","valid_until":"2030-01-02T00:00:00Z","actual_operator_person_id":"10000000-0000-4000-8000-000000000006"},"fixture":{"person":"10000000-0000-4000-8000-000000000006","now_at":"2030-01-01T00:00:00Z","environment_ok":true,"organisation_ok":true,"approved_ok":true,"technical_ok":true},"input":{"p_product":"10000000-0000-4000-8000-000000000001","p_policy":"10000000-0000-4000-8000-000000000004","p_epoch":2}}$operational_baseline$::jsonb;
  lane_baseline constant jsonb:=$lane_baseline${"lane":{"transaction_id":"100","actor_id":"10000000-0000-4000-8000-000000000005","product_id":"10000000-0000-4000-8000-000000000001","action":"subscribe","policy_id":"10000000-0000-4000-8000-000000000004","authority_epoch":2,"request_key":"10000000-0000-4000-8000-000000000007","operating_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"Investor"}},"fixture":{"actor":"10000000-0000-4000-8000-000000000005","txid":"100","session_ok":true,"lane_ok":true,"operational_ok":true},"input":{"p_product":"10000000-0000-4000-8000-000000000001","p_action":"subscribe","p_key":"10000000-0000-4000-8000-000000000007","p_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"Investor"}}}$lane_baseline$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_investor_proof_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if current_row is null or current_row-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(current_row->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then raise exception 'fund_investor_proof_dependency_changed';end if;
  end loop;
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.oid),'[]'::jsonb)
      from pg_catalog.pg_trigger t where t.tgfoid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs)))
    is distinct from expected_triggers then raise exception 'fund_investor_proof_trigger_changed';end if;
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p where p.oid=target;
    if target is distinct from (spec->>'oid')::oid or current_row-'prosrc' is distinct from spec->'metadata' then
      raise exception 'fund_investor_proof_existing_metadata_changed';end if;
    restored:=current_row->>'prosrc';
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'cuts') with ordinality parts(value,ordinal) order by ordinal desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>(cut->>'count')::integer then
        raise exception 'fund_investor_proof_missing_or_extra_cut';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from spec->>'sha' then raise exception 'fund_investor_proof_outside_cut_changed';end if;
  end loop;
  foreach target in array array[
    pg_catalog.to_regprocedure('bx1_private.fund_roleplay_investor_operational(uuid,uuid,integer)')::oid,
    pg_catalog.to_regprocedure('bx1_private.fund_roleplay_investor_write_lane(uuid,text,uuid,jsonb)')::oid] loop
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p where p.oid=target;
    if current_row is null or current_row-'prosrc'-'oid' is distinct from
        (case when current_row->>'proname'='fund_roleplay_investor_operational' then operational_metadata else lane_metadata end)
      or current_row->>'prosrc' is distinct from
        (case when current_row->>'proname'='fund_roleplay_investor_operational' then operational_body else lane_body end)
      or exists(select 1 from pg_catalog.pg_proc p cross join lateral
        pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        where p.oid=target and a.grantee<>p.proowner) then raise exception 'fund_investor_proof_private_helper_drift';end if;
  end loop;
  if bx1_private.fund_roleplay_investor_write_lane(null,'subscribe',null,null) is distinct from false then
    raise exception 'fund_investor_proof_null_actor_authority';end if;
  -- Extract the ACTUAL installed operational predicate, substituting only its
  -- pinned authoritative leaf calls with typed query inputs. No business lookup.
  select p.prosrc into source from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_investor_operational(uuid,uuid,integer)');
  predicate:=split_part(split_part(source,'/* investor_operational_begin */',2),'/* investor_operational_end */',1);
  if predicate='' then raise exception 'fund_investor_proof_operational_marker_missing';end if;
  predicate:=replace(predicate,'pg_catalog.clock_timestamp()','fixture.now_at');
  predicate:=replace(predicate,'bx1_private.fund_roleplay_person_for(product_row.id,product_row.created_by)','fixture.person');
  predicate:=replace(predicate,'bx1_private.test_roleplay_environment()','fixture.environment_ok');
  predicate:=replace(predicate,'bx1_private.fund_roleplay_eligibility_organisation_current(policy.id,policy.authority_epoch,product_row.id)','fixture.organisation_ok');
  predicate:=replace(predicate,'bx1_private.fund_roleplay_approved(product_row.id)','fixture.approved_ok');
  predicate:=replace(predicate,'bx1_portal.offering_technical_ready(product_row.current_offering_revision_id)','fixture.technical_ok');
  if strpos(predicate,'bx1_')>0 or strpos(predicate,'clock_timestamp')>0 then raise exception 'fund_investor_proof_unbound_operational_leaf';end if;
  for sample in select value from pg_catalog.jsonb_array_elements($operational_cases$[{"name":"current","expected":true},{"name":"approved_not_yet_published","product":{"status":"APPROVED"},"expected":true},{"name":"missing_tag","product":{"review_roleplay_policy_id":null},"expected":false},{"name":"epoch_mismatch","product":{"review_roleplay_epoch":1},"expected":false},{"name":"foreign_policy","input":{"p_policy":"20000000-0000-4000-8000-000000000004"},"expected":false},{"name":"wrong_product","input":{"p_product":"20000000-0000-4000-8000-000000000001"},"expected":false},{"name":"wrong_organisation","policy":{"product_organisation_id":"20000000-0000-4000-8000-000000000002"},"expected":false},{"name":"wrong_offering","policy":{"offering_revision_id":"20000000-0000-4000-8000-000000000003"},"expected":false},{"name":"wrong_terms","policy":{"terms_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"expected":false},{"name":"wrong_reviewer","product":{"reviewer_id":"20000000-0000-4000-8000-000000000005"},"expected":false},{"name":"wrong_asset","product":{"terms":{"asset_type":"REAL_ESTATE","terms_version":3,"currency":"TST","settlement_decimals":6}},"expected":false},{"name":"wrong_currency","product":{"terms":{"asset_type":"FUND","terms_version":3,"currency":"ZAR","settlement_decimals":6}},"expected":false},{"name":"revoked_policy","policy":{"status":"REVOKED"},"expected":false},{"name":"expired_policy","policy":{"valid_until":"2029-12-31T00:00:00Z"},"expected":false},{"name":"wrong_person","fixture":{"person":null},"expected":false},{"name":"environment_ok_false","fixture":{"environment_ok":false},"expected":false},{"name":"environment_ok_null","fixture":{"environment_ok":null},"expected":false},{"name":"organisation_ok_false","fixture":{"organisation_ok":false},"expected":false},{"name":"organisation_ok_null","fixture":{"organisation_ok":null},"expected":false},{"name":"approved_ok_false","fixture":{"approved_ok":false},"expected":false},{"name":"approved_ok_null","fixture":{"approved_ok":null},"expected":false},{"name":"technical_ok_false","fixture":{"technical_ok":false},"expected":false},{"name":"technical_ok_null","fixture":{"technical_ok":null},"expected":false},{"name":"missing_product","missing":true,"expected":false}]$operational_cases$::jsonb) loop
    product_row:=(operational_baseline->'product')||coalesce(sample->'product','{}'::jsonb);
    policy_row:=(operational_baseline->'policy')||coalesce(sample->'policy','{}'::jsonb);
    fixture_row:=(operational_baseline->'fixture')||coalesce(sample->'fixture','{}'::jsonb);
    input_row:=(operational_baseline->'input')||coalesce(sample->'input','{}'::jsonb);
    query:=pg_catalog.format($query$
      select coalesce(exists(select 1 from pg_catalog.jsonb_to_recordset(%L::jsonb) product_row(
        id uuid,organisation_id uuid,current_offering_revision_id uuid,terms_hash text,review_roleplay_policy_id uuid,
        review_roleplay_epoch integer,created_by uuid,reviewer_id uuid,status text,terms jsonb)
      cross join pg_catalog.jsonb_to_record(%L::jsonb) policy(id uuid,authority_epoch integer,product_id uuid,
        product_organisation_id uuid,offering_revision_id uuid,terms_hash text,status text,valid_until timestamptz,actual_operator_person_id uuid)
      cross join pg_catalog.jsonb_to_record(%L::jsonb) fixture(person uuid,now_at timestamptz,environment_ok boolean,
        organisation_ok boolean,approved_ok boolean,technical_ok boolean)
      cross join pg_catalog.jsonb_to_record(%L::jsonb) input(p_product uuid,p_policy uuid,p_epoch integer)
      where %s),false)$query$,
      case when sample->'missing'='true'::jsonb then '[]'::jsonb else pg_catalog.jsonb_build_array(product_row) end,
      policy_row,fixture_row,input_row,predicate);
    execute query into actual;
    if actual is distinct from (sample->>'expected')::boolean then raise exception 'fund_investor_proof_operational_case: %',sample->>'name';end if;
    op_count:=op_count+1;
  end loop;
  -- Exact same transaction/actor/key/context/action conditions from the helper.
  select p.prosrc into source from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_investor_write_lane(uuid,text,uuid,jsonb)');
  predicate:=split_part(split_part(source,'/* investor_write_lane_begin */',2),'/* investor_write_lane_end */',1);
  predicate:=replace(predicate,'auth.uid()','fixture.actor');
  predicate:=replace(predicate,'pg_catalog.pg_current_xact_id()','fixture.txid');
  predicate:=replace(predicate,'bx1_private.test_roleplay_protected_session()','fixture.session_ok');
  predicate:=replace(predicate,'bx1_private.fund_roleplay_lane_current(lane.operating_context,lane.product_id,lane.action)','fixture.lane_ok');
  predicate:=replace(predicate,'bx1_private.fund_roleplay_investor_operational(lane.product_id,lane.policy_id,lane.authority_epoch)','fixture.operational_ok');
  if predicate='' or strpos(predicate,'bx1_')>0 or strpos(predicate,'auth.')>0 then raise exception 'fund_investor_proof_unbound_lane_leaf';end if;
  for sample in select value from pg_catalog.jsonb_array_elements($lane_cases$[{"name":"exact_writer","expected":true},{"name":"closed_trigger_derivation","input":{"p_key":null,"p_context":null},"expected":true},{"name":"wrong_actor","fixture":{"actor":"20000000-0000-4000-8000-000000000005"},"expected":false},{"name":"null_actor","fixture":{"actor":null},"expected":false},{"name":"wrong_transaction","fixture":{"txid":"101"},"expected":false},{"name":"wrong_product","input":{"p_product":"20000000-0000-4000-8000-000000000001"},"expected":false},{"name":"wrong_action","input":{"p_action":"publish_product"},"expected":false},{"name":"unsupported_action","lane":{"action":"create_product"},"input":{"p_action":"create_product"},"expected":false},{"name":"wrong_key","input":{"p_key":"20000000-0000-4000-8000-000000000007"},"expected":false},{"name":"zero_saved_key","lane":{"request_key":"00000000-0000-0000-0000-000000000000"},"input":{"p_key":null},"expected":false},{"name":"missing_saved_key","lane":{"request_key":null},"input":{"p_key":null},"expected":false},{"name":"wrong_context","input":{"p_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"ComplianceOfficer"}},"expected":false},{"name":"wrong_lane_role","lane":{"operating_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"ComplianceOfficer"}},"input":{"p_context":null},"expected":false},{"name":"missing_policy","lane":{"policy_id":null},"expected":false},{"name":"invalid_epoch","lane":{"authority_epoch":0},"expected":false},{"name":"session_ok_false","fixture":{"session_ok":false},"expected":false},{"name":"session_ok_null","fixture":{"session_ok":null},"expected":false},{"name":"lane_ok_false","fixture":{"lane_ok":false},"expected":false},{"name":"lane_ok_null","fixture":{"lane_ok":null},"expected":false},{"name":"operational_ok_false","fixture":{"operational_ok":false},"expected":false},{"name":"operational_ok_null","fixture":{"operational_ok":null},"expected":false},{"name":"missing_lane","missing":true,"expected":false}]$lane_cases$::jsonb) loop
    lane_row:=(lane_baseline->'lane')||coalesce(sample->'lane','{}'::jsonb);
    fixture_row:=(lane_baseline->'fixture')||coalesce(sample->'fixture','{}'::jsonb);
    input_row:=(lane_baseline->'input')||coalesce(sample->'input','{}'::jsonb);
    query:=pg_catalog.format($query$
      select coalesce(exists(select 1 from pg_catalog.jsonb_to_recordset(%L::jsonb) lane(
        transaction_id xid8,actor_id uuid,product_id uuid,action text,policy_id uuid,authority_epoch integer,
        request_key uuid,operating_context jsonb)
      cross join pg_catalog.jsonb_to_record(%L::jsonb) fixture(actor uuid,txid xid8,session_ok boolean,lane_ok boolean,operational_ok boolean)
      cross join pg_catalog.jsonb_to_record(%L::jsonb) input(p_product uuid,p_action text,p_key uuid,p_context jsonb)
      where %s),false)$query$,
      case when sample->'missing'='true'::jsonb then '[]'::jsonb else pg_catalog.jsonb_build_array(lane_row) end,
      fixture_row,input_row,predicate);
    execute query into actual;
    if actual is distinct from (sample->>'expected')::boolean then raise exception 'fund_investor_proof_lane_case: %',sample->>'name';end if;
    lane_count:=lane_count+1;
  end loop;
  -- ACTUAL retained-request exclusion from the installed subscribe enter arm.
  -- This result means "do not add provenance", never "approve a subscription".
  select p.prosrc into source from pg_catalog.pg_proc p where p.oid=37279::oid;
  predicate:=substring(source from strpos(source,'    if exists(select 1 from bx1_portal.scoped_requests prior')+length('    if '));
  predicate:=split_part(predicate,' then return;end if;',1);
  if predicate='' or strpos(predicate,'receipt.action=''subscribe''')<=0 then raise exception 'fund_investor_proof_replay_predicate_missing';end if;
  predicate:=replace(predicate,'auth.uid()','fixture.actor');
  predicate:=replace(predicate,'bx1_private.fund_roleplay_record_current(receipt.policy_id,receipt.authority_epoch,receipt.product_id,'||E'\n'||
    '            receipt.offering_revision_id,receipt.actual_actor_id,receipt.operating_context,receipt.action)','fixture.receipt_current');
  if strpos(predicate,'fund_roleplay_record_current')>0 then raise exception 'fund_investor_proof_replay_leaf_changed';end if;
  extra:=$replay_baseline${"prior":{"actor_id":"10000000-0000-4000-8000-000000000005","request_key":"10000000-0000-4000-8000-000000000007","command":"subscribe","payload":{"product_id":"10000000-0000-4000-8000-000000000001","investment_account_id":"10000000-0000-4000-8000-000000000008","units":"100"},"operating_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"Investor"}},"receipt":{"actual_actor_id":"10000000-0000-4000-8000-000000000005","request_key":"10000000-0000-4000-8000-000000000007","action":"subscribe","policy_id":"10000000-0000-4000-8000-000000000004","authority_epoch":2,"product_id":"10000000-0000-4000-8000-000000000001","offering_revision_id":"10000000-0000-4000-8000-000000000003","operating_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"Investor"}},"fixture":{"actor":"10000000-0000-4000-8000-000000000005","receipt_current":true},"input":{"product":"10000000-0000-4000-8000-000000000001","key":"10000000-0000-4000-8000-000000000007","c":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"Investor"},"body":{"product_id":"10000000-0000-4000-8000-000000000001","investment_account_id":"10000000-0000-4000-8000-000000000008","units":"100"}}}$replay_baseline$::jsonb;
  for sample in select value from jsonb_array_elements($replay_cases$[{"name":"fresh_key","no_prior":true,"no_receipt":true,"skip":false},{"name":"retained_ordinary","no_receipt":true,"skip":true},{"name":"retained_matching_tag","skip":false},{"name":"old_policy_revoked","fixture":{"receipt_current":false},"skip":true},{"name":"old_policy_unknown","fixture":{"receipt_current":null},"skip":true},{"name":"foreign_product","receipt":{"product_id":"20000000-0000-4000-8000-000000000001"},"skip":true},{"name":"foreign_actor","receipt":{"actual_actor_id":"20000000-0000-4000-8000-000000000005"},"skip":true},{"name":"foreign_key","receipt":{"request_key":"20000000-0000-4000-8000-000000000007"},"skip":true},{"name":"foreign_context","receipt":{"operating_context":{"mode":"ROLE","organisationId":"10000000-0000-4000-8000-000000000002","role":"ComplianceOfficer"}},"skip":true},{"name":"different_saved_payload","prior":{"payload":{"product_id":"10000000-0000-4000-8000-000000000001","investment_account_id":"10000000-0000-4000-8000-000000000008","units":"101"}},"skip":true},{"name":"different_saved_command","prior":{"command":"request_product_eligibility"},"skip":true}]$replay_cases$::jsonb) loop
    candidate:=(extra->'prior')||coalesce(sample->'prior','{}'::jsonb);
    row_value:=(extra->'receipt')||coalesce(sample->'receipt','{}'::jsonb);
    fixture_row:=(extra->'fixture')||coalesce(sample->'fixture','{}'::jsonb);
    input_row:=extra->'input';
    query:=replace(predicate,'bx1_portal.scoped_requests prior',
      'jsonb_to_recordset('||quote_literal((case when sample->'no_prior'='true'::jsonb then '[]'::jsonb else jsonb_build_array(candidate) end)::text)
      ||'::jsonb) prior(actor_id uuid,request_key uuid,command text,payload jsonb,operating_context jsonb)');
    query:=replace(query,'bx1_private.fund_roleplay_command_receipts receipt',
      'jsonb_to_recordset('||quote_literal((case when sample->'no_receipt'='true'::jsonb then '[]'::jsonb else jsonb_build_array(row_value) end)::text)
      ||'::jsonb) receipt(actual_actor_id uuid,request_key uuid,action text,policy_id uuid,authority_epoch integer,product_id uuid,offering_revision_id uuid,operating_context jsonb)');
    execute format('select (%s) from jsonb_to_record(%L::jsonb) fixture(actor uuid,receipt_current boolean) cross join jsonb_to_record(%L::jsonb) input(product uuid,key uuid,c jsonb,body jsonb)',
      query,fixture_row,input_row) into actual;
    if actual is distinct from (sample->>'skip')::boolean then raise exception 'fund_investor_proof_replay_case: %',sample->>'name';end if;
  end loop;
  -- Derive the immutable graph rows from its exact pinned SELECT source, not
  -- a second optimistic hardcoded list. This SELECT reads reference VALUES only.
  select pg_catalog.btrim(p.prosrc,E' \n\t;') into source from pg_catalog.pg_proc p where p.oid=33604::oid;
  execute 'select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(graph)) from ('||source||') graph(step_key,ordinal,kind)' into graph_rows;
  if pg_catalog.jsonb_array_length(graph_rows)<>25 then raise exception 'fund_investor_proof_graph_not_25';end if;
  setup_row:=pg_catalog.jsonb_build_object('id','30000000-0000-4000-8000-000000000001','actor_id','30000000-0000-4000-8000-000000000002',
    'operating_context',pg_catalog.jsonb_build_object('mode','ROLE','organisationId','30000000-0000-4000-8000-000000000003','role','TokenisationAgent'),
    'safe_observation_id','30000000-0000-4000-8000-000000000999','safe_address','0x'||repeat('d',40),
    'safe_owners',pg_catalog.jsonb_build_array('0x'||repeat('a',40),'0x'||repeat('b',40)),'safe_threshold',2);
  step_rows:='[]'::jsonb;observation_rows:='[]'::jsonb;
  for row_value in select value from pg_catalog.jsonb_array_elements(graph_rows) loop
    candidate:=row_value||pg_catalog.jsonb_build_object('id',lpad(row_value->>'ordinal',32,'0')::uuid,
      'setup_id',setup_row->'id','state','FINAL','observation_id',lpad((100+(row_value->>'ordinal')::integer)::text,32,'0')::uuid,
      'intent_hash',repeat('a',64),'transaction_hash','0x'||repeat('b',64),
      'intent',pg_catalog.jsonb_build_object('expected_runtime_hash','0x'||repeat('c',64),'expected_address','0x'||repeat('d',40),'checks',pg_catalog.jsonb_build_array('ACTUAL_CHECK')));
    step_rows:=step_rows||pg_catalog.jsonb_build_array(candidate);
    first_result:=pg_catalog.jsonb_build_object('chain_id',80002,'status','FINAL','step_key',candidate->'step_key',
      'intent_hash',candidate->'intent_hash','transaction_hash',candidate->'transaction_hash',
      'runtime_hash',candidate#>'{intent,expected_runtime_hash}','checks',candidate#>'{intent,checks}',
      'contract_address',case when candidate->>'kind'='CREATE' then to_jsonb('0x'||repeat('d',40)) else 'null'::jsonb end);
    observation_rows:=observation_rows||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',candidate->'observation_id','setup_id',setup_row->'id',
      'step_id',candidate->'id','actor_id',setup_row->'actor_id','operating_context',setup_row->'operating_context',
      'result',first_result,'result_hash',bx1_portal.fund_digest(first_result)));
  end loop;
  step_rows:=step_rows||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','30000000-0000-4000-8000-000000000998',
    'setup_id',setup_row->'id','step_key','safe_creation','ordinal',0,'kind','CALL','state','FINAL',
    'observation_id','30000000-0000-4000-8000-000000000997'));
  first_result:=pg_catalog.jsonb_build_object('status','VERIFIED_CODE_AND_STATE','address',setup_row->'safe_address',
    'owners',setup_row->'safe_owners','threshold',setup_row->'safe_threshold');
  observation_rows:=observation_rows||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',setup_row->'safe_observation_id',
    'setup_id',setup_row->'id','step_id',null,'actor_id',setup_row->'actor_id','operating_context',setup_row->'operating_context',
    'result',first_result,'result_hash',bx1_portal.fund_digest(first_result)));
  select p.prosrc into source from pg_catalog.pg_proc p where p.oid=36417::oid;
  select value into spec from pg_catalog.jsonb_array_elements(specs) item where (value->>'oid')::integer=36417;
  predicate:=spec#>>'{cuts,0,to}';
  if strpos(source,predicate)<=0 then raise exception 'fund_investor_proof_coverage_not_installed';end if;
  -- Keep these query-only baseline arrays; mutations below never touch tables.
  fixture_row:=pg_catalog.jsonb_build_object('steps',step_rows,'observations',observation_rows);
  foreach case_name in array array['complete_26','safe_plus_24','missing_observation','foreign_observation_setup','foreign_observation_step',
    'wrong_intent','wrong_transaction','pending_observation','wrong_runtime','wrong_checks','wrong_kind','wrong_ordinal',
    'reused_observation','missing_safe_observation','wrong_safe_owners'] loop
    step_rows:=fixture_row->'steps';observation_rows:=fixture_row->'observations';
    if case_name='safe_plus_24' then step_rows:=step_rows-24;
    elsif case_name='missing_observation' then observation_rows:=observation_rows-0;
    elsif case_name='foreign_observation_setup' then observation_rows:=jsonb_set(observation_rows,'{0,setup_id}','"40000000-0000-4000-8000-000000000001"'::jsonb);
    elsif case_name='foreign_observation_step' then observation_rows:=jsonb_set(observation_rows,'{0,step_id}','"40000000-0000-4000-8000-000000000001"'::jsonb);
    elsif case_name='wrong_intent' then observation_rows:=jsonb_set(observation_rows,'{0,result,intent_hash}',to_jsonb(repeat('b',64)));
    elsif case_name='wrong_transaction' then observation_rows:=jsonb_set(observation_rows,'{0,result,transaction_hash}',to_jsonb('0x'||repeat('c',64)));
    elsif case_name='pending_observation' then observation_rows:=jsonb_set(observation_rows,'{0,result,status}','"PENDING"'::jsonb);
    elsif case_name='wrong_runtime' then observation_rows:=jsonb_set(observation_rows,'{0,result,runtime_hash}',to_jsonb('0x'||repeat('e',64)));
    elsif case_name='wrong_checks' then observation_rows:=jsonb_set(observation_rows,'{0,result,checks}','[]'::jsonb);
    elsif case_name='wrong_kind' then step_rows:=jsonb_set(step_rows,'{0,kind}','"CALL"'::jsonb);
    elsif case_name='wrong_ordinal' then step_rows:=jsonb_set(step_rows,'{0,ordinal}','25'::jsonb);
    elsif case_name='reused_observation' then step_rows:=jsonb_set(step_rows,'{1,observation_id}',step_rows#>'{0,observation_id}');
    elsif case_name='missing_safe_observation' then observation_rows:=observation_rows-25;
    elsif case_name='wrong_safe_owners' then observation_rows:=jsonb_set(observation_rows,'{25,result,owners}','[]'::jsonb);
    end if;
    -- Recompute public-result digests so each negative tests the actual binding,
    -- rather than failing only an unrelated unchanged JSON digest.
    select jsonb_agg(value||jsonb_build_object('result_hash',bx1_portal.fund_digest(value->'result')) order by ordinal)
      into observation_rows from jsonb_array_elements(observation_rows) with ordinality items(value,ordinal);
    query:=replace(predicate,'bx1_portal.fund_setup_graph() graph',
      'pg_catalog.jsonb_to_recordset('||quote_literal(graph_rows::text)||'::jsonb) graph(step_key text,ordinal integer,kind text)');
    query:=replace(query,'bx1_portal.fund_setup_graph()',
      'pg_catalog.jsonb_to_recordset('||quote_literal(graph_rows::text)||'::jsonb) graph_count(step_key text,ordinal integer,kind text)');
    query:=replace(query,'bx1_portal.fund_setup_steps step',
      'pg_catalog.jsonb_to_recordset('||quote_literal(step_rows::text)||'::jsonb) step(id uuid,setup_id uuid,step_key text,ordinal integer,kind text,state text,observation_id uuid,intent_hash text,transaction_hash text,intent jsonb)');
    query:=replace(query,'bx1_portal.fund_setup_observations observed',
      'pg_catalog.jsonb_to_recordset('||quote_literal(observation_rows::text)||'::jsonb) observed(id uuid,setup_id uuid,step_id uuid,actor_id uuid,operating_context jsonb,result jsonb,result_hash text)');
    execute pg_catalog.format('select (%s) from pg_catalog.jsonb_to_record(%L::jsonb) s(id uuid,actor_id uuid,operating_context jsonb,safe_observation_id uuid,safe_address text,safe_owners jsonb,safe_threshold integer)',query,setup_row) into actual;
    if actual is distinct from (case_name<>'complete_26') then raise exception 'fund_investor_proof_graph_case: %',case_name;end if;
    if case_name in ('complete_26','safe_plus_24') then
      select count(*)<>25 into old_rejected from jsonb_to_recordset(step_rows) sample_step(state text,observation_id uuid)
        where state='FINAL' and observation_id is not null;
      if old_rejected is distinct from (case_name='complete_26') then raise exception 'fund_investor_proof_old_count_counterexample';end if;
    end if;
    coverage_count:=coverage_count+1;
  end loop;
  -- Current selector: ordinary rows keep the original predicate; a failed tag
  -- never falls back to ordinary truth. Execute the ACTUAL installed CASE.
  select p.prosrc into source from pg_catalog.pg_proc p where p.oid=31496::oid;
  select value into spec from jsonb_array_elements(specs) where (value->>'oid')::integer=31496;
  predicate:=spec#>>'{cuts,0,to}';
  if strpos(source,predicate)<=0 then raise exception 'fund_investor_proof_manifest_selector_missing';end if;
  predicate:=replace(predicate,'bx1_private.fund_roleplay_eligibility_organisation_current(m.roleplay_policy_id,m.roleplay_epoch,m.product_id)','fixture.tag_current');
  predicate:=replace(predicate,'bx1_portal.current_product_organisation(p.organisation_id)','fixture.ordinary_current');
  for sample in select * from (values
    (jsonb_build_object('tag',null,'tag_current',false,'ordinary_current',true,'expected',true)),
    (jsonb_build_object('tag',null,'tag_current',true,'ordinary_current',false,'expected',false)),
    (jsonb_build_object('tag','10000000-0000-4000-8000-000000000004','tag_current',true,'ordinary_current',false,'expected',true)),
    (jsonb_build_object('tag','10000000-0000-4000-8000-000000000004','tag_current',false,'ordinary_current',true,'expected',false)),
    (jsonb_build_object('tag','10000000-0000-4000-8000-000000000004','tag_current',null,'ordinary_current',true,'expected',null))
    ) cases(value) loop
    execute format('select %s from jsonb_to_record(%L::jsonb) m(roleplay_policy_id uuid) cross join jsonb_to_record(%L::jsonb) fixture(tag_current boolean,ordinary_current boolean)',
      predicate,jsonb_build_object('roleplay_policy_id',sample->'tag'),sample) into actual;
    if actual is distinct from (sample->>'expected')::boolean then raise exception 'fund_investor_proof_manifest_fallback';end if;
  end loop;
  if op_count<>24 or lane_count<>22 or coverage_count<>15 then raise exception 'fund_investor_proof_case_count';end if;
  if current_setting('request.jwt.claims',true) is distinct from before_claims
    or current_setting('request.jwt.claim.sub',true) is distinct from before_sub then raise exception 'fund_investor_proof_claims_changed';end if;
end $fund_investor_continuation_proof$;
