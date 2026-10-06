-- EACH PARTY SAYS WHO IT TELLS.
--
-- Q-03's matrix: notification types against recipient classes, per party, with
-- defaults, locked cells, and a rule about who may edit whose.
--
-- The defaults are asserted as BEHAVIOUR (what notification_enabled answers for
-- a party with no rows) rather than as seeded data, because they are computed:
-- a party that has never been touched has no rows at all, which is what makes a
-- supplier onboarded next month work without a backfill.

begin;
select plan(21);

-- ===========================================================================
-- ONE AGENCY ON THE HOUSE PARTNER, ONE SUPPLIER
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('99000000-0000-0000-0000-0000000000d1','zzz-matrix-supplier','ZZZ Matrix Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true, 'supplier');

insert into public.agencies (id, partner_id, name) values
  ('99000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Matrix Agency'),
  ('99000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Matrix Other');
insert into public.branches (id, agency_id, partner_id, name) values
  ('99000000-0000-0000-0000-0000000000b1','99000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Matrix Office'),
  ('99000000-0000-0000-0000-0000000000b2','99000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Matrix Other Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('99000000-0000-0000-0000-00000000c001'::uuid,'zzz.matrix.dir@m.test'),
  ('99000000-0000-0000-0000-00000000c002'::uuid,'zzz.matrix.mgr@m.test'),
  ('99000000-0000-0000-0000-00000000c003'::uuid,'zzz.matrix.other@m.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('99000000-0000-0000-0000-00000000c001','ZZZ Matrix Dir','zzz.matrix.dir@m.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('99000000-0000-0000-0000-00000000c002','ZZZ Matrix Mgr','zzz.matrix.mgr@m.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('99000000-0000-0000-0000-00000000c003','ZZZ Matrix Other Dir','zzz.matrix.other@m.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null);

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('99000000-0000-0000-0000-00000000c001','agency','99000000-0000-0000-0000-0000000000a1',null),
  ('99000000-0000-0000-0000-00000000c002','agency','99000000-0000-0000-0000-0000000000a1',null),
  ('99000000-0000-0000-0000-00000000c003','agency','99000000-0000-0000-0000-0000000000a2',null);

-- ===========================================================================
-- THE CELLS THAT EXIST
-- ===========================================================================
select set_eq(
  $$select recipient::text from public.notification_recipient_classes('agency')$$,
  $$values ('referrer'::text), ('ticked_users'::text)$$,
  'an agency has a referrer and its ticked users, and no branch-mailbox class');
select set_eq(
  $$select recipient::text from public.notification_recipient_classes('supplier')$$,
  $$values ('referrer'::text), ('agent_contact'::text)$$,
  'a supplier has a referrer and a branch agent contact, and no ticked users');
-- NINE, not the eight the instruction names. 20261006620000 added `approved`:
-- notifyReferrer sends submitted, approved, declined and paid, and the list
-- covered three of them. `decline` was there and its opposite was not, which
-- reads as an omission -- and mapping approved onto an existing cell would
-- mean turning off "deed signed" silently also turned off "approved".
select is((select count(*)::int from public.notification_types()), 9,
  'the eight notification types the instruction names, plus the approval it omitted');

-- ===========================================================================
-- THE DEFAULTS, as behaviour, with no rows stored anywhere
-- ===========================================================================
select is((select count(*)::int from public.notification_settings), 0,
  'nothing is seeded: a party that has changed nothing has no rows');

select ok(public.notification_enabled('agency', null, '99000000-0000-0000-0000-0000000000a1', 'sent', 'referrer'),
  'everything is on for an agency: sent, to the referrer');
select ok(public.notification_enabled('agency', null, '99000000-0000-0000-0000-0000000000a1', 'lapse', 'ticked_users'),
  'and lapse, to its ticked users');

select ok(public.notification_enabled('supplier', '99000000-0000-0000-0000-0000000000d1', null, 'sent', 'referrer'),
  'on a supplier everything is on for the referrer');
select ok(public.notification_enabled('supplier', '99000000-0000-0000-0000-0000000000d1', null, 'deed_issued', 'agent_contact'),
  'and deed issued is on for the agent contact');
select ok(not public.notification_enabled('supplier', '99000000-0000-0000-0000-0000000000d1', null, 'sent', 'agent_contact'),
  'but ONLY deed issued: the agent contact is not told a referral was sent');

-- A class this party does not have is never a recipient, whatever is asked.
select ok(not public.notification_enabled('agency', null, '99000000-0000-0000-0000-0000000000a1', 'sent', 'agent_contact'),
  'a class the party does not have is never a recipient');

-- ===========================================================================
-- WHO MAY EDIT
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.set_notification_setting(null, '99000000-0000-0000-0000-0000000000a1', 'lapse', 'ticked_users', false)$$,
  'a Director edits their own agency''s matrix');
/* ASKED AS THE SERVER, because notification_enabled is a send-path helper and
   20261006570000 revoked it from authenticated: it carries no reach test of
   its own, deliberately, so the browser does not get to ask it. The Director
   above did the WRITE; reading back what the send path will now do is the
   server's question. */
reset role;
select ok(not public.notification_enabled('agency', null, '99000000-0000-0000-0000-0000000000a1', 'lapse', 'ticked_users'),
  'and the switch takes effect');
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- THE OTHER AGENCY'S IS NOT THEIRS.
select throws_ok(
  $$select public.set_notification_setting(null, '99000000-0000-0000-0000-0000000000a2', 'lapse', 'ticked_users', false)$$,
  '42501', null,
  'and cannot touch another agency''s');

-- A MANAGER MAY NOT. The matrix decides who is told what a referral earned.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_notification_setting(null, '99000000-0000-0000-0000-0000000000a1', 'sent', 'referrer', false)$$,
  '42501', null,
  'a Manager cannot edit the matrix, because it decides who is told about money');

-- A SUPPLIER'S MATRIX IS OPNDOOR'S: there is no Director level on that rail.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_notification_setting('99000000-0000-0000-0000-0000000000d1', null, 'sent', 'referrer', false)$$,
  '42501', null,
  'and an agency Director cannot edit a supplier''s matrix');

