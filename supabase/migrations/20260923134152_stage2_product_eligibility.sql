-- Stage 2: one product-specific investor decision per account and product.
-- Apply after the canonical entry/admission definitions. The current scoped
-- writer may be the authority bridge or the funding wrapper. Both are retained
-- internally, never left as a second authenticated writer. MAIN remains sealed.
do $$ begin
  if pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entry_manual_review_enabled()') is null then
    raise exception 'product_eligibility_entry_baseline_required' using errcode='55000';
  end if;
end $$;

create table bx1_portal.product_eligibility_cases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  investment_account_id uuid not null,
  holder_user_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  application_revision integer not null check(application_revision>0),
  product_revision integer not null check(product_revision>0),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  revision integer not null default 1 check(revision>0),
  status text not null default 'SUBMITTED' check(status in ('SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED','REVOKED')),
  investor_statement text not null check(char_length(investor_statement) between 20 and 2000 and investor_statement=btrim(investor_statement)),
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete restrict,
  review_notes text,
  review_checks jsonb not null default '{}'::jsonb check(pg_catalog.jsonb_typeof(review_checks)='object'),
  approved_until timestamptz,
  provider_mode text not null default 'MANUAL_TEST_REVIEW' check(provider_mode='MANUAL_TEST_REVIEW'),
  unique(investment_account_id,product_id),
  foreign key(investment_account_id,holder_user_id) references bx1_portal.investment_accounts(id,holder_user_id) on delete restrict,
  check(reviewer_id is null or reviewer_id<>holder_user_id),
  check((status='APPROVED')=(approved_until is not null)),
  check(approved_until is null or (reviewed_at is not null and approved_until>reviewed_at))
);
create index bx1_product_eligibility_reviewer_queue on bx1_portal.product_eligibility_cases(organisation_id,status,submitted_at,id);
create index bx1_product_eligibility_holder on bx1_portal.product_eligibility_cases(holder_user_id,submitted_at,id);

