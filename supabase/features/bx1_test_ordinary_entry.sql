-- Temporary TEST-only, read-only entry continuation for enrolled native AAL1
-- password sessions. This is not MFA completion or recovery. No Auth factors,
-- shared predicates, existing readers/writers, RLS or table grants change.
-- Install atomically; admission is a separate bounded release configuration.
alter table bx1_portal.entry_configuration
  add column test_ordinary_entry_enabled boolean not null default false;
alter table bx1_portal.entry_configuration add constraint bx1_test_ordinary_entry_test_only
  check(not test_ordinary_entry_enabled or environment='TESTNET');

create function bx1_portal.test_ordinary_entry_session() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare claims jsonb:=auth.jwt(); actor uuid:=auth.uid(); methods jsonb;
begin
  if actor is null or bx1_private.has_active_session() is not true
    or claims->>'sub' is distinct from actor::text
    or claims->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or claims->>'role' is distinct from 'authenticated' or claims->>'aal' is distinct from 'aal1'
    or pg_catalog.jsonb_typeof(claims->'exp') is distinct from 'number'
    or claims->>'exp' !~ '^[1-9][0-9]{0,11}$'
    or (claims->>'exp')::numeric<=extract(epoch from pg_catalog.clock_timestamp())
    or claims->>'is_anonymous'='true'
    or not exists(select 1 from bx1_portal.entry_configuration c
      where c.singleton and c.environment='TESTNET' and c.test_ordinary_entry_enabled) then
    return false;
  end if;
  -- Only an ordinary password sign-in is admitted here. Recovery, OAuth,
  -- missing/malformed/unknown AMR methods cannot acquire this continuation.
  methods:=claims->'amr';
  if pg_catalog.jsonb_typeof(methods) is distinct from 'array'
    or pg_catalog.jsonb_array_length(methods) not between 1 and 32
    or exists(select 1 from pg_catalog.jsonb_array_elements(methods) method
      where case pg_catalog.jsonb_typeof(method)
        when 'string' then method#>>'{}' is distinct from 'password'
        when 'object' then pg_catalog.jsonb_typeof(method->'method') is distinct from 'string'
          or method->>'method' is distinct from 'password'
        else true end) then return false; end if;
  return exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    join public.bx1_profiles p on p.id=u.id
    where u.id=actor and u.email is not null and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
      and p.status='ACTIVE' and s.id::text=claims->>'session_id'
      and s.oauth_client_id is null and s.aal::text='aal1'
      and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp()))
    and exists(select 1 from auth.mfa_factors f where f.user_id=actor and f.status::text='verified');
exception when others then return false;
end $$;

-- A private canonical projection, not a second identity/application store.
-- Roles here are labels only. No scope, mandate, provider, document, account,
-- product, order, wallet, financial record or command capability is returned.
create function bx1_portal.test_ordinary_entry_projection() returns jsonb
language sql volatile security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('version',1,'entry',
    pg_catalog.jsonb_build_object('entry_version',1,
      'actor',pg_catalog.jsonb_build_object('id',u.id,'email',u.email),
      'applications',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',a.id,'user_id',a.user_id,'persona',a.persona,'status',a.status,'revision',a.revision,
        'details','{}'::jsonb,'submitted_at',a.submitted_at,'reviewed_at',a.reviewed_at,
        'reviewer_id',null,'review_notes',null,'review_checks','{}'::jsonb,
        'organisation_id',a.organisation_id,'provider_mode',a.provider_mode,'approved_until',a.approved_until,
        'context_kind',a.context_kind,'context_organisation_id',a.context_organisation_id,
        'origin',a.origin,'created_at',a.created_at,'admission_purpose',a.admission_purpose,
        'review_route','NOT_ADMITTED','can_request_mandate',false,'handoff',null)
        order by a.created_at nulls first,a.id) from bx1_portal.applications a
        where a.user_id=u.id),'[]'::jsonb),
      'contexts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'context_key',o.id,'organisation_id',o.id,'name',o.name,'roles',o.roles) order by o.name,o.id)
        from (select org.id,org.name,pg_catalog.jsonb_agg(m.role order by m.role) roles
          from public.bx1_memberships m join public.bx1_organisations org on org.id=m.organisation_id
          where m.user_id=u.id and bx1_portal.native_membership_effective(m.id)
          group by org.id,org.name) o),'[]'::jsonb),
      'admission',pg_catalog.jsonb_build_object('manual_test_review',false),
      'workflow',pg_catalog.jsonb_build_object('version',1,'environment','TESTNET',
        'actor_id',u.id,'scoped_read_available',false),
      'organisation_mandates','[]'::jsonb,'requests','[]'::jsonb),
    'workspace',case when exists(select 1 from public.bx1_memberships m
      where m.user_id=u.id and bx1_portal.native_membership_effective(m.id)) then
      pg_catalog.jsonb_build_object('user',pg_catalog.jsonb_build_object('id',u.id,'email',u.email,
        'platformUserId',p.platform_user_id,'displayName',p.display_name),
        'organisations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',o.id,'name',o.name,'roles',o.roles) order by o.name,o.id)
          from (select org.id,org.name,pg_catalog.jsonb_agg(m.role order by m.role) roles
            from public.bx1_memberships m join public.bx1_organisations org on org.id=m.organisation_id
            where m.user_id=u.id and bx1_portal.native_membership_effective(m.id)
            group by org.id,org.name) o),'[]'::jsonb)) else null end)
  from auth.users u join public.bx1_profiles p on p.id=u.id where u.id=auth.uid();
$$;

create function bx1_portal.test_ordinary_entry_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; current_result jsonb;
begin
  if bx1_portal.test_ordinary_entry_session() is not true then
    raise exception 'test_ordinary_entry_denied' using errcode='42501'; end if;
  -- Recheck after any wait; use the existing native rows, not MFA spoofing.
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  perform id from auth.users where id=actor for share;
  perform id from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=actor for share;
  if bx1_portal.test_ordinary_entry_session() is not true then
    raise exception 'test_ordinary_entry_changed_after_wait' using errcode='42501'; end if;
  result:=bx1_portal.test_ordinary_entry_projection();
  current_result:=bx1_portal.test_ordinary_entry_projection();
  if result is null or result is distinct from current_result
    or bx1_portal.test_ordinary_entry_session() is not true then
    raise exception 'test_ordinary_entry_changed' using errcode='42501'; end if;
  return result;
end $$;

create function public.bx1_test_ordinary_entry_read() returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.test_ordinary_entry_read(); $$;
revoke all on function bx1_portal.test_ordinary_entry_session(),
  bx1_portal.test_ordinary_entry_projection(),bx1_portal.test_ordinary_entry_read(),
  public.bx1_test_ordinary_entry_read() from public,anon,authenticated,service_role;
grant execute on function bx1_portal.test_ordinary_entry_read(),public.bx1_test_ordinary_entry_read() to authenticated;
