-- Current existing Supabase TEST only. Assemble exact reviewed feature/test bytes.
-- Source integrity receipts: manager E1E4DFD32D29342303A54702C751AA212899258452EB6C1266369CFD1E7DAD3D;
-- queue A5516876ABDFA4CD72330FAB8E9A428A06631A3062C593485EF78A9FCE5A9933.
-- This installs guarded definitions, not an authenticated/financial journey.
-- Passwords, MFA secrets, refresh tokens and credential rows are not read.
-- No users, memberships, capacities, policies, factors or business records are seeded.
begin isolation level repeatable read;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local idle_in_transaction_session_timeout='60s';
set local request.jwt.claims='{}';
set local request.jwt.claim.sub='';

do $target$ begin
  if current_user<>'postgres' or session_user<>'postgres' or current_database()<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)') is null
    or pg_catalog.to_regprocedure('bx1_portal.fund_recipient_current(uuid,jsonb,text)') is null
    or pg_catalog.to_regclass('bx1_portal.fund_admission_receipts') is null
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)') is not null
    or pg_catalog.to_regprocedure('bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)') is not null then
    raise exception 'fund_bridge_current_test_target_required' using errcode='55000';end if;
  -- Pin the already-installed TEST issuer, not a browser or fabricated claims.
  if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
    from pg_catalog.pg_proc where oid='bx1_private.test_roleplay_protected_session()'::regprocedure)
    is distinct from 'e183693977b0df93fa12c838bcdea27bfd4e80e91a9a17c611ee31e0bebd5784' then
    raise exception 'fund_bridge_test_project_issuer_changed' using errcode='55000';end if;
  if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
    from pg_catalog.pg_proc where oid='bx1_portal.offering_workflow_approved(uuid)'::regprocedure)
    is distinct from '629d4ed09bc213a99dc20e2367f045dfd2d3bfb9e0068b83eacf091ce3a09825' then
    raise exception 'fund_bridge_approval_dependency_changed' using errcode='55000';end if;
end $target$;

