-- CE-FREEZE-1; accepted integration 64ecec56. Proposal metadata only.
-- Existing canonical writers, authority, receipts and settlement seals remain authoritative.
-- Install as one transaction through the existing trusted migration/fixture owner.
do $ce_preflight$
declare spec jsonb; target oid; actual text; actual_metadata jsonb;
  expected_defaults constant jsonb := '{
    "owner":"postgres","configuration":["search_path=\"\""],
    "kind":"f","is_strict":false,"is_leakproof":false,"returns_set":false,
    "parallel":"u","cost":100,"rows":0,"variadic_type":0,"support":0,
    "argument_default_count":0,"argument_defaults":null,"all_argument_types":null,
    "argument_modes":null,"transforms":null,"binary":null,"sql_body":null,
    "acl":[{"grantor":"postgres","grantee":"postgres","privilege":"EXECUTE","grantable":false}]
  }'::jsonb;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or current_user<>'postgres' then
    raise exception 'common_envelope_trusted_pg17_baseline_required' using errcode='55000'; end if;
  for spec in select value from pg_catalog.jsonb_array_elements($ce_baseline$
[
  {
    "signature": "bx1_portal.validate_terms(jsonb)",
    "expected_sha256": "81e1acde7c54b79ccb156d8826b78fed6972fbed5902a11ad573a74fde4c064d",
    "metadata": {"input_types":["jsonb"],"argument_names":["terms"],"return_type":"void","language":"plpgsql","volatility":"v","security_definer":false}
  },
  {
    "signature": "bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb)",
    "expected_sha256": "d363cc666efe673c63f4cc54cbc325d5ff06b76b7c7715c726ee86e386449879",
    "metadata": {"input_types":["jsonb","uuid","jsonb"],"argument_names":["c","key","body"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)",
    "expected_sha256": "d3c7a414f06c57eca679fc17067b5e53ee52a062200f884c4d786978b6a26fea",
    "metadata": {"input_types":["jsonb","uuid","jsonb"],"argument_names":["c","key","body"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.guard_fund_v2_product()",
    "expected_sha256": "469bf99150dabdd5eebd124838c7cdc9eb12b5c506b1e005dc596b6465b7ea97",
    "metadata": {"input_types":[],"argument_names":null,"return_type":"trigger","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.guard_real_estate_v2_product()",
    "expected_sha256": "6b3787a70a63c1af688e449f45c3266c7593a539c54d531706d01035d9c5d551",
    "metadata": {"input_types":[],"argument_names":null,"return_type":"trigger","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.guard_fund_v2_subscription()",
    "expected_sha256": "1ec2a9e4cf9eb13ea820811e8d060236451aad137a56735ac613637e14e83472",
    "metadata": {"input_types":[],"argument_names":null,"return_type":"trigger","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_product_appointment(jsonb,text,uuid,jsonb)",
    "expected_sha256": "b583a615e4cc279c887e9abcb368ac6eed14fa7b9307df8de9f62e3b72ff914c",
    "metadata": {"input_types":["jsonb","text","uuid","jsonb"],"argument_names":["c","action","key","body"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.offering_workflow_command(jsonb,text,uuid,jsonb)",
    "expected_sha256": "a6bae2735d6ef351a8067ccc4b62c5441446d8de0063f77d1749b3d5b6a5dc8f",
    "metadata": {"input_types":["jsonb","text","uuid","jsonb"],"argument_names":["c","action","key","body"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.read_scoped_pre_handoff(jsonb)",
    "expected_sha256": "e68aa36870e00e923cc6509a398091712c1c659d3160f4ecb5ec2087e4ace027",
    "metadata": {"input_types":["jsonb"],"argument_names":["c"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "expected_sha256": "71368afe93a25122b3f9cc1c80d08b3d10afe96b8b009fd361c67f4836d81903",
    "metadata": {"input_types":["jsonb","text","uuid","jsonb"],"argument_names":["c","action","key","body"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)",
    "expected_sha256": "f74f8d5b1c0c2498588f379ecd6e4aa2fe8796e7722074228e9b15581ed4a9a3",
    "metadata": {"input_types":["jsonb","uuid","jsonb"],"argument_names":["c","key","body"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.guard_offering_revision_product_lock()",
    "expected_sha256": "2bdecafe5af01707888c832894425ddc9276ff09997ecbef6f417e9d739a8c50",
    "metadata": {"input_types":[],"argument_names":null,"return_type":"trigger","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.guard_offering_decision_appointment()",
    "expected_sha256": "903ae5858adb1a4f4e65d298cd507d026d4911debf30b6f1ab4a1ef254f0a9f0",
    "metadata": {"input_types":[],"argument_names":null,"return_type":"trigger","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.offering_approved(uuid)",
    "expected_sha256": "32b10d36ba3587b86f56973c5a3a3464741354bfd935fae02dfd829c76b00300",
    "metadata": {"input_types":["uuid"],"argument_names":["target_product"],"return_type":"boolean","language":"sql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.offering_workflow_approved(uuid)",
    "expected_sha256": "97f8c77550140d329aee65c6cfc11277882897f8fddaed215ea14d65ab9dd2e6",
    "metadata": {"input_types":["uuid"],"argument_names":["target_product"],"return_type":"boolean","language":"sql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid)",
    "expected_sha256": "5673f1d7f8556a48019f8ef7307f264b5697eff9e76cb52440f8ec253e44c5fc",
    "metadata": {"input_types":["jsonb","uuid"],"argument_names":["c","target_product"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)",
    "expected_sha256": "e8ecb175c0f00f2ecd1076494ed4eb44647cb3029da9ce43bab1f85fbcb8e9f7",
    "metadata": {"input_types":["jsonb","uuid"],"argument_names":["c","target_product"],"return_type":"jsonb","language":"plpgsql","volatility":"v","security_definer":true}
  },
  {
    "signature": "bx1_portal.offering_history_projection(uuid)",
    "expected_sha256": "aaec401a3b39dd746884e0ac7d26fe4ed9862df343d6bc447421eed9e2919312",
    "metadata": {"input_types":["uuid"],"argument_names":["target_product"],"return_type":"jsonb","language":"sql","volatility":"s","security_definer":true}
  }
]
$ce_baseline$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'common_envelope_target_missing: %',spec->>'signature' using errcode='55000'; end if;
    select p.prosrc,pg_catalog.jsonb_build_object(
      'signature',n.nspname||'.'||p.proname||'('||coalesce((select pg_catalog.string_agg(
        a.type_oid::regtype::text,',' order by a.ordinality)
        from pg_catalog.unnest(p.proargtypes::oid[]) with ordinality a(type_oid,ordinality)), '')||')',
      'owner',r.rolname,'configuration',p.proconfig,'kind',p.prokind,
      'input_types',coalesce((select pg_catalog.jsonb_agg(a.type_oid::regtype::text order by a.ordinality)
        from pg_catalog.unnest(p.proargtypes::oid[]) with ordinality a(type_oid,ordinality)), '[]'::jsonb),
      'input_count',p.pronargs,'argument_names',p.proargnames,'return_type',p.prorettype::regtype::text,
      'language',l.lanname,'volatility',p.provolatile,'security_definer',p.prosecdef,
      'is_strict',p.proisstrict,'is_leakproof',p.proleakproof,'returns_set',p.proretset,
      'parallel',p.proparallel,'cost',p.procost,'rows',p.prorows,
      'variadic_type',p.provariadic::integer,'support',p.prosupport::oid::integer,
      'argument_default_count',p.pronargdefaults,'argument_defaults',p.proargdefaults::text,
      'all_argument_types',p.proallargtypes,'argument_modes',p.proargmodes,
      'transforms',p.protrftypes,'binary',p.probin,'sql_body',p.prosqlbody::text,
      'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'grantor',grantor.rolname,'grantee',case when a.grantee=0 then 'PUBLIC' else grantee.rolname end,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        order by grantor.rolname,case when a.grantee=0 then 'PUBLIC' else grantee.rolname end,
          a.privilege_type,a.is_grantable)
        from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
        left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee), '[]'::jsonb))
      into actual,actual_metadata from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      join pg_catalog.pg_roles r on r.oid=p.proowner
      join pg_catalog.pg_language l on l.oid=p.prolang where p.oid=target;
    if actual_metadata is distinct from (expected_defaults||(spec->'metadata')||pg_catalog.jsonb_build_object(
      'signature',spec->>'signature','input_count',pg_catalog.jsonb_array_length(spec->'metadata'->'input_types'))) then
      raise exception 'common_envelope_metadata_changed: %',spec->>'signature' using errcode='55000'; end if;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(pg_catalog.replace(actual,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from spec->>'expected_sha256' then
      raise exception 'common_envelope_definition_changed: %',spec->>'signature' using errcode='55000'; end if;
  end loop;
end $ce_preflight$;

create function bx1_portal.product_common_envelope_economic_projection(terms jsonb) returns jsonb
language sql immutable security invoker parallel unsafe cost 100 set search_path='' as $$
  select pg_catalog.jsonb_set(terms-'common_envelope'-'deployment_configuration',
    '{terms_version}','2'::jsonb);
$$;

create function bx1_portal.product_issuer_declaration_hash(product_id uuid,declaration jsonb) returns text
language sql immutable security invoker parallel unsafe cost 100 set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('domain','BX1_ISSUER_DECLARATION_V3_1',
      'product_id',product_id,'posture','SYNTHETIC_DECLARED','declaration',declaration)::text,'UTF8')),'hex');
$$;

create function bx1_portal.product_common_envelope_hash(product_id uuid,terms jsonb) returns text
language sql immutable security invoker parallel unsafe cost 100 set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('domain','BX1_COMMON_ENVELOPE_V3_1','product_id',product_id,
      'asset_type',terms->'asset_type','common_envelope',terms->'common_envelope',
      'authoritative_references',pg_catalog.jsonb_build_object(
        'issuer_name',terms->'issuer_name','share_class',terms->'share_class',
        'currency',terms->'currency','settlement_decimals',terms->'settlement_decimals',
        'unit_price_minor',terms->'unit_price_minor','cap_units',terms->'cap_units',
        'minimum_units',terms->'minimum_units','eligible_countries',terms->'eligible_countries',
        'eligible_investor_types',terms->'eligible_investor_types',
        'property_address',terms->'property_address','property_valuation_minor',terms->'property_valuation_minor',
        'asset_policies',case when terms->>'asset_type'='FUND'
          then pg_catalog.jsonb_build_object('fund',terms->'fund')
          else pg_catalog.jsonb_build_object('real_estate',terms->'real_estate') end))::text,'UTF8')),'hex');
$$;

create function bx1_portal.product_deployment_configuration_hash(product_id uuid,terms jsonb) returns text
language sql immutable security invoker parallel unsafe cost 100 set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('domain','BX1_DEPLOYMENT_CONFIGURATION_V3_1','product_id',product_id,
      'common_envelope_hash',bx1_portal.product_common_envelope_hash(product_id,terms),
      'deployment_configuration',terms->'deployment_configuration')::text,'UTF8')),'hex');
$$;

create function bx1_portal.product_common_envelope_validate(terms jsonb) returns void
language plpgsql volatile security invoker parallel unsafe cost 100 set search_path='' as $$
declare spec record; value jsonb; item jsonb; asset text; ce jsonb; config jsonb;
  class_ids jsonb:='[]'::jsonb; previous_class text; class_index integer:=0;
  event_position integer; last_event_position integer:=0;
  default_order text[]:=array['REPORTING_FAILURE','PAYMENT_FAILURE','MATERIAL_TERMS_BREACH',
    'INSOLVENCY_EVENT','CUSTODY_OR_TITLE_DISPUTE'];
begin
  if pg_catalog.jsonb_typeof(terms) is distinct from 'object'
    or pg_catalog.octet_length(terms::text)>65536 then
    raise exception 'common_envelope_invalid_terms' using errcode='22023'; end if;
  asset:=terms->>'asset_type';
  if asset is null or asset not in ('FUND','REAL_ESTATE') then
    raise exception 'common_envelope_invalid_asset' using errcode='22023'; end if;
  perform bx1_portal.require_keys(terms,array['asset_type','name','issuer_name','summary','strategy','share_class',
    'currency','unit_price_minor','cap_units','minimum_units','pricing_basis','fees','redemption_terms',
    'eligible_countries','eligible_investor_types','property_address','property_valuation_minor',
    'rental_income_policy','documents','terms_version','settlement_decimals',
    case asset when 'FUND' then 'fund' else 'real_estate' end,'common_envelope','deployment_configuration']);
  perform bx1_portal.require_keys(terms#>'{common_envelope}',array['envelope_version','posture','issuer','manager_organisation_id','classes','custody_title','register','eligibility','transfer','fees','settlement','servicing','exit_policy_refs']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,issuer}',array['issuer_reference','declaration_revision','legal_name','registration_reference','jurisdiction','legal_form','governing_law']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,custody_title}',array['asset_title_model','asset_control_model','custodian_legal_name','title_evidence_reference','control_evidence_reference','segregation_policy','control_policy','recovery_policy']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,register}',array['authority','evidence_precedence','correction_policy','dispute_policy']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,eligibility}',array['countries_ref','investor_types_ref','identity_policy']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,transfer}',array['eligible_transfer_policy','lockup_days','maximum_holder_bps','consent_policy','lender_consent_policy_ref']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,fees}',array['schedule_ref','tax_policy','rounding_mode']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,settlement}',array['status','currency','decimals','chain_id','funding_rail','beneficiary_policy','reconciliation_policy','exception_policy']);
  perform bx1_portal.require_keys(terms#>'{common_envelope,servicing}',array['reporting_frequency','reporting_policy','default_events','default_notice_days','default_response_policy','termination_notice_days','termination_approval','termination_policy']);
  perform bx1_portal.require_keys(terms#>'{deployment_configuration}',array['configuration_version','state','standard_family','conformance','chain_id','network','class_ids','primary_class_id','policy_refs','routine_authority','signing','governance','required_decisions']);
  perform bx1_portal.require_keys(terms#>'{deployment_configuration,policy_refs}',array['eligibility','transfer','identity','fees','custody_title','register','servicing','exits']);
  perform bx1_portal.require_keys(terms#>'{deployment_configuration,signing}',array['state','threshold_scope','policy_slots','threshold','required_high_risk_slots','routine_controller_policy','key_recovery_policy']);
  perform bx1_portal.require_keys(terms#>'{deployment_configuration,governance}',array['model','timelock_hours','controller_replacement_policy','powers']);
  perform bx1_portal.require_keys(terms#>'{deployment_configuration,governance,powers}',array['role_grant_revoke','mint_burn','pause_freeze','force_transfer','recovery','upgrade']);
  ce:=terms->'common_envelope'; config:=terms->'deployment_configuration';
  -- Unicode character lengths and exact original string values; never trim or coerce.
  for value in select q.value from pg_catalog.jsonb_path_query(
    terms,'strict $.** ? (@.type() == "string")'::jsonpath) q(value) loop
    if value#>>'{}' ~ E'^[ \t\n\r\f\013]|[ \t\n\r\f\013]$'
      or value#>>'{}' ~* 'ZAR_TEST' then
      raise exception 'common_envelope_string_posture' using errcode='22023'; end if;
  end loop;
  for spec in select * from (values
      ('{common_envelope,issuer,legal_name}'::text[],3,160),
      ('{common_envelope,issuer,registration_reference}'::text[],3,100),
      ('{common_envelope,issuer,legal_form}'::text[],3,100),
      ('{common_envelope,issuer,governing_law}'::text[],3,160),
      ('{common_envelope,custody_title,title_evidence_reference}'::text[],10,400),
      ('{common_envelope,custody_title,control_evidence_reference}'::text[],10,400),
      ('{common_envelope,custody_title,segregation_policy}'::text[],20,2400),
      ('{common_envelope,custody_title,control_policy}'::text[],20,2400),
      ('{common_envelope,custody_title,recovery_policy}'::text[],20,2400),
      ('{common_envelope,register,correction_policy}'::text[],20,2400),
      ('{common_envelope,register,dispute_policy}'::text[],20,2400),
      ('{common_envelope,eligibility,identity_policy}'::text[],20,2400),
      ('{common_envelope,transfer,eligible_transfer_policy}'::text[],20,2400),
      ('{common_envelope,transfer,consent_policy}'::text[],20,2400),
      ('{common_envelope,fees,tax_policy}'::text[],20,2400),
      ('{common_envelope,settlement,reconciliation_policy}'::text[],20,2400),
      ('{common_envelope,settlement,exception_policy}'::text[],20,2400),
      ('{common_envelope,servicing,reporting_policy}'::text[],20,2400),
      ('{common_envelope,servicing,default_response_policy}'::text[],20,2400),
      ('{common_envelope,servicing,termination_policy}'::text[],20,2400),
      ('{deployment_configuration,signing,routine_controller_policy}'::text[],20,2400),
      ('{deployment_configuration,signing,key_recovery_policy}'::text[],20,2400),
      ('{deployment_configuration,governance,controller_replacement_policy}'::text[],20,2400),
      ('{deployment_configuration,governance,powers,role_grant_revoke}'::text[],20,2400),
      ('{deployment_configuration,governance,powers,mint_burn}'::text[],20,2400),
      ('{deployment_configuration,governance,powers,pause_freeze}'::text[],20,2400),
      ('{deployment_configuration,governance,powers,force_transfer}'::text[],20,2400),
      ('{deployment_configuration,governance,powers,recovery}'::text[],20,2400),
      ('{deployment_configuration,governance,powers,upgrade}'::text[],20,2400)
    ) fields(path,minimum,maximum) loop
    value:=terms#>spec.path;
    if pg_catalog.jsonb_typeof(value) is distinct from 'string'
      or pg_catalog.char_length(value#>>'{}') not between spec.minimum and spec.maximum then
      raise exception 'common_envelope_invalid_text' using errcode='22023'; end if;
  end loop;
  for spec in select * from (values
      ('{terms_version}'::text[],3,3),
      ('{settlement_decimals}'::text[],6,6),
      ('{common_envelope,envelope_version}'::text[],1,1),
      ('{common_envelope,issuer,declaration_revision}'::text[],1,999999999),
      ('{common_envelope,transfer,lockup_days}'::text[],0,3650),
      ('{common_envelope,transfer,maximum_holder_bps}'::text[],1,10000),
      ('{common_envelope,settlement,decimals}'::text[],6,6),
      ('{common_envelope,settlement,chain_id}'::text[],80002,80002),
      ('{common_envelope,servicing,default_notice_days}'::text[],0,365),
      ('{common_envelope,servicing,termination_notice_days}'::text[],0,365),
      ('{deployment_configuration,configuration_version}'::text[],1,1),
      ('{deployment_configuration,chain_id}'::text[],80002,80002),
      ('{deployment_configuration,signing,threshold}'::text[],2,4),
      ('{deployment_configuration,governance,timelock_hours}'::text[],24,720)
    ) fields(path,minimum,maximum) loop
    value:=terms#>spec.path;
    if pg_catalog.jsonb_typeof(value) is distinct from 'number'
      or value#>>'{}' !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'common_envelope_invalid_integer' using errcode='22023'; end if;
    if (value#>>'{}')::integer not between spec.minimum and spec.maximum then
      raise exception 'common_envelope_invalid_integer' using errcode='22023'; end if;
  end loop;
  for spec in select * from (values
    ('{common_envelope,issuer,issuer_reference}'::text[]),
    ('{common_envelope,manager_organisation_id}'::text[]),
    ('{deployment_configuration,primary_class_id}'::text[])
    ) fields(path) loop
    value:=terms#>spec.path;
    if pg_catalog.jsonb_typeof(value) is distinct from 'string'
      or value#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or value#>>'{}'='00000000-0000-0000-0000-000000000000' then
      raise exception 'common_envelope_invalid_reference' using errcode='22023'; end if;
  end loop;
  if terms->'currency' is distinct from '"TST"'::jsonb
    or terms#>'{common_envelope,posture}' is distinct from '"SYNTHETIC_DECLARED"'::jsonb
    or terms#>'{common_envelope,register,evidence_precedence}' is distinct from '"REVIEWED_TERMS_AND_DECLARED_REGISTER_OVER_TOKEN_PROJECTION"'::jsonb
    or terms#>'{common_envelope,eligibility,countries_ref}' is distinct from '"eligible_countries"'::jsonb
    or terms#>'{common_envelope,eligibility,investor_types_ref}' is distinct from '"eligible_investor_types"'::jsonb
    or terms#>'{common_envelope,fees,rounding_mode}' is distinct from '"DOWN"'::jsonb
    or terms#>'{common_envelope,settlement,status}' is distinct from '"DECLARED_NOT_APPROVED"'::jsonb
    or terms#>'{common_envelope,settlement,currency}' is distinct from '"TST"'::jsonb
    or terms#>'{common_envelope,settlement,funding_rail}' is distinct from '"TEST_ASSET_PROPOSAL_ONLY"'::jsonb
    or terms#>'{common_envelope,settlement,beneficiary_policy}' is distinct from '"INDEPENDENT_APPROVAL_REQUIRED"'::jsonb
    or terms#>'{common_envelope,servicing,termination_approval}' is distinct from '"ISSUER_AND_COMPLIANCE_REVIEW_REQUIRED"'::jsonb
    or terms#>'{deployment_configuration,state}' is distinct from '"PROPOSED_NOT_DEPLOYED"'::jsonb
    or terms#>'{deployment_configuration,standard_family}' is distinct from '"ERC-3643"'::jsonb
    or terms#>'{deployment_configuration,conformance}' is distinct from '"NOT_VERIFIED"'::jsonb
    or terms#>'{deployment_configuration,network}' is distinct from '"POLYGON_AMOY"'::jsonb
    or terms#>'{deployment_configuration,routine_authority}' is distinct from '"CONTROLLER_ONLY"'::jsonb
    or terms#>'{deployment_configuration,signing,state}' is distinct from '"PROPOSED_INSTITUTIONAL_POLICY"'::jsonb
    or terms#>'{deployment_configuration,signing,threshold_scope}' is distinct from '"HIGH_RISK_ONLY"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,eligibility}' is distinct from '"common_envelope.eligibility"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,transfer}' is distinct from '"common_envelope.transfer"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,identity}' is distinct from '"common_envelope.eligibility.identity_policy"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,fees}' is distinct from '"common_envelope.fees"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,custody_title}' is distinct from '"common_envelope.custody_title"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,register}' is distinct from '"common_envelope.register"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,servicing}' is distinct from '"common_envelope.servicing"'::jsonb
    or terms#>'{deployment_configuration,policy_refs,exits}' is distinct from '"common_envelope.exit_policy_refs"'::jsonb
    or pg_catalog.jsonb_typeof(ce#>'{issuer,jurisdiction}') is distinct from 'string'
    or ce#>>'{issuer,jurisdiction}' !~ '^[A-Z]{2}$'
    or ce#>'{issuer,legal_name}' is distinct from terms->'issuer_name'
    or ce#>'{servicing,reporting_frequency}' not in ('"MONTHLY"'::jsonb,'"QUARTERLY"'::jsonb,'"ANNUALLY"'::jsonb)
    or ce#>'{custody_title,asset_control_model}' not in ('"ISSUER_CONTROL_DECLARED"'::jsonb,'"CUSTODIAN_CONTROL_DECLARED"'::jsonb)
    or config#>'{governance,model}' not in ('"IMMUTABLE_RELEASE_GOVERNED_MIGRATION_PROPOSAL"'::jsonb,'"TIMELOCKED_UPGRADE_PROPOSAL"'::jsonb) then
    raise exception 'common_envelope_invalid_policy_reference' using errcode='22023'; end if;
  if ce#>>'{custody_title,asset_control_model}'='CUSTODIAN_CONTROL_DECLARED' then
    value:=ce#>'{custody_title,custodian_legal_name}';
    if pg_catalog.jsonb_typeof(value) is distinct from 'string'
      or pg_catalog.char_length(value#>>'{}') not between 3 and 160 then
      raise exception 'common_envelope_custodian_required' using errcode='22023'; end if;
  elsif ce#>'{custody_title,custodian_legal_name}' is distinct from 'null'::jsonb then
    raise exception 'common_envelope_custodian_contradiction' using errcode='22023';
  end if;
  if pg_catalog.jsonb_typeof(ce->'classes') is distinct from 'array'
    or pg_catalog.jsonb_typeof(ce#>'{servicing,default_events}') is distinct from 'array'
    or pg_catalog.jsonb_typeof(config->'class_ids') is distinct from 'array'
    or pg_catalog.jsonb_typeof(config#>'{signing,policy_slots}') is distinct from 'array' then
    raise exception 'common_envelope_invalid_array' using errcode='22023'; end if;
  if pg_catalog.jsonb_array_length(ce->'classes') not between 1 and 10
    or pg_catalog.jsonb_array_length(ce#>'{servicing,default_events}') not between 1 and 5 then
    raise exception 'common_envelope_invalid_array' using errcode='22023'; end if;
  for item in select q.value from pg_catalog.jsonb_array_elements(ce->'classes') q(value) loop
    class_index:=class_index+1;
    perform bx1_portal.require_keys(item,array['class_id','primary','name','decimals','rights',
      'unit_price_minor','cap_units','minimum_units','operational_scope']);
    if pg_catalog.jsonb_typeof(item->'class_id') is distinct from 'string'
      or item->>'class_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or item->>'class_id'='00000000-0000-0000-0000-000000000000'
      or class_ids ? (item->>'class_id')
      or item->'primary' is distinct from pg_catalog.to_jsonb(class_index=1)
      or item->'decimals' is distinct from '0'::jsonb
      or pg_catalog.jsonb_typeof(item->'name') is distinct from 'string'
      or pg_catalog.char_length(item->>'name') not between 1 and 80
      or pg_catalog.jsonb_typeof(item->'rights') is distinct from 'string'
      or pg_catalog.char_length(item->>'rights') not between 20 and 2400 then
      raise exception 'common_envelope_invalid_class' using errcode='22023'; end if;
    if class_index=1 then
      if item->'name' is distinct from terms->'share_class'
        or item->'rights' is distinct from (case asset when 'FUND' then terms#>'{fund,class_rights}' else terms#>'{real_estate,spv,interest_rights}' end)
        or item->'unit_price_minor' is distinct from terms->'unit_price_minor'
        or item->'cap_units' is distinct from terms->'cap_units'
        or item->'minimum_units' is distinct from terms->'minimum_units'
        or item->'operational_scope' is distinct from '"PRIMARY_PACKAGE_ONLY"'::jsonb then
        raise exception 'common_envelope_primary_mismatch' using errcode='22023'; end if;
    else
      if (class_index>2 and item->>'class_id'<=previous_class)
        or item->'unit_price_minor' is distinct from 'null'::jsonb
        or item->'cap_units' is distinct from 'null'::jsonb
        or item->'minimum_units' is distinct from 'null'::jsonb
        or item->'operational_scope' is distinct from '"DECLARATION_ONLY"'::jsonb then
        raise exception 'common_envelope_secondary_scope' using errcode='22023'; end if;
      previous_class:=item->>'class_id';
    end if;
    class_ids:=class_ids||pg_catalog.jsonb_build_array(item->'class_id');
  end loop;
  for value in select q.value from pg_catalog.jsonb_array_elements(ce#>'{servicing,default_events}') q(value) loop
    event_position:=pg_catalog.array_position(default_order,value#>>'{}');
    if pg_catalog.jsonb_typeof(value) is distinct from 'string'
      or event_position is null or event_position<=last_event_position then
      raise exception 'common_envelope_default_order' using errcode='22023'; end if;
    last_event_position:=event_position;
  end loop;
  if config->'class_ids' is distinct from class_ids
    or config->'primary_class_id' is distinct from class_ids->0
    or (config#>'{signing,policy_slots}' is distinct from '["CONTROLLER_OPERATOR","INDEPENDENT_GOVERNANCE","INDEPENDENT_COMPLIANCE"]'::jsonb
      and config#>'{signing,policy_slots}' is distinct from '["CONTROLLER_OPERATOR","INDEPENDENT_GOVERNANCE","INDEPENDENT_COMPLIANCE","RECOVERY_CUSTODIAN"]'::jsonb)
    or (config#>>'{signing,threshold}')::integer>pg_catalog.jsonb_array_length(config#>'{signing,policy_slots}')
    or config#>'{signing,required_high_risk_slots}' is distinct from '["INDEPENDENT_GOVERNANCE","INDEPENDENT_COMPLIANCE"]'::jsonb
    or config->'required_decisions' is distinct from '["ISSUER_PACKAGE_REVIEW","APPOINTED_COMPLIANCE_PACKAGE_REVIEW","SEPARATE_TECHNICAL_READINESS","SEPARATE_LEGAL_AND_SERVICE_ADMISSION"]'::jsonb then
    raise exception 'common_envelope_configuration_mismatch' using errcode='22023'; end if;
  -- Reject an undifferentiated catch-all policy, without claiming legal sufficiency.
  if (select pg_catalog.count(distinct q.policy) from (
    select v.value policy from pg_catalog.jsonb_each_text(config#>'{governance,powers}') v
    union all select config#>>'{governance,controller_replacement_policy}') q)=1 then
    raise exception 'common_envelope_catchall_governance' using errcode='22023'; end if;
  if asset='FUND' then
    if ce#>'{custody_title,asset_title_model}' is distinct from '"FUND_PORTFOLIO_INTEREST_DECLARATION"'::jsonb
      or ce#>'{register,authority}' is distinct from '"DECLARED_ISSUER_REGISTER"'::jsonb
      or ce#>'{transfer,lockup_days}' is distinct from terms#>'{fund,liquidity,lockup_days}'
      or ce#>'{transfer,lender_consent_policy_ref}' is distinct from 'null'::jsonb
      or ce#>'{fees,schedule_ref}' is distinct from '"fund.fees"'::jsonb
      or ce->'exit_policy_refs' is distinct from '["fund.redemption","fund.dealing","fund.liquidity"]'::jsonb then
      raise exception 'common_envelope_fund_cross_reference' using errcode='22023'; end if;
  else
    if ce#>'{issuer,legal_name}' is distinct from terms#>'{real_estate,spv,legal_name}'
      or ce#>'{issuer,registration_reference}' is distinct from terms#>'{real_estate,spv,registration_reference}'
      or ce#>'{issuer,jurisdiction}' is distinct from terms#>'{real_estate,spv,jurisdiction}'
      or ce#>'{custody_title,title_evidence_reference}' is distinct from terms#>'{real_estate,property,title_evidence_reference}'
      or ce#>'{custody_title,control_evidence_reference}' is distinct from terms#>'{real_estate,property,control_evidence_reference}'
      or ce#>'{custody_title,asset_title_model}' is distinct from '"PROPERTY_SPV_INTEREST_DECLARATION"'::jsonb
      or ce#>'{register,authority}' is distinct from '"DECLARED_SPV_REGISTER"'::jsonb
      or ce#>'{transfer,eligible_transfer_policy}' is distinct from terms#>'{real_estate,exits,eligible_transfer_policy}'
      or ce#>'{transfer,consent_policy}' is distinct from terms#>'{real_estate,governance,consent_rights}'
      or ce#>'{transfer,lender_consent_policy_ref}' is distinct from '"real_estate.financing.lender_consent_policy"'::jsonb
      or ce#>'{fees,schedule_ref}' is distinct from '"real_estate.cashflow"'::jsonb
      or ce->'exit_policy_refs' is distinct from '["real_estate.exits.eligible_transfer_policy","real_estate.exits.disposal_liquidation_policy"]'::jsonb then
      raise exception 'common_envelope_property_cross_reference' using errcode='22023'; end if;
  end if;
  -- The retained validator receives only its original exact shape. Never persist this projection.
  perform bx1_portal.validate_terms(bx1_portal.product_common_envelope_economic_projection(terms));
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(terms->'eligible_countries')) <>
    (select pg_catalog.count(distinct q.value) from pg_catalog.jsonb_array_elements(terms->'eligible_countries') q(value))
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(terms->'eligible_investor_types')) <>
    (select pg_catalog.count(distinct q.value) from pg_catalog.jsonb_array_elements(terms->'eligible_investor_types') q(value)) then
    raise exception 'common_envelope_duplicate_eligibility' using errcode='22023'; end if;
end $$;

create table bx1_portal.product_issuer_declarations(
  product_id uuid not null references bx1_portal.products(id),
  issuer_reference uuid not null check(issuer_reference<>'00000000-0000-0000-0000-000000000000'),
  declaration_revision integer not null check(declaration_revision between 1 and 999999999),
  declaration jsonb not null check(pg_catalog.jsonb_typeof(declaration)='object'),
  declaration_hash text not null check(declaration_hash ~ '^[0-9a-f]{64}$'),
  declared_by uuid not null references auth.users(id),
  declared_at timestamptz not null,
  constraint bx1_ce_declaration_pk primary key(product_id,declaration_revision),
  constraint bx1_ce_declaration_identity unique(product_id,issuer_reference,declaration_revision),
  check(declaration_hash=bx1_portal.product_issuer_declaration_hash(product_id,declaration)),
  check(declaration ?& array['issuer_reference','declaration_revision','legal_name','registration_reference','jurisdiction','legal_form','governing_law']
    and declaration-array['issuer_reference','declaration_revision','legal_name','registration_reference','jurisdiction','legal_form','governing_law']='{}'::jsonb
    and declaration->'issuer_reference'=pg_catalog.to_jsonb(issuer_reference::text)
    and declaration->'declaration_revision'=pg_catalog.to_jsonb(declaration_revision))
);
alter table bx1_portal.product_issuer_declarations enable row level security;
revoke all on bx1_portal.product_issuer_declarations from public,anon,authenticated,service_role;
create trigger bx1_product_issuer_declaration_immutable before update or delete
  on bx1_portal.product_issuer_declarations for each row execute function bx1_portal.immutable_record();

alter table bx1_portal.offering_revisions
  add column common_envelope_hash text check(common_envelope_hash is null or common_envelope_hash ~ '^[0-9a-f]{64}$'),
  add column deployment_configuration_hash text check(deployment_configuration_hash is null or deployment_configuration_hash ~ '^[0-9a-f]{64}$'),
  add column issuer_declaration_reference uuid,
  add column issuer_declaration_revision integer,
  add constraint bx1_ce_revision_binding_shape check(
    (terms->'terms_version'='3'::jsonb and origin='SUBMITTED'
      and common_envelope_hash is not null and deployment_configuration_hash is not null
      and issuer_declaration_reference is not null and issuer_declaration_revision is not null)
    or (terms->'terms_version' is distinct from '3'::jsonb and common_envelope_hash is null
      and deployment_configuration_hash is null and issuer_declaration_reference is null
      and issuer_declaration_revision is null)),
  add constraint bx1_ce_revision_declaration foreign key(product_id,issuer_declaration_reference,issuer_declaration_revision)
    references bx1_portal.product_issuer_declarations(product_id,issuer_reference,declaration_revision),
  add constraint bx1_ce_revision_hash_identity unique(id,common_envelope_hash,deployment_configuration_hash);
alter table bx1_portal.offering_decisions
  add column common_envelope_hash text check(common_envelope_hash is null or common_envelope_hash ~ '^[0-9a-f]{64}$'),
  add column deployment_configuration_hash text check(deployment_configuration_hash is null or deployment_configuration_hash ~ '^[0-9a-f]{64}$'),
  add constraint bx1_ce_decision_binding_shape check(
    (common_envelope_hash is null and deployment_configuration_hash is null)
    or (common_envelope_hash is not null and deployment_configuration_hash is not null)),
  add constraint bx1_ce_decision_revision_binding foreign key(offering_revision_id,common_envelope_hash,deployment_configuration_hash)
    references bx1_portal.offering_revisions(id,common_envelope_hash,deployment_configuration_hash);

create function bx1_portal.guard_product_common_envelope_declaration() returns trigger
language plpgsql volatile security invoker parallel unsafe cost 100 set search_path='' as $$
declare issuer_payload jsonb; prior_issuer_payload jsonb; snapshot bx1_portal.product_issuer_declarations;
  next_declaration_revision integer; next_issuer_reference uuid;
begin
  if TG_OP='UPDATE' and old.terms->'terms_version'='3'::jsonb
    and new.terms->'terms_version' is distinct from '3'::jsonb then
    raise exception 'common_envelope_downgrade_denied' using errcode='23514'; end if;
  if new.terms->'terms_version' is distinct from '3'::jsonb then return new; end if;
  if auth.uid() is null then raise exception 'common_envelope_actor_required' using errcode='42501'; end if;
  perform bx1_portal.product_common_envelope_validate(new.terms);
  if new.terms#>>'{common_envelope,manager_organisation_id}' is distinct from new.organisation_id::text then
    raise exception 'common_envelope_manager_mismatch' using errcode='23514'; end if;
  issuer_payload:=new.terms#>'{common_envelope,issuer}';
  next_declaration_revision:=(issuer_payload->>'declaration_revision')::integer;
  next_issuer_reference:=(issuer_payload->>'issuer_reference')::uuid;
  if TG_OP='UPDATE' and old.terms->'terms_version'='3'::jsonb then
    prior_issuer_payload:=old.terms#>'{common_envelope,issuer}';
    if issuer_payload->'issuer_reference' is distinct from prior_issuer_payload->'issuer_reference'
      or new.terms#>'{common_envelope,classes,0,class_id}' is distinct from old.terms#>'{common_envelope,classes,0,class_id}'
      or next_declaration_revision is distinct from (prior_issuer_payload->>'declaration_revision')::integer
        + (case when issuer_payload-'declaration_revision' is distinct from prior_issuer_payload-'declaration_revision' then 1 else 0 end) then
      raise exception 'common_envelope_declaration_lineage' using errcode='23514'; end if;
  elsif next_declaration_revision<>1 then
    raise exception 'common_envelope_first_declaration_revision' using errcode='23514';
  end if;
  select * into snapshot from bx1_portal.product_issuer_declarations d
    where d.product_id=new.id and d.declaration_revision=next_declaration_revision;
  if snapshot.product_id is not null then
    if snapshot.issuer_reference is distinct from next_issuer_reference or snapshot.declaration is distinct from issuer_payload
      or snapshot.declaration_hash is distinct from bx1_portal.product_issuer_declaration_hash(new.id,issuer_payload) then
      raise exception 'common_envelope_immutable_declaration_conflict' using errcode='23514'; end if;
  else
    insert into bx1_portal.product_issuer_declarations(product_id,issuer_reference,declaration_revision,
      declaration,declaration_hash,declared_by,declared_at)
      values(new.id,next_issuer_reference,next_declaration_revision,issuer_payload,
        bx1_portal.product_issuer_declaration_hash(new.id,issuer_payload),auth.uid(),pg_catalog.clock_timestamp());
  end if;
  return new;
end $$;
create trigger bx1_product_common_envelope_declaration after insert or update of terms
  on bx1_portal.products for each row execute function bx1_portal.guard_product_common_envelope_declaration();

create function bx1_portal.product_common_envelope_review_replay_authority(c jsonb,kind text,verified_prior_payload jsonb) returns void
language plpgsql volatile security invoker parallel unsafe cost 100 set search_path='' as $$
declare actor uuid:=auth.uid(); action text; target_role text;
  p bx1_portal.products; o bx1_portal.organisations; r bx1_portal.offering_revisions;
  a bx1_portal.product_service_appointments; other_actor uuid;
begin
  if kind='ISSUER' then action:='review_offering_issuer'; target_role:='IssuerFundManager';
  elsif kind='COMPLIANCE' then action:='review_product'; target_role:='ComplianceOfficer';
  else raise exception 'common_envelope_replay_kind_invalid' using errcode='22023'; end if;
  if actor is null or pg_catalog.jsonb_typeof(verified_prior_payload) is distinct from 'object'
    or pg_catalog.octet_length(verified_prior_payload::text)>65536
    or pg_catalog.jsonb_typeof(verified_prior_payload->'product_id') is distinct from 'string'
    or verified_prior_payload->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(verified_prior_payload->'offering_revision_id') is distinct from 'string'
    or verified_prior_payload->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or bx1_portal.offering_workflow_command_context(c,action) is not true then
    raise exception 'common_envelope_replay_denied' using errcode='42501'; end if;
  select * into p from bx1_portal.products
    where id=(verified_prior_payload->>'product_id')::uuid for update;
  if p.id is null then raise exception 'common_envelope_replay_denied' using errcode='42501'; end if;
  perform bx1_portal.offering_workflow_lock_product(c,p.id);
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  select * into r from bx1_portal.offering_revisions
    where id=(verified_prior_payload->>'offering_revision_id')::uuid and product_id=p.id for share;
  if r.id is null or r.origin<>'SUBMITTED' or verified_prior_payload->>'terms_hash' is distinct from r.terms_hash then
    raise exception 'common_envelope_replay_package_mismatch' using errcode='23514'; end if;
  if r.terms->'terms_version'='3'::jsonb then
    perform bx1_portal.require_keys(verified_prior_payload,array['product_id','expected_revision','offering_revision_id',
      'terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);
    if pg_catalog.jsonb_typeof(verified_prior_payload->'common_envelope_hash') is distinct from 'string'
      or pg_catalog.jsonb_typeof(verified_prior_payload->'deployment_configuration_hash') is distinct from 'string'
      or verified_prior_payload->>'common_envelope_hash' is distinct from r.common_envelope_hash
      or verified_prior_payload->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then
      raise exception 'common_envelope_replay_hash_mismatch' using errcode='23514'; end if;
  else
    perform bx1_portal.require_keys(verified_prior_payload,array['product_id','expected_revision','offering_revision_id',
      'terms_hash','decision','notes','checks']);
  end if;
  select * into a from bx1_portal.product_service_appointments appointed
    where appointed.product_id=p.id and appointed.role=target_role
      and appointed.appointee_user_id=actor and appointed.status='APPLIED'
    order by appointed.id limit 1 for share;
  if a.id is null or o.id is null then raise exception 'common_envelope_replay_denied' using errcode='42501'; end if;
  perform m.id from public.bx1_memberships m where m.id=a.native_membership_id for share;
  perform profile.id from public.bx1_profiles profile where profile.id=actor for share;
  perform native_org.id from public.bx1_organisations native_org where native_org.id=(c->>'organisationId')::uuid for share;
  select d.actor_id into other_actor from bx1_portal.offering_decisions d
    where d.offering_revision_id=r.id and d.decision_kind=case kind when 'ISSUER' then 'COMPLIANCE' else 'ISSUER' end;
  perform bx1_portal.offering_workflow_lock_lineage_people(p.id,r.terms_hash,
    array[actor,r.submitted_by,p.created_by,o.owner_id,other_actor,
      a.requested_by_user_id,a.reviewed_by_user_id,a.applied_by_user_id]);
  if bx1_portal.offering_workflow_command_context(c,action) is not true
    or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,target_role) is not true
    or bx1_portal.offering_workflow_product_appointment_effective(a.id) is not true
    or bx1_portal.current_product_organisation(o.id) is not true
    or bx1_portal.offering_workflow_lineage_independent(actor,p.id,r.terms_hash) is not true
    or bx1_portal.offering_workflow_people_independent(actor,p.created_by) is not true
    or bx1_portal.offering_workflow_people_independent(actor,o.owner_id) is not true
    or bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) is not true
    or (other_actor is not null and bx1_portal.offering_workflow_people_independent(actor,other_actor) is not true) then
    raise exception 'common_envelope_replay_authority_changed' using errcode='42501'; end if;
end $$;

alter function bx1_portal.product_common_envelope_economic_projection(jsonb) owner to postgres;
alter function bx1_portal.product_common_envelope_validate(jsonb) owner to postgres;
alter function bx1_portal.product_issuer_declaration_hash(uuid,jsonb) owner to postgres;
alter function bx1_portal.product_common_envelope_hash(uuid,jsonb) owner to postgres;
alter function bx1_portal.product_deployment_configuration_hash(uuid,jsonb) owner to postgres;
alter function bx1_portal.product_common_envelope_review_replay_authority(jsonb,text,jsonb) owner to postgres;
alter function bx1_portal.guard_product_common_envelope_declaration() owner to postgres;
revoke all on function
  bx1_portal.product_common_envelope_economic_projection(jsonb),
  bx1_portal.product_common_envelope_validate(jsonb),
  bx1_portal.product_issuer_declaration_hash(uuid,jsonb),
  bx1_portal.product_common_envelope_hash(uuid,jsonb),
  bx1_portal.product_deployment_configuration_hash(uuid,jsonb),
  bx1_portal.product_common_envelope_review_replay_authority(jsonb,text,jsonb),
  bx1_portal.guard_product_common_envelope_declaration()
  from public,anon,authenticated,service_role;

-- Validate ALL original pins/counts before changing any retained body.
do $ce_install$
declare spec jsonb; change jsonb; target oid; source_body text; next_body text; definition text;
  before_row jsonb; after_row jsonb; occurrences integer;
  recipes jsonb:=$ce_recipes$
[
  {
    "signature": "bx1_portal.validate_terms(jsonb)",
    "expected_sha256": "81e1acde7c54b79ccb156d8826b78fed6972fbed5902a11ad573a74fde4c064d",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if terms->'terms_version'='3'::jsonb then\n    perform bx1_portal.product_common_envelope_validate(terms); return;\n  end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb)",
    "expected_sha256": "d363cc666efe673c63f4cc54cbc325d5ff06b76b7c7715c726ee86e386449879",
    "changes": [
      {
        "from": "proposed->'terms_version' is distinct from '2'::jsonb",
        "to": "(proposed->'terms_version' is distinct from '2'::jsonb and proposed->'terms_version' is distinct from '3'::jsonb)",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)",
    "expected_sha256": "d3c7a414f06c57eca679fc17067b5e53ee52a062200f884c4d786978b6a26fea",
    "changes": [
      {
        "from": "proposed->'terms_version' is distinct from '2'::jsonb",
        "to": "(proposed->'terms_version' is distinct from '2'::jsonb and proposed->'terms_version' is distinct from '3'::jsonb)",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_fund_v2_product()",
    "expected_sha256": "469bf99150dabdd5eebd124838c7cdc9eb12b5c506b1e005dc596b6465b7ea97",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if new.terms->'terms_version'='3'::jsonb\n    and new.terms#>>'{common_envelope,manager_organisation_id}' is distinct from new.organisation_id::text then\n    raise exception 'common_envelope_manager_mismatch' using errcode='23514'; end if;\n",
        "count": 1
      },
      {
        "from": "new.terms->'terms_version'='2'::jsonb",
        "to": "new.terms->'terms_version' in ('2'::jsonb,'3'::jsonb)",
        "count": 1
      },
      {
        "from": "new.terms->'terms_version' is distinct from '2'::jsonb",
        "to": "(new.terms->'terms_version' is distinct from '2'::jsonb and new.terms->'terms_version' is distinct from '3'::jsonb)",
        "count": 2
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_real_estate_v2_product()",
    "expected_sha256": "6b3787a70a63c1af688e449f45c3266c7593a539c54d531706d01035d9c5d551",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if new.terms->'terms_version'='3'::jsonb\n    and new.terms#>>'{common_envelope,manager_organisation_id}' is distinct from new.organisation_id::text then\n    raise exception 'common_envelope_manager_mismatch' using errcode='23514'; end if;\n",
        "count": 1
      },
      {
        "from": "new.terms->'terms_version'='2'::jsonb",
        "to": "new.terms->'terms_version' in ('2'::jsonb,'3'::jsonb)",
        "count": 1
      },
      {
        "from": "new.terms->'terms_version' is distinct from '2'::jsonb",
        "to": "(new.terms->'terms_version' is distinct from '2'::jsonb and new.terms->'terms_version' is distinct from '3'::jsonb)",
        "count": 2
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_fund_v2_subscription()",
    "expected_sha256": "1ec2a9e4cf9eb13ea820811e8d060236451aad137a56735ac613637e14e83472",
    "changes": [
      {
        "from": "p.terms->'terms_version'='2'::jsonb",
        "to": "p.terms->'terms_version' in ('2'::jsonb,'3'::jsonb)",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_product_appointment(jsonb,text,uuid,jsonb)",
    "expected_sha256": "b583a615e4cc279c887e9abcb368ac6eed14fa7b9307df8de9f62e3b72ff914c",
    "changes": [
      {
        "from": "body->'terms'->'terms_version'='2'::jsonb",
        "to": "body->'terms'->'terms_version' in ('2'::jsonb,'3'::jsonb)",
        "count": 1
      },
      {
        "from": "proposed_terms->'terms_version' is distinct from '2'::jsonb",
        "to": "(proposed_terms->'terms_version' is distinct from '2'::jsonb and proposed_terms->'terms_version' is distinct from '3'::jsonb)",
        "count": 2
      },
      {
        "from": "existing_terms->'terms_version' is distinct from '2'::jsonb",
        "to": "(existing_terms->'terms_version' is distinct from '2'::jsonb and existing_terms->'terms_version' is distinct from '3'::jsonb)",
        "count": 1
      },
      {
        "from": "existing_terms->'terms_version'='2'::jsonb",
        "to": "existing_terms->'terms_version' in ('2'::jsonb,'3'::jsonb)",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_command(jsonb,text,uuid,jsonb)",
    "expected_sha256": "a6bae2735d6ef351a8067ccc4b62c5441446d8de0063f77d1749b3d5b6a5dc8f",
    "changes": [
      {
        "from": "body#>'{terms,terms_version}'='2'::jsonb",
        "to": "body#>'{terms,terms_version}' in ('2'::jsonb,'3'::jsonb)",
        "count": 2
      }
    ]
  },
  {
    "signature": "bx1_portal.read_scoped_pre_handoff(jsonb)",
    "expected_sha256": "e68aa36870e00e923cc6509a398091712c1c659d3160f4ecb5ec2087e4ace027",
    "changes": [
      {
        "from": "manager_product.terms->'terms_version'='2'::jsonb",
        "to": "manager_product.terms->'terms_version' in ('2'::jsonb,'3'::jsonb)",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "expected_sha256": "71368afe93a25122b3f9cc1c80d08b3d10afe96b8b009fd361c67f4836d81903",
    "changes": [
      {
        "from": "perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id',\n      'terms_hash','decision','notes','checks']);",
        "to": "if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;",
        "count": 2
      },
      {
        "from": "  if action='review_product' or action='review_offering_issuer' then\n",
        "to": "  if action='review_product' or action='review_offering_issuer' then\n    if r.terms->'terms_version'='3'::jsonb then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n      if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'\n        or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'product_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'\n        or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'offering_revision_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'terms_hash') is distinct from 'string'\n        or body->>'terms_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'common_envelope_hash') is distinct from 'string'\n        or body->>'common_envelope_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'deployment_configuration_hash') is distinct from 'string'\n        or body->>'deployment_configuration_hash' !~ '^[0-9a-f]{64}$'\n        or body->>'common_envelope_hash' is distinct from r.common_envelope_hash\n        or body->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then\n        raise exception 'common_envelope_review_hash_mismatch' using errcode='23514'; end if;\n    else\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']);\n    end if;\n",
        "count": 1
      },
      {
        "from": "      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.read_scoped(c);",
        "to": "      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    if action='review_offering_issuer' then\n      perform bx1_portal.product_common_envelope_review_replay_authority(c,'ISSUER',prior.payload);\n    end if;\n    return bx1_portal.read_scoped(c);",
        "count": 1
      },
      {
        "from": "  elsif action='review_product' then\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true",
        "to": "  elsif action='review_product' then\n    if r.terms->'terms_version'='3'::jsonb then\n      raise exception 'common_envelope_private_compliance_denied' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)",
    "expected_sha256": "f74f8d5b1c0c2498588f379ecd6e4aa2fe8796e7722074228e9b15581ed4a9a3",
    "changes": [
      {
        "from": "perform bx1_portal.require_keys(body,array['product_id','expected_revision',\n    'offering_revision_id','terms_hash','decision','notes','checks']);",
        "to": "if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n    perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n  else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;",
        "count": 1
      },
      {
        "from": "  perform bx1_portal.require_text(body,'notes',20,3000);",
        "to": "    if r.terms->'terms_version'='3'::jsonb then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n      if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'\n        or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'product_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'\n        or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'offering_revision_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'terms_hash') is distinct from 'string'\n        or body->>'terms_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'common_envelope_hash') is distinct from 'string'\n        or body->>'common_envelope_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'deployment_configuration_hash') is distinct from 'string'\n        or body->>'deployment_configuration_hash' !~ '^[0-9a-f]{64}$'\n        or body->>'common_envelope_hash' is distinct from r.common_envelope_hash\n        or body->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then\n        raise exception 'common_envelope_review_hash_mismatch' using errcode='23514'; end if;\n    else\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']);\n    end if;\n  perform bx1_portal.require_text(body,'notes',20,3000);",
        "count": 1
      },
      {
        "from": "body-'offering_revision_id'-'terms_hash'",
        "to": "body-'offering_revision_id'-'terms_hash'-'common_envelope_hash'-'deployment_configuration_hash'",
        "count": 2
      },
      {
        "from": "      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.read_scoped(c);",
        "to": "      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    perform bx1_portal.product_common_envelope_review_replay_authority(c,'COMPLIANCE',prior.payload);\n    return bx1_portal.read_scoped(c);",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_offering_revision_product_lock()",
    "expected_sha256": "2bdecafe5af01707888c832894425ddc9276ff09997ecbef6f417e9d739a8c50",
    "changes": [
      {
        "from": "  if not found then raise exception 'offering_product_required' using errcode='23514'; end if;\n",
        "to": "  if not found then raise exception 'offering_product_required' using errcode='23514'; end if;\n  declare ce_product bx1_portal.products; ce_declaration bx1_portal.product_issuer_declarations;\n    ce_common text; ce_configuration text; ce_reference uuid; ce_revision integer;\n  begin\n    if new.terms->'terms_version'='3'::jsonb then\n      select * into ce_product from bx1_portal.products where id=new.product_id;\n      if new.origin is distinct from 'SUBMITTED' or new.terms is distinct from ce_product.terms\n        or new.terms_hash is distinct from pg_catalog.encode(pg_catalog.sha256(\n          pg_catalog.convert_to(ce_product.terms::text,'UTF8')),'hex') then\n        raise exception 'common_envelope_revision_provenance' using errcode='23514'; end if;\n      perform bx1_portal.product_common_envelope_validate(new.terms);\n      ce_reference:=(new.terms#>>'{common_envelope,issuer,issuer_reference}')::uuid;\n      ce_revision:=(new.terms#>>'{common_envelope,issuer,declaration_revision}')::integer;\n      select * into ce_declaration from bx1_portal.product_issuer_declarations d\n        where d.product_id=new.product_id and d.issuer_reference=ce_reference and d.declaration_revision=ce_revision for share;\n      if ce_declaration.product_id is null or ce_declaration.declaration is distinct from new.terms#>'{common_envelope,issuer}'\n        or ce_declaration.declaration_hash is distinct from bx1_portal.product_issuer_declaration_hash(\n          new.product_id,new.terms#>'{common_envelope,issuer}') then\n        raise exception 'common_envelope_revision_declaration' using errcode='23514'; end if;\n      ce_common:=bx1_portal.product_common_envelope_hash(new.product_id,new.terms);\n      ce_configuration:=bx1_portal.product_deployment_configuration_hash(new.product_id,new.terms);\n      if (new.common_envelope_hash is not null and new.common_envelope_hash is distinct from ce_common)\n        or (new.deployment_configuration_hash is not null and new.deployment_configuration_hash is distinct from ce_configuration)\n        or (new.issuer_declaration_reference is not null and new.issuer_declaration_reference is distinct from ce_reference)\n        or (new.issuer_declaration_revision is not null and new.issuer_declaration_revision is distinct from ce_revision) then\n        raise exception 'common_envelope_revision_binding' using errcode='23514'; end if;\n      new.common_envelope_hash:=ce_common; new.deployment_configuration_hash:=ce_configuration;\n      new.issuer_declaration_reference:=ce_reference; new.issuer_declaration_revision:=ce_revision;\n    elsif new.common_envelope_hash is not null or new.deployment_configuration_hash is not null\n      or new.issuer_declaration_reference is not null or new.issuer_declaration_revision is not null then\n      raise exception 'common_envelope_legacy_revision_binding' using errcode='23514';\n    end if;\n  end;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_offering_decision_appointment()",
    "expected_sha256": "903ae5858adb1a4f4e65d298cd507d026d4911debf30b6f1ab4a1ef254f0a9f0",
    "changes": [
      {
        "from": "  if p.id is null then\n    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;\n",
        "to": "  if p.id is null then\n    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;\n  declare ce_common text; ce_configuration text;\n  begin\n    if r.terms->'terms_version'='3'::jsonb then\n      if r.origin is distinct from 'SUBMITTED' or r.id is distinct from p.current_offering_revision_id\n        or r.terms is distinct from p.terms or r.terms_hash is distinct from p.terms_hash then\n        raise exception 'common_envelope_decision_provenance' using errcode='23514'; end if;\n      ce_common:=bx1_portal.product_common_envelope_hash(p.id,r.terms);\n      ce_configuration:=bx1_portal.product_deployment_configuration_hash(p.id,r.terms);\n      if r.common_envelope_hash is distinct from ce_common or r.deployment_configuration_hash is distinct from ce_configuration\n        or (new.common_envelope_hash is not null and new.common_envelope_hash is distinct from ce_common)\n        or (new.deployment_configuration_hash is not null and new.deployment_configuration_hash is distinct from ce_configuration) then\n        raise exception 'common_envelope_decision_binding' using errcode='23514'; end if;\n      new.common_envelope_hash:=ce_common; new.deployment_configuration_hash:=ce_configuration;\n    elsif new.common_envelope_hash is not null or new.deployment_configuration_hash is not null then\n      raise exception 'common_envelope_legacy_decision_binding' using errcode='23514';\n    end if;\n  end;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_approved(uuid)",
    "expected_sha256": "32b10d36ba3587b86f56973c5a3a3464741354bfd935fae02dfd829c76b00300",
    "changes": [
      {
        "from": "and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes",
        "to": "and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes\n      and (r.terms->'terms_version' is distinct from '3'::jsonb or\n        (issuer.common_envelope_hash=r.common_envelope_hash and issuer.deployment_configuration_hash=r.deployment_configuration_hash))",
        "count": 1
      },
      {
        "from": "and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes",
        "to": "and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes\n      and (r.terms->'terms_version' is distinct from '3'::jsonb or\n        (compliance.common_envelope_hash=r.common_envelope_hash and compliance.deployment_configuration_hash=r.deployment_configuration_hash))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_approved(uuid)",
    "expected_sha256": "97f8c77550140d329aee65c6cfc11277882897f8fddaed215ea14d65ab9dd2e6",
    "changes": [
      {
        "from": "and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes",
        "to": "and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes\n      and (r.terms->'terms_version' is distinct from '3'::jsonb or\n        (issuer.common_envelope_hash=r.common_envelope_hash and issuer.deployment_configuration_hash=r.deployment_configuration_hash))",
        "count": 1
      },
      {
        "from": "and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes",
        "to": "and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes\n      and (r.terms->'terms_version' is distinct from '3'::jsonb or\n        (compliance.common_envelope_hash=r.common_envelope_hash and compliance.deployment_configuration_hash=r.deployment_configuration_hash))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid)",
    "expected_sha256": "5673f1d7f8556a48019f8ef7307f264b5697eff9e76cb52440f8ec253e44c5fc",
    "changes": [
      {
        "from": "'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,",
        "to": "'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,\n    'common_envelope_hash',r.common_envelope_hash,'deployment_configuration_hash',r.deployment_configuration_hash,\n    'common_envelope',case when r.terms->'terms_version'='3'::jsonb then r.terms->'common_envelope' else null::jsonb end,\n    'deployment_configuration',case when r.terms->'terms_version'='3'::jsonb then r.terms->'deployment_configuration' else null::jsonb end,",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)",
    "expected_sha256": "e8ecb175c0f00f2ecd1076494ed4eb44647cb3029da9ce43bab1f85fbcb8e9f7",
    "changes": [
      {
        "from": "'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,",
        "to": "'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,\n    'common_envelope_hash',r.common_envelope_hash,'deployment_configuration_hash',r.deployment_configuration_hash,\n    'common_envelope',case when r.terms->'terms_version'='3'::jsonb then r.terms->'common_envelope' else null::jsonb end,\n    'deployment_configuration',case when r.terms->'terms_version'='3'::jsonb then r.terms->'deployment_configuration' else null::jsonb end,",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_history_projection(uuid)",
    "expected_sha256": "aaec401a3b39dd746884e0ac7d26fe4ed9862df343d6bc447421eed9e2919312",
    "changes": [
      {
        "from": "'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,",
        "to": "'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,\n    'common_envelope_hash',r.common_envelope_hash,'deployment_configuration_hash',r.deployment_configuration_hash,\n    'common_envelope',case when r.terms->'terms_version'='3'::jsonb then r.terms->'common_envelope' else null::jsonb end,\n    'deployment_configuration',case when r.terms->'terms_version'='3'::jsonb then r.terms->'deployment_configuration' else null::jsonb end,",
        "count": 1
      }
    ]
  }
]
$ce_recipes$::jsonb;
begin
  for spec in select value from pg_catalog.jsonb_array_elements(recipes) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'common_envelope_target_missing: %',spec->>'signature' using errcode='55000'; end if;
    select p.prosrc,pg_catalog.to_jsonb(p) into source_body,before_row from pg_catalog.pg_proc p where p.oid=target;
    if before_row->>'proowner' is distinct from ('postgres'::regrole::oid)::text
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from spec->>'expected_sha256' then
      raise exception 'common_envelope_definition_changed: %',spec->>'signature' using errcode='55000'; end if;
    next_body:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,change->>'from','')))
        /pg_catalog.length(change->>'from');
      if occurrences<>(change->>'count')::integer then
        raise exception 'common_envelope_callsite_changed: %',spec->>'signature' using errcode='55000'; end if;
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
  end loop;
  for spec in select value from pg_catalog.jsonb_array_elements(recipes) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select p.prosrc,pg_catalog.to_jsonb(p) into source_body,before_row from pg_catalog.pg_proc p where p.oid=target;
    next_body:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    definition:=pg_catalog.pg_get_functiondef(target);
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'common_envelope_body_ambiguous: %',spec->>'signature' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'common_envelope_catalog_changed: %',spec->>'signature' using errcode='55000'; end if;
  end loop;
end $ce_install$;
