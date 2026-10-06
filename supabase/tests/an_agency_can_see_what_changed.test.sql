-- AN AGENCY CAN SEE WHAT CHANGED.
--
-- Matt, 2026-10-01: "Agency page: add a 'Recent changes' list like the
-- supplier's, showing every change to the agency's details, branches,
-- people's levels and commission deals in plain English, with who and when,
-- using the shared builder."
--
-- Migration: 20261007270000_an_agency_can_see_what_changed.sql
--
-- =========================================================================
-- FOUR SOURCES IS THE WHOLE DIFFICULTY
-- =========================================================================
--
-- The supplier's list reads one table. An agency's history is spread over
-- `org_audit` rows about the agency, about each of its branches and about
-- each of its people, plus `user_audit` rows for their levels -- in two
-- different shapes. Every assertion below is about one of those four
-- arriving, and about the ones belonging to ANOTHER agency not arriving.

begin;
select plan(14);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('99000000-0000-0000-0000-00000000000e', 'zzz-chg', 'ZZZ Changes Partner', 'opndoor_referenced', 0.25, 0.10, false, 'agency');

insert into public.agency_groups (id, partner_id, name)
values ('99000000-0000-0000-0000-00000000009c', '99000000-0000-0000-0000-00000000000e', 'ZZZ Changes Group');

insert into public.agencies (id, partner_id, name, group_id) values
  ('99000000-0000-0000-0000-00000000000a', '99000000-0000-0000-0000-00000000000e', 'ZZZ Ours', '99000000-0000-0000-0000-00000000009c'),
  ('99000000-0000-0000-0000-00000000000b', '99000000-0000-0000-0000-00000000000e', 'ZZZ Theirs', null);
insert into public.branches (id, agency_id, partner_id, name) values
  ('99000000-0000-0000-0000-00000000000c', '99000000-0000-0000-0000-00000000000a', '99000000-0000-0000-0000-00000000000e', 'ZZZ Ours Chelsea'),
  ('99000000-0000-0000-0000-00000000000d', '99000000-0000-0000-0000-00000000000b', '99000000-0000-0000-0000-00000000000e', 'ZZZ Theirs Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('99000000-0000-0000-0000-00000000c001'::uuid,'zzz.chg.admin@o.test'),
  ('99000000-0000-0000-0000-00000000c002'::uuid,'zzz.chg.ours@a.test'),
  ('99000000-0000-0000-0000-00000000c003'::uuid,'zzz.chg.group@a.test'),
  ('99000000-0000-0000-0000-00000000c004'::uuid,'zzz.chg.theirs@a.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('99000000-0000-0000-0000-00000000c001','ZZZ Chg Admin','zzz.chg.admin@o.test','superadmin',null,'active',true),
  ('99000000-0000-0000-0000-00000000c002','ZZZ Ours Person','zzz.chg.ours@a.test','referrer','99000000-0000-0000-0000-00000000000e','active',false),
  ('99000000-0000-0000-0000-00000000c003','ZZZ Group Director','zzz.chg.group@a.test','management','99000000-0000-0000-0000-00000000000e','active',true),
  ('99000000-0000-0000-0000-00000000c004','ZZZ Theirs Person','zzz.chg.theirs@a.test','referrer','99000000-0000-0000-0000-00000000000e','active',false);

insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id) values
  ('99000000-0000-0000-0000-00000000c002','branch',null,null,'99000000-0000-0000-0000-00000000000c'),
  ('99000000-0000-0000-0000-00000000c003','group','99000000-0000-0000-0000-00000000009c',null,null),
  ('99000000-0000-0000-0000-00000000c004','branch',null,null,'99000000-0000-0000-0000-00000000000d');

/* THE FOUR SOURCES, plus one row belonging to the other agency in each
   shape so "only this agency's" is actually tested. */
insert into public.org_audit (entity_type, entity_id, action, detail, actor, at) values
  ('agency','99000000-0000-0000-0000-00000000000a','commission_set','partner 0.2500, agent 0.1000','Rosa Vance', now() - interval '5 min'),
  ('agency','99000000-0000-0000-0000-00000000000a','agreement_created','additive agreement','Rosa Vance', now() - interval '4 min'),
  ('branch','99000000-0000-0000-0000-00000000000c','created','ZZZ Ours Chelsea','Rosa Vance', now() - interval '3 min'),
  ('user','99000000-0000-0000-0000-00000000c002','position_set','branch:99000000-0000-0000-0000-00000000000c','Rosa Vance', now() - interval '2 min'),
  ('user','99000000-0000-0000-0000-00000000c003','position_set','group:99000000-0000-0000-0000-00000000009c','Rosa Vance', now() - interval '1 min'),
  -- The other agency's, which must not appear.
  ('agency','99000000-0000-0000-0000-00000000000b','commission_set','partner 0.9900, agent 0.9900','Someone Else', now()),
  ('branch','99000000-0000-0000-0000-00000000000d','created','ZZZ Theirs Office','Someone Else', now()),
  ('user','99000000-0000-0000-0000-00000000c004','position_set','branch:99000000-0000-0000-0000-00000000000d','Someone Else', now());

insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor, at) values
  ('99000000-0000-0000-0000-00000000c002','99000000-0000-0000-0000-00000000000e','role','referrer','management','Rosa Vance', now() - interval '30 sec'),
  ('99000000-0000-0000-0000-00000000c004','99000000-0000-0000-0000-00000000000e','role','referrer','management','Someone Else', now());

