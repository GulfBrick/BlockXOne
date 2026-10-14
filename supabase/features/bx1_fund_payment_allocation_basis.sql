-- Additive TEST-only ordering correction. A reserved subscription is proposed
-- consideration, not permission to pay. The appointed issuer approves its exact
-- allocation basis before any funding instruction. Final funded allocation,
-- wallet recheck, transfer-agent approval and issuance remain separate.
-- Definitions only: no people, roles, approvals, routes or holdings are seeded.

do $preflight$
begin
  if not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regclass('bx1_portal.fund_payment_allocation_bases') is not null
    or pg_catalog.to_regprocedure('bx1_portal.fund_command(jsonb,text,uuid,jsonb)') is null then
    raise exception 'fund_payment_basis_install_preflight' using errcode='55000'; end if;
end $preflight$;

create table bx1_portal.fund_payment_allocation_bases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subscription_id uuid not null references bx1_portal.subscriptions(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  investment_account_id uuid not null references bx1_portal.investment_accounts(id) on delete restrict,
  product_revision integer not null check(product_revision>0),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  units_base numeric(78,0) not null check(units_base>0),
  amount_base_units numeric(78,0) not null check(amount_base_units>0),
  security_unit_decimals integer not null check(security_unit_decimals between 0 and 18),
  basis_hash text not null check(basis_hash ~ '^[0-9a-f]{64}$'),
  revision integer not null default 1 check(revision>0),
  status text not null default 'REQUESTED' check(status in ('REQUESTED','APPROVED')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_person_id uuid not null,
  requested_context jsonb not null,
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_person_id uuid,
  issuer_authority_id uuid references bx1_portal.fund_authorities(id) on delete restrict,
  approved_context jsonb,
  approved_at timestamptz,
  approved_until timestamptz,
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  unique(subscription_id,revision),
  check((status='APPROVED')=(approved_by is not null and approved_person_id is not null
    and issuer_authority_id is not null and approved_context is not null
    and approved_at is not null and approved_until is not null)),
  check(approved_by is null or (approved_by<>requested_by and approved_person_id<>requested_person_id))
);
alter table bx1_portal.fund_payment_allocation_bases enable row level security;
revoke all on table bx1_portal.fund_payment_allocation_bases from public,anon,authenticated,service_role,bx1_fund_execution_worker;
-- Nullable for retained historical attempts; only new payment preparations are
-- stamped by the trigger below. An old approval is never invented for history.
alter table bx1_portal.fund_payment_intents
  add column allocation_basis_id uuid references bx1_portal.fund_payment_allocation_bases(id) on delete restrict,
  add column allocation_basis_revision integer check(allocation_basis_revision>0),
  add constraint fund_payment_basis_receipt_pair check((allocation_basis_id is null)=(allocation_basis_revision is null));

create function bx1_portal.fund_payment_basis_hash(sid uuid) returns text
language sql volatile security definer set search_path='' as $$
  select bx1_portal.fund_digest(pg_catalog.jsonb_build_object('subscription',s.id,'product',s.product_id,
    'offering',s.offering_revision_id,'account',s.investment_account_id,'investor',s.investor_id,
    'product_revision',s.product_revision,'terms',s.terms_hash,'accepted_terms',s.accepted_terms,
    'units_base',s.units*pg_catalog.power(10::numeric,m.security_unit_decimals),'security_decimals',m.security_unit_decimals,
    'amount_base_units',s.amount_minor,'currency','TST','settlement_decimals',6,
    'manifest',m.id,'class',m.class_id,'policy',sp.id,'authority_epoch',sp.authority_epoch))
  from bx1_portal.subscriptions s join bx1_portal.fund_release_manifests m
    on m.product_id=s.product_id and m.offering_revision_id=s.offering_revision_id and m.status='ADMITTED'
  join bx1_portal.fund_signer_policies sp on sp.manifest_id=m.id and sp.status='ADMITTED'
  where s.id=sid;
$$;
create function bx1_portal.fund_payment_basis_source_current(sid uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.subscriptions s
    join bx1_portal.products p on p.id=s.product_id
    join bx1_portal.investment_accounts i on i.id=s.investment_account_id and i.holder_user_id=s.investor_id
    join bx1_portal.applications admission on admission.id=i.application_id and admission.user_id=s.investor_id
    join auth.users u on u.id=s.investor_id
    join bx1_portal.fund_release_manifests m on m.product_id=s.product_id and m.offering_revision_id=s.offering_revision_id
    join bx1_portal.fund_signer_policies sp on sp.manifest_id=m.id
    where s.id=sid and s.status='AWAITING_FUNDING' and s.accepted_documents and s.accepted_risks
      and s.accepted_terms->>'asset_type'='FUND' and s.accepted_terms->>'currency'='TST'
      and s.accepted_terms->>'settlement_decimals'='6' and s.terms_hash=p.terms_hash
      and s.offering_revision_id=p.current_offering_revision_id and s.units>0
      and s.amount_minor=s.units*(s.accepted_terms->>'unit_price_minor')::numeric
      and i.kind='INDIVIDUAL' and i.status='ACTIVE' and admission.persona='INVESTOR'
      and admission.status='APPROVED' and admission.approved_until>pg_catalog.clock_timestamp()
      and u.deleted_at is null and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
      and not exists(select 1 from public.bx1_profiles profile where profile.id=s.investor_id and profile.status<>'ACTIVE')
      and bx1_portal.fund_person(s.investor_id) is not null and bx1_portal.fund_manifest_current(m.id)
      and sp.status='ADMITTED' and sp.admitted_until>pg_catalog.clock_timestamp() and sp.authority_epoch=m.authority_epoch
      and bx1_portal.offering_technical_ready(s.offering_revision_id)
      and exists(select 1 from bx1_portal.product_eligibility_cases eligibility
        where eligibility.investment_account_id=i.id and eligibility.product_id=s.product_id
          and eligibility.offering_revision_id=s.offering_revision_id and bx1_portal.product_eligibility_current(eligibility.id)));
$$;
create function bx1_portal.fund_payment_basis_proposal_current(bid uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_payment_allocation_bases basis
    join bx1_portal.subscriptions s on s.id=basis.subscription_id
    where basis.id=bid and basis.product_id=s.product_id and basis.offering_revision_id=s.offering_revision_id
      and basis.investment_account_id=s.investment_account_id and basis.product_revision=s.product_revision
      and basis.terms_hash=s.terms_hash and basis.amount_base_units=s.amount_minor
      and basis.units_base=s.units*pg_catalog.power(10::numeric,basis.security_unit_decimals)
      and basis.requested_by=s.investor_id and bx1_portal.fund_person(basis.requested_by)=basis.requested_person_id
      and basis.basis_hash=bx1_portal.fund_payment_basis_hash(s.id)
      and bx1_portal.fund_payment_basis_source_current(s.id));
$$;
create function bx1_portal.fund_payment_basis_current(sid uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_payment_allocation_bases basis
    join bx1_portal.fund_authorities authority on authority.id=basis.issuer_authority_id
    where basis.subscription_id=sid and basis.status='APPROVED'
      and basis.revision=(select max(latest.revision) from bx1_portal.fund_payment_allocation_bases latest where latest.subscription_id=sid)
      and basis.approved_until>pg_catalog.clock_timestamp() and bx1_portal.fund_payment_basis_proposal_current(basis.id)
      and authority.role='IssuerFundManager' and authority.user_id=basis.approved_by
      and authority.person_id=basis.approved_person_id and authority.can_approve and bx1_portal.fund_authority_current(authority.id)
      and bx1_portal.entity_people_independent(basis.approved_by,basis.requested_by));
$$;
create function bx1_portal.fund_payment_basis_projection(c jsonb,sid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare basis bx1_portal.fund_payment_allocation_bases; s bx1_portal.subscriptions; current_basis boolean; source_hash text;
begin
  if bx1_portal.fund_order_visible(c,sid) is not true then return null; end if;
  select * into s from bx1_portal.subscriptions where id=sid;
  source_hash:=bx1_portal.fund_payment_basis_hash(sid);
  if source_hash is null then return null; end if;
  select * into basis from bx1_portal.fund_payment_allocation_bases where subscription_id=sid order by revision desc limit 1;
  current_basis:=bx1_portal.fund_payment_basis_current(sid);
  return pg_catalog.jsonb_build_object('id',basis.id,'revision',basis.revision,'basis_hash',coalesce(basis.basis_hash,source_hash),
    'status',case when basis.id is null then 'NOT_REQUESTED' when current_basis then 'APPROVED'
      when bx1_portal.fund_payment_basis_proposal_current(basis.id) and basis.status='REQUESTED' then 'REQUESTED' else 'NO_LONGER_CURRENT' end,
    'current',current_basis,'approved_at',basis.approved_at,'approved_until',basis.approved_until,
    'units_base',coalesce(basis.units_base,(select s.units*pg_catalog.power(10::numeric,m.security_unit_decimals)
      from bx1_portal.fund_release_manifests m where m.product_id=s.product_id and m.offering_revision_id=s.offering_revision_id and m.status='ADMITTED'))::numeric(78,0)::text,
    'amount_base_units',coalesce(basis.amount_base_units,s.amount_minor)::numeric(78,0)::text);
end $$;
create function bx1_portal.fund_payment_basis_intent_current(payment uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_payment_intents intent
    join bx1_portal.fund_payment_allocation_bases basis on basis.id=intent.allocation_basis_id
      and basis.subscription_id=intent.subscription_id and basis.revision=intent.allocation_basis_revision
    where intent.id=payment and basis.status='APPROVED' and basis.amount_base_units=intent.amount_base_units
      and basis.revision=(select max(latest.revision) from bx1_portal.fund_payment_allocation_bases latest where latest.subscription_id=intent.subscription_id)
      and bx1_portal.fund_payment_basis_current(intent.subscription_id));
$$;
create function bx1_portal.fund_payment_basis_stamp_intent() returns trigger
language plpgsql security definer set search_path='' as $$
declare basis bx1_portal.fund_payment_allocation_bases;
begin
  select * into basis from bx1_portal.fund_payment_allocation_bases where subscription_id=NEW.subscription_id
    order by revision desc limit 1 for share;
  if basis.id is null or bx1_portal.fund_payment_basis_current(NEW.subscription_id) is not true
    or basis.amount_base_units<>NEW.amount_base_units then
    raise exception 'fund_payment_basis_current_receipt_required' using errcode='23514'; end if;
  NEW.allocation_basis_id:=basis.id;
  NEW.allocation_basis_revision:=basis.revision;
  return NEW;
end $$;
create trigger fund_payment_basis_stamp_intent before insert on bx1_portal.fund_payment_intents
  for each row execute function bx1_portal.fund_payment_basis_stamp_intent();
create function bx1_portal.fund_payment_basis_actions(c jsonb,sid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare basis bx1_portal.fund_payment_allocation_bases; s bx1_portal.subscriptions;
  policy uuid; issuer uuid; requestable boolean; approvable boolean; result jsonb:='[]'::jsonb;
begin
  if bx1_portal.fund_order_visible(c,sid) is not true then return result; end if;
  select * into s from bx1_portal.subscriptions where id=sid;
  select * into basis from bx1_portal.fund_payment_allocation_bases where subscription_id=sid order by revision desc limit 1;
  select sp.id into policy from bx1_portal.fund_signer_policies sp join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
    where m.product_id=s.product_id and m.offering_revision_id=s.offering_revision_id and m.status='ADMITTED' and sp.status='ADMITTED';
  requestable:=s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor')
    and bx1_portal.fund_payment_basis_source_current(s.id) and bx1_portal.account_usable(c,s.investment_account_id)
    and not bx1_portal.fund_payment_basis_current(s.id)
    and (basis.id is null or bx1_portal.fund_payment_basis_proposal_current(basis.id) is not true or basis.status='APPROVED')
    and not exists(select 1 from bx1_portal.fund_payment_intents payment where payment.subscription_id=s.id and payment.claimed_at is not null)
    and not exists(select 1 from bx1_portal.funding_obligations obligation join bx1_portal.funding_references reference on reference.obligation_id=obligation.id where obligation.subscription_id=s.id);
  issuer:=bx1_portal.fund_authority(c,policy,'IssuerFundManager');
  approvable:=basis.id is not null and basis.status='REQUESTED' and bx1_portal.fund_payment_basis_proposal_current(basis.id)
    and issuer is not null and exists(select 1 from bx1_portal.fund_authorities authority where authority.id=issuer and authority.can_approve)
    and bx1_portal.entity_people_independent(auth.uid(),s.investor_id);
  if basis.id is null or bx1_portal.fund_payment_basis_proposal_current(basis.id) is not true
    or (basis.status='APPROVED' and bx1_portal.fund_payment_basis_current(s.id) is not true) then
    result:=result||pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_payment_allocation_basis',s.id,s.product_revision,
      'Submit reserved units for issuer approval','Investor',requestable,'ISSUER_ALLOCATION_BASIS_REQUIRED',
      pg_catalog.jsonb_build_object('subscription_id',s.id,'expected_basis_hash',bx1_portal.fund_payment_basis_hash(s.id))));
  elsif basis.status='REQUESTED' then
    result:=result||pg_catalog.jsonb_build_array(bx1_portal.fund_action('approve_fund_payment_allocation_basis',basis.id,basis.revision,
      'Approve the allocation basis before payment','IssuerFundManager',approvable,'CURRENT_ISSUER_ALLOCATION_APPROVAL_REQUIRED',
      pg_catalog.jsonb_build_object('basis_id',basis.id,'expected_revision',basis.revision)));
  end if;
  return result;
end $$;

create function bx1_portal.fund_payment_basis_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.subscriptions; basis bx1_portal.fund_payment_allocation_bases; issuer bx1_portal.fund_authorities;
  prior bx1_portal.scoped_requests; policy uuid; decimals integer; target uuid; expected_hash text; before_rev integer;
begin
  if action not in ('request_fund_payment_allocation_basis','approve_fund_payment_allocation_basis')
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_portal.fund_context(c,false) is not true or key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'fund_payment_basis_command_denied' using errcode='42501'; end if;
  if action='request_fund_payment_allocation_basis' then
    perform bx1_portal.require_keys(body,array['subscription_id','expected_basis_hash']);
    if body->>'expected_basis_hash' !~ '^[0-9a-f]{64}$' then raise exception 'fund_payment_basis_hash_invalid' using errcode='22023'; end if;
    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid;
  else
    perform bx1_portal.require_keys(body,array['basis_id','expected_revision']);
    select * into basis from bx1_portal.fund_payment_allocation_bases where id=(body->>'basis_id')::uuid;
    select * into s from bx1_portal.subscriptions where id=basis.subscription_id;
  end if;
  if s.id is null then raise exception 'fund_payment_basis_order_denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||auth.uid()::text,0));
  perform bx1_portal.fund_lock(c,s.product_id);
  perform bx1_portal.lock_entity_people(array[s.investor_id]);
  perform id from auth.users where id=s.investor_id for share;
  perform id from public.bx1_profiles where id=s.investor_id for share;
  select * into s from bx1_portal.subscriptions where id=s.id for update;
  perform id from bx1_portal.investment_accounts where id=s.investment_account_id for share;
  perform admission.id from bx1_portal.applications admission join bx1_portal.investment_accounts account on account.application_id=admission.id where account.id=s.investment_account_id for share of admission;
  perform id from bx1_portal.product_eligibility_cases where investment_account_id=s.investment_account_id and product_id=s.product_id and offering_revision_id=s.offering_revision_id for share;
  select * into prior from bx1_portal.scoped_requests where actor_id=auth.uid() and request_key=key;
  if prior.actor_id is not null then
    if prior.command is distinct from action or prior.payload is distinct from body or prior.operating_context is distinct from c then
      raise exception 'fund_payment_basis_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.fund_read(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=auth.uid() and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=auth.uid() and request_key=key) then
    raise exception 'fund_payment_basis_prior_key_conflict' using errcode='23505'; end if;
  if bx1_portal.fund_payment_basis_source_current(s.id) is not true then
    raise exception 'fund_payment_basis_source_changed' using errcode='23514'; end if;
  select sp.id,m.security_unit_decimals into policy,decimals from bx1_portal.fund_signer_policies sp
    join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where m.product_id=s.product_id
      and m.offering_revision_id=s.offering_revision_id and m.status='ADMITTED' and sp.status='ADMITTED';
  if action='request_fund_payment_allocation_basis' then
    if s.investor_id is distinct from auth.uid() or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor')
      or bx1_portal.account_usable(c,s.investment_account_id) is not true then
      raise exception 'fund_payment_basis_holder_required' using errcode='42501'; end if;
    expected_hash:=bx1_portal.fund_payment_basis_hash(s.id);
    if expected_hash is distinct from body->>'expected_basis_hash' then raise exception 'fund_payment_basis_order_changed' using errcode='23514'; end if;
    select * into basis from bx1_portal.fund_payment_allocation_bases where subscription_id=s.id order by revision desc limit 1 for update;
    if basis.id is not null and bx1_portal.fund_payment_basis_proposal_current(basis.id)
      and (basis.status='REQUESTED' or bx1_portal.fund_payment_basis_current(s.id)) then
      raise exception 'fund_payment_basis_already_requested' using errcode='23514'; end if;
    if exists(select 1 from bx1_portal.fund_payment_intents payment where payment.subscription_id=s.id and payment.claimed_at is not null)
      or exists(select 1 from bx1_portal.funding_obligations obligation join bx1_portal.funding_references reference on reference.obligation_id=obligation.id where obligation.subscription_id=s.id) then
      raise exception 'fund_payment_basis_existing_payment_recovery_required' using errcode='23514'; end if;
    before_rev:=coalesce(basis.revision,0);
    insert into bx1_portal.fund_payment_allocation_bases(subscription_id,product_id,offering_revision_id,investment_account_id,
      product_revision,terms_hash,units_base,amount_base_units,security_unit_decimals,basis_hash,revision,requested_by,requested_person_id,requested_context)
      values(s.id,s.product_id,s.offering_revision_id,s.investment_account_id,s.product_revision,s.terms_hash,
        s.units*pg_catalog.power(10::numeric,decimals),s.amount_minor,decimals,expected_hash,before_rev+1,
        auth.uid(),bx1_portal.fund_person(auth.uid()),c) returning * into basis;
  else
    select * into basis from bx1_portal.fund_payment_allocation_bases where id=basis.id for update;
    perform bx1_portal.funding_require_revision(basis.revision,body->'expected_revision');
    select * into issuer from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,policy,'IssuerFundManager');
    if basis.status<>'REQUESTED' or issuer.id is null or not issuer.can_approve or bx1_portal.fund_payment_basis_proposal_current(basis.id) is not true
      or basis.revision<>(select max(latest.revision) from bx1_portal.fund_payment_allocation_bases latest where latest.subscription_id=s.id)
      or bx1_portal.entity_people_independent(auth.uid(),basis.requested_by) is not true then
      raise exception 'fund_payment_basis_current_independent_issuer_required' using errcode='42501'; end if;
    before_rev:=basis.revision;
    update bx1_portal.fund_payment_allocation_bases set status='APPROVED',revision=revision+1,
      approved_by=auth.uid(),approved_person_id=issuer.person_id,issuer_authority_id=issuer.id,approved_context=c,
      approved_at=pg_catalog.clock_timestamp(),approved_until=issuer.valid_until where id=basis.id returning * into basis;
  end if;
  target:=basis.id;
  perform bx1_portal.fund_audit(s.product_id,target,null,action,c,before_rev,basis.revision,null,
    pg_catalog.jsonb_build_object('subscription_id',s.id,'basis_hash',basis.basis_hash,'units_base',basis.units_base::text,'amount_base_units',basis.amount_base_units::text));
  if bx1_portal.fund_context(c,false) is not true or bx1_portal.fund_payment_basis_proposal_current(target) is not true
    or (action='approve_fund_payment_allocation_basis' and (bx1_portal.fund_authority(c,policy,'IssuerFundManager') is distinct from issuer.id
      or bx1_portal.fund_payment_basis_current(s.id) is not true)) then
    raise exception 'fund_payment_basis_authority_expired_at_commit' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,command,payload,operating_context) values(auth.uid(),key,action,body,c);
  return bx1_portal.fund_read(c);
