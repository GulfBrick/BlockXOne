-- Stage 3: versioned fund offering terms. This is a package/schema increment,
-- not technical admission or a settlement-asset integration. Existing v1
-- ZAR_TEST terms, hashes, accepted orders and immutable revisions are untouched.

create function bx1_portal.validate_terms_v1(terms jsonb) returns void
language plpgsql set search_path='' as $$
declare v jsonb; c numeric; m numeric;
begin
  perform bx1_portal.require_keys(terms,array['asset_type','name','issuer_name','summary','strategy','share_class','currency','unit_price_minor','cap_units','minimum_units','pricing_basis','fees','redemption_terms','eligible_countries','eligible_investor_types','property_address','property_valuation_minor','rental_income_policy','documents']);
  if coalesce(terms->>'asset_type','') not in ('FUND','REAL_ESTATE') or terms->>'currency' is distinct from 'ZAR_TEST' then raise exception 'portal_invalid_asset' using errcode='22023'; end if;
  perform bx1_portal.require_text(terms,'name',3,120); perform bx1_portal.require_text(terms,'issuer_name',3,160);
  perform bx1_portal.require_text(terms,'summary',30,600); perform bx1_portal.require_text(terms,'strategy',30,4000);
  perform bx1_portal.require_text(terms,'share_class',1,80); perform bx1_portal.require_text(terms,'pricing_basis',10,1200);
  perform bx1_portal.require_text(terms,'fees',10,1200); perform bx1_portal.require_text(terms,'redemption_terms',20,2400);
  perform bx1_portal.require_text(terms,'property_address',0,300); perform bx1_portal.require_text(terms,'rental_income_policy',0,2000);
  perform bx1_portal.positive(terms->'unit_price_minor'); c:=bx1_portal.positive(terms->'cap_units'); m:=bx1_portal.positive(terms->'minimum_units');
  if m>c then raise exception 'portal_minimum_exceeds_capacity' using errcode='23514'; end if;
  if pg_catalog.jsonb_typeof(terms->'property_valuation_minor') is distinct from 'string' or terms->>'property_valuation_minor' !~ '^(0|[1-9][0-9]{0,19})$' then raise exception 'portal_invalid_valuation' using errcode='22023'; end if;
  if terms->>'asset_type'='REAL_ESTATE' and (pg_catalog.length(terms->>'property_address')<10 or (terms->>'property_valuation_minor')::numeric<=0 or pg_catalog.length(terms->>'rental_income_policy')<20) then raise exception 'portal_property_terms_required' using errcode='23514'; end if;
  if pg_catalog.jsonb_typeof(terms->'eligible_countries') is distinct from 'array' or pg_catalog.jsonb_typeof(terms->'eligible_investor_types') is distinct from 'array' then raise exception 'portal_invalid_eligibility' using errcode='22023'; end if;
  if pg_catalog.jsonb_array_length(terms->'eligible_countries') not between 1 and 30 or pg_catalog.jsonb_array_length(terms->'eligible_investor_types') not between 1 and 2 then raise exception 'portal_invalid_eligibility' using errcode='22023'; end if;
  for v in select * from pg_catalog.jsonb_array_elements(terms->'eligible_countries') loop
    if pg_catalog.jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[A-Z]{2}$' then raise exception 'portal_invalid_country' using errcode='22023'; end if;
  end loop;
  for v in select * from pg_catalog.jsonb_array_elements(terms->'eligible_investor_types') loop
    if pg_catalog.jsonb_typeof(v) is distinct from 'string' or v#>>'{}' not in ('INDIVIDUAL','ENTITY') then raise exception 'portal_invalid_investor_type' using errcode='22023'; end if;
  end loop;
  perform bx1_portal.require_keys(terms->'documents',array['memorandum','risks','subscription_terms']);
  perform bx1_portal.require_text(terms->'documents','memorandum',50,12000);
  perform bx1_portal.require_text(terms->'documents','risks',50,12000);
  perform bx1_portal.require_text(terms->'documents','subscription_terms',50,12000);
