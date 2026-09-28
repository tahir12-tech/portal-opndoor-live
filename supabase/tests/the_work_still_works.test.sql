-- THE WORK STILL WORKS.
--
-- Every other file in this directory asks "is this refused?". Not one asked
-- "does this still succeed?", and that is how two locks shipped green:
--
--   create_invited_user was revoked from authenticated, so NO NEW USER COULD
--   BE INVITED on any rail. The invite raised 42501, the calling function
--   deleted the half-made auth account, and the suite stayed green because
--   every test about inviting was about somebody who should be refused.
--
--   user_scopes_delete called may_act_on_user, which authenticated may not
--   execute, so "Remove position" raised "permission denied for function"
--   for managers and admins alike. The one test that removed a position did
--   it as postgres, where no policy applies.
--
--   set_home_branch, the single sanctioned way to change where somebody
--   sits, was granted to service_role only. Nothing could turn the one key.
--
-- A lock that stops real work is as much a defect as a hole, and it is the
-- kind a suite of refusals cannot see. So: one assertion per user-facing
-- action that a security migration touched, RUN AS THE ROLE THAT SHOULD BE
-- ALLOWED, asserting it succeeds.
--
-- These are `lives_ok` and `is` on purpose. A refusal here is a bug even when
-- the refusal is well-reasoned, because the reasoning has already been had:
-- this is the list of things the product must be able to do.

begin;
select plan(15);