create table bx1_portal.product_eligibility_receipts (
  case_id uuid not null references bx1_portal.product_eligibility_cases(id) on delete restrict,
  case_revision integer not null check(case_revision>0),
  action text not null check(action in ('request_product_eligibility','review_product_eligibility','revoke_product_eligibility')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  command_payload jsonb not null check(pg_catalog.jsonb_typeof(command_payload)='object'),
  application_revision integer not null check(application_revision>0),
  product_revision integer not null check(product_revision>0),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  status_after text not null check(status_after in ('SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED','REVOKED')),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(case_id,case_revision)
);
create trigger bx1_product_eligibility_receipt_immutable before update or delete on bx1_portal.product_eligibility_receipts
  for each row execute function bx1_portal.immutable_record();
alter table bx1_portal.product_eligibility_cases enable row level security;
alter table bx1_portal.product_eligibility_receipts enable row level security;
revoke all on bx1_portal.product_eligibility_cases,bx1_portal.product_eligibility_receipts from public,anon,authenticated,service_role;

-- This is an evidence-state predicate, not an access-control entry point. The
-- caller is separately checked by read_scoped/execute_scoped and cannot invoke
-- this private helper directly. It fails closed after any upstream expiry,
-- suspension or exact offering-revision/hash change.
create function bx1_portal.product_eligibility_current(target_case uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_eligibility_cases e
    join bx1_portal.investment_accounts i on i.id=e.investment_account_id and i.holder_user_id=e.holder_user_id
    join bx1_portal.applications a on a.id=i.application_id and a.user_id=e.holder_user_id
    join bx1_portal.products p on p.id=e.product_id and p.organisation_id=e.organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    where e.id=target_case and e.status='APPROVED' and e.approved_until>clock_timestamp()
      and e.product_revision=p.revision and e.terms_hash=p.terms_hash and p.status='PUBLISHED'
      and i.status='ACTIVE' and i.kind='INDIVIDUAL'
      and a.persona='INVESTOR' and a.status='APPROVED' and a.approved_until>clock_timestamp()
      and e.application_revision=a.revision
      and o.reviewer_scope=a.reviewer_scope
      and a.details->>'investor_type'='INDIVIDUAL'
      and p.terms->'eligible_countries' ? (a.details->>'country')
      and p.terms->'eligible_investor_types' ? (a.details->>'investor_type')
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.entry_manual_review_enabled());
$$;

-- Reuse whichever scoped implementation is effective in this environment.
-- The old function OIDs become owner-only; the public invokers are rebound
-- below to the new names, so no authenticated legacy subscribe route remains.
alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_eligibility;
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_eligibility;

create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; cases jsonb; visible_events jsonb;
begin
  result:=bx1_portal.read_scoped_pre_eligibility(c);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',e.id,'investment_account_id',e.investment_account_id,'holder_user_id',e.holder_user_id,
    'product_id',e.product_id,'product_name',p.terms->>'name','organisation_id',e.organisation_id,
    'account_kind',i.kind,'application_revision',e.application_revision,
    'product_revision',e.product_revision,'terms_hash',e.terms_hash,
    'revision',e.revision,'status',e.status,'investor_statement',e.investor_statement,
    'submitted_at',e.submitted_at,'reviewed_at',e.reviewed_at,'reviewer_id',e.reviewer_id,
    'review_notes',e.review_notes,'review_checks',e.review_checks,'approved_until',e.approved_until,
    'provider_mode',e.provider_mode,'effective',bx1_portal.product_eligibility_current(e.id),
    'can_decide',e.status='SUBMITTED' and o.reviewer_scope=a.reviewer_scope
      and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
      and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)
      and bx1_portal.independent_of(e.holder_user_id)
      and bx1_portal.independent_of(o.owner_id) and bx1_portal.independent_of(p.created_by),
    'can_revoke',e.status='APPROVED' and o.reviewer_scope=a.reviewer_scope
      and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
      and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)
      and bx1_portal.independent_of(e.holder_user_id)
      and bx1_portal.independent_of(o.owner_id) and bx1_portal.independent_of(p.created_by),
    'can_approve',e.status='SUBMITTED' and o.reviewer_scope=a.reviewer_scope
      and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
      and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)
      and bx1_portal.independent_of(e.holder_user_id)
      and bx1_portal.independent_of(o.owner_id) and bx1_portal.independent_of(p.created_by)
      and e.application_revision=a.revision and e.product_revision=p.revision and e.terms_hash=p.terms_hash
      and i.status='ACTIVE' and i.kind='INDIVIDUAL'
      and a.status='APPROVED' and a.approved_until>clock_timestamp()
      and a.details->>'investor_type'='INDIVIDUAL'
      and p.terms->'eligible_countries' ? (a.details->>'country')
      and p.terms->'eligible_investor_types' ? (a.details->>'investor_type')
      and p.status='PUBLISHED' and bx1_portal.current_product_organisation(o.id),
    'investor_application',case when o.reviewer_scope=a.reviewer_scope
      and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
      and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)
      then pg_catalog.jsonb_build_object('id',a.id,'revision',a.revision,'status',a.status,
        'approved_until',a.approved_until,'details',a.details) else null end)
    order by e.submitted_at,e.id),'[]'::jsonb) into cases
  from bx1_portal.product_eligibility_cases e
  join bx1_portal.products p on p.id=e.product_id
  join bx1_portal.organisations o on o.id=e.organisation_id
  join bx1_portal.investment_accounts i on i.id=e.investment_account_id
  join bx1_portal.applications a on a.id=i.application_id
  where (e.holder_user_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
    or (o.reviewer_scope=a.reviewer_scope
      and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
      and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id));
  -- The pre-eligibility reader exposes generic events by product scope. If a
  -- reviewer appointment later diverges, remove this case's event metadata as
  -- well as its private statement from that reader's result.
  select coalesce(pg_catalog.jsonb_agg(ev.item order by ev.ordinality),'[]'::jsonb) into visible_events
  from pg_catalog.jsonb_array_elements(result->'events') with ordinality ev(item,ordinality)
  where coalesce(ev.item->>'kind','') not in
      ('request_product_eligibility','review_product_eligibility','revoke_product_eligibility')
    or exists(select 1 from pg_catalog.jsonb_array_elements(cases) as visible_case(item)
      where visible_case.item->>'id'=ev.item->>'subject_id');
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'product_eligibility_context_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_set(pg_catalog.jsonb_set(result,'{events}',visible_events),'{product_eligibility}',cases);
end $$;

create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); e bx1_portal.product_eligibility_cases; i bx1_portal.investment_accounts;
  a bx1_portal.applications; p bx1_portal.products; o bx1_portal.organisations;
  existing bx1_portal.scoped_requests; account_id uuid; expected integer; v_now timestamptz; decision text; manual_scope uuid;
