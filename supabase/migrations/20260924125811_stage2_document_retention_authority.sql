-- Stage 2 document governance. This records a retention date, legal hold and
-- independently approved disposal AUTHORISATION for scanned, application-bound
-- evidence. It never deletes Storage bytes or records a disposed outcome.
-- The existing Storage DELETE trigger remains closed. A later reviewed Storage
-- API worker must obtain deletion evidence and reconcile it before any
-- disposition-complete state is introduced.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_private.document_quarantine_items') is null
    or pg_catalog.to_regclass('bx1_private.document_upload_receipts') is null
    or pg_catalog.to_regclass('bx1_private.document_application_bindings') is null
    or pg_catalog.to_regprocedure('bx1_private.document_disposal_eligible(uuid)') is null
    or pg_catalog.to_regprocedure('bx1_private.has_recent_administration_totp()') is null
    or pg_catalog.to_regprocedure('bx1_portal.representative_mandate_actor(jsonb,uuid,text)') is null then
    raise exception 'document_governance_baseline_required' using errcode='55000';
  end if;
end $$;

-- No retention law, product rule or disposal controller has been admitted.
-- A future separately reviewed migration must define versioned minimums,
-- accountable approval and the verified Storage API deletion worker. This
-- sentinel is deliberately immutable and cannot be enabled by an app role.
create table bx1_private.document_retention_admission (
  singleton boolean primary key check(singleton),
  policy_version integer not null check(policy_version=0),
  state text not null check(state='NOT_ADMITTED')
);
insert into bx1_private.document_retention_admission(singleton,policy_version,state)
  values(true,0,'NOT_ADMITTED');
alter table bx1_private.document_retention_admission enable row level security;
revoke all on bx1_private.document_retention_admission from public,anon,authenticated,service_role;
create trigger bx1_document_retention_admission_immutable before update or delete
  on bx1_private.document_retention_admission for each row execute function bx1_portal.immutable_record();

-- person_principals belongs to the isolated NOLOGIN authority owner. The
-- hosted migration role intentionally has SELECT, not REFERENCES or row-lock
-- rights. Borrow inheritance only for this migration's FK/helper DDL; snapshot
-- every grantor-specific edge and the schema ACL so nothing remains widened.
create temporary table bx1_document_governance_original_edges on commit drop as
  select m.grantor,m.admin_option,m.inherit_option,m.set_option
  from pg_catalog.pg_auth_members m
  where m.roleid='bx1_authority_owner'::regrole and m.member=current_user::regrole;
create temporary table bx1_document_governance_original_schema on commit drop as
  select not pg_catalog.has_schema_privilege('bx1_authority_owner','bx1_private','CREATE') added_create,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a)
      order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb)
      from pg_catalog.aclexplode(n.nspacl) a) original_acl
  from pg_catalog.pg_namespace n where n.nspname='bx1_private';
grant bx1_authority_owner to current_user with inherit true,set true granted by current_user;
do $$ begin
  if (select added_create from pg_temp.bx1_document_governance_original_schema) then
    grant create on schema bx1_private to bx1_authority_owner;
  end if;
end $$;

