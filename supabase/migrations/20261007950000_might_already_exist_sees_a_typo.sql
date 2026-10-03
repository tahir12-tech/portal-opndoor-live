/* =====================================================================
   "MIGHT ALREADY EXIST" SEES A TYPO.

   Matt, 2026-10-03, adding one thing to the approved API design:
   "API-created agencies and offices must go through Reconciliation's 'Might
   already exist' similarity check, so a near-miss like 'Frost Partnerhsix' is
   flagged to me as a possible duplicate of 'Frost Partnership'."

   =====================================================================
   WHERE THAT CHECK ACTUALLY LIVES, read before building anything
   =====================================================================

   "Might already exist" is a FILTER over `reconciliation_queue`, not a
   separate query: the tab is `queue.filter((i) => i.match)`. So a pending row
   is in that tab exactly when the queue found it a `match_name`, and the
   queue's lateral looked for three things:

     the same name, case-insensitively
     a confirmed name CONTAINING the pending one
     a pending name containing a confirmed one

   None of those can see "Frost Partnerhsix". A transposition is not a
   substring of anything, so Matt's own example landed in the OTHER tab,
   reported as a brand new agency, which is precisely the mistake he is
   asking to be told about.

   SO THE FOURTH ARM IS TRIGRAM SIMILARITY, in the same lateral, ordered
   beneath the two it already had: an exact name still wins, then
   containment, then likeness. `matchExact` on the client already tells the
   first apart from the rest, so the card's wording is right with no change.

   0.55, MEASURED RATHER THAN CHOSEN:

     frost partnership  vs frost partnerhsix    0.565   caught  <- Matt's own
     frost partnership  vs frost partnerhsip    0.636   caught
     kestrel lettings   vs kestral lettings     0.700   caught
     regents lettings   vs regent lettings      0.833   caught
     frost partnership  vs foxglove residential 0.026   ignored

   His example is the tightest at 0.565, and it is what sets the threshold:
   0.6 would miss the exact case he asked for. A false positive costs Opndoor
   one glance at a row they were going to read anyway.

   =====================================================================
   AND similar_agency_groups IS DROPPED, because nothing calls it
   =====================================================================

   I added it an hour ago in 20261007930000, reading Matt's sentence as asking
   for a new whole-book duplicate report. It is not: the check he names is the
   tab, the tab is this queue, and a second function answering a similar
   question from a different angle is the thing that drifts.

   It was never called by anything, never drawn, and is dropped in the same
   release it was added, which is the cheapest moment there will ever be. Its
   allowlist entry goes with it.
   ===================================================================== */

DROP FUNCTION IF EXISTS public.similar_agency_groups();

/* THE THRESHOLD, IN ONE PLACE. Inlining 0.55 into the lateral would put the
   number where nobody looking for it would find it, and the next person to
   tune it would tune one of two copies. */
CREATE OR REPLACE FUNCTION public.org_names_are_similar(p_a text, p_b text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    extensions.similarity(public.normalise_org_name(p_a),
                          public.normalise_org_name(p_b)) >= 0.55,
    false)
$function$;

GRANT EXECUTE ON FUNCTION public.org_names_are_similar(text,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.org_names_are_similar(text,text) FROM public, anon;

CREATE OR REPLACE FUNCTION public.reconciliation_queue()
 RETURNS TABLE(entity_id uuid, entity_type text, name text, parent text, created_by_name text, created_at timestamp with time zone, referral_count bigint, match_name text, match_exact boolean, folded_head_office boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with pend as (
    select a.id, 'agency'::text as etype, a.name, null::text as parent, a.created_by, a.created_at, a.partner_id
    from public.agencies a where a.review_state = 'pending_review' and a.livemode
    union all
    select b.id, 'branch'::text as etype, b.name, pa.name as parent, b.created_by, b.created_at, b.partner_id
    from public.branches b join public.agencies pa on pa.id = b.agency_id
    where b.review_state = 'pending_review' and b.livemode
      -- fold the auto head-office branch of a still-pending agency into its card
      and not (pa.review_state = 'pending_review' and lower(b.name) = lower(pa.name || ', Head office'))
  )
  select
    p.id, p.etype, p.name, p.parent,
    coalesce(u.full_name, 'A referrer') as created_by_name,
    p.created_at,
    (select count(*) from public.applications ap
       where ap.livemode
         and ((p.etype = 'agency' and ap.agency_id = p.id) or (p.etype = 'branch' and ap.branch_id = p.id))) as referral_count,
    m.name as match_name,
    coalesce(m.exact, false) as match_exact,
    (p.etype = 'agency' and exists (
       select 1 from public.branches b
       where b.agency_id = p.id and b.review_state = 'pending_review' and b.livemode
         and lower(b.name) = lower(p.name || ', Head office'))) as folded_head_office
  from pend p
  left join public.users u on u.id = p.created_by
  left join lateral (
    select c.name, (lower(c.name) = lower(p.name)) as exact
    from (
      select a.name from public.agencies a where p.etype = 'agency' and a.review_state = 'confirmed' and a.partner_id = p.partner_id and a.livemode
      union all
      select b.name from public.branches b where p.etype = 'branch' and b.review_state = 'confirmed' and b.partner_id = p.partner_id and b.livemode
    ) c
    where lower(c.name) = lower(p.name)
       or lower(c.name) like '%' || lower(p.name) || '%'
       or lower(p.name) like '%' || lower(c.name) || '%'
       -- MATT'S ADDITION. A transposition is a substring of nothing, so the
       -- three arms above cannot see "Frost Partnerhsix" at all.
       or public.org_names_are_similar(c.name, p.name)
    /* BEST FIRST, in the order a reader would rank them: the same name, then
       one that contains the other, then the likeliest of the rest. Without
       the third key a typo and a containment tie and the answer is whichever
       row the planner reached first. */
    order by (lower(c.name) = lower(p.name)) desc,
             (lower(c.name) like '%' || lower(p.name) || '%'
                or lower(p.name) like '%' || lower(c.name) || '%') desc,
             extensions.similarity(public.normalise_org_name(c.name),
                                   public.normalise_org_name(p.name)) desc,
             c.name
    limit 1
  ) m on true
  where public.is_aal2() and public.is_opndoor_staff()
  order by p.created_at desc;
$function$;
