-- ===========================================================================
-- THE SUPPLIER'S COMMISSION IS STORED, THE SAME WAY THE AGENCY'S IS.
--
-- Matt, 2026-10-02, verbatim: "Store supplier commission per application
-- the same way agency commission is stored, and read it everywhere
-- (statements, exports, reporting, settlements) instead of
-- recalculating, with a test that the supplier statement and exports
-- agree to the penny."
--
-- THE OTHER HALF OF THE PENNY. c7581ee made every surface READ the
-- agency's commission instead of multiplying a rate, and said plainly
-- what it could not do: "application_commission_lines carries agency,
-- group and branch levels only, so a supplier's share has no stored line
-- to read and stays fee x partner_rate at every caller." Every one of
-- those callers rounds on its own, so the supplier side can drift
-- exactly as GR-20846 did -- a half-penny fee times a rate, rounded
-- differently by a statement and an export. This gives it a line.
--
-- WHY A LEVEL AND NOT A COLUMN ON applications. "The same way agency
-- commission is stored" is the instruction, and the shape matters: a
-- line carries the rate, the basis it was a share of, and the AMOUNT the
-- server computed, which is what makes a joint tenancy's pennies
-- reproducible. A numeric column on applications would store the amount
-- and lose the other two, and nothing would apportion it.
--
-- AND IT IS APPORTIONED, for the reason the agency side already is:
-- round the TENANCY's commission once and divide, never round each
-- tenant's share on its own. That is what put GR-20845 and GR-20846 a
-- penny over their tenancy's 25%.
--
-- THREE THINGS HAVE TO MOVE TOGETHER, which is why they are one file:
-- the CHECK that lists the levels, the writer, and the one SQL reader
-- that would otherwise put a supplier on the AGENT statement.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A FOURTH LEVEL.
-- ---------------------------------------------------------------------------
alter table public.application_commission_lines
  drop constraint if exists application_commission_lines_level_check;
alter table public.application_commission_lines
  add constraint application_commission_lines_level_check
  check (level in ('group', 'agency', 'branch', 'supplier'));

comment on column public.application_commission_lines.level is
  'group | agency | branch for the agency side, and supplier (20261007580000) for what Opndoor owes a supplier on its own referral. One row per level per application, which the unique constraint enforces. Every reader of the agency side filters to the first three.';

-- ---------------------------------------------------------------------------
-- 2. THE WRITER.
-- ---------------------------------------------------------------------------
/* ADDED TO freeze_commission_lines RATHER THAN BESIDE IT, so the three
   creation paths that already call it -- create_referral,
   create_joint_referral and the supplier's own joint RPC -- get the
   supplier line without any of them being edited, and a fourth path
   added later cannot write one kind of line and forget the other.

   THE RATE IS THE APPLICATION'S OWN SNAPSHOT, not the partner's current
   one: every caller inserts the row with partner_rate from resolve_rates
   and then calls this, so the snapshot is already there and is what the
   application will be settled on however the partner's rate moves after.

   ONLY A REAL SUPPLIER. is_supplier_estate is the same predicate the
   Suppliers list and the route table were fixed onto: not a house
   partner, and not an agency-shaped one. A house route's cut is
   Opndoor's own margin and is owed to nobody, which is why there is no
   line for it rather than a line of zero. */
create or replace function public.freeze_commission_lines(
  p_application uuid, p_branch uuid, p_route_partner uuid, p_tenant_count integer,
  p_basis numeric, p_tenancy_basis numeric default null::numeric,
  p_pcts numeric[] default null::numeric[], p_position integer default null::integer)
