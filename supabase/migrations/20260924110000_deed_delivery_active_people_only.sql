-- A deed never goes to somebody who has not accepted their invitation.
--
-- deed_people_target excluded only 'deactivated', so a PENDING manager — invited,
-- never signed in, no password — was a live delivery target for an executed Deed
-- of Guarantee. Harborview Lettings, whose only manager is pending, would have had
-- a tenant's executed deed emailed to an account that cannot be opened.
--
-- TWO CHANGES, deliberately separated:
--
-- 1. deed_people_target resolves only ACTIVE users. Pending and deactivated are
--    both excluded. This is the rung-by-rung ladder, unchanged otherwise:
--    nominated recipient, then branch, then agency, then group.
--
-- 2. deed_delivery_target gains auto_send. Its EMAIL is deliberately UNCHANGED on
--    every rail, because that column is also the generation precondition
--    (_shared/pandadoc.ts refuses to generate a deed with nowhere to land, and
--    setting deed_state='error' there would stop agent-rail deeds being issued at
--    all). auto_send answers the separate question the webhook actually needs:
--    may this be delivered automatically, or must a human send it?
--
--      supplier rails            -> true, byte-identical to today.
--      direct rail (tenant named
--        a delivery contact)     -> true, byte-identical to today.
--      agent rail                -> only when an ACTIVE org person resolved.
--
--    The agent rail is distinguished from the direct rail by the presence of a
--    tenant-named application_delivery_contacts row, which only the tenant portal
--    writes: on this database every direct application has one and no agent-rail
--    application does.
--
-- When auto_send is false the webhook records a deed_delivery_failed activity
-- entry instead of emailing, which is the SAME needs-attention surface the direct
-- rail already falls back to. Nothing is sent silently and nothing is lost.
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
    where u.status = 'active'
    union all
    select 2, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'branch' and s.branch_id = b.branch_id
           join public.users u on u.id = s.user_id
    where u.status = 'active'
    union all
    select 3, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'agency' and s.agency_id = b.agency_id
           join public.users u on u.id = s.user_id
    where u.status = 'active'
    union all
    select 4, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'group' and s.group_id = b.group_id
           join public.users u on u.id = s.user_id
    where u.status = 'active'
  )
  select email, full_name from cand order by pri asc, email asc limit 1
$function$;

comment on function public.deed_people_target(uuid) is
  'First ACTIVE user who can receive a deed for a branch, most specific first: nominated recipient, then the branch, agency or group manager above it. Pending and deactivated users are excluded -- somebody who has not accepted their invitation cannot receive anything.';

revoke all on function public.deed_people_target(uuid) from public, anon;
grant execute on function public.deed_people_target(uuid) to authenticated, service_role;

-- A new OUT column changes the return type, so the old signature must go first.
drop function if exists public.deed_delivery_target(uuid);
create or replace function public.deed_delivery_target(p_application uuid)
returns table (email text, display_name text, source text, verified boolean, auto_send boolean)
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
    end,
    -- May this be delivered without a human? See the header.
    case
      when pa.referencing_mode <> 'opndoor_referenced' then true
      when d.application_id is not null                then true
      else pe.email is not null
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
  'Where an executed deed goes. Agent rail (opndoor_referenced): the org''s ACTIVE people -- a nominated deed recipient, else the branch/agency/group manager -- then the agent_contacts chain as a fallback for generation only. Supplier rails: the tenant-named delivery contact, else the route-scoped branch primary, else the unscoped branch primary (byte-identical to before). source says which was used. auto_send is false when an agent-rail deed has no ACTIVE person to receive it, so the webhook records it for a staff send instead of emailing it.';

-- The grant shape is asserted elsewhere (20260815020000): this stays revoked from
-- authenticated and callable only by the service role.
revoke all on function public.deed_delivery_target(uuid) from public, anon, authenticated;
grant execute on function public.deed_delivery_target(uuid) to service_role;
