-- Partner capabilities, and the referencing_mode snapshot.
--
-- Two independent dimensions on a partner. referencing_mode decides what happens
-- to an application after it arrives; capabilities decide what the partner can
-- do at all. They are deliberately not one "partner type" enum: an agency is
-- portal only, a CRM is API only, and Rightmove are both, so a type would need a
-- value per combination and a new one every time a combination appeared.

-- ---------------------------------------------------------------------------
-- 1. The capability flags
-- ---------------------------------------------------------------------------
-- The DEFAULTS ARE THE BACKFILL. Every existing partner predates all of this, so
-- the defaults are chosen to preserve exactly what is true today rather than to
-- express a preference: they all use the portal, none of them has API keys. No
-- separate UPDATE is needed and none should be added.
--
-- api_access_enabled defaults FALSE for new partners too, so enabling the API is
-- always a deliberate act. That asymmetry is the point: the cost of wrongly
-- having the portal on is a nav item somebody ignores; the cost of wrongly
-- having the API on is credentials that create real applications.
alter table public.partners
  add column if not exists portal_referrals_enabled boolean not null default true,
  add column if not exists api_access_enabled       boolean not null default false;

comment on column public.partners.portal_referrals_enabled is
  'Whether this partner''s staff may create referrals in the portal. Default true, which is what every partner predating this column was doing.';
comment on column public.partners.api_access_enabled is
  'Whether this partner may hold API keys. Default false, so enabling the API is always deliberate. Also gates AUTHENTICATION, not just minting: turning it off stops existing keys working.';

-- ---------------------------------------------------------------------------
-- 2. The referencing_mode snapshot
-- ---------------------------------------------------------------------------
-- Same reasoning as partner_rate and agent_rate, and the same three steps: add
-- nullable, backfill from the partner's current value, then make it required.
--
-- Without this, changing a partner's mode would retroactively change the basis
-- on which every application already in flight was accepted. An application
-- taken under open criteria would start claiming it was screened, which is a
-- commercial and possibly contractual statement about work that was already
-- done.
alter table public.applications
  add column if not exists referencing_mode text;

-- Backfill from the partner's CURRENT mode. This is an assertion, so it is worth
-- being explicit about why it is safe: the two other modes return 501 at the
-- create path and always have, so no application has ever been created under
-- one. Every existing application was therefore created under the mode its
-- partner holds now.
update public.applications a
set referencing_mode = coalesce(a.referencing_mode, p.referencing_mode)
from public.partners p
where a.partner_id = p.id and a.referencing_mode is null;

alter table public.applications
  alter column referencing_mode set not null;

alter table public.applications drop constraint if exists applications_referencing_mode_check;
alter table public.applications add constraint applications_referencing_mode_check
  check (referencing_mode in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced'));

comment on column public.applications.referencing_mode is
  'The partner''s referencing mode AT CREATION. Snapshotted like partner_rate and agent_rate so changing a partner''s mode never rewrites the basis of applications already in flight.';

-- ---------------------------------------------------------------------------
-- 3. Both create paths snapshot it, and the portal path respects the capability
-- ---------------------------------------------------------------------------
-- These must move in the same migration as the NOT NULL above, or the first
-- insert after it fails.
create or replace function public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications;
        v_mode text; v_portal_ok boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate,
         p.referencing_mode, p.portal_referrals_enabled
    into ag, pid, prate, arate, v_mode, v_portal_ok
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  -- The capability, enforced here rather than only by hiding the button. A
  -- hidden control is a suggestion; this is the rule. Admins are not exempt:
  -- an opndoor admin creating a referral on behalf of an API-only partner would
  -- produce exactly the row the setting exists to prevent.
  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, p_branch, ag, pid, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true,
    v_mode
  ) returning * into a;
  return a;
end $function$;

create or replace function public.create_referral_api(
  p_partner uuid,
  p_livemode boolean,
  p_referrer uuid,
  p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications; rname text;
        v_branch_live boolean; v_ref text; v_mode text;
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_referrer is null then raise exception 'Referrer is required.' using errcode = '22023'; end if;
  if p_livemode is null then raise exception 'livemode is required.' using errcode = '22023'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate, b.livemode, p.referencing_mode
    into ag, pid, prate, arate, v_branch_live, v_mode
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;

  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if pid <> p_partner then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  if v_branch_live is distinct from p_livemode then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  select u.full_name into rname
  from public.users u
  where u.id = p_referrer and u.partner_id = p_partner;

  if not found then
    raise exception 'Referrer not found for this partner.' using errcode = '22023';
  end if;

  v_ref := case when p_livemode
                then 'GR-'      || nextval('public.guarantee_ref_seq')::text
                else 'GR-TEST-' || nextval('public.guarantee_ref_sandbox_seq')::text
           end;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    -- Snapshotted from the partner as it is NOW. The Edge Function separately
    -- read the same value to decide whether to accept the request at all, and a
    -- mode change between those two reads would mean the row records a mode the
    -- request was not judged under. That window is one statement wide and the
    -- alternative, passing the mode in as an argument, would let the caller
    -- state it, which is the thing this whole design refuses to allow.
    referencing_mode
  ) values (
    v_ref, p_branch, ag, p_partner, p_referrer,
    rname,
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, p_livemode,
    v_mode
  ) returning * into a;

  return a;
end $function$;
