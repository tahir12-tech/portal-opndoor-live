/* =====================================================================
   MERGING TWO OFFICES.

   Matt, 2026-10-05, answering the question (ck) left open: "Merging two
   offices: yes, write merge_branches, matching how merge_agencies
   works, with a test."

   (ck) made the Reconciliation queue flag a duplicate office and gave
   it "Keep both". It could not offer "Merge into" because there was
   nothing to call: merge_agencies has existed since the agencies work
   and has no counterpart one level down. This is that counterpart.

   =====================================================================
   WHAT POINTS AT A BRANCH, asked of the catalogue rather than
   remembered. Six foreign keys:

       agent_contacts.branch_id                cascade
       application_agency_match.resolved_branch_id   set null
       applications.branch_id                  no action
       branch_deed_recipient.branch_id         cascade
       user_scopes.branch_id                   cascade
       users.home_branch_id                    set null

   THREE OF THEM CASCADE, which is the reason this function exists
   rather than a DELETE: deleting the merged office would silently take
   its contacts, its deed recipient and every position held at it. Two
   more would be set to null, quietly unplacing people and unresolving
   matches. Every one of them is moved first.

   =====================================================================
   WHERE IT DIFFERS FROM merge_agencies, and why

   IT REFUSES ACROSS ESTATES. merge_agencies does not test the partner;
   this does. Two offices in two estates belong to two different
   companies that "never link, share nothing, and never show each
   other's data" -- the separate-estates rule this product is built on.
   Merging them would be the one operation that breaks it, and unlike
   an agency merge there is no case where it is wanted.

   IT MOVES THE APPLICATIONS' AGENCY TOO. Two duplicate offices can sit
   under two different agencies of the same estate, and applications
   carry a denormalised agency_id maintained by a trigger that fires on
   insert and on a branch_id update. Repointing the office without the
   agency would leave a row filed under an agency that no longer holds
   its office.

   A PRIMARY CONTACT IS NOT MOVED ON TOP OF A PRIMARY CONTACT.
   agent_contacts_primary_per_branch is a partial unique index, so
   moving a second primary onto the survivor would abort the whole
   merge. The incoming one is demoted instead and the survivor's stands:
   losing a contact is worse than losing a flag, and the flag is one
   click to change.
   ===================================================================== */

