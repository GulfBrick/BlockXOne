-- Isolated, synthetic financial demonstration. Deploy ONLY to the admitted TEST
-- project. ZAR_TEST is not money; presenter actions are not production authority.
-- Apply atomically. This migration neither seeds nor changes identity records.
create schema bx1_demo;
revoke all on schema bx1_demo from public,anon,authenticated,service_role;
create role bx1_demo_chain_verifier nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema public to bx1_demo_chain_verifier;
do $$ begin execute format('grant connect on database %I to bx1_demo_chain_verifier',current_database()); end $$;

create table bx1_demo.funds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.bx1_organisations(id),
  created_by uuid not null references public.bx1_profiles(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  status text not null default 'DRAFT' check(status in ('DRAFT','OPEN')),
  unit_price_minor numeric(78,0) not null check(unit_price_minor>0 and unit_price_minor<1e38),
  cap_units numeric(78,0) not null check(cap_units>0 and cap_units<1e38),
  chain_id integer not null default 80002 check(chain_id=80002),
  contract_address text unique check(contract_address ~ '^0x[0-9a-f]{40}$' and contract_address<>'0x0000000000000000000000000000000000000000'),
  contract_owner text check(contract_owner ~ '^0x[0-9a-f]{40}$' and contract_owner<>'0x0000000000000000000000000000000000000000'),
  deployment_transaction_hash text unique check(deployment_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(contract_address,contract_owner,deployment_transaction_hash) in (0,3)),
  check(status<>'OPEN' or contract_address is not null)
);
create table bx1_demo.subscriptions (
  id uuid primary key default gen_random_uuid(), fund_id uuid not null references bx1_demo.funds(id),
  investor_wallet text not null check(investor_wallet ~ '^0x[0-9a-f]{40}$' and investor_wallet<>'0x0000000000000000000000000000000000000000'),
  units numeric(78,0) not null check(units>0 and units<1e38),
  amount_minor numeric(78,0) not null check(amount_minor>0),
  status text not null default 'SUBSCRIBED' check(status in ('SUBSCRIBED','FUNDED','MINT_PREPARED','ISSUED')),
  created_at timestamptz not null default clock_timestamp(), unique(id,fund_id)
);
create table bx1_demo.holdings (
  fund_id uuid not null references bx1_demo.funds(id), investor_wallet text not null,
  units numeric(78,0) not null default 0 check(units>=0),
  reserved_units numeric(78,0) not null default 0 check(reserved_units>=0 and reserved_units<=units),
  primary key(fund_id,investor_wallet)
);
create table bx1_demo.redemptions (
  id uuid primary key default gen_random_uuid(), fund_id uuid not null references bx1_demo.funds(id),
  investor_wallet text not null, units numeric(78,0) not null check(units>0 and units<1e38),
  amount_minor numeric(78,0) not null check(amount_minor>0),
  status text not null default 'RESERVED' check(status in ('RESERVED','BURN_PREPARED','BURNED','PAID')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(fund_id,investor_wallet) references bx1_demo.holdings(fund_id,investor_wallet), unique(id,fund_id)
);
create table bx1_demo.operations (
  id uuid primary key default gen_random_uuid(), fund_id uuid not null references bx1_demo.funds(id),
  kind text not null check(kind in ('MINT','BURN')), source_id uuid not null,
  wallet text not null check(wallet ~ '^0x[0-9a-f]{40}$'),
  units numeric(78,0) not null check(units>0),
  status text not null default 'PREPARED' check(status in ('PREPARED','CONFIRMED')),
  transaction_hash text unique check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint check(block_number>0),
  created_at timestamptz not null default clock_timestamp(), confirmed_at timestamptz,
  unique(kind,source_id), unique(id,fund_id),
  check((status='PREPARED' and num_nonnulls(transaction_hash,block_number,confirmed_at)=0)
    or (status='CONFIRMED' and num_nonnulls(transaction_hash,block_number,confirmed_at)=3))
);
create table bx1_demo.distributions (
  id uuid primary key default gen_random_uuid(), fund_id uuid not null references bx1_demo.funds(id),
  amount_minor numeric(78,0) not null check(amount_minor>0),
  created_at timestamptz not null default clock_timestamp(), unique(id,fund_id)
);
create table bx1_demo.entitlements (
  distribution_id uuid not null references bx1_demo.distributions(id), investor_wallet text not null,
  units numeric(78,0) not null check(units>0), amount_minor numeric(78,0) not null check(amount_minor>=0),
  primary key(distribution_id,investor_wallet)
);
create table bx1_demo.journal_entries (
  id uuid primary key default gen_random_uuid(), fund_id uuid not null references bx1_demo.funds(id),
  event_kind text not null check(event_kind in ('TEST_FUNDING','TEST_INCOME','ISSUANCE_CASH','MINT','DISTRIBUTION','BURN','REDEMPTION_LIABILITY','TEST_PAYOUT')),
  source_id uuid not null, unit text not null check(unit in ('ZAR_TEST','FUND_UNIT')),
  created_at timestamptz not null default clock_timestamp(), unique(fund_id,event_kind,source_id)
);
create table bx1_demo.journal_lines (
  entry_id uuid not null references bx1_demo.journal_entries(id), line_number integer not null check(line_number in (1,2)),
  account text not null check(account in ('SYNTHETIC_CASH','SYNTHETIC_INCOME','CUSTOMER_SUBSCRIPTIONS','FUND_CAPITAL','DISTRIBUTIONS','REDEMPTION_PAYABLE','UNITS_ISSUED','INVESTOR_UNITS')),
  direction text not null check(direction in ('DEBIT','CREDIT')), amount numeric(78,0) not null check(amount>0),
  primary key(entry_id,line_number)
);
create table bx1_demo.requests (
  actor_id uuid not null references public.bx1_profiles(id), request_key uuid not null,
  command text not null, payload jsonb not null, payload_hash text not null,
  fund_id uuid not null references bx1_demo.funds(id), operation_id uuid,
  created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_key),
  foreign key(operation_id,fund_id) references bx1_demo.operations(id,fund_id)
);
create index bx1_demo_subscriptions_fund on bx1_demo.subscriptions(fund_id);
create index bx1_demo_redemptions_fund on bx1_demo.redemptions(fund_id);
create index bx1_demo_operations_fund on bx1_demo.operations(fund_id);
create index bx1_demo_distributions_fund on bx1_demo.distributions(fund_id);
create index bx1_demo_journal_fund on bx1_demo.journal_entries(fund_id);

