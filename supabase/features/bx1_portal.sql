-- Native customer portal: TEST_ONLY onboarding, offering review and reservations.
-- Apply transactionally after the published native identity/MFA/authority migrations.
-- No dependency on the unpublished recovery migration or changes to its helpers.
-- This feature seeds no identities, roles, organisations, approvals or money.
create schema bx1_portal;
revoke all on schema bx1_portal from public, anon, authenticated, service_role;

create table bx1_portal.applications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  persona text not null check (persona in ('INVESTOR','WEALTH_MANAGER')),
  status text not null check (status in ('DRAFT','SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED')),
  revision integer not null default 1 check (revision>0),
  details jsonb not null check (jsonb_typeof(details)='object'),
  reviewer_scope uuid not null references public.bx1_organisations(id),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id),
  review_notes text,
  review_checks jsonb not null default '{}',
  approved_until timestamptz,
  organisation_id uuid unique,
  provider_mode text not null default 'MANUAL_TEST_REVIEW' check(provider_mode='MANUAL_TEST_REVIEW'),
  check (reviewer_id is null or reviewer_id<>user_id),
  check ((status='APPROVED')=(approved_until is not null)),
  check (approved_until is null or approved_until=reviewed_at+interval '30 days')
);
create table bx1_portal.organisations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  application_id uuid not null unique references bx1_portal.applications(id),
  owner_id uuid not null references auth.users(id),
  name text not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','SUSPENDED')),
  reviewer_scope uuid not null references public.bx1_organisations(id),
  created_at timestamptz not null default now()
);
alter table bx1_portal.applications add foreign key(organisation_id) references bx1_portal.organisations(id);
create table bx1_portal.products (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null references bx1_portal.organisations(id),
  created_by uuid not null references auth.users(id),
  revision integer not null default 1 check(revision>0),
  status text not null default 'DRAFT' check(status in ('DRAFT','IN_REVIEW','CHANGES_REQUIRED','APPROVED','PUBLISHED')),
  terms jsonb not null,
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  reserved_units numeric(20,0) not null default 0 check(reserved_units>=0),
  cap_units numeric(20,0) not null check(cap_units>0),
  unit_price_minor numeric(20,0) not null check(unit_price_minor>0),
  minimum_units numeric(20,0) not null check(minimum_units>0 and minimum_units<=cap_units),
  created_at timestamptz not null default now(),
  reviewer_id uuid references auth.users(id),
  review_notes text,
  reviewed_at timestamptz,
  published_at timestamptz,
  review_checks jsonb not null default '{}',
  check(reserved_units<=cap_units),
  check(reviewer_id is null or reviewer_id<>created_by),
  check(terms_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(terms::text,'UTF8')),'hex')),
  check(cap_units=(terms->>'cap_units')::numeric and unit_price_minor=(terms->>'unit_price_minor')::numeric and minimum_units=(terms->>'minimum_units')::numeric)
);
create index bx1_portal_products_org on bx1_portal.products(organisation_id);
create table bx1_portal.subscriptions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id),
  investor_id uuid not null references auth.users(id),
  organisation_id uuid not null references bx1_portal.organisations(id),
  product_revision integer not null check(product_revision>0),
  terms_hash text not null,
  accepted_terms jsonb not null,
  accepted_documents boolean not null check(accepted_documents),
  accepted_risks boolean not null check(accepted_risks),
  units numeric(20,0) not null check(units>0),
  amount_minor numeric(40,0) not null check(amount_minor>0),
  status text not null default 'AWAITING_FUNDING' check(status in ('AWAITING_FUNDING','CANCELLED')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check((status='CANCELLED')=(cancelled_at is not null)),
  check(amount_minor=units*(accepted_terms->>'unit_price_minor')::numeric)
);
create index bx1_portal_subscriptions_investor on bx1_portal.subscriptions(investor_id);
create index bx1_portal_subscriptions_product on bx1_portal.subscriptions(product_id);
create table bx1_portal.requests (
  actor_id uuid not null references auth.users(id), request_key uuid not null,
  command text not null, payload jsonb not null, created_at timestamptz not null default now(),
  primary key(actor_id,request_key)
);
create table bx1_portal.events (
  id uuid primary key default pg_catalog.gen_random_uuid(), subject_id uuid not null,
  application_id uuid references bx1_portal.applications(id),
  organisation_id uuid references bx1_portal.organisations(id),
  investor_id uuid references auth.users(id),
  kind text not null, actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(), summary text not null
);

