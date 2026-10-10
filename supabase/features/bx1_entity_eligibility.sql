-- Stage 2 additive ENTITY eligibility; no investment execution or admission.
-- Apply transactionally after the accepted final reader/writer chain. Historical
-- INDIVIDUAL commands and execution predicates are delegated, never rewritten.
do $baseline$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regclass('bx1_portal.product_eligibility_cases') is null
    or pg_catalog.to_regprocedure('bx1_portal.product_appointment_authorised(jsonb,uuid,text)') is null
    or pg_catalog.to_regprocedure('bx1_portal.investing_mandate_effective(uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.application_document_access(uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null then
    raise exception 'entity_eligibility_baseline_required' using errcode='55000';
  end if;
end $baseline$;

alter table bx1_portal.product_eligibility_cases
  alter column holder_user_id drop not null,
  add column account_kind text not null default 'INDIVIDUAL',
  add column entity_party_id uuid references bx1_portal.legal_entity_parties(id) on delete restrict,
  add column representative_user_id uuid references auth.users(id) on delete restrict,
  add column representative_mandate_id uuid references bx1_portal.investing_representative_mandates(id) on delete restrict,
  add column mandate_cycle integer,
  add column mandate_revision integer,
  add column decision_appointment_id uuid references bx1_portal.product_service_appointments(id) on delete restrict,
  add column decision_appointment_revision integer,
  add constraint bx1_eligibility_subject_xor check (
    (account_kind='INDIVIDUAL' and holder_user_id is not null and entity_party_id is null
      and representative_user_id is null and representative_mandate_id is null
      and mandate_cycle is null and mandate_revision is null
      and decision_appointment_id is null and decision_appointment_revision is null)
    or (account_kind='ENTITY' and holder_user_id is null and entity_party_id is not null
      and representative_user_id is not null and representative_mandate_id is not null
      and mandate_cycle>0 and mandate_cycle is not null and mandate_revision>0 and mandate_revision is not null
      and offering_revision_id is not null
      and ((decision_appointment_id is null and decision_appointment_revision is null)
        or (decision_appointment_id is not null and decision_appointment_revision>0 and decision_appointment_revision is not null))
      and ((status='SUBMITTED' and decision_appointment_id is null and reviewer_id is null and reviewed_at is null)
        or (status<>'SUBMITTED' and decision_appointment_id is not null and reviewer_id is not null
          and reviewed_at is not null and review_notes is not null))
      and (status<>'APPROVED' or review_checks='{"identity":true,"product_fit":true,"restrictions":true,"source_of_funds":true}'::jsonb)));

alter table bx1_portal.product_eligibility_receipts
  add column account_kind text not null default 'INDIVIDUAL',
  add column investment_account_id uuid references bx1_portal.investment_accounts(id) on delete restrict,
  add column entity_party_id uuid references bx1_portal.legal_entity_parties(id) on delete restrict,
  add column representative_user_id uuid references auth.users(id) on delete restrict,
  add column representative_mandate_id uuid references bx1_portal.investing_representative_mandates(id) on delete restrict,
  add column mandate_cycle integer,
  add column mandate_revision integer,
  add column offering_revision_id uuid references bx1_portal.offering_revisions(id) on delete restrict,
  add column decision_appointment_id uuid references bx1_portal.product_service_appointments(id) on delete restrict,
  add column decision_appointment_revision integer,
  add constraint bx1_eligibility_receipt_subject_xor check (
    (account_kind='INDIVIDUAL' and investment_account_id is null and entity_party_id is null
      and representative_user_id is null and representative_mandate_id is null
      and mandate_cycle is null and mandate_revision is null and offering_revision_id is null
      and decision_appointment_id is null and decision_appointment_revision is null)
    or (account_kind='ENTITY' and investment_account_id is not null and entity_party_id is not null
      and representative_user_id is not null and representative_mandate_id is not null
      and mandate_cycle>0 and mandate_cycle is not null and mandate_revision>0 and mandate_revision is not null
      and offering_revision_id is not null
      and ((action='request_product_eligibility' and decision_appointment_id is null and decision_appointment_revision is null)
        or (action in ('review_product_eligibility','revoke_product_eligibility')
          and decision_appointment_id is not null and decision_appointment_revision>0 and decision_appointment_revision is not null))));

-- Cross-table consistency is checked on every insert/update, including owner
-- paths. Snapshots may precede a later revocation but cannot invent a revision.
create function bx1_portal.guard_entity_eligibility_subject() returns trigger
language plpgsql security definer set search_path='' as $$
declare e bx1_portal.product_eligibility_cases; m bx1_portal.investing_representative_mandates;
begin
  if TG_TABLE_NAME='product_eligibility_cases' then
    if TG_OP='UPDATE' then
      if NEW.account_kind is distinct from OLD.account_kind then
        raise exception 'entity_eligibility_subject_immutable' using errcode='23514'; end if;
    end if;
  else
    if not exists(select 1 from bx1_portal.product_eligibility_cases c where c.id=NEW.case_id and c.account_kind=NEW.account_kind) then
      raise exception 'entity_eligibility_receipt_kind_mismatch' using errcode='23514'; end if;
  end if;
  if NEW.account_kind<>'ENTITY' then return NEW; end if;
  if TG_TABLE_NAME='product_eligibility_cases' then e:=NEW;
  else
    select * into e from bx1_portal.product_eligibility_cases where id=NEW.case_id;
    if e.id is null or e.account_kind<>'ENTITY' or e.revision<>NEW.case_revision
      or row(NEW.investment_account_id,NEW.entity_party_id,NEW.representative_user_id,
        NEW.representative_mandate_id,NEW.mandate_cycle,NEW.mandate_revision,NEW.offering_revision_id,
        NEW.application_revision,NEW.product_revision,NEW.terms_hash,NEW.status_after,
        NEW.decision_appointment_id,NEW.decision_appointment_revision)
        is distinct from row(e.investment_account_id,e.entity_party_id,e.representative_user_id,
        e.representative_mandate_id,e.mandate_cycle,e.mandate_revision,e.offering_revision_id,
        e.application_revision,e.product_revision,e.terms_hash,e.status,
        e.decision_appointment_id,e.decision_appointment_revision)
      or NEW.actor_id is distinct from (case when NEW.action='request_product_eligibility'
        then e.representative_user_id else e.reviewer_id end) then
      raise exception 'entity_eligibility_receipt_subject_mismatch' using errcode='23514'; end if;
  end if;
  select * into m from bx1_portal.investing_representative_mandates where id=e.representative_mandate_id;
  if m.id is null or m.investment_account_id<>e.investment_account_id or m.entity_party_id<>e.entity_party_id
    or m.representative_user_id<>e.representative_user_id or m.cycle<>e.mandate_cycle
    or e.mandate_revision>m.revision or m.admission_revision<>e.application_revision
    or not exists(select 1 from bx1_portal.investment_accounts i
      join bx1_portal.legal_entity_parties p on p.id=i.entity_party_id and p.application_id=i.application_id
      where i.id=e.investment_account_id and i.kind='ENTITY' and i.holder_user_id is null
        and i.entity_party_id=e.entity_party_id and i.application_id=m.application_id
        and p.admission_revision=e.application_revision)
    or not exists(select 1 from bx1_portal.offering_revisions r
      join bx1_portal.products p on p.id=r.product_id
      where r.id=e.offering_revision_id and r.product_id=e.product_id
        and p.organisation_id=e.organisation_id and r.terms_hash=e.terms_hash)
    or (e.decision_appointment_id is not null and not exists(
      select 1 from bx1_portal.product_service_appointments a where a.id=e.decision_appointment_id
        and a.product_id=e.product_id and a.product_organisation_id=e.organisation_id
        and a.role='ComplianceOfficer' and a.appointee_user_id=e.reviewer_id
        and a.revision>=e.decision_appointment_revision)) then
    raise exception 'entity_eligibility_composite_mismatch' using errcode='23514'; end if;
  if TG_TABLE_NAME='product_eligibility_cases' and TG_OP='UPDATE' then
    if OLD.account_kind<>'ENTITY' or row(NEW.id,NEW.investment_account_id,NEW.entity_party_id,
      NEW.representative_user_id,NEW.product_id,NEW.organisation_id) is distinct from
      row(OLD.id,OLD.investment_account_id,OLD.entity_party_id,OLD.representative_user_id,OLD.product_id,OLD.organisation_id)
      or NEW.revision<>OLD.revision+1 or OLD.status='REVOKED'
      or not ((OLD.status='SUBMITTED' and NEW.status in ('APPROVED','CHANGES_REQUIRED','REJECTED'))
        or (OLD.status in ('CHANGES_REQUIRED','REJECTED','APPROVED') and NEW.status='SUBMITTED')
        or (OLD.status='APPROVED' and NEW.status='REVOKED')) then
      raise exception 'entity_eligibility_transition_denied' using errcode='23514'; end if;
  end if;
  return NEW;
end $$;
create trigger bx1_entity_eligibility_subject before insert or update on bx1_portal.product_eligibility_cases
  for each row execute function bx1_portal.guard_entity_eligibility_subject();
create trigger bx1_entity_eligibility_receipt_subject before insert on bx1_portal.product_eligibility_receipts
  for each row execute function bx1_portal.guard_entity_eligibility_subject();

-- This policy composition does not grant access, consume receipts or manufacture
-- provider/scanner approval. The explicitly enabled manual TEST lane is labelled.
create function bx1_portal.entity_eligibility_documents_current(target_account uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; d jsonb; mode text; enforced boolean;
begin
  select app.* into a from bx1_portal.applications app join bx1_portal.investment_accounts i
    on i.application_id=app.id where i.id=target_account and i.kind='ENTITY';
  select p.mode into mode from bx1_private.document_lifecycle_policy p where singleton;
  select p.enforced into enforced from bx1_private.document_receipt_policy p where singleton;
  if a.id is null or a.provider_mode<>'MANUAL_TEST_REVIEW'
    or bx1_portal.entry_manual_review_enabled() is not true
    or mode not in ('SYNTHETIC_TEST_ONLY','SCANNER_REQUIRED') or mode is null
    or pg_catalog.jsonb_typeof(a.details->'documents') is distinct from 'array'
    or pg_catalog.jsonb_array_length(a.details->'documents')=0 then return false; end if;
  for d in select * from pg_catalog.jsonb_array_elements(a.details->'documents') loop
    if not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
      and o.name=d->>'storage_path' and o.owner_id=a.user_id::text
      and o.metadata->>'size'=d->>'size' and o.metadata->>'mimetype'=d->>'mime_type') then return false; end if;
    if (mode='SCANNER_REQUIRED' or coalesce(enforced,false)) and not exists(
      select 1 from bx1_private.document_upload_receipts r where r.id=(d->>'id')::uuid
        and r.actor_id=a.user_id and r.storage_path=d->>'storage_path' and r.kind=d->>'kind'
        and r.sha256=d->>'sha256' and r.byte_size=(d->>'size')::integer and r.mime_type=d->>'mime_type'
        and (r.validation_state='SCANNED_CLEAN' or (mode='SYNTHETIC_TEST_ONLY' and r.validation_state='SYNTHETIC_UNSCANNED')))
      then return false; end if;
  end loop;
  return true;
end $$;

create function bx1_portal.entity_eligibility_source_access(c jsonb,target_account uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investment_accounts i join bx1_portal.applications a on a.id=i.application_id
    where i.id=target_account and i.kind='ENTITY'
      and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)
      and bx1_portal.application_document_access(a.id,c)
      and not exists(select 1 from pg_catalog.jsonb_array_elements(a.details->'documents') d
        where bx1_portal.object_readable(d->>'storage_path') is not true));