-- No direct table or helper access, including for the chain verifier service.
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='bx1_demo' loop
    execute format('alter table bx1_demo.%I enable row level security',r.tablename);
    execute format('revoke all on table bx1_demo.%I from public,anon,authenticated,service_role,bx1_demo_chain_verifier',r.tablename);
  end loop;
end $$;

create function bx1_demo.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'demo_history_immutable' using errcode='23514'; end $$;
create trigger demo_journal_immutable before update or delete on bx1_demo.journal_entries for each row execute function bx1_demo.immutable();
create trigger demo_lines_immutable before update or delete on bx1_demo.journal_lines for each row execute function bx1_demo.immutable();
create trigger demo_distribution_immutable before update or delete on bx1_demo.distributions for each row execute function bx1_demo.immutable();
create trigger demo_entitlement_immutable before update or delete on bx1_demo.entitlements for each row execute function bx1_demo.immutable();
create trigger demo_request_immutable before update or delete on bx1_demo.requests for each row execute function bx1_demo.immutable();
create function bx1_demo.check_journal() returns trigger language plpgsql set search_path='' as $$
declare selected_id uuid; line_count integer; net numeric;
begin
  if TG_TABLE_NAME='journal_entries' then selected_id:=NEW.id; else selected_id:=NEW.entry_id; end if;
  select count(*),sum(case when direction='DEBIT' then amount else -amount end) into line_count,net from bx1_demo.journal_lines where entry_id=selected_id;
  if line_count<>2 or net is distinct from 0::numeric then raise exception 'demo_unbalanced_journal' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger demo_entry_balanced after insert on bx1_demo.journal_entries deferrable initially deferred for each row execute function bx1_demo.check_journal();
create constraint trigger demo_lines_balanced after insert on bx1_demo.journal_lines deferrable initially deferred for each row execute function bx1_demo.check_journal();
create function bx1_demo.freeze_fund() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' or NEW.id<>OLD.id or NEW.organisation_id<>OLD.organisation_id or NEW.created_by<>OLD.created_by
    or NEW.name<>OLD.name or NEW.unit_price_minor<>OLD.unit_price_minor or NEW.cap_units<>OLD.cap_units or NEW.chain_id<>OLD.chain_id
    or NEW.created_at<>OLD.created_at or (OLD.status='OPEN' and NEW.status<>'OPEN')
    or (OLD.contract_address is not null and (NEW.contract_address,NEW.contract_owner,NEW.deployment_transaction_hash)
      is distinct from (OLD.contract_address,OLD.contract_owner,OLD.deployment_transaction_hash)) then
    raise exception 'demo_terms_immutable' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger demo_fund_terms_immutable before update or delete on bx1_demo.funds for each row execute function bx1_demo.freeze_fund();

