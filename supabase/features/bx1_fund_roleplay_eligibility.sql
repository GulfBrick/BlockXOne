-- TEST-only same-operator product eligibility. This does NOT open an account,
-- approve an application, admit a provider or create document/payment evidence.
-- The existing application/account/monitoring gates remain authoritative.
do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)') is null
    or exists(select 1 from pg_catalog.pg_attribute where attrelid='bx1_portal.product_eligibility_cases'::regclass
      and attname='roleplay_policy_id' and not attisdropped)
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='bx1_portal.product_eligibility_cases'::regclass and conname='product_eligibility_cases_check'
        and contype='c' and pg_catalog.pg_get_constraintdef(oid)='CHECK (((reviewer_id IS NULL) OR (reviewer_id <> holder_user_id)))') then
    raise exception 'fund_roleplay_eligibility_exact_test_baseline_required' using errcode='55000';
  end if;
end $baseline$;

alter table bx1_portal.product_eligibility_cases
  add column roleplay_policy_id uuid references bx1_private.roleplay_policies(id) on delete restrict,
  add column roleplay_epoch integer,
  add column roleplay_request_context jsonb,
  add column roleplay_review_context jsonb,
  add constraint fund_roleplay_eligibility_provenance_shape check (
    (roleplay_policy_id is null and roleplay_epoch is null and roleplay_request_context is null and roleplay_review_context is null)
    or (roleplay_policy_id is not null and roleplay_epoch is not null and roleplay_epoch>0
      and account_kind='INDIVIDUAL' and holder_user_id is not null
      and roleplay_request_context is not null and jsonb_typeof(roleplay_request_context)='object'
      and (roleplay_review_context is null or jsonb_typeof(roleplay_review_context)='object')));

-- Only the existing, explicitly labelled TEST manager source may lack a
-- wealth-manager customer application. This is not a generic org admission.
create function bx1_private.fund_roleplay_eligibility_organisation_current(policy uuid,epoch integer,product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.roleplay_policies rp
    join bx1_portal.products p on p.id=rp.product_id and p.organisation_id=rp.product_organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id and o.status='ACTIVE' and o.application_id is null
    join bx1_private.test_workspace_sources source on source.id=o.test_workspace_source_id
      and source.product_organisation_id=o.id and source.user_id=o.owner_id
    join bx1_private.test_workspace_entitlements preparation on preparation.source_id=source.id
      and preparation.user_id=source.user_id and preparation.native_organisation_id=source.native_organisation_id
      and preparation.role='OfferingManager'
    where rp.id=policy and rp.authority_epoch=epoch and p.id=product
      and source.role='OfferingManager' and source.origin='TEST_EVALUATION' and source.environment='TESTNET'
      and o.reviewer_scope=rp.native_organisation_id and p.created_by=o.owner_id
      and rp.actual_operator_person_id=bx1_private.fund_roleplay_person_for(product,o.owner_id)
      and bx1_private.test_roleplay_binding_current(rp.id)
      and rp.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=product)
      and preparation.id=bx1_portal.test_offering_source_entitlement(o.id)
      and bx1_portal.test_offering_source_current(o.id,preparation.id,preparation.revision)),false);
$$;

