-- Stage 2 structured beneficial-ownership/control evidence. No platform roles,
-- mandates, account powers or signer authority are derived from these records.
-- Historical v1/v2 submissions remain unchanged; new entity/manager submissions
-- must use v3 and receive an independently reviewed revision.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_portal.application_detail_versions') is null
    or pg_catalog.to_regprocedure('bx1_portal.entry_submit(uuid,integer,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.validate_application(jsonb,text)') is null
    or pg_catalog.to_regclass('bx1_portal.applications') is null
    then raise exception 'ownership_admission_baseline_required' using errcode='55000'; end if;
end $$;

create table bx1_portal.application_ownership_control_versions (
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  application_revision integer not null check(application_revision > 0),
  relationship_id uuid not null,
  party_type text not null check(party_type in ('PERSON','ENTITY')),
  legal_name text not null check(pg_catalog.char_length(legal_name) between 2 and 160),
  registration_reference text not null check(pg_catalog.char_length(registration_reference) <= 100),
  country text not null check(country ~ '^[A-Z]{2}$'),
  relationship text not null check(relationship in ('DIRECT_OWNER','INDIRECT_OWNER','CONTROLLER')),
  ownership_basis_points integer not null check(ownership_basis_points between 0 and 10000),
  control_basis text not null check(pg_catalog.char_length(control_basis) between 20 and 1000),
  effective_on date not null,
  change_reason text not null check(pg_catalog.char_length(change_reason) between 20 and 500),
  ownership_change_reason text not null check(pg_catalog.char_length(ownership_change_reason) between 20 and 500),
  evidence_document_id uuid not null,
  submitted_details_sha256 text not null check(submitted_details_sha256 ~ '^[0-9a-f]{64}$'),
  submitted_at timestamptz not null,
  captured_at timestamptz not null default clock_timestamp(),
  primary key(application_id,application_revision,relationship_id),
  foreign key(application_id,application_revision)
    references bx1_portal.application_detail_versions(application_id,application_revision) on delete restrict,
  check(party_type <> 'ENTITY' or pg_catalog.char_length(registration_reference) >= 3),
  check(relationship = 'CONTROLLER' or ownership_basis_points > 0)
);
create index bx1_ownership_by_application_revision
  on bx1_portal.application_ownership_control_versions(application_id,application_revision);
alter table bx1_portal.application_ownership_control_versions enable row level security;
revoke all on bx1_portal.application_ownership_control_versions from public,anon,authenticated,service_role;
create trigger bx1_application_ownership_immutable before update or delete
  on bx1_portal.application_ownership_control_versions for each row
  execute function bx1_portal.immutable_record();

