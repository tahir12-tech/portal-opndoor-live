-- Extract create_referral's field validation into a callable function so the
-- planned partner API RPC can share it rather than copy it.
--
-- Why: the partner API cannot reuse create_referral itself. That function gates
-- on public.is_aal2() and reads auth.uid() for referrer_id and referrer_name,
-- none of which exist on an API-key request, so it needs a sibling entry point.
-- Two entry points with two copies of eleven field rules would drift, and the
-- portal would start accepting things the API rejects. One shared body cannot.
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR. The rules, their order, their messages
-- and their SQLSTATEs are byte-identical to the previous definition in
-- 20260705140347_snapshot_referrer_name.sql. Only their location moves.
--
-- Deliberately NOT extracted, because they are not field validation and differ
-- per caller:
--   * the is_aal2() gate, which is authentication. The API key is the
--     partner API's authentication and it has no session to step up.
--   * the branch lookup and the app_partner() permission check, which resolve
--     the caller's scope.

-- ---------- the shared validator ----------
-- Raises on the first failing group, exactly as the inline block did:
-- accumulated field errors first as one message, then the four combined rules
-- in order. Returns void when the payload is valid.
--
-- Accesses no tables, so security invoker and stable. p_addr2 and p_county are
-- accepted for signature symmetry with create_referral but are deliberately
-- unvalidated, matching current behaviour.
create or replace function public.assert_referral_valid(
  p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
) returns void
language plpgsql stable security invoker set search_path to ''
as $function$
declare errs text[] := '{}';
begin
  if coalesce(p_tenant_title,'') not in ('Mr','Mrs','Miss','Ms','Mx','Dr') then errs := array_append(errs, 'title'); end if;
  if btrim(coalesce(p_first,'')) = '' then errs := array_append(errs, 'first name'); end if;
  if btrim(coalesce(p_last,'')) = '' then errs := array_append(errs, 'last name'); end if;
  if p_dob is null then errs := array_append(errs, 'date of birth');
  elsif p_dob >= current_date then errs := array_append(errs, 'date of birth (must be in the past)'); end if;
  if coalesce(p_email,'') !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then errs := array_append(errs, 'email'); end if;
  if btrim(coalesce(p_phone,'')) = '' or p_phone !~ '[0-9]' then errs := array_append(errs, 'phone'); end if;
  if btrim(coalesce(p_addr1,'')) = '' then errs := array_append(errs, 'address line 1'); end if;
  if btrim(coalesce(p_city,'')) = '' then errs := array_append(errs, 'city/town'); end if;
  if coalesce(p_postcode,'') !~* '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$' then errs := array_append(errs, 'postcode'); end if;
  if p_rent is null or p_rent <= 0 then errs := array_append(errs, 'monthly rent'); end if;
  if p_tenancy_start is null then errs := array_append(errs, 'tenancy start date'); end if;
  if p_branch is null then errs := array_append(errs, 'branch'); end if;

  if array_length(errs, 1) > 0 then
    raise exception 'Missing or invalid: %', array_to_string(errs, ', ') using errcode = '22023';
  end if;

  if (p_dob + interval '18 years')::date > p_tenancy_start then
    raise exception 'Tenant must be 18 by the tenancy start date.' using errcode = '22023';
  end if;
  if (p_dob + interval '100 years')::date < p_tenancy_start then
    raise exception 'Check the date of birth: the tenant would be over 100 at the tenancy start.' using errcode = '22023';
  end if;
  if p_tenancy_start < (current_date - interval '7 days')::date then
    raise exception 'Tenancy start date cannot be more than 7 days in the past.' using errcode = '22023';
  end if;
  if p_tenancy_start > (current_date + interval '2 years')::date then
    raise exception 'Tenancy start date cannot be more than 2 years ahead.' using errcode = '22023';
  end if;
end $function$;

comment on function public.assert_referral_valid(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Field validation for a referral payload. Shared by create_referral and the planned partner API RPC so the two entry points cannot drift. Raises 22023 with the same messages as the original inline block.';

revoke all on function public.assert_referral_valid(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.assert_referral_valid(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) to authenticated, service_role;

-- ---------- create_referral, now calling the shared validator ----------
-- Identical to the 20260705140347 definition except that the inline validation
-- block is replaced by the perform below. Everything else, including the
-- referrer_name snapshot and the partner_rate / agent_rate commission snapshot,
-- is unchanged.
create or replace function public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate
    into ag, pid, prate, arate
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not (public.is_admin() or pid = public.app_partner()) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, p_branch, ag, pid, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate
  ) returning * into a;
  return a;
end $function$;