$$;

create function bx1_portal.entity_eligibility_reviewer(c jsonb,target_account uuid,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.investment_accounts i on i.id=target_account
    join bx1_portal.applications a on a.id=i.application_id
    where p.id=target_product and i.kind='ENTITY'
      and bx1_portal.product_appointment_authorised(c,p.id,'ComplianceOfficer')
      and bx1_portal.entity_people_independent(auth.uid(),a.user_id)
      and bx1_portal.entity_people_independent(auth.uid(),o.owner_id)
      and bx1_portal.entity_people_independent(auth.uid(),p.created_by)
      and bx1_portal.offering_lineage_independent(auth.uid(),p.id,p.terms_hash));
$$;

create function bx1_portal.entity_eligibility_source_current(target_account uuid,target_mandate uuid,
  target_cycle integer,target_revision integer,target_product uuid,target_product_revision integer,
  target_offering uuid,target_hash text) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investment_accounts i
    join bx1_portal.investing_representative_mandates m on m.investment_account_id=i.id
    join bx1_portal.applications a on a.id=i.application_id
    join bx1_portal.products p on p.id=target_product
    join bx1_portal.offering_revisions r on r.id=target_offering and r.product_id=p.id
    where i.id=target_account and i.kind='ENTITY' and i.status='ACTIVE'
      and m.id=target_mandate and m.cycle=target_cycle and m.revision=target_revision
      and m.entity_party_id=i.entity_party_id and m.application_id=a.id
      and m.representative_user_id=a.user_id and m.transaction_limit_minor=0
      and m.scope @> array['REQUEST_ELIGIBILITY']::text[]
      and bx1_portal.investing_mandate_effective(m.id)
      and bx1_portal.entity_account_admission_current(i.id)
      and bx1_portal.entity_eligibility_documents_current(i.id)
      and p.revision=target_product_revision and p.current_offering_revision_id=r.id
      and p.terms_hash=target_hash and r.terms_hash=target_hash and p.status='PUBLISHED'
      and bx1_portal.offering_operational(p.id) and bx1_portal.current_product_organisation(p.organisation_id)
      and p.terms->'eligible_investor_types' ? 'ENTITY'
      and p.terms->'eligible_countries' ? (a.details->>'country'));
