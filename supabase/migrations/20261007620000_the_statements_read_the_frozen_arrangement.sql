/* =====================================================================
   THE STATEMENTS AND THE SETTLEMENT READ THE FROZEN ARRANGEMENT.

   Steps 2 and 3 of the four Matt approved on 2026-10-03. Step 1
   (20261007610000) snapshotted `opndoor_pays_agents_at_freeze` onto every
   supplier-estate application. This makes the two SQL readers ask it
   instead of asking the partner's live flag.

   NEITHER ARITHMETIC CHANGES. `supplier_statement_lines` already
   implements both shapes correctly and comments them well -- carved
   against siblings, and which of the three figures is the remainder.
   `commission_statement_lines` already knows a supplier-estate agency
   line is sometimes Opndoor's to pay and sometimes not. The only fault in
   either was WHICH FLAG decides, and the answer was a mutable column on
   `partners` that has already moved twice under live referrals.

   WHAT IT MEANT ON DEV. GR-FROST-KES was frozen under "opndoor pays the
   agents" and Kestrel's live flag now says the opposite, so:

     supplier_statement_lines    said total 600, agent 240, supplier 360.
                                 Should be total 840, agent 240,
                                 supplier 600.
     commission_statement_lines  omitted Kestrel's Frost as a payee, so
                                 September's run owed 600 where it owes
                                 840.

   Reporting, which reads no flag at all and always adds, had 840 and was
   right by luck. That is step 4, in the client.

   NO FROZEN AMOUNT IS TOUCHED. The 240 and the 600 in
   application_commission_lines are correct and unchanged. What changes is
   that three readers stop disagreeing about how to combine them.
   ===================================================================== */

/* ONE FACT, ONE PLACE. Both readers below have the application row to
   hand, so this takes the two values rather than an id: a per-row
   subquery on a function that would re-read the row it was handed is a
   cost for nothing, and passing the values keeps the DECISION in one
   place, which is the part that must not drift.

   NOT SECURITY DEFINER. It reads no table of its own; the partner lookup
   in the fallback is inside `supplier_settles_its_own_agents`, which is
   definer and already allow-listed. A definer wrapper here would widen
   the surface to buy nothing.

   THE FALLBACK IS THE LIVE FLAG, for a row the snapshot does not answer
   for: anything off a supplier estate, where there is no supplier and no
   arrangement, and any historic row a future backfill misses. Behaviour
   for those is exactly what it was before this migration, which is what
   makes this change safe to apply to a database whose history we have not
   inspected. */
create or replace function public.settles_its_own_agents_frozen(
  p_frozen boolean, p_partner uuid
) returns boolean language sql stable set search_path = '' as $$
  select case
           when p_frozen is not null then not p_frozen
           else public.supplier_settles_its_own_agents(p_partner)
         end
$$;

comment on function public.settles_its_own_agents_frozen(boolean, uuid) is
  'Did the supplier settle its own agents, as frozen onto this application? Reads applications.opndoor_pays_agents_at_freeze, falling back to the partner''s live flag for a row with no snapshot. Every money reader asks this rather than partners.opndoor_pays_agents, because that column is mutable and has changed under live referrals.';

/* =====================================================================
   STEP 2. THE SUPPLIER'S OWN STATEMENT.

   Four call sites, all the same swap: the condition that chose between
   carved and siblings. The arithmetic under each arm is character for
   character what it was.
   ===================================================================== */
create or replace function public.supplier_statement_lines(p_partner uuid, p_month date)
returns table(application_id uuid, guarantee_ref text, agency_id uuid, agency_name text,
              branch_name text, tenant_name text, paid_on date, fee numeric,
              total_rate numeric, agent_rate numeric, total_amount numeric,
              agent_amount numeric, supplier_amount numeric)
language sql stable security definer set search_path = '' as $$
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
       the agents directly): "the total is the sum".

       AS FROZEN, since 20261007620000. This asked the partner's live flag,
       so a supplier whose arrangement an admin changed had every past
       month's statement rewritten under the new shape. */
    case when public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
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
                   is left.
         siblings  each party's OWN is what Opndoor pays, so each must be
                   right; the total is their sum. Rounding the total first
                   would make it disagree with the two payments it
                   describes. */
    case when public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
         then round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
         else round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
            + round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2)
    end,
    round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2),
    case when public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
         then round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
            - round(coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id), 2)
         else round(coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0), 2)
    end
  from paid p
  left join public.agencies ag on ag.id = p.agency_id
  left join public.branches br on br.id = p.branch_id
  /* GUARANTEE REFERENCE ORDER, LOWEST FIRST, the same as the agency
     statement. The per-agency schedules are built by filtering these
     rows, so they inherit it. */
  order by p.guarantee_ref
$$;

/* =====================================================================
   STEP 3. THE SETTLEMENT RUN.

   Two gates, both asking the same question -- "is this supplier-estate
   agency line Opndoor's to pay" -- and both asking it of the partner's
   live flag. One covers the frozen split, the other the historic arm with
   no split, and the comment on the second says why leaving it alone would
   have let the line back in through the one door the first fix did not
   close. The same is true of this change, which is why both move
   together.

   WHAT IT DOES TO SEPTEMBER ON DEV. GR-FROST-KES was frozen under
   "opndoor pays the agents", so Kestrel's Frost Partnership becomes a
   payee at GBP 240 beside Kestrel's GBP 600. The month's run goes from
   GBP 600 to GBP 840 on that route, which is the figure Reporting has
   been showing and the one Matt confirmed.

   THE REST OF THE FUNCTION IS CHARACTER FOR CHARACTER WHAT IT WAS. It is
   reproduced here from the deployed definition with the two conditions
   swapped and nothing else touched, because retyping a hundred lines of
   money arithmetic to change two of them is how a transcription error
   gets into a statement.
   ===================================================================== */
CREATE OR REPLACE FUNCTION public.commission_statement_lines(p_month date)
 RETURNS TABLE(payee_key text, level text, org_id uuid, org_name text, partner_id uuid, guarantee_ref text, tenant_name text, tenancy_place text, branch_name text, paid_on date, fee numeric, share_percent numeric, rate numeric, source text, commission numeric)
language sql stable security definer set search_path = '' as $$
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
    /* THE AGENCY SIDE ONLY. 20261007580000 added a 'supplier' level, so
       application_commission_lines now holds Opndoor's debt to a supplier
       as well as its debt to an agency. This function builds the AGENT
       statement run and every row it returns becomes a payee on it, so a
       supplier line here would put the supplier on the agency statement.
       The supplier is paid on its own statement, from the same stored
       amount, which is the whole point of storing it. */
    and l.level in ('group', 'agency', 'branch')
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
    where not public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
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
      -- The same filter, for the same reason: an application carrying ONLY a
      -- supplier line has no agency split, so it still takes this historic arm.
      select 1 from public.application_commission_lines l
       where l.application_id = p.id and l.level in ('group', 'agency', 'branch')
    )
      -- NM-C 5 again. A supplier referral with no frozen split is still a
      -- supplier referral, and leaving this arm alone would have let the
      -- agency line back in through the one door the first fix did not
      -- close -- which is exactly how the direct rail got onto a statement.
      and not public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
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
$$;