-- Saved provenance can be checked by the existing restricted chain observer
-- without borrowing a customer's JWT. Command helpers separately require MFA.
create function bx1_private.fund_roleplay_eligibility_source(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_portal.product_eligibility_cases e
    join bx1_portal.investment_accounts i on i.id=e.investment_account_id and i.holder_user_id=e.holder_user_id
    join bx1_portal.applications a on a.id=i.application_id and a.user_id=e.holder_user_id
    join bx1_portal.products p on p.id=e.product_id and p.organisation_id=e.organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_private.roleplay_policies rp on rp.id=e.roleplay_policy_id and rp.authority_epoch=e.roleplay_epoch
    where e.id=target and e.account_kind='INDIVIDUAL' and i.kind='INDIVIDUAL' and i.status='ACTIVE'
      and a.persona='INVESTOR' and a.status='APPROVED' and a.approved_until>pg_catalog.clock_timestamp()
      and bx1_portal.monitoring_new_action_allowed(a.id) and e.application_revision=a.revision
      and a.details->>'investor_type'='INDIVIDUAL' and o.reviewer_scope=a.reviewer_scope
      and p.terms->'eligible_countries' ? (a.details->>'country')
      and p.terms->'eligible_investor_types' ? (a.details->>'investor_type')
      and e.product_revision=p.revision and e.terms_hash=p.terms_hash
      and e.offering_revision_id=p.current_offering_revision_id and rp.offering_revision_id=e.offering_revision_id
      and rp.product_id=p.id and rp.terms_hash=e.terms_hash and p.status='PUBLISHED'
      and bx1_portal.offering_operational(p.id) and bx1_portal.entry_manual_review_enabled()
      and p.created_by=e.holder_user_id and o.owner_id=e.holder_user_id
      and bx1_private.fund_roleplay_record_current(rp.id,rp.authority_epoch,p.id,e.offering_revision_id,
        e.holder_user_id,e.roleplay_request_context,'request_product_eligibility')
      and bx1_private.fund_roleplay_eligibility_organisation_current(rp.id,rp.authority_epoch,p.id)),false);
$$;

create function bx1_private.fund_roleplay_eligibility_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(bx1_private.fund_roleplay_eligibility_source(target) and exists(
    select 1 from bx1_portal.product_eligibility_cases e
    join bx1_private.roleplay_policies rp on rp.id=e.roleplay_policy_id and rp.authority_epoch=e.roleplay_epoch
    join bx1_portal.investment_accounts i on i.id=e.investment_account_id
    join bx1_portal.applications a on a.id=i.application_id
    where e.id=target and e.status='APPROVED' and e.reviewer_id=e.holder_user_id
      and e.reviewed_at is not null and e.approved_until>pg_catalog.clock_timestamp()
      and e.approved_until<=rp.valid_until and e.approved_until<=a.approved_until
      and e.review_checks='{"identity":true,"product_fit":true,"restrictions":true,"source_of_funds":true}'::jsonb
      and bx1_private.fund_roleplay_record_current(rp.id,rp.authority_epoch,e.product_id,e.offering_revision_id,
        e.reviewer_id,e.roleplay_review_context,'review_product_eligibility')),false);
$$;

