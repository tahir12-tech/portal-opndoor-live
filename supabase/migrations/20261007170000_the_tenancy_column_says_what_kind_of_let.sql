/* =====================================================================
   THE TENANCY COLUMN SAYS WHAT KIND OF LET, AND LINES READ IN REFERENCE
   ORDER.

   Matt, 2026-10-01, verbatim: "Commission statements (on screen, PDF
   and CSV, agency and supplier): list lines in guarantee reference
   order, lowest first. The Tenancy column shows 'Single' for one
   tenant, or 'Joint (2)', 'Joint (3)' and so on with the number of
   tenants on that tenancy, instead of '1 of 2' and '-'."

   FOUR PLACES SORTED FOUR WAYS before this: the monthly run by paid
   date, `supplier_statement_lines` by agency then date, the schedules
   by inheritance, and the screen by its own rule. A reader holding the
   PDF beside the page was comparing two orders of the same month. A
   reference is what a finance team reconciles by.

   Both functions regenerated from their last definitions
   (20261007050000 and 20261007060000), by script, with one substitution
   each asserted to match exactly once.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.commission_statement_lines(p_month date)
 RETURNS TABLE(payee_key text, level text, org_id uuid, org_name text, partner_id uuid, guarantee_ref text, tenant_name text, tenancy_place text, branch_name text, paid_on date, fee numeric, share_percent numeric, rate numeric, source text, commission numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_month)::date                         as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date  as m_next
  ),
  paid as (
    select a.*
    from public.applications a, bounds b
    where a.paid_at is not null
      and (a.paid_at at time zone 'Europe/London') >= b.m_start
      and (a.paid_at at time zone 'Europe/London') <  b.m_next
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.livemode is true
      /* DIRECT-RAIL BUSINESS IS NEVER THE MATCHED AGENCY'S. Round 6. The
         auto-matcher rewrites a direct application's branch_id and agency_id
         to a real agency so somebody can service it, while pinning partner_id
         to opndoor-direct. This function had no rail test at all -- the only
         money surface without one -- so that application became an
         agency-level PAYEE, and commission-statements posts the PDF and CSV
         to that agency's Directors. What stopped it firing was opndoor-direct's
         agent_rate being 0.0000, i.e. a number an admin can edit on the
         partner-settings screen.

         `<> 'Direct'` and NOT `= 'Agent referral'`: the digest was written the
         second way and silently dropped every supplier, which is round 6's M3
         in the same list of findings. */
      and public.application_channel(a.id) <> 'Direct'
  ),
  -- Named split_line, not line: `line` is a built-in geometric type name, and a
  -- CTE that shadows a type is a trap nobody needs to walk into.
  split_line as (
    -- The frozen split. basis_amount is what the rate was a share of, snapshotted
    -- at creation; the fee is the fallback for rows frozen before that column
    -- existed, and is the same number by construction.
    select p.id as application_id, l.level, l.org_id, l.org_name, l.rate, l.source,
           coalesce(l.basis_amount, p.fee_amount, p.monthly_rent, 0) as basis,
           l.amount as frozen_amount
    from paid p
    join public.application_commission_lines l on l.application_id = p.id
    /* NM-C 5. Matt, 2026-09-30: "for a supplier like Rightmove, Opndoor
       pays only the supplier; the supplier pays its own agents, so no
       agency commission line is created under a supplier referral unless
       the supplier's agreement says Opndoor pays agents directly."

       The frozen line still EXISTS -- it is the supplier's own record of
       what it owes that agency, and the per-agency schedules are built
       from exactly this arithmetic -- but it is not a thing OPNDOOR pays,
       so it is not a payee on Opndoor's statement run. Two different
       questions about one number, which is why the row is left alone and
       only this reader changes. */
    where not public.supplier_settles_its_own_agents(p.partner_id)
    union all
    -- No split: a historic row, whose money was always the referring agency's.
    select p.id, 'agency', p.agency_id, coalesce(ag.name, '(unknown agency)'),
           coalesce(p.agent_rate, 0), null,
           coalesce(p.fee_amount, p.monthly_rent, 0),
           -- No frozen line at all, so nothing to read: this arm keeps the old
           -- arithmetic, which is all it ever had.
           null::numeric
    from paid p
    left join public.agencies ag on ag.id = p.agency_id
    where not exists (
      select 1 from public.application_commission_lines l where l.application_id = p.id
    )
      -- NM-C 5 again. A supplier referral with no frozen split is still a
      -- supplier referral, and leaving this arm alone would have let the
      -- agency line back in through the one door the first fix did not
      -- close -- which is exactly how the direct rail got onto a statement.
      and not public.supplier_settles_its_own_agents(p.partner_id)
    union all
    /* THE SUPPLIER'S OWN CUT. Matt, 2026-09-30: "a supplier's Management
       users who have statements switched on receive their supplier's
       monthly commission statement, addressed to the supplier."

       IT HAS NEVER BEEN A STATEMENT PAYEE. Measured on dev before this was
       written: `application_commission_lines` holds `agency` rows and
       nothing else, and every payee the run has ever produced is at
       agency level. So this is a new DOCUMENT, not a new recipient for an
       existing one.

       THE DEFINITION IS NOT INVENTED HERE. It is the one every screen
       already uses and `our_margin_is_not_theirs.test.sql` already pins: a
       REAL supplier's `partner_rate` cut of the fee, and nothing on a
       house route, because a house route's partner cut is Opndoor's own
       margin and is owed to nobody. `liveAnalytics` says the same in
       `supplierCommNet`, guarded by the same `isHousePartner` test.

       THE SNAPSHOTTED RATE, `p.partner_rate`, not the partner's current
       one: the whole money model freezes the rate onto the application at
       creation and never recomputes it, and a statement that re-derived
       the rate would restate a month that has already been paid.

       ROUNDED ONCE, here, like the agency arm beside it. */
    /* THE TOTAL, NOT A SHARE OF IT. Matt, 2026-09-30: "Supplier
       commission is one total rate ... that total includes the agents'
       share ... Opndoor pays the whole total to the supplier, who pays
       its agents, unless the supplier's setting says Opndoor pays agents
       directly."

       So the rate here is the supplier's total when it settles its own
       agents, and the total LESS the carved-out agents' share when
       Opndoor pays them -- because in that case the agency arm above is
       producing the rest, and paying both in full would pay the agents
       twice. The two arms always sum to the total, which is the whole of
       "never more in total" and is asserted per referral. */
    select p.id, 'partner', p.partner_id, coalesce(pt2.name, '(unknown supplier)'),
           case when public.supplier_settles_its_own_agents(p.partner_id)
                then coalesce(p.partner_rate, 0)
                else coalesce(p.partner_rate, 0) - public.supplier_agent_rate(p.id)
           end,
           'partner_rate',
           coalesce(p.fee_amount, p.monthly_rent, 0),
           null::numeric
    from paid p
    join public.partners pt2 on pt2.id = p.partner_id
    where not public.is_house_partner_id(pt2.id)
      and case when public.supplier_settles_its_own_agents(p.partner_id)
               then coalesce(p.partner_rate, 0)
               else coalesce(p.partner_rate, 0) - public.supplier_agent_rate(p.id)
          end > 0
  )
  select
    -- Same shape as the client's payeeKey (partner slug, level, org), so a payee
    -- has one identity whichever side of the wire names it.
    coalesce(pt.slug, '') || '|' || l.level || ':'
      || coalesce(l.org_id::text, 'name/' || lower(btrim(l.org_name))),
    l.level, l.org_id, l.org_name, p.partner_id,
    p.guarantee_ref,
    btrim(coalesce(p.tenant_first_name, '') || ' ' || coalesce(p.tenant_last_name, '')),
    /* WHAT KIND OF LET, NOT WHICH TENANT. Matt, 2026-10-01: 'The
       Tenancy column shows "Single" for one tenant, or "Joint (2)",
       "Joint (3)" and so on with the number of tenants on that tenancy,
       instead of "1 of 2" and "-".'

       It printed the tenant's POSITION, which on a commission statement
       is of no interest: the payee is reconciling money and needs to
       know whether this fee is a whole let or a share of a joint one.
       "2 of 3" made them work out that there are two more lines
       somewhere; "Joint (3)" says it.

       NO TENANCY ROW MEANS SINGLE. A solo let has no tenancy_id at all,
       which is the common case, and it printed a hyphen. It is a single
       tenancy and now says so. */
    case
      when p.tenancy_id is null then 'Single'
      else (
        select case when count(*) <= 1 then 'Single'
                    else 'Joint (' || count(*)::text || ')' end
          from public.applications s where s.tenancy_id = p.tenancy_id
      )
    end,
    coalesce(br.name, ''),
    (p.paid_at at time zone 'Europe/London')::date,
    l.basis, p.share_percent, l.rate, l.source,
    -- THE FROZEN AMOUNT, and round(basis * rate) only for a row frozen before
    -- that column existed. Computing it here per line is the defect: two lines of
    -- one tenancy could each round up and sum to a penny more than the tenancy's
    -- own commission.
    coalesce(l.frozen_amount, round(l.basis * l.rate, 2))
  from split_line l
  join paid p on p.id = l.application_id
  left join public.branches br on br.id = p.branch_id
  left join public.partners pt on pt.id = p.partner_id
