-- First-time staff invitation. This is an additive, isolated command path:
-- approval and an email do not create a membership. The invitee must prove
-- ownership of the exact email, enroll TOTP, and accept in a current AAL2
-- session before the reviewed organisation role is granted atomically.
-- No live people, invitations, Auth users, roles, or SMTP settings are seeded.

create table bx1_private.staff_invitation_intents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  email text not null check (email=lower(btrim(email)) and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('Investor','OfferingManager','ComplianceOfficer','IssuerFundManager',
    'TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin')),
  requester_principal_id uuid not null,
  requester_person_id uuid not null,
  reviewer_principal_id uuid,
  reviewer_person_id uuid,
  scope_revision bigint not null check (scope_revision>=1),
  trust_revision bigint not null check (trust_revision>=1),
  state text not null default 'PENDING_REVIEW' check (state in ('PENDING_REVIEW','APPROVED','QUEUED',
    'DISPATCHING','INVITED','MFA_PENDING','ACCEPTED','REJECTED','CANCELLED','EXPIRED','INVALIDATED','DELIVERY_UNKNOWN')),
  revision bigint not null default 1 check (revision>=1),
  created_at timestamptz not null default now(),
  review_expires_at timestamptz not null,
  reviewed_at timestamptz,
  acceptance_expires_at timestamptz,
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  membership_id uuid unique references public.bx1_memberships(id) on delete restrict,
  terminal_reason text,
  foreign key (requester_principal_id,requester_person_id)
    references bx1_private.person_principals(auth_user_id,person_id) on delete restrict,
  foreign key (reviewer_principal_id,reviewer_person_id)
    references bx1_private.person_principals(auth_user_id,person_id) on delete restrict,
  check (review_expires_at=created_at+interval '24 hours'),
  check ((reviewer_principal_id is null)=(reviewer_person_id is null)),
  check (reviewer_person_id is null or reviewer_person_id<>requester_person_id),
  check ((state='ACCEPTED')=(membership_id is not null and accepted_at is not null)),
  check (state not in ('APPROVED','QUEUED','DISPATCHING','INVITED','MFA_PENDING','ACCEPTED','REJECTED')
    or reviewer_person_id is not null),
  check (state not in ('QUEUED','DISPATCHING','INVITED','MFA_PENDING','ACCEPTED')
    or acceptance_expires_at is not null)
);
create index bx1_staff_invitation_scope_state on bx1_private.staff_invitation_intents(organisation_id,state,created_at desc);
create unique index bx1_staff_invitation_one_open_email_role on bx1_private.staff_invitation_intents(organisation_id,email,role)
  where state in ('PENDING_REVIEW','APPROVED','QUEUED','DISPATCHING','INVITED','MFA_PENDING');
-- Supabase Auth has one user per email, so a first-time invitation cannot
-- safely race a second organisation's invite to that same Auth identity.
create unique index bx1_staff_invitation_one_open_email on bx1_private.staff_invitation_intents(email)
  where state in ('PENDING_REVIEW','APPROVED','QUEUED','DISPATCHING','INVITED','MFA_PENDING');

