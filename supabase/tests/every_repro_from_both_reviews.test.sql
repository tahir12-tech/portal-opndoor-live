-- EVERY REPRODUCTION FROM BOTH REVIEWS, AS A STANDING ASSERTION.
--
-- Two reviews looked at this schema: one given only the five isolation rules
-- and the code, one a from-scratch sweep of every policy, definer function,
-- edge function, cron recipient list, export and client read. Between them
-- they produced a set of concrete reproductions -- not "this looks wrong" but
-- "this is what I ran and this is what came back".
--
-- A fix with no test is a fix until somebody rewrites the function. So each
-- reproduction is here, phrased as the attack rather than as the fix, and
-- EVERY ONE OF THEM FAILS against the code as it stood before 20261006300000.
--
-- The two that were measured end to end on dev, and are worth stating in the
-- numbers they came back with:
--
--   Rosa Vance, a Director at Regent's, over PostgREST:
--     before                                 7 applications, 1 agency
--     PATCH own home_branch_id -> Northgate   succeeded
--     after                                 21 applications, 2 agencies
--     UPDATE Northgate's applications        14 rows written
--
--   Regent's Negotiator, on their own sent application:
--     update applications set agency_id = <Northgate> where id = <mine>
--     -> MOVED, 1 row. The application now belongs to: Northgate Lettings
--
-- TWO AGENCIES ON ONE HOUSE PARTNER is the whole fixture, because that is the
-- only shape in which any of this is visible. With one agency per partner
-- every broken answer and every fixed answer are identical.
--
-- SET CONSTRAINTS ALL IMMEDIATE appears wherever the position guard is being
-- tested, and it is load-bearing: that guard is a DEFERRABLE INITIALLY
-- DEFERRED constraint trigger, so it fires at COMMIT -- and a pgTAP test
-- never commits. Without forcing it, every assertion about it would pass by
-- never running.

begin;
select plan(43);

-- ===========================================================================
-- THE FIXTURE: Ours and Theirs, on the same route.
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Repro Ours'),
  ('96000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Repro Theirs');