create function bx1_demo.allowed(target uuid,token_guard boolean default true) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare live boolean:=false;
begin
  if auth.uid() is null then return false; end if;
  if to_regprocedure('bx1_private.has_active_session()') is not null then
    execute 'select bx1_private.has_active_session()' into live;
    if not coalesce(live,false) then return false; end if;
  else return false; end if;
  if to_regprocedure('bx1_private.can_access_organisation(uuid)') is null then return false; end if;
  execute 'select bx1_private.can_access_organisation($1)' into live using target;
  if not coalesce(live,false) then return false; end if;
  if to_regprocedure('bx1_private.has_token_mfa()') is null or to_regprocedure('bx1_private.has_session_mfa()') is null then return false; end if;
  if token_guard then
    execute 'select bx1_private.has_token_mfa()' into live;
    if not coalesce(live,false) then return false; end if;
  end if;
  return exists(select 1 from public.bx1_profiles p join public.bx1_memberships m on m.user_id=p.id
    join public.bx1_organisations o on o.id=m.organisation_id
    where p.id=auth.uid() and p.status='ACTIVE' and m.organisation_id=target and m.status='ACTIVE' and o.status='ACTIVE');
exception when others then return false;
end $$;
create function bx1_demo.positive(value jsonb,max_digits integer default 38) returns numeric language plpgsql immutable set search_path='' as $$
declare text_value text;
begin
  if jsonb_typeof(value) is distinct from 'string' then raise exception 'demo_invalid_amount' using errcode='22023'; end if;
  text_value:=value#>>'{}';
  if text_value !~ '^[1-9][0-9]*$' or length(text_value)>max_digits then raise exception 'demo_invalid_amount' using errcode='22023'; end if;
  return text_value::numeric;
