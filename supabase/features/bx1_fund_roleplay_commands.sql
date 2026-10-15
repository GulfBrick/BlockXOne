-- Exact TEST-only role-play cutover in the existing canonical fund commands.
-- No user, role, policy, provider result, money, contract or holding is seeded.
-- NULL provenance retains normal authority; global TRUSTED/MFA/independence
-- helpers are not replaced. Existing provider and finality evidence stays real.
-- Apply in one transaction AFTER the unchanged allocation-basis feature.

do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.test_roleplay_lock(jsonb,uuid,text,text)') is null
    or pg_catalog.to_regclass('bx1_portal.fund_payment_allocation_bases') is null
    or pg_catalog.to_regclass('bx1_private.fund_roleplay_command_lanes') is not null then
    raise exception 'fund_roleplay_commands_exact_test_baseline_required' using errcode='55000';
  end if;
end $baseline$;

create table bx1_private.fund_roleplay_command_lanes(
  transaction_id xid8 not null,actor_id uuid not null references auth.users(id),
  policy_id uuid not null references bx1_private.roleplay_policies(id),
  authority_epoch integer not null,product_id uuid not null references bx1_portal.products(id),
  offering_revision_id uuid not null,operating_context jsonb not null,
  action text not null,request_key uuid not null,signing_address text,
  primary key(transaction_id,actor_id),
  check(signing_address is null or (signing_address ~ '^0x[0-9a-f]{40}$'
    and signing_address<>'0x0000000000000000000000000000000000000000'))
);
alter table bx1_private.fund_roleplay_command_lanes enable row level security;
revoke all on bx1_private.fund_roleplay_command_lanes from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;

create table bx1_private.fund_roleplay_command_receipts(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  policy_id uuid not null references bx1_private.roleplay_policies(id),
  authority_epoch integer not null,product_id uuid not null references bx1_portal.products(id),
  offering_revision_id uuid not null,actual_actor_id uuid not null references auth.users(id),
  actual_person_id uuid not null references bx1_private.roleplay_people(person_id),
  operating_context jsonb not null,action text not null,request_key uuid not null,
  signing_address text,assurance text not null default 'TEST_ROLE_PLAY' check(assurance='TEST_ROLE_PLAY'),
  independence_proven boolean not null default false check(not independence_proven),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(actual_actor_id,request_key,action)
);
alter table bx1_private.fund_roleplay_command_receipts enable row level security;
revoke all on bx1_private.fund_roleplay_command_receipts from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;
create trigger fund_roleplay_command_receipts_immutable before update or delete on bx1_private.fund_roleplay_command_receipts
  for each row execute function bx1_portal.immutable_record();

create function bx1_private.fund_roleplay_record_bound(policy uuid,epoch integer,product uuid,offering uuid,
  actor uuid,c jsonb,action text) returns boolean
language sql stable security definer set search_path='' as $$
  -- Static provenance is retained after expiry/revocation; it is NOT permission
  -- to take a new action. The separate current predicate gates every action.
  select coalesce(exists(select 1 from bx1_private.roleplay_policies p
    join bx1_private.roleplay_operators operator on operator.user_id=actor and operator.person_id=p.actual_operator_person_id
    join bx1_private.roleplay_people person on person.person_id=operator.person_id
    join bx1_private.roleplay_capacities capacity on capacity.policy_id=p.id and capacity.user_id=actor
      and capacity.role=c->>'role'
    join public.bx1_memberships membership on membership.id=capacity.native_membership_id
      and membership.user_id=actor and membership.role=capacity.role and membership.organisation_id=p.native_organisation_id
    where p.id=policy and p.authority_epoch=epoch and p.product_id=product and p.offering_revision_id=offering
      and p.environment='TESTNET' and p.project_ref='fegnnnlseuejkrusbbkv' and not p.independence_proven
      and c=pg_catalog.jsonb_build_object('mode','ROLE','organisationId',membership.organisation_id,'role',membership.role)
      and action=any(capacity.actions) and action=any(bx1_private.test_roleplay_role_actions(capacity.role))),false);
$$;
create function bx1_private.fund_roleplay_record_current(policy uuid,epoch integer,product uuid,offering uuid,
  actor uuid,c jsonb,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.fund_roleplay_record_bound(policy,epoch,product,offering,actor,c,action)
    and bx1_private.test_roleplay_binding_current(policy)
    and exists(select 1 from bx1_private.roleplay_policies saved where saved.id=policy
      and saved.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=saved.product_id))
    and exists(select 1 from bx1_private.roleplay_operators operator
      join bx1_private.persons person on person.id=operator.person_id and person.status='TEST_ROLE_PLAY'
      join auth.users u on u.id=operator.user_id and u.email_confirmed_at is not null and u.deleted_at is null
      join public.bx1_profiles profile on profile.id=u.id and profile.status='ACTIVE'
      join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy and capacity.user_id=actor and capacity.role=c->>'role'
      join public.bx1_memberships membership on membership.id=capacity.native_membership_id
      join public.bx1_organisations organisation on organisation.id=membership.organisation_id and organisation.status='ACTIVE'
      where operator.user_id=actor and operator.status='ACTIVE' and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
        and membership.status='ACTIVE' and bx1_portal.native_membership_effective(membership.id));
$$;
create function bx1_private.fund_roleplay_current_policy(c jsonb,product uuid,action text) returns uuid
language sql volatile security definer set search_path='' as $$
  -- Lookup-current is allowed only for starting a NEW command. Persistent
  -- records always call record_current with their saved policy and epoch.
  select p.id from bx1_private.roleplay_policies p
    where p.product_id=product and bx1_private.test_roleplay_current(p.id,product,p.offering_revision_id,auth.uid(),c,action,null,p.authority_epoch)
      and p.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=p.product_id)
    order by p.version desc limit 1;
$$;
create function bx1_private.fund_roleplay_person_for(product uuid,actor uuid) returns uuid
language sql volatile security definer set search_path='' as $$
  -- Identity/provenance lookup, NOT a caller permission or MFA assertion.
  -- Durable provider/chain observers have no customer's JWT; their separate
  -- protected worker guard and exact saved provenance still apply.
  select operator.person_id from bx1_private.roleplay_operators operator
    join bx1_private.roleplay_people provenance on provenance.person_id=operator.person_id
    join bx1_private.persons person on person.id=operator.person_id and person.status='TEST_ROLE_PLAY'
    join auth.users actual_user on actual_user.id=operator.user_id and actual_user.email_confirmed_at is not null and actual_user.deleted_at is null
    join public.bx1_profiles profile on profile.id=actual_user.id and profile.status='ACTIVE'
    where operator.user_id=actor and operator.status='ACTIVE' and not coalesce(actual_user.is_anonymous,false)
      and (actual_user.banned_until is null or actual_user.banned_until<=pg_catalog.clock_timestamp())
      and exists(select 1 from bx1_private.roleplay_policies policy
        join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy.id and capacity.user_id=actor
        where policy.product_id=product and policy.actual_operator_person_id=operator.person_id
          and policy.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=policy.product_id)
          and bx1_private.test_roleplay_binding_current(policy.id));
$$;
create function bx1_private.fund_roleplay_context(c jsonb,product uuid,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.test_roleplay_protected_session()
    and bx1_private.fund_roleplay_current_policy(c,product,action) is not null;
$$;
create function bx1_private.fund_roleplay_visible(c jsonb,product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.test_roleplay_protected_session() and exists(
    select 1 from bx1_private.roleplay_policies p join bx1_private.roleplay_capacities capacity on capacity.policy_id=p.id
    where p.product_id=product and capacity.user_id=auth.uid() and capacity.role=c->>'role'
      and p.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=p.product_id)
      and bx1_private.test_roleplay_current(p.id,product,p.offering_revision_id,auth.uid(),c,capacity.actions[1],null,p.authority_epoch));
$$;
create function bx1_private.fund_roleplay_lane_current(c jsonb,product uuid,action text default null) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
    where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.product_id=product and lane.operating_context=c and (fund_roleplay_lane_current.action is null or lane.action=fund_roleplay_lane_current.action)
      and bx1_private.test_roleplay_current(lane.policy_id,lane.product_id,lane.offering_revision_id,lane.actor_id,
        lane.operating_context,lane.action,null,lane.authority_epoch)
      and bx1_private.fund_roleplay_record_current(lane.policy_id,lane.authority_epoch,lane.product_id,lane.offering_revision_id,
        lane.actor_id,lane.operating_context,lane.action));
$$;
create function bx1_private.fund_roleplay_enter(c jsonb,product uuid,action text,key uuid,
  signing_address text default null) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare policy uuid; p bx1_private.roleplay_policies; old bx1_private.fund_roleplay_command_lanes;
begin
  policy:=bx1_private.fund_roleplay_current_policy(c,product,action);
  if policy is null then return null; end if;
  if key is null then raise exception 'fund_roleplay_request_key_required' using errcode='22023';end if;
  perform bx1_private.test_roleplay_lock(c,product,action,null);
  perform factor.id from auth.sessions actual_session join auth.mfa_factors factor on factor.id=actual_session.factor_id
    and factor.user_id=actual_session.user_id where actual_session.user_id=auth.uid()
      and actual_session.id::text=auth.jwt()->>'session_id' for share of factor;
  select * into p from bx1_private.roleplay_policies where id=policy for share;
  select * into old from bx1_private.fund_roleplay_command_lanes
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();
  -- A canonical command inside a selector-bound public overload inherits ONLY
  -- that exact private lane's selected owner; client data cannot set this row.
  signing_address:=coalesce(pg_catalog.lower(signing_address),old.signing_address);
  if exists(select 1 from bx1_private.fund_roleplay_command_receipts receipt where receipt.actual_actor_id=auth.uid()
    and receipt.request_key=key and receipt.action=fund_roleplay_enter.action and (receipt.policy_id is distinct from policy
      or receipt.authority_epoch is distinct from p.authority_epoch or receipt.product_id is distinct from product
      or receipt.operating_context is distinct from c or receipt.signing_address is distinct from fund_roleplay_enter.signing_address)) then
    raise exception 'fund_roleplay_request_selector_conflict' using errcode='23505';end if;
  if old.actor_id is not null then
    if old.policy_id is distinct from policy or old.authority_epoch<>p.authority_epoch or old.product_id<>product
      or old.operating_context is distinct from c or old.action<>action or old.request_key<>key
      or old.signing_address is distinct from signing_address then
      raise exception 'fund_roleplay_nested_scope_conflict' using errcode='42501';end if;
    return policy;
  end if;
  insert into bx1_private.fund_roleplay_command_lanes(transaction_id,actor_id,policy_id,authority_epoch,product_id,
    offering_revision_id,operating_context,action,request_key,signing_address)
    values(pg_catalog.pg_current_xact_id(),auth.uid(),policy,p.authority_epoch,product,p.offering_revision_id,c,action,key,signing_address);
  if bx1_private.fund_roleplay_lane_current(c,product,action) is not true then
    raise exception 'fund_roleplay_authority_changed_after_wait' using errcode='42501';end if;
  return policy;
end $$;
create function bx1_private.fund_roleplay_finish(c jsonb,product uuid,action text,key uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.fund_roleplay_command_lanes;person uuid;
begin
  select * into lane from bx1_private.fund_roleplay_command_lanes
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();
  if lane.actor_id is null then return;end if;
  if lane.request_key<>key or lane.action<>action or bx1_private.fund_roleplay_lane_current(c,product,action) is not true then
    raise exception 'fund_roleplay_authority_changed_at_commit' using errcode='42501';end if;
  select actual_operator_person_id into person from bx1_private.roleplay_policies where id=lane.policy_id;
  insert into bx1_private.fund_roleplay_command_receipts(policy_id,authority_epoch,product_id,offering_revision_id,
    actual_actor_id,actual_person_id,operating_context,action,request_key,signing_address)
    values(lane.policy_id,lane.authority_epoch,product,lane.offering_revision_id,auth.uid(),person,c,action,key,lane.signing_address)
    on conflict(actual_actor_id,request_key,action) do nothing;
  if bx1_private.fund_roleplay_lane_current(c,product,action) is not true then
    raise exception 'fund_roleplay_authority_changed_at_commit' using errcode='42501';end if;
  delete from bx1_private.fund_roleplay_command_lanes where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();
end $$;
create function bx1_private.fund_roleplay_same_operator(c jsonb,product uuid,action text,other_actor uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select other_actor=auth.uid() and bx1_private.fund_roleplay_context(c,product,action)
    and bx1_private.fund_roleplay_person_for(product,other_actor) is not null;
$$;

-- Provenance columns are nullable for all retained history. No old row is
-- backfilled, and old evidence is never rebound to a newer policy.
do $provenance$
declare relation text;
begin
  foreach relation in array array[
    'bx1_portal.product_service_appointments','bx1_portal.product_service_appointment_receipts',
    'bx1_portal.offering_decisions','bx1_private.offering_signature_authorisations',
    'bx1_private.offering_signature_authorisation_events','bx1_portal.funding_routes',
    'bx1_portal.funding_acceptances','bx1_portal.funding_reversals',
    'bx1_portal.fund_payment_allocation_bases','bx1_portal.fund_allocations',
    'bx1_portal.fund_release_manifests','bx1_portal.fund_signer_policies','bx1_portal.fund_authorities',
    'bx1_portal.fund_operations','bx1_portal.fund_operation_approvals','bx1_portal.fund_safe_signatures'] loop
    execute pg_catalog.format('alter table %s add column roleplay_policy_id uuid references bx1_private.roleplay_policies(id) on delete restrict,add column roleplay_epoch integer,add column roleplay_context jsonb',relation);
    execute pg_catalog.format('alter table %s add constraint %I check((roleplay_policy_id is null)=(roleplay_epoch is null) and (roleplay_policy_id is null)=(roleplay_context is null) and (roleplay_epoch is null or roleplay_epoch>0))',relation,split_part(relation,'.',2)||'_roleplay_pair');
  end loop;
end $provenance$;
alter table bx1_portal.fund_operation_approvals add column roleplay_signing_address text
  check(roleplay_signing_address is null or roleplay_signing_address ~ '^0x[0-9a-f]{40}$');
alter table bx1_portal.fund_safe_signatures add column roleplay_signing_address text
  check(roleplay_signing_address is null or roleplay_signing_address ~ '^0x[0-9a-f]{40}$');

create table bx1_private.fund_roleplay_wallet_proofs(
  policy_id uuid not null references bx1_private.roleplay_policies(id),authority_epoch integer not null,
  wallet_slot text not null,actor_id uuid not null references auth.users(id),
  -- Native wallet tables intentionally do not grant this installer REFERENCES.
  -- Guarded insertion locks/resolves both UUIDs; current authority re-resolves
  -- them rather than expanding the wallet owner's private privileges.
  wallet_id uuid not null,proof_id uuid not null,
  operating_context jsonb not null,verified_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(policy_id,wallet_slot,proof_id),unique(policy_id,proof_id)
);
alter table bx1_private.fund_roleplay_wallet_proofs enable row level security;
revoke all on bx1_private.fund_roleplay_wallet_proofs from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;
create trigger fund_roleplay_wallet_proofs_immutable before update or delete on bx1_private.fund_roleplay_wallet_proofs
  for each row execute function bx1_portal.immutable_record();

-- The native wallet owner alone may lock its rows. Borrow only installation
-- authority, create a lock-only internal helper and restore exact ACL/edges.
create temporary table bx1_roleplay_wallet_owner_edges on commit drop as
  select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
  where roleid='bx1_wallet_owner'::regrole and member=current_user::regrole;
create temporary table bx1_roleplay_wallet_schema on commit drop as
  select not pg_catalog.has_schema_privilege('bx1_wallet_owner','bx1_private','CREATE') added_create,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb)
      from pg_catalog.aclexplode(nspacl) a) original_acl from pg_catalog.pg_namespace where nspname='bx1_private';
grant bx1_wallet_owner to current_user with inherit true,set true granted by current_user;
do $$ begin
  if (select added_create from pg_temp.bx1_roleplay_wallet_schema) then grant create on schema bx1_private to bx1_wallet_owner;end if;
end $$;
set local role bx1_wallet_owner;
create function bx1_private.lock_roleplay_wallet_proof(actor uuid,wallet uuid,proof uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if actor is distinct from coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid then raise exception 'roleplay_wallet_lock_actor_denied' using errcode='42501';end if;
  perform id from public.bx1_wallets where id=wallet and user_id=actor and last_proof_id=proof for share;
  if not found then raise exception 'roleplay_wallet_lock_current_proof_required' using errcode='42501';end if;
  perform id from bx1_private.wallet_challenges where id=proof and user_id=actor and used_at is not null for share;
  if not found then raise exception 'roleplay_wallet_lock_consumed_proof_required' using errcode='42501';end if;
end $$;
revoke all on function bx1_private.lock_roleplay_wallet_proof(uuid,uuid,uuid) from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;
grant execute on function bx1_private.lock_roleplay_wallet_proof(uuid,uuid,uuid) to postgres;
reset role;
do $restore_wallet_owner$
declare edge record;actual jsonb;expected jsonb;
begin
  if (select added_create from pg_temp.bx1_roleplay_wallet_schema) then revoke create on schema bx1_private from bx1_wallet_owner;end if;
  select original_acl into expected from pg_temp.bx1_roleplay_wallet_schema;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) into actual
    from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(n.nspacl) a where n.nspname='bx1_private';
  if actual is distinct from expected then raise exception 'roleplay_wallet_schema_acl_not_restored';end if;
  select * into edge from pg_temp.bx1_roleplay_wallet_owner_edges where grantor=current_user::regrole;
  if found then execute pg_catalog.format('grant bx1_wallet_owner to %I with admin %s,inherit %s,set %s granted by %I',current_user,
    edge.admin_option::text,edge.inherit_option::text,edge.set_option::text,current_user);
  else execute pg_catalog.format('revoke bx1_wallet_owner from %I granted by %I',current_user,current_user);end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into expected from pg_temp.bx1_roleplay_wallet_owner_edges e;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into actual from
    (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
      where roleid='bx1_wallet_owner'::regrole and member=current_user::regrole) e;
  if actual is distinct from expected then raise exception 'roleplay_wallet_owner_edges_not_restored';end if;
end $restore_wallet_owner$;

create function bx1_private.fund_roleplay_bind_signer(policy uuid,epoch integer,slot_name text,wallet uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.roleplay_policies; slot bx1_private.roleplay_wallet_slots;
  w public.bx1_wallets;proof bx1_private.wallet_challenges;
begin
  select * into p from bx1_private.roleplay_policies where id=policy;
  if p.id is null or p.authority_epoch is distinct from epoch
    or bx1_private.fund_roleplay_record_current(p.id,epoch,p.product_id,p.offering_revision_id,auth.uid(),c,'bind_roleplay_signer') is not true
    or bx1_private.test_roleplay_current(p.id,p.product_id,p.offering_revision_id,auth.uid(),c,'bind_roleplay_signer',slot_name,epoch) is not true then
    raise exception 'fund_roleplay_signer_slot_denied' using errcode='42501';end if;
  perform bx1_private.test_roleplay_lock(c,p.product_id,'bind_roleplay_signer',slot_name);
  perform factor.id from auth.sessions actual_session join auth.mfa_factors factor on factor.id=actual_session.factor_id
    and factor.user_id=actual_session.user_id where actual_session.user_id=auth.uid()
      and actual_session.id::text=auth.jwt()->>'session_id' for share of factor;
  select wallet_slot.* into slot from bx1_private.roleplay_wallet_slots wallet_slot where wallet_slot.policy_id=policy and wallet_slot.slot=slot_name
    and wallet_slot.user_id=auth.uid() and wallet_slot.role='TokenisationAgent' for share;
  select * into w from public.bx1_wallets where id=wallet and user_id=auth.uid();
  perform bx1_private.lock_roleplay_wallet_proof(auth.uid(),w.id,w.last_proof_id);
  select * into w from public.bx1_wallets where id=wallet and user_id=auth.uid();
  select * into proof from bx1_private.wallet_challenges where id=w.last_proof_id;
  if slot.policy_id is null or w.id is null or w.verified_at is null or proof.id is null
    or w.organisation_id is distinct from p.native_organisation_id or w.address is distinct from slot.wallet_address or w.chain_id<>80002
    or proof.user_id is distinct from auth.uid() or proof.organisation_id is distinct from p.native_organisation_id
    or proof.address is distinct from w.address or proof.chain_id<>80002
    or proof.session_id::text is distinct from auth.jwt()->>'session_id' or proof.used_at is null or proof.proof_signature is null
    or proof.issued_at<p.valid_from or proof.used_at>=p.valid_until then
    raise exception 'fund_roleplay_fresh_slot_control_proof_required' using errcode='42501';end if;
  insert into bx1_private.fund_roleplay_wallet_proofs(policy_id,authority_epoch,wallet_slot,actor_id,wallet_id,proof_id,operating_context)
    values(policy,epoch,slot_name,auth.uid(),wallet,proof.id,c) on conflict(policy_id,wallet_slot,proof_id) do nothing;
  if bx1_private.test_roleplay_current(p.id,p.product_id,p.offering_revision_id,auth.uid(),c,'bind_roleplay_signer',slot_name,epoch) is not true
    or bx1_private.fund_roleplay_record_current(p.id,epoch,p.product_id,p.offering_revision_id,auth.uid(),c,'bind_roleplay_signer') is not true then
    raise exception 'fund_roleplay_signer_authority_changed' using errcode='42501';end if;
  return pg_catalog.jsonb_build_object('policy_id',policy,'authority_epoch',epoch,'wallet_slot',slot_name,
    'signing_address',w.address,'assurance','ACTUAL_WALLET_CONTROL','independence_proven',false);
end $$;

create function bx1_private.fund_roleplay_signer(policy uuid,epoch integer,product uuid,offering uuid,actor uuid,
  c jsonb,signing_address text) returns uuid
language sql volatile security definer set search_path='' as $$
  select authority.id from bx1_portal.fund_authorities authority
    join bx1_portal.fund_signer_policies signer_policy on signer_policy.id=authority.signer_policy_id
    join bx1_portal.fund_release_manifests manifest on manifest.id=signer_policy.manifest_id
    join bx1_private.roleplay_wallet_slots slot on slot.policy_id=policy and slot.user_id=actor
      and slot.role='TokenisationAgent' and slot.wallet_address=signing_address and slot.chain_id=80002
    join bx1_private.fund_roleplay_wallet_proofs binding on binding.policy_id=policy and binding.authority_epoch=epoch
      and binding.wallet_slot=slot.slot and binding.actor_id=actor
    join public.bx1_wallets wallet on wallet.id=binding.wallet_id and wallet.user_id=actor and wallet.organisation_id=(c->>'organisationId')::uuid
      and wallet.address=signing_address and wallet.chain_id=80002 and wallet.verified_at is not null
    join bx1_private.wallet_challenges proof on proof.id=wallet.last_proof_id and proof.user_id=actor
      and proof.organisation_id=wallet.organisation_id and proof.address=wallet.address and proof.chain_id=wallet.chain_id
      and proof.id=binding.proof_id and proof.used_at is not null and proof.proof_signature is not null
    where actor=auth.uid() and bx1_private.test_roleplay_protected_session()
      and c->>'role'='TokenisationAgent' and signing_address ~ '^0x[0-9a-f]{40}$'
      and signing_address<>'0x0000000000000000000000000000000000000000'
      and authority.user_id=actor and authority.signer_address=signing_address and authority.can_sign
      and authority.roleplay_policy_id=policy and authority.roleplay_epoch=epoch
      and signer_policy.roleplay_policy_id=policy and signer_policy.roleplay_epoch=epoch
      and manifest.roleplay_policy_id=policy and manifest.roleplay_epoch=epoch
      and manifest.product_id=product and manifest.offering_revision_id=offering
      and bx1_private.fund_roleplay_record_current(policy,epoch,product,offering,actor,c,'record_fund_signature')
      and bx1_portal.fund_authority_current(authority.id) limit 1;
$$;

-- Exact canonical call-site cutovers and provenance/constraint guards follow.

create function bx1_private.fund_roleplay_review_exception(c jsonb,product uuid,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  -- Explicitly simulated role decisions, NOT an assertion that two actor IDs
  -- are independent humans. Each resulting record is stamped and audited.
  select bx1_private.fund_roleplay_context(c,product,action);
$$;
create function bx1_private.fund_roleplay_document_person(policy uuid,epoch integer,product uuid,offering uuid,
  actor uuid,person uuid,c jsonb,action text) returns uuid
language sql volatile security definer set search_path='' as $$
  select case when policy is null then bx1_private.document_governance_trusted_person(actor,person)
    when bx1_private.fund_roleplay_record_current(policy,epoch,product,offering,actor,c,action)
      and exists(select 1 from bx1_private.roleplay_policies p where p.id=policy and p.actual_operator_person_id=person)
      then person else null end;
$$;

create function bx1_private.fund_roleplay_control_proof_current(policy uuid,epoch integer,slot_name text,actor uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.roleplay_policies p
    join bx1_private.roleplay_wallet_slots slot on slot.policy_id=p.id and slot.user_id=actor and slot.role='TokenisationAgent' and slot.slot=slot_name
    join bx1_private.fund_roleplay_wallet_proofs binding on binding.policy_id=p.id and binding.authority_epoch=p.authority_epoch
      and binding.wallet_slot=slot.slot and binding.actor_id=actor
    join public.bx1_wallets wallet on wallet.id=binding.wallet_id and wallet.user_id=actor and wallet.organisation_id=p.native_organisation_id
      and wallet.address=slot.wallet_address and wallet.chain_id=80002 and wallet.verified_at is not null and wallet.last_proof_id=binding.proof_id
    join bx1_private.wallet_challenges proof on proof.id=binding.proof_id and proof.user_id=actor
      and proof.address=slot.wallet_address and proof.organisation_id=p.native_organisation_id and proof.chain_id=80002
      and proof.used_at is not null and proof.proof_signature is not null and proof.issued_at>=p.valid_from and proof.used_at<p.valid_until
    where p.id=policy and p.authority_epoch=epoch
      and bx1_private.fund_roleplay_record_current(p.id,epoch,p.product_id,p.offering_revision_id,actor,binding.operating_context,'bind_roleplay_signer'));
$$;
create function bx1_private.fund_roleplay_authority_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_authorities a
    join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
    join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
    join bx1_private.roleplay_policies p on p.id=a.roleplay_policy_id and p.id=sp.roleplay_policy_id and p.id=m.roleplay_policy_id
      and p.authority_epoch=a.roleplay_epoch and p.authority_epoch=sp.roleplay_epoch and p.authority_epoch=m.roleplay_epoch
    join bx1_private.roleplay_capacities capacity on capacity.policy_id=p.id and capacity.user_id=a.user_id
      and capacity.role=a.role and capacity.native_membership_id=a.native_membership_id
    join public.bx1_memberships native on native.id=a.native_membership_id and native.user_id=a.user_id and native.role=a.role
      and native.organisation_id=p.native_organisation_id
    where a.id=target and a.status='ADMITTED' and sp.status='ADMITTED' and m.status='ADMITTED'
      and m.product_id=p.product_id and m.offering_revision_id=p.offering_revision_id and a.person_id=p.actual_operator_person_id
      and a.valid_from<=pg_catalog.clock_timestamp() and a.valid_until>pg_catalog.clock_timestamp()
      and sp.admitted_until>pg_catalog.clock_timestamp() and m.admitted_until>pg_catalog.clock_timestamp()
      and sp.authority_epoch=m.authority_epoch and native.status='ACTIVE' and bx1_portal.native_membership_effective(native.id)
      -- The saved provenance is the ACTUAL manager/agent admission command, not
      -- a fabricated per-capacity command. The capacity is separately current.
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,p.product_id,p.offering_revision_id,
        m.admitted_by,a.roleplay_context,'admit_fund_release')
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,p.product_id,p.offering_revision_id,a.user_id,
        pg_catalog.jsonb_build_object('mode','ROLE','organisationId',native.organisation_id,'role',a.role),capacity.actions[1])
      and (not a.can_sign or exists(select 1 from bx1_private.roleplay_wallet_slots slot where slot.policy_id=p.id and slot.user_id=a.user_id
        and slot.role='TokenisationAgent' and slot.wallet_address=a.signer_address
        and bx1_private.fund_roleplay_control_proof_current(p.id,p.authority_epoch,slot.slot,a.user_id))));
$$;

create function bx1_private.fund_roleplay_policy_bound(policy uuid,epoch integer,product uuid,offering uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.roleplay_policies p where p.id=policy and p.authority_epoch=epoch
    and p.product_id=product and (offering is null or p.offering_revision_id=offering)
    and p.project_ref='fegnnnlseuejkrusbbkv' and p.environment='TESTNET' and not p.independence_proven),false);
