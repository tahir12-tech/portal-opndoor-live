/* =====================================================================
   TWO DEAL SHAPES, AND THE SWITCH CHOOSES WHICH.

   Matt, 2026-10-01, verbatim: "Supplier Commission tab, two deal shapes
   chosen by the 'Opndoor pays the agents directly' switch. Off (paid
   through the supplier): one total commission, all paid to the supplier,
   which settles with its agents; the agents' share sits within that total
   and is only used for the per-agency statements. On (paid directly by
   Opndoor): the supplier's own commission and the agents' commission are
   separate deals, each can be flat or tiered, and Opndoor pays each party
   its own; the total is the sum. The plain-English summary explains
   whichever applies. Statements follow: off, one supplier statement plus
   per-agency schedules for them to forward; on, the supplier is paid its
   own share and each agency gets its own statement from Opndoor."

   =====================================================================
   WHAT ACTUALLY CHANGES, WHICH IS LESS THAN IT SOUNDS
   =====================================================================

   The model already had both payees and already had the switch. What it
   did not have was two MEANINGS for `partner_rate`. It had one:

     partner_rate is THE TOTAL, always.

   and the ON shape was expressed by subtracting the agents' share out of
   it, so the two payees summed to the total. Matt's ON shape is not that:
   the two deals are siblings, Opndoor pays each party its own, and the
   total is the SUM of them. So:

     OFF   partner_rate is the total. The supplier is paid all of it and
           settles its own agents. agent_rate is a carve-out, used for the
           per-agency schedules and for nothing Opndoor pays. UNCHANGED.

     ON    partner_rate is the SUPPLIER'S OWN. agent_rate is the
           agencies'. Opndoor pays each in full. The total is the sum.

   Every arm that read `partner_rate - supplier_agent_rate` was computing
   the old ON shape, and each of them becomes plain `partner_rate`.

   =====================================================================
   NOTHING ON DEV IS REPRICED BY THIS, MEASURED BEFORE WRITING IT
   =====================================================================

   Every non-house partner on dev -- harbour-lets, kestrel-lettings,
   letly, test-supplier -- has `opndoor_pays_agents = false` and ZERO paid
   applications. The ON arm prices nothing today, so changing what it
   means cannot restate a month that has already been settled. The OFF arm
   is left alone to the penny, which is the arm every live figure comes
   from.

   And the rates are FROZEN onto the application at creation, so even a
   supplier switched to ON tomorrow reprices only referrals taken after
   the switch. That is "new referrals only", and it is a property of the
   freeze, not of this file.

   Tests: supabase/tests/two_deal_shapes_not_one.test.sql
   ===================================================================== */

-- ---------------------------------------------------------------------------
-- 1. THE AGENTS' RATE IS ONLY CAPPED WHERE IT IS A CARVE-OUT.
-- ---------------------------------------------------------------------------
--
-- `least(agent_rate, partner_rate)` is the OFF shape's rule and reads as
-- arithmetic hygiene until you ask what it means under ON: there the two are
-- separate deals, and an agents' commission larger than the supplier's own is
-- a perfectly ordinary arrangement -- a supplier on 5% introducing agencies on
-- 20%. Capping it would silently pay the agencies the supplier's rate.
--
-- Under OFF the cap stays, and it is not redundant with the save-time guard:
-- the guard checks the DEALS, and a supplier priced by the flat pair has no
-- deal to check. This is the last line before the money.

create or replace function public.supplier_agent_rate(p_app uuid)
returns numeric
language sql
stable security definer
set search_path to ''
as $function$
  select case
    when public.supplier_settles_its_own_agents(a.partner_id)
      /* A CARVE-OUT CANNOT BE BIGGER THAN WHAT IT IS CARVED FROM. */
      then least(coalesce(a.agent_rate, 0), coalesce(a.partner_rate, 0))
      /* SIBLINGS. The agencies' deal stands on its own. */
      else coalesce(a.agent_rate, 0)
  end
  from public.applications a
  where a.id = p_app
$function$;

comment on function public.supplier_agent_rate(uuid) is
  'The agents'' rate on one application. Capped at the supplier''s own rate where the supplier settles its own agents, because there the share is carved out of the total. Uncapped where Opndoor pays the agents directly, because there the two deals are siblings and the total is their sum.';

