-- THE MONTHLY STATEMENT, AND WHO IT IS ADDRESSED TO.
--
-- The statement is computed twice: once in TypeScript for the screen
-- (accruePayees in liveAnalytics.ts, pinned by settlement-statement.test.ts) and
-- once in SQL for the email, because a cron has no browser store to read. Two
-- implementations of one question drift unless both are pinned, so the SQL one
-- is pinned here against worked examples of the rule it has to obey:
--
--     applications that PAID inside the month, refunds excluded,
--     one line per payee per application, commission = basis x rate.
--
-- The addressing is pinned too, because the failure it prevents is not a wrong
-- number but a competitor reading somebody's commission: the ladder is walked
-- UPWARDS ONLY, so a branch manager never receives the agency's statement.

begin;
select plan(24);

-- ---------------------------------------------------------------------------
-- One group, one agency, two branches. The group takes 2% and the agency 10%,
-- so a paid application produces TWO payees, which is the case a single-payee
-- implementation gets wrong.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('96000000-0000-0000-0000-000000000001', 'zzz-stmt', 'Statement Rail', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agency_groups (id, partner_id, name, agent_rate)
values ('96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001', 'Statement Group', 0.02);
insert into public.agencies (id, partner_id, name, group_id, finance_email)
values ('96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000001', 'Statement Agency',
        '96000000-0000-0000-0000-000000000002', 'accounts@statement.test');
insert into public.branches (id, agency_id, partner_id, name) values
  ('96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000001', 'Statement Branch'),
  ('96000000-0000-0000-0000-000000000005', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000001', 'Other Branch');

-- The people, before the applications: every application needs a referrer.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values
  ('96000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'director@statement.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','',''),
  ('96000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'manager@statement.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','',''),
  ('96000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'branch@statement.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','',''),
  ('96000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'gone@statement.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','',''),
  ('96000000-0000-0000-0000-0000000000ff','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'stmtadmin@statement.test', now(), now(), '{}'::jsonb,'{}'::jsonb,'','','','','','','','');

insert into public.users (id, full_name, email, role, partner_id, status) values
  ('96000000-0000-0000-0000-0000000000e1','Group Director','director@statement.test','management','96000000-0000-0000-0000-000000000001','active'),
  ('96000000-0000-0000-0000-0000000000e2','Agency Manager','manager@statement.test','management','96000000-0000-0000-0000-000000000001','active'),
  ('96000000-0000-0000-0000-0000000000e3','Branch Manager','branch@statement.test','management','96000000-0000-0000-0000-000000000001','active'),
  ('96000000-0000-0000-0000-0000000000e4','Left The Firm','gone@statement.test','management','96000000-0000-0000-0000-000000000001','deactivated'),
  ('96000000-0000-0000-0000-0000000000ff','Statement Admin','stmtadmin@statement.test','superadmin', null,'active');

insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id) values
  ('96000000-0000-0000-0000-0000000000e1','group','96000000-0000-0000-0000-000000000002', null, null),
  ('96000000-0000-0000-0000-0000000000e2','agency', null,'96000000-0000-0000-0000-000000000003', null),
  ('96000000-0000-0000-0000-0000000000e3','branch', null, null,'96000000-0000-0000-0000-000000000004'),
  ('96000000-0000-0000-0000-0000000000e4','agency', null,'96000000-0000-0000-0000-000000000003', null);

-- Four applications, all against the same branch:
--   A  paid 10 May 2031, live, not refunded        -> counts
--   B  paid 11 May 2031, REFUNDED                  -> does not count
--   C  paid 10 June 2031                           -> not this month
--   D  paid 30 April 2031 at 23:30 UTC             -> 00:30 BST on 1 May, counts
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id, referrer_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start, status, livemode,
  referencing_mode, partner_rate, agent_rate, sent_at, paid_at, payment_state
) values
  ('96000000-0000-0000-0000-00000000000a', 'GR-STMT-A',
   '96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-0000000000e2',
   'Ms', 'Ada', 'Paid', '1990-01-01', 'ada@statement.test', '07700 900001',
   '1 Test Road', 'London', 'NW1 8LH', 2000, 2000, date '2031-06-01', 'paid', true,
   'opndoor_referenced', 0.25, 0.12, timestamptz '2031-04-01 09:00:00+00', timestamptz '2031-05-10 12:00:00+00', 'paid'),
  ('96000000-0000-0000-0000-00000000000b', 'GR-STMT-B',
   '96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-0000000000e2',
   'Mr', 'Bo', 'Refunded', '1990-01-01', 'bo@statement.test', '07700 900002',
   '2 Test Road', 'London', 'NW1 8LH', 2000, 2000, date '2031-06-01', 'paid', true,
   'opndoor_referenced', 0.25, 0.12, timestamptz '2031-04-01 09:00:00+00', timestamptz '2031-05-11 12:00:00+00', 'refunded'),
  ('96000000-0000-0000-0000-00000000000c', 'GR-STMT-C',
   '96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-0000000000e2',
   'Ms', 'Cleo', 'Nextmonth', '1990-01-01', 'cleo@statement.test', '07700 900003',
   '3 Test Road', 'London', 'NW1 8LH', 2000, 2000, date '2031-07-01', 'paid', true,
   'opndoor_referenced', 0.25, 0.12, timestamptz '2031-04-01 09:00:00+00', timestamptz '2031-06-10 12:00:00+00', 'paid'),
  ('96000000-0000-0000-0000-00000000000d', 'GR-STMT-D',
   '96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-0000000000e2',
   'Mr', 'Dev', 'Midnight', '1990-01-01', 'dev@statement.test', '07700 900004',
   '4 Test Road', 'London', 'NW1 8LH', 1000, 1000, date '2031-06-01', 'paid', true,
   'opndoor_referenced', 0.25, 0.12, timestamptz '2031-04-01 09:00:00+00', timestamptz '2031-04-30 23:30:00+00', 'paid'),
  -- E is a SANDBOX rehearsal, inserted as one rather than made into one:
  -- applications_livemode_immutable refuses a change after creation, which is
  -- exactly the guard it exists to be, so the fixture has to say so up front.
  ('96000000-0000-0000-0000-00000000000e', 'GR-STMT-E',
   '96000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000003',
   '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-0000000000e2',
   'Ms', 'Eve', 'Sandbox', '1990-01-01', 'eve@statement.test', '07700 900005',
   '5 Test Road', 'London', 'NW1 8LH', 2000, 2000, date '2031-06-01', 'paid', false,
   'opndoor_referenced', 0.25, 0.12, timestamptz '2031-04-01 09:00:00+00', timestamptz '2031-05-12 12:00:00+00', 'paid');

-- The frozen split on A, B, C and D: agency 10% and group 2% of the fee paid.
insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount, source) values
  ('96000000-0000-0000-0000-00000000000a', 'agency', '96000000-0000-0000-0000-000000000003', 'Statement Agency', 0.10, 2000, 'standard'),
  ('96000000-0000-0000-0000-00000000000a', 'group',  '96000000-0000-0000-0000-000000000002', 'Statement Group',  0.02, 2000, 'rate'),
  ('96000000-0000-0000-0000-00000000000b', 'agency', '96000000-0000-0000-0000-000000000003', 'Statement Agency', 0.10, 2000, 'standard'),
  ('96000000-0000-0000-0000-00000000000c', 'agency', '96000000-0000-0000-0000-000000000003', 'Statement Agency', 0.10, 2000, 'standard'),
  ('96000000-0000-0000-0000-00000000000d', 'agency', '96000000-0000-0000-0000-000000000003', 'Statement Agency', 0.10, 1000, 'standard');

-- ---------------------------------------------------------------------------
-- The arithmetic.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.commission_statement_lines(date '2031-05-01')
    where org_id in ('96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000002')),
  3, 'two payees on the May application, one on the midnight one, and nothing else');

select is(
  (select l.commission from public.commission_statement_lines(date '2031-05-01') l
    where l.guarantee_ref = 'GR-STMT-A' and l.level = 'agency'),
  200.00::numeric, 'commission is the basis times the rate, to the penny');

select is(
  (select l.commission from public.commission_statement_lines(date '2031-05-01') l
    where l.guarantee_ref = 'GR-STMT-A' and l.level = 'group'),
  40.00::numeric, 'and the group is paid its own line, not a share of the agency''s');

select ok(
  not exists (select 1 from public.commission_statement_lines(date '2031-05-01')
               where guarantee_ref = 'GR-STMT-B'),
  'a refunded application earns nobody anything');

select ok(
  not exists (select 1 from public.commission_statement_lines(date '2031-05-01')
               where guarantee_ref = 'GR-STMT-C'),
  'and one that paid in June is not in May''s statement');

-- THE MONTH IS EUROPE/LONDON, not UTC. 23:30 UTC on 30 April is 00:30 BST on
-- 1 May, and the agency was told on screen that it was a May payment.
select ok(
  exists (select 1 from public.commission_statement_lines(date '2031-05-01')
           where guarantee_ref = 'GR-STMT-D'),
  'a payment just after midnight London time falls in the London month');
select ok(
  not exists (select 1 from public.commission_statement_lines(date '2031-04-01')
               where guarantee_ref = 'GR-STMT-D'),
  'and not in the UTC one');

-- A sandbox rehearsal is not money.
select ok(
  not exists (select 1 from public.commission_statement_lines(date '2031-05-01')
               where guarantee_ref = 'GR-STMT-E'),
  'a sandbox row never reaches a real agency''s statement');

-- THE HISTORIC FALLBACK. A row frozen before the additive model has no lines,
-- and the money it earned was always the referring agency's.
delete from public.application_commission_lines where application_id = '96000000-0000-0000-0000-00000000000d';
select is(
  (select count(*)::int from public.commission_statement_lines(date '2031-05-01')
    where guarantee_ref = 'GR-STMT-D'),
  1, 'a row with no frozen split resolves to exactly one agency line');
select is(
  (select l.commission from public.commission_statement_lines(date '2031-05-01') l
    where l.guarantee_ref = 'GR-STMT-D'),
  120.00::numeric, 'at the scalar rate snapshotted on the application');
select is(
  (select l.org_id from public.commission_statement_lines(date '2031-05-01') l
    where l.guarantee_ref = 'GR-STMT-D'),
  '96000000-0000-0000-0000-000000000003'::uuid,
  'and it names the agency by id, so the statement can actually be posted');

-- ---------------------------------------------------------------------------
-- The aggregate foots to the lines.
-- ---------------------------------------------------------------------------
select is(
  (select p.total from public.commission_statement_payees(date '2031-05-01') p
    where p.org_id = '96000000-0000-0000-0000-000000000003'),
  320.00::numeric, 'the agency''s May total is its two lines added up');
select is(
  (select p.line_count from public.commission_statement_payees(date '2031-05-01') p
    where p.org_id = '96000000-0000-0000-0000-000000000003'),
  2, 'and it says how many applications made it');

-- ---------------------------------------------------------------------------
-- Who reads it. Ticked: the group director, the branch manager (deliberately,
-- to prove the ladder does not read downwards) and somebody who has left.
-- ---------------------------------------------------------------------------
select set_config('app.setting_commission_tick', 'on', true);
update public.users set receives_commission_statements = true
 where id in ('96000000-0000-0000-0000-0000000000e1',
              '96000000-0000-0000-0000-0000000000e3',
              '96000000-0000-0000-0000-0000000000e4');
select set_config('app.setting_commission_tick', 'off', true);
-- The agency manager is left alone: the column defaults to false, which is what
-- "off for everyone else" means, and an unticked person is a real case to test.

select ok(
  exists (select 1 from public.commission_statement_recipients('agency','96000000-0000-0000-0000-000000000003')
           where email = 'director@statement.test'),
  'the group director above an agency receives that agency''s statement');
select ok(
  not exists (select 1 from public.commission_statement_recipients('agency','96000000-0000-0000-0000-000000000003')
               where email = 'branch@statement.test'),
  'a ticked BRANCH manager never receives the agency''s, which is the leak this prevents');
select ok(
  exists (select 1 from public.commission_statement_recipients('branch','96000000-0000-0000-0000-000000000004')
           where email = 'branch@statement.test'),
  'but they do receive their own branch''s');
select ok(
  not exists (select 1 from public.commission_statement_recipients('agency','96000000-0000-0000-0000-000000000003')
               where email = 'manager@statement.test'),
  'an unticked agency manager gets nothing, because the tick is the instruction');
select ok(
  not exists (select 1 from public.commission_statement_recipients('agency','96000000-0000-0000-0000-000000000003')
               where email = 'gone@statement.test'),
  'and a deactivated person is never written to, ticked or not');
select ok(
  exists (select 1 from public.commission_statement_recipients('agency','96000000-0000-0000-0000-000000000003')
           where email = 'accounts@statement.test' and source = 'finance'),
  'the party''s finance mailbox is added alongside the people, not instead of them');

-- ---------------------------------------------------------------------------
-- The tick moves through the RPC or it does not move.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.users set receives_commission_statements = true
     where id = '96000000-0000-0000-0000-0000000000e2'$$,
  '42501', null,
  'a raw UPDATE cannot change who receives commission statements');

select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);
select ok(
  public.set_receives_commission_statements('96000000-0000-0000-0000-0000000000e2', true),
  'an Opndoor admin can turn it on for anyone');
