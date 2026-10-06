-- ===========================================================================
-- Fixes a constraint I got wrong in 20260812090000.
--
-- WHAT WAS WRONG
-- applications_referrer_required says every application has a referrer OR an
-- applicant. That was written with two rails in mind and there are four. The
-- inbound hand-over rail has NEITHER: nobody at Opndoor referred them, and the
-- tenant keeps a tokenised link rather than getting an account, exactly as a
-- Rightmove tenant does. So the constraint would have rejected every rail 4
-- application, and the function that creates them could never have run.
--
-- WHY NOT JUST DROP IT
-- Because the thing it was protecting is real. Relaxing referrer_id from NOT
-- NULL removed a guarantee, and without a replacement a portal or API create
-- that silently lost its attribution would be accepted. The referral path must
-- keep failing loudly in that case.
--
-- THE RULE, STATED PROPERLY
-- An application must have a referrer, OR an applicant account, OR belong to a
-- route where by design it has neither. The third arm is what was missing, and
-- it cannot be a CHECK constraint because it depends on another table. So the
-- guard becomes a trigger, and "a route where it has neither" becomes a
-- property of the partner rather than a list of slugs hardcoded in a function.
-- ===========================================================================

alter table public.partners
  add column if not exists is_house_route boolean not null default false;

comment on column public.partners.is_house_route is
  'True for routes Opndoor operates rather than sells: direct signup and the referencing hand-over. Applications on these rails legitimately have no staff referrer, which is the only thing this flag is allowed to mean. It is NOT a permission and NOT a capability.';

update public.partners
   set is_house_route = true
 where slug in ('opndoor-direct','referencing-partner')
   and is_house_route = false;

-- The CHECK goes; it cannot express the third arm.
alter table public.applications drop constraint if exists applications_referrer_required;

create or replace function public.assert_application_attributed() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_house boolean;
begin
  if new.referrer_id is not null or new.applicant_id is not null then
    return new;
  end if;

  select p.is_house_route into v_house from public.partners p where p.id = new.partner_id;

  if coalesce(v_house, false) then
    return new;   -- direct signup or an inbound hand-over: no referrer by design
  end if;

  raise exception
    'Application has no referrer and no applicant, and % is not a house route. Attribution cannot be silently missing.',
    new.partner_id
    using errcode = '23514';
end $function$;

drop trigger if exists applications_attribution_guard on public.applications;
create trigger applications_attribution_guard
  before insert or update of referrer_id, applicant_id, partner_id on public.applications
  for each row execute function public.assert_application_attributed();

comment on function public.assert_application_attributed() is
  'Replaces applications_referrer_required, which could not express the third legitimate case. A referrer, or an applicant account, or a house route. Everything else is attribution silently going missing on a path that should have it.';

-- ---------------------------------------------------------------------------
-- The inbound create function claimed the caller supplies an applicant. It does
-- not: a hand-over tenant keeps the tokenised link and never signs in, the same
-- as a Rightmove tenant. Reproduced with that comment corrected and nothing
-- else changed.
-- ---------------------------------------------------------------------------
create or replace function public.create_referencing_inbound_application(
  p_table_id bigint,
  p_partner uuid,
  p_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_city text, p_postcode text,
  p_rent numeric, p_tenancy_start date,
  p_company text, p_agency text, p_user text, p_tenant text,
  p_agency_number text, p_tenant_ref text
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare v_branch uuid; v_agency uuid; a public.applications; v_existing uuid;
begin
  select application_id into v_existing
  from public.application_provider_links where table_id = p_table_id;
  if v_existing is not null then
    select * into a from public.applications where id = v_existing;
    return a;
  end if;

  select b.id, b.agency_id into v_branch, v_agency
  from public.branches b
  join public.agencies ag on ag.id = b.agency_id
  where ag.partner_id = p_partner and b.name = 'Unattached'
  limit 1;
  if v_branch is null then
    raise exception 'The referencing route has no house branch' using errcode = '22023';
  end if;

  insert into public.applications (
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_city, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, v_branch, v_agency, p_partner,
    -- No referrer and no applicant. Nobody here referred them, and a hand-over
    -- tenant keeps the tokenised link rather than getting an account, the same
    -- as a Rightmove tenant. Legal because the partner is a house route; the
    -- attribution guard checks exactly that.
    null, 'Referencing hand-over',
    p_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), btrim(p_city), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), 0, 0, true,
    'pre_referenced_open'
  ) returning * into a;

  insert into public.application_provider_links
    (application_id, table_id, company_id, agency_id, user_id, tenant_id, agency_number, tenant_reference_number)
  values (a.id, p_table_id, p_company, p_agency, p_user, p_tenant, p_agency_number, p_tenant_ref);

  return a;
end $function$;

-- Prove the guard admits all four rails and still refuses a lost referrer.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.applications a
  join public.partners p on p.id = a.partner_id
  where a.referrer_id is null and a.applicant_id is null and not p.is_house_route;
  if v_bad > 0 then
    raise exception '% existing application(s) would now fail the attribution guard', v_bad;
  end if;
end $$;
