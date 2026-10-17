-- Product-bound bridge from the existing TEST preparation source to the
-- existing owner-approved fund policy. This does not make the preparation
-- entitlement a professional mandate or grant access to other products.
-- Source-only until reviewed and installed inside one atomic TEST envelope.

do $manager_baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or bx1_private.test_roleplay_environment() is not true
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)') is not null
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)') is null then
    raise exception 'fund_roleplay_manager_exact_test_baseline_required' using errcode='55000';
  end if;
  if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
    from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('bx1_portal.offering_workflow_approved(uuid)'))
      is distinct from '629d4ed09bc213a99dc20e2367f045dfd2d3bfb9e0068b83eacf091ce3a09825' then
    raise exception 'fund_roleplay_manager_workflow_approval_dependency_changed' using errcode='55000';end if;
end $manager_baseline$;

create function bx1_private.fund_roleplay_manager_current(c jsonb,product uuid,action text default null) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(bx1_private.test_roleplay_protected_session() and c->>'mode'='ROLE'
    and c->>'role'='OfferingManager' and exists(
      select 1 from bx1_private.roleplay_policies policy
      join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy.id
        and capacity.user_id=auth.uid() and capacity.role='OfferingManager'
      join bx1_portal.products p on p.id=policy.product_id
      join bx1_portal.organisations organisation on organisation.id=p.organisation_id
      join bx1_private.test_workspace_sources source on source.id=organisation.test_workspace_source_id
      join bx1_private.test_workspace_entitlements preparation on preparation.source_id=source.id
        and preparation.user_id=source.user_id and preparation.native_organisation_id=source.native_organisation_id
        and preparation.role='OfferingManager'
      where p.id=product and p.created_by=auth.uid() and organisation.owner_id=auth.uid()
        and policy.project_ref='fegnnnlseuejkrusbbkv' and policy.environment='TESTNET'
        and organisation.id=policy.product_organisation_id and organisation.status='ACTIVE'
        and organisation.application_id is null and organisation.reviewer_scope=policy.native_organisation_id
        and source.product_organisation_id=organisation.id and source.user_id=auth.uid()
        and source.role='OfferingManager' and source.origin='TEST_EVALUATION' and source.environment='TESTNET'
        and preparation.id=bx1_portal.test_offering_source_entitlement(organisation.id)
        and bx1_portal.test_offering_source_current(organisation.id,preparation.id,preparation.revision)
        and p.current_offering_revision_id=policy.offering_revision_id and p.terms_hash=policy.terms_hash
        and policy.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=p.id)
        and bx1_private.fund_roleplay_record_current(policy.id,policy.authority_epoch,p.id,
          policy.offering_revision_id,auth.uid(),c,coalesce(action,capacity.actions[1]))
        and bx1_private.test_roleplay_current(policy.id,p.id,policy.offering_revision_id,auth.uid(),c,
          coalesce(action,capacity.actions[1]),null,policy.authority_epoch)),false);
$$;

create function bx1_private.fund_roleplay_manager_scope(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products product
    where bx1_private.fund_roleplay_manager_current(c,product.id));
$$;

create function bx1_private.fund_roleplay_manager_command_operator(c jsonb,target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  -- No lane means no additional organisation-wide writer authority. Only an
  -- already entered exact product/action in this transaction can continue the
  -- unchanged canonical writer; a customer cannot create this private row.
  select exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
    join bx1_portal.products product on product.id=lane.product_id
    where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.operating_context=c and product.organisation_id=target_org
      and lane.action in ('request_product_service_appointment','publish_product')
      and bx1_private.fund_roleplay_lane_current(c,product.id,lane.action)
      and bx1_private.fund_roleplay_manager_current(c,product.id,lane.action));
$$;

