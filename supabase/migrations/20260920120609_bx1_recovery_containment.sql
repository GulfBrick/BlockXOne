-- Recovery containment only. No Auth writes, factor reset, release or seeded authority.
-- Apply as one transaction. Source version supplied by the TEST database clock.
-- Preserve every grantor-specific owner edge, including pre-existing non-SET edges.
create temporary table bx1_recovery_original_edges on commit drop as
select m.grantor,m.admin_option,m.inherit_option,m.set_option
from pg_catalog.pg_auth_members m
where m.roleid='bx1_authority_owner'::regrole and m.member=current_user::regrole;
grant bx1_authority_owner to current_user with inherit true, set true granted by current_user;
-- ALTER ... OWNER requires the destination role to have schema CREATE. Restore
-- the full original ACL before commit; this is not a runtime DDL capability.
create temporary table bx1_recovery_original_schema on commit drop as
select not has_schema_privilege('bx1_authority_owner','bx1_private','CREATE') added_create,
  (select coalesce(jsonb_agg(to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb)
   from aclexplode(n.nspacl) a) original_acl
from pg_catalog.pg_namespace n where n.nspname='bx1_private';
do $$ begin
  if (select added_create from pg_temp.bx1_recovery_original_schema) then
    grant create on schema bx1_private to bx1_authority_owner;
  end if;
end $$;

create table bx1_private.recovery_authorities (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operator_person_id uuid not null references bx1_private.persons(id),
  target_person_id uuid not null references bx1_private.persons(id),
  policy_version integer not null default 1 check(policy_version=1),
  operation text not null default 'RECOVERY_CONTAINMENT_V1' check(operation='RECOVERY_CONTAINMENT_V1'),
  valid_from timestamptz not null, valid_until timestamptz not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED')),
  revision bigint not null default 1 check(revision>0),
  evidence_reference text not null check(evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  check(operator_person_id<>target_person_id),
  check(isfinite(valid_from) and isfinite(valid_until) and valid_until>valid_from)
);
create unique index bx1_recovery_authority_active on bx1_private.recovery_authorities(operator_person_id,target_person_id,policy_version) where status='ACTIVE';
create table bx1_private.recovery_cases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  target_person_id uuid not null references bx1_private.persons(id),
  requester_principal_id uuid not null,
  reason text not null default 'LOST_AUTHENTICATOR' check(reason='LOST_AUTHENTICATOR'),
  state text not null default 'REQUESTED' check(state in ('REQUESTED','PENDING_REVIEW','APPROVED','QUARANTINED','REJECTED','EXPIRED','INVALIDATED')),
  revision bigint not null default 1 check(revision>0),
  policy_version integer not null default 1 check(policy_version=1),
  requested_trust_revision bigint not null check(requested_trust_revision>0),
  created_at timestamptz not null, expires_at timestamptz not null,
  proposed_by_principal_id uuid, proposed_by_person_id uuid,
  proposed_grant_id uuid references bx1_private.recovery_authorities(id), proposed_grant_revision bigint,
  reviewed_by_principal_id uuid, reviewed_by_person_id uuid,
  reviewed_grant_id uuid references bx1_private.recovery_authorities(id), reviewed_grant_revision bigint,
  evidence_reference text check(evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  expected_trust_revision bigint, target_snapshot jsonb, target_hash text,
  foreign key(requester_principal_id,target_person_id) references bx1_private.person_principals(auth_user_id,person_id),
  foreign key(proposed_by_principal_id,proposed_by_person_id) references bx1_private.person_principals(auth_user_id,person_id),
  foreign key(reviewed_by_principal_id,reviewed_by_person_id) references bx1_private.person_principals(auth_user_id,person_id),
  check(isfinite(created_at) and expires_at=created_at+interval '24 hours'),
  check(proposed_by_person_id is null or proposed_by_person_id<>target_person_id),
  check(reviewed_by_person_id is null or (reviewed_by_person_id<>target_person_id and reviewed_by_person_id<>proposed_by_person_id)),
  check((proposed_by_person_id is null and proposed_by_principal_id is null and proposed_grant_id is null and proposed_grant_revision is null and evidence_reference is null and expected_trust_revision is null and target_snapshot is null and target_hash is null)
    or (proposed_by_person_id is not null and proposed_by_principal_id is not null and proposed_grant_id is not null and proposed_grant_revision>0 and evidence_reference is not null and expected_trust_revision>0 and jsonb_typeof(target_snapshot)='object' and target_hash ~ '^[0-9a-f]{64}$')),
  check((reviewed_by_person_id is null and reviewed_by_principal_id is null and reviewed_grant_id is null and reviewed_grant_revision is null)
    or (reviewed_by_person_id is not null and reviewed_by_principal_id is not null and reviewed_grant_id is not null and reviewed_grant_revision>0)),
  check(num_nonnulls(proposed_by_person_id,proposed_by_principal_id,proposed_grant_id,proposed_grant_revision,evidence_reference,expected_trust_revision,target_snapshot,target_hash) in (0,8)),
  check(num_nonnulls(reviewed_by_person_id,reviewed_by_principal_id,reviewed_grant_id,reviewed_grant_revision) in (0,4)),
  check(target_snapshot is null or target_hash=encode(sha256(convert_to(target_snapshot::text,'UTF8')),'hex')),
  check(state not in ('PENDING_REVIEW','APPROVED','QUARANTINED','REJECTED') or proposed_by_person_id is not null),
  check(state not in ('APPROVED','QUARANTINED','REJECTED') or reviewed_by_person_id is not null)
);
create unique index bx1_recovery_one_open_person on bx1_private.recovery_cases(target_person_id)
where state in ('REQUESTED','PENDING_REVIEW','APPROVED','QUARANTINED');
create index bx1_recovery_cases_time on bx1_private.recovery_cases(created_at desc,id desc);
create table bx1_private.recovery_holds (
  person_id uuid primary key references bx1_private.persons(id),
  case_id uuid not null unique references bx1_private.recovery_cases(id),
  activated_at timestamptz not null, session_cutoff timestamptz not null,
  check(isfinite(activated_at) and session_cutoff=activated_at)
);
create table bx1_private.recovery_requests (
  actor_principal_id uuid not null references bx1_private.person_principals(auth_user_id),
  request_key uuid not null check(request_key<>'00000000-0000-0000-0000-000000000000'),
  intent jsonb not null check(jsonb_typeof(intent)='object'),
  intent_hash text not null check(intent_hash ~ '^[0-9a-f]{64}$'),
  case_id uuid not null references bx1_private.recovery_cases(id),
  result jsonb not null check(jsonb_typeof(result)='object'), created_at timestamptz not null,
  primary key(actor_principal_id,request_key)
);
create table bx1_private.recovery_events (
  event_sequence bigint generated always as identity primary key,
  case_id uuid not null references bx1_private.recovery_cases(id),
  target_person_id uuid not null references bx1_private.persons(id),
  actor_principal_id uuid not null, actor_person_id uuid not null,
  event_type text not null check(event_type in ('REQUESTED','PROPOSED','APPROVED','REJECTED','QUARANTINED','EXPIRED','INVALIDATED')),
  before_state text, after_state text not null, before_revision bigint, after_revision bigint not null check(after_revision>0),
  at timestamptz not null, details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  foreign key(actor_principal_id,actor_person_id) references bx1_private.person_principals(auth_user_id,person_id),
  check((before_state is null)=(before_revision is null)),
  check(before_state is null or before_state in ('REQUESTED','PENDING_REVIEW','APPROVED')),
  check(after_state in ('REQUESTED','PENDING_REVIEW','APPROVED','QUARANTINED','REJECTED','EXPIRED','INVALIDATED')),
  check((before_revision is null and after_revision=1 and event_type='REQUESTED') or after_revision=before_revision+1),
  check(octet_length(details::text)<=131072)
);
create index bx1_recovery_events_case on bx1_private.recovery_events(case_id,event_sequence);

alter table bx1_private.recovery_authorities owner to bx1_authority_owner;
alter table bx1_private.recovery_cases owner to bx1_authority_owner;
alter table bx1_private.recovery_holds owner to bx1_authority_owner;
alter table bx1_private.recovery_requests owner to bx1_authority_owner;
alter table bx1_private.recovery_events owner to bx1_authority_owner;
alter table bx1_private.recovery_authorities enable row level security;
alter table bx1_private.recovery_cases enable row level security;
alter table bx1_private.recovery_holds enable row level security;
alter table bx1_private.recovery_requests enable row level security;
alter table bx1_private.recovery_events enable row level security;
revoke all on table bx1_private.recovery_authorities,bx1_private.recovery_cases,bx1_private.recovery_holds,bx1_private.recovery_requests,bx1_private.recovery_events
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
revoke all on sequence bx1_private.recovery_events_event_sequence_seq from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
-- Existing Auth-reading function owner, not the application owner, reads these.
grant select on bx1_private.recovery_holds,bx1_private.recovery_authorities to current_user;

create function bx1_private.guard_recovery_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_TABLE_SCHEMA<>'bx1_private' or TG_OP='DELETE' then raise exception using errcode='23514',message='immutable recovery record'; end if;
  if TG_TABLE_NAME in ('recovery_holds','recovery_requests','recovery_events') then raise exception using errcode='23514',message='append-only recovery record';
  elsif TG_TABLE_NAME='recovery_authorities' then
    if to_jsonb(NEW)-array['status','revision'] is distinct from to_jsonb(OLD)-array['status','revision']
      or OLD.status<>'ACTIVE' or NEW.status<>'REVOKED' or NEW.revision<>OLD.revision+1 then raise exception using errcode='23514',message='immutable recovery authority'; end if;
  elsif TG_TABLE_NAME='recovery_cases' then
    if to_jsonb(NEW)-array['state','revision','proposed_by_principal_id','proposed_by_person_id','proposed_grant_id','proposed_grant_revision','reviewed_by_principal_id','reviewed_by_person_id','reviewed_grant_id','reviewed_grant_revision','evidence_reference','expected_trust_revision','target_snapshot','target_hash']
      is distinct from to_jsonb(OLD)-array['state','revision','proposed_by_principal_id','proposed_by_person_id','proposed_grant_id','proposed_grant_revision','reviewed_by_principal_id','reviewed_by_person_id','reviewed_grant_id','reviewed_grant_revision','evidence_reference','expected_trust_revision','target_snapshot','target_hash']
      or NEW.revision<>OLD.revision+1
      or not ((OLD.state='REQUESTED' and NEW.state in ('PENDING_REVIEW','EXPIRED','INVALIDATED'))
        or (OLD.state='PENDING_REVIEW' and NEW.state in ('APPROVED','REJECTED','EXPIRED','INVALIDATED'))
        or (OLD.state='APPROVED' and NEW.state in ('QUARANTINED','EXPIRED','INVALIDATED')))
      or (OLD.proposed_by_person_id is not null and
        (NEW.proposed_by_principal_id,NEW.proposed_by_person_id,NEW.proposed_grant_id,NEW.proposed_grant_revision,NEW.evidence_reference,NEW.expected_trust_revision,NEW.target_snapshot,NEW.target_hash)
        is distinct from (OLD.proposed_by_principal_id,OLD.proposed_by_person_id,OLD.proposed_grant_id,OLD.proposed_grant_revision,OLD.evidence_reference,OLD.expected_trust_revision,OLD.target_snapshot,OLD.target_hash))
      or (OLD.proposed_by_person_id is null and NEW.state<>'PENDING_REVIEW' and NEW.proposed_by_person_id is not null)
      or (OLD.reviewed_by_person_id is not null and (NEW.reviewed_by_principal_id,NEW.reviewed_by_person_id,NEW.reviewed_grant_id,NEW.reviewed_grant_revision)
        is distinct from (OLD.reviewed_by_principal_id,OLD.reviewed_by_person_id,OLD.reviewed_grant_id,OLD.reviewed_grant_revision))
      or (OLD.reviewed_by_person_id is null and NEW.state not in ('APPROVED','REJECTED') and NEW.reviewed_by_person_id is not null)
      then raise exception using errcode='23514',message='invalid recovery transition'; end if;
  else raise exception using errcode='23514',message='unknown recovery table'; end if;
  return NEW;
end $$;
create trigger bx1_recovery_authority_immutable before update or delete on bx1_private.recovery_authorities for each row execute function bx1_private.guard_recovery_immutable();
create trigger bx1_recovery_case_immutable before update or delete on bx1_private.recovery_cases for each row execute function bx1_private.guard_recovery_immutable();
create trigger bx1_recovery_hold_immutable before update or delete on bx1_private.recovery_holds for each row execute function bx1_private.guard_recovery_immutable();
create trigger bx1_recovery_request_immutable before update or delete on bx1_private.recovery_requests for each row execute function bx1_private.guard_recovery_immutable();
create trigger bx1_recovery_event_immutable before update or delete on bx1_private.recovery_events for each row execute function bx1_private.guard_recovery_immutable();

-- Preserve the old identity boundary; no MFA/hold check in this own-status helper.
create function bx1_private.has_identity_session() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare t timestamptz:=pg_catalog.clock_timestamp();
begin
  return exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id join public.bx1_profiles p on p.id=u.id
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>t)
      and s.oauth_client_id is null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=t) and p.status='ACTIVE');