create table bx1_private.document_governance_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references bx1_private.document_quarantine_items(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  reviewer_scope uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_person_id uuid not null,
  actor_membership_id uuid not null references public.bx1_memberships(id) on delete restrict,
  application_revision integer not null check(application_revision>0),
  request_key uuid not null,
  action text not null check(action in (
    'RETENTION_REQUESTED','RETENTION_APPROVED','RETENTION_REJECTED',
    'HOLD_PLACED','HOLD_RELEASE_REQUESTED','HOLD_RELEASED','HOLD_RELEASE_REJECTED',
    'DISPOSAL_REQUESTED','DISPOSAL_APPROVED','DISPOSAL_REJECTED')),
  related_event_id bigint references bx1_private.document_governance_events(id) on delete restrict,
  reason text not null check(pg_catalog.length(reason) between 8 and 1000),
  retention_until timestamptz,
  storage_path text not null,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  review_expires_at timestamptz,
  foreign key(actor_id,actor_person_id)
    references bx1_private.person_principals(auth_user_id,person_id) on delete restrict,
  unique(actor_id,request_key),
  check((action in ('RETENTION_REQUESTED','HOLD_RELEASE_REQUESTED','DISPOSAL_REQUESTED'))
    =(review_expires_at is not null)),
  check(review_expires_at is null or review_expires_at=created_at+interval '24 hours'),
  check((action='RETENTION_REQUESTED')=(retention_until is not null)),
  check((action in ('RETENTION_APPROVED','RETENTION_REJECTED','HOLD_RELEASE_REQUESTED',
    'HOLD_RELEASED','HOLD_RELEASE_REJECTED','DISPOSAL_APPROVED','DISPOSAL_REJECTED'))
    =(related_event_id is not null))
);
create index bx1_document_governance_history on bx1_private.document_governance_events(document_id,id desc);
create unique index bx1_document_governance_one_decision on bx1_private.document_governance_events(related_event_id)
  where action in ('RETENTION_APPROVED','RETENTION_REJECTED','HOLD_RELEASED',
    'HOLD_RELEASE_REJECTED','DISPOSAL_APPROVED','DISPOSAL_REJECTED');
alter table bx1_private.document_governance_events enable row level security;
revoke all on bx1_private.document_governance_events from public,anon,authenticated,service_role;
revoke all on sequence bx1_private.document_governance_events_id_seq from public,anon,authenticated,service_role;
create trigger bx1_document_governance_event_immutable before update or delete
  on bx1_private.document_governance_events for each row execute function bx1_portal.immutable_record();

-- Only the trusted Postgres command owner may invoke this narrow authority-
-- owner helper. Its FOR SHARE locks conflict with concurrent trust revocation;
-- the migrator never receives UPDATE or direct row-lock rights on identity.
create function bx1_private.document_governance_trusted_person(
  p_actor uuid,p_expected_person uuid default null
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare linked_person uuid;
begin
  select pp.person_id into linked_person from bx1_private.person_principals pp
    join bx1_private.persons person on person.id=pp.person_id
    where pp.auth_user_id=p_actor and pp.status='TRUSTED' and person.status='TRUSTED'
      and (p_expected_person is null or pp.person_id=p_expected_person)
    for share of pp,person;
  return linked_person;
end $$;
revoke all on function bx1_private.document_governance_trusted_person(uuid,uuid)
  from public,anon,authenticated,service_role,bx1_wallet_owner,bx1_wallet_verifier;
alter function bx1_private.document_governance_trusted_person(uuid,uuid) owner to bx1_authority_owner;
grant execute on function bx1_private.document_governance_trusted_person(uuid,uuid) to current_user;

do $restore_document_governance_owner$
declare edge record; actual jsonb; expected jsonb;
begin
  if (select added_create from pg_temp.bx1_document_governance_original_schema) then
    revoke create on schema bx1_private from bx1_authority_owner;
  end if;
  select original_acl into expected from pg_temp.bx1_document_governance_original_schema;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a)
    order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) into actual
    from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(n.nspacl) a
    where n.nspname='bx1_private';
  if actual is distinct from expected then raise exception 'document_governance_schema_acl_not_restored'; end if;
  select * into edge from pg_temp.bx1_document_governance_original_edges
    where grantor=current_user::regrole;
  if found then
    execute pg_catalog.format('grant bx1_authority_owner to %I with admin %s, inherit %s, set %s granted by %I',
      current_user,case when edge.admin_option then 'true' else 'false' end,
      case when edge.inherit_option then 'true' else 'false' end,
      case when edge.set_option then 'true' else 'false' end,current_user);
  else
    execute pg_catalog.format('revoke bx1_authority_owner from %I granted by %I',current_user,current_user);
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into expected
    from pg_temp.bx1_document_governance_original_edges e;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into actual
    from (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
      where roleid='bx1_authority_owner'::regrole and member=current_user::regrole) e;
  if actual is distinct from expected then raise exception 'document_governance_owner_edges_not_restored'; end if;