$$;
create function bx1_private.fund_roleplay_row_target(table_name text,row_value jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare product uuid;offering uuid;value uuid;
begin
  product:=(row_value->>'product_id')::uuid;offering:=(row_value->>'offering_revision_id')::uuid;
  if table_name='offering_decisions' then
    select r.product_id,r.id into product,offering from bx1_portal.offering_revisions r where r.id=offering;
  elsif table_name='product_service_appointment_receipts' then
    select a.product_id,(select p.current_offering_revision_id from bx1_portal.products p where p.id=a.product_id)
      into product,offering from bx1_portal.product_service_appointments a where a.id=(row_value->>'appointment_id')::uuid;
  elsif table_name='offering_signature_authorisations' then offering:=(row_value->>'revision_id')::uuid;
  elsif table_name='offering_signature_authorisation_events' then
    select a.product_id,a.revision_id into product,offering from bx1_private.offering_signature_authorisations a where a.id=(row_value->>'authorisation_id')::uuid;
  elsif table_name in ('funding_acceptances','funding_reversals') then
    if table_name='funding_acceptances' then
      select o.product_id,s.offering_revision_id into product,offering from bx1_portal.funding_references r
        join bx1_portal.funding_obligations o on o.id=r.obligation_id join bx1_portal.subscriptions s on s.id=o.subscription_id
        where r.id=(row_value->>'reference_id')::uuid;
    else select o.product_id,s.offering_revision_id into product,offering from bx1_portal.funding_obligations o
      join bx1_portal.subscriptions s on s.id=o.subscription_id where o.id=(row_value->>'obligation_id')::uuid;end if;
  elsif table_name='fund_signer_policies' then
    select m.product_id,m.offering_revision_id into product,offering from bx1_portal.fund_release_manifests m where m.id=(row_value->>'manifest_id')::uuid;
  elsif table_name='fund_authorities' then
    select m.product_id,m.offering_revision_id into product,offering from bx1_portal.fund_signer_policies sp
      join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where sp.id=(row_value->>'signer_policy_id')::uuid;
  elsif table_name in ('fund_operation_approvals','fund_safe_signatures') then
    select o.product_id,o.offering_revision_id into product,offering from bx1_portal.fund_operations o where o.id=(row_value->>'operation_id')::uuid;
  end if;
  if offering is null and product is not null then select current_offering_revision_id into offering from bx1_portal.products where id=product;end if;
  return pg_catalog.jsonb_build_object('product_id',product,'offering_revision_id',offering);
end $$;
create function bx1_private.fund_roleplay_stamp_record() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare target jsonb;lane bx1_private.fund_roleplay_command_lanes;value jsonb:=pg_catalog.to_jsonb(NEW);previous jsonb;
  policy uuid;epoch integer;address text;
begin
  target:=bx1_private.fund_roleplay_row_target(TG_TABLE_NAME,value);
  select * into lane from bx1_private.fund_roleplay_command_lanes
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid() and product_id=(target->>'product_id')::uuid;
  if TG_OP='UPDATE' then
    previous:=pg_catalog.to_jsonb(OLD);
    if value->'roleplay_policy_id' is distinct from previous->'roleplay_policy_id' or value->'roleplay_epoch' is distinct from previous->'roleplay_epoch'
      or value->'roleplay_context' is distinct from previous->'roleplay_context'
      or (value ? 'roleplay_signing_address' and value->'roleplay_signing_address' is distinct from previous->'roleplay_signing_address') then
      raise exception 'fund_roleplay_provenance_immutable' using errcode='23514';end if;
    if lane.actor_id is not null and previous->>'roleplay_policy_id' is null then
      raise exception 'fund_roleplay_cannot_backfill_existing_record' using errcode='42501';end if;
    if lane.actor_id is not null and (previous->>'roleplay_policy_id' is distinct from lane.policy_id::text
      or (previous->>'roleplay_epoch')::integer is distinct from lane.authority_epoch
      or bx1_private.fund_roleplay_lane_current(lane.operating_context,lane.product_id,lane.action) is not true) then
      raise exception 'fund_roleplay_record_policy_changed' using errcode='42501';end if;
    return NEW;
  end if;
  if lane.actor_id is null then
    if value->>'roleplay_policy_id' is not null or value->>'roleplay_epoch' is not null then
      raise exception 'fund_roleplay_unattested_record_denied' using errcode='42501';end if;
    return NEW;
  end if;
  if lane.offering_revision_id is distinct from (target->>'offering_revision_id')::uuid
    or bx1_private.fund_roleplay_lane_current(lane.operating_context,lane.product_id,lane.action) is not true then
    raise exception 'fund_roleplay_exact_record_scope_required' using errcode='42501';end if;
  value:=value||pg_catalog.jsonb_build_object('roleplay_policy_id',lane.policy_id,'roleplay_epoch',lane.authority_epoch,'roleplay_context',lane.operating_context);
  if TG_TABLE_NAME in ('fund_operation_approvals','fund_safe_signatures') then
    select signer_address into address from bx1_portal.fund_authorities where id=(value->>'authority_id')::uuid
      and roleplay_policy_id=lane.policy_id and roleplay_epoch=lane.authority_epoch;
    if address is null or address is distinct from lane.signing_address then
      raise exception 'fund_roleplay_exact_signing_owner_required' using errcode='42501';end if;
    value:=value||pg_catalog.jsonb_build_object('roleplay_signing_address',address);
  end if;
  NEW:=pg_catalog.jsonb_populate_record(NEW,value);return NEW;
end $$;
do $record_guards$
declare relation text;
begin
  foreach relation in array array[
    'bx1_portal.product_service_appointments','bx1_portal.product_service_appointment_receipts',
    'bx1_portal.offering_decisions','bx1_private.offering_signature_authorisations',
    'bx1_private.offering_signature_authorisation_events','bx1_portal.funding_routes',
    'bx1_portal.funding_acceptances','bx1_portal.funding_reversals','bx1_portal.fund_payment_allocation_bases',
    'bx1_portal.fund_allocations','bx1_portal.fund_release_manifests','bx1_portal.fund_signer_policies',
    'bx1_portal.fund_authorities','bx1_portal.fund_operations','bx1_portal.fund_operation_approvals','bx1_portal.fund_safe_signatures'] loop
    execute pg_catalog.format('create trigger aa_fund_roleplay_stamp before insert or update on %s for each row execute function bx1_private.fund_roleplay_stamp_record()',relation);
  end loop;
end $record_guards$;

create function bx1_private.fund_roleplay_appointment_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_service_appointments a
    join bx1_private.roleplay_policies p on p.id=a.roleplay_policy_id and p.authority_epoch=a.roleplay_epoch
    join bx1_portal.product_service_appointment_receipts review on review.id=a.approval_receipt_id
      and review.appointment_id=a.id and review.action='review_product_service_appointment' and review.status_after='APPROVED'
      and review.actor_id=a.reviewed_by_user_id and review.roleplay_policy_id=p.id and review.roleplay_epoch=p.authority_epoch
    join bx1_portal.product_service_appointment_receipts applied on applied.appointment_id=a.id
      and applied.action='apply_product_service_appointment' and applied.status_after='APPLIED'
      and applied.actor_id=a.applied_by_user_id and applied.roleplay_policy_id=p.id and applied.roleplay_epoch=p.authority_epoch
    where a.id=target and a.status='APPLIED' and a.requested_until>pg_catalog.clock_timestamp()
      and a.product_id=p.product_id and a.reviewer_scope_organisation_id=p.native_organisation_id
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,p.product_id,p.offering_revision_id,a.requested_by_user_id,a.requested_in_context,'request_product_service_appointment')
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,p.product_id,p.offering_revision_id,review.actor_id,review.operating_context,review.action)
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,p.product_id,p.offering_revision_id,applied.actor_id,applied.operating_context,applied.action)
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,p.product_id,p.offering_revision_id,a.appointee_user_id,
        pg_catalog.jsonb_build_object('mode','ROLE','organisationId',p.native_organisation_id,'role',a.role),
        case a.role when 'IssuerFundManager' then 'review_offering_issuer' else 'review_product' end));
$$;
create function bx1_private.fund_roleplay_appointed(c jsonb,product uuid,role_name text) returns boolean
language sql volatile security definer set search_path='' as $$
  select c->>'role'=role_name and bx1_private.test_roleplay_protected_session() and exists(
    select 1 from bx1_portal.product_service_appointments a where a.product_id=product and a.appointee_user_id=auth.uid()
      and a.role=role_name and a.reviewer_scope_organisation_id::text=c->>'organisationId'
      and bx1_private.fund_roleplay_appointment_current(a.id));
$$;
create function bx1_private.fund_roleplay_approved(product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products product_row join bx1_portal.offering_revisions r on r.id=product_row.current_offering_revision_id
    join bx1_portal.offering_decisions issuer on issuer.offering_revision_id=r.id and issuer.decision_kind='ISSUER' and issuer.decision='APPROVED'
    join bx1_portal.offering_decisions compliance on compliance.offering_revision_id=r.id and compliance.decision_kind='COMPLIANCE' and compliance.decision='APPROVED'
    join bx1_private.roleplay_policies p on p.id=issuer.roleplay_policy_id and p.id=compliance.roleplay_policy_id
      and p.authority_epoch=issuer.roleplay_epoch and p.authority_epoch=compliance.roleplay_epoch
    where product_row.id=product and p.product_id=product and p.offering_revision_id=r.id
      and r.terms_hash=product_row.terms_hash and r.terms=product_row.terms
      and issuer.terms_hash=r.terms_hash and compliance.terms_hash=r.terms_hash
      and issuer.document_hashes=r.document_hashes and compliance.document_hashes=r.document_hashes
      and bx1_private.fund_roleplay_appointment_current(issuer.product_appointment_id)
      and bx1_private.fund_roleplay_appointment_current(compliance.product_appointment_id)
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,product,r.id,issuer.actor_id,issuer.operating_context,'review_offering_issuer')
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,product,r.id,compliance.actor_id,compliance.operating_context,'review_product')
      and bx1_private.offering_signature_decisions_current(r.id,issuer.id,compliance.id));
$$;


create table bx1_private.fund_roleplay_capacity_receipts(
  owner_id uuid not null references auth.users(id),request_key uuid not null,
  operator_id uuid not null references auth.users(id),native_organisation_id uuid not null references public.bx1_organisations(id),
  product_id uuid not null references bx1_portal.products(id),policy_id uuid not null references bx1_private.roleplay_policies(id),
  owner_reference text not null,payload jsonb not null,payload_hash text not null,capacity_changes jsonb not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),primary key(owner_id,request_key),
  check(payload_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload::text,'UTF8')),'hex'))
);
alter table bx1_private.fund_roleplay_capacity_receipts enable row level security;
revoke all on bx1_private.fund_roleplay_capacity_receipts from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;
create trigger fund_roleplay_capacity_receipts_immutable before update or delete on bx1_private.fund_roleplay_capacity_receipts
  for each row execute function bx1_portal.immutable_record();

create function bx1_private.fund_roleplay_provision_operator(p_owner uuid,p_key uuid,p_body jsonb) returns uuid
language plpgsql volatile security invoker set search_path='' as $$
declare previous bx1_private.fund_roleplay_capacity_receipts;owner_member public.bx1_memberships;member public.bx1_memberships;
  operator uuid;org uuid;product bx1_portal.products;item jsonb;slot jsonb;role_name text;previous_status text;
  expanded jsonb;capacities jsonb:='[]';slots jsonb:='[]';changes jsonb:='[]';policy uuid;
begin
  if current_user<>'postgres' or session_user<>'postgres' or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_capacity_sql_owner_only' using errcode='42501';end if;
  perform bx1_portal.require_keys(p_body,array['product_id','offering_revision_id','expected_product_revision','terms_hash',
    'native_organisation_id','owner_membership_id','owner_reference','operator_person_id','operator_label','operator_user_id',
    'capacities','wallet_slots','valid_until','expected_previous_version']);
  if p_key is null or p_key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(p_body->'capacities') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_body->'capacities') not between 1 and 9 or pg_catalog.jsonb_typeof(p_body->'wallet_slots') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_body->'wallet_slots')>20 then raise exception 'fund_roleplay_capacity_payload_invalid' using errcode='22023';end if;
  perform bx1_portal.require_text(p_body,'owner_reference',20,400);
  operator:=(p_body->>'operator_user_id')::uuid;org:=(p_body->>'native_organisation_id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1-roleplay-capacity:'||operator::text||':'||org::text,0));
  select * into previous from bx1_private.fund_roleplay_capacity_receipts where owner_id=p_owner and request_key=p_key;
  if previous.owner_id is not null then
    if previous.payload is distinct from p_body then raise exception 'fund_roleplay_capacity_idempotency_conflict' using errcode='23505';end if;
    return previous.policy_id;
  end if;
  select * into owner_member from public.bx1_memberships where id=(p_body->>'owner_membership_id')::uuid
    and user_id=p_owner and organisation_id=org and role='SuperAdmin' and status='ACTIVE' for share;
  select * into product from bx1_portal.products where id=(p_body->>'product_id')::uuid for update;
  if owner_member.id is null or bx1_portal.native_membership_effective(owner_member.id) is not true
    or product.id is null or product.revision is distinct from (p_body->>'expected_product_revision')::integer
    or product.current_offering_revision_id is distinct from (p_body->>'offering_revision_id')::uuid
    or product.terms_hash is distinct from p_body->>'terms_hash'
    or not exists(select 1 from bx1_portal.organisations o where o.id=product.organisation_id and o.reviewer_scope=org)
    or not exists(select 1 from public.bx1_profiles profile join auth.users u on u.id=profile.id
      where profile.id=p_owner and profile.status='ACTIVE' and u.email_confirmed_at is not null and u.deleted_at is null
        and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    or not exists(select 1 from public.bx1_profiles profile join auth.users u on u.id=profile.id
      where profile.id=operator and profile.status='ACTIVE' and u.email_confirmed_at is not null and u.deleted_at is null
        and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())) then
    raise exception 'fund_roleplay_actual_owner_operator_scope_required' using errcode='42501';end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_body->'capacities') loop
    perform bx1_portal.require_keys(item,array['role','actions']);role_name:=item->>'role';
    if pg_catalog.cardinality(bx1_private.test_roleplay_role_actions(role_name))=0 then
      raise exception 'fund_roleplay_capacity_role_not_admitted' using errcode='22023';end if;
    select * into member from public.bx1_memberships where user_id=operator and organisation_id=org and role=role_name for update;
    previous_status:=member.status;
    if role_name='SuperAdmin' and (member.id is null or member.status<>'ACTIVE' or bx1_portal.native_membership_effective(member.id) is not true) then
      raise exception 'fund_roleplay_never_grants_superadmin' using errcode='42501';end if;
    if member.id is null then
      insert into public.bx1_memberships(user_id,organisation_id,role,status) values(operator,org,role_name,'ACTIVE') returning * into member;
    elsif member.status<>'ACTIVE' then
      update public.bx1_memberships set status='ACTIVE' where id=member.id returning * into member;
    end if;
    if bx1_portal.native_membership_effective(member.id) is not true then
      raise exception 'fund_roleplay_existing_mandate_or_entitlement_required' using errcode='42501';end if;
    capacities:=capacities||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('user_id',operator,
      'native_membership_id',member.id,'role',role_name,'actions',item->'actions'));
    changes:=changes||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('membership_id',member.id,'role',role_name,
      'previous_status',previous_status,'new_status','ACTIVE','native_organisation_id',org,'scope','TEST_PRODUCT_ROLE_PLAY'));
  end loop;
  for slot in select value from pg_catalog.jsonb_array_elements(p_body->'wallet_slots') loop
    perform bx1_portal.require_keys(slot,array['role','slot','wallet_address']);
    slots:=slots||pg_catalog.jsonb_build_array(slot||pg_catalog.jsonb_build_object('user_id',operator));
  end loop;
  expanded:=(p_body-'operator_user_id')||pg_catalog.jsonb_build_object('capacities',capacities,'wallet_slots',slots);
  policy:=bx1_private.test_roleplay_provision(p_owner,p_key,expanded);
  insert into bx1_private.fund_roleplay_capacity_receipts(owner_id,request_key,operator_id,native_organisation_id,product_id,policy_id,
    owner_reference,payload,payload_hash,capacity_changes)
    values(p_owner,p_key,operator,org,product.id,policy,p_body->>'owner_reference',p_body,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body::text,'UTF8')),'hex'),changes);
  return policy;
end $$;

create function bx1_portal.fund_roleplay_projection(c jsonb,product_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=bx1_private.test_roleplay_projection(c,product_id);
  if result is null or not exists(select 1 from bx1_private.roleplay_policies policy where policy.id=(result->>'policy_id')::uuid
    and policy.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=policy.product_id)) then return null;end if;
  return result||pg_catalog.jsonb_build_object('wallet_slots',(select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('slot',slot.slot,'role',slot.role,'wallet_address',slot.wallet_address,
      'chain_id',slot.chain_id,'control_proof_current',bx1_private.fund_roleplay_control_proof_current(
        slot.policy_id,(result->>'authority_epoch')::integer,slot.slot,auth.uid()),
      'wallet_id',(select binding.wallet_id from bx1_private.fund_roleplay_wallet_proofs binding
        where binding.policy_id=slot.policy_id and binding.authority_epoch=(result->>'authority_epoch')::integer
          and binding.wallet_slot=slot.slot and binding.actor_id=auth.uid()
          and bx1_private.fund_roleplay_control_proof_current(binding.policy_id,binding.authority_epoch,binding.wallet_slot,binding.actor_id)
        order by binding.verified_at desc limit 1)) order by slot.slot),'[]'::jsonb)
    from bx1_private.roleplay_wallet_slots slot where slot.policy_id=(result->>'policy_id')::uuid and slot.user_id=auth.uid()));
end $$;
create function bx1_private.fund_roleplay_static_record_bound(table_name text,row_value jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare target jsonb;policy bx1_private.roleplay_policies;actor uuid;person uuid;field text;users uuid[]:=array[]::uuid[];
begin
  if row_value->>'roleplay_policy_id' is null or row_value->>'roleplay_epoch' is null or row_value->'roleplay_context' is null then return false;end if;
  target:=bx1_private.fund_roleplay_row_target(table_name,row_value);
  select * into policy from bx1_private.roleplay_policies where id=(row_value->>'roleplay_policy_id')::uuid
    and authority_epoch=(row_value->>'roleplay_epoch')::integer and product_id=(target->>'product_id')::uuid;
  if policy.id is null or policy.project_ref<>'fegnnnlseuejkrusbbkv' or policy.environment<>'TESTNET' then return false;end if;
  if row_value ? 'offering_revision_id' and policy.offering_revision_id is distinct from (row_value->>'offering_revision_id')::uuid then return false;end if;
  if row_value ? 'terms_hash' and policy.terms_hash is distinct from row_value->>'terms_hash' then return false;end if;
  if table_name='product_service_appointments' then
    foreach field in array array['requested_by_user_id','appointee_user_id','reviewed_by_user_id','applied_by_user_id'] loop
      actor:=(row_value->>field)::uuid;
      if actor is not null then users:=users||actor;end if;
    end loop;
  else
    foreach field in array array['requested_by','proposed_by','approved_by'] loop
      actor:=(row_value->>field)::uuid;if actor is not null then users:=users||actor;end if;
    end loop;
    foreach field in array array['requested_person_id','proposed_person','approved_person_id','approved_person'] loop
      person:=(row_value->>field)::uuid;
      if person is not null and person<>policy.actual_operator_person_id then return false;end if;
    end loop;
  end if;
  return pg_catalog.cardinality(users)>0 and not exists(select 1 from pg_catalog.unnest(users) u(actor)
    where not exists(select 1 from bx1_private.roleplay_operators operator where operator.user_id=u.actor
      and operator.person_id=policy.actual_operator_person_id));
end $$;

-- Relax no ordinary row. The original exact CHECK remains the NULL-provenance
-- branch; only stamped, exact one-operator TEST provenance admits same-person.
do $same_operator_constraints$
declare spec jsonb;actual text;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($constraints$
[
  {
    "relation": "bx1_portal.funding_routes",
    "conname": "funding_routes_check",
    "contype": "c",
    "definition": "CHECK (((approved_person IS NULL) OR (approved_person <> proposed_person)))",
    "base": "((approved_person IS NULL) OR (approved_person <> proposed_person))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('funding_routes',pg_catalog.jsonb_build_object('product_id',product_id,'terms_hash',terms_hash,'proposed_by',proposed_by,'proposed_person',proposed_person,'approved_by',approved_by,'approved_person',approved_person,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.funding_acceptances",
    "conname": "funding_acceptances_check",
    "contype": "c",
    "definition": "CHECK (((approved_person IS NULL) OR (approved_person <> proposed_person)))",
    "base": "((approved_person IS NULL) OR (approved_person <> proposed_person))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('funding_acceptances',pg_catalog.jsonb_build_object('reference_id',reference_id,'proposed_by',proposed_by,'proposed_person',proposed_person,'approved_by',approved_by,'approved_person',approved_person,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.funding_reversals",
    "conname": "funding_reversals_check",
    "contype": "c",
    "definition": "CHECK (((approved_person IS NULL) OR (approved_person <> proposed_person)))",
    "base": "((approved_person IS NULL) OR (approved_person <> proposed_person))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('funding_reversals',pg_catalog.jsonb_build_object('obligation_id',obligation_id,'proposed_by',proposed_by,'proposed_person',proposed_person,'approved_by',approved_by,'approved_person',approved_person,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.product_service_appointments",
    "conname": "product_service_appointments_check",
    "contype": "c",
    "definition": "CHECK ((requested_by_user_id <> appointee_user_id))",
    "base": "(requested_by_user_id <> appointee_user_id)",
    "exception": "bx1_private.fund_roleplay_static_record_bound('product_service_appointments',pg_catalog.jsonb_build_object('product_id',product_id,'appointee_user_id',appointee_user_id,'requested_by_user_id',requested_by_user_id,'reviewed_by_user_id',reviewed_by_user_id,'applied_by_user_id',applied_by_user_id,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.product_service_appointments",
    "conname": "product_service_appointments_check1",
    "contype": "c",
    "definition": "CHECK (((reviewed_by_user_id IS NULL) OR (reviewed_by_user_id <> requested_by_user_id)))",
    "base": "((reviewed_by_user_id IS NULL) OR (reviewed_by_user_id <> requested_by_user_id))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('product_service_appointments',pg_catalog.jsonb_build_object('product_id',product_id,'appointee_user_id',appointee_user_id,'requested_by_user_id',requested_by_user_id,'reviewed_by_user_id',reviewed_by_user_id,'applied_by_user_id',applied_by_user_id,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.product_service_appointments",
    "conname": "product_service_appointments_check2",
    "contype": "c",
    "definition": "CHECK (((reviewed_by_user_id IS NULL) OR (reviewed_by_user_id <> appointee_user_id)))",
    "base": "((reviewed_by_user_id IS NULL) OR (reviewed_by_user_id <> appointee_user_id))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('product_service_appointments',pg_catalog.jsonb_build_object('product_id',product_id,'appointee_user_id',appointee_user_id,'requested_by_user_id',requested_by_user_id,'reviewed_by_user_id',reviewed_by_user_id,'applied_by_user_id',applied_by_user_id,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.product_service_appointments",
    "conname": "product_service_appointments_check3",
    "contype": "c",
    "definition": "CHECK (((applied_by_user_id IS NULL) OR (((applied_by_user_id <> requested_by_user_id) AND (applied_by_user_id <> appointee_user_id)) AND (applied_by_user_id <> reviewed_by_user_id))))",
    "base": "((applied_by_user_id IS NULL) OR (((applied_by_user_id <> requested_by_user_id) AND (applied_by_user_id <> appointee_user_id)) AND (applied_by_user_id <> reviewed_by_user_id)))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('product_service_appointments',pg_catalog.jsonb_build_object('product_id',product_id,'appointee_user_id',appointee_user_id,'requested_by_user_id',requested_by_user_id,'reviewed_by_user_id',reviewed_by_user_id,'applied_by_user_id',applied_by_user_id,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.fund_allocations",
    "conname": "fund_allocations_check",
    "contype": "c",
    "definition": "CHECK (((approved_person_id IS NULL) OR (approved_person_id <> requested_person_id)))",
    "base": "((approved_person_id IS NULL) OR (approved_person_id <> requested_person_id))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('fund_allocations',pg_catalog.jsonb_build_object('obligation_id',obligation_id,'product_id',product_id,'offering_revision_id',offering_revision_id,'requested_by',requested_by,'requested_person_id',requested_person_id,'approved_by',approved_by,'approved_person_id',approved_person_id,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  },
  {
    "relation": "bx1_portal.fund_payment_allocation_bases",
    "conname": "fund_payment_allocation_bases_check1",
    "contype": "c",
    "definition": "CHECK (((approved_by IS NULL) OR ((approved_by <> requested_by) AND (approved_person_id <> requested_person_id))))",
    "base": "((approved_by IS NULL) OR ((approved_by <> requested_by) AND (approved_person_id <> requested_person_id)))",
    "exception": "bx1_private.fund_roleplay_static_record_bound('fund_payment_allocation_bases',pg_catalog.jsonb_build_object('product_id',product_id,'offering_revision_id',offering_revision_id,'terms_hash',terms_hash,'requested_by',requested_by,'requested_person_id',requested_person_id,'approved_by',approved_by,'approved_person_id',approved_person_id,'roleplay_policy_id',roleplay_policy_id,'roleplay_epoch',roleplay_epoch,'roleplay_context',roleplay_context))"
  }
]
$constraints$::jsonb) loop
    select pg_catalog.pg_get_constraintdef(c.oid) into actual from pg_catalog.pg_constraint c
      where c.conrelid=(spec->>'relation')::regclass and c.conname=spec->>'conname' and c.contype='c' and c.convalidated;
    if actual is distinct from spec->>'definition' then raise exception 'fund_roleplay_constraint_pin_mismatch: %',spec->>'conname';end if;
    execute pg_catalog.format('alter table %s drop constraint %I',spec->>'relation',spec->>'conname');
    execute pg_catalog.format('alter table %s add constraint %I check((%s) or (%s))',spec->>'relation',spec->>'conname',spec->>'base',spec->>'exception');
  end loop;
end $same_operator_constraints$;

-- Ordinary actor/person uniqueness is unchanged through NULL-only indexes.
-- Role-play signatures/approvals are unique by actual controlled owner key,
-- never by an invented second human.
do $capacity_uniqueness$
declare spec jsonb;actual text;columns text;index_name text;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($uniques$
[
  {
    "relation": "bx1_portal.fund_authorities",
    "conname": "fund_authorities_signer_policy_id_person_id_role_key",
    "contype": "u",
    "definition": "UNIQUE (signer_policy_id, person_id, role)"
  },
  {
    "relation": "bx1_portal.fund_authorities",
    "conname": "fund_authorities_signer_policy_id_user_id_role_key",
    "contype": "u",
    "definition": "UNIQUE (signer_policy_id, user_id, role)"
  },
  {
    "relation": "bx1_portal.fund_operation_approvals",
    "conname": "fund_operation_approvals_operation_id_actor_id_key",
    "contype": "u",
    "definition": "UNIQUE (operation_id, actor_id)"
  },
  {
    "relation": "bx1_portal.fund_operation_approvals",
    "conname": "fund_operation_approvals_operation_id_person_id_key",
    "contype": "u",
    "definition": "UNIQUE (operation_id, person_id)"
  },
  {
    "relation": "bx1_portal.fund_safe_signatures",
    "conname": "fund_safe_signatures_operation_id_actor_id_key",
    "contype": "u",
    "definition": "UNIQUE (operation_id, actor_id)"
  },
  {
    "relation": "bx1_portal.fund_safe_signatures",
    "conname": "fund_safe_signatures_operation_id_person_id_key",
    "contype": "u",
    "definition": "UNIQUE (operation_id, person_id)"
  }
]
$uniques$::jsonb) loop
    select pg_catalog.pg_get_constraintdef(c.oid) into actual from pg_catalog.pg_constraint c
      where c.conrelid=(spec->>'relation')::regclass and c.conname=spec->>'conname' and c.contype='u';
    if actual is distinct from spec->>'definition' then raise exception 'fund_roleplay_unique_pin_mismatch: %',spec->>'conname';end if;
    columns:=pg_catalog.substring(actual,8);index_name:=spec->>'conname';
    execute pg_catalog.format('alter table %s drop constraint %I',spec->>'relation',index_name);
    execute pg_catalog.format('create unique index %I on %s %s where roleplay_policy_id is null',index_name,spec->>'relation',columns);
  end loop;
end $capacity_uniqueness$;
create unique index fund_authorities_roleplay_key on bx1_portal.fund_authorities(signer_policy_id,user_id,role,coalesce(signer_address,''))
  where roleplay_policy_id is not null;
create unique index fund_authorities_roleplay_person_key on bx1_portal.fund_authorities(signer_policy_id,person_id,role,coalesce(signer_address,''))
  where roleplay_policy_id is not null;
create unique index fund_approvals_roleplay_key on bx1_portal.fund_operation_approvals(operation_id,roleplay_signing_address)
  where roleplay_policy_id is not null;
create unique index fund_signatures_roleplay_key on bx1_portal.fund_safe_signatures(operation_id,roleplay_signing_address)
  where roleplay_policy_id is not null;
alter table bx1_portal.fund_operation_approvals add constraint fund_approvals_roleplay_key_required
  check((roleplay_policy_id is null)=(roleplay_signing_address is null));
alter table bx1_portal.fund_safe_signatures add constraint fund_signatures_roleplay_key_required
  check((roleplay_policy_id is null)=(roleplay_signing_address is null));

create function bx1_private.fund_roleplay_signature_decision_current(authorisation uuid,actor uuid,kind text) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.offering_signature_authorisations a
    join bx1_private.fund_roleplay_command_lanes lane on lane.policy_id=a.roleplay_policy_id
      and lane.authority_epoch=a.roleplay_epoch and lane.product_id=a.product_id and lane.offering_revision_id=a.revision_id
      and lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=actor and actor=auth.uid()
    where a.id=authorisation and kind in ('ISSUER','COMPLIANCE') and a.roleplay_policy_id is not null
      and a.requester_id=actor and a.signer_id=actor
      and a.requester_person_id=bx1_private.fund_roleplay_person_for(a.product_id,actor)
      and a.signer_person_id=a.requester_person_id
      and lane.action=case kind when 'ISSUER' then 'review_offering_issuer' else 'review_product' end
      and bx1_private.fund_roleplay_lane_current(lane.operating_context,a.product_id,lane.action)
      and bx1_private.offering_signature_authorisation_current(a.id)
      and bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,
        a.requester_id,a.roleplay_context,'REQUEST_PURPOSE')),false);