exception when others then return false;
end $$;
create function bx1_private.recovery_business_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from bx1_private.person_principals pp join bx1_private.recovery_holds h on h.person_id=pp.person_id
    left join auth.sessions s on s.user_id=pp.auth_user_id and s.id::text=auth.jwt()->>'session_id'
    where pp.auth_user_id=auth.uid() and (h.activated_at is not null or s.created_at is null or s.created_at<=h.session_cutoff));
$$;
-- REPLACE retains the existing OID/owner/ACL and every existing caller dependency.
create or replace function bx1_private.has_active_session() returns boolean
language sql stable security definer set search_path='' as $$
  select bx1_private.has_identity_session() and bx1_private.recovery_business_allowed();
$$;
create or replace function bx1_private.is_eligible_governor(target_person uuid,target_organisation uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare guard_time timestamptz:=pg_catalog.clock_timestamp();
begin
  return not exists(select 1 from bx1_private.recovery_holds h where h.person_id=target_person)
    and exists(select 1 from bx1_private.persons p join bx1_private.governance_grants g on g.person_id=p.id
      where p.id=target_person and p.status='TRUSTED' and g.organisation_id=target_organisation and g.status='ACTIVE' and g.capability='ADMINISTRATION_V1'
      and g.valid_from<=guard_time and g.valid_until>guard_time
      and exists(select 1 from bx1_private.person_principals pp join public.bx1_profiles pr on pr.id=pp.auth_user_id join auth.users u on u.id=pp.auth_user_id
        where pp.person_id=p.id and pp.status='TRUSTED' and pr.status='ACTIVE' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=guard_time)
        and exists(select 1 from public.bx1_memberships m join public.bx1_organisations o on o.id=m.organisation_id where m.user_id=pp.auth_user_id and m.organisation_id=target_organisation and m.status='ACTIVE' and o.status='ACTIVE')
        and exists(select 1 from auth.mfa_factors f where f.user_id=pp.auth_user_id and f.status::text='verified' and f.factor_type::text='totp')));
