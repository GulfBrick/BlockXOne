-- Synthetic PGlite substrate only. NEVER apply this file to a hosted database.
-- Stage 1: ordinary identities are deliberately not trusted-human bootstrap.
insert into auth.users(id)
select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
from generate_series(1,8) n;
insert into auth.sessions(id,user_id)
select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
from generate_series(1,8) n;
insert into public.bx1_profiles(id,platform_user_id)
select id, ('40000000-0000-4000-8000-' || right(id::text,12))::uuid from auth.users;
insert into public.bx1_organisations(id,name) values
('30000000-0000-4000-8000-000000000001','Synthetic administration organisation A'),
('30000000-0000-4000-8000-000000000002','Synthetic administration organisation B');
insert into public.bx1_memberships(user_id,organisation_id,role)
select '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', role
from unnest(array['Investor','OfferingManager','ComplianceOfficer','IssuerFundManager',
  'TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin']) role;
insert into public.bx1_memberships(user_id,organisation_id,role)
select id,'30000000-0000-4000-8000-000000000001','Investor' from auth.users
where id not in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006');
insert into public.bx1_memberships(user_id,organisation_id,role)
select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       '30000000-0000-4000-8000-000000000002','Investor'
from unnest(array[3,5,6,8]) n;

-- ADMINISTRATION_TRUST_FIXTURE
-- Stage 2: explicit synthetic attestation; users 1 and 2 are the SAME human.
insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id)
select ('60000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       'Synthetic person ' || n,'TRUSTED','synthetic-attestation-' || n,
       '70000000-0000-4000-8000-000000000001' from generate_series(1,5) n;
insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       ('60000000-0000-4000-8000-' || lpad((case when n=2 then 1 when n=8 then 4 when n>2 then n-1 else n end)::text,12,'0'))::uuid,
       'TRUSTED','synthetic-principal-' || n,'70000000-0000-4000-8000-000000000001'
from unnest(array[1,2,3,4,5,6,8]) n;
insert into bx1_private.authority_scopes(organisation_id,state,revision,bootstrap_receipt_id)
values ('30000000-0000-4000-8000-000000000001','READY',1,'70000000-0000-4000-8000-000000000001');
insert into bx1_private.governance_grants(id,organisation_id,person_id,capability,status,valid_from,valid_until,revision,bootstrap_receipt_id)
select ('80000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '30000000-0000-4000-8000-000000000001',
 ('60000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'ADMINISTRATION_V1','ACTIVE',now()-interval '1 minute',now()+interval '30 days',1,
 '70000000-0000-4000-8000-000000000001' from generate_series(1,2) n;
insert into auth.mfa_factors(id,user_id,status,factor_type)
select ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'verified','totp'
from generate_series(1,8) n;
update auth.sessions set aal='aal2',factor_id=('50000000-0000-4000-8000-' || right(user_id::text,12))::uuid;
