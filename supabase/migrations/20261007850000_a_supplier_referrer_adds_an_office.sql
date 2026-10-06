/* =====================================================================
   AND A SUPPLIER'S REFERRER CAN ADD AN OFFICE.

   The office half of 20261007840000, on the door a supplier's Agencies page
   and the referral form both use for an office under an EXISTING agency.
   Management could already do this -- confined by `app_may_reach_agency` --
   and what is new is the referrer, confined instead by the estate test,
   because a referrer holds no position for the reach test to use.

   WHAT A REFERRER CREATES WAITS FOR REVIEW. An admin using the org tool is
   the check; a referrer typing an office name mid-referral is not.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.admin_add_branch(p_agency_id uuid, p_name text, p_area text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; br_id uuid; v_admin boolean := public.is_admin(); v_own_supplier boolean; v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Branch name is required' using errcode = '22023'; end if;
  select partner_id into pid from public.agencies where id = p_agency_id;
  if pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;
  /* AND A SUPPLIER'S REFERRER TOO, 2026-10-03. Matt: "Supplier users who can
     refer (Management and Referrers) can add an agency or office for their
     own supplier while sending a referring" -- the office half of the same
     instruction. Management could already; the referral form is where a
     referrer meets a new office, so refusing them there refuses the case
     this is for.

     OUR OWN ESTATE IS STILL EXCLUDED for the referrer arm, and management's
     own arm is untouched: `app_may_reach_agency` is what confines a manager
     to the agencies they reach, and a referrer holds no position, so the
     estate test is what confines them instead. */
  v_own_supplier := not v_admin
    and public.app_role() = 'referrer'
    and pid = public.app_partner()
    and not coalesce(public.is_our_estate_partner(pid), false);
  if not coalesce((v_admin or v_own_supplier or (public.app_role() = 'management' and pid = public.app_partner()
                      and public.app_may_reach_agency(p_agency_id))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  /* A CONTACT HAS TO EXIST FOR THIS BRANCH. Matt, 2026-10-02: "A contact
     email is required when any agency or branch is created, in any
     estate, so one always exists."

     UNLESS IT INHERITS ONE. A branch with no contacts of its own uses its
     agency's -- that is what `effectiveContacts` has always done and what
     the deed panel prints as "agency default for X". The clause that
     matters in the instruction is "so one always exists", and for a
     branch under an agency that has a contact, one does. Requiring a
     second address per office would undo the default rather than add to
     it. The branch of an agency with NO contact is the case that was
     leaving a deed with nowhere to go, and it is refused. */
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid branch contact email, or leave it blank to use the agency''s.' using errcode = '22023';
  end if;
  /* NOT REQUIRED OF A BRANCH AT ALL, since Matt's correction of
     2026-10-02: "a branch's own email, if set, OVERRIDES it for that
     branch". An override is optional by definition. On the supplier side
     the AGENCY email is the required one and every branch inherits it;
     on our own estate nothing is required, because the deed goes to the
     referrer and the ticked people. */
  -- A deliberate org-tool add by admin OR management lands confirmed (instant).
  if exists (select 1 from public.branches where agency_id = p_agency_id and lower(name) = lower(btrim(p_name))) then
    raise exception 'A branch with that name already exists for this agency.' using errcode = '23505';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  insert into public.branches(name, agency_id, partner_id, area, review_state, created_by)
  /* A REFERRER'S OFFICE WAITS FOR REVIEW, an admin's does not, and a
     manager's keeps the behaviour it had. An admin using the org tool IS the
     check; a referrer typing a name mid-referral is not, and
     Reconciliation's queue is where that gets looked at. */
  values (btrim(p_name), p_agency_id, pid, nullif(btrim(coalesce(p_area,'')),''),
          case when v_own_supplier then 'pending_review' else 'confirmed' end, me) returning id into br_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', br_id, 'created', btrim(p_name), who, me);
  if v_email <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return br_id;
end $function$;
