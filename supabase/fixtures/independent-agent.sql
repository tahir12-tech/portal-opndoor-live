-- ===========================================================================
-- The small independent: one brand, one branch, one person.
--
-- WHY IT EXISTS. The collapse rule has four cases and only three of them had
-- data. This is the case the rule was written FOR: somebody who should never be
-- shown a brand list of one and a branch list of one. Without a fixture, "asks
-- nothing" was a branch of a CASE statement nobody had executed.
--
-- Disposable projects only. Invented name.
-- ===========================================================================

do $$
declare v_partner uuid; v_agency uuid; v_branch uuid;
begin
  insert into public.partners (slug, name, status, live_from, referencing_mode,
                               portal_referrals_enabled, refers_own_stock)
  values ('harbour-lets', 'Harbour Lets', 'active', current_date,
          'opndoor_referenced', true, true)
  on conflict (slug) do update set refers_own_stock = true;
  select id into v_partner from public.partners where slug = 'harbour-lets';

  insert into public.agencies (partner_id, name, review_state)
  values (v_partner, 'Harbour Lets', 'confirmed')
  on conflict (partner_id, name) do nothing;
  select id into v_agency from public.agencies where partner_id = v_partner and name = 'Harbour Lets';

  insert into public.branches (agency_id, name, review_state)
  values (v_agency, 'Harbour Lets', 'confirmed')
  on conflict (agency_id, name) do nothing;
  select id into v_branch from public.branches where agency_id = v_agency;

  insert into public.agent_contacts (partner_id, branch_id, name, email, is_primary)
  select v_partner, v_branch, 'Harbour Lets', 'lettings@harbourlets.invalid', true
   where not exists (select 1 from public.agent_contacts c where c.branch_id = v_branch);
end $$;

-- ---------------------------------------------------------------------------
-- An agent that can actually reach the API.
--
-- WHY A SECOND ONE. createApplication dispatches on referencing_mode as its
-- FIRST act and returns 501 for opndoor_referenced, before the org is resolved
-- at all. Both agent fixtures above that point are opndoor_referenced, so the
-- "an agent may omit agency_name" shortcut could never execute and was
-- effectively unreachable code.
--
-- This is also the realistic shape for an agency with an integration: they do
-- their own referencing and send us the failures, which is pre_referenced_open.
-- ---------------------------------------------------------------------------
do $$
declare v_partner uuid; v_agency uuid; v_branch uuid;
begin
  insert into public.partners (slug, name, status, live_from, referencing_mode,
                               portal_referrals_enabled, api_access_enabled, refers_own_stock)
  values ('kestrel-lettings', 'Kestrel Lettings', 'active', current_date,
          'pre_referenced_open', true, true, true)
  on conflict (slug) do update set
    refers_own_stock = true, api_access_enabled = true, referencing_mode = 'pre_referenced_open';
  select id into v_partner from public.partners where slug = 'kestrel-lettings';

  insert into public.agencies (partner_id, name, review_state)
  values (v_partner, 'Kestrel Lettings', 'confirmed')
  on conflict (partner_id, name) do nothing;
  select id into v_agency from public.agencies where partner_id = v_partner and name = 'Kestrel Lettings';

  -- Several branches, so the agency collapses and the branch does not. That is
  -- the case where omitting agency_name is a real saving on every call.
  insert into public.branches (agency_id, name, review_state) values
    (v_agency, 'Kestrel Central', 'confirmed'),
    (v_agency, 'Kestrel Riverside', 'confirmed')
  on conflict (agency_id, name) do nothing;

  insert into public.agent_contacts (partner_id, branch_id, name, email, is_primary)
  select v_partner, b.id, b.name, lower(replace(b.name,' ','.'))||'@kestrel.invalid', true
    from public.branches b
   where b.agency_id = v_agency
     and not exists (select 1 from public.agent_contacts c where c.branch_id = b.id);
end $$;
