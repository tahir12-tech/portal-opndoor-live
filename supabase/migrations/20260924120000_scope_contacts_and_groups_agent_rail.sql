-- Close two cross-agency leaks on the AGENT RAIL.
--
-- THE HAZARD. `partner_id = app_partner()` is a tenant boundary on the SUPPLIER
-- rail, where one partner is one customer and a partner-wide mailbox model is the
-- point. It is NOT a boundary on the agent rail, where every independently
-- onboarded agency shares the one 'opndoor-agents' house partner. agencies,
-- branches and users were narrowed by position long ago; agent_contacts and
-- agency_groups were missed, so a Harborview manager could read -- and, for
-- contacts, UPDATE and DELETE -- Meridian's rows.
--
-- THE RULING. On the agent rail both narrow to the caller's position ladder. The
-- supplier rail keeps exactly what it has, byte for byte: its arm of every policy
-- below is the original predicate, unchanged.
--
-- WHY HELPERS. A policy expression that selects from another RLS-protected table
-- evaluates that table's RLS too, which both under-reports and risks recursion.
-- Every predicate below is therefore a SECURITY DEFINER helper, the same shape
-- app_scope_branches and partner_can_reach_agency already use.
--
-- SIGN-IN SAFETY. The login hydrate selects agent_contacts and agency_groups and
-- ABORTS on error, which is how the August partners-rate revocation broke
-- management sign-in. Narrowing a USING clause returns FEWER ROWS, never an
-- error; no grant is revoked here and no column is dropped. Sign-in is verified
-- for every role after this migration.

-- ---------------------------------------------------------------------------
-- Agencies the caller reaches BY POSITION. Deliberately excludes the
-- partner-wide fallback: on the agent rail that fallback is the leak.
-- A negotiator reaches the agency of their home branch and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.app_scoped_agencies()
returns setof uuid
language sql stable security definer set search_path to '' as $function$
  select a.id
  from public.agencies a
  where exists (
    select 1 from public.user_scopes s
    where s.user_id = auth.uid()
      and (   (s.kind = 'agency' and s.agency_id = a.id)
           or (s.kind = 'group'  and a.group_id is not null and s.group_id = a.group_id)
           or (s.kind = 'branch' and exists (
                 select 1 from public.branches b
                 where b.id = s.branch_id and b.agency_id = a.id)))
  )
  union
  select b.agency_id
  from public.users u
  join public.branches b on b.id = u.home_branch_id
  where u.id = auth.uid()
$function$;

comment on function public.app_scoped_agencies() is
  'Agencies the caller holds a position over (group, agency or branch scope), plus the agency of a negotiator''s home branch. Position only: it deliberately omits the partner-wide fallback, because on the agent rail every independent agency shares one house partner.';

revoke all on function public.app_scoped_agencies() from public, anon;
grant execute on function public.app_scoped_agencies() to authenticated;

-- May the caller reach this agency at all? Rail-aware: position on the agent
-- rail, the existing partner reach on the supplier rail.
create or replace function public.app_reachable_agency(p_agency uuid)
returns boolean
language sql stable security definer set search_path to '' as $function$
  select case
    when public.is_admin() or public.app_role() = 'opndoor_manager' then true
    when exists (
      select 1 from public.agencies a
      join public.partners p on p.id = a.partner_id
      where a.id = p_agency and p.referencing_mode = 'opndoor_referenced'
    ) then p_agency in (select public.app_scoped_agencies())
    else public.partner_can_reach_agency(p_agency)
  end
$function$;

revoke all on function public.app_reachable_agency(uuid) from public, anon;
grant execute on function public.app_reachable_agency(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- agent_contacts. A contact belongs to an agency directly, or to a branch and so
-- to that branch's agency.
-- ---------------------------------------------------------------------------
create or replace function public.app_may_reach_contact(p_agency uuid, p_branch uuid, p_partner uuid)
returns boolean
language sql stable security definer set search_path to '' as $function$
  with owner as (
    select coalesce(p_agency, (select b.agency_id from public.branches b where b.id = p_branch)) as agency_id
  )
  select case
    when public.is_admin() or public.app_role() = 'opndoor_manager' then true
    when exists (
      select 1 from owner o
      join public.agencies a on a.id = o.agency_id
      join public.partners p on p.id = a.partner_id
      where p.referencing_mode = 'opndoor_referenced'
    ) then (select public.app_reachable_agency(o.agency_id) from owner o)
    -- SUPPLIER RAIL: the original predicate, unchanged.
    else p_partner = public.app_partner()
  end
$function$;

revoke all on function public.app_may_reach_contact(uuid, uuid, uuid) from public, anon;
grant execute on function public.app_may_reach_contact(uuid, uuid, uuid) to authenticated;

drop policy if exists contacts_select on public.agent_contacts;
create policy contacts_select on public.agent_contacts for select to authenticated
using (
  public.is_admin()
  or (public.app_role() = any (array['management','referrer','developer'])
      and public.app_may_reach_contact(agency_id, branch_id, partner_id))
);

drop policy if exists contacts_insert on public.agent_contacts;
create policy contacts_insert on public.agent_contacts for insert to authenticated
with check (
  public.is_admin()
  or (public.app_role() = 'management'
      and public.app_may_reach_contact(agency_id, branch_id, partner_id))
);

drop policy if exists contacts_update on public.agent_contacts;
create policy contacts_update on public.agent_contacts for update to authenticated
using (
  public.is_admin()
  or (public.app_role() = 'management'
      and public.app_may_reach_contact(agency_id, branch_id, partner_id))
)
with check (
  public.is_admin()
  or (public.app_role() = 'management'
      and public.app_may_reach_contact(agency_id, branch_id, partner_id))
);

drop policy if exists contacts_delete on public.agent_contacts;
create policy contacts_delete on public.agent_contacts for delete to authenticated
using (
  public.is_admin()
  or (public.app_role() = 'management'
      and public.app_may_reach_contact(agency_id, branch_id, partner_id))
);

-- ---------------------------------------------------------------------------
-- agency_groups. On the agent rail: your OWN group only. A director reaches the
-- group they hold; an agency or branch manager reaches the group above them;
-- nobody reads a sibling's.
-- ---------------------------------------------------------------------------
create or replace function public.app_reachable_group(p_group uuid, p_partner uuid)
returns boolean
language sql stable security definer set search_path to '' as $function$
  select case
    when public.is_admin() or public.app_role() = 'opndoor_manager' then true
    when exists (
      select 1 from public.partners p
      where p.id = p_partner and p.referencing_mode = 'opndoor_referenced'
    ) then
      -- the group you hold a position over, even before it has any agencies...
      exists (select 1 from public.user_scopes s
               where s.user_id = auth.uid() and s.kind = 'group' and s.group_id = p_group)
      -- ...or the group sitting above an agency you reach.
      or exists (select 1 from public.agencies a
                  where a.group_id = p_group
                    and a.id in (select public.app_scoped_agencies()))
    -- SUPPLIER RAIL: the original predicate, unchanged.
    else p_partner = public.app_partner()
  end
$function$;

revoke all on function public.app_reachable_group(uuid, uuid) from public, anon;
grant execute on function public.app_reachable_group(uuid, uuid) to authenticated;

drop policy if exists agency_groups_select on public.agency_groups;
create policy agency_groups_select on public.agency_groups for select to authenticated
using (public.is_admin() or public.app_reachable_group(id, partner_id));