end $$;
create function bx1_demo.wallet(value jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
  if jsonb_typeof(value) is distinct from 'string' then raise exception 'demo_invalid_wallet' using errcode='22023'; end if;
  result:=lower(value#>>'{}');
  if result !~ '^0x[0-9a-f]{40}$' or result='0x0000000000000000000000000000000000000000' then raise exception 'demo_invalid_wallet' using errcode='22023'; end if;
  return result;
end $$;
create function bx1_demo.post(fund uuid,event text,source uuid,unit_name text,value numeric,debit_account text,credit_account text) returns void
language plpgsql set search_path='' as $$
declare entry uuid;
begin
  if value<=0 or value<>trunc(value) or debit_account=credit_account then raise exception 'demo_invalid_posting' using errcode='23514'; end if;
  insert into bx1_demo.journal_entries(fund_id,event_kind,source_id,unit) values(fund,event,source,unit_name) returning id into entry;
  insert into bx1_demo.journal_lines(entry_id,line_number,account,direction,amount) values
    (entry,1,debit_account,'DEBIT',value),(entry,2,credit_account,'CREDIT',value);
end $$;
create function bx1_demo.cash(fund uuid) returns numeric language sql stable set search_path='' as $$
  select coalesce(sum(case when l.direction='DEBIT' then l.amount else -l.amount end),0)
    from bx1_demo.journal_entries e join bx1_demo.journal_lines l on l.entry_id=e.id
    where e.fund_id=fund and e.unit='ZAR_TEST' and l.account='SYNTHETIC_CASH';
$$;
create function bx1_demo.reserved_cash(fund uuid) returns numeric language sql stable set search_path='' as $$
  select coalesce(sum(amount_minor),0) from bx1_demo.redemptions where fund_id=fund and status<>'PAID';
$$;
create function bx1_demo.operation_view(o bx1_demo.operations) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',o.id,'fund_id',o.fund_id,'kind',o.kind,'wallet',o.wallet,'units',o.units::text,'status',o.status,
    'transaction_hash',o.transaction_hash,'block_number',o.block_number::text);
$$;
create function bx1_demo.fund_view(f bx1_demo.funds) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',f.id,'organisation_id',f.organisation_id,'created_by',f.created_by,'name',f.name,'status',f.status,'chain_id',f.chain_id,
    'currency','ZAR_TEST','cash_decimals',2,'unit_decimals',0,'unit_price_minor',f.unit_price_minor::text,'cap_units',f.cap_units::text,
    'contract_address',f.contract_address,'contract_owner',f.contract_owner,'deployment_transaction_hash',f.deployment_transaction_hash,
    'issued_units',(select coalesce(sum(units),0)::text from bx1_demo.holdings where fund_id=f.id),
    'reserved_subscription_units',(select coalesce(sum(units),0)::text from bx1_demo.subscriptions where fund_id=f.id and status<>'ISSUED'),
    'reserved_redemption_units',(select coalesce(sum(reserved_units),0)::text from bx1_demo.holdings where fund_id=f.id),
    'synthetic_cash_minor',bx1_demo.cash(f.id)::text,
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'investor_wallet',s.investor_wallet,'units',s.units::text,'amount_minor',s.amount_minor::text,'status',s.status,
      'operation_id',(select id from bx1_demo.operations where kind='MINT' and source_id=s.id)) order by s.created_at,s.id) from bx1_demo.subscriptions s where s.fund_id=f.id),'[]'),
    'holdings',coalesce((select jsonb_agg(jsonb_build_object('investor_wallet',h.investor_wallet,'units',h.units::text,'reserved_units',h.reserved_units::text) order by h.investor_wallet) from bx1_demo.holdings h where h.fund_id=f.id),'[]'),
    'distributions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'amount_minor',d.amount_minor::text,'created_at',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'entitlements',(select jsonb_agg(jsonb_build_object('investor_wallet',e.investor_wallet,'units',e.units::text,'amount_minor',e.amount_minor::text) order by e.investor_wallet) from bx1_demo.entitlements e where e.distribution_id=d.id)) order by d.created_at,d.id) from bx1_demo.distributions d where d.fund_id=f.id),'[]'),
    'redemptions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'investor_wallet',r.investor_wallet,'units',r.units::text,'amount_minor',r.amount_minor::text,'status',r.status,
      'operation_id',(select id from bx1_demo.operations where kind='BURN' and source_id=r.id)) order by r.created_at,r.id) from bx1_demo.redemptions r where r.fund_id=f.id),'[]'),
    'operations',coalesce((select jsonb_agg(bx1_demo.operation_view(o) order by o.created_at,o.id) from bx1_demo.operations o where o.fund_id=f.id),'[]'),
    'journal',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_kind',e.event_kind,'unit',e.unit,'source_id',e.source_id,
      'lines',(select jsonb_agg(jsonb_build_object('account',l.account,'direction',l.direction,'amount',l.amount::text) order by l.line_number) from bx1_demo.journal_lines l where l.entry_id=e.id)) order by e.created_at,e.id) from bx1_demo.journal_entries e where e.fund_id=f.id),'[]'));
$$;

