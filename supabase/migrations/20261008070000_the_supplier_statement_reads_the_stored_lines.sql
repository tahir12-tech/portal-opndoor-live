-- THE SUPPLIER STATEMENT READS THE STORED COMMISSION LINES.
--
-- Matt, 2026-10-04: "switch supplier statements to read the stored commission
-- lines, as everything else does; show me Kestrel's September statement
-- before and after (it should be identical)."
--
-- Test: supabase/tests/the_supplier_statement_reads_the_lines.test.sql
--
-- =========================================================================
-- THE LAST READER STILL RECALCULATING
-- =========================================================================
--
-- Asked while confirming (aj): do statements, settlement and Reporting read
-- the stored lines? Two of the three did. `commission_statement_lines` reads
-- them for the agency statement, and the client's `linesFor` and
-- `supplierLineOf` read them for Reporting and the settlement, preferring
-- the frozen line and synthesising only when there is none.
--
-- This function computed `fee * rate` from the application, against Matt's
-- own 2026-10-02 rule, which is quoted in commissionSplit.ts a few lines from
-- where the client obeys it: "Store supplier commission per application the
-- same way agency commission is stored, and read it everywhere (statements,
-- exports, reporting, settlements) instead of recalculating."
--
-- =========================================================================
-- WHY THIS IS SAFE, AND WHAT WOULD HAVE MADE IT UNSAFE
-- =========================================================================
--
-- STORED FIRST, COMPUTED WHEN ABSENT. A row whose lines predate
-- 20261008060000's backfill, or one its `on conflict do nothing` left as it
-- found it, still answers with the old arithmetic rather than going blank.
-- The same shape `linesFor` has used client-side all along.
--
-- THE CARVED CLAMP SURVIVES, AND IS CLAMPED AGAINST THE RIGHT THING, which
-- a test caught me getting wrong. `supplier_agent_rate` applies
-- least(agent_rate, partner_rate) so a carve-out cannot exceed what it is
-- carved FROM, and the stored line holds the raw agent_rate and knows
-- nothing about that: read alone it could drive the supplier amount
-- NEGATIVE, the exact fault the audit found on 2026-10-04.
--
-- My first attempt clamped the stored line against the COMPUTED agent
-- amount, which holds the invariant and defeats the change: a stored line
-- that legitimately differs upward would have been silently replaced by the
-- arithmetic this migration exists to stop using. It is clamped against the
-- TOTAL instead, which is what the original clamp meant. A stored line is
-- read as it stands unless it would take more than there is.
--
-- AND ONLY WHEN CARVED. Under siblings the two are separate payees and
-- Opndoor pays each its own, so there is nothing for the agency's share to
-- be carved out of and nothing to clamp.
--
-- THE SHAPE LOGIC IS UNTOUCHED: which of the three figures is derived still
-- follows who is actually paid, carved or siblings, as frozen on the row.
--
-- ROUNDED ON THE WAY OUT, WHICHEVER SOURCE ANSWERED, and the before/after is
-- what caught it. GR-FROST-KES's agency line was seeded as `240`, scale 0,
-- where the computed figure was `240.00`. The same money and a different
-- string, which the client would have rendered identically through
-- gbpAmount, and which a CSV or a diff would not. A money column is to the
-- penny regardless of where the number came from.
--
-- MEASURED BEFORE AND AFTER on Kestrel's September statement, which is the
-- proof Matt asked for and is in the commit message. It is identical,
-- because both sources derive from the same frozen rates: that is the point
-- of the change rather than a lucky result.

CREATE OR REPLACE FUNCTION public.supplier_statement_lines(p_partner uuid, p_month date)
 RETURNS TABLE(application_id uuid, guarantee_ref text, agency_id uuid, agency_name text, branch_name text, tenant_name text, paid_on date, fee numeric, total_rate numeric, agent_rate numeric, total_amount numeric, agent_amount numeric, supplier_amount numeric, settles_own boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  ),
  /* THE STORED LINES, WHICH ARE NOW THE SOURCE. Matt, 2026-10-04: "switch
     supplier statements to read the stored commission lines, as everything
     else does".

     This function computed `fee * rate` while commission_statement_lines,
     the client's linesFor and supplierLineOf all read
     application_commission_lines. It was the last reader still
     recalculating, against Matt's own 2026-10-02 rule: "read it everywhere
     (statements, exports, reporting, settlements) instead of recalculating".

     STORED FIRST, COMPUTED WHEN ABSENT, which is exactly what linesFor does
     client-side. A row whose lines predate 20261008060000's backfill, or one
     the backfill's `on conflict` left alone, still answers rather than going
     blank. */
  stored as (
    select p.*,
           (select l.amount from public.application_commission_lines l
             where l.application_id = p.id and l.level = 'supplier') as sup_amt,
           (select l.amount from public.application_commission_lines l
             where l.application_id = p.id and l.level = 'agency') as ag_amt
    from paid p
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
    /* EACH AMOUNT IS THE STORED LINE, OR THE SAME ARITHMETIC AS BEFORE WHEN
       THERE IS NONE. The shape logic above it is untouched: which of the
       three is derived still follows who is actually paid. */
    case when public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
         then round(coalesce(p.sup_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0)), 2)
         else round(coalesce(p.sup_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0)), 2)
            + round(coalesce(p.ag_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id)), 2)
    end,
    /* THE CLAMP SURVIVES THE SWITCH, and it has to. supplier_agent_rate
       applies least(agent_rate, partner_rate) in the carved shape so a
       carve-out cannot exceed what it is carved from; the STORED line holds
       the raw agent_rate and knows nothing about that. Taking the lower of
       the two keeps the invariant that made the clamp exist, so reading the
       stored line cannot produce a negative supplier amount. */
    case when public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
         then least(
                round(coalesce(p.ag_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id)), 2),
                round(coalesce(p.sup_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0)), 2))
         else round(coalesce(p.ag_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id)), 2)
    end,
    case when public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
         then round(coalesce(p.sup_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0)), 2)
            - least(
                round(coalesce(p.ag_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * public.supplier_agent_rate(p.id)), 2),
                round(coalesce(p.sup_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0)), 2))
         else round(coalesce(p.sup_amt, coalesce(p.fee_amount, p.monthly_rent, 0) * coalesce(p.partner_rate, 0)), 2)
    end,
    /* WHICH ARRANGEMENT THIS LINE WAS FROZEN UNDER, returned since
       20261007820000 because the amounts cannot be read back to it.

       Under BOTH shapes supplier_amount = total_amount - agent_amount, so
       the decomposition looks identical; what differs is whether the
       agents' share was added ON TOP of the supplier's total or carved OUT
       of it. The caller has to know which, because it decides what Opndoor
       actually owes the supplier:

         carved     the supplier is paid the TOTAL and passes the agents'
                    share on, so the total is the debt
         siblings   Opndoor pays the agency directly, so the debt is the
                    supplier's own share and the agents' share must not be
                    invoiced by them as well

       Matt, 2026-10-03: "the invoice instruction must ask for what Opndoor
       owes the supplier itself (600 here, not 840), otherwise agency
       commission Opndoor pays directly gets paid twice." */
    public.settles_its_own_agents_frozen(p.opndoor_pays_agents_at_freeze, p.partner_id)
  from stored p
  left join public.agencies ag on ag.id = p.agency_id
  left join public.branches br on br.id = p.branch_id
  /* GUARANTEE REFERENCE ORDER, LOWEST FIRST, the same as the agency
     statement. The per-agency schedules are built by filtering these
     rows, so they inherit it. */
  order by p.guarantee_ref
$function$


;
