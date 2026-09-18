-- Disposable Auth-shape extension only. NEVER apply this fixture to Supabase.
create type auth.aal_level as enum ('aal1','aal2');
create type auth.factor_status as enum ('unverified','verified');
create type auth.factor_type as enum ('totp','phone','webauthn');
alter table auth.sessions add column aal auth.aal_level default 'aal1';
alter table auth.sessions add column factor_id uuid;
create table auth.mfa_factors (
  id uuid primary key, user_id uuid not null references auth.users(id),
  status auth.factor_status not null, factor_type auth.factor_type not null
);
alter table auth.mfa_factors enable row level security;
-- Deliberately no seeds, recovery codes, Auth writes or grants for app roles.
