/* =====================================================================
   (ci) A SUPPLIER-ESTATE AGENCY INHERITS, AND THE SERVER SAYS SO.

   Matt, 2026-10-04: "Supplier-estate agency Overview: remove the 'How
   are [agency]'s tenants checked?' choice. It follows the supplier's
   setting ... Make the server refuse setting a referencing mode on any
   supplier-estate agency or office, so the inheritance fix can't be
   undone by a click."

   "SO IT CAN'T BE UNDONE BY A CLICK" IS THE WHOLE INSTRUCTION. Hiding
   the control is the cosmetic half, and the screen half was NOT done
   either: the radios were gated on `open && isAdmin && a.id` and
   nothing else, so an admin on Kestrel's Test Lettings was offered the
   choice and the server took it. Both halves are in this commit.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.set_agency_referencing_mode(p_agency uuid, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  /* (ci) AN AGENCY IN A SUPPLIER'S ESTATE HAS NO SETTING OF ITS OWN.

     Matt: "Make the server refuse setting a referencing mode on any
     supplier-estate agency or office, so the inheritance fix can't be
     undone by a click."

     THE INHERITANCE IS resolve_referencing_mode'S coalesce: the agency's
     own mode first, the route partner's second. So a value stored on a
     supplier's agency does not sit alongside the supplier's setting, it
     OVERRIDES it, silently, for every referral through that agency. The
     screen no longer offers the choice; this is what makes the absence
     binding.

     MEASURED ON DEV BEFORE ADDING IT: all eight agencies in Kestrel's
     estate hold NULL and inherit correctly today, so nothing is being
     repaired here. One click was all it took to break it.

     'supplier' EXACTLY, not "anything that is not our estate". The
     hand-over rail `referencing-partner` is neither a supplier estate
     nor ours, and its Unattached agency does hold a mode of its own.
     Refusing there would be a change Matt did not ask for. */
  if exists (
    select 1 from public.agencies a
      join public.partners p on p.id = a.partner_id
     where a.id = p_agency and p.partner_kind = 'supplier') then
    raise exception 'This agency follows its supplier''s checking setting. Change it on the supplier.'
      using errcode = '42501';
  end if;

  if p_mode is null then
    raise exception 'Choose how this agency''s tenants are checked. There is no "follow the default" any more.'
      using errcode = '22023';
  end if;
  if p_mode not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Unknown referencing mode %', p_mode using errcode = '22023';
  end if;

  /* RECORDED IN RECENT CHANGES. Matt: "Changing it asks for
     confirmation and applies to new referrals only, and is recorded in
     Recent changes." The confirmation is the screen's; the record is
     this, and it is written here so every caller gets it.

     ONLY WHEN IT MOVES, like the contact email: a save that changes
     nothing is not a change, and a list of them is what he asked to
     have hidden on the Settings tab the same day. */
  if exists (select 1 from public.agencies
              where id = p_agency and referencing_mode::text is distinct from p_mode) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    select 'agency', p_agency, 'tenant_check_changed',
           (case when a.referencing_mode::text = 'opndoor_referenced' then 'Opndoor checks eligibility'
                 else 'Agency has already referenced them' end)
           || ' -> ' ||
           (case when p_mode = 'opndoor_referenced' then 'Opndoor checks eligibility'
                 else 'Agency has already referenced them' end),
           coalesce((select full_name from public.users where id = auth.uid()), 'an administrator'),
           auth.uid()
    from public.agencies a where a.id = p_agency;
  end if;

  update public.agencies set referencing_mode = p_mode where id = p_agency;
end $function$;

revoke all on function public.set_agency_referencing_mode(uuid, text) from public, anon;
grant execute on function public.set_agency_referencing_mode(uuid, text) to authenticated, service_role;
