-- Ownership proof only: this migration confers no eligibility or financial rights.
-- Hosted credential/LOGIN provisioning is a separate, human-controlled gate.
create role bx1_wallet_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role bx1_wallet_verifier nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- Hosted postgres is CREATEROLE but not superuser. Ownership transfer requires
-- temporary SET membership and schema CREATE; remove both before completion.
grant bx1_wallet_owner to current_user with inherit false, set true;
grant create on schema public, bx1_private to bx1_wallet_owner;
grant usage on schema public, bx1_private to bx1_wallet_owner;
grant usage on schema bx1_private to bx1_wallet_verifier;
grant execute on function bx1_private.has_active_session(), bx1_private.can_access_organisation(uuid) to bx1_wallet_owner;
grant select (id, platform_user_id) on public.bx1_profiles to bx1_wallet_owner;
create policy bx1_wallet_owner_identity_map on public.bx1_profiles for select to bx1_wallet_owner using (true);

create table bx1_private.wallet_challenges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  nonce text not null unique check (nonce ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.bx1_profiles(id) on delete restrict,
  platform_user_id uuid not null,
  session_id uuid not null,
  organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  domain text not null check (domain = 'https://bx1.co.za'),
  chain_id integer not null check (chain_id = 80002),
  address text not null check (address ~ '^0x[0-9a-f]{40}$' and address <> '0x0000000000000000000000000000000000000000'),
  message text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at = issued_at + interval '5 minutes'),
  used_at timestamptz,
  proof_signature text,
  check ((used_at is null and proof_signature is null) or (used_at is not null and proof_signature ~ '^0x[0-9a-fA-F]{130}$'))
);
create index bx1_wallet_challenge_actor_time on bx1_private.wallet_challenges(user_id, issued_at);
create table public.bx1_wallets (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.bx1_profiles(id) on delete restrict,
  platform_user_id uuid not null,
  organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  address text not null check (address ~ '^0x[0-9a-f]{40}$' and address <> '0x0000000000000000000000000000000000000000'),
  chain_id integer not null check (chain_id = 80002),
  status text not null default 'PENDING' check (status = 'PENDING'),
  verified_at timestamptz not null,
  last_proof_id uuid not null references bx1_private.wallet_challenges(id) on delete restrict
);
create unique index bx1_wallet_unique_address_chain on public.bx1_wallets(lower(address), chain_id);
create index bx1_wallet_actor_organisation on public.bx1_wallets(user_id, organisation_id);
alter table bx1_private.wallet_challenges enable row level security;
alter table public.bx1_wallets enable row level security;
revoke all on bx1_private.wallet_challenges, public.bx1_wallets from public, anon, authenticated, service_role, bx1_wallet_verifier;
grant select (id, organisation_id, address, chain_id, verified_at, status) on public.bx1_wallets to authenticated;
create policy bx1_wallet_self_read on public.bx1_wallets for select to authenticated
using (user_id = (select auth.uid()) and (select bx1_private.has_active_session())
  and bx1_private.can_access_organisation(organisation_id));
comment on table public.bx1_wallets is 'EOA ownership proof only. PENDING means no compliance or financial approval.';
comment on table bx1_private.wallet_challenges is 'Private one-time ownership challenge and consumed proof evidence. Never expose through Data API.';
alter table bx1_private.wallet_challenges owner to bx1_wallet_owner;
alter table public.bx1_wallets owner to bx1_wallet_owner;