end $$;

create function bx1_portal.fund_payment_basis_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' or OLD.status<>'REQUESTED' or NEW.status<>'APPROVED' or NEW.revision<>OLD.revision+1
    or pg_catalog.to_jsonb(NEW)-array['status','revision','approved_by','approved_person_id','issuer_authority_id','approved_context','approved_at','approved_until']
      is distinct from pg_catalog.to_jsonb(OLD)-array['status','revision','approved_by','approved_person_id','issuer_authority_id','approved_context','approved_at','approved_until'] then
    raise exception 'fund_payment_basis_history_immutable' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger fund_payment_basis_history_immutable before update or delete on bx1_portal.fund_payment_allocation_bases
  for each row execute function bx1_portal.fund_payment_basis_guard();

-- Exact accepted TEST definitions and one-match cutpoints. Existing function
-- identities/ACLs stay intact; no alternate public command or finance writer.
do $cutover$
declare item record; original text; actual text; replacement text;
begin
  for item in select * from (values
    ('bx1_portal.fund_command(jsonb,text,uuid,jsonb)','033a4aceeddb51d3427deeb4ecf1c7f86913dbe0282744e414681dcbfc51dd9e',
      E'\nbegin\n', E'\nbegin\n  if action in (\'request_fund_payment_allocation_basis\',\'approve_fund_payment_allocation_basis\') then\n    return bx1_portal.fund_payment_basis_command(c,action,key,body); end if;\n'),
    ('bx1_portal.fund_order_projection(jsonb,uuid)','67d98df70e665222630404b850280ae7fb4515cfd867d6085a147f8ebbba1b8e',
      'and bx1_portal.offering_technical_ready(s.offering_revision_id)',
      'and bx1_portal.offering_technical_ready(s.offering_revision_id) and bx1_portal.fund_payment_basis_current(s.id)'),
    ('bx1_portal.fund_prepare_payment(jsonb,uuid,integer,text)','e2cc0959b5b9347fdd27d9e5e151f352697caa776bdd84a38e09982324fd6d70',
      'perform bx1_portal.fund_lock(c,s.product_id);',
      E'perform bx1_portal.fund_lock(c,s.product_id);\n  if bx1_portal.fund_payment_basis_current(s.id) is not true then raise exception \'fund_issuer_allocation_basis_required_before_payment\' using errcode=\'23514\'; end if;'),
    ('bx1_portal.fund_submit_payment(jsonb,uuid)','237196cc9a66d1cdcf1511bc0e5ed53df24762d113fe2456b0455007e83f8982',
      'perform bx1_portal.fund_lock(c,s.product_id);',
      E'perform bx1_portal.fund_lock(c,s.product_id);\n  if bx1_portal.fund_payment_basis_intent_current(p.id) is not true then raise exception \'fund_issuer_allocation_basis_changed_before_submission\' using errcode=\'23514\'; end if;'),
    ('bx1_portal.fund_allocation_current(uuid)','2edeb187a3c4ea277f2c68ea9f0f15b0c1420354da082cdfff9fcc96cef66ecb',
      'where a.id=target and s.status=''AWAITING_FUNDING''',
      'where a.id=target and bx1_portal.fund_payment_basis_current(s.id) and s.status=''AWAITING_FUNDING'''),
    ('bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)','cd2bd747d460eb4d0f39d0fd08eddfb3215b98c8ac60e77bc2a923bf577f38cb',
      E'  elsif action=\'open_funding_obligation\' then\n    if s.status',
      E'  elsif action=\'open_funding_obligation\' then\n    if s.accepted_terms->>\'asset_type\'=\'FUND\' and s.accepted_terms->>\'currency\'=\'TST\' and bx1_portal.fund_payment_basis_current(s.id) is not true then\n      raise exception \'fund_issuer_allocation_basis_required_before_instruction\' using errcode=\'23514\'; end if;\n    if s.status')
  ) as cuts(signature,source_hash,cutpoint,addition) loop
    select pg_catalog.pg_get_functiondef(p.oid),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') into original,actual
      from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(item.signature)
        and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
    if actual is distinct from item.source_hash or original is null
      or (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,item.cutpoint,'')))/pg_catalog.length(item.cutpoint)<>1 then
      raise exception 'fund_payment_basis_cutover_source_drift: %',item.signature using errcode='55000'; end if;
    replacement:=pg_catalog.replace(original,item.cutpoint,item.addition);
    if item.signature='bx1_portal.fund_prepare_payment(jsonb,uuid,integer,text)' then
      if (pg_catalog.length(replacement)-pg_catalog.length(pg_catalog.replace(replacement,'select * into p from bx1_portal.fund_payment_intents where obligation_id=o.id for update;','')))
        /pg_catalog.length('select * into p from bx1_portal.fund_payment_intents where obligation_id=o.id for update;')<>1 then
        raise exception 'fund_payment_basis_prepared_intent_cutpoint_drift' using errcode='55000'; end if;
      replacement:=pg_catalog.replace(replacement,'select * into p from bx1_portal.fund_payment_intents where obligation_id=o.id for update;',
        E'select * into p from bx1_portal.fund_payment_intents where obligation_id=o.id for update;\n  if p.id is not null and bx1_portal.fund_payment_basis_intent_current(p.id) is not true then\n    raise exception \'fund_existing_payment_basis_requires_recovery\' using errcode=\'23514\'; end if;');
    end if;
    if item.signature='bx1_portal.fund_command(jsonb,text,uuid,jsonb)' then
      if (pg_catalog.length(replacement)-pg_catalog.length(pg_catalog.replace(replacement,'or obligation.token_decimals<>6 or bx1_portal.funding_state(obligation.id)<>''RECONCILED''','')))
        /pg_catalog.length('or obligation.token_decimals<>6 or bx1_portal.funding_state(obligation.id)<>''RECONCILED''')<>1 then
        raise exception 'fund_payment_basis_final_allocation_cutpoint_drift' using errcode='55000'; end if;
      replacement:=pg_catalog.replace(replacement,'or obligation.token_decimals<>6 or bx1_portal.funding_state(obligation.id)<>''RECONCILED''',
        'or bx1_portal.fund_payment_basis_current(s.id) is not true or obligation.token_decimals<>6 or bx1_portal.funding_state(obligation.id)<>''RECONCILED''');
    end if;
    if item.signature='bx1_portal.fund_order_projection(jsonb,uuid)' then
      if (pg_catalog.length(replacement)-pg_catalog.length(pg_catalog.replace(replacement,'''issuance_operation_id'',(select id from bx1_portal.fund_operations where allocation_id=a.id),''actions'',actions);','')))
        /pg_catalog.length('''issuance_operation_id'',(select id from bx1_portal.fund_operations where allocation_id=a.id),''actions'',actions);')<>1 then
        raise exception 'fund_payment_basis_projection_cutpoint_drift' using errcode='55000'; end if;
      replacement:=pg_catalog.replace(replacement,
        '''issuance_operation_id'',(select id from bx1_portal.fund_operations where allocation_id=a.id),''actions'',actions);',
        '''issuance_operation_id'',(select id from bx1_portal.fund_operations where allocation_id=a.id),''payment_allocation_basis'',bx1_portal.fund_payment_basis_projection(c,s.id),''actions'',bx1_portal.fund_payment_basis_actions(c,s.id)||actions);');
      if (pg_catalog.length(replacement)-pg_catalog.length(pg_catalog.replace(replacement,'and bx1_portal.fund_binding_current(b.id),''RECONCILED_PAYMENT_AND_WALLET_REQUIRED''','')))
        /pg_catalog.length('and bx1_portal.fund_binding_current(b.id),''RECONCILED_PAYMENT_AND_WALLET_REQUIRED''')<>1 then
        raise exception 'fund_payment_basis_final_allocation_action_drift' using errcode='55000'; end if;
      replacement:=pg_catalog.replace(replacement,'and bx1_portal.fund_binding_current(b.id),''RECONCILED_PAYMENT_AND_WALLET_REQUIRED''',
        'and bx1_portal.fund_payment_basis_current(s.id) and bx1_portal.fund_binding_current(b.id),''RECONCILED_PAYMENT_AND_WALLET_REQUIRED''');
    end if;
    execute replacement;
  end loop;
end $cutover$;

do $private_helpers$
declare item record;
begin
  for item in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and pg_catalog.left(p.proname,19)='fund_payment_basis_' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_fund_execution_worker',item.signature);
  end loop;
end $private_helpers$;
