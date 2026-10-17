-- Existing TEST project and saved fund only. User authorised Daniel's single-human
-- TEST role-play and supplied both public MetaMask addresses. This does not prove
-- wallet control, independent humans, product approval or any chain effect.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $preflight$
begin
  if current_user <> 'postgres' or session_user <> 'postgres'
    or bx1_private.test_roleplay_environment() is not true
    or (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
        from pg_catalog.pg_proc where oid='bx1_private.fund_roleplay_provision_operator(uuid,uuid,jsonb)'::regprocedure)
      is distinct from 'be023eb5403b0fcd183677a618296279e192bbfd4b66b8658abfeb903995f10d'
    or (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
        from pg_catalog.pg_proc where oid='bx1_private.test_roleplay_provision(uuid,uuid,jsonb)'::regprocedure)
      is distinct from 'a7e9bdd60e255b8347ca7e443381bcaa9756f2ed8439c2c7fb4abefac8a0ab2b'
    or not exists(select 1 from public.bx1_memberships
      where id='2992fd87-d470-42c4-90c1-be7c01a8dd3b'
        and user_id='988d46c4-a585-4793-92b3-f1ae964e63bd'
        and organisation_id='0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
        and role='SuperAdmin' and status='ACTIVE'
        and bx1_portal.native_membership_effective(id)) then
    raise exception 'exact_test_roleplay_owner_and_implementation_required';
  end if;
end $preflight$;

create temporary table bx1_current_fund_roleplay_result on commit drop as
select bx1_private.fund_roleplay_provision_operator(
  '988d46c4-a585-4793-92b3-f1ae964e63bd',
  '056105da-b820-4ffb-8851-d267a9423270',
  pg_catalog.jsonb_build_object(
    'product_id','8f02d068-4fdb-48be-8b7a-12316d0b564d',
    'offering_revision_id','ff94499a-17b2-4cb9-b77a-42e822c848b1',
    'expected_product_revision',2,
    'terms_hash','7e445267efa4f58ee640ab11c93533ac7b9c718318fc08650a7c9f5f3b2e191a',
    'native_organisation_id','0ba2b126-bd85-4cfb-9a1d-83633c9def1e',
    'owner_membership_id','2992fd87-d470-42c4-90c1-be7c01a8dd3b',
    'owner_reference','User-authorised TEST-only single-human Daniel fund role-play; second public MetaMask address supplied 2026-10-15. MAIN unchanged; addresses declared, not verified.',
    'operator_person_id','fc527fd8-7459-4d8b-bc26-b2fd1aceb81d',
    'operator_label','Daniel fund operator',
    'operator_user_id','988d46c4-a585-4793-92b3-f1ae964e63bd',
    'capacities',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role',r,'actions',pg_catalog.to_jsonb(bx1_private.test_roleplay_role_actions(r))) order by r)
      from pg_catalog.unnest(array['Investor','OfferingManager','IssuerFundManager','ComplianceOfficer',
        'TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin']) r),
    'wallet_slots',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('role','TokenisationAgent','slot','signer_a',
        'wallet_address','0x27d1b26be9c04f4fd81c5cfd3975dae8b0f806fb'),
      pg_catalog.jsonb_build_object('role','TokenisationAgent','slot','signer_b',
        'wallet_address','0x751b4c05fe8052099c538abdfa0508ee304aedd7')),
    'valid_until','2026-10-21T10:23:05.503501+00:00',
    'expected_previous_version',0)) policy_id;

do $postcheck$
declare target uuid;
begin
  select policy_id into strict target from pg_temp.bx1_current_fund_roleplay_result;
  if not exists(select 1 from bx1_private.roleplay_policies
      where id=target and product_id='8f02d068-4fdb-48be-8b7a-12316d0b564d'
        and offering_revision_id='ff94499a-17b2-4cb9-b77a-42e822c848b1'
        and project_ref='fegnnnlseuejkrusbbkv' and environment='TESTNET'
        and assurance='TEST_ROLE_PLAY' and not independence_proven
        and version=1 and authority_epoch=1 and status='ACTIVE')
    or (select count(*) from bx1_private.roleplay_capacities where policy_id=target)<>9
    or (select count(*) from bx1_private.roleplay_wallet_slots
      where policy_id=target and chain_id=80002 and ownership_assurance='DECLARED_NOT_VERIFIED')<>2
    or not exists(select 1 from bx1_portal.products
      where id='8f02d068-4fdb-48be-8b7a-12316d0b564d' and status='IN_REVIEW' and revision=2
        and current_offering_revision_id='ff94499a-17b2-4cb9-b77a-42e822c848b1') then
    raise exception 'test_roleplay_exact_result_required';
  end if;
end $postcheck$;

select p.id policy_id,p.product_id,p.offering_revision_id,p.version,p.authority_epoch,
  p.assurance,p.independence_proven,p.valid_until,
  (select count(*) from bx1_private.roleplay_capacities c where c.policy_id=p.id) capacity_count,
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('slot',w.slot,
    'wallet_address',w.wallet_address,'chain_id',w.chain_id,'ownership_assurance',w.ownership_assurance) order by w.slot)
    from bx1_private.roleplay_wallet_slots w where w.policy_id=p.id) wallet_slots
from bx1_private.roleplay_policies p join pg_temp.bx1_current_fund_roleplay_result result on result.policy_id=p.id;

commit;