insert into public.branches (id, agency_id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Ours Office'),
  ('96000000-0000-0000-0000-0000000000b2','96000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Theirs Office');
insert into public.agency_groups (id, partner_id, name) values
  ('96000000-0000-0000-0000-00000000ab02',(select id from public.partners where slug='opndoor-agents'),'ZZZ Theirs Group');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('96000000-0000-0000-0000-00000000c001'::uuid,'zzz.repro.ourdir@r.test'),
  ('96000000-0000-0000-0000-00000000c002'::uuid,'zzz.repro.ourneg@r.test'),
  ('96000000-0000-0000-0000-00000000c003'::uuid,'zzz.repro.theirdir@r.test'),
  ('96000000-0000-0000-0000-00000000c004'::uuid,'zzz.repro.theirneg@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('96000000-0000-0000-0000-00000000c001','ZZZ Our Dir','zzz.repro.ourdir@r.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('96000000-0000-0000-0000-00000000c002','ZZZ Our Neg','zzz.repro.ourneg@r.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'96000000-0000-0000-0000-0000000000b1'),
  ('96000000-0000-0000-0000-00000000c003','ZZZ Their Dir','zzz.repro.theirdir@r.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('96000000-0000-0000-0000-00000000c004','ZZZ Their Neg','zzz.repro.theirneg@r.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'96000000-0000-0000-0000-0000000000b2');

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('96000000-0000-0000-0000-00000000c001','agency','96000000-0000-0000-0000-0000000000a1',null),
  ('96000000-0000-0000-0000-00000000c002','branch',null,'96000000-0000-0000-0000-0000000000b1'),
  ('96000000-0000-0000-0000-00000000c003','agency','96000000-0000-0000-0000-0000000000a2',null),
  ('96000000-0000-0000-0000-00000000c004','branch',null,'96000000-0000-0000-0000-0000000000b2');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values
  ('96000000-0000-0000-0000-00000000e001','ZZZ-R-1',(select id from public.partners where slug='opndoor-agents'),
   '96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000b1',
   '96000000-0000-0000-0000-00000000c002','ZZZ Our Neg','Mx','Ann','Ours','1990-01-01','ann@r.test','07700900001',
   '1 Ours Street','London','OU1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '2 days'),
  ('96000000-0000-0000-0000-00000000e002','ZZZ-R-2',(select id from public.partners where slug='opndoor-agents'),
   '96000000-0000-0000-0000-0000000000a2','96000000-0000-0000-0000-0000000000b2',
   '96000000-0000-0000-0000-00000000c004','ZZZ Their Neg','Mx','Ben','Theirs','1990-01-01','ben@r.test','07700900002',
   '2 Theirs Street','London','TH1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '2 days');

insert into public.agent_contacts (id, agency_id, partner_id, name, email, is_primary)
values ('96000000-0000-0000-0000-00000000f002','96000000-0000-0000-0000-0000000000a2',
        (select id from public.partners where slug='opndoor-agents'),'ZZZ Theirs Desk','theirs@r.test',true);

insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor, actor_id)
values ('96000000-0000-0000-0000-00000000c003',(select id from public.partners where slug='opndoor-agents'),
        'role','referrer','management','ZZZ Their Dir','96000000-0000-0000-0000-00000000c003');

insert into public.user_agency_attachments (user_id, agency_id)
values ('96000000-0000-0000-0000-00000000c003','96000000-0000-0000-0000-0000000000a2');

insert into public.activity_log (application_id, kind, message, actor, visibility)
values ('96000000-0000-0000-0000-00000000e001','deed_email_failed',
        'Resend 422: the provider rejected the address',  'System','internal');

-- ===========================================================================
-- REPRO 1: A MANAGER REWRITES THEIR OWN BOUNDARY
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications), 1,
  'before: our Director sees one application, their own agency''s');

-- The PATCH itself. It used to succeed and move the boundary; it is now
-- refused by a column trigger, whatever else the row policy allows.
select throws_ok(
  $$update public.users set home_branch_id = '96000000-0000-0000-0000-0000000000b2'
     where id = '96000000-0000-0000-0000-00000000c001'$$,
  '42501', 'Where somebody sits is changed from their row by a manager who reaches them, not by editing this field.',
  'PATCHing your own home branch is refused, and says who does set it');

-- And the second, independent half: even if the column moved, it no longer
-- decides anything. app_scoped_agencies reads positions and nothing else.
reset role;
update public.users set home_branch_id = '96000000-0000-0000-0000-0000000000b2'
  where id = '96000000-0000-0000-0000-00000000c001';
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- Measured through the AGENCIES they can read, not through the helper: the
-- helper is service_role only now, and the observable answer is the one that
-- matters anyway.
select is((select count(*)::int from public.agencies where name like 'ZZZ Repro %'), 1,
  'and with the column forced to the other agency anyway, it buys no reach at all');
select is((select count(*)::int from public.applications), 1,
  'so the application count is unchanged: 1, not 2');
select is((select count(*)::int from public.applications
            where agency_id = '96000000-0000-0000-0000-0000000000a2'), 0,
  'and none of them is the other agency''s');

-- ===========================================================================
-- REPRO 2: A NEGOTIATOR MOVES THEIR OWN APPLICATION TO A COMPETITOR
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- agency_id alone: structurally re-derived from branch_id by the sync trigger,
-- which now fires on both columns. The write is accepted and changes nothing,
-- which is the correct outcome for a column that is not independently settable.
select lives_ok(
  $$update public.applications set agency_id = '96000000-0000-0000-0000-0000000000a2'
     where id = '96000000-0000-0000-0000-00000000e001'$$,
  'a negotiator may write their own application');
reset role;
select is((select agency_id from public.applications where id = '96000000-0000-0000-0000-00000000e001'),
  '96000000-0000-0000-0000-0000000000a1'::uuid,
  'but setting agency_id alone does not move it: the agency follows the branch');

-- branch AND agency together, which is the form that would actually have
-- moved it. Refused.
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
-- No errcode asserted: this is refused twice over, by the row policy's WITH
-- CHECK on the agency it would move TO and by the sync trigger being unable
-- to read a branch the caller cannot see. Either is a correct refusal, and
-- pinning one of them would make the test brittle about which fires first.
select throws_ok(
  $$update public.applications
       set branch_id = '96000000-0000-0000-0000-0000000000b2',
           agency_id = '96000000-0000-0000-0000-0000000000a2'
     where id = '96000000-0000-0000-0000-00000000e001'$$,
  null, null, 'moving it branch and all is refused outright');
reset role;
select is((select agency_id from public.applications where id = '96000000-0000-0000-0000-00000000e001'),
  '96000000-0000-0000-0000-0000000000a1'::uuid,
  'and it is still ours afterwards');

-- ===========================================================================
-- REPRO 3: THE PEOPLE SURFACE, READ ACROSS THE ROUTE
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.users
            where email like 'zzz.repro.their%'), 0,
  'our Director reads none of the other agency''s people');
