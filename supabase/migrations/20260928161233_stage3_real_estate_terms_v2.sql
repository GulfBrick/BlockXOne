-- Stage 3: typed six-decimal TST real-estate offering packages. Historical
-- ZAR_TEST property terms, accepted orders and immutable revisions are not
-- reinterpreted. No settlement route, property title or legal approval is
-- implied by the synthetic package.

create function bx1_portal.validate_real_estate_terms_v2(terms jsonb) returns void
language plpgsql set search_path='' as $$
declare property jsonb; spv jsonb; asset jsonb; financing jsonb;
  cashflow jsonb; governance jsonb; exits jsonb;
begin
  perform bx1_portal.require_keys(terms,array[
    'asset_type','name','issuer_name','summary','strategy','share_class',
    'currency','unit_price_minor','cap_units','minimum_units','pricing_basis',
    'fees','redemption_terms','eligible_countries','eligible_investor_types',
    'property_address','property_valuation_minor','rental_income_policy',
    'documents','terms_version','settlement_decimals','real_estate']);
  if terms->'terms_version' is distinct from '2'::jsonb
    or terms->>'asset_type' is distinct from 'REAL_ESTATE'
    or terms->>'currency' is distinct from 'TST'
    or terms->'settlement_decimals' is distinct from '6'::jsonb then
    raise exception 'property_v2_asset_or_denomination_invalid' using errcode='22023'; end if;
  -- Legacy text keys are canonical cross-references only. Typed property
  -- policies below are the operative rights, income and exit descriptions.
  if terms->>'strategy' is distinct from
      'The real_estate.spv and real_estate.property policies define the property interest and control for this package.'
    or terms->>'pricing_basis' is distinct from
      'The real_estate.property valuation policy is the authoritative pricing basis for this package.'
    or terms->>'fees' is distinct from
      'The real_estate.cashflow expense and reserve policies govern charges for this package.'
    or terms->>'redemption_terms' is distinct from
      'The real_estate.exits policies distinguish eligible interest transfer from disposal and liquidation for this package.'
    or terms->>'rental_income_policy' is distinct from
      'The real_estate.cashflow rent and distribution policies govern income for this package.' then
    raise exception 'property_v2_noncanonical_economics' using errcode='22023'; end if;
  if terms::text ~* 'ZAR_TEST' then
    raise exception 'property_v2_legacy_denomination_reference' using errcode='22023'; end if;
  -- Reuse original common disclosure/eligibility validation without changing
  -- its historical ZAR_TEST semantics. This is validation, not conversion.
  perform bx1_portal.validate_terms_v1(pg_catalog.jsonb_set(
    terms-'terms_version'-'settlement_decimals'-'real_estate',
    '{currency}','"ZAR_TEST"'::jsonb));
  property:=terms->'real_estate';
  perform bx1_portal.require_keys(property,array[
    'spv','property','financing','cashflow','governance','exits']);
  spv:=property->'spv';
  perform bx1_portal.require_keys(spv,array[
    'legal_name','registration_reference','jurisdiction','interest_rights']);
  perform bx1_portal.require_text(spv,'legal_name',3,160);
  perform bx1_portal.require_text(spv,'registration_reference',3,100);
  perform bx1_portal.require_text(spv,'jurisdiction',2,2);
  if spv->>'jurisdiction' !~ '^[A-Z]{2}$' then
    raise exception 'property_v2_jurisdiction_invalid' using errcode='22023'; end if;
  perform bx1_portal.require_text(spv,'interest_rights',20,2400);
  asset:=property->'property';
  perform bx1_portal.require_keys(asset,array[
    'title_evidence_reference','control_evidence_reference',
    'valuation_method','valuation_frequency','correction_policy']);
  perform bx1_portal.require_text(asset,'title_evidence_reference',10,400);
  perform bx1_portal.require_text(asset,'control_evidence_reference',10,400);
  perform bx1_portal.require_text(asset,'valuation_method',20,2000);
  perform bx1_portal.require_text(asset,'correction_policy',20,2000);
  if asset->>'valuation_frequency' not in ('QUARTERLY','ANNUALLY')
    or asset->>'valuation_frequency' is null then
    raise exception 'property_v2_valuation_frequency_invalid' using errcode='22023'; end if;
  financing:=property->'financing';
  perform bx1_portal.require_keys(financing,array['debt_policy','lender_consent_policy']);
  perform bx1_portal.require_text(financing,'debt_policy',20,2000);
  perform bx1_portal.require_text(financing,'lender_consent_policy',20,2000);
  cashflow:=property->'cashflow';
  perform bx1_portal.require_keys(cashflow,array[
    'rent_policy','expense_policy','reserve_policy','distribution_policy']);
  perform bx1_portal.require_text(cashflow,'rent_policy',20,2000);
  perform bx1_portal.require_text(cashflow,'expense_policy',20,2000);
  perform bx1_portal.require_text(cashflow,'reserve_policy',20,2000);
  perform bx1_portal.require_text(cashflow,'distribution_policy',20,2000);
  governance:=property->'governance';
  perform bx1_portal.require_keys(governance,array['consent_rights','voting_policy']);
  perform bx1_portal.require_text(governance,'consent_rights',20,2000);
  perform bx1_portal.require_text(governance,'voting_policy',20,2000);
  exits:=property->'exits';
  perform bx1_portal.require_keys(exits,array[
    'eligible_transfer_policy','disposal_liquidation_policy']);
  perform bx1_portal.require_text(exits,'eligible_transfer_policy',20,2400);
  perform bx1_portal.require_text(exits,'disposal_liquidation_policy',20,2400);
  if exits->>'eligible_transfer_policy'=exits->>'disposal_liquidation_policy' then
    raise exception 'property_v2_exit_paths_must_differ' using errcode='23514'; end if;
