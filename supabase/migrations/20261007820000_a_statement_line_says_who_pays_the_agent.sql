/* =====================================================================
   THE SUPPLIER'S STATEMENT SAYS WHICH ARRANGEMENT EACH LINE WAS SOLD UNDER.

   Matt, 2026-10-03: "the invoice instruction must ask for what Opndoor owes
   the supplier itself (600 here, not 840), otherwise agency commission
   Opndoor pays directly gets paid twice."

   THE AMOUNTS CANNOT BE READ BACK TO THE ARRANGEMENT, which is the whole
   reason this migration exists. Under both shapes
   `supplier_amount = total_amount - agent_amount`, so a reader of the three
   numbers cannot tell whether the agents' share was added on top of the
   supplier's total or carved out of it -- and that is precisely what decides
   the debt:

     Kestrel, GR-FROST-KES, frozen "opndoor pays the agents"
       total 840, agents 240, supplier 600
       Opndoor pays Frost the 240 DIRECTLY, so Kestrel is owed 600.
       The statement invoiced 840. That is 240 paid twice.

     the same numbers frozen "the supplier pays its own agents"
       total 600, agents 240, supplier 360
       Kestrel is owed the whole 600 and passes 240 to Frost.

   ONE BOOLEAN, FROM THE FUNCTION THAT ALREADY ANSWERS IT.
   `settles_its_own_agents_frozen` is what the rates in this very query are
   already branched on; it is returned rather than recomputed so the caller
   cannot answer it differently from the figures it is reading.

   DROPPED AND RECREATED because the return type gains a column, which CREATE
   OR REPLACE cannot do. The grant is restated for the same reason: a DROP
   takes it with it. service_role only, unchanged -- the browser has never
   been able to call this and must not start.
   ===================================================================== */

DROP FUNCTION IF EXISTS public.supplier_statement_lines(uuid, date);

CREATE FUNCTION public.supplier_statement_lines(p_partner uuid, p_month date)
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
  from paid p
  left join public.agencies ag on ag.id = p.agency_id
  left join public.branches br on br.id = p.branch_id
  /* GUARANTEE REFERENCE ORDER, LOWEST FIRST, the same as the agency
     statement. The per-agency schedules are built by filtering these
     rows, so they inherit it. */
  order by p.guarantee_ref
$function$;

REVOKE ALL ON FUNCTION public.supplier_statement_lines(uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.supplier_statement_lines(uuid, date) TO service_role;