-- AND THE PREDICATE ITSELF, by name, because it is what every one of those
-- refusals is made of and a definer function on the allowlist has to be
-- exercised directly rather than only through its callers.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.may_edit_notification_matrix(null, '99000000-0000-0000-0000-0000000000a1'),
  'a Director may edit their own agency''s matrix');
select ok(not public.may_edit_notification_matrix(null, '99000000-0000-0000-0000-0000000000a2'),
  'and may not edit another agency''s');

-- ===========================================================================
-- THE LOCKED CELLS
-- ===========================================================================
select throws_ok(
  $$select public.set_notification_setting(null, '99000000-0000-0000-0000-0000000000a1', 'deed_issued', 'referrer', false)$$,
  '42501', 'Delivery of the executed deed to its recipient cannot be turned off.',
  'the deed to its recipient cannot be turned off, and says why');

-- And a locked cell answers true even if a row somehow says otherwise.
reset role;
insert into public.notification_settings (agency_id, notification_type, recipient, enabled)
values ('99000000-0000-0000-0000-0000000000a1','deed_issued','referrer',false);
select ok(public.notification_enabled('agency', null, '99000000-0000-0000-0000-0000000000a1', 'deed_issued', 'referrer'),
  'and a row that says otherwise does not change the answer');

-- ===========================================================================
-- THE CHANGE IS AUDITED
-- ===========================================================================
select is(
  (select count(*)::int from public.org_audit
    where entity_id = '99000000-0000-0000-0000-0000000000a1'
      and action = 'notification_setting'),
  1,
  'the one real change is in the audit, once');

-- ===========================================================================
-- THE MATRIX THE SCREEN DRAWS
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.notification_matrix(null, '99000000-0000-0000-0000-0000000000a1')),
  18,
  'the agency matrix is nine types by its two classes, and draws no switch that does nothing');

select * from finish();
rollback;