end $restore_document_governance_owner$;

-- This is an internal eligibility predicate, not a deletion endpoint. An
-- approval is invalidated by any later governance event, hold, expiry change,
-- missing clean scan/receipt, or disappearance of the exact Storage object.
create function bx1_private.document_disposal_authorised(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.document_quarantine_items q
    join bx1_private.document_upload_receipts r on r.id=q.id
    join bx1_private.document_governance_events approval on approval.document_id=q.id
      and approval.action='DISPOSAL_APPROVED'
    join bx1_private.document_governance_events request on request.id=approval.related_event_id
      and request.action='DISPOSAL_REQUESTED' and request.document_id=q.id
      and request.actor_person_id<>approval.actor_person_id
    join bx1_private.person_principals requester on requester.auth_user_id=request.actor_id
      and requester.person_id=request.actor_person_id and requester.status='TRUSTED'
    join bx1_private.persons requester_person on requester_person.id=requester.person_id
      and requester_person.status='TRUSTED'
    join bx1_private.person_principals approver on approver.auth_user_id=approval.actor_id
      and approver.person_id=approval.actor_person_id and approver.status='TRUSTED'
    join bx1_private.persons approver_person on approver_person.id=approver.person_id
      and approver_person.status='TRUSTED'
    join public.bx1_memberships requester_membership on requester_membership.id=request.actor_membership_id
      and requester_membership.user_id=request.actor_id
      and requester_membership.organisation_id=request.reviewer_scope
      and requester_membership.role='ComplianceOfficer' and requester_membership.status='ACTIVE'
    join public.bx1_memberships approver_membership on approver_membership.id=approval.actor_membership_id
      and approver_membership.user_id=approval.actor_id
      and approver_membership.organisation_id=approval.reviewer_scope
      and approver_membership.role='SuperAdmin' and approver_membership.status='ACTIVE'
    join public.bx1_profiles requester_profile on requester_profile.id=request.actor_id
      and requester_profile.status='ACTIVE'
    join public.bx1_profiles approver_profile on approver_profile.id=approval.actor_id
      and approver_profile.status='ACTIVE'
    join public.bx1_organisations reviewer_org on reviewer_org.id=request.reviewer_scope
      and reviewer_org.status='ACTIVE'
    join auth.users requester_user on requester_user.id=request.actor_id
      and requester_user.deleted_at is null
    join auth.users approver_user on approver_user.id=approval.actor_id
      and approver_user.deleted_at is null
    join bx1_portal.applications application on application.id=request.application_id
      and application.id=approval.application_id and application.revision=request.application_revision
      and application.revision=approval.application_revision
      and application.reviewer_scope=request.reviewer_scope
      and application.reviewer_scope=approval.reviewer_scope
    where q.id=p_id and q.state='PROMOTED' and r.validation_state='SCANNED_CLEAN'
      and exists(select 1 from bx1_private.document_retention_admission policy
        where policy.singleton and policy.state='ADMITTED' and policy.policy_version>0)
      and request.review_expires_at>approval.created_at
      and approval.created_at>pg_catalog.clock_timestamp()-interval '24 hours'
      and (requester_user.banned_until is null or requester_user.banned_until<=pg_catalog.clock_timestamp())
      and (approver_user.banned_until is null or approver_user.banned_until<=pg_catalog.clock_timestamp())
      and r.storage_path=q.storage_path and r.sha256=q.sha256
      and approval.storage_path=q.storage_path and approval.sha256=q.sha256
      and request.storage_path=q.storage_path and request.sha256=q.sha256
      and approval.id=(select max(last_event.id) from bx1_private.document_governance_events last_event
        where last_event.document_id=q.id)
      and exists(select 1 from bx1_private.document_scan_events scan
        where scan.document_id=q.id and scan.verdict='CLEAN' and scan.sha256=q.sha256)
      and exists(select 1 from bx1_private.document_governance_events retention
        where retention.document_id=q.id and retention.action='RETENTION_APPROVED'
          and retention.related_event_id in (select retention_request.id
            from bx1_private.document_governance_events retention_request
            where retention_request.document_id=q.id and retention_request.action='RETENTION_REQUESTED'
              and retention_request.retention_until=q.retention_until))
      and bx1_private.document_disposal_eligible(q.id)
      and exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
        and o.name=q.storage_path and o.owner_id=q.actor_id::text
        and o.metadata->>'size'=q.byte_size::text and o.metadata->>'mimetype'=q.mime_type));