-- ===========================================================================
-- ONE AGENCY, ITS DIRECTOR, ITS MANAGER, ITS NEGOTIATOR
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('95000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Works Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('95000000-0000-0000-0000-0000000000f2','95000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Works Office'),
  ('95000000-0000-0000-0000-0000000000f3','95000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Works Annexe');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('95000000-0000-0000-0000-00000000d001'::uuid,'zzz.works.dir@w.test'),
  ('95000000-0000-0000-0000-00000000d002'::uuid,'zzz.works.mgr@w.test'),
  ('95000000-0000-0000-0000-00000000d003'::uuid,'zzz.works.neg@w.test'),
  ('95000000-0000-0000-0000-00000000d004'::uuid,'zzz.works.new@w.test'),
  ('95000000-0000-0000-0000-00000000d005'::uuid,'zzz.works.second@w.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('95000000-0000-0000-0000-00000000d001','ZZZ Works Dir','zzz.works.dir@w.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('95000000-0000-0000-0000-00000000d002','ZZZ Works Mgr','zzz.works.mgr@w.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('95000000-0000-0000-0000-00000000d003','ZZZ Works Neg','zzz.works.neg@w.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'95000000-0000-0000-0000-0000000000f2'),
  ('95000000-0000-0000-0000-00000000d005','ZZZ Works Second','zzz.works.second@w.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'95000000-0000-0000-0000-0000000000f2');

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('95000000-0000-0000-0000-00000000d001','agency','95000000-0000-0000-0000-0000000000f1',null),
  ('95000000-0000-0000-0000-00000000d002','branch',null,'95000000-0000-0000-0000-0000000000f2'),
  ('95000000-0000-0000-0000-00000000d003','branch',null,'95000000-0000-0000-0000-0000000000f2'),
  ('95000000-0000-0000-0000-00000000d005','branch',null,'95000000-0000-0000-0000-0000000000f2');

insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary)
values ('95000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Works Desk','desk@w.test',true);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values ('95000000-0000-0000-0000-00000000e0f1','ZZZ-WORKS-1',(select id from public.partners where slug='opndoor-agents'),
   '95000000-0000-0000-0000-0000000000f1','95000000-0000-0000-0000-0000000000f2','95000000-0000-0000-0000-00000000d003','ZZZ Works Neg',
   'Mx','Wanda','Works','1990-01-01','wanda@w.test','07700900010','1 Works Street','London','WK1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '1 day');

-- ===========================================================================
-- AS THE DIRECTOR, who should be able to run their own agency
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-00000000d001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- 1. INVITE A NEW USER. The one that was broken outright.
select lives_ok(
  $$select public.create_invited_user(
      '95000000-0000-0000-0000-00000000d004','zzz.works.new@w.test','ZZZ Works New','referrer',
      (select id from public.partners where slug='opndoor-agents'),
      '95000000-0000-0000-0000-0000000000f2', false, 'branch', '95000000-0000-0000-0000-0000000000f2')$$,
  'a Director can invite a new Negotiator into their own branch');

reset role;
select is((select kind from public.user_scopes where user_id = '95000000-0000-0000-0000-00000000d004'),
  'branch',
  'and the new person arrives holding the position, in one transaction with their row');
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-00000000d001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- 2. RE-INVITE somebody who already exists: a different path through the same
--    function, and the one that kept working while new invites did not.
select lives_ok(
  $$select public.set_user_scope('95000000-0000-0000-0000-00000000d004','branch','95000000-0000-0000-0000-0000000000f3')$$,
  'and can move that person to another of their own offices');

/* 3. REMOVE A POSITION, which is a narrower action than it sounds.
      user_scopes has SELECT and DELETE policies and no INSERT: positions are
      granted only through set_user_scope, which REPLACES, so nobody ever
      holds two. And the constraint trigger refuses removing the last one
      from an active person on our estate. So "Remove position" succeeds in
      exactly one case: after they are deactivated. That is the product's
      real answer -- place them, or deactivate them -- and it is the case
      that was raising "permission denied for function may_act_on_user"
      rather than doing either. */
-- Done on the ACTIVE colleague, not the one just invited: an invitee is
-- 'pending', and the position guard covers pending too, because somebody who
-- has not accepted yet still needs a boundary the day they do.
select lives_ok(
  $$select public.admin_set_user_status('95000000-0000-0000-0000-00000000d005','deactivated')$$,
  'a Director can deactivate somebody in their own agency');
select lives_ok(
  $$delete from public.user_scopes where user_id = '95000000-0000-0000-0000-00000000d005';
    set constraints all immediate$$,
  'and Remove position then succeeds, which it could not while the policy called a function the caller may not execute');
-- Put constraints back, or every later write in this transaction is checked
-- immediately and the deferred guard stops being deferred.
select lives_ok($$set constraints all deferred$$, 'and the deferred guard is restored for the rest of this file');

-- 4. CHANGE LEVEL, both directions across the one bit that separates them.
select lives_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-00000000d003','Manager')$$,
  'a Director can promote their Negotiator to Manager');
select lives_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-00000000d003','Negotiator')$$,
  'and put them back');

-- 5. SET A HOME BRANCH through the one sanctioned door.
select lives_ok(
  $$select public.set_home_branch('95000000-0000-0000-0000-00000000d003','95000000-0000-0000-0000-0000000000f3')$$,
  'a Director can place somebody at another of their offices, through set_home_branch');

-- 6. RENAME somebody, which the identity guard deliberately still allows.
select lives_ok(
  $$update public.users set full_name = 'ZZZ Works Neg Renamed'
     where id = '95000000-0000-0000-0000-00000000d003'$$,
  'and rename them, because the identity guard covers the delivery address and not the label');

-- 8. RESET MFA for somebody below them.
select lives_ok(
  $$select public.admin_reset_user_mfa('95000000-0000-0000-0000-00000000d003')$$,
  'and reset their MFA');

-- ===========================================================================
-- AS THE NEGOTIATOR, on their own application
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-00000000d003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- 9. READ THEIR OWN BOOK. The column revokes narrowed applications twice;
--    a re-grant that was too narrow would empty every screen.
select is((select count(*)::int from public.applications where guarantee_ref = 'ZZZ-WORKS-1'), 1,
  'a Negotiator still sees their own application after two rounds of column revokes');

-- 10. WITHDRAW IT. A write through a definer RPC on their own row.
select lives_ok(
  $$select public.mark_withdrawn('ZZZ-WORKS-1','tenancy_fell_through','The tenant pulled out.')$$,
  'and can withdraw it');

-- 11. ADD A NOTE, the other write they own.
reset role;
update public.applications set status = 'sent', withdrawn_at = null where guarantee_ref = 'ZZZ-WORKS-1';
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-00000000d003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.add_application_note('ZZZ-WORKS-1','Spoke to the tenant.')$$,
  'and can add a business note to it');

-- 12. THE DEED PATH. send_deed_to_agent is called by an edge function AS the
--     caller, so the grant has to hold for a signed-in user. Refusing because
--     the application is not at 'deed' is the right refusal; refusing with
--     42501 would be the grant being wrong, and that is what this separates.
select throws_ok(
  $$select public.send_deed_to_agent('95000000-0000-0000-0000-00000000e0f1', null, false)$$,
  'P0001', null,
  'send_deed_to_agent is reachable and refuses on the STATE (deed not yet issued), not on permission');

select * from finish();
rollback;
