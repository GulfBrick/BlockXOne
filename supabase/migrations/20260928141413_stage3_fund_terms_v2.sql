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

-- Keep the existing single guarded writer. Prevent v1 drafts from becoming new
-- fund packages and prevent six-decimal TST reaching the ZAR_TEST-only funding
-- and subscription code. Historical v1 reviews and records are preserved.
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_fund_v2;
create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare existing_terms jsonb; proposed_terms jsonb;
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
    end if;
  elsif action='submit_product' then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and bx1_portal.scoped_operator(c,p.organisation_id) is true;
    if existing_terms->>'asset_type'='FUND' then
      if existing_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'fund_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(existing_terms);
    end if;
  elsif action in ('publish_product','subscribe') then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and ((action='publish_product' and bx1_portal.scoped_operator(c,p.organisation_id) is true)
          or (action='subscribe' and bx1_portal.scoped_product_visible(c,p.id) is true));
    if existing_terms->'terms_version'='2'::jsonb then
      raise exception 'fund_v2_settlement_route_not_admitted' using errcode='23514'; end if;
  end if;
  return bx1_portal.execute_scoped_pre_fund_v2(c,action,key,body);
end $$;

create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select bx1_portal.execute_scoped(operating_context,command,request_key,payload);
$$;

revoke all on function bx1_portal.validate_terms_v1(jsonb),
  bx1_portal.fund_v2_bounded_integer(jsonb,integer,integer),
  bx1_portal.validate_terms(jsonb),
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
