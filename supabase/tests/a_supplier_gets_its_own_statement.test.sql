-- A SUPPLIER GETS ITS OWN MONTHLY COMMISSION STATEMENT.
--
-- Matt, 2026-09-30, verbatim: "Supplier monthly commission statements: sent
-- to the supplier's Management users who have statements switched on,
-- addressed to the supplier. Only Opndoor admin can switch statements on or
-- off for a supplier's users; supplier users cannot change it for
-- themselves or colleagues. Opndoor admin can also add named email
-- addresses that aren't portal users (e.g. a finance inbox) to receive a
-- supplier's statement."
--
-- THIS IS A NEW DOCUMENT, NOT A NEW RECIPIENT. Measured on dev before any
-- of it was written: application_commission_lines holds `agency` rows and
-- nothing else, and every payee the run has ever produced is agency-level.
-- A supplier's own commission has never been on a statement.
--
-- AND DEV CANNOT SHOW IT WORKING, which is why this file carries its own
-- fixture. Every paid application on dev sits on `opndoor-agents` or
-- `opndoor-direct`; there is not one paid referral on a real supplier. So
-- the rule is unexercised by the real book and only a fixture proves it.
--
-- THE TRAP, AND IT IS THE FIRST ASSERTION FOR A REASON. `opndoor-agents`
-- has `is_house_route = FALSE` -- measured, not assumed. It is the house
-- partner every agency Opndoor onboards shares, and it carries 15 of dev's
-- 16 paid applications with a non-zero partner_rate. A supplier arm that
-- tested only `is_house_route` would turn all fifteen into one enormous
-- supplier payee and post it.
--
-- WHICH IS WHY "REAL SUPPLIER" IS `not public.is_house_partner_id(...)`
-- AND NOT A GUARD WRITTEN HERE. That predicate exists because the first
-- attempt at this same question used `is_house_route` alone and changed
-- nothing, and `our_margin_is_not_theirs.test.sql` exercises it by name
-- against all three house slugs. One definition, already pinned.

begin;
select plan(31);

insert into public.partners (id, slug, name, status, is_house_route, partner_rate, agent_rate)
/* ONE TOTAL OF 0.35 WITH 0.15 CARVED OUT FOR THE AGENTS, which is the
   shape of Matt's instruction and not its numbers: "nothing hardcoded;
   Rightmove's happens to be 35%". 0.35 and 0.15 are this fixture's
   figures and every expectation below is derived from the fee and these
   two columns rather than written as a constant. */
values ('e5000000-0000-0000-0000-0000000000f1','zzz-stmt-sup','ZZZ Statement Supplier','active',false,0.35,0.15)
on conflict (id) do nothing;

/* AN AGENCY AND A BRANCH UNDER THE SUPPLIER. Every application hangs off a
   branch whatever the rail -- `sync_application_partner` derives the
   application's partner FROM the branch and raises "branch <NULL> not
   found" without one. Which is the model working as NM-P described it:
   the office layer does not stop existing, it stops being SHOWN. Both sit
   on the supplier's partner so the trigger's derivation agrees with the
   partner_id written below. */
insert into public.agencies (id, partner_id, name)
values ('e5000000-0000-0000-0000-0000000000a9','e5000000-0000-0000-0000-0000000000f1','ZZZ Stmt Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('e5000000-0000-0000-0000-0000000000b9','e5000000-0000-0000-0000-0000000000a9',
        'e5000000-0000-0000-0000-0000000000f1','ZZZ Stmt Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e5000000-0000-0000-0000-00000000c001'::uuid,'zzz.st.mgmt@s.test'),
  ('e5000000-0000-0000-0000-00000000c002'::uuid,'zzz.st.ref@s.test'),
  ('e5000000-0000-0000-0000-00000000c003'::uuid,'zzz.st.off@s.test'),
  ('e5000000-0000-0000-0000-00000000c004'::uuid,'zzz.st.admin@o.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission,
                          receives_commission_statements) values
  -- Management, ticked: the one who should receive it.
  ('e5000000-0000-0000-0000-00000000c001','ZZZ Stmt Mgmt','zzz.st.mgmt@s.test','management',
   'e5000000-0000-0000-0000-0000000000f1','active',true,true),
  -- A referrer, ticked anyway: "Management users" is the rule, so the tick
  -- must not be enough on its own.
  ('e5000000-0000-0000-0000-00000000c002','ZZZ Stmt Ref','zzz.st.ref@s.test','referrer',
   'e5000000-0000-0000-0000-0000000000f1','active',false,true),
  -- Management, NOT ticked: "who have statements switched on".
  ('e5000000-0000-0000-0000-00000000c003','ZZZ Stmt Off','zzz.st.off@s.test','management',
   'e5000000-0000-0000-0000-0000000000f1','active',true,false),
  ('e5000000-0000-0000-0000-00000000c004','ZZZ Stmt Admin','zzz.st.admin@o.test','superadmin',
   null,'active',true,false);

