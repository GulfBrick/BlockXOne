-- Exact TEST-only provider-contract correction for an OTP-origin session which
-- has subsequently completed genuine TOTP. This is not an MFA waiver.
-- Install atomically as postgres after reviewing the recorded source pin.
-- No roles, accounts, sessions, factors, documents or provider results are seeded.

do $offering_aal2_otp$
declare target oid;before_metadata jsonb;after_metadata jsonb;source_body text;
  next_body text;definition text;
  old_predicate constant text:='or method->>''method'' not in (''password'',''totp'',''mfa/totp'')';
  new_predicate constant text:='or (method->>''method'' not in (''password'',''totp'',''mfa/totp'')
        and not (p_aal=''aal2'' and method->>''method''=''otp''
          and exists(select 1 from pg_catalog.jsonb_array_elements(a->''amr'') amr_proof(entry)
            where amr_proof.entry->>''method'' in (''totp'',''mfa/totp''))))';
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'offering_aal2_otp_test_owner_required' using errcode='42501';end if;
  target:=pg_catalog.to_regprocedure('bx1_private.offering_file_session_context(uuid,uuid,text,jsonb)');
  if target is null then raise exception 'offering_aal2_otp_guard_signature_missing' using errcode='55000';end if;
  select pg_catalog.to_jsonb(p)-'prosrc',p.prosrc into before_metadata,source_body
    from pg_catalog.pg_proc p where p.oid=target;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(source_body,E'\r\n',E'\n'),'UTF8')),'hex')
      is distinct from '2096dc8db8e025d9aa684d03a34f18465519cb7195ea33c1a03842cbe50c48c1'
    or (before_metadata->>'proowner')::oid is distinct from 'postgres'::regrole::oid
    or (before_metadata->>'prosecdef')::boolean is not true
    or (select proacl::text from pg_catalog.pg_proc where oid=target) is distinct from '{postgres=X/postgres}'
    or pg_catalog.to_jsonb((select proconfig from pg_catalog.pg_proc where oid=target)) is distinct from '["search_path=\"\""]'::jsonb then
    raise exception 'offering_aal2_otp_exact_guard_pin_mismatch' using errcode='55000';end if;
  if (length(source_body)-length(replace(source_body,old_predicate,'')))/length(old_predicate)<>1 then
    raise exception 'offering_aal2_otp_predicate_not_unique' using errcode='55000';end if;
  -- Every other source byte, including issuer/subject/session/expiry checks,
  -- password-only AAL1, real AAL2 factor checks and error codes, is preserved.
  next_body:=replace(source_body,old_predicate,new_predicate);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(next_body,E'\r\n',E'\n'),'UTF8')),'hex')
    is distinct from '9d7e289016a8afa0f3d6c4c9011f4b16c23b97f94d036f8971fb7ba733d73d5a' then
    raise exception 'offering_aal2_otp_corrected_guard_pin_mismatch' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,source_body,'')))/length(source_body)<>1 then
    raise exception 'offering_aal2_otp_body_not_unique' using errcode='55000';end if;
  execute replace(definition,source_body,next_body);
  select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
  if before_metadata is distinct from after_metadata
    or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
    raise exception 'offering_aal2_otp_metadata_or_body_changed' using errcode='55000';end if;
end $offering_aal2_otp$;
