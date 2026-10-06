-- ===========================================================================
-- The commission columns on partners, closed the same way applications was.
--
-- THE DEFECT. 20260811180000 revoked applications.partner_rate and
-- applications.agent_rate from authenticated, because RLS grants ROWS and not
-- COLUMNS and a referrer could otherwise read commission straight from
-- PostgREST. The SAME TWO VALUES live on public.partners and were never
-- revoked there. Proven live, as a plain referrer at AAL2:
--
--   partners.partner_rate  authenticated can select: TRUE
--   partners.agent_rate    authenticated can select: TRUE
--   applications.partner_rate                       false   <- the fix that worked
--
-- A column-level revoke on one table does not protect the same value held on
-- another. That is the class, and it is now REGRESSION H21.12.
--
-- HOW IT CAME BACK. 20260810210000:200-219 removed `developer` from
-- partners_select deliberately and left a comment: "Exists because
-- partners_select excludes developers to keep partner_rate and agent_rate away
-- from them, and RLS cannot filter columns. Never add rate columns here."
-- 20260811190000:67-72 put `developer` back, justifying it with the narrowed
-- select in hydrate.ts. The migration immediately before it, 20260811180000,
-- states why that is not a defence: "maySeeCommission() decides whether the
-- client ASKS. It is TypeScript. PostgREST does not consult it."
--
-- A migration comment saying never do X is a recorded decision. Reversing it
-- means arguing against the original reason, and client-side narrowing is never
-- that argument.
--
-- THE MECHANISM, and its cost. A column-level REVOKE cannot subtract from a
-- table-level GRANT, so the table grant goes and every other column is granted
-- back by name. CONSEQUENCE: every future column added to public.partners needs
-- its own grant here or it is silently invisible to the portal. That is the
-- same bargain 20260811180000 struck on applications and it is the reason this
-- file lists columns rather than using a wildcard.
--
-- ADMIN AND MANAGEMENT still need the figures, so they get a definer RPC, the
-- route my_partner_summary already established for the developer's own view.
-- ===========================================================================

revoke select on public.partners from authenticated;

grant select (
  id, slug, name, status, live_from, is_primary,
  referrer_leaderboard_mode, referencing_mode,
  portal_referrals_enabled, api_access_enabled,
  is_house_route, refers_own_stock, created_at
) on public.partners to authenticated;

-- ---------------------------------------------------------------------------
-- The gated route back. Admin and management only, which is exactly what
-- maySeeCommission() allows on the client, except this one is enforced.
-- ---------------------------------------------------------------------------
create or replace function public.my_partner_rates()
returns table (partner_id uuid, partner_rate numeric, agent_rate numeric)
language plpgsql stable security definer set search_path to '' as $$
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- A referrer and a developer are refused here, deliberately. That is the
  -- whole point: the client used to decide this and PostgREST did not ask.
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
  'Commission rates for the caller: every partner for an admin, their own for management. Refuses a referrer and a developer. Exists because the rate columns on partners are revoked and RLS cannot filter columns.';

-- ---------------------------------------------------------------------------
-- Prove it, with has_column_privilege, the way the exposure was proven.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.partners', 'partner_rate', 'select') then
    raise exception 'authenticated can still select partners.partner_rate';
  end if;
  if has_column_privilege('authenticated', 'public.partners', 'agent_rate', 'select') then
    raise exception 'authenticated can still select partners.agent_rate';
  end if;

  -- The portal must still work. If these went with the table grant, every
  -- screen that lists partners breaks.
  if not has_column_privilege('authenticated', 'public.partners', 'name', 'select') then
    raise exception 'authenticated lost partners.name; the whole portal reads it';
  end if;
  if not has_column_privilege('authenticated', 'public.partners', 'referencing_mode', 'select') then
    raise exception 'authenticated lost partners.referencing_mode';
  end if;

  -- service_role keeps everything, or the Edge Functions stop resolving rates.
  if not has_column_privilege('service_role', 'public.partners', 'partner_rate', 'select') then
    raise exception 'service_role lost partners.partner_rate; rate snapshotting would fail';
  end if;
end $$;
