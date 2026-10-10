-- 02-12 controlled administration. Apply the whole migration transactionally.
-- No person, principal, scope, governor, Auth or hosted bootstrap data is seeded.
create role bx1_authority_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- Non-superuser CREATEROLE migration: temporary ownership-transfer capability.
grant bx1_authority_owner to current_user with inherit false, set true;
grant usage, create on schema bx1_private to bx1_authority_owner;

create table bx1_private.authority_root (
  id boolean primary key check (id),
  policy_version integer not null check (policy_version = 1),
  trust_revision bigint not null check (trust_revision >= 1)
);
create table bx1_private.persons (
  id uuid primary key default pg_catalog.gen_random_uuid() check (id <> '00000000-0000-0000-0000-000000000000'),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 200),
  status text not null check (status in ('TRUSTED','REVOKED')),
  evidence_reference text not null check (evidence_reference = btrim(evidence_reference) and char_length(evidence_reference) between 1 and 200),
  bootstrap_receipt_id uuid not null check (bootstrap_receipt_id <> '00000000-0000-0000-0000-000000000000'),
  created_at timestamptz not null default now() check (isfinite(created_at))
);
create table bx1_private.person_principals (
  auth_user_id uuid primary key references public.bx1_profiles(id) on delete restrict,
  person_id uuid not null references bx1_private.persons(id) on delete restrict,
  status text not null check (status in ('TRUSTED','REVOKED')),
  evidence_reference text not null check (evidence_reference = btrim(evidence_reference) and char_length(evidence_reference) between 1 and 200),
  bootstrap_receipt_id uuid not null check (bootstrap_receipt_id <> '00000000-0000-0000-0000-000000000000'),
  created_at timestamptz not null default now() check (isfinite(created_at)),
  unique (auth_user_id,person_id),
  check (auth_user_id <> '00000000-0000-0000-0000-000000000000')
);
create table bx1_private.authority_scopes (
  organisation_id uuid primary key references public.bx1_organisations(id) on delete restrict,
  state text not null check (state in ('READY','HOLD')),
  revision bigint not null default 1 check (revision >= 1),
  bootstrap_receipt_id uuid not null check (bootstrap_receipt_id <> '00000000-0000-0000-0000-000000000000'),
  check (organisation_id <> '00000000-0000-0000-0000-000000000000')
);
create table bx1_private.administration_commands (
  id uuid primary key default pg_catalog.gen_random_uuid() check (id <> '00000000-0000-0000-0000-000000000000'),
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  request_key uuid not null check (request_key <> '00000000-0000-0000-0000-000000000000'),
  kind text not null check (kind in ('ENTITY_DRAFT_CREATE','MEMBERSHIP_GRANT','MEMBERSHIP_REVOKE','GOVERNANCE_GRANT','GOVERNANCE_REVOKE','PERSON_SCOPE_REVOKE')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  -- convert_to is STABLE, not IMMUTABLE: do not use a generated-column or a
  -- falsely IMMUTABLE wrapper. Task 2's trusted command computes this formula.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'
    and payload_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload::text,'UTF8')),'hex')),
  target_snapshot jsonb not null default '{}' check (jsonb_typeof(target_snapshot)='object' and octet_length(target_snapshot::text)<=4096),
  requester_principal_id uuid not null,
  requester_person_id uuid not null,
  beneficiary_person_id uuid references bx1_private.persons(id) on delete restrict,
  expected_scope_revision bigint not null check (expected_scope_revision >= 1),
  expected_trust_revision bigint not null check (expected_trust_revision >= 1),
  policy_version integer not null default 1 check (policy_version = 1),
  created_at timestamptz not null default now() check (isfinite(created_at)),
  expires_at timestamptz not null default now()+interval '24 hours' check (isfinite(expires_at)),
  revision bigint not null default 1 check (revision >= 1),
  state text not null default 'PENDING_REVIEW' check (state in ('PENDING_REVIEW','APPROVED','APPLIED','REJECTED','CANCELLED','EXPIRED','INVALIDATED')),
  reviewer_principal_id uuid,
  reviewer_person_id uuid,
  reviewed_at timestamptz check (isfinite(reviewed_at)),
  applied_at timestamptz check (isfinite(applied_at)),
  terminal_reason text check (terminal_reason in ('routine','security','expired','stale_policy','stale_scope','stale_trust','stale_target','authority_lost','below_two_governors')),
  unique (organisation_id,id),
  unique (organisation_id,requester_principal_id,request_key),
  foreign key (requester_principal_id,requester_person_id) references bx1_private.person_principals(auth_user_id,person_id) on delete restrict,
  foreign key (reviewer_principal_id,reviewer_person_id) references bx1_private.person_principals(auth_user_id,person_id) on delete restrict,
  check (expires_at = created_at + interval '24 hours'),
  check ((reviewer_principal_id is null and reviewer_person_id is null and reviewed_at is null)
    or (reviewer_principal_id is not null and reviewer_person_id is not null and reviewed_at is not null)),
  check (state not in ('APPROVED','APPLIED','REJECTED') or reviewer_person_id is not null),
  check (state <> 'PENDING_REVIEW' or reviewer_person_id is null),
  check ((state='APPLIED') = (applied_at is not null)),
  check (reviewer_person_id is null or (reviewer_person_id <> requester_person_id
    and (beneficiary_person_id is null or reviewer_person_id <> beneficiary_person_id))),
  check (kind not in ('MEMBERSHIP_GRANT','GOVERNANCE_GRANT') or beneficiary_person_id <> requester_person_id),
  check ((kind='ENTITY_DRAFT_CREATE') = (beneficiary_person_id is null)),
  check (case kind
    when 'ENTITY_DRAFT_CREATE' then payload ?& array['displayName','kind','jurisdictionCode','registrationReference']
      and payload - array['displayName','kind','jurisdictionCode','registrationReference'] = '{}'
    when 'MEMBERSHIP_GRANT' then payload ?& array['principalId','role'] and payload-array['principalId','role']='{}'
    when 'MEMBERSHIP_REVOKE' then payload ?& array['membershipId','reason'] and payload-array['membershipId','reason']='{}'
    when 'GOVERNANCE_GRANT' then payload ?& array['personId','validUntil'] and payload-array['personId','validUntil']='{}'
    when 'GOVERNANCE_REVOKE' then payload ?& array['grantId','reason'] and payload-array['grantId','reason']='{}'
    when 'PERSON_SCOPE_REVOKE' then payload ?& array['personId','reason'] and payload-array['personId','reason']='{}'
    else false end),
  check (coalesce(case kind
    when 'ENTITY_DRAFT_CREATE' then
      jsonb_typeof(payload->'displayName')='string'
      and (payload->>'displayName')=btrim(payload->>'displayName')
      and char_length(payload->>'displayName') between 1 and 200
      and jsonb_typeof(payload->'kind')='string' and payload->>'kind' in ('COMPANY','TRUST','FUND','OTHER')
      and (payload->'jurisdictionCode'='null'::jsonb or
        (jsonb_typeof(payload->'jurisdictionCode')='string' and payload->>'jurisdictionCode' ~ '^[A-Z]{2}$'))
      and (payload->'registrationReference'='null'::jsonb or
        (jsonb_typeof(payload->'registrationReference')='string'
          and payload->>'registrationReference'=btrim(payload->>'registrationReference')
          and char_length(payload->>'registrationReference') between 1 and 100))
    when 'MEMBERSHIP_GRANT' then
      jsonb_typeof(payload->'principalId')='string'
      and payload->>'principalId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload->>'principalId'<>'00000000-0000-0000-0000-000000000000'
      and jsonb_typeof(payload->'role')='string'
      and payload->>'role' in ('Investor','OfferingManager','ComplianceOfficer','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin')
    when 'GOVERNANCE_GRANT' then
      jsonb_typeof(payload->'personId')='string'
      and payload->>'personId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload->>'personId'<>'00000000-0000-0000-0000-000000000000'
      and jsonb_typeof(payload->'validUntil')='string'
      and payload->>'validUntil' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    else
      jsonb_typeof(payload->(case kind when 'MEMBERSHIP_REVOKE' then 'membershipId' when 'GOVERNANCE_REVOKE' then 'grantId' else 'personId' end))='string'
      and payload->>(case kind when 'MEMBERSHIP_REVOKE' then 'membershipId' when 'GOVERNANCE_REVOKE' then 'grantId' else 'personId' end) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload->>(case kind when 'MEMBERSHIP_REVOKE' then 'membershipId' when 'GOVERNANCE_REVOKE' then 'grantId' else 'personId' end)<>'00000000-0000-0000-0000-000000000000'
      and jsonb_typeof(payload->'reason')='string' and payload->>'reason' in ('routine','security')
    end,false))
);
create table bx1_private.governance_grants (
  id uuid primary key default pg_catalog.gen_random_uuid() check (id <> '00000000-0000-0000-0000-000000000000'),
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  person_id uuid not null references bx1_private.persons(id) on delete restrict,
  capability text not null default 'ADMINISTRATION_V1' check (capability='ADMINISTRATION_V1'),
  status text not null check (status in ('ACTIVE','REVOKED')),
  valid_from timestamptz not null default now() check (isfinite(valid_from)),
  valid_until timestamptz not null check (isfinite(valid_until)),
  revision bigint not null default 1 check (revision>=1),
  created_command_id uuid,
  bootstrap_receipt_id uuid check (bootstrap_receipt_id <> '00000000-0000-0000-0000-000000000000'),
  unique (organisation_id,id),
  foreign key (organisation_id,created_command_id) references bx1_private.administration_commands(organisation_id,id) on delete restrict,
  check (valid_until>valid_from and valid_until<=valid_from+interval '2160 hours'),
  check ((created_command_id is null) <> (bootstrap_receipt_id is null))
);
create unique index bx1_governance_one_active_grant on bx1_private.governance_grants(organisation_id,person_id) where status='ACTIVE';
create table bx1_private.legal_parties (
  id uuid primary key default pg_catalog.gen_random_uuid() check (id <> '00000000-0000-0000-0000-000000000000'),
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  display_name text not null check (display_name=btrim(display_name) and char_length(display_name) between 1 and 200),
  kind text not null check (kind in ('COMPANY','TRUST','FUND','OTHER')),
  jurisdiction_code text check (jurisdiction_code ~ '^[A-Z]{2}$'),
  registration_reference text check (registration_reference=btrim(registration_reference) and char_length(registration_reference) between 1 and 100),
  status text not null default 'DRAFT' check (status='DRAFT'),
  revision bigint not null default 1 check (revision=1),
  created_command_id uuid not null unique,
  created_at timestamptz not null default now() check (isfinite(created_at)),
  unique (organisation_id,id),
  foreign key (organisation_id,created_command_id) references bx1_private.administration_commands(organisation_id,id) on delete restrict
);
create table bx1_private.workspace_parties (
  organisation_id uuid not null,
  party_id uuid not null,
  relationship text not null default 'RECORDED_ONLY' check (relationship='RECORDED_ONLY'),
  created_command_id uuid not null,
  created_at timestamptz not null default now() check (isfinite(created_at)),
  primary key (organisation_id,party_id),
  foreign key (organisation_id,party_id) references bx1_private.legal_parties(organisation_id,id) on delete restrict,
  foreign key (organisation_id,created_command_id) references bx1_private.administration_commands(organisation_id,id) on delete restrict
);
create table bx1_private.administration_requests (
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  actor_principal_id uuid not null references bx1_private.person_principals(auth_user_id) on delete restrict,
  request_key uuid not null check (request_key <> '00000000-0000-0000-0000-000000000000'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  command_id uuid not null,
  result jsonb not null check (jsonb_typeof(result)='object' and octet_length(result::text)<=4096),
  created_at timestamptz not null default now() check (isfinite(created_at)),
  primary key (organisation_id,actor_principal_id,request_key),
  foreign key (organisation_id,command_id) references bx1_private.administration_commands(organisation_id,id) on delete restrict
);
create table bx1_private.administration_events (
  id uuid primary key default pg_catalog.gen_random_uuid() check (id <> '00000000-0000-0000-0000-000000000000'),
  command_id uuid,
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  event_sequence bigint generated always as identity unique,
  actor_principal_id uuid,
  actor_person_id uuid,
  event_type text not null check (event_type in ('PROPOSED','APPROVED','REJECTED','CANCELLED','EXPIRED','INVALIDATED','APPLIED','GOVERNANCE_HOLD','BOOTSTRAP')),
  before_revision bigint check (before_revision>=1),
  after_revision bigint check (after_revision>=1),
  before_state text check (before_state in ('PENDING_REVIEW','APPROVED','APPLIED','REJECTED','CANCELLED','EXPIRED','INVALIDATED')),
  after_state text check (after_state in ('PENDING_REVIEW','APPROVED','APPLIED','REJECTED','CANCELLED','EXPIRED','INVALIDATED')),
  payload_hash text check (payload_hash ~ '^[0-9a-f]{64}$'),
  reason text check (reason in ('routine','security','expired','stale_policy','stale_scope','stale_trust','stale_target','authority_lost','below_two_governors')),
  evidence_reference text check (evidence_reference=btrim(evidence_reference) and char_length(evidence_reference) between 1 and 200),
  created_at timestamptz not null default now() check (isfinite(created_at)),
  foreign key (organisation_id,command_id) references bx1_private.administration_commands(organisation_id,id) on delete restrict,
  foreign key (actor_principal_id,actor_person_id) references bx1_private.person_principals(auth_user_id,person_id) on delete restrict,
  check ((event_type='BOOTSTRAP') = (command_id is null)),
  check ((actor_principal_id is null) = (actor_person_id is null)),
  check (command_id is null or (actor_principal_id is not null and after_revision is not null and after_state is not null and payload_hash is not null)),
  check ((before_revision is null) = (before_state is null))
);
create index bx1_administration_commands_scope_time on bx1_private.administration_commands(organisation_id,created_at desc,id);
create index bx1_administration_events_command_sequence on bx1_private.administration_events(organisation_id,command_id,event_sequence desc);

-- The ONLY migration seed is non-person configuration. No authority is active.
insert into bx1_private.authority_root(id,policy_version,trust_revision) values(true,1,1);

alter table bx1_private.authority_root enable row level security;
alter table bx1_private.persons enable row level security;
alter table bx1_private.person_principals enable row level security;
alter table bx1_private.authority_scopes enable row level security;
alter table bx1_private.governance_grants enable row level security;
alter table bx1_private.legal_parties enable row level security;
alter table bx1_private.workspace_parties enable row level security;
alter table bx1_private.administration_commands enable row level security;
alter table bx1_private.administration_requests enable row level security;
alter table bx1_private.administration_events enable row level security;
revoke all on table bx1_private.authority_root,bx1_private.persons,bx1_private.person_principals,
  bx1_private.authority_scopes,bx1_private.governance_grants,bx1_private.legal_parties,
  bx1_private.workspace_parties,bx1_private.administration_commands,bx1_private.administration_requests,
  bx1_private.administration_events from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
revoke all on sequence bx1_private.administration_events_event_sequence_seq
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
alter table bx1_private.authority_root owner to bx1_authority_owner;
alter table bx1_private.persons owner to bx1_authority_owner;
alter table bx1_private.person_principals owner to bx1_authority_owner;
alter table bx1_private.authority_scopes owner to bx1_authority_owner;
alter table bx1_private.governance_grants owner to bx1_authority_owner;
alter table bx1_private.legal_parties owner to bx1_authority_owner;
alter table bx1_private.workspace_parties owner to bx1_authority_owner;
alter table bx1_private.administration_commands owner to bx1_authority_owner;
alter table bx1_private.administration_requests owner to bx1_authority_owner;
alter table bx1_private.administration_events owner to bx1_authority_owner;
-- Temporary DDL inheritance only; restored at the end of this migration.
grant bx1_authority_owner to current_user with inherit true, set true;

grant select on public.bx1_profiles,public.bx1_organisations,public.bx1_memberships to bx1_authority_owner;
grant insert(user_id,organisation_id,role,status),update(status) on public.bx1_memberships to bx1_authority_owner;
create policy bx1_authority_profile_read on public.bx1_profiles for select to bx1_authority_owner using (true);
create policy bx1_authority_organisation_read on public.bx1_organisations for select to bx1_authority_owner using (true);
create policy bx1_authority_membership_read on public.bx1_memberships for select to bx1_authority_owner using (true);
create policy bx1_authority_membership_insert on public.bx1_memberships for insert to bx1_authority_owner with check (true);
create policy bx1_authority_membership_update on public.bx1_memberships for update to bx1_authority_owner using (true) with check (true);
grant execute on function bx1_private.has_active_session(),bx1_private.can_access_organisation(uuid),bx1_private.read_mfa_status() to bx1_authority_owner;

-- These two booleans retain the migrator's existing Auth read authority. The
-- application owner receives neither Auth table privileges nor Auth row data.
grant select on bx1_private.persons,bx1_private.person_principals,bx1_private.governance_grants to current_user;
create function bx1_private.has_recent_administration_totp() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  claims jsonb; item jsonb; epoch_now numeric; timestamp_value numeric; found_totp boolean := false;
  guard_time timestamptz := pg_catalog.clock_timestamp();
begin
  claims := auth.jwt();
  epoch_now := pg_catalog.floor(extract(epoch from guard_time));
  if not bx1_private.has_active_session() or claims->>'aal' is distinct from 'aal2'
    or pg_catalog.jsonb_typeof(claims->'exp') is distinct from 'number'
    or (claims->>'exp') !~ '^[0-9]{1,16}$' or (claims->>'exp')::numeric <= epoch_now
    or pg_catalog.jsonb_typeof(claims->'amr') is distinct from 'array'
    or pg_catalog.jsonb_array_length(claims->'amr') not between 1 and 32 then return false; end if;
  if not exists (select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
    where s.id::text=claims->>'session_id' and s.user_id=auth.uid()
      and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp'
      and s.oauth_client_id is null and (s.not_after is null or s.not_after>guard_time)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=guard_time)) then return false; end if;
  for item in select value from pg_catalog.jsonb_array_elements(claims->'amr') loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object'
      or pg_catalog.jsonb_typeof(item->'method') is distinct from 'string'
      or (item->>'method') !~ '^[A-Za-z0-9_./-]{1,64}$'
      or pg_catalog.jsonb_typeof(item->'timestamp') is distinct from 'number'
      or (item->>'timestamp') !~ '^[0-9]{1,16}$' then return false; end if;
    timestamp_value := (item->>'timestamp')::numeric;
    if timestamp_value>epoch_now then return false; end if;
    if item->>'method'='totp' and epoch_now-timestamp_value between 0 and 300 then found_totp:=true; end if;
  end loop;
  return found_totp;
