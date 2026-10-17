-- Connected fund ownership proof scope. Install AFTER connected_fund_lifecycle.
-- Same wallet challenge/read/consume writer and immutable message bytes.
-- No person, membership, signer, settlement or token authority is created.
begin;

do $wallet_scope_preflight$
begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_portal.fund_release_manifests') is null
    or pg_catalog.to_regprocedure('bx1_portal.fund_manifest_current(uuid)') is null
    or not pg_catalog.pg_has_role(current_user,'bx1_wallet_owner','MEMBER') then
    raise exception 'fund_wallet_scope_dependency_required' using errcode='42501';
  end if;
end
$wallet_scope_preflight$;

-- This is ownership-only scope for an individual customer, not issuer staff
-- membership. Repeat it inside the SAME private writer after its locks.
create function bx1_private.fund_wallet_actor_current(p_user uuid,p_session uuid,p_org uuid) returns boolean
language sql volatile security definer set search_path='' as $wallet_scope$
  select p_user is not null and p_session is not null and p_org is not null
    and auth.uid()=p_user and auth.jwt()->>'session_id'=p_session::text
    and bx1_private.has_active_session() and bx1_private.has_session_mfa()
    and exists(select 1 from auth.users u join public.bx1_profiles profile on profile.id=u.id
      where u.id=p_user and profile.status='ACTIVE' and u.email_confirmed_at is not null
        and u.deleted_at is null and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    and exists(select 1 from bx1_portal.entry_configuration cfg
      join public.bx1_organisations native_org on native_org.id=p_org and native_org.status='ACTIVE'
      where cfg.singleton and cfg.environment='TESTNET')
    and exists(select 1 from bx1_portal.investment_accounts account
      join bx1_portal.applications application on application.id=account.application_id
        and application.user_id=p_user and application.persona='INVESTOR'
        and application.status='APPROVED' and application.approved_until>pg_catalog.clock_timestamp()
        and application.details->>'investor_type'='INDIVIDUAL'
      join bx1_portal.product_eligibility_cases eligibility on eligibility.investment_account_id=account.id
        and eligibility.holder_user_id=p_user
      join bx1_portal.fund_release_manifests manifest on manifest.product_id=eligibility.product_id
        and manifest.offering_revision_id=eligibility.offering_revision_id
        and manifest.native_organisation_id=p_org and manifest.environment='TESTNET'
      where account.holder_user_id=p_user and account.kind='INDIVIDUAL' and account.status='ACTIVE'
        and bx1_portal.monitoring_new_action_allowed(application.id)
        and bx1_portal.product_eligibility_current(eligibility.id)
        and bx1_portal.fund_manifest_current(manifest.id));
$wallet_scope$;
revoke all on function bx1_private.fund_wallet_actor_current(uuid,uuid,uuid) from public,anon,authenticated,service_role;
-- Necessary internal invocation by the existing owner-owned proof writer only.
grant execute on function bx1_private.fund_wallet_actor_current(uuid,uuid,uuid) to bx1_wallet_owner;

-- Pin the currently installed authority, not a guessed predecessor. Any source
-- change aborts this bounded cutover instead of silently overwriting other work.
do $wallet_scope_cutover$
declare item jsonb; routine regprocedure; source text; actual text; owner_name text;
  needle constant text := 'or not bx1_private.can_access_organisation(p_org)';
  replacement constant text := 'or not (bx1_private.can_access_organisation(p_org) or bx1_private.fund_wallet_actor_current(p_user,p_session,p_org))';
begin
  for item in select value from pg_catalog.jsonb_array_elements(
    '[{"signature":"bx1_private.issue_wallet_challenge(uuid,uuid,uuid,uuid,text,integer,text,text)","hash":"87d30bfc4e82108bbb06a4af1bccc696ddd1575e96f3f24bec4f236f1813036e"},
      {"signature":"bx1_private.read_wallet_challenge(uuid,uuid,uuid,uuid,uuid)","hash":"857f807b325e3be9997a4f52a36f521bb2494727b0e86210f284a8e3c3fe0eb3"},
      {"signature":"bx1_private.consume_wallet_challenge(uuid,uuid,uuid,uuid,uuid,text,text)","hash":"2b9ee283404d2ba9ea9cb1cdc9acba98249f245acfdaf2bd48576e3215878fb7"}]'::jsonb)
  loop
    routine:=pg_catalog.to_regprocedure(item->>'signature');
    if routine is null then raise exception 'fund_wallet_writer_missing' using errcode='23514'; end if;
    select pg_catalog.pg_get_functiondef(p.oid),p.proowner::regrole::text into source,owner_name
      from pg_catalog.pg_proc p where p.oid=routine;
    actual:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex');
    if actual is distinct from item->>'hash' or owner_name is distinct from 'bx1_wallet_owner'
      or (pg_catalog.length(source)-pg_catalog.length(pg_catalog.replace(source,needle,'')))/pg_catalog.length(needle) <> 1 then
      raise exception 'fund_wallet_writer_definition_changed' using errcode='23514';
    end if;
    -- No privilege on wallet/challenge tables is broadened. Preserve the
    -- original function owner and its narrow existing verifier EXECUTE ACL.
    execute 'set local role bx1_wallet_owner';
    execute pg_catalog.replace(source,needle,replacement);
    execute 'set local role postgres';
  end loop;
end
$wallet_scope_cutover$;

-- Authenticated, read-only context. Every returned field is server-derived.
-- Native wallet access remains valid; the additional individual scope is TEST
-- only and does not manufacture a membership, compliance approval or holding.
create function public.bx1_portal_fund_wallet_context_scoped(organisation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $wallet_context$
declare actor uuid:=auth.uid(); target_org uuid:=organisation_id; session uuid; platform uuid; environment text;
  organisation_name text; wallets jsonb;
begin
  if actor is null or target_org is null
    or coalesce(auth.jwt()->>'session_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or bx1_private.has_active_session() is not true or bx1_private.has_session_mfa() is not true then
    raise exception 'fund_wallet_context_denied' using errcode='42501'; end if;
  session:=(auth.jwt()->>'session_id')::uuid;
  select profile.platform_user_id into platform from public.bx1_profiles profile
    join auth.users u on u.id=profile.id
    where profile.id=actor and profile.status='ACTIVE' and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp());
  select cfg.environment into environment from bx1_portal.entry_configuration cfg where cfg.singleton;
  select org.name into organisation_name from public.bx1_organisations org
    where org.id=target_org and org.status='ACTIVE';
  if platform is null or environment is null or environment not in ('TESTNET','MAINNET') or organisation_name is null
    or not (bx1_private.can_access_organisation(target_org)
      or bx1_private.fund_wallet_actor_current(actor,session,target_org)) then
    raise exception 'fund_wallet_context_denied' using errcode='42501'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',w.id,'organisationId',w.organisation_id,'address',w.address,'chainId',w.chain_id,
      'verifiedAt',w.verified_at,'status',w.status) order by w.verified_at desc,w.id),'[]'::jsonb) into wallets
    from public.bx1_wallets w join bx1_private.wallet_challenges proof on proof.id=w.last_proof_id
      and proof.user_id=w.user_id and proof.platform_user_id=w.platform_user_id
      and proof.organisation_id=w.organisation_id and proof.address=w.address and proof.chain_id=w.chain_id
    where w.user_id=actor and w.platform_user_id=platform and w.organisation_id=target_org
      and w.chain_id=80002 and w.status='PENDING' and proof.domain='https://bx1.co.za'
      and proof.used_at is not null and proof.proof_signature is not null
      and proof.used_at>=proof.issued_at and proof.used_at<proof.expires_at;
  -- A scope change while reading must not be returned as current authority.
  if bx1_private.has_active_session() is not true or bx1_private.has_session_mfa() is not true
    or not (bx1_private.can_access_organisation(target_org)
      or bx1_private.fund_wallet_actor_current(actor,session,target_org)) then
    raise exception 'fund_wallet_context_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('actor_id',actor,'platform_user_id',platform,'session_id',session,
    'organisation_id',target_org,'organisation_name',organisation_name,'chain_id',80002,
    'environment',environment,'wallets',wallets);
end
$wallet_context$;
revoke all on function public.bx1_portal_fund_wallet_context_scoped(uuid) from public,anon,authenticated,service_role;
grant execute on function public.bx1_portal_fund_wallet_context_scoped(uuid) to authenticated;

commit;
