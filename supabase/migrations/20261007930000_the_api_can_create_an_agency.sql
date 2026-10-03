/* =====================================================================
   THE API CAN CREATE AN AGENCY AND AN OFFICE, FOR A SUPPLIER THAT ASKS FOR IT.

   Matt, 2026-10-03, approving the design: "Approved, build it after items 1 to
   8 as designed: opt-in flag defaulting to false, suppliers only, agency email
   required, reuse on an exact (normalised) match, refuse on ambiguous, land in
   Reconciliation, response says what was created, audited with the key name.
   One addition: API-created agencies and offices must go through
   Reconciliation's 'Might already exist' similarity check, so a near-miss like
   'Frost Partnerhsix' is flagged to me as a possible duplicate of 'Frost
   Partnership'."

   WHAT HAPPENS TODAY, read off `partner_api_resolve_org` rather than asserted,
   because the design said to: an unknown agency returns `agency_not_found` and
   the referral is REFUSED, with a message telling the integrator to create it
   in the portal first. So nothing is lost by this change and nothing silently
   changes meaning: a partner without the flag sees exactly that message still.

   =====================================================================
   THE SEVEN RULES, AND WHY EACH ONE IS WHERE IT IS
   =====================================================================

   1. OPT IN, DEFAULTING TO FALSE. `api_may_create_agencies` is a column on
      the partner, not a scope on the key: a key is minted and revoked by the
      supplier's own developer, and whether their integration may create
      agencies in our records is Opndoor's decision about the relationship.
      Default false means every partner we already have is unchanged.

   2. SUPPLIERS ONLY, tested on `partner_kind`. `opndoor-agents` is ONE partner
      shared by every agency Opndoor onboards, so creating there is making a
      sibling beside somebody else's agency rather than adding to your own
      book. The same reasoning as 20261007840000, and the same refusal.

   3. THE AGENCY EMAIL IS REQUIRED, because a signed deed for any of its
      offices goes there and an agency created without one is a deed with
      nowhere to go. `admin_create_agency_and_branch` and
      `create_referral_target` both refuse the same way on this rail.

   4. REUSE ON AN EXACT NORMALISED MATCH. `normalise_org_name` already lowers
      case, collapses whitespace and strips a trailing Ltd or Limited, and the
      resolver has matched on it since it was written. So "frost partnership
      ltd" finds "Frost Partnership" and creates nothing: an integrator
      retrying a failed call does not get a second agency.

   5. REFUSE ON AMBIGUOUS. Two agencies normalising the same is a data problem
      on OUR side, and picking one attaches real money to a guess.

   6. IT LANDS IN RECONCILIATION as `pending_review`, the same state a
      supplier's own person gets when they add one while referring.

   7. AUDITED WITH THE KEY NAME. An API key is not a person, so `actor_id`
      stays null and the actor is the key's own name: "Rightmove production"
      rather than a uuid nobody can read, or a blank.

   =====================================================================
   AND MATT'S ADDITION: THE NEAR MISS
   =====================================================================

   Reconciliation's "Might already exist" tab is `duplicate_agency_groups()`,
   which groups by `name_key` -- an EXACT normalised key. It catches "Frost
   Partnership" against "Frost Partnership Ltd" and it cannot catch
   "Frost Partnerhsip", because a typo normalises to a different key. That is
   precisely the case Matt named.

   `similar_agency_groups()` is the fuzzy twin, on pg_trgm, which is already
   installed on dev in the `extensions` schema. 0.55 is the threshold, and it
   was chosen by MEASURING the pairs that matter on dev rather than by taste:

     frost partnership  vs frost partnerhsix    0.565   caught   <- Matt's own
     frost partnership  vs frost partnerhsip    0.636   caught
     frost partnership  vs frost partnership mayfair  0.692  caught
     kestrel lettings   vs kestral lettings     0.700   caught
     frost partnership  vs frost partners       0.737   caught
     regents lettings   vs regent lettings      0.833   caught
     frost partnership  vs foxglove residential 0.026   ignored

   MATT'S OWN EXAMPLE IS THE TIGHTEST OF THEM at 0.565, and it is what sets
   the threshold: 0.6 would have missed the exact case he asked for, which is
   a two-letter transposition plus a wrong last letter. There is room above
   the only unrelated pair on dev (0.026) for the threshold to come down
   further if a real miss turns up, and a near-miss that is NOT a duplicate
   costs Opndoor one glance at a Reconciliation row.

   PAIRS, NOT GROUPS, because similarity is not transitive: A can resemble B
   and B resemble C while A and C are unrelated, so a grouping would invent a
   cluster nobody can read. One row per pair, each named, and Opndoor decides.

   IT IS NOT LIMITED TO API-CREATED ROWS. Matt asks for API creations to go
   through the check; the check is worth having over the whole book, because a
   typo typed into the referral form is the same mistake and was equally
   invisible. The API is what made it urgent, not what makes it true.
   ===================================================================== */

