-- Organisations: resolve by name, never create.
--
-- Partners create the agency and branch in the portal first, with a contact
-- email. Only then can their system send applications against it. The API
-- resolves what they name; it does not create, and it does not queue anything
-- for reconciliation.
--
-- ===========================================================================
-- WHAT THIS BREAKS IF NOTHING ELSE CHANGES, AND WHY THE GUARD BELOW GOES
-- ===========================================================================
-- create_referral_target_api was the ONLY writer that could produce a SANDBOX
-- agency or branch. Every other org-creating function is a portal RPC that never
-- sets livemode, so it produces live rows, and the restrictive policies
-- agencies_live_only / branches_live_only carry `with check (livemode)`, which
-- refuses a sandbox insert from any authenticated session including a
-- developer's.
--
-- So removing it means no sandbox org can ever exist again. And
-- create_referral_api refused a branch whose livemode differed from the key's,
-- which would then have made every sandbox application impossible to create.
-- Sandbox would have been dead, silently, with the only symptom a "Selected
-- branch not found" that looked like a bad id.
--
-- The resolution is that THE ORG IS NOT THE THING BEING SANDBOXED. A developer
-- rehearsing wants to send a test application against a branch that really
-- exists, which is their real one. So the cross-mode branch guard goes, and a
-- sandbox application may reference a live org.
--
-- Nothing leaks by allowing that. The APPLICATION is still sandbox and still
-- invisible everywhere except the Dev Centre; reconciliation_queue counts only
-- applications with livemode true; no opndoor email is sent for sandbox, so the
-- branch's real agent contact is never written to; and the deed goes to the
-- tenant address the developer supplied, through PandaDoc's sandbox account.
--
-- The livemode columns on agencies, branches and agent_contacts are now
-- vestigial. They are deliberately NOT dropped here: they hold data on any
-- project where sandbox orgs were already created, dropping a column is not
-- reversible, and leaving them costs nothing. See HANDOVER.md before removing.

-- ---------------------------------------------------------------------------
-- 1. Name normalisation
-- ---------------------------------------------------------------------------
-- Matching raw names produces false misses that are invisible to the partner:
-- "Foo Lettings Ltd" against "Foo Lettings", a trailing space from a CSV export,
-- a capitalised first letter. Each is a rejected application that looks like our
-- fault, and the partner cannot see our stored value to compare.
--
-- IMMUTABLE so it can be used in an index later if matching ever gets slow. It
-- is not indexed now: a partner has tens of agencies, not thousands.
create or replace function public.normalise_org_name(p_name text)
returns text
language sql immutable
as $function$
  select nullif(
    btrim(
      regexp_replace(
        -- Collapse all whitespace runs to one space first, so "Foo   Ltd"
        -- and "Foo Ltd" normalise the same before the suffix is stripped.
        regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', ' ', 'g'),
        -- Trailing Ltd / Limited, with or without a preceding comma and with or
        -- without a full stop. Only at the END: "Limited Lettings Group" keeps
        -- its first word.
        '[,[:space:]]*(ltd|limited)[.]?$', '', 'i'
      )
    ),
  '');
$function$;

comment on function public.normalise_org_name(text) is
  'Lowercases, trims, collapses internal whitespace and strips a trailing Ltd or Limited. Used to match partner-supplied org names against stored ones without false misses on formatting.';