create function bx1_private.fund_roleplay_manager_offering_approved(c jsonb,product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  -- The workflow approval is already TEST-provenance-aware and retains exact
  -- terms, current appointments and genuine document/signature evidence. The
  -- legacy offering_approved helper remains unchanged for ordinary callers.
  select bx1_private.fund_roleplay_manager_current(c,product,'publish_product')
    and bx1_portal.offering_workflow_approved(product)
    and exists(select 1 from bx1_portal.products p where p.id=product
      and p.status in ('APPROVED','PUBLISHED'));
$$;


create function bx1_private.fund_roleplay_manager_actions(c jsonb,product uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select coalesce(pg_catalog.jsonb_agg(action order by ordinal),'[]'::jsonb)
    from pg_catalog.unnest(array['request_product_service_appointment','publish_product'])
      with ordinality x(action,ordinal)
    where bx1_private.fund_roleplay_manager_current(c,product,action)
      and (action<>'publish_product' or exists(select 1 from bx1_portal.products p where p.id=product
        and p.status='APPROVED' and bx1_private.fund_roleplay_manager_offering_approved(c,p.id)
        and bx1_portal.offering_technical_ready(p.current_offering_revision_id)));
$$;

create function bx1_private.fund_roleplay_manager_read(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; product bx1_portal.products; policy bx1_private.roleplay_policies;
  capacity bx1_private.roleplay_capacities; products_json jsonb:='[]'::jsonb;
  organisations_json jsonb; appointments_json jsonb; candidates_json jsonb; commands jsonb;
begin
  if bx1_private.fund_roleplay_manager_scope(c) is not true then
    raise exception 'fund_roleplay_manager_read_denied' using errcode='42501';end if;
  -- Each shown product uses its actual current factor/session/native capacity,
  -- policy and original preparation source. No simulated session is created.
  for product in select * from bx1_portal.products p
    where bx1_private.fund_roleplay_manager_current(c,p.id) order by p.id loop
    select saved.* into policy from bx1_private.roleplay_policies saved
      where saved.product_id=product.id and saved.version=(select max(later.version)
        from bx1_private.roleplay_policies later where later.product_id=product.id);
    select * into capacity from bx1_private.roleplay_capacities
      where policy_id=policy.id and user_id=auth.uid() and role='OfferingManager';
    perform bx1_private.test_roleplay_lock(c,product.id,capacity.actions[1],null);
    perform bx1_portal.test_offering_lock_source(product.organisation_id);
    if bx1_private.fund_roleplay_manager_current(c,product.id) is not true then
      raise exception 'fund_roleplay_manager_read_changed_after_wait' using errcode='42501';end if;
    products_json:=products_json||pg_catalog.jsonb_build_array(
      (pg_catalog.to_jsonb(product)-array['cap_units','minimum_units','unit_price_minor'])||
      pg_catalog.jsonb_build_object('reserved_units',product.reserved_units::text,
        'offering_package',bx1_portal.offering_workflow_package_projection(c,product.id),
        'offering_history',bx1_portal.offering_history_projection(product.id),
        'allowed_actions',bx1_private.fund_roleplay_manager_actions(c,product.id)));
  end loop;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',o.id,'name',o.name,'status',o.status,'native_organisation_id',c->>'organisationId',
    'roles','["OfferingManager"]'::jsonb,'authority_source','TEST_ROLE_PLAY',
    'capabilities',(select coalesce(pg_catalog.jsonb_agg(distinct action),'[]'::jsonb)
      from bx1_portal.products p cross join lateral
        pg_catalog.jsonb_array_elements(bx1_private.fund_roleplay_manager_actions(c,p.id)) x(action)
      where p.organisation_id=o.id and bx1_private.fund_roleplay_manager_current(c,p.id)))
    order by o.id),'[]'::jsonb) into organisations_json
    from bx1_portal.organisations o where exists(select 1 from bx1_portal.products p
      where p.organisation_id=o.id and bx1_private.fund_roleplay_manager_current(c,p.id));
  select coalesce(pg_catalog.jsonb_agg(shown.value order by appointment.id),'[]'::jsonb) into appointments_json
    from bx1_portal.product_service_appointments appointment
    cross join lateral(select bx1_portal.offering_workflow_appointment_projection(c,appointment.id) value) shown
    where bx1_private.fund_roleplay_manager_current(c,appointment.product_id)
      and bx1_portal.offering_workflow_appointment_visible(c,appointment.id) and shown.value is not null;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'product_id',p.id,'role',candidate.role,'user_id',candidate.user_id,
    'membership_id',candidate.native_membership_id,'display_name',profile.display_name,'email',u.email)
    order by p.id,candidate.role),'[]'::jsonb) into candidates_json
    from bx1_portal.products p join bx1_private.roleplay_policies saved on saved.product_id=p.id
    join bx1_private.roleplay_capacities candidate on candidate.policy_id=saved.id
      and candidate.user_id=auth.uid() and candidate.role in ('IssuerFundManager','ComplianceOfficer')
    join public.bx1_profiles profile on profile.id=candidate.user_id join auth.users u on u.id=candidate.user_id
    where bx1_private.fund_roleplay_manager_current(c,p.id,'request_product_service_appointment')
      and saved.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=p.id)
      and bx1_private.fund_roleplay_record_current(saved.id,saved.authority_epoch,p.id,saved.offering_revision_id,
        candidate.user_id,pg_catalog.jsonb_build_object('mode','ROLE','organisationId',saved.native_organisation_id,
          'role',candidate.role),candidate.actions[1]);
  select coalesce(pg_catalog.jsonb_agg(distinct action),'[]'::jsonb) into commands from bx1_portal.products p
    cross join lateral pg_catalog.jsonb_array_elements(bx1_private.fund_roleplay_manager_actions(c,p.id)) x(action)
    -- offering_access is the existing preparation-only command contract.
    -- Publication is carried by exact product.allowed_actions, not this enum.
    where bx1_private.fund_roleplay_manager_current(c,p.id)
      and action='"request_product_service_appointment"'::jsonb;
  select pg_catalog.jsonb_build_object('operating_context',c,'base_records_available',false,
    'actor',pg_catalog.jsonb_build_object('id',auth.uid(),'email',u.email,
      'display_name',profile.display_name,'can_review',false),
    'applications','[]'::jsonb,'accounts','[]'::jsonb,'entity_investment_accounts','[]'::jsonb,
    'organisation_mandates','[]'::jsonb,'investing_representative_mandates','[]'::jsonb,
    'subscriptions','[]'::jsonb,'product_eligibility','[]'::jsonb,'entity_product_eligibility','[]'::jsonb,
    'customer_monitoring','[]'::jsonb,'events','[]'::jsonb,
    'products',products_json,'organisations',organisations_json,'product_appointments',appointments_json,
    'product_appointment_candidates',candidates_json,
    'offering_access',pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','actor_id',auth.uid(),
      'operating_context',c,'session_mode','STANDARD','allowed_commands',commands),
    'requests',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.request_key,'command',r.action)
      order by r.recorded_at desc,r.id),'[]'::jsonb) from bx1_private.fund_roleplay_command_receipts r
      where r.actual_actor_id=auth.uid() and r.operating_context=c
        and bx1_private.fund_roleplay_manager_current(c,r.product_id)
        and bx1_private.fund_roleplay_record_current(r.policy_id,r.authority_epoch,r.product_id,
          r.offering_revision_id,r.actual_actor_id,r.operating_context,r.action)))
    into result from auth.users u join public.bx1_profiles profile on profile.id=u.id where u.id=auth.uid();
  if result is null or bx1_private.fund_roleplay_manager_scope(c) is not true
    or exists(select 1 from pg_catalog.jsonb_array_elements(products_json) shown(value)
      where bx1_private.fund_roleplay_manager_current(c,(value->>'id')::uuid) is not true
        or not exists(select 1 from bx1_portal.products live where live.id=(value->>'id')::uuid
          and live.revision=(value->>'revision')::integer and live.status=value->>'status'
          and live.terms_hash=value->>'terms_hash')
        or coalesce(bx1_portal.offering_workflow_package_projection(c,(value->>'id')::uuid),'null'::jsonb)
          is distinct from value->'offering_package'
        or bx1_private.fund_roleplay_manager_actions(c,(value->>'id')::uuid) is distinct from value->'allowed_actions')
    or exists(select 1 from pg_catalog.jsonb_array_elements(candidates_json) shown(value)
      where not exists(select 1 from bx1_private.roleplay_policies saved
        join bx1_private.roleplay_capacities candidate on candidate.policy_id=saved.id
        where saved.product_id=(value->>'product_id')::uuid and candidate.user_id=(value->>'user_id')::uuid
          and candidate.native_membership_id=(value->>'membership_id')::uuid and candidate.role=value->>'role'
          and saved.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=saved.product_id)
          and bx1_private.fund_roleplay_record_current(saved.id,saved.authority_epoch,saved.product_id,
            saved.offering_revision_id,candidate.user_id,pg_catalog.jsonb_build_object(
              'mode','ROLE','organisationId',saved.native_organisation_id,'role',candidate.role),candidate.actions[1])))
    or exists(select 1 from pg_catalog.jsonb_array_elements(appointments_json) shown(value)
      where bx1_portal.offering_workflow_appointment_visible(c,(value->>'id')::uuid) is not true
        or bx1_portal.offering_workflow_appointment_projection(c,(value->>'id')::uuid) is distinct from value) then
    raise exception 'fund_roleplay_manager_read_authority_changed' using errcode='42501';end if;
  return result;
end $$;

create function bx1_private.fund_roleplay_manager_publish_lane(product uuid,key uuid,c jsonb default null) returns boolean
language sql volatile security definer set search_path='' as $$
  -- Canonical continuation, not a public permission API. Exact entered
  -- product/action/key remains mandatory even for a context-free base writer.
  select exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
    join bx1_portal.products p on p.id=lane.product_id
    where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.product_id=product and lane.request_key=key and lane.action='publish_product'
      and (c is null or lane.operating_context=c)
      and bx1_private.fund_roleplay_lane_current(lane.operating_context,p.id,'publish_product')
      and bx1_private.fund_roleplay_manager_current(lane.operating_context,p.id,'publish_product')
      and p.status in ('APPROVED','PUBLISHED') and bx1_private.fund_roleplay_manager_offering_approved(lane.operating_context,p.id)
      and bx1_portal.offering_technical_ready(p.current_offering_revision_id));
$$;


create function bx1_private.fund_roleplay_manager_publish(c jsonb,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare product uuid; policy uuid; result jsonb; prior bx1_portal.scoped_requests;
begin
  if key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object' then
    raise exception 'fund_roleplay_manager_publish_denied' using errcode='42501';end if;
  perform bx1_portal.require_keys(body,array['product_id','expected_revision']);
  if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'
    or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'fund_roleplay_manager_publish_invalid' using errcode='22023';end if;
  product:=(body->>'product_id')::uuid;
  if bx1_private.fund_roleplay_manager_current(c,product,'publish_product') is not true then
    raise exception 'fund_roleplay_manager_publish_denied' using errcode='42501';end if;
  policy:=bx1_private.fund_roleplay_enter(c,product,'publish_product',key);
  if policy is null then raise exception 'fund_roleplay_manager_publish_denied' using errcode='42501';end if;
  perform bx1_portal.test_offering_lock_source((select organisation_id from bx1_portal.products where id=product));
  select * into prior from bx1_portal.scoped_requests where actor_id=auth.uid() and request_key=key;
  if prior.actor_id is not null then
    if prior.operating_context is distinct from c or prior.command is distinct from 'publish_product'
      or prior.payload is distinct from body
      or not exists(select 1 from bx1_private.fund_roleplay_command_receipts receipt
        where receipt.actual_actor_id=auth.uid() and receipt.request_key=key and receipt.action='publish_product'
          and receipt.policy_id=policy and receipt.product_id=product and receipt.operating_context=c
          and bx1_private.fund_roleplay_record_current(receipt.policy_id,receipt.authority_epoch,
            product,receipt.offering_revision_id,auth.uid(),c,'publish_product')) then
      raise exception 'fund_roleplay_manager_publish_replay_conflict' using errcode='23505';end if;
    perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);
    return bx1_private.fund_roleplay_manager_read(c);
  end if;
  if not exists(select 1 from bx1_portal.products p where p.id=product
    and p.revision=(body->>'expected_revision')::integer and p.status='APPROVED'
    and bx1_private.fund_roleplay_manager_offering_approved(c,p.id) and bx1_portal.offering_technical_ready(p.current_offering_revision_id)) then
    raise exception 'fund_roleplay_manager_approved_ready_offering_required' using errcode='23514';end if;
  -- ONE unchanged business writer. No status, readiness, provider, payment or
  -- ownership result is inserted by this bridge.
  result:=bx1_portal.execute_scoped_pre_monitoring(c,'publish_product',key,body);
  if bx1_private.fund_roleplay_manager_current(c,product,'publish_product') is not true then
    raise exception 'fund_roleplay_manager_publish_changed_at_commit' using errcode='42501';end if;
  perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);
  return result;
