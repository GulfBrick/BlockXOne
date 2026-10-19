-- AC-FIN-6: exact TEST investor handoffs. Installs no business result.
-- Frozen contract 3848BCBE2587D6D65E1944EE449B27D39600C68752F5573B4B35673D7DF6C175.
-- Existing canonical sources, global ordinary helpers and their metadata stay pinned.
do $fund_investor_continuation$
declare spec jsonb; cut jsonb; dependency jsonb; helper_spec jsonb; permission record;
  original text; next_body text; restored text; definition text; current_row jsonb; after_row jsonb;
  target oid; helper oid; originals integer:=0; finals integer:=0; bootstrap boolean;
  dependencies_before jsonb; trigger_before jsonb;
  specs constant jsonb:=$specs$[
  {
    "oid": 36417,
    "signature": "bx1_portal.fund_admission_seed(uuid,integer,jsonb)",
    "original": "\ndeclare s bx1_portal.fund_setups;r bx1_portal.offering_revisions;p bx1_private.roleplay_policies;\n  proof bx1_portal.fund_contract_release_receipts;owners jsonb;wallet record;classes jsonb;limit_units numeric;\nbegin\n  select * into s from bx1_portal.fund_setups where id=sid;\n  if s.id is null or s.revision<>expected or not bx1_portal.fund_setup_current(s.id,c)\n    or not bx1_portal.fund_setup_context(c,s.product_id,true) or not bx1_portal.fund_setup_package_approved(s.product_id)\n    or s.safe_state<>'VERIFIED' or s.recovery_hold or s.configuration is null\n    or (select count(*) from bx1_portal.fund_setup_steps where setup_id=s.id and state='FINAL' and observation_id is not null)<>25 then\n    raise exception 'fund_admission_current_verified_setup_required' using errcode='42501';end if;\n  select * into p from bx1_private.roleplay_policies where id=(s.roleplay_policy->>'policy_id')::uuid;\n  if p.id is null or not bx1_private.test_roleplay_current(p.id,s.product_id,s.offering_revision_id,auth.uid(),c,'admit_fund_release',null,p.authority_epoch)\n    or p.authority_epoch<>(s.roleplay_policy->>'epoch')::integer then\n    raise exception 'fund_admission_explicit_test_policy_required' using errcode='42501';end if;\n  select * into r from bx1_portal.offering_revisions where id=s.offering_revision_id and product_id=s.product_id;\n  select * into proof from bx1_portal.fund_contract_release_receipts where source_pin=s.source_pin and catalog_hash=s.catalog_hash\n    and valid_until>pg_catalog.clock_timestamp() order by recorded_at desc limit 1;\n  if proof.id is null then raise exception 'fund_admission_real_conformance_receipt_required' using errcode='23514';end if;\n  owners:='[]'::jsonb;\n  for wallet in select * from bx1_private.roleplay_wallet_slots where policy_id=p.id and user_id=auth.uid() and role='TokenisationAgent' order by wallet_address loop\n    if not bx1_private.fund_roleplay_control_proof_current(p.id,p.authority_epoch,wallet.slot,auth.uid()) then\n      raise exception 'fund_admission_actual_signing_key_proof_required' using errcode='42501';end if;\n    owners:=owners||to_jsonb(wallet.wallet_address);\n  end loop;\n  if jsonb_array_length(owners)<2 or owners is distinct from s.safe_owners or s.safe_threshold<2\n    or s.safe_threshold is distinct from (r.terms#>>'{deployment_configuration,signing,threshold}')::integer\n    or s.safe_threshold>jsonb_array_length(owners) then raise exception 'fund_admission_exact_safe_quorum_required' using errcode='23514';end if;\n  if (select count(distinct role) from bx1_private.roleplay_capacities where policy_id=p.id and user_id=auth.uid()\n    and role in ('IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController')\n    and bx1_portal.native_membership_effective(native_membership_id))<>6 then\n    raise exception 'fund_admission_operating_capacities_required' using errcode='42501';end if;\n  classes:=r.terms#>'{common_envelope,classes,0}';limit_units:=(r.terms->>'cap_units')::numeric*power(10::numeric,(classes->>'decimals')::integer);\n  return jsonb_build_object('setup',bx1_portal.fund_setup_projection(s.product_id,c),'conformance_receipt_id',proof.id,\n    'class_id',classes->>'class_id','class_name',classes->>'name','security_unit_decimals',(classes->>'decimals')::integer,\n    'token_name',r.terms->>'name','token_symbol','BX1F','cap_units',r.terms->>'cap_units','maximum_operation_units',limit_units::numeric(78,0)::text,\n    'claim_topics',jsonb_build_array('1'),'deployment_salt','bx1:'||r.id::text,'signer_address',owners->>0,\n    'authority_epoch',p.authority_epoch,'required_confirmations',64);\nend ",
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
    },
    "sha": "0607cb0ff25e24bf5d3dd9f838d1e463228dfa1e4da79a516011aa1d3f5ca6d6",
    "cuts": [
      {
        "from": "(select count(*) from bx1_portal.fund_setup_steps where setup_id=s.id and state='FINAL' and observation_id is not null)<>25",
        "to": "(select count(*) from bx1_portal.fund_setup_graph())<>25\n    or exists(select 1 from bx1_portal.fund_setup_graph() graph\n      left join bx1_portal.fund_setup_steps step on step.setup_id=s.id and step.step_key=graph.step_key\n        and step.ordinal=graph.ordinal and step.kind=graph.kind\n      left join bx1_portal.fund_setup_observations observed on observed.id=step.observation_id\n        and observed.setup_id=s.id and observed.step_id=step.id\n      where step.id is null or step.state is distinct from 'FINAL' or observed.id is null\n        or observed.actor_id is distinct from s.actor_id or observed.operating_context is distinct from s.operating_context\n        or observed.result_hash is distinct from bx1_portal.fund_digest(observed.result)\n        or observed.result->>'status' is distinct from 'FINAL' or observed.result->>'chain_id' is distinct from '80002'\n        or observed.result->>'step_key' is distinct from step.step_key\n        or step.intent_hash is null or observed.result->>'intent_hash' is distinct from step.intent_hash\n        or step.transaction_hash is null or observed.result->>'transaction_hash' is distinct from step.transaction_hash\n        or observed.result->>'runtime_hash' is distinct from step.intent->>'expected_runtime_hash'\n        or observed.result->'checks' is distinct from step.intent->'checks'\n        or (step.kind='CREATE' and observed.result->>'contract_address' is distinct from step.intent->>'expected_address')\n        or (step.kind='CALL' and observed.result->'contract_address' is distinct from 'null'::jsonb))\n    or exists(select 1 from bx1_portal.fund_setup_steps step where step.setup_id=s.id\n      and not (step.step_key='safe_creation' and step.ordinal=0 and step.kind='CALL')\n      and not exists(select 1 from bx1_portal.fund_setup_graph() graph\n        where graph.step_key=step.step_key and graph.ordinal=step.ordinal and graph.kind=step.kind))\n    or not exists(select 1 from bx1_portal.fund_setup_observations observed\n      where observed.id=s.safe_observation_id and observed.setup_id=s.id and observed.step_id is null\n        and observed.actor_id=s.actor_id and observed.operating_context=s.operating_context\n        and observed.result_hash=bx1_portal.fund_digest(observed.result)\n        and observed.result->>'status'='VERIFIED_CODE_AND_STATE'\n        and observed.result->>'address'=s.safe_address and observed.result->'owners'=s.safe_owners\n        and observed.result->>'threshold'=s.safe_threshold::text)",
        "count": 1
      }
    ]
  },
  {
    "oid": 31496,
    "signature": "bx1_portal.fund_manifest_current(uuid)",
    "original": "\n  select exists(select 1 from bx1_portal.fund_release_manifests m\n    join bx1_portal.products p on p.id=m.product_id and p.current_offering_revision_id=m.offering_revision_id\n    join bx1_portal.offering_revisions r on r.id=m.offering_revision_id and r.product_id=p.id\n    join bx1_portal.entry_configuration c on c.singleton and c.environment=m.environment\n    where m.id=target and (m.roleplay_policy_id is null or bx1_private.fund_roleplay_record_current(m.roleplay_policy_id,m.roleplay_epoch,m.product_id,m.offering_revision_id,m.admitted_by,m.roleplay_context,'admit_fund_release')) and m.status='ADMITTED' and m.admitted_until>pg_catalog.clock_timestamp()\n      and m.terms_hash=r.terms_hash and p.terms_hash=r.terms_hash\n      and r.terms->>'asset_type'='FUND' and r.terms->>'terms_version'='3' and r.terms->>'currency'='TST'\n      and r.terms->>'settlement_decimals'='6' and m.configuration_hash=r.deployment_configuration_hash\n      and r.terms#>>'{deployment_configuration,primary_class_id}'=m.class_id::text\n      and r.terms#>>'{common_envelope,classes,0,class_id}'=m.class_id::text\n      and r.terms#>>'{common_envelope,classes,0,name}'=m.class_name\n      and r.terms#>>'{common_envelope,classes,0,decimals}'=m.security_unit_decimals::text\n      and m.deployment_expectation#>>'{manifest,token_details,name}'=r.terms->>'name'\n      and m.deployment_expectation#>>'{manifest,token_details,decimals}'=m.security_unit_decimals::text\n      and (m.deployment_expectation#>>'{manifest,maximum_supply}')::numeric\n        =(r.terms->>'cap_units')::numeric*pg_catalog.power(10::numeric,m.security_unit_decimals)\n      and m.deployment_expectation#>>'{manifest,product_binding_hash}'=m.product_binding_hash\n      and m.issuance_expectation#>>'{manifest,product_binding_hash}'=m.product_binding_hash\n      and m.environment='TESTNET' and m.chain_id=80002\n      and bx1_portal.current_product_organisation(p.organisation_id)\n      and bx1_portal.offering_workflow_approved(p.id)\n      and exists(select 1 from bx1_portal.offering_decisions i\n        join bx1_portal.offering_decisions c on c.offering_revision_id=i.offering_revision_id and c.decision_kind='COMPLIANCE'\n        where i.offering_revision_id=r.id and i.decision_kind='ISSUER'\n          and i.decision='APPROVED' and c.decision='APPROVED'\n          and bx1_private.offering_signature_decisions_current(r.id,i.id,c.id)));\n",
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
    },
    "sha": "b06a74fa8f0a1ad435d678af5a62cde193f3242db0446922b9491fd052c2d153",
    "cuts": [
      {
        "from": "bx1_portal.current_product_organisation(p.organisation_id)",
        "to": "(case when m.roleplay_policy_id is not null then bx1_private.fund_roleplay_eligibility_organisation_current(m.roleplay_policy_id,m.roleplay_epoch,m.product_id) else bx1_portal.current_product_organisation(p.organisation_id) end)",
        "count": 1
      }
    ]
  },
  {
    "oid": 25738,
    "signature": "bx1_portal.guard_offering_publication()",
    "original": "\nbegin\n  if new.status<>'PUBLISHED' then return new; end if;\n  if tg_op='INSERT' then\n    raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;\n  if new.terms is distinct from old.terms\n    or new.terms_hash is distinct from old.terms_hash\n    or new.current_offering_revision_id is distinct from old.current_offering_revision_id then\n    raise exception 'offering_published_package_immutable' using errcode='23514'; end if;\n  if old.status is distinct from 'PUBLISHED' and bx1_portal.offering_operational(new.id) is not true then\n    raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;\n  return new;\nend ",
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
    },
    "sha": "16998557a368f6f8847082838f58f8256e7ccfeea36b9f20c338d38df7b3feb2",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(new.id)",
        "to": "(case when new.review_roleplay_policy_id is not null then\n    (old.status='APPROVED' and new.revision=old.revision+1 and exists(\n      select 1 from bx1_private.fund_roleplay_command_lanes lane\n      where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n        and lane.product_id=new.id and lane.action='publish_product'\n        and bx1_private.fund_roleplay_investor_write_lane(new.id,'publish_product',lane.request_key,lane.operating_context)\n        and bx1_private.fund_roleplay_manager_publish_lane(new.id,lane.request_key,lane.operating_context)))\n    else bx1_portal.offering_operational(new.id) end)",
        "count": 1
      }
    ]
  },
  {
    "oid": 37275,
    "signature": "bx1_private.fund_roleplay_eligibility_source(uuid)",
    "original": "\n  select coalesce(exists(select 1 from bx1_portal.product_eligibility_cases e\n    join bx1_portal.investment_accounts i on i.id=e.investment_account_id and i.holder_user_id=e.holder_user_id\n    join bx1_portal.applications a on a.id=i.application_id and a.user_id=e.holder_user_id\n    join bx1_portal.products p on p.id=e.product_id and p.organisation_id=e.organisation_id\n    join bx1_portal.organisations o on o.id=p.organisation_id\n    join bx1_private.roleplay_policies rp on rp.id=e.roleplay_policy_id and rp.authority_epoch=e.roleplay_epoch\n    where e.id=target and e.account_kind='INDIVIDUAL' and i.kind='INDIVIDUAL' and i.status='ACTIVE'\n      and a.persona='INVESTOR' and a.status='APPROVED' and a.approved_until>pg_catalog.clock_timestamp()\n      and bx1_portal.monitoring_new_action_allowed(a.id) and e.application_revision=a.revision\n      and a.details->>'investor_type'='INDIVIDUAL' and o.reviewer_scope=a.reviewer_scope\n      and p.terms->'eligible_countries' ? (a.details->>'country')\n      and p.terms->'eligible_investor_types' ? (a.details->>'investor_type')\n      and e.product_revision=p.revision and e.terms_hash=p.terms_hash\n      and e.offering_revision_id=p.current_offering_revision_id and rp.offering_revision_id=e.offering_revision_id\n      and rp.product_id=p.id and rp.terms_hash=e.terms_hash and p.status='PUBLISHED'\n      and bx1_portal.offering_operational(p.id) and bx1_portal.entry_manual_review_enabled()\n      and p.created_by=e.holder_user_id and o.owner_id=e.holder_user_id\n      and bx1_private.fund_roleplay_record_current(rp.id,rp.authority_epoch,p.id,e.offering_revision_id,\n        e.holder_user_id,e.roleplay_request_context,'request_product_eligibility')\n      and bx1_private.fund_roleplay_eligibility_organisation_current(rp.id,rp.authority_epoch,p.id)),false);\n",
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
    },
    "sha": "de227ad3391f1c8e67ce91c0d78a1de16a8bad533aebe1ab46c33864f845f2ee",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "bx1_private.fund_roleplay_investor_operational(p.id,rp.id,rp.authority_epoch)",
        "count": 1
      }
    ]
  },
  {
    "oid": 37285,
    "signature": "bx1_private.fund_roleplay_eligibility_product_visible(jsonb,uuid)",
    "original": "\n  select coalesce(c->>'mode'='ROLE' and c->>'role'='Investor' and exists(\n    select 1 from bx1_private.roleplay_policies rp join bx1_portal.products p on p.id=rp.product_id\n    where p.id=product and p.status='PUBLISHED' and bx1_portal.offering_operational(p.id)\n      and bx1_portal.is_eligible(p.terms) and bx1_private.fund_roleplay_context(c,p.id,'request_product_eligibility')\n      and rp.id=bx1_private.fund_roleplay_current_policy(c,p.id,'request_product_eligibility')\n      and bx1_private.fund_roleplay_eligibility_organisation_current(rp.id,rp.authority_epoch,p.id)),false);\n",
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
    },
    "sha": "2404e8bc14047e15674b6173951cb4e40cce0ab9d0bd0fe427e049c817cae100",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "bx1_private.fund_roleplay_investor_operational(p.id,rp.id,rp.authority_epoch)",
        "count": 1
      }
    ]
  },
  {
    "oid": 25748,
    "signature": "bx1_portal.guard_offering_eligibility()",
    "original": "\ndeclare p bx1_portal.products;\nbegin\n  if tg_op='INSERT' then\n    select * into p from bx1_portal.products where id=new.product_id;\n    if p.id is null or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true\n      or new.product_revision is distinct from p.revision or new.terms_hash is distinct from p.terms_hash then\n      raise exception 'offering_not_open' using errcode='23514'; end if;\n    new.offering_revision_id:=p.current_offering_revision_id;\n  elsif new.status='SUBMITTED' and\n      (old.status is distinct from 'SUBMITTED' or old.product_revision is distinct from new.product_revision\n        or old.terms_hash is distinct from new.terms_hash) then\n    select * into p from bx1_portal.products where id=new.product_id;\n    if p.id is null or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true\n      or new.product_revision is distinct from p.revision or new.terms_hash is distinct from p.terms_hash then\n      raise exception 'offering_not_open' using errcode='23514'; end if;\n    new.offering_revision_id:=p.current_offering_revision_id;\n  elsif new.status='APPROVED' and old.status is distinct from 'APPROVED' then\n    select * into p from bx1_portal.products where id=new.product_id;\n    if new.offering_revision_id is null or new.offering_revision_id is distinct from p.current_offering_revision_id\n      or bx1_portal.offering_operational(p.id) is not true then\n      raise exception 'offering_eligibility_revision_expired' using errcode='23514'; end if;\n  end if;\n  return new;\nend ",
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
    },
    "sha": "b4f35ee1d594ee8066aa737c4226acc8c4cfc9db7d8f3f56bbb9bc1c05d21503",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "(case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,case when TG_OP='INSERT' or new.status='SUBMITTED' then 'request_product_eligibility' when new.status='APPROVED' then 'review_product_eligibility' else null end,null,null) else bx1_portal.offering_operational(p.id) end)",
        "count": 3
      }
    ]
  },
  {
    "oid": 25754,
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "original": "declare actor uuid:=auth.uid(); p bx1_portal.products; o bx1_portal.organisations;\n  r bx1_portal.offering_revisions; d bx1_portal.offering_decisions;\n  prior bx1_portal.scoped_requests; original_revision integer; decision text; counter integer;\nbegin\n  if action='review_offering_issuer' then perform bx1_private.fund_roleplay_enter(c,bx1_portal.test_offering_target(action,body),action,key);end if;\n  if bx1_portal.admission_password_session() and action='review_product' then\n    return bx1_portal.execute_appointed_compliance_decision(c,key,body); end if;\n  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n  if action not in ('save_product','submit_product','review_product','review_offering_issuer',\n    'publish_product','subscribe') then\n    return bx1_portal.offering_workflow_parent_command(c,action,key,body); end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true or\n    key is null or key='00000000-0000-0000-0000-000000000000' or\n    pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'offering_context_or_command_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;\n  if prior.actor_id is not null then\n    if prior.operating_context is distinct from c or prior.command is distinct from action\n      or prior.payload is distinct from body then\n      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    if action='review_offering_issuer' then\n      if bx1_private.fund_roleplay_lane_current(c,(prior.payload->>'product_id')::uuid,action) is true\n        and bx1_private.fund_roleplay_offering_decision_commit(c,action,key,prior.payload) is not null then\n        perform bx1_private.fund_roleplay_finish(c,(prior.payload->>'product_id')::uuid,action,key);\n        return bx1_private.fund_roleplay_offering_decision_commit(c,action,key,prior.payload);\n      end if;\n      perform bx1_portal.product_common_envelope_review_replay_authority(c,'ISSUER',prior.payload);\n    end if;\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key) then\n    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;\n\n  if action='subscribe' then\n    perform bx1_portal.require_keys(body,array['product_id','expected_revision','terms_hash','units',\n      'accepted_documents','accepted_risks','investment_account_id','offering_revision_id']);\n  elsif action='review_product' then\n    if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  elsif action='review_offering_issuer' then\n    if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  end if;\n  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;\n  if p.id is null then raise exception 'offering_product_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;\n  perform id from bx1_portal.organisation_authority_bindings\n    where product_organisation_id=o.id order by id for share;\n  original_revision:=p.revision;\n  if action in ('review_product','review_offering_issuer','subscribe','publish_product') then\n    select * into r from bx1_portal.offering_revisions\n      where id=p.current_offering_revision_id and product_id=p.id;\n    if r.id is null or r.origin<>'SUBMITTED' or r.terms_hash is distinct from p.terms_hash\n      or r.terms is distinct from p.terms then\n      raise exception 'offering_current_package_required' using errcode='23514'; end if;\n  end if;\n\n  if action='review_product' or action='review_offering_issuer' then\n    if r.terms->'terms_version'='3'::jsonb then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n      if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'\n        or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'product_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'\n        or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'offering_revision_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'terms_hash') is distinct from 'string'\n        or body->>'terms_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'common_envelope_hash') is distinct from 'string'\n        or body->>'common_envelope_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'deployment_configuration_hash') is distinct from 'string'\n        or body->>'deployment_configuration_hash' !~ '^[0-9a-f]{64}$'\n        or body->>'common_envelope_hash' is distinct from r.common_envelope_hash\n        or body->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then\n        raise exception 'common_envelope_review_hash_mismatch' using errcode='23514'; end if;\n    else\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']);\n    end if;\n    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'\n      or (body->>'expected_revision')::integer<>p.revision\n      or body->>'offering_revision_id' is distinct from r.id::text\n      or body->>'terms_hash' is distinct from r.terms_hash then\n      raise exception 'offering_stale_package' using errcode='23514'; end if;\n    perform bx1_portal.require_text(body,'notes',20,3000);\n    decision:=body->>'decision';\n    if decision not in ('APPROVED','CHANGES_REQUIRED') then\n      raise exception 'offering_decision_invalid' using errcode='22023'; end if;\n  end if;\n\n  if action='save_product' then\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n    update bx1_portal.products set current_offering_revision_id=null where id=p.id;\n  elsif action='submit_product' then\n    select * into r from bx1_portal.offering_revisions\n      where product_id=p.id and origin='SUBMITTED' order by package_number desc limit 1;\n    if r.id is not null and r.terms_hash=p.terms_hash then\n      raise exception 'offering_unchanged_resubmission' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n    select * into p from bx1_portal.products where id=p.id;\n    select coalesce(max(package_number),0)+1 into counter\n      from bx1_portal.offering_revisions where product_id=p.id;\n    insert into bx1_portal.offering_revisions(product_id,package_number,origin,\n      product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)\n      values(p.id,counter,'SUBMITTED',p.revision,p.terms,p.terms_hash,\n        bx1_portal.offering_document_hashes(p.terms),actor,pg_catalog.clock_timestamp()) returning * into r;\n    update bx1_portal.products set current_offering_revision_id=r.id where id=p.id;\n  elsif action='review_product' then\n    if r.terms->'terms_version'='3'::jsonb then\n      raise exception 'common_envelope_private_compliance_denied' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true\n      or (bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_compliance_scope_denied' using errcode='42501'; end if;\n    select * into d from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='ISSUER';\n    perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true\n      or (bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_compliance_authority_changed' using errcode='42501'; end if;\n    if d.id is not null and (bx1_portal.offering_workflow_people_independent(actor,d.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_independent_review_required' using errcode='42501'; end if;\n    if exists(select 1 from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='COMPLIANCE') then\n      raise exception 'offering_decision_already_recorded' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,\n      body-'offering_revision_id'-'terms_hash');\n    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n      values(r.id,'COMPLIANCE',decision,actor,c,r.terms_hash,r.document_hashes,\n        original_revision,body->>'notes',body->'checks');\n    -- The inherited reviewer writer labels Compliance-only approval APPROVED.\n    -- Correct the enduring product state in the same transaction: the entire\n    -- offering is approved only after the separately appointed issuer agrees.\n    if decision='APPROVED' and coalesce(d.decision,'PENDING')<>'APPROVED' then\n      update bx1_portal.products set status='IN_REVIEW' where id=p.id;\n    end if;\n  elsif action='review_offering_issuer' then\n    perform bx1_portal.require_checks(body->'checks',array['issuer_authority','terms','rights'],decision='APPROVED');\n    if p.status not in ('IN_REVIEW','APPROVED') or bx1_portal.offering_workflow_issuer_authorised(c,p.id) is not true then\n      raise exception 'offering_issuer_appointment_required' using errcode='42501'; end if;\n    -- Pin the native appointment source through commit. A concurrent role or\n    -- organisation suspension cannot race the independently recorded choice.\n    perform m.id from public.bx1_memberships m\n      where m.user_id=actor and m.organisation_id=(c->>'organisationId')::uuid\n        and m.role='IssuerFundManager' order by m.id for share;\n    perform n.id from public.bx1_organisations n\n      where n.id=(c->>'organisationId')::uuid for share;\n    select * into d from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='COMPLIANCE';\n    if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' and action='review_offering_issuer'\n      and bx1_private.fund_roleplay_lane_current(c,p.id,action) is true\n      and not exists(select 1 from pg_catalog.unnest(array[actor,r.submitted_by,o.owner_id,d.actor_id]) locked(user_id)\n        where locked.user_id is not null and locked.user_id is distinct from auth.uid()) then\n      perform bx1_portal.admission_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    else\n      perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    end if;\n    if d.id is not null and (bx1_portal.offering_workflow_people_independent(actor,d.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_independent_issuer_required' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_command_context(c,action) is not true or\n      bx1_portal.offering_workflow_issuer_authorised(c,p.id) is not true then\n      raise exception 'offering_issuer_authority_changed' using errcode='42501'; end if;\n    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n      values(r.id,'ISSUER',decision,actor,c,r.terms_hash,r.document_hashes,\n        original_revision,body->>'notes',body->'checks');\n    update bx1_portal.products set revision=revision+1,\n      status=case when decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'\n        when d.decision='APPROVED' then 'APPROVED' else 'IN_REVIEW' end\n      where id=p.id;\n    insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)\n      values(r.id,p.organisation_id,action,actor,\n        'Appointed issuer decided exact immutable test offering package: '||decision||'. No publication or chain deployment.');\n    insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)\n      values(actor,key,c,action,body);\n  elsif action='publish_product' then\n    if bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then\n      raise exception 'offering_operator_denied' using errcode='42501'; end if;\n    if (bx1_portal.offering_approved(p.id) or (action='publish_product'\n      and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c)\n      and bx1_portal.offering_workflow_approved(p.id))) is not true then\n      raise exception 'offering_issuer_and_compliance_approval_required' using errcode='23514'; end if;\n    if bx1_portal.offering_technical_ready(r.id) is not true then\n      raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n  elsif action='subscribe' then\n    if body->>'offering_revision_id' is distinct from r.id::text\n      or body->>'terms_hash' is distinct from r.terms_hash\n      or bx1_portal.scoped_product_visible(c,p.id) is not true\n      or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true then\n      raise exception 'offering_not_open' using errcode='42501'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body-'offering_revision_id');\n  end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'offering_context_changed' using errcode='42501'; end if;\n  if action='publish_product' and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c) is true then\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key);\n    return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');\n  end if;\n  perform bx1_private.fund_roleplay_finish(c,p.id,action,key);\n  return coalesce(bx1_private.fund_roleplay_offering_decision_commit(c,action,key,body),bx1_portal.read_scoped(c));\nend",
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
    },
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
    ]
  },
  {
    "oid": 24447,
    "signature": "bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)",
    "original": "declare v_actor uuid:=auth.uid(); old_request bx1_portal.scoped_requests; app bx1_portal.applications;\n  p bx1_portal.products; o bx1_portal.organisations; s bx1_portal.subscriptions; account_row bx1_portal.investment_accounts;\n  v_org uuid; account_id uuid; forwarded jsonb:=body; ignored jsonb; v_subject_id uuid;\n  prior_order_ids uuid[]; new_order_ids uuid[];\nbegin\n  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  if bx1_portal.offering_workflow_command_context(c,action) is not true then raise exception 'portal_context_denied' using errcode='42501'; end if;\n  if key is null or key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(body) is distinct from 'object'\n    or octet_length(body::text)>65536 then raise exception 'portal_invalid_command' using errcode='22023'; end if;\n  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));\n  -- Pin authority rows until commit; a concurrently completed revocation must be\n  -- observed after a wait. Expiry uses wall time, not transaction-start now().\n  perform id from auth.users where id=v_actor for share;\n  perform id from auth.sessions where user_id=v_actor and id::text=auth.jwt()->>'session_id' for share;\n  perform id from public.bx1_profiles where id=v_actor for share;\n  if c->>'mode'='ROLE' then\n    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;\n    perform id from public.bx1_memberships where user_id=v_actor and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;\n  end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;\n  select * into old_request from bx1_portal.scoped_requests where actor_id=v_actor and request_key=key;\n  if found then\n    if old_request.operating_context is distinct from c or old_request.command is distinct from action or old_request.payload is distinct from body then\n      raise exception 'portal_context_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=v_actor and request_key=key) then raise exception 'portal_legacy_key_conflict' using errcode='23505'; end if;\n  -- Personal onboarding is always the actor's own principal, never organisation\n  -- authority; native staff may submit it without changing their selected role.\n  if action in ('create_investment_account','subscribe','cancel_subscription') then\n    if c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor' then raise exception 'portal_investor_context_required' using errcode='42501'; end if;\n  end if;\n  if action='create_product' then v_org:=(body->>'organisation_id')::uuid;\n  elsif action in ('save_product','submit_product','review_product','publish_product','subscribe') then\n    select * into p from bx1_portal.products where id=(body->>'product_id')::uuid;\n    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;\n    v_org:=p.organisation_id;\n  elsif action='cancel_subscription' then\n    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid and investor_id=v_actor;\n    if not found then raise exception 'portal_subscription_denied' using errcode='42501'; end if;\n    v_org:=s.organisation_id;\n  end if;\n  if v_org is not null then\n    if (bx1_portal.admission_password_session() or bx1_portal.test_workspace_entitlement(c) is not null) and bx1_portal.offering_workflow_command_allowed(c,action) then\n      if action='create_product' then perform bx1_portal.offering_workflow_lock_organisation(c,v_org);\n      else perform bx1_portal.offering_workflow_lock_product(c,p.id); end if;\n    end if;\n    select * into o from bx1_portal.organisations where id=v_org for share;\n    perform id from bx1_portal.organisation_authority_bindings where product_organisation_id=v_org order by id for share;\n    if action in ('create_product','save_product','submit_product','publish_product') and bx1_portal.offering_workflow_operator(c,v_org) is not true then\n      raise exception 'portal_operator_scope_denied' using errcode='42501'; end if;\n    if action='review_product' and bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true then\n      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;\n  end if;\n  if action='review_application' then\n    select * into app from bx1_portal.applications where id=(body->>'application_id')::uuid for update;\n    if not found or bx1_portal.admission_application_reviewer(c,app.reviewer_scope,app.organisation_id) is not true then\n      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;\n    perform bx1_private.fund_roleplay_admission_enter(c,key,body);\n  elsif action='create_investment_account' then\n    perform bx1_portal.require_keys(body,array['application_id']);\n    select * into app from bx1_portal.applications where id=(body->>'application_id')::uuid and user_id=v_actor for update;\n    if not found or app.persona<>'INVESTOR' or app.status<>'APPROVED' or app.approved_until<=clock_timestamp()\n      or app.details->>'investor_type' is distinct from 'INDIVIDUAL' then raise exception 'portal_individual_approval_required' using errcode='42501'; end if;\n    insert into bx1_portal.investment_accounts(holder_user_id,application_id) values(v_actor,app.id) returning * into account_row;\n    v_subject_id:=account_row.id;\n    insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,key,action,body);\n    insert into bx1_portal.events(subject_id,application_id,investor_id,kind,actor_id,summary)\n      values(v_subject_id,app.id,v_actor,action,v_actor,'Individual investment account opened from current reviewed application. No holding or funding created.');\n  elsif action='subscribe' then\n    account_id:=(body->>'investment_account_id')::uuid;\n    select * into account_row from bx1_portal.investment_accounts where id=account_id for share;\n    if bx1_portal.account_usable(c,account_id) is not true then raise exception 'portal_account_denied' using errcode='42501'; end if;\n    perform id from bx1_portal.applications where id=account_row.application_id for share;\n    -- Claim the capacity row before the last account/authority/expiry check.\n    perform id from bx1_portal.products where id=p.id for update;\n    if bx1_portal.account_usable(c,account_id) is not true or not bx1_portal.current_product_organisation(v_org) then\n      raise exception 'portal_account_or_product_expired' using errcode='42501'; end if;\n    forwarded:=body-'investment_account_id';\n    select coalesce(array_agg(existing.id),'{}'::uuid[]) into prior_order_ids from bx1_portal.subscriptions existing\n      where existing.investor_id=v_actor and existing.product_id=p.id;\n  elsif action='cancel_subscription' and s.investment_account_id is not null then\n    -- Cancellation does not require renewed KYC, but cannot act for another account.\n    if not exists(select 1 from bx1_portal.investment_accounts where id=s.investment_account_id and holder_user_id=v_actor) then\n      raise exception 'portal_account_denied' using errcode='42501'; end if;\n  end if;\n  if action<>'create_investment_account' then\n    if (bx1_portal.admission_password_session() or bx1_portal.test_workspace_entitlement(c) is not null) and bx1_portal.offering_workflow_command_allowed(c,action) then\n      ignored:=bx1_portal.offering_workflow_base_command(c,action,key,forwarded);\n    else ignored:=bx1_portal.execute_command(action,key,forwarded); end if;\n    if action='subscribe' then\n      -- The actor lock serializes all writes and the product lock holds capacity.\n      -- Bind the exact newly inserted row, never a timestamp/latest-row guess.\n      select array_agg(new_order.id) into new_order_ids from bx1_portal.subscriptions new_order\n        where new_order.investor_id=v_actor and new_order.product_id=p.id and not(new_order.id=any(prior_order_ids));\n      if coalesce(cardinality(new_order_ids),0)<>1 then raise exception 'portal_account_binding_failed' using errcode='23514'; end if;\n      update bx1_portal.subscriptions set investment_account_id=account_id where id=new_order_ids[1] and investor_id=v_actor and investment_account_id is null;\n      if not found then raise exception 'portal_account_binding_failed' using errcode='23514'; end if;\n    end if;\n  end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;\n  if v_org is not null and action in ('create_product','save_product','submit_product','publish_product') and not bx1_portal.offering_workflow_operator(c,v_org) then\n    raise exception 'portal_authority_expired' using errcode='42501'; end if;\n  if (action='review_product' and not bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id))\n    or (action='review_application' and not bx1_portal.admission_application_reviewer(c,app.reviewer_scope,app.organisation_id)) then\n    raise exception 'portal_reviewer_scope_expired' using errcode='42501'; end if;\n  if action='subscribe' and (not bx1_portal.account_usable(c,account_id) or not bx1_portal.current_product_organisation(v_org)) then\n    raise exception 'portal_account_or_product_expired' using errcode='42501'; end if;\n  if action='create_investment_account' and not bx1_portal.admission_individual_account_current(c,account_row.id) then\n    raise exception 'portal_account_approval_expired' using errcode='42501'; end if;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);\n  perform bx1_private.fund_roleplay_admission_finish(c,action,key,body);\n  -- The pinned immutable-package writer discards this intermediate snapshot.\n  -- Idempotency replay above remains a full reader and is never suppressed.\n  if action='submit_product' and c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n    and bx1_portal.test_offering_lane_current(c,p.id,key,'submit_product') is true then\n    return pg_catalog.jsonb_build_object('internal_continuation','SUBMIT_PACKAGE');\n  end if;\n  if action='publish_product' and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c) is true then\n    return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');\n  end if;\n  return bx1_portal.read_scoped(c);\nend",
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
    },
    "sha": "867d71f86ac7bf3fb96c3c5f6eb38f890b4769ab363f00f2404a02886cb16ea2",
    "cuts": [
      {
        "from": "bx1_portal.current_product_organisation(v_org)",
        "to": "(case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',key,c) else bx1_portal.current_product_organisation(v_org) end)",
        "count": 2
      }
    ]
  },
  {
    "oid": 25740,
    "signature": "bx1_portal.guard_offering_subscription()",
    "original": "\ndeclare p bx1_portal.products;\nbegin\n  select * into p from bx1_portal.products where id=new.product_id;\n  if p.id is null or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true\n    or new.terms_hash is distinct from p.terms_hash then\n    raise exception 'offering_not_open' using errcode='23514'; end if;\n  if new.offering_revision_id is not null and new.offering_revision_id<>p.current_offering_revision_id then\n    raise exception 'offering_revision_mismatch' using errcode='23514'; end if;\n  new.offering_revision_id:=p.current_offering_revision_id;\n  return new;\nend ",
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
    },
    "sha": "35b757ba2fcac1e946146554dfbfd1ffaae47d45734d6b0a19bc53e1d92f2078",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(p.id)",
        "to": "(case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',null,null) else bx1_portal.offering_operational(p.id) end)",
        "count": 1
      }
    ]
  },
  {
    "oid": 25744,
    "signature": "bx1_portal.guard_offering_funding_commitment()",
    "original": "\nbegin\n  if bx1_portal.offering_operational(new.product_id) is not true then\n    raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;\n  return new;\nend ",
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
    },
    "sha": "574c7104b69ac52775f789ff6f5f1baf0690f1361e3798352570e0e196992ac9",
    "cuts": [
      {
        "from": "bx1_portal.offering_operational(new.product_id)",
        "to": "(case when exists(select 1 from bx1_portal.products product_row where product_row.id=new.product_id\n    and product_row.review_roleplay_policy_id is not null) then\n    (case when TG_TABLE_NAME='funding_routes' and TG_OP='INSERT' then\n      bx1_private.fund_roleplay_investor_write_lane(new.product_id,'propose_funding_route',null,null)\n    when TG_TABLE_NAME='funding_routes' and TG_OP='UPDATE' then\n      bx1_private.fund_roleplay_investor_write_lane(new.product_id,'approve_funding_route',null,null)\n    when TG_TABLE_NAME='funding_obligations' and TG_OP='INSERT' then\n      bx1_private.fund_roleplay_investor_write_lane(new.product_id,'open_funding_obligation',null,null)\n    else false end) else bx1_portal.offering_operational(new.product_id) end)",
        "count": 1
      }
    ]
  },
  {
    "oid": 37279,
    "signature": "bx1_private.fund_roleplay_eligibility_enter(jsonb,text,uuid,jsonb)",
    "original": "\ndeclare product uuid; saved bx1_portal.product_eligibility_cases; policy uuid;\nbegin\n  if action='request_product_eligibility' then product:=(body->>'product_id')::uuid;\n  elsif action in ('review_product_eligibility','revoke_product_eligibility') then\n    select * into saved from bx1_portal.product_eligibility_cases where id=(body->>'eligibility_case_id')::uuid;\n    if saved.roleplay_policy_id is null then return;end if;\n    product:=saved.product_id;\n  else return;end if;\n  policy:=bx1_private.fund_roleplay_current_policy(c,product,action);\n  if saved.roleplay_policy_id is not null and (policy is distinct from saved.roleplay_policy_id\n    or not exists(select 1 from bx1_private.roleplay_policies rp where rp.id=policy and rp.authority_epoch=saved.roleplay_epoch)) then\n    raise exception 'fund_roleplay_eligibility_saved_authority_expired' using errcode='42501';end if;\n  if policy is null then return;end if;\n  perform bx1_private.fund_roleplay_enter(c,product,action,key,null);\nend ",
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
    },
    "sha": "402db4c2d6f6ff1bd1306919411c1faf585fe481741104b9ce46b51881552c63",
    "cuts": [
      {
        "from": "begin\n  if action='request_product_eligibility'",
        "to": "begin\n  if action='subscribe' then\n    product:=(body->>'product_id')::uuid;\n    -- Never relabel a retained ordinary request with new role-play provenance.\n    if exists(select 1 from bx1_portal.scoped_requests prior\n      where prior.actor_id=auth.uid() and prior.request_key=key)\n      and not exists(select 1 from bx1_private.fund_roleplay_command_receipts receipt\n        join bx1_portal.scoped_requests prior on prior.actor_id=receipt.actual_actor_id\n          and prior.request_key=receipt.request_key and prior.command=receipt.action\n        where receipt.actual_actor_id=auth.uid() and receipt.request_key=key and receipt.action='subscribe'\n          and receipt.product_id=product and receipt.operating_context=c\n          and prior.operating_context=c and prior.command='subscribe' and prior.payload=body\n          and bx1_private.fund_roleplay_record_current(receipt.policy_id,receipt.authority_epoch,receipt.product_id,\n            receipt.offering_revision_id,receipt.actual_actor_id,receipt.operating_context,receipt.action)) then return;end if;\n    if bx1_private.fund_roleplay_current_policy(c,product,action) is null then return;end if;\n    if not exists(select 1 from bx1_portal.investment_accounts account_row\n      join bx1_portal.product_eligibility_cases eligibility on eligibility.investment_account_id=account_row.id\n        and eligibility.holder_user_id=account_row.holder_user_id\n      where account_row.id=(body->>'investment_account_id')::uuid and account_row.holder_user_id=auth.uid()\n        and eligibility.product_id=product and bx1_portal.account_usable(c,account_row.id)\n        and bx1_portal.product_eligibility_current(eligibility.id)\n        and bx1_private.fund_roleplay_admission_product(account_row.application_id,product)) then\n      raise exception 'fund_roleplay_subscribe_exact_account_required' using errcode='42501';end if;\n    perform bx1_private.fund_roleplay_enter(c,product,action,key,null);\n    return;\n  end if;\n  if action='request_product_eligibility'",
        "count": 1
      }
    ]
  },
  {
    "oid": 37280,
    "signature": "bx1_private.fund_roleplay_eligibility_finish(jsonb,text,uuid,jsonb)",
    "original": "\ndeclare product uuid;\nbegin\n  if action='request_product_eligibility' then product:=(body->>'product_id')::uuid;\n  elsif action in ('review_product_eligibility','revoke_product_eligibility') then\n    select product_id into product from bx1_portal.product_eligibility_cases where id=(body->>'eligibility_case_id')::uuid;\n  else return;end if;\n  perform bx1_private.fund_roleplay_finish(c,product,action,key);\nend ",
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
    },
    "sha": "4a008d265fa9baefd278eae274d4db5816808bdcf00416c64d6807cdc50ab467",
    "cuts": [
      {
        "from": "  if action='request_product_eligibility' then product:=(body->>'product_id')::uuid;",
        "to": "  if action in ('request_product_eligibility','subscribe') then product:=(body->>'product_id')::uuid;",
        "count": 1
      }
    ]
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
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_investor_continuation_exact_test_owner_required' using errcode='42501';end if;
  -- Preflight EVERY target and dependency before adding either helper.
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if current_row is null or current_row-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(current_row->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_investor_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) into dependencies_before
    from pg_catalog.pg_proc p where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(dependencies));
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.oid),'[]'::jsonb) into trigger_before
    from pg_catalog.pg_trigger t where t.tgfoid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs));
  if trigger_before is distinct from expected_triggers then
    raise exception 'fund_investor_trigger_attachments_changed' using errcode='55000';end if;
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p where p.oid=target;
    original:=spec->>'original';next_body:=original;
    if target is distinct from (spec->>'oid')::oid or current_row-'prosrc' is distinct from spec->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from spec->>'sha' then
      raise exception 'fund_investor_native_baseline_changed: %',spec->>'signature' using errcode='55000';end if;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'cuts') loop
      if (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>(cut->>'count')::integer then
        raise exception 'fund_investor_forward_cut_not_unique: %',spec->>'signature' using errcode='55000';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');
    end loop;
    restored:=next_body;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'cuts') with ordinality parts(value,ordinal) order by ordinal desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>(cut->>'count')::integer then
        raise exception 'fund_investor_reverse_cut_not_unique' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if restored is distinct from original then raise exception 'fund_investor_inverse_mismatch' using errcode='55000';end if;
    if current_row->>'prosrc'=original then originals:=originals+1;
    elsif current_row->>'prosrc'=next_body then finals:=finals+1;
    else raise exception 'fund_investor_unexpected_native_source: %',spec->>'signature' using errcode='55000';end if;
  end loop;
  bootstrap:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_investor_operational(uuid,uuid,integer)') is null
    and pg_catalog.to_regprocedure('bx1_private.fund_roleplay_investor_write_lane(uuid,text,uuid,jsonb)') is null;
  if not ((bootstrap and originals=12 and finals=0) or (not bootstrap and originals=0 and finals=12)) then
    raise exception 'fund_investor_partial_installation_denied' using errcode='55000';end if;
  for helper_spec in select * from (values
    (pg_catalog.jsonb_build_object('signature','bx1_private.fund_roleplay_investor_operational(uuid,uuid,integer)',
      'definition','bx1_private.fund_roleplay_investor_operational(p_product uuid,p_policy uuid,p_epoch integer)',
'args',pg_catalog.jsonb_build_array('p_product','p_policy','p_epoch'),'metadata',$op_metadata${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_investor_operational","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_product","p_policy","p_epoch"],"proargtypes":["2950","2950","23"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$op_metadata$::jsonb,'body',operational_body)),
    (pg_catalog.jsonb_build_object('signature','bx1_private.fund_roleplay_investor_write_lane(uuid,text,uuid,jsonb)',
      'definition','bx1_private.fund_roleplay_investor_write_lane(p_product uuid,p_action text,p_key uuid,p_context jsonb)',
'args',pg_catalog.jsonb_build_array('p_product','p_action','p_key','p_context'),'metadata',$lane_metadata${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_investor_write_lane","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_product","p_action","p_key","p_context"],"proargtypes":["2950","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$lane_metadata$::jsonb,'body',lane_body))
    ) helpers(value) loop
    if bootstrap then
      execute 'create function '||(helper_spec->>'definition')||' returns boolean language sql volatile security definer set search_path='''' as $helper$'
        ||(helper_spec->>'body')||'$helper$';
      helper:=pg_catalog.to_regprocedure(helper_spec->>'signature');
      -- Close every actual nonowner default EXECUTE edge, including PUBLIC.
      for permission in select distinct a.grantee,role_row.rolname from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        left join pg_catalog.pg_roles role_row on role_row.oid=a.grantee
        where p.oid=helper and a.grantee<>p.proowner loop
        execute pg_catalog.format('revoke all on function %s from %s',helper_spec->>'signature',
          case when permission.grantee=0 then 'public' else pg_catalog.quote_ident(permission.rolname) end);
      end loop;
    end if;
    helper:=pg_catalog.to_regprocedure(helper_spec->>'signature');
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p where p.oid=helper;
    if current_row is null or current_row-'prosrc'-'oid' is distinct from helper_spec->'metadata'
      or current_row->>'prosrc' is distinct from helper_spec->>'body'
      or exists(select 1 from pg_catalog.pg_proc p cross join lateral
        pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        where p.oid=helper and a.grantee<>p.proowner) then
      raise exception 'fund_investor_private_helper_drift: %',helper_spec->>'signature' using errcode='55000';end if;
  end loop;
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=(spec->>'oid')::oid;original:=spec->>'original';next_body:=original;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'cuts') loop next_body:=replace(next_body,cut->>'from',cut->>'to');end loop;
    select pg_catalog.to_jsonb(p) into current_row from pg_catalog.pg_proc p where p.oid=target;
    if current_row-'prosrc' is distinct from spec->'metadata' then raise exception 'fund_investor_metadata_changed_before_cut';end if;
    if current_row->>'prosrc'=original then
      definition:=pg_catalog.pg_get_functiondef(target);
      execute replace(definition,original,next_body);
    elsif current_row->>'prosrc' is distinct from next_body then raise exception 'fund_investor_source_changed_before_cut';end if;
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from spec->'metadata' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'fund_investor_existing_metadata_or_source_changed' using errcode='55000';end if;
  end loop;
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) from pg_catalog.pg_proc p
      where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(dependencies))) is distinct from dependencies_before
    or (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.oid),'[]'::jsonb) from pg_catalog.pg_trigger t
      where t.tgfoid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs))) is distinct from trigger_before then
    raise exception 'fund_investor_dependency_or_trigger_mutated' using errcode='55000';end if;
end $fund_investor_continuation$;
