-- ===========================================================================
-- A walkable letting-agency group.
--
-- WHY THIS EXISTS. The agent referral path forks on referencing_mode. A partner
-- on 'opndoor_referenced' sends the tenant an INVITE into the applicant journey;
-- one on 'pre_referenced_open' sends a payment link. Before this fixture, every
-- partner on the project with portal referrals enabled was pre_referenced_open,
-- so the agent path had nothing to run against and could not be seen at all.
--
-- It builds the third shape from the brief, the one a flat model cannot hold: a
-- group over two brands on DIFFERENT rates, branches under each, and people at
-- three levels of visibility.
--
-- DISPOSABLE PROJECTS ONLY. Invented names throughout, and the password below is
-- printed in a repo file, so this must never run anywhere real.
--
-- Idempotent: re-running changes nothing.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Creates a signable staff identity, or returns the existing one.
--
-- public.users.id is a foreign key to auth.users, so a staff row cannot be
-- inserted on its own. HANDOVER item 34: the token columns must be '' and not
-- NULL, because GoTrue scans them into non-nullable Go strings and every
-- sign-in fails with 'Database error querying schema' otherwise.
--
-- Fixture-only. Dropped at the end of this script so it cannot be called by
-- anything else and cannot survive into a real database.
-- ---------------------------------------------------------------------------
create or replace function public.fixture_staff(
  p_email text, p_name text, p_role text, p_partner uuid, p_password text
) returns uuid
language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;

  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      p_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, 'email',
            jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true),
            now(), now());
  end if;

  insert into public.users (id, full_name, email, role, partner_id, status)
  values (v_id, p_name, p_email, p_role, p_partner, 'active')
  on conflict (id) do update set role = excluded.role, partner_id = excluded.partner_id;

  return v_id;
end $fn$;


do $$
declare
  v_partner uuid; v_group uuid;
  ag_north uuid; ag_south uuid;
  br_n1 uuid; br_n2 uuid; br_s1 uuid;
  u_director uuid; u_manager uuid; u_negotiator uuid;
  v_pw text := 'MeridianDev!2026';

  -- public.users.id is FK to auth.users, so a staff row cannot exist without an
  -- identity. Item 34: GoTrue scans these token columns into non-nullable Go
  -- strings, so NULL means 'Database error querying schema' on every sign-in.
begin

  ------------------------------------------------------------------ partner
  insert into public.partners (slug, name, status, live_from, partner_rate, agent_rate,
                               referencing_mode, portal_referrals_enabled, api_access_enabled)
  values ('meridian-group', 'Meridian Property Group', 'active', current_date, 0.25, 0.10,
          'opndoor_referenced', true, false)
  on conflict (slug) do update set
    referencing_mode = 'opndoor_referenced',
    portal_referrals_enabled = true;
  select id into v_partner from public.partners where slug = 'meridian-group';

  ------------------------------------------------------------------ group
  insert into public.agency_groups (partner_id, name)
  values (v_partner, 'Meridian Property Group')
  on conflict (partner_id, name) do nothing;
  select id into v_group from public.agency_groups
   where partner_id = v_partner and name = 'Meridian Property Group';

  ------------------------------------------------------------------ brands
  -- Northgate was acquired on its own terms and carries its own partner_rate.
  -- Southbank inherits the partner's. That difference is the whole reason the
  -- rate sits at the agency and the group is only an override.
  insert into public.agencies (partner_id, name, review_state, group_id, partner_rate)
  values (v_partner, 'Northgate Lettings', 'confirmed', v_group, 0.30)
  on conflict (partner_id, name) do update
    set group_id = excluded.group_id, partner_rate = excluded.partner_rate;
  select id into ag_north from public.agencies where partner_id = v_partner and name = 'Northgate Lettings';

  insert into public.agencies (partner_id, name, review_state, group_id)
  values (v_partner, 'Southbank Residential', 'confirmed', v_group)
  on conflict (partner_id, name) do update set group_id = excluded.group_id;
  select id into ag_south from public.agencies where partner_id = v_partner and name = 'Southbank Residential';

  ------------------------------------------------------------------ branches
  insert into public.branches (agency_id, name, review_state) values
    (ag_north, 'Northgate Central', 'confirmed'),
    (ag_north, 'Northgate West',    'confirmed'),
    (ag_south, 'Southbank Quay',    'confirmed')
  on conflict (agency_id, name) do nothing;

  select id into br_n1 from public.branches where agency_id = ag_north and name = 'Northgate Central';
  select id into br_n2 from public.branches where agency_id = ag_north and name = 'Northgate West';
  select id into br_s1 from public.branches where agency_id = ag_south and name = 'Southbank Quay';

  -- has_agent_contact gates deed issuance, so every branch needs a primary or
  -- half the lifecycle cannot run. partner_id is NOT NULL: a contact belongs to
  -- the relationship that created it, which is what stops it being shared.
  insert into public.agent_contacts (partner_id, branch_id, name, email, is_primary)
  select v_partner, b.id, b.name || ' Lettings',
         lower(replace(b.name, ' ', '.')) || '@meridian.invalid', true
    from public.branches b
   where b.id in (br_n1, br_n2, br_s1)
     and not exists (select 1 from public.agent_contacts c where c.branch_id = b.id);

  ------------------------------------------------------------------ people
  -- Three levels. The negotiator deliberately gets NO position: no position
  -- means own referrals only, and that is the correct default, not an omission.
  u_director   := public.fixture_staff('director@meridian.invalid',     'Dara Whitfield', 'management', v_partner, v_pw);
  u_manager    := public.fixture_staff('branchmanager@meridian.invalid','Ines Barros',    'management', v_partner, v_pw);
  u_negotiator := public.fixture_staff('negotiator@meridian.invalid',   'Tom Reddy',      'referrer',   v_partner, v_pw);

  insert into public.user_scopes (user_id, kind, group_id)  values (u_director, 'group',  v_group) on conflict do nothing;
  insert into public.user_scopes (user_id, kind, branch_id) values (u_manager,  'branch', br_n1)  on conflict do nothing;
  insert into public.user_scopes (user_id, kind, branch_id) values (u_manager,  'branch', br_n2)  on conflict do nothing;

end $$;

-- The helper has no business existing after the fixture has run.
drop function if exists public.fixture_staff(text, text, text, uuid, text);

select p.slug,
       g.name  as group_name,
       (select count(*) from public.agencies a where a.group_id = g.id) as brands,
       (select count(*) from public.branches b
          join public.agencies a on a.id = b.agency_id where a.group_id = g.id) as branches,
       (select count(*) from public.user_scopes s
          join public.users u on u.id = s.user_id where u.partner_id = p.id) as positions,
       p.referencing_mode, p.portal_referrals_enabled
  from public.partners p
  join public.agency_groups g on g.partner_id = p.id
 where p.slug = 'meridian-group';