create temporary table bx1_bridge_cuts(signature text primary key,source_hash text not null,expected_after_hash text not null) on commit drop;
insert into pg_temp.bx1_bridge_cuts values
  ('bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)','2266f7763fd51e95d624a8a80d6b817241b8ea1bd399ba41be6a77286132a86f','78fe020c0aba57a0b43f301bc4c1108878cc0c024123aaa50c31492ade1cfb7f'),
  ('bx1_portal.offering_workflow_parent_command(jsonb,text,uuid,jsonb)','0c3922a9aa573c2ba01c6690cbd2b668a07c00f7710af5fbb82642f0b212234b','72622cdda7624e197d0363ee19a6a26ac32b41a9523fb025bdcd83993b62bdf8'),
  ('bx1_portal.execute_command_pre_entry(text,uuid,jsonb)','0ea0a32d3497a02586361c69f1b3dd56e63a30677a4cd7e23b891a6499b3bf17','509d104df875b3c1bca1212dcc2cbd24f3b31de4dd361142586d182ce9329149'),
  ('bx1_private.test_roleplay_role_actions(text)','90bb379a92406b16422f7a6c235548a79166a561014eecd0f97be9aaeee8c08e','2de3ad03e89f4d96dccf0a50058fc238348999aa710dd40daa7f1e8e8d692e72'),
  ('bx1_portal.offering_workflow_context(jsonb)','2e3592ba5615c2e5188eca949d7a94f28ead364ab6347d98fe04d7a9ae2255bd','30f74bec6275b44f338cc99993fba1f5eda021503007755b42b6d187245bf2fe'),
  ('bx1_portal.offering_workflow_operator(jsonb,uuid)','e99eba175755695d07c718ee32f58747aa8e1985ff90e1048315d80940062545','579880eb016d30b25ec3604163a9f22fe86639cd34e23192fa1228d5f385f88e'),
  ('bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)','4a56fb1027de19fdde592377bfe333f604457cb758b7c1061ced66a465870168','d99caee2073d7e9522f8b53e8e228a876940264f559b8a058a407a182e83ada0'),
  ('bx1_portal.test_offering_lock_product_context(jsonb,uuid)','f43fa4c1826ea48715c287feb9b91c58c03a0743523f713895e099108be27f14','02de580a61be4a69c5616e3df9b03b364999873efe569a641a08de83d1f08c99'),
  ('bx1_portal.test_offering_appointment_visible(jsonb,uuid)','b7b5cb312f7cb3f35e2703edcbecae63d781372f3e72c67e3b2962e4dbddd5cc','f04f1a4a664fbd352f194f1cc000369605a84677d709910ff96edf4b608d6037'),
  ('bx1_portal.offering_workflow_appointment_projection(jsonb,uuid)','a1dae90c2f1b37a8f7752c9bc07e663a64fc495041adc2309078200a79e18554','38c8d1b0b8d2bf67b0d7d96200817af3408111aa1aadf56b2028413b61647edc'),
  ('bx1_private.offering_document_manager(jsonb,uuid)','c6f3dc60bd92f96b7893314c533efcad6c1e050f5977b9b64cab8b407c67e55a','1a810fc762aa84bacfdb030c5319bc0c73142d2761a6faf4ab0627de1eca1cd0'),
  ('bx1_private.offering_document_visible(jsonb,uuid)','405ce9bd3c9fc8378ec9eb77ef32e3bbfb84596a03021ce81bb11d7645f79152','c902d6a76e2f9b460fdebaccd7866134586c104d94c2d0d40954145e46387763'),
  ('bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)','87f44d8772eb07e36ff057949def4598ad7704de901292c8842d1a3edc4969a1','d537cf85b5b4ee8488c14cb5a30df9693ee36ccad9d264a5afe385e34125c6a5'),
  ('bx1_portal.offering_workflow_package_projection(jsonb,uuid)','416a3fe61c73d1b5b3f0cf41cf16ef895385763f47dc4732a5dd5dadfeffc8f3','575de24944154c7e4942345191731e89a2735ef3ff31772670508007b97640bd'),
  ('bx1_portal.read_scoped(jsonb)','d1295f00833a24fba3c9ccb0295929ec5e3a77a4ee1c808daa27c3cf8f4fc3d4','b2302b13a807ee87ddd5ef19923841d880369ad69e514a5330426b504c961c0d'),
  ('bx1_portal.offering_workflow_read_scoped(jsonb)','9d45d7c415daa66182191e0340c3f98f02948f393cd3deacd8b14fbea369706f','def1621971b1f0268c42f4a9dff36f9a9c23b828c5905cd1f6f4b55be11b7d6d'),
  ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)','47393ea3761c03dd8ef4ecfefa609c83330738e363e1e49ba29dead40751c85a','8fee52076847a861a51b598571efcf40335ef6ebad2c284b979258ab6f8fc0c2'),
  ('bx1_portal.fund_order_visible(jsonb,uuid)','2ef727f06db41cb915fa29011abee237e65e20533688e2590724084dd72fd6d3','3fd013724c327dcdf112cfd1a91f3d53abd571f39d01b7d75017f116e7e25336');
create temporary table bx1_bridge_new_helpers(signature text primary key,expected_hash text not null) on commit drop;
insert into pg_temp.bx1_bridge_new_helpers values
  ('bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)','593f8a07b79dd88c5952d3d4b620eef81125a3270b1e56c344481e17dfb10ec8'),
  ('bx1_private.fund_roleplay_manager_scope(jsonb)','6ce794b8e07f3f6088e2187f57c032abcab0f633905234046fb1dfaf6e6463ba'),
  ('bx1_private.fund_roleplay_manager_command_operator(jsonb,uuid)','540aa4c116b7fdab9cd82d70b30c1f71cdfb533288605c7c32a4ecb80ac00bb9'),
  ('bx1_private.fund_roleplay_manager_offering_approved(jsonb,uuid)','8ffeef89c1d62ba2db8d7bf23b1508549c92a67a0ee8973b86c697126081c29d'),
  ('bx1_private.fund_roleplay_manager_actions(jsonb,uuid)','bf5dea1c1342050c053b9164e85d32c5e4ed5a0961f06e26bbe564f1b3738498'),
  ('bx1_private.fund_roleplay_manager_read(jsonb)','f98636368070087a92b0edc836985e47d209e021f3c01fc84705924b892db6f9'),
  ('bx1_private.fund_roleplay_manager_publish_lane(uuid,uuid,jsonb)','33f14798292ebf6eef59f8250374aed42aeebada887af469f086e67a04cade0f'),
  ('bx1_private.fund_roleplay_manager_publish(jsonb,uuid,jsonb)','e79c2e35919f4086f487847be7daec858d198d143fee7f40e6166d162233f866'),
  ('bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)','ff031dc882dad209b446ba24c90301dbd9e99e7957a401d0d45d71bb133a70f3');