end $$;

create function bx1_portal.fund_v2_bounded_integer(value jsonb, minimum integer, maximum integer) returns void
language plpgsql immutable set search_path='' as $$
begin
  if pg_catalog.jsonb_typeof(value) is distinct from 'number'
    or value#>>'{}' !~ '^(0|[1-9][0-9]{0,4})$' then
    raise exception 'fund_v2_invalid_integer' using errcode='22023';
  end if;
  if (value#>>'{}')::integer not between minimum and maximum then
    raise exception 'fund_v2_invalid_integer' using errcode='22023';
  end if;
end $$;

create or replace function bx1_portal.validate_terms(terms jsonb) returns void
language plpgsql set search_path='' as $$
declare fund jsonb; nav jsonb; dealing jsonb; fees jsonb;
  liquidity jsonb; distributions jsonb; redemption jsonb;
begin
  if not (terms ? 'terms_version') then
    perform bx1_portal.validate_terms_v1(terms);
    return;
  end if;
  perform bx1_portal.require_keys(terms,array['asset_type','name','issuer_name','summary','strategy','share_class','currency','unit_price_minor','cap_units','minimum_units','pricing_basis','fees','redemption_terms','eligible_countries','eligible_investor_types','property_address','property_valuation_minor','rental_income_policy','documents','terms_version','settlement_decimals','fund']);
  if terms->'terms_version' is distinct from '2'::jsonb
    or terms->>'asset_type' is distinct from 'FUND'
    or terms->>'currency' is distinct from 'TST'
    or terms->'settlement_decimals' is distinct from '6'::jsonb
    or terms->>'property_address' is distinct from ''
    or terms->>'property_valuation_minor' is distinct from '0'
    or terms->>'rental_income_policy' is distinct from '' then
    raise exception 'fund_v2_asset_or_denomination_invalid' using errcode='22023';
  end if;
  -- These v1 compatibility fields are cross-references only in v2. The typed
  -- fund policies below are the sole operative economics and mandate. This
  -- prevents direct RPC callers from submitting conflicting fee/price/exit
  -- narratives while retaining the legacy JSON shape and historical records.
  if terms->>'strategy' is distinct from 'The fund.mandate policy is the authoritative investment mandate for this package.'
    or terms->>'pricing_basis' is distinct from 'The fund.nav and fund.dealing policies are the authoritative pricing terms for this package.'
    or terms->>'fees' is distinct from 'The fund.fees policy is the authoritative fee schedule for this package.'
    or terms->>'redemption_terms' is distinct from 'The fund.redemption, fund.dealing and fund.liquidity policies govern exits for this package.' then
    raise exception 'fund_v2_noncanonical_economics' using errcode='22023';
  end if;
  if terms::text ~* 'ZAR_TEST' then
    raise exception 'fund_v2_legacy_denomination_reference' using errcode='22023';
  end if;
  -- Reuse all original common/disclosure checks without changing legacy v1.
  perform bx1_portal.validate_terms_v1(pg_catalog.jsonb_set(
    terms-'terms_version'-'settlement_decimals'-'fund','{currency}','"ZAR_TEST"'::jsonb));
  fund:=terms->'fund';
  perform bx1_portal.require_keys(fund,array['mandate','class_rights','nav','dealing','fees','liquidity','distributions','redemption']);
  perform bx1_portal.require_text(fund,'mandate',30,4000);
  perform bx1_portal.require_text(fund,'class_rights',20,2400);
  nav:=fund->'nav';
  perform bx1_portal.require_keys(nav,array['valuation_method','frequency','pricing_cutoff','correction_policy']);
  perform bx1_portal.require_text(nav,'valuation_method',20,2000);
  perform bx1_portal.require_text(nav,'pricing_cutoff',10,300);
  perform bx1_portal.require_text(nav,'correction_policy',20,2000);
  if (nav->>'frequency' in ('DAILY','WEEKLY','MONTHLY')) is not true then
    raise exception 'fund_v2_nav_frequency_invalid' using errcode='22023'; end if;
  dealing:=fund->'dealing';
  perform bx1_portal.require_keys(dealing,array['subscription_frequency','redemption_frequency','notice_days','settlement_days']);
  if (dealing->>'subscription_frequency' in ('DAILY','WEEKLY','MONTHLY')) is not true
    or (dealing->>'redemption_frequency' in ('DAILY','WEEKLY','MONTHLY','QUARTERLY')) is not true then
    raise exception 'fund_v2_dealing_frequency_invalid' using errcode='22023'; end if;
  perform bx1_portal.fund_v2_bounded_integer(dealing->'notice_days',0,365);
  perform bx1_portal.fund_v2_bounded_integer(dealing->'settlement_days',0,30);
  fees:=fund->'fees';
  perform bx1_portal.require_keys(fees,array['management_bps','performance_bps','other_fees']);
  perform bx1_portal.fund_v2_bounded_integer(fees->'management_bps',0,10000);
  perform bx1_portal.fund_v2_bounded_integer(fees->'performance_bps',0,10000);
  perform bx1_portal.require_text(fees,'other_fees',10,2000);
  liquidity:=fund->'liquidity';
  perform bx1_portal.require_keys(liquidity,array['lockup_days','gate_bps','suspension_policy']);
  perform bx1_portal.fund_v2_bounded_integer(liquidity->'lockup_days',0,3650);
  perform bx1_portal.fund_v2_bounded_integer(liquidity->'gate_bps',0,10000);
  perform bx1_portal.require_text(liquidity,'suspension_policy',20,2000);
  distributions:=fund->'distributions';
  perform bx1_portal.require_keys(distributions,array['frequency','policy']);
  if (distributions->>'frequency' in ('NONE','MONTHLY','QUARTERLY','ANNUALLY')) is not true then
    raise exception 'fund_v2_distribution_frequency_invalid' using errcode='22023'; end if;
  perform bx1_portal.require_text(distributions,'policy',20,2000);
  redemption:=fund->'redemption';
  perform bx1_portal.require_keys(redemption,array['price_basis','conditions']);
  if redemption->>'price_basis' is distinct from 'NAV' then
    raise exception 'fund_v2_redemption_price_basis_invalid' using errcode='22023'; end if;
  perform bx1_portal.require_text(redemption,'conditions',20,2400);
end $$;

-- Enforce the package version at the record transition itself as well as the
-- command boundary. The hosted cloud proof caught a legacy draft entering
-- review through a delegated writer despite the wrapper pre-read. This guard
-- makes the invariant atomic regardless of SQL-function plan rebinding or
-- which approved internal writer performs the transition.
create function bx1_portal.guard_fund_v2_product() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  -- The existing publication and funding adapter is ZAR_TEST-only. Keep v2
  -- TST packages closed even if the technical-readiness flag changes later.
  if new.terms->'terms_version'='2'::jsonb and new.status='PUBLISHED' then
    raise exception 'fund_v2_settlement_route_not_admitted' using errcode='23514'; end if;
  if TG_OP='INSERT' then
    if new.terms->>'asset_type'='FUND' then
      if new.terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(new.terms);
    end if;
    return new;
  end if;
  if new.terms->>'asset_type' is distinct from old.terms->>'asset_type' then
    raise exception 'fund_v2_asset_class_immutable' using errcode='23514';
  end if;
  if new.terms->>'asset_type'='FUND'
    and (new.terms is distinct from old.terms
      or (old.status in ('DRAFT','CHANGES_REQUIRED') and new.status='IN_REVIEW')
      or (old.status in ('DRAFT','CHANGES_REQUIRED') and new.status='DRAFT'
        and new.revision>old.revision)) then
    if new.terms->'terms_version' is distinct from '2'::jsonb then
      raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
    perform bx1_portal.validate_terms(new.terms);
  end if;
  return new;
end $$;
create trigger bx1_fund_v2_product_guard before insert or update on bx1_portal.products
for each row execute function bx1_portal.guard_fund_v2_product();

create function bx1_portal.guard_fund_v2_subscription() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if exists(select 1 from bx1_portal.products p
      where p.id=new.product_id and p.terms->'terms_version'='2'::jsonb) then
    raise exception 'fund_v2_settlement_route_not_admitted' using errcode='23514'; end if;
  return new;
end $$;
create trigger bx1_fund_v2_subscription_guard before insert on bx1_portal.subscriptions
for each row execute function bx1_portal.guard_fund_v2_subscription();

-- One authoritative v2 FUND draft writer. The inherited save path builds a
-- legacy read, a scoped read and an offering read before returning. For a
-- customer mandate that repeats expensive authority projections and can time
-- out. This cutover preserves its guarded write/receipt semantics and returns
-- only the final, current scoped snapshot. Every other action still delegates.
create function bx1_portal.save_fund_v2_scoped(c jsonb,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior bx1_portal.scoped_requests;
  p bx1_portal.products; source_application uuid; locked_application uuid; target_org uuid;
  proposed jsonb:=body->'terms'; expected integer;
begin
  if bx1_portal.valid_operating_context(c) is not true or
    key is null or key='00000000-0000-0000-0000-000000000000' or
    pg_catalog.jsonb_typeof(body) is distinct from 'object' or
    pg_catalog.octet_length(body::text)>65536 then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_lock_actor();
  perform singleton from bx1_portal.entry_configuration
    where singleton and environment='TESTNET' for share;
  if not found then raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  select * into prior from bx1_portal.scoped_requests
    where actor_id=actor and request_key=key;
  if found then
    if prior.operating_context is distinct from c or prior.command is distinct from 'save_product'
      or prior.payload is distinct from body then
      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;
    if bx1_portal.valid_operating_context(c) is not true then
      raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key) then
    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;
  perform bx1_portal.require_keys(body,array['product_id','expected_revision','terms']);
  if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'
    or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'portal_stale_product' using errcode='23514'; end if;
  expected:=(body->>'expected_revision')::integer;
  -- Existing product writers take product before organisation. Revoke/hold
  -- writers do not take product, then lock source app before org/mandate.
  select * into p from bx1_portal.products
    where id=(body->>'product_id')::uuid for update;
  if p.id is null then raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  target_org:=p.organisation_id;
  if bx1_portal.scoped_operator(c,target_org) is not true then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  select o.application_id into source_application from bx1_portal.organisations o
    where o.id=target_org;
  perform id from bx1_portal.applications where id=source_application for share;
  if not found then raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  select application_id into locked_application from bx1_portal.organisations
    where id=target_org for share;
  if not found or locked_application is distinct from source_application then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  if c->>'mode'='ROLE' then
    perform id from bx1_portal.representative_mandates
      where product_organisation_id=target_org and applicant_user_id=actor
        and native_organisation_id=(c->>'organisationId')::uuid order by id for share;
  end if;
  perform id from bx1_portal.organisation_authority_bindings
    where product_organisation_id=target_org order by id for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships
      where user_id=actor and organisation_id=(c->>'organisationId')::uuid
        and role=c->>'role' order by id for share;
  end if;
  if bx1_portal.valid_operating_context(c) is not true
    or bx1_portal.scoped_operator(c,target_org) is not true then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  if p.terms->>'asset_type' is distinct from 'FUND' or p.organisation_id is distinct from target_org then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  if p.status not in ('DRAFT','CHANGES_REQUIRED') then
    raise exception 'portal_terms_locked' using errcode='23514'; end if;
  if p.revision<>expected then raise exception 'portal_stale_product' using errcode='23514'; end if;
  if proposed->'terms_version' is distinct from '2'::jsonb
    or proposed->>'asset_type' is distinct from 'FUND' then
    raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
  perform bx1_portal.validate_terms(proposed);
  update bx1_portal.products set
    terms=proposed,
    terms_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(proposed::text,'UTF8')),'hex'),
    cap_units=(proposed->>'cap_units')::numeric,
    unit_price_minor=(proposed->>'unit_price_minor')::numeric,
    minimum_units=(proposed->>'minimum_units')::numeric,
    revision=revision+1,status='DRAFT',reviewer_id=null,review_notes=null,
    reviewed_at=null,review_checks='{}'::jsonb,current_offering_revision_id=null
    where id=p.id;
  insert into bx1_portal.requests(actor_id,request_key,command,payload)
    values(actor,key,'save_product',body);
  insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)
    values(p.id,target_org,'save_product',actor,
      'Test product draft terms revised; earlier review no longer applies.');
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
    values(actor,key,c,'save_product',body);
  if bx1_portal.valid_operating_context(c) is not true
    or bx1_portal.scoped_operator(c,target_org) is not true then
    raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  return bx1_portal.read_scoped(c);
