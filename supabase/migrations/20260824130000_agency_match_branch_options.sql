-- ===========================================================================
-- Branch options for the agency-match panel.
--
-- Resolving a direct match means an admin picks a branch of the matched agency.
-- The client org tree is partner-scoped, but a direct application's matched
-- agency may belong to another partner, so the admin needs its branches without
-- a cross-partner org load. This definer function returns them, admin only.
--
-- Read-only, cross-partner by design, and narrow: branch id, name and area for
-- one agency. It exposes nothing about applications, contacts or volumes.
-- ===========================================================================
create or replace function public.agency_branches_for_match(p_agency uuid)
returns table (branch_id uuid, name text, area text)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select b.id, b.name, b.area
      from public.branches b
     where b.agency_id = p_agency
       and not b.is_placeholder
       and b.livemode
     order by b.name;
end $fn$;

comment on function public.agency_branches_for_match(uuid) is
  'The real branches of one agency, for the direct agency-match panel branch picker. Admin only, cross-partner, read-only.';

revoke all on function public.agency_branches_for_match(uuid) from public, anon;
grant execute on function public.agency_branches_for_match(uuid) to authenticated, service_role;
