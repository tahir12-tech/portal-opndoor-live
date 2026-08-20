-- ===========================================================================
-- Seventeen SECURITY DEFINER helpers were executable by any signed-in user.
--
-- WHAT THEY HAVE IN COMMON. Every one is SECURITY DEFINER, so it bypasses RLS.
-- Every one has NO role, ownership or partner test anywhere in its body. And
-- every one is reached only by an Edge Function running as service_role, or by
-- another definer function, or by nothing at all. The grant to `authenticated`
-- was never serving a caller: it is the Supabase default that nobody revoked.
--
-- WHY THAT IS NOT THEORETICAL. Reproduced as a plain referrer at AAL2:
--   resolve_rates(branch, other_partner)  -> 0.2500 / 0.1000, another partner's
--                                            commission
--   hubspot_sync_partners()               -> every partner id, no arguments
--   deed_delivery_target(application)     -> an agent's email and name
--
-- And they compose. hubspot_sync_partners() hands out the partner ids;
-- hubspot_pending_events(p_partner, ...) takes one as a plain argument and
-- returns to_jsonb(a.*), the whole applications row: name, date of birth,
-- email, phone, address, rent. Two calls, any signed-in principal, another
-- partner's entire book.
--
-- Two of them are WRITES. hubspot_mark_cursor could advance another partner's
-- sync cursor past unprocessed events, dropping them silently; hubspot_mark_stuck
-- could park a partner as failed.
--
-- THE DISTINCTION THAT MATTERS, and the reason this is not a blanket sweep:
-- a definer function granted to `authenticated` is FINE when its body gates
-- itself. cron_health does exactly that, is_aal2() then is_admin(), and the
-- Health screen calls it from the browser as `authenticated`. Revoking that one
-- would have broken the screen and secured nothing. 72 other definer functions
-- are in the same position and are deliberately untouched. The defect is the
-- subset with NO gate and NO browser caller.
--
-- SAFE TO REVOKE. Every internal caller listed is itself SECURITY DEFINER, so
-- those chains run as the owner and never consult the caller's grants. Nothing
-- under src/ calls any of them; src/data/channel.ts is a deliberate TypeScript
-- mirror of application_channel, not an RPC.
-- ===========================================================================

revoke execute on function public.hubspot_pending_events(uuid, timestamptz, uuid, text[], integer) from authenticated;
revoke execute on function public.hubspot_sync_partners()                                          from authenticated;
revoke execute on function public.hubspot_stale_partners(interval)                                 from authenticated;
revoke execute on function public.hubspot_mark_cursor(uuid, timestamptz, uuid)                     from authenticated;
revoke execute on function public.hubspot_mark_stuck(uuid, text)                                   from authenticated;
revoke execute on function public.resolve_rates(uuid, uuid)                                        from authenticated;
revoke execute on function public.duplicate_agency_groups()                                        from authenticated;
revoke execute on function public.deed_delivery_target(uuid)                                       from authenticated;
revoke execute on function public.application_annual_income(uuid)                                  from authenticated;
revoke execute on function public.application_attribution(uuid)                                    from authenticated;
revoke execute on function public.effective_primary_contact_route(uuid, uuid)                      from authenticated;
revoke execute on function public.tenancy_group_prequalification(uuid)                             from authenticated;
revoke execute on function public.partner_reaches_agency(uuid, uuid)                               from authenticated;
revoke execute on function public.application_channel(uuid)                                        from authenticated;
revoke execute on function public.livemode_audit()                                                 from authenticated;
revoke execute on function public.address_history_months(uuid)                                     from authenticated;
revoke execute on function public.eligibility_fee_paid(uuid)                                       from authenticated;

-- ---------------------------------------------------------------------------
-- Assert both directions.
--
-- The second half is the one that matters. A careless revoke that also took
-- service_role would stop the HubSpot sync finding work, and it would fail
-- SILENTLY: the cron would run, find nothing, and report success forever.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_sigs text[] := array[
    'public.hubspot_pending_events(uuid, timestamptz, uuid, text[], integer)',
    'public.hubspot_sync_partners()',
    'public.hubspot_stale_partners(interval)',
    'public.hubspot_mark_cursor(uuid, timestamptz, uuid)',
    'public.hubspot_mark_stuck(uuid, text)',
    'public.resolve_rates(uuid, uuid)',
    'public.duplicate_agency_groups()',
    'public.deed_delivery_target(uuid)',
    'public.application_annual_income(uuid)',
    'public.application_attribution(uuid)',
    'public.effective_primary_contact_route(uuid, uuid)',
    'public.tenancy_group_prequalification(uuid)',
    'public.partner_reaches_agency(uuid, uuid)',
    'public.application_channel(uuid)',
    'public.livemode_audit()',
    'public.address_history_months(uuid)',
    'public.eligibility_fee_paid(uuid)'
  ];
begin
  foreach v_fn in array v_sigs loop
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'authenticated can still execute %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'anon can still execute %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'service_role lost %; the Edge Function that calls it would fail', v_fn;
    end if;
  end loop;

  -- The counter-example, held as an assertion so nobody "tidies" it later:
  -- cron_health MUST keep its grant, because the Health screen calls it from
  -- the browser and its body is the boundary.
  if not has_function_privilege('authenticated', 'public.cron_health()', 'execute') then
    raise exception 'cron_health lost its grant; the Health screen calls it from the browser and it gates itself';
  end if;
end $$;
