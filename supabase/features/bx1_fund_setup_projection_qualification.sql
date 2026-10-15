-- TEST-only projection qualification. Exactly two column spans change.
-- No helper, authority, grants, writer transition or business rows change.
do $setup_projection_qualification$
declare target oid; before_row jsonb; after_row jsonb; original text; next_body text;
  restored text; definition text; dependency jsonb; cut jsonb; dependencies_before jsonb;
  dependencies constant jsonb:=$dependencies$[
    {"oid":16542,"signature":"auth.uid()","sha":"09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":33388,"signature":"bx1_private.test_roleplay_environment()","sha":"df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":33613,"signature":"bx1_portal.fund_setup_command(text,uuid,jsonb,jsonb)","sha":"046e4159569c6b79ffba18b739650459e3926c5a2e66a1fdb6f98a83897ed577","metadata":{"oid":"33613","proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_setup_command","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["command","key","body","c"],"proargtypes":["25","2950","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}
  ]$dependencies$::jsonb;
  target_metadata constant jsonb:=$target_metadata${"oid":"33611","proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_setup_projection","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["pid","c"],"proargtypes":["2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$target_metadata$::jsonb;
  cuts constant jsonb:=$cuts$[
  {
    "from": "select * into next_step from bx1_portal.fund_setup_steps where setup_id=s.id and state<>'FINAL' order by ordinal limit 1;",
    "to": "select candidate_step.* into next_step from bx1_portal.fund_setup_steps candidate_step where candidate_step.setup_id=s.id and candidate_step.state<>'FINAL' order by candidate_step.ordinal limit 1;"
  },
  {
    "from": "exists(select 1 from bx1_portal.fund_setup_steps where setup_id=s.id and state<>'NOT_STARTED')",
    "to": "exists(select 1 from bx1_portal.fund_setup_steps progress_step where progress_step.setup_id=s.id and progress_step.state<>'NOT_STARTED')"
  }
]$cuts$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_setup_projection_qualification_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if after_row is null or after_row->>'oid' is distinct from dependency->>'oid'
      or after_row-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(after_row->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_setup_projection_qualification_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) into dependencies_before
    from pg_catalog.pg_proc p where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(dependencies));
  target:=pg_catalog.to_regprocedure('bx1_portal.fund_setup_projection(uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 33611::oid or before_row-'prosrc' is distinct from target_metadata then
    raise exception 'fund_setup_projection_qualification_metadata_changed' using errcode='55000';end if;
  next_body:=original;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    ='bebc445ee7aa6dc482fb833a4859c262f50f56fb82be5b72a9a071b55708495d' then
    for cut in select value from pg_catalog.jsonb_array_elements(cuts) loop
      if (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>1 then
        raise exception 'fund_setup_projection_qualification_cut_not_unique' using errcode='55000';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');
    end loop;
  else
    restored:=original;
    for cut in select value from pg_catalog.jsonb_array_elements(cuts) with ordinality item(value,n) order by n desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'fund_setup_projection_qualification_repeat_cut_changed' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'bebc445ee7aa6dc482fb833a4859c262f50f56fb82be5b72a9a071b55708495d' then
      raise exception 'fund_setup_projection_qualification_outside_cut_changed' using errcode='55000';end if;
  end if;
  if next_body is distinct from original then
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_setup_projection_qualification_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
  end if;
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_setup_projection_qualification_metadata_not_preserved' using errcode='55000';end if;
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) from pg_catalog.pg_proc p
    where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(dependencies))) is distinct from dependencies_before then
    raise exception 'fund_setup_projection_qualification_dependency_modified' using errcode='55000';end if;
end $setup_projection_qualification$;