exception when others then return false;
end $$;

-- No caller-controlled GUC can disable these invariants. Administrative DB
-- operators remain outside the application tamper boundary and must follow the
-- separately controlled bootstrap/recovery procedure.
create function bx1_private.guard_administration_immutable() returns trigger
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if TG_TABLE_SCHEMA<>'bx1_private' or TG_OP='DELETE' then
    raise exception using errcode='23514',message='immutable administration record';
  end if;
  if TG_TABLE_NAME in ('administration_events','administration_requests','legal_parties','workspace_parties') then
    raise exception using errcode='23514',message='append-only administration record';
  elsif TG_TABLE_NAME in ('persons','person_principals') then
    if pg_catalog.to_jsonb(NEW)-'status' is distinct from pg_catalog.to_jsonb(OLD)-'status'
      or OLD.status<>'TRUSTED' or NEW.status<>'REVOKED' then
      raise exception using errcode='23514',message='immutable trusted identity'; end if;
  elsif TG_TABLE_NAME='governance_grants' then
    if pg_catalog.to_jsonb(NEW)-array['status','revision'] is distinct from pg_catalog.to_jsonb(OLD)-array['status','revision']
      or OLD.status<>'ACTIVE' or NEW.status<>'REVOKED' or NEW.revision<>OLD.revision+1 then
      raise exception using errcode='23514',message='immutable governance grant'; end if;
  elsif TG_TABLE_NAME='administration_commands' then
    if pg_catalog.to_jsonb(NEW)-array['state','revision','reviewer_principal_id','reviewer_person_id','reviewed_at','applied_at','terminal_reason']
      is distinct from pg_catalog.to_jsonb(OLD)-array['state','revision','reviewer_principal_id','reviewer_person_id','reviewed_at','applied_at','terminal_reason']
      or NEW.revision<>OLD.revision+1
      or not ((OLD.state='PENDING_REVIEW' and NEW.state in ('APPROVED','REJECTED','CANCELLED','EXPIRED','INVALIDATED'))
        or (OLD.state='APPROVED' and NEW.state in ('APPLIED','CANCELLED','EXPIRED','INVALIDATED')))
      or (OLD.reviewer_person_id is not null and (NEW.reviewer_person_id,NEW.reviewer_principal_id,NEW.reviewed_at)
        is distinct from (OLD.reviewer_person_id,OLD.reviewer_principal_id,OLD.reviewed_at))
      or (OLD.reviewer_person_id is null and NEW.state not in ('APPROVED','REJECTED') and NEW.reviewer_person_id is not null)
      then raise exception using errcode='23514',message='immutable proposal or invalid transition'; end if;
  elsif TG_TABLE_NAME='authority_scopes' then
    if NEW.organisation_id<>OLD.organisation_id or NEW.bootstrap_receipt_id<>OLD.bootstrap_receipt_id
      or NEW.revision<>OLD.revision+1 or OLD.state='HOLD' or NEW.state not in ('READY','HOLD') then
      raise exception using errcode='23514',message='invalid scope transition'; end if;
  elsif TG_TABLE_NAME='authority_root' then
    if NEW.id is distinct from OLD.id or NEW.policy_version is distinct from OLD.policy_version or NEW.trust_revision<>OLD.trust_revision+1 then
      raise exception using errcode='23514',message='invalid trust revision'; end if;
  else raise exception using errcode='23514',message='unknown immutable table';
  end if;
  return NEW;
