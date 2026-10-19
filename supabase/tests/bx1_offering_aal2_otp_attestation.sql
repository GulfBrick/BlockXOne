-- Denial-only proof for the one AMR predicate correction.
-- No real user/session claim is minted and no user, session or factor is seeded.
-- Well-shaped OTP+TOTP reaches the unchanged real-session rejection; it cannot
-- establish authority. Actual positive acceptance requires the genuine browser.
do $offering_aal2_otp_negatives$
declare
  missing_actor constant uuid:='ffffffff-ffff-ffff-ffff-ffffffffffff';
  missing_session constant uuid:='ffffffff-ffff-ffff-ffff-fffffffffffe';
  at_epoch bigint:=floor(extract(epoch from pg_catalog.clock_timestamp()))::bigint;
  base jsonb; testcase record; denied boolean; actual_error text; target oid;
  before_counts jsonb; after_counts jsonb;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_subject text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'offering_aal2_otp_negative_test_owner_required';end if;
  if exists(select 1 from auth.users where id=missing_actor)
    or exists(select 1 from auth.sessions where id=missing_session or user_id=missing_actor)
    or exists(select 1 from public.bx1_profiles where id=missing_actor) then
    raise exception 'offering_aal2_otp_negative_actor_not_missing';end if;
  target:=pg_catalog.to_regprocedure('bx1_private.offering_file_session_context(uuid,uuid,text,jsonb)');
  if target is null or not exists(select 1 from pg_catalog.pg_proc p where p.oid=target
      and p.proowner='postgres'::regrole::oid and p.prosecdef
      and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=""']
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
        ='9d7e289016a8afa0f3d6c4c9011f4b16c23b97f94d036f8971fb7ba733d73d5a') then
    raise exception 'offering_aal2_otp_negative_corrected_guard_missing';end if;
  select pg_catalog.jsonb_build_object(
    'users',(select count(*) from auth.users),
    'sessions',(select count(*) from auth.sessions),
    'factors',(select count(*) from auth.mfa_factors),
    'profiles',(select count(*) from public.bx1_profiles),
    'products',(select count(*) from bx1_portal.products)) into before_counts;
  base:=pg_catalog.jsonb_build_object(
    'iss','https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1',
    'sub',missing_actor,'session_id',missing_session,'role','authenticated',
    'aal','aal2','exp',at_epoch+300,'is_anonymous',false,
    'amr',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('method','otp','timestamp',at_epoch-60),
      pg_catalog.jsonb_build_object('method','totp','timestamp',at_epoch-1)));
  for testcase in select * from (values
    ('incomplete','aal2',base-'amr','offering_file_attestation_denied'),
    ('extra-field','aal2',base||'{"extra":true}'::jsonb,'offering_file_attestation_denied'),
    ('wrong-issuer','aal2',base||'{"iss":"https://oqkevkjbkpugjotihtda.supabase.co/auth/v1"}'::jsonb,'offering_file_attestation_denied'),
    ('wrong-subject','aal2',base||'{"sub":"ffffffff-ffff-ffff-ffff-fffffffffffd"}'::jsonb,'offering_file_attestation_denied'),
    ('wrong-session','aal2',base||'{"session_id":"ffffffff-ffff-ffff-ffff-fffffffffffd"}'::jsonb,'offering_file_attestation_denied'),
    ('expired','aal2',base||pg_catalog.jsonb_build_object('exp',at_epoch-1),'offering_file_attestation_denied'),
    ('unknown-method','aal2',pg_catalog.jsonb_set(base,'{amr,0,method}','"unrecognised"'::jsonb),'offering_file_attestation_denied'),
    ('future-method-time','aal2',pg_catalog.jsonb_set(base,'{amr,0,timestamp}',pg_catalog.to_jsonb(at_epoch+300)),'offering_file_attestation_denied'),
    ('malformed-method-time','aal2',pg_catalog.jsonb_set(base,'{amr,1,timestamp}','"not-a-number"'::jsonb),'offering_file_attestation_denied'),
    ('otp-only-aal2','aal2',pg_catalog.jsonb_set(base,'{amr}',pg_catalog.jsonb_build_array(base->'amr'->0)),'offering_file_attestation_denied'),
    ('otp-totp-aal1','aal1',base||'{"aal":"aal1"}'::jsonb,'offering_file_attestation_denied'),
    ('otp-only-aal1','aal1',pg_catalog.jsonb_set(base||'{"aal":"aal1"}'::jsonb,'{amr}',pg_catalog.jsonb_build_array(base->'amr'->0)),'offering_file_attestation_denied'),
    ('well-shaped-otp-totp-no-session','aal2',base,'offering_file_session_denied'),
    ('well-shaped-otp-mfa-totp-no-session','aal2',pg_catalog.jsonb_set(base,'{amr,1,method}','"mfa/totp"'::jsonb),'offering_file_session_denied'),
    ('original-password-totp-no-session','aal2',pg_catalog.jsonb_set(base,'{amr,0,method}','"password"'::jsonb),'offering_file_session_denied'),
    ('original-password-aal1-no-session','aal1',pg_catalog.jsonb_set(base||'{"aal":"aal1"}'::jsonb,'{amr}',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('method','password','timestamp',at_epoch-60))),'offering_file_session_denied')
  ) as cases(label,assurance,attestation,expected_error) loop
    denied:=false;actual_error:=null;
    begin
      perform bx1_private.offering_file_session_context(missing_actor,missing_session,testcase.assurance,testcase.attestation);
    exception when insufficient_privilege then denied:=true;actual_error:=sqlerrm;end;
    if denied is not true or actual_error is distinct from testcase.expected_error then
      raise exception 'offering_aal2_otp_negative_boundary_failed:%',testcase.label;end if;
  end loop;
  select pg_catalog.jsonb_build_object(
    'users',(select count(*) from auth.users),
    'sessions',(select count(*) from auth.sessions),
    'factors',(select count(*) from auth.mfa_factors),
    'profiles',(select count(*) from public.bx1_profiles),
    'products',(select count(*) from bx1_portal.products)) into after_counts;
  if before_counts is distinct from after_counts
    or before_claims is distinct from pg_catalog.current_setting('request.jwt.claims',true)
    or before_subject is distinct from pg_catalog.current_setting('request.jwt.claim.sub',true) then
    raise exception 'offering_aal2_otp_negative_changed_data_or_claims';end if;
end $offering_aal2_otp_negatives$;