create function public.bx1_demo_snapshot(p_fund_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'demo_forbidden' using errcode='42501'; end if;
  if p_fund_id is not null and not exists(select 1 from bx1_demo.funds f where f.id=p_fund_id and bx1_demo.allowed(f.organisation_id)) then
    raise exception 'demo_forbidden' using errcode='42501';
  end if;
  select jsonb_build_object('funds',coalesce(jsonb_agg(bx1_demo.fund_view(f) order by f.created_at desc,f.id),'[]')) into result
    from (select * from bx1_demo.funds where (p_fund_id is null or id=p_fund_id) and bx1_demo.allowed(organisation_id) order by created_at desc,id limit 20) f;
  return result;
end $$;

create function public.bx1_demo_command(p_command text,p_key uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare actor uuid:=auth.uid(); f bx1_demo.funds; s bx1_demo.subscriptions; r bx1_demo.redemptions; o bx1_demo.operations;
  prior bx1_demo.requests; selected_fund uuid; selected_org uuid; value numeric; amount numeric; total numeric; allocated numeric;
  selected_wallet text; selected_distribution uuid; payload_hash text; expected_keys text[]; result jsonb;
begin
  perform set_config('lock_timeout','3s',true);
  if actor is null then raise exception 'demo_forbidden' using errcode='42501'; end if;
  if p_key is null or p_key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>4096 then
    raise exception 'demo_invalid_request' using errcode='22023';
  end if;
  expected_keys:=case p_command
    when 'create_fund' then array['organisation_id','name','unit_price_minor','cap_units']
    when 'open_offering' then array['fund_id']
    when 'subscribe' then array['fund_id','units','investor_wallet']
    when 'record_test_funding' then array['fund_id','subscription_id']
    when 'prepare_mint' then array['fund_id','subscription_id']
    when 'record_test_income' then array['fund_id','amount_minor']
    when 'record_distribution' then array['fund_id','amount_minor']
    when 'request_redemption' then array['fund_id','units','investor_wallet']
    when 'prepare_burn' then array['fund_id','redemption_id']
    when 'complete_test_payout' then array['fund_id','redemption_id'] else null end;
  if expected_keys is null or not p_payload ?& expected_keys or p_payload-expected_keys<>'{}'::jsonb then raise exception 'demo_invalid_request' using errcode='22023'; end if;
  payload_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('bx1-demo:'||actor::text||':'||p_key::text,0));
  select * into prior from bx1_demo.requests where actor_id=actor and request_key=p_key;
  if found then
    if prior.command is distinct from p_command or prior.payload_hash<>payload_hash or prior.payload is distinct from p_payload then raise exception 'demo_key_conflict' using errcode='23505'; end if;
    select * into f from bx1_demo.funds where id=prior.fund_id for update;
    if f.created_by<>actor or not bx1_demo.allowed(f.organisation_id) then raise exception 'demo_forbidden' using errcode='42501'; end if;
    result:=jsonb_build_object('funds',jsonb_build_array(bx1_demo.fund_view(f)));
    if prior.operation_id is not null then select * into o from bx1_demo.operations where id=prior.operation_id; result:=result||jsonb_build_object('operation',bx1_demo.operation_view(o)); end if;
    return result;
  end if;
  if p_command='create_fund' then
    selected_org:=(p_payload->>'organisation_id')::uuid;
    if not coalesce(bx1_demo.allowed(selected_org),false) then raise exception 'demo_forbidden' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended('bx1-demo-org:'||selected_org::text,0));
    if (select count(*) from bx1_demo.funds where organisation_id=selected_org)>=20 then raise exception 'demo_limit' using errcode='23514'; end if;
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or length(btrim(p_payload->>'name')) not between 1 and 120 then raise exception 'demo_invalid_name' using errcode='22023'; end if;
    insert into bx1_demo.funds(organisation_id,created_by,name,unit_price_minor,cap_units)
      values(selected_org,actor,btrim(p_payload->>'name'),bx1_demo.positive(p_payload->'unit_price_minor'),bx1_demo.positive(p_payload->'cap_units')) returning * into f;
  else
    selected_fund:=(p_payload->>'fund_id')::uuid;
    select * into f from bx1_demo.funds where id=selected_fund for update;
    if f.id is null or f.created_by<>actor or not coalesce(bx1_demo.allowed(f.organisation_id),false) then raise exception 'demo_forbidden' using errcode='42501'; end if;
    if p_command='open_offering' then
      if f.contract_address is null then raise exception 'demo_contract_unbound' using errcode='23514'; end if;
      update bx1_demo.funds set status='OPEN' where id=f.id returning * into f;
    else
      if f.status<>'OPEN' then raise exception 'demo_offering_not_open' using errcode='23514'; end if;
      if p_command='subscribe' then
        value:=bx1_demo.positive(p_payload->'units'); selected_wallet:=bx1_demo.wallet(p_payload->'investor_wallet');
        select coalesce(sum(units),0),count(*) into total,allocated from bx1_demo.subscriptions where fund_id=f.id;
        if total+value>f.cap_units or allocated>=100 then raise exception 'demo_capacity_exceeded' using errcode='23514'; end if;
        insert into bx1_demo.subscriptions(fund_id,investor_wallet,units,amount_minor) values(f.id,selected_wallet,value,value*f.unit_price_minor);
      elsif p_command in ('record_test_funding','prepare_mint') then
        select * into s from bx1_demo.subscriptions where id=(p_payload->>'subscription_id')::uuid and fund_id=f.id for update;
        if s.id is null then raise exception 'demo_not_found' using errcode='22023'; end if;
        if p_command='record_test_funding' then
          if s.status<>'SUBSCRIBED' then raise exception 'demo_invalid_state' using errcode='23514'; end if;
          perform bx1_demo.post(f.id,'TEST_FUNDING',s.id,'ZAR_TEST',s.amount_minor,'SYNTHETIC_CASH','CUSTOMER_SUBSCRIPTIONS');
          update bx1_demo.subscriptions set status='FUNDED' where id=s.id;
        else
          if s.status<>'FUNDED' then raise exception 'demo_invalid_state' using errcode='23514'; end if;
          insert into bx1_demo.operations(fund_id,kind,source_id,wallet,units) values(f.id,'MINT',s.id,s.investor_wallet,s.units) returning * into o;
          update bx1_demo.subscriptions set status='MINT_PREPARED' where id=s.id;
        end if;
      elsif p_command='record_test_income' then
        amount:=bx1_demo.positive(p_payload->'amount_minor',76);
        if amount>f.unit_price_minor*f.cap_units or (select count(*) from bx1_demo.journal_entries where fund_id=f.id and event_kind='TEST_INCOME')>=100 then raise exception 'demo_limit' using errcode='23514'; end if;
        if not exists(select 1 from bx1_demo.holdings where fund_id=f.id and units>0) then raise exception 'demo_no_holders' using errcode='23514'; end if;
        perform bx1_demo.post(f.id,'TEST_INCOME',gen_random_uuid(),'ZAR_TEST',amount,'SYNTHETIC_CASH','SYNTHETIC_INCOME');
      elsif p_command='record_distribution' then
        amount:=bx1_demo.positive(p_payload->'amount_minor',76);
        if amount>bx1_demo.cash(f.id)-bx1_demo.reserved_cash(f.id) then raise exception 'demo_insufficient_cash' using errcode='23514'; end if;
        if (select count(*) from bx1_demo.distributions where fund_id=f.id)>=50 then raise exception 'demo_limit' using errcode='23514'; end if;
        -- Do not distribute unissued subscribers' consideration.
        if exists(select 1 from bx1_demo.subscriptions where fund_id=f.id and status in ('FUNDED','MINT_PREPARED')) then raise exception 'demo_unissued_funding' using errcode='23514'; end if;
        if exists(select 1 from bx1_demo.operations where fund_id=f.id and status='PREPARED') then raise exception 'demo_chain_pending' using errcode='23514'; end if;
        select coalesce(sum(units),0) into total from bx1_demo.holdings where fund_id=f.id;
        if total<=0 then raise exception 'demo_no_holders' using errcode='23514'; end if;
        insert into bx1_demo.distributions(fund_id,amount_minor) values(f.id,amount) returning id into selected_distribution;
        -- Largest remainder, wallet-ordered tie break: sum entitlements EXACTLY
        -- equals the budget, with immutable record-date units and no float math.
        insert into bx1_demo.entitlements(distribution_id,investor_wallet,units,amount_minor)
          with portions as (
            select h.investor_wallet,h.units,div(amount*h.units,total) base,mod(amount*h.units,total) remainder
            from bx1_demo.holdings h where h.fund_id=f.id and h.units>0
          ), ranked as (
            select p.*,row_number() over(order by remainder desc,investor_wallet) position,
              amount-sum(base) over() residual from portions p
          ) select selected_distribution,investor_wallet,units,base+case when position<=residual then 1 else 0 end from ranked;
        perform bx1_demo.post(f.id,'DISTRIBUTION',selected_distribution,'ZAR_TEST',amount,'DISTRIBUTIONS','SYNTHETIC_CASH');
      elsif p_command='request_redemption' then
        value:=bx1_demo.positive(p_payload->'units'); selected_wallet:=bx1_demo.wallet(p_payload->'investor_wallet'); amount:=value*f.unit_price_minor;
        if not exists(select 1 from bx1_demo.holdings where fund_id=f.id and investor_wallet=selected_wallet and units-reserved_units>=value) then raise exception 'demo_insufficient_units' using errcode='23514'; end if;
        if amount>bx1_demo.cash(f.id)-bx1_demo.reserved_cash(f.id)
          -(select coalesce(sum(amount_minor),0) from bx1_demo.subscriptions where fund_id=f.id and status in ('FUNDED','MINT_PREPARED')) then raise exception 'demo_insufficient_cash' using errcode='23514'; end if;
        if (select count(*) from bx1_demo.redemptions where fund_id=f.id)>=100 then raise exception 'demo_limit' using errcode='23514'; end if;
        insert into bx1_demo.redemptions(fund_id,investor_wallet,units,amount_minor) values(f.id,selected_wallet,value,amount);
        update bx1_demo.holdings set reserved_units=reserved_units+value where fund_id=f.id and investor_wallet=selected_wallet;
      elsif p_command in ('prepare_burn','complete_test_payout') then
        select * into r from bx1_demo.redemptions where id=(p_payload->>'redemption_id')::uuid and fund_id=f.id for update;
        if r.id is null then raise exception 'demo_not_found' using errcode='22023'; end if;
        if p_command='prepare_burn' then
          if r.status<>'RESERVED' then raise exception 'demo_invalid_state' using errcode='23514'; end if;
          insert into bx1_demo.operations(fund_id,kind,source_id,wallet,units) values(f.id,'BURN',r.id,r.investor_wallet,r.units) returning * into o;
          update bx1_demo.redemptions set status='BURN_PREPARED' where id=r.id;
        else
          if r.status<>'BURNED' then raise exception 'demo_invalid_state' using errcode='23514'; end if;
          if r.amount_minor>bx1_demo.cash(f.id) then raise exception 'demo_insufficient_cash' using errcode='23514'; end if;
          perform bx1_demo.post(f.id,'TEST_PAYOUT',r.id,'ZAR_TEST',r.amount_minor,'REDEMPTION_PAYABLE','SYNTHETIC_CASH');
          update bx1_demo.redemptions set status='PAID' where id=r.id;
        end if;
      end if;
    end if;
  end if;
  if f.created_by<>actor or not bx1_demo.allowed(f.organisation_id) then raise exception 'demo_forbidden' using errcode='42501'; end if;
  insert into bx1_demo.requests(actor_id,request_key,command,payload,payload_hash,fund_id,operation_id) values(actor,p_key,p_command,p_payload,payload_hash,f.id,o.id);
  result:=jsonb_build_object('funds',jsonb_build_array(bx1_demo.fund_view(f)));
  if o.id is not null then result:=result||jsonb_build_object('operation',bx1_demo.operation_view(o)); end if;
  return result;
