-- Deed delivery for the AGENT RAIL resolves from the org's PEOPLE.
--
-- For an agent-rail application (partner referencing_mode = 'opndoor_referenced')
-- the deed goes to one of the org's own users, in order: a nominated deed recipient
-- (branch_deed_recipient), else the branch manager, else the agency manager, else the
-- group manager above. This is what point 11's nomination and point 4's warning read.
--
-- SAFETY: supplier-introduced rails (pre_referenced_*) are BYTE-IDENTICAL to before —
-- the people lateral only joins for opndoor_referenced, so for a supplier application
-- it is null and the resolver falls straight through to the existing
-- coalesce(delivery_contact, route_contact, branch_contact) chain. The Rightmove
-- referral path is untouched. For an agent-rail application the people answer is
-- merely PREFERRED and still falls back to the agent_contacts chain, so nothing that
-- delivers today stops delivering; the "no one to receive the deed" warning is a
-- separate, people-based signal surfaced in the UI.

-- First user found for a branch, most specific first: nominated recipient, then the
-- branch / agency / group manager above it. Excludes deactivated users.
create or replace function public.deed_people_target(p_branch uuid)
returns table (email text, display_name text)
language sql stable security definer set search_path to '' as $function$
  with b as (
    select br.id as branch_id, br.agency_id, ag.group_id
    from public.branches br
    left join public.agencies ag on ag.id = br.agency_id
    where br.id = p_branch
  ),
  cand as (
    select 1 as pri, u.email, u.full_name
    from b join public.branch_deed_recipient r on r.branch_id = b.branch_id
           join public.users u on u.id = r.user_id
    where u.status <> 'deactivated'
    union all
    select 2, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'branch' and s.branch_id = b.branch_id
           join public.users u on u.id = s.user_id
    where u.status <> 'deactivated'
    union all
    select 3, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'agency' and s.agency_id = b.agency_id
           join public.users u on u.id = s.user_id
    where u.status <> 'deactivated'
    union all
    select 4, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'group' and s.group_id = b.group_id
           join public.users u on u.id = s.user_id
    where u.status <> 'deactivated'
  )
  select email, full_name from cand order by pri asc, email asc limit 1
$function$;
revoke all on function public.deed_people_target(uuid) from public, anon;
grant execute on function public.deed_people_target(uuid) to authenticated, service_role;

-- The route resolver, now people-first for the agent rail only.
create or replace function public.deed_delivery_target(p_application uuid)
returns table (email text, display_name text, source text, verified boolean)
language sql stable security definer set search_path to '' as $$
  select
    coalesce(pe.email, d.email, rc.email, c.email),
    coalesce(
      pe.display_name,
      nullif(btrim(coalesce(d.agency_name, '')), ''),
      nullif(btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
      rc.name, c.name
    ),
    case
      when pe.email is not null           then 'org_person'
      when d.application_id is not null    then 'delivery_contact'
      when rc.id is not null               then 'route_contact'
      else 'branch_contact'
    end,
    case
      when pe.email is not null            then true
      when d.application_id is not null     then d.verified_at is not null
      else true
    end
  from public.applications a
  join public.partners pa on pa.id = a.partner_id
  -- People only for the agent rail; null for every supplier application, so their
  -- resolution is byte-identical to before.
  left join lateral (
    select * from public.deed_people_target(a.branch_id)
    where pa.referencing_mode = 'opndoor_referenced'
  ) pe on true
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral (
    select * from public.effective_primary_contact_route(a.branch_id, a.partner_id)
  ) rc on true
  left join lateral (
    select * from public.effective_primary_contact(a.branch_id)
  ) c on true
  where a.id = p_application
$$;

comment on function public.deed_delivery_target(uuid) is
  'Where an executed deed goes. Agent rail (opndoor_referenced): the org''s people — a nominated deed recipient, else the branch/agency/group manager — then the agent_contacts chain as a fallback. Supplier rails: the tenant-named delivery contact, else the route-scoped branch primary, else the unscoped branch primary (byte-identical to before). source says which was used.';

-- Supplier-path invariant unchanged: route-scoped and unscoped primaries must still
-- agree everywhere until org sharing is used.
do $$
declare v_diff int;
begin
  select count(*) into v_diff
  from public.applications a
  where a.branch_id is not null
    and (select email from public.effective_primary_contact_route(a.branch_id, a.partner_id)) is not null
    and (select email from public.effective_primary_contact_route(a.branch_id, a.partner_id))
        is distinct from (select email from public.effective_primary_contact(a.branch_id));
  if v_diff > 0 then
    raise warning 'ROUTE CONTACT DIFFERS from the unscoped primary on % application(s). Investigate.', v_diff;
  end if;
end $$;