-- 1. THE OPT-IN.
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS api_may_create_agencies boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.partners.api_may_create_agencies IS
  'May this supplier''s API keys create an agency or office that does not exist yet? Default false. Suppliers only: partner_api_create_org refuses on the agency estate whatever this says.';

-- 2. THE NEAR MISS, for Reconciliation.
CREATE OR REPLACE FUNCTION public.similar_agency_groups()
 RETURNS TABLE(partner_id uuid, partner_name text, a_id uuid, a_name text,
               b_id uuid, b_name text, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  /* WITHIN ONE PARTNER'S BOOK. Two suppliers may each carry a "Frost
     Partnership" and they are different companies; the duplicate question is
     only ever about one party's own records.

     `a.id < b.id` SO EACH PAIR APPEARS ONCE, and in a stable order, rather
     than twice with the names swapped.

     THE EXACT DUPLICATES ARE LEFT TO duplicate_agency_groups, which already
     reports them with their own wording: a pair that shares a name_key is not
     a "might", it is a duplicate, and reporting it in both places would have
     Opndoor resolve the same row twice. */
  select a.partner_id, min(p.name), a.id, a.name, b.id, b.name,
         extensions.similarity(public.normalise_org_name(a.name),
                               public.normalise_org_name(b.name)) as score
    from public.agencies a
    join public.agencies b
      on b.partner_id = a.partner_id and a.id < b.id
    join public.partners p on p.id = a.partner_id
   where not a.is_placeholder and not b.is_placeholder
     and a.name_key <> b.name_key
     and extensions.similarity(public.normalise_org_name(a.name),
                               public.normalise_org_name(b.name)) >= 0.55
   group by a.partner_id, a.id, a.name, b.id, b.name
   order by score desc, a.name
$function$;

GRANT EXECUTE ON FUNCTION public.similar_agency_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.similar_agency_groups() TO service_role;
REVOKE EXECUTE ON FUNCTION public.similar_agency_groups() FROM public, anon;

-- 3. THE CREATION PATH.
CREATE OR REPLACE FUNCTION public.partner_api_create_org(
  p_partner uuid,
  p_api_key uuid,
  p_agency_name text,
  p_agency_email text,
  p_agency_address text,
  p_branch_name text,
  p_branch_address text,
  p_branch_email text
)
 RETURNS TABLE(outcome text, agency_id uuid, branch_id uuid, created text[], detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text; v_allowed boolean; v_actor text;
  v_agency uuid; v_branch uuid; v_n int; v_names text;
  v_made text[] := array[]::text[];
  v_email text := btrim(coalesce(p_agency_email, ''));
  v_aname text := btrim(coalesce(p_agency_name, ''));
  v_bname text := btrim(coalesce(p_branch_name, ''));
begin
  /* THE PARTY AND ITS PERMISSION, in one read. Both are facts about the
     partner, and reading them separately is two chances for one of them to be
     asked and the other forgotten. */
  select pt.partner_kind, pt.api_may_create_agencies
    into v_kind, v_allowed
    from public.partners pt where pt.id = p_partner;

  if v_kind is null then
    return query select 'unknown_partner'::text, null::uuid, null::uuid, v_made, null::text;
    return;
  end if;

  -- RULE 2. Suppliers only, whatever the flag says.
  if v_kind <> 'supplier' then
    return query select 'creation_not_available'::text, null::uuid, null::uuid, v_made, null::text;
    return;
  end if;

  -- RULE 1. Opt in, defaulting to false.
  if not coalesce(v_allowed, false) then
    return query select 'creation_not_enabled'::text, null::uuid, null::uuid, v_made, null::text;
    return;
  end if;

  if public.normalise_org_name(v_aname) is null then
    return query select 'agency_required'::text, null::uuid, null::uuid, v_made, null::text;
    return;
  end if;

  /* THE KEY'S OWN NAME, for the audit trail. An API key is not a person, so
     there is no `actor_id` to record and inventing one would put a user's name
     on something no user did. A revoked or deleted key still leaves its name
     on what it made, which is the point of writing it down. */
  select k.name into v_actor from public.partner_api_keys k where k.id = p_api_key;
  v_actor := coalesce(nullif(btrim(coalesce(v_actor, '')), ''), 'an API key');

  -- RULES 4 AND 5. Reuse on an exact normalised match; refuse on ambiguous.
  select count(*), (array_agg(a.id order by a.created_at))[1] into v_n, v_agency
    from public.agencies a
   where a.partner_id = p_partner
     and public.normalise_org_name(a.name) = public.normalise_org_name(v_aname);

  if v_n > 1 then
    select string_agg(a.name, ', ' order by a.name) into v_names
      from public.agencies a
     where a.partner_id = p_partner
       and public.normalise_org_name(a.name) = public.normalise_org_name(v_aname);
    return query select 'agency_ambiguous'::text, null::uuid, null::uuid, v_made, v_names;
    return;
  end if;

  if v_n = 0 then
    -- RULE 3. The agency email, and only for an agency being CREATED: one
    -- that already exists has whatever contact it has, and demanding an
    -- address to reuse a record would refuse a correct call.
    if v_email = '' then
      return query select 'agency_email_required'::text, null::uuid, null::uuid, v_made, null::text;
      return;
    end if;
    if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      return query select 'agency_email_invalid'::text, null::uuid, null::uuid, v_made, null::text;
      return;
    end if;

    -- RULE 6. Pending review: it lands in Reconciliation.
    insert into public.agencies (partner_id, name, review_state)
    values (p_partner, v_aname, 'pending_review')
    returning id into v_agency;
    v_made := v_made || 'agency';

    insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary)
    values (v_agency, p_partner, '', v_email, true);

    -- RULE 7. Audited with the key's name.
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', v_agency, 'created', v_aname || ' (created through the API)', v_actor, null);
  end if;

  /* AND THE OFFICE. No name given means the agency's own single office, which
     is the shape `create_referral_target` makes and the shape a supplier's own
     Add agency dialog makes: an agency created through the API would otherwise
     have no office at all and the referral would have nowhere to sit. */
  if public.normalise_org_name(v_bname) is null then
    v_bname := v_aname;
  end if;

  select count(*), (array_agg(b.id order by b.created_at))[1] into v_n, v_branch
    from public.branches b
   where b.agency_id = v_agency
     and public.normalise_org_name(b.name) = public.normalise_org_name(v_bname);

  if v_n > 1 then
    select string_agg(b.name, ', ' order by b.name) into v_names
      from public.branches b
     where b.agency_id = v_agency
       and public.normalise_org_name(b.name) = public.normalise_org_name(v_bname);
    return query select 'branch_ambiguous'::text, v_agency, null::uuid, v_made, v_names;
    return;
  end if;

  if v_n = 0 then
    insert into public.branches (agency_id, partner_id, name, area, review_state)
    values (v_agency, p_partner, v_bname,
            nullif(btrim(coalesce(p_branch_address, '')), ''), 'pending_review')
    returning id into v_branch;
    v_made := v_made || 'branch';

    /* THE OFFICE'S OWN EMAIL IS OPTIONAL, which is the rule everywhere else on
       this rail: a branch with none inherits the agency's, so an empty one is
       not a missing field. */
    if coalesce(btrim(p_branch_email), '') <> '' then
      insert into public.agent_contacts (branch_id, agency_id, partner_id, name, email, is_primary)
      values (v_branch, v_agency, p_partner, '', btrim(p_branch_email), true);
    end if;

    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', v_branch, 'created', v_bname || ' (created through the API)', v_actor, null);
  end if;

  return query select 'ok'::text, v_agency, v_branch, v_made, null::text;
end $function$;

GRANT EXECUTE ON FUNCTION public.partner_api_create_org(uuid,uuid,text,text,text,text,text,text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.partner_api_create_org(uuid,uuid,text,text,text,text,text,text) FROM public, anon, authenticated;
