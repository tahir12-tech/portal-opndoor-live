-- create_referral_api: the machine-callable sibling of create_referral.
--
-- WHY A SIBLING RATHER THAN REUSING create_referral. That function blocks a
-- machine caller in three independent ways, none of which can be relaxed without
-- weakening the portal path:
--
--   is_aal2()      an API-key request has no session and no MFA assurance level
--   auth.uid()     supplies referrer_id, and there is no authenticated user
--   app_partner()  reads a JWT claim that does not exist
--
-- So the partner and referrer arrive as explicit arguments. The API key is the
-- authentication, verified in the Edge Function before this is called.
--
-- THE VALIDATION IS SHARED, NOT COPIED. Both entry points call
-- assert_referral_valid, which is built on referral_field_errors
-- (20260810120000). One copy of the rules, so the portal and the API cannot
-- start disagreeing about what a valid application is. The Edge Function calls
-- referral_field_errors directly first to build per-field errors; the call here
-- is the backstop that makes the RPC safe to call from anywhere.
--
-- WHAT IT PRODUCES IS DELIBERATELY IDENTICAL to the portal path. Same table,
-- same guarantee_ref sequence, same status, same referrer_name snapshot, same
-- commission-rate snapshot. An application created through the API must be
-- indistinguishable from a typed one, so nothing downstream can branch on how it
-- arrived. Provenance lives in partner_api_requests, not here.
--
-- SECURITY. definer, because every table carries a restrictive AAL2 policy an
-- API-key request cannot satisfy. p_partner comes from the verified key and
-- never from a payload. The branch is checked to belong to that partner, which
-- is the check that stops one partner writing an application against another's
-- org. Execute is granted to service_role only: no authenticated user can reach
-- this and thereby bypass the AAL2 gate on the portal path.

create or replace function public.create_referral_api(
  p_partner uuid,
  p_referrer uuid,
  p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications; rname text;
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_referrer is null then raise exception 'Referrer is required.' using errcode = '22023'; end if;

  -- Same rules as the portal, from the same function.
  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate
    into ag, pid, prate, arate
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;

  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  -- The cross-partner guard. Deliberately the same message whether the branch
  -- belongs to another partner or does not exist, so the API cannot be used to
  -- probe for the existence of another partner's orgs.
  if pid <> p_partner then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  -- The referrer must belong to this partner too. Without this, a partner could
  -- attribute an application to another partner's user.
  select u.full_name into rname
  from public.users u
  where u.id = p_referrer and u.partner_id = p_partner;

  if not found then
    raise exception 'Referrer not found for this partner.' using errcode = '22023';
  end if;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, p_branch, ag, p_partner, p_referrer,
    rname,
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate
  ) returning * into a;

  return a;
end $function$;

comment on function public.create_referral_api(uuid, uuid, uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Machine-callable create path for the partner API. Partner and referrer are explicit because an API-key request has no session. Shares validation with create_referral and produces an identical row, so an API-created application is indistinguishable from a typed one.';

revoke all on function public.create_referral_api(uuid, uuid, uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.create_referral_api(uuid, uuid, uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) to service_role;
