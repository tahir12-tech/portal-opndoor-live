/* =====================================================================
   AND THE DUPLICATE-AGENCY RACE SAYS SO TOO.

   20261007720000 gave `admin_create_agency_and_branch` a pre-check so a
   duplicate name is refused with a sentence instead of a unique-constraint
   error the client has to genericise. A pre-check has a window: two admins
   adding the same name at the same moment both pass it, and the loser
   reaches the constraint and gets "Something went wrong saving that
   change" after all.

   `create_agency_group` has had both halves since it was written -- a
   check and an `exception when unique_violation` -- and this makes the
   agency path match it. The pre-check is still worth having: it is what
   catches the case-insensitive near-duplicate, which the index does not,
   and it answers without the insert being attempted.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.admin_create_agency_and_branch(p_agency_name text, p_branch_name text DEFAULT NULL::text, p_branch_area text DEFAULT NULL::text, p_partner_rate numeric DEFAULT NULL::numeric, p_agent_rate numeric DEFAULT NULL::numeric, p_partner_slug text DEFAULT 'opndoor-agents'::text, p_group_id uuid DEFAULT NULL::uuid, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text)
 RETURNS TABLE(agency_id uuid, branch_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid; v_agency uuid; v_branch uuid; v_me uuid := auth.uid();
        v_email text := btrim(coalesce(p_agency_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if coalesce(btrim(p_agency_name), '') = '' then raise exception 'An agency name is required.' using errcode = '22023'; end if;

  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid agency contact email.' using errcode = '22023';
  end if;

  select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
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

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate, group_id)
  values (v_partner, btrim(p_agency_name), 'confirmed', p_partner_rate, p_agent_rate, p_group_id)
  returning id into v_agency;

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
    values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), 'confirmed')
    returning id into v_branch;
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
end $$;
