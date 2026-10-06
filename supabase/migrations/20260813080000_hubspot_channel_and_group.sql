-- ===========================================================================
-- HubSpot: a pipeline per channel, and attribution down to brand and group.
--
-- WHAT WAS WRONG
-- The applicant field map hardcodes channel to the constant 'Partner Referral'
-- (20260705150500:69), with the note 'Owner-ruled constant'. That was true when
-- every application arrived one way. With four rails it labels a direct signup,
-- an agent referral and a provider hand-over all as partner referrals, so the
-- CRM cannot tell where any piece of business came from.
--
-- The company side already anticipated a group: company_level is
-- 'Group HQ / Brand | Branch' and network_group is seeded as
-- 'portal Group/network -> parent layer' (:101-103). It was fed from
-- agencies.group_name, free text with one writer and no update path. Now that a
-- real group exists it feeds from that instead, and falls back to the free text
-- so nothing that syncs today stops.
--
-- WHY DERIVED RATHER THAN A COLUMN ON applications
-- The channel is a function of the route, and the route is partner_id, which is
-- already on the row. A second column would be a copy that can disagree with it,
-- and the one thing worse than an unattributed CRM record is a confidently
-- wrongly-attributed one.
-- ===========================================================================

-- The channel a record should carry, from the route it arrived by.
create or replace function public.application_channel(p_application uuid)
returns text
language sql stable security definer set search_path to '' as $$
  select case
    when p.slug = 'opndoor-direct'       then 'Direct'
    when p.slug = 'referencing-partner'  then 'Provider hand-over'
    -- An application on a house route that is neither is still house business.
    when p.is_house_route                then 'Direct'
    -- Otherwise it came from a partner. An agent referral is one typed in the
    -- portal; a partner referral is one pushed through the API. The rail is the
    -- honest discriminator, and it is snapshotted on the row.
    when a.referencing_mode = 'opndoor_referenced' then 'Agent referral'
    else 'Partner referral'
  end
  from public.applications a
  join public.partners p on p.id = a.partner_id
  where a.id = p_application
$$;

comment on function public.application_channel(uuid) is
  'How this application arrived, for the CRM: Direct, Agent referral, Partner referral or Provider hand-over. DERIVED from the route rather than stored, because a second column would be a copy that can disagree, and a confidently wrong attribution is worse than none.';

revoke all on function public.application_channel(uuid) from public, anon;
grant execute on function public.application_channel(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Feed the field map from the new sources.
-- ---------------------------------------------------------------------------
-- The constant lives in `source` when source_kind is 'const'; there is no
-- separate value column. So this changes the KIND as well as the source.
update public.hubspot_field_map
   set source_kind = 'derived', source = 'channel',
       notes = 'Direct | Agent referral | Partner referral | Provider hand-over, derived from the route'
 where object = 'applicant' and hs_property = 'channel';

update public.hubspot_field_map
   set notes = 'portal group -> parent layer; agency_groups.name, falling back to agencies.group_name'
 where object = 'company' and hs_property = 'network_group';

-- Brand and group as their own properties, so a group with many brands can be
-- reported on without parsing a company name. Empty events means every event,
-- matching how the other always-on applicant properties are seeded.
insert into public.hubspot_field_map (object, hs_property, source_kind, source, transform, events, notes)
values
  ('applicant', 'brand_name', 'derived', 'brand_name', null, '{}', 'The agency the application belongs to'),
  ('applicant', 'group_name', 'derived', 'group_name', null, '{}', 'The group the brand belongs to, blank when it is not in one')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What the sync needs, in one read, so it does not join four tables per event.
-- ---------------------------------------------------------------------------
create or replace function public.application_attribution(p_application uuid)
returns table (channel text, brand_name text, group_name text, group_id uuid)
language sql stable security definer set search_path to '' as $$
  select
    public.application_channel(a.id),
    ag.name,
    coalesce(g.name, ag.group_name),
    g.id
  from public.applications a
  join public.agencies ag on ag.id = a.agency_id
  left join public.agency_groups g on g.id = ag.group_id
  where a.id = p_application
$$;

revoke all on function public.application_attribution(uuid) from public, anon;
grant execute on function public.application_attribution(uuid) to service_role;

do $$
declare v_kind text;
begin
  select source_kind into v_kind from public.hubspot_field_map
   where object = 'applicant' and hs_property = 'channel';
  if v_kind is distinct from 'derived' then
    raise exception 'channel is still a % ; every rail would be labelled the same', v_kind;
  end if;

  if not exists (select 1 from public.hubspot_field_map
                  where object = 'applicant' and hs_property in ('brand_name','group_name')) then
    raise exception 'brand and group attribution were not added';
  end if;
end $$;
