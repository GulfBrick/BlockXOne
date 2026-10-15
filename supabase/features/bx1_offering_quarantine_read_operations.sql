-- TEST-only SDK read-back compatibility for two existing quarantine SELECT
-- policies. The metadata probe and authenticated download retain the exact
-- owner/current-manager predicate. No list, signed URL, grant or writer change.
do $offering_quarantine_read_operations$
declare spec jsonb;target oid;before_row jsonb;after_row jsonb;original text;next_expression text;after_expression text;
  old_operation constant text:=$old$storage.allow_only_operation('object.get_authenticated'::text)$old$;
  new_operation constant text:=$new$storage.allow_any_operation(ARRAY['object.get_authenticated_info'::text, 'object.get_authenticated'::text])$new$;
  specifications constant jsonb:=$pins$[
    {"name":"bx1_offering_file_owner_read","sha256":"ed2f8d9c04b9f8fc76177080346ee3a3042800074a71e30ff2a72589c11f88c5","role":"authenticated","permissive":true},
    {"name":"bx1_offering_file_read_restrict","sha256":"898f4042ae367089e25deaddcfcd5cec86794b92674d0c135ce23714c36b63ba","role":"public","permissive":false}
  ]$pins$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('storage.allow_only_operation(text)') is null
    or pg_catalog.to_regprocedure('storage.allow_any_operation(text[])') is null
    or pg_catalog.to_regprocedure('bx1_portal.offering_file_owner_read_allowed(text,text)') is null then
    raise exception 'offering_quarantine_read_operations_exact_test_owner_required' using errcode='42501';end if;

  -- Preflight both policies before changing either one. The enclosing DO is
  -- atomic: a second-policy pin or postcondition failure rolls back both cuts.
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    select p.oid,pg_catalog.to_jsonb(p),pg_catalog.pg_get_expr(p.polqual,p.polrelid)
      into target,before_row,original from pg_catalog.pg_policy p
      where p.polrelid='storage.objects'::regclass and p.polname=spec->>'name';
    if target is null or before_row->>'polcmd' is distinct from 'r'
      or before_row->'polpermissive' is distinct from spec->'permissive'
      or before_row->'polwithcheck' is distinct from 'null'::jsonb
      or before_row->'polroles' is distinct from (case when spec->>'role'='public'
        then pg_catalog.to_jsonb(array[0::oid]) else pg_catalog.to_jsonb(array['authenticated'::regrole::oid]) end)
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original,'UTF8')),'hex') is distinct from spec->>'sha256'
      or (length(original)-length(replace(original,old_operation,'')))/length(old_operation)<>1 then
      raise exception 'offering_quarantine_read_operations_native_pin_mismatch: %',spec->>'name' using errcode='55000';end if;
  end loop;

  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    select p.oid,pg_catalog.to_jsonb(p),pg_catalog.pg_get_expr(p.polqual,p.polrelid)
      into target,before_row,original from pg_catalog.pg_policy p
      where p.polrelid='storage.objects'::regclass and p.polname=spec->>'name';
    if target is null or before_row->>'polcmd' is distinct from 'r'
      or before_row->'polpermissive' is distinct from spec->'permissive'
      or before_row->'polwithcheck' is distinct from 'null'::jsonb
      or before_row->'polroles' is distinct from (case when spec->>'role'='public'
        then pg_catalog.to_jsonb(array[0::oid]) else pg_catalog.to_jsonb(array['authenticated'::regrole::oid]) end)
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original,'UTF8')),'hex') is distinct from spec->>'sha256'
      or (length(original)-length(replace(original,old_operation,'')))/length(old_operation)<>1 then
      raise exception 'offering_quarantine_read_operations_changed_before_cut: %',spec->>'name' using errcode='55000';end if;
    next_expression:=replace(original,old_operation,new_operation);
    if replace(next_expression,new_operation,old_operation) is distinct from original then
      raise exception 'offering_quarantine_read_operations_outside_cut_changed' using errcode='55000';end if;
    execute pg_catalog.format('alter policy %I on storage.objects using (%s)',spec->>'name',next_expression);
    select pg_catalog.to_jsonb(p),pg_catalog.pg_get_expr(p.polqual,p.polrelid)
      into after_row,after_expression from pg_catalog.pg_policy p where p.oid=target;
    if after_row-'polqual' is distinct from before_row-'polqual'
      or after_expression is distinct from next_expression
      or replace(after_expression,new_operation,old_operation) is distinct from original then
      raise exception 'offering_quarantine_read_operations_metadata_or_outside_cut_changed' using errcode='55000';end if;
  end loop;
end $offering_quarantine_read_operations$;
