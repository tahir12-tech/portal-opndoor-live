/* =====================================================================
   ROUND 6, THE LOWS THAT ARE STILL OPEN. Three of the eight.

   Four of the eight named in docs/QUEUE.md are already done and the
   aggregate row there is stale: the unescaped ILIKE, the `.neq` NULL hole
   (no live `.neq(` remains anywhere in the tree), send-password-reset's
   origin fallback (safeOrigin, backlog B6) and commission_statement_refs'
   may-see-commission guard (20261006790000). The fourth still open,
   localStorage surviving sign-out, is client-side and not here.

   -------------------------------------------------------------------
   1. THE SECOND FACTOR, ON THE THREE TABLES THE LAST SWEEP MISSED
   -------------------------------------------------------------------

   20261006780000 was written for backlog B8, whose sentence is
   "partner_agency_relationships has no require_aal2 restrictive policy".
   It gave the policy to nine tables. `partner_agency_relationships` was
   not one of them. A case-insensitive grep for `require_aal2` across every
   migration returns no hit on that table at all, and QUEUE.md records B8
   as done.

   SO THE LIST WAS DERIVED RATHER THAN TRUSTED. Every table in `public`
   with row security on was checked against its policies on a clean
   filename-order apply of all 351 migrations. Of 69 such tables, most have
   RLS on and NO policy, which is deny-by-default and correct: nothing
   reads them except through a definer function that has checked the
   caller, and adding a restrictive policy to a table with no permissive
   one changes nothing. The tables that matter are the ones with a
   permissive policy and no second-factor requirement, and there are
   exactly three:

     partner_agency_relationships   2 select policies   which agencies a
                                                        supplier carries
     branch_deed_recipient          1 select policy     who receives deeds
                                                        at a branch
     view_as_audit                  1 select policy     who looked at whom

   All three are readable today by a password-only session that has not
   completed the second factor. `view_as_audit` is the sharpest of them: it
   is the record of who read whose data, so reading it at AAL1 is reading
   the audit trail without passing the control the trail exists to police.

   RESTRICTIVE, so it ANDs with whatever permissive policy already decides
   who may read the row; it narrows and never widens. Written in the
   verbose form, one statement per table, because scripts/schema-drift.mjs
   cannot see policies created inside a do-loop -- the blind spot
   20261006780000 documents.

   -------------------------------------------------------------------
   2. detach_user_from_agency ASKS ONE FEWER QUESTION THAN ITS SIBLING
   -------------------------------------------------------------------

   `attach_user_to_agency` requires the caller to hold a group or agency
   position, and says why: "attaching somebody to an agency is a statement
   about the whole brand, which is above their position." Its twin does not
   ask, so a branch-level Manager who cannot ATTACH a colleague to an
   agency can DETACH one from it. Removing somebody's access is a statement
   about the brand in exactly the same way, and it is the more damaging
   direction.

   The clause is added INSIDE the existing coalesce so the guard stays one
   null-safe compound rather than becoming `not A and B`, which is the bug
   20261006440000 exists to undo.

   -------------------------------------------------------------------
   3. set_branch_deed_recipient CALLS THE HOUSE PARTNER "THIS ORGANISATION"
   -------------------------------------------------------------------

   Its test is `v_user_partner <> v_partner`, where v_partner is the
   branch's partner. On the agency rail that is the one house partner
   `opndoor-agents`, shared by every agency Opndoor has onboarded -- so the
   test passes for a user at ANY agency on the estate and the error message
   under it, "must be a user in this organisation", is false. The
   authorisation clause below it is sound, so the caller is confined to
   branches they reach; the hole is the OTHER argument. A Manager at agency
   A could nominate a person at agency B to receive agency A's deeds.

   `app_may_reach_user` is the predicate that knows the difference between
   the rails, and it is the one every other "may I act on this person"
   site already asks. It replaces the partner comparison rather than
   joining it: on the supplier rail it resolves to the partner boundary,
   which is what the old line was reaching for and got right by accident.

   THE TWO CHECKS ARE ALSO REORDERED so authorisation runs first. As it
   stood, a caller with no permission at all learned whether p_user exists
   and which partner they belong to, from the error they got back.
   ===================================================================== */

-- ---- 1. the second factor, on the three tables the sweep missed --------

alter table public.partner_agency_relationships enable row level security;
drop policy if exists require_aal2 on public.partner_agency_relationships;
create policy require_aal2 on public.partner_agency_relationships
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.branch_deed_recipient enable row level security;
drop policy if exists require_aal2 on public.branch_deed_recipient;
create policy require_aal2 on public.branch_deed_recipient
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.view_as_audit enable row level security;
drop policy if exists require_aal2 on public.view_as_audit;
create policy require_aal2 on public.view_as_audit
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

-- ---- 2. detaching is as much a statement about the brand as attaching --

CREATE OR REPLACE FUNCTION public.detach_user_from_agency(p_user uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner()
              and public.app_may_reach_agency(p_agency)
              and public.user_within_caller_scope(p_user)
              -- The clause attach_user_to_agency has and this did not. A
              -- branch manager cannot detach somebody from an agency for
              -- the same reason they cannot attach one: it is a statement
              -- about the whole brand, and it is the worse direction.
              and exists (select 1 from public.user_scopes s
                           where s.user_id = auth.uid() and s.kind in ('group','agency')))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);

  -- The trigger recomputes user_attached for the pair and deletes the
  -- relationship row when nothing else holds it up.
  delete from public.user_agency_attachments where user_id = p_user and agency_id = p_agency;
end $function$;

-- ---- 3. "this organisation" is not "this partner" on the agency rail ---

CREATE OR REPLACE FUNCTION public.set_branch_deed_recipient(p_branch uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;

  -- AUTHORISATION FIRST. It used to run after the recipient lookup, so a
  -- caller with no permission at all still learned whether p_user exists
  -- and which partner they belong to.
  if not coalesce((
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and public.app_may_reach_branch(p_branch))
  ), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  /* AND THE RECIPIENT MUST BE SOMEBODY THE CALLER CAN ACTUALLY REACH.
     This was `v_user_partner <> v_partner`, which on the agency rail
     compares against the one house partner every agency shares, so it
     admitted a user at any agency on the estate. app_may_reach_user knows
     the rails: on the supplier rail it resolves to the partner boundary,
     which is what the old comparison was reaching for. */
  if not coalesce(public.app_may_reach_user(p_user), false) then
    raise exception 'The nominated recipient must be a user in this organisation.' using errcode = '22023';
  end if;

  insert into public.branch_deed_recipient (branch_id, user_id, set_by)
  values (p_branch, p_user, auth.uid())
  on conflict (branch_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
end $function$;
