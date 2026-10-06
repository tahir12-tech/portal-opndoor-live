-- ===========================================================================
-- Two things the vendor routes need, built now so only "turn the button on"
-- remains later:
--
-- 1. ID gets its own document kind. Marking the ID check done off any
--    other_upload was wrong: the Documents tab writes other_upload too. A new
--    id_document kind, and a bank_connection kind for a completed open-banking
--    link, join the applicant kinds.
--
-- 2. Financials accepts EITHER three months of bank statements OR a completed
--    bank connection. Today no connection is produced (the button is off), so
--    the OR-branch is dormant, but a connected applicant is never wrongly
--    blocked once it is wired in. submit_application_for_referencing is recreated
--    in full with the OR, no earlier gate lost. Additive; the referral path
--    never calls this submit.
-- ===========================================================================

-- 1. The new applicant document kinds.
alter table public.application_documents drop constraint application_documents_kind_check;
alter table public.application_documents add constraint application_documents_kind_check
  check (kind in (
    -- uploaded by the applicant
    'bank_statement','proof_of_address','p60_or_pension_award','tax_return','other_upload',
    'id_document','bank_connection',
    -- produced by the referencing provider and delivered to us
    'reference_report','summary_report','review_summary_report','provider_signature'));

alter table public.application_documents drop constraint document_bucket_matches_kind;
alter table public.application_documents add constraint document_bucket_matches_kind check (
  (bucket = 'applicant-docs'
     and kind in ('bank_statement','proof_of_address','p60_or_pension_award','tax_return','other_upload','id_document','bank_connection'))
  or
  (bucket = 'reference-reports'
     and kind in ('reference_report','summary_report','review_summary_report','provider_signature'))
);

-- 2. The submit gate, recreated in full with the financials OR-branch.
create or replace function public.submit_application_for_referencing(p_application uuid)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  a public.applications;
  prof public.application_profiles;
  v_months int;
  v_statements int;
  v_missing text := '';
begin
  select * into a from public.applications where id = p_application;
  if not found then raise exception 'Application % not found', p_application using errcode = '22023'; end if;

  if a.status <> 'draft' then
    raise exception 'This application has already been sent.' using errcode = '42501';
  end if;

  -- THE FEE. First, because it is the one somebody might try to route around.
  if not public.eligibility_fee_paid(p_application) then
    raise exception 'The application fee has not been paid.' using errcode = '42501';
  end if;

  if coalesce(btrim(a.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if a.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(a.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;
  if coalesce(a.monthly_rent, 0) <= 0         then v_missing := v_missing || 'monthly rent, '; end if;
  if a.tenancy_start is null                  then v_missing := v_missing || 'tenancy start date, '; end if;

  select * into prof from public.application_profiles where application_id = p_application;
  if coalesce(btrim(prof.nationality), '') = ''            then v_missing := v_missing || 'nationality, '; end if;
  if coalesce(btrim(prof.right_to_rent_category), '') = '' then v_missing := v_missing || 'right to rent, '; end if;
  if coalesce(btrim(prof.declared_name), '') = ''          then v_missing := v_missing || 'your name on the declaration, '; end if;
  if prof.declared_at is null                              then v_missing := v_missing || 'the declaration tick, '; end if;

  if v_missing <> '' then
    raise exception 'Still needed: %', left(v_missing, length(v_missing) - 2) using errcode = '23502';
  end if;

  v_months := public.address_history_months(p_application);
  if v_months < 36 then
    raise exception 'We need three years of address history. You have given us % months.', v_months
      using errcode = '23502';
  end if;

  -- PROOF OF ADDRESS. Every address needs its proof type chosen AND its document,
  -- scoped to that address. The address step's Continue gates on the same.
  if exists (
    select 1 from public.application_addresses ad
    where ad.application_id = p_application
      and (coalesce(btrim(ad.proof_type), '') = ''
           or not exists (
             select 1 from public.application_documents d
             where d.application_id = p_application
               and d.kind = 'proof_of_address'
               and d.address_id = ad.id))
  ) then
    raise exception 'Each address needs its proof of address type chosen and document uploaded.'
      using errcode = '23502';
  end if;

  if not exists (select 1 from public.application_incomes i
                  where i.application_id = p_application and not i.is_additional) then
    raise exception 'We need at least one main income.' using errcode = '23502';
  end if;

  -- FINANCIALS. Three months of bank statements, OR a completed bank connection
  -- (open banking). The connection is a bank_connection document, written when the
  -- vendor is wired in; a connected applicant then needs no statements.
  if not exists (select 1 from public.application_documents d
                  where d.application_id = p_application and d.kind = 'bank_connection') then
    select count(*) into v_statements
    from public.application_documents d
    where d.application_id = p_application and d.kind = 'bank_statement';
    if v_statements < 3 then
      raise exception 'We need three months of bank statements, or a connected bank. You have uploaded %.', v_statements
        using errcode = '23502';
    end if;
  end if;

  update public.applications set status = 'referencing' where id = p_application;
  update public.application_profiles
     set completed_at = coalesce(completed_at, now()), updated_at = now()
   where application_id = p_application;

  insert into public.activity_log (application_id, kind, message, actor)
  values (p_application, 'sent_for_referencing',
          'Application completed and sent for referencing.', 'Tenant');

  select * into a from public.applications where id = p_application;
  return a;
end $function$;

comment on function public.submit_application_for_referencing(uuid) is
  'Sends a direct-rail application for referencing. Refuses unless the fee is paid; identity, nationality, right to rent and the declaration are complete; three years of address history with a proof of address (type and document) for every address; a main income; and either three months of bank statements or a completed bank connection. The Send button gates on the same set.';
