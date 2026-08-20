-- ===========================================================================
-- STEP 1 of 3. PURELY ADDITIVE. Safe to run at any time.
--
-- Creates the two gated routes to the commission figures. Revokes nothing, so
-- the currently deployed client keeps working exactly as it does now and
-- nothing is protected yet. That is the point: the protection lands in step 3,
-- after a client that no longer reads the columns is live.
--
-- Run step 3 before the client is deployed and management cannot sign in.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Per application. This is what 20260811180000 created and production never
-- got, which is why applications.partner_rate is still readable there.
-- ---------------------------------------------------------------------------
create or replace function public.application_commission_rates(p_partner uuid default null)
returns table (application_id uuid, partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to '' as $$
  select a.id, a.partner_rate, a.agent_rate
  from public.applications a
  where public.is_aal2()
    and a.livemode
    and (
      public.is_admin()
      or (public.app_role() = 'management' and a.partner_id = public.app_partner())
    )
    and (p_partner is null or a.partner_id = p_partner);
$$;

revoke all on function public.application_commission_rates(uuid) from public, anon;
grant execute on function public.application_commission_rates(uuid) to authenticated;

comment on function public.application_commission_rates(uuid) is
  'Commission rates per application for the roles entitled to them. Exists because the rate columns are revoked and RLS grants rows, not columns. Returns nothing to a referrer or a developer rather than refusing, so the caller does not need to know which it is.';

-- ---------------------------------------------------------------------------
-- Per partner. The same shape one level up.
-- ---------------------------------------------------------------------------
create or replace function public.my_partner_rates()
returns table (partner_id uuid, partner_rate numeric, agent_rate numeric)
language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() then
    return query select p.id, p.partner_rate, p.agent_rate from public.partners p;
  elsif public.app_role() = 'management' then
    return query select p.id, p.partner_rate, p.agent_rate
                   from public.partners p where p.id = public.app_partner();
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;
end $$;

revoke all on function public.my_partner_rates() from public, anon;
grant execute on function public.my_partner_rates() to authenticated;

comment on function public.my_partner_rates() is
  'Commission rates for the caller: every partner for an admin, their own for management. Refuses a referrer and a developer.';

-- ---------------------------------------------------------------------------
-- Nothing was revoked. Assert that, so this step cannot be confused with step 3.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_column_privilege('authenticated', 'public.partners', 'partner_rate', 'select') then
    raise exception 'step 1 must not revoke anything, but partners.partner_rate is already closed. Is this step 3?';
  end if;
  if to_regprocedure('public.my_partner_rates()') is null
     or to_regprocedure('public.application_commission_rates(uuid)') is null then
    raise exception 'an RPC did not get created';
  end if;
end $$;