end $$;
create trigger bx1_authority_root_immutable before update or delete on bx1_private.authority_root for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_persons_immutable before update or delete on bx1_private.persons for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_person_principals_immutable before update or delete on bx1_private.person_principals for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_authority_scopes_immutable before update or delete on bx1_private.authority_scopes for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_governance_grants_immutable before update or delete on bx1_private.governance_grants for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_legal_parties_immutable before update or delete on bx1_private.legal_parties for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_workspace_parties_immutable before update or delete on bx1_private.workspace_parties for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_administration_commands_immutable before update or delete on bx1_private.administration_commands for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_administration_requests_immutable before update or delete on bx1_private.administration_requests for each row execute function bx1_private.guard_administration_immutable();
create trigger bx1_administration_events_immutable before update or delete on bx1_private.administration_events for each row execute function bx1_private.guard_administration_immutable();

create function bx1_private.is_eligible_governor(target_person uuid,target_organisation uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare guard_time timestamptz := pg_catalog.clock_timestamp();
begin
  return exists (select 1 from bx1_private.persons p
    join bx1_private.governance_grants g on g.person_id=p.id
    where p.id=target_person and p.status='TRUSTED' and g.organisation_id=target_organisation
      and g.status='ACTIVE' and g.capability='ADMINISTRATION_V1'
      and g.valid_from<=guard_time and g.valid_until>guard_time
      and exists (select 1 from bx1_private.person_principals pp
        join public.bx1_profiles pr on pr.id=pp.auth_user_id
        join auth.users u on u.id=pp.auth_user_id
        where pp.person_id=p.id and pp.status='TRUSTED' and pr.status='ACTIVE'
          and u.deleted_at is null and (u.banned_until is null or u.banned_until<=guard_time)
          and exists (select 1 from public.bx1_memberships m join public.bx1_organisations o on o.id=m.organisation_id
            where m.user_id=pp.auth_user_id and m.organisation_id=target_organisation and m.status='ACTIVE' and o.status='ACTIVE')
          and exists (select 1 from auth.mfa_factors f where f.user_id=pp.auth_user_id
            and f.status::text='verified' and f.factor_type::text='totp')));
exception when others then return false;
end $$;
revoke all on function bx1_private.has_recent_administration_totp(),bx1_private.is_eligible_governor(uuid,uuid)
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
grant execute on function bx1_private.has_recent_administration_totp(),bx1_private.is_eligible_governor(uuid,uuid) to bx1_authority_owner;

-- Pure normalization: a NULL result is invalid, never authority. UTC timestamps
-- are strictly round-tripped; PostgreSQL's permissive date normalization is not
-- accepted. UUID case and surrounding human-text whitespace are normalized.
create function bx1_private.normalize_administration_payload(target_kind text,input_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare result jsonb; key_name text; id_value text; value_item record; until_value timestamptz; canonical_date text;
  trim_characters text:=U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if pg_catalog.jsonb_typeof(input_payload) is distinct from 'object' or pg_catalog.octet_length(input_payload::text)>8192 then return null; end if;
  for value_item in select key,value from pg_catalog.jsonb_each(input_payload) loop
    if pg_catalog.jsonb_typeof(value_item.value) not in ('string','null') then return null; end if;
    if pg_catalog.jsonb_typeof(value_item.value)='string' and (value_item.value #>> '{}') ~ U&'[\0001-\001F\007F-\009F]' then return null; end if;
  end loop;
  if target_kind='ENTITY_DRAFT_CREATE' then
    if not(input_payload ?& array['displayName','kind','jurisdictionCode','registrationReference'])
      or input_payload-array['displayName','kind','jurisdictionCode','registrationReference']<>'{}'
      or pg_catalog.jsonb_typeof(input_payload->'displayName') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(input_payload->>'displayName',trim_characters)) not between 1 and 200
      or input_payload->>'kind' not in ('COMPANY','TRUST','FUND','OTHER')
      or input_payload->>'kind' is null
      or not(input_payload->'jurisdictionCode'='null'::jsonb or input_payload->>'jurisdictionCode' ~ '^[A-Z]{2}$')
      or not(input_payload->'registrationReference'='null'::jsonb or pg_catalog.char_length(pg_catalog.btrim(input_payload->>'registrationReference',trim_characters)) between 1 and 100)
      then return null; end if;
    result:=pg_catalog.jsonb_build_object('displayName',pg_catalog.btrim(input_payload->>'displayName',trim_characters),'kind',input_payload->>'kind',
      'jurisdictionCode',input_payload->>'jurisdictionCode','registrationReference',pg_catalog.btrim(input_payload->>'registrationReference',trim_characters));
  else
    key_name:=case target_kind when 'MEMBERSHIP_GRANT' then 'principalId' when 'MEMBERSHIP_REVOKE' then 'membershipId'
      when 'GOVERNANCE_REVOKE' then 'grantId' when 'GOVERNANCE_GRANT' then 'personId' when 'PERSON_SCOPE_REVOKE' then 'personId' end;
    if key_name is null then return null; end if;
    id_value:=pg_catalog.lower(input_payload->>key_name);
    if pg_catalog.jsonb_typeof(input_payload->key_name) is distinct from 'string'
      or id_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or id_value='00000000-0000-0000-0000-000000000000' then return null; end if;
    if target_kind='MEMBERSHIP_GRANT' then
      if not(input_payload ?& array[key_name,'role']) or input_payload-array[key_name,'role']<>'{}'
        or input_payload->>'role' is null or input_payload->>'role' not in ('Investor','OfferingManager','ComplianceOfficer','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin') then return null; end if;
      result:=pg_catalog.jsonb_build_object(key_name,id_value,'role',input_payload->>'role');
    elsif target_kind='GOVERNANCE_GRANT' then
      if not(input_payload ?& array[key_name,'validUntil']) or input_payload-array[key_name,'validUntil']<>'{}'
        or pg_catalog.jsonb_typeof(input_payload->'validUntil') is distinct from 'string'
        or input_payload->>'validUntil' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then return null; end if;
      until_value:=(input_payload->>'validUntil')::timestamptz;
      canonical_date:=pg_catalog.to_char(until_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS');
      if pg_catalog.left(input_payload->>'validUntil',19)<>canonical_date then return null; end if;
      result:=pg_catalog.jsonb_build_object(key_name,id_value,'validUntil',input_payload->>'validUntil');
    else
      if not(input_payload ?& array[key_name,'reason']) or input_payload-array[key_name,'reason']<>'{}'
        or input_payload->>'reason' is null or input_payload->>'reason' not in ('routine','security') then return null; end if;
      result:=pg_catalog.jsonb_build_object(key_name,id_value,'reason',input_payload->>'reason');
    end if;
  end if;
  if pg_catalog.octet_length(result::text)>4096 then return null; end if;
  return result;
exception when others then return null;
end $$;

-- Full target-set commitment, not a directory-page commitment. All mapped
-- principals and selected-scope membership/grant tuples feed the ordered digest.
create function bx1_private.administration_target_snapshot(target_kind text,target_payload jsonb,target_organisation uuid) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare person_id_value uuid; principal_value uuid; membership_row public.bx1_memberships; grant_row bx1_private.governance_grants;
  person_status text; tuples jsonb; target_detail jsonb := '{}'::jsonb;
begin
  if target_kind='ENTITY_DRAFT_CREATE' then return pg_catalog.jsonb_build_object('organisationId',target_organisation,'beneficiaryPersonId',null); end if;
  if target_kind='MEMBERSHIP_GRANT' then
    principal_value:=(target_payload->>'principalId')::uuid;
    select pp.person_id into person_id_value from bx1_private.person_principals pp join public.bx1_profiles p on p.id=pp.auth_user_id
      where pp.auth_user_id=principal_value and pp.status='TRUSTED' and p.status='ACTIVE'
      and exists(select 1 from public.bx1_memberships m where m.user_id=pp.auth_user_id and m.organisation_id=target_organisation and m.status='ACTIVE');
    if person_id_value is null then return null; end if;
    select * into membership_row from public.bx1_memberships where user_id=principal_value and organisation_id=target_organisation and role=target_payload->>'role';
    if membership_row.status='ACTIVE' then return null; end if;
    target_detail:=pg_catalog.jsonb_build_object('principalId',principal_value,'membershipId',membership_row.id,'membershipStatus',membership_row.status,'role',target_payload->>'role');
  elsif target_kind='MEMBERSHIP_REVOKE' then
    select * into membership_row from public.bx1_memberships where id=(target_payload->>'membershipId')::uuid and organisation_id=target_organisation and status='ACTIVE';
    if membership_row.id is null then return null; end if;
    select person_id into person_id_value from bx1_private.person_principals where auth_user_id=membership_row.user_id;
    target_detail:=pg_catalog.jsonb_build_object('membershipId',membership_row.id,'principalId',membership_row.user_id,'role',membership_row.role,'status',membership_row.status);
  elsif target_kind='GOVERNANCE_REVOKE' then
    select * into grant_row from bx1_private.governance_grants where id=(target_payload->>'grantId')::uuid and organisation_id=target_organisation and status='ACTIVE';
    if grant_row.id is null then return null; end if;
    person_id_value:=grant_row.person_id;
    target_detail:=pg_catalog.jsonb_build_object('grantId',grant_row.id,'revision',grant_row.revision::text,'status',grant_row.status);
  else
    person_id_value:=(target_payload->>'personId')::uuid;
    if target_kind='GOVERNANCE_GRANT' and exists(select 1 from bx1_private.governance_grants where person_id=person_id_value and organisation_id=target_organisation and status='ACTIVE') then return null; end if;
  end if;
  select status into person_status from bx1_private.persons where id=person_id_value;
  if person_status is null then return null; end if;
  -- Elevation requires an already admitted trusted recipient. Reduction is
  -- intentionally different: an ineligible/suspended beneficiary must not block
  -- cleanup of its existing selected-scope authority. Actors stay fully gated.
  if target_kind in ('MEMBERSHIP_GRANT','GOVERNANCE_GRANT') then
    if person_status<>'TRUSTED' or not exists(select 1 from bx1_private.person_principals pp join public.bx1_profiles p on p.id=pp.auth_user_id
      join public.bx1_memberships m on m.user_id=pp.auth_user_id where pp.person_id=person_id_value and pp.status='TRUSTED'
        and p.status='ACTIVE' and m.organisation_id=target_organisation and m.status='ACTIVE') then return null; end if;
  elsif target_kind='PERSON_SCOPE_REVOKE' then
    if not exists(select 1 from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id
        where pp.person_id=person_id_value and m.organisation_id=target_organisation and m.status='ACTIVE')
      and not exists(select 1 from bx1_private.governance_grants g where g.person_id=person_id_value and g.organisation_id=target_organisation and g.status='ACTIVE') then return null; end if;
  end if;
  select pg_catalog.jsonb_build_object(
    'principals',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(pp.auth_user_id,pp.status,p.status) order by pp.auth_user_id)
      from bx1_private.person_principals pp join public.bx1_profiles p on p.id=pp.auth_user_id where pp.person_id=person_id_value),'[]'::jsonb),
    'memberships',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(m.id,m.user_id,m.role,m.status) order by m.id)
      from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=person_id_value and m.organisation_id=target_organisation),'[]'::jsonb),
    'grants',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(g.id,g.status,g.revision::text,
      pg_catalog.to_char(g.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      pg_catalog.to_char(g.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by g.id)
      from bx1_private.governance_grants g where g.person_id=person_id_value and g.organisation_id=target_organisation),'[]'::jsonb)) into tuples;
  return pg_catalog.jsonb_build_object('organisationId',target_organisation,'beneficiaryPersonId',person_id_value,'personStatus',person_status,
    'target',target_detail,'setHash',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(tuples::text,'UTF8')),'hex'));