create table bx1_private.staff_invitation_requests (
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  actor_id uuid not null references bx1_private.person_principals(auth_user_id) on delete restrict,
  request_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  invitation_id uuid not null references bx1_private.staff_invitation_intents(id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  primary key (organisation_id,actor_id,request_key)
);
create table bx1_private.staff_invitation_outbox (
  invitation_id uuid primary key references bx1_private.staff_invitation_intents(id) on delete restrict,
  state text not null check (state in ('PENDING','CLAIMED','SENT','UNKNOWN')),
  lease_id uuid unique,
  claimed_at timestamptz,
  dispatched_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((state='CLAIMED')=(lease_id is not null and claimed_at is not null))
);
create table bx1_private.staff_invitation_events (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references bx1_private.staff_invitation_intents(id) on delete restrict,
  organisation_id uuid not null references bx1_private.authority_scopes(organisation_id) on delete restrict,
  actor_id uuid,
  event_type text not null check (event_type in ('PROPOSED','APPROVED','REJECTED','QUEUED','DISPATCH_CLAIMED',
    'INVITED','RECONCILED','DELIVERY_UNKNOWN','MFA_PENDING','ACCEPTED','CANCELLED','EXPIRED','INVALIDATED')),
  before_state text,
  after_state text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (actor_id) references auth.users(id) on delete restrict
);
create index bx1_staff_invitation_events_order on bx1_private.staff_invitation_events(invitation_id,created_at,id);

alter table bx1_private.staff_invitation_intents enable row level security;
alter table bx1_private.staff_invitation_requests enable row level security;
alter table bx1_private.staff_invitation_outbox enable row level security;
alter table bx1_private.staff_invitation_events enable row level security;
revoke all on table bx1_private.staff_invitation_intents,bx1_private.staff_invitation_requests,
  bx1_private.staff_invitation_outbox,bx1_private.staff_invitation_events from public,anon,authenticated,service_role;
-- Preserve the existing MFA helper's isolated ownership when a project uses a
-- non-default migration owner. Only that pre-existing trusted helper owner may
-- inspect a pending pre-role invitation; authenticated callers get no table read.
do $invite_mfa_owner$
declare helper_owner text;
begin
  select pg_get_userbyid(p.proowner) into helper_owner from pg_proc p
    where p.oid='bx1_private.read_mfa_status()'::regprocedure;
  execute format('grant select on bx1_private.staff_invitation_intents to %I',helper_owner);
end $invite_mfa_owner$;

create function bx1_private.staff_invitation_event_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'immutable invitation evidence' using errcode='23514';
end $$;
create trigger bx1_staff_invitation_events_immutable before update or delete on bx1_private.staff_invitation_events
  for each row execute function bx1_private.staff_invitation_event_immutable();
create trigger bx1_staff_invitation_requests_immutable before update or delete on bx1_private.staff_invitation_requests
  for each row execute function bx1_private.staff_invitation_event_immutable();

-- Every administrative intent uses the existing live-person, live-governance,
-- live-session and recent-TOTP authority boundary. The low-volume root/scope
-- locks serialize invitation decisions against authority changes.
create function bx1_private.staff_invitation_admin(target_org uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare admission jsonb;
begin
  if target_org is null or not bx1_private.has_active_session() then return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  admission:=bx1_private.read_administration(target_org,null);
  if admission->>'availability'<>'ready' then
    return jsonb_build_object('ok',false,'error',coalesce(admission->>'availability','unavailable')); end if;
  if not bx1_private.has_recent_administration_totp() then
    return '{"ok":false,"error":"step_up_required"}'::jsonb; end if;
  return jsonb_build_object('ok',true,'actorId',admission#>>'{caller,principalId}',
    'personId',admission#>>'{caller,personId}',
    'scopeRevision',admission#>>'{scope,revision}',
    'trustRevision',admission#>>'{scope,trustRevision}');
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

create function bx1_private.staff_invitation_command(target_org uuid,command_key uuid,command jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare authority jsonb; actor uuid; actor_person uuid; scope_row bx1_private.authority_scopes;
  root_row bx1_private.authority_root; invite bx1_private.staff_invitation_intents;
  prior bx1_private.staff_invitation_requests; intent text; expected bigint; email_value text;
  role_value text; hash_value text; answer jsonb; now_value timestamptz;
begin
  perform set_config('lock_timeout','3s',true);
  if command_key is null or command_key='00000000-0000-0000-0000-000000000000'
    or jsonb_typeof(command) is distinct from 'object' or octet_length(command::text)>4096
    or jsonb_typeof(command->'intent') is distinct from 'string' then
    return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
  intent:=command->>'intent';
  if intent='propose' then
    if not(command ?& array['intent','email','role','expectedScopeRevision'])
      or command-array['intent','email','role','expectedScopeRevision']<>'{}'
      or jsonb_typeof(command->'email')<>'string' or jsonb_typeof(command->'role')<>'string'
      or jsonb_typeof(command->'expectedScopeRevision')<>'string'
      or command->>'expectedScopeRevision' !~ '^[1-9][0-9]{0,18}$'
      or (command->>'expectedScopeRevision')::numeric>9223372036854775807 then
      return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    email_value:=lower(btrim(command->>'email'));
    role_value:=command->>'role';
    if char_length(email_value) not between 3 and 254
      or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or role_value not in ('Investor','OfferingManager','ComplianceOfficer','IssuerFundManager',
        'TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin') then
      return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    expected:=(command->>'expectedScopeRevision')::bigint;
    command:=jsonb_build_object('intent',intent,'email',email_value,'role',role_value,'expectedScopeRevision',expected::text);
  elsif intent in ('approve','reject','apply','cancel') then
    if not(command ?& array['intent','invitationId','expectedRevision'])
      or command-array['intent','invitationId','expectedRevision']<>'{}'
      or jsonb_typeof(command->'invitationId')<>'string'
      or command->>'invitationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(command->'expectedRevision')<>'string'
      or command->>'expectedRevision' !~ '^[1-9][0-9]{0,18}$'
      or (command->>'expectedRevision')::numeric>9223372036854775807 then
      return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
    expected:=(command->>'expectedRevision')::bigint;
    command:=jsonb_build_object('intent',intent,'invitationId',(command->>'invitationId')::uuid,
      'expectedRevision',expected::text);
  else return '{"ok":false,"error":"invalid_request"}'::jsonb; end if;
  authority:=bx1_private.staff_invitation_admin(target_org);
  if authority->'ok'<>'true'::jsonb then return authority; end if;
  actor:=(authority->>'actorId')::uuid; actor_person:=(authority->>'personId')::uuid;
  hash_value:=encode(sha256(convert_to(command::text,'UTF8')),'hex');
  select * into root_row from bx1_private.authority_root where id for update;
  select * into scope_row from bx1_private.authority_scopes where organisation_id=target_org for update;
  if not found or scope_row.state<>'READY' then return '{"ok":false,"error":"governance_hold"}'::jsonb; end if;
  -- Lock the current actor and all selected-scope governors before rechecking.
  perform id from bx1_private.persons where id=actor_person for share;
  perform id from bx1_private.governance_grants where organisation_id=target_org order by id for share;
  now_value:=clock_timestamp();
  authority:=bx1_private.staff_invitation_admin(target_org);
  if authority->'ok'<>'true'::jsonb or authority->>'actorId'<>actor::text
    or root_row.trust_revision<>(authority->>'trustRevision')::bigint
    or scope_row.revision<>(authority->>'scopeRevision')::bigint then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  select * into prior from bx1_private.staff_invitation_requests r where r.organisation_id=target_org
    and r.actor_id=actor and r.request_key=command_key;
  if found then
    if prior.request_hash<>hash_value then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    return prior.result||'{"replayed":true}'::jsonb;
  end if;
  if intent='propose' then
    if expected<>scope_row.revision or exists(select 1 from auth.users u where lower(u.email)=email_value and u.deleted_at is null)
      or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=email_value)
      or (select count(*) from bx1_private.governance_grants g where g.organisation_id=target_org
        and g.status='ACTIVE' and bx1_private.is_eligible_governor(g.person_id,target_org))<2 then
      return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    insert into bx1_private.staff_invitation_intents(organisation_id,email,role,requester_principal_id,
      requester_person_id,scope_revision,trust_revision,created_at,review_expires_at)
      values(target_org,email_value,role_value,actor,actor_person,scope_row.revision,
        root_row.trust_revision,now_value,now_value+interval '24 hours') returning * into invite;
    insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
      values(invite.id,target_org,actor,'PROPOSED',null,'PENDING_REVIEW');
  else
    select * into invite from bx1_private.staff_invitation_intents where id=(command->>'invitationId')::uuid
      and organisation_id=target_org for update;
    if not found then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    if invite.revision<>expected then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
    if intent in ('approve','reject') and (invite.state<>'PENDING_REVIEW' or actor_person=invite.requester_person_id) then
      return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    if intent='apply' and (invite.state<>'APPROVED' or actor_person not in (invite.requester_person_id,invite.reviewer_person_id)) then
      return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    if intent='cancel' and (invite.state not in ('PENDING_REVIEW','APPROVED','QUEUED','DISPATCHING','INVITED','MFA_PENDING')
      or actor_person not in (invite.requester_person_id,coalesce(invite.reviewer_person_id,invite.requester_person_id))) then
      return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
    if invite.review_expires_at<=now_value and invite.state in ('PENDING_REVIEW','APPROVED')
      or (invite.acceptance_expires_at is not null and invite.acceptance_expires_at<=now_value)
      or invite.scope_revision<>scope_row.revision and invite.state in ('PENDING_REVIEW','APPROVED')
      or invite.trust_revision<>root_row.trust_revision and invite.state in ('PENDING_REVIEW','APPROVED')
      or not bx1_private.is_eligible_governor(invite.requester_person_id,target_org)
      or (invite.reviewer_person_id is not null and not bx1_private.is_eligible_governor(invite.reviewer_person_id,target_org)) then
      update bx1_private.staff_invitation_intents set state='INVALIDATED',revision=revision+1,terminal_reason='stale_authority'
        where id=invite.id returning * into invite;
      insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
        values(invite.id,target_org,actor,'INVALIDATED',null,'INVALIDATED');
      answer:='{"ok":false,"error":"conflict"}'::jsonb;
    elsif intent in ('approve','reject') then
      update bx1_private.staff_invitation_intents set state=case intent when 'approve' then 'APPROVED' else 'REJECTED' end,
        revision=revision+1,reviewer_principal_id=actor,reviewer_person_id=actor_person,reviewed_at=now_value
        where id=invite.id returning * into invite;
      insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
        values(invite.id,target_org,actor,invite.state,'PENDING_REVIEW',invite.state);
    elsif intent='apply' then
      if exists(select 1 from auth.users u where lower(u.email)=invite.email and u.deleted_at is null) then
        return '{"ok":false,"error":"conflict"}'::jsonb; end if;
      update bx1_private.staff_invitation_intents set state='QUEUED',revision=revision+1,
        acceptance_expires_at=now_value+interval '7 days' where id=invite.id returning * into invite;
      insert into bx1_private.staff_invitation_outbox(invitation_id,state) values(invite.id,'PENDING');
      insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
        values(invite.id,target_org,actor,'QUEUED','APPROVED','QUEUED');
    else
      update bx1_private.staff_invitation_intents set state='CANCELLED',revision=revision+1,terminal_reason='cancelled'
        where id=invite.id returning * into invite;
      insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
        values(invite.id,target_org,actor,'CANCELLED',null,'CANCELLED');
    end if;
  end if;
  if answer is null then answer:=jsonb_build_object('ok',true,'invitationId',invite.id,
    'state',invite.state,'revision',invite.revision::text,'replayed',false); end if;
  insert into bx1_private.staff_invitation_requests(organisation_id,actor_id,request_key,request_hash,invitation_id,result)
    values(target_org,actor,command_key,hash_value,invite.id,answer);
  return answer;
exception when unique_violation then return '{"ok":false,"error":"conflict"}'::jsonb;
when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

create function bx1_private.staff_invitation_read(target_org uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare authority jsonb; items jsonb;
begin
  authority:=bx1_private.staff_invitation_admin(target_org);
  if authority->'ok'<>'true'::jsonb then return authority; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'state',
    case when i.state in ('PENDING_REVIEW','APPROVED') and i.review_expires_at<=clock_timestamp() then 'EXPIRED'
      when i.state in ('QUEUED','DISPATCHING','INVITED','MFA_PENDING') and i.acceptance_expires_at<=clock_timestamp() then 'EXPIRED'
      else i.state end,'revision',i.revision::text,'requesterPersonId',i.requester_person_id,
    'reviewerPersonId',i.reviewer_person_id,'reviewExpiresAt',i.review_expires_at,
    'acceptanceExpiresAt',i.acceptance_expires_at) order by i.created_at desc,i.id),'[]'::jsonb)
    into items from (select * from bx1_private.staff_invitation_intents where organisation_id=target_org
      order by created_at desc,id limit 50) i;
  if (bx1_private.staff_invitation_admin(target_org))->'ok'<>'true'::jsonb then
    return '{"ok":false,"error":"unavailable"}'::jsonb; end if;
  return jsonb_build_object('ok',true,'scopeRevision',(authority->>'scopeRevision'),'actorPersonId',authority->>'personId','invitations',items);
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

-- Claim is caller-authorised and once-only. Unknown provider outcomes are NOT
-- retried blindly: Supabase Auth invite has no operation-bound idempotency key.
create function bx1_private.staff_invitation_claim(target_org uuid,invite_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare authority jsonb; invite bx1_private.staff_invitation_intents; lease uuid:=gen_random_uuid();
  outbox bx1_private.staff_invitation_outbox;
begin
  perform set_config('lock_timeout','3s',true);
  authority:=bx1_private.staff_invitation_admin(target_org);
  if authority->'ok'<>'true'::jsonb then return authority; end if;
  perform id from bx1_private.authority_root where id for update;
  perform organisation_id from bx1_private.authority_scopes where organisation_id=target_org for update;
  select * into invite from bx1_private.staff_invitation_intents where id=invite_id and organisation_id=target_org for update;
  select * into outbox from bx1_private.staff_invitation_outbox where invitation_id=invite_id for update;
  if invite.id is null or outbox.invitation_id is null or invite.state<>'QUEUED' or outbox.state<>'PENDING'
    or invite.acceptance_expires_at<=clock_timestamp()
    or not bx1_private.is_eligible_governor(invite.requester_person_id,target_org)
    or not bx1_private.is_eligible_governor(invite.reviewer_person_id,target_org)
    or exists(select 1 from auth.users u where lower(u.email)=invite.email and u.deleted_at is null) then
    return '{"ok":false,"error":"conflict"}'::jsonb; end if;
  if (bx1_private.staff_invitation_admin(target_org))->'ok'<>'true'::jsonb then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  update bx1_private.staff_invitation_outbox set state='CLAIMED',lease_id=lease,claimed_at=clock_timestamp(),updated_at=clock_timestamp()
    where invitation_id=invite.id and state='PENDING';
  update bx1_private.staff_invitation_intents set state='DISPATCHING',revision=revision+1 where id=invite.id;
  insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
    values(invite.id,target_org,(authority->>'actorId')::uuid,'DISPATCH_CLAIMED','QUEUED','DISPATCHING');
  return jsonb_build_object('ok',true,'invitationId',invite.id,'email',invite.email,'leaseId',lease);
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

-- This endpoint is service-only. It records the actual Auth user returned by
-- inviteUserByEmail; it cannot decide or grant a membership.
create function bx1_private.staff_invitation_dispatch_result(invite_id uuid,lease_id uuid,auth_id uuid,delivered boolean) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare invite bx1_private.staff_invitation_intents; outbox bx1_private.staff_invitation_outbox;
  next_state text; now_value timestamptz:=clock_timestamp();
begin
  if auth.jwt()->>'role'<>'service_role' or invite_id is null or lease_id is null or delivered is null then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  select * into invite from bx1_private.staff_invitation_intents where id=invite_id for update;
  select * into outbox from bx1_private.staff_invitation_outbox where invitation_id=invite_id for update;
  if invite.id is null or outbox.lease_id is distinct from lease_id or invite.state<>'DISPATCHING'
    or outbox.state<>'CLAIMED' then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
  if delivered and (auth_id is null or invite.acceptance_expires_at<=now_value
    or not exists(select 1 from auth.users u where u.id=auth_id and lower(u.email)=invite.email and u.deleted_at is null
      and u.invited_at>=outbox.claimed_at and u.confirmation_sent_at>=outbox.claimed_at
      and u.raw_user_meta_data->>'bx1_staff_invitation_id'=invite.id::text
      and u.raw_user_meta_data->>'bx1_staff_lease_id'=lease_id::text)) then
    return '{"ok":false,"error":"conflict"}'::jsonb; end if;
  next_state:=case when delivered then 'INVITED' else 'DELIVERY_UNKNOWN' end;
  update bx1_private.staff_invitation_outbox set state=case when delivered then 'SENT' else 'UNKNOWN' end,
    lease_id=null,claimed_at=null,dispatched_at=now_value,updated_at=now_value where invitation_id=invite_id;
  update bx1_private.staff_invitation_intents set state=next_state,revision=revision+1,
    auth_user_id=case when delivered then auth_id else null end where id=invite_id;
  insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,event_type,before_state,after_state)
    values(invite.id,invite.organisation_id,case when delivered then 'INVITED' else 'DELIVERY_UNKNOWN' end,
      'DISPATCHING',next_state);
  return jsonb_build_object('ok',true,'state',next_state);
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

-- Read-only Auth evidence reconciliation for an unknown result. The provider
-- may have sent its email before our result RPC timed out. This never sends or
-- resends; it can only bind the exact user created by that lease and only
-- while the independently approved invitation remains current.
create function bx1_private.staff_invitation_reconcile(target_org uuid,invite_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare authority jsonb; invite bx1_private.staff_invitation_intents;
  outbox bx1_private.staff_invitation_outbox; matched_user uuid; match_count integer;
begin
  perform set_config('lock_timeout','3s',true);
  authority:=bx1_private.staff_invitation_admin(target_org);
  if authority->'ok'<>'true'::jsonb then return authority; end if;
  perform id from bx1_private.authority_root where id for update;
  perform organisation_id from bx1_private.authority_scopes where organisation_id=target_org for update;
  select * into invite from bx1_private.staff_invitation_intents where id=invite_id and organisation_id=target_org for update;
  if invite.id is null then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  if invite.state='INVITED' and invite.auth_user_id is not null then
    return jsonb_build_object('ok',true,'state','INVITED','replayed',true); end if;
  select * into outbox from bx1_private.staff_invitation_outbox where invitation_id=invite.id for update;
  if invite.state<>'DISPATCHING' or outbox.state<>'CLAIMED' or outbox.lease_id is null
    or invite.acceptance_expires_at<=clock_timestamp()
    or not bx1_private.is_eligible_governor(invite.requester_person_id,target_org)
    or not bx1_private.is_eligible_governor(invite.reviewer_person_id,target_org) then
    return '{"ok":false,"error":"conflict"}'::jsonb; end if;
  select min(u.id::text)::uuid,count(*)::int into matched_user,match_count from auth.users u
    where lower(u.email)=invite.email and u.deleted_at is null
      and u.invited_at>=outbox.claimed_at and u.confirmation_sent_at>=outbox.claimed_at
      and u.raw_user_meta_data->>'bx1_staff_invitation_id'=invite.id::text
      and u.raw_user_meta_data->>'bx1_staff_lease_id'=outbox.lease_id::text;
  if match_count<>1 then return '{"ok":false,"error":"outcome_unknown"}'::jsonb; end if;
  if (bx1_private.staff_invitation_admin(target_org))->'ok'<>'true'::jsonb then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  update bx1_private.staff_invitation_outbox set state='SENT',lease_id=null,claimed_at=null,
    dispatched_at=clock_timestamp(),updated_at=clock_timestamp() where invitation_id=invite.id;
  update bx1_private.staff_invitation_intents set state='INVITED',revision=revision+1,
    auth_user_id=matched_user where id=invite.id;
  insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
    values(invite.id,target_org,(authority->>'actorId')::uuid,'RECONCILED','DISPATCHING','INVITED');
  return jsonb_build_object('ok',true,'state','INVITED');
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

-- Invitee self-binding requires the signed, live session and confirmed exact
-- email. It creates only a profile, never a membership or trusted person.
create function bx1_private.staff_invitation_begin() returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid:=auth.uid(); token jsonb:=auth.jwt(); invite bx1_private.staff_invitation_intents;
  user_row auth.users; profile public.bx1_profiles; now_value timestamptz:=clock_timestamp();
begin
  if actor is null or token->>'session_id' is null or token->>'exp' !~ '^[0-9]{1,16}$'
    or (token->>'exp')::numeric<=extract(epoch from now_value) then
    return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  perform id from auth.sessions where user_id=actor and id::text=token->>'session_id'
    and (not_after is null or not_after>now_value) and oauth_client_id is null for share;
  if not found then return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  select * into user_row from auth.users where id=actor for share;
  if not found or user_row.email_confirmed_at is null or user_row.deleted_at is not null
    or coalesce(user_row.is_anonymous,false) or user_row.banned_until>now_value then
    return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  select * into invite from bx1_private.staff_invitation_intents where auth_user_id=actor
    and email=lower(user_row.email) and state in ('INVITED','MFA_PENDING')
    order by created_at,id limit 1 for update;
  if not found then return '{"ok":true,"state":"NONE"}'::jsonb; end if;
  if invite.acceptance_expires_at<=now_value
    or not exists(select 1 from bx1_private.authority_scopes s join public.bx1_organisations o
      on o.id=s.organisation_id where s.organisation_id=invite.organisation_id and s.state='READY' and o.status='ACTIVE')
    or not bx1_private.is_eligible_governor(invite.requester_person_id,invite.organisation_id)
    or not bx1_private.is_eligible_governor(invite.reviewer_person_id,invite.organisation_id) then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  select * into profile from public.bx1_profiles where id=actor for update;
  if found and profile.status<>'ACTIVE' then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  if not found then insert into public.bx1_profiles(id,display_name,status)
    values(actor,invite.email,'ACTIVE'); end if;
  if invite.state='INVITED' then
    update bx1_private.staff_invitation_intents set state='MFA_PENDING',revision=revision+1 where id=invite.id;
    insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
      values(invite.id,invite.organisation_id,actor,'MFA_PENDING','INVITED','MFA_PENDING');
  end if;
  return jsonb_build_object('ok',true,'state','MFA_PENDING','invitationId',invite.id);
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

-- The existing MFA enrollment endpoint can now issue a QR before role grant;
-- no ordinary staff/dashboard read is opened because membership is absent.
create or replace function bx1_private.read_mfa_status() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare current_aal text; current_factor_type text; requires_factor boolean; current_mfa boolean;
begin
  if not bx1_private.has_active_session() or not (
    exists(select 1 from public.bx1_memberships m join public.bx1_organisations o on o.id=m.organisation_id
      where m.user_id=auth.uid() and m.status='ACTIVE' and o.status='ACTIVE')
    or exists(select 1 from bx1_private.staff_invitation_intents i where i.auth_user_id=auth.uid()
      and i.state='MFA_PENDING' and i.acceptance_expires_at>clock_timestamp()
      -- Enrollment is not a role or organisation grant. Acceptance below
      -- separately rechecks current scope and both approvers after TOTP.
    )
  ) then return jsonb_build_object('active',false,'requires_mfa',false,'session_aal',null,
      'session_is_mfa',false,'session_is_totp',false); end if;
  select s.aal::text,f.factor_type::text into current_aal,current_factor_type from auth.sessions s
    left join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id and f.status='verified'
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id';
  select exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified') into requires_factor;
  current_mfa:=coalesce(current_aal='aal2' and current_factor_type is not null,false);
  return jsonb_build_object('active',true,'requires_mfa',requires_factor,'session_aal',current_aal,
    'session_is_mfa',current_mfa,'session_is_totp',current_mfa and coalesce(current_factor_type='totp',false));
end $$;
create or replace function public.bx1_mfa_status() returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_private.read_mfa_status(); $$;

create function bx1_private.staff_invitation_accept(invite_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid:=auth.uid(); token jsonb:=auth.jwt(); invite bx1_private.staff_invitation_intents;
  user_row auth.users; profile public.bx1_profiles; mapped bx1_private.person_principals;
  mapped_person bx1_private.persons; member public.bx1_memberships; now_value timestamptz;
  created_person uuid;
begin
  perform set_config('lock_timeout','3s',true);
  if actor is null or invite_id is null or token->>'aal'<>'aal2'
    or not bx1_private.has_active_session() or not bx1_private.has_recent_administration_totp() then
    return '{"ok":false,"error":"mfa_required"}'::jsonb; end if;
  perform id from bx1_private.authority_root where id for update;
  select * into invite from bx1_private.staff_invitation_intents where id=invite_id;
  if not found or invite.auth_user_id<>actor then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  perform organisation_id from bx1_private.authority_scopes where organisation_id=invite.organisation_id for update;
  select * into invite from bx1_private.staff_invitation_intents where id=invite_id for update;
  if invite.state='ACCEPTED' and invite.membership_id is not null
    and exists(select 1 from public.bx1_memberships m where m.id=invite.membership_id and m.user_id=actor
      and m.organisation_id=invite.organisation_id and m.role=invite.role and m.status='ACTIVE') then
    return jsonb_build_object('ok',true,'state','ACCEPTED','membershipId',invite.membership_id,'replayed',true); end if;
  if invite.state<>'MFA_PENDING' then return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  now_value:=clock_timestamp();
  perform id from auth.sessions where user_id=actor and id::text=token->>'session_id'
    and aal='aal2' and (not_after is null or not_after>now_value) and oauth_client_id is null for share;
  if not found then return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  select * into user_row from auth.users where id=actor for share;
  select * into profile from public.bx1_profiles where id=actor for update;
  if user_row.id is null or lower(user_row.email)<>invite.email or user_row.email_confirmed_at is null
    or user_row.deleted_at is not null or user_row.banned_until>now_value or coalesce(user_row.is_anonymous,false)
    or profile.id is null or profile.status<>'ACTIVE' or invite.acceptance_expires_at<=now_value
    or not exists(select 1 from bx1_private.authority_scopes s join public.bx1_organisations o
      on o.id=s.organisation_id where s.organisation_id=invite.organisation_id and s.state='READY' and o.status='ACTIVE')
    or not bx1_private.is_eligible_governor(invite.requester_person_id,invite.organisation_id)
    or not bx1_private.is_eligible_governor(invite.reviewer_person_id,invite.organisation_id)
    or not exists(select 1 from auth.mfa_factors f where f.user_id=actor and f.status='verified'
      and f.factor_type='totp' and f.id=(select s.factor_id from auth.sessions s where s.user_id=actor
        and s.id::text=token->>'session_id')) then
    return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  select * into mapped from bx1_private.person_principals where auth_user_id=actor for update;
  if found then
    select * into mapped_person from bx1_private.persons where id=mapped.person_id for update;
    if mapped.status<>'TRUSTED' or mapped_person.status<>'TRUSTED' then
      return '{"ok":false,"error":"forbidden"}'::jsonb; end if;
  else
    insert into bx1_private.persons(label,status,evidence_reference,bootstrap_receipt_id)
      values(invite.email,'TRUSTED','accepted_staff_invitation',invite.id) returning id into created_person;
    insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
      values(actor,created_person,'TRUSTED','accepted_staff_invitation',invite.id);
  end if;
  select * into member from public.bx1_memberships where user_id=actor and organisation_id=invite.organisation_id
    and role=invite.role for update;
  if found then return '{"ok":false,"error":"conflict"}'::jsonb; end if;
  insert into public.bx1_memberships(user_id,organisation_id,role,status)
    values(actor,invite.organisation_id,invite.role,'ACTIVE') returning * into member;
  update bx1_private.staff_invitation_intents set state='ACCEPTED',revision=revision+1,
    membership_id=member.id,accepted_at=now_value where id=invite.id;
  update bx1_private.authority_scopes set revision=revision+1 where organisation_id=invite.organisation_id;
  if created_person is not null then update bx1_private.authority_root set trust_revision=trust_revision+1 where id; end if;
  insert into bx1_private.staff_invitation_events(invitation_id,organisation_id,actor_id,event_type,before_state,after_state)
    values(invite.id,invite.organisation_id,actor,'ACCEPTED','MFA_PENDING','ACCEPTED');
  if not bx1_private.can_access_organisation(invite.organisation_id) then
    raise exception 'post_acceptance_access_changed' using errcode='42501'; end if;
  return jsonb_build_object('ok',true,'state','ACCEPTED','membershipId',member.id);
exception when unique_violation then return '{"ok":false,"error":"conflict"}'::jsonb;
when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

create function bx1_private.staff_invitation_self_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); items jsonb;
begin
  if not bx1_private.has_active_session() then return '{"ok":false,"error":"unauthorised"}'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'organisationId',i.organisation_id,
    'role',i.role,'state',i.state,'expiresAt',i.acceptance_expires_at)
    order by i.created_at,i.id),'[]'::jsonb) into items
    from bx1_private.staff_invitation_intents i where i.auth_user_id=actor and i.state='MFA_PENDING'
      and i.acceptance_expires_at>clock_timestamp();
  return jsonb_build_object('ok',true,'invitations',items);
