/* =====================================================================
   THE NO-DEAL LATCH IS RE-ARMED WHEREVER THE TRIGGER FIRES.

   20261007690000 put the "anybody who now has a deal is re-armed" sweep
   AFTER the two early returns, so it only ran when the inserting
   supplier ITSELF had no deal. Its own pgTAP file caught it:

     not ok 10 - and the latch is cleared once that supplier has a deal

   WHY THAT MATTERS AND IS NOT COSMETIC. A stale latch is harmless while
   the supplier has a deal, because the trigger returns before reaching
   it. It stops being harmless the day that supplier LOSES its deal: the
   next referral finds no deal, tries to latch, hits the stale row, and
   nobody is told. The alert would be silently spent on an episode that
   ended months earlier -- which is the exact failure this whole pair of
   migrations exists to remove.

   SO THE SWEEP GOES FIRST, before anything can return. It matches only
   partners that DO have a deal, so it can never clear a latch that is
   still doing its job, and the table holds a handful of rows.

   The `<> new.partner_id` guard goes with it: it was there because the
   sweep ran after the check and the inserting partner was known to have
   no deal. Run first, the inserting partner is just another row, and
   excluding it would leave the commonest recovery -- a supplier getting
   a deal and then referring again -- to be cleaned up by somebody else.
   ===================================================================== */
create or replace function public.alert_on_missing_commission_deal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_new boolean; v_name text; v_slug text;
begin
  /* RE-ARMED FOR ANYBODY WHO NOW HAS A DEAL, before any early return.
     Lazy, here, rather than two more triggers on `partners` and
     `pricing_agreements`: doing it where the condition is already being
     evaluated means the cleanup cannot drift from the test. */
  delete from public.supplier_no_deal_alerts a
   where exists (select 1 from public.partners p
                  where p.id = a.partner_id and p.partner_rate is not null)
      or exists (select 1 from public.pricing_agreements pa
                  where pa.scope_level = 'partner' and pa.scope_id = a.partner_id
                    and pa.kind = 'commission' and pa.ended_at is null);

  /* SUPPLIERS ONLY. On the agency rail `partner_rate` is Opndoor's own
     margin and on the direct rail there is no supplier at all; neither
     has a deal to be missing. */
  if not coalesce(public.is_supplier_estate(new.partner_id), false) then
    return null;
  end if;
  if not coalesce(public.has_no_commission_deal(new.branch_id, new.partner_id, 1), false) then
    return null;
  end if;

  insert into public.supplier_no_deal_alerts (partner_id, first_application_id)
  values (new.partner_id, new.id)
  on conflict (partner_id) do nothing;
  get diagnostics v_new = row_count;
  if not v_new then return null; end if;

  select p.name, p.slug into v_name, v_slug from public.partners p where p.id = new.partner_id;
  perform public.report_ops_incident(
    'supplier_no_commission_deal',
    format('%s (%s) has no commission deal set, and referrals are coming in: %s is priced at 0%% and nothing will be owed to them. Set a deal on the supplier''s Commission tab.',
           coalesce(v_name, '(unnamed supplier)'), coalesce(v_slug, '?'), new.guarantee_ref),
    new.id);
  return null;
exception when others then
  /* BEST EFFORT, LIKE report_ops_incident ITSELF. An alert that cannot be
     raised must never stop a referral being created: the referral is the
     business and this is the warning about it. */
  return null;
end $$;
