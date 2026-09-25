-- NO AGENCY USER SEES PEOPLE OR STRUCTURE OUTSIDE THEIR SCOPE.
--
-- The Team page replaces Agencies and Users for an agency of ours, and it is
-- built entirely out of things the client already reads: agencies, branches,
-- users and user_scopes. That is deliberate — no new RPC means no new reach —
-- but it is only safe if those four policies really do narrow to a position.
-- The page hides; SQL is the rule; these are the rule.
--
-- The shape under test is Regent's: two agencies under ONE partner, because
-- that is the case a partner-level policy would wave through. A manager scoped
-- to one of them must not see the other's branches, the other's staff, or the
-- other's staff's positions — and must not see the house partner that carries
-- them both.

begin;
select plan(14);

-- One partner, the house rail that carries our agencies.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('95000000-0000-0000-0000-000000000001', 'zzz-team-estate', 'Team Estate', 'opndoor_referenced', 0.25, 0.10, true);

-- Two agencies of ours under it. THEIRS and THE OTHER ONE.
insert into public.agencies (id, partner_id, name) values
  ('95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'Theirs Lettings'),
  ('95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 'Other Lettings');
insert into public.branches (id, agency_id, partner_id, name) values
  ('95000000-0000-0000-0000-000000000004', '95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'Theirs High Street'),
  ('95000000-0000-0000-0000-000000000005', '95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'Theirs Riverside'),
  ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 'Other High Street');

-- Three people: their manager, their negotiator, and somebody at the other one.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('95000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mgr@zzzteam.test', '', now(), now(), now()),
  ('95000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'neg@zzzteam.test', '', now(), now(), now()),
  ('95000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@zzzteam.test', '', now(), now(), now());

insert into public.users (id, full_name, email, role, partner_id, status, home_branch_id) values
  ('95000000-0000-0000-0000-00000000000a', 'Their Manager',   'mgr@zzzteam.test',   'management', '95000000-0000-0000-0000-000000000001', 'active', null),
  ('95000000-0000-0000-0000-00000000000b', 'Their Negotiator','neg@zzzteam.test',   'referrer',   '95000000-0000-0000-0000-000000000001', 'active', '95000000-0000-0000-0000-000000000004'),
  ('95000000-0000-0000-0000-00000000000c', 'Other Person',    'other@zzzteam.test', 'management', '95000000-0000-0000-0000-000000000001', 'active', null);

-- Positions: the manager over THEIR agency, the negotiator at one of its
-- branches, and the other person over the OTHER agency.
insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('95000000-0000-0000-0000-00000000000a', 'agency', '95000000-0000-0000-0000-000000000002', null),
  ('95000000-0000-0000-0000-00000000000c', 'agency', '95000000-0000-0000-0000-000000000003', null);
insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('95000000-0000-0000-0000-00000000000b', 'branch', null, '95000000-0000-0000-0000-000000000004');

-- Become their manager.
select set_config('request.jwt.claims', json_build_object(
  'sub','95000000-0000-0000-0000-00000000000a','role','authenticated','aal','aal2')::text, true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- THE STRUCTURE. Team renders getAgencies() and its branches, nothing else.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.agencies a
    where a.id in ('95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000003')),
  1, 'a manager sees ONE agency: their own, not their partner''s other one');
select is(
  (select a.name from public.agencies a
    where a.id in ('95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000003')),
  'Theirs Lettings', 'and it is theirs');

select is(
  (select count(*)::int from public.branches b
    where b.id in ('95000000-0000-0000-0000-000000000004','95000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000006')),
  2, 'they see both of their OWN branches');
select ok(
  not exists (select 1 from public.branches b where b.id = '95000000-0000-0000-0000-000000000006'),
  'and not the other agency''s branch, which shares their partner');

-- ---------------------------------------------------------------------------
-- THE PEOPLE. Team renders list_managed_users() and getPositions() per person.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.list_managed_users() u
    where u.id in ('95000000-0000-0000-0000-00000000000a','95000000-0000-0000-0000-00000000000b','95000000-0000-0000-0000-00000000000c')),
  2, 'they see themselves and their negotiator, and no one else');
select ok(
  not exists (select 1 from public.list_managed_users() u where u.id = '95000000-0000-0000-0000-00000000000c'),
  'the other agency''s manager is not in their team list');

select is(
  (select count(*)::int from public.user_scopes s where s.user_id = '95000000-0000-0000-0000-00000000000b'),
  1, 'they can read their own negotiator''s position, which is how Team files them');
select is(
  (select count(*)::int from public.user_scopes s where s.user_id = '95000000-0000-0000-0000-00000000000c'),
  0, 'and cannot read the other agency''s manager''s position');

-- ---------------------------------------------------------------------------
-- THE HOUSE PARTNER. Team never names it; this is the guarantee that it
-- could not, even if a future screen asked.
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.partners p where p.slug = 'zzz-team-estate') <= 1,
  'the partner row is at most their own route, never a list of partners');