returns void
language sql security definer set search_path to ''
as $function$
  with agency_side as (
    insert into public.application_commission_lines
      (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
    select p_application, s.level, s.org_id, s.org_name, s.rate, p_basis, s.source,
           case
             when p_pcts is null or p_position is null or p_tenancy_basis is null
               -- A tenancy of one: its single line IS the tenancy's commission, so
               -- rounding it once here is the same arithmetic apportion would do.
               then round(p_basis * s.rate, 2)
             else
               -- Round the TENANCY's commission once, then divide. The reverse
               -- order is the defect.
               (public.apportion(round(p_tenancy_basis * s.rate, 2), p_pcts))[p_position]
           end
    from public.commission_split(p_branch, p_route_partner, p_tenant_count) s
    returning 1
  )
  insert into public.application_commission_lines
    (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
  select p_application, 'supplier', pt.id, pt.name, a.partner_rate, p_basis,
         -- The supplier's rate is resolved by resolve_rates and carries no
         -- source today. Null is "not recorded", which is what the agency
         -- side's historic lines say and is honest; naming one would be a
         -- guess printed on a statement.
         null,
         case
           when p_pcts is null or p_position is null or p_tenancy_basis is null
             then round(p_basis * a.partner_rate, 2)
           else (public.apportion(round(p_tenancy_basis * a.partner_rate, 2), p_pcts))[p_position]
         end
  from public.applications a
  join public.partners pt on pt.id = a.partner_id
  where a.id = p_application
    and public.is_supplier_estate(a.partner_id)
    and coalesce(a.partner_rate, 0) > 0
  -- Idempotent, so a re-run or a retried creation cannot raise on the
  -- unique (application_id, level) rather than doing nothing.
  on conflict (application_id, level) do nothing
$function$;

revoke all on function public.freeze_commission_lines(uuid, uuid, uuid, integer, numeric, numeric, numeric[], integer) from public, anon, authenticated;
grant execute on function public.freeze_commission_lines(uuid, uuid, uuid, integer, numeric, numeric, numeric[], integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. THE BACKFILL.
-- ---------------------------------------------------------------------------
/* EVERY SUPPLIER-ESTATE APPLICATION THAT HAS NO SUPPLIER LINE, from its
   own snapshot. Dev holds two, both sole tenants: GR-22162 (fee £1,000
   at 25%) and GR-FROST-KES (no fee_amount, so the rent of £2,400 stands
   in, as feeBaseFor does on every other surface).

   THE JOINT ARM IS WRITTEN EVEN THOUGH DEV HAS NO JOINT SUPPLIER
   TENANCY, because the first one created after this runs will go
   through the writer above and be apportioned, and a backfill that
   rounded each share on its own would leave the history disagreeing
   with everything made after it. share_percent in tenancy_position
   order is the same vector the creation paths pass as p_pcts. */
insert into public.application_commission_lines
  (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
select a.id, 'supplier', pt.id, pt.name, a.partner_rate,
       coalesce(a.fee_amount, a.monthly_rent, 0), null,
       case
         when t.pcts is null then round(coalesce(a.fee_amount, a.monthly_rent, 0) * a.partner_rate, 2)
         else (public.apportion(round(t.basis * a.partner_rate, 2), t.pcts))[a.tenancy_position]
       end
from public.applications a
join public.partners pt on pt.id = a.partner_id
left join lateral (
  select array_agg(x.share_percent order by x.tenancy_position) as pcts,
         sum(coalesce(x.fee_amount, x.monthly_rent, 0)) as basis
  from public.applications x
  where a.tenancy_id is not null
    and x.tenancy_id = a.tenancy_id
    and a.tenancy_position is not null
) t on true
where public.is_supplier_estate(a.partner_id)
  and coalesce(a.partner_rate, 0) > 0
  and coalesce(a.fee_amount, a.monthly_rent, 0) > 0
  and not exists (
    select 1 from public.application_commission_lines l
     where l.application_id = a.id and l.level = 'supplier'
  )
on conflict (application_id, level) do nothing;

-- ---------------------------------------------------------------------------
-- 4. AND THE AGENT STATEMENT DOES NOT GAIN A SUPPLIER PAYEE.
-- ---------------------------------------------------------------------------
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
      -- The same filter, for the same reason: an application carrying ONLY a
      -- supplier line has no agency split, so it still takes this historic arm.
      select 1 from public.application_commission_lines l
       where l.application_id = p.id and l.level in ('group', 'agency', 'branch')
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
