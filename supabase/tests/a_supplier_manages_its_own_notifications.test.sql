-- Q4. A SUPPLIER'S MANAGEMENT MANAGES ITS OWN PEOPLE'S NOTIFICATIONS.
--
-- Matt, 2026-09-30, verbatim: "Q4: yes. A supplier's Management user can
-- change the notification settings of anyone at the same supplier, the same
-- way an agency Director can for their agency. Referrers can change only
-- their own event choices. Monthly statements stay Management-only."
--
-- WHY IT COULD NOT WORK BEFORE, AND IT WAS NOT A UI OVERSIGHT.
-- `caller_may_set_for` tests the ladder through `user_within_caller_scope`,
-- which requires the TARGET to hold a row in `user_scopes`. A supplier's
-- staff never hold one, deliberately: `user_must_hold_a_position` returns
-- early off the estate and says why -- "on the supplier rail partner_id IS
-- the company boundary ... requiring a position there would be ceremony
-- with no boundary behind it." So the guard was not refusing supplier
-- management; it was finding nothing to reason about and answering no.
-- Recorded as B3 and as round 6's M10, and this closes both.
--
-- THE BOUNDARY HERE IS partner_id, AND THAT IS RULE 2 RATHER THAN A
-- VIOLATION OF IT. On the agency rail every agency shares the house partner
-- so partner_id is a route; on the SUPPLIER rail the partner IS the company.
-- This is the one rail where that column is the right test, and the arm is
-- written so it can never fire on the house partners.
--
-- THE NEGATIVE ASSERTIONS ARE THE POINT. A rule that grants is easy; the
-- ones that matter here are that a supplier's Referrer still cannot reach
-- a colleague, that statements stay Management-only, and above all that a
-- supplier's Management cannot reach ANOTHER supplier's people -- which is
-- the failure mode a partner_id test invites if it is written carelessly.

begin;
select plan(15);

-- ---------------------------------------------------------------------------
-- TWO SUPPLIERS, so "the same supplier" is a real boundary and not a tautology
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, status, is_house_route) values
  ('e4000000-0000-0000-0000-0000000000f1','zzz-sup-one','ZZZ Supplier One','active',false),
  ('e4000000-0000-0000-0000-0000000000f2','zzz-sup-two','ZZZ Supplier Two','active',false)
on conflict (id) do nothing;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e4000000-0000-0000-0000-00000000c001'::uuid,'zzz.s1.mgmt@s.test'),
  ('e4000000-0000-0000-0000-00000000c002'::uuid,'zzz.s1.ref@s.test'),
  ('e4000000-0000-0000-0000-00000000c003'::uuid,'zzz.s1.col@s.test'),
  ('e4000000-0000-0000-0000-00000000c004'::uuid,'zzz.s2.mgmt@s.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e4000000-0000-0000-0000-00000000c001','ZZZ Sup1 Management','zzz.s1.mgmt@s.test','management',
   'e4000000-0000-0000-0000-0000000000f1','active',true),
  ('e4000000-0000-0000-0000-00000000c002','ZZZ Sup1 Referrer','zzz.s1.ref@s.test','referrer',
   'e4000000-0000-0000-0000-0000000000f1','active',false),
  ('e4000000-0000-0000-0000-00000000c003','ZZZ Sup1 Colleague','zzz.s1.col@s.test','referrer',
   'e4000000-0000-0000-0000-0000000000f1','active',false),
  ('e4000000-0000-0000-0000-00000000c004','ZZZ Sup2 Management','zzz.s2.mgmt@s.test','management',
   'e4000000-0000-0000-0000-0000000000f2','active',true);


-- ===========================================================================
-- AS THE SUPPLIER'S MANAGEMENT
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* BOTH HALVES OF THE GATE, ASKED BY NAME. The gates read
   `caller_leads_their_party() and caller_may_set_for(x)` -- am I senior
   enough, and is this person mine -- and both needed a supplier answer.
   Asserting the pair directly is also what keeps
   `caller_leads_their_party` off the coverage ratchet's uncovered list:
   it is browser-reachable through the write policy, so it has to be
   granted, so it has to be proven. */
select ok(public.caller_leads_their_party(),
  'a supplier Management user leads their own party, which caller_is_director could never say');

select ok(public.caller_may_set_for('e4000000-0000-0000-0000-00000000c002'),
  'and may reach their own referrer, which was the whole of B3');

select ok(public.caller_may_set_for('e4000000-0000-0000-0000-00000000c001'),
  'and themselves');

-- THE ONE THAT MATTERS MOST. A partner_id test written carelessly reaches
-- everybody on every rail; this must stop at the supplier's own door.
select ok(not public.caller_may_set_for('e4000000-0000-0000-0000-00000000c004'),
  'but NOT another supplier''s management, which is what a careless partner test would allow');

select lives_ok($$select public.set_notification_for('e4000000-0000-0000-0000-00000000c002','sent',false)$$,
  'and may change a colleague''s event choice');

select lives_ok($$select public.set_receives_notifications('e4000000-0000-0000-0000-00000000c002', true)$$,
  'and may copy a colleague in on referrals, which the agency rail calls Director-only');