create function bx1_private.fund_roleplay_eligibility_request(c jsonb,product uuid,account uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(c->>'mode'='ROLE' and c->>'role'='Investor' and exists(
    select 1 from bx1_private.roleplay_policies rp
    join bx1_portal.products p on p.id=rp.product_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.investment_accounts i on i.id=account and i.holder_user_id=auth.uid() and i.kind='INDIVIDUAL'
    join bx1_portal.applications a on a.id=i.application_id and a.user_id=auth.uid()
    where p.id=product and rp.id=bx1_private.fund_roleplay_current_policy(c,product,'request_product_eligibility')
      and bx1_private.fund_roleplay_context(c,product,'request_product_eligibility')
      and bx1_portal.account_usable(c,i.id) and a.status='APPROVED'
      and a.approved_until>pg_catalog.clock_timestamp() and bx1_portal.monitoring_new_action_allowed(a.id)
      and a.details->>'investor_type'='INDIVIDUAL' and o.reviewer_scope=a.reviewer_scope
      and p.created_by=auth.uid() and o.owner_id=auth.uid()
      and bx1_private.fund_roleplay_eligibility_organisation_current(rp.id,rp.authority_epoch,product)),false);
$$;

create function bx1_private.fund_roleplay_eligibility_review(c jsonb,target uuid,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(action in ('review_product_eligibility','revoke_product_eligibility')
    and c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
    and bx1_private.fund_roleplay_eligibility_source(target) and exists(
      select 1 from bx1_portal.product_eligibility_cases e
      join bx1_portal.investment_accounts i on i.id=e.investment_account_id
      join bx1_portal.applications a on a.id=i.application_id
      join bx1_portal.organisations o on o.id=e.organisation_id
      where e.id=target and e.holder_user_id=auth.uid()
        and e.roleplay_policy_id=bx1_private.fund_roleplay_current_policy(c,e.product_id,action)
        and bx1_private.fund_roleplay_context(c,e.product_id,action)
        and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
        and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)
        and bx1_private.fund_roleplay_appointed(c,e.product_id,'ComplianceOfficer')),false);
$$;

create function bx1_private.fund_roleplay_eligibility_enter(c jsonb,action text,key uuid,body jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare product uuid; saved bx1_portal.product_eligibility_cases; policy uuid;
begin
  if action='request_product_eligibility' then product:=(body->>'product_id')::uuid;
  elsif action in ('review_product_eligibility','revoke_product_eligibility') then
    select * into saved from bx1_portal.product_eligibility_cases where id=(body->>'eligibility_case_id')::uuid;
    if saved.roleplay_policy_id is null then return;end if;
    product:=saved.product_id;
  else return;end if;
  policy:=bx1_private.fund_roleplay_current_policy(c,product,action);
  if saved.roleplay_policy_id is not null and (policy is distinct from saved.roleplay_policy_id
    or not exists(select 1 from bx1_private.roleplay_policies rp where rp.id=policy and rp.authority_epoch=saved.roleplay_epoch)) then
    raise exception 'fund_roleplay_eligibility_saved_authority_expired' using errcode='42501';end if;
  if policy is null then return;end if;
  perform bx1_private.fund_roleplay_enter(c,product,action,key,null);
end $$;

create function bx1_private.fund_roleplay_eligibility_finish(c jsonb,action text,key uuid,body jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare product uuid;
begin
  if action='request_product_eligibility' then product:=(body->>'product_id')::uuid;
  elsif action in ('review_product_eligibility','revoke_product_eligibility') then
    select product_id into product from bx1_portal.product_eligibility_cases where id=(body->>'eligibility_case_id')::uuid;
  else return;end if;
  perform bx1_private.fund_roleplay_finish(c,product,action,key);
end $$;

create function bx1_private.fund_roleplay_eligibility_stamp() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.fund_roleplay_command_lanes;
begin
  select * into lane from bx1_private.fund_roleplay_command_lanes
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid() and product_id=NEW.product_id
      and action in ('request_product_eligibility','review_product_eligibility','revoke_product_eligibility');
  if TG_OP='UPDATE' then
    if NEW.roleplay_policy_id is distinct from OLD.roleplay_policy_id or NEW.roleplay_epoch is distinct from OLD.roleplay_epoch
      or NEW.roleplay_request_context is distinct from OLD.roleplay_request_context
      or NEW.roleplay_review_context is distinct from OLD.roleplay_review_context then
      raise exception 'fund_roleplay_eligibility_provenance_immutable' using errcode='23514';end if;
    if lane.actor_id is not null and OLD.roleplay_policy_id is null then
      raise exception 'fund_roleplay_eligibility_no_legacy_backfill' using errcode='42501';end if;
    if OLD.roleplay_policy_id is null then return NEW;end if;
  elsif lane.actor_id is null then
    if NEW.roleplay_policy_id is not null or NEW.roleplay_epoch is not null
      or NEW.roleplay_request_context is not null or NEW.roleplay_review_context is not null then
      raise exception 'fund_roleplay_eligibility_no_client_provenance' using errcode='42501';end if;
    return NEW;
  else
    if NEW.roleplay_policy_id is not null or NEW.roleplay_epoch is not null
      or NEW.roleplay_request_context is not null or NEW.roleplay_review_context is not null
      or lane.action<>'request_product_eligibility' or NEW.holder_user_id is distinct from auth.uid() then
      raise exception 'fund_roleplay_eligibility_invalid_insert_lane' using errcode='42501';end if;
    NEW.roleplay_policy_id:=lane.policy_id;NEW.roleplay_epoch:=lane.authority_epoch;
    NEW.roleplay_request_context:=lane.operating_context;
  end if;
  if lane.actor_id is null or lane.policy_id is distinct from NEW.roleplay_policy_id
    or lane.authority_epoch is distinct from NEW.roleplay_epoch
    or lane.offering_revision_id is distinct from NEW.offering_revision_id
    or bx1_private.fund_roleplay_lane_current(lane.operating_context,NEW.product_id,lane.action) is not true then
    raise exception 'fund_roleplay_eligibility_current_lane_required' using errcode='42501';end if;
  if lane.action='request_product_eligibility' then NEW.roleplay_review_context:=null;
  else NEW.roleplay_review_context:=lane.operating_context;end if;
  return NEW;
end $$;
create trigger zz_fund_roleplay_eligibility_provenance before insert or update on bx1_portal.product_eligibility_cases
  for each row execute function bx1_private.fund_roleplay_eligibility_stamp();

alter table bx1_portal.product_eligibility_cases drop constraint product_eligibility_cases_check;
alter table bx1_portal.product_eligibility_cases add constraint product_eligibility_cases_check check (
  reviewer_id is null or reviewer_id<>holder_user_id
  or (roleplay_policy_id is not null and roleplay_epoch is not null and roleplay_epoch>0
    and reviewer_id=holder_user_id and roleplay_review_context is not null));

create function bx1_private.fund_roleplay_eligibility_projection(c jsonb,target uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare e bx1_portal.product_eligibility_cases;rp bx1_private.roleplay_policies;
begin
  select * into e from bx1_portal.product_eligibility_cases where id=target;
  if e.roleplay_policy_id is null then return null;end if;
  select * into rp from bx1_private.roleplay_policies where id=e.roleplay_policy_id;
  return pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','assurance','TEST_ROLE_PLAY','independence_proven',false,
    'actor_id',auth.uid(),'operating_context',c,'operator_user_id',e.holder_user_id,'policy_id',rp.id,'authority_epoch',e.roleplay_epoch,
    'product_id',e.product_id,'offering_revision_id',e.offering_revision_id,'case_id',e.id,'case_revision',e.revision,
    'expires_at',rp.valid_until,'binding_current',bx1_private.fund_roleplay_eligibility_source(e.id),
    'review_allowed',bx1_private.fund_roleplay_eligibility_review(c,e.id,'review_product_eligibility'),
    'revoke_allowed',bx1_private.fund_roleplay_eligibility_review(c,e.id,'revoke_product_eligibility'),
    'label','TEST role-play: one operator, not independent human approval');
end $$;

create function bx1_private.fund_roleplay_eligibility_product_visible(c jsonb,product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(c->>'mode'='ROLE' and c->>'role'='Investor' and exists(
    select 1 from bx1_private.roleplay_policies rp join bx1_portal.products p on p.id=rp.product_id
    where p.id=product and p.status='PUBLISHED' and bx1_portal.offering_operational(p.id)
      and bx1_portal.is_eligible(p.terms) and bx1_private.fund_roleplay_context(c,p.id,'request_product_eligibility')
      and rp.id=bx1_private.fund_roleplay_current_policy(c,p.id,'request_product_eligibility')
      and bx1_private.fund_roleplay_eligibility_organisation_current(rp.id,rp.authority_epoch,p.id)),false);
$$;

-- Body-only exact cuts: preserve each existing OID/owner/security/ACL and all
-- unrelated predicates. Native NULL provenance remains on the original path.
do $cutover$
declare spec jsonb;change jsonb;target oid;original_body text;next_body text;definition text;before_row jsonb;after_row jsonb;occurrences integer;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($recipes$[
    {"signature":"bx1_portal.execute_scoped_pre_mandate(jsonb,text,uuid,jsonb)","hash":"b32671c74da4dbef33d21d776518e72cac565c14df3d1a6d578735c867731415","changes":[
      {"from":"begin\n  if bx1_portal.admission_password_session()","to":"begin\n  perform bx1_private.fund_roleplay_eligibility_enter(c,action,key,body);\n  if bx1_portal.admission_password_session()","count":1},
      {"from":"return bx1_portal.read_scoped(c);","to":"perform bx1_private.fund_roleplay_eligibility_finish(c,action,key,body); return bx1_portal.read_scoped(c);","count":3},
      {"from":"if not found or bx1_portal.product_eligibility_current(e.id) is not true","to":"if (not found and e.roleplay_policy_id is null) or bx1_portal.product_eligibility_current(e.id) is not true","count":1},
      {"from":"bx1_portal.independent_of(o.owner_id) is not true","to":"(bx1_portal.independent_of(o.owner_id) or case when action='request_product_eligibility' then bx1_private.fund_roleplay_eligibility_request(c,p.id,i.id) else bx1_private.fund_roleplay_eligibility_review(c,e.id,action) end) is not true","count":4},
      {"from":"bx1_portal.independent_of(p.created_by) is not true","to":"(bx1_portal.independent_of(p.created_by) or case when action='request_product_eligibility' then bx1_private.fund_roleplay_eligibility_request(c,p.id,i.id) else bx1_private.fund_roleplay_eligibility_review(c,e.id,action) end) is not true","count":4},
      {"from":"bx1_portal.independent_of(e.holder_user_id) is not true","to":"(bx1_portal.independent_of(e.holder_user_id) or bx1_private.fund_roleplay_eligibility_review(c,e.id,action)) is not true","count":3},
      {"from":"bx1_portal.current_product_organisation(o.id) is not true","to":"(bx1_portal.current_product_organisation(o.id) or bx1_private.fund_roleplay_eligibility_source(e.id)) is not true","count":1},
      {"from":"least(a.approved_until,v_now+interval '30 days')","to":"least(a.approved_until,v_now+interval '30 days',coalesce((select valid_until from bx1_private.roleplay_policies where id=e.roleplay_policy_id),'infinity'::timestamptz))","count":1},
      {"from":"else 'Independent product-specific synthetic eligibility decision: '||decision||'.' end","to":"when e.roleplay_policy_id is not null then 'TEST role-play product eligibility decision: '||decision||'; one operator, not independent human approval.' else 'Independent product-specific synthetic eligibility decision: '||decision||'.' end","count":1}
    ]},
    {"signature":"bx1_portal.product_eligibility_current_pre_monitoring(uuid)","hash":"323976e2fe529e38d92742fd132a278e72f62ac49ddb71ded4d51121a67a8319","changes":[
      {"from":"select exists(select 1 from bx1_portal.product_eligibility_cases e","to":"select case when exists(select 1 from bx1_portal.product_eligibility_cases saved where saved.id=target_case and saved.roleplay_policy_id is not null) then bx1_private.fund_roleplay_eligibility_current(target_case) else exists(select 1 from bx1_portal.product_eligibility_cases e","count":1},
      {"from":"and bx1_portal.entry_manual_review_enabled());","to":"and bx1_portal.entry_manual_review_enabled()) end;","count":1}
    ]},
    {"signature":"bx1_portal.scoped_product_visible(jsonb,uuid)","hash":"dd548ded9c96f0cad4290736052bda6013c2867399d55e9daa10048768f16921","changes":[
      {"from":"return bx1_portal.scoped_operator(c,o.id)","to":"return bx1_private.fund_roleplay_eligibility_product_visible(c,p.id)\n    or bx1_portal.scoped_operator(c,o.id)","count":1}
    ]},
    {"signature":"bx1_portal.read_scoped_pre_mandate(jsonb)","hash":"9f29a93c548365d41a3c6897c9fd57ffdf42daaa7b6e02b35e4b8aa0e8770067","changes":[
      {"from":"'product_revision',e.product_revision,'terms_hash',e.terms_hash,","to":"'product_revision',e.product_revision,'terms_hash',e.terms_hash,'offering_revision_id',e.offering_revision_id,\n    'roleplay',bx1_private.fund_roleplay_eligibility_projection(c,e.id),","count":1},
      {"from":"'can_decide',e.status='SUBMITTED'","to":"'can_decide',(e.roleplay_policy_id is null or bx1_private.fund_roleplay_eligibility_review(c,e.id,'review_product_eligibility')) and e.status='SUBMITTED'","count":1},
      {"from":"'can_approve',e.status='SUBMITTED'","to":"'can_approve',(e.roleplay_policy_id is null or bx1_private.fund_roleplay_eligibility_review(c,e.id,'review_product_eligibility')) and e.status='SUBMITTED'","count":1},
      {"from":"'can_revoke',e.status='APPROVED'","to":"'can_revoke',(e.roleplay_policy_id is null or bx1_private.fund_roleplay_eligibility_review(c,e.id,'revoke_product_eligibility')) and e.status='APPROVED'","count":1},
      {"from":"bx1_portal.independent_of(e.holder_user_id)","to":"(bx1_portal.independent_of(e.holder_user_id) or bx1_private.fund_roleplay_eligibility_review(c,e.id,case when e.status='APPROVED' then 'revoke_product_eligibility' else 'review_product_eligibility' end))","count":3},
      {"from":"bx1_portal.independent_of(o.owner_id)","to":"(bx1_portal.independent_of(o.owner_id) or bx1_private.fund_roleplay_eligibility_review(c,e.id,case when e.status='APPROVED' then 'revoke_product_eligibility' else 'review_product_eligibility' end))","count":3},
      {"from":"bx1_portal.independent_of(p.created_by)","to":"(bx1_portal.independent_of(p.created_by) or bx1_private.fund_roleplay_eligibility_review(c,e.id,case when e.status='APPROVED' then 'revoke_product_eligibility' else 'review_product_eligibility' end))","count":3},
      {"from":"and p.status='PUBLISHED' and bx1_portal.current_product_organisation(o.id),","to":"and p.status='PUBLISHED' and (bx1_portal.current_product_organisation(o.id) or bx1_private.fund_roleplay_eligibility_source(e.id)),","count":1}
    ]}
  ]$recipes$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select prosrc,pg_catalog.to_jsonb(p) into original_body,before_row from pg_catalog.pg_proc p where oid=target;
    next_body:=pg_catalog.btrim(pg_catalog.replace(original_body,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(next_body,'UTF8')),'hex') is distinct from spec->>'hash' then
      raise exception 'fund_roleplay_eligibility_source_changed: %',spec->>'signature' using errcode='55000';end if;
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,change->>'from','')))/pg_catalog.length(change->>'from');
      if occurrences<>(change->>'count')::integer then
        raise exception 'fund_roleplay_eligibility_cut_mismatch: % / %',spec->>'signature',change->>'from' using errcode='55000';end if;
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    definition:=pg_catalog.pg_get_functiondef(target);
    execute pg_catalog.replace(definition,original_body,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'fund_roleplay_eligibility_function_metadata_changed' using errcode='55000';end if;
  end loop;
end $cutover$;

do $acl$
declare signature text;grantee text;
begin
  foreach signature in array array[
    'bx1_private.fund_roleplay_eligibility_organisation_current(uuid,integer,uuid)',
    'bx1_private.fund_roleplay_eligibility_source(uuid)',
    'bx1_private.fund_roleplay_eligibility_current(uuid)',
    'bx1_private.fund_roleplay_eligibility_request(jsonb,uuid,uuid)',
    'bx1_private.fund_roleplay_eligibility_review(jsonb,uuid,text)',
    'bx1_private.fund_roleplay_eligibility_enter(jsonb,text,uuid,jsonb)',
    'bx1_private.fund_roleplay_eligibility_finish(jsonb,text,uuid,jsonb)',
    'bx1_private.fund_roleplay_eligibility_stamp()',
    'bx1_private.fund_roleplay_eligibility_projection(jsonb,uuid)',
    'bx1_private.fund_roleplay_eligibility_product_visible(jsonb,uuid)'] loop
    execute pg_catalog.format('alter function %s owner to postgres',signature);
    for grantee in select distinct case when a.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(r.rolname) end
      from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=pg_catalog.to_regprocedure(signature) and a.grantee<>p.proowner loop
      execute pg_catalog.format('revoke all on function %s from %s',signature,grantee);
    end loop;
  end loop;
end $acl$;