select is((select count(*)::int from public.user_scopes s
            join public.users u on u.id = s.user_id where u.email like 'zzz.repro.their%'), 0,
  'nor their positions, which is the org chart of a competitor');
select is((select count(*)::int from public.user_audit
            where target_user = '96000000-0000-0000-0000-00000000c003'), 0,
  'nor their people lifecycle trail: demotions, MFA resets, password authorisations');
select is((select count(*)::int from public.user_agency_attachments
            where agency_id = '96000000-0000-0000-0000-0000000000a2'), 0,
  'nor which agency their people are attached to');
select is((select count(*)::int from public.partner_agency_relationships
            where agency_id = '96000000-0000-0000-0000-0000000000a2'), 0,
  'nor the relationship row that would have handed over the agency uuid itself');
select is((select count(*)::int from public.list_managed_users()
            where email like 'zzz.repro.their%'), 0,
  'and the people list the Team screen draws agrees with all of that');

-- THE LEVEL READERS, which answer for any uuid you can name.
select is(public.level_rank_of('96000000-0000-0000-0000-00000000c003'), null,
  'another agency''s seniority does not answer, even though the uuid is valid');
-- agency_level_of answers the same question by name and is not callable from
-- the browser at all, which is the stronger form of the same guarantee. Its
-- own reach gate is defence in depth behind this.
select throws_ok(
  $$select public.agency_level_of('96000000-0000-0000-0000-00000000c003')$$,
  '42501', null, 'nor their level by name, which the browser may not ask for at all');
select is(public.level_rank_of('96000000-0000-0000-0000-00000000c002'), 3,
  'while their own Negotiator still ranks, so the ladder is not broken by the gate');

-- ===========================================================================
-- REPRO 4: THE WRITE PATHS INTO ANOTHER AGENCY
-- ===========================================================================
select throws_ok(
  $$select public.org_set_primary_contact('96000000-0000-0000-0000-00000000f002')$$,
  '42501', 'Not permitted.',
  'and they cannot make themselves another agency''s primary contact, which would redirect its deeds');
select throws_ok(
  $$select public.set_agency_group('96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-00000000ab02')$$,
  '42501', 'You can only file an agency under a group you hold.',
  'nor file their own agency under a group belonging to somebody else');
/* THE REAL KEY SHAPE, and this assertion is why. The first version of it
   passed 'agency:<uuid>', which is the shape I assumed when I wrote the reach
   gate, and the gate and the test then agreed with each other and with
   nothing else. payeeKey() in src/data/commissionSplit.ts:84 builds
   '<level>:<org id>' and the caller prepends '<partner slug>|', so a real key
   is 'opndoor-agents|agency:<uuid>'. Under the wrong parser EVERY non-admin
   was refused, including for their own agency, and this test still passed.
   Both directions are asserted now: their own works, another party's does
   not. */
select throws_ok(
  $$select public.commission_statement_ref('2026-09','opndoor-agents|agency:96000000-0000-0000-0000-0000000000a2')$$,
  '42501', 'You can only read a statement for a party you hold.',
  'nor read or mint another party''s commission statement number');
select matches(
  (select public.commission_statement_ref('2026-09','opndoor-agents|agency:96000000-0000-0000-0000-0000000000a1')),
  '^STMT-2026-09-[0-9]{4}$',
  'while their OWN agency''s reference is minted, in the STMT-YYYY-MM-NNNN shape');

