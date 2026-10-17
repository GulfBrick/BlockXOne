-- Exact TEST offering-decision commit receipts. No business writer, authority,
-- timeout, role grant or record is added. Publish the compatible app FIRST.
do $offering_decision_commit$
declare spec jsonb; dependency jsonb; cut jsonb; permission record; target oid; helper oid;
  before_row jsonb; after_row jsonb; original text; normalized text; next_body text; restored text; definition text;
  prepared jsonb:='{}'::jsonb; dependencies_before jsonb:='{}'::jsonb;
  cuts constant jsonb:=$cuts$[
  {
    "id": "ISSUER_REPLAY",
    "from": "    if action='review_offering_issuer' then\n      perform bx1_portal.product_common_envelope_review_replay_authority(c,'ISSUER',prior.payload);\n    end if;\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);",
    "to": "    if action='review_offering_issuer' then\n      if bx1_private.fund_roleplay_lane_current(c,(prior.payload->>'product_id')::uuid,action) is true\n        and bx1_private.fund_roleplay_offering_decision_commit(c,action,key,prior.payload) is not null then\n        perform bx1_private.fund_roleplay_finish(c,(prior.payload->>'product_id')::uuid,action,key);\n        return bx1_private.fund_roleplay_offering_decision_commit(c,action,key,prior.payload);\n      end if;\n      perform bx1_portal.product_common_envelope_review_replay_authority(c,'ISSUER',prior.payload);\n    end if;\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);"
  },
  {
    "id": "ISSUER_FINAL",
    "from": "  perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\nend",
    "to": "  perform bx1_private.fund_roleplay_finish(c,p.id,action,key);\n  return coalesce(bx1_private.fund_roleplay_offering_decision_commit(c,action,key,body),bx1_portal.read_scoped(c));\nend"
  },
  {
    "id": "COMPLIANCE_REPLAY",
    "from": "    perform bx1_portal.product_common_envelope_review_replay_authority(c,'COMPLIANCE',prior.payload);\n    return bx1_portal.read_scoped(c);",
    "to": "    if bx1_private.fund_roleplay_lane_current(c,(prior.payload->>'product_id')::uuid,'review_product') is true\n      and bx1_private.fund_roleplay_offering_decision_commit(c,'review_product',key,prior.payload) is not null then\n      perform bx1_private.fund_roleplay_finish(c,(prior.payload->>'product_id')::uuid,'review_product',key);\n      return bx1_private.fund_roleplay_offering_decision_commit(c,'review_product',key,prior.payload);\n    end if;\n    perform bx1_portal.product_common_envelope_review_replay_authority(c,'COMPLIANCE',prior.payload);\n    return bx1_portal.read_scoped(c);"
  },
  {
    "id": "COMPLIANCE_FINAL",
    "from": "  perform bx1_private.fund_roleplay_finish(c,p.id,'review_product',key);\n  return bx1_portal.read_scoped(c);\nend",
    "to": "  perform bx1_private.fund_roleplay_finish(c,p.id,'review_product',key);\n  return coalesce(bx1_private.fund_roleplay_offering_decision_commit(c,'review_product',key,body),bx1_portal.read_scoped(c));\nend"
  },
  {
    "id": "BASE_REPLAY",
    "from": "    -- Fresh scoped view, not a historical snapshot that could disclose revoked access.\n    if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;",
    "to": "    -- Fresh scoped view, not a historical snapshot that could disclose revoked access.\n    if command='review_product' and auth.uid() is not null and c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'\n      and bx1_private.test_roleplay_environment() is true\n      and exists(select 1 from bx1_private.fund_roleplay_command_lanes lane\n        where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n          and lane.request_key=offering_workflow_base_command.request_key and lane.action='review_product'\n          and lane.product_id=(payload->>'product_id')::uuid and lane.operating_context=c\n          and bx1_private.fund_roleplay_lane_current(c,lane.product_id,'review_product') is true) then\n      return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_OFFERING_DECISION');\n    end if;\n    if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;"
  },
  {
    "id": "BASE_FINAL",
    "from": "  if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;\n  return bx1_portal.read_state();\nend",
    "to": "  if command='review_product' and auth.uid() is not null and c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'\n      and bx1_private.test_roleplay_environment() is true\n      and exists(select 1 from bx1_private.fund_roleplay_command_lanes lane\n        where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n          and lane.request_key=offering_workflow_base_command.request_key and lane.action='review_product'\n          and lane.product_id=(payload->>'product_id')::uuid and lane.operating_context=c\n          and bx1_private.fund_roleplay_lane_current(c,lane.product_id,'review_product') is true) then\n    return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_OFFERING_DECISION');\n  end if;\n  if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;\n  return bx1_portal.read_state();\nend"
  }
]$cuts$::jsonb;
  specifications constant jsonb:=$specifications$[
  {
    "acl": "{postgres=X/postgres}",
    "oid": "25754",
    "sha": "1c0e20dba86b455418adb6b77a112c21e5d7cdf92bf31fa7d7caaba902eead6e",
    "owner": "postgres",
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "args": [
      "c",
      "action",
      "key",
      "body"
    ],
    "cuts": [
      "ISSUER_REPLAY",
      "ISSUER_FINAL"
    ]
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "26609",
    "sha": "aac7a73ec278517b342481337b5528a869c9bff9045c6460723ad962cf1463af",
    "owner": "postgres",
    "signature": "bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)",
    "args": [
      "c",
      "key",
      "body"
    ],
    "cuts": [
      "COMPLIANCE_REPLAY",
      "COMPLIANCE_FINAL"
    ]
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "29619",
    "sha": "f55792240ffbb459ee467431a163905f2aa5c637fbcb958adcc57e443bd9bbb4",
    "owner": "postgres",
    "signature": "bx1_portal.offering_workflow_base_command(jsonb,text,uuid,jsonb)",
    "args": [
      "c",
      "command",
      "request_key",
      "payload"
    ],
    "cuts": [
      "BASE_REPLAY",
      "BASE_FINAL"
    ]
  }
]$specifications$::jsonb;
  dependencies constant jsonb:=$dependencies$[
  {
    "acl": "{postgres=X/postgres}",
    "oid": "29688",
    "sha": "0eeb7ca23f10f8c2c974002d93675f9e85c9a7d40887707704519041573c3c3d",
    "secdef": false,
    "owner": "postgres",
    "signature": "bx1_portal.product_common_envelope_review_replay_authority(jsonb,text,jsonb)"
  },
  {
    "acl": "{postgres=X/postgres,bx1_authority_owner=X/postgres}",
    "oid": "33388",
    "sha": "df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21",
    "owner": "postgres",
    "signature": "bx1_private.test_roleplay_environment()"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "33389",
    "sha": "0cef4c386c389bb403f99fbae76f82a20faa874a1d7d9749d795c292b2822e14",
    "owner": "postgres",
    "signature": "bx1_private.test_roleplay_protected_session()"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "36060",
    "sha": "fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8",
    "owner": "postgres",
    "signature": "bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "36065",
    "sha": "e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177",
    "owner": "postgres",
    "signature": "bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "36067",
    "sha": "3168472a61298bb600ccc544cecbd18c490fa4154fa45044bf7ef32ff2056302",
    "owner": "postgres",
    "signature": "bx1_private.fund_roleplay_finish(jsonb,uuid,text,uuid)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "36222",
    "sha": "6fcb9829a5dff3398844bf54d316de411dfea9da51d3c65bbd75cf7267f9adc9",
    "owner": "postgres",
    "signature": "bx1_private.fund_roleplay_appointment_current(uuid)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "29591",
    "sha": "9ad3e90d5fd94b0c90b6555bbc322f5bca21bf96bd61429abddfffb002b55aa2",
    "owner": "postgres",
    "signature": "bx1_portal.offering_workflow_lock_actor(text,jsonb)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "30783",
    "sha": "4230af88f5b77ef0e615ec85fd98310b7a7b3d93881212cf34c0870156e62a28",
    "owner": "postgres",
    "signature": "bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "30777",
    "sha": "b01b8aa294bf62a992149ac8da39cedfb6e1452e17d8b60a9ed6cfe74ad5c75a",
    "owner": "postgres",
    "signature": "bx1_portal.test_offering_lock_product_context(jsonb,uuid)"
  },
  {
    "acl": "{postgres=X/postgres}",
    "oid": "36066",
    "sha": "07bebb9b24e5676b24b78af98ce14d50929f4b997e300b7d06223aa350d771ec",
    "owner": "postgres",
    "signature": "bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)"
  }
]$dependencies$::jsonb;
  helper_body constant text:=$helper_body$declare fund_receipt bx1_private.fund_roleplay_command_receipts;
  scoped_request bx1_portal.scoped_requests; base_request bx1_portal.requests;
  decision_row bx1_portal.offering_decisions; product_row bx1_portal.products;
  offering_row bx1_portal.offering_revisions; saved_policy bx1_private.roleplay_policies;
  appointment bx1_portal.product_service_appointments; target_kind text; target_role text;