create or replace function public.merge_branches(p_keep uuid, p_merge uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  b_keep public.branches; b_merge public.branches;
  v_apps int := 0; v_contacts int := 0; v_scopes int := 0;
  v_homes int := 0; v_matches int := 0; v_demoted int := 0;
  v_recipient boolean := false; v_moved int := 0;
  who text; me uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_keep = p_merge then raise exception 'Cannot merge an office into itself' using errcode = '22023'; end if;

  select * into b_keep  from public.branches where id = p_keep;
  if not coalesce(found, false) then raise exception 'Surviving office not found' using errcode = '22023'; end if;
  select * into b_merge from public.branches where id = p_merge;
  if not coalesce(found, false) then raise exception 'Merged office not found' using errcode = '22023'; end if;

  -- Placeholders are not offices. The same refusal merge_agencies makes.
  if b_keep.is_placeholder or b_merge.is_placeholder then
    raise exception 'Placeholder offices cannot be merged' using errcode = '22023';
  end if;

  /* THE SEPARATE-ESTATES RULE, enforced rather than trusted. */
  if b_keep.partner_id is distinct from b_merge.partner_id then
    raise exception 'Those offices are in different estates. They are two companies, and merging them would join two books that never share data.'
      using errcode = '22023';
  end if;

  me := auth.uid();
  select full_name into who from public.users where id = me;

  -- ---- applications -------------------------------------------------------
  /* THE AGENCY MOVES WITH THE OFFICE. agency_id is denormalised onto
     applications and maintained by applications_sync_partner, which fires on
     insert and on a branch_id update; both are written here so the row is
     never half moved. partner_id is NOT touched: that is the ROUTE the
     referral arrived on, and merging two org records does not change it. */
  update public.applications
     set branch_id = p_keep, agency_id = b_keep.agency_id
   where branch_id = p_merge;
  get diagnostics v_apps = row_count;

  update public.application_agency_match
     set resolved_branch_id = p_keep
   where resolved_branch_id = p_merge;
  get diagnostics v_matches = row_count;

  -- ---- contacts -----------------------------------------------------------
  /* DEMOTED, NOT DROPPED, AND IN ONE STATEMENT WITH THE MOVE.

     One primary per branch is a partial unique index, so the incoming
     primary would abort the merge if the survivor has one. The survivor's
     stands and the newcomer arrives as an ordinary contact: losing a
     contact is worse than losing a flag, and the flag is one click back.

     DEMOTING IT FIRST DOES NOT WORK, which this found by trying:
     contacts_maintain_primary refuses to un-set the primary of an owner
     that has no other contact, and while the row is still on the merged
     office it IS that office's only contact. Moving and demoting in the
     same UPDATE puts the trigger's `new.branch_id` on the survivor, where
     there is another contact to be primary, so it promotes rather than
     refuses.

     THE NON-PRIMARY ONES MOVE FIRST, so the survivor is never briefly
     without a primary while the one statement below runs. */
  update public.agent_contacts set branch_id = p_keep
   where branch_id = p_merge and not is_primary;
  get diagnostics v_contacts = row_count;

  if exists (select 1 from public.agent_contacts where branch_id = p_keep and is_primary) then
    update public.agent_contacts set branch_id = p_keep, is_primary = false
     where branch_id = p_merge and is_primary;
    get diagnostics v_demoted = row_count;
    v_contacts := v_contacts + v_demoted;
  else
    /* NOBODY TO CLASH WITH: the merged office's primary becomes the
       survivor's, which is better than an office with contacts and no
       primary -- the state the trigger exists to prevent. */
    update public.agent_contacts set branch_id = p_keep
     where branch_id = p_merge and is_primary;
    get diagnostics v_moved = row_count;
    v_contacts := v_contacts + v_moved;
  end if;

  -- ---- the nominated deed recipient ---------------------------------------
  /* ONE ROW PER BRANCH (it is the primary key), so the survivor's nomination
     wins where it has one and the merged office's moves across where it does
     not. Never two, and never none where there was one. */
  if not exists (select 1 from public.branch_deed_recipient where branch_id = p_keep) then
    update public.branch_deed_recipient set branch_id = p_keep where branch_id = p_merge;
    v_recipient := found;
  else
    delete from public.branch_deed_recipient where branch_id = p_merge;
  end if;

  -- ---- positions ----------------------------------------------------------
  /* A POSITION AT THE MERGED OFFICE BECOMES ONE AT THE SURVIVOR, and somebody
     who held both keeps one. user_scopes_unique_target is on
     (user_id, kind, coalesce(group_id, agency_id, branch_id)), so the
     duplicate is deleted rather than moved onto itself. */
  delete from public.user_scopes s
   where s.branch_id = p_merge
     and exists (select 1 from public.user_scopes k
                  where k.user_id = s.user_id and k.kind = s.kind and k.branch_id = p_keep);
  update public.user_scopes set branch_id = p_keep where branch_id = p_merge;
  get diagnostics v_scopes = row_count;

  -- ---- home branches ------------------------------------------------------
  /* SET NULL IS THE FOREIGN KEY'S ANSWER and it is the wrong one: a negotiator
     whose home office was merged still works somewhere. */
  update public.users set home_branch_id = p_keep where home_branch_id = p_merge;
  get diagnostics v_homes = row_count;

  -- ---- the merged row goes ------------------------------------------------
  delete from public.branches where id = p_merge;

  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', p_keep, 'merged',
          format('Merged office "%s" into "%s"%s', b_merge.name, b_keep.name,
                 case when coalesce(btrim(p_note),'') = '' then '' else ': ' || btrim(p_note) end),
          coalesce(who, 'opndoor admin'), me);

  return jsonb_build_object(
    'kept', p_keep, 'kept_name', b_keep.name,
    'merged', p_merge, 'merged_name', b_merge.name,
    'applications_repointed', v_apps, 'contacts_moved', v_contacts,
    'contacts_demoted', v_demoted, 'positions_moved', v_scopes,
    'home_branches_moved', v_homes, 'matches_repointed', v_matches,
    'deed_recipient_moved', coalesce(v_recipient, false)
  );
end $function$;

revoke all on function public.merge_branches(uuid, uuid, text) from public, anon;
grant execute on function public.merge_branches(uuid, uuid, text) to authenticated, service_role;

comment on function public.merge_branches(uuid, uuid, text) is
  'Join two offices that are the same office, keeping the first. Everything pointing at the merged one moves first -- applications and their denormalised agency, contacts, the deed recipient, positions, home branches and resolved tenant matches -- because three of the six foreign keys cascade and two set null, so a plain delete would quietly take people and nominations with it. Refuses across estates: two offices in two estates are two companies.';

/* =====================================================================
   AND THE BROWSER MAY CALL BOTH OF THEM, WHICH IT COULD NOT.

   FOUND BY TRYING IT, after writing the one above: as `authenticated`
   with an admin's claims, `merge_agencies` answers

       ERROR: 42501 permission denied for function merge_agencies

   It has never been granted to anybody but service_role. So the "Merge
   into" button added to Reconciliation yesterday with (ck) would have
   failed at the click, every time. The render test proved the button
   was drawn and the pgTAP proved the queue found the duplicate;
   nothing called the function as the browser calls it, which is the
   same gap (vv) and (cd) were.

   WHY GRANTING IT IS RIGHT RATHER THAN EXPEDIENT. Both functions are
   SECURITY DEFINER and both open with the same two lines every other
   admin RPC the browser calls opens with:

       is_aal2()   -- or 'MFA required'
       is_admin()  -- or 'not permitted'

   The grant decides who may ASK; those two decide who may DO. Leaving
   the grant off is not a second lock, it is the button not working.
   The pgTAP asserts both halves: an ordinary signed-in user is refused
   BY THE FUNCTION, not merely by the absence of a grant.
   ===================================================================== */
revoke all on function public.merge_agencies(uuid, uuid, text) from public, anon;
grant execute on function public.merge_agencies(uuid, uuid, text) to authenticated, service_role;