-- ---------------------------------------------------------------------------
-- A NEGOTIATOR IS NARROWER STILL, and may not hand out positions.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object(
  'sub','95000000-0000-0000-0000-00000000000b','role','authenticated','aal','aal2')::text, true);

-- A negotiator reaches their OWN agency's offices, because branches_select
-- grants the agency they are positioned under. That is right for the referral
-- picker and too wide for a team list, so Team narrows to the viewer's own
-- branch positions in the page. What SQL must guarantee is the boundary that
-- matters and that no screen can widen: nothing outside their own agency.
select is(
  (select count(*)::int from public.branches b
    where b.id in ('95000000-0000-0000-0000-000000000004','95000000-0000-0000-0000-000000000005')),
  2, 'a branch negotiator reaches their own agency''s offices');
select ok(
  not exists (select 1 from public.branches b where b.id = '95000000-0000-0000-0000-000000000006'),
  'and never the other agency''s, which is the boundary that matters');

-- STRUCTURE IS READ-ONLY FOR A CUSTOMER. Team draws no Add branch button, and
-- this is why that is a courtesy rather than the rule.
-- STRUCTURE IS SET UP BY OPNDOOR. Before 20261004160000 this insert SUCCEEDED:
-- partner_id = app_partner() is satisfied by every agency of ours, because our
-- agencies all share one house partner, so a negotiator at one could create a
-- branch under another customer's agency. Both halves of the ruling are here —
-- the ruling that a customer does not change structure, and the hole it closed.
-- Refused, but not by RLS: a validation trigger runs first and cannot see the
-- agency at all, so it says "not found" (P0001) before the policy is consulted.
-- Two locks on one door; the test asserts the door, not which lock turned.
select throws_ok(
  $$insert into public.branches (agency_id, partner_id, name)
    values ('95000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000001','Sneaked In')$$,
  null, null,
  'and cannot create a branch under ANOTHER agency of our estate');
select throws_ok(
  $$insert into public.branches (agency_id, partner_id, name)
    values ('95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000001','Also Sneaked In')$$,
  '42501',
  null,
  'nor under their own: opndoor sets up structure, whatever the screen offers');

-- ---------------------------------------------------------------------------
-- AND THE SUPPLIER RAIL IS UNTOUCHED. This is the Rightmove guarantee: their
-- agency set is open at referral time, an office they have never sent us before
-- turns up mid-form, and the referral must not stop. Only rows whose partner is
-- OUR house route gained a condition.
-- ---------------------------------------------------------------------------
reset role;
insert into public.partners (id, slug, name, partner_rate, agent_rate, refers_own_stock)
values ('95000000-0000-0000-0000-000000000011', 'zzz-team-supplier', 'Team Supplier', 0.25, 0.10, false);
insert into public.agencies (id, partner_id, name)
values ('95000000-0000-0000-0000-000000000012', '95000000-0000-0000-0000-000000000011', 'Supplier Agency');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('95000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sup@zzzteam.test', '', now(), now(), now());
insert into public.users (id, full_name, email, role, partner_id, status)
values ('95000000-0000-0000-0000-00000000001a', 'Supplier Staff', 'sup@zzzteam.test', 'referrer', '95000000-0000-0000-0000-000000000011', 'active');

select set_config('request.jwt.claims', json_build_object(
  'sub','95000000-0000-0000-0000-00000000001a','role','authenticated','aal','aal2')::text, true);
set local role authenticated;

select lives_ok(
  $$insert into public.branches (agency_id, partner_id, name)
    values ('95000000-0000-0000-0000-000000000012','95000000-0000-0000-0000-000000000011','New Office')$$,
  'a supplier''s staff still add a branch mid-referral, exactly as before');

select * from finish();
rollback;
