-- Missing-session/catalog negatives only; no real conformance/chain facts seeded.
do $admission_negatives$ declare missing uuid:='00000000-0000-4000-8000-000000000001';denied boolean;proc record;begin
  if not bx1_private.test_roleplay_environment() or current_user<>'postgres' then raise exception 'admission_test_only';end if;
  perform set_config('request.jwt.claims','{}',true);
  denied:=false;
  begin perform public.bx1_portal_fund_admission_seed(missing,1,'{"mode":"APPLICANT"}');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'admission_no_session_not_denied';end if;
  if position('deployment_configuration,signing,threshold' in (select prosrc from pg_proc where oid='bx1_portal.fund_admission_seed(uuid,integer,jsonb)'::regprocedure))=0 then
    raise exception 'admission_reviewed_threshold_not_bound';end if;
  for proc in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_portal','bx1_private') and p.proname in ('fund_record_conformance','fund_admission_request_guard',
      'fund_admission_worker_enter','read_fund_admission','record_fund_admission') loop
    if has_function_privilege('anon',proc.oid,'EXECUTE') or has_function_privilege('authenticated',proc.oid,'EXECUTE')
      or has_function_privilege('service_role',proc.oid,'EXECUTE') then raise exception 'admission_private_helper_acl_open';end if;
  end loop;
  if exists(select 1 from bx1_portal.fund_contract_release_receipts) or exists(select 1 from bx1_portal.fund_admission_requests)
    or exists(select 1 from bx1_portal.fund_admission_receipts) then raise exception 'admission_evidence_fabricated';end if;
end $admission_negatives$;
