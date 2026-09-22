-- CLOUD-CI PGlite synthetic substrate ONLY. Never apply to a Supabase project.
-- Runs after the unchanged identity/MFA/administration fixtures and five migrations.
insert into public.bx1_organisations(id,name) values
('30000000-0000-4000-8000-000000000003','Synthetic ordinary membership-only organisation'),
('30000000-0000-4000-8000-000000000004','Synthetic unrelated governed organisation');
insert into public.bx1_memberships(user_id,organisation_id,role) values
('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','Investor'),
('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Investor'),
('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','Investor');
insert into bx1_private.authority_scopes(organisation_id,state,revision,bootstrap_receipt_id) values
('30000000-0000-4000-8000-000000000002','HOLD',9,'70000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000004','READY',1,'70000000-0000-4000-8000-000000000001');
-- An expired grant still marked ACTIVE must be retired, not skipped.
insert into bx1_private.governance_grants(id,organisation_id,person_id,capability,status,valid_from,valid_until,revision,bootstrap_receipt_id) values
('80000000-0000-4000-8000-000000000099','30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','ADMINISTRATION_V1','ACTIVE',now()-interval '2 days',now()-interval '1 day',1,'70000000-0000-4000-8000-000000000001');
-- Target person1 has accounts1/2. Proposer person4 has accounts5/8.
-- Reviewer account4/person3 and unrelated third operator account3/person2.
insert into bx1_private.recovery_authorities(id,operator_person_id,target_person_id,valid_from,valid_until,evidence_reference)
select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '60000000-0000-4000-8000-000000000001',now()-interval '1 minute',now()+interval '1 hour','synthetic-recovery-authority-'||n
from unnest(array[2,3,4]) n;
-- Pre-existing proof history must remain intact while becoming unreadable to held users.
insert into bx1_private.wallet_challenges(id,nonce,user_id,platform_user_id,session_id,organisation_id,domain,chain_id,address,message,issued_at,expires_at)
values('a0000000-0000-4000-8000-000000000001',repeat('a',64),'10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','https://bx1.co.za',80002,
 '0x1111111111111111111111111111111111111111','Synthetic recovery regression proof',now(),now()+interval '5 minutes');
insert into public.bx1_wallets(user_id,platform_user_id,organisation_id,address,chain_id,verified_at,last_proof_id)
values('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
 '0x1111111111111111111111111111111111111111',80002,now(),'a0000000-0000-4000-8000-000000000001');