end $$;

-- Preserve the existing function identity so callers already bound to it
-- (including legacy internal writers) must use the new property validator.
create or replace function bx1_portal.validate_terms(terms jsonb) returns void
language plpgsql set search_path='' as $$
declare fund jsonb; nav jsonb; dealing jsonb; fees jsonb;
  liquidity jsonb; distributions jsonb; redemption jsonb;
begin
  if terms->>'asset_type'='REAL_ESTATE' and terms ? 'terms_version' then
    perform bx1_portal.validate_real_estate_terms_v2(terms);
    return;
  end if;
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
  if terms->>'strategy' is distinct from 'The fund.mandate policy is the authoritative investment mandate for this package.'
    or terms->>'pricing_basis' is distinct from 'The fund.nav and fund.dealing policies are the authoritative pricing terms for this package.'
    or terms->>'fees' is distinct from 'The fund.fees policy is the authoritative fee schedule for this package.'
    or terms->>'redemption_terms' is distinct from 'The fund.redemption, fund.dealing and fund.liquidity policies govern exits for this package.' then
    raise exception 'fund_v2_noncanonical_economics' using errcode='22023';
  end if;
  if terms::text ~* 'ZAR_TEST' then
    raise exception 'fund_v2_legacy_denomination_reference' using errcode='22023';
  end if;
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

create function bx1_portal.guard_real_estate_v2_product() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if new.terms->>'asset_type' is distinct from 'REAL_ESTATE' then return new; end if;
  if new.terms->'terms_version'='2'::jsonb and new.status='PUBLISHED' then
    raise exception 'property_v2_settlement_route_not_admitted' using errcode='23514'; end if;
  if TG_OP='INSERT' then
    if new.terms->'terms_version' is distinct from '2'::jsonb then
      raise exception 'property_v2_terms_required' using errcode='23514'; end if;
    perform bx1_portal.validate_terms(new.terms);
    return new;
  end if;
  if new.terms is distinct from old.terms
    or (old.status in ('DRAFT','CHANGES_REQUIRED')
      and new.status not in ('DRAFT','CHANGES_REQUIRED')) then
    if new.terms->'terms_version' is distinct from '2'::jsonb then
      raise exception 'property_v2_terms_required' using errcode='23514'; end if;
    perform bx1_portal.validate_terms(new.terms);
  end if;
  return new;
end $$;
create trigger bx1_real_estate_v2_product_guard before insert or update on bx1_portal.products
for each row execute function bx1_portal.guard_real_estate_v2_product();

-- A single scoped draft writer for v2 property terms. It follows the tested
-- fund lock order, records both idempotency receipts and one audit event, and
-- reads the final scoped state only once. This is not a second application.
create function bx1_portal.save_real_estate_v2_scoped(c jsonb,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior bx1_portal.scoped_requests;
  p bx1_portal.products; source_application uuid; locked_application uuid; target_org uuid;
  proposed jsonb:=body->'terms'; expected integer;
begin
  if bx1_portal.valid_operating_context(c) is not true or
    key is null or key='00000000-0000-0000-0000-000000000000' or
    pg_catalog.jsonb_typeof(body) is distinct from 'object' or
    pg_catalog.octet_length(body::text)>65536 then
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_lock_actor();
  perform singleton from bx1_portal.entry_configuration
    where singleton and environment='TESTNET' for share;
  if not found then raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  select * into prior from bx1_portal.scoped_requests
    where actor_id=actor and request_key=key;
  if found then
    if prior.operating_context is distinct from c or prior.command is distinct from 'save_product'
      or prior.payload is distinct from body then
      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;
    if bx1_portal.valid_operating_context(c) is not true then
      raise exception 'property_v2_save_denied' using errcode='42501'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key) then
    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;
  perform bx1_portal.require_keys(body,array['product_id','expected_revision','terms']);
  if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'
    or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'portal_stale_product' using errcode='23514'; end if;
  expected:=(body->>'expected_revision')::integer;
  select * into p from bx1_portal.products
    where id=(body->>'product_id')::uuid for update;
  if p.id is null then raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  target_org:=p.organisation_id;
  if bx1_portal.scoped_operator(c,target_org) is not true then
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  select o.application_id into source_application from bx1_portal.organisations o
    where o.id=target_org;
  perform id from bx1_portal.applications where id=source_application for share;
  if not found then raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  select application_id into locked_application from bx1_portal.organisations
    where id=target_org for share;
  if not found or locked_application is distinct from source_application then
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
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
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  if p.terms->>'asset_type' is distinct from 'REAL_ESTATE'
    or p.organisation_id is distinct from target_org then
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  if p.status not in ('DRAFT','CHANGES_REQUIRED') then
    raise exception 'portal_terms_locked' using errcode='23514'; end if;
  if p.revision<>expected then raise exception 'portal_stale_product' using errcode='23514'; end if;
  if proposed->'terms_version' is distinct from '2'::jsonb
    or proposed->>'asset_type' is distinct from 'REAL_ESTATE' then
    raise exception 'property_v2_terms_required' using errcode='23514'; end if;
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
      'Synthetic property draft terms revised; earlier review no longer applies.');
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
    values(actor,key,c,'save_product',body);
  if bx1_portal.valid_operating_context(c) is not true
    or bx1_portal.scoped_operator(c,target_org) is not true then
    raise exception 'property_v2_save_denied' using errcode='42501'; end if;
  return bx1_portal.read_scoped(c);
