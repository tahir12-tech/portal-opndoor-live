-- AN OFFICE NAMED AFTER ITS AGENCY FOLLOWS THE RENAME.
--
-- Matt (dn), asked and answered: "after renaming the agency Test
-- Lettings asda to Test Lettings asdah, its office is still called
-- 'Test Lettings asda'. It shows in the Branch column on Kestrel's
-- statement and the agency's own schedule, and in Volume by branch, so
-- the agency sees its old name." And then: "an office whose name was
-- derived from its agency follows a rename; a name a person typed is
-- never changed."
--
-- IT IS NOT (ct). The name is stale DATA, not a stale lookup: the row
-- says "Test Lettings asda" because that is what is stored, and
-- matching by id would not have helped.
--
-- THE PROVENANCE WAS MEASURED, not assumed. That office carries
-- created_by NULL and a created_at identical to its agency's to the
-- microsecond: one write, no person, the name taken from the agency.
--
-- TWO SHAPES COUNT AS DERIVED and no others: the office named exactly
-- after its agency, and the auto "<Agency>, Head office" the referral
-- form creates. Both are the system writing the agency's name into a
-- second row. Battersea, Clifton and Harbourmouth are somebody's own
-- word for a place, and this function was not given permission to edit
-- those.

CREATE OR REPLACE FUNCTION public.set_agency_details(p_agency uuid, p_name text, p_address text, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; v_pid uuid; v_old_name text; v_old_email text; r record;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, name into v_pid, v_old_name from public.agencies where id = p_agency;
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
     set name = v_name, address = nullif(btrim(coalesce(p_address, '')), '')
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
  if v_email <> '' and lower(coalesce(v_old_email, '')) is distinct from lower(v_email) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_agency, 'email_changed',
            'Agency email set to ' || v_email || ', so signed deeds now go there', who, me);
  end if;
end $function$;