begin
  -- Ordinary commands keep their original return path. A decision row alone
  -- never manufactures a commit: the canonical finish receipt is mandatory.
  if auth.uid() is null or p_action is null
    or p_action not in ('review_offering_issuer','review_product') then return null;end if;
  select saved.* into fund_receipt from bx1_private.fund_roleplay_command_receipts saved
    where saved.actual_actor_id=auth.uid() and saved.request_key=p_key and saved.action=p_action;
  if fund_receipt.id is null then return null;end if;
  target_kind:=case p_action when 'review_offering_issuer' then 'ISSUER' else 'COMPLIANCE' end;
  target_role:=case p_action when 'review_offering_issuer' then 'IssuerFundManager' else 'ComplianceOfficer' end;
  if bx1_private.test_roleplay_environment() is not true
    or pg_catalog.jsonb_typeof(p_context) is distinct from 'object'
    or p_context->>'mode' is distinct from 'ROLE' or p_context->>'role' is distinct from target_role
    or p_context-array['mode','organisationId','role']<>'{}'::jsonb
    or coalesce(p_context->>'organisationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_key is null or p_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
    or not(p_body ?& array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash'])
    or p_body-array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_body->'product_id') is distinct from 'string'
    or coalesce(p_body->>'product_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(p_body->'offering_revision_id') is distinct from 'string'
    or coalesce(p_body->>'offering_revision_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(p_body->'expected_revision') is distinct from 'number'
    or coalesce(p_body->>'expected_revision','') !~ '^[1-9][0-9]{0,8}$'
    or coalesce(auth.jwt()->>'session_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'fund_roleplay_offering_decision_commit_scope_denied' using errcode='42501';end if;
  select saved.* into scoped_request from bx1_portal.scoped_requests saved
    where saved.actor_id=auth.uid() and saved.request_key=p_key;
  select saved.* into product_row from bx1_portal.products saved where saved.id=(p_body->>'product_id')::uuid;
  select saved.* into offering_row from bx1_portal.offering_revisions saved where saved.id=product_row.current_offering_revision_id;
  select saved.* into decision_row from bx1_portal.offering_decisions saved
    where saved.offering_revision_id=offering_row.id and saved.decision_kind=target_kind;
  select saved.* into saved_policy from bx1_private.roleplay_policies saved where saved.id=fund_receipt.policy_id;
  select saved.* into appointment from bx1_portal.product_service_appointments saved where saved.id=decision_row.product_appointment_id;
  if scoped_request.actor_id is null or scoped_request.command is distinct from p_action
    or scoped_request.request_key is distinct from p_key or scoped_request.payload is distinct from p_body
    or scoped_request.operating_context is distinct from p_context
    or product_row.id is null or offering_row.id is null or decision_row.id is null or saved_policy.id is null
    or product_row.id is distinct from (p_body->>'product_id')::uuid
    or offering_row.id is distinct from (p_body->>'offering_revision_id')::uuid
    or offering_row.product_id is distinct from product_row.id or offering_row.origin is distinct from 'SUBMITTED'
    or offering_row.terms is distinct from product_row.terms or offering_row.terms_hash is distinct from product_row.terms_hash
    or offering_row.terms->>'asset_type' is distinct from 'FUND' or offering_row.terms->>'terms_version' is distinct from '3'
    or decision_row.offering_revision_id is distinct from offering_row.id or decision_row.decision_kind is distinct from target_kind
    or decision_row.actor_id is distinct from auth.uid() or decision_row.operating_context is distinct from p_context
    or decision_row.decision is distinct from p_body->>'decision' or decision_row.notes is distinct from p_body->>'notes'
    or decision_row.checks is distinct from p_body->'checks'
    or decision_row.product_revision_at_decision is distinct from (p_body->>'expected_revision')::integer
    or decision_row.terms_hash is distinct from p_body->>'terms_hash' or decision_row.terms_hash is distinct from offering_row.terms_hash
    or decision_row.document_hashes is distinct from offering_row.document_hashes
    or decision_row.common_envelope_hash is null or decision_row.common_envelope_hash is distinct from offering_row.common_envelope_hash
    or decision_row.common_envelope_hash is distinct from p_body->>'common_envelope_hash'
    or decision_row.deployment_configuration_hash is null
    or decision_row.deployment_configuration_hash is distinct from offering_row.deployment_configuration_hash
    or decision_row.deployment_configuration_hash is distinct from p_body->>'deployment_configuration_hash'
    or saved_policy.product_id is distinct from product_row.id
    or saved_policy.product_organisation_id is distinct from product_row.organisation_id
    or saved_policy.offering_revision_id is distinct from offering_row.id or saved_policy.terms_hash is distinct from offering_row.terms_hash
    or saved_policy.native_organisation_id::text is distinct from p_context->>'organisationId'
    or saved_policy.environment is distinct from 'TESTNET' or saved_policy.project_ref is distinct from 'fegnnnlseuejkrusbbkv'
    or fund_receipt.actual_actor_id is distinct from auth.uid() or fund_receipt.request_key is distinct from p_key
    or fund_receipt.action is distinct from p_action or fund_receipt.operating_context is distinct from p_context
    or fund_receipt.policy_id is distinct from saved_policy.id or fund_receipt.authority_epoch is distinct from saved_policy.authority_epoch
    or fund_receipt.product_id is distinct from product_row.id or fund_receipt.offering_revision_id is distinct from offering_row.id
    or fund_receipt.actual_person_id is distinct from saved_policy.actual_operator_person_id
    or fund_receipt.assurance is distinct from 'TEST_ROLE_PLAY' or fund_receipt.independence_proven is distinct from false
    or fund_receipt.recorded_at is null
    or decision_row.roleplay_policy_id is distinct from fund_receipt.policy_id
    or decision_row.roleplay_epoch is distinct from fund_receipt.authority_epoch or decision_row.roleplay_context is distinct from p_context
    or appointment.id is null or appointment.product_id is distinct from product_row.id
    or appointment.product_organisation_id is distinct from product_row.organisation_id
    or appointment.appointee_user_id is distinct from auth.uid() or appointment.role is distinct from target_role
    or appointment.reviewer_scope_organisation_id is distinct from saved_policy.native_organisation_id
    or appointment.roleplay_policy_id is distinct from fund_receipt.policy_id or appointment.roleplay_epoch is distinct from fund_receipt.authority_epoch then
    raise exception 'fund_roleplay_offering_decision_commit_binding_changed' using errcode='42501';end if;
  if p_action='review_product' then
    select saved.* into base_request from bx1_portal.requests saved where saved.actor_id=auth.uid() and saved.request_key=p_key;
    if base_request.actor_id is null or base_request.command is distinct from p_action
      or base_request.request_key is distinct from p_key
      or base_request.payload is distinct from p_body-array['offering_revision_id','terms_hash','common_envelope_hash','deployment_configuration_hash'] then
      raise exception 'fund_roleplay_offering_decision_commit_base_request_changed' using errcode='42501';end if;
  end if;
  -- No active lane is required after finish consumes it. Read current authority
  -- against the ORIGINAL receipt and exact recorded appointment, not a new policy.
  if bx1_private.test_roleplay_protected_session() is not true
    or bx1_private.fund_roleplay_record_current(fund_receipt.policy_id,fund_receipt.authority_epoch,
      product_row.id,offering_row.id,auth.uid(),p_context,p_action) is not true
    or bx1_private.fund_roleplay_appointment_current(appointment.id) is not true then
    raise exception 'fund_roleplay_offering_decision_commit_authority_changed' using errcode='42501';end if;
  return pg_catalog.jsonb_build_object('kind','TEST_FUND_OFFERING_DECISION_COMMIT','version',1,
    'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false,
    'actor_id',auth.uid(),'session_id',(auth.jwt()->>'session_id')::uuid,'operating_context',p_context,
    'policy_id',saved_policy.id,'authority_epoch',saved_policy.authority_epoch,'product_id',product_row.id,
    'offering_revision_id',offering_row.id,'decision_id',decision_row.id,'decision_kind',decision_row.decision_kind,
    'request',pg_catalog.jsonb_build_object('command',p_action,'key',p_key,'payload',scoped_request.payload),
    'recorded_at',fund_receipt.recorded_at);
end$helper_body$;
  helper_definition constant text:=$helper_definition$create function bx1_private.fund_roleplay_offering_decision_commit(p_context jsonb,p_action text,p_key uuid,p_body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $function$declare fund_receipt bx1_private.fund_roleplay_command_receipts;
  scoped_request bx1_portal.scoped_requests; base_request bx1_portal.requests;
  decision_row bx1_portal.offering_decisions; product_row bx1_portal.products;
  offering_row bx1_portal.offering_revisions; saved_policy bx1_private.roleplay_policies;
  appointment bx1_portal.product_service_appointments; target_kind text; target_role text;
begin
  -- Ordinary commands keep their original return path. A decision row alone
  -- never manufactures a commit: the canonical finish receipt is mandatory.
  if auth.uid() is null or p_action is null
    or p_action not in ('review_offering_issuer','review_product') then return null;end if;
  select saved.* into fund_receipt from bx1_private.fund_roleplay_command_receipts saved
    where saved.actual_actor_id=auth.uid() and saved.request_key=p_key and saved.action=p_action;
  if fund_receipt.id is null then return null;end if;
  target_kind:=case p_action when 'review_offering_issuer' then 'ISSUER' else 'COMPLIANCE' end;
  target_role:=case p_action when 'review_offering_issuer' then 'IssuerFundManager' else 'ComplianceOfficer' end;
  if bx1_private.test_roleplay_environment() is not true
    or pg_catalog.jsonb_typeof(p_context) is distinct from 'object'
    or p_context->>'mode' is distinct from 'ROLE' or p_context->>'role' is distinct from target_role
    or p_context-array['mode','organisationId','role']<>'{}'::jsonb
    or coalesce(p_context->>'organisationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_key is null or p_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
    or not(p_body ?& array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash'])
    or p_body-array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_body->'product_id') is distinct from 'string'
    or coalesce(p_body->>'product_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(p_body->'offering_revision_id') is distinct from 'string'
    or coalesce(p_body->>'offering_revision_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(p_body->'expected_revision') is distinct from 'number'
    or coalesce(p_body->>'expected_revision','') !~ '^[1-9][0-9]{0,8}$'
    or coalesce(auth.jwt()->>'session_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'fund_roleplay_offering_decision_commit_scope_denied' using errcode='42501';end if;
  select saved.* into scoped_request from bx1_portal.scoped_requests saved
    where saved.actor_id=auth.uid() and saved.request_key=p_key;
  select saved.* into product_row from bx1_portal.products saved where saved.id=(p_body->>'product_id')::uuid;
  select saved.* into offering_row from bx1_portal.offering_revisions saved where saved.id=product_row.current_offering_revision_id;
  select saved.* into decision_row from bx1_portal.offering_decisions saved
    where saved.offering_revision_id=offering_row.id and saved.decision_kind=target_kind;
  select saved.* into saved_policy from bx1_private.roleplay_policies saved where saved.id=fund_receipt.policy_id;
  select saved.* into appointment from bx1_portal.product_service_appointments saved where saved.id=decision_row.product_appointment_id;
  if scoped_request.actor_id is null or scoped_request.command is distinct from p_action
    or scoped_request.request_key is distinct from p_key or scoped_request.payload is distinct from p_body
    or scoped_request.operating_context is distinct from p_context
    or product_row.id is null or offering_row.id is null or decision_row.id is null or saved_policy.id is null
    or product_row.id is distinct from (p_body->>'product_id')::uuid
    or offering_row.id is distinct from (p_body->>'offering_revision_id')::uuid
    or offering_row.product_id is distinct from product_row.id or offering_row.origin is distinct from 'SUBMITTED'
    or offering_row.terms is distinct from product_row.terms or offering_row.terms_hash is distinct from product_row.terms_hash
    or offering_row.terms->>'asset_type' is distinct from 'FUND' or offering_row.terms->>'terms_version' is distinct from '3'
    or decision_row.offering_revision_id is distinct from offering_row.id or decision_row.decision_kind is distinct from target_kind
    or decision_row.actor_id is distinct from auth.uid() or decision_row.operating_context is distinct from p_context
    or decision_row.decision is distinct from p_body->>'decision' or decision_row.notes is distinct from p_body->>'notes'
    or decision_row.checks is distinct from p_body->'checks'
    or decision_row.product_revision_at_decision is distinct from (p_body->>'expected_revision')::integer
    or decision_row.terms_hash is distinct from p_body->>'terms_hash' or decision_row.terms_hash is distinct from offering_row.terms_hash
    or decision_row.document_hashes is distinct from offering_row.document_hashes
    or decision_row.common_envelope_hash is null or decision_row.common_envelope_hash is distinct from offering_row.common_envelope_hash
    or decision_row.common_envelope_hash is distinct from p_body->>'common_envelope_hash'
    or decision_row.deployment_configuration_hash is null
    or decision_row.deployment_configuration_hash is distinct from offering_row.deployment_configuration_hash
    or decision_row.deployment_configuration_hash is distinct from p_body->>'deployment_configuration_hash'
    or saved_policy.product_id is distinct from product_row.id
    or saved_policy.product_organisation_id is distinct from product_row.organisation_id
    or saved_policy.offering_revision_id is distinct from offering_row.id or saved_policy.terms_hash is distinct from offering_row.terms_hash
    or saved_policy.native_organisation_id::text is distinct from p_context->>'organisationId'
    or saved_policy.environment is distinct from 'TESTNET' or saved_policy.project_ref is distinct from 'fegnnnlseuejkrusbbkv'
    or fund_receipt.actual_actor_id is distinct from auth.uid() or fund_receipt.request_key is distinct from p_key
    or fund_receipt.action is distinct from p_action or fund_receipt.operating_context is distinct from p_context
    or fund_receipt.policy_id is distinct from saved_policy.id or fund_receipt.authority_epoch is distinct from saved_policy.authority_epoch
    or fund_receipt.product_id is distinct from product_row.id or fund_receipt.offering_revision_id is distinct from offering_row.id
    or fund_receipt.actual_person_id is distinct from saved_policy.actual_operator_person_id
    or fund_receipt.assurance is distinct from 'TEST_ROLE_PLAY' or fund_receipt.independence_proven is distinct from false
    or fund_receipt.recorded_at is null
    or decision_row.roleplay_policy_id is distinct from fund_receipt.policy_id
    or decision_row.roleplay_epoch is distinct from fund_receipt.authority_epoch or decision_row.roleplay_context is distinct from p_context
    or appointment.id is null or appointment.product_id is distinct from product_row.id
    or appointment.product_organisation_id is distinct from product_row.organisation_id
    or appointment.appointee_user_id is distinct from auth.uid() or appointment.role is distinct from target_role
    or appointment.reviewer_scope_organisation_id is distinct from saved_policy.native_organisation_id
    or appointment.roleplay_policy_id is distinct from fund_receipt.policy_id or appointment.roleplay_epoch is distinct from fund_receipt.authority_epoch then
    raise exception 'fund_roleplay_offering_decision_commit_binding_changed' using errcode='42501';end if;
  if p_action='review_product' then
    select saved.* into base_request from bx1_portal.requests saved where saved.actor_id=auth.uid() and saved.request_key=p_key;
    if base_request.actor_id is null or base_request.command is distinct from p_action
      or base_request.request_key is distinct from p_key
      or base_request.payload is distinct from p_body-array['offering_revision_id','terms_hash','common_envelope_hash','deployment_configuration_hash'] then
      raise exception 'fund_roleplay_offering_decision_commit_base_request_changed' using errcode='42501';end if;
  end if;
  -- No active lane is required after finish consumes it. Read current authority
  -- against the ORIGINAL receipt and exact recorded appointment, not a new policy.
  if bx1_private.test_roleplay_protected_session() is not true
    or bx1_private.fund_roleplay_record_current(fund_receipt.policy_id,fund_receipt.authority_epoch,
      product_row.id,offering_row.id,auth.uid(),p_context,p_action) is not true
    or bx1_private.fund_roleplay_appointment_current(appointment.id) is not true then
    raise exception 'fund_roleplay_offering_decision_commit_authority_changed' using errcode='42501';end if;
  return pg_catalog.jsonb_build_object('kind','TEST_FUND_OFFERING_DECISION_COMMIT','version',1,
    'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false,
    'actor_id',auth.uid(),'session_id',(auth.jwt()->>'session_id')::uuid,'operating_context',p_context,
    'policy_id',saved_policy.id,'authority_epoch',saved_policy.authority_epoch,'product_id',product_row.id,
    'offering_revision_id',offering_row.id,'decision_id',decision_row.id,'decision_kind',decision_row.decision_kind,
    'request',pg_catalog.jsonb_build_object('command',p_action,'key',p_key,'payload',scoped_request.payload),
    'recorded_at',fund_receipt.recorded_at);
end$function$;$helper_definition$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'offering_decision_commit_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    target:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is distinct from (dependency->>'oid')::oid
      or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from coalesce(dependency->'secdef','true'::jsonb)
      or before_row->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
      or (select p.proacl::text from pg_catalog.pg_proc p where p.oid=target) is distinct from dependency->>'acl'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'offering_decision_commit_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    dependencies_before:=dependencies_before||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;
  -- Prepare all three functions before any DDL. Exact inverse + whole old hash
  -- identifies only the reviewed final body on a repeat; partial/drift denies.
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is distinct from (spec->>'oid')::oid
      or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or before_row->>'provolatile' is distinct from 'v' or before_row->'proargnames' is distinct from spec->'args'
      or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='plpgsql')
      or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb' then
      raise exception 'offering_decision_commit_native_metadata_changed: %',spec->>'signature' using errcode='55000';end if;
    next_body:=original;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')=spec->>'sha' then
      for cut in select item.value from pg_catalog.jsonb_array_elements(cuts) with ordinality item(value,n)
        where spec->'cuts' ? (item.value->>'id') order by item.n loop
        if (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>1 then
          raise exception 'offering_decision_commit_cut_not_unique' using errcode='55000';end if;
        next_body:=replace(next_body,cut->>'from',cut->>'to');
      end loop;
    end if;
    restored:=next_body;
    for cut in select item.value from pg_catalog.jsonb_array_elements(cuts) with ordinality item(value,n)
      where spec->'cuts' ? (item.value->>'id') order by item.n desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'offering_decision_commit_final_cut_not_unique' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from spec->>'sha' then
      raise exception 'offering_decision_commit_outside_cut_changed' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if original is null or original='' or (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'offering_decision_commit_definition_not_unique' using errcode='55000';end if;
    prepared:=prepared||pg_catalog.jsonb_build_object(spec->>'signature',pg_catalog.jsonb_build_object('before',before_row,'original',original,'next',next_body,'definition',definition));
  end loop;
  helper:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_offering_decision_commit(jsonb,text,uuid,jsonb)');
  if helper is null then
    execute helper_definition;
    helper:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_offering_decision_commit(jsonb,text,uuid,jsonb)');
    for permission in select distinct a.grantee,r.rolname from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=helper and a.grantee<>p.proowner loop
      if permission.grantee=0 then execute pg_catalog.format('revoke all on function %s from public',helper::regprocedure);
      else execute pg_catalog.format('revoke all on function %s from %I',helper::regprocedure,permission.rolname);end if;
    end loop;
  end if;
  select pg_catalog.to_jsonb(p) into before_row from pg_catalog.pg_proc p where p.oid=helper;
  if before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_row->'proargnames' is distinct from '["p_context","p_action","p_key","p_body"]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='plpgsql')
    or pg_catalog.pg_get_function_result(helper) is distinct from 'jsonb'
    or before_row->>'prosrc' is distinct from helper_body then
    raise exception 'offering_decision_commit_helper_changed' using errcode='55000';end if;
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p) into before_row from pg_catalog.pg_proc p where p.oid=target;
    if before_row is distinct from prepared#>array[spec->>'signature','before'] then raise exception 'offering_decision_commit_target_changed_before_cut';end if;
    original:=prepared#>>array[spec->>'signature','original'];next_body:=prepared#>>array[spec->>'signature','next'];
    if original is distinct from next_body then
      execute replace(prepared#>>array[spec->>'signature','definition'],original,next_body);
    end if;
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'offering_decision_commit_metadata_changed' using errcode='55000';end if;
  end loop;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(dependency->>'signature'))
      is distinct from dependencies_before->(dependency->>'signature') then
      raise exception 'offering_decision_commit_dependency_mutated' using errcode='55000';end if;
  end loop;
end $offering_decision_commit$;

