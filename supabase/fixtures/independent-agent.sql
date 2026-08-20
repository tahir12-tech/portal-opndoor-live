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
