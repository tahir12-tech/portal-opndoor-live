-- RECONCILIATION SAYS WHOSE, WHAT, AND WHO.
--
-- Matt (am): "Reconciliation: 1) show which supplier each new agency or
-- office belongs to ('Kestrel Lettings · Test Test Test'); 2) an agency's
-- automatic first office (created with it) is confirmed together with the
-- agency, not listed separately; offices added later are listed on their
-- own; 3) 'created by A referrer' must name the person who created it."
--
-- Test: supabase/tests/reconciliation_says_whose_what_and_who.test.sql
--
-- =========================================================================
-- ITEM 2 WAS ALREADY BUILT AND HAS NEVER ONCE FIRED
-- =========================================================================
--
-- The fold is there: a pending branch is dropped from the queue when its
-- agency is also pending and the branch is named `<agency>, Head office`.
-- That name does not exist. `create_referral_target` defaults an unnamed
-- office to plain 'Head office', and every pending row on dev right now is
-- named after its AGENCY ("Test Test Test" under "Test Test Test"), because
-- the supplier's referral form puts the agency name in the office box.
-- Three spellings, and the fold matched none of them.
--
-- SO THE RULE STOPS BEING ABOUT THE NAME. An office is the agency's
-- automatic first one when its agency is still pending and it is that
-- agency's ONLY office. That is what "created with it" means, it is what
-- makes confirming the agency confirm the office too, and it cannot be
-- broken by a fourth path spelling the default differently.
--
-- AND TWO OFFICES ON A PENDING AGENCY FOLD NEITHER, which falls out of the
-- same rule rather than needing its own: once there are two, neither is the
-- automatic one and both are decisions somebody made.
--
-- =========================================================================
-- ITEM 3 IS THE SAME ROWS, AND THE FALLBACK WAS HIDING IT
-- =========================================================================
--
-- `coalesce(u.full_name, 'A referrer')` reads as a deliberate anonymisation
-- and is not one: every pending BRANCH on dev has `created_by` null while
-- its agency has the real person on it. The first office is created in the
-- same breath as the agency, so the agency's creator IS its creator, and
-- that is a fact we hold rather than a guess.
--
-- THE LITERAL STAYS AS THE LAST RESORT, because a row whose creator has
-- since been deleted has no name to give and "A referrer" is still true.

/* DROPPED, NOT REPLACED, because the row type changes: `supplier` is a new
   OUT column and Postgres refuses a CREATE OR REPLACE that changes the shape
   of a set-returning function. The DROP is in the file so a clean apply
   does exactly what dev did. */
drop function if exists public.reconciliation_queue();

create function public.reconciliation_queue()
returns table(entity_id uuid, entity_type text, name text, parent text,
              supplier text, created_by_name text, created_at timestamp with time zone,
              referral_count bigint, match_name text, match_exact boolean,
              folded_head_office boolean)
language sql stable security definer set search_path to '' as $function$
  with pend as (
    select a.id, 'agency'::text as etype, a.name, null::text as parent,
           a.created_by, a.created_at, a.partner_id
    from public.agencies a where a.review_state = 'pending_review' and a.livemode
    union all
    select b.id, 'branch'::text as etype, b.name, pa.name as parent,
           /* THE AGENCY'S CREATOR WHERE THE OFFICE HAS NONE. Item 3. The
              automatic first office is created in the same statement as the
              agency, so this is the person who made it, not an assumption. */
           coalesce(b.created_by, pa.created_by), b.created_at, b.partner_id
    from public.branches b join public.agencies pa on pa.id = b.agency_id
    where b.review_state = 'pending_review' and b.livemode
      /* FOLD THE AGENCY'S AUTOMATIC FIRST OFFICE. Item 2, by shape rather
         than by name: its agency is still pending, and it is that agency's
         only office. Offices added later are a second decision and stay. */
      and not (
        pa.review_state = 'pending_review'
        and (select count(*) from public.branches sb
              where sb.agency_id = pa.id and sb.livemode) = 1
      )
  )
  select
    p.id, p.etype, p.name, p.parent,
    /* WHOSE. Item 1. Named only for a SUPPLIER'S estate: on our own agency
       rail the partner is the house route "Opndoor Agents", which is
       plumbing and is what channel.ts exists to keep off a screen. Null
       there, so the UI prints nothing rather than a company nobody has
       heard of. */
    case when pt.partner_kind = 'supplier' then pt.name end as supplier,
    coalesce(u.full_name, 'A referrer') as created_by_name,
    p.created_at,
    (select count(*) from public.applications ap
       where ap.livemode
         and ((p.etype = 'agency' and ap.agency_id = p.id) or (p.etype = 'branch' and ap.branch_id = p.id))) as referral_count,
    m.name as match_name,
    coalesce(m.exact, false) as match_exact,
    /* "AND ITS FIRST OFFICE", on the agency's own card, so the reviewer can
       see what they are confirming. Same shape as the fold above: one
       office, and the agency still pending. */
    (p.etype = 'agency' and (
       select count(*) from public.branches b
        where b.agency_id = p.id and b.review_state = 'pending_review' and b.livemode) = 1
     and (select count(*) from public.branches b2 where b2.agency_id = p.id and b2.livemode) = 1
    ) as folded_head_office
  from pend p
  join public.partners pt on pt.id = p.partner_id
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

revoke all on function public.reconciliation_queue() from public, anon;
grant execute on function public.reconciliation_queue() to authenticated, service_role;

comment on function public.reconciliation_queue() is
  'New agencies and offices awaiting review. `supplier` names the supplier whose estate it is, and is null on our own agency rail where the partner is the house route. An agency''s automatic first office is folded into the agency''s card -- identified as "its agency is pending and it is that agency''s only office", not by name, because the default office name is spelled three different ways by three creation paths. A branch with no creator inherits the agency''s, which is the same person.';