-- ---------------------------------------------------------------------------
-- 2. Resolve, with ambiguity reported rather than guessed
-- ---------------------------------------------------------------------------
-- Returns an OUTCOME rather than raising, so the Edge Function can turn each
-- case into its own field error with its own message. A partner told only
-- "not found" when the real problem is two branches with the same name will
-- check their spelling for an hour.
create or replace function public.partner_api_resolve_org(
  p_partner uuid,
  p_agency_name text,
  p_branch_name text
)
returns table (outcome text, agency_id uuid, branch_id uuid, detail text)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_agency uuid; v_agency_n int; v_branch uuid; v_branch_n int; v_names text;
begin
  if public.normalise_org_name(p_agency_name) is null then
    return query select 'agency_required'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  select count(*), min(a.id) into v_agency_n, v_agency
  from public.agencies a
  where a.partner_id = p_partner
    and public.normalise_org_name(a.name) = public.normalise_org_name(p_agency_name);

  if v_agency_n = 0 then
    return query select 'agency_not_found'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_agency_n > 1 then
    -- Two agencies normalising the same is a data problem on our side, not the
    -- partner's. Say so rather than picking one: picking one attaches real money
    -- to an arbitrary record.
    select string_agg(a.name, ', ' order by a.name) into v_names
    from public.agencies a
    where a.partner_id = p_partner
      and public.normalise_org_name(a.name) = public.normalise_org_name(p_agency_name);
    return query select 'agency_ambiguous'::text, null::uuid, null::uuid, v_names;
    return;
  end if;

  -- No branch named. If the agency has exactly one, that is unambiguous and
  -- using it is a kindness. More than one and we must ask, because guessing
  -- "Head office" would silently send applications somewhere the partner did not
  -- name.
  if public.normalise_org_name(p_branch_name) is null then
    select count(*), min(b.id) into v_branch_n, v_branch
    from public.branches b where b.agency_id = v_agency;

    if v_branch_n = 1 then
      return query select 'ok'::text, v_agency, v_branch, null::text;
    else
      select string_agg(b.name, ', ' order by b.name) into v_names
      from public.branches b where b.agency_id = v_agency;
      return query select 'branch_required'::text, v_agency, null::uuid, v_names;
    end if;
    return;
  end if;

  select count(*), min(b.id) into v_branch_n, v_branch
  from public.branches b
  where b.agency_id = v_agency
    and public.normalise_org_name(b.name) = public.normalise_org_name(p_branch_name);

  if v_branch_n = 0 then
    select string_agg(b.name, ', ' order by b.name) into v_names
    from public.branches b where b.agency_id = v_agency;
    return query select 'branch_not_found'::text, v_agency, null::uuid, v_names;
    return;
  end if;

  if v_branch_n > 1 then
    return query select 'branch_ambiguous'::text, v_agency, null::uuid, p_branch_name;
    return;
  end if;

  return query select 'ok'::text, v_agency, v_branch, null::text;
end $function$;

revoke all on function public.partner_api_resolve_org(uuid, text, text) from public, anon, authenticated;
grant execute on function public.partner_api_resolve_org(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Org creation from the API is gone
-- ---------------------------------------------------------------------------
-- Both signatures: the original, and the livemode one added when sandbox org
-- creation was kept. Dropped rather than left unused, so nothing can call it by
-- accident and nobody has to work out whether it is live.
drop function if exists public.create_referral_target_api(uuid, uuid, text, text, text, text, text);
drop function if exists public.create_referral_target_api(uuid, boolean, uuid, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 4. GET /v1/orgs returns the partner's orgs, whatever mode the key is
-- ---------------------------------------------------------------------------
-- The livemode filter here existed to stop a sandbox key seeing live orgs. That
-- was right when sandbox had its own orgs. Now that a sandbox application
-- references the partner's real branch, a sandbox key that could not SEE those
-- branches could never name one, and GET /v1/orgs would return an empty list
-- with no explanation.
drop function if exists public.partner_api_orgs(uuid, boolean);

create function public.partner_api_orgs(p_partner uuid)
returns table (
  agency_id                 uuid,
  agency_name               text,
  agency_has_agent_contact  boolean,
  branch_id                 uuid,
  branch_name               text,
  branch_has_agent_contact  boolean
)
language sql security definer set search_path to '' stable
as $function$
  select
    a.id,
    a.name,
    exists (
      select 1 from public.agent_contacts c
      where c.agency_id = a.id and c.is_primary
    ) as agency_has_agent_contact,
    b.id,
    b.name,
    case when b.id is null then null
         else ((public.effective_primary_contact(b.id)).email is not null)
    end as branch_has_agent_contact
  from public.agencies a
  left join public.branches b
    on b.agency_id = a.id
   and b.partner_id = p_partner
  where a.partner_id = p_partner
  order by a.name, b.name nulls first;
$function$;

revoke all on function public.partner_api_orgs(uuid) from public, anon, authenticated;
grant execute on function public.partner_api_orgs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The cross-mode branch guard goes
-- ---------------------------------------------------------------------------
-- See the header. Reproduced in full with that one block removed and nothing
-- else changed.
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
        v_ref text; v_mode text;
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_referrer is null then raise exception 'Referrer is required.' using errcode = '22023'; end if;
  if p_livemode is null then raise exception 'livemode is required.' using errcode = '22023'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate, p.referencing_mode
    into ag, pid, prate, arate, v_mode
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;

  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  -- The cross-PARTNER guard stays. Deliberately the same message whether the
  -- branch belongs to another partner or does not exist, so the API cannot be
  -- used to probe for the existence of another partner's orgs.
  if pid <> p_partner then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  -- The cross-MODE guard is GONE. Orgs are no longer per mode: a sandbox
  -- application references the partner's real branch, because the org is not the
  -- thing being rehearsed and there is now no other org for it to reference.

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
