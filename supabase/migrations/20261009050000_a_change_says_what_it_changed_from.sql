/* =====================================================================
   (cs) EVERY NAME, ADDRESS AND EMAIL CHANGE, WITH WHO MADE IT.

   Matt: "Agency/office edits by supplier Management aren't recorded in
   Recent changes (renamed Test Lettings asda to asdah and changed the
   email; still '2 changes'). Record every name, address and email
   change with who made it, e.g. 'Email changed from test@lettings.com
   to test2@lettings.com, by Matthew Dwyer'."

   MOST OF THIS WAS BUILT WITH (dn) EARLIER TONIGHT, and the proof is
   his own edit: org_audit holds "Test Lettings asda renamed to Test
   Lettings asdah" and an email line, both actored "Matthew Dwyer", at
   00:09:31 on 2026-10-05. Two gaps are left, and they are in his
   sentence rather than in the mechanism.

   THE EMAIL LINE DID NOT SAY WHAT IT REPLACED. His example is "from X
   to Y"; the line said only "set to Y". That is the half a reader needs
   to tell a correction from a mistake, and the old value was already in
   hand -- it is read a few lines above to decide whether anything
   changed at all.

   THE ADDRESS WAS NOT RECORDED AT ALL. It is the one of the three that
   changes nothing else in the product, which is probably why it was
   missed, and it is the one somebody is most likely to want to check
   later.

   BOTH FUNCTIONS, because an office is edited by the same people
   through the same screen and a rule that holds for one of them is not
   a rule.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.set_agency_details(p_agency uuid, p_name text, p_address text, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; v_pid uuid; v_old_name text; v_old_email text; r record;
  v_old_addr text; v_addr text := nullif(btrim(coalesce(p_address, '')), '');
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, name, address into v_pid, v_old_name, v_old_addr from public.agencies where id = p_agency;
  if v_pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;

  /* THE SAME TEST admin_add_agency USES, deliberately: whoever may add an
     agency to an estate may correct one in it. Management only -- a
     Referrer adds agencies from the referral form and that is not the same
     right as renaming one afterwards. */
  if not coalesce((public.is_admin()
        or (public.app_role() = 'management'
            and v_pid = public.app_partner()
            and not public.is_our_estate_partner(v_pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_name = '' then raise exception 'Agency name is required.' using errcode = '22023'; end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid agency contact email.' using errcode = '22023';
  end if;
  /* THE SAME DUPLICATE CHECK AS ADDING, which is what Matt asked for, and
     excluding this row: renaming an agency to the name it already has is
     not a clash. */
  if exists (select 1 from public.agencies a
              where a.partner_id = v_pid and a.id <> p_agency
                and lower(a.name) = lower(v_name)) then
    raise exception 'An agency with that name already exists for this partner.' using errcode = '23505';
  end if;
  /* AN AGENCY IN A SUPPLIER'S ESTATE MUST KEEP AN EMAIL. admin_add_agency
     requires one at creation because signed deeds for its branches go
     there; clearing it afterwards would leave the same gap by a different
     door. */
  if v_email = '' and coalesce(public.is_supplier_estate(v_pid), false)
     and exists (select 1 from public.agent_contacts c where c.agency_id = p_agency and c.is_primary) then
    raise exception 'An agency that comes through a supplier must keep an email. Signed deeds for its branches go there.'
      using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'somebody');
  select c.email into v_old_email from public.agent_contacts c
   where c.agency_id = p_agency and c.is_primary limit 1;

  update public.agencies
     set name = v_name, address = v_addr
   where id = p_agency;

  if v_email <> '' then
    if v_old_email is null then
      insert into public.agent_contacts(agency_id, partner_id, name, email, is_primary, created_by)
      values (p_agency, v_pid, v_name, v_email, true, me);
    else
      update public.agent_contacts set email = v_email
       where agency_id = p_agency and is_primary;
    end if;
  end if;

  /* RECORDED WITH WHO DID IT, which Matt asked for, and SAYING WHAT
     CHANGED rather than that something did. A Recent changes line reading
     "the agency was edited" is the entry somebody has to open the row to
     understand. */
  /* CASE-SENSITIVE FOR THE AUDIT, case-insensitive for the duplicate check,
     and the difference is the point. "Test Lettings asda" -> "Test Lettings
     ASDA" is not a clash with itself, so the check above must ignore case;
     but it IS the correction this function largely exists for, so recording
     nothing would leave the commonest edit invisible in Recent changes. */
  if v_old_name is distinct from v_name then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_agency, 'renamed', v_old_name || ' renamed to ' || v_name, who, me);

    /* (dn) AN OFFICE NAMED AFTER ITS AGENCY FOLLOWS THE RENAME. A NAME
       A PERSON TYPED NEVER DOES.

       Matt, answering the question: "an office whose name was derived
       from its agency follows a rename; a name a person typed is never
       changed."

       HOW WE KNOW WHICH. Two shapes, and only two: the office is named
       exactly after its agency, or it is the auto "<Agency>, Head
       office" the referral form creates when somebody adds a
       single-office agency on the fly. Both are the SYSTEM writing the
       agency's name into a second row. Everything else -- Battersea,
       Clifton, Harbourmouth -- is somebody's own word for a place, and
       rewriting it would be this function editing a fact it was not
       given.

       THE SAME TEST THE SCREEN ALREADY USES. officeNameAddsNothing in
       agencyOffices.ts draws exactly this line to decide whether to
       SHOW an office; it now also decides whether to RENAME one, so
       the two cannot disagree about which names are the system's.

       MEASURED BEFORE BUILDING: Test Lettings asda's office carries
       created_by NULL and a created_at identical to its agency's to
       the microsecond -- one write, no person. That is the case this
       is for.

       AND EACH ONE IS AUDITED SEPARATELY, because a reader of Recent
       changes should see that their office name moved, not have to
       infer it from the agency's line. */
    for r in
      select b.id, b.name from public.branches b
       where b.agency_id = p_agency
         and (lower(btrim(b.name)) = lower(btrim(v_old_name))
           or lower(btrim(b.name)) = lower(btrim(v_old_name) || ', head office'))
    loop
      update public.branches
         set name = case when lower(btrim(r.name)) = lower(btrim(v_old_name))
                         then v_name else v_name || ', Head office' end
       where id = r.id;
      insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
      select 'branch', r.id, 'renamed',
             r.name || ' renamed to ' || b.name || ' (it was named after the agency)', who, me
        from public.branches b where b.id = r.id;
    end loop;
  end if;
  /* (cs) FROM WHAT, TO WHAT. Matt's own example: "Email changed from
     test@lettings.com to test2@lettings.com, by Matthew Dwyer." The line
     named only the new address, so a reader could see that the deeds move
     but not where they were going before -- which is the half you need to
     tell a correction from a mistake. Where there was no address at all it
     still says so rather than inventing a "from". */
  if v_email <> '' and lower(coalesce(v_old_email, '')) is distinct from lower(v_email) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_agency, 'email_changed',
            case when coalesce(v_old_email, '') = ''
                 then 'Agency email set to ' || v_email || ', so signed deeds now go there'
                 else 'Agency email changed from ' || v_old_email || ' to ' || v_email
                      || ', so signed deeds now go there' end,
            who, me);
  end if;
  /* (cs) AND THE ADDRESS, which was not recorded at all. Matt: "Record
     every name, address and email change with who made it." It is the one
     of the three that changes nothing else in the product, which is
     probably why it was missed -- and it is the one a reader is most
     likely to want to check later. */
  if coalesce(v_old_addr, '') is distinct from coalesce(v_addr, '') then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_agency, 'address_changed',
            case when coalesce(v_old_addr, '') = '' then 'Address set to ' || v_addr
                 when coalesce(v_addr, '') = ''     then 'Address removed (it was ' || v_old_addr || ')'
                 else 'Address changed from ' || v_old_addr || ' to ' || v_addr end,
            who, me);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_branch_details(p_branch uuid, p_name text, p_address text, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; v_pid uuid; v_ag uuid; v_old_name text; v_old_email text;
  v_old_addr text; v_addr text := nullif(btrim(coalesce(p_address, '')), '');
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, agency_id, name, address into v_pid, v_ag, v_old_name, v_old_addr
    from public.branches where id = p_branch;
  if v_pid is null then raise exception 'Office not found.' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
        or (public.app_role() = 'management'
            and v_pid = public.app_partner()
            and not public.is_our_estate_partner(v_pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_name = '' then raise exception 'Office name is required.' using errcode = '22023'; end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid office email.' using errcode = '22023';
  end if;
  -- WITHIN ITS AGENCY, not within the partner: two agencies may each have a
  -- "Mayfair" office and neither is a duplicate of the other.
  if exists (select 1 from public.branches b
              where b.agency_id = v_ag and b.id <> p_branch
                and lower(b.name) = lower(v_name)) then
    raise exception 'An office with that name already exists for this agency.' using errcode = '23505';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'somebody');
  select c.email into v_old_email from public.agent_contacts c
   where c.branch_id = p_branch and c.is_primary limit 1;

  update public.branches
     set name = v_name, address = v_addr
   where id = p_branch;

  /* AN OFFICE EMAIL IS AN OVERRIDE OF ITS AGENCY'S, which Matt established
     on 2026-10-02, so clearing it is a real act and not a mistake: it means
     "use the agency's". Deleting the row rather than storing an empty one
     is what makes effective_primary_contact fall back correctly. */
  if v_email = '' then
    delete from public.agent_contacts where branch_id = p_branch and is_primary;
  elsif v_old_email is null then
    insert into public.agent_contacts(branch_id, partner_id, name, email, is_primary, created_by)
    values (p_branch, v_pid, v_name, v_email, true, me);
  else
    update public.agent_contacts set email = v_email where branch_id = p_branch and is_primary;
  end if;

  -- Case-sensitive here too: see the agency function above.
  if v_old_name is distinct from v_name then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', p_branch, 'renamed', v_old_name || ' renamed to ' || v_name, who, me);
  end if;
  -- (cs) FROM WHAT, TO WHAT. See the agency function.
  if lower(coalesce(v_old_email, '')) is distinct from lower(v_email) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', p_branch, 'email_changed',
            case when v_email = '' then 'Office email removed, so signed deeds go to the agency''s'
                 when coalesce(v_old_email, '') = ''
                   then 'Office email set to ' || v_email || ', so signed deeds now go there'
                 else 'Office email changed from ' || v_old_email || ' to ' || v_email
                      || ', so signed deeds now go there' end,
            who, me);
  end if;
  -- (cs) AND THE ADDRESS. See the agency function.
  if coalesce(v_old_addr, '') is distinct from coalesce(v_addr, '') then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', p_branch, 'address_changed',
            case when coalesce(v_old_addr, '') = '' then 'Address set to ' || v_addr
                 when coalesce(v_addr, '') = ''     then 'Address removed (it was ' || v_old_addr || ')'
                 else 'Address changed from ' || v_old_addr || ' to ' || v_addr end,
            who, me);
  end if;
end $function$;
