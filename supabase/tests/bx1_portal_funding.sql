-- Disposable GitHub PostgreSQL17 fixture only. These are NOT hosted people,
-- legal authorities, deployed tokens, wallet signatures or chain receipts.
do $$ begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres'
    or (select count(*) from auth.users where email like 'portal-synthetic-%@example.invalid')<>9 then
    raise exception 'funding_fixture_disposable_database_required';
  end if;
end $$;
insert into public.bx1_memberships(user_id,organisation_id,role)
select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'0ba2b126-bd85-4cfb-9a1d-83633c9def1e',role
from (values(5,'TreasuryOperator'),(2,'FinancialController'),(4,'FinancialController'),(5,'FinancialController')) v(n,role);
insert into public.bx1_memberships(user_id,organisation_id,role) values
('e1000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','FinancialController');
insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id)
select o.id,'0ba2b126-bd85-4cfb-9a1d-83633c9def1e',r.role,'ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',
  'synthetic-cloud-proof:explicit-finance-authority','ec000000-0000-4000-8000-000000000002'
from bx1_portal.organisations o cross join (values('TreasuryOperator'),('FinancialController')) r(role)
where o.owner_id='e1000000-0000-4000-8000-000000000001';