exception when others then return '{"ok":false,"error":"unavailable"}'::jsonb;
end $$;

create function public.bx1_staff_invitation_read(target_organisation uuid) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_read(target_organisation); $$;
create function public.bx1_staff_invitation_command(target_organisation uuid,request_key uuid,command jsonb) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_command(target_organisation,request_key,command); $$;
create function public.bx1_staff_invitation_claim(target_organisation uuid,invitation_id uuid) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_claim(target_organisation,invitation_id); $$;
create function public.bx1_staff_invitation_dispatch_result(invitation_id uuid,lease_id uuid,auth_user_id uuid,delivered boolean) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_dispatch_result(invitation_id,lease_id,auth_user_id,delivered); $$;
create function public.bx1_staff_invitation_reconcile(target_organisation uuid,invitation_id uuid) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_reconcile(target_organisation,invitation_id); $$;
create function public.bx1_staff_invitation_begin() returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_begin(); $$;
create function public.bx1_staff_invitation_accept(invitation_id uuid) returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_accept(invitation_id); $$;
create function public.bx1_staff_invitation_self_read() returns jsonb
language sql volatile security invoker set search_path='' set statement_timeout='10s' as $$
  select bx1_private.staff_invitation_self_read(); $$;

revoke all on function bx1_private.staff_invitation_event_immutable(),bx1_private.staff_invitation_admin(uuid),
  bx1_private.staff_invitation_command(uuid,uuid,jsonb),bx1_private.staff_invitation_read(uuid),
  bx1_private.staff_invitation_claim(uuid,uuid),bx1_private.staff_invitation_dispatch_result(uuid,uuid,uuid,boolean),
  bx1_private.staff_invitation_reconcile(uuid,uuid),
  bx1_private.staff_invitation_begin(),bx1_private.staff_invitation_accept(uuid),bx1_private.staff_invitation_self_read(),
  public.bx1_staff_invitation_read(uuid),public.bx1_staff_invitation_command(uuid,uuid,jsonb),
  public.bx1_staff_invitation_claim(uuid,uuid),public.bx1_staff_invitation_dispatch_result(uuid,uuid,uuid,boolean),
  public.bx1_staff_invitation_reconcile(uuid,uuid),
  public.bx1_staff_invitation_begin(),public.bx1_staff_invitation_accept(uuid),public.bx1_staff_invitation_self_read()
  from public,anon,authenticated,service_role;