begin
  if action not in ('request_product_eligibility','review_product_eligibility','revoke_product_eligibility','subscribe') then
    return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body);
  end if;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'product_eligibility_context_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then raise exception 'product_eligibility_invalid_command' using errcode='22023'; end if;
  -- The same actor lock namespace as entry, authority and funding commands.
  perform bx1_portal.entry_lock_actor();
  -- A role or native-organisation revocation must either finish before this
  -- command rechecks authority, or wait until the command commits. The actor
  -- lock above deliberately does not lock these separate authority rows.
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=actor
      and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
  -- Disabling the TEST-only manual review route cannot overtake a business
  -- write that was authorised under it. MAIN's sealed route stays sealed.
  select reviewer_scope into manual_scope from bx1_portal.entry_configuration where singleton for share;
  if manual_scope is not null then
    perform id from public.bx1_organisations where id=manual_scope for share;
  end if;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'product_eligibility_context_changed' using errcode='42501'; end if;
  select * into existing from bx1_portal.scoped_requests r where r.actor_id=actor and r.request_key=key;
  if found then
    if existing.operating_context is distinct from c or existing.command is distinct from action or existing.payload is distinct from body then
      raise exception 'product_eligibility_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key) then
    raise exception 'product_eligibility_prior_key_conflict' using errcode='23505'; end if;
  if action='subscribe' then
    account_id:=(body->>'investment_account_id')::uuid;
    select * into e from bx1_portal.product_eligibility_cases x
      where x.investment_account_id=account_id and x.product_id=(body->>'product_id')::uuid
        and x.holder_user_id=actor for share;
    if e.id is not null then
      select * into i from bx1_portal.investment_accounts where id=e.investment_account_id for share;
      select * into a from bx1_portal.applications where id=i.application_id for share;
      select * into p from bx1_portal.products where id=e.product_id for share;
      select * into o from bx1_portal.organisations where id=e.organisation_id for share;
      perform id from bx1_portal.applications where id=o.application_id for share;
    end if;
    if not found or bx1_portal.product_eligibility_current(e.id) is not true
      or bx1_portal.account_usable(c,account_id) is not true
      or bx1_portal.entry_manual_review_enabled() is not true then
      raise exception 'product_eligibility_approval_required' using errcode='42501'; end if;
    -- The held case SHARE lock prevents a concurrent decision or revocation from
    -- committing between this gate and the underlying capacity reservation.
    perform bx1_portal.execute_scoped_pre_eligibility(c,action,key,body);
    if bx1_portal.product_eligibility_current(e.id) is not true
      or bx1_portal.account_usable(c,account_id) is not true
      or bx1_portal.entry_manual_review_enabled() is not true then
      raise exception 'product_eligibility_expired_after_wait' using errcode='42501'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if bx1_portal.entry_manual_review_enabled() is not true then raise exception 'product_eligibility_manual_route_unavailable' using errcode='55000'; end if;
  if action='request_product_eligibility' then
    perform bx1_portal.require_keys(body,array['product_id','investment_account_id','expected_revision','investor_statement']);
    perform bx1_portal.require_text(body,'investor_statement',20,2000);
    if c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor' then raise exception 'product_eligibility_investor_context_required' using errcode='42501'; end if;
    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'product_eligibility_invalid_revision' using errcode='22023'; end if;
    expected:=(body->>'expected_revision')::integer;
    account_id:=(body->>'investment_account_id')::uuid;
    select * into i from bx1_portal.investment_accounts where id=account_id and holder_user_id=actor for share;
    select * into a from bx1_portal.applications where id=i.application_id for share;
    select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for share;
    if i.id is null or p.id is null or p.status<>'PUBLISHED' or bx1_portal.account_usable(c,i.id) is not true
      or bx1_portal.scoped_product_visible(c,p.id) is not true then raise exception 'product_eligibility_request_denied' using errcode='42501'; end if;
    select * into o from bx1_portal.organisations where id=p.organisation_id for share;
    perform id from bx1_portal.applications where id=o.application_id for share;
    if o.reviewer_scope is distinct from a.reviewer_scope
      or bx1_portal.independent_of(o.owner_id) is not true
      or bx1_portal.independent_of(p.created_by) is not true then
      raise exception 'product_eligibility_conflict' using errcode='42501'; end if;
    select * into e from bx1_portal.product_eligibility_cases x
      where x.investment_account_id=i.id and x.product_id=p.id for update;
    v_now:=clock_timestamp();
    if e.id is null then
      if expected<>0 then raise exception 'product_eligibility_stale_case' using errcode='23514'; end if;
      insert into bx1_portal.product_eligibility_cases(investment_account_id,holder_user_id,product_id,organisation_id,application_revision,
        product_revision,terms_hash,investor_statement,submitted_at)
        values(i.id,actor,p.id,p.organisation_id,a.revision,p.revision,p.terms_hash,body->>'investor_statement',v_now) returning * into e;
    else
      if e.holder_user_id<>actor or e.revision<>expected or e.status='REVOKED'
        or (e.status='SUBMITTED' and e.application_revision=a.revision and e.product_revision=p.revision and e.terms_hash=p.terms_hash)
        or (e.status='APPROVED' and bx1_portal.product_eligibility_current(e.id)) then
        raise exception 'product_eligibility_stale_case' using errcode='23514'; end if;
      update bx1_portal.product_eligibility_cases set application_revision=a.revision,product_revision=p.revision,terms_hash=p.terms_hash,
        investor_statement=body->>'investor_statement',status='SUBMITTED',revision=revision+1,
        submitted_at=v_now,reviewed_at=null,reviewer_id=null,review_notes=null,review_checks='{}'::jsonb,approved_until=null
        where id=e.id returning * into e;
    end if;
  elsif action='review_product_eligibility' then
    perform bx1_portal.require_keys(body,array['eligibility_case_id','expected_revision','decision','notes','checks']);
    perform bx1_portal.require_text(body,'notes',20,3000);
    decision:=body->>'decision';
    if coalesce(decision,'') not in ('APPROVED','CHANGES_REQUIRED','REJECTED')
      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'product_eligibility_invalid_decision' using errcode='22023'; end if;
    perform bx1_portal.require_checks(body->'checks',array['identity','product_fit','restrictions','source_of_funds'],decision='APPROVED');
    select * into e from bx1_portal.product_eligibility_cases x where x.id=(body->>'eligibility_case_id')::uuid for update;
    if e.id is null or e.status<>'SUBMITTED' or e.revision<>(body->>'expected_revision')::integer then
      raise exception 'product_eligibility_stale_case' using errcode='23514'; end if;
    select * into p from bx1_portal.products where id=e.product_id for share;
    select * into o from bx1_portal.organisations where id=e.organisation_id for share;
    select * into i from bx1_portal.investment_accounts where id=e.investment_account_id for share;
    select * into a from bx1_portal.applications where id=i.application_id for share;
    -- The product's appointed reviewer can be revoked independently of a
    -- native membership. Lock all bindings, not only the currently ACTIVE one,
    -- so adding or changing a binding follows the prior authority lock order.
    perform id from bx1_portal.organisation_authority_bindings
      where product_organisation_id=o.id order by id for share;
    if a.organisation_id is not null and a.organisation_id<>o.id then
      perform id from bx1_portal.organisation_authority_bindings
        where product_organisation_id=a.organisation_id order by id for share;
    end if;
    perform id from bx1_portal.applications where id=o.application_id for share;
    if o.reviewer_scope is distinct from a.reviewer_scope
      or bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id) is not true
      or bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id) is not true
      or bx1_portal.independent_of(e.holder_user_id) is not true
      or bx1_portal.independent_of(o.owner_id) is not true
      or bx1_portal.independent_of(p.created_by) is not true then
      raise exception 'product_eligibility_reviewer_denied' using errcode='42501'; end if;
    if decision='APPROVED' and (bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id) is not true
      or p.status<>'PUBLISHED' or e.application_revision<>a.revision
      or e.product_revision<>p.revision or e.terms_hash<>p.terms_hash
      or i.status<>'ACTIVE' or a.status<>'APPROVED' or a.approved_until<=clock_timestamp()
      or a.details->>'investor_type' is distinct from 'INDIVIDUAL'
      or not(p.terms->'eligible_countries' ? (a.details->>'country'))
      or not(p.terms->'eligible_investor_types' ? (a.details->>'investor_type'))
      or bx1_portal.current_product_organisation(o.id) is not true) then
      raise exception 'product_eligibility_source_not_current' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    if decision='APPROVED' and a.approved_until<=v_now then raise exception 'product_eligibility_source_expired' using errcode='42501'; end if;
    update bx1_portal.product_eligibility_cases set status=decision,revision=revision+1,reviewed_at=v_now,
      reviewer_id=actor,review_notes=body->>'notes',review_checks=body->'checks',
      approved_until=case when decision='APPROVED' then least(a.approved_until,v_now+interval '30 days') end
      where id=e.id returning * into e;
  else
    perform bx1_portal.require_keys(body,array['eligibility_case_id','expected_revision','reason']);
    perform bx1_portal.require_text(body,'reason',20,2000);
    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'product_eligibility_invalid_revision' using errcode='22023'; end if;
    select * into e from bx1_portal.product_eligibility_cases x where x.id=(body->>'eligibility_case_id')::uuid for update;
    if e.id is null or e.status<>'APPROVED' or e.revision<>(body->>'expected_revision')::integer then
      raise exception 'product_eligibility_stale_case' using errcode='23514'; end if;
    select * into p from bx1_portal.products where id=e.product_id for share;
    select * into o from bx1_portal.organisations where id=e.organisation_id for share;
    select * into i from bx1_portal.investment_accounts where id=e.investment_account_id for share;
    select * into a from bx1_portal.applications where id=i.application_id for share;
    perform id from bx1_portal.organisation_authority_bindings
      where product_organisation_id=o.id order by id for share;
    if a.organisation_id is not null and a.organisation_id<>o.id then
      perform id from bx1_portal.organisation_authority_bindings
        where product_organisation_id=a.organisation_id order by id for share;
    end if;
    if o.reviewer_scope is distinct from a.reviewer_scope
      or bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id) is not true
      or bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id) is not true
      or bx1_portal.independent_of(e.holder_user_id) is not true
      or bx1_portal.independent_of(o.owner_id) is not true
      or bx1_portal.independent_of(p.created_by) is not true then
      raise exception 'product_eligibility_reviewer_denied' using errcode='42501'; end if;
    decision:='REVOKED';
    update bx1_portal.product_eligibility_cases set status='REVOKED',revision=revision+1,
      reviewed_at=clock_timestamp(),reviewer_id=actor,review_notes=body->>'reason',approved_until=null
      where id=e.id returning * into e;
  end if;
  insert into bx1_portal.product_eligibility_receipts(case_id,case_revision,action,actor_id,operating_context,
    command_payload,application_revision,product_revision,terms_hash,status_after)
    values(e.id,e.revision,action,actor,c,body,e.application_revision,e.product_revision,e.terms_hash,e.status);
  insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)
    values(e.id,i.application_id,e.organisation_id,e.holder_user_id,action,actor,
      case when action='request_product_eligibility' then 'Product-specific test eligibility requested; no right to subscribe granted.'
        else 'Independent product-specific synthetic eligibility decision: '||decision||'.' end);
  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'product_eligibility_authority_expired' using errcode='42501'; end if;
  if action='request_product_eligibility' and bx1_portal.account_usable(c,e.investment_account_id) is not true then
    raise exception 'product_eligibility_account_expired' using errcode='42501'; end if;
  if action in ('review_product_eligibility','revoke_product_eligibility')
    and (o.reviewer_scope is distinct from a.reviewer_scope
    or bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id) is not true
    or bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id) is not true
    or bx1_portal.independent_of(e.holder_user_id) is not true
    or bx1_portal.independent_of(o.owner_id) is not true
    or bx1_portal.independent_of(p.created_by) is not true) then
    raise exception 'product_eligibility_reviewer_expired' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
    values(actor,key,c,action,body);
  return bx1_portal.read_scoped(c);