-- ---------------------------------------------------------------------------
-- 2. THE SUPPLIER IS PAID ITS OWN, NOT THE TOTAL LESS THE AGENTS'.
-- ---------------------------------------------------------------------------
--
-- Regenerated from 20261007170000's definition BY SCRIPT, with two
-- substitutions each asserted to match exactly once -- the rate and the
-- `> 0` test that repeats it. Not retyped: I retyped it first and got four
-- things wrong (the CTE's name, the tenancy-place subquery, share_percent's
-- source and one join's outerness), none of which the typechecker or a
-- cursory read would catch. The rule in this repo exists for that reason.
--
-- Under ON the agency arm above already pays the agencies in full; the
-- supplier arm now pays the supplier in full beside it, and the two sum to
-- the total rather than dividing it.

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
           /* THE SUPPLIER'S OWN, AND NOW IT IS ITS OWN UNDER BOTH SHAPES.
              This read `partner_rate - supplier_agent_rate` under ON because
              the old model had partner_rate meaning the total in both shapes
              and DIVIDED it between the two payees. Matt's ON shape sums:
              "the supplier's own commission and the agents' commission are
              separate deals ... Opndoor pays each party its own; the total
              is the sum." Under OFF partner_rate is still the whole total
              and there is no agency payee beside it. */
           coalesce(p.partner_rate, 0),
           'partner_rate',
           coalesce(p.fee_amount, p.monthly_rent, 0),
           null::numeric
    from paid p
    join public.partners pt2 on pt2.id = p.partner_id
    where not public.is_house_partner_id(pt2.id)
      and coalesce(p.partner_rate, 0) > 0
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

-- ---------------------------------------------------------------------------
-- 3. THE SUPPLIER'S OWN STATEMENT, UNDER BOTH SHAPES.
-- ---------------------------------------------------------------------------
--
-- The three money columns mean different things under the two shapes and the
-- penny has to land in a different place in each, so the arithmetic forks
-- rather than being parameterised:
--
--   OFF  total is what Opndoor pays. Round the total first, round the
--        agents' carve-out next, and the supplier gets WHAT IS LEFT, so the
--        two always add to the total exactly. (Unchanged, to the penny.)
--
--   ON   Opndoor pays each party its own, so each is the number that must be
--        right: round the supplier's, round the agents', and the total is
--        their SUM. Rounding the total first would make it disagree with the
--        two payments it is supposed to describe.
--
-- In both the three columns reconcile; which one is derived is the whole
-- difference, and it follows who is actually being paid.

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
    /* THE TOTAL RATE, WHICH IS NOT THE SAME NUMBER UNDER THE TWO SHAPES.
       Carved (the supplier settles its own agents): partner_rate IS the
       total, and the agents' share sits inside it. Siblings (Opndoor pays
       the agents directly): "the total is the sum". */
    case when public.supplier_settles_its_own_agents(p.partner_id)
         then coalesce(p.partner_rate, 0)
         else coalesce(p.partner_rate, 0) + public.supplier_agent_rate(p.id)
    end,
    public.supplier_agent_rate(p.id),
    /* ROUNDED ONCE EACH, AND WHICH ONE IS DERIVED FOLLOWS WHO IS PAID.
       Computing a share as basis * (total - agent) would let the three
       numbers disagree by a penny: round(a) + round(b) is not round(a+b).
       So one of the three is always the remainder of the other two, and it
       has to be the one nobody is actually paid:

         carved    the TOTAL is what Opndoor pays. Round it first, round
                   the agents' carve-out next, and the supplier gets what
                   is left. (Unchanged, to the penny.)
         siblings  each party's OWN is what Opndoor pays, so each must be
                   right; the total is their sum. Rounding the total first
                   would make it disagree with the two payments it
                   describes. */
    case when public.supplier_settles_its_own_agents(p.partner_id)
         then round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
         else round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
            + round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2)
    end,
    round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2),
    case when public.supplier_settles_its_own_agents(p.partner_id)
         then round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
            - round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2)
         else round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
    end
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

comment on function public.supplier_statement_lines(uuid, date) is
  'One supplier''s paid referrals for a month, with the total, the agents'' share and the supplier''s own. Where the supplier settles its own agents the total is what Opndoor pays and the supplier''s own is the remainder; where Opndoor pays the agents directly each party''s own is what Opndoor pays and the total is their sum.';

-- ---------------------------------------------------------------------------
-- 4. THE SHARE-WITHIN-TOTAL GUARD IS AN OFF-SHAPE RULE.
-- ---------------------------------------------------------------------------
--
-- "The agents' share can never exceed the supplier's total on any referral"
-- was Matt's rule a message earlier, and the message after it says what that
-- rule was ABOUT: a share that "sits within that total". Under ON there is no
-- total for it to sit within -- the total is the sum of the two -- so there is
-- nothing to exceed, and the guard would refuse a supplier on 5% introducing
-- agencies on 20%, which is an ordinary arrangement and the reason the ON
-- shape exists.
--
-- NARROWED HERE, IN THE FINDER, rather than at the two call sites. The finder
-- is what "is this supplier in breach" means, and a rule that is only a rule
-- under one shape should stop being true rather than stop being checked: a
-- third caller added later gets the right answer without knowing any of this.

create or replace function public.supplier_share_breaches(p_partner uuid)
returns table(tenants integer, volume integer, total_rate numeric, share_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with deals as (
    select
      public.active_agreement_of_kind('partner', p_partner, 'commission')  as total_id,
      public.active_agreement_of_kind('partner', p_partner, 'agent_share') as share_id
  ),
  tenant_points as (
    select distinct b.min_tenants as n
    from public.pricing_agreement_bands b, deals d
    where b.agreement_id in (d.total_id, d.share_id)
    union select 1
  ),
  volume_points as (
    select distinct t.from_count as v
    from public.commission_tiers t, deals d
    where t.agreement_id in (d.total_id, d.share_id)
    union select 0
  )
  select tp.n, vp.v,
         public.agreement_rate_at((select total_id from deals), tp.n, vp.v),
         public.agreement_rate_at((select share_id from deals), tp.n, vp.v)
  from tenant_points tp, volume_points vp, deals d
  /* THE SHAPE FIRST. Where Opndoor pays the agents directly the two deals
     are siblings and neither bounds the other, so there is no breach to
     find and the whole question is skipped. */
  where public.supplier_settles_its_own_agents(p_partner)
    and d.share_id is not null
    and d.total_id is not null
    and public.agreement_rate_at(d.share_id, tp.n, vp.v) is not null
    and public.agreement_rate_at(d.total_id, tp.n, vp.v) is not null
    and public.agreement_rate_at(d.share_id, tp.n, vp.v)
      > public.agreement_rate_at(d.total_id, tp.n, vp.v)
  order by tp.n, vp.v
$function$;

comment on function public.supplier_share_breaches(uuid) is
  'Every tenant count and volume at which a supplier''s agents'' share would be more than the supplier''s own commission. Empty is the healthy answer, and it is always empty where Opndoor pays the agents directly, because there the two deals are siblings and the total is their sum rather than something the share sits inside.';