$$;
revoke all on function bx1_private.document_disposal_authorised(uuid) from public,anon,authenticated,service_role;

create function public.bx1_document_governance_command(
  p_document uuid,p_context jsonb,p_request_key uuid,p_action text,p_reason text,
  p_retention_until timestamptz default null,p_related_event_id bigint default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  q bx1_private.document_quarantine_items;
  r bx1_private.document_upload_receipts;
  a bx1_portal.applications;
  prior bx1_private.document_governance_events;
  request_event bx1_private.document_governance_events;
  event_id bigint;
  actor uuid:=auth.uid();
  actor_person uuid;
  actor_membership uuid;
  role_name text;
  hold_active boolean;
  bound_application uuid;
  latest_hold_event bigint;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_document is null or p_request_key is null or p_action is null
    or p_reason is null or pg_catalog.length(p_reason) not between 8 and 1000
    or p_action not in ('RETENTION_REQUESTED','RETENTION_APPROVED','RETENTION_REJECTED',
      'HOLD_PLACED','HOLD_RELEASE_REQUESTED','HOLD_RELEASED','HOLD_RELEASE_REJECTED',
      'DISPOSAL_REQUESTED','DISPOSAL_APPROVED','DISPOSAL_REJECTED')
    or bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true
    or bx1_private.has_recent_administration_totp() is not true then
    raise exception 'document_governance_denied' using errcode='42501';
  end if;
  role_name:=case when p_action in ('RETENTION_REQUESTED','HOLD_PLACED',
      'HOLD_RELEASE_REQUESTED','DISPOSAL_REQUESTED') then 'ComplianceOfficer' else 'SuperAdmin' end;
  select * into q from bx1_private.document_quarantine_items where id=p_document for update;
  if q.id is null then raise exception 'document_governance_not_found' using errcode='P0002'; end if;
  select * into r from bx1_private.document_upload_receipts where id=q.id;
  select b.application_id into bound_application from bx1_private.document_application_bindings b
    where b.receipt_id=q.id order by b.bound_at,b.application_id limit 1;
  select * into a from bx1_portal.applications where id=bound_application;
  if r.id is null or r.actor_id<>q.actor_id or r.sha256<>q.sha256
    or r.storage_path<>q.storage_path or q.state<>'PROMOTED'
    or r.validation_state<>'SCANNED_CLEAN'
    or a.id is null or a.status='DRAFT' or a.reviewer_scope is null
    or not exists(select 1 from bx1_private.document_application_bindings b
      where b.receipt_id=q.id and b.application_id=a.id)
    or exists(select 1 from bx1_private.document_application_bindings b
      where b.receipt_id=q.id and b.application_id<>a.id)
    or bx1_portal.representative_mandate_actor(p_context,a.reviewer_scope,role_name) is not true then
    raise exception 'document_governance_scope_denied' using errcode='42501';
  end if;
  -- A login is not a human. Every governance action requires a trusted
  -- principal-to-person mapping, and the exact active native membership is
  -- retained for independent review and later revalidation.
  actor_person:=bx1_private.document_governance_trusted_person(actor,null);
  select m.id into actor_membership from public.bx1_memberships m
    where m.user_id=actor and m.organisation_id=a.reviewer_scope
      and m.role=role_name and m.status='ACTIVE' for share;
  if actor_person is null or actor_membership is null then
    raise exception 'document_governance_trusted_person_required' using errcode='42501';
  end if;
  if p_action in ('DISPOSAL_REQUESTED','DISPOSAL_APPROVED') and not exists(
    select 1 from bx1_private.document_retention_admission policy
    where policy.singleton and policy.state='ADMITTED' and policy.policy_version>0) then
    raise exception 'document_retention_policy_unconfigured' using errcode='55000';
  end if;
  -- Idempotent replay returns the same immutable event only after present
  -- authority and document scope have been revalidated.
  select * into prior from bx1_private.document_governance_events
    where actor_id=actor and request_key=p_request_key;
  if prior.id is not null then
    if prior.document_id<>q.id or prior.application_id<>a.id or prior.action<>p_action
      or prior.actor_person_id<>actor_person or prior.actor_membership_id<>actor_membership
      or prior.application_revision<>a.revision or prior.reviewer_scope<>a.reviewer_scope
      or prior.reason<>p_reason or prior.retention_until is distinct from p_retention_until
      or prior.related_event_id is distinct from p_related_event_id then
      raise exception 'document_governance_request_conflict' using errcode='23505';
    end if;
    return pg_catalog.jsonb_build_object('event_id',prior.id,'document_id',q.id,'action',prior.action,
      'retention_until',q.retention_until,'disposal_authorised',bx1_private.document_disposal_authorised(q.id));
  end if;
  select h.action='PLACE' into hold_active from bx1_private.document_hold_events h
    where h.document_id=q.id order by h.id desc limit 1;
  hold_active:=coalesce(hold_active,false);
  if p_action='RETENTION_REQUESTED' then
    if p_retention_until is null or p_retention_until<=v_now
      or (q.retention_until is not null and p_retention_until<q.retention_until)
      or p_related_event_id is not null then
      raise exception 'document_retention_invalid' using errcode='22023'; end if;
  elsif p_action='HOLD_PLACED' then
    if p_retention_until is not null or p_related_event_id is not null or hold_active then
      raise exception 'document_hold_invalid' using errcode='23514'; end if;
  else
    if p_retention_until is not null then raise exception 'document_governance_extra_retention' using errcode='22023'; end if;
    if p_action='DISPOSAL_REQUESTED' then
      if p_related_event_id is not null or hold_active
        or q.retention_until is null or q.retention_until>v_now
        or bx1_private.document_disposal_eligible(q.id) is not true
        or not exists(select 1 from bx1_private.document_governance_events approved
          join bx1_private.document_governance_events requested on requested.id=approved.related_event_id
          where approved.document_id=q.id and approved.action='RETENTION_APPROVED'
            and requested.action='RETENTION_REQUESTED'
            and requested.retention_until=q.retention_until)
        or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
          and o.name=q.storage_path and o.owner_id=q.actor_id::text) then
        raise exception 'document_disposal_not_eligible' using errcode='23514'; end if;
    elsif p_action='HOLD_RELEASE_REQUESTED' then
      if not hold_active or p_related_event_id is null then
        raise exception 'document_hold_release_invalid' using errcode='23514'; end if;
      select h.id into latest_hold_event from bx1_private.document_governance_events h
        where h.document_id=q.id and h.action='HOLD_PLACED' order by h.id desc limit 1;
      if p_related_event_id is distinct from latest_hold_event then
        raise exception 'document_hold_release_stale' using errcode='23514'; end if;
    else
      select * into request_event from bx1_private.document_governance_events
        where id=p_related_event_id and document_id=q.id;
      if request_event.id is null or request_event.actor_person_id=actor_person
        or request_event.application_id<>a.id or request_event.reviewer_scope<>a.reviewer_scope
        or request_event.application_revision<>a.revision
        or request_event.review_expires_at<=v_now
        or (p_action in ('RETENTION_APPROVED','RETENTION_REJECTED')
          and request_event.action<>'RETENTION_REQUESTED')
        or (p_action in ('HOLD_RELEASED','HOLD_RELEASE_REJECTED')
          and request_event.action<>'HOLD_RELEASE_REQUESTED')
        or (p_action in ('DISPOSAL_APPROVED','DISPOSAL_REJECTED')
          and request_event.action<>'DISPOSAL_REQUESTED')
        or exists(select 1 from bx1_private.document_governance_events decision
          where decision.related_event_id=request_event.id and decision.action in
            ('RETENTION_APPROVED','RETENTION_REJECTED','HOLD_RELEASED',
             'HOLD_RELEASE_REJECTED','DISPOSAL_APPROVED','DISPOSAL_REJECTED')) then
        raise exception 'document_governance_independent_approval_denied' using errcode='42501'; end if;
      -- Revalidate the requester's original Compliance authority, identity,
      -- active account and scope after locking the mutable rows. A revoked
      -- mapping or membership cannot be rescued by a different Auth login.
      if bx1_private.document_governance_trusted_person(
        request_event.actor_id,request_event.actor_person_id) is distinct from
          request_event.actor_person_id then
        raise exception 'document_governance_requester_authority_lost' using errcode='42501'; end if;
      perform m.id from public.bx1_memberships m
        join public.bx1_profiles profile on profile.id=m.user_id
        join public.bx1_organisations org on org.id=m.organisation_id
        join auth.users user_row on user_row.id=m.user_id
        where m.id=request_event.actor_membership_id
          and m.user_id=request_event.actor_id
          and m.organisation_id=a.reviewer_scope and m.role='ComplianceOfficer'
          and m.status='ACTIVE' and profile.status='ACTIVE' and org.status='ACTIVE'
          and user_row.deleted_at is null
          and (user_row.banned_until is null or user_row.banned_until<=v_now)
        for share of m,profile,org,user_row;
      if not found then
        raise exception 'document_governance_requester_authority_lost' using errcode='42501'; end if;
      if p_action='RETENTION_APPROVED' and (request_event.retention_until<=v_now
        or (q.retention_until is not null and request_event.retention_until<q.retention_until)) then
        raise exception 'document_retention_stale' using errcode='23514'; end if;
      if p_action in ('HOLD_RELEASED','HOLD_RELEASE_REJECTED') and not hold_active then
        raise exception 'document_hold_release_stale' using errcode='23514'; end if;
      if p_action='HOLD_RELEASED' then
        select h.id into latest_hold_event from bx1_private.document_governance_events h
          where h.document_id=q.id and h.action='HOLD_PLACED' order by h.id desc limit 1;
        if request_event.related_event_id is distinct from latest_hold_event then
          raise exception 'document_hold_release_stale' using errcode='23514'; end if;
      end if;
      if p_action='DISPOSAL_APPROVED' and (hold_active
        or bx1_private.document_disposal_eligible(q.id) is not true
        or request_event.id is distinct from (select max(last_event.id)
          from bx1_private.document_governance_events last_event where last_event.document_id=q.id)) then
        raise exception 'document_disposal_stale' using errcode='23514'; end if;
    end if;
  end if;
  -- The immutable audit insert precedes every mutable retention/hold change;
  -- any audit or post-insert failure rolls the whole transaction back.
  insert into bx1_private.document_governance_events(document_id,application_id,reviewer_scope,
    actor_id,actor_person_id,actor_membership_id,application_revision,request_key,action,
    related_event_id,reason,retention_until,storage_path,sha256,created_at,review_expires_at)
  values(q.id,a.id,a.reviewer_scope,actor,actor_person,actor_membership,a.revision,p_request_key,
    p_action,p_related_event_id,p_reason,p_retention_until,q.storage_path,q.sha256,v_now,
    case when p_action in ('RETENTION_REQUESTED','HOLD_RELEASE_REQUESTED','DISPOSAL_REQUESTED')
      then v_now+interval '24 hours' end) returning id into event_id;
  if p_action='RETENTION_APPROVED' then
    update bx1_private.document_quarantine_items set retention_until=request_event.retention_until
      where id=q.id;
  elsif p_action='HOLD_PLACED' then
    insert into bx1_private.document_hold_events(document_id,action,reason,actor_id)
      values(q.id,'PLACE',p_reason,actor);
  elsif p_action='HOLD_RELEASED' then
    insert into bx1_private.document_hold_events(document_id,action,reason,actor_id)
      values(q.id,'RELEASE',p_reason,actor);
  end if;
  if bx1_portal.representative_mandate_actor(p_context,a.reviewer_scope,role_name) is not true
    or bx1_private.has_recent_administration_totp() is not true then
    raise exception 'document_governance_authority_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('event_id',event_id,'document_id',q.id,'action',p_action,
    'retention_until',coalesce(request_event.retention_until,q.retention_until),
    'disposal_authorised',bx1_private.document_disposal_authorised(q.id));
