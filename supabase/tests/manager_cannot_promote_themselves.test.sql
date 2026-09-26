-- A MANAGER CANNOT MAKE THEMSELVES A DIRECTOR.
--
-- manager_sees_no_commission.test.sql proves a Manager gets nothing from any of
-- the four rate routes. It proves it for a Manager whose sees_commission is
-- false, and until 20261005210000 nothing stopped them setting it true:
-- users_mgmt_update lets a management user update any management/referrer row
-- under their own partner, their own row included, and authenticated holds a
-- TABLE-level UPDATE grant on public.users so it reaches every column.
--
-- One PATCH and the level meant nothing. This file is the other half of that
-- suite: the first asks "what may a Manager read", this asks "what may a Manager
-- BECOME".
--
-- The last three assertions are the ones that would actually have shipped
-- broken. A guard on a column of a table an agency legitimately edits has to
-- leave the legitimate editing alone, and an admin has to keep a way to set the
-- level or the only Directors in the world are the ones the backfill made.

begin;
select plan(12);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('94000000-0000-0000-0000-000000000001', 'zzz-promote', 'ZZZ Promote Route', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agencies (id, partner_id, name)
values ('94000000-0000-0000-0000-00000000000a', '94000000-0000-0000-0000-000000000001', 'ZZZ Promote Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('94000000-0000-0000-0000-00000000000b', '94000000-0000-0000-0000-00000000000a',
        '94000000-0000-0000-0000-000000000001', 'ZZZ Promote Park');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('94000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mo@zzzpromote.test',  '', now(), now(), now()),
  ('94000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dee@zzzpromote.test', '', now(), now(), now()),
  ('94000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@zzzpromote.test', '', now(), now(), now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('94000000-0000-0000-0000-00000000000d', 'Mo Manager',  'mo@zzzpromote.test',  'management', '94000000-0000-0000-0000-000000000001', 'active', false),
  ('94000000-0000-0000-0000-00000000000e', 'Dee Director','dee@zzzpromote.test', 'management', '94000000-0000-0000-0000-000000000001', 'active', true),
  ('94000000-0000-0000-0000-00000000000f', 'Ada Admin',   'adm@zzzpromote.test', 'superadmin', null, 'active', true);

insert into public.user_scopes (user_id, kind, agency_id) values
  ('94000000-0000-0000-0000-00000000000d', 'agency', '94000000-0000-0000-0000-00000000000a'),
  ('94000000-0000-0000-0000-00000000000e', 'agency', '94000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- THE MANAGER TRIES.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(not public.may_see_commission(), 'a Manager starts without commission');

-- The row IS writable by them, which is the whole reason this needed a trigger
-- rather than a policy: the policy is right, the column was the problem.
select lives_ok(
  $$update public.users set full_name = 'Mo Manager Jr' where id = auth.uid()$$,
  'and may still edit their own ordinary fields, so the guard is narrow');

select throws_ok(
  $$update public.users set sees_commission = true where id = auth.uid()$$,
  '42501', null,
  'but promoting themselves to Director is refused');

select throws_ok(
  $$update public.users set receives_commission_statements = true where id = auth.uid()$$,
  '42501', null,
  'and so is posting themselves the monthly statement');

-- NOT JUST THEIR OWN ROW. users_mgmt_update covers every management and referrer
-- row under the same partner, and on the house route that is every agency we
-- carry. Demoting the Director would have been a way to make the figures nobody
-- can see, and promoting a colleague a way to get them read out loud.
select throws_ok(
  $$update public.users set sees_commission = false
     where id = '94000000-0000-0000-0000-00000000000e'$$,
  '42501', null,
  'nor may they change a colleague''s level');

select ok(not public.may_see_commission(), 'and after all that they still may not see commission');

-- The RPC is not a way round it either.
select throws_ok(
  $$select public.set_agency_level('94000000-0000-0000-0000-00000000000d', 'Director')$$,
  '42501', null,
  'and the level RPC refuses a non-admin');

-- ---------------------------------------------------------------------------
-- THE DIRECTOR IS UNTOUCHED.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.may_see_commission(), 'a Director still sees commission, so nothing was taken away');

-- ---------------------------------------------------------------------------
-- AND OPNDOOR CAN STILL SET A LEVEL, or there would be no Directors after today.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-00000000000f","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_agency_level('94000000-0000-0000-0000-00000000000d', 'Director')$$,
  'an admin may promote a Manager to Director');

-- Role and flag move TOGETHER. Set separately they can disagree, and a
-- 'referrer' with sees_commission true is a Negotiator the predicate answers
-- false for anyway: a contradiction that reads as a bug for ever.
select results_eq(
  $$select role, sees_commission from public.users
     where id = '94000000-0000-0000-0000-00000000000d'$$,
  $$values ('management'::text, true)$$,
  'and the role and the flag moved together');

select is(
  (select new_value from public.user_audit
    where target_user = '94000000-0000-0000-0000-00000000000d'
      and action = 'agency level changed' order by at desc limit 1),
  'Director',
  'and it is audited, so "who made this person a Director" has an answer');

-- Opndoor's own staff have no agency level, and this must not be a way to demote
-- a superadmin into a referrer.
select throws_ok(
  $$select public.set_agency_level('94000000-0000-0000-0000-00000000000f', 'Negotiator')$$,
  '22023', null,
  'and opndoor staff have no agency level to set');

select * from finish();
rollback;
