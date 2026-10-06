-- ===========================================================================
-- A draft is allowed to be incomplete. Anything past draft is not.
--
-- THE BUG THIS FIXES, FOUND BY WALKING THE JOURNEY
-- applications.tenant_title, tenant_dob and tenant_phone are NOT NULL with no
-- default (20260702171309:41). That is correct for a referral: an agent types
-- the whole thing in one sitting and a half-filled referral is a mistake.
--
-- It is wrong for a direct signup, and it broke it outright.
-- create_direct_application copies those three from the applicant record, and a
-- tenant who has just registered has given a name, an email and a password.
-- They have no title and no date of birth yet, because asking for a date of
-- birth before somebody has decided to apply is exactly the friction the
-- prequalification exists to remove. So the very first act of the direct rail
-- was a NOT NULL violation.
--
-- THE FIX IS NOT TO ASK EARLIER, AND NOT TO INVENT PLACEHOLDERS
-- Collecting a date of birth at registration puts a field nobody wants in front
-- of the one screen where drop-off is most expensive. Defaulting it to anything
-- would put a fabricated date of birth on a legal instrument.
--
-- So the requirement moves from "at insert" to "past draft", which is what it
-- always meant. A draft may be missing them. The moment an application leaves
-- draft, by any route, they are required again. The referral path never enters
-- draft, so for every application an agent or a partner creates the rule is
-- exactly as strict as it was and fires at exactly the same moment.
-- ===========================================================================

alter table public.applications alter column tenant_title drop not null;
alter table public.applications alter column tenant_dob   drop not null;
alter table public.applications alter column tenant_phone drop not null;

create or replace function public.assert_application_complete() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_missing text := '';
begin
  -- Drafts are exempt, and only drafts. This is the whole change.
  if new.status = 'draft' then return new; end if;

  if coalesce(btrim(new.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if new.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(new.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;

  if v_missing <> '' then
    raise exception 'Application is missing: %', left(v_missing, length(v_missing) - 2)
      using errcode = '23502';
  end if;
  return new;
end $function$;

drop trigger if exists applications_completeness_guard on public.applications;
create trigger applications_completeness_guard
  before insert or update of status, tenant_title, tenant_dob, tenant_phone on public.applications
  for each row execute function public.assert_application_complete();

comment on function public.assert_application_complete() is
  'Title, date of birth and phone are required on every application EXCEPT a draft. Was three NOT NULL columns, which is right for a referral created in one sitting and wrong for a tenant who has only just registered. The referral path never enters draft, so nothing about it changed.';

-- The direct create path stops copying values the applicant may not have yet.
create or replace function public.create_direct_application(
  p_applicant uuid,
  p_rent numeric, p_tenancy_start date,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare v_partner uuid; v_branch uuid; v_agency uuid; ap public.applicants; a public.applications;
begin
  select * into ap from public.applicants where id = p_applicant;
  if not found then raise exception 'Applicant % not found', p_applicant using errcode = '22023'; end if;
  if ap.closed_at is not null then raise exception 'This account is closed.' using errcode = '42501'; end if;

  select p.id into v_partner from public.partners p where p.slug = 'opndoor-direct';
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
    -- Whatever they have so far. Title and date of birth arrive on the form,
    -- and the completeness guard makes sure they arrive before this leaves draft.
    ap.title, ap.first_name, ap.last_name, ap.dob, ap.email, ap.phone,
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(coalesce(p_postcode,''))),
    coalesce(p_rent, 0), coalesce(p_tenancy_start, current_date + 30),
    'draft', now(), 0, 0, true,
    'opndoor_referenced'
  ) returning * into a;
  return a;
end $function$;

revoke all on function public.create_direct_application(uuid, numeric, date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_direct_application(uuid, numeric, date, text, text, text, text, text) to service_role;

-- Nothing that exists may fail the new guard.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.applications
  where status <> 'draft'
    and (coalesce(btrim(tenant_title),'') = '' or tenant_dob is null or coalesce(btrim(tenant_phone),'') = '');
  if v_bad > 0 then
    raise exception '% existing non-draft application(s) would fail the completeness guard', v_bad;
  end if;
end $$;
