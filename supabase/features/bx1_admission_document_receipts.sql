-- Receipt-only normal TEST admission consistency. No quarantine/scanner,
-- Auth, role, policy or submission-binding mutation. Install atomically.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.admission_password_session()') is null
    or pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null
    or pg_catalog.to_regclass('bx1_private.document_lifecycle_policy') is null
    or pg_catalog.to_regprocedure('bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text,jsonb)') is not null
    or not exists(select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)')
        and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
          ='fadb04b5ce0389a3ea9ee910a938109b547f1edea789269f4af4b4ed01968cff')
    or not pg_catalog.has_function_privilege('bx1_document_receipt_writer',
      'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
      'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE')
    or not exists(select 1 from pg_catalog.pg_proc p
      where p.oid='bx1_private.lock_funding_person(uuid,uuid)'::regprocedure
        and p.proowner='bx1_authority_owner'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
          ='f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc')
    or not pg_catalog.has_function_privilege('postgres','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE') then
    raise exception 'admission_document_receipts_baseline_changed' using errcode='55000'; end if;
end $$;

-- This attestation is accepted ONLY from the restricted server receipt writer.
-- The server verifies the actual token with getUser before selecting these
-- fields. No request.jwt.claims GUC is read or manufactured here.
create function bx1_private.admission_receipt_session(p_actor uuid,p_session uuid,a jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if p_actor is null or p_session is null or pg_catalog.jsonb_typeof(a) is distinct from 'object'
    or not(a ?& array['iss','sub','session_id','role','aal','exp','is_anonymous','amr'])
    or a-array['iss','sub','session_id','role','aal','exp','is_anonymous','amr']<>'{}'::jsonb
    or a->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or a->>'sub' is distinct from p_actor::text or a->>'session_id' is distinct from p_session::text
    or a->>'role' is distinct from 'authenticated' or a->>'aal' is distinct from 'aal1'
    or a->'is_anonymous' is distinct from 'false'::jsonb
    or pg_catalog.jsonb_typeof(a->'exp') is distinct from 'number'
    or coalesce(a->>'exp','') !~ '^[1-9][0-9]{0,11}$'
    or (a->>'exp')::numeric<=extract(epoch from pg_catalog.clock_timestamp())
    or pg_catalog.jsonb_typeof(a->'amr') is distinct from 'array' or pg_catalog.jsonb_array_length(a->'amr')<>1
    or pg_catalog.jsonb_typeof(a->'amr'->0) is distinct from 'object'
    or (a->'amr'->0)-array['method','timestamp']<>'{}'::jsonb
    or a->'amr'->0->>'method' is distinct from 'password'
    or pg_catalog.jsonb_typeof(a->'amr'->0->'timestamp') is distinct from 'number'
    or coalesce(a->'amr'->0->>'timestamp','') !~ '^[1-9][0-9]{0,11}$'
    or (a->'amr'->0->>'timestamp')::numeric>extract(epoch from pg_catalog.clock_timestamp()) then return false; end if;
  return exists(select 1 from bx1_portal.entry_configuration c
      join public.bx1_organisations o on o.id=c.reviewer_scope
      where c.singleton and c.environment='TESTNET' and c.manual_test_review
        and c.test_ordinary_entry_enabled and o.status='ACTIVE')
    and exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced)
    and exists(select 1 from bx1_private.document_lifecycle_policy where singleton and mode='SYNTHETIC_TEST_ONLY')
    and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=p_actor and u.email_confirmed_at is not null and u.deleted_at is null
        and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
        and s.id=p_session and s.aal::text='aal1' and s.oauth_client_id is null
        and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp()))
    and not exists(select 1 from public.bx1_profiles pr where pr.id=p_actor and pr.status<>'ACTIVE')
    and not exists(select 1 from bx1_private.person_principals pp left join bx1_private.persons h on h.id=pp.person_id
      where pp.auth_user_id=p_actor and (pp.status is distinct from 'TRUSTED' or h.status is distinct from 'TRUSTED'));
exception when others then return false;
end $$;
revoke all on function bx1_private.admission_receipt_session(uuid,uuid,jsonb) from public,anon,authenticated,service_role,bx1_document_receipt_writer;

