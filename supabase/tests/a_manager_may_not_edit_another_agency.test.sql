-- A MANAGER MAY NOT TOUCH ANOTHER AGENCY'S PEOPLE.
--
-- users_mgmt_update read, in full:
--
--   app_role() = 'management'
--   and partner_id = app_partner()
--   and role in ('management','referrer','developer')
--
-- No scope, no level, no self test. On the supplier rail that is a company
-- boundary. On the agency rail every agency shares the house partner
-- 'opndoor-agents', so it meant "every agency Opndoor has onboarded": on dev,
-- four unrelated competitors.
--
-- users_level_ladder_guard already protected `role` and `status`, which is why
-- this was not total. Every other column was open, and the new
-- receives_notifications column would have been too.
--
-- EVERY ASSERTION BELOW FAILS AGAINST THE POLICY AS IT WAS. The writes it now
-- refuses all succeeded, because the row was visible and the trigger governs
-- two columns rather than the row.

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- TWO AGENCIES ON ONE HOUSE PARTNER, which is the whole point.
-- ---------------------------------------------------------------------------
insert into public.agencies (id, partner_id, name)
values ('93000000-0000-0000-0000-00000000000a',
        (select id from public.partners where slug='opndoor-agents'), 'ZZZ Ours'),
       ('93000000-0000-0000-0000-00000000000b',
        (select id from public.partners where slug='opndoor-agents'), 'ZZZ Theirs');
insert into public.branches (id, agency_id, partner_id, name)
values ('93000000-0000-0000-0000-0000000000b1', '93000000-0000-0000-0000-00000000000a',
        (select id from public.partners where slug='opndoor-agents'), 'ZZZ Ours Park'),
       ('93000000-0000-0000-0000-0000000000b2', '93000000-0000-0000-0000-00000000000b',
        (select id from public.partners where slug='opndoor-agents'), 'ZZZ Theirs Park');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('93000000-0000-0000-0000-00000000e0a1'::uuid, 'zzz.ours.mgr@b.test'),
  ('93000000-0000-0000-0000-00000000e0a2'::uuid, 'zzz.ours.dir@b.test'),
  ('93000000-0000-0000-0000-00000000e0a3'::uuid, 'zzz.theirs.mgr@b.test'),
  ('93000000-0000-0000-0000-00000000e0a4'::uuid, 'zzz.ours.neg@b.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id)
values
  ('93000000-0000-0000-0000-00000000e0a1','ZZZ Ours Mgr','zzz.ours.mgr@b.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('93000000-0000-0000-0000-00000000e0a2','ZZZ Ours Dir','zzz.ours.dir@b.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('93000000-0000-0000-0000-00000000e0a3','ZZZ Theirs Mgr','zzz.theirs.mgr@b.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('93000000-0000-0000-0000-00000000e0a4','ZZZ Ours Neg','zzz.ours.neg@b.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false,
   '93000000-0000-0000-0000-0000000000b1');

/* THE NEGOTIATOR HOLDS A POSITION TOO, which this fixture did not give them
   when it was written: they were located by home_branch_id, the way every
   negotiator on the estate was. 20261006300000 made a position mandatory here
   and backfilled the real ones from that same column, because a column its own
   subject can PATCH is not a boundary. Their home branch is left set, since a
   negotiator still sits somewhere; it is simply not what finds them. */
insert into public.user_scopes (user_id, kind, agency_id, branch_id, group_id) values
  ('93000000-0000-0000-0000-00000000e0a1','agency','93000000-0000-0000-0000-00000000000a',null,null),
  ('93000000-0000-0000-0000-00000000e0a2','agency','93000000-0000-0000-0000-00000000000a',null,null),
  ('93000000-0000-0000-0000-00000000e0a3','agency','93000000-0000-0000-0000-00000000000b',null,null),
  ('93000000-0000-0000-0000-00000000e0a4','branch',null,'93000000-0000-0000-0000-0000000000b1',null);

-- Act as ZZZ Ours Mgr: a Manager, positioned on ZZZ Ours.
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-00000000e0a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- ANOTHER AGENCY'S PERSON, FIELD BY FIELD. Each of these applied before.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.users set full_name = 'Renamed By A Competitor'
     where id = '93000000-0000-0000-0000-00000000e0a3'$$,
  'renaming another agency''s manager raises nothing, because it matches nothing');

select lives_ok(
  $$update public.users set email = 'stolen@b.test'
     where id = '93000000-0000-0000-0000-00000000e0a3'$$,
  'nor does changing their email address');

-- Moving somebody used to be a row-policy question and is now a GRANT one:
-- 20261006550000 took UPDATE on home_branch_id away from authenticated
-- altogether, because set_home_branch is the only door and nothing in the
-- product writes the column. Refused earlier and harder, so the assertion
-- moves with it.
select throws_ok(
  $$update public.users set home_branch_id = '93000000-0000-0000-0000-0000000000b1'
     where id = '93000000-0000-0000-0000-00000000e0a3'$$,
  '42501', null,
  'nor moving them to one of my own branches, which is no longer even a writable column');

reset role;
select is(
  (select full_name || '|' || email || '|' || coalesce(home_branch_id::text,'-')
     from public.users where id = '93000000-0000-0000-0000-00000000e0a3'),
  'ZZZ Theirs Mgr|zzz.theirs.mgr@b.test|-',
  'and their row is untouched in every one of those fields');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- MY OWN AGENCY, AT OR BELOW MY LEVEL: still allowed, because the policy is a
-- boundary and not a wall.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.users set full_name = 'ZZZ Ours Neg Renamed'
     where id = '93000000-0000-0000-0000-00000000e0a4'$$,
  'a Manager may still rename a Negotiator at her own agency');
reset role;
select is((select full_name from public.users where id = '93000000-0000-0000-0000-00000000e0a4'),
  'ZZZ Ours Neg Renamed', 'and that one really did change');
set local role authenticated;

-- Her own row.
select lives_ok(
  $$update public.users set full_name = 'ZZZ Ours Mgr Herself'
     where id = '93000000-0000-0000-0000-00000000e0a1'$$,
  'and her own, which is what makes the tickbox self-service');

-- The Director beside her is ABOVE her: at-or-below excludes them.
select lives_ok(
  $$update public.users set full_name = 'Renamed By A Manager'
     where id = '93000000-0000-0000-0000-00000000e0a2'$$,
  'but her own Director matches nothing, because at-or-below excludes above');
reset role;
select is((select full_name from public.users where id = '93000000-0000-0000-0000-00000000e0a2'),
  'ZZZ Ours Dir', 'and the Director is untouched');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- THE TICKBOX IS NOT A WAY ROUND ANY OF IT.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.users set receives_notifications = true
     where id = '93000000-0000-0000-0000-00000000e0a4'$$,
  '42501', 'Who receives notifications is changed from the person''s row, not by editing them directly.',
  'the column cannot be set by a PATCH, even on somebody she may otherwise edit');

select throws_ok(
  $$select public.set_receives_notifications('93000000-0000-0000-0000-00000000e0a3', true)$$,
  '42501', 'You can only change this for people at or below your own position, in your own agency.',
  'and the RPC refuses another agency''s person, in a sentence that says why');

select lives_ok(
  $$select public.set_receives_notifications('93000000-0000-0000-0000-00000000e0a4', true)$$,
  'while her own Negotiator is allowed');

select * from finish();
rollback;