end $$;

-- Keep the existing single guarded writer. Prevent v1 drafts from becoming new
-- fund packages and prevent six-decimal TST reaching the ZAR_TEST-only funding
-- and subscription code. Historical v1 reviews and records are preserved.
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_fund_v2;
create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare existing_terms jsonb; proposed_terms jsonb; result jsonb;
begin
  if action in ('create_product','save_product','submit_product','publish_product','subscribe') then
    if bx1_portal.valid_operating_context(c) is not true
      or key is null or key='00000000-0000-0000-0000-000000000000'
      or pg_catalog.jsonb_typeof(body) is distinct from 'object' then
      raise exception 'fund_v2_command_denied' using errcode='42501';
    end if;
    if pg_catalog.octet_length(body::text)>65536 then
      raise exception 'fund_v2_command_too_large' using errcode='22023';
    end if;
  end if;
  -- An exact historical idempotent replay is a read, not a new v1 write.
  -- Delegate so the existing command compares context/action/payload and
  -- rechecks the current session before returning a scoped projection.
  if action in ('create_product','save_product','submit_product','publish_product','subscribe')
    and (action='save_product' and body->'terms'->'terms_version'='2'::jsonb
      and body->'terms'->>'asset_type'='FUND') is not true
    and exists(select 1 from bx1_portal.scoped_requests prior
      where prior.actor_id=auth.uid() and prior.request_key=key) then
    return bx1_portal.execute_scoped_pre_fund_v2(c,action,key,body);
  end if;
  if action='create_product' then
    proposed_terms:=body->'terms';
    if proposed_terms->>'asset_type'='FUND' then
      if proposed_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(proposed_terms);
    end if;
  elsif action='save_product' then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and bx1_portal.scoped_operator(c,p.organisation_id) is true;
    proposed_terms:=body->'terms';
    if existing_terms is not null and proposed_terms->>'asset_type' is distinct from existing_terms->>'asset_type' then
      raise exception 'fund_v2_asset_class_immutable' using errcode='23514'; end if;
    if existing_terms is not null and proposed_terms->>'asset_type'='FUND' then
      if proposed_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(proposed_terms);
      return bx1_portal.save_fund_v2_scoped(c,key,body);
    end if;
  elsif action='submit_product' then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and bx1_portal.scoped_operator(c,p.organisation_id) is true;
    if existing_terms->>'asset_type'='FUND' then
      if existing_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(existing_terms);
    end if;
  elsif action in ('publish_product','subscribe') then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and ((action='publish_product' and bx1_portal.scoped_operator(c,p.organisation_id) is true)
          or (action='subscribe' and bx1_portal.scoped_product_visible(c,p.id) is true));
    if existing_terms->'terms_version'='2'::jsonb then
      raise exception 'fund_v2_settlement_route_not_admitted' using errcode='23514'; end if;
  end if;
  return bx1_portal.execute_scoped_pre_fund_v2(c,action,key,body);
