-- A SANDBOX TOKEN MINTS A SANDBOX APPLICATION.
--
-- Round 5, M6. referencing_inbound_tokens carries a `livemode` column, and
-- referencing-inbound selects it:
--
--   .select("id, agency_number, partner_id, livemode, active")
--
-- and then never passes it. This function writes `livemode` as the literal
-- `true`, so every application arriving on the referencing hand-over rail is
-- a live one, and a partner testing against their sandbox token creates real
-- applications on our estate: real guarantee refs off the live sequence, real
-- rows in the agency's book, and -- because livemode is what the senders
-- test -- real email to real tenants.
--
-- The parameter is added rather than the column read back inside, because the
-- token is the authority here and the token is what the caller authenticated
-- with. Reading `referencing_inbound_tokens` a second time inside the
-- function would be a second lookup that can disagree with the first.
--
-- DROP AND RECREATE, not create-or-replace: a new parameter is a new
-- signature, so `create or replace` would leave the old nineteen-argument
-- function in place as an overload and the edge function would keep resolving
-- to whichever matched. The drop takes the ACL with it, so the grant is
-- restated below; it was service_role only, and this is called from an edge
-- function with the service key.

drop function if exists public.create_referencing_inbound_application(
  bigint, uuid, text, text, text, date, text, text, text, text, text, numeric,
  date, text, text, text, text, text, text);

CREATE FUNCTION public.create_referencing_inbound_application(p_table_id bigint, p_partner uuid, p_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_city text, p_postcode text, p_rent numeric, p_tenancy_start date, p_company text, p_agency text, p_user text, p_tenant text, p_agency_number text, p_tenant_ref text, p_livemode boolean)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    p_rent, p_tenancy_start, 'sent', now(), 0, 0, coalesce(p_livemode, false),
    'pre_referenced_open'
  ) returning * into a;

  insert into public.application_provider_links
    (application_id, table_id, company_id, agency_id, user_id, tenant_id, agency_number, tenant_reference_number)
  values (a.id, p_table_id, p_company, p_agency, p_user, p_tenant, p_agency_number, p_tenant_ref);

  return a;
end $function$;


revoke all on function public.create_referencing_inbound_application(
  bigint, uuid, text, text, text, date, text, text, text, text, text, numeric,
  date, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_referencing_inbound_application(
  bigint, uuid, text, text, text, date, text, text, text, text, text, numeric,
  date, text, text, text, text, text, text, boolean) to service_role;
