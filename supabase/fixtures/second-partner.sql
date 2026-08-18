-- ===========================================================================
-- The second-partner fixture.
--
-- WHY IT EXISTS: nothing in REGRESSION.md exercises a second partner. Every
-- lifecycle row runs against one partner, so every cross-partner property in
-- this system is currently asserted by reading the SQL rather than by running
-- anything. The four-rail work makes cross-partner behaviour load-bearing:
-- attribution, visibility, commission, webhooks and the CRM feed all key on
-- partner_id, and all of them are untested with more than one value in play.
--
-- Run against a DISPOSABLE project only. It writes real rows.
--
-- Creates:
--   partner  'fixture-alpha'  portal on,  API off   (stands in for an agency partner)
--   partner  'fixture-beta'   portal off, API on    (stands in for an API partner)
--   one agency + branch + primary contact under each
--
-- Deliberately NOT named after any real or potential partner. See the built
-- artefact check in section C: real names must never appear in a fixture that
-- somebody later copies into a seed.
-- ===========================================================================

do $$
declare
  a_partner uuid; b_partner uuid;
  a_agency  uuid; b_agency  uuid;
  a_branch  uuid; b_branch  uuid;
begin
  insert into public.partners (slug, name, status, live_from, partner_rate, agent_rate,
                               referencing_mode, portal_referrals_enabled, api_access_enabled)
  values ('fixture-alpha', 'Fixture Alpha Lettings', 'active', current_date, 0.25, 0.10,
          'pre_referenced_screened', true, false)
  on conflict (slug) do update set name = excluded.name
  returning id into a_partner;

  insert into public.partners (slug, name, status, live_from, partner_rate, agent_rate,
                               referencing_mode, portal_referrals_enabled, api_access_enabled)
  values ('fixture-beta', 'Fixture Beta Group', 'active', current_date, 0.20, 0.05,
          'pre_referenced_open', false, true)
  on conflict (slug) do update set name = excluded.name
  returning id into b_partner;

  insert into public.agencies (partner_id, name, review_state)
  values (a_partner, 'Fixture Alpha Agency', 'confirmed')
  returning id into a_agency;

  insert into public.agencies (partner_id, name, review_state)
  values (b_partner, 'Fixture Beta Agency', 'confirmed')
  returning id into b_agency;

  -- partner_id on branches is set by the branches_sync_partner trigger.
  insert into public.branches (agency_id, name) values (a_agency, 'Alpha Central') returning id into a_branch;
  insert into public.branches (agency_id, name) values (b_agency, 'Beta Central')  returning id into b_branch;

  -- has_agent_contact is what gates deed issuance, so both branches get a
  -- primary contact or half the lifecycle rows cannot run.
  insert into public.agent_contacts (branch_id, name, email, is_primary)
  values (a_branch, 'Alpha Contact', 'alpha-contact@example.invalid', true);
  insert into public.agent_contacts (branch_id, name, email, is_primary)
  values (b_branch, 'Beta Contact', 'beta-contact@example.invalid', true);

  raise notice 'fixture partners: alpha=% beta=%', a_partner, b_partner;
  raise notice 'fixture branches: alpha=% beta=%', a_branch, b_branch;
end $$;