end $$;

-- Trusted backend MUST independently verify deployment chain, bytecode, owner,
-- immutable cap/decimals and receipt before this write. No presenter RPC route.
-- actor/session are trusted-backend assertions from getUser(exact signed JWT),
-- NOT independently authenticated SQL arguments. SQL rechecks live session,
-- enrolled-factor state, presenter and scope after locking; it does not verify JWTs.
create function public.bx1_demo_bind_contract(p_fund_id uuid,p_contract_address text,p_deployer text,p_transaction_hash text,p_actor_id uuid,p_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare f bx1_demo.funds; address text; owner_address text; verified_hash text:=lower(p_transaction_hash);
begin
  perform set_config('lock_timeout','3s',true);
  address:=bx1_demo.wallet(to_jsonb(p_contract_address)); owner_address:=bx1_demo.wallet(to_jsonb(p_deployer));
  if verified_hash is null or verified_hash !~ '^0x[0-9a-f]{64}$' or verified_hash='0x'||repeat('0',64) then raise exception 'demo_invalid_transaction' using errcode='22023'; end if;
  select * into f from bx1_demo.funds where id=p_fund_id for update;
  if f.id is null then raise exception 'demo_not_found' using errcode='22023'; end if;
  if p_actor_id is null or p_session_id is null then raise exception 'demo_forbidden' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'session_id',p_session_id,'role','authenticated')::text,true);
  if f.created_by<>p_actor_id or not bx1_demo.allowed(f.organisation_id,false) then raise exception 'demo_forbidden' using errcode='42501'; end if;
  if f.contract_address is not null then
    if (f.contract_address,f.contract_owner,f.deployment_transaction_hash) is distinct from (address,owner_address,verified_hash) then raise exception 'demo_binding_conflict' using errcode='23505'; end if;
  else
    if f.status<>'DRAFT' then raise exception 'demo_invalid_state' using errcode='23514'; end if;
    update bx1_demo.funds set contract_address=address,contract_owner=owner_address,deployment_transaction_hash=verified_hash where id=f.id returning * into f;
  end if;
  return jsonb_build_object('funds',jsonb_build_array(bx1_demo.fund_view(f)));
