-- Source/ACL/pure-expression proof only. NO real actor, claims, session,
-- policy, decision or provider rows are seeded. Integrator wraps install +
-- repeat + this proof in the existing forced-ROLLBACK cloud procedure.
do $offering_decision_commit_proof$
declare target oid;helper oid;spec jsonb;cut jsonb;permission record;role_name text;source text;restored text;metadata jsonb;
  helper_source text;binding text;expression text;evaluate text;case_row jsonb;candidate jsonb;outcome boolean;
  replay_gate text;lane_call text;formatter_call text;finish_call text;legacy_call text;
  equality_at integer;lane_at integer;probe_at integer;finish_at integer;return_at integer;legacy_at integer;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
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
  fixture constant jsonb:=$fixture${
  "actor_id": "11111111-1111-4111-8111-111111111111",
  "p_context": {
    "mode": "ROLE",
    "organisationId": "66666666-6666-4666-8666-666666666666",
    "role": "IssuerFundManager"
  },
  "p_action": "review_offering_issuer",
  "p_key": "22222222-2222-4222-8222-222222222222",
  "p_body": {
    "product_id": "33333333-3333-4333-8333-333333333333",
    "expected_revision": 2,
    "offering_revision_id": "44444444-4444-4444-8444-444444444444",
    "terms_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "decision": "APPROVED",
    "notes": "Synthetic expression fixture only",
    "checks": {
      "issuer_authority": true,
      "terms": true,
      "rights": true
    },
    "common_envelope_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "deployment_configuration_hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "target_kind": "ISSUER",
  "target_role": "IssuerFundManager",
  "fund_receipt": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "actual_actor_id": "11111111-1111-4111-8111-111111111111",
    "request_key": "22222222-2222-4222-8222-222222222222",
    "action": "review_offering_issuer",
    "policy_id": "77777777-7777-4777-8777-777777777777",
    "authority_epoch": 2,
    "product_id": "33333333-3333-4333-8333-333333333333",
    "offering_revision_id": "44444444-4444-4444-8444-444444444444",
    "actual_person_id": "88888888-8888-4888-8888-888888888888",
    "operating_context": {
      "mode": "ROLE",
      "organisationId": "66666666-6666-4666-8666-666666666666",
      "role": "IssuerFundManager"
    },
    "assurance": "TEST_ROLE_PLAY",
    "independence_proven": false,
    "recorded_at": "2026-10-15T20:00:00Z"
  },
  "scoped_request": {
    "actor_id": "11111111-1111-4111-8111-111111111111",
    "request_key": "22222222-2222-4222-8222-222222222222",
    "command": "review_offering_issuer",
    "payload": {
      "product_id": "33333333-3333-4333-8333-333333333333",
      "expected_revision": 2,
      "offering_revision_id": "44444444-4444-4444-8444-444444444444",
      "terms_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "decision": "APPROVED",
      "notes": "Synthetic expression fixture only",
      "checks": {
        "issuer_authority": true,
        "terms": true,
        "rights": true
      },
      "common_envelope_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "deployment_configuration_hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    },
    "operating_context": {
      "mode": "ROLE",
      "organisationId": "66666666-6666-4666-8666-666666666666",
      "role": "IssuerFundManager"
    }
  },
  "product_row": {
    "id": "33333333-3333-4333-8333-333333333333",
    "organisation_id": "55555555-5555-4555-8555-555555555555",
    "current_offering_revision_id": "44444444-4444-4444-8444-444444444444",
    "terms": {
      "asset_type": "FUND",
      "terms_version": "3"
    },
    "terms_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "offering_row": {
    "id": "44444444-4444-4444-8444-444444444444",
    "product_id": "33333333-3333-4333-8333-333333333333",
    "origin": "SUBMITTED",
    "terms": {
      "asset_type": "FUND",
      "terms_version": "3"
    },
    "terms_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "common_envelope_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "deployment_configuration_hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "document_hashes": {
      "synthetic": "pinned"
    }
  },
  "decision_row": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "offering_revision_id": "44444444-4444-4444-8444-444444444444",
    "decision_kind": "ISSUER",
    "actor_id": "11111111-1111-4111-8111-111111111111",
    "operating_context": {
      "mode": "ROLE",
      "organisationId": "66666666-6666-4666-8666-666666666666",
      "role": "IssuerFundManager"
    },
    "decision": "APPROVED",
    "notes": "Synthetic expression fixture only",
    "checks": {
      "issuer_authority": true,
      "terms": true,
      "rights": true
    },
    "product_revision_at_decision": 2,
    "terms_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "document_hashes": {
      "synthetic": "pinned"
    },
    "common_envelope_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "deployment_configuration_hash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "roleplay_policy_id": "77777777-7777-4777-8777-777777777777",
    "roleplay_epoch": 2,
    "roleplay_context": {
      "mode": "ROLE",
      "organisationId": "66666666-6666-4666-8666-666666666666",
      "role": "IssuerFundManager"
    },
    "product_appointment_id": "99999999-9999-4999-8999-999999999999"
  },
  "saved_policy": {
    "id": "77777777-7777-4777-8777-777777777777",
    "authority_epoch": 2,
    "product_id": "33333333-3333-4333-8333-333333333333",
    "product_organisation_id": "55555555-5555-4555-8555-555555555555",
    "offering_revision_id": "44444444-4444-4444-8444-444444444444",
    "terms_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "native_organisation_id": "66666666-6666-4666-8666-666666666666",
    "environment": "TESTNET",
    "project_ref": "fegnnnlseuejkrusbbkv",
    "actual_operator_person_id": "88888888-8888-4888-8888-888888888888"
  },
  "appointment": {
    "id": "99999999-9999-4999-8999-999999999999",
    "product_id": "33333333-3333-4333-8333-333333333333",
    "product_organisation_id": "55555555-5555-4555-8555-555555555555",
    "appointee_user_id": "11111111-1111-4111-8111-111111111111",
    "role": "IssuerFundManager",
    "reviewer_scope_organisation_id": "66666666-6666-4666-8666-666666666666",
    "roleplay_policy_id": "77777777-7777-4777-8777-777777777777",
    "roleplay_epoch": 2
  }
}$fixture$::jsonb;
  negatives constant jsonb:=$negatives$[
  {
    "label": "scoped command",
    "path": [
      "scoped_request",
      "command"
    ],
    "value": "review_product"
  },
  {
    "label": "scoped key",
    "path": [
      "scoped_request",
      "request_key"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "scoped payload",
    "path": [
      "scoped_request",
      "payload"
    ],
    "value": {}
  },
  {
    "label": "scoped context",
    "path": [
      "scoped_request",
      "operating_context"
    ],
    "value": {
      "mode": "ROLE",
      "organisationId": "66666666-6666-4666-8666-666666666666",
      "role": "ComplianceOfficer"
    }
  },
  {
    "label": "missing product",
    "path": [
      "product_row",
      "id"
    ],
    "value": null
  },
  {
    "label": "wrong product",
    "path": [
      "product_row",
      "id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong offering",
    "path": [
      "offering_row",
      "id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong offering product",
    "path": [
      "offering_row",
      "product_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "unsubmitted",
    "path": [
      "offering_row",
      "origin"
    ],
    "value": "LEGACY"
  },
  {
    "label": "wrong terms",
    "path": [
      "offering_row",
      "terms"
    ],
    "value": {}
  },
  {
    "label": "wrong kind",
    "path": [
      "decision_row",
      "decision_kind"
    ],
    "value": "COMPLIANCE"
  },
  {
    "label": "wrong decision actor",
    "path": [
      "decision_row",
      "actor_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "changed notes",
    "path": [
      "decision_row",
      "notes"
    ],
    "value": "Different synthetic notes"
  },
  {
    "label": "changed checks",
    "path": [
      "decision_row",
      "checks"
    ],
    "value": {}
  },
  {
    "label": "wrong expected revision",
    "path": [
      "decision_row",
      "product_revision_at_decision"
    ],
    "value": 3
  },
  {
    "label": "wrong terms hash",
    "path": [
      "decision_row",
      "terms_hash"
    ],
    "value": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  {
    "label": "wrong documents",
    "path": [
      "decision_row",
      "document_hashes"
    ],
    "value": {}
  },
  {
    "label": "missing common hash",
    "path": [
      "decision_row",
      "common_envelope_hash"
    ],
    "value": null
  },
  {
    "label": "wrong deployment hash",
    "path": [
      "decision_row",
      "deployment_configuration_hash"
    ],
    "value": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  {
    "label": "policy other environment",
    "path": [
      "saved_policy",
      "environment"
    ],
    "value": "MAINNET"
  },
  {
    "label": "policy other project",
    "path": [
      "saved_policy",
      "project_ref"
    ],
    "value": "other-project"
  },
  {
    "label": "policy wrong org",
    "path": [
      "saved_policy",
      "native_organisation_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong receipt actor",
    "path": [
      "fund_receipt",
      "actual_actor_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong receipt key",
    "path": [
      "fund_receipt",
      "request_key"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong receipt action",
    "path": [
      "fund_receipt",
      "action"
    ],
    "value": "review_product"
  },
  {
    "label": "wrong receipt policy",
    "path": [
      "fund_receipt",
      "policy_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong epoch",
    "path": [
      "fund_receipt",
      "authority_epoch"
    ],
    "value": 3
  },
  {
    "label": "wrong receipt person",
    "path": [
      "fund_receipt",
      "actual_person_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong receipt offering",
    "path": [
      "fund_receipt",
      "offering_revision_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong receipt assurance",
    "path": [
      "fund_receipt",
      "assurance"
    ],
    "value": "TRUSTED"
  },
  {
    "label": "false independence label",
    "path": [
      "fund_receipt",
      "independence_proven"
    ],
    "value": true
  },
  {
    "label": "missing canonical recorded time",
    "path": [
      "fund_receipt",
      "recorded_at"
    ],
    "value": null
  },
  {
    "label": "wrong decision policy",
    "path": [
      "decision_row",
      "roleplay_policy_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong decision epoch",
    "path": [
      "decision_row",
      "roleplay_epoch"
    ],
    "value": 3
  },
  {
    "label": "wrong appointment actor",
    "path": [
      "appointment",
      "appointee_user_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong appointment role",
    "path": [
      "appointment",
      "role"
    ],
    "value": "ComplianceOfficer"
  },
  {
    "label": "wrong appointment policy",
    "path": [
      "appointment",
      "roleplay_policy_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  },
  {
    "label": "wrong appointment org",
    "path": [
      "appointment",
      "reviewer_scope_organisation_id"
    ],
    "value": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  }
]$negatives$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'offering_decision_commit_proof_exact_test_owner_required';end if;
  -- This existing replay authority deliberately remains SECURITY INVOKER.
  -- Pin its actual boundary rather than upgrading it to definer execution.
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=29688
      and p.oid=pg_catalog.to_regprocedure('bx1_portal.product_common_envelope_review_replay_authority(jsonb,text,jsonb)')
      and p.proowner='postgres'::regrole and p.prosecdef is false
      and p.proacl::text='{postgres=X/postgres}'
      and p.proconfig=array['search_path=""']::text[]
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        ='0eeb7ca23f10f8c2c974002d93675f9e85c9a7d40887707704519041573c3c3d') then
    raise exception 'offering_decision_commit_proof_replay_authority_changed';end if;
  -- These unchanged outer guards own the original product/session/policy locks
  -- and the final context checks. The ACK replay does not replace that boundary.
  for spec in select value from pg_catalog.jsonb_array_elements($outer_dependencies$[
    {"oid":29591,"signature":"bx1_portal.offering_workflow_lock_actor(text,jsonb)","sha":"9ad3e90d5fd94b0c90b6555bbc322f5bca21bf96bd61429abddfffb002b55aa2"},
    {"oid":30783,"signature":"bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)","sha":"4230af88f5b77ef0e615ec85fd98310b7a7b3d93881212cf34c0870156e62a28"},
    {"oid":30777,"signature":"bx1_portal.test_offering_lock_product_context(jsonb,uuid)","sha":"b01b8aa294bf62a992149ac8da39cedfb6e1452e17d8b60a9ed6cfe74ad5c75a"},
    {"oid":36066,"signature":"bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)","sha":"07bebb9b24e5676b24b78af98ce14d50929f4b997e300b7d06223aa350d771ec"}
  ]$outer_dependencies$::jsonb) loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=(spec->>'oid')::oid
      and p.oid=pg_catalog.to_regprocedure(spec->>'signature') and p.proowner='postgres'::regrole and p.prosecdef
      and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=""']::text[]
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')=spec->>'sha') then
      raise exception 'offering_decision_commit_proof_outer_dependency_changed: %',spec->>'signature';end if;
  end loop;
  helper:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_offering_decision_commit(jsonb,text,uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into metadata,helper_source from pg_catalog.pg_proc p where p.oid=helper;
  if helper is null or metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or metadata->'prosecdef' is distinct from 'true'::jsonb
    or metadata->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or metadata->'proargnames' is distinct from '["p_context","p_action","p_key","p_body"]'::jsonb
    or pg_catalog.pg_get_function_result(helper) is distinct from 'jsonb'
    or helper_source ~* '\m(insert|update|delete|set_config|execute)\M' then
    raise exception 'offering_decision_commit_proof_formatter_contract_changed';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker','bx1_document_receipt_writer'] loop
    if pg_catalog.to_regrole(role_name) is not null and pg_catalog.has_function_privilege(role_name,helper,'EXECUTE') then
      raise exception 'offering_decision_commit_proof_private_formatter_exposed';end if;
  end loop;
  -- Whole-function reverse pins retain EVERY original writer/replay guard.
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into metadata,source from pg_catalog.pg_proc p where p.oid=target;
    if target is distinct from (spec->>'oid')::oid or metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or metadata->'prosecdef' is distinct from 'true'::jsonb or metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or metadata->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
      or metadata->'proargnames' is distinct from spec->'args' then
      raise exception 'offering_decision_commit_proof_writer_metadata_changed';end if;
    if target in (25754::oid,26609::oid) then
      select item.value into cut from pg_catalog.jsonb_array_elements(cuts) item(value)
        where item.value->>'id'=(case target when 25754::oid then 'ISSUER_REPLAY' else 'COMPLIANCE_REPLAY' end);
      lane_call:=case target when 25754 then
        'bx1_private.fund_roleplay_lane_current(c,(prior.payload->>''product_id'')::uuid,action)'
        else 'bx1_private.fund_roleplay_lane_current(c,(prior.payload->>''product_id'')::uuid,''review_product'')' end;
      formatter_call:=case target when 25754 then
        'bx1_private.fund_roleplay_offering_decision_commit(c,action,key,prior.payload)'
        else 'bx1_private.fund_roleplay_offering_decision_commit(c,''review_product'',key,prior.payload)' end;
      finish_call:=case target when 25754 then
        'perform bx1_private.fund_roleplay_finish(c,(prior.payload->>''product_id'')::uuid,action,key);'
        else 'perform bx1_private.fund_roleplay_finish(c,(prior.payload->>''product_id'')::uuid,''review_product'',key);' end;
      legacy_call:=case target when 25754 then
        'perform bx1_portal.product_common_envelope_review_replay_authority(c,''ISSUER'',prior.payload);'
        else 'perform bx1_portal.product_common_envelope_review_replay_authority(c,''COMPLIANCE'',prior.payload);' end;
      equality_at:=strpos(source,'raise exception ''offering_idempotency_conflict''');
      lane_at:=strpos(source,lane_call);probe_at:=strpos(source,formatter_call||' is not null');
      finish_at:=strpos(source,finish_call);return_at:=strpos(source,'return '||formatter_call||';');
      legacy_at:=strpos(source,legacy_call);
      if equality_at<=0 or lane_at<=equality_at or probe_at<=lane_at or finish_at<=probe_at
        or return_at<=finish_at or legacy_at<=return_at then
        raise exception 'offering_decision_commit_proof_replay_order_changed';end if;
      -- Evaluate the actual extracted replay branch with pure booleans/JSON
      -- only. A missing EXISTING receipt must never reach finish/ACK.
      replay_gate:=substring(cut->>'to' from strpos(cut->>'to','if '||lane_call)+3);
      replay_gate:=substring(replay_gate from 1 for strpos(replay_gate,' then')-1);
      replay_gate:=replace(replace(replay_gate,lane_call,'lane_is_current'),formatter_call,'existing_receipt');
      for case_row in select value from pg_catalog.jsonb_array_elements($recovery_cases$[
        {"lane":true,"receipt":{"kind":"EXPRESSION_ONLY"},"allow":true},
        {"lane":false,"receipt":{"kind":"EXPRESSION_ONLY"},"allow":false},
        {"lane":null,"receipt":{"kind":"EXPRESSION_ONLY"},"allow":false},
        {"lane":true,"receipt":null,"allow":false},
        {"lane":false,"receipt":null,"allow":false}
      ]$recovery_cases$::jsonb) loop
        execute 'select ('||replay_gate||') is true from (select $1::boolean lane_is_current,$2::jsonb existing_receipt) input'
          into outcome using (case_row->>'lane')::boolean,nullif(case_row->'receipt','null'::jsonb);
        if outcome is distinct from (case_row->>'allow')::boolean then
          raise exception 'offering_decision_commit_proof_replay_missing_receipt_or_lane_failed';end if;
      end loop;
    end if;
    restored:=source;
    for cut in select item.value from pg_catalog.jsonb_array_elements(cuts) with ordinality item(value,n)
      where spec->'cuts' ? (item.value->>'id') order by item.n desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'offering_decision_commit_proof_cut_not_unique';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from spec->>'sha' then raise exception 'offering_decision_commit_proof_outside_cut_changed';end if;
  end loop;
  if bx1_private.fund_roleplay_offering_decision_commit(null,'review_offering_issuer',
    '22222222-2222-4222-8222-222222222222','{}'::jsonb) is not null
    or bx1_private.fund_roleplay_offering_decision_commit(null,'review_product',
    '22222222-2222-4222-8222-222222222222','{}'::jsonb) is not null then
    raise exception 'offering_decision_commit_proof_no_actor_must_not_claim_commit';end if;
  -- Extract the ACTUAL constructor's pure binding denial. Typed records below
  -- exist only as query values; this is not an authenticated positive command.
  binding:=substring(helper_source from strpos(helper_source,'scoped_request.actor_id is null')
    for strpos(helper_source,' then'||E'\n'||'    raise exception ''fund_roleplay_offering_decision_commit_binding_changed''')
      -strpos(helper_source,'scoped_request.actor_id is null'));
  if binding is null or binding='' or strpos(binding,'decision_row.product_revision_at_decision is distinct from (p_body->>''expected_revision'')::integer')=0
    or strpos(helper_source,'product_revision'',')>0
    or strpos(helper_source,'''kind'',''TEST_FUND_OFFERING_DECISION_COMMIT''')=0
    or strpos(helper_source,'if fund_receipt.id is null then return null;end if;')=0
    or strpos(helper_source,'fund_roleplay_record_current(fund_receipt.policy_id,fund_receipt.authority_epoch,')=0
    or strpos(helper_source,'fund_roleplay_appointment_current(appointment.id) is not true')=0
    or strpos(helper_source,'test_roleplay_protected_session() is not true')=0
    or strpos(helper_source,'base_request.payload is distinct from p_body-array[''offering_revision_id'',''terms_hash'',''common_envelope_hash'',''deployment_configuration_hash'']')=0 then
    raise exception 'offering_decision_commit_proof_binding_extraction_changed';end if;
  expression:=replace(binding,'auth.uid()','actor_id');
  foreach role_name in array array['fund_receipt','scoped_request','decision_row','product_row','offering_row','saved_policy','appointment'] loop
    expression:=replace(expression,role_name||'.','('||role_name||').');
  end loop;
  evaluate:=$evaluate$with f as (select $1::jsonb v), input as (select
 (v->>'actor_id')::uuid actor_id,v->'p_context' p_context,v->>'p_action' p_action,(v->>'p_key')::uuid p_key,v->'p_body' p_body,
 v->>'target_kind' target_kind,v->>'target_role' target_role,
 pg_catalog.jsonb_populate_record(null::bx1_private.fund_roleplay_command_receipts,v->'fund_receipt') fund_receipt,
 pg_catalog.jsonb_populate_record(null::bx1_portal.scoped_requests,v->'scoped_request') scoped_request,
 pg_catalog.jsonb_populate_record(null::bx1_portal.products,v->'product_row') product_row,
 pg_catalog.jsonb_populate_record(null::bx1_portal.offering_revisions,v->'offering_row') offering_row,
 pg_catalog.jsonb_populate_record(null::bx1_portal.offering_decisions,v->'decision_row') decision_row,
 pg_catalog.jsonb_populate_record(null::bx1_private.roleplay_policies,v->'saved_policy') saved_policy,
 pg_catalog.jsonb_populate_record(null::bx1_portal.product_service_appointments,v->'appointment') appointment from f)
select (__BINDING__) is true from input$evaluate$;
  evaluate:=replace(evaluate,'__BINDING__',expression);
  execute evaluate into outcome using fixture;
  if outcome is distinct from false then raise exception 'offering_decision_commit_proof_pure_baseline_denied';end if;
  for case_row in select value from pg_catalog.jsonb_array_elements(negatives) loop
    candidate:=pg_catalog.jsonb_set(fixture,array(select pg_catalog.jsonb_array_elements_text(case_row->'path')),case_row->'value');
    execute evaluate into outcome using candidate;
    if outcome is distinct from true then raise exception 'offering_decision_commit_proof_binding_negative_failed: %',case_row->>'label';end if;
  end loop;
  -- No currentness shortcut: each real gate remains independently mandatory.
  for case_row in select value from pg_catalog.jsonb_array_elements('[{"session":false,"policy":true,"appointment":true},{"session":true,"policy":false,"appointment":true},{"session":true,"policy":true,"appointment":false},{"session":null,"policy":true,"appointment":true},{"session":true,"policy":null,"appointment":true},{"session":true,"policy":true,"appointment":null}]'::jsonb) loop
    outcome:=(case_row->>'session')::boolean is not true or (case_row->>'policy')::boolean is not true or (case_row->>'appointment')::boolean is not true;
    if outcome is not true then raise exception 'offering_decision_commit_proof_current_gate_negative_failed';end if;
  end loop;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from before_claims
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from before_sub then
    raise exception 'offering_decision_commit_proof_claims_changed';end if;
end $offering_decision_commit_proof$;