-- THE INTERNAL TRAIL. Declared opndoor-admin-only and enforced in one render
-- site in the client, which is not enforcement.
select is((select count(*)::int from public.activity_log
            where application_id = '96000000-0000-0000-0000-00000000e001'
              and visibility = 'internal'), 0,
  'and an internal-only activity row is filtered by the policy, not by the screen');

-- ===========================================================================
-- REPRO 5: THE UNPOSITIONED STATE, WHICH IS WHAT MADE THE FAIL-OPENS PAY
-- ===========================================================================
reset role;
select throws_ok(
  $$delete from public.user_scopes where user_id = '96000000-0000-0000-0000-00000000c001';
    set constraints all immediate$$,
  '23514', null,
  'removing somebody''s last position on our estate is refused at the database');

-- ...and the way out is to deactivate them, not to leave them unplaced.
select lives_ok(
  $$update public.users set status = 'deactivated' where id = '96000000-0000-0000-0000-00000000c003';
    delete from public.user_scopes where user_id = '96000000-0000-0000-0000-00000000c003';
    set constraints all immediate$$,
  'while deactivating them first is allowed, which is the honest way to remove somebody');

-- The supplier rail keeps its unpositioned management, because there the
-- partner IS the company and a position would be ceremony.
select lives_ok(
  $$insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate)
    values ('96000000-0000-0000-0000-00000000ac09','zzz-repro-supplier','ZZZ Repro Supplier','pre_referenced_open',0.25,0.10);
    set constraints all immediate$$,
  'and the supplier rail is untouched by any of it');

-- ===========================================================================
-- REPRO 6: THE GRANT SURFACE
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- Three functions that hand out a named staff email or a whole estate, none
-- of which the browser has ever called.
select throws_ok(
  $$select public.deed_people_target('96000000-0000-0000-0000-0000000000b2')$$,
  '42501', null, 'the browser cannot ask for another branch''s deed recipient by name');
select throws_ok(
  $$select public.agency_notification_recipients('96000000-0000-0000-0000-00000000e002')$$,
  '42501', null, 'nor for the notification ladder of an application it does not own');
select throws_ok(
  $$select public.staff_notification_scopes((select id from public.partners where slug='opndoor-agents'))$$,
  '42501', null, 'nor for every digest reader on the route');

-- And org_deed_readiness, which a Negotiator could call for the whole estate,
-- answers only for what they hold.
select is((select count(*)::int from public.org_deed_readiness()
            where agency_id = '96000000-0000-0000-0000-0000000000a2'), 0,
  'and deed readiness reports on their own agency, not on every agency we carry');

-- ===========================================================================
-- REPRO 7: THE THIRD REVIEWER'S FOUR, THREE OF WHICH WERE MINE
-- ===========================================================================

-- A BRANCHLESS AGENCY. 20260927100000 made the first branch optional, so a
-- group can be stood up as a skeleton. The containment test in set_user_scope
-- asked "does any branch under the target lie outside my scope", which is
-- FALSE of an agency with no branches, so it passed vacuously. Reproduced on
-- dev: a Director placed their own Negotiator onto a branchless agency they
-- do not reach.
reset role;
insert into public.agencies (id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000a9',(select id from public.partners where slug='opndoor-agents'),'ZZZ Repro Branchless');
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_user_scope('96000000-0000-0000-0000-00000000c002','agency','96000000-0000-0000-0000-0000000000a9')$$,
  '42501', null,
  'a branchless agency they do not reach is still an agency they may not place somebody at');

-- THE COMMISSION COLUMNS. 20261006350000 wrote a column-level revoke with no
-- table-level revoke in front of it, which Postgres accepts in silence and
-- which changes nothing. Asked as a privilege rather than as a query, because
-- that is the question PostgREST asks and the one the broken version passed.
reset role;
select ok(not has_column_privilege('authenticated', 'public.agencies', 'partner_rate', 'SELECT'),
  'authenticated cannot select agencies.partner_rate');
select ok(not has_column_privilege('authenticated', 'public.agencies', 'agent_rate', 'SELECT'),
  'nor agencies.agent_rate');
