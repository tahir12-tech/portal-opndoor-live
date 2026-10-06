/* =====================================================================
   `|| 'agency'` ON A text[] IS NOT AN APPEND.

   Caught by a_near_miss_is_flagged.test.sql before anything called this, which
   is the whole reason the test was written alongside the migration:

     ERROR: malformed array literal: "agency"
     QUERY:  v_made := v_made || 'agency'

   Postgres resolves `text[] || unknown` by casting the unknown operand to
   text[] and parsing it as an array LITERAL, so 'agency' had to start with a
   brace. The intent was `array_append`, which is what it says now. The
   alternative, `|| 'agency'::text`, resolves to the right operator and reads
   as though the ambiguity was not there.

   A NEW FILE BECAUSE 20261007930000 IS APPLIED. Re-running it would make dev
   disagree with a clean filename-order run.

   NOTHING ELSE CHANGES, and nothing had used it yet: the response field this
   builds is Matt's "response says what was created", and the only call path
   to it is the one being built in the same release.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.partner_api_create_org(p_partner uuid, p_api_key uuid, p_agency_name text, p_agency_email text, p_agency_address text, p_branch_name text, p_branch_address text, p_branch_email text)
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
    v_made := array_append(v_made, 'agency');

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
    v_made := array_append(v_made, 'branch');

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