alter function bx1_portal.validate_application(jsonb,text) rename to validate_application_pre_ownership;
create function bx1_portal.validate_application(details jsonb,persona text) returns void
language plpgsql security invoker set search_path='' as $$
declare record jsonb; ids text[] := '{}'; evidence_ids text[] := '{}'; effective_date date; direct_basis_points integer := 0;
begin
  if details->'details_version' is distinct from '3'::jsonb then
    perform bx1_portal.validate_application_pre_ownership(details,persona); return;
  end if;
  if persona='WEALTH_MANAGER' then
    perform bx1_portal.validate_application_pre_ownership(
      (details-'ownership_control'-'ownership_change_reason') || pg_catalog.jsonb_build_object('details_version',2),persona);
  elsif persona='INVESTOR' and details->>'investor_type'='ENTITY' then
    perform bx1_portal.validate_application_pre_ownership(
      details-'details_version'-'ownership_control'-'ownership_change_reason',persona);
  else
    raise exception 'ownership_disclosure_wrong_capacity' using errcode='22023';
  end if;
  perform bx1_portal.require_keys(details,case when persona='WEALTH_MANAGER' then
    array['details_version','full_name','country','company_name','registration_reference','beneficial_owners',
      'business_activities','representative_position','authority_basis','documents','test_data_acknowledged',
      'ownership_control','ownership_change_reason']
    else array['details_version','full_name','country','investor_type','company_name','registration_reference',
      'source_of_funds','beneficial_owners','experience','documents','test_data_acknowledged',
      'ownership_control','ownership_change_reason'] end);
  perform bx1_portal.require_text(details,'ownership_change_reason',20,500);
  if pg_catalog.jsonb_typeof(details->'ownership_control') is distinct from 'array'
    or pg_catalog.jsonb_array_length(details->'ownership_control') not between 1 and 20 then
    raise exception 'ownership_relationships_required' using errcode='23514'; end if;
  select pg_catalog.array_agg(d->>'id') into evidence_ids
    from pg_catalog.jsonb_array_elements(details->'documents') d where d->>'kind'='BENEFICIAL_OWNERS';
  for record in select * from pg_catalog.jsonb_array_elements(details->'ownership_control') loop
    perform bx1_portal.require_keys(record,array['id','party_type','legal_name','registration_reference','country',
      'relationship','ownership_basis_points','control_basis','effective_on','change_reason','evidence_document_id']);
    perform bx1_portal.require_text(record,'legal_name',2,160);
    perform bx1_portal.require_text(record,'registration_reference',
      case when record->>'party_type'='ENTITY' then 3 else 0 end,100);
    perform bx1_portal.require_text(record,'country',2,2);
    perform bx1_portal.require_text(record,'control_basis',20,1000);
    perform bx1_portal.require_text(record,'change_reason',20,500);
    if pg_catalog.jsonb_typeof(record->'effective_on') is distinct from 'string'
      or record->>'effective_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'ownership_effective_date_invalid' using errcode='22023'; end if;
    begin
      effective_date := (record->>'effective_on')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'ownership_effective_date_invalid' using errcode='22023';
    end;
    if pg_catalog.jsonb_typeof(record->'ownership_basis_points') is distinct from 'number'
      or record->>'ownership_basis_points' !~ '^(0|[1-9][0-9]{0,4})$' then
      raise exception 'ownership_percentage_invalid' using errcode='22023'; end if;
    if pg_catalog.jsonb_typeof(record->'id') is distinct from 'string'
      or record->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (record->>'id')=any(ids)
      or coalesce(record->>'party_type','') not in ('PERSON','ENTITY')
      or record->>'country' !~ '^[A-Z]{2}$'
      or coalesce(record->>'relationship','') not in ('DIRECT_OWNER','INDIRECT_OWNER','CONTROLLER')
      or (record->>'ownership_basis_points')::integer > 10000
      or (record->>'relationship'<>'CONTROLLER' and (record->>'ownership_basis_points')::integer=0)
      or pg_catalog.to_char(effective_date,'YYYY-MM-DD') <> record->>'effective_on'
      or effective_date > current_date
      or pg_catalog.jsonb_typeof(record->'evidence_document_id') is distinct from 'string'
      or record->>'evidence_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not (record->>'evidence_document_id')=any(evidence_ids) then
      raise exception 'ownership_relationship_invalid' using errcode='22023'; end if;
    ids:=pg_catalog.array_append(ids,record->>'id');
    if record->>'relationship'='DIRECT_OWNER' then
      direct_basis_points:=direct_basis_points+(record->>'ownership_basis_points')::integer;
    end if;
  end loop;
  if direct_basis_points>10000 then raise exception 'ownership_direct_total_exceeds_100_percent' using errcode='22023'; end if;
end $$;