$$;

create function bx1_private.fund_roleplay_basis_approval(basis_id uuid,c jsonb,authority_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_portal.fund_payment_allocation_bases basis
    join bx1_portal.fund_authorities authority on authority.id=authority_id
      and authority.roleplay_policy_id=basis.roleplay_policy_id and authority.roleplay_epoch=basis.roleplay_epoch
    where basis.id=basis_id and basis.roleplay_policy_id is not null and basis.requested_by=auth.uid()
      and basis.requested_person_id=bx1_private.fund_roleplay_person_for(basis.product_id,auth.uid())
      and authority.role='IssuerFundManager' and authority.user_id=auth.uid()
      and authority.person_id=basis.requested_person_id and authority.can_approve
      and bx1_private.fund_roleplay_authority_current(authority.id)
      and bx1_private.fund_roleplay_record_current(basis.roleplay_policy_id,basis.roleplay_epoch,basis.product_id,basis.offering_revision_id,
        basis.requested_by,basis.requested_context,'request_fund_payment_allocation_basis')
      and bx1_private.fund_roleplay_record_current(basis.roleplay_policy_id,basis.roleplay_epoch,basis.product_id,basis.offering_revision_id,
        auth.uid(),c,'approve_fund_payment_allocation_basis')),false);
$$;
create function bx1_private.fund_roleplay_allocation_basis_current(subscription uuid,actor uuid,c jsonb,action text,authority_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_portal.fund_payment_allocation_bases basis
    join bx1_portal.fund_authorities authority on authority.id=authority_id
      and authority.roleplay_policy_id=basis.roleplay_policy_id and authority.roleplay_epoch=basis.roleplay_epoch
    where basis.subscription_id=subscription and basis.status='APPROVED' and basis.roleplay_policy_id is not null
      and basis.requested_by=actor and basis.approved_by=actor and actor=auth.uid()
      and basis.requested_person_id=bx1_private.fund_roleplay_person_for(basis.product_id,actor)
      and basis.approved_person_id=basis.requested_person_id and authority.person_id=basis.requested_person_id
      and bx1_portal.fund_payment_basis_current(subscription)
      and bx1_private.fund_roleplay_authority_current(authority.id)
      and bx1_private.fund_roleplay_record_current(basis.roleplay_policy_id,basis.roleplay_epoch,basis.product_id,basis.offering_revision_id,
        actor,c,fund_roleplay_allocation_basis_current.action)
      and exists(select 1 from bx1_private.fund_roleplay_command_lanes lane where lane.transaction_id=pg_catalog.pg_current_xact_id()
        and lane.actor_id=actor and lane.policy_id=basis.roleplay_policy_id and lane.authority_epoch=basis.roleplay_epoch
        and lane.product_id=basis.product_id and lane.operating_context=c and lane.action=fund_roleplay_allocation_basis_current.action)),false);
$$;

create function bx1_private.fund_roleplay_owner_addresses(c jsonb,operation_id uuid) returns text[]
language sql volatile security definer set search_path='' as $$
  select coalesce(array_agg(distinct authority.signer_address order by authority.signer_address),array[]::text[])
    from bx1_portal.fund_operations operation
    join bx1_portal.fund_authorities authority on authority.signer_policy_id=operation.signer_policy_id
    join public.bx1_memberships membership on membership.id=authority.native_membership_id
    where operation.id=operation_id and authority.user_id=auth.uid() and authority.role='TokenisationAgent'
      and authority.can_sign and membership.organisation_id::text=c->>'organisationId' and c->>'role'='TokenisationAgent'
      and bx1_portal.fund_operation_current(operation.id)
      and bx1_portal.fund_authority_current(authority.id)
      and ((authority.roleplay_policy_id is null and bx1_portal.fund_context(c,true))
        or (authority.roleplay_policy_id=operation.roleplay_policy_id and authority.roleplay_epoch=operation.roleplay_epoch
          and bx1_private.fund_roleplay_context(c,operation.product_id,'prepare_fund_transaction')));
$$;