end $$;

-- Staff-only projection for a future connected review queue. The document
-- contents remain in Storage; this exposes only governance evidence within
-- the application's existing reviewer scope.
create function public.bx1_document_governance_state(p_document uuid,p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q bx1_private.document_quarantine_items; a bx1_portal.applications;
  bound_application uuid; history jsonb; active_hold boolean; role_name text;
begin
  if p_document is null or bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true then
    raise exception 'document_governance_read_denied' using errcode='42501'; end if;
  select * into q from bx1_private.document_quarantine_items where id=p_document;
  select b.application_id into bound_application from bx1_private.document_application_bindings b
    where b.receipt_id=p_document order by b.bound_at,b.application_id limit 1;
  select * into a from bx1_portal.applications where id=bound_application;
  role_name:=p_context->>'role';
  if q.id is null or a.id is null or a.reviewer_scope is null
    or exists(select 1 from bx1_private.document_application_bindings b
      where b.receipt_id=q.id and b.application_id<>a.id)
    or role_name not in ('ComplianceOfficer','SuperAdmin')
    or bx1_portal.representative_mandate_actor(p_context,a.reviewer_scope,role_name) is not true then
    raise exception 'document_governance_read_denied' using errcode='42501'; end if;
  select h.action='PLACE' into active_hold from bx1_private.document_hold_events h
    where h.document_id=q.id order by h.id desc limit 1;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('event_id',e.id,
    'action',e.action,'actor_id',e.actor_id,'actor_person_id',e.actor_person_id,
    'related_event_id',e.related_event_id,'reason',e.reason,
    'retention_until',e.retention_until,'created_at',e.created_at,
    'review_expires_at',e.review_expires_at)
    order by e.id),'[]'::jsonb) into history
    from bx1_private.document_governance_events e where e.document_id=q.id;
  if bx1_portal.representative_mandate_actor(p_context,a.reviewer_scope,role_name) is not true then
    raise exception 'document_governance_read_denied' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('document_id',q.id,'application_id',a.id,
    'retention_until',q.retention_until,'legal_hold',coalesce(active_hold,false),
    'disposal_authorised',bx1_private.document_disposal_authorised(q.id),
    'disposal_completed',false,'events',history);
end $$;

revoke all on function public.bx1_document_governance_command(
  uuid,jsonb,uuid,text,text,timestamptz,bigint) from public,anon,authenticated,service_role;
revoke all on function public.bx1_document_governance_state(uuid,jsonb)
  from public,anon,authenticated,service_role;
do $$ begin
  if (select environment='TESTNET' and manual_test_review from bx1_portal.entry_configuration where singleton) then
    grant execute on function public.bx1_document_governance_command(
      uuid,jsonb,uuid,text,text,timestamptz,bigint) to authenticated;
    grant execute on function public.bx1_document_governance_state(uuid,jsonb) to authenticated;
  end if;
end $$;