grant execute on function bx1_private.staff_invitation_admin(uuid),bx1_private.staff_invitation_command(uuid,uuid,jsonb),
  bx1_private.staff_invitation_read(uuid),bx1_private.staff_invitation_claim(uuid,uuid),bx1_private.staff_invitation_reconcile(uuid,uuid),
  bx1_private.staff_invitation_begin(),bx1_private.staff_invitation_accept(uuid),bx1_private.staff_invitation_self_read(),
  public.bx1_staff_invitation_read(uuid),public.bx1_staff_invitation_command(uuid,uuid,jsonb),
  public.bx1_staff_invitation_claim(uuid,uuid),public.bx1_staff_invitation_reconcile(uuid,uuid),public.bx1_staff_invitation_begin(),
  public.bx1_staff_invitation_accept(uuid),public.bx1_staff_invitation_self_read() to authenticated;
grant execute on function bx1_private.staff_invitation_dispatch_result(uuid,uuid,uuid,boolean),
  public.bx1_staff_invitation_dispatch_result(uuid,uuid,uuid,boolean) to service_role;
-- The public invoker wrapper needs schema USAGE to reach only the explicitly
-- granted service result function; raw invitation tables remain inaccessible.
grant usage on schema bx1_private to service_role;
comment on function public.bx1_staff_invitation_accept(uuid) is 'Verified exact-email invitee, current live TOTP session and current independent governors required; one scoped membership only.';