do $pins$ declare cut record;begin
  for cut in select * from pg_temp.bx1_bridge_cuts loop
    if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
      from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(cut.signature)) is distinct from cut.source_hash then
      raise exception 'fund_bridge_native_pin_changed: %',cut.signature using errcode='55000';end if;
  end loop;
  if exists(select 1 from pg_temp.bx1_bridge_new_helpers h where pg_catalog.to_regprocedure(h.signature) is not null) then
    raise exception 'fund_bridge_new_helper_already_present' using errcode='55000';end if;
end $pins$;

create temporary table bx1_bridge_functions on commit drop as
  select p.oid,p.oid::regprocedure::text signature,exists(select 1 from pg_temp.bx1_bridge_cuts cut
    where pg_catalog.to_regprocedure(cut.signature)=p.oid) is_cut,
    case when exists(select 1 from pg_temp.bx1_bridge_cuts cut where pg_catalog.to_regprocedure(cut.signature)=p.oid)
      then pg_catalog.to_jsonb(p)-'prosrc' else pg_catalog.to_jsonb(p) end fingerprint
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('bx1_private','bx1_portal','auth') or (n.nspname='public' and pg_catalog.left(p.proname,4)='bx1_');
create temporary table bx1_bridge_schema_acl on commit drop as
  select oid,nspowner,nspacl from pg_catalog.pg_namespace where nspname in ('public','bx1_private','bx1_portal','auth','storage');
create temporary table bx1_bridge_role_edges on commit drop as select * from pg_catalog.pg_auth_members;
create temporary table bx1_bridge_relations on commit drop as
  select c.oid,n.nspname,c.relname,pg_catalog.jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,'kind',c.relkind,'persistence',c.relpersistence,'namespace',c.relnamespace) metadata,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.attnum),'[]'::jsonb)
      from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0) attributes,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.indexrelid),'[]'::jsonb)
      from pg_catalog.pg_index i where i.indrelid=c.oid) indexes,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(k) order by k.oid),'[]'::jsonb)
      from pg_catalog.pg_constraint k where k.conrelid=c.oid) constraints,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.oid),'[]'::jsonb)
      from pg_catalog.pg_trigger t where t.tgrelid=c.oid) triggers
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('bx1_private','bx1_portal','auth') or (n.nspname='public' and pg_catalog.left(c.relname,4)='bx1_');

create temporary table bx1_bridge_data(relation oid primary key,relation_name text not null,projection text not null,
  row_count bigint not null,digest text not null) on commit drop;
