/* =====================================================================
   A SUPPLIER'S OWN PEOPLE CAN ADD AN AGENCY OR AN OFFICE.

   Matt, 2026-10-03: "Supplier users who can refer (Management and Referrers)
   can add an agency or office for their own supplier while sending a
   referral, instead of 'A new agency is set up by opndoor, not here' ... It
   belongs to that supplier's estate only, is usable straight away for the
   referral, and lands in Opndoor's Reconciliation to check, recorded in
   Recent changes with who added it ... Opndoor's own agencies are unchanged:
   their users can't add agencies or offices."

   THIS DOOR WAS is_admin() ONLY, which is why the "Add agency" button Matt
   asked for on a supplier's own Agencies page could not have worked either.
   `admin_add_agency` beside it already admits a supplier's MANAGEMENT, with
   the reasoning this migration reuses; what is new is the REFERRER, and the
   review state that follows from who created the row.

   FOUR THINGS, AND THE THIRD IS THE ONE THAT MATTERS MOST:

     1. Management and Referrer at a supplier may call it, for their own
        partner only.
     2. Our own estate is excluded. `opndoor-agents` is ONE partner shared by
        every agency Opndoor has onboarded, so a Regent negotiator creating an
        agency there would be creating a sibling beside their own rather than
        adding to their own book.
     3. The partner is taken from `app_partner()` and NOT from the parameter
        when the caller is a supplier's own person. `p_partner_slug` has a
        default, so otherwise a Kestrel referrer could name Harbourside's slug
        and create an agency inside a competitor's estate. An admin keeps the
        parameter: choosing the partner is what the admin tool is for.
     4. What a supplier's person creates lands `pending_review`, so it reaches
        Reconciliation. An admin using the org tool IS the check and their rows
        still land confirmed.

   AND IT NOW RECORDS WHO. This door wrote no `org_audit` row, which is
   exactly why I could date Harborview Lettings to the second this afternoon
   and could not say who created it. Matt's separate instruction the same day
   asks for creation to be recorded "(who, when, and from where)"; the detail
   says "(added while referring)" where that is how it happened.

   USABLE STRAIGHT AWAY. `pending_review` is a flag for the reviewer, not a
   gate: the ids come back from this call and the referral is filed against
   them immediately.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.admin_create_agency_and_branch(p_agency_name text, p_branch_name text DEFAULT NULL::text, p_branch_area text DEFAULT NULL::text, p_partner_rate numeric DEFAULT NULL::numeric, p_agent_rate numeric DEFAULT NULL::numeric, p_partner_slug text DEFAULT 'opndoor-agents'::text, p_group_id uuid DEFAULT NULL::uuid, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text)
 RETURNS TABLE(agency_id uuid, branch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_agency uuid; v_branch uuid; v_me uuid := auth.uid();
        v_email text := btrim(coalesce(p_agency_email, ''));
        v_admin boolean; v_own_supplier boolean; v_review text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  /* A SUPPLIER'S OWN PEOPLE MAY ADD TO THEIR OWN BOOK.

     Matt, 2026-10-03: "Supplier users who can refer (Management and
     Referrers) can add an agency or office for their own supplier while
     sending a referral, instead of 'A new agency is set up by opndoor, not
     here' ... Opndoor's own agencies are unchanged: their users can't add
     agencies or offices."

     WHY OUR OWN ESTATE IS EXCLUDED, and it is not an oversight:
     `opndoor-agents` is ONE partner shared by every agency Opndoor has
     onboarded, so a Regent negotiator creating an agency there is creating a
     sibling beside their own, not adding to their own book.
     `admin_add_agency` has carried that exact reasoning since it was written
     and this is the same test, said the same way.

     MANAGEMENT AND REFERRER BOTH, which is Matt's instruction and is wider
     than `admin_add_agency`'s management-only rule. The referral form is
     where a referrer meets a new office, so refusing them there is refusing
     the case this is for. What a referrer creates lands for review; see
     v_confirmed below. */
  v_admin := coalesce(public.is_admin(), false);
  v_own_supplier := not v_admin
    and public.app_role() in ('management', 'referrer')
    and public.app_partner() is not null
    and not coalesce(public.is_our_estate_partner(public.app_partner()), false);
  if not (v_admin or v_own_supplier) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_agency_name), '') = '' then raise exception 'An agency name is required.' using errcode = '22023'; end if;

  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid agency contact email.' using errcode = '22023';
  end if;

  /* THEIR OWN PARTNER, NOT THE ONE THEY ASKED FOR. `p_partner_slug` is a
     parameter with a default, so a supplier's own person could otherwise name
     somebody else's slug and create an agency inside a competitor's estate.
     An admin keeps the parameter, because choosing the partner is what the
     admin tool is for. */
  if v_own_supplier then
    v_partner := public.app_partner();
  else
    select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
  end if;
  if v_partner is null then raise exception 'Partner not found.' using errcode = '22023'; end if;

  -- The estate decides, and only after the partner is resolved.
  if v_email = '' and coalesce(public.is_supplier_estate(v_partner), false) then
    raise exception 'An agency email is required for an agency that comes through a supplier. Signed deeds for its branches go there.'
      using errcode = '22023';
  end if;

  if p_group_id is not null and not exists (
    select 1 from public.agency_groups g where g.id = p_group_id and g.partner_id = v_partner
  ) then
    raise exception 'That group is not under this partner.' using errcode = '22023';
  end if;

  /* THE REAL REASON, BEFORE THE CONSTRAINT GETS IT. Matt, 2026-10-03:
     "adding an agency whose name already exists in that supplier's estate
     (e.g. 'Frost Partnership' under Kestrel) fails with the generic
     'Something went wrong saving that change.' Show the real reason inside
     the form, next to the name."

     WHY IT WAS GENERIC AND WHY THE FIX BELONGS HERE. `agencies` carries a
     unique (partner_id, name), so the insert below raised "duplicate key
     value violates unique constraint" -- and `cleanRpcError` in the client
     replaces anything that reads like a database internal with a safe
     sentence, correctly, because a Postgres error is not a thing to show a
     user. The answer is not to start parsing those strings in the client;
     it is for this function to say the sentence itself, as it already does
     for a missing name, a bad email and a group under another partner.

     CASE-INSENSITIVE, which is slightly stricter than the constraint. An
     estate holding "Frost Partnership" and "frost partnership" is somebody
     making the mistake this message exists to prevent, and catching it here
     means they get the sentence rather than the raw constraint error they
     would otherwise still get.

     THE AGENCY'S NAME, NOT ITS ID. The form finds the existing one in the
     hydrated book to offer "Open it instead?"; putting an id in a sentence
     would make the message unreadable on its own. */
  if exists (
    select 1 from public.agencies a
     where a.partner_id = v_partner
       and lower(btrim(a.name)) = lower(btrim(p_agency_name))
  ) then
    raise exception '% already has an agency called %.',
      (select p.name from public.partners p where p.id = v_partner),
      btrim(p_agency_name)
      using errcode = '23505';
  end if;

  /* WHO MADE IT DECIDES WHETHER ANYBODY CHECKS IT.

     Matt, 2026-10-03: what a supplier's own user creates "lands in Opndoor's
     Reconciliation to check". An admin using the org tool is the check, so
     their rows land confirmed, exactly as before; a supplier's own person
     creates a company Opndoor has never seen, so it waits for review -- the
     same `pending_review` the agent rail's on-the-fly branch already uses, so
     it arrives in a queue that already exists and is already read.

     AND IT IS USABLE STRAIGHT AWAY. `pending_review` is a flag for the
     reviewer, not a gate on the referral: the branch id comes back from this
     call and the referral is filed against it immediately, which is Matt's
     "usable straight away for the referral". */
  v_review := case when v_admin then 'confirmed' else 'pending_review' end;

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate, group_id, created_by)
  values (v_partner, btrim(p_agency_name), v_review, p_partner_rate, p_agent_rate, p_group_id, v_me)
  returning id into v_agency;

  /* RECORDED, WITH WHO. `admin_add_agency` has written this row since it was
     written and this door did not -- which is why I could date Harborview
     Lettings to the second and not say who made it. Matt's own instruction,
     the same day: "Record agency, branch, group and supplier creation in
     Recent changes and the audit trail (who, when, and from where)." */
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', v_agency, 'created',
          btrim(p_agency_name) || case when v_own_supplier then ' (added while referring)' else '' end,
          coalesce((select full_name from public.users where id = v_me), 'an administrator'), v_me);

  -- Only when there is one: an empty contact row is a mailbox with no
  -- address in it, and "leave it blank and nothing is missing".
  if v_email <> '' then
    insert into public.agent_contacts (agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (v_agency, v_partner, btrim(coalesce(p_agency_contact_name, '')), v_email,
            nullif(btrim(coalesce(p_agency_phone, '')), ''), true, v_me);
  end if;

  -- Optional: a skeleton agency waits for its manager to add branches.
  if coalesce(btrim(p_branch_name), '') <> '' then
    insert into public.branches (agency_id, partner_id, name, area, review_state)
    values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), v_review)
    returning id into v_branch;
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', v_branch, 'created',
            btrim(p_branch_name) || case when v_own_supplier then ' (added while referring)' else '' end,
            coalesce((select full_name from public.users where id = v_me), 'an administrator'), v_me);
  end if;

  return query select v_agency, v_branch;

exception when unique_violation then
  /* AND THE RACE, which the pre-check above cannot cover. Two admins
     adding the same name at the same moment both pass the EXISTS and one
     of them reaches the constraint -- and `cleanRpcError` would turn that
     into the generic sentence this whole migration exists to remove.

     `create_agency_group` has had this shape since it was written and is
     the pattern followed here: pre-check for the readable case, including
     the case-insensitive near-duplicate the index does not catch, and a
     handler for the one the pre-check cannot see.

     NAMED, not re-queried. The partner's name is already in hand from the
     check above; selecting it again inside a failed transaction's handler
     is a second chance to fail. */
  raise exception '% already has an agency called %.',
    coalesce((select p.name from public.partners p where p.id = v_partner), 'This supplier'),
    btrim(p_agency_name)
    using errcode = '23505';
end $function$;