exception when others then return false;
end $$;
create function bx1_private.is_eligible_recovery_operator(principal uuid,target uuid,grant_id uuid,grant_revision bigint) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare t timestamptz:=pg_catalog.clock_timestamp();
begin
  return exists(select 1 from bx1_private.recovery_authorities g join bx1_private.persons p on p.id=g.operator_person_id
    join bx1_private.person_principals pp on pp.person_id=p.id and pp.auth_user_id=principal
    join public.bx1_profiles pr on pr.id=pp.auth_user_id join auth.users u on u.id=pp.auth_user_id
    where g.id=grant_id and g.revision=grant_revision and g.target_person_id=target and g.operator_person_id<>target
      and g.policy_version=1 and g.operation='RECOVERY_CONTAINMENT_V1' and g.status='ACTIVE' and g.valid_from<=t and g.valid_until>t
      and p.status='TRUSTED' and pp.status='TRUSTED' and pr.status='ACTIVE' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=t)
      and not exists(select 1 from bx1_private.recovery_holds h where h.person_id=p.id)
      and exists(select 1 from public.bx1_memberships m join public.bx1_organisations o on o.id=m.organisation_id where m.user_id=principal and m.status='ACTIVE' and o.status='ACTIVE')
      and exists(select 1 from auth.mfa_factors f where f.user_id=principal and f.status::text='verified' and f.factor_type::text='totp'));