create function bx1_portal.guard_application_ownership_control() returns trigger
language plpgsql security definer set search_path='' as $$
declare new_submission boolean;
begin
  if TG_OP='INSERT' then
    new_submission:=NEW.status='SUBMITTED';
  else
    new_submission:=NEW.status='SUBMITTED' and OLD.status in ('DRAFT','CHANGES_REQUIRED','REJECTED');
  end if;
  if new_submission and (NEW.persona='WEALTH_MANAGER'
    or (NEW.persona='INVESTOR' and NEW.details->>'investor_type'='ENTITY')) then
    if NEW.details->'details_version' is distinct from '3'::jsonb then
      raise exception 'structured_ownership_required_for_submission' using errcode='23514'; end if;
    perform bx1_portal.validate_application(NEW.details,NEW.persona);
    if TG_OP='UPDATE' then
      if OLD.details->'details_version'='3'::jsonb
        and OLD.details->'ownership_control' is distinct from NEW.details->'ownership_control'
        and OLD.details->>'ownership_change_reason'=NEW.details->>'ownership_change_reason' then
        raise exception 'ownership_material_change_reason_required' using errcode='23514'; end if;
    end if;
  end if;
  if TG_OP='UPDATE' then
    if OLD.status='SUBMITTED' and NEW.status in ('APPROVED','CHANGES_REQUIRED','REJECTED') then
      if NEW.details is distinct from OLD.details then
        raise exception 'review_cannot_change_submitted_ownership' using errcode='23514'; end if;
      if NEW.status='APPROVED' and (OLD.persona='WEALTH_MANAGER'
        or (OLD.persona='INVESTOR' and OLD.details->>'investor_type'='ENTITY')) then
        if OLD.details->'details_version' is distinct from '3'::jsonb then
          raise exception 'structured_ownership_review_required' using errcode='23514'; end if;
        if (select pg_catalog.count(*) from bx1_portal.application_ownership_control_versions v
          where v.application_id=OLD.id and v.application_revision=OLD.revision
            and v.submitted_details_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(OLD.details::text,'UTF8')),'hex'))
            <> pg_catalog.jsonb_array_length(OLD.details->'ownership_control') then
          raise exception 'ownership_review_version_changed' using errcode='23514'; end if;
      end if;
    end if;
  end if;
  return NEW;
end $$;
create trigger bx1_application_ownership_guard before insert or update on bx1_portal.applications
  for each row execute function bx1_portal.guard_application_ownership_control();

create function bx1_portal.capture_application_ownership_control() returns trigger
language plpgsql security definer set search_path='' as $$
declare relation jsonb; new_submission boolean;
begin
  if TG_OP='INSERT' then
    new_submission:=NEW.status='SUBMITTED';
  else
    new_submission:=NEW.status='SUBMITTED' and (OLD.status is distinct from 'SUBMITTED' or OLD.revision is distinct from NEW.revision);
  end if;
  if new_submission and NEW.details->'details_version'='3'::jsonb and NEW.submitted_at is not null then
    for relation in select * from pg_catalog.jsonb_array_elements(NEW.details->'ownership_control') loop
      insert into bx1_portal.application_ownership_control_versions(
        application_id,application_revision,relationship_id,party_type,legal_name,registration_reference,country,
        relationship,ownership_basis_points,control_basis,effective_on,change_reason,ownership_change_reason,
        evidence_document_id,submitted_details_sha256,submitted_at)
      values(NEW.id,NEW.revision,(relation->>'id')::uuid,relation->>'party_type',relation->>'legal_name',
        relation->>'registration_reference',relation->>'country',relation->>'relationship',
        (relation->>'ownership_basis_points')::integer,relation->>'control_basis',(relation->>'effective_on')::date,
        relation->>'change_reason',NEW.details->>'ownership_change_reason',(relation->>'evidence_document_id')::uuid,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.details::text,'UTF8')),'hex'),NEW.submitted_at);
    end loop;
  end if;
  return NEW;
end $$;
-- The existing immutable application_detail_versions trigger runs first by name;
-- this FK proves that a relationship belongs to the exact submitted revision.
create trigger bx1_application_ownership_capture after insert or update of details,submitted_at
  on bx1_portal.applications for each row
  execute function bx1_portal.capture_application_ownership_control();

revoke all on function bx1_portal.validate_application_pre_ownership(jsonb,text),
  bx1_portal.validate_application(jsonb,text),bx1_portal.guard_application_ownership_control(),
  bx1_portal.capture_application_ownership_control() from public,anon,authenticated,service_role;
comment on table bx1_portal.application_ownership_control_versions is
  'Immutable disclosed ownership/control facts per submitted application revision. Evidence only; never a mandate, membership or signer source.';
