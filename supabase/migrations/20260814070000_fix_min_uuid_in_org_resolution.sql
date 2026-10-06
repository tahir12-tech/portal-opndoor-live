-- ===========================================================================
-- Re-applies partner_api_resolve_org with min(uuid) removed.
--
-- THE DEFECT, AND IT PREDATES THIS WORK. The function resolved "the only one"
-- with min(a.id) and min(b.id), in four places. PostgreSQL HAS NO min AGGREGATE
-- FOR uuid, in 17 or in any earlier version, so every by-name resolution raised
--
--   42883: function min(uuid) does not exist
--
-- which means POST /v1/applications with org: { agency_name, branch_name } has
-- never worked on any deployment. Only the by-id form did. It survived because
-- the failure is at EXECUTION, not at creation: the migration applied cleanly,
-- and nothing in the suite ever called it with a name.
--
-- Found by calling the function rather than reading it, which is the second
-- time in this session that has been the difference between a green push and a
-- working function. The first was a temp table inside a stable function.
--
-- Replaced with (array_agg(id))[1], which is only ever read when the count is 1,
-- so which element it returns cannot matter.
--
-- 20260814050000 was already recorded as applied when this was found, and a
-- recorded migration cannot be edited, so the corrected body needs its own step.
-- Everything else is identical. Read that migration's header for why an agent
-- may omit the agency at all.
-- ===========================================================================

create or replace function public.partner_api_resolve_org(
  p_partner uuid,
  p_agency_name text,
  p_branch_name text
)
returns table (outcome text, agency_id uuid, branch_id uuid, detail text)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_agency uuid; v_agency_n int; v_branch uuid; v_branch_n int; v_names text;
  v_own boolean;
begin
  if public.normalise_org_name(p_agency_name) is null then
    select p.refers_own_stock into v_own from public.partners p where p.id = p_partner;

    -- Only a partner that owns its stock may omit the agency, and only when
    -- there is exactly one to mean.
    if coalesce(v_own, false) then
      select count(*), (array_agg(a.id))[1] into v_agency_n, v_agency
        from public.agencies a where a.partner_id = p_partner;

      if v_agency_n = 1 then
        -- Fall through to the branch resolution below with the agency settled.
        null;
      else
        -- A group has several brands and must name one. Report the same
        -- ambiguity the branch case reports, with the names, so an integrator
        -- can fix it without a support ticket.
        select string_agg(a.name, ', ' order by a.name) into v_names
          from public.agencies a where a.partner_id = p_partner;
        return query select 'agency_required'::text, null::uuid, null::uuid, v_names;
        return;
      end if;
    else
      return query select 'agency_required'::text, null::uuid, null::uuid, null::text;
      return;
    end if;
  else
    select count(*), (array_agg(a.id))[1] into v_agency_n, v_agency
      from public.agencies a
     where a.partner_id = p_partner
       and public.normalise_org_name(a.name) = public.normalise_org_name(p_agency_name);

    if v_agency_n = 0 then
      return query select 'agency_not_found'::text, null::uuid, null::uuid, null::text;
      return;
    end if;

    if v_agency_n > 1 then
      -- Two agencies normalising the same is a data problem on our side, not
      -- the partner's. Say so rather than picking one.
      select string_agg(a.name, ', ' order by a.name) into v_names
        from public.agencies a
       where a.partner_id = p_partner
         and public.normalise_org_name(a.name) = public.normalise_org_name(p_agency_name);
      return query select 'agency_ambiguous'::text, null::uuid, null::uuid, v_names;
      return;
    end if;
  end if;

  -- No branch named. One branch is unambiguous; more than one must be asked.
  if public.normalise_org_name(p_branch_name) is null then
    select count(*), (array_agg(b.id))[1] into v_branch_n, v_branch
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

  select count(*), (array_agg(b.id))[1] into v_branch_n, v_branch
    from public.branches b
   where b.agency_id = v_agency
     and public.normalise_org_name(b.name) = public.normalise_org_name(p_branch_name);

  if v_branch_n = 0 then
    return query select 'branch_not_found'::text, v_agency, null::uuid, null::text;
  elsif v_branch_n > 1 then
    select string_agg(b.name, ', ' order by b.name) into v_names
      from public.branches b
     where b.agency_id = v_agency
       and public.normalise_org_name(b.name) = public.normalise_org_name(p_branch_name);
    return query select 'branch_ambiguous'::text, v_agency, null::uuid, v_names;
  else
    return query select 'ok'::text, v_agency, v_branch, null::text;
  end if;
end $function$;

-- ---------------------------------------------------------------------------
-- The write guard is somewhere else and must still be there. This function only
-- resolves; create_referral_api is what refuses another partner's branch, and
-- two earlier migrations already assert it. Assert it a third time here, because
-- this migration is the one that made resolution more permissive.
-- ---------------------------------------------------------------------------
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc
   where proname = 'create_referral_api' and pronamespace = 'public'::regnamespace
   limit 1;

  if position('pid <> p_partner' in v_src) = 0 then
    raise exception 'create_referral_api no longer guards pid <> p_partner; loosening org resolution without it would let a caller reach another partner';
  end if;
end $$;
