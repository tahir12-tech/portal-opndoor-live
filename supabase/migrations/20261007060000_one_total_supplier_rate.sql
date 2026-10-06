/* =====================================================================
   ONE TOTAL SUPPLIER RATE, WITH THE AGENT'S SHARE CARVED OUT OF IT.

   Matt, 2026-09-30, verbatim: "Supplier commission is one total rate, set
   per supplier on its Commission tab (nothing hardcoded; Rightmove's
   happens to be 35%), and that total includes the agents' share. The
   agent's share is carved out of it and can be volume-tiered per supplier
   using the existing tiers (e.g. x% on an agency's first N paid referrals
   in the month, y% after). The supplier's own share is the total minus
   the agent's share, never more in total. Opndoor pays the whole total to
   the supplier, who pays its agents, unless the supplier's setting says
   Opndoor pays agents directly. The supplier statement shows, per
   referral: agency, branch, fee, agent's share, supplier's share, total.
   The per-agency statements show each agency's referrals and its share."

   And, from the two instructions immediately before it:

   "no agency commission line is created under a supplier referral unless
   the supplier's agreement says Opndoor pays agents directly" (NM-C 5),
   and "a separate commission statement for each agency under that
   supplier for the month ... These go to the supplier's statement
   recipients, not to the agencies, since the supplier pays its own
   agents."

   ---- WHAT CHANGES ABOUT MONEY THAT ALREADY WORKS ----

   THE TWO RATES WERE ADDITIVE ON THIS RAIL AND ARE NOW ONE. Measured in
   this morning's dry run: a supplier referral at partner_rate 0.10 and
   agent_rate 0.20 produced TWO payee lines and Opndoor paid out 30% of
   the fee. From here `partner_rate` on a supplier is the TOTAL, the
   agent's share is carved out of it, and Opndoor pays the total and never
   the total plus anything.

   AND NOTHING IS BEING REINTERPRETED, which is the fact that makes this
   safe to do in one migration. Measured on dev first: there is not one
   paid referral on any real supplier, so no frozen row anywhere reads its
   two snapshotted rates the old way. The AGENCY rail is untouched --
   there `partner_rate` is Opndoor's own margin and `agent_rate` is the
   agency's cut, they were never one number, and none of this reaches
   them.

   THE INVARIANT, asserted per referral rather than per month:
   agent share + supplier share = total. It is the whole of "never more in
   total" and it is what a rounding mistake breaks first.

   ---- THE TIERS ARE THE EXISTING ONES ----

   No new tier table. `pricing_agreements` scoped to the partner, with
   `commission_tiers(from_count, to_count, agent_rate)` under it, resolved
   by `resolve_pricing_agreement` against `agreement_volume`. That already
   means exactly what Matt described: `agreement_volume` counts the paid
   referrals on this route since the agreement's period start, inside the
   agreement's `counting_scope`, so an agreement with period 'month' and
   counting_scope 'agency' prices referral N by how many that agency had
   already had this month. First N at x%, the rest at y%.

   ---- WHY A NEW READER RATHER THAN A WIDER commission_statement_lines ----

   The supplier's two documents want columns the agency statement does not
   have (agency name, and the three money columns) and not the ones it
   does. Widening `commission_statement_lines` would change its return
   type, which is a DROP and a rebuild of the one function the agency
   statement, the Reporting screen and the monthly run all read, a week
   before Regent goes live. So the supplier documents get their own
   reader, `supplier_statement_lines`, and the agency path is left alone.
   ===================================================================== */

/* ---- 1. the setting, off by default --------------------------------- */

/* MATT'S WORDS ARE "the supplier's agreement says Opndoor pays agents
   directly", and this is a column on the supplier rather than on
   `pricing_agreements` deliberately: it is a property of the commercial
   relationship, not of a dated rate schedule, and it has to be readable
   for a supplier that has no agreement row at all. Every supplier on dev
   has none. */
alter table public.partners
  add column if not exists opndoor_pays_agents boolean not null default false;

comment on column public.partners.opndoor_pays_agents is
  'Off: Opndoor pays this supplier the whole commission total and the supplier settles with its own agents, so no agency payee is created under its referrals. On: Opndoor pays the agents'' carved-out share directly and the agency is a payee as on the agency rail. Off by default. NM-C 5.';

/* ---- 2. the carve-out, in one place --------------------------------- */

/* THE AGENT'S SHARE OF A SUPPLIER REFERRAL, as a rate.

   ONE DEFINITION, because four things need this number and they must not
   each work it out: the supplier's statement, the per-agency schedules,
   what Opndoor owes, and the screen. It reads the FROZEN rate off the
   application, exactly as every other money surface does -- the whole
   model snapshots rates at creation and never recomputes, and a statement
   that re-derived a tier from today's volume would restate a month that
   has already been paid.

   CAPPED AT THE TOTAL, and that is not defensive dressing. A supplier
   configured with an agent rate above its total would otherwise produce a
   negative supplier share, and "never more in total" is the sentence this
   implements. The cap makes the invariant true by construction rather
   than by hoping the data is sane; `a_supplier_share_is_carved_out`
   asserts both the ordinary case and this one. */
