/* THE SUPPLIER STATEMENT READS THE STORED COMMISSION LINES.
   Migration: 20261008070000.

   It was the last reader still computing `fee * rate`, against Matt's own
   2026-10-02 rule that the stored lines are read "everywhere (statements,
   exports, reporting, settlements) instead of recalculating". */
begin;
select plan(7);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate, opndoor_pays_agents)
values ('e6600000-0000-0000-0000-00000000f001','zzz-stmt-carved','ZZZ Carved',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false);
insert into public.agencies (id, partner_id, name) values
  ('e6600000-0000-0000-0000-00000000a001','e6600000-0000-0000-0000-00000000f001','ZZZ Stmt Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e6600000-0000-0000-0000-00000000b001','e6600000-0000-0000-0000-00000000a001',
   'e6600000-0000-0000-0000-00000000f001','ZZZ Stmt Office');

/* A REFERRER, because assert_application_attributed refuses an application
   with neither a referrer nor an applicant off a house route. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e6600000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.stmtref@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e6600000-0000-0000-0000-00000000c001','ZZZ Stmt Referrer','zzz.stmtref@opndoor.test',
   'referrer','e6600000-0000-0000-0000-00000000f001','active',false);

insert into public.applications
  (id, guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name,
   tenant_last_name, tenant_dob, tenant_email, tenant_phone, prop_addr1, prop_city,
   prop_postcode, monthly_rent, fee_amount, tenancy_start, status, sent_at, paid_at,
   partner_rate, agent_rate, livemode, referencing_mode, opndoor_pays_agents_at_freeze)
values ('e6600000-0000-0000-0000-000000000a01','GR-ZZZSTMT',
        'e6600000-0000-0000-0000-00000000b001','e6600000-0000-0000-0000-00000000a001',
        'e6600000-0000-0000-0000-00000000f001','e6600000-0000-0000-0000-00000000c001',
        'ZZZ Stmt Referrer','Mr','Stmt','Tenant','1990-01-01',
        'zzz.stmt@t.test','07700900901','1 Stmt Street','London','SW1A 1AA',
        /* SENT BEFORE PAID, or applications_journey_sequence refuses the row:
           sent_at defaults to now() and paid_at is backdated into September
           so the statement has a month to find it in. */
        2000, 2000, current_date + 30, 'paid', '2026-09-01T09:00:00Z', '2026-09-10T10:00:00Z',
        0.2500, 0.1000, true, 'pre_referenced_open', false);

-- ===========================================================================
-- 1. WITH NO STORED LINES IT STILL ANSWERS, which is the fallback that stops
--    a pre-backfill row going blank.
-- ===========================================================================
select is(
  (select supplier_amount from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  300.00::numeric,
  'with no stored line it computes as before: carved, 25% less the 10% carve-out');

-- ===========================================================================
-- 2. WITH STORED LINES IT READS THEM.
-- ===========================================================================
select public.freeze_commission_lines(
  'e6600000-0000-0000-0000-000000000a01',
  'e6600000-0000-0000-0000-00000000b001','e6600000-0000-0000-0000-00000000f001', 1, 2000);

select is(
  (select supplier_amount from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  300.00::numeric,
  'and with them it reads the same number, which is the point of the change');

select is(
  (select agent_amount from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  200.00::numeric,
  'the agency amount is the stored line');

/* IT REALLY IS READING THEM, which the two assertions above cannot prove on
   their own because both sources agree. Move the stored line and the
   statement must move with it. */
update public.application_commission_lines set amount = 150.00
 where application_id = 'e6600000-0000-0000-0000-000000000a01' and level = 'agency';
select is(
  (select agent_amount from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  150.00::numeric,
  'and moving the stored line moves the statement, so it is the source');

select is(
  (select supplier_amount from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  350.00::numeric,
  'and the supplier gets the remainder of the carve-out');

-- ===========================================================================
-- 3. THE CARVED CLAMP SURVIVES, which is the invariant that could have been
--    lost by reading the line and nothing else.
-- ===========================================================================
update public.application_commission_lines set amount = 9999.00
 where application_id = 'e6600000-0000-0000-0000-000000000a01' and level = 'agency';
select cmp_ok(
  (select supplier_amount from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  '>=', 0::numeric,
  'a stored agency line larger than the total cannot drive the supplier negative');

/* MONEY TO THE PENNY WHATEVER THE SCALE IT WAS STORED AT. A line seeded as
   `240` and one computed as `240.00` are the same money and different text,
   and a CSV or a diff shows the difference. Found by the before-and-after on
   Kestrel's September statement. */
update public.application_commission_lines set amount = 240
 where application_id = 'e6600000-0000-0000-0000-000000000a01' and level = 'agency';
select is(
  (select agent_amount::text from public.supplier_statement_lines(
     'e6600000-0000-0000-0000-00000000f001','2026-09-01')),
  '240.00',
  'and a line stored without pence still reads as money to the penny');

select * from finish();
rollback;
