-- AN ADMIN CHOOSES THE ROUTE, AND ONLY WHERE THE RELATIONSHIP EXISTS.
--
-- Q-06 item H. An agency introduced by a supplier can transact on EITHER
-- route -- its own, or that supplier's -- and which one it is decides the
-- commission. The branch cannot answer that, so until now the admin form
-- inferred the rail, the route and the fee from the branch after the fact and
-- had no way to say "this one came through Harbour".
--
-- Matt's sentence is the specification: "The server checks the branch belongs
-- to the chosen supplier and refuses otherwise."
--
-- WHAT EACH ASSERTION IS FOR:
--
--   1  the default path is untouched -- every existing caller passes nothing
--      and resolves the route exactly as before, which is most of the risk in
--      adding a parameter at all
--   2  an admin may state a route the relationship supports, and the
--      application is FROZEN onto it, because partner_id is the route
--   3  the route is frozen onto the row
--   4  an admin may NOT state a supplier the branch has never sat under
--   5  and a partner's own manager may not state a route at all: theirs is
--      their own partner, and stating somebody else's is acting as them

begin;
select plan(5);

-- ===========================================================================
-- ONE AGENCY, TWO ROUTES. It sits on the house route and was introduced by a
-- supplier; a second supplier has never met it.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('a4000000-0000-0000-0000-0000000000d1','zzz-route-supplier','ZZZ Route Supplier',
   'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier'),
  ('a4000000-0000-0000-0000-0000000000d2','zzz-route-stranger','ZZZ Route Stranger',
   'pre_referenced_open', 0.25, 0.10, false, false, true, true, 'supplier');

insert into public.agencies (id, partner_id, name) values
  ('a4000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'), 'ZZZ Route Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('a4000000-0000-0000-0000-0000000000b1','a4000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'), 'ZZZ Route Office');

-- THE RELATIONSHIP. This row, and only this row, is what makes the supplier a
-- legitimate route for this agency's branches.
insert into public.partner_agency_relationships (partner_id, agency_id, introduced)
values ('a4000000-0000-0000-0000-0000000000d1','a4000000-0000-0000-0000-0000000000a1', true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('a4000000-0000-0000-0000-00000000c001'::uuid,'zzz.route.admin@r.test'),
  ('a4000000-0000-0000-0000-00000000c002'::uuid,'zzz.route.mgr@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('a4000000-0000-0000-0000-00000000c001','ZZZ Route Admin','zzz.route.admin@r.test','superadmin',null,'active',true),
  ('a4000000-0000-0000-0000-00000000c002','ZZZ Route Mgr','zzz.route.mgr@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('a4000000-0000-0000-0000-00000000c002','agency','a4000000-0000-0000-0000-0000000000a1');

-- ===========================================================================
-- THE ADMIN
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a4000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- 1. NOTHING STATED, NOTHING CHANGED. The path every other caller takes.
select lives_ok(
  $$select public.create_referral(
      'a4000000-0000-0000-0000-0000000000b1','Mx','Dee','Default','1990-01-01',
      'zzz.route.d@r.test','07700900401','1 Route Street',null,'London',null,'RT1 1AA',
      1000, current_date + 30)$$,
  'a referral that states no route is created exactly as before');

-- 2. A ROUTE THE RELATIONSHIP SUPPORTS.
select lives_ok(
  $$select public.create_referral(
      'a4000000-0000-0000-0000-0000000000b1','Mx','Ravi','Routed','1990-01-01',
      'zzz.route.r@r.test','07700900402','2 Route Street',null,'London',null,'RT2 2AA',
      1000, current_date + 30, 'a4000000-0000-0000-0000-0000000000d1')$$,
  'an admin may send a referral down a supplier the agency actually sits under');

reset role;
select is(
  (select partner_id from public.applications where tenant_email = 'zzz.route.r@r.test'),
  'a4000000-0000-0000-0000-0000000000d1'::uuid,
  'and the route is FROZEN onto the application, because partner_id is the route');

-- 3. A SUPPLIER THE BRANCH HAS NEVER SAT UNDER.
select set_config('request.jwt.claims',
  '{"sub":"a4000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_referral(
      'a4000000-0000-0000-0000-0000000000b1','Mx','Stan','Stranger','1990-01-01',
      'zzz.route.s@r.test','07700900403','3 Route Street',null,'London',null,'RT3 3AA',
      1000, current_date + 30, 'a4000000-0000-0000-0000-0000000000d2')$$,
  '22023', 'That branch does not sit under the chosen supplier.',
  'but not down one that has never met them, which is Matt''s own sentence');

-- 4. AND A PARTNER'S OWN MANAGER MAY NOT CHOOSE AT ALL.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a4000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_referral(
      'a4000000-0000-0000-0000-0000000000b1','Mx','Mo','Manager','1990-01-01',
      'zzz.route.m@r.test','07700900404','4 Route Street',null,'London',null,'RT4 4AA',
      1000, current_date + 30, 'a4000000-0000-0000-0000-0000000000d1')$$,
  '42501',   /* "OPNDOOR STAFF", NOT "an opndoor admin", SINCE (bb). Matt gave opndoor
     managers New application "on behalf of any supplier or agency, the same
     form admins use", so the route guard admits them too and its message
     would otherwise name a group it no longer describes.

     WHAT THIS ASSERTION IS ABOUT IS UNCHANGED and is the reason it is
     reworded rather than dropped: a PARTNER'S own manager still may not
     state a route, because theirs is their own partner. The grant widened
     from one kind of opndoor reader to two; it did not reach customers. */
  'Only opndoor staff may choose the route for a referral.',
  'a partner''s own manager may not state a route: theirs is their own partner');

reset role;
select * from finish();
rollback;