exception when others then return false;
end $$;
-- Recovery-only claim gate: the trusted wallet adapter intentionally uses an
-- internal sub/session claim tuple without exp/aal, so never add this to its base.
create function bx1_private.recovery_claims_valid() returns boolean
language plpgsql volatile security invoker set search_path='' as $$
declare claims jsonb:=auth.jwt();
begin
  if jsonb_typeof(claims) is distinct from 'object' or jsonb_typeof(claims->'exp') is distinct from 'number'
    or (claims->>'exp') !~ '^[0-9]{1,16}$' or jsonb_typeof(claims->'aal') is distinct from 'string'
    or claims->>'aal' not in ('aal1','aal2') then return false; end if;
  return (claims->>'exp')::numeric>floor(extract(epoch from clock_timestamp()));
exception when others then return false;
end $$;
create function bx1_private.has_current_recovery_totp() returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.recovery_claims_valid() and bx1_private.has_active_session() and auth.jwt()->>'aal'='aal2' and exists(
    select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp');
$$;
revoke all on function bx1_private.has_identity_session(),bx1_private.recovery_business_allowed(),bx1_private.is_eligible_recovery_operator(uuid,uuid,uuid,bigint),bx1_private.has_current_recovery_totp(),bx1_private.recovery_claims_valid()
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
grant execute on function bx1_private.has_identity_session(),bx1_private.is_eligible_recovery_operator(uuid,uuid,uuid,bigint),bx1_private.has_current_recovery_totp(),bx1_private.recovery_claims_valid() to bx1_authority_owner;

create function bx1_private.recovery_actor_person() returns uuid
language sql volatile security definer set search_path='' as $$
  select pp.person_id from bx1_private.person_principals pp join bx1_private.persons p on p.id=pp.person_id
  where pp.auth_user_id=auth.uid() and pp.status='TRUSTED' and p.status='TRUSTED' and bx1_private.has_identity_session() and bx1_private.recovery_claims_valid();
$$;
create function bx1_private.recovery_scope_ids(target uuid) returns uuid[]
language sql stable security invoker set search_path='' as $$
  select coalesce(array_agg(distinct organisation_id order by organisation_id),'{}'::uuid[]) from (
    select m.organisation_id from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=target
    union select g.organisation_id from bx1_private.governance_grants g where g.person_id=target) q;
$$;
create function bx1_private.lock_recovery(target uuid,actor uuid) returns void
language plpgsql volatile security invoker set search_path='' as $$
declare scopes uuid[]; people uuid[];
begin
  perform id from bx1_private.authority_root where id for update;
  scopes:=bx1_private.recovery_scope_ids(target);
  select array_agg(distinct id order by id) into people from (
    select target id union select actor union select operator_person_id from bx1_private.recovery_authorities where target_person_id=target
    union select proposed_by_person_id from bx1_private.recovery_cases where target_person_id=target
    union select reviewed_by_person_id from bx1_private.recovery_cases where target_person_id=target) p where id is not null;
  perform organisation_id from bx1_private.authority_scopes where organisation_id=any(scopes) order by organisation_id for update;
  perform id from bx1_private.persons where id=any(people) order by id for update;
  perform auth_user_id from bx1_private.person_principals where person_id=any(people) order by auth_user_id for update;
  perform id from bx1_private.governance_grants where organisation_id=any(scopes) or person_id=any(people) order by id for update;
  perform id from bx1_private.administration_commands where organisation_id=any(scopes) order by id for update;
  perform m.id from public.bx1_memberships m where m.organisation_id=any(scopes) or exists(select 1 from bx1_private.person_principals pp where pp.auth_user_id=m.user_id and pp.person_id=any(people)) order by m.id for update;
  perform id from bx1_private.legal_parties where organisation_id=any(scopes) order by id for update;
  perform id from bx1_private.recovery_authorities where target_person_id=target order by id for update;
  perform id from bx1_private.recovery_cases where target_person_id=target order by id for update;
  perform person_id from bx1_private.recovery_holds where person_id=any(people) order by person_id for update;
  if scopes is distinct from bx1_private.recovery_scope_ids(target) then raise exception using errcode='40001',message='recovery scope changed'; end if;
end $$;
create function bx1_private.recovery_target_snapshot(target uuid) returns jsonb
language sql stable security invoker set search_path='' set TimeZone='UTC' as $$
  select jsonb_build_object('person',(select jsonb_build_object('id',id,'status',status) from bx1_private.persons where id=target),
    'principals',coalesce((select jsonb_agg(jsonb_build_object('id',pp.auth_user_id,'mappingStatus',pp.status,'profileStatus',p.status,'platformUserId',p.platform_user_id) order by pp.auth_user_id) from bx1_private.person_principals pp join public.bx1_profiles p on p.id=pp.auth_user_id where pp.person_id=target),'[]'::jsonb),
    'memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=target),'[]'::jsonb),
    'grants',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from bx1_private.governance_grants g where g.person_id=target),'[]'::jsonb),
    'scopes',coalesce((select jsonb_agg(to_jsonb(s) order by s.organisation_id) from bx1_private.authority_scopes s where s.organisation_id=any(bx1_private.recovery_scope_ids(target))),'[]'::jsonb),
    'root',(select jsonb_build_object('policyVersion',policy_version,'trustRevision',trust_revision::text) from bx1_private.authority_root where id),
    'held',exists(select 1 from bx1_private.recovery_holds where person_id=target));