do $data_before$ declare r record;projection text;n bigint;h text;begin
  for r in select c.oid,n.nspname,c.relname,pg_catalog.has_table_privilege(current_user,c.oid,'UPDATE')
    or pg_catalog.has_table_privilege(current_user,c.oid,'DELETE') can_share_lock
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and (
      n.nspname='bx1_portal'
      or (n.nspname='public' and c.relname in ('bx1_profiles','bx1_memberships','bx1_organisations','bx1_wallets'))
      or (n.nspname='bx1_private' and (c.relname in ('persons','principals','user_principals','wallet_challenges',
        'test_workspace_sources','test_workspace_entitlements','test_workspace_product_commands')
        or pg_catalog.left(c.relname,9)='roleplay_' or pg_catalog.left(c.relname,14)='fund_roleplay_'))
      or (n.nspname='auth' and c.relname in ('users','sessions','mfa_factors')))
    order by c.oid loop
    -- Existing read-only identity/wallet ACLs are not broadened just to lock.
    -- A repeatable-read digest detects this install's own writes; unrelated
    -- external identity updates are outside that preserved transaction snapshot.
    execute pg_catalog.format('lock table %s in %s mode',r.oid::regclass,case when r.can_share_lock then 'share' else 'access share' end);
    if r.nspname='auth' and r.relname='users' then
      projection:='pg_catalog.jsonb_build_object(''id'',t.id,''email'',t.email,''role'',t.role,''is_super_admin'',t.is_super_admin,''email_confirmed_at'',t.email_confirmed_at,''phone_confirmed_at'',t.phone_confirmed_at,''invited_at'',t.invited_at,''last_sign_in_at'',t.last_sign_in_at,''created_at'',t.created_at,''updated_at'',t.updated_at,''banned_until'',t.banned_until,''deleted_at'',t.deleted_at,''is_anonymous'',t.is_anonymous)';
    elsif r.nspname='auth' and r.relname='sessions' then
      projection:='pg_catalog.jsonb_build_object(''id'',t.id,''user_id'',t.user_id,''factor_id'',t.factor_id,''aal'',t.aal,''not_after'',t.not_after,''created_at'',t.created_at,''updated_at'',t.updated_at)';
    elsif r.nspname='auth' and r.relname='mfa_factors' then
      projection:='pg_catalog.jsonb_build_object(''id'',t.id,''user_id'',t.user_id,''factor_type'',t.factor_type,''status'',t.status,''friendly_name'',t.friendly_name,''created_at'',t.created_at,''updated_at'',t.updated_at)';
    else
      projection:='pg_catalog.to_jsonb(t)-array[''password'',''encrypted_password'',''secret'',''provider_secret'',''access_token'',''refresh_token'',''private_key'',''wallet_password'']';
    end if;
    execute pg_catalog.format('select count(*),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(row_hash,'','' order by row_hash),''''),''UTF8'')),''hex'') from (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((%s)::text,''UTF8'')),''hex'') row_hash from %s t) rows',projection,r.oid::regclass) into n,h;
    insert into pg_temp.bx1_bridge_data values(r.oid,r.nspname||'.'||r.relname,projection,n,h);
  end loop;
end $data_before$;

-- INSERT_FEATURE_MANAGER_BRIDGE
-- Exact supabase/features/bx1_fund_roleplay_manager_bridge.sql bytes.
-- INSERT_FEATURE_RECIPIENT_COMPLIANCE_QUEUE
-- Exact supabase/features/bx1_fund_recipient_compliance_queue.sql bytes.
-- INSERT_NEGATIVE_MANAGER_BRIDGE
-- Exact supabase/tests/bx1_fund_roleplay_manager_bridge.sql bytes.
-- INSERT_NEGATIVE_RECIPIENT_COMPLIANCE_QUEUE
-- Exact supabase/tests/bx1_fund_recipient_compliance_queue.sql bytes.
set local request.jwt.claims='{}';
set local request.jwt.claim.sub='';

do $preservation$ declare saved record;actual jsonb;proc record;n bigint;h text;begin
  for saved in select * from pg_temp.bx1_bridge_cuts loop
    if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
      from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(saved.signature)) is distinct from saved.expected_after_hash then
      raise exception 'fund_bridge_exact_expected_cutover_not_installed: %',saved.signature;end if;
  end loop;
  for saved in select * from pg_temp.bx1_bridge_functions loop
    select case when saved.is_cut then pg_catalog.to_jsonb(p)-'prosrc' else pg_catalog.to_jsonb(p) end into actual
      from pg_catalog.pg_proc p where p.oid=saved.oid;
    if actual is distinct from saved.fingerprint then
      raise exception 'fund_bridge_existing_function_metadata_or_source_changed: %',saved.signature;end if;
  end loop;
  for proc in select p.oid,p.oid::regprocedure::text signature,p.proowner,p.prosecdef,p.proconfig,p.proacl
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace ns on ns.oid=p.pronamespace
    where (ns.nspname in ('bx1_private','bx1_portal','auth') or (ns.nspname='public' and pg_catalog.left(p.proname,4)='bx1_'))
      and not exists(select 1 from pg_temp.bx1_bridge_functions old_proc where old_proc.oid=p.oid) loop
    if not exists(select 1 from pg_temp.bx1_bridge_new_helpers allowed where pg_catalog.to_regprocedure(allowed.signature)=proc.oid)
      or proc.proowner<>'postgres'::regrole or not proc.prosecdef or proc.proconfig is distinct from array['search_path=""']::text[]
      or proc.proacl::text is distinct from '{postgres=X/postgres}' then
      raise exception 'fund_bridge_unexpected_or_exposed_new_function: %',proc.signature;end if;
  end loop;
  if (select count(*) from pg_temp.bx1_bridge_new_helpers h where pg_catalog.to_regprocedure(h.signature) is not null)<>9 then
    raise exception 'fund_bridge_expected_nine_helpers_not_installed';end if;
  for saved in select * from pg_temp.bx1_bridge_new_helpers loop
    if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
      from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(saved.signature)) is distinct from saved.expected_hash then
      raise exception 'fund_bridge_exact_expected_helper_not_installed: %',saved.signature;end if;
  end loop;
  if exists(select 1 from pg_temp.bx1_bridge_schema_acl old_acl full join
    (select oid,nspowner,nspacl from pg_catalog.pg_namespace where nspname in ('public','bx1_private','bx1_portal','auth','storage')) new_acl using(oid)
    where pg_catalog.to_jsonb(old_acl) is distinct from pg_catalog.to_jsonb(new_acl))
    or exists((select * from pg_catalog.pg_auth_members except select * from pg_temp.bx1_bridge_role_edges)
      union all (select * from pg_temp.bx1_bridge_role_edges except select * from pg_catalog.pg_auth_members)) then
    raise exception 'fund_bridge_schema_acl_or_role_membership_edges_changed';end if;
  for saved in select * from pg_temp.bx1_bridge_relations loop
    select pg_catalog.jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
      'force_rls',c.relforcerowsecurity,'kind',c.relkind,'persistence',c.relpersistence,'namespace',c.relnamespace) into actual
      from pg_catalog.pg_class c where c.oid=saved.oid;
    if actual is distinct from saved.metadata
      or saved.attributes is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.attnum),'[]'::jsonb)
        from pg_catalog.pg_attribute a where a.attrelid=saved.oid and a.attnum>0)
      or saved.indexes is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.indexrelid),'[]'::jsonb)
        from pg_catalog.pg_index i where i.indrelid=saved.oid)
      or saved.constraints is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(k) order by k.oid),'[]'::jsonb)
        from pg_catalog.pg_constraint k where k.conrelid=saved.oid)
      or saved.triggers is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.oid),'[]'::jsonb)
        from pg_catalog.pg_trigger t where t.tgrelid=saved.oid) then
      raise exception 'fund_bridge_existing_relation_definition_changed: %.%',saved.nspname,saved.relname;end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
    where (ns.nspname in ('bx1_private','bx1_portal','auth') or (ns.nspname='public' and pg_catalog.left(c.relname,4)='bx1_'))
      and not exists(select 1 from pg_temp.bx1_bridge_relations original where original.oid=c.oid)) then
    raise exception 'fund_bridge_unexpected_persistent_relation';end if;
  for saved in select * from pg_temp.bx1_bridge_data loop
    execute pg_catalog.format('select count(*),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(row_hash,'','' order by row_hash),''''),''UTF8'')),''hex'') from (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((%s)::text,''UTF8'')),''hex'') row_hash from %s t) rows',saved.projection,saved.relation::regclass) into n,h;
    if n<>saved.row_count or h is distinct from saved.digest then
      raise exception 'fund_bridge_existing_records_or_count_changed: %',saved.relation_name;end if;
  end loop;
  if auth.uid() is not null or current_user<>'postgres' or session_user<>'postgres'
    or pg_catalog.current_setting('request.jwt.claims',true) is distinct from '{}'
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from '' then
    raise exception 'fund_bridge_owner_or_auth_context_not_cleared';end if;
end $preservation$;
commit;
select 'INSTALLED_TEST_MANAGER_RECIPIENT_DEFINITIONS_AND_NEGATIVES_ONLY_NOT_HOSTED_JOURNEY' status;
