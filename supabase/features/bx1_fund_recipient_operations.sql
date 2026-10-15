-- Connected canonical recipient operations in TEST only. No customer, claim,
-- role, wallet proof, chain effect or holding is seeded. Apply atomically after
-- the reviewed role-play/admission overlays. One exact nonce-counter seam is
-- cut over in place; existing writer OIDs, owners and ACLs remain unchanged.
do $baseline$ begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regclass('bx1_portal.fund_recipient_cases') is not null
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_context(jsonb,uuid,text)') is null
    or pg_catalog.to_regprocedure('bx1_portal.fund_manifest_current(uuid)') is null then
    raise exception 'fund_recipient_exact_test_baseline_required' using errcode='55000';end if;
end $baseline$;

create table bx1_portal.fund_recipient_cases (
  id uuid primary key default pg_catalog.gen_random_uuid(),revision integer not null default 1 check(revision>0),
  product_id uuid not null references bx1_portal.products(id),offering_revision_id uuid not null,
  manifest_id uuid not null references bx1_portal.fund_release_manifests(id),
  investment_account_id uuid not null references bx1_portal.investment_accounts(id),
  delivery_binding_id uuid not null references bx1_portal.fund_delivery_bindings(id),
  holder_user_id uuid not null references auth.users(id),wallet_proof_id uuid not null,
  wallet_address text not null check(wallet_address ~ '^0x[0-9a-f]{40}$'),
  eligibility_case_id uuid not null references bx1_portal.product_eligibility_cases(id),eligibility_revision integer not null check(eligibility_revision>0),
  claim_topic text not null check(claim_topic ~ '^[1-9][0-9]{0,77}$'),claim_signer_address text not null check(claim_signer_address ~ '^0x[0-9a-f]{40}$'),
  country_alpha2 text not null check(country_alpha2 ~ '^[A-Z]{2}$'),country_code integer not null check(country_code between 1 and 999),
  product_binding_hash text not null,account_binding_hash text not null,eligibility_binding_hash text not null,
  claim_valid_until timestamptz not null,identity_address text check(identity_address ~ '^0x[0-9a-f]{40}$'),
  state text not null default 'IDENTITY_REQUIRED' check(state in ('IDENTITY_REQUIRED','CLAIM_SIGNATURE_REQUIRED','CLAIM_INSTALL_REQUIRED','REGISTRATION_REQUIRED','READY','REVOKED','RECOVERY_REQUIRED')),
  pending_signature_id uuid,claim_signature_id uuid,registration_observation_id uuid,roleplay_policy_id uuid references bx1_private.roleplay_policies(id),roleplay_epoch integer,
  created_by uuid not null references auth.users(id),created_context jsonb not null,created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id),
  check((roleplay_policy_id is null)=(roleplay_epoch is null)),
  unique(product_id,offering_revision_id,investment_account_id,delivery_binding_id)
);
create table bx1_portal.fund_recipient_operations (
  id uuid primary key default pg_catalog.gen_random_uuid(),case_id uuid not null references bx1_portal.fund_recipient_cases(id),
  revision integer not null default 1 check(revision>0),phase text not null check(phase in ('CREATE_IDENTITY','ADD_CLAIM','REGISTER_IDENTITY','REVOKE_CLAIM')),
  actor_id uuid not null references auth.users(id),operating_context jsonb not null,actor_claims jsonb not null,
  request_key uuid not null,sender_address text not null check(sender_address ~ '^0x[0-9a-f]{40}$'),
  state text not null default 'REQUESTED' check(state in ('REQUESTED','PREPARED','UNKNOWN','BROADCAST','PENDING','FINAL','FAILED','RECOVERY_REQUIRED')),
  expectation jsonb,intent jsonb,intent_hash text,sender_nonce numeric(78,0),safe_nonce numeric(78,0),
  expires_at timestamptz not null,claimed_at timestamptz,transaction_hash text,observation_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),unique(actor_id,request_key),
  check((intent is null)=(intent_hash is null)),check(transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  check(state='REQUESTED' or (intent is not null and expectation is not null and sender_nonce is not null)),
  check(state not in ('BROADCAST','PENDING','FINAL','FAILED') or transaction_hash is not null)
);
create unique index fund_recipient_sender_nonce on bx1_portal.fund_recipient_operations(sender_address,sender_nonce) where sender_nonce is not null;
create unique index fund_recipient_one_active_phase on bx1_portal.fund_recipient_operations(case_id,phase) where state not in ('FAILED','FINAL');
create table bx1_portal.fund_recipient_claim_signatures (
  id uuid primary key default pg_catalog.gen_random_uuid(),case_id uuid not null references bx1_portal.fund_recipient_cases(id),
  case_revision integer not null,actor_id uuid not null references auth.users(id),operating_context jsonb not null,
  signature text not null check(signature ~ '^0x[0-9a-f]{130}$'),
  actor_claims jsonb not null,expires_at timestamptz not null,request_key uuid not null,
  proof jsonb not null,proof_hash text not null,created_at timestamptz not null default pg_catalog.clock_timestamp(),unique(actor_id,request_key)
);
create table bx1_portal.fund_recipient_claim_verifications (
  signature_id uuid primary key references bx1_portal.fund_recipient_claim_signatures(id),proof jsonb not null,proof_hash text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_portal.fund_recipient_safe_signatures (
  id uuid primary key default pg_catalog.gen_random_uuid(),operation_id uuid not null references bx1_portal.fund_recipient_operations(id),
  actor_id uuid not null references auth.users(id),operating_context jsonb not null,actor_claims jsonb not null,
  authority_id uuid not null references bx1_portal.fund_authorities(id),signing_address text not null,signature text not null,
  intent_hash text not null,created_at timestamptz not null default pg_catalog.clock_timestamp(),unique(operation_id,signing_address),
  check(signing_address ~ '^0x[0-9a-f]{40}$' and signature ~ '^0x[0-9a-f]{130}$')
);
create table bx1_portal.fund_recipient_safe_verifications (
  signature_id uuid primary key references bx1_portal.fund_recipient_safe_signatures(id),proof jsonb not null,proof_hash text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_portal.fund_recipient_observations (
  id uuid primary key default pg_catalog.gen_random_uuid(),operation_id uuid not null references bx1_portal.fund_recipient_operations(id),
  result jsonb not null,result_hash text not null,created_at timestamptz not null default pg_catalog.clock_timestamp(),unique(operation_id,result_hash)
);
create table bx1_portal.fund_recipient_requests (
  actor_id uuid not null references auth.users(id),request_key uuid not null,command text not null,payload jsonb not null,operating_context jsonb not null,
  case_id uuid not null references bx1_portal.fund_recipient_cases(id),created_at timestamptz not null default pg_catalog.clock_timestamp(),primary key(actor_id,request_key)
);
create table bx1_portal.fund_recipient_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),case_id uuid not null references bx1_portal.fund_recipient_cases(id),
  operation_id uuid references bx1_portal.fund_recipient_operations(id),actor_id uuid not null references auth.users(id),operating_context jsonb not null,
  action text not null,details_hash text not null,recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
do $tables$ declare name text;begin
  foreach name in array array['fund_recipient_cases','fund_recipient_operations','fund_recipient_claim_signatures','fund_recipient_claim_verifications','fund_recipient_safe_signatures','fund_recipient_safe_verifications','fund_recipient_observations','fund_recipient_requests','fund_recipient_events'] loop
    execute pg_catalog.format('alter table bx1_portal.%I enable row level security',name);
    execute pg_catalog.format('revoke all on bx1_portal.%I from public,anon,authenticated,service_role,bx1_fund_execution_worker',name);
    if name not in ('fund_recipient_cases','fund_recipient_operations') then execute pg_catalog.format('create trigger %I before update or delete on bx1_portal.%I for each row execute function bx1_portal.immutable_record()',name||'_immutable',name);end if;
  end loop;
end $tables$;

-- The private native wallet owner locks only identifiers/current provenance.
-- This helper is executable by postgres alone, not a browser or worker. A
-- reviewer may lock a saved beneficiary proof without impersonating its owner.
create temporary table bx1_recipient_wallet_edges on commit drop as
 select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
 where roleid='bx1_wallet_owner'::regrole and member=current_user::regrole;
create temporary table bx1_recipient_wallet_schema on commit drop as
 select not pg_catalog.has_schema_privilege('bx1_wallet_owner','bx1_private','CREATE') added_create,
  (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb)
   from pg_catalog.aclexplode(nspacl) a) original_acl from pg_catalog.pg_namespace where nspname='bx1_private';
grant bx1_wallet_owner to current_user with inherit true,set true granted by current_user;
do $$ begin if (select added_create from pg_temp.bx1_recipient_wallet_schema) then grant create on schema bx1_private to bx1_wallet_owner;end if;end $$;
set local role bx1_wallet_owner;
create function bx1_private.lock_fund_recipient_wallet(holder uuid,wallet uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare proof uuid;
begin
 select last_proof_id into proof from public.bx1_wallets where id=wallet and user_id=holder and chain_id=80002 and verified_at is not null for share;
 if proof is null then raise exception 'fund_recipient_current_native_wallet_required' using errcode='42501';end if;
 perform id from bx1_private.wallet_challenges where id=proof and user_id=holder and used_at is not null and proof_signature is not null for share;
 if not found then raise exception 'fund_recipient_consumed_native_proof_required' using errcode='42501';end if;
end $$;
revoke all on function bx1_private.lock_fund_recipient_wallet(uuid,uuid) from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;
grant execute on function bx1_private.lock_fund_recipient_wallet(uuid,uuid) to postgres;
reset role;
do $restore_recipient_wallet$
declare edge record;actual jsonb;expected jsonb;
begin
 if (select added_create from pg_temp.bx1_recipient_wallet_schema) then revoke create on schema bx1_private from bx1_wallet_owner;end if;
 select original_acl into expected from pg_temp.bx1_recipient_wallet_schema;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) into actual
  from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(n.nspacl) a where n.nspname='bx1_private';
 if actual is distinct from expected then raise exception 'fund_recipient_wallet_schema_acl_not_restored';end if;
 select * into edge from pg_temp.bx1_recipient_wallet_edges where grantor=current_user::regrole;
 if found then execute pg_catalog.format('grant bx1_wallet_owner to %I with admin %s,inherit %s,set %s granted by %I',current_user,
  edge.admin_option::text,edge.inherit_option::text,edge.set_option::text,current_user);
 else execute pg_catalog.format('revoke bx1_wallet_owner from %I granted by %I',current_user,current_user);end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into expected from pg_temp.bx1_recipient_wallet_edges e;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into actual from
  (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
   where roleid='bx1_wallet_owner'::regrole and member=current_user::regrole) e;
 if actual is distinct from expected then raise exception 'fund_recipient_wallet_owner_edges_not_restored';end if;
