-- EVERY CREATION ROW SAYS WHO, WHEN AND FROM WHERE.
--
-- Matt, 2026-10-03: "Record agency, branch, group and supplier creation in
-- Recent changes and the audit trail (who, when, and from where), the same way
-- edits are recorded."
--
-- MEASURED BEFORE BUILDING, and most of it was already there: every creation
-- path writes a row with who and when. What was uneven is "from where" -- the
-- two paths written this week say it and the older admin paths said only the
-- name, so a row read six months from now could not tell an agency typed into
-- the Agencies screen from one that arrived on a referral. Which is exactly
-- the question the Harborview investigation could not answer.
--
-- AND THE HARBORVIEW GAP WAS NOT A MISSING AUDIT: that agency appeared on
-- 2026-09-23 and the last org_audit creation row before it is 2026-09-18,
-- because a SQL fixture written straight into the table bypasses every one of
-- these functions. Expected of a fixture, and not something to build for.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('a4000000-0000-0000-0000-0000000000a1','zzz-whence','ZZZ Whence Supplier',
        'pre_referenced_open', false, 'supplier');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('a4000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.whence@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('a4000000-0000-0000-0000-0000000000d1','ZZZ Whence Admin','zzz.whence@o.test',
        'superadmin', null, 'active', true);

select set_config('request.jwt.claims',
  '{"sub":"a4000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- THE ADMIN PATHS: the Agencies screen
-- ===========================================================================
select lives_ok(
  /* THE PARTNER IS THE THIRD ARGUMENT, not the second: the second is the
     GROUP. An admin has no `app_partner()`, so the slug has to be named or
     the function refuses with "Select a specific partner". */
  /* AND THE EMAIL IS REQUIRED on a supplier's estate, which is
     20261007840000's rule and is right: signed deeds for its branches go
     there. Given here rather than switching the fixture to our own estate,
     because the supplier rail is where an agency is created most often. */
  $$select public.admin_add_agency('ZZZ Whence Agency', null, 'zzz-whence', 'deeds@zzzwhence.test')$$,
  'an admin can add an agency');

select is(
  (select detail from public.org_audit
    where entity_type = 'agency' and action = 'created' and detail like 'ZZZ Whence Agency%'),
  'ZZZ Whence Agency (added on the Agencies screen)',
  'and the row says the name AND where it came from');

/* WHO AND WHEN WERE ALREADY THERE, and are asserted so that a change to the
   detail cannot quietly drop either: the whole point of the row is the three
   facts together. */
select is(
  (select actor from public.org_audit
    where entity_type = 'agency' and action = 'created' and detail like 'ZZZ Whence Agency%'),
  'ZZZ Whence Admin', 'with who');

select ok(
  (select at from public.org_audit
    where entity_type = 'agency' and action = 'created' and detail like 'ZZZ Whence Agency%')
    > now() - interval '1 minute',
  'and when');

select lives_ok(
  $$select public.admin_add_branch(
      (select id from public.agencies where name = 'ZZZ Whence Agency'),
      'ZZZ Whence Office', null, null, null, null)$$,
  'an admin can add an office');

select is(
  (select detail from public.org_audit
    where entity_type = 'branch' and action = 'created' and detail like 'ZZZ Whence Office%'),
  'ZZZ Whence Office (added on the Agencies screen)',
  'and its row says where too');

-- ===========================================================================
-- AND A GROUP, which is the third thing Matt names
-- ===========================================================================
select lives_ok(
  -- And here the slug comes FIRST. The two signatures disagree about the
  -- order, which is worth a line because it cost a test run.
  $$select public.create_agency_group('zzz-whence', 'ZZZ Whence Group')$$,
  'an admin can add a group');

select is(
  (select detail from public.org_audit
    where entity_type = 'agency_group' and action = 'created' and detail like 'ZZZ Whence Group%'),
  'ZZZ Whence Group (added on the Agencies screen)',
  'and so does a group''s');

select finish();
rollback;