$$;

create function bx1_portal.entity_product_eligibility_current(target_case uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_eligibility_cases e
    join bx1_portal.product_service_appointments ap on ap.id=e.decision_appointment_id
    join bx1_portal.products p on p.id=e.product_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    where e.id=target_case and e.account_kind='ENTITY' and e.status='APPROVED'
      and e.approved_until>pg_catalog.clock_timestamp() and ap.revision=e.decision_appointment_revision
      and e.review_checks='{"identity":true,"product_fit":true,"restrictions":true,"source_of_funds":true}'::jsonb
      and ap.role='ComplianceOfficer' and ap.appointee_user_id=e.reviewer_id
      and ap.product_id=e.product_id and bx1_portal.product_appointment_effective(ap.id)
      and bx1_portal.entity_people_independent(e.reviewer_id,e.representative_user_id)
      and bx1_portal.entity_people_independent(e.reviewer_id,o.owner_id)
      and bx1_portal.entity_people_independent(e.reviewer_id,p.created_by)
      and bx1_portal.offering_lineage_independent(e.reviewer_id,p.id,e.terms_hash)
      and exists(select 1 from bx1_portal.product_eligibility_receipts receipt
        where receipt.case_id=e.id and receipt.case_revision=e.revision and receipt.status_after='APPROVED'
          and receipt.account_kind='ENTITY' and receipt.action='review_product_eligibility'
          and receipt.actor_id=e.reviewer_id and receipt.decision_appointment_id=ap.id
          and receipt.decision_appointment_revision=ap.revision)
      and bx1_portal.entity_eligibility_source_current(e.investment_account_id,e.representative_mandate_id,
        e.mandate_cycle,e.mandate_revision,e.product_id,e.product_revision,e.offering_revision_id,e.terms_hash));
