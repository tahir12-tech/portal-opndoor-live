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
select plan(23);

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

/* AND ACROSS THE TWO MANAGEMENT LEVELS, which is the move the admin screen
   could not make until Q-06 item G.
   Director and Manager share role = 'management' and differ only by
   sees_commission, so /users' "Edit role" -- which writes `role` -- could
   not move anybody between them at all. It is the move an agency actually
   argues about, and nothing asserted it worked. set_agency_level is the one
   door that writes both columns together. */
select lives_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-00000000d002','Director')$$,
  'a Director can promote their Manager to Director');

/* AND THEN CANNOT PUT THEM BACK, which surprised me and is correct.
   The ladder is "someone BELOW your own level" (assert_may_act_on_user).
   The moment that Manager becomes a Director they are a PEER, and demoting a
   peer is a lateral act on somebody who can do the same to you. It takes an
   opndoor admin. Asserted rather than worked around, because the obvious
   test -- promote then demote, the shape used for the Negotiator pair above
   -- passes only where the two levels are not adjacent to the actor's own,
   and reading that asymmetry as a bug is exactly how a ladder gets loosened. */
select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-00000000d002','Manager')$$,
  '42501', 'You can only do this to someone below your own level.',
  'and then cannot demote them, because a Director is not below a Director');

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

/* 13. THE MONTHLY STATEMENT CAN ACTUALLY BE SENT.
 *
 * This is the functional-guard case in its purest form: a permission gate so
 * tight that the sanctioned caller is refused, and nobody noticed because
 * nothing asserted that the sanctioned caller works.
 *
 * commission_statement_ref falls through only for is_admin() or
 * app_role() = 'opndoor_manager'. The monthly run is two pg_cron jobs posting
 * to the commission-statements function, which calls this RPC with the
 * SERVICE key and no user JWT. Measured on dev: current_user service_role,
 * auth.uid() null, is_admin() false, may_see_commission() false -- so the
 * gate raised 'You can only read a statement for a party you hold.' for
 * every payee, every month.
 *
 * commission_statement_sends held ZERO rows on dev. No statement has ever
 * been sent, to anybody, on either rail. The three refs that do exist were
 * minted by one seeding transaction from a browser on 2026-09-26, identical
 * to the microsecond across three consecutive subtransaction ids.
 *
 * Not true of production: the whole subsystem is absent from the live 65
 * migrations, so nothing is broken there today. It would have shipped broken
 * at cutover instead. Fixed by 20261006740000.
 */
/* THE WHOLE CHAIN, not just the step that raised. The Edge Function makes
   five database calls in order, each of which could have its own gate, and
   fixing only the one that happened to raise first would move the failure
   rather than remove it. Each is asserted as lives_ok rather than on its
   result: the question here is whether the cron is REFUSED, not whether dev
   happens to hold data for that month. */
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select lives_ok(
  $$select count(*) from public.commission_statement_payees('2026-09-01')$$,
  'the monthly run can list the month''s payees');

select lives_ok(
  $$select count(*) from public.commission_statement_lines('2026-09-01')$$,
  'and read the commission lines behind them');

select lives_ok(
  $$select count(*) from public.commission_statement_recipients('agency', '95000000-0000-0000-0000-0000000000a1')$$,
  'and resolve who each statement goes to');

select lives_ok(
  $$select public.commission_statement_ref('2026-11', 'opndoor-agents|agency:95000000-0000-0000-0000-0000000000a1')$$,
  'and READ the statement reference, which is the step that refused it every month until now');
/* AND MINTING IS THE RUN'S, 20261007650000. This file walks the monthly
   run's steps, and taking the number is one of them, so the step is still
   here -- asked of the half that does it, as the caller that does it. */
select lives_ok(
  $$select public.mint_commission_statement_ref('2026-11', 'opndoor-agents|agency:95000000-0000-0000-0000-0000000000a1')$$,
  'and the run itself mints one');

select lives_ok(
  $$insert into public.commission_statement_sends (statement_month, payee_key, recipients, total)
    values ('2026-11', 'opndoor-agents|agency:95000000-0000-0000-0000-0000000000a1', 1, 123.45)$$,
  'and record that it was sent, which is the row that had never once been written');

reset role;

select * from finish();
rollback;
