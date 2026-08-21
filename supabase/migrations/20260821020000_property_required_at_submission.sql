-- ===========================================================================
-- The property is the NEXT screen, so it cannot be required at insert.
--
-- THE WALL. A tenant registered, verified their code, and landed back on the
-- registration page with no message. create_direct_application was raising
--
--   23502: null value in column "prop_addr1" violates not-null constraint
--
-- because the direct rail creates the draft BEFORE asking for the property.
-- The referral rail always has one, so the constraint never bit there, and the
-- direct rail has therefore never been able to create an application at all.
--
-- Same shape as tenant_title, tenant_dob and tenant_phone in 20260812210000,
-- and the same fix: the requirement is real, it just belongs at SUBMISSION
-- rather than at insert. A draft is allowed to be incomplete; that is what a
-- draft is.
--
-- THERE WERE TWO WALLS. Behind the property columns sat
-- applications_monthly_rent_check, CHECK (monthly_rent > 0), and the direct
-- insert passes coalesce(p_rent, 0). So even with the address nullable, a draft
-- with no rent yet was refused. Same reasoning, same fix: a rent of zero is not
-- a valid application, it is an application that has not been filled in, and
-- that is what a draft is. The check becomes >= 0 and the completeness guard
-- requires a real figure before submission.
--
-- AND A THIRD. applications_postcode_valid is a regex, and the insert wrote
-- upper(btrim(coalesce(p_postcode,''))), which is '' when unanswered. An empty
-- string is not NULL: it fails the regex, where NULL would have passed. So the
-- function now writes NULL for an unanswered postcode, address and town, which
-- is what "not answered yet" actually means.
--
-- tenancy_start stays as it is: the insert defaults it to current_date + 30, so
-- it never blocked anything.
--
-- Three constraints, one cause. The direct rail creates a draft before asking
-- for the property, and every one of these assumed a property was already
-- there. None of them was wrong about a SUBMITTED application.
-- ===========================================================================

alter table public.applications alter column prop_addr1    drop not null;
alter table public.applications alter column prop_city     drop not null;
alter table public.applications alter column prop_postcode drop not null;

-- A draft may not have a rent yet. Zero means unanswered, not free.
alter table public.applications drop constraint if exists applications_monthly_rent_check;
alter table public.applications add  constraint applications_monthly_rent_check
  check (monthly_rent >= 0);

-- ---------------------------------------------------------------------------
-- Unanswered is NULL, not empty string. Only this one line changes.
-- ---------------------------------------------------------------------------
create or replace function public.create_direct_application(
  p_applicant uuid, p_rent numeric default null, p_tenancy_start date default null,
  p_addr1 text default null, p_addr2 text default null, p_city text default null,
  p_county text default null, p_postcode text default null
) returns public.applications
language plpgsql security definer set search_path to '' as $fn$
declare ap public.applicants; v_partner uuid; v_branch uuid; v_agency uuid; a public.applications;
begin
  select * into ap from public.applicants where id = p_applicant;
  if not found then raise exception 'Applicant % not found', p_applicant using errcode = '22023'; end if;
  if ap.closed_at is not null then raise exception 'This account is closed.' using errcode = '42501'; end if;

  select id into v_partner from public.partners where slug = 'opndoor-direct';
  if v_partner is null then
    raise exception 'The direct route is not provisioned (partner slug opndoor-direct is missing)';
  end if;

  select b.id, b.agency_id into v_branch, v_agency
  from public.branches b
  join public.agencies ag on ag.id = b.agency_id
  where ag.partner_id = v_partner and b.name = 'Unattached'
  limit 1;
  if v_branch is null then raise exception 'The direct route has no house branch'; end if;

  insert into public.applications (
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    applicant_id,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, v_branch, v_agency, v_partner,
    null, 'Direct signup',
    p_applicant,
    ap.title, ap.first_name, ap.last_name, ap.dob, ap.email, ap.phone,
    nullif(btrim(coalesce(p_addr1, '')), ''), nullif(btrim(coalesce(p_addr2,'')), ''),
    nullif(btrim(coalesce(p_city, '')), ''), nullif(btrim(coalesce(p_county,'')), ''),
    nullif(upper(btrim(coalesce(p_postcode,''))), ''),
    coalesce(p_rent, 0), coalesce(p_tenancy_start, current_date + 30),
    'draft', now(), 0, 0, true,
    'opndoor_referenced'
  ) returning * into a;
  return a;
end $fn$;

-- ---------------------------------------------------------------------------
-- The requirement, moved rather than removed.
-- ---------------------------------------------------------------------------
create or replace function public.assert_application_complete() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_missing text := '';
begin
  -- Drafts are exempt, and only drafts.
  if new.status = 'draft' then return new; end if;

  if coalesce(btrim(new.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if new.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(new.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;

  -- New: the property. Nothing may leave draft without somewhere to guarantee.
  if coalesce(btrim(new.prop_addr1), '')    = '' then v_missing := v_missing || 'property address, '; end if;
  if coalesce(btrim(new.prop_city), '')     = '' then v_missing := v_missing || 'town or city, '; end if;
  if coalesce(btrim(new.prop_postcode), '') = '' then v_missing := v_missing || 'postcode, '; end if;
  if coalesce(new.monthly_rent, 0) <= 0         then v_missing := v_missing || 'monthly rent, '; end if;

  if v_missing <> '' then
    raise exception 'Application is missing: %', left(v_missing, length(v_missing) - 2)
      using errcode = '23502';
  end if;
  return new;
end $function$;

-- The trigger must fire when a property column changes too, or a submitted
-- application could have its address cleared afterwards.
drop trigger if exists applications_completeness_guard on public.applications;
create trigger applications_completeness_guard
  before insert or update of status, tenant_title, tenant_dob, tenant_phone,
                             prop_addr1, prop_city, prop_postcode, monthly_rent
  on public.applications
  for each row execute function public.assert_application_complete();

comment on function public.assert_application_complete() is
  'Everything an application needs before it leaves draft: the tenant''s title, date of birth and phone, and the property address, town, postcode and a monthly rent above zero. Drafts are exempt, because a draft is allowed to be incomplete.';

-- ---------------------------------------------------------------------------
-- Prove both halves: a direct draft can now be created, and it still cannot be
-- submitted without a property.
-- ---------------------------------------------------------------------------
do $$
declare v_app public.applications; v_applicant uuid;
begin
  select id into v_applicant from public.applicants limit 1;
  if v_applicant is null then
    raise notice 'no applicant to test with; skipping the live assertion';
    return;
  end if;

  select * into v_app from public.create_direct_application(v_applicant, null, null, null, null, null, null, null);
  if v_app.id is null then raise exception 'a direct draft still cannot be created'; end if;

  begin
    update public.applications set status = 'referencing' where id = v_app.id;
    raise exception 'an application without a property was allowed to leave draft';
  exception
    when sqlstate '23502' then null;   -- refused, which is the point
  end;

  delete from public.applications where id = v_app.id;
end $$;