$$;

create function bx1_portal.entity_product_eligibility_projection(c jsonb,target_case uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare e bx1_portal.product_eligibility_cases; a bx1_portal.applications; p bx1_portal.products;
  party bx1_portal.legal_entity_parties; own_actor boolean; reviewer boolean; source_visible boolean;
  current_source boolean; current_decision boolean; reason text; requestable boolean;
begin
  if bx1_portal.valid_operating_context(c) is not true then return null; end if;
  select * into e from bx1_portal.product_eligibility_cases where id=target_case and account_kind='ENTITY';
  if e.id is null then return null; end if;
  select app.* into a from bx1_portal.applications app join bx1_portal.investment_accounts i
    on i.application_id=app.id where i.id=e.investment_account_id;
  select * into p from bx1_portal.products where id=e.product_id;
  select * into party from bx1_portal.legal_entity_parties where id=e.entity_party_id;
  own_actor:=c='{"mode":"APPLICANT"}'::jsonb and e.representative_user_id=auth.uid() and a.user_id=auth.uid();
  reviewer:=bx1_portal.entity_eligibility_reviewer(c,e.investment_account_id,e.product_id);
  if not(own_actor or reviewer) then return null; end if;
  source_visible:=reviewer and bx1_portal.entity_eligibility_source_access(c,e.investment_account_id)
    and bx1_portal.entity_eligibility_documents_current(e.investment_account_id);
  current_source:=bx1_portal.entity_eligibility_source_current(e.investment_account_id,e.representative_mandate_id,
    e.mandate_cycle,e.mandate_revision,e.product_id,e.product_revision,e.offering_revision_id,e.terms_hash);
  -- Decision currency is intrinsic; unlike review permission it must not depend
  -- on the caller's role. Exact appointment snapshot and independent people.
  current_decision:=bx1_portal.entity_product_eligibility_current(e.id);
  requestable:=own_actor and e.status in ('CHANGES_REQUIRED','REJECTED') and current_source;
  reason:=case when e.status='REVOKED' then 'REVOKED'
    when not current_source then 'SOURCE_NOT_CURRENT'
    when reviewer and not source_visible then 'SOURCE_EVIDENCE_UNAVAILABLE'
    when e.status='APPROVED' and not current_decision then 'DECISION_APPOINTMENT_NOT_CURRENT' else null end;
  if bx1_portal.valid_operating_context(c) is not true
    or (reviewer and bx1_portal.entity_eligibility_reviewer(c,e.investment_account_id,e.product_id) is not true)
    or (source_visible and bx1_portal.entity_eligibility_source_access(c,e.investment_account_id) is not true) then
    raise exception 'entity_eligibility_projection_authority_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('id',e.id,'investment_account_id',e.investment_account_id,
    'account_kind','ENTITY','entity_party_id',e.entity_party_id,'entity_name',party.legal_name,
    'representative_user_id',e.representative_user_id,'representative_mandate_id',e.representative_mandate_id,
    'mandate_cycle',e.mandate_cycle,'mandate_revision',e.mandate_revision,
    'decision_appointment_id',e.decision_appointment_id,'decision_appointment_revision',e.decision_appointment_revision,
    'product_id',e.product_id,'product_name',p.terms->>'name','organisation_id',e.organisation_id,
    'product_revision',e.product_revision,'offering_revision_id',e.offering_revision_id,'terms_hash',e.terms_hash,
    'application_revision',e.application_revision,'revision',e.revision,'status',e.status,
    'investor_statement',e.investor_statement,'submitted_at',e.submitted_at,'reviewed_at',e.reviewed_at,
    'reviewer_id',e.reviewer_id,'review_notes',e.review_notes,'review_checks',e.review_checks,
    'approved_until',e.approved_until,'provider_mode','MANUAL_TEST_REVIEW','effective',current_decision,
    'can_request',requestable,'can_decide',reviewer and e.status='SUBMITTED',
    'can_approve',reviewer and source_visible and current_source and e.status='SUBMITTED',
    'can_revoke',reviewer and e.status='APPROVED','blocked_reason',reason,
    'next_owner',case when e.status in ('CHANGES_REQUIRED','REJECTED') then 'APPLICANT'
      when e.status='SUBMITTED' or (e.status='APPROVED' and not current_decision) then 'COMPLIANCE' else 'NONE' end,
    'investor_application',case when source_visible then pg_catalog.jsonb_build_object('id',a.id,'revision',a.revision,
      'status',a.status,'approved_until',a.approved_until,'details',a.details) else null end);