create function bx1_portal.has_session() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or not exists(
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=v_actor and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
      and s.id::text=auth.jwt()->>'session_id' and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>now())
  ) then return false; end if;
  if exists(select 1 from public.bx1_profiles p where p.id=v_actor) then
    return bx1_private.has_active_session() and bx1_private.has_token_mfa();
  end if;
  -- New verified applicants have no native profile; current enrolled factors
  -- still require the real AAL2 session/factor and matching token assurance.
  return coalesce(not exists(select 1 from auth.mfa_factors f where f.user_id=v_actor and f.status::text='verified')
    or (auth.jwt()->>'aal'='aal2' and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.user_id=v_actor and s.id::text=auth.jwt()->>'session_id' and s.aal::text='aal2' and f.status::text='verified')),false);
exception when others then return false;
end $$;

create function bx1_portal.is_reviewer(target_scope uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select bx1_portal.has_session() and target_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e'::uuid
    and bx1_private.can_access_organisation(target_scope)
    and exists(select 1 from public.bx1_memberships m where m.user_id=auth.uid()
      and m.organisation_id=target_scope and m.role='ComplianceOfficer' and m.status='ACTIVE');
$$;
create function bx1_portal.is_operator(target_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select bx1_portal.has_session() and exists(select 1 from bx1_portal.organisations o
    join bx1_portal.applications a on a.id=o.application_id where o.id=target_org and o.owner_id=auth.uid()
      and o.status='ACTIVE' and a.status='APPROVED' and a.approved_until>now() and a.persona='WEALTH_MANAGER');
$$;
create function bx1_portal.organisation_active(target_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.organisations o join bx1_portal.applications a on a.id=o.application_id
    where o.id=target_org and o.status='ACTIVE' and a.status='APPROVED' and a.approved_until>now());
$$;
create function bx1_portal.independent_of(target_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select target_user<>auth.uid() and not exists(
    select 1 from bx1_private.person_principals a join bx1_private.person_principals b on b.person_id=a.person_id
    where a.auth_user_id=auth.uid() and b.auth_user_id=target_user);
$$;
create function bx1_portal.is_eligible(target_terms jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select bx1_portal.has_session() and exists(select 1 from bx1_portal.applications a
    where a.user_id=auth.uid() and a.persona='INVESTOR' and a.status='APPROVED' and a.approved_until>now()
      and target_terms->'eligible_countries' ? (a.details->>'country')
      and target_terms->'eligible_investor_types' ? (a.details->>'investor_type'));
$$;
create function bx1_portal.object_readable(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select bx1_portal.has_session() and (
    split_part(object_name,'/',1)=auth.uid()::text
    or exists(select 1 from bx1_portal.applications a
      where bx1_portal.is_reviewer(a.reviewer_scope) and a.status<>'DRAFT'
        and exists(select 1 from jsonb_array_elements(a.details->'documents') d where d->>'storage_path'=object_name))
  );
$$;
create function bx1_portal.document_upload_allowed(object_name text, object_owner text, object_metadata jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_count bigint;
begin
  if bx1_portal.has_session() is not true or object_owner is distinct from v_actor::text
    or split_part(object_name,'/',1) is distinct from v_actor::text then return false; end if;
  -- Storage canUpload probes do not contain final metadata.size. Account every
  -- object at the 4MiB bucket maximum: eight objects <=32MiB, without trusting
  -- caller metadata or rejecting metadata-absent authorization probes.
  -- Separate lock namespace; this helper bypasses object RLS only to count the
  -- caller's own quota, so it never invokes this INSERT policy recursively.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal_document:'||v_actor::text,0));
  if bx1_portal.has_session() is not true then return false; end if;
  select count(*) into v_count from storage.objects o where o.bucket_id='bx1-portal-documents'
      and (o.owner_id=v_actor::text or split_part(o.name,'/',1)=v_actor::text);
  return v_count<8;
end $$;
create function bx1_portal.guard_stored_document() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_owner text; v_count bigint;
begin
  -- Storage completeUpload writes as its privileged backend role after a rolled
  -- back canUpload probe. RLS alone cannot enforce final quota/immutability.
  if TG_OP<>'INSERT' then
    if old.bucket_id='bx1-portal-documents' then raise exception 'portal_document_immutable' using errcode='23514'; end if;
    if TG_OP='DELETE' then return old; end if;
  end if;
  if new.bucket_id<>'bx1-portal-documents' then return new; end if;
  v_owner:=new.owner_id;
  if v_owner is null or v_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(new.name,'/',1) is distinct from v_owner then raise exception 'portal_document_owner_required' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal_document:'||v_owner,0));
  select count(*) into v_count from storage.objects o where o.bucket_id='bx1-portal-documents'
    and (o.owner_id=v_owner or split_part(o.name,'/',1)=v_owner);
  if v_count>=8 then raise exception 'portal_document_quota_exceeded' using errcode='23514'; end if;
  return new;
end $$;

create function bx1_portal.require_keys(value jsonb, keys text[]) returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or not(value ?& keys) or value-keys<>'{}'::jsonb then
    raise exception 'portal_invalid_fields' using errcode='22023';
  end if;
end $$;
create function bx1_portal.require_text(value jsonb, field text, minimum integer, maximum integer) returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(value->field) is distinct from 'string' or length(value->>field) not between minimum and maximum
    or value->>field<>btrim(value->>field) then raise exception 'portal_invalid_text' using errcode='22023'; end if;
end $$;
create function bx1_portal.positive(value jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'string' or value#>>'{}' !~ '^[1-9][0-9]{0,19}$' then
    raise exception 'portal_invalid_amount' using errcode='22023'; end if;
  return (value#>>'{}')::numeric;
end $$;
create function bx1_portal.require_checks(value jsonb, fields text[], approved boolean) returns void
language plpgsql set search_path='' as $$
declare f text;
begin
  perform bx1_portal.require_keys(value,fields);
  foreach f in array fields loop
    if jsonb_typeof(value->f) is distinct from 'boolean' or (approved and value->f<>'true'::jsonb) then
      raise exception 'portal_checks_incomplete' using errcode='23514'; end if;
  end loop;
end $$;
create function bx1_portal.validate_application(details jsonb, persona text) returns void
language plpgsql set search_path='' as $$
declare d jsonb; doc_ids text[]:='{}'; doc_paths text[]:='{}'; doc_kinds text[]:='{}'; v_size numeric;
begin
  perform bx1_portal.require_keys(details,array['full_name','country','investor_type','company_name','registration_reference','source_of_funds','beneficial_owners','experience','documents','test_data_acknowledged']);
  perform bx1_portal.require_text(details,'full_name',2,120);
  perform bx1_portal.require_text(details,'country',2,2);
  perform bx1_portal.require_text(details,'company_name',0,160);
  perform bx1_portal.require_text(details,'registration_reference',0,100);
  perform bx1_portal.require_text(details,'source_of_funds',20,2000);
  perform bx1_portal.require_text(details,'beneficial_owners',0,2000);
  perform bx1_portal.require_text(details,'experience',10,2000);
  if details->>'country' !~ '^[A-Z]{2}$' or coalesce(details->>'investor_type','') not in ('INDIVIDUAL','ENTITY')
    or details->'test_data_acknowledged' is distinct from 'true'::jsonb
    or jsonb_typeof(details->'documents') is distinct from 'array' then
    raise exception 'portal_invalid_application' using errcode='22023'; end if;
  if jsonb_array_length(details->'documents') not between 1 and 8 then raise exception 'portal_documents_required' using errcode='23514'; end if;
  for d in select * from jsonb_array_elements(details->'documents') loop
    perform bx1_portal.require_keys(d,array['id','kind','title','storage_path','sha256','size','mime_type']);
    perform bx1_portal.require_text(d,'title',1,160);
    perform bx1_portal.require_text(d,'storage_path',1,400);
    if jsonb_typeof(d->'id') is distinct from 'string' or d->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(d->>'kind','') not in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')
      or jsonb_typeof(d->'sha256') is distinct from 'string' or d->>'sha256' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(d->'size') is distinct from 'number' or d->>'size' !~ '^[1-9][0-9]{0,6}$'
      or coalesce(d->>'mime_type','') not in ('application/pdf','image/png','image/jpeg')
      or split_part(d->>'storage_path','/',1)<>auth.uid()::text
      or (d->>'id')=any(doc_ids) or (d->>'storage_path')=any(doc_paths) then
      raise exception 'portal_invalid_document' using errcode='22023'; end if;
    v_size:=(d->>'size')::numeric;
    if v_size>4194304 or not exists(select 1 from storage.objects o
      where o.bucket_id='bx1-portal-documents' and o.name=d->>'storage_path' and o.owner_id=auth.uid()::text
        and o.metadata->>'size'=d->>'size' and o.metadata->>'mimetype'=d->>'mime_type') then
      raise exception 'portal_document_upload_not_verified' using errcode='23514'; end if;
    doc_ids:=array_append(doc_ids,d->>'id'); doc_paths:=array_append(doc_paths,d->>'storage_path'); doc_kinds:=array_append(doc_kinds,d->>'kind');
  end loop;
  if not 'IDENTITY'=any(doc_kinds) then raise exception 'portal_identity_document_required' using errcode='23514'; end if;
  if persona='WEALTH_MANAGER' or details->>'investor_type'='ENTITY' then
    if length(details->>'company_name')<3 or length(details->>'registration_reference')<3 or length(details->>'beneficial_owners')<20
      or not 'COMPANY'=any(doc_kinds) or not 'BENEFICIAL_OWNERS'=any(doc_kinds) then
      raise exception 'portal_kyb_evidence_required' using errcode='23514'; end if;
  end if;
end $$;
create function bx1_portal.validate_terms(terms jsonb) returns void
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
  if jsonb_typeof(terms->'property_valuation_minor') is distinct from 'string' or terms->>'property_valuation_minor' !~ '^(0|[1-9][0-9]{0,19})$' then raise exception 'portal_invalid_valuation' using errcode='22023'; end if;
  if terms->>'asset_type'='REAL_ESTATE' and (length(terms->>'property_address')<10 or (terms->>'property_valuation_minor')::numeric<=0 or length(terms->>'rental_income_policy')<20) then raise exception 'portal_property_terms_required' using errcode='23514'; end if;
  if jsonb_typeof(terms->'eligible_countries') is distinct from 'array' or jsonb_typeof(terms->'eligible_investor_types') is distinct from 'array' then raise exception 'portal_invalid_eligibility' using errcode='22023'; end if;
  if jsonb_array_length(terms->'eligible_countries') not between 1 and 30 or jsonb_array_length(terms->'eligible_investor_types') not between 1 and 2 then raise exception 'portal_invalid_eligibility' using errcode='22023'; end if;
  for v in select * from jsonb_array_elements(terms->'eligible_countries') loop
    if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[A-Z]{2}$' then raise exception 'portal_invalid_country' using errcode='22023'; end if;
  end loop;
  for v in select * from jsonb_array_elements(terms->'eligible_investor_types') loop
    if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' not in ('INDIVIDUAL','ENTITY') then raise exception 'portal_invalid_investor_type' using errcode='22023'; end if;
  end loop;
  perform bx1_portal.require_keys(terms->'documents',array['memorandum','risks','subscription_terms']);
  perform bx1_portal.require_text(terms->'documents','memorandum',50,12000);
  perform bx1_portal.require_text(terms->'documents','risks',50,12000);
  perform bx1_portal.require_text(terms->'documents','subscription_terms',50,12000);
end $$;

create function bx1_portal.read_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
  if bx1_portal.has_session() is not true then raise exception 'portal_session_required' using errcode='42501'; end if;
  select jsonb_build_object(
    'actor',jsonb_build_object('id',v_actor,'email',u.email,'display_name',(select p.display_name from public.bx1_profiles p where p.id=v_actor),'can_review',bx1_portal.is_reviewer('0ba2b126-bd85-4cfb-9a1d-83633c9def1e')),
    'applications',coalesce((select jsonb_agg(to_jsonb(a)-'reviewer_scope' order by a.submitted_at,a.id) from bx1_portal.applications a where a.user_id=v_actor or bx1_portal.is_reviewer(a.reviewer_scope)),'[]'::jsonb),
    'organisations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',o.status,'roles',jsonb_build_array('IssuerFundManager','OfferingManager')) order by o.id) from bx1_portal.organisations o where o.owner_id=v_actor),'[]'::jsonb),
    'products',coalesce((select jsonb_agg((to_jsonb(p)-array['cap_units','minimum_units','unit_price_minor'])||jsonb_build_object('reserved_units',p.reserved_units::text) order by p.created_at,p.id) from bx1_portal.products p join bx1_portal.organisations o on o.id=p.organisation_id where bx1_portal.is_operator(o.id) or bx1_portal.is_reviewer(o.reviewer_scope) or (p.status='PUBLISHED' and bx1_portal.organisation_active(o.id) and bx1_portal.is_eligible(p.terms))),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'product_id',s.product_id,'investor_id',s.investor_id,'product_name',s.accepted_terms->>'name','organisation_id',s.organisation_id,'product_revision',s.product_revision,'terms_hash',s.terms_hash,'units',s.units::text,'amount_minor',s.amount_minor::text,'status',s.status,'created_at',s.created_at) order by s.created_at,s.id) from bx1_portal.subscriptions s where s.investor_id=v_actor or bx1_portal.is_operator(s.organisation_id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'subject_id',e.subject_id,'kind',e.kind,'actor_id',e.actor_id,'created_at',e.created_at,'summary',e.summary) order by e.created_at,e.id) from bx1_portal.events e where e.actor_id=v_actor or e.investor_id=v_actor or bx1_portal.is_operator(e.organisation_id) or exists(select 1 from bx1_portal.applications a where a.id=e.application_id and (a.user_id=v_actor or bx1_portal.is_reviewer(a.reviewer_scope))) or exists(select 1 from bx1_portal.organisations o where o.id=e.organisation_id and bx1_portal.is_reviewer(o.reviewer_scope))),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('key',r.request_key,'command',r.command) order by r.created_at desc,r.request_key) from (select request_key,command,created_at from bx1_portal.requests where actor_id=v_actor and created_at>=now()-interval '7 days' order by created_at desc,request_key limit 1000) r),'[]'::jsonb)
  ) into v_result from auth.users u where u.id=v_actor;
  return v_result;