/* One paid referral on that supplier, in a month of its own so the
   assertions cannot collide with dev's real book.

   IT NEEDS A REFERRER. `assert_application_attributed` refuses an
   application with neither referrer nor applicant unless the partner is a
   house route -- "Attribution cannot be silently missing" -- and a real
   supplier is not one. The supplier's own referrer is the right one to
   name: on that rail the supplier's staff do the referring, which is the
   premise of NM-O. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, fee_amount, tenancy_start, referencing_mode,
   partner_rate, agent_rate, status, sent_at, paid_at, livemode, payment_state)
values
  ('e5000000-0000-0000-0000-0000000000a1','ZZZ-STMT-1','e5000000-0000-0000-0000-0000000000f1',
   'e5000000-0000-0000-0000-0000000000a9','e5000000-0000-0000-0000-0000000000b9',
   'e5000000-0000-0000-0000-00000000c002',
   'Ms','Ada','Tester','1990-01-01','ada@zzz.test','07700900000',
   '1 ZZZ Street','London','SW1A 1AA',
   2000, 2000, '2026-06-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-05-10T10:00:00Z', '2026-05-15T10:00:00Z', true, 'paid');

-- ===========================================================================
-- 1. THE TRAP FIRST. The house agency partner must never become a supplier.
-- ===========================================================================
select is(
  (select count(*)::int from public.commission_statement_payees('2026-09-01'::date)
    where level = 'partner'),
  0, 'the house agency partner is not a supplier payee, though its is_house_route is FALSE and it carries every paid referral on dev');

-- ===========================================================================
-- 2. THE SUPPLIER IS A PAYEE, ADDRESSED TO THE COMPANY
-- ===========================================================================
/* EXACTLY ONE, and named by level rather than by `limit 1`. The same paid
   referral also produces the AGENCY's own line at its agent_rate -- the
   supplier's share is a SECOND payee on the same money, not a replacement
   for the agency's -- so an unfiltered `limit 1` reads whichever row the
   planner hands back first and proves nothing. */
select is(
  (select count(*)::int from public.commission_statement_payees('2026-05-01'::date)
    where level = 'partner'),
  1, 'a real supplier is a payee at partner level, exactly once');

select is(
  (select org_name from public.commission_statement_payees('2026-05-01'::date)
    where level = 'partner'),
  'ZZZ Statement Supplier', 'and it is addressed to the SUPPLIER, not a person and not an agency under it');

/* WHAT OPNDOOR OWES IS THE WHOLE TOTAL. Matt, 2026-09-30: "Opndoor pays
   the whole total to the supplier, who pays its agents, unless the
   supplier's setting says Opndoor pays agents directly." The setting is
   off, so this is the fee times the supplier's TOTAL rate, agents'
   share included.

   READ FROM THE PARTNER, not written as 700.00. A test that hardcodes
   the number passes when somebody changes the rate and the arithmetic
   at the same time, which is the one case worth catching. */
select is(
  (select total from public.commission_statement_payees('2026-05-01'::date)
    where level = 'partner'),
  (select round(2000 * p.partner_rate, 2) from public.partners p
    where p.id = 'e5000000-0000-0000-0000-0000000000f1'),
  'Opndoor owes the supplier its whole total rate of the fee, agents'' share included');