end $$;

-- Supersede only the final invoker target; all older individuals are delegated.
alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_entity_eligibility;
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_entity_eligibility;
create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; cases jsonb; individuals jsonb; visible_events jsonb; accounts jsonb;
begin
  result:=bx1_portal.read_scoped_pre_entity_eligibility(c);
  select coalesce(pg_catalog.jsonb_agg(projected.value order by e.submitted_at,e.id),'[]'::jsonb) into cases
    from bx1_portal.product_eligibility_cases e
    cross join lateral (select bx1_portal.entity_product_eligibility_projection(c,e.id) value) projected
    where e.account_kind='ENTITY' and projected.value is not null;
  select coalesce(pg_catalog.jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into individuals
    from pg_catalog.jsonb_array_elements(coalesce(result->'product_eligibility','[]'::jsonb)) with ordinality item(value,ordinality)
    where not exists(select 1 from bx1_portal.product_eligibility_cases e where e.id=(item.value->>'id')::uuid and e.account_kind='ENTITY');
  select coalesce(pg_catalog.jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into visible_events
    from pg_catalog.jsonb_array_elements(coalesce(result->'events','[]'::jsonb)) with ordinality item(value,ordinality)
    where not exists(select 1 from bx1_portal.product_eligibility_cases e where e.id=(item.value->>'subject_id')::uuid and e.account_kind='ENTITY')
      or exists(select 1 from pg_catalog.jsonb_array_elements(cases) x where x->>'id'=item.value->>'subject_id');
  select coalesce(pg_catalog.jsonb_agg(item.value||pg_catalog.jsonb_build_object('can_request_eligibility',
      c='{"mode":"APPLICANT"}'::jsonb and exists(select 1 from bx1_portal.investing_representative_mandates m
        where m.investment_account_id=(item.value->>'id')::uuid and m.representative_user_id=auth.uid()
          and m.scope @> array['REQUEST_ELIGIBILITY']::text[] and m.transaction_limit_minor=0
          and bx1_portal.investing_mandate_effective(m.id)
          and bx1_portal.entity_eligibility_documents_current(m.investment_account_id))) order by item.ordinality),'[]'::jsonb) into accounts
    from pg_catalog.jsonb_array_elements(coalesce(result->'entity_investment_accounts','[]'::jsonb)) with ordinality item(value,ordinality);
  if bx1_portal.valid_operating_context(c) is not true or exists(
    select 1 from pg_catalog.jsonb_array_elements(cases) prior_case
      where bx1_portal.entity_product_eligibility_projection(c,(prior_case->>'id')::uuid) is null) then
    raise exception 'entity_eligibility_read_authority_changed' using errcode='42501'; end if;
  -- Refresh decision/source currency after any later aggregation wait. This is
  -- not a business write and cannot silently return formerly authorised PII.
  select coalesce(pg_catalog.jsonb_agg(bx1_portal.entity_product_eligibility_projection(c,(x.value->>'id')::uuid)
    order by x.ordinality),'[]'::jsonb) into cases
    from pg_catalog.jsonb_array_elements(cases) with ordinality x(value,ordinality);
  return pg_catalog.jsonb_set(pg_catalog.jsonb_set(result,'{product_eligibility}',individuals),'{events}',visible_events)
    ||pg_catalog.jsonb_build_object('entity_product_eligibility',cases,'entity_investment_accounts',accounts);
end $$;

create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare e bx1_portal.product_eligibility_cases; i bx1_portal.investment_accounts;
  a bx1_portal.applications; m bx1_portal.investing_representative_mandates;
  p bx1_portal.products; o bx1_portal.organisations; ap bx1_portal.product_service_appointments;
  prior bx1_portal.scoped_requests; actor uuid:=auth.uid(); target_account uuid; target_product uuid;
  target_case uuid; expected integer; decision text; now_at timestamptz; source_current boolean;
begin
  if action not in ('request_product_eligibility','review_product_eligibility','revoke_product_eligibility') then
    return bx1_portal.execute_scoped_pre_entity_eligibility(c,action,key,body); end if;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'entity_eligibility_context_denied' using errcode='42501'; end if;
  if action='request_product_eligibility' then
    select * into i from bx1_portal.investment_accounts where id=(body->>'investment_account_id')::uuid;
    if i.id is null or i.kind<>'ENTITY' then return bx1_portal.execute_scoped_pre_entity_eligibility(c,action,key,body); end if;
    target_account:=i.id; target_product:=(body->>'product_id')::uuid;
  else
    select * into e from bx1_portal.product_eligibility_cases where id=(body->>'eligibility_case_id')::uuid;
    if e.id is null or e.account_kind<>'ENTITY' then return bx1_portal.execute_scoped_pre_entity_eligibility(c,action,key,body); end if;
    target_account:=e.investment_account_id; target_product:=e.product_id; target_case:=e.id;
  end if;
  if bx1_portal.entry_manual_review_enabled() is not true or key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>8192 then
    raise exception 'entity_eligibility_unavailable' using errcode='42501'; end if;
  perform bx1_portal.entry_lock_actor();
  -- Product row serializes offering, appointment and new-case uniqueness. All
  -- commands take the same product -> organisation -> account -> mandate order.
  select * into p from bx1_portal.products where id=target_product for update;
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  perform id from bx1_portal.organisation_authority_bindings where product_organisation_id=o.id order by id for share;
  perform id from bx1_portal.product_service_appointments where product_id=p.id order by id for share;
  select * into i from bx1_portal.investment_accounts where id=target_account and kind='ENTITY' for share;
  select * into a from bx1_portal.applications where id=i.application_id for share;
  perform id from bx1_portal.applications where id=o.application_id for share;
  if action='request_product_eligibility' then
    perform bx1_portal.require_keys(body,array['product_id','investment_account_id','expected_revision','investor_statement',
      'representative_mandate_id','expected_mandate_revision','expected_mandate_cycle','expected_product_revision','offering_revision_id','terms_hash']);
    perform bx1_portal.require_text(body,'investor_statement',20,2000);
    select * into m from bx1_portal.investing_representative_mandates where id=(body->>'representative_mandate_id')::uuid for share;
  else
    select * into e from bx1_portal.product_eligibility_cases where id=target_case for update;
    select * into m from bx1_portal.investing_representative_mandates where id=e.representative_mandate_id for share;
  end if;
  perform bx1_portal.lock_offering_lineage_people(p.id,p.terms_hash,array[actor,a.user_id,a.reviewer_id,
    o.owner_id,p.created_by,m.reviewer_user_id,m.applied_by_user_id]);
  perform bx1_portal.lock_entity_people(array(select distinct people.person_id from bx1_portal.product_service_appointments appt,
    lateral unnest(array[appt.appointee_user_id,appt.requested_by_user_id,appt.reviewed_by_user_id,appt.applied_by_user_id]) people(person_id)
    where appt.product_id=p.id));
  if i.id is null or p.id is null or m.id is null or a.id is null
    or bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'entity_eligibility_authority_changed' using errcode='42501'; end if;
  if action='request_product_eligibility' then
    if c<>'{"mode":"APPLICANT"}'::jsonb or actor<>a.user_id or actor<>m.representative_user_id
      or m.investment_account_id<>i.id or m.entity_party_id<>i.entity_party_id
      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'
      or pg_catalog.jsonb_typeof(body->'expected_mandate_revision') is distinct from 'number'
      or body->>'expected_mandate_revision' !~ '^[1-9][0-9]{0,8}$'
      or pg_catalog.jsonb_typeof(body->'expected_mandate_cycle') is distinct from 'number'
      or body->>'expected_mandate_cycle' !~ '^[1-9][0-9]{0,8}$'
      or pg_catalog.jsonb_typeof(body->'expected_product_revision') is distinct from 'number'
      or body->>'expected_product_revision' !~ '^[1-9][0-9]{0,8}$'
      or m.revision<>(body->>'expected_mandate_revision')::integer or m.cycle<>(body->>'expected_mandate_cycle')::integer
      or p.revision<>(body->>'expected_product_revision')::integer
      or p.current_offering_revision_id is distinct from (body->>'offering_revision_id')::uuid
      or p.terms_hash is distinct from body->>'terms_hash'
      or bx1_portal.entity_people_independent(actor,o.owner_id) is not true
      or bx1_portal.entity_people_independent(actor,p.created_by) is not true
      or bx1_portal.offering_lineage_independent(actor,p.id,p.terms_hash) is not true
      or bx1_portal.entity_eligibility_source_current(i.id,m.id,m.cycle,m.revision,p.id,p.revision,p.current_offering_revision_id,p.terms_hash) is not true then
      raise exception 'entity_eligibility_request_denied' using errcode='42501'; end if;
  elsif bx1_portal.entity_eligibility_reviewer(c,i.id,p.id) is not true then
    raise exception 'entity_eligibility_reviewer_denied' using errcode='42501';
  end if;
  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;
  if found then
    if prior.command is distinct from action or prior.operating_context is distinct from c or prior.payload is distinct from body then
      raise exception 'entity_eligibility_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.representative_mandate_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.product_service_appointment_requests where actor_id=actor and request_key=key) then
    raise exception 'entity_eligibility_prior_key_conflict' using errcode='23505'; end if;
  now_at:=pg_catalog.clock_timestamp();
  if action='request_product_eligibility' then
    expected:=(body->>'expected_revision')::integer;
    select * into e from bx1_portal.product_eligibility_cases where investment_account_id=i.id and product_id=p.id for update;
    if e.id is null then
      if expected<>0 then raise exception 'entity_eligibility_stale_case' using errcode='23514'; end if;
      insert into bx1_portal.product_eligibility_cases(investment_account_id,holder_user_id,account_kind,entity_party_id,
        representative_user_id,representative_mandate_id,mandate_cycle,mandate_revision,
        product_id,organisation_id,application_revision,product_revision,offering_revision_id,terms_hash,investor_statement)
      values(i.id,null,'ENTITY',i.entity_party_id,actor,m.id,m.cycle,m.revision,
        p.id,p.organisation_id,a.revision,p.revision,p.current_offering_revision_id,p.terms_hash,body->>'investor_statement') returning * into e;
    else
      if e.account_kind<>'ENTITY' or e.representative_user_id<>actor or e.revision<>expected
        or e.status in ('SUBMITTED','REVOKED') or bx1_portal.entity_product_eligibility_current(e.id) then
        raise exception 'entity_eligibility_stale_case' using errcode='23514'; end if;
      update bx1_portal.product_eligibility_cases set representative_mandate_id=m.id,mandate_cycle=m.cycle,mandate_revision=m.revision,
        application_revision=a.revision,product_revision=p.revision,offering_revision_id=p.current_offering_revision_id,terms_hash=p.terms_hash,
        status='SUBMITTED',revision=revision+1,investor_statement=body->>'investor_statement',submitted_at=now_at,
        reviewed_at=null,reviewer_id=null,review_notes=null,review_checks='{}',approved_until=null,
        decision_appointment_id=null,decision_appointment_revision=null where id=e.id returning * into e;
    end if;
  else
    if action='review_product_eligibility' then
      perform bx1_portal.require_keys(body,array['eligibility_case_id','expected_revision','decision','notes','checks']);
      perform bx1_portal.require_text(body,'notes',20,3000); decision:=body->>'decision';
      if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') or decision is null then
        raise exception 'entity_eligibility_invalid_decision' using errcode='22023'; end if;
      perform bx1_portal.require_checks(body->'checks',array['identity','product_fit','restrictions','source_of_funds'],decision='APPROVED');
    else
      perform bx1_portal.require_keys(body,array['eligibility_case_id','expected_revision','reason']);
      perform bx1_portal.require_text(body,'reason',20,2000); decision:='REVOKED';
    end if;
    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' or e.revision<>(body->>'expected_revision')::integer
      or (action='review_product_eligibility' and e.status<>'SUBMITTED')
      or (action='revoke_product_eligibility' and e.status<>'APPROVED') then
      raise exception 'entity_eligibility_stale_case' using errcode='23514'; end if;
    select * into ap from bx1_portal.product_service_appointments where product_id=p.id and role='ComplianceOfficer'
      and appointee_user_id=actor and status='APPLIED' and bx1_portal.product_appointment_effective(id);
    if ap.id is null then raise exception 'entity_eligibility_appointment_unavailable' using errcode='42501'; end if;
    source_current:=bx1_portal.entity_eligibility_source_current(i.id,e.representative_mandate_id,e.mandate_cycle,e.mandate_revision,
      p.id,e.product_revision,e.offering_revision_id,e.terms_hash);
    if decision='APPROVED' and (not source_current or bx1_portal.entity_eligibility_source_access(c,i.id) is not true) then
      raise exception 'entity_eligibility_source_unavailable' using errcode='42501'; end if;
    update bx1_portal.product_eligibility_cases set status=decision,revision=revision+1,reviewed_at=now_at,reviewer_id=actor,
      review_notes=case when decision='REVOKED' then body->>'reason' else body->>'notes' end,
      review_checks=case when decision='REVOKED' then review_checks else body->'checks' end,
      approved_until=case when decision='APPROVED' then least(a.approved_until,m.requested_until,ap.requested_until,now_at+interval '30 days') end,
      decision_appointment_id=ap.id,decision_appointment_revision=ap.revision where id=e.id returning * into e;
  end if;
  insert into bx1_portal.product_eligibility_receipts(case_id,case_revision,action,actor_id,operating_context,command_payload,
    application_revision,product_revision,terms_hash,status_after,account_kind,investment_account_id,entity_party_id,
    representative_user_id,representative_mandate_id,mandate_cycle,mandate_revision,offering_revision_id,
    decision_appointment_id,decision_appointment_revision)
  values(e.id,e.revision,action,actor,c,body,e.application_revision,e.product_revision,e.terms_hash,e.status,'ENTITY',i.id,e.entity_party_id,
    e.representative_user_id,e.representative_mandate_id,e.mandate_cycle,e.mandate_revision,e.offering_revision_id,
    e.decision_appointment_id,e.decision_appointment_revision);
  insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)
  values(e.id,a.id,e.organisation_id,e.representative_user_id,action,actor,
    'Synthetic manual ENTITY eligibility '||e.status||'; no provider clearance, subscription, payment or issuance authority.');
  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true
    or (action='request_product_eligibility' and (actor<>a.user_id
      or bx1_portal.entity_eligibility_source_current(i.id,m.id,m.cycle,m.revision,p.id,p.revision,p.current_offering_revision_id,p.terms_hash) is not true))
    or (action<>'request_product_eligibility' and (bx1_portal.entity_eligibility_reviewer(c,i.id,p.id) is not true
      or not exists(select 1 from bx1_portal.product_service_appointments current_ap where current_ap.id=ap.id
        and current_ap.revision=ap.revision and bx1_portal.product_appointment_effective(current_ap.id))))
    or (decision='APPROVED' and (bx1_portal.entity_eligibility_source_access(c,i.id) is not true
      or bx1_portal.entity_eligibility_source_current(i.id,e.representative_mandate_id,e.mandate_cycle,e.mandate_revision,
        p.id,e.product_revision,e.offering_revision_id,e.terms_hash) is not true)) then
    raise exception 'entity_eligibility_authority_expired' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);
  return bx1_portal.read_scoped(c);
end $$;

create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;

revoke all on function bx1_portal.guard_entity_eligibility_subject(),
  bx1_portal.entity_eligibility_documents_current(uuid),bx1_portal.entity_eligibility_source_access(jsonb,uuid),
  bx1_portal.entity_eligibility_reviewer(jsonb,uuid,uuid),
  bx1_portal.entity_eligibility_source_current(uuid,uuid,integer,integer,uuid,integer,uuid,text),
  bx1_portal.entity_product_eligibility_current(uuid),bx1_portal.entity_product_eligibility_projection(jsonb,uuid),
  bx1_portal.read_scoped_pre_entity_eligibility(jsonb),bx1_portal.execute_scoped_pre_entity_eligibility(jsonb,text,uuid,jsonb),
  bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role;
do $acl$ begin
  if (select environment='TESTNET' and manual_test_review from bx1_portal.entry_configuration where singleton) then
    grant execute on function bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) to authenticated;
  end if;
end $acl$;
comment on function bx1_portal.entity_product_eligibility_current(uuid) is
  'Decision currency only. ENTITY cases never satisfy individual subscription, funding or wallet authority.';
