-- THE ESTATE DECIDES WHO MAY ADD AN AGENCY, NOT WHO OWNS THE STOCK.
--
-- Matt, 2026-10-04, verbatim: "Signed in as Kestrel Management
-- (test@kestrel.com), New application still says 'Your own agencies. A new
-- agency is set up by opndoor, not here' with no way to add an agency or
-- office, though item 3 was reported done. Find why the supplier form doesn't
-- show it (wrong form, a role check, or not deployed), fix it".
--
-- Test: supabase/tests/the_estate_decides_who_may_add.test.sql
--
-- =========================================================================
-- NONE OF THE THREE. IT WAS A FLAG ANSWERING THE WRONG QUESTION
-- =========================================================================
--
-- The feature is built, tested and deployed. `my_org_shape` computed
--
--     may_add_agency := (not refers_own_stock)
--
-- and Kestrel Lettings carries `refers_own_stock = true`, so the server told
-- the form that Kestrel Management may not add an agency, and the form
-- believed it. Measured as the user: may_add_agency false, refers_own_stock
-- true.
--
-- THE COLUMN'S OWN COMMENT FORBIDS THIS USE, in as many words: "True when
-- this partner refers tenants into stock it owns or manages (an agent). False
-- when it refers on behalf of agencies it does not own (a supplier) ...
-- Ownership only. Never a permission." It was being used as a permission.
--
-- AND KESTREL IS BOTH THINGS AT ONCE, which is why this surfaced there and
-- nowhere else: it owns stock it refers AND holds an estate of agencies it
-- does not own (Frost Partnership, 123, Example Lettings). One boolean cannot
-- answer both questions, and the one it was answering was ownership.
--
-- `is_supplier_estate` is the question the form is actually asking, and it is
-- the predicate the SQL guards already use, so the form and the database now
-- agree about who may add rather than agreeing by coincidence.
--
-- MEASURED ACROSS EVERY PARTNER THAT HOLDS AGENCIES. Three answers move:
--
--     kestrel-lettings      false -> TRUE    the reported bug
--     opndoor-direct        true  -> false   a house route nobody adds to
--     referencing-partner   true  -> false   the same
--
-- The two tightenings are not collateral: a direct signup is one tenant
-- applying for themselves with no staff referrer, so "may add an agency" was
-- never a sensible true there. harbour-lets and opndoor-agents are unchanged.
--
-- =========================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
-- =========================================================================
--
-- It does not change Kestrel's `refers_own_stock`. That flag is arguably
-- wrong for a supplier by its own definition, but it also decides which
-- approved tenant email a referral gets (`create-referral` picks rail
-- "agency" or "supplier" from it), and Matt has ruled that supplier wording
-- "approved and must stay byte-identical". Flipping it would change what a
-- Kestrel tenant receives, which is his call and not a side effect of fixing
-- a form. Raised separately.

CREATE OR REPLACE FUNCTION public.my_org_shape(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(refers_own_stock boolean, agency_count integer, branch_count integer, collapse_agency boolean, collapse_branch boolean, may_add_agency boolean, only_agency_id uuid, only_agency_name text, only_branch_id uuid, only_branch_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner uuid;
  v_own     boolean;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  if v_partner is null then
    return;
  end if;

  select p.refers_own_stock into v_own from public.partners p where p.id = v_partner;
  v_own := coalesce(v_own, false);

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         case
           -- A position says which branches, and on our estate it is the only
           -- thing that does. WAS: a home_branch_id arm beneath this one, and
           -- an `else true` beneath that.
           when public.app_has_scope() then b.id in (select s from public.app_scope_branches() s)
           -- No position on our own estate is now impossible; if it somehow
           -- happens, the honest answer is the empty set, which the client
           -- draws as "nothing is set up for your account yet".
           when public.is_our_estate_partner(v_partner) then false
           -- A supplier without a position sees their own company. Stated, not
           -- defaulted to, so the closed default below is the one a new arm meets.
           when not public.is_our_estate_partner(v_partner) then true
           else false
         end
       )
  ),
  agg as (
    select
      count(distinct r.aid)::int       as ag,
      count(*)::int                    as br,
      (array_agg(distinct r.aid))[1]   as aid1,
      (array_agg(distinct r.aname))[1] as aname1,
      (array_agg(r.bid))[1]            as bid1,
      (array_agg(r.bname))[1]          as bname1
    from reachable r
  )
  select
    v_own,
    agg.ag,
    agg.br,
    (v_own and agg.ag = 1),
    (v_own and agg.br = 1),
    /* MAY THIS VIEWER ADD AN AGENCY. The estate decides it, not ownership.

       It was `not v_own`, reading partners.refers_own_stock, whose own column
       comment forbids exactly that: "Ownership only. Never a permission."
       Kestrel owns some of the stock it refers AND is a supplier with an
       estate of agencies it does not own, so one flag was being asked two
       questions and answered the wrong one: Kestrel Management got a plain
       select and the sentence "A new agency is set up by opndoor, not here",
       with no way to add the agency they were referring for.

       `is_supplier_estate` is the question actually being asked, and it is
       the same predicate the SQL guards use, so the form and the database now
       agree about who may add rather than agreeing by coincidence.

       MEASURED ACROSS EVERY PARTNER THAT HOLDS AGENCIES, three answers move
       and all three move the right way:
         kestrel-lettings      false -> TRUE   the reported bug
         opndoor-direct        true  -> false  a house route nobody adds to
         referencing-partner   true  -> false  the same
       harbour-lets and opndoor-agents are unchanged at false. */
    public.is_supplier_estate(v_partner),
    case when agg.ag = 1 then agg.aid1   end,
    case when agg.ag = 1 then agg.aname1 end,
    case when agg.br = 1 then agg.bid1   end,
    case when agg.br = 1 then agg.bname1 end
  from agg;
end $function$


;
