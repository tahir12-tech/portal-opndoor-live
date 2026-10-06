-- M3. AN AGENCY CHOOSES ITS OWN REFERENCING ROUTE.
--
-- referencing_mode decides a real fork: 'opndoor_referenced' puts the application
-- in draft, mints a tenant invite and creates NO Stripe session, so the tenant
-- goes through eligibility; the pre_referenced_* modes go straight to 'sent' with
-- Checkout, payment emails, reminders and the 15-day lapse. Today that choice is
-- made once per PARTNER, which is right on a supplier rail (one partner is one
-- customer) and meaningless on the agent rail, where every independently
-- onboarded agency shares the one house partner and they may legitimately differ.
--
-- So the mode becomes a per-agency override, resolved agency-then-route-partner
-- and snapshotted onto the application exactly as it already is. Nothing about
-- how the mode is CONSUMED changes: applications.referencing_mode remains the
-- single thing every downstream reader looks at.
--
-- SAFE BY CONSTRUCTION. The column is null everywhere on arrival, so every
-- resolution returns precisely the partner mode it returns today.
alter table public.agencies
  add column if not exists referencing_mode text;
alter table public.agencies drop constraint if exists agencies_referencing_mode_check;
alter table public.agencies add constraint agencies_referencing_mode_check
  check (referencing_mode is null
         or referencing_mode in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced'));

comment on column public.agencies.referencing_mode is
  'This agency''s own referencing route, overriding its partner. NULL means inherit, which is every agency until one is set deliberately.';

grant select (referencing_mode) on public.agencies to authenticated;

-- ---------------------------------------------------------------------------
-- The resolution, in one place: the agency if it has said, else the route partner.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_referencing_mode(p_branch uuid, p_route_partner uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select a.referencing_mode
       from public.branches b
       join public.agencies a on a.id = b.agency_id
      where b.id = p_branch),
    (select p.referencing_mode from public.partners p where p.id = p_route_partner)
  )
$function$;

comment on function public.resolve_referencing_mode(uuid, uuid) is
  'The referencing route for a referral: the agency''s own mode if it has one, else the route partner''s. Snapshotted onto the application at creation, which is what every downstream reader uses.';

revoke all on function public.resolve_referencing_mode(uuid, uuid) from public, anon;
grant execute on function public.resolve_referencing_mode(uuid, uuid) to authenticated, service_role;

-- Setting it. Admin only, like every other org-shape change.
create or replace function public.set_agency_referencing_mode(p_agency uuid, p_mode text)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_mode is not null and p_mode not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Unknown referencing mode %', p_mode using errcode = '22023';
  end if;
  update public.agencies set referencing_mode = p_mode where id = p_agency;
end $function$;

revoke all on function public.set_agency_referencing_mode(uuid, text) from public, anon;
grant execute on function public.set_agency_referencing_mode(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- AUDIT FIX 1: deed_delivery_target read the mode from the application's PARTNER
-- when it means the APPLICATION. The application already carries its own
-- snapshot, which is the correct and more specific source; with per-agency modes
-- the partner's answer can now differ from the application's.
-- Behaviour today is unchanged, because the two agree until an override is set.
-- ---------------------------------------------------------------------------
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
    case
      when a.referencing_mode <> 'opndoor_referenced' then true
      when d.application_id is not null               then true
      else pe.email is not null
    end
  from public.applications a
  -- People only for the agent rail; keyed on the APPLICATION's own mode.
  left join lateral (
    select * from public.deed_people_target(a.branch_id)
    where a.referencing_mode = 'opndoor_referenced'
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
  'Where an executed deed goes, keyed on the APPLICATION''s own referencing_mode rather than its partner''s, so a per-agency route resolves correctly. Agent rail: the org''s ACTIVE people, then the agent_contacts chain for generation only. Supplier rails unchanged. auto_send is false when an agent-rail deed has no active person to receive it.';

revoke all on function public.deed_delivery_target(uuid) from public, anon, authenticated;
grant execute on function public.deed_delivery_target(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- AUDIT FIX 2: org_deed_readiness decided "is this the agent rail?" from the
-- agency's PARTNER. An agency that has opted into eligibility is on the agent
-- rail whatever its partner says, and one that has opted out is not.
-- ---------------------------------------------------------------------------
create or replace function public.org_deed_readiness()
returns table (agency_id uuid, branch_id uuid, ready boolean)
language sql stable security definer set search_path to ''
as $function$
  with vis_agency as (
    select a.id, a.group_id
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    -- The agency's own mode wins; its partner's is the fallback.
    where coalesce(a.referencing_mode, p.referencing_mode) = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() in ('management','referrer','developer')
               and case
                     when public.app_has_scope()
                       then a.id in (select b.agency_id from public.branches b
                                      where b.id in (select public.app_scope_branches()))
                     else public.partner_can_reach_agency(a.id)
                   end))
  ),
  vis_branch as (
    select b.id, b.agency_id
    from public.branches b
    where public.is_admin()
       or (public.app_role() in ('management','referrer','developer')
           and case
                 when public.app_has_scope()
                   then b.id in (select public.app_scope_branches())
                 else public.partner_can_reach_agency(b.agency_id)
               end)
  ),
  act as (
    select s.kind, s.branch_id, s.agency_id, s.group_id
    from public.user_scopes s
    join public.users u on u.id = s.user_id
    where u.status = 'active'
  ),
  nom as (
    select r.branch_id
    from public.branch_deed_recipient r
    join public.users u on u.id = r.user_id
    where u.status = 'active'
  ),
  above as (
    select va.id as agency_id,
           (exists (select 1 from act where act.kind = 'agency' and act.agency_id = va.id)
         or exists (select 1 from act where act.kind = 'group'  and act.group_id  = va.group_id
                    and va.group_id is not null)) as covered
    from vis_agency va
  ),
  branch_row as (
    select vb.agency_id, vb.id as branch_id,
           (ab.covered
         or exists (select 1 from nom where nom.branch_id = vb.id)
         or exists (select 1 from act where act.kind = 'branch' and act.branch_id = vb.id)) as ready
    from vis_branch vb
    join above ab on ab.agency_id = vb.agency_id
  )
  select agency_id, branch_id, ready from branch_row
  union all
  select ab.agency_id, null::uuid,
         ab.covered or exists (select 1 from branch_row br
                                where br.agency_id = ab.agency_id and br.ready)
  from above ab
$function$;

revoke all on function public.org_deed_readiness() from public, anon;
grant execute on function public.org_deed_readiness() to authenticated;

-- ---------------------------------------------------------------------------
-- INERTNESS GUARD. No agency has an override, so every branch must resolve to
-- exactly the mode its partner already gives it.
-- ---------------------------------------------------------------------------
do $$
declare v_diff int; v_over int;
begin
  select count(*) into v_over from public.agencies where referencing_mode is not null;

  select count(*) into v_diff
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where public.resolve_referencing_mode(b.id, b.partner_id) is distinct from p.referencing_mode;

  if v_over = 0 and v_diff > 0 then
    raise exception 'REFUSING: % branch(es) resolve to a different mode than their partner with no override set.', v_diff;
  end if;
  raise notice 'Per-agency referencing added: % override(s) set, % branch(es) differing from their partner.', v_over, v_diff;
end $$;