/* MONTHLY STATEMENTS, AND BOTH HALVES OF THIS MOVED ON 2026-09-30.
   It used to expect 22023, for a reason that no longer holds, and the
   reason mattering more than the code is why the whole note is rewritten
   rather than the errcode edited.

   WHAT USED TO HAPPEN. The gate admitted a supplier's management -- that
   is Q4 -- and the step BEFORE it refused:
   `commission_statement_party(p_user)` answered nothing for anybody with
   no org attachment, and a supplier's staff have none, deliberately
   (decision D11). So the error was 22023 "not attached to a group,
   agency or branch", and the NM-O sweep recorded it as a gap: "a
   supplier Director can never be put on a commission statement".

   BOTH ENDS CHANGED, IN OPPOSITE DIRECTIONS. Supplier statements
   (20261007040000) gave `commission_statement_party` a fourth arm, so a
   supplier person now resolves to their SUPPLIER and the gap is closed.
   And the same instruction narrowed who may switch the tick: "Only
   Opndoor admin can switch statements on or off for a supplier's users;
   supplier users cannot change it for themselves or colleagues."

   So the refusal is now the PERMISSION refusal, 42501, which is a
   stronger thing to assert than the old one: it says nobody at the
   supplier may, rather than that nobody could be addressed at all. This
   is the half of Q4 Matt reversed, and it is asserted from both sides --
   here, and by the two throws_ok in
   a_supplier_gets_its_own_statement.test.sql. */
select throws_ok($$select public.set_receives_commission_statements('e4000000-0000-0000-0000-00000000c001', true)$$,
  '42501', null,
  'a supplier Management user may not switch a statement on, for themselves or anyone: Opndoor only, which reverses half of Q4');

select throws_ok($$select public.set_notification_for('e4000000-0000-0000-0000-00000000c004','sent',false)$$,
  '42501', null, 'while another supplier''s person is refused');

-- ===========================================================================
-- AS THE SUPPLIER'S REFERRER. "Referrers can change only their own event
-- choices" -- and the two negatives are the half that is easy to lose.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok($$select public.set_notification_for('e4000000-0000-0000-0000-00000000c002','sent',true)$$,
  'a supplier referrer may change their OWN event choice');

select throws_ok($$select public.set_notification_for('e4000000-0000-0000-0000-00000000c003','sent',false)$$,
  '42501', null, 'and not a colleague''s');

/* A referrer is refused, and by the LEVEL check rather than the
   permission one, because that check runs first on purpose: its own
   comment says "'change their level first' is the useful answer even to
   somebody who would not have been allowed anyway." The refusal is what
   Matt asked for; the code it arrives with is a documented trade-off and
   is asserted as it is rather than quietly reversed. */
select throws_ok($$select public.set_receives_commission_statements('e4000000-0000-0000-0000-00000000c002', true)$$,
  '22023', null, 'and cannot give themselves a monthly statement: that stays Management-only');

select throws_ok($$select public.set_receives_notifications('e4000000-0000-0000-0000-00000000c002', true)$$,
  '42501', null, 'and cannot copy themselves in on colleagues'' referrals');

-- ===========================================================================
-- THE AGENCY RAIL IS UNCHANGED, which is the regression half: widening the
-- supplier arm must not loosen the agency ladder by a single rung.
-- ===========================================================================
reset role;
-- auth.users FIRST: public.users.id references it.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e4000000-0000-0000-0000-00000000c005','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.est.mgr@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e4000000-0000-0000-0000-00000000c005','ZZZ Est Manager','zzz.est.mgr@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',false);

/* c006 is a SECOND estate person at a different agency on the SAME house
   partner. Inserted here, in the reset-role region, because every fixture
   write has to happen before a persona is assumed: `authenticated` has no
   insert on auth.users, and a fixture written mid-test errors rather than
   failing an assertion. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e4000000-0000-0000-0000-00000000c006','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.est.oth@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e4000000-0000-0000-0000-00000000c006','ZZZ Other Estate Person','zzz.est.oth@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false);

select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000c005","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- An estate MANAGER holds no position here and may not see commission, so
-- they are not a Director and the agency arm must still refuse them.
select ok(not public.caller_may_set_for('e4000000-0000-0000-0000-00000000c001'),
  'an estate manager still cannot reach a supplier''s person');

/* The estate manager is refused too, and for the plain reason now
   rather than the incidental one. This was 22023 -- the target had no
   attachment to resolve -- which meant the assertion passed without ever
   reaching the permission check. Since 20261007040000 a supplier person
   resolves to their supplier, so the refusal is the permission itself. */
select throws_ok($$select public.set_receives_commission_statements('e4000000-0000-0000-0000-00000000c001', true)$$,
  '42501', null, 'and cannot switch on a statement for one');

/* AND THE HOUSE PARTNER IS NEVER "THE SAME SUPPLIER". This is the
   assertion the whole migration turns on. EVERY agency Opndoor onboards
   shares `opndoor-agents`, so an arm that tested partner_id without
   excluding the house routes would hand every agency's management the
   notification settings of every other agency on the estate -- which is
   rule 2, and the single most repeated finding in this whole effort.

   c005 and c006 are at two DIFFERENT agencies on the same house partner,
   which is exactly the pair that would collide. */

select ok(not public.caller_may_set_for('e4000000-0000-0000-0000-00000000c006'),
  'and one estate agency''s management cannot reach another''s person through the shared house partner');

select * from finish();
rollback;