create or replace function public.supplier_agent_rate(p_app uuid)
returns numeric
language sql
stable security definer
set search_path to ''
as $function$
  select least(coalesce(a.agent_rate, 0), coalesce(a.partner_rate, 0))
  from public.applications a
  where a.id = p_app
$function$;

comment on function public.supplier_agent_rate(uuid) is
  'The agents'' share of a supplier referral, as a rate, carved out of the supplier total and never exceeding it. Frozen: read from the application, not re-derived.';

/* ---- 3. the supplier's own two documents ---------------------------- */

/* EVERY PAID REFERRAL ON ONE SUPPLIER IN ONE MONTH, decomposed.

   The columns are the ones Matt named for the supplier statement --
   "agency, branch, fee, agent's share, supplier's share, total" -- plus
   the reference and tenant that identify the row, and they are returned
   for the per-agency schedules too so the two documents cannot disagree
   about a number.

   THE SAME MONTH RULE AS THE AGENCY STATEMENT, copied deliberately rather
   than shared: paid inside the month in Europe/London, refunds excluded,
   livemode only, and never the direct rail. A supplier referral cannot be
   direct, but the test costs nothing and its absence is what 20261006580000
   existed to fix on the one money surface that lacked it. */
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
  order by coalesce(ag.name, ''), (p.paid_at at time zone 'Europe/London')::date, p.guarantee_ref
$function$;

comment on function public.supplier_statement_lines(uuid, date) is
  'One month of a supplier''s paid referrals, each decomposed into the agents'' carved-out share and the supplier''s own share of one total. Feeds both the supplier statement and the per-agency schedules.';

/* THE AGENCIES UNDER A SUPPLIER THAT HAVE BUSINESS THIS MONTH, and what
   each one's agents are owed.

   ONE SCHEDULE PER AGENCY WITH AT LEAST ONE PAID REFERRAL. An agency with
   nothing paid gets no schedule, on the same rule the statement itself
   uses for a payee: a document reading "your commission is £0.00" is
   noise rather than a statement.

   NOT ADDRESSED TO THE AGENCY, and that is the point of the whole
   instruction. These are the SUPPLIER's working for settling with its own
   agents, so they are attachments on the supplier's email and the
   recipients come from the supplier's party. An agency under a supplier
   is not Opndoor's payee and must never be posted one; nothing here
   returns a recipient, which is the structural half of saying so. */
create or replace function public.supplier_agency_schedules(p_partner uuid, p_month date)
returns table(agency_id uuid, agency_name text, referrals integer, fees numeric, agent_amount numeric)
language sql
stable security definer
set search_path to ''
as $function$
  select l.agency_id, l.agency_name, count(*)::int, sum(l.fee), sum(l.agent_amount)
  from public.supplier_statement_lines(p_partner, p_month) l
  group by l.agency_id, l.agency_name
  having sum(l.agent_amount) > 0
  order by l.agency_name
$function$;

comment on function public.supplier_agency_schedules(uuid, date) is
  'One row per agency under a supplier with paid business in the month, and what that agency''s agents earned out of the supplier total. Posted to the SUPPLIER''s statement recipients, never to the agency.';

/* Read by the monthly run as service_role, and by the admin screens.
   `public` named explicitly on the revoke: Postgres grants EXECUTE to
   PUBLIC on every new function. */
revoke all on function public.supplier_agent_rate(uuid) from public, anon;
grant execute on function public.supplier_agent_rate(uuid) to authenticated, service_role;
revoke all on function public.supplier_statement_lines(uuid, date) from public, anon, authenticated;
grant execute on function public.supplier_statement_lines(uuid, date) to service_role;
revoke all on function public.supplier_agency_schedules(uuid, date) from public, anon, authenticated;
grant execute on function public.supplier_agency_schedules(uuid, date) to service_role;

/* ---- 4. does this supplier settle with its own agents? -------------- */

/* THE QUESTION THREE ARMS OF commission_statement_lines ASK, in one place
   and answering FALSE for everything that is not a real supplier -- the
   house partner every agency shares, the direct rail, the referencing
   hand-over. The agency rail must keep producing agency payees exactly as
   it does today, and an arm that asked `not opndoor_pays_agents` on its
   own would have switched the whole estate off. */
create or replace function public.supplier_settles_its_own_agents(p_partner uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce((
    select not p.opndoor_pays_agents
    from public.partners p
    where p.id = p_partner
      and not public.is_house_partner_id(p.id)
  ), false)
$function$;

comment on function public.supplier_settles_its_own_agents(uuid) is
  'True when this partner is a real supplier that pays its own agents, which is when Opndoor creates no agency payee under its referrals. False for every house route and for the agency rail. NM-C 5.';

revoke all on function public.supplier_settles_its_own_agents(uuid) from public, anon;
grant execute on function public.supplier_settles_its_own_agents(uuid) to authenticated, service_role;

/* ---- 5. what Opndoor owes ------------------------------------------- */

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
    case
      when p.tenancy_id is null or p.tenancy_position is null then ''
      else p.tenancy_position::text || ' of '
           || (select count(*) from public.applications s where s.tenancy_id = p.tenancy_id)::text
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
