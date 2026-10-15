-- Catalog/inverse and actual extracted SQL query proof only.
-- Typed VALUES/recordsets are not saved setup steps or authenticated acceptance.
do $setup_projection_qualification_proof$
declare target oid; metadata jsonb; source text; restored text; dependency jsonb; cut jsonb;
  next_query text; progress_query text; typed_rows text; block_source text; fixture jsonb;
  old_query text; ambiguous_denied boolean:=false;
  dependencies constant jsonb:=$dependencies$[{"oid":16542,"signature":"auth.uid()","sha":"09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":33388,"signature":"bx1_private.test_roleplay_environment()","sha":"df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":33613,"signature":"bx1_portal.fund_setup_command(text,uuid,jsonb,jsonb)","sha":"046e4159569c6b79ffba18b739650459e3926c5a2e66a1fdb6f98a83897ed577","metadata":{"oid":"33613","proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_setup_command","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["command","key","body","c"],"proargtypes":["25","2950","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]$dependencies$::jsonb;
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
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_setup_projection_qualification_proof_exact_test_owner_required';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    select pg_catalog.to_jsonb(p) into metadata from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if metadata is null or metadata->>'oid' is distinct from dependency->>'oid'
      or metadata-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(metadata->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_setup_projection_qualification_proof_dependency_changed: %',dependency->>'signature';end if;
  end loop;
  target:=pg_catalog.to_regprocedure('bx1_portal.fund_setup_projection(uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into metadata,source from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 33611::oid or metadata-'prosrc' is distinct from target_metadata then
    raise exception 'fund_setup_projection_qualification_proof_metadata_changed';end if;
  restored:=source;
  for cut in select value from pg_catalog.jsonb_array_elements(cuts) with ordinality item(value,n) order by n desc loop
    if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
      raise exception 'fund_setup_projection_qualification_proof_cut_not_unique';end if;
    restored:=replace(restored,cut->>'to',cut->>'from');
  end loop;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    is distinct from 'bebc445ee7aa6dc482fb833a4859c262f50f56fb82be5b72a9a071b55708495d' then
    raise exception 'fund_setup_projection_qualification_proof_outside_cut_changed';end if;
  next_query:=substring(source from strpos(source,cuts->0->>'to') for length(cuts->0->>'to'));
  progress_query:=substring(source from strpos(source,cuts->1->>'to') for length(cuts->1->>'to'));
  -- Compile the actual qualified query text with a deliberate same-named local
  -- state variable, substituting only typed in-memory rows for the saved table.
  for fixture in select value from pg_catalog.jsonb_array_elements($fixtures$[{"rows":[{"id":"22222222-2222-4222-8222-222222222222","setup_id":"22222222-2222-4222-8222-222222222222","state":"NOT_STARTED","ordinal":0},{"id":"11111111-1111-4111-8111-111111111111","setup_id":"11111111-1111-4111-8111-111111111111","state":"FINAL","ordinal":0},{"id":"33333333-3333-4333-8333-333333333333","setup_id":"11111111-1111-4111-8111-111111111111","state":"NOT_STARTED","ordinal":1},{"id":"22222222-2222-4222-8222-222222222222","setup_id":"11111111-1111-4111-8111-111111111111","state":"PREPARED","ordinal":2}],"chosen":"33333333-3333-4333-8333-333333333333","progress":true},{"rows":[{"id":"22222222-2222-4222-8222-222222222222","setup_id":"22222222-2222-4222-8222-222222222222","state":"PREPARED","ordinal":0},{"id":"33333333-3333-4333-8333-333333333333","setup_id":"11111111-1111-4111-8111-111111111111","state":"NOT_STARTED","ordinal":1},{"id":"11111111-1111-4111-8111-111111111111","setup_id":"11111111-1111-4111-8111-111111111111","state":"NOT_STARTED","ordinal":2}],"chosen":"33333333-3333-4333-8333-333333333333","progress":false},{"rows":[{"id":"22222222-2222-4222-8222-222222222222","setup_id":"22222222-2222-4222-8222-222222222222","state":"NOT_STARTED","ordinal":0},{"id":"11111111-1111-4111-8111-111111111111","setup_id":"11111111-1111-4111-8111-111111111111","state":"FINAL","ordinal":0}],"chosen":null,"progress":true},{"rows":[],"chosen":null,"progress":false}]$fixtures$::jsonb) loop
    typed_rows:='pg_catalog.jsonb_populate_recordset(null::bx1_portal.fund_setup_steps,'||pg_catalog.quote_literal((fixture->'rows')::text)||'::jsonb)';
    block_source:='do $typed_query$'||E'\n'||'#variable_conflict error'||E'\n'||
      'declare state text;s bx1_portal.fund_setups;next_step bx1_portal.fund_setup_steps;in_progress boolean;'||
      'begin s.id:=''11111111-1111-4111-8111-111111111111'';'||
      'foreach state in array array[''FINAL'',''NOT_STARTED'',''PREPARED'',null::text] loop '||
      replace(next_query,'bx1_portal.fund_setup_steps candidate_step',typed_rows||' candidate_step')||
      'if next_step.id is distinct from '||pg_catalog.quote_nullable(fixture->>'chosen')||'::uuid then raise exception ''setup_projection_next_step_query_failed'';end if;'||
      'in_progress:='||replace(progress_query,'bx1_portal.fund_setup_steps progress_step',typed_rows||' progress_step')||';'||
      'if in_progress is distinct from '||(fixture->>'progress')||' then raise exception ''setup_projection_progress_query_failed'';end if;'||
      'end loop;end $typed_query$;';
    execute block_source;
  end loop;
  -- Regression counterexample: the original unqualified statement must raise
  -- precisely ambiguous_column in that same local-state/query-only setting.
  old_query:=cuts->0->>'from';
  typed_rows:='pg_catalog.jsonb_populate_recordset(null::bx1_portal.fund_setup_steps,'||
    pg_catalog.quote_literal('[{"id":"33333333-3333-4333-8333-333333333333","setup_id":"11111111-1111-4111-8111-111111111111","state":"NOT_STARTED","ordinal":1}]')||'::jsonb)';
  begin
    execute 'do $old_query$'||E'\n'||'#variable_conflict error'||E'\n'||
      'declare state text:=''FINAL'';s bx1_portal.fund_setups;next_step bx1_portal.fund_setup_steps;'||
      'begin s.id:=''11111111-1111-4111-8111-111111111111'';'||
      replace(old_query,'bx1_portal.fund_setup_steps',typed_rows)||'end $old_query$;';
  exception when ambiguous_column then ambiguous_denied:=true;
  end;
  if not ambiguous_denied then raise exception 'fund_setup_projection_qualification_proof_old_ambiguity_not_reproduced';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from before_claims
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from before_sub then
    raise exception 'fund_setup_projection_qualification_proof_claims_changed';end if;
end $setup_projection_qualification_proof$;

-- Revision 2: the nonce RHS must read the labelled function argument, not the
-- conflicting step-row intent. No setup writer or worker entry is invoked.
do $setup_prepare_nonce_qualification_proof$
declare target oid; metadata jsonb; source text; restored text; rhs text; old_rhs text;
  nonce_value text; row_intent jsonb; block_source text; ambiguous_denied boolean:=false; cases integer:=0;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  old_nonce constant text:=$old_nonce$nonce=(intent->>'nonce')::numeric$old_nonce$;
  new_nonce constant text:=$new_nonce$nonce=(prepare_fund_setup_step.intent->>'nonce')::numeric$new_nonce$;
  target_metadata constant jsonb:=$target_metadata${"oid":"33621","proacl":["postgres=X/postgres","bx1_fund_execution_worker=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"prepare_fund_setup_step","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["preparation","intent"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$target_metadata$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_setup_nonce_qualification_proof_exact_test_owner_required';end if;
  target:=pg_catalog.to_regprocedure('bx1_portal.prepare_fund_setup_step(jsonb,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into metadata,source from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 33621::oid or metadata-'prosrc' is distinct from target_metadata
    or (length(source)-length(replace(source,new_nonce,'')))/length(new_nonce)<>1
    or strpos(source,old_nonce)>0 then
    raise exception 'fund_setup_nonce_qualification_proof_metadata_or_cut_changed';end if;
  restored:=replace(source,new_nonce,old_nonce);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    is distinct from '3c44dc6dc3fbd9f5de71a0599fb33223deaf635629acacd3242d19c9e150260d' then
    raise exception 'fund_setup_nonce_qualification_proof_outside_cut_changed';end if;
  rhs:=substring(source from strpos(source,new_nonce)+length('nonce=') for length(new_nonce)-length('nonce='));
  old_rhs:=substring(restored from strpos(restored,old_nonce)+length('nonce=') for length(old_nonce)-length('nonce='));
  -- Compile the ACTUAL extracted RHS under an identically named local block.
  -- The typed row deliberately has a same-named intent containing a different
  -- nonce or NULL. Numeric precision is checked without floating-point casts.
  foreach nonce_value in array array['0','7','115792089237316195423570985008687907853269984665640564039457584007913129639935'] loop
    foreach row_intent in array array[pg_catalog.jsonb_build_object('nonce','99'),null::jsonb] loop
      block_source:='do $nonce_query$'||E'\n'||'#variable_conflict error'||E'\n'||
        '<<prepare_fund_setup_step>> declare intent jsonb:='||pg_catalog.quote_literal(pg_catalog.jsonb_build_object('nonce',nonce_value)::text)||'::jsonb;actual_nonce numeric;'||
        'begin select '||rhs||' into actual_nonce from (values ('||pg_catalog.quote_nullable(row_intent::text)||'::jsonb)) sample_row(intent);'||
        'if actual_nonce is distinct from '||pg_catalog.quote_literal(nonce_value)||'::numeric then raise exception ''setup_prepare_nonce_argument_value_changed'';end if;'||
        'end prepare_fund_setup_step; $nonce_query$;';
      execute block_source;
      cases:=cases+1;
    end loop;
  end loop;
  if cases<>6 then raise exception 'fund_setup_nonce_qualification_proof_cases_missing';end if;
  -- The old exact RHS is ambiguous with the same local argument and row
  -- column. Catch only 42702; every other compile/runtime error propagates.
  begin
    execute 'do $old_nonce_query$'||E'\n'||'#variable_conflict error'||E'\n'||
      '<<prepare_fund_setup_step>> declare intent jsonb:=''{"nonce":"7"}''::jsonb;actual_nonce numeric;'||
      'begin select '||old_rhs||' into actual_nonce from (values (''{"nonce":"99"}''::jsonb)) sample_row(intent);'||
      'end prepare_fund_setup_step; $old_nonce_query$;';
  exception when ambiguous_column then ambiguous_denied:=true;
  end;
  if not ambiguous_denied then raise exception 'fund_setup_nonce_qualification_proof_old_ambiguity_not_reproduced';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from before_claims
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from before_sub then
    raise exception 'fund_setup_nonce_qualification_proof_claims_changed';end if;
end $setup_prepare_nonce_qualification_proof$;
