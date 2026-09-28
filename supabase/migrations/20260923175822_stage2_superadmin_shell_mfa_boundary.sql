-- Narrow the early customer-source MFA gate added by the entity-account
-- migration. A ROLE SuperAdmin without TOTP may use the ordinary portal shell;
-- it does not become an appointed Compliance reviewer. The inherited
-- scoped_reviewer predicate still requires current AAL2 TOTP before exposing
-- customer applications, eligibility source data or documents. Entity mandate
-- queues and apply/revoke commands retain their own AAL2 actor checks.
-- This is additive because the preceding migration has already run on TEST.
do $bx1_superadmin_shell$
declare signature text; definition text; matches integer;
  early_guard text:=$bx1_pattern$if[[:space:]]+c->>'mode'[[:space:]]*=[[:space:]]*'ROLE'[[:space:]]+and[[:space:]]+c->>'role'[[:space:]]+in[[:space:]]*\([[:space:]]*'ComplianceOfficer'[[:space:]]*,[[:space:]]*'SuperAdmin'[[:space:]]*\)[[:space:]]+and[[:space:]]+bx1_portal\.entity_staff_source_assured\(c\)[[:space:]]+is[[:space:]]+not[[:space:]]+true[[:space:]]+then$bx1_pattern$;
  narrowed_guard text:=$bx1_replacement$if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
    and bx1_portal.entity_staff_source_assured(c) is not true then$bx1_replacement$;
begin
  if current_user<>'postgres' or to_regprocedure('bx1_portal.entity_staff_source_assured(jsonb)') is null
    or to_regprocedure('bx1_portal.representative_mandate_actor(jsonb,uuid,text)') is null then
    raise exception 'superadmin_shell_entity_baseline_required' using errcode='55000'; end if;
  foreach signature in array array[
    'bx1_portal.read_scoped(jsonb)',
    'bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'] loop
    definition:=pg_catalog.pg_get_functiondef(signature::pg_catalog.regprocedure);
    select count(*) into matches from pg_catalog.regexp_matches(definition,early_guard,'g');
    if matches<>1 then
      raise exception 'superadmin_shell_guard_mismatch_%_%',signature,matches using errcode='55000'; end if;
    execute pg_catalog.regexp_replace(definition,early_guard,narrowed_guard);
  end loop;
end $bx1_superadmin_shell$;