end $$;

-- Replace the one public command dispatcher in place. This deliberately does
-- not add another route or allow a property v2 package into v1 funding logic.
create or replace function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare existing_terms jsonb; proposed_terms jsonb;
begin
  if action in ('create_product','save_product','submit_product','publish_product','subscribe') then
    if bx1_portal.valid_operating_context(c) is not true
      or key is null or key='00000000-0000-0000-0000-000000000000'
      or pg_catalog.jsonb_typeof(body) is distinct from 'object' then
      raise exception 'product_v2_command_denied' using errcode='42501'; end if;
    if pg_catalog.octet_length(body::text)>65536 then
      raise exception 'product_v2_command_too_large' using errcode='22023'; end if;
  end if;
  if action in ('create_product','save_product','submit_product','publish_product','subscribe')
    and (action='save_product' and body->'terms'->'terms_version'='2'::jsonb
      and body->'terms'->>'asset_type' in ('FUND','REAL_ESTATE')) is not true
    and exists(select 1 from bx1_portal.scoped_requests prior
      where prior.actor_id=auth.uid() and prior.request_key=key) then
    return bx1_portal.execute_scoped_pre_fund_v2(c,action,key,body);
  end if;
  if action='create_product' then
    proposed_terms:=body->'terms';
    if proposed_terms->>'asset_type' in ('FUND','REAL_ESTATE') then
      if proposed_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'product_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(proposed_terms);
    end if;
  elsif action='save_product' then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and bx1_portal.scoped_operator(c,p.organisation_id) is true;
    proposed_terms:=body->'terms';
    if existing_terms is not null
      and proposed_terms->>'asset_type' is distinct from existing_terms->>'asset_type' then
      raise exception 'product_v2_asset_class_immutable' using errcode='23514'; end if;
    if existing_terms is not null and proposed_terms->>'asset_type' in ('FUND','REAL_ESTATE') then
      if proposed_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'product_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(proposed_terms);
      if proposed_terms->>'asset_type'='FUND' then
        return bx1_portal.save_fund_v2_scoped(c,key,body);
      end if;
      return bx1_portal.save_real_estate_v2_scoped(c,key,body);
    end if;
  elsif action='submit_product' then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and bx1_portal.scoped_operator(c,p.organisation_id) is true;
    if existing_terms->>'asset_type' in ('FUND','REAL_ESTATE') then
      if existing_terms->'terms_version' is distinct from '2'::jsonb then
        raise exception 'product_v2_terms_required' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(existing_terms);
    end if;
  elsif action in ('publish_product','subscribe') then
    select p.terms into existing_terms from bx1_portal.products p
      where p.id=case when body->>'product_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (body->>'product_id')::uuid else null end
        and ((action='publish_product' and bx1_portal.scoped_operator(c,p.organisation_id) is true)
          or (action='subscribe' and bx1_portal.scoped_product_visible(c,p.id) is true));
    if existing_terms->'terms_version'='2'::jsonb then
      raise exception 'product_v2_settlement_route_not_admitted' using errcode='23514'; end if;
  end if;
  return bx1_portal.execute_scoped_pre_fund_v2(c,action,key,body);
end $$;

revoke all on function bx1_portal.validate_real_estate_terms_v2(jsonb),
  bx1_portal.validate_terms(jsonb),bx1_portal.guard_real_estate_v2_product(),
  bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb),
  bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
do $property_v2_grants$ begin
  if exists(select 1 from bx1_portal.entry_configuration
    where singleton and environment='TESTNET') then
    grant execute on function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)
      to authenticated;
  end if;
end $property_v2_grants$;