exception when others then return null;
end $$;

create function bx1_private.administration_proposal_projection(proposal bx1_private.administration_commands,actor_person uuid,
  scope_row bx1_private.authority_scopes,root_row bx1_private.authority_root) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare transitions jsonb:='[]'::jsonb; effective_state text:=proposal.state; fresh boolean;
begin
  if proposal.state in ('PENDING_REVIEW','APPROVED') and proposal.expires_at<=pg_catalog.clock_timestamp() then effective_state:='EXPIRED'; end if;
  fresh:=scope_row.state='READY' and effective_state in ('PENDING_REVIEW','APPROVED')
    and proposal.expected_scope_revision=scope_row.revision and proposal.expected_trust_revision=root_row.trust_revision
    and proposal.policy_version=root_row.policy_version
    and bx1_private.is_eligible_governor(proposal.requester_person_id,proposal.organisation_id)
    and (proposal.reviewer_person_id is null or bx1_private.is_eligible_governor(proposal.reviewer_person_id,proposal.organisation_id))
    and bx1_private.administration_target_snapshot(proposal.kind,proposal.payload,proposal.organisation_id)=proposal.target_snapshot;
  if fresh then
    if actor_person=proposal.requester_person_id then transitions:=transitions||'"cancel"'::jsonb; end if;
    if effective_state='PENDING_REVIEW' and actor_person<>proposal.requester_person_id
      and actor_person is distinct from proposal.beneficiary_person_id then transitions:=transitions||'["approve","reject"]'::jsonb; end if;
    if effective_state='APPROVED' and actor_person in (proposal.requester_person_id,proposal.reviewer_person_id)
      and actor_person is distinct from proposal.beneficiary_person_id then transitions:=transitions||'"apply"'::jsonb; end if;
  end if;
  return pg_catalog.jsonb_build_object('id',proposal.id,'kind',proposal.kind,'state',effective_state,'revision',proposal.revision::text,
    'requesterPersonId',proposal.requester_person_id,'beneficiaryPersonId',proposal.beneficiary_person_id,'reviewerPersonId',proposal.reviewer_person_id,
    'payload',proposal.payload,'payloadHash',proposal.payload_hash,'expiresAt',pg_catalog.to_char(proposal.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'expectedScopeRevision',proposal.expected_scope_revision::text,'expectedTrustRevision',proposal.expected_trust_revision::text,
    'policyVersion',proposal.policy_version,'allowedTransitions',transitions);
end $$;

create function bx1_private.read_administration(target_organisation uuid,selected_proposal uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  gate jsonb:= '{"availability":"forbidden","scopeRevision":null,"policyVersion":1,"caller":null,"scope":null,"people":[],"entities":[],"proposals":[],"selectedProposal":null,"truncated":{"people":false,"entities":false,"proposals":false},"governanceGrants":[],"grantsTruncated":false}'::jsonb;
  claims jsonb; mfa jsonb; actor_id uuid; actor_person uuid; root_row bx1_private.authority_root; scope_row bx1_private.authority_scopes;
  own_grant bx1_private.governance_grants; proposal bx1_private.administration_commands;
  person_row record; principal_row record; grant_row record; row_item record;
  people jsonb:='[]'; entities jsonb:='[]'; proposals jsonb:='[]'; grants jsonb:='[]'; principals jsonb; memberships jsonb;
  selected jsonb:=null; events jsonb; people_count integer:=0; principal_count integer; entity_count integer:=0; proposal_count integer:=0; grant_count integer:=0; event_count integer;
  own_grant_json jsonb;
begin
  if target_organisation is null or target_organisation='00000000-0000-0000-0000-000000000000' then return gate; end if;
  claims:=pg_catalog.current_setting('request.jwt.claims',true)::jsonb;
  actor_id:=(claims->>'sub')::uuid;
  if not bx1_private.has_active_session() or not exists(select 1 from public.bx1_memberships m join public.bx1_organisations o on o.id=m.organisation_id
    where m.user_id=actor_id and m.organisation_id=target_organisation and m.status='ACTIVE' and o.status='ACTIVE') then return gate; end if;
  mfa:=bx1_private.read_mfa_status();
  if claims->>'aal' is distinct from 'aal2' or pg_catalog.jsonb_typeof(claims->'exp') is distinct from 'number'
    or (claims->>'exp') !~ '^[0-9]{1,16}$' or (claims->>'exp')::numeric<=pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()))
    or not coalesce((mfa->>'active')::boolean,false) or not coalesce((mfa->>'session_is_mfa')::boolean,false)
    or not coalesce((mfa->>'session_is_totp')::boolean,false) then return gate||'{"availability":"mfa_required"}'::jsonb; end if;
  if not bx1_private.can_access_organisation(target_organisation) then return gate; end if;
  select * into root_row from bx1_private.authority_root where id;
  select * into scope_row from bx1_private.authority_scopes where organisation_id=target_organisation;
  if scope_row.organisation_id is null then return gate||'{"availability":"unconfigured"}'::jsonb; end if;
  select pp.person_id into actor_person from bx1_private.person_principals pp join bx1_private.persons p on p.id=pp.person_id
    where pp.auth_user_id=actor_id and pp.status='TRUSTED' and p.status='TRUSTED';
  if actor_person is null or not bx1_private.is_eligible_governor(actor_person,target_organisation) then return gate; end if;
  select * into own_grant from bx1_private.governance_grants where person_id=actor_person and organisation_id=target_organisation and status='ACTIVE';
  own_grant_json:=pg_catalog.jsonb_build_object('id',own_grant.id,'personId',own_grant.person_id,'capability',own_grant.capability,'status',own_grant.status,
    'validFrom',pg_catalog.to_char(own_grant.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'validUntil',pg_catalog.to_char(own_grant.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',own_grant.revision::text);
  for person_row in select p.* from bx1_private.persons p where p.status='TRUSTED'
    and exists(select 1 from bx1_private.person_principals pp join public.bx1_profiles pr on pr.id=pp.auth_user_id
      join public.bx1_memberships m on m.user_id=pp.auth_user_id where pp.person_id=p.id and pp.status='TRUSTED' and pr.status='ACTIVE'
        and m.organisation_id=target_organisation and m.status='ACTIVE') order by p.created_at desc,p.id limit 51 loop
    people_count:=people_count+1; if people_count>50 then exit; end if;
    principals:='[]'; principal_count:=0;
    for principal_row in select pp.* from bx1_private.person_principals pp join public.bx1_profiles pr on pr.id=pp.auth_user_id
      where pp.person_id=person_row.id and pp.status='TRUSTED' and pr.status='ACTIVE'
      and exists(select 1 from public.bx1_memberships m where m.user_id=pp.auth_user_id and m.organisation_id=target_organisation and m.status='ACTIVE')
      order by pp.created_at desc,pp.auth_user_id limit 11 loop
      principal_count:=principal_count+1; if principal_count>10 then exit; end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id,'principalId',m.user_id,'personId',person_row.id,'role',m.role,'status',m.status) order by m.role),'[]'::jsonb)
        into memberships from public.bx1_memberships m where m.user_id=principal_row.auth_user_id and m.organisation_id=target_organisation;
      principals:=principals||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',principal_row.auth_user_id,'memberships',memberships));
    end loop;
    people:=people||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',person_row.id,'label',person_row.label,'principals',principals,'principalsTruncated',principal_count>10));
  end loop;
  for row_item in select p.* from bx1_private.legal_parties p join bx1_private.workspace_parties w on w.party_id=p.id and w.organisation_id=p.organisation_id
    where p.organisation_id=target_organisation order by p.created_at desc,p.id limit 51 loop
    entity_count:=entity_count+1; if entity_count>50 then exit; end if;
    entities:=entities||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',row_item.id,'displayName',row_item.display_name,'kind',row_item.kind,
      'jurisdictionCode',row_item.jurisdiction_code,'registrationReference',row_item.registration_reference,'status','DRAFT','revision','1','relationship','RECORDED_ONLY'));
  end loop;
  for proposal in select * from bx1_private.administration_commands where organisation_id=target_organisation order by created_at desc,id limit 51 loop
    proposal_count:=proposal_count+1; if proposal_count>50 then exit; end if;
    proposals:=proposals||pg_catalog.jsonb_build_array(bx1_private.administration_proposal_projection(proposal,actor_person,scope_row,root_row));
  end loop;
  for grant_row in select * from bx1_private.governance_grants where organisation_id=target_organisation order by valid_from desc,id limit 51 loop
    grant_count:=grant_count+1; if grant_count>50 then exit; end if;
    grants:=grants||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',grant_row.id,'personId',grant_row.person_id,'capability',grant_row.capability,'status',grant_row.status,
      'validFrom',pg_catalog.to_char(grant_row.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'validUntil',pg_catalog.to_char(grant_row.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'revision',grant_row.revision::text));
  end loop;
  if selected_proposal is not null then
    select * into proposal from bx1_private.administration_commands where organisation_id=target_organisation and id=selected_proposal;
    if proposal.id is not null then
      events:='[]'; event_count:=0;
      for row_item in select * from bx1_private.administration_events where organisation_id=target_organisation and command_id=selected_proposal
        and event_type<>'BOOTSTRAP' order by event_sequence desc limit 101 loop
        event_count:=event_count+1; if event_count>100 then exit; end if;
        events:=events||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',row_item.id,'sequence',row_item.event_sequence::text,'type',row_item.event_type,
          'actorPersonId',row_item.actor_person_id,'beforeState',row_item.before_state,'afterState',row_item.after_state,'beforeRevision',row_item.before_revision::text,
          'afterRevision',row_item.after_revision::text,'payloadHash',row_item.payload_hash,'reason',row_item.reason,
          'createdAt',pg_catalog.to_char(row_item.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
      end loop;
      selected:=bx1_private.administration_proposal_projection(proposal,actor_person,scope_row,root_row)||pg_catalog.jsonb_build_object('events',events,'historyTruncated',event_count>100);
    end if;
  end if;
  -- Recheck admission after constructing the bounded projection. Application
  -- writers advance scope/trust revisions; never return a mixed old-authority
  -- directory if one committed during these read-only queries.
  mfa:=bx1_private.read_mfa_status();
  if not bx1_private.can_access_organisation(target_organisation)
    or not bx1_private.is_eligible_governor(actor_person,target_organisation)
    or not exists(select 1 from bx1_private.person_principals where auth_user_id=actor_id and person_id=actor_person and status='TRUSTED') then return gate; end if;
  if not coalesce((mfa->>'active')::boolean,false) or not coalesce((mfa->>'session_is_mfa')::boolean,false)
    or not coalesce((mfa->>'session_is_totp')::boolean,false)
    or (claims->>'exp')::numeric<=pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp())) then return gate||'{"availability":"mfa_required"}'::jsonb; end if;
  if not exists(select 1 from bx1_private.authority_scopes where organisation_id=target_organisation and revision=scope_row.revision and state=scope_row.state)
    or not exists(select 1 from bx1_private.authority_root where id and trust_revision=root_row.trust_revision and policy_version=root_row.policy_version) then return gate||'{"availability":"unavailable"}'::jsonb; end if;
  return pg_catalog.jsonb_build_object('availability',case scope_row.state when 'HOLD' then 'hold' else 'ready' end,'scopeRevision',scope_row.revision::text,'policyVersion',root_row.policy_version,
    'caller',pg_catalog.jsonb_build_object('principalId',actor_id,'personId',actor_person,'grant',own_grant_json),
    'scope',pg_catalog.jsonb_build_object('organisationId',target_organisation,'state',scope_row.state,'revision',scope_row.revision::text,'policyVersion',root_row.policy_version,'trustRevision',root_row.trust_revision::text),
    'people',people,'entities',entities,'proposals',proposals,'selectedProposal',selected,
    'truncated',pg_catalog.jsonb_build_object('people',people_count>50,'entities',entity_count>50,'proposals',proposal_count>50),
    'governanceGrants',grants,'grantsTruncated',grant_count>50);