create function bx1_portal.fund_roleplay_prepare(c jsonb,oid uuid,expected_revision integer,address text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare operation bx1_portal.fund_operations; policy uuid; key uuid:=pg_catalog.gen_random_uuid(); result jsonb;
begin
  address:=pg_catalog.lower(address);
  if address is null or address!~'^0x[0-9a-f]{40}$' or address='0x0000000000000000000000000000000000000000' then
    raise exception 'fund_signing_owner_selector_invalid' using errcode='22023';end if;
  select * into operation from bx1_portal.fund_operations where id=oid;
  if operation.id is null then raise exception 'fund_operation_denied' using errcode='42501';end if;
  policy:=bx1_private.fund_roleplay_enter(c,operation.product_id,'prepare_fund_transaction',key,address);
  if policy is not null then
    if policy is distinct from operation.roleplay_policy_id or bx1_private.fund_roleplay_signer(policy,operation.roleplay_epoch,
      operation.product_id,operation.offering_revision_id,auth.uid(),c,address) is null then
      raise exception 'fund_current_recorded_signing_owner_required' using errcode='42501';end if;
  elsif address is distinct from (select signer_address from bx1_portal.fund_authorities
    where id=bx1_portal.fund_authority(c,operation.signer_policy_id,'TokenisationAgent')) then
    raise exception 'fund_current_signing_owner_required' using errcode='42501';end if;
  result:=bx1_portal.fund_prepare(c,oid,expected_revision);
  if result->>'signing_owner_address' is distinct from address then
    raise exception 'fund_prepared_signing_owner_mismatch' using errcode='42501';end if;
  return result;
end $$;

create function bx1_portal.fund_roleplay_signature(c jsonb,oid uuid,expected_revision integer,signature text,address text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare operation bx1_portal.fund_operations;policy uuid;key uuid:=pg_catalog.gen_random_uuid();
begin
  address:=pg_catalog.lower(address);
  if address is null or address!~'^0x[0-9a-f]{40}$' or address='0x0000000000000000000000000000000000000000' then
    raise exception 'fund_signing_owner_selector_invalid' using errcode='22023';end if;
  select * into operation from bx1_portal.fund_operations where id=oid;
  if operation.id is null then raise exception 'fund_operation_denied' using errcode='42501';end if;
  policy:=bx1_private.fund_roleplay_enter(c,operation.product_id,'record_fund_signature',key,address);
  if policy is not null then
    if policy is distinct from operation.roleplay_policy_id or bx1_private.fund_roleplay_signer(policy,operation.roleplay_epoch,
      operation.product_id,operation.offering_revision_id,auth.uid(),c,address) is null then
      raise exception 'fund_current_recorded_signing_owner_required' using errcode='42501';end if;
  elsif address is distinct from (select signer_address from bx1_portal.fund_authorities
    where id=bx1_portal.fund_authority(c,operation.signer_policy_id,'TokenisationAgent')) then
    raise exception 'fund_current_signing_owner_required' using errcode='42501';end if;
  return bx1_portal.fund_record_signature(c,oid,expected_revision,signature);
end $$;

create function bx1_portal.fund_roleplay_approval(c jsonb,action text,key uuid,body jsonb,address text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare operation bx1_portal.fund_operations;policy uuid;
begin
  address:=pg_catalog.lower(address);
  if action not in ('approve_fund_deployment','approve_fund_issuance') or address is null
    or address!~'^0x[0-9a-f]{40}$' or address='0x0000000000000000000000000000000000000000' then
    raise exception 'fund_signing_owner_selector_invalid' using errcode='22023';end if;
  perform bx1_portal.require_keys(body,array['operation_id','expected_revision']);
  select * into operation from bx1_portal.fund_operations where id=(body->>'operation_id')::uuid;
  if operation.id is null then raise exception 'fund_operation_denied' using errcode='42501';end if;
  policy:=bx1_private.fund_roleplay_enter(c,operation.product_id,action,key,address);
  if policy is not null then
    if policy is distinct from operation.roleplay_policy_id or bx1_private.fund_roleplay_signer(policy,operation.roleplay_epoch,
      operation.product_id,operation.offering_revision_id,auth.uid(),c,address) is null then
      raise exception 'fund_current_recorded_signing_owner_required' using errcode='42501';end if;
  elsif address is distinct from (select signer_address from bx1_portal.fund_authorities
    where id=bx1_portal.fund_authority(c,operation.signer_policy_id,'TokenisationAgent')) then
    raise exception 'fund_current_signing_owner_required' using errcode='42501';end if;
  return bx1_portal.fund_command(c,action,key,body);
end $$;

create function bx1_portal.fund_roleplay_bind_signer(policy uuid,epoch integer,slot text,wallet uuid,c jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$
  select bx1_private.fund_roleplay_bind_signer(policy,epoch,slot,wallet,c);
$$;

create function public.bx1_portal_fund_roleplay_read(product_id uuid,operating_context jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_portal.fund_roleplay_projection(operating_context,product_id);
$$;
create function public.bx1_portal_bind_roleplay_signer(policy_id uuid,authority_epoch integer,wallet_slot text,wallet_id uuid,operating_context jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_portal.fund_roleplay_bind_signer(policy_id,authority_epoch,wallet_slot,wallet_id,operating_context);
$$;
create function public.bx1_portal_prepare_fund_transaction(operation_id uuid,expected_revision integer,operating_context jsonb,signing_address text) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_portal.fund_roleplay_prepare(operating_context,operation_id,expected_revision,signing_address);
$$;
create function public.bx1_portal_record_fund_signature(operation_id uuid,expected_revision integer,signature text,operating_context jsonb,signing_address text) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_portal.fund_roleplay_signature(operating_context,operation_id,expected_revision,signature,signing_address);
$$;
create function public.bx1_portal_fund_lifecycle_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb,signing_address text) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_portal.fund_roleplay_approval(operating_context,command,request_key,payload,signing_address);
$$;

-- The captured TEST catalog, not an earlier feature file, is the baseline.
-- Reuse canonical OIDs/owner/ACL/config; replace ONLY these reviewed bodies.
do $roleplay_cutover$
declare spec jsonb;target oid;before_row jsonb;after_row jsonb;source_body text;definition text;next_body text;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($roleplay_specs$
[
  {
    "signature": "bx1_portal.test_offering_appointment_effective(uuid)",
    "sha": "e4467ca1411405cf584039f9bdcd2b7ec3ba09c53adf8e0ea1e28acaf201ae1d",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select case when exists(select 1 from bx1_portal.product_service_appointments a where a.id=target_id and a.roleplay_policy_id is not null) then bx1_private.fund_roleplay_appointment_current(target_id) else (exists(select 1 from bx1_portal.product_service_appointments a\n    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id\n    join bx1_portal.organisations o on o.id=p.organisation_id and o.reviewer_scope=a.reviewer_scope_organisation_id\n    join public.bx1_memberships m on m.id=a.native_membership_id\n      and m.user_id=a.appointee_user_id and m.role=a.role and m.organisation_id=a.reviewer_scope_organisation_id\n    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'\n      and cfg.manual_test_review and cfg.test_ordinary_entry_enabled and cfg.reviewer_scope=o.reviewer_scope\n    join bx1_portal.product_service_appointment_receipts receipt on receipt.id=a.approval_receipt_id\n      and receipt.appointment_id=a.id and receipt.action='review_product_service_appointment'\n      and receipt.status_after='APPROVED' and receipt.actor_id=a.reviewed_by_user_id\n    where a.id=target_id and a.status='APPLIED' and a.applied_at is not null\n      and a.requested_until>pg_catalog.clock_timestamp() and bx1_portal.test_offering_appointment_current(a.id)\n      and bx1_portal.native_membership_effective(m.id)\n      and bx1_portal.offering_workflow_person_current(a.appointee_user_id)\n      and bx1_portal.offering_workflow_person_current(a.reviewed_by_user_id)\n      and bx1_portal.offering_workflow_person_current(a.applied_by_user_id)\n      and exists(select 1 from public.bx1_memberships reviewer where reviewer.user_id=a.reviewed_by_user_id\n        and reviewer.role='ComplianceOfficer' and reviewer.organisation_id=a.reviewer_scope_organisation_id\n        and bx1_portal.native_membership_effective(reviewer.id))\n      and exists(select 1 from public.bx1_memberships applier where applier.user_id=a.applied_by_user_id\n        and applier.role='SuperAdmin' and applier.organisation_id=a.reviewer_scope_organisation_id\n        and bx1_portal.native_membership_effective(applier.id))\n      and bx1_portal.offering_workflow_people_independent(a.requested_by_user_id,a.appointee_user_id)\n      and bx1_portal.offering_workflow_people_independent(a.requested_by_user_id,a.reviewed_by_user_id)\n      and bx1_portal.offering_workflow_people_independent(a.requested_by_user_id,a.applied_by_user_id)\n      and bx1_portal.offering_workflow_people_independent(a.appointee_user_id,a.reviewed_by_user_id)\n      and bx1_portal.offering_workflow_people_independent(a.appointee_user_id,a.applied_by_user_id)\n      and bx1_portal.offering_workflow_people_independent(a.reviewed_by_user_id,a.applied_by_user_id))) end;\n"
  },
  {
    "signature": "bx1_portal.offering_workflow_approved(uuid)",
    "sha": "b5c665622687d1348b24ab63506b54e54b969ef681d0892e862ae24b0d75be24",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select case when exists(select 1 from bx1_portal.offering_decisions d join bx1_portal.offering_revisions r on r.id=d.offering_revision_id where r.product_id=target_product and r.id=(select current_offering_revision_id from bx1_portal.products where id=target_product) and d.roleplay_policy_id is not null) then bx1_private.fund_roleplay_approved(target_product) else (exists(select 1 from bx1_portal.products p\n    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id\n      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms\n    join bx1_portal.organisations o on o.id=p.organisation_id\n    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'\n      and cfg.manual_test_review\n    join bx1_portal.offering_decisions issuer on issuer.offering_revision_id=r.id\n      and issuer.decision_kind='ISSUER' and issuer.decision='APPROVED'\n      and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes\n      and (r.terms->'terms_version' is distinct from '3'::jsonb or\n        (issuer.common_envelope_hash=r.common_envelope_hash and issuer.deployment_configuration_hash=r.deployment_configuration_hash))\n    join bx1_portal.product_service_appointments ia on ia.id=issuer.product_appointment_id\n      and ia.product_id=p.id and ia.appointee_user_id=issuer.actor_id\n      and ia.role='IssuerFundManager'\n    join bx1_portal.offering_decisions compliance on compliance.offering_revision_id=r.id\n      and compliance.decision_kind='COMPLIANCE' and compliance.decision='APPROVED'\n      and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes\n      and (r.terms->'terms_version' is distinct from '3'::jsonb or\n        (compliance.common_envelope_hash=r.common_envelope_hash and compliance.deployment_configuration_hash=r.deployment_configuration_hash))\n    join bx1_portal.product_service_appointments ca on ca.id=compliance.product_appointment_id\n      and ca.product_id=p.id and ca.appointee_user_id=compliance.actor_id\n      and ca.role='ComplianceOfficer'\n    where p.id=target_product and issuer.actor_id<>compliance.actor_id\n      and (not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n        or bx1_private.offering_signature_decisions_current(r.id,issuer.id,compliance.id))\n      and bx1_portal.test_offering_organisation_current(o.id)\n      and (not bx1_portal.test_offering_is_source(o.id) or bx1_portal.test_offering_revision_current(r.id))\n      and bx1_portal.offering_workflow_product_appointment_effective(ia.id)\n      and bx1_portal.offering_workflow_product_appointment_effective(ca.id)\n      and bx1_portal.offering_workflow_people_independent(issuer.actor_id,compliance.actor_id)\n      and bx1_portal.offering_workflow_lineage_independent(issuer.actor_id,p.id,r.terms_hash)\n      and bx1_portal.offering_workflow_lineage_independent(compliance.actor_id,p.id,r.terms_hash))) end;\n"
  },
  {
    "signature": "bx1_portal.fund_authority_current(uuid)",
    "sha": "79fa01798bd56631b7afe41138d402817bc56f830bad96ec722535b5fa537b2e",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select case when exists(select 1 from bx1_portal.fund_authorities a where a.id=target and a.roleplay_policy_id is not null) then bx1_private.fund_roleplay_authority_current(target) else (exists(select 1 from bx1_portal.fund_authorities a\n    join bx1_portal.fund_signer_policies s on s.id=a.signer_policy_id\n    join bx1_portal.fund_release_manifests r on r.id=s.manifest_id\n    join public.bx1_memberships m on m.id=a.native_membership_id and m.user_id=a.user_id and m.role=a.role\n    join public.bx1_profiles p on p.id=a.user_id and p.status='ACTIVE'\n    join auth.users u on u.id=a.user_id and u.deleted_at is null and u.email_confirmed_at is not null\n    where a.id=target and a.status='ADMITTED' and s.status='ADMITTED' and r.status='ADMITTED'\n      and a.valid_from<=pg_catalog.clock_timestamp() and a.valid_until>pg_catalog.clock_timestamp()\n      and s.admitted_until>pg_catalog.clock_timestamp() and r.admitted_until>pg_catalog.clock_timestamp()\n      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())\n      and bx1_portal.native_membership_effective(m.id)\n      and bx1_portal.fund_person(a.user_id)=a.person_id and s.authority_epoch=r.authority_epoch)) end;\n"
  },
  {
    "signature": "bx1_portal.test_offering_appointed(jsonb,uuid,text)",
    "sha": "ca41fba338f8a277704f103746ed76fa29e6d3aa3b7fe1de3e1da5eeebd92205",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.fund_roleplay_appointed(c,target_product,target_role) or (bx1_portal.test_offering_context(c) and c->>'role'=target_role\n    and target_role in ('IssuerFundManager','ComplianceOfficer')\n    and exists(select 1 from bx1_portal.product_service_appointments a\n      join public.bx1_memberships m on m.id=a.native_membership_id\n      where a.product_id=target_product and a.appointee_user_id=auth.uid() and a.role=target_role\n        and m.organisation_id::text=c->>'organisationId'\n        and bx1_portal.test_offering_appointment_effective(a.id)));\n"
  },
  {
    "signature": "bx1_portal.offering_workflow_product_appointment_authorised(jsonb,uuid,text)",
    "sha": "4664240e1cc5f8b04aac0d33fcbfbd02fe045554769b0f40c867b8208d34832c",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.fund_roleplay_appointed(c,target_product,target_role) or (case when exists(select 1 from bx1_portal.products p where p.id=target_product and bx1_portal.test_offering_is_source(p.organisation_id))\n    then bx1_portal.test_offering_appointed(c,target_product,target_role) else (case when bx1_portal.admission_password_session() is not true\n    then bx1_portal.product_appointment_authorised(c,target_product,target_role)\n    else bx1_portal.offering_workflow_context(c) and c->>'role'=target_role\n      and target_role in ('IssuerFundManager','ComplianceOfficer')\n      and exists(select 1 from bx1_portal.product_service_appointments a\n        join public.bx1_memberships m on m.id=a.native_membership_id\n        where a.product_id=target_product and a.role=target_role and a.appointee_user_id=auth.uid()\n          and m.organisation_id=(c->>'organisationId')::uuid\n          and bx1_portal.offering_workflow_product_appointment_effective(a.id)) end) end);\n"
  },
  {
    "signature": "bx1_portal.test_offering_product_visible(jsonb,uuid)",
    "sha": "bb8b51220560acd1c3ad9396afbfeb7158ca5eb71a51b233f36cf81be07c59bc",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select bx1_private.fund_roleplay_visible(c,target_product) or (bx1_portal.test_offering_context(c) and exists(select 1 from bx1_portal.products p\n    join bx1_portal.organisations o on o.id=p.organisation_id\n    where p.id=target_product and bx1_portal.test_offering_source_current(o.id)\n      and (p.current_offering_revision_id is null or bx1_portal.test_offering_revision_current(p.current_offering_revision_id))\n      and ((c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,o.id))\n        or bx1_portal.test_offering_appointed(c,p.id,c->>'role')\n        or (c->>'role'='ComplianceOfficer' and exists(select 1 from bx1_portal.product_service_appointments a\n          where a.product_id=p.id and a.status='SUBMITTED' and bx1_portal.test_offering_appointment_visible(c,a.id)))\n        or (c->>'role'='SuperAdmin' and exists(select 1 from bx1_portal.product_service_appointments a\n          where a.product_id=p.id and bx1_portal.test_offering_appointment_visible(c,a.id))))));\n"
  },
  {
    "signature": "bx1_portal.offering_workflow_issuer_authorised(jsonb,uuid)",
    "sha": "3fd98d229b2fba4e018afa343e1f142d655518638e0ffd6d27303fc1bac38a5b",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.products p\n    join bx1_portal.organisations o on o.id=p.organisation_id\n    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id\n    join public.bx1_memberships m on m.user_id=auth.uid()\n      and m.organisation_id=(c->>'organisationId')::uuid and m.role='IssuerFundManager'\n    where p.id=target_product and (bx1_portal.offering_workflow_context(c) or bx1_portal.offering_issuer_session_assured(c))\n      and bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'IssuerFundManager')\n      and bx1_portal.native_membership_effective(m.id)\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),p.created_by) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_offering_issuer'))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),o.owner_id) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_offering_issuer'))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_offering_issuer'))\n      and bx1_portal.test_offering_organisation_current(o.id)\n      and (not bx1_portal.test_offering_is_source(o.id) or bx1_portal.test_offering_revision_current(r.id))\n      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash\n      and not exists(select 1 from bx1_portal.offering_decisions d\n        where d.offering_revision_id=r.id and d.decision_kind='ISSUER'));\n"
  },
  {
    "signature": "bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)",
    "sha": "41729a719602c74a169e0c51878274990e5f1e25800ac384b2f86c9f18e9ffa1",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "declare actor uuid:=auth.uid(); a bx1_portal.product_service_appointments;\n  p bx1_portal.products; o bx1_portal.organisations;\n  m public.bx1_memberships;\n  previous bx1_portal.product_service_appointment_requests;\n  expired bx1_portal.product_service_appointments;\n  receipt_id uuid; decision text; requested_until timestamptz; target_product uuid;\nbegin\n  perform bx1_private.fund_roleplay_enter(c,bx1_portal.test_offering_target(action,body),action,key);\n  if bx1_portal.entry_manual_review_enabled() is not true\n    or bx1_portal.offering_workflow_command_context(c,action) is not true\n    or key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object'\n    or pg_catalog.octet_length(body::text)>8192 then\n    raise exception 'product_appointment_unavailable' using errcode='42501';\n  end if;\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  select * into previous from bx1_portal.product_service_appointment_requests\n    where actor_id=actor and request_key=key;\n  if previous.actor_id is not null then\n    if previous.command is distinct from action or previous.operating_context is distinct from c\n      or previous.payload is distinct from body then\n      raise exception 'product_appointment_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.scoped_requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key) then\n    raise exception 'product_appointment_prior_key_conflict' using errcode='23505'; end if;\n\n  if action='request_product_service_appointment' then\n    perform bx1_portal.require_keys(body,array['product_id','role','appointee_user_id',\n      'native_membership_id','expected_product_revision',\n      'evidence_reference','requested_until']);\n    perform bx1_portal.require_text(body,'evidence_reference',20,400);\n    if body->>'role' not in ('IssuerFundManager','ComplianceOfficer')\n      or pg_catalog.jsonb_typeof(body->'expected_product_revision') is distinct from 'number'\n      or body->>'expected_product_revision' !~ '^[1-9][0-9]{0,8}$' then\n      raise exception 'product_appointment_request_invalid' using errcode='22023'; end if;\n    requested_until:=(body->>'requested_until')::timestamptz;\n    if requested_until<=pg_catalog.clock_timestamp()+interval '1 hour'\n      or requested_until>pg_catalog.clock_timestamp()+interval '90 days' then\n      raise exception 'product_appointment_expiry_invalid' using errcode='22023'; end if;\n    select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;\n    if p.id is null or p.revision<>(body->>'expected_product_revision')::integer\n      or c->>'mode'<>'ROLE' or c->>'role'<>'OfferingManager'\n      or bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then\n      raise exception 'product_appointment_product_denied' using errcode='42501'; end if;\n    perform bx1_portal.offering_workflow_lock_product(c,p.id);\n    select * into o from bx1_portal.organisations where id=p.organisation_id for share;\n    select * into m from public.bx1_memberships where id=(body->>'native_membership_id')::uuid for share;\n    perform bx1_portal.offering_workflow_lock_people(array[actor,(body->>'appointee_user_id')::uuid]);\n    if m.id is null or m.user_id<>(body->>'appointee_user_id')::uuid\n      or m.role<>body->>'role' or bx1_portal.native_membership_effective(m.id) is not true\n      or not exists(select 1 from public.bx1_profiles profile\n        where profile.id=m.user_id and profile.status='ACTIVE')\n      or m.organisation_id<>o.reviewer_scope\n      or (bx1_portal.offering_workflow_people_independent(actor,m.user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true\n      or bx1_portal.test_offering_organisation_current(o.id) is not true then\n      raise exception 'product_appointment_target_denied' using errcode='42501'; end if;\n    -- An expired pending nomination cannot be reviewed or applied. Close it\n    -- with an immutable receipt in the same transaction as its replacement;\n    -- an unchanged retry returns the original request without expiring again.\n    for expired in select * from bx1_portal.product_service_appointments old\n      where old.product_id=p.id and old.role=body->>'role'\n        and old.status in ('SUBMITTED','APPROVED')\n        and old.requested_until<=pg_catalog.clock_timestamp()\n      order by old.id for update loop\n      update bx1_portal.product_service_appointments set status='EXPIRED',revision=revision+1\n        where id=expired.id;\n      insert into bx1_portal.product_service_appointment_receipts(appointment_id,appointment_revision,\n        action,actor_id,operating_context,command_payload,status_after)\n        values(expired.id,expired.revision+1,'expire_product_service_appointment',actor,c,\n          pg_catalog.jsonb_build_object('reason','REQUESTED_UNTIL_ELAPSED',\n            'replacement_request_key',key,'requested_until',expired.requested_until),'EXPIRED');\n      insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)\n        values(expired.id,expired.product_organisation_id,'expire_product_service_appointment',actor,\n          'Expired synthetic TEST product appointment closed before a new nomination. No authority was granted.');\n    end loop;\n    insert into bx1_portal.product_service_appointments(product_id,product_organisation_id,\n      reviewer_scope_organisation_id,role,appointee_user_id,native_membership_id,\n      requested_by_user_id,requested_in_context,\n      product_revision_at_request,terms_hash_at_request,evidence_reference,requested_until)\n      values(p.id,p.organisation_id,o.reviewer_scope,body->>'role',m.user_id,m.id,\n        actor,c,p.revision,p.terms_hash,body->>'evidence_reference',requested_until)\n      returning * into a;\n  else\n    if action='review_product_service_appointment' then\n      perform bx1_portal.require_keys(body,array['appointment_id','expected_revision',\n        'decision','notes','checks']);\n      perform bx1_portal.require_text(body,'notes',20,3000);\n      decision:=body->>'decision';\n      if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then\n        raise exception 'product_appointment_decision_invalid' using errcode='22023'; end if;\n      perform bx1_portal.require_checks(body->'checks',array['appointment','evidence','scope'],\n        decision='APPROVED');\n    elsif action='apply_product_service_appointment' then\n      perform bx1_portal.require_keys(body,array['appointment_id','expected_revision']);\n    elsif action='revoke_product_service_appointment' then\n      perform bx1_portal.require_keys(body,array['appointment_id','expected_revision','reason']);\n      perform bx1_portal.require_text(body,'reason',20,1000);\n    else\n      raise exception 'product_appointment_command_unknown' using errcode='22023'; end if;\n    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then\n      raise exception 'product_appointment_revision_invalid' using errcode='22023'; end if;\n    -- The offering-decision writer locks the product before the appointment.\n    -- Use the same order for review/apply/revoke to avoid inverse-lock cycles.\n    select product_id into target_product from bx1_portal.product_service_appointments\n      where id=(body->>'appointment_id')::uuid;\n    if target_product is null then\n      raise exception 'product_appointment_stale' using errcode='23514'; end if;\n    select * into p from bx1_portal.products where id=target_product for update;\n    perform bx1_portal.offering_workflow_lock_product(c,p.id);\n    select * into a from bx1_portal.product_service_appointments\n      where id=(body->>'appointment_id')::uuid for update;\n    if a.id is null or a.revision<>(body->>'expected_revision')::integer then\n      raise exception 'product_appointment_stale' using errcode='23514'; end if;\n    if p.id is distinct from a.product_id then\n      raise exception 'product_appointment_stale' using errcode='23514'; end if;\n    select * into o from bx1_portal.organisations where id=a.product_organisation_id for share;\n    select * into m from public.bx1_memberships where id=a.native_membership_id for share;\n    perform bx1_portal.offering_workflow_lock_people(array[actor,a.requested_by_user_id,\n      a.appointee_user_id,a.reviewed_by_user_id]);\n    if action='review_product_service_appointment' then\n      if a.status<>'SUBMITTED'\n        or a.requested_until<=pg_catalog.clock_timestamp()\n        or bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer') is not true\n        or (bx1_portal.offering_workflow_people_independent(actor,a.requested_by_user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true\n        or (bx1_portal.offering_workflow_people_independent(actor,a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n        raise exception 'product_appointment_review_denied' using errcode='42501'; end if;\n      if decision='APPROVED' and (m.organisation_id<>a.reviewer_scope_organisation_id\n        or bx1_portal.native_membership_effective(m.id) is not true\n        or not exists(select 1 from public.bx1_profiles profile\n          where profile.id=m.user_id and profile.status='ACTIVE')) then\n        raise exception 'product_appointment_target_changed' using errcode='42501'; end if;\n    elsif action='apply_product_service_appointment' then\n      if a.status<>'APPROVED' or a.approval_receipt_id is null\n        or a.requested_until<=pg_catalog.clock_timestamp()\n        or m.organisation_id<>a.reviewer_scope_organisation_id\n        or bx1_portal.native_membership_effective(m.id) is not true\n        or not exists(select 1 from public.bx1_profiles profile\n          where profile.id=m.user_id and profile.status='ACTIVE')\n        or bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'SuperAdmin') is not true\n        or (bx1_portal.offering_workflow_people_independent(actor,a.requested_by_user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true\n        or (bx1_portal.offering_workflow_people_independent(actor,a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true\n        or (bx1_portal.offering_workflow_people_independent(actor,a.reviewed_by_user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n        raise exception 'product_appointment_apply_denied' using errcode='42501'; end if;\n    elsif action='revoke_product_service_appointment' then\n      if a.status<>'APPLIED'\n        or bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'SuperAdmin') is not true\n        or (bx1_portal.offering_workflow_people_independent(actor,a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n        raise exception 'product_appointment_revoke_denied' using errcode='42501'; end if;\n    end if;\n    if action='review_product_service_appointment' then\n      insert into bx1_portal.product_service_appointment_receipts(appointment_id,appointment_revision,\n        action,actor_id,operating_context,command_payload,status_after)\n        values(a.id,a.revision+1,action,actor,c,body,decision) returning id into receipt_id;\n      update bx1_portal.product_service_appointments set revision=revision+1,status=decision,\n        reviewed_at=pg_catalog.clock_timestamp(),reviewed_by_user_id=actor,\n        review_notes=body->>'notes',review_checks=body->'checks',\n        approval_receipt_id=case when decision='APPROVED' then receipt_id else null end\n        where id=a.id returning * into a;\n    elsif action='apply_product_service_appointment' then\n      update bx1_portal.product_service_appointments set revision=revision+1,\n        status='APPLIED',applied_at=pg_catalog.clock_timestamp(),applied_by_user_id=actor\n        where id=a.id returning * into a;\n    elsif action='revoke_product_service_appointment' then\n      update bx1_portal.product_service_appointments set revision=revision+1,\n        status='REVOKED',revoked_at=pg_catalog.clock_timestamp(),\n        revoked_by_user_id=actor,revoke_reason=body->>'reason'\n        where id=a.id returning * into a;\n    end if;\n  end if;\n  if receipt_id is null then\n    insert into bx1_portal.product_service_appointment_receipts(appointment_id,appointment_revision,\n      action,actor_id,operating_context,command_payload,status_after)\n      values(a.id,a.revision,action,actor,c,body,a.status) returning id into receipt_id;\n  end if;\n  insert into bx1_portal.product_service_appointment_requests(actor_id,request_key,\n    command,operating_context,payload,appointment_id,receipt_id)\n    values(actor,key,action,c,body,a.id,receipt_id);\n  insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)\n    values(a.id,a.product_organisation_id,action,actor,\n      'Synthetic TEST product service appointment '||a.role||' '||a.status||\n      '. No signing, funding or publication authority.');\n  if bx1_portal.offering_workflow_command_context(c,action) is not true\n    or bx1_portal.entry_manual_review_enabled() is not true then\n    raise exception 'product_appointment_context_changed' using errcode='42501'; end if;\n  perform bx1_private.fund_roleplay_finish(c,p.id,action,key);\n  return bx1_portal.read_scoped(c);\nend"
  },
  {
    "signature": "bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)",
    "sha": "5a763dd2583a93e15aa814ae428efae615f84706bd5a0f3e394c31743e11b4f9",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "declare actor uuid:=auth.uid(); p bx1_portal.products; o bx1_portal.organisations;\n  r bx1_portal.offering_revisions; issuer bx1_portal.offering_decisions;\n  a bx1_portal.product_service_appointments; prior bx1_portal.scoped_requests;\n  decision text; original_revision integer;\nbegin\n  perform bx1_private.fund_roleplay_enter(c,bx1_portal.test_offering_target('review_product',body),'review_product',key);\n  if bx1_portal.entry_manual_review_enabled() is not true\n    or bx1_portal.offering_workflow_command_context(c,'review_product') is not true\n    or key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object'\n    or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'offering_compliance_appointment_required' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_actor('review_product',c);\n  select * into prior from bx1_portal.scoped_requests\n    where actor_id=actor and request_key=key;\n  if prior.actor_id is not null then\n    if prior.command is distinct from 'review_product'\n      or prior.operating_context is distinct from c or prior.payload is distinct from body then\n      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    perform bx1_portal.product_common_envelope_review_replay_authority(c,'COMPLIANCE',prior.payload);\n    return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.product_service_appointment_requests\n      where actor_id=actor and request_key=key) then\n    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;\n  if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n    perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n  else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;\n  if p.id is null then\n    raise exception 'offering_product_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;\n  select * into r from bx1_portal.offering_revisions\n    where id=p.current_offering_revision_id and product_id=p.id;\n  if o.id is null or r.id is null or r.origin<>'SUBMITTED' or p.status<>'IN_REVIEW'\n    or r.terms_hash is distinct from p.terms_hash or r.terms is distinct from p.terms\n    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'\n    or (body->>'expected_revision')::integer<>p.revision\n    or body->>'offering_revision_id' is distinct from r.id::text\n    or body->>'terms_hash' is distinct from r.terms_hash then\n    raise exception 'offering_stale_package' using errcode='23514'; end if;\n    if r.terms->'terms_version'='3'::jsonb then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n      if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'\n        or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'product_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'\n        or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'offering_revision_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'terms_hash') is distinct from 'string'\n        or body->>'terms_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'common_envelope_hash') is distinct from 'string'\n        or body->>'common_envelope_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'deployment_configuration_hash') is distinct from 'string'\n        or body->>'deployment_configuration_hash' !~ '^[0-9a-f]{64}$'\n        or body->>'common_envelope_hash' is distinct from r.common_envelope_hash\n        or body->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then\n        raise exception 'common_envelope_review_hash_mismatch' using errcode='23514'; end if;\n    else\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']);\n    end if;\n  perform bx1_portal.require_text(body,'notes',20,3000);\n  decision:=body->>'decision';\n  if decision not in ('APPROVED','CHANGES_REQUIRED') then\n    raise exception 'offering_decision_invalid' using errcode='22023'; end if;\n  original_revision:=p.revision;\n  select * into issuer from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='ISSUER';\n  if exists(select 1 from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='COMPLIANCE') then\n    raise exception 'offering_decision_already_recorded' using errcode='23514'; end if;\n  select * into a from bx1_portal.product_service_appointments appointed\n    where appointed.product_id=p.id and appointed.role='ComplianceOfficer'\n      and appointed.appointee_user_id=actor and appointed.status='APPLIED'\n    order by appointed.id limit 1 for share;\n  if a.id is null then\n    raise exception 'offering_compliance_appointment_required' using errcode='42501'; end if;\n  perform m.id from public.bx1_memberships m where m.id=a.native_membership_id for share;\n  perform profile.id from public.bx1_profiles profile where profile.id=actor for share;\n  perform bx1_portal.offering_workflow_lock_lineage_people(p.id,r.terms_hash,\n    array[actor,r.submitted_by,p.created_by,o.owner_id,\n      issuer.actor_id,a.requested_by_user_id,a.reviewed_by_user_id,a.applied_by_user_id]);\n  if bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer') is not true\n    or bx1_portal.test_offering_organisation_current(o.id) is not true\n    or (bx1_portal.offering_workflow_lineage_independent(actor,p.id,r.terms_hash) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product')) is not true\n    or (bx1_portal.offering_workflow_people_independent(actor,p.created_by) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product')) is not true\n    or (bx1_portal.offering_workflow_people_independent(actor,o.owner_id) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product')) is not true\n    or (issuer.id is not null and\n      (bx1_portal.offering_workflow_people_independent(actor,issuer.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product')) is not true) then\n    raise exception 'offering_compliance_appointment_required' using errcode='42501'; end if;\n  -- The base transition preserves revision/state/check validation and its\n  -- product/request/event audit path. Its reviewer predicate checks the\n  -- native Compliance scope, not a customer-wide authority binding.\n  if bx1_portal.admission_password_session() or bx1_portal.test_offering_is_source(o.id) then\n    perform bx1_portal.offering_workflow_base_command(c,'review_product',key,body-'offering_revision_id'-'terms_hash'-'common_envelope_hash'-'deployment_configuration_hash');\n  else perform bx1_portal.execute_command('review_product',key,body-'offering_revision_id'-'terms_hash'-'common_envelope_hash'-'deployment_configuration_hash'); end if;\n  insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n    actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n    values(r.id,'COMPLIANCE',decision,actor,c,r.terms_hash,r.document_hashes,\n      original_revision,body->>'notes',body->'checks');\n  if decision='APPROVED' and coalesce(issuer.decision,'PENDING')<>'APPROVED' then\n    update bx1_portal.products set status='IN_REVIEW' where id=p.id;\n  end if;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)\n    values(actor,key,c,'review_product',body);\n  if bx1_portal.offering_workflow_command_context(c,'review_product') is not true\n    or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer') is not true then\n    raise exception 'offering_compliance_authority_changed' using errcode='42501'; end if;\n  perform bx1_private.fund_roleplay_finish(c,p.id,'review_product',key);\n  return bx1_portal.read_scoped(c);\nend"
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "sha": "11003d1b4bafcda12e3ce9012b7e52fcb4b8d75174d9c2072fa393e60c1eb97c",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "declare actor uuid:=auth.uid(); p bx1_portal.products; o bx1_portal.organisations;\n  r bx1_portal.offering_revisions; d bx1_portal.offering_decisions;\n  prior bx1_portal.scoped_requests; original_revision integer; decision text; counter integer;\nbegin\n  if action='review_offering_issuer' then perform bx1_private.fund_roleplay_enter(c,bx1_portal.test_offering_target(action,body),action,key);end if;\n  if bx1_portal.admission_password_session() and action='review_product' then\n    return bx1_portal.execute_appointed_compliance_decision(c,key,body); end if;\n  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n  if action not in ('save_product','submit_product','review_product','review_offering_issuer',\n    'publish_product','subscribe') then\n    return bx1_portal.offering_workflow_parent_command(c,action,key,body); end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true or\n    key is null or key='00000000-0000-0000-0000-000000000000' or\n    pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'offering_context_or_command_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;\n  if prior.actor_id is not null then\n    if prior.operating_context is distinct from c or prior.command is distinct from action\n      or prior.payload is distinct from body then\n      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;\n    if action='review_offering_issuer' then\n      perform bx1_portal.product_common_envelope_review_replay_authority(c,'ISSUER',prior.payload);\n    end if;\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key) then\n    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;\n\n  if action='subscribe' then\n    perform bx1_portal.require_keys(body,array['product_id','expected_revision','terms_hash','units',\n      'accepted_documents','accepted_risks','investment_account_id','offering_revision_id']);\n  elsif action='review_product' then\n    if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  elsif action='review_offering_issuer' then\n    if body ? 'common_envelope_hash' or body ? 'deployment_configuration_hash' then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n    else perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']); end if;\n  end if;\n  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;\n  if p.id is null then raise exception 'offering_product_denied' using errcode='42501'; end if;\n  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;\n  perform id from bx1_portal.organisation_authority_bindings\n    where product_organisation_id=o.id order by id for share;\n  original_revision:=p.revision;\n  if action in ('review_product','review_offering_issuer','subscribe','publish_product') then\n    select * into r from bx1_portal.offering_revisions\n      where id=p.current_offering_revision_id and product_id=p.id;\n    if r.id is null or r.origin<>'SUBMITTED' or r.terms_hash is distinct from p.terms_hash\n      or r.terms is distinct from p.terms then\n      raise exception 'offering_current_package_required' using errcode='23514'; end if;\n  end if;\n\n  if action='review_product' or action='review_offering_issuer' then\n    if r.terms->'terms_version'='3'::jsonb then\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks','common_envelope_hash','deployment_configuration_hash']);\n      if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'\n        or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'product_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'\n        or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n        or body->>'offering_revision_id'='00000000-0000-0000-0000-000000000000'\n        or pg_catalog.jsonb_typeof(body->'terms_hash') is distinct from 'string'\n        or body->>'terms_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'common_envelope_hash') is distinct from 'string'\n        or body->>'common_envelope_hash' !~ '^[0-9a-f]{64}$'\n        or pg_catalog.jsonb_typeof(body->'deployment_configuration_hash') is distinct from 'string'\n        or body->>'deployment_configuration_hash' !~ '^[0-9a-f]{64}$'\n        or body->>'common_envelope_hash' is distinct from r.common_envelope_hash\n        or body->>'deployment_configuration_hash' is distinct from r.deployment_configuration_hash then\n        raise exception 'common_envelope_review_hash_mismatch' using errcode='23514'; end if;\n    else\n      perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id','terms_hash','decision','notes','checks']);\n    end if;\n    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'\n      or (body->>'expected_revision')::integer<>p.revision\n      or body->>'offering_revision_id' is distinct from r.id::text\n      or body->>'terms_hash' is distinct from r.terms_hash then\n      raise exception 'offering_stale_package' using errcode='23514'; end if;\n    perform bx1_portal.require_text(body,'notes',20,3000);\n    decision:=body->>'decision';\n    if decision not in ('APPROVED','CHANGES_REQUIRED') then\n      raise exception 'offering_decision_invalid' using errcode='22023'; end if;\n  end if;\n\n  if action='save_product' then\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n    update bx1_portal.products set current_offering_revision_id=null where id=p.id;\n  elsif action='submit_product' then\n    select * into r from bx1_portal.offering_revisions\n      where product_id=p.id and origin='SUBMITTED' order by package_number desc limit 1;\n    if r.id is not null and r.terms_hash=p.terms_hash then\n      raise exception 'offering_unchanged_resubmission' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n    select * into p from bx1_portal.products where id=p.id;\n    select coalesce(max(package_number),0)+1 into counter\n      from bx1_portal.offering_revisions where product_id=p.id;\n    insert into bx1_portal.offering_revisions(product_id,package_number,origin,\n      product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)\n      values(p.id,counter,'SUBMITTED',p.revision,p.terms,p.terms_hash,\n        bx1_portal.offering_document_hashes(p.terms),actor,pg_catalog.clock_timestamp()) returning * into r;\n    update bx1_portal.products set current_offering_revision_id=r.id where id=p.id;\n  elsif action='review_product' then\n    if r.terms->'terms_version'='3'::jsonb then\n      raise exception 'common_envelope_private_compliance_denied' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true\n      or (bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_compliance_scope_denied' using errcode='42501'; end if;\n    select * into d from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='ISSUER';\n    perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    if bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true\n      or (bx1_portal.offering_workflow_people_independent(actor,r.submitted_by) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_compliance_authority_changed' using errcode='42501'; end if;\n    if d.id is not null and (bx1_portal.offering_workflow_people_independent(actor,d.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_independent_review_required' using errcode='42501'; end if;\n    if exists(select 1 from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='COMPLIANCE') then\n      raise exception 'offering_decision_already_recorded' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,\n      body-'offering_revision_id'-'terms_hash');\n    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n      values(r.id,'COMPLIANCE',decision,actor,c,r.terms_hash,r.document_hashes,\n        original_revision,body->>'notes',body->'checks');\n    -- The inherited reviewer writer labels Compliance-only approval APPROVED.\n    -- Correct the enduring product state in the same transaction: the entire\n    -- offering is approved only after the separately appointed issuer agrees.\n    if decision='APPROVED' and coalesce(d.decision,'PENDING')<>'APPROVED' then\n      update bx1_portal.products set status='IN_REVIEW' where id=p.id;\n    end if;\n  elsif action='review_offering_issuer' then\n    perform bx1_portal.require_checks(body->'checks',array['issuer_authority','terms','rights'],decision='APPROVED');\n    if p.status not in ('IN_REVIEW','APPROVED') or bx1_portal.offering_workflow_issuer_authorised(c,p.id) is not true then\n      raise exception 'offering_issuer_appointment_required' using errcode='42501'; end if;\n    -- Pin the native appointment source through commit. A concurrent role or\n    -- organisation suspension cannot race the independently recorded choice.\n    perform m.id from public.bx1_memberships m\n      where m.user_id=actor and m.organisation_id=(c->>'organisationId')::uuid\n        and m.role='IssuerFundManager' order by m.id for share;\n    perform n.id from public.bx1_organisations n\n      where n.id=(c->>'organisationId')::uuid for share;\n    select * into d from bx1_portal.offering_decisions\n      where offering_revision_id=r.id and decision_kind='COMPLIANCE';\n    perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);\n    if d.id is not null and (bx1_portal.offering_workflow_people_independent(actor,d.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,action)) is not true then\n      raise exception 'offering_independent_issuer_required' using errcode='42501'; end if;\n    if bx1_portal.offering_workflow_command_context(c,action) is not true or\n      bx1_portal.offering_workflow_issuer_authorised(c,p.id) is not true then\n      raise exception 'offering_issuer_authority_changed' using errcode='42501'; end if;\n    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,\n      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)\n      values(r.id,'ISSUER',decision,actor,c,r.terms_hash,r.document_hashes,\n        original_revision,body->>'notes',body->'checks');\n    update bx1_portal.products set revision=revision+1,\n      status=case when decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'\n        when d.decision='APPROVED' then 'APPROVED' else 'IN_REVIEW' end\n      where id=p.id;\n    insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)\n      values(r.id,p.organisation_id,action,actor,\n        'Appointed issuer decided exact immutable test offering package: '||decision||'. No publication or chain deployment.');\n    insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)\n      values(actor,key,c,action,body);\n  elsif action='publish_product' then\n    if bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then\n      raise exception 'offering_operator_denied' using errcode='42501'; end if;\n    if bx1_portal.offering_approved(p.id) is not true then\n      raise exception 'offering_issuer_and_compliance_approval_required' using errcode='23514'; end if;\n    if bx1_portal.offering_technical_ready(r.id) is not true then\n      raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body);\n  elsif action='subscribe' then\n    if body->>'offering_revision_id' is distinct from r.id::text\n      or body->>'terms_hash' is distinct from r.terms_hash\n      or bx1_portal.scoped_product_visible(c,p.id) is not true\n      or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true then\n      raise exception 'offering_not_open' using errcode='42501'; end if;\n    perform bx1_portal.offering_workflow_parent_command(c,action,key,body-'offering_revision_id');\n  end if;\n  if bx1_portal.offering_workflow_command_context(c,action) is not true then\n    raise exception 'offering_context_changed' using errcode='42501'; end if;\n  perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\nend"
  },
  {
    "signature": "bx1_portal.offering_workflow_appointment_projection(jsonb,uuid)",
    "sha": "c574ec627f8cc9cffa2aa8836e1d8108f8632ef69a855a89876ce67f8bd1500d",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare a bx1_portal.product_service_appointments;\n  is_manager boolean; is_reviewer boolean; is_admin boolean; is_appointee boolean;\nbegin\n  if (bx1_portal.valid_operating_context(c) or bx1_portal.offering_workflow_context(c)) is not true then return null; end if;\n  select * into a from bx1_portal.product_service_appointments where id=target_id;\n  if a.id is null then return null; end if;\n  is_manager:=a.requested_by_user_id=auth.uid() and c=a.requested_in_context\n    and bx1_portal.offering_workflow_operator(c,a.product_organisation_id);\n  is_reviewer:=c->>'role'='ComplianceOfficer' and\n    bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer');\n  is_admin:=c->>'role'='SuperAdmin' and\n    bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'SuperAdmin');\n  is_appointee:=a.appointee_user_id=auth.uid() and c->>'mode'='ROLE' and c->>'role'=a.role\n    and c->>'organisationId'=(select m.organisation_id::text from public.bx1_memberships m\n      where m.id=a.native_membership_id);\n  if not(is_manager or is_reviewer or is_admin or is_appointee) then return null; end if;\n  return pg_catalog.jsonb_build_object(\n    'id',a.id,'product_id',a.product_id,'product_organisation_id',a.product_organisation_id,\n    'reviewer_scope_organisation_id',a.reviewer_scope_organisation_id,\n    'role',a.role,'appointee_user_id',a.appointee_user_id,\n    'native_membership_id',a.native_membership_id,\n    'requested_by_user_id',a.requested_by_user_id,\n    'product_revision_at_request',a.product_revision_at_request,\n    'terms_hash_at_request',a.terms_hash_at_request,'evidence_reference',a.evidence_reference,\n    'requested_until',a.requested_until,'status',a.status,'revision',a.revision,\n    'requested_at',a.requested_at,'reviewed_at',a.reviewed_at,\n    'reviewed_by_user_id',a.reviewed_by_user_id,'review_notes',a.review_notes,\n    'approval_receipt_id',a.approval_receipt_id,'applied_at',a.applied_at,\n    'applied_by_user_id',a.applied_by_user_id,'revoked_at',a.revoked_at,\n    'revoke_reason',a.revoke_reason,'effective',bx1_portal.offering_workflow_product_appointment_effective(a.id),\n    'next_owner',case when a.status in ('SUBMITTED','APPROVED')\n        and a.requested_until<=pg_catalog.clock_timestamp() then 'OFFERING_MANAGER'\n      when a.status='SUBMITTED' then 'COMPLIANCE'\n      when a.status='APPROVED' then 'SUPER_ADMIN'\n      when a.status='APPLIED' and bx1_portal.offering_workflow_product_appointment_effective(a.id) is not true\n        then 'SUPER_ADMIN'\n      when a.status in ('CHANGES_REQUIRED','REJECTED') then 'OFFERING_MANAGER'\n      else 'NONE' end,\n    'can_review',is_reviewer and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='SUBMITTED'\n      and a.requested_until>pg_catalog.clock_timestamp()\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end)),\n    'can_apply',is_admin and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='APPROVED'\n      and a.requested_until>pg_catalog.clock_timestamp()\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.reviewed_by_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end))\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end)),\n    'can_revoke',not bx1_portal.admission_password_session() and is_admin and a.status='APPLIED'\n      and (bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id) or bx1_private.fund_roleplay_review_exception(c,a.product_id,case c->>'role' when 'ComplianceOfficer' then 'review_product_service_appointment' when 'SuperAdmin' then 'apply_product_service_appointment' else 'request_product_service_appointment' end)));\nend "
  },
  {
    "signature": "bx1_portal.offering_workflow_package_projection(jsonb,uuid)",
    "sha": "faf405929a6c338229ed5da06e8cf71daf3240e7f558b206f9cb6c3f8e3f8f0b",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare result jsonb; p bx1_portal.products; r bx1_portal.offering_revisions;\n  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;\n  appointed boolean; can_review boolean;\nbegin\n  result:=bx1_portal.offering_workflow_package_projection_base(c,target_product);\n  if result is null then return null; end if;\n  select * into p from bx1_portal.products where id=target_product;\n  select * into r from bx1_portal.offering_revisions\n    where id=p.current_offering_revision_id and product_id=p.id;\n  select * into issuer from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='ISSUER';\n  select * into compliance from bx1_portal.offering_decisions\n    where offering_revision_id=r.id and decision_kind='COMPLIANCE';\n  appointed:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer');\n  can_review:=appointed and p.status='IN_REVIEW' and compliance.id is null\n    and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms\n    and (bx1_portal.offering_workflow_lineage_independent(auth.uid(),p.id,r.terms_hash) or bx1_private.fund_roleplay_review_exception(c,p.id,case c->>'role' when 'IssuerFundManager' then 'review_offering_issuer' else 'review_product' end))\n    and (bx1_portal.offering_workflow_people_independent(auth.uid(),p.created_by) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product'))\n    and (bx1_portal.offering_workflow_people_independent(auth.uid(),\n      (select o.owner_id from bx1_portal.organisations o where o.id=p.organisation_id)) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product'))\n    and (issuer.id is null or (bx1_portal.offering_workflow_people_independent(auth.uid(),issuer.actor_id) or bx1_private.fund_roleplay_review_exception(c,p.id,'review_product')));\n  result:=pg_catalog.jsonb_set(result,'{can_review_compliance}',pg_catalog.to_jsonb(can_review));\n  if coalesce((result->>'can_review_issuer')::boolean,false)\n    and (bx1_portal.offering_workflow_lineage_independent(auth.uid(),p.id,r.terms_hash) or bx1_private.fund_roleplay_review_exception(c,p.id,case c->>'role' when 'IssuerFundManager' then 'review_offering_issuer' else 'review_product' end)) is not true then\n    result:=pg_catalog.jsonb_set(result,'{can_review_issuer}','false'::jsonb);\n  end if;\n  if appointed then\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}',\n      coalesce(pg_catalog.to_jsonb(issuer.notes),'null'::jsonb));\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}',\n      coalesce(pg_catalog.to_jsonb(issuer.checks),'null'::jsonb));\n  elsif bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}','null'::jsonb);\n    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}','null'::jsonb);\n  end if;\n  return result;\nend "
  },
  {
    "signature": "bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)",
    "sha": "16318656f954b13a619891f6db69616300acd36c22d74c24619162a85df383da",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare target uuid; p bx1_portal.products; o bx1_portal.organisations;\n  e bx1_private.test_workspace_entitlements; a bx1_portal.product_service_appointments; result jsonb;\nbegin\n  target:=bx1_portal.test_offering_target(action,body);\n  if target is null or key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536\n    or bx1_portal.test_offering_context(c) is not true\n    or bx1_portal.offering_workflow_command_allowed(c,action) is not true then\n    raise exception 'test_offering_command_denied' using errcode='42501'; end if;\n  perform bx1_private.fund_roleplay_enter(c,target,action,key);\n  perform bx1_portal.offering_workflow_lock_actor(action,c);\n  perform bx1_portal.test_offering_lock_product_context(c,target);\n  select * into p from bx1_portal.products where id=target;\n  select * into o from bx1_portal.organisations where id=p.organisation_id;\n  select * into e from bx1_private.test_workspace_entitlements where id=bx1_portal.test_offering_source_entitlement(o.id);\n  if action='request_product_service_appointment' then\n    if c->>'role'<>'OfferingManager' or bx1_portal.offering_workflow_operator(c,o.id) is not true then\n      raise exception 'test_offering_nomination_denied' using errcode='42501'; end if;\n  elsif action in ('review_product_service_appointment','apply_product_service_appointment') then\n    select * into a from bx1_portal.product_service_appointments where id=(body->>'appointment_id')::uuid for share;\n    if a.product_id is distinct from p.id or bx1_portal.test_offering_appointment_current(a.id) is not true\n      or bx1_portal.offering_workflow_staff(c,o.reviewer_scope,\n        case action when 'review_product_service_appointment' then 'ComplianceOfficer' else 'SuperAdmin' end) is not true then\n      raise exception 'test_offering_appointment_command_denied' using errcode='42501'; end if;\n  elsif action in ('review_offering_issuer','review_product') then\n    if p.current_offering_revision_id is null or bx1_portal.test_offering_revision_current(p.current_offering_revision_id) is not true\n      or bx1_portal.test_offering_appointed(c,p.id,case action when 'review_product' then 'ComplianceOfficer' else 'IssuerFundManager' end) is not true then\n      raise exception 'test_offering_review_appointment_required' using errcode='42501'; end if;\n  else raise exception 'test_offering_command_denied' using errcode='42501'; end if;\n  insert into bx1_private.test_workspace_product_commands(transaction_id,actor_id,session_id,entitlement_id,\n    entitlement_revision,operating_context,product_organisation_id,command,request_key,target_product_id)\n    values(pg_catalog.pg_current_xact_id(),auth.uid(),(auth.jwt()->>'session_id')::uuid,e.id,e.revision,c,o.id,action,key,p.id);\n  -- Existing guarded business writers remain the only writers.\n  result:=bx1_portal.offering_workflow_command(c,action,key,body);\n  if bx1_portal.test_offering_source_current(o.id,e.id,e.revision) is not true\n    or bx1_portal.test_offering_context(c) is not true\n    or bx1_portal.offering_workflow_command_allowed(c,action) is not true then\n    raise exception 'test_offering_authority_changed_after_wait' using errcode='42501'; end if;\n  delete from bx1_private.test_workspace_product_commands where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();\n  perform bx1_private.fund_roleplay_finish(c,target,action,key);\n  return result;\nend "
  },
  {
    "signature": "bx1_private.test_roleplay_role_actions(text)",
    "sha": "c7e08311fb65685ca9ff3adf8f043e7c45309423b507bc9031b2ba26f12d32c0",
    "secdef": false,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select case p_role\n    when 'Investor' then array['open_funding_obligation','cancel_subscription','request_product_eligibility','subscribe','bind_fund_delivery_wallet','request_fund_payment_allocation_basis','prepare_fund_payment','submit_fund_payment','record_fund_payment','submit_funding_reference','verify_funding_reference']\n    when 'OfferingManager' then array['admit_fund_release','FUND_SETUP','create_product','save_product','submit_product','request_product_service_appointment','REQUEST_PURPOSE']\n    when 'IssuerFundManager' then array['review_offering_issuer','approve_fund_payment_allocation_basis','request_fund_allocation','PREPARE_EXECUTION','REQUEST_SIGNING_VIEW']\n    when 'ComplianceOfficer' then array['review_product_service_appointment','review_product','review_product_eligibility','revoke_product_eligibility','REVIEW_PURPOSE','REVOKE_PURPOSE']\n    when 'TransferAgent' then array['approve_fund_allocation']\n    when 'TokenisationAgent' then array['bind_roleplay_signer','admit_fund_release','FUND_SETUP','request_fund_deployment','approve_fund_deployment','prepare_fund_transaction','record_fund_signature','claim_fund_execution','record_fund_transaction','request_fund_issuance','approve_fund_issuance','cancel_fund_operation']\n    when 'TreasuryOperator' then array['verify_funding_route','revoke_funding_route','verify_funding_reference','propose_funding_route','open_funding_obligation','propose_funding_acceptance','propose_funding_exception','propose_funding_reversal']\n    when 'FinancialController' then array['verify_funding_route','verify_funding_reference','approve_funding_route','reconcile_funding','resolve_funding_exception','approve_funding_reversal']\n    when 'SuperAdmin' then array['apply_product_service_appointment','read_test_roleplay','revoke_test_roleplay']\n    else array[]::text[] end;\n"
  },
  {
    "signature": "bx1_private.execute_offering_signature_command(uuid,uuid,text,jsonb,text,uuid,jsonb,jsonb)",
    "sha": "1b2718ae728caab66d3eaaf8e38f26f9ca71347b26070b1338d58da2bf367e18",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,bx1_document_receipt_writer=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare p bx1_portal.products; r bx1_portal.offering_revisions; m bx1_private.offering_document_manifests;\n  d bx1_portal.product_issuer_declarations; ap bx1_portal.product_service_appointments;\n  a bx1_private.offering_signature_authorisations; e bx1_private.offering_signature_authorisation_events;\n  o bx1_private.offering_signature_operations; policy bx1_private.offering_signature_policy;\n  prior bx1_private.offering_signature_command_receipts; rp_policy uuid; person uuid; signer_person uuid; target uuid; approval uuid;\n  fields text[]; latest_state text; at timestamptz:=pg_catalog.clock_timestamp(); result jsonb; action jsonb;\nbegin\n  if p_command is null or p_command not in ('REQUEST_PURPOSE','REVIEW_PURPOSE','REVOKE_PURPOSE','PREPARE_EXECUTION',\n      'REQUEST_RECONCILIATION','REQUEST_RECOVERY','REQUEST_SIGNING_VIEW') or p_key is null\n    or p_key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'\n    or pg_catalog.octet_length(p_payload::text)>16384 then raise exception 'offering_signature_command_invalid' using errcode='22023'; end if;\n  fields:=array['product_id','offering_revision_id','expected_revision']||case p_command\n    when 'REQUEST_PURPOSE' then array['appointment_id','valid_from','valid_until','source_reference','source_sha256']\n    when 'REVIEW_PURPOSE' then array['authorisation_id','decision','reason']\n    when 'REVOKE_PURPOSE' then array['authorisation_id','reason']\n    when 'PREPARE_EXECUTION' then array['authorisation_id']\n    when 'REQUEST_RECOVERY' then array['operation_id','reason'] else array['operation_id'] end;\n  perform bx1_portal.require_keys(p_payload,fields);\n  if pg_catalog.jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'\n    or p_payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'offering_signature_command_invalid' using errcode='22023'; end if;\n  perform bx1_private.offering_signature_lock_context(p_actor,p_session,p_aal,p_context,(p_payload->>'offering_revision_id')::uuid,p_attestation);\n  select * into p from bx1_portal.products where id=(p_payload->>'product_id')::uuid for update;\n  select * into r from bx1_portal.offering_revisions where id=(p_payload->>'offering_revision_id')::uuid;\n  select * into policy from bx1_private.offering_signature_policy where singleton for share;\n  if p.id is null or r.product_id is distinct from p.id or p.current_offering_revision_id is distinct from r.id\n    or p.terms is distinct from r.terms or r.terms->'terms_version' is distinct from '3'::jsonb\n    or r.terms->>'asset_type' not in ('FUND','REAL_ESTATE') or bx1_private.offering_signature_admitted() is not true then\n    raise exception 'offering_signature_scope_denied' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_enter(p_context,p.id,p_command,p_key);\n  person:=case when rp_policy is null then bx1_private.document_governance_trusted_person(p_actor,null) else bx1_private.fund_roleplay_person_for(p.id,p_actor) end;\n  if person is null then raise exception 'offering_signature_trusted_person_required' using errcode='42501'; end if;\n  select * into prior from bx1_private.offering_signature_command_receipts where actor_id=p_actor and request_key=p_key;\n  if prior.actor_id is not null then\n    if prior.command<>p_command or prior.operating_context is distinct from p_context or prior.payload is distinct from p_payload then\n      raise exception 'offering_signature_request_conflict' using errcode='23505'; end if;\n    -- Replay still needs present capability. A VIEW URL is never replayed.\n    result:=bx1_private.offering_signature_snapshot(p_context,r.id);\n    if not(result->'allowed_commands' ? p_command) then raise exception 'offering_signature_replay_denied' using errcode='42501'; end if;\n    if p_command in ('PREPARE_EXECUTION','REQUEST_SIGNING_VIEW') then\n      select au.* into a from bx1_private.offering_signature_authorisations au\n        left join bx1_private.offering_signature_operations op on op.authorisation_id=au.id\n        where (p_command='PREPARE_EXECUTION' and au.id=(p_payload->>'authorisation_id')::uuid)\n          or (p_command='REQUEST_SIGNING_VIEW' and op.id=(p_payload->>'operation_id')::uuid) limit 1;\n      if a.id is null or a.signer_id<>p_actor or a.signer_person_id<>person\n        or bx1_private.offering_signature_authorisation_current(a.id) is not true then\n        raise exception 'offering_signature_replay_authority_changed' using errcode='42501'; end if;\n    end if;\n    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(p_context,p.id,p_command,p_key);end if;\n    return result;\n  end if;\n  if exists(select 1 from bx1_portal.scoped_requests where actor_id=p_actor and request_key=p_key)\n    or exists(select 1 from bx1_portal.requests where actor_id=p_actor and request_key=p_key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=p_actor and request_key=p_key)\n    or exists(select 1 from bx1_private.offering_document_command_receipts where actor_id=p_actor and request_key=p_key) then\n    raise exception 'offering_signature_request_conflict' using errcode='23505'; end if;\n  if p.revision<>(p_payload->>'expected_revision')::integer then raise exception 'offering_signature_stale' using errcode='23514'; end if;\n  result:=bx1_private.offering_signature_snapshot(p_context,r.id);\n  if not(result->'allowed_commands' ? p_command) then raise exception 'offering_signature_command_denied' using errcode='42501'; end if;\n  select * into m from bx1_private.offering_document_manifests where offering_revision_id=r.id;\n  if p_command='REQUEST_PURPOSE' then\n    select * into ap from bx1_portal.product_service_appointments where id=(p_payload->>'appointment_id')::uuid for share;\n    select * into d from bx1_portal.product_issuer_declarations where product_id=p.id\n      and issuer_reference=r.issuer_declaration_reference and declaration_revision=r.issuer_declaration_revision;\n    signer_person:=case when rp_policy is null then bx1_private.document_governance_trusted_person(ap.appointee_user_id,null)\n      when ap.roleplay_policy_id=rp_policy and ap.roleplay_epoch=(select authority_epoch from bx1_private.roleplay_policies where id=rp_policy)\n        and ap.appointee_user_id=p_actor then bx1_private.fund_roleplay_person_for(p.id,ap.appointee_user_id) end;\n    perform bx1_portal.require_text(p_payload,'source_reference',20,1000);\n    if ap.id is null or ap.product_id<>p.id or ap.role<>'IssuerFundManager' or ap.status<>'APPLIED'\n      or bx1_portal.offering_workflow_product_appointment_effective(ap.id) is not true or signer_person is null\n      or d.product_id is null or m.id is null\n      or not exists(select 1 from bx1_portal.product_service_appointment_receipts receipt where receipt.id=ap.approval_receipt_id\n        and receipt.appointment_id=ap.id and receipt.action='review_product_service_appointment' and receipt.status_after='APPROVED')\n      or coalesce(p_payload->>'source_sha256','') !~ '^[0-9a-f]{64}$'\n      or not pg_catalog.isfinite((p_payload->>'valid_from')::timestamptz) or not pg_catalog.isfinite((p_payload->>'valid_until')::timestamptz)\n      or (p_payload->>'valid_until')::timestamptz<=at or (p_payload->>'valid_until')::timestamptz>ap.requested_until\n      or (p_payload->>'valid_until')::timestamptz<=(p_payload->>'valid_from')::timestamptz then\n      raise exception 'offering_signature_purpose_binding_denied' using errcode='42501'; end if;\n    insert into bx1_private.offering_signature_authorisations(product_id,revision_id,manifest_id,manifest_hash,terms_hash,document_hashes,\n      common_envelope_hash,deployment_configuration_hash,issuer_reference,declaration_revision,declaration_hash,manager_organisation_id,\n      acting_organisation_id,requester_id,requester_person_id,signer_id,signer_person_id,appointment_id,appointment_receipt_id,\n      valid_from,valid_until,source_reference,source_sha256)\n      values(p.id,r.id,m.id,m.hash,r.terms_hash,r.document_hashes,r.common_envelope_hash,r.deployment_configuration_hash,\n      d.issuer_reference,d.declaration_revision,d.declaration_hash,p.organisation_id,ap.reviewer_scope_organisation_id,p_actor,person,\n      ap.appointee_user_id,signer_person,ap.id,ap.approval_receipt_id,(p_payload->>'valid_from')::timestamptz,\n      (p_payload->>'valid_until')::timestamptz,p_payload->>'source_reference',p_payload->>'source_sha256') returning * into a;\n  elsif p_command in ('REVIEW_PURPOSE','REVOKE_PURPOSE','PREPARE_EXECUTION') then\n    select * into a from bx1_private.offering_signature_authorisations where id=(p_payload->>'authorisation_id')::uuid for update;\n    if a.id is null or a.product_id<>p.id or a.revision_id<>r.id or a.manifest_id<>m.id\n      or (rp_policy is not null and (a.roleplay_policy_id is distinct from rp_policy\n        or a.roleplay_epoch is distinct from (select authority_epoch from bx1_private.roleplay_policies where id=rp_policy))) then raise exception 'offering_signature_authorisation_denied' using errcode='42501'; end if;\n    select * into e from bx1_private.offering_signature_authorisation_events where authorisation_id=a.id order by event_number desc limit 1;\n    if p_command='REVIEW_PURPOSE' then\n    perform bx1_portal.require_text(p_payload,'reason',20,1000);\n      if e.id is not null or p_payload->>'decision' not in ('APPROVED','REJECTED')\n        or (person in (a.requester_person_id,a.signer_person_id) and (rp_policy is null or rp_policy is distinct from a.roleplay_policy_id\n          or bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,p_actor,p_context,'REVIEW_PURPOSE') is not true))\n        or bx1_private.fund_roleplay_document_person(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,a.requester_id,a.requester_person_id,\n          a.roleplay_context,'REQUEST_PURPOSE') is distinct from a.requester_person_id\n        or bx1_private.fund_roleplay_document_person(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,a.signer_id,a.signer_person_id,\n          pg_catalog.jsonb_build_object('mode','ROLE','organisationId',(select native_organisation_id from bx1_private.roleplay_policies where id=a.roleplay_policy_id),'role','IssuerFundManager'),'PREPARE_EXECUTION') is distinct from a.signer_person_id then\n        raise exception 'offering_signature_independent_purpose_denied' using errcode='42501'; end if;\n      select * into ap from bx1_portal.product_service_appointments where product_id=p.id and appointee_user_id=p_actor\n        and role='ComplianceOfficer' and bx1_portal.offering_workflow_product_appointment_effective(id) order by id limit 1 for share;\n      if ap.id is null then raise exception 'offering_signature_compliance_denied' using errcode='42501'; end if;\n      insert into bx1_private.offering_signature_authorisation_events(authorisation_id,event_number,state,actor_id,person_id,appointment_id,reason)\n        values(a.id,1,p_payload->>'decision',p_actor,person,ap.id,p_payload->>'reason');\n      if p_payload->>'decision'='APPROVED' and bx1_private.offering_signature_authorisation_current(a.id) is not true then\n        raise exception 'offering_signature_purpose_not_current' using errcode='42501'; end if;\n    elsif p_command='REVOKE_PURPOSE' then\n      perform bx1_portal.require_text(p_payload,'reason',20,1000);\n      if e.state is distinct from 'APPROVED' then raise exception 'offering_signature_revoke_denied' using errcode='42501'; end if;\n      insert into bx1_private.offering_signature_authorisation_events(authorisation_id,event_number,state,actor_id,person_id,reason)\n        values(a.id,e.event_number+1,'REVOKED',p_actor,person,p_payload->>'reason');\n      update bx1_private.offering_signature_operations set noncurrent_reason='PURPOSE_REVOKED',\n        next_action=case when state in ('PREPARED','EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED') then 'NONE'\n          when state='COMPLETION_OBSERVED' then 'RETAIN' when envelope_id is not null then 'VOID' else 'RECONCILE' end\n        where authorisation_id=a.id;\n    else\n      if a.signer_id<>p_actor or a.signer_person_id<>person or bx1_private.offering_signature_authorisation_current(a.id) is not true then\n        raise exception 'offering_signature_signer_denied' using errcode='42501'; end if;\n      select * into o from bx1_private.offering_signature_operations where authorisation_id=a.id and manifest_id=m.id;\n      if o.id is null then\n        insert into bx1_private.offering_signature_operations(authorisation_id,approval_event_id,manifest_id,environment,originals,authority_epoch)\n          values(a.id,e.id,m.id,'TESTNET',m.evidence->'files',policy.authority_epoch) returning * into o;\n      end if;\n    end if;\n  else\n    select * into o from bx1_private.offering_signature_operations where id=(p_payload->>'operation_id')::uuid for update;\n    select * into a from bx1_private.offering_signature_authorisations where id=o.authorisation_id;\n    if o.id is null or a.revision_id<>r.id\n      or (rp_policy is not null and (a.roleplay_policy_id is distinct from rp_policy\n        or a.roleplay_epoch is distinct from (select authority_epoch from bx1_private.roleplay_policies where id=rp_policy))) then raise exception 'offering_signature_operation_denied' using errcode='42501'; end if;\n    if p_command='REQUEST_SIGNING_VIEW' then\n      if a.signer_id<>p_actor or a.signer_person_id<>person or o.state<>'SENT' or o.envelope_id is null\n        or bx1_private.offering_signature_authorisation_current(a.id) is not true\n        or exists(select 1 from bx1_private.offering_signature_observations obs where obs.operation_id=o.id\n          and obs.action='SIGNING_VIEW_RESULT' and obs.result->>'outcome'='UNKNOWN' and obs.result ? 'next_check_at'\n          and (obs.result->>'next_check_at')::timestamptz>pg_catalog.clock_timestamp())\n        or (o.lease_id is not null and o.lease_expires_at>at) then raise exception 'offering_signature_view_denied' using errcode='42501'; end if;\n      update bx1_private.offering_signature_operations set next_action='VIEW',lease_id=pg_catalog.gen_random_uuid(),\n        generation=generation+1,lease_expires_at=at+interval '60 seconds',worker_id=policy.worker_id,\n        originating_actor_id=p_actor,originating_session_id=p_session,originating_context=p_context,originating_request_id=p_key\n        where id=o.id returning * into o;\n      insert into bx1_private.offering_signature_attempts values(p_key,o.id,'VIEW',o.worker_id,o.lease_id,o.generation,policy.authority_epoch,\n        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('request_id',p_key,'operation_id',o.id,\n          'action','VIEW','worker_id',o.worker_id,'lease_id',o.lease_id,'generation',o.generation,'authority_epoch',policy.authority_epoch)::text,'UTF8')),'hex'),at);\n      action:=pg_catalog.jsonb_build_object('operation_id',o.id,'lease_id',o.lease_id,'generation',o.generation,'request_id',p_key);\n    else\n      if p_command='REQUEST_RECOVERY' then perform bx1_portal.require_text(p_payload,'reason',20,1000); end if;\n      if o.state in ('EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED') then raise exception 'offering_signature_terminal_operation' using errcode='23514'; end if;\n      -- Requests never shorten persisted polling deadlines or create a new operation.\n      update bx1_private.offering_signature_operations set state=case when p_command='REQUEST_RECOVERY' and state='RECOVERY_REQUIRED'\n          and create_request is null and envelope_id is null and bx1_private.offering_signature_authorisation_current(authorisation_id)\n          and authority_epoch=policy.authority_epoch then 'PREPARED' else state end,\n        next_action=case when p_command='REQUEST_RECOVERY' and create_request is null and envelope_id is null\n          and bx1_private.offering_signature_authorisation_current(authorisation_id) and authority_epoch=policy.authority_epoch then 'PREPARE'\n        when state='COMPLETION_OBSERVED' then 'RETAIN'\n        when state='PREPARED' then next_action else 'RECONCILE' end,\n        noncurrent_reason=case when p_command='REQUEST_RECOVERY' and noncurrent_reason='PROVIDER_THROTTLED'\n          and bx1_private.offering_signature_authorisation_current(authorisation_id) and authority_epoch=policy.authority_epoch\n          then null else noncurrent_reason end where id=o.id;\n    end if;\n  end if;\n  insert into bx1_private.offering_signature_command_receipts(actor_id,request_key,command,operating_context,payload,payload_sha256,result,revision_id,operation_id)\n    values(p_actor,p_key,p_command,p_context,p_payload,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),'hex'),\n      pg_catalog.jsonb_build_object('revision_id',r.id,'authorisation_id',a.id,'operation_id',o.id),r.id,o.id);\n  result:=bx1_private.offering_signature_snapshot(p_context,r.id);\n  if action is not null then result:=result||pg_catalog.jsonb_build_object('action',action); end if;\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(p_context,p.id,p_command,p_key);end if;\n  return result;\nend "
  },
  {
    "signature": "bx1_private.offering_signature_authorisation_current(uuid)",
    "sha": "47e14aac756030e8296db1b6baf4da319825c31214c54e3a8120e4523a6ff3c5",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare a bx1_private.offering_signature_authorisations; e bx1_private.offering_signature_authorisation_events;\nbegin\n  select * into a from bx1_private.offering_signature_authorisations where id=p_id;\n  if a.id is null or bx1_private.offering_signature_admitted() is not true then return false; end if;\n  perform id from bx1_portal.products where id=a.product_id for update;\n  perform singleton from bx1_private.offering_signature_policy where singleton for share;\n  perform singleton from bx1_private.offering_document_policy where singleton for share;\n  perform singleton from bx1_private.offering_document_scanner_policy where singleton for share;\n  select * into e from bx1_private.offering_signature_authorisation_events where authorisation_id=a.id order by event_number desc limit 1;\n  perform id from bx1_portal.product_service_appointments where id in (a.appointment_id,e.appointment_id) order by id for share;\n  perform id from public.bx1_memberships where user_id in (a.requester_id,a.signer_id,e.actor_id) order by id for share;\n  perform bx1_portal.admission_lock_people(array[a.requester_id,a.signer_id,e.actor_id]);\n  if e.state is distinct from 'APPROVED' or a.valid_from>pg_catalog.clock_timestamp() or a.valid_until<=pg_catalog.clock_timestamp()\n    or bx1_private.fund_roleplay_document_person(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,a.requester_id,a.requester_person_id,\n      a.roleplay_context,'REQUEST_PURPOSE') is distinct from a.requester_person_id\n    or bx1_private.fund_roleplay_document_person(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,a.signer_id,a.signer_person_id,\n      pg_catalog.jsonb_build_object('mode','ROLE','organisationId',(select native_organisation_id from bx1_private.roleplay_policies where id=a.roleplay_policy_id),'role','IssuerFundManager'),'PREPARE_EXECUTION') is distinct from a.signer_person_id\n    or bx1_private.fund_roleplay_document_person(e.roleplay_policy_id,e.roleplay_epoch,a.product_id,a.revision_id,e.actor_id,e.person_id,e.roleplay_context,'REVIEW_PURPOSE') is distinct from e.person_id\n    or (e.person_id in (a.requester_person_id,a.signer_person_id)\n      and (a.roleplay_policy_id is null or e.roleplay_policy_id is distinct from a.roleplay_policy_id\n        or e.roleplay_epoch is distinct from a.roleplay_epoch or e.actor_id is distinct from a.requester_id or e.actor_id is distinct from a.signer_id))\n    or bx1_portal.offering_workflow_product_appointment_effective(a.appointment_id) is not true\n    or bx1_portal.offering_workflow_product_appointment_effective(e.appointment_id) is not true then return false; end if;\n  return exists(select 1 from bx1_portal.products p join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id\n    join bx1_private.offering_document_manifests m on m.id=a.manifest_id and m.offering_revision_id=r.id\n    join bx1_portal.product_issuer_declarations d on d.product_id=p.id and d.issuer_reference=a.issuer_reference and d.declaration_revision=a.declaration_revision\n    join bx1_portal.product_service_appointments ap on ap.id=a.appointment_id\n    join bx1_portal.product_service_appointment_receipts ar on ar.id=a.appointment_receipt_id\n    join bx1_portal.product_service_appointments ca on ca.id=e.appointment_id\n    where p.id=a.product_id\n      and (not bx1_portal.test_offering_is_source(p.organisation_id) or bx1_portal.test_offering_revision_current(r.id))\n      and r.id=a.revision_id and r.origin='SUBMITTED' and r.terms=p.terms and p.terms_hash=a.terms_hash\n      and r.terms->'terms_version'='3'::jsonb and r.terms->>'asset_type' in ('FUND','REAL_ESTATE')\n      and r.document_hashes=a.document_hashes and r.common_envelope_hash=a.common_envelope_hash\n      and r.deployment_configuration_hash=a.deployment_configuration_hash and m.hash=a.manifest_hash\n      and not exists(select 1 from bx1_private.offering_document_clean_receipts clean\n        cross join bx1_private.offering_document_policy dp cross join bx1_private.offering_document_scanner_policy sp\n        where clean.file_id=any(m.file_ids) and dp.singleton and sp.singleton\n          and (clean.authority_epoch<>dp.authority_epoch or clean.scanner_authority_epoch<>sp.authority_epoch))\n      and d.declaration_hash=a.declaration_hash and r.issuer_declaration_reference=a.issuer_reference and r.issuer_declaration_revision=a.declaration_revision\n      and ap.product_id=p.id and ap.appointee_user_id=a.signer_id and ap.role='IssuerFundManager' and ap.status='APPLIED'\n      and ap.approval_receipt_id=ar.id and ar.appointment_id=ap.id and ar.status_after='APPROVED'\n      and ar.action='review_product_service_appointment' and ap.reviewer_scope_organisation_id=a.acting_organisation_id\n      and ca.product_id=p.id and ca.appointee_user_id=e.actor_id and ca.role='ComplianceOfficer' and ca.status='APPLIED');\nend "
  },
  {
    "signature": "bx1_private.offering_signature_require_decision(uuid,uuid,text)",
    "sha": "cc696fd96c3f8c876cef23d29b3f477a3ab76c07cabd3469ad8aef568e7275bb",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare person uuid; eligible uuid; p bx1_portal.products; r bx1_portal.offering_revisions;\nbegin\n  -- Preserve the PDF revision lock order and every currentness predicate. The\n  -- canonical Compliance writer transitions the product BEFORE decision INSERT;\n  -- only its exact authenticated reviewer may use that post-transition state.\n  select product.* into p from bx1_portal.offering_revisions revision\n    join bx1_portal.products product on product.id=revision.product_id\n    where revision.id=p_revision for update of product;\n  select * into r from bx1_portal.offering_revisions where id=p_revision;\n  perform id from bx1_portal.organisations where id=p.organisation_id for share;\n  perform id from bx1_portal.representative_mandates where product_organisation_id=p.organisation_id order by id for share;\n  perform m.id from public.bx1_memberships m join bx1_portal.representative_mandates mandate\n    on mandate.native_membership_id=m.id where mandate.product_organisation_id=p.organisation_id order by m.id for share of m;\n  perform bx1_portal.admission_lock_people(array[r.submitted_by,p.created_by]);\n  if p.id is null or p.current_offering_revision_id is distinct from r.id\n    or (p.status in ('IN_REVIEW','CHANGES_REQUIRED')\n      or (p_kind='COMPLIANCE' and p.status='APPROVED' and auth.uid()=p_actor and p.reviewer_id=p_actor)) is not true\n    or r.terms is distinct from p.terms\n    or r.terms_hash is distinct from p.terms_hash\n    or bx1_portal.test_offering_organisation_current(p.organisation_id) is not true\n    or bx1_portal.offering_workflow_person_current(r.submitted_by) is not true\n    or not (bx1_portal.test_offering_revision_current(p_revision) or (not bx1_portal.test_offering_is_source(p.organisation_id)\n      and exists(select 1 from bx1_portal.representative_mandates mandate\n      where mandate.product_organisation_id=p.organisation_id and mandate.applicant_user_id=r.submitted_by\n        and bx1_portal.offering_workflow_manager_current(r.submitted_by,p.organisation_id,mandate.native_organisation_id))))\n    or not exists(select 1 from bx1_private.offering_document_profiles q\n      where q.offering_revision_id=r.id and q.product_id=p.id and q.organisation_id=p.organisation_id\n        and q.terms_hash=r.terms_hash and q.document_hashes=r.document_hashes\n        and q.common_envelope_hash is not distinct from r.common_envelope_hash\n        and q.deployment_configuration_hash is not distinct from r.deployment_configuration_hash) then\n    raise exception 'offering_document_current_revision_denied' using errcode='42501'; end if;\n  person:=case when bx1_private.fund_roleplay_lane_current((select operating_context from bx1_private.fund_roleplay_command_lanes where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid()),p.id,\n    case p_kind when 'ISSUER' then 'review_offering_issuer' else 'review_product' end) then bx1_private.fund_roleplay_person_for(p.id,p_actor)\n    else bx1_private.document_governance_trusted_person(p_actor,null) end;\n  if person is null or p_kind not in ('ISSUER','COMPLIANCE') then\n    raise exception 'offering_signature_decision_person_denied' using errcode='42501'; end if;\n  select o.id into eligible from bx1_private.offering_signature_operations o\n    join bx1_private.offering_signature_authorisations a on a.id=o.authorisation_id\n    where a.revision_id=p_revision and bx1_private.offering_signature_evidence_current(o.id)\n      and ((p_kind='ISSUER' and a.signer_id=p_actor and a.signer_person_id=person)\n        or (p_kind='COMPLIANCE' and (person not in (a.signer_person_id,a.requester_person_id)\n          or bx1_private.fund_roleplay_signature_decision_current(a.id,p_actor,'COMPLIANCE'))\n          and exists(select 1 from bx1_private.offering_signature_decision_bindings b\n            join bx1_portal.offering_decisions d on d.id=b.decision_id\n            where b.operation_id=o.id and b.decision_kind='ISSUER' and d.decision='APPROVED' and d.offering_revision_id=p_revision)))\n    order by o.created_at desc,o.id limit 1 for update of o;\n  if eligible is null then raise exception 'offering_signature_current_evidence_required' using errcode='23514'; end if;\nend "
  },
  {
    "signature": "bx1_private.offering_signature_bind_decision()",
    "sha": "582447cb9edd480875ffcd7b6f25be96e933ec2420e7c4c6d07fe0f877cd2e49",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare o bx1_private.offering_signature_operations; a bx1_private.offering_signature_authorisations; evidence uuid; person uuid;\nbegin\n  if NEW.decision<>'APPROVED' or not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=NEW.offering_revision_id) then\n    return NEW; end if;\n  perform bx1_private.offering_signature_require_decision(NEW.offering_revision_id,NEW.actor_id,NEW.decision_kind);\n  person:=case when NEW.roleplay_policy_id is null then bx1_private.document_governance_trusted_person(NEW.actor_id,null)\n    else bx1_private.fund_roleplay_person_for((select product_id from bx1_portal.offering_revisions where id=NEW.offering_revision_id),NEW.actor_id) end;\n  select op.* into o from bx1_private.offering_signature_operations op\n    join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id\n    where au.revision_id=NEW.offering_revision_id and bx1_private.offering_signature_evidence_current(op.id)\n      and ((NEW.decision_kind='ISSUER' and au.signer_id=NEW.actor_id and au.signer_person_id=person)\n        or (NEW.decision_kind='COMPLIANCE' and (person not in (au.signer_person_id,au.requester_person_id)\n          or bx1_private.fund_roleplay_signature_decision_current(au.id,NEW.actor_id,'COMPLIANCE'))\n          and exists(select 1 from bx1_private.offering_signature_decision_bindings b\n            join bx1_portal.offering_decisions d on d.id=b.decision_id\n            where b.operation_id=op.id and b.decision_kind='ISSUER' and d.decision='APPROVED'\n              and d.offering_revision_id=NEW.offering_revision_id)))\n    order by op.created_at desc,op.id limit 1 for update of op;\n  select * into a from bx1_private.offering_signature_authorisations where id=o.authorisation_id;\n  select id into evidence from bx1_private.offering_signature_observations where operation_id=o.id and action='EVIDENCE_FINALIZED'\n    and current_at_observation and result->'integrity_verified'='true'::jsonb order by created_at desc,id limit 1;\n  if evidence is null then raise exception 'offering_signature_decision_binding_missing' using errcode='23514'; end if;\n  insert into bx1_private.offering_signature_decision_bindings(decision_id,authorisation_id,approval_event_id,operation_id,\n    observation_id,manifest_id,manifest_hash,decision_kind)\n    values(NEW.id,a.id,o.approval_event_id,o.id,evidence,a.manifest_id,a.manifest_hash,NEW.decision_kind);\n  return NEW;\nend "
  },
  {
    "signature": "bx1_private.offering_signature_snapshot(jsonb,uuid)",
    "sha": "738468ac0d860bad9447094674bf40801cf20a4b3cd8dd8f262467611a37ca11",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare p bx1_portal.products; cfg bx1_portal.entry_configuration; commands jsonb:='[]'::jsonb;\n  admitted boolean; is_manager boolean; is_issuer boolean; is_compliance boolean; blocked text;\nbegin\n  if bx1_private.offering_document_visible(c,p_revision) is not true then raise exception 'offering_signature_read_denied' using errcode='42501'; end if;\n  select product.* into p from bx1_portal.products product join bx1_portal.offering_revisions r on r.product_id=product.id where r.id=p_revision;\n  select * into cfg from bx1_portal.entry_configuration where singleton;\n  admitted:=bx1_private.offering_signature_admitted();\n  is_manager:=bx1_private.offering_document_manager(c,p_revision);\n  is_issuer:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'IssuerFundManager');\n  is_compliance:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer');\n  blocked:=case when not admitted then 'NOT_ADMITTED' when p.current_offering_revision_id<>p_revision then 'REVISION_NOT_CURRENT'\n    when p.terms->'terms_version' is distinct from '3'::jsonb then 'ISSUER_BINDING_UNSUPPORTED'\n    when not exists(select 1 from bx1_private.offering_document_manifests where offering_revision_id=p_revision) then 'MANIFEST_REQUIRED'\n    when bx1_private.document_governance_trusted_person(auth.uid(),null) is null\n      and bx1_private.fund_roleplay_visible(c,p.id) is not true then 'TRUSTED_PERSON_REQUIRED' else null end;\n  if blocked is null then\n    if is_manager then commands:=commands||'\"REQUEST_PURPOSE\"'::jsonb; end if;\n    if is_compliance then commands:=commands||'\"REVIEW_PURPOSE\"'::jsonb; end if;\n    if is_manager or is_compliance then commands:=commands||'\"REVOKE_PURPOSE\"'::jsonb; end if;\n    if is_issuer then commands:=commands||'[\"PREPARE_EXECUTION\",\"REQUEST_SIGNING_VIEW\"]'::jsonb; end if;\n    if is_manager or is_issuer or is_compliance then commands:=commands||'[\"REQUEST_RECONCILIATION\",\"REQUEST_RECOVERY\"]'::jsonb; end if;\n  end if;\n  return pg_catalog.jsonb_build_object('version',1,'actor_id',auth.uid(),'session_id',auth.jwt()->>'session_id','context',c,\n    'environment',cfg.environment,'product_id',p.id,'revision_id',p_revision,'expected_revision',p.revision,\n    'purpose','ISSUER_PACKAGE_EXECUTION','admitted',admitted,'allowed_commands',commands,'blocker',blocked,\n    'authorisations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id,'signer_id',a.signer_id,\n      'signer_person_id',a.signer_person_id,'appointment_id',a.appointment_id,\n      'state',coalesce((select e.state from bx1_private.offering_signature_authorisation_events e where e.authorisation_id=a.id order by e.event_number desc limit 1),'REQUESTED'),\n      'valid_from',a.valid_from,'valid_until',a.valid_until,'source_reference',a.source_reference) order by a.created_at,a.id)\n      from bx1_private.offering_signature_authorisations a where a.revision_id=p_revision),'[]'::jsonb),\n    'operations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'authorisation_id',o.authorisation_id,\n      'state',o.state,'current',bx1_private.offering_signature_evidence_current(o.id),'noncurrent_reason',\n      case when bx1_private.offering_signature_authorisation_current(o.authorisation_id) then o.noncurrent_reason else 'AUTHORITY_NOT_CURRENT' end,\n      'envelope_id',o.envelope_id,'next_check_at',o.next_check_at,\n      'artifacts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',ar.reservation_id,'kind',ar.kind,\n        'sha256',ar.sha256,'size',ar.size,'mime_type',ar.mime_type) order by ar.kind)\n        from bx1_private.offering_signature_artifacts ar where ar.operation_id=o.id and ar.state='RETAINED'),'[]'::jsonb)) order by o.created_at,o.id)\n      from bx1_private.offering_signature_operations o join bx1_private.offering_signature_authorisations a on a.id=o.authorisation_id\n      where a.revision_id=p_revision),'[]'::jsonb));\nend "
  },
  {
    "signature": "bx1_portal.fund_payment_basis_proposal_current(uuid)",
    "sha": "d75444a6789e7e90bd46592db65a1dcfdbcc511fb5f2f627e12505f23302a1e1",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.fund_payment_allocation_bases basis\n    join bx1_portal.subscriptions s on s.id=basis.subscription_id\n    where basis.id=bid and basis.product_id=s.product_id and basis.offering_revision_id=s.offering_revision_id\n      and basis.investment_account_id=s.investment_account_id and basis.product_revision=s.product_revision\n      and basis.terms_hash=s.terms_hash and basis.amount_base_units=s.amount_minor\n      and basis.units_base=s.units*pg_catalog.power(10::numeric,basis.security_unit_decimals)\n      and basis.requested_by=s.investor_id and ((basis.roleplay_policy_id is null and bx1_portal.fund_person(basis.requested_by)=basis.requested_person_id)\n        or (basis.roleplay_policy_id is not null and basis.requested_person_id=bx1_private.fund_roleplay_person_for(basis.product_id,basis.requested_by)\n          and bx1_private.fund_roleplay_record_current(basis.roleplay_policy_id,basis.roleplay_epoch,basis.product_id,basis.offering_revision_id,\n            basis.requested_by,basis.requested_context,'request_fund_payment_allocation_basis')))\n      and basis.basis_hash=bx1_portal.fund_payment_basis_hash(s.id)\n      and bx1_portal.fund_payment_basis_source_current(s.id));\n"
  },
  {
    "signature": "bx1_portal.fund_payment_basis_source_current(uuid)",
    "sha": "e2c1ccf2d634eed421331b1761609ce235a58e3794d91e40653c06ba8e627e4e",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.subscriptions s\n    join bx1_portal.products p on p.id=s.product_id\n    join bx1_portal.investment_accounts i on i.id=s.investment_account_id and i.holder_user_id=s.investor_id\n    join bx1_portal.applications admission on admission.id=i.application_id and admission.user_id=s.investor_id\n    join auth.users u on u.id=s.investor_id\n    join bx1_portal.fund_release_manifests m on m.product_id=s.product_id and m.offering_revision_id=s.offering_revision_id\n    join bx1_portal.fund_signer_policies sp on sp.manifest_id=m.id\n    where s.id=sid and s.status='AWAITING_FUNDING' and s.accepted_documents and s.accepted_risks\n      and s.accepted_terms->>'asset_type'='FUND' and s.accepted_terms->>'currency'='TST'\n      and s.accepted_terms->>'settlement_decimals'='6' and s.terms_hash=p.terms_hash\n      and s.offering_revision_id=p.current_offering_revision_id and s.units>0\n      and s.amount_minor=s.units*(s.accepted_terms->>'unit_price_minor')::numeric\n      and i.kind='INDIVIDUAL' and i.status='ACTIVE' and admission.persona='INVESTOR'\n      and admission.status='APPROVED' and admission.approved_until>pg_catalog.clock_timestamp()\n      and u.deleted_at is null and u.email_confirmed_at is not null\n      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())\n      and not exists(select 1 from public.bx1_profiles profile where profile.id=s.investor_id and profile.status<>'ACTIVE')\n      and ((m.roleplay_policy_id is null and bx1_portal.fund_person(s.investor_id) is not null)\n        or (m.roleplay_policy_id is not null and sp.roleplay_policy_id=m.roleplay_policy_id and sp.roleplay_epoch=m.roleplay_epoch\n          and bx1_private.fund_roleplay_person_for(s.product_id,s.investor_id) is not null\n          and bx1_private.fund_roleplay_record_current(m.roleplay_policy_id,m.roleplay_epoch,s.product_id,s.offering_revision_id,s.investor_id,\n            pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.native_organisation_id,'role','Investor'),'request_fund_payment_allocation_basis')))\n      and bx1_portal.fund_manifest_current(m.id)\n      and sp.status='ADMITTED' and sp.admitted_until>pg_catalog.clock_timestamp() and sp.authority_epoch=m.authority_epoch\n      and bx1_portal.offering_technical_ready(s.offering_revision_id)\n      and exists(select 1 from bx1_portal.product_eligibility_cases eligibility\n        where eligibility.investment_account_id=i.id and eligibility.product_id=s.product_id\n          and eligibility.offering_revision_id=s.offering_revision_id and bx1_portal.product_eligibility_current(eligibility.id)));\n"
  },
  {
    "signature": "bx1_portal.fund_payment_basis_current(uuid)",
    "sha": "825946a67799559588b755350134214a4b60699ff38d5e62fd6c7b66f466a8ff",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.fund_payment_allocation_bases basis\n    join bx1_portal.fund_authorities authority on authority.id=basis.issuer_authority_id\n    where basis.subscription_id=sid and basis.status='APPROVED'\n      and basis.revision=(select max(latest.revision) from bx1_portal.fund_payment_allocation_bases latest where latest.subscription_id=sid)\n      and basis.approved_until>pg_catalog.clock_timestamp() and bx1_portal.fund_payment_basis_proposal_current(basis.id)\n      and authority.role='IssuerFundManager' and authority.user_id=basis.approved_by\n      and authority.person_id=basis.approved_person_id and authority.can_approve\n      and ((basis.roleplay_policy_id is null and authority.roleplay_policy_id is null\n          and bx1_portal.fund_authority_current(authority.id) and bx1_portal.entity_people_independent(basis.approved_by,basis.requested_by))\n        or (basis.roleplay_policy_id is not null and authority.roleplay_policy_id=basis.roleplay_policy_id\n          and authority.roleplay_epoch=basis.roleplay_epoch and basis.approved_by=basis.requested_by\n          and basis.approved_person_id=basis.requested_person_id and bx1_private.fund_roleplay_authority_current(authority.id)\n          and bx1_private.fund_roleplay_record_current(basis.roleplay_policy_id,basis.roleplay_epoch,basis.product_id,basis.offering_revision_id,\n            basis.approved_by,basis.approved_context,'approve_fund_payment_allocation_basis'))));\n"
  },
  {
    "signature": "bx1_portal.fund_payment_basis_actions(jsonb,uuid)",
    "sha": "2989dfb093bed5a02f7b25cbef79c09dac5fd23947df371d4eeb8dd07e474597",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare basis bx1_portal.fund_payment_allocation_bases; s bx1_portal.subscriptions;\n  policy uuid; issuer uuid; requestable boolean; approvable boolean; result jsonb:='[]'::jsonb;\nbegin\n  if bx1_portal.fund_order_visible(c,sid) is not true then return result; end if;\n  select * into s from bx1_portal.subscriptions where id=sid;\n  select * into basis from bx1_portal.fund_payment_allocation_bases where subscription_id=sid order by revision desc limit 1;\n  select sp.id into policy from bx1_portal.fund_signer_policies sp join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id\n    where m.product_id=s.product_id and m.offering_revision_id=s.offering_revision_id and m.status='ADMITTED' and sp.status='ADMITTED';\n  requestable:=s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor')\n    and bx1_portal.fund_payment_basis_source_current(s.id) and bx1_portal.account_usable(c,s.investment_account_id)\n    and not bx1_portal.fund_payment_basis_current(s.id)\n    and (basis.id is null or bx1_portal.fund_payment_basis_proposal_current(basis.id) is not true or basis.status='APPROVED')\n    and not exists(select 1 from bx1_portal.fund_payment_intents payment where payment.subscription_id=s.id and payment.claimed_at is not null)\n    and not exists(select 1 from bx1_portal.funding_obligations obligation join bx1_portal.funding_references reference on reference.obligation_id=obligation.id where obligation.subscription_id=s.id);\n  issuer:=bx1_portal.fund_authority(c,policy,'IssuerFundManager');\n  approvable:=basis.id is not null and basis.status='REQUESTED' and bx1_portal.fund_payment_basis_proposal_current(basis.id)\n    and issuer is not null and exists(select 1 from bx1_portal.fund_authorities authority where authority.id=issuer and authority.can_approve)\n    and (bx1_portal.entity_people_independent(auth.uid(),s.investor_id)\n      or bx1_private.fund_roleplay_basis_approval(basis.id,c,issuer));\n  if basis.id is null or bx1_portal.fund_payment_basis_proposal_current(basis.id) is not true\n    or (basis.status='APPROVED' and bx1_portal.fund_payment_basis_current(s.id) is not true) then\n    result:=result||pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_payment_allocation_basis',s.id,s.product_revision,\n      'Submit reserved units for issuer approval','Investor',requestable,'ISSUER_ALLOCATION_BASIS_REQUIRED',\n      pg_catalog.jsonb_build_object('subscription_id',s.id,'expected_basis_hash',bx1_portal.fund_payment_basis_hash(s.id))));\n  elsif basis.status='REQUESTED' then\n    result:=result||pg_catalog.jsonb_build_array(bx1_portal.fund_action('approve_fund_payment_allocation_basis',basis.id,basis.revision,\n      'Approve the allocation basis before payment','IssuerFundManager',approvable,'CURRENT_ISSUER_ALLOCATION_APPROVAL_REQUIRED',\n      pg_catalog.jsonb_build_object('basis_id',basis.id,'expected_revision',basis.revision)));\n  end if;\n  return result;\nend "
  },
  {
    "signature": "bx1_portal.fund_payment_basis_command(jsonb,text,uuid,jsonb)",
    "sha": "84a4b28cb7534834517be972fe407eff20679aa44523897f35f689e14b6ccf83",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare s bx1_portal.subscriptions; basis bx1_portal.fund_payment_allocation_bases; issuer bx1_portal.fund_authorities;\n  prior bx1_portal.scoped_requests; rp_policy uuid; policy uuid; decimals integer; target uuid; expected_hash text; before_rev integer;\nbegin\n  if action not in ('request_fund_payment_allocation_basis','approve_fund_payment_allocation_basis')\n    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')\n    or bx1_portal.fund_context(c,false) is not true or key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'fund_payment_basis_command_denied' using errcode='42501'; end if;\n  if action='request_fund_payment_allocation_basis' then\n    perform bx1_portal.require_keys(body,array['subscription_id','expected_basis_hash']);\n    if body->>'expected_basis_hash' !~ '^[0-9a-f]{64}$' then raise exception 'fund_payment_basis_hash_invalid' using errcode='22023'; end if;\n    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid;\n  else\n    perform bx1_portal.require_keys(body,array['basis_id','expected_revision']);\n    select * into basis from bx1_portal.fund_payment_allocation_bases where id=(body->>'basis_id')::uuid;\n    select * into s from bx1_portal.subscriptions where id=basis.subscription_id;\n  end if;\n  if s.id is null then raise exception 'fund_payment_basis_order_denied' using errcode='42501'; end if;\n  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||auth.uid()::text,0));\n  rp_policy:=bx1_private.fund_roleplay_enter(c,s.product_id,action,key);\n  perform bx1_portal.fund_lock(c,s.product_id);\n  perform bx1_portal.lock_entity_people(array[s.investor_id]);\n  perform id from auth.users where id=s.investor_id for share;\n  perform id from public.bx1_profiles where id=s.investor_id for share;\n  select * into s from bx1_portal.subscriptions where id=s.id for update;\n  perform id from bx1_portal.investment_accounts where id=s.investment_account_id for share;\n  perform admission.id from bx1_portal.applications admission join bx1_portal.investment_accounts account on account.application_id=admission.id where account.id=s.investment_account_id for share of admission;\n  perform id from bx1_portal.product_eligibility_cases where investment_account_id=s.investment_account_id and product_id=s.product_id and offering_revision_id=s.offering_revision_id for share;\n  select * into prior from bx1_portal.scoped_requests where actor_id=auth.uid() and request_key=key;\n  if prior.actor_id is not null then\n    if prior.command is distinct from action or prior.payload is distinct from body or prior.operating_context is distinct from c then\n      raise exception 'fund_payment_basis_idempotency_conflict' using errcode='23505'; end if;\n    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,action,key);end if;\n    return bx1_portal.fund_read(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=auth.uid() and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=auth.uid() and request_key=key) then\n    raise exception 'fund_payment_basis_prior_key_conflict' using errcode='23505'; end if;\n  if bx1_portal.fund_payment_basis_source_current(s.id) is not true then\n    raise exception 'fund_payment_basis_source_changed' using errcode='23514'; end if;\n  select sp.id,m.security_unit_decimals into policy,decimals from bx1_portal.fund_signer_policies sp\n    join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where m.product_id=s.product_id\n      and m.offering_revision_id=s.offering_revision_id and m.status='ADMITTED' and sp.status='ADMITTED';\n  if action='request_fund_payment_allocation_basis' then\n    if s.investor_id is distinct from auth.uid() or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor')\n      or bx1_portal.account_usable(c,s.investment_account_id) is not true then\n      raise exception 'fund_payment_basis_holder_required' using errcode='42501'; end if;\n    expected_hash:=bx1_portal.fund_payment_basis_hash(s.id);\n    if expected_hash is distinct from body->>'expected_basis_hash' then raise exception 'fund_payment_basis_order_changed' using errcode='23514'; end if;\n    select * into basis from bx1_portal.fund_payment_allocation_bases where subscription_id=s.id order by revision desc limit 1 for update;\n    if basis.id is not null and bx1_portal.fund_payment_basis_proposal_current(basis.id)\n      and (basis.status='REQUESTED' or bx1_portal.fund_payment_basis_current(s.id)) then\n      raise exception 'fund_payment_basis_already_requested' using errcode='23514'; end if;\n    if exists(select 1 from bx1_portal.fund_payment_intents payment where payment.subscription_id=s.id and payment.claimed_at is not null)\n      or exists(select 1 from bx1_portal.funding_obligations obligation join bx1_portal.funding_references reference on reference.obligation_id=obligation.id where obligation.subscription_id=s.id) then\n      raise exception 'fund_payment_basis_existing_payment_recovery_required' using errcode='23514'; end if;\n    before_rev:=coalesce(basis.revision,0);\n    insert into bx1_portal.fund_payment_allocation_bases(subscription_id,product_id,offering_revision_id,investment_account_id,\n      product_revision,terms_hash,units_base,amount_base_units,security_unit_decimals,basis_hash,revision,requested_by,requested_person_id,requested_context)\n      values(s.id,s.product_id,s.offering_revision_id,s.investment_account_id,s.product_revision,s.terms_hash,\n        s.units*pg_catalog.power(10::numeric,decimals),s.amount_minor,decimals,expected_hash,before_rev+1,\n        auth.uid(),case when rp_policy is null then bx1_portal.fund_person(auth.uid()) else bx1_private.fund_roleplay_person_for(s.product_id,auth.uid()) end,c) returning * into basis;\n  else\n    select * into basis from bx1_portal.fund_payment_allocation_bases where id=basis.id for update;\n    perform bx1_portal.funding_require_revision(basis.revision,body->'expected_revision');\n    select * into issuer from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,policy,'IssuerFundManager');\n    if basis.status<>'REQUESTED' or issuer.id is null or not issuer.can_approve or bx1_portal.fund_payment_basis_proposal_current(basis.id) is not true\n      or basis.revision<>(select max(latest.revision) from bx1_portal.fund_payment_allocation_bases latest where latest.subscription_id=s.id)\n      or (bx1_portal.entity_people_independent(auth.uid(),basis.requested_by) is not true\n        and (rp_policy is null or rp_policy is distinct from basis.roleplay_policy_id\n          or bx1_private.fund_roleplay_basis_approval(basis.id,c,issuer.id) is not true)) then\n      raise exception 'fund_payment_basis_current_independent_issuer_required' using errcode='42501'; end if;\n    before_rev:=basis.revision;\n    update bx1_portal.fund_payment_allocation_bases set status='APPROVED',revision=revision+1,\n      approved_by=auth.uid(),approved_person_id=issuer.person_id,issuer_authority_id=issuer.id,approved_context=c,\n      approved_at=pg_catalog.clock_timestamp(),approved_until=case when rp_policy is null then issuer.valid_until\n        else least(issuer.valid_until,(select valid_until from bx1_private.roleplay_policies where id=rp_policy)) end where id=basis.id returning * into basis;\n  end if;\n  target:=basis.id;\n  perform bx1_portal.fund_audit(s.product_id,target,null,action,c,before_rev,basis.revision,null,\n    pg_catalog.jsonb_build_object('subscription_id',s.id,'basis_hash',basis.basis_hash,'units_base',basis.units_base::text,'amount_base_units',basis.amount_base_units::text));\n  if (case when rp_policy is null then bx1_portal.fund_context(c,false) else bx1_private.fund_roleplay_lane_current(c,s.product_id,action) end) is not true or bx1_portal.fund_payment_basis_proposal_current(target) is not true\n    or (action='approve_fund_payment_allocation_basis' and (bx1_portal.fund_authority(c,policy,'IssuerFundManager') is distinct from issuer.id\n      or bx1_portal.fund_payment_basis_current(s.id) is not true)) then\n    raise exception 'fund_payment_basis_authority_expired_at_commit' using errcode='42501'; end if;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,command,payload,operating_context) values(auth.uid(),key,action,body,c);\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,action,key);end if;\n  return bx1_portal.fund_read(c);\nend "
  },
  {
    "signature": "bx1_portal.fund_authority(jsonb,uuid,text)",
    "sha": "8f1d4636c473b80504434b00569c157d201da570b52a895019d255c6eea9a0e4",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select a.id from bx1_portal.fund_authorities a join public.bx1_memberships m on m.id=a.native_membership_id\n  where a.signer_policy_id=target_policy and a.user_id=auth.uid() and a.role=c->>'role'\n    and m.organisation_id::text=c->>'organisationId' and (target_role is null or a.role=target_role)\n    and ((a.roleplay_policy_id is null and bx1_portal.fund_context(c,true) and bx1_portal.fund_authority_current(a.id))\n      or (a.roleplay_policy_id is not null and bx1_private.test_roleplay_protected_session()\n        and bx1_private.fund_roleplay_authority_current(a.id)\n        and exists(select 1 from bx1_portal.fund_signer_policies sp join bx1_portal.fund_release_manifests manifest on manifest.id=sp.manifest_id\n          where sp.id=target_policy and bx1_private.fund_roleplay_visible(c,manifest.product_id)\n            and (not a.can_sign or a.signer_address=coalesce(\n              (select lane.signing_address from bx1_private.fund_roleplay_command_lanes lane\n                where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n                  and lane.policy_id=a.roleplay_policy_id and lane.authority_epoch=a.roleplay_epoch and lane.operating_context=c),\n              manifest.deployment_expectation->>'signer_address')))))\n  order by a.id limit 1;\n"
  },
  {
    "signature": "bx1_portal.fund_manifest_current(uuid)",
    "sha": "d69500244dcef0c51a49dc3e494dfd7b50d10f1fc1d81de329d91335f3e84f75",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.fund_release_manifests m\n    join bx1_portal.products p on p.id=m.product_id and p.current_offering_revision_id=m.offering_revision_id\n    join bx1_portal.offering_revisions r on r.id=m.offering_revision_id and r.product_id=p.id\n    join bx1_portal.entry_configuration c on c.singleton and c.environment=m.environment\n    where m.id=target and (m.roleplay_policy_id is null or bx1_private.fund_roleplay_record_current(m.roleplay_policy_id,m.roleplay_epoch,m.product_id,m.offering_revision_id,m.admitted_by,m.roleplay_context,'admit_fund_release')) and m.status='ADMITTED' and m.admitted_until>pg_catalog.clock_timestamp()\n      and m.terms_hash=r.terms_hash and p.terms_hash=r.terms_hash\n      and r.terms->>'asset_type'='FUND' and r.terms->>'terms_version'='3' and r.terms->>'currency'='TST'\n      and r.terms->>'settlement_decimals'='6' and m.configuration_hash=r.deployment_configuration_hash\n      and r.terms#>>'{deployment_configuration,primary_class_id}'=m.class_id::text\n      and r.terms#>>'{common_envelope,classes,0,class_id}'=m.class_id::text\n      and r.terms#>>'{common_envelope,classes,0,name}'=m.class_name\n      and r.terms#>>'{common_envelope,classes,0,decimals}'=m.security_unit_decimals::text\n      and m.deployment_expectation#>>'{manifest,token_details,name}'=r.terms->>'name'\n      and m.deployment_expectation#>>'{manifest,token_details,decimals}'=m.security_unit_decimals::text\n      and (m.deployment_expectation#>>'{manifest,maximum_supply}')::numeric\n        =(r.terms->>'cap_units')::numeric*pg_catalog.power(10::numeric,m.security_unit_decimals)\n      and m.deployment_expectation#>>'{manifest,product_binding_hash}'=m.product_binding_hash\n      and m.issuance_expectation#>>'{manifest,product_binding_hash}'=m.product_binding_hash\n      and m.environment='TESTNET' and m.chain_id=80002\n      and bx1_portal.current_product_organisation(p.organisation_id)\n      and bx1_portal.offering_workflow_approved(p.id)\n      and exists(select 1 from bx1_portal.offering_decisions i\n        join bx1_portal.offering_decisions c on c.offering_revision_id=i.offering_revision_id and c.decision_kind='COMPLIANCE'\n        where i.offering_revision_id=r.id and i.decision_kind='ISSUER'\n          and i.decision='APPROVED' and c.decision='APPROVED'\n          and bx1_private.offering_signature_decisions_current(r.id,i.id,c.id)));\n"
  },
  {
    "signature": "bx1_portal.fund_new_operation(jsonb,uuid,uuid,uuid,uuid)",
    "sha": "2415e1d7adf73c92ee0e69c9769aa48d44f2c6c93563dd2ce57f1040042da074",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare m bx1_portal.fund_release_manifests; sp bx1_portal.fund_signer_policies; a bx1_portal.fund_allocations;\n  b bx1_portal.fund_delivery_bindings; oid uuid:=pg_catalog.gen_random_uuid(); expiry timestamptz;\n  expectation jsonb; binding text; nonce numeric; kind text; prior_supply numeric; prior_balance numeric; reconciliation_id uuid;\nbegin\n  select * into m from bx1_portal.fund_release_manifests where id=mid and product_id=pid;\n  select * into sp from bx1_portal.fund_signer_policies where id=policy_id and manifest_id=m.id;\n  if m.id is null or sp.id is null or bx1_portal.fund_manifest_current(m.id) is not true\n    or sp.status<>'ADMITTED' or sp.admitted_until<=pg_catalog.clock_timestamp() then\n    raise exception 'fund_canonical_dependencies_not_admitted' using errcode='55000'; end if;\n  expiry:=least(pg_catalog.clock_timestamp()+interval '1 hour',m.admitted_until,sp.admitted_until);\n  kind:=case when allocation is null then 'DEPLOYMENT' else 'ISSUANCE' end;\n  expectation:=case when allocation is null then m.deployment_expectation else m.issuance_expectation end;\n  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_safe:'||m.execution_account,0));\n  nonce:=coalesce((select max(safe_nonce)+1 from bx1_portal.fund_operations where execution_account=m.execution_account and not nonce_released),\n    (expectation#>>'{manifest,safe,nonce}')::numeric);\n  if nonce is null or nonce<0 then raise exception 'fund_safe_nonce_not_admitted' using errcode='55000'; end if;\n  binding:=bx1_portal.fund_digest(pg_catalog.jsonb_build_object('operation',oid,'product',pid,'offering',m.offering_revision_id,\n    'terms',m.terms_hash,'configuration',m.configuration_hash,'manifest',m.manifest_hash,\n    'policy',sp.authority_policy_hash,'epoch',sp.authority_epoch,'allocation',allocation));\n  expectation:=expectation||pg_catalog.jsonb_build_object('version',1,'kind',kind,'operation_id',oid,\n    'operation_revision',1,'product_id',pid,'offering_revision_id',m.offering_revision_id,'class_id',m.class_id,\n    'environment',m.environment,'chain_id',m.chain_id,'binding_hash',binding,'authority_policy_hash',sp.authority_policy_hash,\n    'authority_epoch',sp.authority_epoch,'expires_at',expiry);\n  expectation:=pg_catalog.jsonb_set(expectation,'{manifest,product_binding_hash}',pg_catalog.to_jsonb(m.product_binding_hash));\n  expectation:=pg_catalog.jsonb_set(expectation,'{manifest,safe,nonce}',pg_catalog.to_jsonb(nonce::text));\n  expectation:=pg_catalog.jsonb_set(expectation,'{safe_transaction,nonce}',pg_catalog.to_jsonb(nonce::text));\n  if allocation is not null then\n    select * into a from bx1_portal.fund_allocations where id=allocation and product_id=pid for update;\n    select * into b from bx1_portal.fund_delivery_bindings where id=a.delivery_binding_id;\n    if a.status<>'APPROVED' or bx1_portal.fund_allocation_current(a.id) is not true then\n      raise exception 'fund_current_allocation_required' using errcode='23514'; end if;\n    perform id from bx1_portal.product_eligibility_cases where id=a.eligibility_case_id for share;\n    select coalesce(sum(units_base),0),coalesce(sum(units_base) filter(where wallet_address=b.wallet_address),0)\n      into prior_supply,prior_balance from bx1_portal.fund_register_entries where product_id=a.product_id;\n    select id into reconciliation_id from bx1_portal.funding_journals where obligation_id=a.obligation_id and kind='FUNDING'\n      order by created_at desc,id desc limit 1;\n    if reconciliation_id is null then raise exception 'fund_posted_reconciliation_evidence_required' using errcode='23514'; end if;\n    expectation:=pg_catalog.jsonb_set(expectation,'{issuance}',coalesce(expectation->'issuance','{}'::jsonb)\n      ||pg_catalog.jsonb_build_object('allocation_id',a.id,'subscription_id',a.subscription_id,\n        'investment_account_id',a.investment_account_id,'wallet_proof_id',b.wallet_proof_id,\n        'eligibility_evidence_id',a.eligibility_case_id,'reconciliation_evidence_id',reconciliation_id,\n        'previous_reconciled_supply',prior_supply::text,'previous_reconciled_balance',prior_balance::text,\n        'recipient',b.wallet_address,'units_base',a.units_base::text));\n  end if;\n  insert into bx1_portal.fund_operations(id,product_id,offering_revision_id,subscription_id,allocation_id,manifest_id,\n    signer_policy_id,kind,chain_id,execution_account,binding_hash,intent_hash,authority_policy_hash,authority_epoch,expectation,safe_nonce,\n    requested_by,requested_person_id,requested_context,expires_at)\n    values(oid,pid,m.offering_revision_id,a.subscription_id,allocation,m.id,sp.id,kind,m.chain_id,m.execution_account,binding,\n      bx1_portal.fund_digest(expectation),sp.authority_policy_hash,sp.authority_epoch,expectation,nonce,\n      auth.uid(),case when m.roleplay_policy_id is not null and bx1_private.fund_roleplay_lane_current(c,pid,\n        case when allocation is null then 'request_fund_deployment' else 'request_fund_issuance' end)\n        then bx1_private.fund_roleplay_person_for(pid,auth.uid()) else bx1_portal.fund_person(auth.uid()) end,c,expiry);\n  if allocation is not null then update bx1_portal.fund_allocations set status='ISSUING',revision=revision+1 where id=allocation; end if;\n  return oid;\nend "
  },
  {
    "signature": "bx1_portal.fund_operation_current(uuid)",
    "sha": "38eec5296de2d2b93c51ef725bd9141916a6cce5871fbf31065cc7992a8d540b",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.fund_operations o\n    join bx1_portal.fund_signer_policies p on p.id=o.signer_policy_id and p.manifest_id=o.manifest_id\n    where o.id=target and (o.roleplay_policy_id is null or (p.roleplay_policy_id=o.roleplay_policy_id and p.roleplay_epoch=o.roleplay_epoch\n        and bx1_private.fund_roleplay_record_current(o.roleplay_policy_id,o.roleplay_epoch,o.product_id,o.offering_revision_id,\n          o.requested_by,o.requested_context,case o.kind when 'DEPLOYMENT' then 'request_fund_deployment' else 'request_fund_issuance' end)\n        and o.requested_person_id=bx1_private.fund_roleplay_person_for(o.product_id,o.requested_by)))\n      and bx1_portal.fund_manifest_current(o.manifest_id)\n      and p.status='ADMITTED' and p.admitted_until>pg_catalog.clock_timestamp()\n      and p.authority_epoch=o.authority_epoch and p.authority_policy_hash=o.authority_policy_hash\n      and (o.expires_at>pg_catalog.clock_timestamp() or o.state in ('BROADCAST','UNKNOWN','MINED','CONFIRMING'))\n      and (o.kind='DEPLOYMENT' or bx1_portal.fund_allocation_current(o.allocation_id))\n      and not exists(select 1 from bx1_portal.fund_operation_approvals a where a.operation_id=o.id\n        and (a.intent_hash<>o.intent_hash or a.authority_epoch<>o.authority_epoch\n          or (o.roleplay_policy_id is not null and (a.roleplay_policy_id is distinct from o.roleplay_policy_id\n            or a.roleplay_epoch is distinct from o.roleplay_epoch\n            or bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,o.product_id,o.offering_revision_id,a.actor_id,\n              a.operating_context,case o.kind when 'DEPLOYMENT' then 'approve_fund_deployment' else 'approve_fund_issuance' end) is not true))\n          or bx1_portal.fund_authority_current(a.authority_id) is not true)));\n"
  },
  {
    "signature": "bx1_portal.fund_allocation_current(uuid)",
    "sha": "8801d946eb6d10920a837da19f29536412d18b9793d3288fcaa719a5e4ed2b9a",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\n  select exists(select 1 from bx1_portal.fund_allocations a\n    join bx1_portal.subscriptions s on s.id=a.subscription_id and s.product_id=a.product_id\n      and s.offering_revision_id=a.offering_revision_id and s.investment_account_id=a.investment_account_id\n    join bx1_portal.funding_obligations o on o.id=a.obligation_id and o.subscription_id=s.id\n    join bx1_portal.product_eligibility_cases eligibility on eligibility.id=a.eligibility_case_id\n      and eligibility.revision=a.eligibility_revision and eligibility.investment_account_id=a.investment_account_id\n      and eligibility.product_id=a.product_id and eligibility.offering_revision_id=a.offering_revision_id\n    where a.id=target and (a.roleplay_policy_id is null or (\n        a.requested_person_id=bx1_private.fund_roleplay_person_for(a.product_id,a.requested_by)\n        and bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.offering_revision_id,\n          a.requested_by,a.requested_context,'request_fund_allocation')\n        and (a.approved_by is null or (a.approved_by=a.requested_by and a.approved_person_id=a.requested_person_id\n          and bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.offering_revision_id,a.approved_by,\n            pg_catalog.jsonb_build_object('mode','ROLE','organisationId',(select native_organisation_id from bx1_private.roleplay_policies where id=a.roleplay_policy_id),'role','TransferAgent'),'approve_fund_allocation')))\n        and exists(select 1 from bx1_portal.fund_payment_allocation_bases basis where basis.subscription_id=s.id and basis.status='APPROVED'\n          and basis.roleplay_policy_id=a.roleplay_policy_id and basis.roleplay_epoch=a.roleplay_epoch)))\n      and bx1_portal.fund_payment_basis_current(s.id) and s.status='AWAITING_FUNDING' and o.currency='TST' and o.token_decimals=6\n      and a.obligation_revision=o.revision and a.amount_base_units=o.token_amount_base_units\n      and a.evidence_set_hash=bx1_portal.funding_evidence_hash(o.id)\n      and bx1_portal.funding_state(o.id)='RECONCILED' and bx1_portal.funding_account_current(o.id)\n      and bx1_portal.product_eligibility_current(eligibility.id)\n      and bx1_portal.funding_route_current(o.route_id) and bx1_portal.fund_binding_current(a.delivery_binding_id)\n      and not exists(select 1 from bx1_portal.funding_reversals rev where rev.obligation_id=o.id));\n"
  },
  {
    "signature": "bx1_portal.fund_command(jsonb,text,uuid,jsonb)",
    "sha": "273572cd2fb268bd9eef5f7baefb4ab556ce0771c33165d98d780a1a13c6a660",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare p bx1_portal.products; m bx1_portal.fund_release_manifests; sp bx1_portal.fund_signer_policies;\n  o bx1_portal.fund_operations; a bx1_portal.fund_allocations; authz bx1_portal.fund_authorities;\n  s bx1_portal.subscriptions; obligation bx1_portal.funding_obligations; b bx1_portal.fund_delivery_bindings;\n  eligibility bx1_portal.product_eligibility_cases;\n  w public.bx1_wallets; previous bx1_portal.scoped_requests; rp_policy uuid; pid uuid; target uuid; before_rev integer;\nbegin\n  if action in ('request_fund_payment_allocation_basis','approve_fund_payment_allocation_basis') then\n    return bx1_portal.fund_payment_basis_command(c,action,key,body); end if;\n  if action not in ('request_fund_deployment','approve_fund_deployment','record_fund_transaction',\n    'request_fund_allocation','approve_fund_allocation','request_fund_issuance','approve_fund_issuance',\n    'bind_fund_delivery_wallet','cancel_fund_operation') or bx1_portal.fund_context(c,false) is not true then\n    raise exception 'fund_command_denied' using errcode='42501'; end if;\n  if key is null or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body)<>'object'\n    or pg_catalog.octet_length(body::text)>65536 then raise exception 'fund_command_invalid' using errcode='22023'; end if;\n  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||auth.uid()::text,0));\n  if exists(select 1 from bx1_portal.requests where actor_id=auth.uid() and request_key=key) then\n    raise exception 'fund_legacy_request_key_conflict' using errcode='23505'; end if;\n  if action='request_fund_deployment' then\n    perform bx1_portal.require_keys(body,array['product_id','expected_revision','manifest_id','signer_policy_id']);\n    pid:=(body->>'product_id')::uuid;\n  elsif action='bind_fund_delivery_wallet' then\n    perform bx1_portal.require_keys(body,array['investment_account_id','product_id','wallet_proof_id']);\n    pid:=(body->>'product_id')::uuid;\n  elsif action='request_fund_allocation' then\n    perform bx1_portal.require_keys(body,array['subscription_id','expected_obligation_revision']);\n    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid; pid:=s.product_id;\n  elsif action in ('approve_fund_allocation','request_fund_issuance') then\n    perform bx1_portal.require_keys(body,array['allocation_id','expected_revision']);\n    select * into a from bx1_portal.fund_allocations where id=(body->>'allocation_id')::uuid; pid:=a.product_id;\n  else\n    perform bx1_portal.require_keys(body,case when action='record_fund_transaction' then array['operation_id','expected_revision','transaction_hash']\n      when action='cancel_fund_operation' then array['operation_id','expected_revision','reason'] else array['operation_id','expected_revision'] end);\n    select * into o from bx1_portal.fund_operations where id=(body->>'operation_id')::uuid; pid:=o.product_id;\n  end if;\n  if pid is null then raise exception 'fund_target_denied' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_enter(c,pid,action,key);\n  select * into previous from bx1_portal.scoped_requests where actor_id=auth.uid() and request_key=key;\n  if previous.actor_id is not null then\n    if previous.command<>action or previous.payload<>body or previous.operating_context<>c then\n      raise exception 'fund_idempotency_conflict' using errcode='23505'; end if;\n    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,pid,action,key);end if;\n    return bx1_portal.fund_read(c);\n  end if;\n  perform bx1_portal.fund_lock(c,pid);\n  select * into p from bx1_portal.products where id=pid;\n  if action='request_fund_deployment' then\n    perform bx1_portal.funding_require_revision(p.revision,body->'expected_revision');\n    select * into m from bx1_portal.fund_release_manifests where id=(body->>'manifest_id')::uuid and product_id=p.id;\n    select * into sp from bx1_portal.fund_signer_policies where id=(body->>'signer_policy_id')::uuid and manifest_id=m.id;\n    if not bx1_portal.offering_workflow_operator(c,p.organisation_id)\n      and bx1_portal.fund_authority(c,sp.id,'TokenisationAgent') is null then\n      raise exception 'fund_deployment_request_scope_denied' using errcode='42501'; end if;\n    target:=bx1_portal.fund_new_operation(c,p.id,m.id,sp.id,null);\n  elsif action='bind_fund_delivery_wallet' then\n    if c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor' then raise exception 'fund_holder_required' using errcode='42501'; end if;\n    if bx1_portal.account_usable(c,(body->>'investment_account_id')::uuid) is not true then\n      raise exception 'fund_account_not_current' using errcode='42501'; end if;\n    select * into w from public.bx1_wallets where id=(body->>'wallet_proof_id')::uuid and user_id=auth.uid();\n    if w.id is not null then perform bx1_private.lock_roleplay_wallet_proof(auth.uid(),w.id,w.last_proof_id);end if;\n    if w.id is null or w.chain_id<>80002 or not exists(select 1 from bx1_private.wallet_challenges q\n      where q.id=w.last_proof_id and q.user_id=auth.uid() and q.used_at is not null and q.proof_signature is not null) then\n      raise exception 'fund_ownership_proof_required' using errcode='23514'; end if;\n    if exists(select 1 from bx1_portal.fund_allocations where investment_account_id=(body->>'investment_account_id')::uuid\n      and product_id=p.id and status not in ('CANCELLED')) then raise exception 'fund_allocated_wallet_recovery_required' using errcode='23514'; end if;\n    insert into bx1_portal.fund_delivery_bindings(investment_account_id,product_id,actor_id,wallet_proof_id,wallet_address,chain_id)\n      values((body->>'investment_account_id')::uuid,p.id,auth.uid(),w.id,w.address,w.chain_id)\n      on conflict(investment_account_id,product_id) do update set wallet_proof_id=excluded.wallet_proof_id,\n        wallet_address=excluded.wallet_address,status='ACTIVE',revision=bx1_portal.fund_delivery_bindings.revision+1 returning id into target;\n  elsif action='request_fund_allocation' then\n    select * into s from bx1_portal.subscriptions where id=s.id for update;\n    select * into obligation from bx1_portal.funding_obligations where subscription_id=s.id for update;\n    perform bx1_portal.funding_require_revision(obligation.revision,body->'expected_obligation_revision');\n    select * into m from bx1_portal.fund_release_manifests where product_id=p.id and offering_revision_id=s.offering_revision_id and status='ADMITTED';\n    select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED';\n    select * into authz from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,sp.id,'IssuerFundManager');\n    select * into b from bx1_portal.fund_delivery_bindings where investment_account_id=s.investment_account_id and product_id=p.id for share;\n    select * into eligibility from bx1_portal.product_eligibility_cases where investment_account_id=s.investment_account_id\n      and product_id=p.id and offering_revision_id=s.offering_revision_id for share;\n    if authz.id is null or bx1_portal.fund_manifest_current(m.id) is not true or obligation.currency is distinct from 'TST'\n      or bx1_portal.fund_payment_basis_current(s.id) is not true or obligation.token_decimals<>6 or bx1_portal.funding_state(obligation.id)<>'RECONCILED'\n      or bx1_portal.funding_account_current(obligation.id) is not true or bx1_portal.fund_binding_current(b.id) is not true\n      or bx1_portal.product_eligibility_current(eligibility.id) is not true\n      or (bx1_portal.entity_people_independent(auth.uid(),s.investor_id) is not true\n        and (rp_policy is null or bx1_private.fund_roleplay_allocation_basis_current(s.id,auth.uid(),c,action,authz.id) is not true)) then\n      raise exception 'fund_reconciled_current_allocation_required' using errcode='23514'; end if;\n    insert into bx1_portal.fund_allocations(subscription_id,obligation_id,product_id,offering_revision_id,\n      investment_account_id,delivery_binding_id,eligibility_case_id,eligibility_revision,units_base,amount_base_units,evidence_set_hash,obligation_revision,\n      requested_by,requested_person_id,requested_context)\n      values(s.id,obligation.id,p.id,s.offering_revision_id,s.investment_account_id,b.id,eligibility.id,eligibility.revision,\n        s.units*pg_catalog.power(10::numeric,m.security_unit_decimals),obligation.token_amount_base_units,\n        bx1_portal.funding_evidence_hash(obligation.id),obligation.revision,auth.uid(),authz.person_id,c) returning id into target;\n  elsif action in ('approve_fund_allocation','request_fund_issuance') then\n    select * into a from bx1_portal.fund_allocations where id=a.id for update; before_rev:=a.revision;\n    perform bx1_portal.funding_require_revision(a.revision,body->'expected_revision');\n    select * into m from bx1_portal.fund_release_manifests where product_id=a.product_id and offering_revision_id=a.offering_revision_id and status='ADMITTED';\n    select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED';\n    select * into authz from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,sp.id,\n      case when action='approve_fund_allocation' then 'TransferAgent' else 'TokenisationAgent' end);\n    if authz.id is null or bx1_portal.fund_allocation_current(a.id) is not true then\n      raise exception 'fund_allocation_authority_changed' using errcode='42501'; end if;\n    if action='approve_fund_allocation' then\n      if a.status<>'REQUESTED' or (bx1_portal.entity_people_independent(auth.uid(),a.requested_by) is not true\n        and (rp_policy is null or a.roleplay_policy_id is distinct from rp_policy or authz.roleplay_policy_id is distinct from rp_policy\n          or authz.roleplay_epoch is distinct from a.roleplay_epoch or a.requested_by<>auth.uid()\n          or a.requested_person_id is distinct from bx1_private.fund_roleplay_person_for(pid,auth.uid())\n          or bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,pid,a.offering_revision_id,\n            a.requested_by,a.requested_context,'request_fund_allocation') is not true\n          or bx1_private.fund_roleplay_lane_current(c,pid,action) is not true)) then\n        raise exception 'fund_independent_allocation_approval_required' using errcode='42501'; end if;\n      update bx1_portal.fund_allocations set status='APPROVED',revision=revision+1,\n        approved_by=auth.uid(),approved_person_id=authz.person_id,approved_at=pg_catalog.clock_timestamp() where id=a.id;\n      target:=a.id;\n    else target:=bx1_portal.fund_new_operation(c,p.id,m.id,sp.id,a.id); end if;\n  else\n    select * into o from bx1_portal.fund_operations where id=o.id for update; before_rev:=o.revision;\n    perform bx1_portal.funding_require_revision(o.revision,body->'expected_revision');\n    select * into sp from bx1_portal.fund_signer_policies where id=o.signer_policy_id;\n    select * into authz from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,sp.id,'TokenisationAgent');\n    if authz.id is null or bx1_portal.fund_operation_current(o.id) is not true then\n      raise exception 'fund_execution_authority_not_current' using errcode='42501'; end if;\n    if action in ('approve_fund_deployment','approve_fund_issuance') then\n      if o.state<>'APPROVAL_PENDING' or o.intent is null or o.expires_at<=pg_catalog.clock_timestamp()\n        or (action='approve_fund_deployment')<>(o.kind='DEPLOYMENT') or not authz.can_approve\n        or (bx1_portal.entity_people_independent(auth.uid(),o.requested_by) is not true\n          and (rp_policy is null or o.roleplay_policy_id is distinct from rp_policy\n            or authz.roleplay_policy_id is distinct from rp_policy or authz.roleplay_epoch is distinct from o.roleplay_epoch\n            or o.requested_by<>auth.uid() or o.requested_person_id is distinct from authz.person_id\n            or bx1_private.fund_roleplay_record_current(o.roleplay_policy_id,o.roleplay_epoch,pid,o.offering_revision_id,o.requested_by,\n              o.requested_context,case o.kind when 'DEPLOYMENT' then 'request_fund_deployment' else 'request_fund_issuance' end) is not true\n            or bx1_private.fund_roleplay_lane_current(c,pid,action) is not true)) then\n        raise exception 'fund_independent_intent_approval_required' using errcode='42501'; end if;\n      insert into bx1_portal.fund_operation_approvals(operation_id,authority_id,actor_id,person_id,operating_context,intent_hash,authority_epoch)\n        values(o.id,authz.id,auth.uid(),authz.person_id,c,o.intent_hash,o.authority_epoch);\n      update bx1_portal.fund_operations set revision=revision+1,updated_at=pg_catalog.clock_timestamp(),\n        state=case when (select count(*) from bx1_portal.fund_operation_approvals where operation_id=o.id)>=sp.approval_threshold then 'APPROVED' else 'APPROVAL_PENDING' end where id=o.id;\n    elsif action='record_fund_transaction' then\n      if o.state not in ('SIGNING','UNKNOWN','BROADCAST','REPLACED') or not authz.can_sign\n        or authz.signer_address is distinct from o.expectation->>'signer_address'\n        or not exists(select 1 from bx1_portal.fund_execution_claims claim where claim.operation_id=o.id and claim.actor_id=auth.uid())\n        or body->>'transaction_hash' !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'fund_broadcast_not_authorised' using errcode='23514'; end if;\n      insert into bx1_portal.fund_transaction_attempts(operation_id,transaction_hash,submitted_by)\n        values(o.id,pg_catalog.lower(body->>'transaction_hash'),auth.uid()) on conflict(operation_id,transaction_hash) do nothing;\n      update bx1_portal.fund_operations set state='BROADCAST',transaction_hash=pg_catalog.lower(body->>'transaction_hash'),\n        revision=revision+1,updated_at=pg_catalog.clock_timestamp() where id=o.id;\n    else\n      perform bx1_portal.require_text(body,'reason',20,2000);\n      if o.state not in ('REQUESTED','APPROVAL_PENDING','APPROVED','SIGNING_FAILED')\n        or exists(select 1 from bx1_portal.fund_safe_signatures where operation_id=o.id)\n        or exists(select 1 from bx1_portal.fund_transaction_attempts where operation_id=o.id) then\n        raise exception 'fund_signed_operation_requires_governed_revocation' using errcode='23514'; end if;\n      update bx1_portal.fund_operations set state='CANCELLED',nonce_released=true,revision=revision+1,\n        reason_code='CANCELLED_BEFORE_SIGNING',updated_at=pg_catalog.clock_timestamp() where id=o.id;\n    end if;\n    target:=o.id;\n  end if;\n  perform bx1_portal.fund_audit(p.id,target,case when action in ('request_fund_deployment','request_fund_issuance') then target else o.id end,\n    action,c,before_rev,null,null,body);\n  if bx1_portal.fund_context(c,false) is not true or bx1_portal.fund_product_visible(c,p.id) is not true\n    or (action not in ('request_fund_deployment','bind_fund_delivery_wallet') and (case when rp_policy is null then bx1_portal.fund_context(c,true) else bx1_private.fund_roleplay_lane_current(c,pid,action) end) is not true) then\n    raise exception 'fund_authority_expired_at_commit' using errcode='42501'; end if;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,command,payload,operating_context) values(auth.uid(),key,action,body,c);\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,pid,action,key);end if;\n  return bx1_portal.fund_read(c);\nend "
  },
  {
    "signature": "bx1_portal.fund_prepare(jsonb,uuid,integer)",
    "sha": "308bf4d160fcea1fc4c1f620a2fcc7947d0d92e9466a621e07beadaf4ac54165",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; rp_policy uuid; rp_key uuid; owners text[]; result jsonb;\nbegin\n  select * into o from bx1_portal.fund_operations where id=oid;\n  if o.id is null then raise exception 'fund_operation_denied' using errcode='42501'; end if;\n  select request_key into rp_key from bx1_private.fund_roleplay_command_lanes where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();\n  rp_key:=coalesce(rp_key,pg_catalog.gen_random_uuid());\n  rp_policy:=bx1_private.fund_roleplay_enter(c,o.product_id,'prepare_fund_transaction',rp_key);\n  if rp_policy is not null and rp_policy is distinct from o.roleplay_policy_id then raise exception 'fund_operation_policy_changed' using errcode='42501';end if;\n  perform bx1_portal.fund_lock(c,o.product_id);\n  select * into o from bx1_portal.fund_operations where id=oid for update;\n  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');\n  if o.revision<>expected_revision or a.id is null or not a.can_sign\n    or o.state not in ('REQUESTED','APPROVED','SIGNING','BROADCAST','MINED','CONFIRMING','UNKNOWN','REPLACED')\n    or (o.state in ('REQUESTED','APPROVED','SIGNING') and o.expires_at<=pg_catalog.clock_timestamp())\n    or bx1_portal.fund_operation_current(o.id) is not true then raise exception 'fund_preparation_not_authorised' using errcode='42501'; end if;\n  owners:=bx1_private.fund_roleplay_owner_addresses(c,o.id);\n  result:=pg_catalog.jsonb_build_object('expectation',o.expectation,'operation',bx1_portal.fund_operation_projection(c,o.id),\n    'signing_owner_address',case when rp_policy is null or cardinality(owners)=1\n      or (select signing_address from bx1_private.fund_roleplay_command_lanes where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid()) is not null then a.signer_address end,\n    'signing_owner_addresses',pg_catalog.to_jsonb(owners));\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,o.product_id,'prepare_fund_transaction',rp_key);end if;\n  return result;\nend "
  },
  {
    "signature": "bx1_portal.fund_record_signature(jsonb,uuid,integer,text)",
    "sha": "1e19c85ee8320a69e4f35353c17e41ab2d5f7944cdbdc5a8281d921a6d69025b",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; sid uuid; rp_policy uuid; rp_key uuid; result jsonb;\nbegin\n  select * into o from bx1_portal.fund_operations where id=oid;\n  if o.id is null then raise exception 'fund_operation_denied' using errcode='42501'; end if;\n  select request_key into rp_key from bx1_private.fund_roleplay_command_lanes where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();\n  rp_key:=coalesce(rp_key,pg_catalog.gen_random_uuid());\n  rp_policy:=bx1_private.fund_roleplay_enter(c,o.product_id,'record_fund_signature',rp_key);\n  if rp_policy is not null and rp_policy is distinct from o.roleplay_policy_id then raise exception 'fund_operation_policy_changed' using errcode='42501';end if;\n  perform bx1_portal.fund_lock(c,o.product_id);\n  select * into o from bx1_portal.fund_operations where id=oid for update;\n  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');\n  if o.revision<>expected_revision or a.id is null or not a.can_sign or o.state not in ('APPROVED','SIGNING')\n    or o.intent is null or raw_signature !~ '^0x[0-9a-fA-F]{130}$'\n    or bx1_portal.fund_operation_current(o.id) is not true or o.expires_at<=pg_catalog.clock_timestamp() then\n    raise exception 'fund_signature_not_authorised' using errcode='42501'; end if;\n  select id into sid from bx1_portal.fund_safe_signatures where operation_id=o.id and actor_id=auth.uid()\n    and (rp_policy is null or (authority_id=a.id and roleplay_policy_id=rp_policy and roleplay_epoch=o.roleplay_epoch and roleplay_signing_address=a.signer_address));\n  if sid is not null then\n    if not exists(select 1 from bx1_portal.fund_safe_signatures where id=sid and signature=raw_signature\n      and intent_hash=o.intent_hash and authority_epoch=o.authority_epoch) then\n      raise exception 'fund_signature_replay_conflict' using errcode='23505'; end if;\n    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,o.product_id,'record_fund_signature',rp_key);end if;\n    return pg_catalog.jsonb_build_object('signature_id',sid,'operation_revision',o.revision);\n  end if;\n  insert into bx1_portal.fund_safe_signatures(operation_id,authority_id,actor_id,person_id,signature,intent_hash,authority_epoch)\n    values(o.id,a.id,auth.uid(),a.person_id,raw_signature,o.intent_hash,o.authority_epoch) returning id into sid;\n  update bx1_portal.fund_operations set state='SIGNING',revision=revision+1,updated_at=pg_catalog.clock_timestamp() where id=o.id;\n  perform bx1_portal.fund_audit(o.product_id,sid,o.id,'FUND_RAW_SIGNATURE_RECEIVED',c,o.revision,o.revision+1,sid,\n    pg_catalog.jsonb_build_object('signature_id',sid,'status','UNVERIFIED','intent_hash',o.intent_hash));\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,o.product_id,'record_fund_signature',rp_key);end if;\n  return pg_catalog.jsonb_build_object('signature_id',sid,'state','UNVERIFIED','operation_revision',o.revision+1);\nend "
  },
  {
    "signature": "bx1_portal.fund_claim_execution(jsonb,uuid,integer)",
    "sha": "3753eb06ff84860a5511dd5f852329b799361bca6c9217fd51a4f60e5d1393af",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; sp bx1_portal.fund_signer_policies; signatures jsonb; n integer; rp_policy uuid; rp_key uuid:=pg_catalog.gen_random_uuid();result jsonb;\nbegin\n  select * into o from bx1_portal.fund_operations where id=oid;\n  if o.id is null then raise exception 'fund_operation_denied' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_enter(c,o.product_id,'claim_fund_execution',rp_key);\n  if rp_policy is not null and rp_policy is distinct from o.roleplay_policy_id then raise exception 'fund_operation_policy_changed' using errcode='42501';end if;\n  perform bx1_portal.fund_lock(c,o.product_id);\n  select * into o from bx1_portal.fund_operations where id=oid for update;\n  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');\n  select * into sp from bx1_portal.fund_signer_policies where id=o.signer_policy_id;\n  if o.revision<>expected_revision or a.id is null or not a.can_sign or o.state<>'SIGNING'\n    or a.signer_address<>o.expectation->>'signer_address' or bx1_portal.fund_operation_current(o.id) is not true\n    or o.expires_at<=pg_catalog.clock_timestamp() then raise exception 'fund_execution_not_authorised' using errcode='42501'; end if;\n  select count(*),pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_address',s.recovered_address,'signature',s.signature) order by s.recovered_address)\n    into n,signatures from bx1_portal.fund_safe_signatures s\n    where s.operation_id=o.id and s.status='VERIFIED' and s.intent_hash=o.intent_hash and s.authority_epoch=o.authority_epoch\n      and bx1_portal.fund_authority_current(s.authority_id);\n  if n<sp.safe_threshold then raise exception 'fund_verified_human_threshold_required' using errcode='23514'; end if;\n  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_address',picked.recovered_address,'signature',picked.signature)\n    order by picked.recovered_address) into signatures from (\n      select sig.recovered_address,sig.signature from bx1_portal.fund_safe_signatures sig\n      where sig.operation_id=o.id and sig.status='VERIFIED' and sig.intent_hash=o.intent_hash\n        and sig.authority_epoch=o.authority_epoch and bx1_portal.fund_authority_current(sig.authority_id)\n      order by sig.recovered_address limit sp.safe_threshold) picked;\n  insert into bx1_portal.fund_execution_claims(operation_id,actor_id,authority_id,claimed_revision,signature_set_hash)\n    values(o.id,auth.uid(),a.id,o.revision,bx1_portal.fund_digest(signatures));\n  -- UNKNOWN is durable before the wallet broadcast. A lost response must not\n  -- offer another spend/sign operation; it is a recovery/observation case.\n  update bx1_portal.fund_operations set state='UNKNOWN',revision=revision+1,reason_code='EXECUTION_CLAIMED_OUTCOME_UNKNOWN',updated_at=pg_catalog.clock_timestamp() where id=o.id;\n  perform bx1_portal.fund_audit(o.product_id,o.id,o.id,'FUND_EXECUTION_CLAIMED',c,o.revision,o.revision+1,null,signatures);\n  result:=pg_catalog.jsonb_build_object('expectation',o.expectation,'intent',o.intent,'signatures',signatures,\n    'operation_revision',o.revision+1,'operation',bx1_portal.fund_operation_projection(c,o.id));\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,o.product_id,'claim_fund_execution',rp_key);end if;\n  return result;\nend "
  },
  {
    "signature": "bx1_portal.fund_prepare_payment(jsonb,uuid,integer,text)",
    "sha": "c170014d6c45ffe832fcf9cae268f9dcef649d61cfcbca2dfa42dd8033989e20",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare s bx1_portal.subscriptions; o bx1_portal.funding_obligations; r bx1_portal.funding_routes; p bx1_portal.fund_payment_intents;\n  rp_policy uuid;rp_key uuid:=pg_catalog.gen_random_uuid();\nbegin\n  select * into s from bx1_portal.subscriptions where id=sid and investor_id=auth.uid();\n  if s.id is null or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then\n    raise exception 'fund_payment_holder_required' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_enter(c,s.product_id,'prepare_fund_payment',rp_key);\n  perform bx1_portal.fund_lock(c,s.product_id);\n  if bx1_portal.fund_payment_basis_current(s.id) is not true then raise exception 'fund_issuer_allocation_basis_required_before_payment' using errcode='23514'; end if;\n  select * into o from bx1_portal.funding_obligations where subscription_id=s.id for update;\n  select * into r from bx1_portal.funding_routes where id=o.route_id for share;\n  if o.revision<>expected_revision or o.currency is distinct from 'TST' or o.token_decimals<>6 or r.denomination is distinct from 'TST'\n    or r.chain_id<>80002 or bx1_portal.funding_route_current(r.id) is not true\n    or bx1_portal.funding_account_current(o.id) is not true or bx1_portal.offering_technical_ready(s.offering_revision_id) is not true\n    or not exists(select 1 from bx1_portal.product_eligibility_cases eligibility where eligibility.investment_account_id=s.investment_account_id\n      and eligibility.product_id=s.product_id and eligibility.offering_revision_id=s.offering_revision_id\n      and bx1_portal.product_eligibility_current(eligibility.id))\n    or bx1_portal.funding_state(o.id)<>'AWAITING_FUNDING' or pg_catalog.lower(payer) !~ '^0x[0-9a-f]{40}$'\n    or pg_catalog.lower(payer)='0x0000000000000000000000000000000000000000' then\n    raise exception 'fund_payment_current_tst_obligation_required' using errcode='23514'; end if;\n  select * into p from bx1_portal.fund_payment_intents where obligation_id=o.id for update;\n  if p.id is not null and bx1_portal.fund_payment_basis_intent_current(p.id) is not true then\n    raise exception 'fund_existing_payment_basis_requires_recovery' using errcode='23514'; end if;\n  if p.id is not null then\n    if p.state<>'PREPARED' or p.payer_address<>pg_catalog.lower(payer) or p.obligation_revision<>o.revision\n      or p.route_revision<>r.revision or p.claimed_at is not null or p.transaction_hash is not null then\n      raise exception 'fund_existing_payment_requires_recovery' using errcode='23514'; end if;\n    if p.expires_at<=pg_catalog.clock_timestamp() then\n      update bx1_portal.fund_payment_intents set expires_at=pg_catalog.clock_timestamp()+interval '5 minutes' where id=p.id;\n      perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_UNSENT_PAYMENT_RENEWED',c,null,null,null,\n        pg_catalog.jsonb_build_object('payment_id',p.id,'obligation_revision',o.revision,'route_revision',r.revision));\n    end if;\n    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,'prepare_fund_payment',rp_key);end if;\n    return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id));\n  end if;\n  insert into bx1_portal.fund_payment_intents(subscription_id,obligation_id,obligation_revision,route_id,route_revision,\n    actor_id,payer_address,token_address,beneficiary_address,amount_base_units,expires_at)\n    values(s.id,o.id,o.revision,r.id,r.revision,auth.uid(),pg_catalog.lower(payer),r.token_address,r.receiving_address,\n      o.token_amount_base_units,pg_catalog.clock_timestamp()+interval '5 minutes') returning * into p;\n  perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_PAYMENT_PREPARED',c,null,1,null,\n    pg_catalog.jsonb_build_object('subscription_id',s.id,'obligation_id',o.id,'amount_base_units',o.token_amount_base_units::text));\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,'prepare_fund_payment',rp_key);end if;\n  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id));\nend "
  },
  {
    "signature": "bx1_portal.fund_submit_payment(jsonb,uuid)",
    "sha": "40534d14977b0529dd0147e4c92371ebb45f70bef335d1e123160c601ccd51e1",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare p bx1_portal.fund_payment_intents; o bx1_portal.funding_obligations; s bx1_portal.subscriptions;\n  rp_policy uuid;rp_key uuid:=pg_catalog.gen_random_uuid();\nbegin\n  select * into p from bx1_portal.fund_payment_intents where id=payment and actor_id=auth.uid();\n  select * into s from bx1_portal.subscriptions where id=p.subscription_id;\n  if p.id is null or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then raise exception 'fund_payment_denied' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_enter(c,s.product_id,'submit_fund_payment',rp_key);\n  perform bx1_portal.fund_lock(c,s.product_id);\n  if bx1_portal.fund_payment_basis_intent_current(p.id) is not true then raise exception 'fund_issuer_allocation_basis_changed_before_submission' using errcode='23514'; end if;\n  select * into p from bx1_portal.fund_payment_intents where id=payment for update;\n  select * into o from bx1_portal.funding_obligations where id=p.obligation_id for update;\n  if p.state<>'PREPARED' or p.expires_at<=pg_catalog.clock_timestamp() or p.obligation_revision<>o.revision\n    or bx1_portal.funding_account_current(o.id) is not true or bx1_portal.funding_state(o.id)<>'AWAITING_FUNDING'\n    or not exists(select 1 from bx1_portal.product_eligibility_cases eligibility where eligibility.investment_account_id=s.investment_account_id\n      and eligibility.product_id=s.product_id and eligibility.offering_revision_id=s.offering_revision_id\n      and bx1_portal.product_eligibility_current(eligibility.id))\n    or not exists(select 1 from bx1_portal.funding_routes r where r.id=p.route_id and r.revision=p.route_revision\n      and r.denomination='TST' and r.token_address=p.token_address and r.receiving_address=p.beneficiary_address\n      and bx1_portal.funding_route_current(r.id)) then raise exception 'fund_payment_intent_changed' using errcode='23514'; end if;\n  update bx1_portal.fund_payment_intents set state='UNKNOWN',claimed_at=pg_catalog.clock_timestamp() where id=p.id;\n  perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_PAYMENT_CLAIMED',c,1,2,null,\n    pg_catalog.jsonb_build_object('payment_id',p.id,'state','UNKNOWN'));\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,'submit_fund_payment',rp_key);end if;\n  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id));\nend "
  },
  {
    "signature": "bx1_portal.fund_record_payment(jsonb,uuid,text)",
    "sha": "72ab8fafa7c21219666649b44d5f6602759acb1c564be82bb800a03dae5211be",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres,authenticated=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare p bx1_portal.fund_payment_intents; s bx1_portal.subscriptions;\n  rp_policy uuid;rp_key uuid:=pg_catalog.gen_random_uuid();\nbegin\n  select * into p from bx1_portal.fund_payment_intents where id=payment and actor_id=auth.uid();\n  select * into s from bx1_portal.subscriptions where id=p.subscription_id;\n  if p.id is null or pg_catalog.lower(tx) !~ '^0x[0-9a-f]{64}$' or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then\n    raise exception 'fund_payment_record_denied' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_enter(c,s.product_id,'record_fund_payment',rp_key);\n  perform bx1_portal.fund_lock(c,s.product_id);\n  select * into p from bx1_portal.fund_payment_intents where id=payment for update;\n  if p.state='BROADCAST' and p.transaction_hash=pg_catalog.lower(tx) then\n    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,'record_fund_payment',rp_key);end if;\n    return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id),'next_action','SUBMIT_SIGNED_FUNDING_REFERENCE'); end if;\n  if p.state<>'UNKNOWN' or p.transaction_hash is not null then raise exception 'fund_payment_record_conflict' using errcode='23505'; end if;\n  update bx1_portal.fund_payment_intents set state='BROADCAST',transaction_hash=pg_catalog.lower(tx) where id=p.id;\n  perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_PAYMENT_BROADCAST_RECORDED',c,2,3,null,\n    pg_catalog.jsonb_build_object('payment_id',p.id,'transaction_hash',pg_catalog.lower(tx)));\n  -- A hash is not a verified payment. Existing signed funding-reference,\n  -- independent receipt observation, Treasury and Controller paths remain.\n  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,'record_fund_payment',rp_key);end if;\n  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id),'next_action','SUBMIT_SIGNED_FUNDING_REFERENCE');\nend "
  },
  {
    "signature": "bx1_portal.fund_operation_actions(jsonb,uuid)",
    "sha": "afc5053d2a6adbda9ed5915d82ab0231c59fa53e911497a932a6ba03493e69d0",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; allowed boolean; actions jsonb:='[]'::jsonb;\nbegin\n  select * into o from bx1_portal.fund_operations where id=oid;\n  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');\n  if o.id is null then return actions; end if;\n  allowed:=a.id is not null and bx1_portal.fund_operation_current(o.id);\n  if o.state='REQUESTED' then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action(null,o.id,o.revision,\n      'Prepare the contract request','TokenisationAgent',allowed and a.can_sign and o.expires_at>pg_catalog.clock_timestamp(),\n      'PREPARATION_REQUIRED',null));\n  end if;\n  if o.state='APPROVAL_PENDING' then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action(\n      case when o.kind='DEPLOYMENT' then 'approve_fund_deployment' else 'approve_fund_issuance' end,o.id,o.revision,\n      case when o.kind='DEPLOYMENT' then 'Approve deployment request' else 'Approve unit issuance' end,'TokenisationAgent',\n      allowed and a.can_approve and ((o.roleplay_policy_id is null and a.person_id is distinct from o.requested_person_id\n        and bx1_portal.entity_people_independent(a.user_id,o.requested_by)\n        and not exists(select 1 from bx1_portal.fund_operation_approvals ap where ap.operation_id=o.id and ap.person_id=a.person_id))\n        or (o.roleplay_policy_id is not null and o.requested_by=auth.uid()\n          and bx1_private.fund_roleplay_record_current(o.roleplay_policy_id,o.roleplay_epoch,o.product_id,o.offering_revision_id,\n            o.requested_by,o.requested_context,case o.kind when 'DEPLOYMENT' then 'request_fund_deployment' else 'request_fund_issuance' end)\n          and bx1_private.fund_roleplay_record_current(o.roleplay_policy_id,o.roleplay_epoch,o.product_id,o.offering_revision_id,auth.uid(),\n            c,case o.kind when 'DEPLOYMENT' then 'approve_fund_deployment' else 'approve_fund_issuance' end)\n          and exists(select 1 from bx1_portal.fund_authorities owner\n            where owner.signer_policy_id=o.signer_policy_id and owner.user_id=auth.uid()\n              and owner.roleplay_policy_id=o.roleplay_policy_id and owner.roleplay_epoch=o.roleplay_epoch and owner.can_approve\n              and bx1_private.fund_roleplay_authority_current(owner.id)\n              and not exists(select 1 from bx1_portal.fund_operation_approvals ap\n                where ap.operation_id=o.id and ap.roleplay_signing_address=owner.signer_address)))),\n      case when not allowed then 'CURRENT_SIGNING_AUTHORITY_REQUIRED' end,\n      pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision)));\n  end if;\n  if o.state in ('APPROVED','SIGNING') then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action(null,o.id,o.revision,\n      'Review and sign the approved request','TokenisationAgent',allowed and a.can_sign\n        and o.intent is not null and o.expires_at>pg_catalog.clock_timestamp(),'SAFE_SIGNATURE_REQUIRED',null));\n  end if;\n  if o.state in ('UNKNOWN','BROADCAST','REPLACED') then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('record_fund_transaction',o.id,o.revision,\n      'Record the existing transaction hash','TokenisationAgent',allowed and a.can_sign\n        and a.signer_address=o.expectation->>'signer_address'\n        and exists(select 1 from bx1_portal.fund_execution_claims claim where claim.operation_id=o.id and claim.actor_id=auth.uid()),\n      'EXISTING_TRANSACTION_HASH_REQUIRED',pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision)));\n  end if;\n  if o.state in ('REQUESTED','APPROVAL_PENDING','APPROVED','SIGNING','SIGNING_FAILED') then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('cancel_fund_operation',o.id,o.revision,\n      'Cancel unsigned operation','TokenisationAgent',false,'REASON_REQUIRED',null));\n  end if;\n  return actions;\nend "
  },
  {
    "signature": "bx1_portal.fund_operation_projection(jsonb,uuid)",
    "sha": "4ba8b930131b55634030c1e8dae7f558f4d9b607840946fef8e9d0bc6ab7eba6",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare o bx1_portal.fund_operations; m bx1_portal.fund_release_manifests; intent jsonb;\nbegin\n  select * into o from bx1_portal.fund_operations where id=oid;\n  select * into m from bx1_portal.fund_release_manifests where id=o.manifest_id;\n  if o.id is null or bx1_portal.fund_product_visible(c,o.product_id) is not true then return null; end if;\n  -- Intent is withheld from customer roles and while authority/evidence drift.\n  if bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent') is not null\n    and bx1_portal.fund_operation_current(o.id) and (o.state in ('APPROVED','SIGNING') or (o.roleplay_policy_id is not null and o.state='APPROVAL_PENDING')) then intent:=o.intent; end if;\n  return pg_catalog.jsonb_build_object('id',o.id,'product_id',o.product_id,'offering_revision_id',o.offering_revision_id,\n    'subscription_id',o.subscription_id,'allocation_id',o.allocation_id,'revision',o.revision,'kind',o.kind,'state',o.state,\n    'chain_id',o.chain_id,'transaction_hash',o.transaction_hash,'token_address',o.token_address,\n    'controller_address',o.controller_address,'manifest_id',o.manifest_id,'manifest_hash',m.manifest_hash,\n    'intent_hash',o.intent_hash,'expires_at',o.expires_at,'confirmations',o.confirmations,\n    'required_confirmations',m.required_confirmations,'reason_code',o.reason_code,'intent',intent,\n    'actions',bx1_portal.fund_operation_actions(c,o.id),\n    'signing_owner_address',case when cardinality(bx1_private.fund_roleplay_owner_addresses(c,o.id))=1\n      then (bx1_private.fund_roleplay_owner_addresses(c,o.id))[1] end,\n    'signing_owner_addresses',pg_catalog.to_jsonb(bx1_private.fund_roleplay_owner_addresses(c,o.id)),\n    'signer_threshold',(select safe_threshold from bx1_portal.fund_signer_policies where id=o.signer_policy_id),\n    'signature_count',(select count(*) from bx1_portal.fund_safe_signatures sig where sig.operation_id=o.id\n      and sig.status='VERIFIED' and bx1_portal.fund_authority_current(sig.authority_id)));\nend "
  },
  {
    "signature": "bx1_portal.fund_order_projection(jsonb,uuid)",
    "sha": "25e2e6955b3e915c2feaa9feecd235ff1bfdbc1cc664a14b90188a2711608771",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "\ndeclare s bx1_portal.subscriptions; o bx1_portal.funding_obligations; r bx1_portal.funding_routes;\n  a bx1_portal.fund_allocations; b bx1_portal.fund_delivery_bindings; m bx1_portal.fund_release_manifests;\n  sp bx1_portal.fund_signer_policies; funding jsonb; actions jsonb:='[]'::jsonb; allocation_role text;\nbegin\n  select * into s from bx1_portal.subscriptions where id=sid;\n  if s.id is null or bx1_portal.fund_order_visible(c,s.id) is not true then return null; end if;\n  select * into o from bx1_portal.funding_obligations where subscription_id=s.id;\n  select * into r from bx1_portal.funding_routes where id=o.route_id;\n  select * into a from bx1_portal.fund_allocations where subscription_id=s.id;\n  select * into b from bx1_portal.fund_delivery_bindings where investment_account_id=s.investment_account_id and product_id=s.product_id;\n  select * into m from bx1_portal.fund_release_manifests where product_id=s.product_id and offering_revision_id=s.offering_revision_id and status='ADMITTED';\n  select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED';\n  if s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor')\n    and a.id is null and m.id is not null and bx1_portal.account_usable(c,s.investment_account_id)\n    and (b.id is null or bx1_portal.fund_binding_current(b.id) is not true) then\n    actions:=actions||coalesce((select pg_catalog.jsonb_agg(bx1_portal.fund_action('bind_fund_delivery_wallet',w.id,1,\n      'Use this wallet for fund units','Investor',true,null,pg_catalog.jsonb_build_object(\n        'investment_account_id',s.investment_account_id,'product_id',s.product_id,'wallet_proof_id',w.id)) order by w.verified_at desc,w.id)\n      from public.bx1_wallets w join bx1_private.wallet_challenges proof on proof.id=w.last_proof_id\n      where w.user_id=auth.uid() and w.organisation_id=m.native_organisation_id and w.chain_id=80002\n        and proof.user_id=auth.uid() and proof.used_at is not null and proof.proof_signature is not null),'[]'::jsonb);\n  end if;\n  if o.currency='TST' and o.token_decimals=6 and r.denomination='TST' then\n    funding:=pg_catalog.jsonb_build_object('obligation_id',o.id,'obligation_revision',o.revision,'route_id',r.id,'route_revision',r.revision,\n      'currency','TST','settlement_decimals',6,'chain_id',80002,'settlement_token_address',r.token_address,\n      'beneficiary_address',r.receiving_address,'required_base_units',o.token_amount_base_units::text,\n      'verified_base_units',bx1_portal.funding_totals(o.id)->>'observed','posted_base_units',bx1_portal.funding_totals(o.id)->>'posted',\n      'evidence_set_hash',bx1_portal.funding_evidence_hash(o.id),'state',bx1_portal.funding_state(o.id),\n      'can_pay',s.investor_id=auth.uid() and bx1_portal.funding_actions(c,'OBLIGATION',o.id)?'submit_funding_reference'\n        and bx1_portal.offering_technical_ready(s.offering_revision_id) and bx1_portal.fund_payment_basis_current(s.id)\n        and bx1_portal.funding_state(o.id)='AWAITING_FUNDING'\n        and (not exists(select 1 from bx1_portal.fund_payment_intents where obligation_id=o.id)\n          or exists(select 1 from bx1_portal.fund_payment_intents payment where payment.obligation_id=o.id\n            and payment.actor_id=auth.uid() and payment.state='PREPARED' and payment.claimed_at is null\n            and payment.transaction_hash is null and payment.obligation_revision=o.revision and payment.route_revision=r.revision)));\n  end if;\n  if a.id is null and o.id is not null then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_allocation',s.id,o.revision,\n      'Prepare investor allocation','IssuerFundManager',\n      bx1_portal.fund_authority(c,sp.id,'IssuerFundManager') is not null and bx1_portal.funding_state(o.id)='RECONCILED'\n        and bx1_portal.fund_payment_basis_current(s.id) and bx1_portal.fund_binding_current(b.id),'RECONCILED_PAYMENT_AND_WALLET_REQUIRED',\n      pg_catalog.jsonb_build_object('subscription_id',s.id,'expected_obligation_revision',o.revision)));\n  elsif a.status='REQUESTED' then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('approve_fund_allocation',a.id,a.revision,\n      'Approve investor allocation','TransferAgent',bx1_portal.fund_authority(c,sp.id,'TransferAgent') is not null\n        and bx1_portal.fund_allocation_current(a.id) and (bx1_portal.entity_people_independent(auth.uid(),a.requested_by)\n          or (a.roleplay_policy_id is not null and a.requested_by=auth.uid()\n            and a.requested_person_id=bx1_private.fund_roleplay_person_for(a.product_id,auth.uid())\n            and bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.offering_revision_id,\n              a.requested_by,a.requested_context,'request_fund_allocation')\n            and bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.offering_revision_id,\n              auth.uid(),c,'approve_fund_allocation'))),\n      'CURRENT_INDEPENDENT_ALLOCATION_REVIEW_REQUIRED',pg_catalog.jsonb_build_object('allocation_id',a.id,'expected_revision',a.revision)));\n  elsif a.status='APPROVED' then\n    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_issuance',a.id,a.revision,\n      'Request unit issuance','TokenisationAgent',bx1_portal.fund_authority(c,sp.id,'TokenisationAgent') is not null\n        and bx1_portal.fund_allocation_current(a.id),'CURRENT_ISSUANCE_AUTHORITY_REQUIRED',\n      pg_catalog.jsonb_build_object('allocation_id',a.id,'expected_revision',a.revision)));\n  end if;\n  return pg_catalog.jsonb_build_object('subscription_id',s.id,'product_id',s.product_id,'investment_account_id',s.investment_account_id,\n    'allocation_id',a.id,'allocation_revision',a.revision,\n    'units_base',(s.units*pg_catalog.power(10::numeric,coalesce(m.security_unit_decimals,0)))::numeric(78,0)::text,\n    'security_unit_decimals',coalesce(m.security_unit_decimals,0),'funding',funding,\n    'delivery_wallet',case when b.id is not null then pg_catalog.jsonb_build_object('binding_id',b.id,'proof_id',b.wallet_proof_id,\n      'address',b.wallet_address,'chain_id',b.chain_id,'effective',bx1_portal.fund_binding_current(b.id)) end,\n    'issuance_operation_id',(select id from bx1_portal.fund_operations where allocation_id=a.id),'payment_allocation_basis',bx1_portal.fund_payment_basis_projection(c,s.id),'actions',bx1_portal.fund_payment_basis_actions(c,s.id)||actions);\nend "
  },
  {
    "signature": "bx1_portal.guard_offering_decision_appointment()",
    "sha": "f9d59d64e5ea2ea1b1803384de5eaff46b86b0905c385b02641bedf6e93f9a23",
    "secdef": true,
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "config": [
      "search_path=\"\""
    ],
    "next_body": "declare target_product uuid; target_role text;\n  candidate bx1_portal.product_service_appointments;\n  p bx1_portal.products; o bx1_portal.organisations;\n  r bx1_portal.offering_revisions;\nbegin\n  select * into r from bx1_portal.offering_revisions\n    where id=new.offering_revision_id;\n  target_product:=r.product_id;\n  target_role:=case new.decision_kind when 'ISSUER' then 'IssuerFundManager'\n    when 'COMPLIANCE' then 'ComplianceOfficer' end;\n  if new.actor_id is distinct from auth.uid() or target_product is null\n    or target_role is null then\n    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;\n  -- BEFORE INSERT triggers run by name. The file-review trigger can run\n  -- after this one, and it takes the product FOR UPDATE. Take that lock first\n  -- here as well: appointment revoke/review/apply all use product -> appointment.\n  -- Otherwise a privileged direct insert can hold the appointment FOR SHARE\n  -- while waiting for the product, deadlocking a concurrent revocation.\n  select * into p from bx1_portal.products where id=target_product for update;\n  if p.id is null then\n    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;\n  declare ce_common text; ce_configuration text;\n  begin\n    if r.terms->'terms_version'='3'::jsonb then\n      if r.origin is distinct from 'SUBMITTED' or r.id is distinct from p.current_offering_revision_id\n        or r.terms is distinct from p.terms or r.terms_hash is distinct from p.terms_hash then\n        raise exception 'common_envelope_decision_provenance' using errcode='23514'; end if;\n      ce_common:=bx1_portal.product_common_envelope_hash(p.id,r.terms);\n      ce_configuration:=bx1_portal.product_deployment_configuration_hash(p.id,r.terms);\n      if r.common_envelope_hash is distinct from ce_common or r.deployment_configuration_hash is distinct from ce_configuration\n        or (new.common_envelope_hash is not null and new.common_envelope_hash is distinct from ce_common)\n        or (new.deployment_configuration_hash is not null and new.deployment_configuration_hash is distinct from ce_configuration) then\n        raise exception 'common_envelope_decision_binding' using errcode='23514'; end if;\n      new.common_envelope_hash:=ce_common; new.deployment_configuration_hash:=ce_configuration;\n    elsif new.common_envelope_hash is not null or new.deployment_configuration_hash is not null then\n      raise exception 'common_envelope_legacy_decision_binding' using errcode='23514';\n    end if;\n  end;\n  perform bx1_portal.offering_workflow_lock_product(new.operating_context,target_product);\n  select * into candidate from bx1_portal.product_service_appointments a\n    where a.product_id=target_product and a.role=target_role\n      and a.appointee_user_id=new.actor_id and a.status='APPLIED'\n    order by a.id limit 1 for share;\n  if candidate.id is null then\n    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;\n  select * into o from bx1_portal.organisations where id=p.organisation_id;\n  -- This DB trigger also protects privileged internal writers. The canonical\n  -- command path already holds the product lock; pin every trusted human who\n  -- makes this appointment effective before the final authority check.\n  declare roleplay_users uuid[];\n  begin\n    if auth.uid() is not null and new.operating_context->>'mode'='ROLE'\n      and new.operating_context->>'role'=target_role\n      and bx1_private.fund_roleplay_lane_current(new.operating_context,target_product,\n        case new.decision_kind when 'ISSUER' then 'review_offering_issuer'\n          when 'COMPLIANCE' then 'review_product' end) is true then\n      select pg_catalog.array_agg(distinct locked.user_id order by locked.user_id) into roleplay_users from (\n        select pg_catalog.unnest(array[new.actor_id,candidate.requested_by_user_id,\n          candidate.reviewed_by_user_id,candidate.applied_by_user_id,\n          p.created_by,o.owner_id,r.submitted_by]) user_id\n        union select history.submitted_by from bx1_portal.offering_revisions history\n          where history.product_id=target_product and history.origin='SUBMITTED' and history.terms_hash=r.terms_hash\n      ) locked where locked.user_id is not null;\n    end if;\n    if roleplay_users is not null and pg_catalog.cardinality(roleplay_users)>0\n      and not exists(select 1 from pg_catalog.unnest(roleplay_users) locked(user_id)\n        where locked.user_id is distinct from auth.uid()) then\n      perform bx1_portal.admission_lock_people(roleplay_users);\n    else\n      perform bx1_portal.offering_workflow_lock_lineage_people(target_product,r.terms_hash,\n        array[new.actor_id,candidate.requested_by_user_id,\n        candidate.reviewed_by_user_id,candidate.applied_by_user_id,\n        p.created_by,o.owner_id,r.submitted_by]);\n    end if;\n  end;\n  if bx1_portal.offering_workflow_product_appointment_authorised(\n      new.operating_context,target_product,target_role) is not true\n    or bx1_portal.offering_workflow_product_appointment_effective(candidate.id) is not true\n    or bx1_portal.offering_workflow_lineage_independent(new.actor_id,target_product,r.terms_hash) is not true then\n    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;\n  new.product_appointment_id:=candidate.id;\n  return new;\nend"
  }
]
$roleplay_specs$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'fund_roleplay_canonical_signature_missing: %',spec->>'signature';end if;
    select pg_catalog.to_jsonb(p)-'prosrc',p.prosrc into before_row,source_body from pg_catalog.pg_proc p where p.oid=target;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(source_body,E'\r\n',E'\n'),'UTF8')),'hex') is distinct from spec->>'sha'
      or (before_row->>'proowner')::oid is distinct from (spec->>'owner')::regrole::oid
      or (before_row->>'prosecdef')::boolean is distinct from (spec->>'secdef')::boolean
      or (select proacl::text from pg_catalog.pg_proc where oid=target) is distinct from spec->>'acl'
      or pg_catalog.to_jsonb((select proconfig from pg_catalog.pg_proc where oid=target)) is distinct from spec->'config' then
      raise exception 'fund_roleplay_exact_canonical_pin_mismatch: %',spec->>'signature' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);next_body:=spec->>'next_body';
    if source_body is null or source_body='' or (length(definition)-length(replace(definition,source_body,'')))/length(source_body)<>1 then
      raise exception 'fund_roleplay_canonical_body_not_unique: %',spec->>'signature';end if;
    execute replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p)-'prosrc' into after_row from pg_catalog.pg_proc p where p.oid=target;
    if before_row is distinct from after_row or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
      raise exception 'fund_roleplay_canonical_metadata_changed: %',spec->>'signature';end if;
  end loop;
