-- Disposable PGlite fixture only. Never execute against the hosted project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
create table auth.sessions (
  id uuid primary key, user_id uuid not null references auth.users(id),
  not_after timestamptz, oauth_client_id uuid
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub','')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.jwt(), auth.uid() to authenticated;
-- Match Supabase's permissive new-public-table defaults to prove our migration
-- explicitly removes them without changing unrelated objects/default settings.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