-- Sole receipt transition: native calls use NULL attestation and retain the
-- original native assurance predicate; only the explicit TEST branch differs.
create function bx1_private.register_document_receipt(p_actor uuid,p_session uuid,p_id uuid,
  p_kind text,p_title text,p_sha256 text,p_byte_size integer,p_mime_type text,p_attestation jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r bx1_private.document_upload_receipts; path text; admission boolean:=p_attestation is not null;
begin
  if admission then
    if bx1_private.admission_receipt_session(p_actor,p_session,p_attestation) is not true then
      raise exception 'document_receipt_session_denied' using errcode='42501'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||p_actor::text,0));
    perform singleton from bx1_portal.entry_configuration where singleton for share;
    perform singleton from bx1_private.document_receipt_policy where singleton for share;
    perform singleton from bx1_private.document_lifecycle_policy where singleton for share;
    perform id from public.bx1_organisations where id=(select reviewer_scope from bx1_portal.entry_configuration where singleton) for share;
    perform id from auth.users where id=p_actor for share;
    perform id from auth.sessions where id=p_session and user_id=p_actor for share;
    perform id from public.bx1_profiles where id=p_actor for share;
    perform id from auth.mfa_factors where user_id=p_actor order by id for share;
    perform bx1_private.lock_funding_person(p_actor,null);
    if bx1_private.admission_receipt_session(p_actor,p_session,p_attestation) is not true then
      raise exception 'document_receipt_session_denied' using errcode='42501'; end if;
  elsif not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced)
    or p_actor is null or p_session is null or p_id is null
    or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_actor and s.oauth_client_id is null
        and (s.not_after is null or s.not_after>clock_timestamp()) and u.email_confirmed_at is not null
        and u.deleted_at is null and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and not exists(select 1 from public.bx1_profiles p where p.id=p_actor and p.status<>'ACTIVE')
        and (not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.status::text='verified')
          or (s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f
            where f.id=s.factor_id and f.user_id=p_actor and f.status::text='verified')))) then
    raise exception 'document_receipt_session_denied' using errcode='42501'; end if;
  if (admission and (p_id is null or p_kind is null or p_title is null or p_sha256 is null or p_byte_size is null or p_mime_type is null))
    or p_kind not in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS') or length(p_title) not between 1 and 160
    or p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_size not between 1 and 4194304
    or p_mime_type not in ('application/pdf','image/png','image/jpeg') then
    raise exception 'document_receipt_invalid' using errcode='22023'; end if;
  path:=p_actor::text||'/'||p_id::text;
  perform o.id from storage.objects o where o.bucket_id='bx1-portal-documents' and o.name=path
    and o.owner_id=p_actor::text and o.metadata->>'size'=p_byte_size::text
    and o.metadata->>'mimetype'=p_mime_type and (not admission or o.user_metadata->>'sha256'=p_sha256) for share;
  if not found then raise exception 'document_receipt_storage_mismatch' using errcode='23514'; end if;
  insert into bx1_private.document_upload_receipts(id,actor_id,session_id,storage_path,kind,title,sha256,byte_size,mime_type)
    values(p_id,p_actor,p_session,path,p_kind,p_title,p_sha256,p_byte_size,p_mime_type) on conflict(id) do nothing;
  select * into r from bx1_private.document_upload_receipts where id=p_id for share;
  if r.id is null or r.actor_id is distinct from p_actor or r.storage_path is distinct from path or r.kind is distinct from p_kind
    or r.title is distinct from p_title or r.sha256 is distinct from p_sha256
    or r.byte_size is distinct from p_byte_size or r.mime_type is distinct from p_mime_type
    or (admission and r.validation_state<>'SYNTHETIC_UNSCANNED') then raise exception 'document_receipt_conflict' using errcode='23514'; end if;
  if admission and bx1_private.admission_receipt_session(p_actor,p_session,p_attestation) is not true then
    raise exception 'document_receipt_session_denied' using errcode='42501'; end if;
  insert into bx1_private.document_receipt_events(receipt_id,kind) values(p_id,'REGISTERED') on conflict do nothing;
  if admission and bx1_private.admission_receipt_session(p_actor,p_session,p_attestation) is not true then
    raise exception 'document_receipt_session_denied' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('id',r.id,'actor_id',r.actor_id,'storage_path',r.storage_path,
    'kind',r.kind,'title',r.title,'sha256',r.sha256,'size',r.byte_size,'mime_type',r.mime_type,
    'validation_state',r.validation_state);
end $$;
revoke all on function bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text,jsonb) to bx1_document_receipt_writer;

do $$
declare original record; actual record;
begin
  select oid,proowner,proacl,prosecdef,proconfig into original from pg_catalog.pg_proc
    where oid='bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)'::regprocedure;
  execute $definition$create or replace function bx1_private.register_document_receipt(p_actor uuid,p_session uuid,p_id uuid,
    p_kind text,p_title text,p_sha256 text,p_byte_size integer,p_mime_type text)
    returns jsonb language plpgsql volatile security definer set search_path='' as $body$
begin
  return bx1_private.register_document_receipt(p_actor,p_session,p_id,p_kind,p_title,p_sha256,p_byte_size,p_mime_type,null::jsonb);
end $body$;$definition$;
  select oid,proowner,proacl,prosecdef,proconfig into actual from pg_catalog.pg_proc where oid=original.oid;
  if row(actual.oid,actual.proowner,actual.proacl,actual.prosecdef,actual.proconfig)
    is distinct from row(original.oid,original.proowner,original.proacl,original.prosecdef,original.proconfig) then
    raise exception 'admission_document_receipts_native_metadata_changed' using errcode='55000'; end if;
end $$;