select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. ALL FOUR SOURCES ARRIVE
-- ===========================================================================
select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000a')),
  6, 'six changes: two the agency''s, one a branch''s, two positions and one level');

select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where subject_kind = 'deal'),
  2, 'the commission and the deal are both read as deals');

select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where subject_kind = 'branch'),
  1, 'the branch''s own change is there');

select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where subject_kind = 'person'),
  3, 'and its people''s, positions and level alike');

-- ===========================================================================
-- 2. AND NOBODY ELSE'S
-- ===========================================================================
/* THE ASSERTION THAT MATTERS. The other agency's rows are the same
   actions on the same tables; only the entity tells them apart. */
select is_empty(
  $$select * from public.agency_changes('99000000-0000-0000-0000-00000000000a')
     where actor = 'Someone Else'$$,
  'and not one row belonging to the other agency');

select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000b')),
  4, 'which has its own four: a commission, a branch, a position and a level');

-- ===========================================================================
-- 3. A GROUP-LEVEL PERSON COUNTS AS THIS AGENCY'S
-- ===========================================================================
/* A Director positioned on the group runs this agency, and a change to
   their level changes who can act on it. Leaving them out would make the
   list quietly incomplete where it matters most. */
select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where subject = 'ZZZ Group Director'),
  1, 'the group''s Director is one of this agency''s people');

-- ===========================================================================
-- 4. THE SHAPES, AND THE ONE THING THE READER HAS TO RESOLVE
-- ===========================================================================
select is(
  (select detail from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where action = 'position_set' and subject = 'ZZZ Ours Person'),
  'the ZZZ Ours Chelsea branch',
  'a position reads as a place, not as a uuid');

select is(
  (select detail from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where action = 'position_set' and subject = 'ZZZ Group Director'),
  'the ZZZ Changes Group group', 'and a group position names the group');

/* AN EVENT CARRIES NO TRIPLE AND A TRIPLE CARRIES NO EVENT, which is what
   lets the client pick a shape per row rather than guessing. */
select is_empty(
  $$select * from public.agency_changes('99000000-0000-0000-0000-00000000000a')
     where action is not null and field is not null$$,
  'no row arrives in both shapes at once');

select is(
  (select new_value from public.agency_changes('99000000-0000-0000-0000-00000000000a')
    where field = 'role'),
  'management', 'and a level change arrives as a triple');

-- ===========================================================================
-- 5. NEWEST FIRST, AND THE LIMIT HOLDS
-- ===========================================================================
select is(
  (select field from public.agency_changes('99000000-0000-0000-0000-00000000000a') limit 1),
  'role', 'newest first');

select is(
  (select count(*)::int from public.agency_changes('99000000-0000-0000-0000-00000000000a', 2)),
  2, 'and the limit is obeyed');

-- ===========================================================================
-- 6. AND IT IS NOT A WAY ROUND THE BOUNDARY
-- ===========================================================================
/* The gate is `app_may_reach_agency`, the same predicate every other
   agency-scoped reader uses. A supplier's referrer reaches no agency of
   ours at all. */
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select * from public.agency_changes('99000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'somebody who cannot reach the agency cannot read its history');

select * from finish();
rollback;
