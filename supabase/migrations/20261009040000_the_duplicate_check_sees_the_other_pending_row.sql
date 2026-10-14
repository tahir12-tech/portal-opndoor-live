/* =====================================================================
   (ck) THE DUPLICATE CHECK COULD NOT SEE THE DUPLICATE.

   Matt: "Reconciliation duplicate check: 'Test Lettings' and 'Test
   Lettings asda' (both under Kestrel, same email test@lettings.com,
   created 2 minutes apart) both show 'Nothing similar found'. Flag as
   'Might already exist' when a new agency or office shares an email
   with an existing one, or its name starts with or contains another's
   name, within the same supplier or Opndoor's own estate."

   =====================================================================
   THE CAUSE, MEASURED, AND IT IS NOT THE THRESHOLD
   =====================================================================

   The queue note guessed at the trigram threshold. It was wrong, and
   the real cause is plainer: the match only ever looked at rows with
   `review_state = 'confirmed'`.

   On dev, all three Test agencies are pending_review. Two agencies
   created two minutes apart are therefore invisible to each other BY
   CONSTRUCTION -- each is compared against the confirmed book, which
   neither of them is in yet. The name arms were already right: the
   function has tested containment in both directions since it was
   written, and "Test Lettings" is a substring of "Test Lettings asdah".
   It was asking the right question about the wrong set.

   THAT ALSO MAKES IT THE WORST CASE RATHER THAN AN EDGE ONE. Two rows
   arriving minutes apart is what a duplicate IS: the same person
   creating the same agency twice because the first attempt did not look
   like it worked.

   =====================================================================
   AND THE EMAIL, WHICH WAS NOT ASKED AT ALL
   =====================================================================

   Matt's first clue is a shared address, and nothing in the match
   looked at one. It lives on agent_contacts, not on the agency, so it
   is a question about the contacts of two orgs rather than a column
   comparison. org_shares_contact_email asks it in one place, for
   agencies and offices alike.

   NO EMAIL IS NOT A SHARED EMAIL, which is the trap in a rule like
   this, and on dev most organisations have no contact at all.
   agent_contacts.email is NOT NULL and constrained to a valid address,
   so "no email" means no contact ROW and the join finds nothing; the
   null and blank guards below are belt and braces against a column
   that is already held.
   ===================================================================== */

/* SECURITY INVOKER, deliberately. Its only caller is reconciliation_queue,
   which is already SECURITY DEFINER and admin-gated, so inside that call
   this runs with the owner's rights and adds nothing to the definer
   allowlist. Called by anyone else it is bounded by their own RLS. */
create or replace function public.org_shares_contact_email(
  p_kind text, p_a uuid, p_b uuid)
returns boolean
language sql stable
set search_path to ''
as $function$
  select exists (
    select 1
      from public.agent_contacts x
      join public.agent_contacts y
        on lower(btrim(y.email)) = lower(btrim(x.email))
     where x.email is not null and btrim(x.email) <> ''
       and case when p_kind = 'agency' then x.agency_id = p_a else x.branch_id = p_a end
       and case when p_kind = 'agency' then y.agency_id = p_b else y.branch_id = p_b end
  )
$function$;

revoke all on function public.org_shares_contact_email(text, uuid, uuid) from public, anon;
grant execute on function public.org_shares_contact_email(text, uuid, uuid) to authenticated, service_role;

comment on function public.org_shares_contact_email(text, uuid, uuid) is
  'Do these two agencies, or these two offices, have a contact email in common? Used by the reconciliation duplicate check, where a shared address is the strongest sign that somebody created the same organisation twice. An org with no contact email matches nothing.';

/* DROPPED FIRST: three columns are added to the returned row type, and
   Postgres will not change an OUT parameter list through CREATE OR
   REPLACE. */
drop function if exists public.reconciliation_queue();

CREATE OR REPLACE FUNCTION public.reconciliation_queue()
 RETURNS TABLE(entity_id uuid, entity_type text, name text, parent text, supplier text,
               created_by_name text, created_at timestamp with time zone, referral_count bigint,
               match_name text, match_exact boolean, folded_head_office boolean,
               match_id uuid, match_reason text, match_pending boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    ) as folded_head_office,
    /* (ck) THE ID, so the reviewer can act on the match rather than be told
       about it, and WHY it matched, so they can see what the machine saw. */
    m.id as match_id,
    m.reason as match_reason,
    coalesce(m.pending, false) as match_pending
  from pend p
  join public.partners pt on pt.id = p.partner_id
  left join public.users u on u.id = p.created_by
  left join lateral (
    select c.id, c.name, c.pending,
           (lower(c.name) = lower(p.name)) as exact,
           /* THE REASON, in the order a reader would rank it. One string,
              chosen here rather than rebuilt in the browser from four
              booleans. */
           case
             when lower(c.name) = lower(p.name) then 'same name'
             when public.org_shares_contact_email(p.etype, p.id, c.id) then 'same contact email'
             when lower(c.name) like '%' || lower(p.name) || '%'
               or lower(p.name) like '%' || lower(c.name) || '%' then 'one name contains the other'
             else 'a similar name'
           end as reason
    from (
      /* (ck) THE PENDING ONES TOO, which is the whole fix. Two agencies
         created two minutes apart are both pending, so a check against the
         confirmed book alone could never see either of them -- and that is
         not an edge case, it is what a duplicate looks like. Its own row is
         excluded by id; a placeholder is not an agency. */
      select a.id, a.name, (a.review_state = 'pending_review') as pending
        from public.agencies a
       where p.etype = 'agency' and a.partner_id = p.partner_id and a.livemode
         and a.id <> p.id and not a.is_placeholder
         and a.review_state in ('confirmed', 'pending_review')
      union all
      select b.id, b.name, (b.review_state = 'pending_review')
        from public.branches b
       where p.etype = 'branch' and b.partner_id = p.partner_id and b.livemode
         and b.id <> p.id
         and b.review_state in ('confirmed', 'pending_review')
    ) c
    where lower(c.name) = lower(p.name)
       or lower(c.name) like '%' || lower(p.name) || '%'
       or lower(p.name) like '%' || lower(c.name) || '%'
       -- MATT'S ADDITION. A transposition is a substring of nothing, so the
       -- three arms above cannot see "Frost Partnerhsix" at all.
       or public.org_names_are_similar(c.name, p.name)
       -- (ck) AND A SHARED ADDRESS, his first clue and the one arm that
       -- needs no spelling to agree at all.
       or public.org_shares_contact_email(p.etype, p.id, c.id)
    /* BEST FIRST, in the order a reader would rank them: the same name, then
       one that contains the other, then the likeliest of the rest. Without
       the third key a typo and a containment tie and the answer is whichever
       row the planner reached first.

       A CONFIRMED MATCH BEFORE A PENDING ONE, added with the pending rows:
       "merge into the one that already exists" is the likelier action, and
       an existing record is the better survivor of the two. */
    order by (lower(c.name) = lower(p.name)) desc,
             (not c.pending) desc,
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