end $restore_recipient_wallet$;

-- Pinned CLDR48 numeric mapping for every existing alpha-2 application option.
-- Reference data only, not a country eligibility or regulatory decision.
-- https://github.com/unicode-org/cldr-json/blob/48.0.0/cldr-json/cldr-core/supplemental/codeMappings.json
create function bx1_portal.fund_recipient_country(alpha2 text) returns integer language sql immutable set search_path='' as $$
 select ('{"AD":20,"AE":784,"AF":4,"AG":28,"AI":660,"AL":8,"AM":51,"AO":24,"AQ":10,"AR":32,"AS":16,"AT":40,"AU":36,"AW":533,"AX":248,"AZ":31,"BA":70,"BB":52,"BD":50,"BE":56,"BF":854,"BG":100,"BH":48,"BI":108,"BJ":204,"BL":652,"BM":60,"BN":96,"BO":68,"BQ":535,"BR":76,"BS":44,"BT":64,"BV":74,"BW":72,"BY":112,"BZ":84,"CA":124,"CC":166,"CD":180,"CF":140,"CG":178,"CH":756,"CI":384,"CK":184,"CL":152,"CM":120,"CN":156,"CO":170,"CR":188,"CU":192,"CV":132,"CW":531,"CX":162,"CY":196,"CZ":203,"DE":276,"DJ":262,"DK":208,"DM":212,"DO":214,"DZ":12,"EC":218,"EE":233,"EG":818,"EH":732,"ER":232,"ES":724,"ET":231,"FI":246,"FJ":242,"FK":238,"FM":583,"FO":234,"FR":250,"GA":266,"GB":826,"GD":308,"GE":268,"GF":254,"GG":831,"GH":288,"GI":292,"GL":304,"GM":270,"GN":324,"GP":312,"GQ":226,"GR":300,"GS":239,"GT":320,"GU":316,"GW":624,"GY":328,"HK":344,"HM":334,"HN":340,"HR":191,"HT":332,"HU":348,"ID":360,"IE":372,"IL":376,"IM":833,"IN":356,"IO":86,"IQ":368,"IR":364,"IS":352,"IT":380,"JE":832,"JM":388,"JO":400,"JP":392,"KE":404,"KG":417,"KH":116,"KI":296,"KM":174,"KN":659,"KP":408,"KR":410,"KW":414,"KY":136,"KZ":398,"LA":418,"LB":422,"LC":662,"LI":438,"LK":144,"LR":430,"LS":426,"LT":440,"LU":442,"LV":428,"LY":434,"MA":504,"MC":492,"MD":498,"ME":499,"MF":663,"MG":450,"MH":584,"MK":807,"ML":466,"MM":104,"MN":496,"MO":446,"MP":580,"MQ":474,"MR":478,"MS":500,"MT":470,"MU":480,"MV":462,"MW":454,"MX":484,"MY":458,"MZ":508,"NA":516,"NC":540,"NE":562,"NF":574,"NG":566,"NI":558,"NL":528,"NO":578,"NP":524,"NR":520,"NU":570,"NZ":554,"OM":512,"PA":591,"PE":604,"PF":258,"PG":598,"PH":608,"PK":586,"PL":616,"PM":666,"PN":612,"PR":630,"PS":275,"PT":620,"PW":585,"PY":600,"QA":634,"RE":638,"RO":642,"RS":688,"RU":643,"RW":646,"SA":682,"SB":90,"SC":690,"SD":729,"SE":752,"SG":702,"SH":654,"SI":705,"SJ":744,"SK":703,"SL":694,"SM":674,"SN":686,"SO":706,"SR":740,"SS":728,"ST":678,"SV":222,"SX":534,"SY":760,"SZ":748,"TC":796,"TD":148,"TF":260,"TG":768,"TH":764,"TJ":762,"TK":772,"TL":626,"TM":795,"TN":788,"TO":776,"TR":792,"TT":780,"TV":798,"TW":158,"TZ":834,"UA":804,"UG":800,"UM":581,"US":840,"UY":858,"UZ":860,"VA":336,"VC":670,"VE":862,"VG":92,"VI":850,"VN":704,"VU":548,"WF":876,"WS":882,"YE":887,"YT":175,"ZA":710,"ZM":894,"ZW":716}'::jsonb->>alpha2)::integer;
$$;
create function bx1_portal.fund_recipient_action(phase text) returns text language sql immutable set search_path='' as $$
 select case phase when 'CREATE_IDENTITY' then 'bind_fund_delivery_wallet' when 'ADD_CLAIM' then 'bind_fund_delivery_wallet'
  when 'CLAIM_SIGNATURE' then 'review_product_eligibility' when 'REGISTER_IDENTITY' then 'record_fund_signature' when 'REVOKE_CLAIM' then 'revoke_product_eligibility' end;
$$;
create function bx1_portal.fund_recipient_session() returns boolean language plpgsql volatile security definer set search_path='' as $$
begin return coalesce(auth.uid() is not null and auth.jwt()->>'iss'='https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
 and auth.jwt()->>'role'='authenticated' and auth.jwt()->>'aal'='aal2' and bx1_portal.fresh_session()
 and bx1_private.has_session_mfa() and bx1_private.has_token_mfa()
 and exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
 and exists(select 1 from auth.users u join public.bx1_profiles p on p.id=u.id join auth.sessions s on s.user_id=u.id
  join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id where u.id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
  and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp' and p.status='ACTIVE'
  and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())),false);exception when others then return false;end $$;
create function bx1_portal.fund_recipient_visible(cid uuid,c jsonb) returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(exists(select 1 from bx1_portal.fund_recipient_cases r join bx1_portal.fund_release_manifests m on m.id=r.manifest_id
  where r.id=cid and auth.uid() is not null and exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
  and (bx1_portal.fund_context(c,false) or bx1_private.fund_roleplay_visible(c,r.product_id)) and (
   (r.holder_user_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
   or (c->>'mode'='ROLE' and c->>'organisationId'=m.native_organisation_id::text and c->>'role' in ('ComplianceOfficer','TokenisationAgent')
    and (bx1_portal.fund_product_visible(c,r.product_id) or bx1_private.fund_roleplay_visible(c,r.product_id))))),false);
$$;
create function bx1_portal.fund_recipient_current(cid uuid,c jsonb,phase text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;m bx1_portal.fund_release_manifests;policy uuid;action text;
begin
 select * into r from bx1_portal.fund_recipient_cases where id=cid;select * into m from bx1_portal.fund_release_manifests where id=r.manifest_id;
 action:=bx1_portal.fund_recipient_action(phase);
 if r.id is null or action is null or bx1_portal.fund_recipient_visible(cid,c) is not true or bx1_portal.fund_recipient_session() is not true
  or bx1_portal.fund_manifest_current(m.id) is not true then return false;end if;
 if phase<>'REVOKE_CLAIM' and (r.claim_valid_until<=pg_catalog.clock_timestamp() or not exists(select 1 from bx1_portal.product_eligibility_cases e
  where e.id=r.eligibility_case_id and e.revision=r.eligibility_revision and e.investment_account_id=r.investment_account_id
   and e.product_id=r.product_id and e.offering_revision_id=r.offering_revision_id and bx1_portal.product_eligibility_current(e.id))
  or bx1_portal.fund_binding_current(r.delivery_binding_id) is not true) then return false;end if;
 if r.roleplay_policy_id is not null and bx1_private.test_roleplay_current(r.roleplay_policy_id,r.product_id,r.offering_revision_id,
   auth.uid(),c,action,null,r.roleplay_epoch) is not true then return false;end if;
 if phase in ('CREATE_IDENTITY','ADD_CLAIM') then return r.holder_user_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor');end if;
 if c->>'mode'<>'ROLE' or c->>'organisationId' is distinct from m.native_organisation_id::text then return false;end if;
 if phase in ('CLAIM_SIGNATURE','REVOKE_CLAIM') then
  if c->>'role' is distinct from 'ComplianceOfficer' then return false;end if;
  return bx1_private.fund_roleplay_context(c,r.product_id,action) or exists(select 1 from bx1_portal.fund_signer_policies s
   where s.manifest_id=m.id and bx1_portal.fund_authority(c,s.id,'ComplianceOfficer') is not null);
 end if;
 return c->>'role'='TokenisationAgent' and (bx1_private.fund_roleplay_context(c,r.product_id,action)
  or exists(select 1 from bx1_portal.fund_signer_policies s where s.manifest_id=m.id and bx1_portal.fund_authority(c,s.id,'TokenisationAgent') is not null));
exception when others then return false;end $$;
create function bx1_portal.fund_recipient_lock(cid uuid,c jsonb,phase text) returns void language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;action text;wallet record;matched integer:=0;
begin
 select * into r from bx1_portal.fund_recipient_cases where id=cid;action:=bx1_portal.fund_recipient_action(phase);
 if bx1_portal.fund_recipient_current(cid,c,phase) is not true then raise exception 'fund_recipient_current_scope_required' using errcode='42501';end if;
 if r.roleplay_policy_id is not null then perform bx1_private.test_roleplay_lock(c,r.product_id,action,null);
 else perform bx1_portal.admission_lock_actor(null,c);end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund:'||r.product_id::text,0));
 perform id from bx1_portal.products where id=r.product_id for update;
 perform id from bx1_portal.fund_release_manifests where id=r.manifest_id for share;
 perform id from bx1_portal.investment_accounts where id=r.investment_account_id for share;
 perform app.id from bx1_portal.applications app join bx1_portal.investment_accounts a on a.application_id=app.id where a.id=r.investment_account_id for share of app;
 perform id from bx1_portal.product_eligibility_cases where id=r.eligibility_case_id for share;
 perform id from bx1_portal.fund_delivery_bindings where id=r.delivery_binding_id for share;
 if phase<>'REVOKE_CLAIM' then perform bx1_private.lock_fund_recipient_wallet(r.holder_user_id,r.wallet_proof_id);end if;
 if phase in ('CLAIM_SIGNATURE','REVOKE_CLAIM','REGISTER_IDENTITY') then
  for wallet in select w.id from public.bx1_wallets w join bx1_portal.fund_release_manifests m on m.id=r.manifest_id
   where w.user_id=auth.uid() and w.chain_id=80002 and w.verified_at is not null
    and ((phase in ('CLAIM_SIGNATURE','REVOKE_CLAIM') and w.address=r.claim_signer_address)
      or (phase='REGISTER_IDENTITY' and m.deployment_expectation#>'{manifest,safe,owners}' ? w.address)) order by w.id loop
   perform bx1_private.lock_fund_recipient_wallet(auth.uid(),wallet.id);matched:=matched+1;
  end loop;
  if matched=0 then raise exception 'fund_recipient_current_signing_wallet_required' using errcode='42501';end if;
 end if;
 perform id from auth.users where id=auth.uid() for share;perform id from public.bx1_profiles where id=auth.uid() for share;
 perform s.id from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' for share;
 perform f.id from auth.mfa_factors f join auth.sessions s on s.factor_id=f.id where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' for share of f;
 perform id from bx1_portal.fund_recipient_cases where id=cid for update;
 if bx1_portal.fund_recipient_current(cid,c,phase) is not true then raise exception 'fund_recipient_authority_changed_after_wait' using errcode='42501';end if;
end $$;
create function bx1_portal.fund_recipient_audit(cid uuid,oid uuid,action text,c jsonb,details jsonb) returns void language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;begin select * into strict r from bx1_portal.fund_recipient_cases where id=cid;
 insert into bx1_portal.fund_recipient_events(case_id,operation_id,actor_id,operating_context,action,details_hash) values(cid,oid,auth.uid(),c,action,bx1_portal.fund_digest(details));
 perform bx1_portal.fund_audit(r.product_id,coalesce(oid,cid),null,action,c,null,r.revision,null,details||pg_catalog.jsonb_build_object('recipient_case_id',cid,'no_eligibility_or_ownership_granted',true));
end $$;
create function bx1_portal.fund_recipient_projection(cid uuid,c jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;operations jsonb;
begin
 if bx1_portal.fund_recipient_visible(cid,c) is not true then raise exception 'fund_recipient_read_denied' using errcode='42501';end if;
 select * into strict r from bx1_portal.fund_recipient_cases where id=cid;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'revision',o.revision,'phase',o.phase,'state',o.state,
  'actor_id',o.actor_id,'operating_context',o.operating_context,'sender_address',o.sender_address,'expires_at',o.expires_at,'transaction_hash',o.transaction_hash,
  'intent',case when bx1_portal.fund_recipient_current(cid,c,o.phase) and ((o.actor_id=auth.uid() and o.operating_context=c) or o.phase='REGISTER_IDENTITY') then o.intent else null end,
  'signatures',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',sig.id,'actor_id',sig.actor_id,'signing_address',sig.signing_address,
    'status',case when verified.signature_id is null then 'UNVERIFIED' else 'VERIFIED' end) order by sig.signing_address),'[]')
    from bx1_portal.fund_recipient_safe_signatures sig left join bx1_portal.fund_recipient_safe_verifications verified on verified.signature_id=sig.id where sig.operation_id=o.id))
  order by o.created_at,o.id),'[]') into operations from bx1_portal.fund_recipient_operations o where o.case_id=cid;
 return pg_catalog.jsonb_build_object('schema_version',1,'environment','TESTNET','actor_id',auth.uid(),'operating_context',c,
  'case',pg_catalog.to_jsonb(r),'operations',operations,'expiry_enforced_on_chain',false);