$$;
create function bx1_private.recovery_record(c bx1_private.recovery_cases,actor uuid,event text,prior_state text,prior_revision bigint,t timestamptz,details jsonb,key uuid,intent jsonb,result jsonb) returns void
language plpgsql volatile security invoker set search_path='' as $$
begin
  insert into bx1_private.recovery_events(case_id,target_person_id,actor_principal_id,actor_person_id,event_type,before_state,after_state,before_revision,after_revision,at,details)
    values(c.id,c.target_person_id,auth.uid(),actor,event,prior_state,c.state,prior_revision,c.revision,t,details);
  insert into bx1_private.recovery_requests(actor_principal_id,request_key,intent,intent_hash,case_id,result,created_at)
    values(auth.uid(),key,intent,encode(sha256(convert_to(intent::text,'UTF8')),'hex'),c.id,result,t);
end $$;
create function bx1_private.request_recovery(request_key uuid,request jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid; t timestamptz; c bx1_private.recovery_cases; r bx1_private.recovery_requests; root_row bx1_private.authority_root; result jsonb;
begin
  perform set_config('lock_timeout','3s',true);
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000' or request is distinct from '{"intent":"request","reason":"LOST_AUTHENTICATOR"}'::jsonb then return '{"ok":false,"error":"invalid_request"}'; end if;
  actor:=bx1_private.recovery_actor_person(); if actor is null then return '{"ok":false,"error":"unauthorised"}'; end if;
  perform bx1_private.lock_recovery(actor,actor); t:=clock_timestamp();
  if actor is distinct from bx1_private.recovery_actor_person() then return '{"ok":false,"error":"unauthorised"}'; end if;
  select * into r from bx1_private.recovery_requests where actor_principal_id=auth.uid() and recovery_requests.request_key=request_recovery.request_key;
  if found then
    if r.intent is distinct from request then return '{"ok":false,"error":"conflict"}'; end if;
    if r.result->>'ok'='true' then return r.result||'{"replayed":true}'::jsonb; else return r.result; end if;
  end if;
  if exists(select 1 from bx1_private.recovery_holds where person_id=actor) then return '{"ok":false,"error":"conflict"}'; end if;
  if exists(select 1 from bx1_private.recovery_cases where target_person_id=actor and state in ('REQUESTED','PENDING_REVIEW','APPROVED','QUARANTINED')) then return '{"ok":false,"error":"conflict"}'; end if;
  select * into root_row from bx1_private.authority_root where id;
  if root_row.policy_version is distinct from 1 then return '{"ok":false,"error":"unavailable"}'; end if;
  insert into bx1_private.recovery_cases(target_person_id,requester_principal_id,requested_trust_revision,created_at,expires_at)
    values(actor,auth.uid(),root_row.trust_revision,t,t+interval '24 hours') returning * into c;
  result:=jsonb_build_object('ok',true,'caseId',c.id,'state',c.state,'revision',c.revision::text,'replayed',false);
  perform bx1_private.recovery_record(c,actor,'REQUESTED',null,null,t,'{}',request_key,request,result); return result;
exception when others then return '{"ok":false,"error":"unavailable"}';
end $$;
create function bx1_private.execute_recovery(request_key uuid,command jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid; c bx1_private.recovery_cases; r bx1_private.recovery_requests; g bx1_private.recovery_authorities;
  root_row bx1_private.authority_root; prior_state text; prior_revision bigint; event text; result jsonb; t timestamptz;
  snapshot jsonb; scopes uuid[]; a bx1_private.administration_commands; scope_row bx1_private.authority_scopes;
  grant_count integer:=0; scope_count integer:=0; command_count integer:=0; details jsonb:='{}';
begin
  perform set_config('lock_timeout','3s',true);
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(command) is distinct from 'object' or octet_length(command::text)>8192
    or not command ?& array['intent','caseId','expectedRevision'] or jsonb_typeof(command->'intent') is distinct from 'string' or command->>'intent' not in ('propose','review','apply')
    or jsonb_typeof(command->'caseId') is distinct from 'string' or (command->>'caseId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or command->>'caseId'='00000000-0000-0000-0000-000000000000'
    or jsonb_typeof(command->'expectedRevision') is distinct from 'string' or (command->>'expectedRevision') !~ '^[1-9][0-9]{0,18}$' then return '{"ok":false,"error":"invalid_request"}'; end if;
  if (command->>'expectedRevision')::numeric>9223372036854775807 then return '{"ok":false,"error":"invalid_request"}'; end if;
  if command->>'intent'='propose' then
    if not command ? 'evidenceReference' or command-array['intent','caseId','expectedRevision','evidenceReference']<>'{}'::jsonb or jsonb_typeof(command->'evidenceReference') is distinct from 'string' or (command->>'evidenceReference') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then return '{"ok":false,"error":"invalid_request"}'; end if;
  elsif command->>'intent'='review' then
    if not command ? 'decision' or command-array['intent','caseId','expectedRevision','decision']<>'{}'::jsonb or jsonb_typeof(command->'decision') is distinct from 'string' or command->>'decision' not in ('approve','reject') then return '{"ok":false,"error":"invalid_request"}'; end if;
  elsif command-array['intent','caseId','expectedRevision']<>'{}'::jsonb then return '{"ok":false,"error":"invalid_request"}'; end if;
  actor:=bx1_private.recovery_actor_person(); if actor is null then return '{"ok":false,"error":"unauthorised"}'; end if;
  if not bx1_private.has_recent_administration_totp() then return '{"ok":false,"error":"step_up_required"}'; end if;
  select * into c from bx1_private.recovery_cases where id=(command->>'caseId')::uuid;
  if c.id is null or actor=c.target_person_id then return '{"ok":false,"error":"forbidden"}'; end if;
  select * into g from bx1_private.recovery_authorities where operator_person_id=actor and target_person_id=c.target_person_id
    and bx1_private.is_eligible_recovery_operator(auth.uid(),c.target_person_id,id,revision) order by id limit 1;
  if g.id is null then return '{"ok":false,"error":"forbidden"}'; end if;
  perform bx1_private.lock_recovery(c.target_person_id,actor); t:=clock_timestamp();
  if actor is distinct from bx1_private.recovery_actor_person() then return '{"ok":false,"error":"unauthorised"}'; end if;
  if not bx1_private.has_recent_administration_totp() then return '{"ok":false,"error":"step_up_required"}'; end if;
  if not bx1_private.is_eligible_recovery_operator(auth.uid(),c.target_person_id,g.id,g.revision) then return '{"ok":false,"error":"forbidden"}'; end if;
  select * into c from bx1_private.recovery_cases where id=c.id;
  select * into r from bx1_private.recovery_requests where actor_principal_id=auth.uid() and recovery_requests.request_key=execute_recovery.request_key;
  if found then
    if r.intent is distinct from command or r.case_id<>c.id then return '{"ok":false,"error":"conflict"}'; end if;
    if r.result->>'ok'='true' then return r.result||'{"replayed":true}'::jsonb; else return r.result; end if;
  end if;
  if c.revision<>(command->>'expectedRevision')::bigint then return '{"ok":false,"error":"conflict"}'; end if;
  if (command->>'intent'='propose' and c.state<>'REQUESTED') or (command->>'intent'='review' and c.state<>'PENDING_REVIEW') or (command->>'intent'='apply' and c.state<>'APPROVED') then return '{"ok":false,"error":"conflict"}'; end if;
  if command->>'intent'='review' and actor=c.proposed_by_person_id then return '{"ok":false,"error":"forbidden"}'; end if;
  if command->>'intent'='apply' and actor not in (c.proposed_by_person_id,c.reviewed_by_person_id) then return '{"ok":false,"error":"forbidden"}'; end if;
  prior_state:=c.state; prior_revision:=c.revision;
  select * into root_row from bx1_private.authority_root where id;
  snapshot:=bx1_private.recovery_target_snapshot(c.target_person_id);
  if c.expires_at<=t then event:='EXPIRED'; result:='{"ok":false,"error":"expired"}';
  elsif root_row.policy_version<>c.policy_version or snapshot->>'held'='true'
    or (c.proposed_by_person_id is not null and (c.expected_trust_revision<>root_row.trust_revision or c.target_snapshot is distinct from snapshot
      or not bx1_private.is_eligible_recovery_operator(c.proposed_by_principal_id,c.target_person_id,c.proposed_grant_id,c.proposed_grant_revision)))
    or (c.reviewed_by_person_id is not null and not bx1_private.is_eligible_recovery_operator(c.reviewed_by_principal_id,c.target_person_id,c.reviewed_grant_id,c.reviewed_grant_revision)) then event:='INVALIDATED'; result:='{"ok":false,"error":"conflict"}';
  elsif command->>'intent'='propose' then
    event:='PROPOSED';
    update bx1_private.recovery_cases set state='PENDING_REVIEW',revision=revision+1,proposed_by_principal_id=auth.uid(),proposed_by_person_id=actor,proposed_grant_id=g.id,proposed_grant_revision=g.revision,
      evidence_reference=command->>'evidenceReference',expected_trust_revision=root_row.trust_revision,target_snapshot=snapshot,target_hash=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') where id=c.id returning * into c;
  elsif command->>'intent'='review' then
    event:=case command->>'decision' when 'approve' then 'APPROVED' else 'REJECTED' end;
    update bx1_private.recovery_cases set state=event,revision=revision+1,reviewed_by_principal_id=auth.uid(),reviewed_by_person_id=actor,reviewed_grant_id=g.id,reviewed_grant_revision=g.revision where id=c.id returning * into c;
  else
    event:='QUARANTINED'; scopes:=bx1_private.recovery_scope_ids(c.target_person_id);
    insert into bx1_private.recovery_holds(person_id,case_id,activated_at,session_cutoff) values(c.target_person_id,c.id,t,t);
    update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where person_id=c.target_person_id and status='ACTIVE'; get diagnostics grant_count=row_count;
    update bx1_private.authority_scopes set state='HOLD',revision=revision+1 where organisation_id=any(scopes) and state='READY'; get diagnostics scope_count=row_count;
    update bx1_private.authority_root set trust_revision=trust_revision+1 where id;
    for a in select * from bx1_private.administration_commands where organisation_id=any(scopes) and state in ('PENDING_REVIEW','APPROVED') order by id loop
      update bx1_private.administration_commands set state='INVALIDATED',revision=revision+1,terminal_reason='stale_scope' where id=a.id;
      insert into bx1_private.administration_events(command_id,organisation_id,actor_principal_id,actor_person_id,event_type,before_revision,after_revision,before_state,after_state,payload_hash,reason,created_at)
        values(a.id,a.organisation_id,auth.uid(),actor,'INVALIDATED',a.revision,a.revision+1,a.state,'INVALIDATED',a.payload_hash,'stale_scope',t);
      command_count:=command_count+1;
    end loop;
    details:=jsonb_build_object('grantsRevoked',grant_count,'scopesHeld',scope_count,'commandsInvalidated',command_count,'cutoff',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'trustRevision',(root_row.trust_revision+1)::text,'principals',snapshot->'principals',
      'grantRevisions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision::text,'status',status) order by id) from bx1_private.governance_grants where person_id=c.target_person_id),'[]'::jsonb),
      'scopeRevisions',coalesce((select jsonb_agg(jsonb_build_object('organisationId',organisation_id,'revision',revision::text,'state',state) order by organisation_id) from bx1_private.authority_scopes where organisation_id=any(scopes)),'[]'::jsonb));
    update bx1_private.recovery_cases set state='QUARANTINED',revision=revision+1 where id=c.id returning * into c;
  end if;
  if event in ('EXPIRED','INVALIDATED') then update bx1_private.recovery_cases set state=event,revision=revision+1 where id=c.id returning * into c; end if;
  if result is null then result:=jsonb_build_object('ok',true,'caseId',c.id,'state',c.state,'revision',c.revision::text,'replayed',false); end if;
  perform bx1_private.recovery_record(c,actor,event,prior_state,prior_revision,t,details,request_key,command,result); return result;
exception when others then return '{"ok":false,"error":"unavailable"}';
end $$;

create function bx1_private.recovery_can_operate(c bx1_private.recovery_cases,actor uuid) returns boolean
language sql volatile security invoker set search_path='' as $$
  select actor<>c.target_person_id and bx1_private.has_current_recovery_totp() and exists(select 1 from bx1_private.recovery_authorities g
    where g.operator_person_id=actor and g.target_person_id=c.target_person_id and bx1_private.is_eligible_recovery_operator(auth.uid(),c.target_person_id,g.id,g.revision));
$$;
create function bx1_private.recovery_case_view(c bx1_private.recovery_cases,actor uuid,operator_access boolean) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare actions text[]:='{}'; recent boolean:=false; eligible_proposer boolean:=false; eligible_reviewer boolean:=false;
begin
  if operator_access then
    recent:=bx1_private.has_recent_administration_totp();
    eligible_proposer:=coalesce(bx1_private.is_eligible_recovery_operator(c.proposed_by_principal_id,c.target_person_id,c.proposed_grant_id,c.proposed_grant_revision),false);
    eligible_reviewer:=coalesce(bx1_private.is_eligible_recovery_operator(c.reviewed_by_principal_id,c.target_person_id,c.reviewed_grant_id,c.reviewed_grant_revision),false);
    if recent and c.expires_at>clock_timestamp() then
      if c.state='REQUESTED' then actions:=array['propose'];
      elsif c.state='PENDING_REVIEW' and actor<>c.proposed_by_person_id and eligible_proposer then actions:=array['approve','reject'];
      elsif c.state='APPROVED' and actor in (c.proposed_by_person_id,c.reviewed_by_person_id) and eligible_proposer and eligible_reviewer then actions:=array['apply']; end if;
    end if;
  end if;
  return jsonb_build_object('caseId',c.id,'targetPersonId',c.target_person_id,'requesterPrincipalId',c.requester_principal_id,'state',c.state,'revision',c.revision::text,
    'reason',c.reason,'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposedByPersonId',case when operator_access then c.proposed_by_person_id end,'reviewedByPersonId',case when operator_access then c.reviewed_by_person_id end,
    'evidenceReference',case when operator_access then c.evidence_reference end,'isOwn',actor=c.target_person_id,'requiresStepUp',operator_access and not recent,'allowedActions',to_jsonb(actions));
end $$;
create function bx1_private.read_recovery(selected_case uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid; c bx1_private.recovery_cases; operator_access boolean; list jsonb:='[]'; selected jsonb; events jsonb; item jsonb;
  n integer:=0; count_events integer; held boolean; result jsonb; gate jsonb:='{"availability":"unauthorised","policyVersion":1,"caller":null,"held":false,"canRequest":false,"cases":[],"casesTruncated":false,"selectedCase":null}';
begin
  perform set_config('lock_timeout','3s',true);
  actor:=bx1_private.recovery_actor_person(); if actor is null then return gate; end if;
  if selected_case='00000000-0000-0000-0000-000000000000' then return gate||'{"availability":"unavailable"}'::jsonb; end if;
  for c in select * from bx1_private.recovery_cases v where v.target_person_id=actor or bx1_private.recovery_can_operate(v,actor) order by v.created_at desc,v.id desc limit 51 loop
    n:=n+1;
    if n<=50 then list:=list||jsonb_build_array(bx1_private.recovery_case_view(c,actor,bx1_private.recovery_can_operate(c,actor))); end if;
  end loop;
  if selected_case is not null then
    select * into c from bx1_private.recovery_cases where id=selected_case;
    if c.id is not null and (c.target_person_id=actor or bx1_private.recovery_can_operate(c,actor)) then
      operator_access:=bx1_private.recovery_can_operate(c,actor);
      select count(*) into count_events from (select 1 from bx1_private.recovery_events where case_id=c.id order by event_sequence desc limit 101) q;
      select coalesce(jsonb_agg(jsonb_build_object('sequence',e.event_sequence::text,'eventType',e.event_type,'at',to_char(e.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'actorPersonId',case when operator_access or e.actor_person_id=actor then e.actor_person_id end,'beforeState',e.before_state,'afterState',e.after_state,
        'beforeRevision',e.before_revision::text,'afterRevision',e.after_revision::text) order by e.event_sequence),'[]'::jsonb) into events
        from (select * from bx1_private.recovery_events where case_id=c.id order by event_sequence desc limit 100) e;
      selected:=bx1_private.recovery_case_view(c,actor,operator_access)||jsonb_build_object('events',events,'historyTruncated',count_events>100);
    end if;
  end if;
  -- Recheck the exact caller and every disclosed case after projection; fail closed.
  if actor is distinct from bx1_private.recovery_actor_person() then return gate; end if;
  for item in select value from jsonb_array_elements(list||case when selected is null then '[]'::jsonb else jsonb_build_array(selected) end) loop
    select * into c from bx1_private.recovery_cases where id=(item->>'caseId')::uuid;
    if c.id is null or (c.target_person_id<>actor and not bx1_private.recovery_can_operate(c,actor)) then return gate||'{"availability":"unavailable"}'::jsonb; end if;
  end loop;
  held:=exists(select 1 from bx1_private.recovery_holds where person_id=actor);
  result:=jsonb_build_object('availability','ready','policyVersion',1,'caller',jsonb_build_object('principalId',auth.uid(),'personId',actor),'held',held,
    'canRequest',not held and not exists(select 1 from bx1_private.recovery_cases where target_person_id=actor and state in ('REQUESTED','PENDING_REVIEW','APPROVED','QUARANTINED')),
    'cases',list,'casesTruncated',n>50,'selectedCase',selected);
  if octet_length(result::text)>262144 then return gate||'{"availability":"unavailable"}'::jsonb; end if;
  return result;
exception when others then return gate||'{"availability":"unavailable"}'::jsonb;
end $$;

create function public.bx1_recovery_request(request_key uuid,request jsonb) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$ select bx1_private.request_recovery(request_key,request); $$;
create function public.bx1_recovery_read(selected_case uuid default null) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$ select bx1_private.read_recovery(selected_case); $$;
create function public.bx1_recovery_command(request_key uuid,command jsonb) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$ select bx1_private.execute_recovery(request_key,command); $$;

alter function bx1_private.guard_recovery_immutable() owner to bx1_authority_owner;
alter function bx1_private.recovery_actor_person() owner to bx1_authority_owner;
alter function bx1_private.recovery_scope_ids(uuid) owner to bx1_authority_owner;
alter function bx1_private.lock_recovery(uuid,uuid) owner to bx1_authority_owner;
alter function bx1_private.recovery_target_snapshot(uuid) owner to bx1_authority_owner;
alter function bx1_private.recovery_record(bx1_private.recovery_cases,uuid,text,text,bigint,timestamptz,jsonb,uuid,jsonb,jsonb) owner to bx1_authority_owner;
alter function bx1_private.request_recovery(uuid,jsonb) owner to bx1_authority_owner;
alter function bx1_private.execute_recovery(uuid,jsonb) owner to bx1_authority_owner;
alter function bx1_private.recovery_can_operate(bx1_private.recovery_cases,uuid) owner to bx1_authority_owner;
alter function bx1_private.recovery_case_view(bx1_private.recovery_cases,uuid,boolean) owner to bx1_authority_owner;
alter function bx1_private.read_recovery(uuid) owner to bx1_authority_owner;
revoke all on function bx1_private.guard_recovery_immutable(),bx1_private.recovery_actor_person(),bx1_private.recovery_scope_ids(uuid),bx1_private.lock_recovery(uuid,uuid),
  bx1_private.recovery_target_snapshot(uuid),bx1_private.recovery_record(bx1_private.recovery_cases,uuid,text,text,bigint,timestamptz,jsonb,uuid,jsonb,jsonb),
  bx1_private.request_recovery(uuid,jsonb),bx1_private.execute_recovery(uuid,jsonb),bx1_private.recovery_can_operate(bx1_private.recovery_cases,uuid),
  bx1_private.recovery_case_view(bx1_private.recovery_cases,uuid,boolean),bx1_private.read_recovery(uuid),
  public.bx1_recovery_request(uuid,jsonb),public.bx1_recovery_read(uuid),public.bx1_recovery_command(uuid,jsonb)
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
grant execute on function bx1_private.request_recovery(uuid,jsonb),bx1_private.execute_recovery(uuid,jsonb),bx1_private.read_recovery(uuid),
  public.bx1_recovery_request(uuid,jsonb),public.bx1_recovery_read(uuid),public.bx1_recovery_command(uuid,jsonb) to authenticated;

do $$
declare edge record; actual jsonb; expected jsonb;
begin
  if (select added_create from pg_temp.bx1_recovery_original_schema) then
    revoke create on schema bx1_private from bx1_authority_owner;
  end if;
  select original_acl into expected from pg_temp.bx1_recovery_original_schema;
  select coalesce(jsonb_agg(to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) into actual
    from pg_catalog.pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname='bx1_private';
  if actual is distinct from expected then raise exception 'recovery schema ACL not restored'; end if;
  select * into edge from pg_temp.bx1_recovery_original_edges where grantor=current_user::regrole;
  if found then
    execute format('grant bx1_authority_owner to %I with admin %s, inherit %s, set %s granted by %I',current_user,edge.admin_option,edge.inherit_option,edge.set_option,current_user);
  else execute format('revoke bx1_authority_owner from %I granted by %I',current_user,current_user); end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by grantor),'[]'::jsonb) into expected from pg_temp.bx1_recovery_original_edges e;
  select coalesce(jsonb_agg(to_jsonb(e) order by grantor),'[]'::jsonb) into actual from
    (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members where roleid='bx1_authority_owner'::regrole and member=current_user::regrole) e;
  if actual is distinct from expected then raise exception 'recovery owner edges not restored'; end if;
end $$;
