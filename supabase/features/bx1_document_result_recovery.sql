-- TEST-only continuation of an already accepted immutable scanner event.
-- No CLAIM, scan, verdict, lease renewal, promotion or historical rewrite here.
do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.document_processing_authority(text,text)') is null
    or pg_catalog.to_regprocedure('bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)') is null
    or not exists(select 1 from pg_catalog.pg_constraint c
      where c.conrelid='bx1_private.document_scan_events'::regclass and c.contype='u'
        and c.conkey=array[(select a.attnum from pg_catalog.pg_attribute a
          where a.attrelid=c.conrelid and a.attname='document_id' and not a.attisdropped)]::smallint[])
    or pg_catalog.to_regprocedure('bx1_private.read_document_processing_recorded_result(uuid,uuid,bigint,text,text)') is not null then
    raise exception 'document_result_recovery_exact_test_baseline_required' using errcode='55000';
  end if;
end $baseline$;

create function bx1_private.read_document_processing_recorded_result(p_document uuid,p_attempt uuid,p_epoch bigint,
  p_worker text,p_scanner text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare policy bx1_private.document_processing_policy; job bx1_private.document_processing_jobs;
  attempt bx1_private.document_processing_attempts; item bx1_private.document_quarantine_items;
  scan bx1_private.document_scan_events;
begin
  if not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or p_document is null or p_attempt is null or p_epoch is null or p_epoch<1
    or p_document='00000000-0000-0000-0000-000000000000'::uuid
    or p_attempt='00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'document_result_recovery_denied' using errcode='42501';end if;
  -- Same policy -> job -> attempt -> quarantine lock order as native writers.
  policy:=bx1_private.document_processing_authority(p_worker,p_scanner);
  select * into job from bx1_private.document_processing_jobs where document_id=p_document for share;
  select * into attempt from bx1_private.document_processing_attempts
    where id=p_attempt and document_id=p_document for share;
  select * into item from bx1_private.document_quarantine_items where id=p_document for share;
  select * into scan from bx1_private.document_scan_events where document_id=p_document;
  if job.document_id is null or attempt.id is null or item.id is null or scan.id is null
    or job.current_attempt_id is distinct from attempt.id or job.attempt_number is distinct from attempt.attempt_number
    or attempt.authority_epoch is distinct from p_epoch or attempt.authority_epoch is distinct from policy.authority_epoch
    or attempt.worker_id is distinct from p_worker or attempt.scanner_id is distinct from p_scanner
    or attempt.reference is distinct from 'bx1-scan:'||attempt.id::text
    or job.actor_id is distinct from item.actor_id or job.storage_path is distinct from item.storage_path
    or job.sha256 is distinct from item.sha256 or job.byte_size is distinct from item.byte_size
    or job.mime_type is distinct from item.mime_type or scan.sha256 is distinct from item.sha256
    or scan.scanner_id is distinct from attempt.scanner_id or scan.scanner_reference is distinct from attempt.reference
    or item.scanner_id is distinct from scan.scanner_id or item.scanner_reference is distinct from scan.scanner_reference
    or item.scanned_at is distinct from scan.observed_at or attempt.finished_at is null
    or attempt.outcome is distinct from scan.verdict
    or not ((scan.verdict='CLEAN' and job.state in ('RESULT_RECORDED','COMPLETED') and item.state in ('SCANNED_CLEAN','PROMOTED'))
      or (scan.verdict='MALICIOUS' and job.state='REJECTED' and item.state='REJECTED'))
    or not exists(select 1 from bx1_private.document_processing_events evidence
      where evidence.document_id=p_document and evidence.attempt_id=p_attempt
        and evidence.kind=case when scan.verdict='CLEAN' then 'RESULT_RECORDED' else 'REJECTED' end
        and evidence.evidence->>'sha256'=scan.sha256 and evidence.evidence->>'verdict'=scan.verdict
        and evidence.evidence->>'scanner_id'=scan.scanner_id and evidence.evidence->>'reference'=scan.scanner_reference
        and (evidence.evidence->>'observed_at')::timestamptz=scan.observed_at
        and evidence.evidence->>'authority_epoch'=attempt.authority_epoch::text) then
    raise exception 'document_result_recovery_denied' using errcode='42501';end if;
  -- The original lease/observed-time window is intentionally not extended or
  -- reapplied: only this exact committed event can be resumed after process loss.
  return pg_catalog.jsonb_build_object('document_id',item.id,'attempt_id',attempt.id,'authority_epoch',attempt.authority_epoch,
    'worker_id',attempt.worker_id,'scanner_id',scan.scanner_id,'scan_event_id',scan.id,'sha256',scan.sha256,
    'verdict',scan.verdict,'reference',scan.scanner_reference,'observed_at',scan.observed_at);
end $$;

do $closed_acl$
declare grantee text;
begin
  for grantee in select distinct case when a.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(r.rolname) end
    from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid='bx1_private.read_document_processing_recorded_result(uuid,uuid,bigint,text,text)'::regprocedure
      and a.grantee<>p.proowner loop
    execute pg_catalog.format('revoke all on function bx1_private.read_document_processing_recorded_result(uuid,uuid,bigint,text,text) from %s',grantee);
  end loop;
end $closed_acl$;
grant execute on function bx1_private.read_document_processing_recorded_result(uuid,uuid,bigint,text,text)
  to bx1_document_scanner_writer;