/* AND NO AGENCY LINE AT ALL, WHICH IS AN INVERSION. This assertion used
   to read "the agency line on the same referral is untouched by the
   supplier gaining one" and expected 400.00, because the two rates were
   additive and Opndoor paid out both. NM-C 5 reverses it: "for a
   supplier like Rightmove, Opndoor pays only the supplier; the supplier
   pays its own agents, so no agency commission line is created under a
   supplier referral."

   It is not deleted, it is turned over, and the arm that was true before
   is now asserted under the SETTING, further down. */
select is_empty(
  $$select 1 from public.commission_statement_payees('2026-05-01'::date) where level = 'agency'$$,
  'and Opndoor creates NO agency payee under a supplier referral, because the supplier pays its own agents');

-- ===========================================================================
-- 2b. THE CARVE-OUT, PER REFERRAL
-- ===========================================================================
/* THE INVARIANT, and it is the sentence "never more in total" written as
   arithmetic. Asserted per referral rather than on the month's sum,
   because rounding breaks it one row at a time: round(a) + round(b) is
   not round(a + b), which is why the supplier's share is computed as a
   subtraction rather than at its own rate. */
select is_empty(
  $$select l.guarantee_ref from public.supplier_statement_lines(
      'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date) l
     where l.agent_amount + l.supplier_amount <> l.total_amount$$,
  'the agents'' share and the supplier''s share add to the total exactly, on every referral');

select is(
  (select l.agent_amount from public.supplier_statement_lines(
     'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date) l
    where l.guarantee_ref = 'ZZZ-STMT-1'),
  (select round(2000 * p.agent_rate, 2) from public.partners p
    where p.id = 'e5000000-0000-0000-0000-0000000000f1'),
  'the agents'' share is the supplier''s agent rate of the fee, carved out of the total');

select is(
  (select l.supplier_amount from public.supplier_statement_lines(
     'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date) l
    where l.guarantee_ref = 'ZZZ-STMT-1'),
  (select round(2000 * (p.partner_rate - p.agent_rate), 2) from public.partners p
    where p.id = 'e5000000-0000-0000-0000-0000000000f1'),
  'and the supplier''s own share is what is left of the total, not a rate of its own');

/* AND IT CARRIES THE AGENCY AND THE BRANCH ON EVERY LINE. Matt:
   "Supplier commission statements always show the agency and branch on
   every line, even when they're all the same." The shared collapse rule
   would drop both here -- one agency, one office -- so the supplier
   documents do not use it, and this is what says the columns are
   populated rather than merely declared. */
select is_empty(
  $$select l.guarantee_ref from public.supplier_statement_lines(
      'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date) l
     where coalesce(btrim(l.agency_name),'') = '' or coalesce(btrim(l.branch_name),'') = ''$$,
  'and every line names its agency and its branch, though all of them are the same one');

-- ===========================================================================
-- 2c. THE PER-AGENCY SCHEDULES
-- ===========================================================================
select is(
  (select count(*)::int from public.supplier_agency_schedules(
     'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date)),
  1, 'one schedule per agency under the supplier with paid business in the month');

select is(
  (select s.agent_amount from public.supplier_agency_schedules(
     'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date) s),
  (select sum(l.agent_amount) from public.supplier_statement_lines(
     'e5000000-0000-0000-0000-0000000000f1','2026-05-01'::date) l),
  'and it foots to the agents'' share on the supplier''s own statement, so the two documents cannot disagree');

-- ===========================================================================
-- 2d. AND WITH THE SETTING ON, WHICH IS THE OTHER HALF OF NM-C 5
-- ===========================================================================
update public.partners set opndoor_pays_agents = true
 where id = 'e5000000-0000-0000-0000-0000000000f1';

/* =========================================================================
   THESE THREE SAID THE OPPOSITE UNTIL 20261007230000, AND THE COMMENT THEY
   CARRIED NAMED THE CHANGE THAT WOULD BREAK THEM.

   It read: "THE SUM IS THE SAME EITHER WAY, which is the point of a
   carve-out and the thing that would break first if somebody made the arms
   independent." Matt, 2026-10-01, made the arms independent: "On (paid
   directly by Opndoor): the supplier's own commission and the agents'
   commission are separate deals ... Opndoor pays each party its own; the
   total is the sum."

   So the switch no longer only decides WHO receives a fixed total; under ON
   it decides what the total IS. Rewritten rather than deleted: the old rule
   and the new one are both worth pinning, and the OFF half above is
   untouched and still asserts the carve-out to the penny.
   ========================================================================= */
select is(
  (select total from public.commission_statement_payees('2026-05-01'::date)
    where level = 'agency'),
  (select round(2000 * p.agent_rate, 2) from public.partners p
    where p.id = 'e5000000-0000-0000-0000-0000000000f1'),
  'with Opndoor paying agents directly the agency IS a payee, for its own commission');

select is(
  (select total from public.commission_statement_payees('2026-05-01'::date)
    where level = 'partner'),
  (select round(2000 * p.partner_rate, 2) from public.partners p
    where p.id = 'e5000000-0000-0000-0000-0000000000f1'),
  'and the supplier is paid its OWN commission in full, not the total less the agents''');

select is(
  (select sum(total) from public.commission_statement_payees('2026-05-01'::date)
    where level in ('agency','partner')),
  (select round(2000 * (p.partner_rate + p.agent_rate), 2) from public.partners p
    where p.id = 'e5000000-0000-0000-0000-0000000000f1'),
  'so under this shape the total is the SUM of the two deals, not a fixed figure divided');

update public.partners set opndoor_pays_agents = false
 where id = 'e5000000-0000-0000-0000-0000000000f1';

-- ===========================================================================
-- 3. WHO RECEIVES IT
-- ===========================================================================
select set_eq(
  $$select email from public.commission_statement_recipients('partner','e5000000-0000-0000-0000-0000000000f1')$$,
  $$values ('zzz.st.mgmt@s.test')$$,
  'only the Management user with statements switched on');

-- Each half of that, separately, because set_eq passing tells you the
-- answer and not which rule produced it.
select is_empty(
  $$select 1 from public.commission_statement_recipients('partner','e5000000-0000-0000-0000-0000000000f1')
     where email = 'zzz.st.ref@s.test'$$,
  'a supplier REFERRER does not receive one, though their tick is on');

select is_empty(
  $$select 1 from public.commission_statement_recipients('partner','e5000000-0000-0000-0000-0000000000f1')
     where email = 'zzz.st.off@s.test'$$,
  'and Management with the tick OFF does not either');

-- ===========================================================================
-- 4. THE NAMED ADDRESSES THAT ARE NOT PORTAL USERS
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.add_partner_statement_recipient('e5000000-0000-0000-0000-0000000000f1','Finance@ZZZ.test','ZZZ Finance')$$,
  'an Opndoor admin may add a named address that is not a portal user');

/* AND NOT ON A PARTNER THAT IS NOT A SUPPLIER, at this door as well as in
   the money. `add_partner_statement_recipient` is the only way a row
   reaches the table, so the trap above is worth nothing if an admin can
   hang a finance inbox off the house partner every agency shares: the
   statement it would receive is Opndoor's own margin on the whole estate.
   Both remaining house slugs, because the predicate covers three and the
   arithmetic above only ever demonstrates one. */
select throws_ok(
  $$select public.add_partner_statement_recipient(
      (select id from public.partners where slug = 'opndoor-agents'),'x@zzz.test',null)$$,
  '22023', null, 'and not on the house agency partner, which is not a supplier however its is_house_route column reads');

select throws_ok(
  $$select public.add_partner_statement_recipient(
      (select id from public.partners where slug = 'referencing-partner'),'x@zzz.test',null)$$,
  '22023', null, 'nor on the referencing hand-over partner');

reset role;
select ok(
  exists (select 1 from public.commission_statement_recipients('partner','e5000000-0000-0000-0000-0000000000f1')
           where email = 'finance@zzz.test' and source = 'named'),
  'and it receives the statement, lower-cased, marked as a named address rather than a person');

/* AND THE ADMIN SCREEN CAN READ THE LIST BACK. The table is RLS-on with
   no policy, so this RPC is the only way the list reaches a browser. */
select set_eq(
  $$select email from public.partner_statement_recipient_list('e5000000-0000-0000-0000-0000000000f1')$$,
  $$values ('finance@zzz.test')$$,
  'and an Opndoor admin can read the supplier''s named addresses back');

/* THE ID, KEPT, so the refusal below is a real attempt rather than an
   accident of the supplier not being able to name the row. A test that
   passed NULL would pass against a remove with no guard at all, which is
   precisely what the mutation check caught here. */
create temporary table _rid as
  select id from public.partner_statement_recipient_list('e5000000-0000-0000-0000-0000000000f1');
grant select on _rid to public;

/* AND THE SUPPLIER ITSELF CANNOT ADD ONE. "Only Opndoor admin" is the
   whole of Matt's sentence, and the list is the one thing on this rail a
   supplier's Management could otherwise reach: the RPC is granted to
   `authenticated`, and a screen is not a boundary. */
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.add_partner_statement_recipient('e5000000-0000-0000-0000-0000000000f1','their.own@zzz.test',null)$$,
  '42501', null, 'a supplier''s own Management may NOT add a named address: Opndoor only');

-- NOR SEE THE LIST. This one narrows rather than raising, so the
-- assertion is emptiness: a screen that showed it read-only would still
-- be showing Opndoor's record of who it posts to.
select is_empty(
  $$select 1 from public.partner_statement_recipient_list('e5000000-0000-0000-0000-0000000000f1')$$,
  'nor read the list, though the RPC is granted to authenticated');

-- NOR TAKE ONE OFF, handed the real id. The three doors onto this list
-- are add, read and remove, and all three are Opndoor's.
select throws_ok(
  $$select public.remove_partner_statement_recipient((select id from _rid))$$,
  '42501', null, 'nor remove one, given the id outright');

-- AND TAKING ONE OFF AGAIN, which is the half that makes the list a
-- setting rather than a one-way door.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
/* THROUGH THE LIST RPC, not the table. The table is RLS-on with no
   policy, so a select from it as `authenticated` returns nothing even for
   an admin and the remove is handed a NULL id -- which is deny-by-default
   working, and is also exactly how the admin screen has to find the id. */
select lives_ok(
  $$select public.remove_partner_statement_recipient(
      (select id from public.partner_statement_recipient_list('e5000000-0000-0000-0000-0000000000f1')
        where email = 'finance@zzz.test'))$$,
  'an Opndoor admin may take a named address off again');

reset role;
select is_empty(
  $$select 1 from public.commission_statement_recipients('partner','e5000000-0000-0000-0000-0000000000f1')
     where email = 'finance@zzz.test'$$,
  'and it stops receiving the statement, which is what makes the removal real');

-- ===========================================================================
-- 5. WHO MAY SWITCH IT. This is the half that REVERSES Q4.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_receives_commission_statements('e5000000-0000-0000-0000-00000000c003', true)$$,
  '42501', null,
  'a supplier Management user may NOT switch statements on for a colleague: Opndoor only, which narrows Q4');

select throws_ok(
  $$select public.set_receives_commission_statements('e5000000-0000-0000-0000-00000000c001', false)$$,
  '42501', null, 'nor for themselves');

-- AND THE TWO SETTINGS Q4 GAVE THEM ARE UNTOUCHED, which is the assertion
-- that stops this narrowing being applied one setting too wide.
select lives_ok(
  $$select public.set_notification_for('e5000000-0000-0000-0000-00000000c002','sent',false)$$,
  'while they may still change a colleague''s event choice, which Q4 gave them and this does not take back');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_receives_commission_statements('e5000000-0000-0000-0000-00000000c003', true)$$,
  'and an Opndoor admin still may, which is the whole of who can');

select * from finish();
rollback;
