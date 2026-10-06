-- ===========================================================================
-- Merging two agency records into one, relationship-aware.
--
-- WHY THIS SHIPS WITH SHARING RATHER THAN AFTER IT
-- Before sharing, a duplicate agency was untidy: two rows, two partners, each
-- seeing their own. After sharing it is a correctness problem, because the
-- whole promise is "one agency, one org record, however many routes reach it".
-- Two rows for one real agency means two sets of reachability, two contact
-- books that never meet, and a referral form that offers the same agency twice.
--
-- And a merge under sharing is a bigger act than it was: it unions two sets of
-- partner relationships, so a partner who could reach only one of the rows can
-- afterwards reach the survivor. That is correct, and it is also a disclosure,
-- which is why this is admin-only, audited, and refuses more than it guesses.
--
-- WHAT IT MOVES AND WHAT IT DELIBERATELY DOES NOT
--   moves    branches, applications, relationships (unioned), attachments
--   moves    contacts, KEEPING their partner_id exactly as it is
--   never    reassigns a contact to another partner. The contact book is the
--            one thing sharing does not share (20260812120000), and a merge is
--            not a loophole in that.
-- ===========================================================================

create or replace function public.merge_agencies(p_keep uuid, p_merge uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  a_keep public.agencies; a_merge public.agencies;
  v_branches int := 0; v_apps int := 0; v_contacts int := 0;
  v_rels int := 0; v_attach int := 0; v_renamed jsonb := '[]'::jsonb;
  r record; v_new_name text; who text; me uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_keep = p_merge then raise exception 'Cannot merge an agency into itself' using errcode = '22023'; end if;

  select * into a_keep  from public.agencies where id = p_keep;
  if not found then raise exception 'Surviving agency not found' using errcode = '22023'; end if;
  select * into a_merge from public.agencies where id = p_merge;
  if not found then raise exception 'Merged agency not found' using errcode = '22023'; end if;

  -- Placeholders are not agencies and must never be merged with one. Merging a
  -- house row would attach every direct application to a real letting agency.
  if a_keep.is_placeholder or a_merge.is_placeholder then
    raise exception 'Placeholder agencies cannot be merged' using errcode = '22023';
  end if;

  me := auth.uid();
  select full_name into who from public.users where id = me;

  -- ---- branches -----------------------------------------------------------
  -- unique (agency_id, name) means a name collision would abort the whole
  -- merge. Rather than refuse, the incoming branch is suffixed with where it
  -- came from and the rename is reported, because two branches that genuinely
  -- share a name are usually two real offices and losing one is worse than an
  -- ugly name a human can tidy.
  for r in select id, name from public.branches where agency_id = p_merge loop
    v_new_name := r.name;
    if exists (select 1 from public.branches b where b.agency_id = p_keep and b.name = r.name) then
      v_new_name := r.name || ' (' || a_merge.name || ')';
      -- Still colliding after the suffix: give up on prettiness, stay unique.
      if exists (select 1 from public.branches b where b.agency_id = p_keep and b.name = v_new_name) then
        v_new_name := v_new_name || ' ' || left(r.id::text, 8);
      end if;
      v_renamed := v_renamed || jsonb_build_object('branch', r.id, 'from', r.name, 'to', v_new_name);
    end if;
    update public.branches set agency_id = p_keep, name = v_new_name where id = r.id;
    v_branches := v_branches + 1;
  end loop;

  -- ---- applications -------------------------------------------------------
  -- agency_id is denormalised onto applications and is normally maintained by
  -- applications_sync_partner, which only fires on insert or on a branch_id
  -- update. Moving the branch does not rewrite history, so the rows are
  -- repointed here. partner_id is NOT touched: that is the ROUTE, and a merge
  -- of two org records does not change how any application arrived.
  update public.applications set agency_id = p_keep where agency_id = p_merge;
  get diagnostics v_apps = row_count;

  -- ---- contacts -----------------------------------------------------------
  -- partner_id is deliberately left alone. Each contact stays in the book of
  -- the partner that created it.
  update public.agent_contacts set agency_id = p_keep where agency_id = p_merge;
  get diagnostics v_contacts = row_count;

  -- ---- relationships ------------------------------------------------------
  -- Unioned: a partner who could reach either row can reach the survivor, and
  -- the reasons are OR-ed so nothing is downgraded.
  insert into public.partner_agency_relationships
    (partner_id, agency_id, introduced, user_attached, transacted, first_seen_at)
  select r2.partner_id, p_keep, r2.introduced, r2.user_attached, r2.transacted, r2.first_seen_at
  from public.partner_agency_relationships r2
  where r2.agency_id = p_merge
  on conflict (partner_id, agency_id) do update
    set introduced    = public.partner_agency_relationships.introduced    or excluded.introduced,
        user_attached = public.partner_agency_relationships.user_attached or excluded.user_attached,
        transacted    = public.partner_agency_relationships.transacted    or excluded.transacted,
        first_seen_at = least(public.partner_agency_relationships.first_seen_at, excluded.first_seen_at),
        updated_at    = now();
  get diagnostics v_rels = row_count;
  delete from public.partner_agency_relationships where agency_id = p_merge;

  -- ---- user attachments ---------------------------------------------------
  insert into public.user_agency_attachments (user_id, agency_id, created_by)
  select ua.user_id, p_keep, ua.created_by
  from public.user_agency_attachments ua
  where ua.agency_id = p_merge
  on conflict (user_id, agency_id) do nothing;
  get diagnostics v_attach = row_count;
  delete from public.user_agency_attachments where agency_id = p_merge;

  -- ---- the merged row goes ------------------------------------------------
  delete from public.agencies where id = p_merge;

  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_keep, 'merged',
          format('Merged "%s" into "%s"%s', a_merge.name, a_keep.name,
                 case when coalesce(btrim(p_note),'') = '' then '' else ': ' || btrim(p_note) end),
          coalesce(who, 'opndoor admin'), me);

  return jsonb_build_object(
    'kept', p_keep, 'kept_name', a_keep.name,
    'merged', p_merge, 'merged_name', a_merge.name,
    'branches_moved', v_branches, 'applications_repointed', v_apps,
    'contacts_moved', v_contacts, 'relationships_unioned', v_rels,
    'attachments_moved', v_attach, 'branches_renamed', v_renamed
  );
end $function$;

comment on function public.merge_agencies(uuid, uuid, text) is
  'Merges one agency record into another. Unions partner relationships, repoints applications and branches, and moves contacts WITHOUT reassigning their partner: a merge is not a loophole in the rule that sharing an agency never shares a contact book. Admin plus AAL2, audited, refuses placeholders.';

revoke all on function public.merge_agencies(uuid, uuid, text) from public, anon;
grant execute on function public.merge_agencies(uuid, uuid, text) to authenticated;