end $$;
create function bx1_portal.fund_recipient_expectation(oid uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_recipient_operations;r bx1_portal.fund_recipient_cases;m bx1_portal.fund_release_manifests;sig text;
begin select * into strict o from bx1_portal.fund_recipient_operations where id=oid;select * into strict r from bx1_portal.fund_recipient_cases where id=o.case_id;
 select * into strict m from bx1_portal.fund_release_manifests where id=r.manifest_id;
 select signature into sig from bx1_portal.fund_recipient_claim_signatures where id=r.claim_signature_id;
 return pg_catalog.jsonb_build_object('operation_id',o.id,'revision',1,'phase',o.phase,'product_id',r.product_id,'offering_revision_id',r.offering_revision_id,
  'investment_account_id',r.investment_account_id,'wallet_proof_id',r.wallet_proof_id,'eligibility_case_id',r.eligibility_case_id,'eligibility_revision',r.eligibility_revision,
  'product_binding_hash',r.product_binding_hash,'account_binding_hash',r.account_binding_hash,'eligibility_binding_hash',r.eligibility_binding_hash,
  'valid_until',r.claim_valid_until,'action_valid_until',o.expires_at,'recipient_address',r.wallet_address,'identity_address',r.identity_address,
  'claim_topic',r.claim_topic,'claim_signer_address',r.claim_signer_address,'claim_signature',sig,'country_code',r.country_code,
  'sender_address',o.sender_address,'sender_nonce',coalesce(o.sender_nonce,0)::text,'safe_nonce',o.safe_nonce::text,'manifest',m.deployment_expectation->'manifest');
end $$;
create function bx1_portal.fund_recipient_command(command text,key uuid,body jsonb,c jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;o bx1_portal.fund_recipient_operations;m bx1_portal.fund_release_manifests;b bx1_portal.fund_delivery_bindings;
 e bx1_portal.product_eligibility_cases;a bx1_portal.applications;st bx1_portal.fund_setups;prior bx1_portal.fund_recipient_requests;phase text;sender text;cfg jsonb;sig_id uuid;authority uuid;
begin
 if command is null or command not in ('CREATE_CASE','REQUEST_OPERATION','SUBMIT_CLAIM_SIGNATURE','RECORD_SAFE_SIGNATURE','CLAIM_EXECUTION','RECORD_HASH','AUTHORISE') or key is null
  or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>8192
  or bx1_portal.fund_recipient_session() is not true then raise exception 'fund_recipient_command_denied' using errcode='42501';end if;
 if command='CREATE_CASE' then
  perform bx1_portal.require_keys(body,array['delivery_binding_id']);
  select * into b from bx1_portal.fund_delivery_bindings where id=(body->>'delivery_binding_id')::uuid and actor_id=auth.uid();
  select * into m from bx1_portal.fund_release_manifests where product_id=b.product_id and status='ADMITTED' and bx1_portal.fund_manifest_current(id);
  if b.id is null or (c->>'mode' is distinct from 'APPLICANT' and c->>'role' is distinct from 'Investor')
   or bx1_portal.fund_binding_current(b.id) is not true or bx1_portal.fund_manifest_current(m.id) is not true then raise exception 'fund_recipient_bound_account_required' using errcode='42501';end if;
  if m.roleplay_policy_id is not null then perform bx1_private.test_roleplay_lock(c,b.product_id,'bind_fund_delivery_wallet',null);else perform bx1_portal.admission_lock_actor(null,c);end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund:'||b.product_id::text,0));
  perform id from bx1_portal.products where id=b.product_id for update;
  select * into r from bx1_portal.fund_recipient_cases where delivery_binding_id=b.id and offering_revision_id=m.offering_revision_id;
  if r.id is null then
   select * into e from bx1_portal.product_eligibility_cases where investment_account_id=b.investment_account_id and product_id=b.product_id and offering_revision_id=m.offering_revision_id;
   select app.* into a from bx1_portal.applications app join bx1_portal.investment_accounts i on i.application_id=app.id where i.id=b.investment_account_id;
   select * into st from bx1_portal.fund_setups where product_id=b.product_id and offering_revision_id=m.offering_revision_id;
   if e.id is null or bx1_portal.product_eligibility_current(e.id) is not true or st.id is null
    or pg_catalog.jsonb_array_length(m.deployment_expectation#>'{manifest,token_details,claim_topics}') is distinct from 1
    or pg_catalog.jsonb_array_length(m.deployment_expectation#>'{manifest,token_details,claim_issuers}') is distinct from 1
    or bx1_portal.fund_recipient_country(a.details->>'country') is null then raise exception 'fund_recipient_exact_claim_policy_required' using errcode='23514';end if;
   insert into bx1_portal.fund_recipient_cases(product_id,offering_revision_id,manifest_id,investment_account_id,delivery_binding_id,holder_user_id,wallet_proof_id,wallet_address,
    eligibility_case_id,eligibility_revision,claim_topic,claim_signer_address,country_alpha2,country_code,product_binding_hash,account_binding_hash,eligibility_binding_hash,claim_valid_until,
    roleplay_policy_id,roleplay_epoch,created_by,created_context)
   values(b.product_id,m.offering_revision_id,m.id,b.investment_account_id,b.id,b.actor_id,b.wallet_proof_id,b.wallet_address,e.id,e.revision,
    m.deployment_expectation#>>'{manifest,token_details,claim_topics,0}',st.configuration->>'claim_management_key',a.details->>'country',bx1_portal.fund_recipient_country(a.details->>'country'),m.product_binding_hash,
    bx1_portal.fund_digest(pg_catalog.jsonb_build_object('account',b.investment_account_id,'binding',b.id,'wallet',b.wallet_address,'wallet_proof',b.wallet_proof_id)),
    bx1_portal.fund_digest(pg_catalog.jsonb_build_object('eligibility_case',e.id,'revision',e.revision,'offering',e.offering_revision_id,'terms',m.terms_hash)),
    least(e.approved_until,a.approved_until),m.roleplay_policy_id,m.roleplay_epoch,auth.uid(),c) returning * into r;
   perform bx1_portal.fund_recipient_audit(r.id,null,'FUND_RECIPIENT_CASE_CREATED',c,body);
  end if;
 else
  if command in ('REQUEST_OPERATION','SUBMIT_CLAIM_SIGNATURE') then perform bx1_portal.require_keys(body,case when command='REQUEST_OPERATION' then array['case_id','expected_revision','phase','sender_address'] else array['case_id','expected_revision','signature'] end);select * into r from bx1_portal.fund_recipient_cases where id=(body->>'case_id')::uuid;
  else perform bx1_portal.require_keys(body,case when command='RECORD_HASH' then array['operation_id','expected_revision','transaction_hash'] when command='RECORD_SAFE_SIGNATURE' then array['operation_id','expected_revision','signing_address','signature'] else array['operation_id','expected_revision'] end);
   select * into o from bx1_portal.fund_recipient_operations where id=(body->>'operation_id')::uuid and (command='RECORD_SAFE_SIGNATURE' or (actor_id=auth.uid() and operating_context=c));
   select * into r from bx1_portal.fund_recipient_cases where id=o.case_id;end if;
  phase:=case when command='REQUEST_OPERATION' then body->>'phase' when command='SUBMIT_CLAIM_SIGNATURE' then 'CLAIM_SIGNATURE' else o.phase end;
  perform bx1_portal.fund_recipient_lock(r.id,c,phase);
 end if;
 select * into prior from bx1_portal.fund_recipient_requests where actor_id=auth.uid() and request_key=key;
 if prior.actor_id is not null then
  if prior.command is distinct from command or prior.payload is distinct from body or prior.operating_context is distinct from c or prior.case_id is distinct from r.id then raise exception 'fund_recipient_idempotency_conflict' using errcode='23505';end if;
  return bx1_portal.fund_recipient_projection(r.id,c);end if;
 if command='REQUEST_OPERATION' then
  perform bx1_portal.funding_require_revision(r.revision,body->'expected_revision');sender:=pg_catalog.lower(body->>'sender_address');
  if pg_catalog.jsonb_typeof(body->'sender_address') is distinct from 'string' or sender !~ '^0x[0-9a-f]{40}$'
   or (phase='CREATE_IDENTITY' and r.state<>'IDENTITY_REQUIRED') or (phase='ADD_CLAIM' and r.state<>'CLAIM_INSTALL_REQUIRED')
   or (phase='REGISTER_IDENTITY' and r.state<>'REGISTRATION_REQUIRED') or (phase='REVOKE_CLAIM' and r.state not in ('READY','REGISTRATION_REQUIRED'))
   or (phase in ('CREATE_IDENTITY','ADD_CLAIM') and sender is distinct from r.wallet_address)
   or (phase='REVOKE_CLAIM' and sender is distinct from r.claim_signer_address)
   or not exists(select 1 from public.bx1_wallets w join bx1_private.wallet_challenges p on p.id=w.last_proof_id and p.user_id=w.user_id
    where w.user_id=auth.uid() and w.address=sender and w.chain_id=80002 and w.verified_at is not null and p.used_at is not null and p.proof_signature is not null) then
    raise exception 'fund_recipient_next_phase_or_wallet_required' using errcode='42501';end if;
  if phase='REGISTER_IDENTITY' and not exists(select 1 from bx1_portal.fund_release_manifests m where m.id=r.manifest_id and m.deployment_expectation#>'{manifest,safe,owners}' ? sender) then raise exception 'fund_recipient_safe_owner_required' using errcode='42501';end if;
  insert into bx1_portal.fund_recipient_operations(case_id,phase,actor_id,operating_context,actor_claims,request_key,sender_address,expires_at)
   values(r.id,phase,auth.uid(),c,auth.jwt(),key,sender,least(pg_catalog.clock_timestamp()+interval '5 minutes',case when phase='REVOKE_CLAIM' then 'infinity'::timestamptz else r.claim_valid_until end)) returning * into o;
  perform bx1_portal.fund_recipient_audit(r.id,o.id,'FUND_RECIPIENT_OPERATION_REQUESTED',c,body);
 elsif command='SUBMIT_CLAIM_SIGNATURE' then
  perform bx1_portal.funding_require_revision(r.revision,body->'expected_revision');
  if r.state<>'CLAIM_SIGNATURE_REQUIRED' or pg_catalog.jsonb_typeof(body->'signature') is distinct from 'string' or body->>'signature' !~* '^0x[0-9a-f]{130}$'
   or not exists(select 1 from public.bx1_wallets w join bx1_private.wallet_challenges proof on proof.id=w.last_proof_id and proof.user_id=w.user_id
    where w.user_id=auth.uid() and w.address=r.claim_signer_address and w.chain_id=80002 and w.verified_at is not null and proof.used_at is not null and proof.proof_signature is not null) then raise exception 'fund_recipient_actual_claim_key_required' using errcode='42501';end if;
  insert into bx1_portal.fund_recipient_claim_signatures(case_id,case_revision,actor_id,operating_context,signature,actor_claims,expires_at,request_key,proof,proof_hash)
   values(r.id,r.revision,auth.uid(),c,pg_catalog.lower(body->>'signature'),auth.jwt(),least(r.claim_valid_until,pg_catalog.clock_timestamp()+interval '5 minutes'),key,
    pg_catalog.jsonb_build_object('status','UNVERIFIED'),bx1_portal.fund_digest(body)) returning id into sig_id;
  update bx1_portal.fund_recipient_cases set pending_signature_id=sig_id,revision=revision+1 where id=r.id;
  perform bx1_portal.fund_recipient_audit(r.id,null,'FUND_RECIPIENT_RAW_CLAIM_SIGNATURE_RECEIVED',c,pg_catalog.jsonb_build_object('signature_id',sig_id,'status','UNVERIFIED'));
 elsif command<>'CREATE_CASE' then
  select * into strict o from bx1_portal.fund_recipient_operations where id=o.id for update;
  perform bx1_portal.funding_require_revision(o.revision,body->'expected_revision');
  if command='RECORD_SAFE_SIGNATURE' then
   sender:=pg_catalog.lower(body->>'signing_address');select * into m from bx1_portal.fund_release_manifests where id=r.manifest_id;
   if o.phase<>'REGISTER_IDENTITY' or o.state<>'PREPARED' or o.expires_at<=pg_catalog.clock_timestamp() or o.intent is null
    or pg_catalog.jsonb_typeof(body->'signature') is distinct from 'string' or body->>'signature' !~* '^0x[0-9a-f]{130}$'
    or pg_catalog.jsonb_typeof(body->'signing_address') is distinct from 'string' or not(m.deployment_expectation#>'{manifest,safe,owners}' ? sender) then raise exception 'fund_recipient_pinned_safe_signature_required' using errcode='42501';end if;
   if r.roleplay_policy_id is not null then authority:=bx1_private.fund_roleplay_signer(r.roleplay_policy_id,r.roleplay_epoch,r.product_id,r.offering_revision_id,auth.uid(),c,sender);
   else select a.id into authority from bx1_portal.fund_authorities a join bx1_portal.fund_signer_policies p on p.id=a.signer_policy_id where p.manifest_id=m.id and a.user_id=auth.uid() and a.role='TokenisationAgent' and a.can_sign and a.signer_address=sender and bx1_portal.fund_authority_current(a.id);end if;
   if authority is null then raise exception 'fund_recipient_current_owner_slot_required' using errcode='42501';end if;
   insert into bx1_portal.fund_recipient_safe_signatures(operation_id,actor_id,operating_context,actor_claims,authority_id,signing_address,signature,intent_hash)
    values(o.id,auth.uid(),c,auth.jwt(),authority,sender,pg_catalog.lower(body->>'signature'),o.intent_hash);
   perform bx1_portal.fund_recipient_audit(r.id,o.id,'FUND_RECIPIENT_RAW_SAFE_SIGNATURE_RECEIVED',c,pg_catalog.jsonb_build_object('signing_address',sender,'status','UNVERIFIED'));
  elsif command='AUTHORISE' then update bx1_portal.fund_recipient_operations set actor_claims=auth.jwt() where id=o.id;
  elsif command='CLAIM_EXECUTION' then
   if o.state<>'PREPARED' or o.expires_at<=pg_catalog.clock_timestamp() or o.intent is null then raise exception 'fund_recipient_prepared_intent_required' using errcode='42501';end if;
   if o.phase='REGISTER_IDENTITY' and (select count(*) from bx1_portal.fund_recipient_safe_signatures sig join bx1_portal.fund_recipient_safe_verifications v on v.signature_id=sig.id
     where sig.operation_id=o.id and sig.intent_hash=o.intent_hash and bx1_portal.fund_authority_current(sig.authority_id)) < (o.intent->>'safe_threshold')::integer then raise exception 'fund_recipient_verified_safe_signatures_required' using errcode='42501';end if;
   update bx1_portal.fund_recipient_operations set state='UNKNOWN',claimed_at=pg_catalog.clock_timestamp(),revision=revision+1 where id=o.id;
  else
   if o.state not in ('UNKNOWN','BROADCAST','PENDING') or pg_catalog.jsonb_typeof(body->'transaction_hash') is distinct from 'string' or body->>'transaction_hash' !~* '^0x[0-9a-f]{64}$' then raise exception 'fund_recipient_original_hash_required' using errcode='23514';end if;
   if o.transaction_hash is not null and o.transaction_hash is distinct from pg_catalog.lower(body->>'transaction_hash') then raise exception 'fund_recipient_original_hash_immutable_recovery_required' using errcode='23514';end if;
   update bx1_portal.fund_recipient_operations set state='BROADCAST',transaction_hash=pg_catalog.lower(body->>'transaction_hash'),revision=revision+1 where id=o.id;
  end if;
  perform bx1_portal.fund_recipient_audit(r.id,o.id,'FUND_RECIPIENT_'||command,c,body);
 end if;
 if command='CREATE_CASE' then perform bx1_portal.fund_recipient_lock(r.id,c,'CREATE_IDENTITY');end if;
 if bx1_portal.fund_recipient_current(r.id,c,coalesce(phase,'CREATE_IDENTITY')) is not true then raise exception 'fund_recipient_authority_changed_at_commit' using errcode='42501';end if;
 insert into bx1_portal.fund_recipient_requests(actor_id,request_key,command,payload,operating_context,case_id) values(auth.uid(),key,command,body,c,r.id);
 return bx1_portal.fund_recipient_projection(r.id,c);
end $$;

create function bx1_portal.read_fund_recipient_observation(oid uuid,expected integer,actor uuid,c jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare prior text;o bx1_portal.fund_recipient_operations;answer jsonb;
begin prior:=bx1_portal.fund_recipient_worker_enter(oid,actor,c);select * into strict o from bx1_portal.fund_recipient_operations where id=oid for update;
 if o.revision is distinct from expected or o.state not in ('UNKNOWN','BROADCAST','PENDING','FINAL','FAILED') or o.expectation is null or o.intent is null or o.transaction_hash is null then raise exception 'fund_recipient_original_transaction_required' using errcode='23514';end if;
 answer:=pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision,'actor_id',o.actor_id,'operating_context',o.operating_context,
  'case_id',o.case_id,'expectation',o.expectation,'intent',o.intent,'transaction_hash',o.transaction_hash,'state',o.state);
 perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $$;
create function bx1_portal.fund_recipient_result_shape(result jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text;provider jsonb;urls text[]:='{}';
begin
 if pg_catalog.jsonb_typeof(result) is distinct from 'object' or result->'version' is distinct from '1'::jsonb or result->'chain_id' is distinct from '80002'::jsonb
  or result->'expiry_enforced_on_chain' is distinct from 'false'::jsonb or pg_catalog.jsonb_typeof(result->'operation_revision') is distinct from 'number'
  or (result->>'operation_revision' ~ '^[1-9][0-9]{0,8}$') is not true
  or result->>'phase' is null or result->>'phase' not in ('CREATE_IDENTITY','ADD_CLAIM','REGISTER_IDENTITY','REVOKE_CLAIM')
  or result->>'status' is null or result->>'status' not in ('UNKNOWN','PENDING','FAILED','FINAL') then return false;end if;
 foreach field in array array['transaction_hash','claim_data_hash','claim_id'] loop
  if pg_catalog.jsonb_typeof(result->field) is distinct from 'string' or (result->>field ~ '^0x[0-9a-f]{64}$') is not true or result->>field='0x'||pg_catalog.repeat('0',64) then return false;end if;
 end loop;
 if pg_catalog.jsonb_typeof(result->'operation_id') is distinct from 'string' or (result->>'operation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true
  or pg_catalog.jsonb_typeof(result->'expectation_hash') is distinct from 'string' or (result->>'expectation_hash' ~ '^[0-9a-f]{64}$') is not true
  or pg_catalog.jsonb_typeof(result->'identity_address') is distinct from 'string' or (result->>'identity_address' ~ '^0x[0-9a-f]{40}$') is not true
  or result->>'identity_address'='0x'||pg_catalog.repeat('0',40)
  or pg_catalog.jsonb_typeof(result->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'providers')<>2 then return false;end if;
 for provider in select value from pg_catalog.jsonb_array_elements(result->'providers') loop
  if pg_catalog.jsonb_typeof(provider->'url') is distinct from 'string' or provider->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com')
   or pg_catalog.jsonb_typeof(provider->'finalized_block_number') is distinct from 'string' or (provider->>'finalized_block_number' ~ '^[1-9][0-9]{0,77}$') is not true
   or pg_catalog.jsonb_typeof(provider->'finalized_block_hash') is distinct from 'string' or (provider->>'finalized_block_hash' ~ '^0x[0-9a-f]{64}$') is not true
   or provider->>'finalized_block_hash'='0x'||pg_catalog.repeat('0',64) then return false;end if;
  urls:=pg_catalog.array_append(urls,provider->>'url');
 end loop;
 if urls[1]=urls[2] then return false;end if;
 if result->>'status' in ('FINAL','FAILED') then
  if pg_catalog.jsonb_typeof(result->'block_number') is distinct from 'string' or (result->>'block_number' ~ '^[1-9][0-9]{0,77}$') is not true
   or pg_catalog.jsonb_typeof(result->'block_hash') is distinct from 'string' or (result->>'block_hash' ~ '^0x[0-9a-f]{64}$') is not true or result->>'block_hash'='0x'||pg_catalog.repeat('0',64)
   or pg_catalog.jsonb_typeof(result->'block_timestamp') is distinct from 'string' or not pg_catalog.isfinite((result->>'block_timestamp')::timestamptz)
   or pg_catalog.jsonb_typeof(result->'transaction_index') is distinct from 'number' or (result->>'transaction_index' ~ '^(0|[1-9][0-9]{0,9})$') is not true
   or (result->>'transaction_index')::numeric>2147483647 or pg_catalog.jsonb_typeof(result->'inner_execution_success') is distinct from 'boolean'
   or pg_catalog.jsonb_typeof(result->'registry_verified') is distinct from 'boolean' then return false;end if;
 end if;
 return true;exception when others then return false;
end $$;
create function bx1_portal.record_fund_recipient_observation(request jsonb,result jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare prior text;expected jsonb;o bx1_portal.fund_recipient_operations;r bx1_portal.fund_recipient_cases;obs uuid;answer jsonb;item jsonb;urls text[]:='{}';next_state text;
begin
 prior:=bx1_portal.fund_recipient_worker_enter((request->>'operation_id')::uuid,(request->>'actor_id')::uuid,request->'operating_context');
 expected:=bx1_portal.read_fund_recipient_observation((request->>'operation_id')::uuid,(request->>'expected_revision')::integer,(request->>'actor_id')::uuid,request->'operating_context');
 select * into strict o from bx1_portal.fund_recipient_operations where id=(request->>'operation_id')::uuid for update;select * into strict r from bx1_portal.fund_recipient_cases where id=o.case_id;
 if expected is distinct from request or bx1_portal.fund_recipient_result_shape(result) is not true or pg_catalog.octet_length(result::text)>65536
  or result->'version' is distinct from '1'::jsonb or result->'chain_id' is distinct from '80002'::jsonb
  or result->>'operation_id' is distinct from o.id::text or result->>'operation_revision' is distinct from o.expectation->>'revision'
  or result->>'phase' is distinct from o.phase or result->>'expectation_hash' is distinct from o.intent->>'expectation_hash'
  or result->>'transaction_hash' is distinct from o.transaction_hash or result->>'identity_address' is distinct from o.intent->>'expected_identity_address'
  or result->>'claim_data_hash' is distinct from o.intent->>'claim_data_hash' or result->>'claim_id' is distinct from o.intent->>'claim_id'
  or result->'expiry_enforced_on_chain' is distinct from 'false'::jsonb or result->>'status' is null or result->>'status' not in ('UNKNOWN','PENDING','FAILED','FINAL')
  or pg_catalog.jsonb_typeof(result->'providers') is distinct from 'array' or pg_catalog.jsonb_array_length(result->'providers')<>2 then raise exception 'fund_recipient_observation_binding_invalid' using errcode='23514';end if;
 for item in select value from pg_catalog.jsonb_array_elements(result->'providers') loop
  if pg_catalog.jsonb_typeof(item->'url') is distinct from 'string' or item->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com')
   or pg_catalog.jsonb_typeof(item->'finalized_block_hash') is distinct from 'string' or (item->>'finalized_block_hash' ~ '^0x[0-9a-f]{64}$') is not true
   or pg_catalog.jsonb_typeof(item->'finalized_block_number') is distinct from 'string' or (item->>'finalized_block_number' ~ '^[1-9][0-9]{0,77}$') is not true then raise exception 'fund_recipient_independent_provider_required' using errcode='23514';end if;
  urls:=pg_catalog.array_append(urls,item->>'url');
 end loop;
 if urls[1]=urls[2] then raise exception 'fund_recipient_duplicate_provider_denied';end if;
 if result->>'status' in ('FINAL','FAILED') and (pg_catalog.jsonb_typeof(result->'block_number') is distinct from 'string'
  or (result->>'block_number' ~ '^[1-9][0-9]{0,77}$') is not true or pg_catalog.jsonb_typeof(result->'block_hash') is distinct from 'string'
  or (result->>'block_hash' ~ '^0x[0-9a-f]{64}$') is not true or pg_catalog.jsonb_typeof(result->'block_timestamp') is distinct from 'string'
  or not pg_catalog.isfinite((result->>'block_timestamp')::timestamptz)) then raise exception 'fund_recipient_final_canonical_block_required';end if;
 if result->>'status'='FINAL' and (result->'inner_execution_success' is distinct from 'true'::jsonb
  or (result->>'block_timestamp')::timestamptz>o.expires_at or (o.phase<>'REVOKE_CLAIM' and (result->>'block_timestamp')::timestamptz>r.claim_valid_until)
  or (o.phase='REGISTER_IDENTITY' and result->'registry_verified' is distinct from 'true'::jsonb)
  or (o.phase='REVOKE_CLAIM' and result->'registry_verified' is distinct from 'false'::jsonb)) then raise exception 'fund_recipient_final_effect_required';end if;
 select id into obs from bx1_portal.fund_recipient_observations where operation_id=o.id and result_hash=bx1_portal.fund_digest(result);
 if obs is not null then answer:=bx1_portal.fund_recipient_projection(r.id,o.operating_context);perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;end if;
 if o.state in ('FINAL','FAILED') then raise exception 'fund_recipient_terminal_observation_changed_recovery_required' using errcode='23514';end if;
 insert into bx1_portal.fund_recipient_observations(operation_id,result,result_hash) values(o.id,result,bx1_portal.fund_digest(result)) returning id into obs;
 next_state:=result->>'status';update bx1_portal.fund_recipient_operations set state=next_state,observation_id=obs,revision=revision+1 where id=o.id;
 if next_state='FINAL' then
  update bx1_portal.fund_recipient_cases set state=case o.phase when 'CREATE_IDENTITY' then 'CLAIM_SIGNATURE_REQUIRED' when 'ADD_CLAIM' then 'REGISTRATION_REQUIRED' when 'REGISTER_IDENTITY' then 'READY' else 'REVOKED' end,
   identity_address=case when o.phase='CREATE_IDENTITY' then result->>'identity_address' else identity_address end,
   registration_observation_id=case when o.phase='REGISTER_IDENTITY' then obs else registration_observation_id end,revision=revision+1 where id=r.id;
 end if;
 perform bx1_portal.fund_recipient_audit(r.id,o.id,'FUND_RECIPIENT_CHAIN_OBSERVED',o.operating_context,pg_catalog.jsonb_build_object('observation_id',obs,'status',next_state));
 if bx1_portal.fund_recipient_current(r.id,o.operating_context,o.phase) is not true then raise exception 'fund_recipient_observation_authority_changed_at_commit' using errcode='42501';end if;
 answer:=bx1_portal.fund_recipient_projection(r.id,o.operating_context);perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $$;

create function bx1_portal.read_fund_recipient_claim(cid uuid,expected integer,actor uuid,c jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;s bx1_portal.fund_recipient_claim_signatures;m bx1_portal.fund_release_manifests;prior text;e jsonb;answer jsonb;
begin
 if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_recipient_private_worker_required' using errcode='42501';end if;
 select * into r from bx1_portal.fund_recipient_cases where id=cid;select * into s from bx1_portal.fund_recipient_claim_signatures where id=r.pending_signature_id and actor_id=actor and operating_context=c;
 if r.id is null or r.revision is distinct from expected or s.id is null or s.actor_claims->>'sub' is distinct from actor::text
  or pg_catalog.jsonb_typeof(s.actor_claims->'exp') is distinct from 'number' or (s.actor_claims->>'exp' ~ '^[0-9]{1,12}$') is not true or (s.actor_claims->>'exp')::numeric<=extract(epoch from pg_catalog.clock_timestamp()) then raise exception 'fund_recipient_claim_request_denied' using errcode='42501';end if;
 prior:=pg_catalog.current_setting('request.jwt.claims',true);perform pg_catalog.set_config('request.jwt.claims',s.actor_claims::text,true);
 perform bx1_portal.fund_recipient_lock(r.id,c,'CLAIM_SIGNATURE');select * into strict r from bx1_portal.fund_recipient_cases where id=cid for update;
 if r.pending_signature_id is distinct from s.id or r.state<>'CLAIM_SIGNATURE_REQUIRED' or s.expires_at<=pg_catalog.clock_timestamp() then raise exception 'fund_recipient_claim_request_changed';end if;
 select * into strict m from bx1_portal.fund_release_manifests where id=r.manifest_id;
 e:=pg_catalog.jsonb_build_object('operation_id',s.id,'revision',1,'phase','ADD_CLAIM','product_id',r.product_id,'offering_revision_id',r.offering_revision_id,
  'investment_account_id',r.investment_account_id,'wallet_proof_id',r.wallet_proof_id,'eligibility_case_id',r.eligibility_case_id,'eligibility_revision',r.eligibility_revision,
  'product_binding_hash',r.product_binding_hash,'account_binding_hash',r.account_binding_hash,'eligibility_binding_hash',r.eligibility_binding_hash,
  'valid_until',r.claim_valid_until,'action_valid_until',s.expires_at,'recipient_address',r.wallet_address,'identity_address',r.identity_address,'claim_topic',r.claim_topic,
  'claim_signer_address',r.claim_signer_address,'claim_signature',s.signature,'country_code',r.country_code,'sender_address',r.wallet_address,'sender_nonce','0','safe_nonce',null,'manifest',m.deployment_expectation->'manifest');
 answer:=pg_catalog.jsonb_build_object('case_id',r.id,'expected_revision',r.revision,'actor_id',s.actor_id,'operating_context',s.operating_context,'signature_id',s.id,'expectation',e);
 perform pg_catalog.set_config('request.jwt.claims',coalesce(prior,''),true);return answer;
end $$;
create function bx1_portal.record_fund_recipient_claim(request jsonb,result jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare expected jsonb;prior text;r bx1_portal.fund_recipient_cases;s bx1_portal.fund_recipient_claim_signatures;answer jsonb;
begin
 expected:=bx1_portal.read_fund_recipient_claim((request->>'case_id')::uuid,(request->>'expected_revision')::integer,(request->>'actor_id')::uuid,request->'operating_context');
 if expected is distinct from request or result->'version' is distinct from '1'::jsonb or result->>'status' is distinct from 'VERIFIED'
  or result->>'operation_id' is distinct from request->>'signature_id' or result->>'signature' is distinct from request#>>'{expectation,claim_signature}'
  or result->>'claim_signer_address' is distinct from request#>>'{expectation,claim_signer_address}'
  or (result->>'claim_data_hash' ~ '^0x[0-9a-f]{64}$') is not true or (result->>'claim_id' ~ '^0x[0-9a-f]{64}$') is not true
  or result->>'catalog_hash' is distinct from '2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2'
  or result->'expiry_enforced_on_chain' is distinct from 'false'::jsonb or bx1_portal.fund_setup_observers_valid(pg_catalog.jsonb_build_object('providers',result#>'{observed,providers}','block_number',result#>'{observed,block,number}')) is not true then raise exception 'fund_recipient_claim_evidence_invalid' using errcode='23514';end if;
 select * into strict s from bx1_portal.fund_recipient_claim_signatures where id=(request->>'signature_id')::uuid;
 prior:=pg_catalog.current_setting('request.jwt.claims',true);perform pg_catalog.set_config('request.jwt.claims',s.actor_claims::text,true);
 perform bx1_portal.fund_recipient_lock(s.case_id,s.operating_context,'CLAIM_SIGNATURE');select * into strict r from bx1_portal.fund_recipient_cases where id=s.case_id for update;
 if r.revision is distinct from (request->>'expected_revision')::integer or r.pending_signature_id is distinct from s.id or r.state<>'CLAIM_SIGNATURE_REQUIRED' then raise exception 'fund_recipient_claim_changed_after_wait';end if;
 insert into bx1_portal.fund_recipient_claim_verifications(signature_id,proof,proof_hash) values(s.id,result,bx1_portal.fund_digest(result));
 update bx1_portal.fund_recipient_cases set claim_signature_id=s.id,pending_signature_id=null,state='CLAIM_INSTALL_REQUIRED',revision=revision+1 where id=r.id;
 perform bx1_portal.fund_recipient_audit(r.id,null,'FUND_RECIPIENT_CLAIM_CRYPTOGRAPHICALLY_VERIFIED',s.operating_context,pg_catalog.jsonb_build_object('signature_id',s.id,'claim_data_hash',result->>'claim_data_hash','no_eligibility_granted',true));
 if bx1_portal.fund_recipient_current(r.id,s.operating_context,'CLAIM_SIGNATURE') is not true then raise exception 'fund_recipient_claim_authority_changed_at_commit' using errcode='42501';end if;
 answer:=bx1_portal.fund_recipient_projection(r.id,s.operating_context);perform pg_catalog.set_config('request.jwt.claims',coalesce(prior,''),true);return answer;
end $$;

create function bx1_portal.read_fund_recipient_signature(sid uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_recipient_safe_signatures;o bx1_portal.fund_recipient_operations;prior text;answer jsonb;
begin
 if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_recipient_private_worker_required' using errcode='42501';end if;
 select * into s from bx1_portal.fund_recipient_safe_signatures where id=sid;select * into o from bx1_portal.fund_recipient_operations where id=s.operation_id;
 if s.id is null or o.phase<>'REGISTER_IDENTITY' or o.intent is null or s.intent_hash is distinct from o.intent_hash or o.state<>'PREPARED'
  or o.expires_at<=pg_catalog.clock_timestamp() or pg_catalog.jsonb_typeof(s.actor_claims->'exp') is distinct from 'number' or (s.actor_claims->>'exp' ~ '^[0-9]{1,12}$') is not true
  or (s.actor_claims->>'exp')::numeric<=extract(epoch from pg_catalog.clock_timestamp()) then raise exception 'fund_recipient_saved_signature_scope_required' using errcode='42501';end if;
 prior:=pg_catalog.current_setting('request.jwt.claims',true);perform pg_catalog.set_config('request.jwt.claims',s.actor_claims::text,true);
 perform bx1_portal.fund_recipient_lock(o.case_id,s.operating_context,'REGISTER_IDENTITY');
 if bx1_portal.fund_authority_current(s.authority_id) is not true then raise exception 'fund_recipient_signer_authority_changed' using errcode='42501';end if;
 answer:=pg_catalog.jsonb_build_object('signature_id',s.id,'operation_id',o.id,'actor_id',s.actor_id,'operating_context',s.operating_context,
  'signing_address',s.signing_address,'signature',s.signature,'intent',o.intent,'intent_hash',o.intent_hash);
 perform pg_catalog.set_config('request.jwt.claims',coalesce(prior,''),true);return answer;
end $$;
create function bx1_portal.record_fund_recipient_signature(sid uuid,result jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare expected jsonb;s bx1_portal.fund_recipient_safe_signatures;o bx1_portal.fund_recipient_operations;prior text;answer jsonb;
begin
 expected:=bx1_portal.read_fund_recipient_signature(sid);
 if result->'version' is distinct from '1'::jsonb or result->>'status' is distinct from 'VERIFIED'
  or result->>'signature_id' is distinct from sid::text or result->>'signing_address' is distinct from expected->>'signing_address'
  or result->>'signature' is distinct from expected->>'signature' or result->>'intent_hash' is distinct from expected->>'intent_hash'
  or result->>'safe_transaction_hash' is distinct from expected#>>'{intent,safe_transaction_hash}' then raise exception 'fund_recipient_signature_proof_invalid' using errcode='23514';end if;
 select * into strict s from bx1_portal.fund_recipient_safe_signatures where id=sid;select * into strict o from bx1_portal.fund_recipient_operations where id=s.operation_id;
 prior:=pg_catalog.current_setting('request.jwt.claims',true);perform pg_catalog.set_config('request.jwt.claims',s.actor_claims::text,true);
 perform bx1_portal.fund_recipient_lock(o.case_id,s.operating_context,'REGISTER_IDENTITY');
 insert into bx1_portal.fund_recipient_safe_verifications(signature_id,proof,proof_hash) values(sid,result,bx1_portal.fund_digest(result)) on conflict(signature_id) do nothing;
 if not exists(select 1 from bx1_portal.fund_recipient_safe_verifications where signature_id=sid and proof=result) then raise exception 'fund_recipient_signature_evidence_conflict';end if;
 perform bx1_portal.fund_recipient_audit(o.case_id,o.id,'FUND_RECIPIENT_SAFE_OWNER_SIGNATURE_VERIFIED',s.operating_context,pg_catalog.jsonb_build_object('signature_id',sid,'signing_address',s.signing_address));
 if bx1_portal.fund_authority_current(s.authority_id) is not true or bx1_portal.fund_recipient_current(o.case_id,s.operating_context,'REGISTER_IDENTITY') is not true then raise exception 'fund_recipient_signature_authority_changed_at_commit' using errcode='42501';end if;
 answer:=bx1_portal.fund_recipient_projection(o.case_id,s.operating_context);perform pg_catalog.set_config('request.jwt.claims',coalesce(prior,''),true);return answer;
end $$;

-- Exclude cross-family nonces using the SAME locks at every insertion point.
-- New triggers are the only additions to existing tables; no function body or
-- existing row is changed. UNKNOWN leases are never silently released.
create function bx1_portal.fund_recipient_shared_nonce_guard() returns trigger language plpgsql volatile security definer set search_path='' as $$
<<fund_recipient_shared_nonce_guard>>
declare sender text;n numeric;safe text;sn numeric;
begin
 if TG_TABLE_NAME='fund_setup_steps' then sender:=NEW.sender;n:=NEW.nonce;
 elsif TG_TABLE_NAME='fund_recipient_operations' then sender:=NEW.sender_address;n:=NEW.sender_nonce;
 else safe:=NEW.execution_account;sn:=NEW.safe_nonce;end if;
 if n is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_setup_nonce:'||sender,0));
  if TG_TABLE_NAME='fund_setup_steps' and exists(select 1 from bx1_portal.fund_recipient_operations where sender_address=sender and sender_nonce=n)
   or TG_TABLE_NAME='fund_recipient_operations' and exists(select 1 from bx1_portal.fund_setup_steps where fund_setup_steps.sender=fund_recipient_shared_nonce_guard.sender and nonce=n) then raise exception 'fund_recipient_cross_family_nonce_reserved' using errcode='23505';end if;
 end if;
 if TG_TABLE_NAME='fund_operations' and sn is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_safe:'||safe,0));
  if exists(select 1 from bx1_portal.fund_recipient_operations o join bx1_portal.fund_recipient_cases r on r.id=o.case_id join bx1_portal.fund_release_manifests m on m.id=r.manifest_id
   where m.execution_account=safe and o.safe_nonce=sn) then raise exception 'fund_recipient_cross_family_safe_nonce_reserved' using errcode='23505';end if;
 end if;
 return NEW;
end $$;
create trigger fund_recipient_setup_nonce_boundary before insert or update of sender,nonce on bx1_portal.fund_setup_steps for each row execute function bx1_portal.fund_recipient_shared_nonce_guard();
create trigger fund_recipient_operation_nonce_boundary before insert or update of sender_address,sender_nonce on bx1_portal.fund_recipient_operations for each row execute function bx1_portal.fund_recipient_shared_nonce_guard();
create trigger fund_recipient_safe_nonce_boundary before insert or update of execution_account,safe_nonce on bx1_portal.fund_operations for each row execute function bx1_portal.fund_recipient_shared_nonce_guard();
create function bx1_portal.fund_recipient_mutation_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'fund_recipient_history_permanent';end if;
 if TG_TABLE_NAME='fund_recipient_cases' then
  if pg_catalog.to_jsonb(NEW)-array['revision','state','identity_address','pending_signature_id','claim_signature_id','registration_observation_id'] is distinct from pg_catalog.to_jsonb(OLD)-array['revision','state','identity_address','pending_signature_id','claim_signature_id','registration_observation_id']
   or NEW.revision<>OLD.revision+1 or OLD.identity_address is not null and NEW.identity_address is distinct from OLD.identity_address
   or OLD.claim_signature_id is not null and NEW.claim_signature_id is distinct from OLD.claim_signature_id then raise exception 'fund_recipient_identity_immutable';end if;
 else
  if pg_catalog.to_jsonb(NEW)-array['revision','state','expectation','intent','intent_hash','sender_nonce','safe_nonce','claimed_at','transaction_hash','observation_id','actor_claims'] is distinct from pg_catalog.to_jsonb(OLD)-array['revision','state','expectation','intent','intent_hash','sender_nonce','safe_nonce','claimed_at','transaction_hash','observation_id','actor_claims']
   or NEW.revision not in (OLD.revision,OLD.revision+1) or (OLD.intent is not null and (NEW.intent,NEW.intent_hash,NEW.expectation,NEW.sender_nonce,NEW.safe_nonce) is distinct from (OLD.intent,OLD.intent_hash,OLD.expectation,OLD.sender_nonce,OLD.safe_nonce))
   or OLD.claimed_at is not null and NEW.claimed_at is distinct from OLD.claimed_at or OLD.state in ('FINAL','FAILED') and (NEW.state,NEW.transaction_hash) is distinct from (OLD.state,OLD.transaction_hash) then raise exception 'fund_recipient_prepared_identity_immutable';end if;
 end if;return NEW;
end $$;
create trigger fund_recipient_cases_guard before update or delete on bx1_portal.fund_recipient_cases for each row execute function bx1_portal.fund_recipient_mutation_guard();
create trigger fund_recipient_operations_guard before update or delete on bx1_portal.fund_recipient_operations for each row execute function bx1_portal.fund_recipient_mutation_guard();

create function public.bx1_portal_fund_recipient_read(case_id uuid,operating_context jsonb) returns jsonb language sql security invoker set search_path='' as $$ select bx1_portal.fund_recipient_projection(case_id,operating_context); $$;
create function public.bx1_portal_fund_recipient_command(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb language sql security invoker set search_path='' as $$ select bx1_portal.fund_recipient_command(command,request_key,payload,operating_context); $$;

-- Worker request binding restores only JWT claims saved through authenticated
-- commands. No caller-created AAL2/person/role or browser expectation is accepted.
create function bx1_portal.fund_recipient_worker_enter(oid uuid,actor uuid,c jsonb) returns text language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_recipient_operations;prior text;
begin
 if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_recipient_private_worker_required' using errcode='42501';end if;
 select * into o from bx1_portal.fund_recipient_operations where id=oid and actor_id=actor and operating_context=c;
 if o.id is null or o.actor_claims->>'sub' is distinct from actor::text or pg_catalog.jsonb_typeof(o.actor_claims->'exp') is distinct from 'number' or (o.actor_claims->>'exp' ~ '^[0-9]{1,12}$') is not true
  or (o.actor_claims->>'exp')::numeric<=extract(epoch from pg_catalog.clock_timestamp()) then raise exception 'fund_recipient_saved_session_expired' using errcode='42501';end if;
 prior:=pg_catalog.current_setting('request.jwt.claims',true);perform pg_catalog.set_config('request.jwt.claims',o.actor_claims::text,true);
 perform bx1_portal.fund_recipient_lock(o.case_id,c,o.phase);return coalesce(prior,'');
end $$;
create function bx1_portal.read_fund_recipient_preparation(oid uuid,expected integer,actor uuid,c jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare prior text;o bx1_portal.fund_recipient_operations;answer jsonb;
begin prior:=bx1_portal.fund_recipient_worker_enter(oid,actor,c);select * into strict o from bx1_portal.fund_recipient_operations where id=oid for update;
 if o.revision is distinct from expected or o.state not in ('REQUESTED','PREPARED') or o.expires_at<=pg_catalog.clock_timestamp() then raise exception 'fund_recipient_preparation_changed' using errcode='23514';end if;
 answer:=pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision,'actor_id',o.actor_id,'operating_context',o.operating_context,
  'case_id',o.case_id,'expectation',bx1_portal.fund_recipient_expectation(o.id),'saved_intent',o.intent);
 perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $$;
create function bx1_portal.prepare_fund_recipient_operation(request jsonb,intent jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare prior text;o bx1_portal.fund_recipient_operations;r bx1_portal.fund_recipient_cases;e jsonb;sender_nonce numeric;safe_nonce numeric;expected jsonb;answer jsonb;
begin
 prior:=bx1_portal.fund_recipient_worker_enter((request->>'operation_id')::uuid,(request->>'actor_id')::uuid,request->'operating_context');
 expected:=bx1_portal.read_fund_recipient_preparation((request->>'operation_id')::uuid,(request->>'expected_revision')::integer,(request->>'actor_id')::uuid,request->'operating_context');
 if expected is distinct from request or pg_catalog.jsonb_typeof(intent) is distinct from 'object' or intent->'version' is distinct from '1'::jsonb
  or intent->'chain_id' is distinct from '80002'::jsonb or intent->>'operation_id' is distinct from request->>'operation_id'
  or pg_catalog.jsonb_typeof(intent->'sender_nonce') is distinct from 'string' or (intent->>'sender_nonce' ~ '^(0|[1-9][0-9]{0,19})$') is not true
  or pg_catalog.jsonb_typeof(intent->'transaction_data') is distinct from 'string' or (intent->>'transaction_data' ~ '^0x([0-9a-f]{2})+$') is not true
  or intent->>'catalog_hash' is distinct from '2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2'
  or intent->'expiry_enforced_on_chain' is distinct from 'false'::jsonb then raise exception 'fund_recipient_server_intent_invalid' using errcode='23514';end if;
 select * into strict o from bx1_portal.fund_recipient_operations where id=(request->>'operation_id')::uuid for update;select * into strict r from bx1_portal.fund_recipient_cases where id=o.case_id;
 if intent->>'phase' is distinct from o.phase or intent->>'sender_address' is distinct from o.sender_address or intent->>'value' is distinct from '0'
  or (intent->>'valid_until')::timestamptz is distinct from o.expires_at or (intent->>'claim_valid_until')::timestamptz is distinct from r.claim_valid_until then raise exception 'fund_recipient_intent_scope_changed' using errcode='23514';end if;
 sender_nonce:=(intent->>'sender_nonce')::numeric;if sender_nonce>=18446744073709551616 then raise exception 'fund_recipient_nonce_out_of_range';end if;
 if o.phase='REGISTER_IDENTITY' then
  if (intent#>>'{safe_transaction,nonce}' ~ '^(0|[1-9][0-9]{0,77})$') is not true then raise exception 'fund_recipient_safe_nonce_required';end if;safe_nonce:=(intent#>>'{safe_transaction,nonce}')::numeric;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_setup_nonce:'||o.sender_address,0));
 if exists(select 1 from bx1_portal.fund_setup_steps where sender=o.sender_address and nonce=sender_nonce)
  or exists(select 1 from bx1_portal.fund_recipient_operations x where x.sender_address=o.sender_address and x.sender_nonce=prepare_fund_recipient_operation.sender_nonce and x.id<>o.id) then raise exception 'fund_recipient_sender_nonce_already_reserved' using errcode='23505';end if;
 if safe_nonce is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_safe:'||(request#>>'{expectation,manifest,safe,address}'),0));
  if exists(select 1 from bx1_portal.fund_operations where execution_account=request#>>'{expectation,manifest,safe,address}' and fund_operations.safe_nonce=prepare_fund_recipient_operation.safe_nonce and not nonce_released)
   or exists(select 1 from bx1_portal.fund_recipient_operations x join bx1_portal.fund_recipient_cases y on y.id=x.case_id join bx1_portal.fund_release_manifests m on m.id=y.manifest_id
     where m.execution_account=request#>>'{expectation,manifest,safe,address}' and x.safe_nonce=prepare_fund_recipient_operation.safe_nonce and x.id<>o.id) then raise exception 'fund_recipient_safe_nonce_already_reserved' using errcode='23505';end if;
 end if;
 e:=request->'expectation';e:=pg_catalog.jsonb_set(e,'{sender_nonce}',pg_catalog.to_jsonb(sender_nonce::text));e:=pg_catalog.jsonb_set(e,'{safe_nonce}',coalesce(pg_catalog.to_jsonb(safe_nonce::text),'null'::jsonb));
 if o.state='PREPARED' then if o.intent is distinct from intent or o.expectation is distinct from e then raise exception 'fund_recipient_prepared_intent_immutable';end if;
 else update bx1_portal.fund_recipient_operations set expectation=e,intent=prepare_fund_recipient_operation.intent,intent_hash=bx1_portal.fund_digest(prepare_fund_recipient_operation.intent),
  sender_nonce=prepare_fund_recipient_operation.sender_nonce,safe_nonce=prepare_fund_recipient_operation.safe_nonce,state='PREPARED',revision=revision+1 where id=o.id;
  perform bx1_portal.fund_recipient_audit(r.id,o.id,'FUND_RECIPIENT_INTENT_PREPARED',o.operating_context,pg_catalog.jsonb_build_object('intent_hash',bx1_portal.fund_digest(intent)));end if;
 if bx1_portal.fund_recipient_current(r.id,o.operating_context,o.phase) is not true then raise exception 'fund_recipient_prepare_authority_changed_at_commit' using errcode='42501';end if;
 answer:=bx1_portal.fund_recipient_projection(r.id,o.operating_context);perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $$;

create function bx1_portal.fund_recipient_claim_signing_request(cid uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.fund_recipient_cases;m bx1_portal.fund_release_manifests;e jsonb;
begin
 perform bx1_portal.fund_recipient_lock(cid,c,'CLAIM_SIGNATURE');select * into strict r from bx1_portal.fund_recipient_cases where id=cid;
 if r.state<>'CLAIM_SIGNATURE_REQUIRED' or r.identity_address is null then raise exception 'fund_recipient_claim_not_requested' using errcode='23514';end if;
 select * into strict m from bx1_portal.fund_release_manifests where id=r.manifest_id;
 e:=pg_catalog.jsonb_build_object('operation_id',r.id,'revision',1,'phase','ADD_CLAIM','product_id',r.product_id,'offering_revision_id',r.offering_revision_id,
  'investment_account_id',r.investment_account_id,'wallet_proof_id',r.wallet_proof_id,'eligibility_case_id',r.eligibility_case_id,'eligibility_revision',r.eligibility_revision,
  'product_binding_hash',r.product_binding_hash,'account_binding_hash',r.account_binding_hash,'eligibility_binding_hash',r.eligibility_binding_hash,
  'valid_until',r.claim_valid_until,'action_valid_until',least(r.claim_valid_until,pg_catalog.clock_timestamp()+interval '5 minutes'),
  'recipient_address',r.wallet_address,'identity_address',r.identity_address,'claim_topic',r.claim_topic,'claim_signer_address',r.claim_signer_address,
  'claim_signature',null,'country_code',r.country_code,'sender_address',r.wallet_address,'sender_nonce','0','safe_nonce',null,'manifest',m.deployment_expectation->'manifest');
 if bx1_portal.fund_recipient_current(cid,c,'CLAIM_SIGNATURE') is not true then raise exception 'fund_recipient_signing_authority_changed' using errcode='42501';end if;
 return pg_catalog.jsonb_build_object('case_id',r.id,'expected_revision',r.revision,'actor_id',auth.uid(),'operating_context',c,'expectation',e);
end $$;
create function public.bx1_portal_fund_recipient_claim_signing_request(case_id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_recipient_claim_signing_request(case_id,operating_context); $$;

create function bx1_portal.fund_recipient_find(binding uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare b bx1_portal.fund_delivery_bindings;r bx1_portal.fund_recipient_cases;
begin
 select * into b from bx1_portal.fund_delivery_bindings where id=binding;
 if b.id is null or auth.uid() is null or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
  or (bx1_portal.fund_context(c,false) or bx1_private.fund_roleplay_visible(c,b.product_id)) is not true
  or ((b.actor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
   or (c->>'mode'='ROLE' and c->>'role' in ('ComplianceOfficer','TokenisationAgent')
    and (bx1_portal.fund_product_visible(c,b.product_id) or bx1_private.fund_roleplay_visible(c,b.product_id)))) is not true then
   raise exception 'fund_recipient_binding_read_denied' using errcode='42501';end if;
 select x.* into r from bx1_portal.fund_recipient_cases x join bx1_portal.fund_release_manifests m on m.id=x.manifest_id
  where x.delivery_binding_id=binding and m.offering_revision_id=x.offering_revision_id and bx1_portal.fund_manifest_current(m.id);
 if r.id is not null and bx1_portal.fund_recipient_visible(r.id,c) is not true then raise exception 'fund_recipient_binding_case_denied' using errcode='42501';end if;
 return pg_catalog.jsonb_build_object('delivery_binding_id',binding,'case_id',r.id,'snapshot',case when r.id is not null then bx1_portal.fund_recipient_projection(r.id,c) else null end);
end $$;
create function public.bx1_portal_fund_recipient_find(delivery_binding_id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_recipient_find(delivery_binding_id,operating_context); $$;

create function bx1_portal.read_fund_recipient_execution(oid uuid,expected integer,actor uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare prior text;o bx1_portal.fund_recipient_operations;answer jsonb;signatures jsonb;
begin
 prior:=bx1_portal.fund_recipient_worker_enter(oid,actor,c);select * into strict o from bx1_portal.fund_recipient_operations where id=oid for update;
 if o.revision is distinct from expected or o.state<>'UNKNOWN' or o.transaction_hash is not null or o.expires_at<=pg_catalog.clock_timestamp()
  or o.expectation is null or o.intent is null then raise exception 'fund_recipient_current_claim_required' using errcode='42501';end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_address',s.signing_address,'signature',s.signature) order by s.signing_address),'[]') into signatures
  from bx1_portal.fund_recipient_safe_signatures s join bx1_portal.fund_recipient_safe_verifications v on v.signature_id=s.id
  where s.operation_id=o.id and s.intent_hash=o.intent_hash and bx1_portal.fund_authority_current(s.authority_id);
 if o.phase='REGISTER_IDENTITY' and pg_catalog.jsonb_array_length(signatures)<(o.intent->>'safe_threshold')::integer then raise exception 'fund_recipient_current_quorum_required' using errcode='42501';end if;
 answer:=pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision,'actor_id',o.actor_id,'operating_context',o.operating_context,
  'case_id',o.case_id,'expectation',o.expectation,'intent',o.intent,'signatures',signatures);
 perform pg_catalog.set_config('request.jwt.claims',prior,true);return answer;
end $$;

-- Discovery and guarded issuance precondition only. It does not grant an
-- investor eligibility, allocate money, create units or update ownership.
create function bx1_portal.fund_recipient_ready_for_allocation(allocation uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select coalesce(exists(select 1 from bx1_portal.fund_allocations a
  join bx1_portal.fund_delivery_bindings b on b.id=a.delivery_binding_id and b.product_id=a.product_id and b.investment_account_id=a.investment_account_id
  join bx1_portal.fund_recipient_cases r on r.product_id=a.product_id and r.offering_revision_id=a.offering_revision_id
   and r.investment_account_id=a.investment_account_id and r.delivery_binding_id=b.id and r.holder_user_id=b.actor_id
   and r.wallet_proof_id=b.wallet_proof_id and r.wallet_address=b.wallet_address
   and r.eligibility_case_id=a.eligibility_case_id and r.eligibility_revision=a.eligibility_revision
  join bx1_portal.fund_release_manifests m on m.id=r.manifest_id and m.product_id=a.product_id and m.offering_revision_id=a.offering_revision_id
  join bx1_portal.fund_recipient_observations observation on observation.id=r.registration_observation_id
  join bx1_portal.fund_recipient_operations operation on operation.id=observation.operation_id and operation.case_id=r.id
   and operation.observation_id=observation.id and operation.phase='REGISTER_IDENTITY' and operation.state='FINAL'
  join bx1_portal.fund_recipient_claim_verifications claim on claim.signature_id=r.claim_signature_id
  where a.id=allocation and r.state='READY' and r.identity_address is not null and r.claim_valid_until>pg_catalog.clock_timestamp()
   and bx1_portal.fund_manifest_current(m.id) and bx1_portal.product_eligibility_current(r.eligibility_case_id)
   and bx1_portal.fund_binding_current(b.id) and observation.result->>'status'='FINAL'
   and observation.result->'inner_execution_success'='true'::jsonb and observation.result->'registry_verified'='true'::jsonb
   and observation.result->>'identity_address'=r.identity_address and claim.proof->>'status'='VERIFIED'),false);
$$;

-- Exact body-pinned cutover for the one shared Safe nonce counter. No competing
-- mint/deployment writer is introduced; UNKNOWN and failed attempts retain their
-- nonce until a separately authorised recovery can prove release is safe.
do $recipient_nonce_counter$
declare target oid;body text;definition text;before_metadata jsonb;after_metadata jsonb;original text;replacement text;
begin
 target:=pg_catalog.to_regprocedure('bx1_portal.fund_new_operation(jsonb,uuid,uuid,uuid,uuid)');
 select prosrc,pg_catalog.to_jsonb(p)-'prosrc' into body,before_metadata from pg_catalog.pg_proc p where p.oid=target;
 if target is null or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(body,E'\r\n',E'\n'),'UTF8')),'hex')
  is distinct from '3857ff1d865a4753bffd513faa3775af6295b2de026927a4adad0cafd5522bd1' then raise exception 'fund_recipient_nonce_counter_exact_source_required' using errcode='55000';end if;
 original:='(select max(safe_nonce)+1 from bx1_portal.fund_operations where execution_account=m.execution_account and not nonce_released)';
 replacement:='(select max(n.safe_nonce)+1 from (select safe_nonce from bx1_portal.fund_operations where execution_account=m.execution_account and not nonce_released union all select ro.safe_nonce from bx1_portal.fund_recipient_operations ro join bx1_portal.fund_recipient_cases rc on rc.id=ro.case_id join bx1_portal.fund_release_manifests rm on rm.id=rc.manifest_id where rm.execution_account=m.execution_account and ro.safe_nonce is not null) n)';
 if (pg_catalog.length(body)-pg_catalog.length(replace(body,original,'')))/pg_catalog.length(original)<>1 then raise exception 'fund_recipient_nonce_counter_fragment_not_unique';end if;
 definition:=pg_catalog.pg_get_functiondef(target);execute replace(definition,original,replacement);
 select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
 if before_metadata is distinct from after_metadata then raise exception 'fund_recipient_nonce_counter_metadata_changed';end if;
end $recipient_nonce_counter$;

do $acl$ declare p record;begin
 for p in select oid::regprocedure signature from pg_catalog.pg_proc where pronamespace='bx1_portal'::regnamespace and (pg_catalog.left(proname,15)='fund_recipient_' or proname in ('read_fund_recipient_preparation','prepare_fund_recipient_operation','read_fund_recipient_observation','record_fund_recipient_observation','read_fund_recipient_claim','record_fund_recipient_claim','read_fund_recipient_signature','record_fund_recipient_signature','read_fund_recipient_execution')) loop
  execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_fund_execution_worker',p.signature);end loop;
end $acl$;
revoke all on function public.bx1_portal_fund_recipient_read(uuid,jsonb),public.bx1_portal_fund_recipient_command(text,uuid,jsonb,jsonb),public.bx1_portal_fund_recipient_find(uuid,jsonb),public.bx1_portal_fund_recipient_claim_signing_request(uuid,jsonb) from public,anon,authenticated,service_role,bx1_fund_execution_worker;
grant execute on function bx1_portal.fund_recipient_projection(uuid,jsonb),bx1_portal.fund_recipient_command(text,uuid,jsonb,jsonb),bx1_portal.fund_recipient_find(uuid,jsonb),bx1_portal.fund_recipient_claim_signing_request(uuid,jsonb),public.bx1_portal_fund_recipient_read(uuid,jsonb),public.bx1_portal_fund_recipient_command(text,uuid,jsonb,jsonb),public.bx1_portal_fund_recipient_find(uuid,jsonb),public.bx1_portal_fund_recipient_claim_signing_request(uuid,jsonb) to authenticated;
grant execute on function bx1_portal.read_fund_recipient_preparation(uuid,integer,uuid,jsonb),bx1_portal.prepare_fund_recipient_operation(jsonb,jsonb),
 bx1_portal.read_fund_recipient_observation(uuid,integer,uuid,jsonb),bx1_portal.record_fund_recipient_observation(jsonb,jsonb),
 bx1_portal.read_fund_recipient_claim(uuid,integer,uuid,jsonb),bx1_portal.record_fund_recipient_claim(jsonb,jsonb),
 bx1_portal.read_fund_recipient_signature(uuid),bx1_portal.record_fund_recipient_signature(uuid,jsonb),bx1_portal.read_fund_recipient_execution(uuid,integer,uuid,jsonb) to bx1_fund_execution_worker;