end $$;

create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  return bx1_portal.execute_scoped(operating_context,command,request_key,payload);
end $$;

revoke all on function bx1_portal.validate_terms_v1(jsonb),
  bx1_portal.fund_v2_bounded_integer(jsonb,integer,integer),
  bx1_portal.validate_terms(jsonb),
  bx1_portal.guard_fund_v2_product(),
  bx1_portal.guard_fund_v2_subscription(),
  bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb),
  bx1_portal.execute_scoped_pre_fund_v2(jsonb,text,uuid,jsonb),
  bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
do $fund_v2_grants$ begin
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    grant execute on function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
      public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb) to authenticated;
  end if;
end $fund_v2_grants$;

-- The inherited base workspace projection ran the full mandate/monitoring
-- predicate once for every audit event. On a small synthetic customer history
-- that made a normal manager read take 11-14 seconds. Build the event's
-- permitted-organisation set once per read instead. Recheck that cached
-- authority at the end: a mandate can expire while this projection runs.
-- Keep every other predicate and the existing context checks unchanged.
do $fund_v2_read_efficiency$
declare definition text; candidates oid[];
  old_declaration text := 'declare v_actor uuid:=auth.uid(); result jsonb;';
  new_declaration text := 'declare v_actor uuid:=auth.uid(); result jsonb; v_operator_orgs uuid[];';
  old_initial_check text :=
    'if bx1_portal.valid_operating_context(c) is not true then raise exception ''portal_context_denied'' using errcode=''42501''; end if;';
  new_initial_check text :=
    old_initial_check || E'\n  v_operator_orgs := array(select permitted.id from bx1_portal.organisations permitted where bx1_portal.scoped_operator(c,permitted.id));';
  old_predicate text :=
  'from bx1_portal.events e where bx1_portal.scoped_operator(c,e.organisation_id)';
  new_predicate text :=
  'from bx1_portal.events e where e.organisation_id = any(v_operator_orgs)';
  old_final_check text :=
    'if bx1_portal.valid_operating_context(c) is not true then raise exception ''portal_context_changed'' using errcode=''42501''; end if;';
  new_final_check text :=
    E'if exists(select 1 from pg_catalog.unnest(v_operator_orgs) as org(id) where bx1_portal.scoped_operator(c,org.id) is not true) then\n    raise exception ''portal_context_changed'' using errcode=''42501''; end if;\n  ' || old_final_check;