end $$;

-- Confirmation is a verifier-only database boundary, NOT an RPC accepting a
-- browser's unverified receipt. Verify final receipt + exact operation event,
-- chain80002, contract, wallet, units and known signer before calling.
create function public.bx1_demo_confirm_chain(p_operation_id uuid,p_transaction_hash text,p_block_number bigint,p_contract_address text,p_actor_id uuid,p_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='10s' as $$
declare o bx1_demo.operations; f bx1_demo.funds; s bx1_demo.subscriptions; r bx1_demo.redemptions;
  verified_hash text:=lower(p_transaction_hash); selected_fund uuid;
begin
  perform set_config('lock_timeout','3s',true);
  if verified_hash is null or verified_hash !~ '^0x[0-9a-f]{64}$' or verified_hash='0x'||repeat('0',64) or p_block_number is null or p_block_number<=0 then raise exception 'demo_invalid_transaction' using errcode='22023'; end if;
  select fund_id into selected_fund from bx1_demo.operations where id=p_operation_id;
  select * into f from bx1_demo.funds where id=selected_fund for update;
  select * into o from bx1_demo.operations where id=p_operation_id for update;
  if o.id is null or f.id is null then raise exception 'demo_not_found' using errcode='22023'; end if;
  if p_actor_id is null or p_session_id is null then raise exception 'demo_forbidden' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'session_id',p_session_id,'role','authenticated')::text,true);
  if f.created_by<>p_actor_id or not bx1_demo.allowed(f.organisation_id,false) then raise exception 'demo_forbidden' using errcode='42501'; end if;
  if lower(p_contract_address) is distinct from f.contract_address then raise exception 'demo_wrong_contract' using errcode='23514'; end if;
  if o.status='CONFIRMED' then
    if (o.transaction_hash,o.block_number) is distinct from (verified_hash,p_block_number) then raise exception 'demo_confirmation_conflict' using errcode='23505'; end if;
  else
    if o.kind='MINT' then
      select * into s from bx1_demo.subscriptions where id=o.source_id and fund_id=f.id for update;
      if s.status is distinct from 'MINT_PREPARED' or s.units<>o.units or s.investor_wallet<>o.wallet then raise exception 'demo_invalid_state' using errcode='23514'; end if;
      insert into bx1_demo.holdings(fund_id,investor_wallet,units) values(f.id,o.wallet,o.units)
        on conflict(fund_id,investor_wallet) do update set units=bx1_demo.holdings.units+excluded.units;
      perform bx1_demo.post(f.id,'MINT',o.id,'FUND_UNIT',o.units,'UNITS_ISSUED','INVESTOR_UNITS');
      perform bx1_demo.post(f.id,'ISSUANCE_CASH',s.id,'ZAR_TEST',s.amount_minor,'CUSTOMER_SUBSCRIPTIONS','FUND_CAPITAL');
      update bx1_demo.subscriptions set status='ISSUED' where id=s.id;
    else
      select * into r from bx1_demo.redemptions where id=o.source_id and fund_id=f.id for update;
      if r.status is distinct from 'BURN_PREPARED' or r.units<>o.units or r.investor_wallet<>o.wallet then raise exception 'demo_invalid_state' using errcode='23514'; end if;
      update bx1_demo.holdings set units=units-o.units,reserved_units=reserved_units-o.units where fund_id=f.id and investor_wallet=o.wallet and units>=o.units and reserved_units>=o.units;
      if not found then raise exception 'demo_insufficient_units' using errcode='23514'; end if;
      perform bx1_demo.post(f.id,'BURN',o.id,'FUND_UNIT',o.units,'INVESTOR_UNITS','UNITS_ISSUED');
      perform bx1_demo.post(f.id,'REDEMPTION_LIABILITY',r.id,'ZAR_TEST',r.amount_minor,'FUND_CAPITAL','REDEMPTION_PAYABLE');
      update bx1_demo.redemptions set status='BURNED' where id=r.id;
    end if;
    update bx1_demo.operations set status='CONFIRMED',transaction_hash=verified_hash,block_number=p_block_number,confirmed_at=clock_timestamp() where id=o.id returning * into o;
  end if;
  return jsonb_build_object('funds',jsonb_build_array(bx1_demo.fund_view(f)),'operation',bx1_demo.operation_view(o));
end $$;

revoke all on all functions in schema bx1_demo from public,anon,authenticated,service_role,bx1_demo_chain_verifier;
revoke all on function public.bx1_demo_snapshot(uuid),public.bx1_demo_command(text,uuid,jsonb),
  public.bx1_demo_bind_contract(uuid,text,text,text,uuid,uuid),public.bx1_demo_confirm_chain(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated,service_role,bx1_demo_chain_verifier;
grant execute on function public.bx1_demo_snapshot(uuid),public.bx1_demo_command(text,uuid,jsonb) to authenticated;
grant execute on function public.bx1_demo_bind_contract(uuid,text,text,text,uuid,uuid),public.bx1_demo_confirm_chain(uuid,text,bigint,text,uuid,uuid) to bx1_demo_chain_verifier;
comment on schema bx1_demo is 'TEST ONLY: fictional presenter-led fund demo; synthetic ZAR_TEST, no real money, no production authority. Never expose this schema in the Data API.';
