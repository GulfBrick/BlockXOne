-- WALLET-UID-20261015: preserve the wallet-owner lock helper and replace its
-- unavailable auth namespace reference with the exact read-only native UID
-- expression. No auth grant, context write, business row or policy change.
-- Apply in one TEST owner transaction; temporary installer authority is fully
-- restored before this block returns. Repeating the exact repair is a no-op.

do $fund_roleplay_wallet_uid$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_private.lock_roleplay_wallet_proof(uuid,uuid,uuid)');
  uid_function oid:=pg_catalog.to_regprocedure('auth.uid()');
  binder oid:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_bind_signer(uuid,integer,text,uuid,jsonb)');
  before_function jsonb;after_function jsonb;before_uid jsonb;before_binder jsonb;
  before_namespaces jsonb;before_memberships jsonb;edge record;
  original text;restored text;next_body text;definition text;added_create boolean;
  old_fragment constant text:='auth.uid()';
  new_fragment constant text:=$uid$coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$uid$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_wallet_uid_test_owner_required' using errcode='42501';end if;
  select pg_catalog.to_jsonb(p),p.prosrc into before_function,original from pg_catalog.pg_proc p where p.oid=target;
  select pg_catalog.to_jsonb(p) into before_uid from pg_catalog.pg_proc p where p.oid=uid_function;
  select pg_catalog.to_jsonb(p) into before_binder from pg_catalog.pg_proc p where p.oid=binder;
  if target is null or uid_function is null or binder is null
    or before_function->>'proowner' is distinct from 'bx1_wallet_owner'::regrole::oid::text
    or before_function->'prosecdef' is distinct from 'true'::jsonb
    or before_function->>'provolatile' is distinct from 'v'
    or before_function->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_function->'proacl' is distinct from '["bx1_wallet_owner=X/bx1_wallet_owner","postgres=X/bx1_wallet_owner"]'::jsonb
    or before_function->'proargnames' is distinct from '["actor","wallet","proof"]'::jsonb
    or pg_catalog.pg_get_function_result(target) is distinct from 'void'
    or before_function->>'prolang' is distinct from
      (select language.oid::text from pg_catalog.pg_language language where language.lanname='plpgsql')
    or before_uid->>'proowner' is distinct from 'supabase_auth_admin'::regrole::oid::text
    or before_uid->'prosecdef' is distinct from 'false'::jsonb
    or before_uid->>'provolatile' is distinct from 's'
    or before_uid->'proconfig' is distinct from 'null'::jsonb
    or before_uid->'proargnames' is distinct from 'null'::jsonb
    or pg_catalog.pg_get_function_result(uid_function) is distinct from 'uuid'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(before_uid->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(before_binder->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '22f480a64d2c38e7879b78d278811af62f49864d9343c49886c47a52bbe571ec' then
    raise exception 'fund_roleplay_wallet_uid_native_metadata_pin_mismatch' using errcode='55000';end if;

  if (length(original)-length(replace(original,new_fragment,'')))/length(new_fragment)=1 then
    restored:=replace(original,new_fragment,old_fragment);next_body:=original;
  elsif (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)=1
      and pg_catalog.strpos(original,new_fragment)=0 then
    restored:=original;next_body:=replace(original,old_fragment,new_fragment);
  else raise exception 'fund_roleplay_wallet_uid_cut_not_unique' using errcode='55000';end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '2fa6f5d32aa02b96a679965a31b8c0e9e30ecaf86a09ec9e2633586008e57826'
    or replace(next_body,new_fragment,old_fragment) is distinct from restored then
    raise exception 'fund_roleplay_wallet_uid_source_pin_mismatch' using errcode='55000';end if;

  -- Preserve ALL namespace and membership metadata, not just effective access.
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.oid) into before_namespaces from pg_catalog.pg_namespace n;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb)
    into before_memberships from pg_catalog.pg_auth_members m;
  if next_body is distinct from original then
    select * into edge from pg_catalog.pg_auth_members
      where roleid='bx1_wallet_owner'::regrole and member=current_user::regrole and grantor=current_user::regrole;
    added_create:=not pg_catalog.has_schema_privilege('bx1_wallet_owner','bx1_private','CREATE');
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_roleplay_wallet_uid_definition_not_unique' using errcode='55000';end if;

    -- Same temporary installer pattern as the canonical wallet-owner helper.
    execute 'grant bx1_wallet_owner to postgres with inherit true,set true granted by postgres';
    if added_create then execute 'grant create on schema bx1_private to bx1_wallet_owner';end if;
    execute 'set local role bx1_wallet_owner';
    execute replace(definition,original,next_body);
    execute 'reset role';
    if added_create then execute 'revoke create on schema bx1_private from bx1_wallet_owner';end if;
    if edge.oid is not null then
      execute pg_catalog.format('grant bx1_wallet_owner to postgres with admin %s,inherit %s,set %s granted by postgres',
        edge.admin_option::text,edge.inherit_option::text,edge.set_option::text);
    else execute 'revoke bx1_wallet_owner from postgres granted by postgres';end if;
  end if;
  select pg_catalog.to_jsonb(p) into after_function from pg_catalog.pg_proc p where p.oid=target;
  if current_user<>'postgres' or after_function-'prosrc' is distinct from before_function-'prosrc'
    or after_function->>'prosrc' is distinct from next_body
    or (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=uid_function) is distinct from before_uid
    or (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=binder) is distinct from before_binder
    or (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.oid) from pg_catalog.pg_namespace n) is distinct from before_namespaces
    or (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb)
      from pg_catalog.pg_auth_members m) is distinct from before_memberships then
    raise exception 'fund_roleplay_wallet_uid_metadata_not_preserved' using errcode='55000';end if;
end $fund_roleplay_wallet_uid$;