exception when others then return gate||'{"availability":"unavailable"}'::jsonb;
end $$;

create function bx1_private.execute_administration(target_organisation uuid,command_request_key uuid,command jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  admission jsonb; actor_id uuid; actor_person uuid; intent text; normalized jsonb; payload_value jsonb; expected_value bigint; proposal_id uuid;
  request_hash_value text; receipt bx1_private.administration_requests; proposal bx1_private.administration_commands;
  root_row bx1_private.authority_root; scope_row bx1_private.authority_scopes; snapshot_value jsonb; beneficiary uuid;
  guard_time timestamptz; before_state_value text; before_revision_value bigint; reason_value text; result_value jsonb; event_type_value text;
  party_id_value uuid; target_person_value uuid; target_membership_value uuid; eligible_count integer; stale_proposal bx1_private.administration_commands;
begin
  perform pg_catalog.set_config('lock_timeout','3s',true);
  perform pg_catalog.set_config('statement_timeout','10s',true);
  if target_organisation is null or command_request_key is null
    or target_organisation='00000000-0000-0000-0000-000000000000' or command_request_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(command) is distinct from 'object' or pg_catalog.octet_length(command::text)>8192
    or pg_catalog.jsonb_typeof(command->'intent') is distinct from 'string' then return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
  intent:=command->>'intent';
  if intent='propose' then
    if not(command ?& array['intent','kind','payload','expectedScopeRevision']) or command-array['intent','kind','payload','expectedScopeRevision']<>'{}'
      or pg_catalog.jsonb_typeof(command->'kind') is distinct from 'string'
      or pg_catalog.jsonb_typeof(command->'expectedScopeRevision') is distinct from 'string'
      or command->>'expectedScopeRevision' !~ '^[1-9][0-9]{0,18}$'
      or (command->>'expectedScopeRevision')::numeric>9223372036854775807 then return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    payload_value:=bx1_private.normalize_administration_payload(command->>'kind',command->'payload');
    if payload_value is null then return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    expected_value:=(command->>'expectedScopeRevision')::bigint;
    normalized:=pg_catalog.jsonb_build_object('intent',intent,'kind',command->>'kind','payload',payload_value,'expectedScopeRevision',expected_value::text);
  elsif intent in ('review','apply','cancel') then
    if (intent='review' and (not(command ?& array['intent','proposalId','expectedRevision','decision']) or command-array['intent','proposalId','expectedRevision','decision']<>'{}'
        or pg_catalog.jsonb_typeof(command->'decision') is distinct from 'string' or command->>'decision' not in ('approve','reject')))
      or (intent<>'review' and (not(command ?& array['intent','proposalId','expectedRevision']) or command-array['intent','proposalId','expectedRevision']<>'{}'))
      or pg_catalog.jsonb_typeof(command->'proposalId') is distinct from 'string'
      or command->>'proposalId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or command->>'proposalId'='00000000-0000-0000-0000-000000000000'
      or pg_catalog.jsonb_typeof(command->'expectedRevision') is distinct from 'string'
      or command->>'expectedRevision' !~ '^[1-9][0-9]{0,18}$'
      or (command->>'expectedRevision')::numeric>9223372036854775807 then return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    proposal_id:=(command->>'proposalId')::uuid; expected_value:=(command->>'expectedRevision')::bigint;
    normalized:=pg_catalog.jsonb_build_object('intent',intent,'proposalId',proposal_id,'expectedRevision',expected_value::text);
    if intent='review' then normalized:=normalized||pg_catalog.jsonb_build_object('decision',command->>'decision'); end if;
  else return '{"ok":false,"error":"invalid_request"}'::jsonb;
  end if;
  if not bx1_private.has_active_session() then return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  admission:=bx1_private.read_administration(target_organisation,null);
  if admission->>'availability' not in ('ready','hold') then return pg_catalog.jsonb_build_object('ok',false,'error',admission->>'availability'); end if;
  if not bx1_private.has_recent_administration_totp() then return '{"ok":false,"error":"step_up_required"}'::jsonb; end if;
  if admission->>'availability'='hold' then return '{"ok":false,"error":"governance_hold"}'::jsonb; end if;
  actor_id:=(admission#>>'{caller,principalId}')::uuid; actor_person:=(admission#>>'{caller,personId}')::uuid;
  request_hash_value:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized::text,'UTF8')),'hex');

  -- Deliberately serialize this low-volume control plane. Locks include the
  -- complete selected-scope target set, never just a bounded read directory.
  select * into root_row from bx1_private.authority_root where id for update;
  select * into scope_row from bx1_private.authority_scopes where organisation_id=target_organisation for update;
  if scope_row.organisation_id is null then return '{"ok":false,"error":"unconfigured"}'::jsonb; end if;
  perform p.id from bx1_private.persons p where exists(select 1 from bx1_private.person_principals pp
    join public.bx1_memberships m on m.user_id=pp.auth_user_id where pp.person_id=p.id and m.organisation_id=target_organisation)
    or exists(select 1 from bx1_private.governance_grants g where g.person_id=p.id and g.organisation_id=target_organisation)
    order by p.id for update of p;
  perform pp.auth_user_id from bx1_private.person_principals pp where exists(select 1 from bx1_private.person_principals scoped
    join public.bx1_memberships m on m.user_id=scoped.auth_user_id where scoped.person_id=pp.person_id and m.organisation_id=target_organisation)
    or exists(select 1 from bx1_private.governance_grants g where g.person_id=pp.person_id and g.organisation_id=target_organisation)
    order by pp.auth_user_id for update of pp;
  perform g.id from bx1_private.governance_grants g where g.organisation_id=target_organisation order by g.id for update;
  perform c.id from bx1_private.administration_commands c where c.organisation_id=target_organisation order by c.id for update;
  perform m.id from public.bx1_memberships m where m.organisation_id=target_organisation order by m.id for update;
  perform p.id from bx1_private.legal_parties p where p.organisation_id=target_organisation order by p.id for update;
  guard_time:=pg_catalog.clock_timestamp();

  -- Every replay and every transition re-authorizes after all waits. Provider
  -- revocations committed before this fresh snapshot deny; no Auth lock or DML.
  if not bx1_private.has_recent_administration_totp() then return '{"ok":false,"error":"step_up_required"}'::jsonb; end if;
  if not bx1_private.can_access_organisation(target_organisation)
    or not exists(select 1 from bx1_private.person_principals pp join bx1_private.persons p on p.id=pp.person_id
      where pp.auth_user_id=actor_id and pp.person_id=actor_person and pp.status='TRUSTED' and p.status='TRUSTED')
    or not bx1_private.is_eligible_governor(actor_person,target_organisation) then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  if scope_row.state='HOLD' then return '{"ok":false,"error":"governance_hold"}'::jsonb; end if;
  select * into receipt from bx1_private.administration_requests r where r.organisation_id=target_organisation
    and r.actor_principal_id=actor_id and r.request_key=command_request_key;
  if receipt.request_key is not null then
    if receipt.request_hash<>request_hash_value then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    if receipt.result->'ok'='true'::jsonb then return receipt.result||'{"replayed":true}'::jsonb; end if;
    return receipt.result;
  end if;
  select count(*) into eligible_count from bx1_private.governance_grants g where g.organisation_id=target_organisation
    and g.status='ACTIVE' and bx1_private.is_eligible_governor(g.person_id,target_organisation);
  -- Loss of a required requester/reviewer must still terminalize an existing
  -- intent below this line. A roster deficit blocks new proposals, not the
  -- authorised observation and recording of that lost authority.
  if eligible_count<2 and intent='propose' then return '{"ok":false,"error":"governance_hold"}'::jsonb; end if;

  if intent='propose' then
    if expected_value<>scope_row.revision then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    if command->>'kind'='GOVERNANCE_GRANT' and ((payload_value->>'validUntil')::timestamptz<=guard_time
      or (payload_value->>'validUntil')::timestamptz>guard_time+interval '2160 hours') then return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    snapshot_value:=bx1_private.administration_target_snapshot(command->>'kind',payload_value,target_organisation);
    if snapshot_value is null then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    beneficiary:=(snapshot_value->>'beneficiaryPersonId')::uuid;
    if command->>'kind' in ('MEMBERSHIP_GRANT','GOVERNANCE_GRANT') and beneficiary=actor_person then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    insert into bx1_private.administration_commands(organisation_id,request_key,kind,payload,payload_hash,target_snapshot,
      requester_principal_id,requester_person_id,beneficiary_person_id,expected_scope_revision,expected_trust_revision,policy_version,created_at,expires_at)
    values(target_organisation,command_request_key,command->>'kind',payload_value,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload_value::text,'UTF8')),'hex'),snapshot_value,
      actor_id,actor_person,beneficiary,scope_row.revision,root_row.trust_revision,root_row.policy_version,guard_time,guard_time+interval '24 hours') returning * into proposal;
    event_type_value:='PROPOSED';
  else
    select * into proposal from bx1_private.administration_commands where id=proposal_id and organisation_id=target_organisation;
    if proposal.id is null then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    -- Independence is about attested people, never just Auth account IDs.
    if (intent='review' and (actor_person=proposal.requester_person_id or actor_person=proposal.beneficiary_person_id))
      or (intent='apply' and (actor_person not in (proposal.requester_person_id,coalesce(proposal.reviewer_person_id,proposal.requester_person_id)) or actor_person=proposal.beneficiary_person_id))
      or (intent='cancel' and actor_person<>proposal.requester_person_id) then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    if proposal.revision<>expected_value or proposal.state not in ('PENDING_REVIEW','APPROVED')
      or (intent='review' and proposal.state<>'PENDING_REVIEW') or (intent='apply' and proposal.state<>'APPROVED') then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    before_state_value:=proposal.state; before_revision_value:=proposal.revision;
    if proposal.expires_at<=guard_time then reason_value:='expired';
    elsif proposal.policy_version<>root_row.policy_version then reason_value:='stale_policy';
    elsif proposal.expected_trust_revision<>root_row.trust_revision then reason_value:='stale_trust';
    elsif proposal.expected_scope_revision<>scope_row.revision then reason_value:='stale_scope';
    elsif not bx1_private.is_eligible_governor(proposal.requester_person_id,target_organisation)
      or (proposal.reviewer_person_id is not null and not bx1_private.is_eligible_governor(proposal.reviewer_person_id,target_organisation))
      or not exists(select 1 from bx1_private.person_principals pp where pp.auth_user_id=proposal.requester_principal_id and pp.person_id=proposal.requester_person_id and pp.status='TRUSTED')
      or (proposal.reviewer_person_id is not null and not exists(select 1 from bx1_private.person_principals pp where pp.auth_user_id=proposal.reviewer_principal_id and pp.person_id=proposal.reviewer_person_id and pp.status='TRUSTED')) then reason_value:='authority_lost';
    elsif bx1_private.administration_target_snapshot(proposal.kind,proposal.payload,target_organisation) is distinct from proposal.target_snapshot
      or (proposal.kind='GOVERNANCE_GRANT' and (proposal.payload->>'validUntil')::timestamptz<=guard_time) then reason_value:='stale_target';
    end if;
    if reason_value is not null then
      event_type_value:=case reason_value when 'expired' then 'EXPIRED' else 'INVALIDATED' end;
      update bx1_private.administration_commands set state=event_type_value,revision=revision+1,terminal_reason=reason_value where id=proposal.id returning * into proposal;
      result_value:=pg_catalog.jsonb_build_object('ok',false,'error',case reason_value when 'expired' then 'expired' else 'conflict' end);
    elsif intent='review' then
      event_type_value:=case command->>'decision' when 'approve' then 'APPROVED' else 'REJECTED' end;
      update bx1_private.administration_commands set state=event_type_value,revision=revision+1,reviewer_principal_id=actor_id,reviewer_person_id=actor_person,reviewed_at=guard_time where id=proposal.id returning * into proposal;
    elsif intent='cancel' then
      event_type_value:='CANCELLED';
      update bx1_private.administration_commands set state='CANCELLED',revision=revision+1 where id=proposal.id returning * into proposal;
    else
      -- A routine floor violation rolls this inner domain effect back before
      -- returning a denial. Any unexpected error rolls back this entire call.
      begin
        if proposal.kind='ENTITY_DRAFT_CREATE' then
          insert into bx1_private.legal_parties(organisation_id,display_name,kind,jurisdiction_code,registration_reference,created_command_id,created_at)
            values(target_organisation,proposal.payload->>'displayName',proposal.payload->>'kind',proposal.payload->>'jurisdictionCode',proposal.payload->>'registrationReference',proposal.id,guard_time) returning id into party_id_value;
          insert into bx1_private.workspace_parties(organisation_id,party_id,created_command_id,created_at) values(target_organisation,party_id_value,proposal.id,guard_time);
        elsif proposal.kind='MEMBERSHIP_GRANT' then
          select id into target_membership_value from public.bx1_memberships where user_id=(proposal.payload->>'principalId')::uuid and organisation_id=target_organisation and role=proposal.payload->>'role';
          if target_membership_value is null then
            insert into public.bx1_memberships(user_id,organisation_id,role,status) values((proposal.payload->>'principalId')::uuid,target_organisation,proposal.payload->>'role','ACTIVE');
          else update public.bx1_memberships set status='ACTIVE' where id=target_membership_value and status='SUSPENDED'; end if;
        elsif proposal.kind='MEMBERSHIP_REVOKE' then
          update public.bx1_memberships set status='SUSPENDED' where id=(proposal.payload->>'membershipId')::uuid and organisation_id=target_organisation and status='ACTIVE';
        elsif proposal.kind='GOVERNANCE_GRANT' then
          insert into bx1_private.governance_grants(organisation_id,person_id,status,valid_from,valid_until,created_command_id)
            values(target_organisation,(proposal.payload->>'personId')::uuid,'ACTIVE',guard_time,(proposal.payload->>'validUntil')::timestamptz,proposal.id);
        elsif proposal.kind='GOVERNANCE_REVOKE' then
          update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where id=(proposal.payload->>'grantId')::uuid and organisation_id=target_organisation and status='ACTIVE';
        elsif proposal.kind='PERSON_SCOPE_REVOKE' then
          target_person_value:=(proposal.payload->>'personId')::uuid;
          update public.bx1_memberships m set status='SUSPENDED' where m.organisation_id=target_organisation and m.status='ACTIVE'
            and exists(select 1 from bx1_private.person_principals pp where pp.auth_user_id=m.user_id and pp.person_id=target_person_value);
          update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where person_id=target_person_value and organisation_id=target_organisation and status='ACTIVE';
        end if;
        select count(*) into eligible_count from bx1_private.governance_grants g where g.organisation_id=target_organisation and g.status='ACTIVE' and bx1_private.is_eligible_governor(g.person_id,target_organisation);
        if eligible_count<2 and coalesce(proposal.payload->>'reason','routine')<>'security' then
          raise exception using errcode='BA002',message='routine governance floor'; end if;
        update bx1_private.authority_scopes set revision=revision+1,state=case when eligible_count<2 then 'HOLD' else 'READY' end
          where organisation_id=target_organisation returning * into scope_row;
        update bx1_private.administration_commands set state='APPLIED',revision=revision+1,applied_at=guard_time,
          terminal_reason=proposal.payload->>'reason' where id=proposal.id returning * into proposal;
      exception when sqlstate 'BA002' then return '{"ok":false,"error":"conflict"}'::jsonb;
      end;
      event_type_value:='APPLIED'; reason_value:=proposal.payload->>'reason';
      -- Any applied domain change invalidates other outstanding intents. They
      -- keep their original payload, identities, target commitment and expiry.
      for stale_proposal in select * from bx1_private.administration_commands where organisation_id=target_organisation
        and id<>proposal.id and state in ('PENDING_REVIEW','APPROVED') order by id loop
        update bx1_private.administration_commands set state='INVALIDATED',revision=revision+1,terminal_reason='stale_scope' where id=stale_proposal.id;
        insert into bx1_private.administration_events(command_id,organisation_id,actor_principal_id,actor_person_id,event_type,before_revision,after_revision,before_state,after_state,payload_hash,reason,created_at)
          values(stale_proposal.id,target_organisation,actor_id,actor_person,'INVALIDATED',stale_proposal.revision,stale_proposal.revision+1,stale_proposal.state,'INVALIDATED',stale_proposal.payload_hash,'stale_scope',guard_time);
      end loop;
    end if;
  end if;
  insert into bx1_private.administration_events(command_id,organisation_id,actor_principal_id,actor_person_id,event_type,before_revision,after_revision,before_state,after_state,payload_hash,reason,created_at)
    values(proposal.id,target_organisation,actor_id,actor_person,event_type_value,before_revision_value,proposal.revision,before_state_value,proposal.state,proposal.payload_hash,reason_value,guard_time);
  if event_type_value='APPLIED' and scope_row.state='HOLD' then
    insert into bx1_private.administration_events(command_id,organisation_id,actor_principal_id,actor_person_id,event_type,before_revision,after_revision,before_state,after_state,payload_hash,reason,created_at)
      values(proposal.id,target_organisation,actor_id,actor_person,'GOVERNANCE_HOLD',proposal.revision,proposal.revision,'APPLIED','APPLIED',proposal.payload_hash,'below_two_governors',guard_time);
  end if;
  if result_value is null then result_value:=pg_catalog.jsonb_build_object('ok',true,'proposalId',proposal.id,'state',proposal.state,'revision',proposal.revision::text,
    'replayed',false,'scopeState',scope_row.state,'scopeRevision',scope_row.revision::text); end if;
  insert into bx1_private.administration_requests(organisation_id,actor_principal_id,request_key,request_hash,command_id,result,created_at)
    values(target_organisation,actor_id,command_request_key,request_hash_value,proposal.id,result_value,guard_time);
  return result_value;