end $$;

-- Rebind the public SQL invokers to the NEW function OIDs. A CREATE OR REPLACE
-- preserves each environment's existing public RPC ACL; it does not admit MAIN.
create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;
create or replace function bx1_portal.read_state() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=bx1_portal.read_scoped('{"mode":"APPLICANT"}'::jsonb);
  return pg_catalog.jsonb_set(result,'{actor,can_review}',pg_catalog.to_jsonb(exists(select 1 from public.bx1_memberships m
    where m.user_id=auth.uid() and m.role='ComplianceOfficer' and m.status='ACTIVE'
      and bx1_portal.valid_operating_context(pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role',m.role)))));
end $$;

-- Preserve admitted TEST grants and MAIN's sealed absence of business grants.
-- The inherited grants on both renamed functions are then removed completely.
do $$ begin
  revoke all on function bx1_portal.product_eligibility_current(uuid),bx1_portal.read_scoped(jsonb),
    bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role;
  if pg_catalog.has_function_privilege('authenticated','bx1_portal.read_scoped_pre_eligibility(jsonb)','EXECUTE') then
    grant execute on function bx1_portal.read_scoped(jsonb) to authenticated;
  end if;
  if pg_catalog.has_function_privilege('authenticated','bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)','EXECUTE') then
    grant execute on function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) to authenticated;
  end if;
  revoke all on function bx1_portal.read_scoped_pre_eligibility(jsonb),
    bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role;
end $$;