end $roleplay_cutover$;

-- Close every new private helper and portal bridge. Existing canonical ACLs
-- are checked/preserved above; no new raw table or private helper API is exposed.
do $close_roleplay_api$
declare signature text;
begin
  for signature in select p.oid::regprocedure::text from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and p.proname like 'fund_roleplay_%' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_fund_execution_worker',signature);
    execute pg_catalog.format('grant execute on function %s to postgres',signature);
  end loop;
  for signature in select p.oid::regprocedure::text from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and p.proname like 'fund_roleplay_%' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_fund_execution_worker',signature);
    execute pg_catalog.format('grant execute on function %s to postgres,authenticated',signature);
  end loop;
end $close_roleplay_api$;
revoke all on function public.bx1_portal_fund_roleplay_read(uuid,jsonb),
  public.bx1_portal_bind_roleplay_signer(uuid,integer,text,uuid,jsonb),
  public.bx1_portal_prepare_fund_transaction(uuid,integer,jsonb,text),
  public.bx1_portal_record_fund_signature(uuid,integer,text,jsonb,text),
  public.bx1_portal_fund_lifecycle_command_scoped(text,uuid,jsonb,jsonb,text)
  from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_fund_execution_worker;
grant execute on function public.bx1_portal_fund_roleplay_read(uuid,jsonb),
  public.bx1_portal_bind_roleplay_signer(uuid,integer,text,uuid,jsonb),
  public.bx1_portal_prepare_fund_transaction(uuid,integer,jsonb,text),
  public.bx1_portal_record_fund_signature(uuid,integer,text,jsonb,text),
  public.bx1_portal_fund_lifecycle_command_scoped(text,uuid,jsonb,jsonb,text)
  to authenticated;