end $$;

create function bx1_portal.execute_command(command text, request_key uuid, payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_request bx1_portal.requests; a bx1_portal.applications;
  p bx1_portal.products; o bx1_portal.organisations; s bx1_portal.subscriptions;
  v_subject uuid; v_application uuid; v_org uuid; v_investor uuid; v_units numeric; v_revision integer;
  v_now timestamptz:=clock_timestamp(); v_summary text;
begin
  if bx1_portal.has_session() is not true then raise exception 'portal_session_required' using errcode='42501'; end if;
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>65536 then raise exception 'portal_invalid_command' using errcode='22023'; end if;
  -- All commands by one principal serialize, including first application creation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));
  if bx1_portal.has_session() is not true then raise exception 'portal_session_required' using errcode='42501'; end if;
  select * into v_request from bx1_portal.requests r where r.actor_id=v_actor and r.request_key=execute_command.request_key;
  if found then
    if v_request.command is distinct from command or v_request.payload is distinct from payload then raise exception 'portal_idempotency_conflict' using errcode='23505'; end if;
    -- Fresh scoped view, not a historical snapshot that could disclose revoked access.
    return bx1_portal.read_state();
  end if;
  if command='submit_application' then
    perform bx1_portal.require_keys(payload,array['persona','expected_revision','details']);
    if coalesce(payload->>'persona','') not in ('INVESTOR','WEALTH_MANAGER') or jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[0-9]{1,9}$' then raise exception 'portal_invalid_application' using errcode='22023'; end if;
    perform bx1_portal.validate_application(payload->'details',payload->>'persona');
    select * into a from bx1_portal.applications where user_id=v_actor for update;
    if found then
      if a.status not in ('DRAFT','CHANGES_REQUIRED','REJECTED') or a.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_application' using errcode='23514'; end if;
      update bx1_portal.applications set persona=payload->>'persona',status='SUBMITTED',revision=revision+1,details=payload->'details',submitted_at=v_now,reviewed_at=null,reviewer_id=null,review_notes=null,review_checks='{}',approved_until=null where id=a.id returning * into a;
    else
      if (payload->>'expected_revision')::integer<>0 then raise exception 'portal_stale_application' using errcode='23514'; end if;
      insert into bx1_portal.applications(user_id,persona,status,details,reviewer_scope,submitted_at)
        values(v_actor,payload->>'persona','SUBMITTED',payload->'details','0ba2b126-bd85-4cfb-9a1d-83633c9def1e',v_now) returning * into a;
    end if;
    v_subject:=a.id; v_application:=a.id; v_summary:='Test onboarding application submitted for independent manual review.';
  elsif command='review_application' then
    perform bx1_portal.require_keys(payload,array['application_id','expected_revision','decision','notes','checks']);
    perform bx1_portal.require_text(payload,'notes',20,3000);
    if coalesce(payload->>'decision','') not in ('APPROVED','CHANGES_REQUIRED','REJECTED') or jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'portal_invalid_decision' using errcode='22023'; end if;
    perform bx1_portal.require_checks(payload->'checks',array['identity','ownership','screening','suitability'],payload->>'decision'='APPROVED');
    select * into a from bx1_portal.applications where id=(payload->>'application_id')::uuid for update;
    if not found or not bx1_portal.is_reviewer(a.reviewer_scope) or not bx1_portal.independent_of(a.user_id) then raise exception 'portal_review_denied' using errcode='42501'; end if;
    if a.status<>'SUBMITTED' or a.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_application' using errcode='23514'; end if;
    if payload->>'decision'='APPROVED' and a.persona='WEALTH_MANAGER' then
      insert into bx1_portal.organisations(application_id,owner_id,name,reviewer_scope) values(a.id,a.user_id,a.details->>'company_name',a.reviewer_scope) returning * into o;
      v_org:=o.id;
    end if;
    update bx1_portal.applications set status=payload->>'decision',revision=revision+1,reviewer_id=v_actor,reviewed_at=v_now,review_notes=payload->>'notes',review_checks=payload->'checks',approved_until=case when payload->>'decision'='APPROVED' then v_now+interval '30 days' end,organisation_id=coalesce(v_org,organisation_id) where id=a.id;
    v_subject:=a.id; v_application:=a.id; v_summary:='Manual TEST_ONLY onboarding decision: '||(payload->>'decision')||'. Approval, when given, expires after 30 days and is not provider verification.';
  elsif command='create_product' then
    perform bx1_portal.require_keys(payload,array['organisation_id','terms']);
    v_org:=(payload->>'organisation_id')::uuid;
    if not bx1_portal.is_operator(v_org) then raise exception 'portal_operator_denied' using errcode='42501'; end if;
    perform bx1_portal.validate_terms(payload->'terms');
    insert into bx1_portal.products(organisation_id,created_by,terms,terms_hash,cap_units,unit_price_minor,minimum_units)
      values(v_org,v_actor,payload->'terms',encode(sha256(convert_to((payload->'terms')::text,'UTF8')),'hex'),(payload#>>'{terms,cap_units}')::numeric,(payload#>>'{terms,unit_price_minor}')::numeric,(payload#>>'{terms,minimum_units}')::numeric) returning * into p;
    v_subject:=p.id; v_summary:='Typed test product draft created. No assets or tokens issued.';
  elsif command in ('save_product','submit_product','review_product','publish_product','subscribe') then
    if command='save_product' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms']);
    elsif command='review_product' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','decision','notes','checks']);
    elsif command='subscribe' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms_hash','units','accepted_documents','accepted_risks']);
    else perform bx1_portal.require_keys(payload,array['product_id','expected_revision']); end if;
    select * into p from bx1_portal.products where id=(payload->>'product_id')::uuid for update;
    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;
    select * into o from bx1_portal.organisations where id=p.organisation_id;
    if command='review_product' then
      if not bx1_portal.is_reviewer(o.reviewer_scope) or not bx1_portal.independent_of(p.created_by) or not bx1_portal.independent_of(o.owner_id) or not bx1_portal.organisation_active(o.id) then raise exception 'portal_review_denied' using errcode='42501'; end if;
    elsif command='subscribe' then
      if not bx1_portal.is_eligible(p.terms) or not bx1_portal.organisation_active(o.id) or not bx1_portal.independent_of(o.owner_id) then raise exception 'portal_investor_denied' using errcode='42501'; end if;
    elsif not bx1_portal.is_operator(o.id) then raise exception 'portal_operator_denied' using errcode='42501'; end if;
    if jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' or p.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_product' using errcode='23514'; end if;
    v_subject:=p.id; v_org:=p.organisation_id;
    if command='save_product' then
      if p.status not in ('DRAFT','CHANGES_REQUIRED') then raise exception 'portal_terms_locked' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(payload->'terms');
      update bx1_portal.products set terms=payload->'terms',terms_hash=encode(sha256(convert_to((payload->'terms')::text,'UTF8')),'hex'),cap_units=(payload#>>'{terms,cap_units}')::numeric,unit_price_minor=(payload#>>'{terms,unit_price_minor}')::numeric,minimum_units=(payload#>>'{terms,minimum_units}')::numeric,revision=revision+1,status='DRAFT',reviewer_id=null,review_notes=null,reviewed_at=null,review_checks='{}' where id=p.id;
      v_summary:='Test product draft terms revised; earlier review no longer applies.';
    elsif command='submit_product' then
      if p.status not in ('DRAFT','CHANGES_REQUIRED') then raise exception 'portal_invalid_product_state' using errcode='23514'; end if;
      update bx1_portal.products set status='IN_REVIEW',revision=revision+1 where id=p.id;
      v_summary:='Test offering submitted for independent compliance review.';
    elsif command='review_product' then
      perform bx1_portal.require_text(payload,'notes',20,3000);
      if coalesce(payload->>'decision','') not in ('APPROVED','CHANGES_REQUIRED') or p.status<>'IN_REVIEW' then raise exception 'portal_invalid_product_state' using errcode='23514'; end if;
      perform bx1_portal.require_checks(payload->'checks',array['issuer','terms','disclosures','eligibility'],payload->>'decision'='APPROVED');
      update bx1_portal.products set status=payload->>'decision',revision=revision+1,reviewer_id=v_actor,review_notes=payload->>'notes',reviewed_at=v_now,review_checks=payload->'checks' where id=p.id;
      v_summary:='Independent test offering review: '||(payload->>'decision')||'.';
    elsif command='publish_product' then
      if p.status<>'APPROVED' or p.reviewer_id is null then raise exception 'portal_approval_required' using errcode='23514'; end if;
      update bx1_portal.products set status='PUBLISHED',revision=revision+1,published_at=v_now where id=p.id;
      v_summary:='Approved test offering published to eligible investors.';
    else
      if p.status<>'PUBLISHED' or payload->>'terms_hash' is distinct from p.terms_hash or payload->'accepted_documents' is distinct from 'true'::jsonb or payload->'accepted_risks' is distinct from 'true'::jsonb then raise exception 'portal_terms_acceptance_required' using errcode='23514'; end if;
      v_units:=bx1_portal.positive(payload->'units');
      if v_units<p.minimum_units or p.reserved_units+v_units>p.cap_units then raise exception 'portal_capacity_unavailable' using errcode='23514'; end if;
      insert into bx1_portal.subscriptions(product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor)
        values(p.id,v_actor,p.organisation_id,p.revision,p.terms_hash,p.terms,true,true,v_units,v_units*p.unit_price_minor) returning * into s;
      update bx1_portal.products set reserved_units=reserved_units+v_units where id=p.id;
      v_subject:=s.id; v_investor:=v_actor; v_summary:='Test subscription reserved; awaiting funding. No cash received, holding, or token issued.';
    end if;
  elsif command='cancel_subscription' then
    perform bx1_portal.require_keys(payload,array['subscription_id']);
    -- Product lock precedes subscription lock, matching the capacity claim order.
    select * into s from bx1_portal.subscriptions where id=(payload->>'subscription_id')::uuid and investor_id=v_actor;
    if not found then raise exception 'portal_subscription_denied' using errcode='42501'; end if;
    perform id from bx1_portal.products where id=s.product_id for update;
    select * into s from bx1_portal.subscriptions where id=s.id for update;
    if s.status<>'AWAITING_FUNDING' then raise exception 'portal_subscription_not_cancellable' using errcode='23514'; end if;
    update bx1_portal.subscriptions set status='CANCELLED',cancelled_at=v_now where id=s.id;
    update bx1_portal.products set reserved_units=reserved_units-s.units where id=s.product_id;
    v_subject:=s.id; v_org:=s.organisation_id; v_investor:=v_actor; v_summary:='Unfunded test subscription cancelled; reserved capacity released.';
  else raise exception 'portal_unknown_command' using errcode='22023'; end if;
  insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,request_key,command,payload);
  insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)
    values(v_subject,v_application,v_org,v_investor,command,v_actor,v_summary);
  return bx1_portal.read_state();
end $$;

create function bx1_portal.immutable_record() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'portal_history_immutable' using errcode='23514'; end $$;
create trigger bx1_portal_requests_immutable before update or delete on bx1_portal.requests for each row execute function bx1_portal.immutable_record();
create trigger bx1_portal_events_immutable before update or delete on bx1_portal.events for each row execute function bx1_portal.immutable_record();

alter table bx1_portal.applications enable row level security;
alter table bx1_portal.organisations enable row level security;
alter table bx1_portal.products enable row level security;
alter table bx1_portal.subscriptions enable row level security;
alter table bx1_portal.requests enable row level security;
alter table bx1_portal.events enable row level security;
revoke all on all tables in schema bx1_portal from public, anon, authenticated, service_role;
revoke all on all functions in schema bx1_portal from public, anon, authenticated, service_role;
grant usage on schema bx1_portal to authenticated;
grant execute on function bx1_portal.read_state(),bx1_portal.execute_command(text,uuid,jsonb),bx1_portal.has_session(),bx1_portal.object_readable(text),bx1_portal.document_upload_allowed(text,text,jsonb) to authenticated;
create function public.bx1_portal_read() returns jsonb language sql security invoker set search_path='' as $$ select bx1_portal.read_state(); $$;
create function public.bx1_portal_command(command text,request_key uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select bx1_portal.execute_command(command,request_key,payload); $$;
revoke all on function public.bx1_portal_read(),public.bx1_portal_command(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bx1_portal_read(),public.bx1_portal_command(text,uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('bx1-portal-documents','bx1-portal-documents',false,4194304,array['application/pdf','image/png','image/jpeg']);
create policy bx1_portal_document_insert on storage.objects for insert to authenticated
  with check(bucket_id='bx1-portal-documents' and bx1_portal.document_upload_allowed(name,owner_id,metadata));
create policy bx1_portal_document_read on storage.objects for select to authenticated
  using(bucket_id='bx1-portal-documents' and bx1_portal.object_readable(name));
-- Restrictive bucket guards also constrain any pre-existing broad Storage policy.
create policy bx1_portal_document_insert_guard on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'bx1-portal-documents' or bx1_portal.document_upload_allowed(name,owner_id,metadata));
create policy bx1_portal_document_read_guard on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'bx1-portal-documents' or bx1_portal.object_readable(name));
create policy bx1_portal_document_no_overwrite on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'bx1-portal-documents') with check(bucket_id<>'bx1-portal-documents');
create policy bx1_portal_document_no_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'bx1-portal-documents');
create trigger bx1_portal_stored_document_guard before insert or update or delete on storage.objects
  for each row execute function bx1_portal.guard_stored_document();
-- Evidence retirement/quota reset is a separate governed lifecycle; deliberately
-- not exposed as a customer delete or an undocumented metadata mutation.