create function bx1_private.issue_wallet_challenge(
  p_user uuid, p_platform uuid, p_session uuid, p_org uuid,
  p_address text, p_chain integer, p_domain text, p_nonce text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c bx1_private.wallet_challenges%rowtype;
begin
  if p_user is null or p_platform is null or p_session is null or p_org is null
    or p_chain is distinct from 80002 or p_domain is distinct from 'https://bx1.co.za'
    or p_address is null or lower(p_address) !~ '^0x[0-9a-f]{40}$'
    or lower(p_address) = '0x0000000000000000000000000000000000000000'
    or p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_request' using errcode = 'BW002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1-wallet-issue:' || p_user::text, 0));
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated')::text, true);
  if not bx1_private.has_active_session() or not bx1_private.can_access_organisation(p_org)
    or not exists (select 1 from public.bx1_profiles p where p.id = p_user and p.platform_user_id = p_platform) then
    raise exception 'unauthorised' using errcode = 'BW001';
  end if;
  if (select count(*) from bx1_private.wallet_challenges where user_id = p_user and issued_at > pg_catalog.clock_timestamp() - interval '10 minutes') >= 10 then
    raise exception 'rate_limited' using errcode = 'BW005';
  end if;
  c.id := pg_catalog.gen_random_uuid();
  c.issued_at := pg_catalog.clock_timestamp();
  c.expires_at := c.issued_at + interval '5 minutes';
  c.address := lower(p_address);
  c.message := 'Link this wallet to BlockXOne. This is not a transaction or financial approval.' || E'\n'
    || 'Domain: ' || p_domain || E'\nAddress: ' || c.address || E'\nChain ID: 80002'
    || E'\nChallenge: ' || c.id::text || E'\nNonce: ' || p_nonce
    || E'\nActor: ' || p_platform::text || E'\nOrganisation: ' || p_org::text
    || E'\nSession binding: ' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_session::text || ':' || p_nonce, 'UTF8')), 'hex')
    || E'\nIssued at: ' || pg_catalog.to_char(c.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    || E'\nExpires at: ' || pg_catalog.to_char(c.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into bx1_private.wallet_challenges(id,nonce,user_id,platform_user_id,session_id,organisation_id,domain,chain_id,address,message,issued_at,expires_at)
  values(c.id,p_nonce,p_user,p_platform,p_session,p_org,p_domain,p_chain,c.address,c.message,c.issued_at,c.expires_at);
  return pg_catalog.jsonb_build_object('challengeId',c.id,'address',c.address,'chainId',p_chain,'domain',p_domain,'message',c.message,'issuedAt',c.issued_at,'expiresAt',c.expires_at);
exception when unique_violation then
  raise exception 'conflict' using errcode = 'BW004';
end;
$$;

create function bx1_private.read_wallet_challenge(p_user uuid, p_platform uuid, p_session uuid, p_org uuid, p_challenge uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare c bx1_private.wallet_challenges%rowtype;
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated')::text, true);
  if p_user is null or p_platform is null or p_session is null or p_org is null
    or not bx1_private.has_active_session() or not bx1_private.can_access_organisation(p_org)
    or not exists (select 1 from public.bx1_profiles p where p.id = p_user and p.platform_user_id = p_platform) then
    raise exception 'unauthorised' using errcode = 'BW001';
  end if;
  select * into c from bx1_private.wallet_challenges where id = p_challenge
    and user_id = p_user and platform_user_id = p_platform and session_id = p_session and organisation_id = p_org;
  if not found or c.used_at is not null then raise exception 'conflict' using errcode = 'BW004'; end if;
  if c.expires_at <= pg_catalog.clock_timestamp() then raise exception 'expired' using errcode = 'BW003'; end if;
  return pg_catalog.jsonb_build_object('challengeId',c.id,'address',c.address,'chainId',c.chain_id,'domain',c.domain,'message',c.message,'issuedAt',c.issued_at,'expiresAt',c.expires_at);
end;
$$;

create function bx1_private.consume_wallet_challenge(
  p_user uuid, p_platform uuid, p_session uuid, p_org uuid, p_challenge uuid, p_message text, p_signature text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c bx1_private.wallet_challenges%rowtype;
  w public.bx1_wallets%rowtype;
  checked_at timestamptz;
begin
  select * into c from bx1_private.wallet_challenges where id = p_challenge for update;
  if not found then raise exception 'conflict' using errcode = 'BW004'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1-wallet-address:' || c.address || ':' || c.chain_id::text, 0));
  -- Volatile PL/pgSQL starts a fresh statement snapshot here, AFTER both locks.
  -- Revocation committed later than this guard's snapshot is not cancellable.
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated')::text, true);
  if p_user is null or p_platform is null or p_session is null or p_org is null
    or not bx1_private.has_active_session() or not bx1_private.can_access_organisation(p_org)
    or not exists (select 1 from public.bx1_profiles p where p.id = p_user and p.platform_user_id = p_platform) then
    raise exception 'unauthorised' using errcode = 'BW001';
  end if;
  if c.user_id is distinct from p_user or c.platform_user_id is distinct from p_platform
    or c.session_id is distinct from p_session or c.organisation_id is distinct from p_org
    or c.domain <> 'https://bx1.co.za' or c.chain_id <> 80002
    or c.message is distinct from p_message or c.used_at is not null then
    raise exception 'conflict' using errcode = 'BW004';
  end if;
  checked_at := pg_catalog.clock_timestamp();
  if c.expires_at <= checked_at then raise exception 'expired' using errcode = 'BW003'; end if;
  if p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then raise exception 'invalid_request' using errcode = 'BW002'; end if;
  select * into w from public.bx1_wallets where lower(address) = c.address and chain_id = c.chain_id for update;
  if found then
    if w.user_id <> p_user or w.platform_user_id <> p_platform or w.organisation_id <> p_org then
      raise exception 'conflict' using errcode = 'BW004';
    end if;
    update public.bx1_wallets set verified_at = checked_at, last_proof_id = c.id where id = w.id returning * into w;
  else
    insert into public.bx1_wallets(user_id,platform_user_id,organisation_id,address,chain_id,verified_at,last_proof_id)
    values(p_user,p_platform,p_org,c.address,c.chain_id,checked_at,c.id) returning * into w;
  end if;
  update bx1_private.wallet_challenges set used_at = checked_at, proof_signature = p_signature where id = c.id;
  return pg_catalog.jsonb_build_object('id',w.id,'organisationId',w.organisation_id,'address',w.address,'chainId',w.chain_id,'verifiedAt',w.verified_at,'status',w.status);
exception when unique_violation then
  raise exception 'conflict' using errcode = 'BW004';
end;
$$;

revoke all on function bx1_private.issue_wallet_challenge(uuid,uuid,uuid,uuid,text,integer,text,text),
  bx1_private.read_wallet_challenge(uuid,uuid,uuid,uuid,uuid),
  bx1_private.consume_wallet_challenge(uuid,uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function bx1_private.issue_wallet_challenge(uuid,uuid,uuid,uuid,text,integer,text,text),
  bx1_private.read_wallet_challenge(uuid,uuid,uuid,uuid,uuid),
  bx1_private.consume_wallet_challenge(uuid,uuid,uuid,uuid,uuid,text,text) to bx1_wallet_verifier;
alter function bx1_private.issue_wallet_challenge(uuid,uuid,uuid,uuid,text,integer,text,text) owner to bx1_wallet_owner;
alter function bx1_private.read_wallet_challenge(uuid,uuid,uuid,uuid,uuid) owner to bx1_wallet_owner;
alter function bx1_private.consume_wallet_challenge(uuid,uuid,uuid,uuid,uuid,text,text) owner to bx1_wallet_owner;
revoke create on schema public, bx1_private from bx1_wallet_owner;
grant bx1_wallet_owner to current_user with inherit false, set false;
