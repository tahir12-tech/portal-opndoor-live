-- WHAT THE REFERRAL FORM ASKS, AND WHO IT ASKS IT OF.
--
-- my_org_shape narrows its reachable branches by the caller's POSITION:
--
--   and (not public.app_has_scope()
--        or b.id in (select s from public.app_scope_branches() s))
--
-- A Negotiator holds no position row by design (invite-user places a manager with
-- a scope and a negotiator by their home branch), so app_has_scope() is false,
-- `not false` is true, and the predicate stopped narrowing. Every branch under
-- the caller's partner became reachable, and on the agent rail the partner is the
-- house route carrying every one of our agencies. Reported from the walk as Tom,
-- a Negotiator at a single-office agency, who was shown "Brand and branch" with
-- an agency select and an office select. Measured on dev: five agencies, six
-- offices, for a man who works at one.
--
-- The fixture below is the smallest thing that can catch it: an estate with TWO
-- agencies. With one agency the broken and fixed answers are identical, which is
-- exactly why Regent's own shape looked right for the Director and the Manager
-- and wrong only for the person with no position.
--
-- The last case is the one that would have shipped broken the other way: a
-- SUPPLIER with no position must still reach everything under their partner,
-- because their agency set is open at referral time and always was.

begin;
select plan(8);

-- OUR ESTATE: two agencies, one office each.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock)
values ('92000000-0000-0000-0000-000000000001', 'zzz-ladder', 'ZZZ Ladder Route', 'opndoor_referenced', 0.25, 0.10, true, true);
insert into public.agencies (id, partner_id, name) values
  ('92000000-0000-0000-0000-00000000000a', '92000000-0000-0000-0000-000000000001', 'ZZZ Ladder Ours'),
  ('92000000-0000-0000-0000-00000000000b', '92000000-0000-0000-0000-000000000001', 'ZZZ Ladder Theirs');
insert into public.branches (id, agency_id, partner_id, name) values
  ('92000000-0000-0000-0000-0000000000a1', '92000000-0000-0000-0000-00000000000a', '92000000-0000-0000-0000-000000000001', 'Ours Park'),
  ('92000000-0000-0000-0000-0000000000b1', '92000000-0000-0000-0000-00000000000b', '92000000-0000-0000-0000-000000000001', 'Theirs Park');

-- A SUPPLIER: two agencies, one office each, same shape, different rail.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock)
values ('92000000-0000-0000-0000-000000000002', 'zzz-supp', 'ZZZ Ladder Supplier', 'pre_referenced_open', 0.25, 0.10, false, false);
insert into public.agencies (id, partner_id, name) values
  ('92000000-0000-0000-0000-00000000000c', '92000000-0000-0000-0000-000000000002', 'ZZZ Supp One'),
  ('92000000-0000-0000-0000-00000000000d', '92000000-0000-0000-0000-000000000002', 'ZZZ Supp Two');