select ok(
  exists (select 1 from public.org_audit
           where entity_type = 'agency'
             and entity_id = '96000000-0000-0000-0000-000000000003'
             and action = 'commission_statements_on'),
  'and the change is audited against the party whose post moved');

-- ---------------------------------------------------------------------------
-- AND NOBODY ELSE CAN, WHICH IS THE RULING.
--
-- The tick was briefly settable by a positioned manager for people wholly
-- inside their own position. That arm is withdrawn (20261005160000): who is
-- posted a statement is Opndoor's record, not a setting an agency adjusts
-- about itself. The control has come off Team, and this is what makes that a
-- rule rather than a convention, because the RPC is granted to authenticated
-- and a screen is not a boundary.
--
-- The manager used here is the one the suite already proved COULD do it under
-- the old rule: the agency manager over the very person being changed. If
-- anybody may, she may, so refusing her is the whole ruling in one assertion.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-0000000000e2","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.set_receives_commission_statements('96000000-0000-0000-0000-0000000000e3', true)$$,
  '42501',
  'Who receives a commission statement is set by Opndoor, not by the agency.',
  'an agency manager cannot set it, not even inside her own agency');
select throws_ok(
  $$select public.set_receives_commission_statements('96000000-0000-0000-0000-0000000000e2', false)$$,
  '42501', null,
  'nor turn her own off, which is the route somebody would actually try');

select * from finish();
rollback;
