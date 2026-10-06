-- The Opndoor Agents house partner: the home for letting agencies that refer
-- into their own managed stock. Created the same way opndoor-direct was (a
-- partner row plus an "Unattached" placeholder agency and branch, because
-- applications carries NOT NULL foreign keys to both), with refers_own_stock =
-- true and referencing_mode = 'opndoor_referenced' (the agent-referral rail).
--
-- meridian-group's whole estate then moves under it, so the existing dev test
-- accounts keep working; from here on Opndoor staff onboard new agencies through
-- the product (Agencies & branches -> add agency -> add branch -> invite the
-- first manager), no SQL. The partner rate matches meridian-group's old value so
-- any agency or group that inherits (rather than overrides) keeps the same
-- figure. Additive: the Rightmove referral path is untouched. Safe on a project
-- with no meridian-group (the move is guarded).
do $$
declare
  v_agents uuid;
  v_meridian uuid;
begin
  insert into public.partners (slug, name, status, live_from, partner_rate, agent_rate,
                               referencing_mode, portal_referrals_enabled, api_access_enabled, refers_own_stock)
  values ('opndoor-agents', 'Opndoor Agents', 'active', current_date, 0.25, 0.10,
          'opndoor_referenced', true, false, true)
  on conflict (slug) do update
    set refers_own_stock = true, referencing_mode = 'opndoor_referenced', portal_referrals_enabled = true;
  select id into v_agents from public.partners where slug = 'opndoor-agents';

  -- Placeholder org, the shape opndoor-direct got. branches.partner_id is set by
  -- the branches_sync_partner trigger from the agency, so it is not listed here.
  insert into public.agencies (partner_id, name, review_state)
  values (v_agents, 'Unattached', 'confirmed')
  on conflict (partner_id, name) do nothing;
  insert into public.branches (agency_id, name, review_state)
  select a.id, 'Unattached', 'confirmed'
  from public.agencies a
  where a.partner_id = v_agents and a.name = 'Unattached'
  on conflict (agency_id, name) do nothing;

  -- Move meridian-group's estate under Opndoor Agents. branches.partner_id and
  -- agent_contacts.partner_id are denormalised and their sync trigger fires only
  -- on an agency_id change, so re-point them explicitly to match. user_scopes
  -- reference agency/branch/group ids (unchanged), so positions survive the move.
  select id into v_meridian from public.partners where slug = 'meridian-group';
  if v_meridian is not null then
    update public.agency_groups  set partner_id = v_agents where partner_id = v_meridian;
    update public.agencies       set partner_id = v_agents where partner_id = v_meridian;
    update public.branches       set partner_id = v_agents where partner_id = v_meridian;
    update public.agent_contacts set partner_id = v_agents where partner_id = v_meridian;
    update public.applications   set partner_id = v_agents where partner_id = v_meridian;
    update public.users          set partner_id = v_agents where partner_id = v_meridian;
  end if;
end $$;