insert into public.branches (id, agency_id, partner_id, name) values
  ('92000000-0000-0000-0000-0000000000c1', '92000000-0000-0000-0000-00000000000c', '92000000-0000-0000-0000-000000000002', 'Supp One Office'),
  ('92000000-0000-0000-0000-0000000000d1', '92000000-0000-0000-0000-00000000000d', '92000000-0000-0000-0000-000000000002', 'Supp Two Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('92000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'positioned@zzzladder.test', '', now(), now(), now()),
  ('92000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'homebranch@zzzladder.test', '', now(), now(), now()),
  ('92000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nowhere@zzzladder.test', '', now(), now(), now()),
  ('92000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supp@zzzladder.test', '', now(), now(), now());

insert into public.users (id, full_name, email, role, partner_id, status, home_branch_id) values
  ('92000000-0000-0000-0000-0000000000f1', 'Pos Manager', 'positioned@zzzladder.test', 'management', '92000000-0000-0000-0000-000000000001', 'active', null),
  -- The reported case: a Negotiator at a single-office agency.
  ('92000000-0000-0000-0000-0000000000f2', 'Tom Negotiator', 'homebranch@zzzladder.test', 'referrer', '92000000-0000-0000-0000-000000000001', 'active', '92000000-0000-0000-0000-0000000000a1'),
  ('92000000-0000-0000-0000-0000000000f3', 'No Place', 'nowhere@zzzladder.test', 'referrer', '92000000-0000-0000-0000-000000000001', 'active', null),
  ('92000000-0000-0000-0000-0000000000f4', 'Supp Person', 'supp@zzzladder.test', 'management', '92000000-0000-0000-0000-000000000002', 'active', null);

insert into public.user_scopes (user_id, kind, agency_id, branch_id)
values ('92000000-0000-0000-0000-0000000000f1', 'agency', '92000000-0000-0000-0000-00000000000a', null),
       -- Tom holds a BRANCH position now. He used to hold none and be located
       -- by home_branch_id, which is what case 2 below was written about.
       ('92000000-0000-0000-0000-0000000000f2', 'branch', null, '92000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------------------
-- 1. A POSITION DECIDES. Unchanged behaviour, asserted so the ladder's first
--    rung cannot be broken by a change to the others.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-0000000000f1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select results_eq(
  $$select agency_count, branch_count, collapse_agency, collapse_branch
      from public.my_org_shape(null)$$,
  $$values (1, 1, true, true)$$,
  'a positioned manager sees only their own agency and office');

-- ---------------------------------------------------------------------------
-- 2. A NEGOTIATOR AT ONE OFFICE. The reported bug, and then the second one.
--
--    As reported, Tom held no position and my_org_shape fell back to his
--    home_branch_id. That answered correctly and was still wrong: the column
--    is one its own subject can PATCH, so the fallback was an editable
--    boundary. He is positioned at his one office now (20261006300000), and
--    the answer below is unchanged -- which is the point. The assertion that
--    he holds NO position has been turned over: holding one is the rule.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-0000000000f2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(public.app_has_scope(), 'a negotiator holds a position, which is now the rule');

select results_eq(
  $$select agency_count, branch_count, collapse_agency, collapse_branch
      from public.my_org_shape(null)$$,
  $$values (1, 1, true, true)$$,
  'and is resolved from that position: one agency, one office, nothing to ask');

-- NAMED, not just counted. The form refuses to collapse a level it cannot print,
-- so a shape that says "one office" without saying which one still draws the
-- section. Counting right and naming wrong would look fixed and not be.
select results_eq(
  $$select only_agency_name, only_branch_name from public.my_org_shape(null)$$,
  $$values ('ZZZ Ladder Ours'::text, 'Ours Park'::text)$$,
  'and both are named, so the office can be stated under Tenancy');

-- THE OTHER AGENCY IS NOT THEIRS. The assertion that actually fails on the old
-- code: before the fix this answered 2 agencies and 2 offices.
select isnt(
  (select branch_count from public.my_org_shape(null)), 2,
  'and the second agency on the house route is not offered to them');

-- ---------------------------------------------------------------------------
-- 3. NO POSITION AT ALL, ON OUR ESTATE. Unreachable now, and still asserted.
--
--    20261006300000 refuses to commit this person, so the state is gone rather
--    than handled. The assertions stay because my_org_shape must not answer
--    "the whole estate" if one ever appears -- through a restore, a direct
--    service_role write, or a future path that forgets. A closed default is
--    only worth having if something checks it is still closed.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-0000000000f3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select results_eq(
  $$select agency_count, branch_count from public.my_org_shape(null)$$,
  $$values (0, 0)$$,
  'somebody with no position and no office gets nothing, not the whole estate');

-- A ROW, not an absence, and the difference matters: no row makes the client fall
-- back to the supplier picker (an agency search and a create option), which is
-- the opposite of what this person should be offered. One row with zero counts is
-- the "nothing is set up for your account yet" state.
select is(
  (select count(*)::int from public.my_org_shape(null)), 1,
  'and still gets a ROW, so the client does not fall back to the supplier picker');

-- ---------------------------------------------------------------------------
-- 4. A SUPPLIER IS UNTOUCHED. Their agency set is open at referral time.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-0000000000f4","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select results_eq(
  $$select agency_count, branch_count, collapse_agency, may_add_agency
      from public.my_org_shape(null)$$,
  $$values (2, 2, false, true)$$,
  'a supplier with no position still reaches their whole partner, and may add an agency');

select * from finish();
rollback;
