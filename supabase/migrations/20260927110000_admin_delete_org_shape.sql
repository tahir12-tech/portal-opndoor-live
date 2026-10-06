-- Undo a half-made org when a creation flow fails part way.
--
-- Standing up a group is several statements plus an edge-function invite, and the
-- invite cannot join the database transaction. So the flow creates the org, sends
-- the invite last, and calls this when the invite fails -- including when
-- invite-user refuses the position grant and rolls its own user back. Without it
-- a refused grant would leave a group and its agencies behind with nobody in them,
-- which is exactly the half-made state the fatal-grant rule exists to prevent.
--
-- REFUSES TO DELETE ANYTHING REAL. Only an org with no applications against it can
-- be removed, so this can never be turned into a way to erase history. Branches,
-- contacts and positions go by cascade; a group is removed only when it is left
-- empty.
create or replace function public.admin_delete_org_shape(p_agency_ids uuid[], p_group_id uuid default null)
returns table (agencies_removed int, group_removed boolean)
language plpgsql security definer set search_path to ''
as $function$
declare v_apps int; v_ag int; v_grp boolean := false;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  select count(*) into v_apps
  from public.applications a
  where a.agency_id = any(coalesce(p_agency_ids, '{}'::uuid[]));
  if v_apps > 0 then
    raise exception 'REFUSING: % application(s) already exist against these agencies.', v_apps
      using errcode = '22023';
  end if;

  with gone as (
    delete from public.agencies
     where id = any(coalesce(p_agency_ids, '{}'::uuid[]))
    returning id
  )
  select count(*) into v_ag from gone;

  -- The group goes only if nothing else was moved into it meanwhile.
  if p_group_id is not null
     and not exists (select 1 from public.agencies a where a.group_id = p_group_id) then
    delete from public.agency_groups where id = p_group_id;
    v_grp := true;
  end if;

  return query select v_ag, v_grp;
end $function$;

comment on function public.admin_delete_org_shape(uuid[], uuid) is
  'Rollback for a partly-created org shape: removes the named agencies (branches, contacts and positions cascade) and the group if it is left empty. Refuses if any application exists against them, so it can never erase history.';

revoke all on function public.admin_delete_org_shape(uuid[], uuid) from public, anon;
grant execute on function public.admin_delete_org_shape(uuid[], uuid) to authenticated;