begin
  -- The two hosted projects preserve different historical function names:
  -- TEST has read_scoped_p2, while MAIN and the source fixture have
  -- read_scoped_pre_eligibility. Select by the exact old body, never by a
  -- guessed name, and stop if the chain has zero or multiple candidates.
  candidates := array(select p.oid from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and pg_catalog.left(p.proname::text,11)='read_scoped'
      and p.pronargs=1 and p.proargtypes[0]='jsonb'::pg_catalog.regtype
      and pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid),old_predicate)>0);
  if pg_catalog.cardinality(candidates)<>1 then
    raise exception 'fund_v2_base_read_target_ambiguous' using errcode='55000'; end if;
  definition := pg_catalog.pg_get_functiondef(candidates[1]);
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_declaration,'')))
       /pg_catalog.length(old_declaration) <> 1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_initial_check,'')))
       /pg_catalog.length(old_initial_check) <> 1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_predicate,'')))
       /pg_catalog.length(old_predicate) <> 1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_final_check,'')))
       /pg_catalog.length(old_final_check) <> 1 then
    raise exception 'fund_v2_base_read_definition_changed' using errcode='55000'; end if;
  definition := pg_catalog.replace(definition,old_declaration,new_declaration);
  definition := pg_catalog.replace(definition,old_initial_check,new_initial_check);
  definition := pg_catalog.replace(definition,old_predicate,new_predicate);
  definition := pg_catalog.replace(definition,old_final_check,new_final_check);
  execute definition;
end $fund_v2_read_efficiency$;
