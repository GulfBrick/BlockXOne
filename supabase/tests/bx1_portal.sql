-- Synthetic PostgreSQL17 cloud fixture ONLY, never a hosted Supabase project.
-- Users 1/4 are one known human. Reviewer2 and investors3/6 are independent fixtures.
do $$ begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres' then raise exception 'portal_fixture_disposable_database_required'; end if;
end $$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'portal-synthetic-'||n||'@example.invalid',case when n=7 then null else now() end,false
from generate_series(1,9) n;
insert into auth.sessions(id,user_id,not_after,created_at)
select ('e2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()+interval '1 hour',now()-interval '1 hour'
from generate_series(1,9) n;
-- New applicants3/6/7/8/9 intentionally have NO native profile or membership.
insert into public.bx1_profiles(id,display_name)
select id,'Synthetic native person '||right(id::text,1) from auth.users where right(id::text,1) in ('1','2','4','5');
insert into public.bx1_organisations(id,name) values
  ('0ba2b126-bd85-4cfb-9a1d-83633c9def1e','Explicit synthetic portal compliance scope'),
  ('e3000000-0000-4000-8000-000000000002','Unrelated synthetic organisation');
insert into public.bx1_memberships(user_id,organisation_id,role) values
  ('e1000000-0000-4000-8000-000000000001','0ba2b126-bd85-4cfb-9a1d-83633c9def1e','Investor'),
  ('e1000000-0000-4000-8000-000000000002','0ba2b126-bd85-4cfb-9a1d-83633c9def1e','ComplianceOfficer'),
  ('e1000000-0000-4000-8000-000000000004','0ba2b126-bd85-4cfb-9a1d-83633c9def1e','ComplianceOfficer'),
  ('e1000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000002','ComplianceOfficer');
insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id)
select ('e6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic test human '||n,'TRUSTED','synthetic:test-human-'||n,'e7000000-0000-4000-8000-000000000001'
from generate_series(1,3) n;
insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('e6000000-0000-4000-8000-'||lpad((case when n=4 then 1 when n=5 then 3 else n end)::text,12,'0'))::uuid,
  'TRUSTED','synthetic:test-principal-'||n,'e7000000-0000-4000-8000-000000000001'
from unnest(array[1,2,4,5]) n;
-- Broad pre-existing policies deliberately test restrictive portal bucket guards.
create policy fixture_existing_storage_select on storage.objects for select to authenticated using(true);
create policy fixture_existing_storage_insert on storage.objects for insert to authenticated with check(true);
create policy fixture_existing_storage_update on storage.objects for update to authenticated using(true) with check(true);
create policy fixture_existing_storage_delete on storage.objects for delete to authenticated using(true);
insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata)
select 'bx1-portal-documents',u.id::text||'/synthetic-'||k.kind||'.pdf',u.id::text,
  '{"size":100,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',repeat('a',64))
from auth.users u cross join (values('IDENTITY'),('COMPANY'),('BENEFICIAL_OWNERS')) k(kind);