select ok(not has_column_privilege('authenticated', 'public.agency_groups', 'agent_rate', 'SELECT'),
  'nor agency_groups.agent_rate');
select ok(not has_column_privilege('authenticated', 'public.branches', 'agent_rate', 'SELECT'),
  'nor branches.agent_rate, which is the one a Negotiator actually read on dev');
select ok(has_column_privilege('authenticated', 'public.agencies', 'name', 'SELECT'),
  'while an ordinary column is still selectable, so the re-grant is not too narrow');

-- THE DELIVERY ADDRESS. users.email is what the executed deed, the commission
-- statement and the weekly digest are sent to, and it was the one meaningful
-- column on that table with no trigger. A Director rewrote their own
-- Negotiator's and the deed address became attacker@evil.test.
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$update public.users set email = 'attacker@evil.test'
     where id = '96000000-0000-0000-0000-00000000c002'$$,
  '42501', null,
  'a Director cannot rewrite the address their Negotiator''s deeds are sent to');
-- The NAME is deliberately still editable: users_mgmt_update is meant to be
-- narrow, three older tests assert exactly that, and a label on a screen is
-- not a delivery decision. Asserted so the distinction is on purpose.
select lives_ok(
  $$update public.users set full_name = 'ZZZ Our Neg Renamed'
     where id = '96000000-0000-0000-0000-00000000c002'$$,
  'while their NAME is still theirs to edit, which keeps the policy narrow');

-- AN AGREEMENT IS A COMMISSION FIGURE. agreement_for_agency had the org test
-- and not the level test, so a Manager read the negotiated bands and tiers.
-- Our Director may see commission, so this is asserted from the Negotiator,
-- who may not.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.agreement_for_agency('96000000-0000-0000-0000-0000000000a1')), 0,
  'somebody who may not see commission gets no agreement, even for their own agency');

-- SET CONSTRAINTS IS TRANSACTION-WIDE, and REPRO 5 above made them immediate
-- to force the deferred position guard to fire. That setting is still in
-- force here, and it would make create_invited_user's two writes fail on the
-- first of them -- which is precisely the ordering problem the constraint is
-- DEFERRED to avoid. Put back, or this assertion tests the test harness.
set constraints all deferred;

-- AND THE REGRESSION. Removing the home-branch arm from app_may_reach_user
-- left nothing able to locate a person who has no position yet, so
-- create_invited_user -> set_user_scope -> assert_may_act_on_user refused
-- every invite on our own estate. This is the case that has to keep working.
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('96000000-0000-0000-0000-00000000cf01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.repro.newstarter@r.test','',now(),now(),now());
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_invited_user(
      '96000000-0000-0000-0000-00000000cf01','zzz.repro.newstarter@r.test','ZZZ New Starter','referrer',
      (select id from public.partners where slug='opndoor-agents'),
      '96000000-0000-0000-0000-0000000000b1', false, 'branch', '96000000-0000-0000-0000-0000000000b1')$$,
  'a Director can still invite a Negotiator into their own branch');
reset role;
select is((select kind from public.user_scopes where user_id = '96000000-0000-0000-0000-00000000cf01'),
  'branch',
  'and the new person arrives holding the position, in the same transaction as their row');

-- ===========================================================================
-- REPRO 8: `not A and B` IS NOT `not (A and B)`
-- ===========================================================================
-- agency_match_queue is SECURITY DEFINER with no org predicate at all, and a
-- string substitution turned its staff-only guard into
--   if not is_opndoor_staff() and is_aal2() then raise
-- which refuses a non-staff caller only if they HAVE stepped up. Reproduced
-- on dev: an agency Negotiator on a password-only session read the whole
-- direct-rail match queue, and the same person stepped up was refused.
-- Exactly inverted. A tenant holds a real session too, so the direct-rail
-- pipeline was readable by the tenants in it.
--
-- Asserted at both AAL levels, because one of them passed while it was broken.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.agency_match_queue()$$,
  '42501', null,
  'a password-only agency session cannot read the direct-rail match queue');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.agency_match_queue()$$,
  '42501', null,
  'and neither can the same person once they have stepped up');

select * from finish();
rollback;