$function$;

create or replace function public.supplier_statement_lines(p_partner uuid, p_month date)
returns table(
  application_id uuid,
  guarantee_ref text,
  agency_id uuid,
  agency_name text,
  branch_name text,
  tenant_name text,
  paid_on date,
  fee numeric,
  total_rate numeric,
  agent_rate numeric,
  total_amount numeric,
  agent_amount numeric,
  supplier_amount numeric
)
language sql
stable security definer
set search_path to ''
as $function$
  with bounds as (
    select date_trunc('month', p_month)::date                        as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_next
  ),
  paid as (
    select a.*
    from public.applications a, bounds b
    where a.partner_id = p_partner
      and a.paid_at is not null
      and (a.paid_at at time zone 'Europe/London') >= b.m_start
      and (a.paid_at at time zone 'Europe/London') <  b.m_next
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.livemode is true
      and public.application_channel(a.id) <> 'Direct'
  )
  select
    p.id,
    p.guarantee_ref,
    p.agency_id,
    coalesce(ag.name, '(unknown agency)'),
    coalesce(br.name, ''),
    btrim(coalesce(p.tenant_first_name, '') || ' ' || coalesce(p.tenant_last_name, '')),
    (p.paid_at at time zone 'Europe/London')::date,
    coalesce(p.fee_amount, p.monthly_rent, 0),
    coalesce(p.partner_rate, 0),
    public.supplier_agent_rate(p.id),
    /* ROUNDED ONCE EACH, AND THE SUPPLIER'S SHARE IS A SUBTRACTION.
       Computing the supplier's share as basis * (total - agent) would let
       the three numbers disagree by a penny: round(a) + round(b) is not
       round(a+b). The total is the number Opndoor pays and is rounded
       first; the agent's share is rounded next; the supplier gets what is
       left, so the two always add to the total exactly. */
    round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2),
    round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2),
    round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
      - round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2)
  from paid p
  left join public.agencies ag on ag.id = p.agency_id
  left join public.branches br on br.id = p.branch_id
  /* GUARANTEE REFERENCE ORDER, LOWEST FIRST, the same as the agency
     statement. Matt, 2026-10-01. It was agency, then paid date, then
     reference, so the supplier's own statement and the agency statement
     beside it read in two different orders. The per-agency schedules
     are built by filtering these rows, so they inherit it. */
  order by p.guarantee_ref
$function$;
