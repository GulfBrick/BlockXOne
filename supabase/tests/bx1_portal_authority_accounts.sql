-- Synthetic identities and evidence-backed mappings ONLY in the disposable
-- GitHub PostgreSQL17 service. Never run against Supabase or a customer DB.
do $$ begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres'
    or (select count(*) from auth.users where email like 'portal-synthetic-%@example.invalid')<>9 then
    raise exception 'portal_scoped_fixture_disposable_database_required';
  end if;
end $$;
insert into public.bx1_profiles(id,display_name)
select id,'Synthetic scoped investor '||right(id::text,1) from auth.users where right(id::text,1) in ('3','6');
insert into public.bx1_memberships(user_id,organisation_id,role)
select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'0ba2b126-bd85-4cfb-9a1d-83633c9def1e',role
from (values(1,'OfferingManager'),(1,'IssuerFundManager'),(1,'ComplianceOfficer'),(3,'Investor'),(6,'Investor'),
  (5,'OfferingManager'),(1,'TransferAgent'),(1,'TokenisationAgent'),(1,'TreasuryOperator'),(1,'FinancialController'),(1,'SuperAdmin')) v(n,role);
insert into public.bx1_memberships(user_id,organisation_id,role) values
('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000002','OfferingManager'),
('e1000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000002','OfferingManager');
insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id)
select o.id,'0ba2b126-bd85-4cfb-9a1d-83633c9def1e',r.role,'ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',
  'synthetic-cloud-proof:explicit-product-organisation-scope','ec000000-0000-4000-8000-000000000001'
from bx1_portal.organisations o cross join (values('OfferingManager'),('IssuerFundManager'),('ComplianceOfficer')) r(role)
where o.owner_id='e1000000-0000-4000-8000-000000000001';