exception when others then
  -- Includes lock timeout, deadlock, serialization, constraint and audit faults.
  -- PL/pgSQL's exception subtransaction rolls back every preceding write.
  return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

create function public.bx1_administration_read(target_organisation uuid,selected_command uuid default null) returns jsonb
language sql volatile security invoker set search_path = '' set statement_timeout = '10s' as $$
  select bx1_private.read_administration(target_organisation,selected_command);
$$;
create function public.bx1_administration_command(target_organisation uuid,request_key uuid,command jsonb) returns jsonb
language sql volatile security invoker set search_path = '' set statement_timeout = '10s' as $$
  select bx1_private.execute_administration(target_organisation,request_key,command);
$$;

-- Remove creator defaults before exact grants. Only the two fully guarded
-- entries are client-callable in private; no bootstrap/audit/normalizer endpoint.
revoke all on function bx1_private.guard_administration_immutable(),bx1_private.normalize_administration_payload(text,jsonb),
  bx1_private.administration_target_snapshot(text,jsonb,uuid),
  bx1_private.administration_proposal_projection(bx1_private.administration_commands,uuid,bx1_private.authority_scopes,bx1_private.authority_root),
  bx1_private.read_administration(uuid,uuid),bx1_private.execute_administration(uuid,uuid,jsonb),
  public.bx1_administration_read(uuid,uuid),public.bx1_administration_command(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
alter function bx1_private.guard_administration_immutable() owner to bx1_authority_owner;
alter function bx1_private.normalize_administration_payload(text,jsonb) owner to bx1_authority_owner;
alter function bx1_private.administration_target_snapshot(text,jsonb,uuid) owner to bx1_authority_owner;
alter function bx1_private.administration_proposal_projection(bx1_private.administration_commands,uuid,bx1_private.authority_scopes,bx1_private.authority_root) owner to bx1_authority_owner;
alter function bx1_private.read_administration(uuid,uuid) owner to bx1_authority_owner;
alter function bx1_private.execute_administration(uuid,uuid,jsonb) owner to bx1_authority_owner;
grant execute on function bx1_private.read_administration(uuid,uuid),bx1_private.execute_administration(uuid,uuid,jsonb),
  public.bx1_administration_read(uuid,uuid),public.bx1_administration_command(uuid,uuid,jsonb) to authenticated;
revoke create on schema bx1_private from bx1_authority_owner;
grant bx1_authority_owner to current_user with inherit false, set false;
comment on function public.bx1_administration_command(uuid,uuid,jsonb) is 'Guarded, independent scoped administration only. No Auth, wallet, financial or chain authority. No bootstrap.';
