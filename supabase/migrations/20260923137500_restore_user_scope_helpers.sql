-- Restore user-scope helper functions expected by later user-management RPCs.
-- The source migrations are recorded as applied in the testing database,
-- but these functions are missing from the actual schema.

create or replace function public.app_scope_branches_for(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select b.id
  from public.user_scopes s
  join public.agencies a on a.group_id = s.group_id
  join public.branches b on b.agency_id = a.id
  where s.user_id = p_user
    and s.kind = 'group'

  union

  select b.id
  from public.user_scopes s
  join public.branches b on b.agency_id = s.agency_id
  where s.user_id = p_user
    and s.kind = 'agency'

  union

  select s.branch_id
  from public.user_scopes s
  where s.user_id = p_user
    and s.kind = 'branch';
$function$;

revoke all on function public.app_scope_branches_for(uuid) from public, anon;
grant execute on function public.app_scope_branches_for(uuid) to authenticated, service_role;


create or replace function public.app_user_in_scope(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_user = auth.uid()
    or (
      public.app_has_scope()
      and (
        -- placed at invite: their home branch is one of mine
        exists (
          select 1
          from public.users u
          where u.id = p_user
            and u.home_branch_id in (
              select public.app_scope_branches()
            )
        )

        -- a referrer located by where they have referred
        or exists (
          select 1
          from public.applications a
          where a.referrer_id = p_user
            and a.branch_id in (
              select public.app_scope_branches()
            )
        )

        -- a colleague attached to one of my branches
        or exists (
          select 1
          from public.user_agency_attachments ua
          join public.branches b
            on b.agency_id = ua.agency_id
          where ua.user_id = p_user
            and b.id in (
              select public.app_scope_branches()
            )
        )

        -- a manager whose own position overlaps mine
        or exists (
          select 1
          from public.app_scope_branches_for(p_user) x
          where x in (
            select public.app_scope_branches()
          )
        )
      )
    );
$function$;

revoke all on function public.app_user_in_scope(uuid) from public, anon;
grant execute on function public.app_user_in_scope(uuid) to authenticated, service_role;