end $$;


do $manager_cutover$
declare spec jsonb;target oid;before_row jsonb;after_row jsonb;source_body text;definition text;next_body text;
begin
  for spec in select value from pg_catalog.jsonb_array_elements(
$manager_specs$
[
{
  "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
  "sha": "2266f7763fd51e95d624a8a80d6b817241b8ea1bd399ba41be6a77286132a86f",
  "secdef": true,
  "owner": "postgres",
  "acl": "{postgres=X/postgres}",
  "config": [
    "search_path=\"\""
  ],
  "next_body": "declare actor uuid:=auth.uid(); p bx1_portal.products; o bx1_portal.organisations;\n  r bx1_portal.offering_revisions; d bx1_portal.offering_decisions;\n  prior bx1_portal.scoped_requests; original_revision integer; decision text; counter integer;\nbegin\n  if action='review_offering_issuer' then perform bx1_private.fund_roleplay_enter(c,bx1_portal.test_offering_target(action,body),action,key);end if;\n  if bx1_portal.admission_password_session() and action='review_product' then\n    return bx1_portal.execute_appointed_compliance_decision(c,key,body); end if;\n  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n  if action not in ('save_product','submit_product','review_product','review_offering_issuer',\n    'publish_product','subscribe') then\n    return bx1_portal.offering_workflow_parent_command(c,action,key,body); end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true or\n    key is null or key='00000000-0000-0000-0000-000000000000' or\n    pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'offering_context_or_command_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;\n  if prior.actor_id is not null then\n    if prior.operating_context is distinct from c or prior.command is distinct from action\n      or prior.payload is distinct from body then\n      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    if action='review_offering_issuer' then\n      perform bx1_portal.product_common_envelope_review_replay_authority(c,'ISSUER',prior.payload);\n    end if;\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key) then\n    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;\n\n  if action='subscribe' then\n    perform bx1_portal.require_keys(body,array['product_id','expected_revision','terms_hash','units',\n      'accepted_documents','accepted_risks','investment_account_id','offering_revision_id']);\n  elsif action='review_product' then\n    if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  elsif action='review_offering_issuer' then\n    if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  end if;\n  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;\n  if p.id is null then raise exception 'offering_product_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;\n  perform id from bx1_portal.organisation_authority_bindings\n    where product_organisation_id=o.id order by id for share;\n  original_revision:=p.revision;\n  if action in ('review_product','review_offering_issuer','subscribe','publish_product') then\n    select * into r from bx1_portal.offering_revisions\n      where id=p.current_offering_revision_id and product_id=p.id;\n    if r.id is null or r.origin<>'SUBMITTED' or r.terms_hash is distinct from p.terms_hash\n      or r.terms is distinct from p.terms then\n      raise exception 'offering_current_package_required' using errcode='23514'; end if;\n  end if;\n\n  if action='review_product' or action='review_offering_issuer' then\n    if r.terms->'terms_version'='3'::jsonb then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n      if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'\n        or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'product_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'\n        or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'offering_revision_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'terms_hash') is distinct from 'string'\n        or body->>'terms_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'common_envelope_hash') is distinct from 'string'\n        or body->>'common_envelope_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'deployment_configuration_hash') is distinct from 'string'\n        or body->>'deployment_configuration_hash' !~ '^[0-9a-f]{64}$'\n        or body->>'common_envelope_hash' is distinct from r.common_envelope_hash\n        or body->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then\n        raise exception 'common_envelope_review_hash_mismatch' using errcode='23514'; end if;\n    else\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']);\n    end if;\n    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'\n      or (body->>'expected_revision')::integer<>p.revision\n      or body->>'offering_revision_id' is distinct from r.id::text\n      or body->>'terms_hash' is distinct from r.terms_hash then\n      raise exception 'offering_stale_package' using errcode='23514'; end if;\n    perform bx1_portal.require_text(body,'notes',20,3000);\n    decision:=body->>'decision';\n    if decision not in ('APPROVED','CHANGES_REQUIRED') then\n      raise exception 'offering_decision_invalid' using errcode='22023'; end if;\n  end if;\n\n  if action='save_product' then\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n    update bx1_portal.products set current_offering_revision_id=null where id=p.id;\n  elsif action='submit_product' then\n    select * into r from bx1_portal.offering_revisions\n      where product_id=p.id and origin='SUBMITTED' order by package_number desc limit 1;\n    if r.id is not null and r.terms_hash=p.terms_hash then\n      raise exception 'offering_unchanged_resubmission' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n    select * into p from bx1_portal.products where id=p.id;\n    select coalesce(max(package_number),0)+1 into counter\n      from bx1_portal.offering_revisions where product_id=p.id;\n    insert into bx1_portal.offering_revisions(product_id,package_number,origin,\n      product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)\n      values(p.id,counter,'SUBMITTED',p.revision,p.terms,p.terms_hash,\n        bx1_portal.offering_document_hashes(p.terms),actor,pg_catalog.clock_timestamp()) returning * into r;\n    update bx1_portal.products set current_offering_revision_id=r.id where id=p.id;\n  elsif action='review_product' then\n    if r.terms->'terms_version'='3'::jsonb then\n      raise exception 'common_envelope_private_compliance_denied' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true\n      or (bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_compliance_scope_denied' using errcode='42501'; end if;\n    select * into d from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='ISSUER';\n    perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true\n      or (bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_compliance_authority_changed' using errcode='42501'; end if;\n    if d.id is not null and (bx1_portal.offering_workflow_people_independent(actor,d.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_independent_review_required' using errcode='42501'; end if;\n    if exists(select 1 from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='COMPLIANCE') then\n      raise exception 'offering_decision_already_recorded' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,\n      body-'offering_revision_id'-'terms_hash');\n    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n      values(r.id,'COMPLIANCE',decision,actor,c,r.terms_hash,r.document_hashes,\n        original_revision,body->>'notes',body->'checks');\n    -- The inherited reviewer writer labels Compliance-only approval APPROVED.\n    -- Correct the enduring product state in the same transaction: the entire\n    -- offering is approved only after the separately appointed issuer agrees.\n    if decision='APPROVED' and coalesce(d.decision,'PENDING')<>'APPROVED' then\n      update bx1_portal.products set status='IN_REVIEW' where id=p.id;\n    end if;\n  elsif action='review_offering_issuer' then\n    perform bx1_portal.require_checks(body->'checks',array['issuer_authority','terms','rights'],decision='APPROVED');\n    if p.status not in ('IN_REVIEW','APPROVED') or bx1_portal.offering_workflow_issuer_authorised(c,p.id) is not true then\n      raise exception 'offering_issuer_appointment_required' using errcode='42501'; end if;\n    -- Pin the native appointment source through commit. A concurrent role or\n    -- organisation suspension cannot race the independently recorded choice.\n    perform m.id from public.bx1_memberships m\n      where m.user_id=actor and m.organisation_id=(c->>'organisationId')::uuid\n        and m.role='IssuerFundManager' order by m.id for share;\n    perform n.id from public.bx1_organisations n\n      where n.id=(c->>'organisationId')::uuid for share;\n    select * into d from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='COMPLIANCE';\n    perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    if d.id is not null and (bx1_portal.offering_workflow_people_independent(actor,d.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_independent_issuer_required' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_command_context(c,action) is not true or\n      bx1_portal.offering_workflow_issuer_authorised(c,p.id) is not true then\n      raise exception 'offering_issuer_authority_changed' using errcode='42501'; end if;\n    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n      values(r.id,'ISSUER',decision,actor,c,r.terms_hash,r.document_hashes,\n        original_revision,body->>'notes',body->'checks');\n    update bx1_portal.products set revision=revision+1,\n      status=case when decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'\n        when d.decision='APPROVED' then 'APPROVED' else 'IN_REVIEW' end\n      where id=p.id;\n    insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)\n      values(r.id,p.organisation_id,action,actor,\n        'Appointed issuer decided exact immutable test offering package: '||decision||'. No publication or chain deployment.');\n    insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)\n      values(actor,key,c,action,body);\n  elsif action='publish_product' then\n    if bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then\n      raise exception 'offering_operator_denied' using errcode='42501'; end if;\n    if (bx1_portal.offering_approved(p.id) or (action='publish_product'\n      and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c)\n      and bx1_portal.offering_workflow_approved(p.id))) is not true then\n      raise exception 'offering_issuer_and_compliance_approval_required' using errcode='23514'; end if;\n    if bx1_portal.offering_technical_ready(r.id) is not true then\n      raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n  elsif action='subscribe' then\n    if body->>'offering_revision_id' is distinct from r.id::text\n      or body->>'terms_hash' is distinct from r.terms_hash\n      or bx1_portal.scoped_product_visible(c,p.id) is not true\n      or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true then\n      raise exception 'offering_not_open' using errcode='42501'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body-'offering_revision_id');\n  end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'offering_context_changed' using errcode='42501'; end if;\n  perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\nend"
},
{
  "signature": "bx1_portal.offering_workflow_parent_command(jsonb,text,uuid,jsonb)",
  "sha": "0c3922a9aa573c2ba01c6690cbd2b668a07c00f7710af5fbb82642f0b212234b",
  "secdef": true,
  "owner": "postgres",
  "acl": "{postgres=X/postgres}",
  "config": [
    "search_path=\"\""
  ],
  "next_body": "\nbegin\n  if action='publish_product' and pg_catalog.jsonb_typeof(body)='object'\n    and body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n    and bx1_private.fund_roleplay_manager_publish_lane((body->>'product_id')::uuid,key,c) then\n    return bx1_portal.offering_workflow_parent_command_pre_test_workspace(c,action,key,body); end if;\n  if bx1_portal.test_workspace_entitlement(c) is not null then\n    if c->>'role' is distinct from 'OfferingManager' or action is null or action not in ('save_product','submit_product')\n      or bx1_portal.offering_workflow_command_allowed(c,action) is not true then\n      raise exception 'test_workspace_parent_command_denied' using errcode='42501'; end if;\n    perform bx1_portal.test_workspace_lock(c);\n    return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body);\n  end if;\n  return bx1_portal.offering_workflow_parent_command_pre_test_workspace(c,action,key,body);\nend "
},
{
  "signature": "bx1_portal.execute_command_pre_entry(text,uuid,jsonb)",
  "sha": "0ea0a32d3497a02586361c69f1b3dd56e63a30677a4cd7e23b891a6499b3bf17",
  "secdef": true,
  "owner": "postgres",
  "acl": "{postgres=X/postgres}",
  "config": [
    "search_path=\"\""
  ],
  "next_body": "declare\n  v_actor uuid:=auth.uid(); v_request bx1_portal.requests; a bx1_portal.applications;\n  p bx1_portal.products; o bx1_portal.organisations; s bx1_portal.subscriptions;\n  v_subject uuid; v_application uuid; v_org uuid; v_investor uuid; v_units numeric; v_revision integer;\n  v_now timestamptz:=clock_timestamp(); v_summary text;\nbegin\n  if bx1_portal.admission_password_session() and command is distinct from 'review_application' then\n    raise exception 'admission_legacy_command_denied' using errcode='42501'; end if;\n  if bx1_portal.admission_password_session() then\n    perform bx1_portal.admission_lock_actor(command,bx1_portal.admission_review_context((payload->>'application_id')::uuid)); end if;\n  if (bx1_portal.has_session() or bx1_portal.admission_password_session()) is not true then raise exception 'portal_session_required' using errcode='42501'; end if;\n  if request_key is null or request_key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>65536 then raise exception 'portal_invalid_command' using errcode='22023'; end if;\n  -- All commands by one principal serialize, including first application creation.\n  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));\n  if (bx1_portal.has_session() or bx1_portal.admission_password_session()) is not true then raise exception 'portal_session_required' using errcode='42501'; end if;\n  select * into v_request from bx1_portal.requests r where r.actor_id=v_actor and r.request_key=execute_command_pre_entry.request_key;\n  if found then\n    if v_request.command is distinct from command or v_request.payload is distinct from payload then raise exception 'portal_idempotency_conflict' using errcode='23505'; end if;\n    -- Fresh scoped view, not a historical snapshot that could disclose revoked access.\n    if bx1_portal.admission_password_session() then return bx1_portal.admission_read_scoped(bx1_portal.admission_review_context((payload->>'application_id')::uuid)); end if;\n    if command='publish_product' and bx1_private.fund_roleplay_manager_publish_lane((payload->>'product_id')::uuid,request_key) then\n      return bx1_private.fund_roleplay_manager_read((select lane.operating_context from bx1_private.fund_roleplay_command_lanes lane\n        where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n          and lane.product_id=(payload->>'product_id')::uuid and lane.action='publish_product' and lane.request_key=execute_command_pre_entry.request_key));\n    end if;\n    return bx1_portal.read_state();\n  end if;\n  if command='submit_application' then\n    perform bx1_portal.require_keys(payload,array['persona','expected_revision','details']);\n    if coalesce(payload->>'persona','') not in ('INVESTOR','WEALTH_MANAGER') or jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[0-9]{1,9}$' then raise exception 'portal_invalid_application' using errcode='22023'; end if;\n    perform bx1_portal.validate_application(payload->'details',payload->>'persona');\n    select * into a from bx1_portal.applications where user_id=v_actor for update;\n    if found then\n      if a.status not in ('DRAFT','CHANGES_REQUIRED','REJECTED') or a.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_application' using errcode='23514'; end if;\n      update bx1_portal.applications set persona=payload->>'persona',status='SUBMITTED',revision=revision+1,details=payload->'details',submitted_at=v_now,reviewed_at=null,reviewer_id=null,review_notes=null,review_checks='{}',approved_until=null where id=a.id returning * into a;\n    else\n      if (payload->>'expected_revision')::integer<>0 then raise exception 'portal_stale_application' using errcode='23514'; end if;\n      insert into bx1_portal.applications(user_id,persona,status,details,reviewer_scope,submitted_at)\n        values(v_actor,payload->>'persona','SUBMITTED',payload->'details','0ba2b126-bd85-4cfb-9a1d-83633c9def1e',v_now) returning * into a;\n    end if;\n    v_subject:=a.id; v_application:=a.id; v_summary:='Test onboarding application submitted for independent manual review.';\n  elsif command='review_application' then\n    perform bx1_portal.require_keys(payload,array['application_id','expected_revision','decision','notes','checks']);\n    perform bx1_portal.require_text(payload,'notes',20,3000);\n    if coalesce(payload->>'decision','') not in ('APPROVED','CHANGES_REQUIRED','REJECTED') or jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'portal_invalid_decision' using errcode='22023'; end if;\n    perform bx1_portal.require_checks(payload->'checks',array['identity','ownership','screening','suitability'],payload->>'decision'='APPROVED');\n    select * into a from bx1_portal.applications where id=(payload->>'application_id')::uuid for update;\n    perform bx1_portal.admission_lock_people(array[v_actor,a.user_id]);\n    if a.id is null or not (bx1_portal.is_reviewer(a.reviewer_scope) or bx1_portal.admission_application_reviewer(bx1_portal.admission_review_context(a.id),a.reviewer_scope,a.organisation_id)) or not bx1_portal.admission_action_independent(a.user_id) then raise exception 'portal_review_denied' using errcode='42501'; end if;\n    v_org:=bx1_portal.review_application_transition(a.id,(payload->>'expected_revision')::integer,\n      payload->>'decision',payload->>'notes',payload->'checks',v_now);\n    v_subject:=a.id; v_application:=a.id; v_summary:='Manual TEST_ONLY onboarding decision: '||(payload->>'decision')||'. Approval, when given, expires after 30 days and is not provider verification.';\n  elsif command in ('create_product','save_product','submit_product','review_product') then\n    return bx1_portal.offering_workflow_base_command(null,command,request_key,payload);\n  elsif command in ('publish_product','subscribe') then\n    if command='subscribe' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms_hash','units','accepted_documents','accepted_risks']);\n    else perform bx1_portal.require_keys(payload,array['product_id','expected_revision']); end if;\n    select * into p from bx1_portal.products where id=(payload->>'product_id')::uuid for update;\n    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;\n    select * into o from bx1_portal.organisations where id=p.organisation_id;\n    if command='subscribe' then\n      if not bx1_portal.is_eligible(p.terms) or not bx1_portal.organisation_active(o.id) or not bx1_portal.independent_of(o.owner_id) then raise exception 'portal_investor_denied' using errcode='42501'; end if;\n    elsif not bx1_portal.is_operator(o.id) and (command is distinct from 'publish_product' or bx1_private.fund_roleplay_manager_publish_lane(p.id,request_key) is not true) then raise exception 'portal_operator_denied' using errcode='42501'; end if;\n    if jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' or p.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_product' using errcode='23514'; end if;\n    v_subject:=p.id; v_org:=p.organisation_id;\n    if command='publish_product' then\n      if p.status<>'APPROVED' or p.reviewer_id is null then raise exception 'portal_approval_required' using errcode='23514'; end if;\n      update bx1_portal.products set status='PUBLISHED',revision=revision+1,published_at=v_now where id=p.id;\n      v_summary:='Approved test offering published to eligible investors.';\n    else\n      if p.status<>'PUBLISHED' or payload->>'terms_hash' is distinct from p.terms_hash or payload->'accepted_documents' is distinct from 'true'::jsonb or payload->'accepted_risks' is distinct from 'true'::jsonb then raise exception 'portal_terms_acceptance_required' using errcode='23514'; end if;\n      v_units:=bx1_portal.positive(payload->'units');\n      if v_units<p.minimum_units or p.reserved_units+v_units>p.cap_units then raise exception 'portal_capacity_unavailable' using errcode='23514'; end if;\n      insert into bx1_portal.subscriptions(product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor)\n        values(p.id,v_actor,p.organisation_id,p.revision,p.terms_hash,p.terms,true,true,v_units,v_units*p.unit_price_minor) returning * into s;\n      update bx1_portal.products set reserved_units=reserved_units+v_units where id=p.id;\n      v_subject:=s.id; v_investor:=v_actor; v_summary:='Test subscription reserved; awaiting funding. No cash received, holding, or token issued.';\n    end if;\n  elsif command='cancel_subscription' then\n    perform bx1_portal.require_keys(payload,array['subscription_id']);\n    -- Product lock precedes subscription lock, matching the capacity claim order.\n    select * into s from bx1_portal.subscriptions where id=(payload->>'subscription_id')::uuid and investor_id=v_actor;\n    if not found then raise exception 'portal_subscription_denied' using errcode='42501'; end if;\n    perform id from bx1_portal.products where id=s.product_id for update;\n    select * into s from bx1_portal.subscriptions where id=s.id for update;\n    if s.status<>'AWAITING_FUNDING' then raise exception 'portal_subscription_not_cancellable' using errcode='23514'; end if;\n    update bx1_portal.subscriptions set status='CANCELLED',cancelled_at=v_now where id=s.id;\n    update bx1_portal.products set reserved_units=reserved_units-s.units where id=s.product_id;\n    v_subject:=s.id; v_org:=s.organisation_id; v_investor:=v_actor; v_summary:='Unfunded test subscription cancelled; reserved capacity released.';\n  else raise exception 'portal_unknown_command' using errcode='22023'; end if;\n  if command='publish_product' and not bx1_portal.is_operator(o.id)\n    and bx1_private.fund_roleplay_manager_publish_lane(p.id,request_key) is not true then\n    raise exception 'fund_roleplay_manager_base_publish_authority_changed' using errcode='42501';end if;\n  insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,request_key,command,payload);\n  insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)\n    values(v_subject,v_application,v_org,v_investor,command,v_actor,v_summary);\n  if bx1_portal.admission_password_session() then return bx1_portal.admission_read_scoped(bx1_portal.admission_review_context((payload->>'application_id')::uuid)); end if;\n    if command='publish_product' and bx1_private.fund_roleplay_manager_publish_lane((payload->>'product_id')::uuid,request_key) then\n      return bx1_private.fund_roleplay_manager_read((select lane.operating_context from bx1_private.fund_roleplay_command_lanes lane\n        where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n          and lane.product_id=(payload->>'product_id')::uuid and lane.action='publish_product' and lane.request_key=execute_command_pre_entry.request_key));\n    end if;\n    return bx1_portal.read_state();\nend"
},
  {
    "signature": "bx1_private.test_roleplay_role_actions(text)",
    "sha": "90bb379a92406b16422f7a6c235548a79166a561014eecd0f97be9aaeee8c08e",
    "secdef": false,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select case p_role\n    when 'Investor' then array['open_funding_obligation','cancel_subscription','request_product_eligibility','subscribe','bind_fund_delivery_wallet','request_fund_payment_allocation_basis','prepare_fund_payment','submit_fund_payment','record_fund_payment','submit_funding_reference','verify_funding_reference']\n    when 'OfferingManager' then array['publish_product','admit_fund_release','FUND_SETUP','create_product','save_product','submit_product','request_product_service_appointment','REQUEST_PURPOSE']\n    when 'IssuerFundManager' then array['review_offering_issuer','approve_fund_payment_allocation_basis','request_fund_allocation','PREPARE_EXECUTION','REQUEST_SIGNING_VIEW']\n    when 'ComplianceOfficer' then array['review_product_service_appointment','review_product','review_product_eligibility','revoke_product_eligibility','REVIEW_PURPOSE','REVOKE_PURPOSE']\n    when 'TransferAgent' then array['approve_fund_allocation']\n    when 'TokenisationAgent' then array['bind_roleplay_signer','admit_fund_release','FUND_SETUP','request_fund_deployment','approve_fund_deployment','prepare_fund_transaction','record_fund_signature','claim_fund_execution','record_fund_transaction','request_fund_issuance','approve_fund_issuance','cancel_fund_operation']\n    when 'TreasuryOperator' then array['verify_funding_route','revoke_funding_route','verify_funding_reference','propose_funding_route','open_funding_obligation','propose_funding_acceptance','propose_funding_exception','propose_funding_reversal']\n    when 'FinancialController' then array['verify_funding_route','verify_funding_reference','approve_funding_route','reconcile_funding','resolve_funding_exception','approve_funding_reversal']\n    when 'SuperAdmin' then array['apply_product_service_appointment','read_test_roleplay','revoke_test_roleplay']\n    else array[]::text[] end;\n"
  },
  {
    "signature": "bx1_portal.offering_workflow_context(jsonb)",
    "sha": "2e3592ba5615c2e5188eca949d7a94f28ead364ab6347d98fe04d7a9ae2255bd",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.fund_roleplay_manager_scope(c) or case when bx1_portal.test_workspace_environment() and c->>'mode'='ROLE'\n      and c->>'role' in ('IssuerFundManager','ComplianceOfficer','SuperAdmin')\n    then bx1_portal.test_offering_context(c)\n    when bx1_portal.test_workspace_entitlement(c) is not null\n    then c->>'role'='OfferingManager' and bx1_portal.offering_workflow_person_current(auth.uid())\n    else bx1_portal.offering_workflow_context_pre_test_workspace(c) end;\n"
  },
  {
    "signature": "bx1_portal.offering_workflow_operator(jsonb,uuid)",
    "sha": "e99eba175755695d07c718ee32f58747aa8e1985ff90e1048315d80940062545",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.fund_roleplay_manager_command_operator(c,target_org) or case when bx1_portal.test_workspace_entitlement(c) is not null\n    then c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n      and bx1_portal.offering_workflow_manager_current(auth.uid(),target_org,(c->>'organisationId')::uuid)\n    else bx1_portal.offering_workflow_operator_pre_test_workspace(c,target_org) end;\n"
  },
  {
    "signature": "bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)",
    "sha": "4a56fb1027de19fdde592377bfe333f604457cb758b7c1061ced66a465870168",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare target uuid; p bx1_portal.products; o bx1_portal.organisations;\n  e bx1_private.test_workspace_entitlements; a bx1_portal.product_service_appointments; result jsonb;\nbegin\n  target:=bx1_portal.test_offering_target(action,body);\n  if target is null or key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536\n    or (bx1_portal.test_offering_context(c) or bx1_private.fund_roleplay_manager_current(c,target,action)) is not true\n    or bx1_portal.offering_workflow_command_allowed(c,action) is not true then\n    raise exception 'test_offering_command_denied' using errcode='42501'; end if;\n  perform bx1_private.fund_roleplay_enter(c,target,action,key);\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  perform bx1_portal.test_offering_lock_product_context(c,target);\n  select * into p from bx1_portal.products where id=target;\n  select * into o from bx1_portal.organisations where id=p.organisation_id;\n  select * into e from bx1_private.test_workspace_entitlements where id=bx1_portal.test_offering_source_entitlement(o.id);\n  if action='request_product_service_appointment' then\n    if c->>'role'<>'OfferingManager' or bx1_portal.offering_workflow_operator(c,o.id) is not true then\n      raise exception 'test_offering_nomination_denied' using errcode='42501'; end if;\n  elsif action in ('review_product_service_appointment','apply_product_service_appointment') then\n    select * into a from bx1_portal.product_service_appointments where id=(body->>'appointment_id')::uuid for share;\n    if a.product_id is distinct from p.id or bx1_portal.test_offering_appointment_current(a.id) is not true\n      or bx1_portal.offering_workflow_staff(c,o.reviewer_scope,\n        case action when 'review_product_service_appointment' then 'ComplianceOfficer' else 'SuperAdmin' end) is not true then\n      raise exception 'test_offering_appointment_command_denied' using errcode='42501'; end if;\n  elsif action in ('review_offering_issuer','review_product') then\n    if p.current_offering_revision_id is null or bx1_portal.test_offering_revision_current(p.current_offering_revision_id) is not true\n      or bx1_portal.test_offering_appointed(c,p.id,case action when 'review_product' then 'ComplianceOfficer' else 'IssuerFundManager' end) is not true then\n      raise exception 'test_offering_review_appointment_required' using errcode='42501'; end if;\n  else raise exception 'test_offering_command_denied' using errcode='42501'; end if;\n  insert into bx1_private.test_workspace_product_commands(transaction_id,actor_id,session_id,entitlement_id,\n    entitlement_revision,operating_context,product_organisation_id,command,request_key,target_product_id)\n    values(pg_catalog.pg_current_xact_id(),auth.uid(),(auth.jwt()->>'session_id')::uuid,e.id,e.revision,c,o.id,action,key,p.id);\n  -- Existing guarded business writers remain the only writers.\n  result:=bx1_portal.offering_workflow_command(c,action,key,body);\n  if bx1_portal.test_offering_source_current(o.id,e.id,e.revision) is not true\n    or (bx1_portal.test_offering_context(c) or bx1_private.fund_roleplay_manager_current(c,target,action)) is not true\n    or bx1_portal.offering_workflow_command_allowed(c,action) is not true then\n    raise exception 'test_offering_authority_changed_after_wait' using errcode='42501'; end if;\n  delete from bx1_private.test_workspace_product_commands where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();\n  perform bx1_private.fund_roleplay_finish(c,target,action,key);\n  return result;\nend "
  },
  {
    "signature": "bx1_portal.test_offering_lock_product_context(jsonb,uuid)",
    "sha": "f43fa4c1826ea48715c287feb9b91c58c03a0743523f713895e099108be27f14",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare p bx1_portal.products; o bx1_portal.organisations;\nbegin\n  select * into p from bx1_portal.products where id=target_product for update;\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;\n  if p.id is null or (bx1_portal.test_offering_context(c) or bx1_private.fund_roleplay_manager_current(c,p.id)) is not true then\n    raise exception 'test_offering_context_denied' using errcode='42501'; end if;\n  perform bx1_portal.test_offering_lock_source(o.id);\n  if c->>'role'='OfferingManager' then\n    if (bx1_portal.offering_workflow_operator(c,o.id) or bx1_private.fund_roleplay_manager_current(c,p.id)) is not true then\n      raise exception 'test_offering_manager_denied' using errcode='42501'; end if;\n  elsif c->>'role'='IssuerFundManager' then\n    if c->>'organisationId' is distinct from o.reviewer_scope::text\n      or bx1_portal.test_offering_appointed(c,p.id,'IssuerFundManager') is not true then\n      raise exception 'test_offering_issuer_scope_denied' using errcode='42501'; end if;\n  elsif c->>'organisationId' is distinct from o.reviewer_scope::text\n    or bx1_portal.offering_workflow_staff(c,o.reviewer_scope,c->>'role') is not true then\n    raise exception 'test_offering_staff_scope_denied' using errcode='42501'; end if;\n  if p.current_offering_revision_id is not null then\n    if bx1_portal.test_offering_revision_current(p.current_offering_revision_id) is not true then\n      raise exception 'test_offering_revision_source_not_current' using errcode='42501'; end if;\n  end if;\nend "
  },
  {
    "signature": "bx1_portal.test_offering_appointment_visible(jsonb,uuid)",
    "sha": "b7b5cb312f7cb3f35e2703edcbecae63d781372f3e72c67e3b2962e4dbddd5cc",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare a bx1_portal.product_service_appointments; v jsonb;\nbegin\n  select * into a from bx1_portal.product_service_appointments where id=target_id;\n  if a.id is null or (bx1_portal.test_offering_context(c) or bx1_private.fund_roleplay_manager_current(c,a.product_id)) is not true\n    or bx1_portal.test_offering_appointment_current(a.id) is not true then return false; end if;\n  v:=bx1_portal.offering_workflow_appointment_projection(c,a.id);\n  if v is null then return false; end if;\n  if c->>'role'='OfferingManager' then\n    return a.requested_by_user_id=auth.uid() and a.requested_in_context=c\n      and (bx1_portal.offering_workflow_operator(c,a.product_organisation_id) or bx1_private.fund_roleplay_manager_current(c,a.product_id));\n  elsif c->>'role'='IssuerFundManager' then\n    return a.appointee_user_id=auth.uid() and a.role='IssuerFundManager'\n      and bx1_portal.test_offering_appointed(c,a.product_id,'IssuerFundManager');\n  elsif c->>'role'='ComplianceOfficer' then\n    return coalesce((v->>'can_review')::boolean,false)\n      or bx1_portal.test_offering_appointed(c,a.product_id,'ComplianceOfficer')\n      or (a.reviewed_by_user_id=auth.uid() and a.approval_receipt_id is not null and a.reviewed_at is not null\n        and bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer')\n        and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)\n        and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id)\n        and (a.status='APPROVED' or (a.status='APPLIED' and bx1_portal.test_offering_appointment_effective(a.id))));\n  elsif c->>'role'='SuperAdmin' then\n    return coalesce((v->>'can_apply')::boolean,false)\n      or (a.status='APPLIED' and a.applied_by_user_id=auth.uid() and a.applied_at is not null\n        and a.approval_receipt_id is not null and bx1_portal.test_offering_appointment_effective(a.id));\n  end if;\n  return false;\nend "
  },
  {
    "signature": "bx1_portal.offering_workflow_appointment_projection(jsonb,uuid)",
    "sha": "a1dae90c2f1b37a8f7752c9bc07e663a64fc495041adc2309078200a79e18554",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare a bx1_portal.product_service_appointments;\n  is_manager boolean; is_reviewer boolean; is_admin boolean; is_appointee boolean;\nbegin\n  if (bx1_portal.valid_operating_context(c) or bx1_portal.offering_workflow_context(c)) is not true then return null; end if;\n  select * into a from bx1_portal.product_service_appointments where id=target_id;\n  if a.id is null then return null; end if;\n  is_manager:=a.requested_by_user_id=auth.uid() and c=a.requested_in_context\n    and (bx1_portal.offering_workflow_operator(c,a.product_organisation_id) or bx1_private.fund_roleplay_manager_current(c,a.product_id));\n  is_reviewer:=c->>'role'='ComplianceOfficer' and\n    bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer');\n  is_admin:=c->>'role'='SuperAdmin' and\n    bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'SuperAdmin');\n  is_appointee:=a.appointee_user_id=auth.uid() and c->>'mode'='ROLE' and c->>'role'=a.role\n    and c->>'organisationId'=(select m.organisation_id::text from public.bx1_memberships m\n      where m.id=a.native_membership_id);\n  if not(is_manager or is_reviewer or is_admin or is_appointee) then return null; end if;\n  return pg_catalog.jsonb_build_object(\n    'id',a.id,'product_id',a.product_id,'product_organisation_id',a.product_organisation_id,\n    'reviewer_scope_organisation_id',a.reviewer_scope_organisation_id,\n    'role',a.role,'appointee_user_id',a.appointee_user_id,\n    'native_membership_id',a.native_membership_id,\n    'requested_by_user_id',a.requested_by_user_id,\n    'product_revision_at_request',a.product_revision_at_request,\n    'terms_hash_at_request',a.terms_hash_at_request,'evidence_reference',a.evidence_reference,\n    'requested_until',a.requested_until,'status',a.status,'revision',a.revision,\n    'requested_at',a.requested_at,'reviewed_at',a.reviewed_at,\n    'reviewed_by_user_id',a.reviewed_by_user_id,'review_notes',a.review_notes,\n    'approval_receipt_id',a.approval_receipt_id,'applied_at',a.applied_at,\n    'applied_by_user_id',a.applied_by_user_id,'revoked_at',a.revoked_at,\n    'revoke_reason',a.revoke_reason,'effective',bx1_portal.offering_workflow_product_appointment_effective(a.id),\n    'next_owner',case when a.status in ('SUBMITTED','APPROVED')\n        and a.requested_until<=pg_catalog.clock_timestamp() then 'OFFERING_MANAGER'\n      when a.status='SUBMITTED' then 'COMPLIANCE'\n      when a.status='APPROVED' then 'SUPER_ADMIN'\n      when a.status='APPLIED' and bx1_portal.offering_workflow_product_appointment_effective(a.id) is not true\n        then 'SUPER_ADMIN'\n      when a.status in ('CHANGES_REQUIRED','REJECTED') then 'OFFERING_MANAGER'\n      else 'NONE' end,\n    'can_review',is_reviewer and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='SUBMITTED'\n      and a.requested_until>pg_catalog.clock_timestamp()\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end)),\n    'can_apply',is_admin and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='APPROVED'\n      and a.requested_until>pg_catalog.clock_timestamp()\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.reviewed_by_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end)),\n    'can_revoke',not bx1_portal.admission_password_session() and is_admin and a.status='APPLIED'\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end)));\nend "
  },
  {
    "signature": "bx1_private.offering_document_manager(jsonb,uuid)",
    "sha": "c6f3dc60bd92f96b7893314c533efcad6c1e050f5977b9b64cab8b407c67e55a",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.offering_document_context(c) and c->>'role'='OfferingManager'\n    and exists(select 1 from bx1_portal.offering_revisions r join bx1_portal.products p on p.id=r.product_id\n      where r.id=target_revision and r.origin='SUBMITTED' and p.current_offering_revision_id=r.id\n        and p.status in ('IN_REVIEW','CHANGES_REQUIRED') and r.terms=p.terms and r.terms_hash=p.terms_hash\n        and (bx1_portal.offering_workflow_operator(c,p.organisation_id) or bx1_private.fund_roleplay_manager_current(c,p.id)));\n"
  },
  {
    "signature": "bx1_private.offering_document_visible(jsonb,uuid)",
    "sha": "405ce9bd3c9fc8378ec9eb77ef32e3bbfb84596a03021ce81bb11d7645f79152",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.offering_document_context(c) and exists(select 1\n    from bx1_portal.offering_revisions r join bx1_portal.products p on p.id=r.product_id\n    where r.id=target_revision and r.origin='SUBMITTED' and (\n      (c->>'role'='OfferingManager' and (bx1_portal.offering_workflow_operator(c,p.organisation_id) or bx1_private.fund_roleplay_manager_current(c,p.id)))\n      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'IssuerFundManager')\n      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')));\n"
  },
  {
    "signature": "bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)",
    "sha": "87f44d8772eb07e36ff057949def4598ad7704de901292c8842d1a3edc4969a1",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "declare p bx1_portal.products; r bx1_portal.offering_revisions;\n  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;\n  can_issuer boolean; can_compliance boolean; is_ready boolean;\nbegin\n  select * into p from bx1_portal.products where id=target_product;\n  if p.id is null or p.current_offering_revision_id is null then return null; end if;\n  select * into r from bx1_portal.offering_revisions where id=p.current_offering_revision_id and product_id=p.id;\n  if r.id is null or r.origin<>'SUBMITTED' then return null; end if;\n  select * into issuer from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='ISSUER';\n  select * into compliance from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='COMPLIANCE';\n  can_issuer:=p.status in ('IN_REVIEW','APPROVED') and bx1_portal.offering_workflow_issuer_authorised(c,p.id)\n    and (compliance.id is null or bx1_portal.offering_workflow_people_independent(auth.uid(),compliance.actor_id));\n  can_compliance:=p.status='IN_REVIEW' and compliance.id is null\n    and bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')\n    and bx1_portal.offering_workflow_people_independent(auth.uid(),r.submitted_by)\n    and (issuer.id is null or bx1_portal.offering_workflow_people_independent(auth.uid(),issuer.actor_id));\n  is_ready:=bx1_portal.offering_technical_ready(r.id) is true;\n  return pg_catalog.jsonb_build_object(\n    'id',r.id,'package_number',r.package_number,'origin',r.origin,\n    'product_revision_at_submission',r.product_revision_at_submission,\n    'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,\n    'common_envelope_hash',r.common_envelope_hash,'deployment_configuration_hash',r.deployment_configuration_hash,\n    'common_envelope',case when r.terms->'terms_version'='3'::jsonb then r.terms->'common_envelope' else null::jsonb end,\n    'deployment_configuration',case when r.terms->'terms_version'='3'::jsonb then r.terms->'deployment_configuration' else null::jsonb end,'submitted_at',r.submitted_at,\n    'issuer_status',coalesce(issuer.decision,'PENDING'),\n    'compliance_status',coalesce(compliance.decision,'PENDING'),\n    'issuer_review_notes',case when (bx1_portal.offering_workflow_operator(c,p.organisation_id) or bx1_private.fund_roleplay_manager_current(c,p.id))\n      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')\n      then issuer.notes end,\n    'issuer_review_checks',case when (bx1_portal.offering_workflow_operator(c,p.organisation_id) or bx1_private.fund_roleplay_manager_current(c,p.id))\n      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')\n      then issuer.checks else null end,\n    'technical_readiness_status','NOT_VERIFIED',\n    'status',case when issuer.decision='CHANGES_REQUIRED' or compliance.decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'\n      when issuer.decision='APPROVED' and compliance.decision='APPROVED'\n        and bx1_portal.offering_workflow_approved(p.id) then 'APPROVED_AWAITING_READINESS'\n      when issuer.decision='APPROVED' and compliance.decision='APPROVED' then 'AUTHORITY_EXPIRED'\n      else 'IN_REVIEW' end,\n    'can_review_issuer',can_issuer,'can_review_compliance',can_compliance,\n    'publishable',p.status='APPROVED' and is_ready,\n    'subscribable',p.status='PUBLISHED' and is_ready) || case when exists(\n      select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n      then pg_catalog.jsonb_build_object('document_evidence',bx1_private.offering_document_evidence_summary(r.id))\n      else '{}'::jsonb end;\nend"
  },
  {
    "signature": "bx1_portal.offering_workflow_package_projection(jsonb,uuid)",
    "sha": "416a3fe61c73d1b5b3f0cf41cf16ef895385763f47dc4732a5dd5dadfeffc8f3",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare result jsonb; p bx1_portal.products; r bx1_portal.offering_revisions;\n  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;\n  appointed boolean; can_review boolean;\nbegin\n  result:=bx1_portal.offering_workflow_package_projection_base(c,target_product);\n  if result is null then return null; end if;\n  select * into p from bx1_portal.products where id=target_product;\n  select * into r from bx1_portal.offering_revisions\n    where id=p.current_offering_revision_id and product_id=p.id;\n  select * into issuer from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='ISSUER';\n  select * into compliance from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='COMPLIANCE';\n  appointed:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer');\n  can_review:=appointed and p.status='IN_REVIEW' and compliance.id is null\n    and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms\n    and (bx1_portal.offering_workflow_lineage_independent(auth.uid(),p.id,r.terms_hash) or bx1_private.fund_roleplay_review_exception(c,p.id,case c->>'role' when 'IssuerFundManager' then 'review_offering_issuer' else 'review_product' end))\n    and (bx1_portal.offering_workflow_people_independent(auth.uid(),p.created_by) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product'))\n    and (bx1_portal.offering_workflow_people_independent(auth.uid(),\n      (select o.owner_id from bx1_portal.organisations o where o.id=p.organisation_id)) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product'))\n    and (issuer.id is null or (bx1_portal.offering_workflow_people_independent(auth.uid(),issuer.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product')));\n  result:=pg_catalog.jsonb_set(result,'{can_review_compliance}',pg_catalog.to_jsonb(can_review));\n  if coalesce((result->>'can_review_issuer')::boolean,false)\n    and (bx1_portal.offering_workflow_lineage_independent(auth.uid(),p.id,r.terms_hash) or bx1_private.fund_roleplay_review_exception(c,p.id,case c->>'role' when 'IssuerFundManager' then 'review_offering_issuer' else 'review_product' end)) is not true then\n    result:=pg_catalog.jsonb_set(result,'{can_review_issuer}','false'::jsonb);\n  end if;\n  if appointed then\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}',\n      coalesce(pg_catalog.to_jsonb(issuer.notes),'null'::jsonb));\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}',\n      coalesce(pg_catalog.to_jsonb(issuer.checks),'null'::jsonb));\n  elsif (bx1_portal.offering_workflow_operator(c,p.organisation_id) or bx1_private.fund_roleplay_manager_current(c,p.id)) is not true then\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}','null'::jsonb);\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}','null'::jsonb);\n  end if;\n  return result;\nend "
  },
  {
    "signature": "bx1_portal.read_scoped(jsonb)",
    "sha": "d1295f00833a24fba3c9ccb0295929ec5e3a77a4ee1c808daa27c3cf8f4fc3d4",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare roleplay_result jsonb;\nbegin\n  if bx1_private.fund_roleplay_manager_scope(c) then return bx1_private.fund_roleplay_manager_read(c); end if;\n  if c->>'mode'='ROLE' and c->>'role' in ('TreasuryOperator','FinancialController')\n    and exists(select 1 from bx1_portal.products product where bx1_private.fund_roleplay_finance_visible(c,product.id)) then\n    roleplay_result:=bx1_portal.read_scoped_pre_entity_eligibility(c);\n    if bx1_private.fund_roleplay_finance_read_current(c,roleplay_result) is not true then\n      raise exception 'fund_roleplay_finance_read_scope_expired' using errcode='42501';end if;\n    return roleplay_result;\n  end if;\n  if c->>'mode'='ROLE' and c->>'role' in ('TreasuryOperator','FinancialController')\n    and bx1_portal.fund_context(c,true) and bx1_portal.test_workspace_entitlement(c) is null\n    and exists(select 1 from bx1_portal.organisations org where bx1_portal.scoped_finance(c,org.id,c->>'role')) then\n    return bx1_portal.read_scoped_pre_entity_eligibility(c); end if;\n  if bx1_portal.test_offering_context(c) and c->>'role' in ('IssuerFundManager','ComplianceOfficer','SuperAdmin')\n    and exists(select 1 from bx1_portal.products target_product\n      where bx1_portal.test_offering_is_source(target_product.organisation_id)\n        and bx1_portal.test_offering_product_visible(c,target_product.id)) then\n    return bx1_portal.offering_workflow_read_scoped(c); end if;\n  if bx1_portal.test_workspace_entitlement(c) is not null then return bx1_portal.test_workspace_read(c); end if;\n  return bx1_portal.read_scoped_pre_test_workspace(c);\nend "
  },
  {
    "signature": "bx1_portal.offering_workflow_read_scoped(jsonb)",
    "sha": "9d45d7c415daa66182191e0340c3f98f02948f393cd3deacd8b14fbea369706f",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\nbegin\n  if bx1_private.fund_roleplay_manager_scope(c) then return bx1_private.fund_roleplay_manager_read(c); end if;\n  if bx1_portal.test_workspace_entitlement(c) is not null then return bx1_portal.test_workspace_read(c); end if;\n  return bx1_portal.offering_workflow_read_scoped_pre_test_workspace(c);\nend "
  },
  {
    "signature": "bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)",
    "sha": "47393ea3761c03dd8ef4ecfefa609c83330738e363e1e49ba29dead40751c85a",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\nbegin\n  if action='publish_product' and pg_catalog.jsonb_typeof(body)='object'\n    and body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n    and bx1_private.fund_roleplay_manager_current(c,(body->>'product_id')::uuid,'publish_product') then\n    return bx1_private.fund_roleplay_manager_publish(c,key,body); end if;\n  if action in ('propose_funding_route','approve_funding_route','revoke_funding_route','open_funding_obligation',\n    'submit_funding_reference','propose_funding_acceptance','reconcile_funding','propose_funding_exception',\n    'resolve_funding_exception','propose_funding_reversal','approve_funding_reversal','cancel_subscription')\n    and bx1_portal.funding_session() and bx1_portal.valid_operating_context(c)\n    and bx1_portal.test_workspace_entitlement(c) is null then\n    return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body); end if;\n  if bx1_portal.test_offering_target(action,body) is not null then\n    return bx1_portal.test_offering_command(c,action,key,body); end if;\n  if c->>'mode'='ROLE' and exists(select 1 from bx1_private.test_workspace_sources s\n    where s.native_organisation_id::text=c->>'organisationId') then\n    if bx1_portal.test_workspace_entitlement(c) is null or c->>'role' is distinct from 'OfferingManager'\n      or action is null or action not in ('create_product','save_product','submit_product') then\n      raise exception 'test_workspace_command_denied' using errcode='42501'; end if;\n    return bx1_portal.test_workspace_product_command(c,action,key,body);\n  end if;\n  return bx1_portal.execute_scoped_pre_test_workspace(c,action,key,body);\nend "
  }
]
$manager_specs$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'fund_roleplay_manager_signature_missing: %',spec->>'signature';end if;
    select pg_catalog.to_jsonb(p)-'prosrc',p.prosrc into before_row,source_body from pg_catalog.pg_proc p where p.oid=target;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(source_body,E'\r\n',E'\n'),'UTF8')),'hex') is distinct from spec->>'sha'
      or (before_row->>'proowner')::oid is distinct from (spec->>'owner')::regrole::oid
      or (before_row->>'prosecdef')::boolean is distinct from (spec->>'secdef')::boolean
      or (select proacl::text from pg_catalog.pg_proc where oid=target) is distinct from spec->>'acl'
      or pg_catalog.to_jsonb((select proconfig from pg_catalog.pg_proc where oid=target)) is distinct from spec->'config' then
      raise exception 'fund_roleplay_manager_exact_pin_mismatch: %',spec->>'signature' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);next_body:=spec->>'next_body';
    if source_body is null or source_body='' or (length(definition)-length(replace(definition,source_body,'')))/length(source_body)<>1 then
      raise exception 'fund_roleplay_manager_body_not_unique: %',spec->>'signature';end if;
    execute replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p)-'prosrc' into after_row from pg_catalog.pg_proc p where p.oid=target;
    if before_row is distinct from after_row or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
      raise exception 'fund_roleplay_manager_metadata_changed: %',spec->>'signature';end if;
  end loop;
end $manager_cutover$;

do $manager_close$
declare signature text;
begin
  for signature in select p.oid::regprocedure::text from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and p.proname in (
      'fund_roleplay_manager_current','fund_roleplay_manager_scope','fund_roleplay_manager_command_operator',
      'fund_roleplay_manager_actions','fund_roleplay_manager_read','fund_roleplay_manager_publish',
      'fund_roleplay_manager_publish_lane','fund_roleplay_manager_offering_approved') loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_fund_execution_worker',signature);
    execute pg_catalog.format('grant execute on function %s to postgres',signature);
  end loop;
end $manager_close$;
