/* =====================================================================
   A MISSING COMMISSION DEAL IS LOUD.

   Matt, 2026-10-03: "Make a missing deal loud, not silent: when a
   referral is created for a supplier with no commission deal set (rates
   null, coalesced to 0), raise an ops alert once per supplier and show it
   on Health and the supplier's Overview ('Referrals are coming in with no
   commission deal set'). A deliberate 0% deal like Letly's must not
   alert."

   THIS IS THE OTHER HALF OF 20261007680000. That migration stopped "Add
   supplier" inventing a 25% deal, and gave `resolve_rates` a final
   coalesce to 0 so a dealless supplier's referrals are recorded rather
   than refused on `applications.partner_rate`'s NOT NULL -- refusing them
   is an After-launch item. The cost of not refusing is silence: the
   referral is created, the statement shows nothing owed, and the first
   person to notice is the supplier. This is what replaces that silence.

   "NOTHING RESOLVED" IS THE TEST, NOT "THE ANSWER WAS 0". Letly is on
   0.00 / 0.00 WITH a commission agreement: a deal of nothing, agreed.
   That must never alert, and it is the reason this cannot simply watch
   for a zero rate. `has_no_commission_deal` is the resolve chain with the
   final coalesce taken off, so it is true exactly when `resolve_rates`
   fell through to the fallback and false for every rate anybody set,
   including zero.
   ===================================================================== */

create or replace function public.has_no_commission_deal(
  p_branch uuid, p_route_partner uuid, p_tenant_count integer default 1
) returns boolean language sql stable security definer set search_path = '' as $$
  /* `resolve_rates`'s own precedence -- agreement, agency, group, partner
     -- with the `, 0` that 20261007680000 added taken off the end. True
     means nothing was set anywhere and the referral took the fallback.

     THE COMMISSION SIDE ONLY. The agents' share is a slice of a deal; if
     there is no deal there is nothing for it to be a slice of, and a
     supplier with a share but no total is a different fault with a
     different sentence. */
  select coalesce(
           (select r.agent_rate from public.resolve_pricing_agreement(
              p_branch, p_route_partner, p_tenant_count, 'commission') r
             where r.scope_level = 'partner'),
           a.partner_rate, g.partner_rate, p.partner_rate) is null
    from public.partners p
    left join public.branches b on b.id = p_branch
    left join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
   where p.id = p_route_partner
$$;

comment on function public.has_no_commission_deal(uuid, uuid, integer) is
  'True when no commission rate resolves for this branch and route partner at all: no partner-scope agreement, no agency or group override, and a null partner_rate. This is "nobody has agreed terms", NOT "the rate is zero" -- a deliberate 0% deal answers false.';

/* =====================================================================
   THE LATCH, SO IT IS ONCE PER SUPPLIER AND NOT ONCE PER REFERRAL.

   `report_ops_incident` dedupes on (alert_type, application_id,
   hour_bucket), which is once an hour per APPLICATION -- so a supplier
   taking ten referrals an hour would send ten alerts, and the same ten
   again next hour. Matt asked for once per supplier, and the HubSpot
   instruction on the same day asks the same thing in the general case:
   "the alert fires once per failing record, not every run".

   A ROW HERE IS "WE HAVE TOLD SOMEBODY ABOUT THIS SUPPLIER". It is
   removed as soon as a deal exists, so a supplier that loses its deal
   later alerts again -- "not again until it changes or recovers".
   ===================================================================== */
create table if not exists public.supplier_no_deal_alerts (
  partner_id uuid primary key references public.partners(id) on delete cascade,
  first_application_id uuid references public.applications(id) on delete set null,
  alerted_at timestamptz not null default now()
);

comment on table public.supplier_no_deal_alerts is
  'One row per supplier we have already alerted about having no commission deal. Exists only to keep the alert to once per supplier; the SCREENS do not read it, they derive the condition, so deleting a row re-arms the alert and shows nothing different.';

alter table public.supplier_no_deal_alerts enable row level security;
/* NO POLICY, DELIBERATELY. RLS on with no policy denies every browser
   role outright, which is right: this is alerting bookkeeping and no
   screen reads it. The definer functions below reach it as owner. */

/* =====================================================================
   THE TRIGGER, ON THE ONE CHOKEPOINT.

   AFTER INSERT on `applications` rather than inside `create_referral`,
   because there are four ways in -- create_referral, create_joint_referral,
   create_referral_api and a direct insert -- and a check in one of them
   is a check three paths skip. Matt asked for the portal and the API; this
   is both and anything else.

   AFTER, not BEFORE: the row must exist before it can be named in the
   alert, and nothing here may change what is written.
   ===================================================================== */
create or replace function public.alert_on_missing_commission_deal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_new boolean; v_name text; v_slug text;
begin
  /* SUPPLIERS ONLY. On the agency rail `partner_rate` is Opndoor's own
     margin and on the direct rail there is no supplier at all; neither has
     a deal to be missing. */
  if not coalesce(public.is_supplier_estate(new.partner_id), false) then
    return null;
  end if;
  if not coalesce(public.has_no_commission_deal(new.branch_id, new.partner_id, 1), false) then
    return null;
  end if;

  /* RE-ARMED FOR ANYBODY WHO NOW HAS A DEAL. Lazy, here, rather than two
     more triggers on `partners` and `pricing_agreements`: this table holds
     a handful of rows at most, and doing it where the condition is already
     being evaluated means the cleanup cannot drift from the test. */
  delete from public.supplier_no_deal_alerts a
   where a.partner_id <> new.partner_id
     and (exists (select 1 from public.partners p
                   where p.id = a.partner_id and p.partner_rate is not null)
          or exists (select 1 from public.pricing_agreements pa
                      where pa.scope_level = 'partner' and pa.scope_id = a.partner_id
                        and pa.kind = 'commission' and pa.ended_at is null));

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

create trigger applications_alert_missing_deal
  after insert on public.applications
  for each row execute function public.alert_on_missing_commission_deal();

/* =====================================================================
   AND WHAT THE SCREENS READ, which is DERIVED and not the latch.

   Health and the supplier's Overview show the condition as it is now, so
   clearing an alert row changes nothing they display and setting a deal
   makes the warning go away on its own. The latch governs the email; this
   governs the screens; neither can tell the other a different story
   because only one of them is a fact about the world.
   ===================================================================== */
create or replace function public.suppliers_with_no_commission_deal()
returns table(partner_id uuid, slug text, name text, referrals bigint,
              first_referral_at timestamptz, last_referral_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.slug, p.name,
         count(a.id),
         min(a.created_at),
         max(a.created_at)
    from public.partners p
    join public.applications a on a.partner_id = p.id
   where public.is_admin()
     and p.partner_kind = 'supplier'
     and p.partner_rate is null
     and not exists (
       select 1 from public.pricing_agreements pa
        where pa.scope_level = 'partner' and pa.scope_id = p.id
          and pa.kind = 'commission' and pa.ended_at is null)
   group by p.id, p.slug, p.name
   order by count(a.id) desc, p.name
$$;

comment on function public.suppliers_with_no_commission_deal() is
  'Suppliers that have taken at least one referral and have no commission deal: no partner-scope agreement and a null partner_rate. Admin only. Derived, so a supplier drops off it the moment a deal is set.';

revoke all on function public.has_no_commission_deal(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.has_no_commission_deal(uuid, uuid, integer)
  to service_role;

revoke all on function public.alert_on_missing_commission_deal()
  from public, anon, authenticated;

revoke all on function public.suppliers_with_no_commission_deal()
  from public, anon;
grant execute on function public.suppliers_with_no_commission_deal()
  to authenticated, service_role;
