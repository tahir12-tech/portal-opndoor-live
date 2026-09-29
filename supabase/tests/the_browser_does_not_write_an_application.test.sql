-- THE BROWSER DOES NOT WRITE AN APPLICATION.
--
-- Round 7's critical, and the same shape as round 6's H1 on public.users: a
-- table grant nothing in the product uses, silently overriding a decision the
-- codebase had already made.
--
-- 20261006410000 revoked the table-wide INSERT/UPDATE on applications and
-- re-granted PER COLUMN, denylisting only partner_rate and agent_rate. So 79
-- of 82 columns stayed writable by `authenticated`, and `applications_update`
-- gates which ROW, never which COLUMN. Measured on dev before the fix:
--
--   as Regent's MANAGER (sees_commission = false), aal2:
--     update applications set status='paid', payment_state='paid',
--            paid_at=now()-interval '2 hours', paid_amount=0
--      where guarantee_ref='GR-20837'        -- never paid, no payment intent
--
--   commission_statement_lines then returns
--     Regent's Lettings | GR-20837 | 138.46
--   and deeds_awaiting_generation returns the row, so the hourly cron
--   generates and SENDS a real Deed of Guarantee, unattended, for a payment
--   that never happened. activity_log is unchanged: no audit record at all.
--
-- The sanctioned door already refuses that caller -- set_application_status
-- raises 42501 for a Manager and says "opndoor admin only" in its own comment,
-- and apply_stripe_payment is not executable by `authenticated` at all.
--
-- THE ASSERTIONS ARE CATALOGUE-DRIVEN, not one column at a time. The defect
-- was not that a particular column was writable; it was that a denylist was
-- used where an allowlist was meant, so every column added since has been
-- writable by default. A test naming columns would have the same flaw.

begin;
select plan(15);

-- ===========================================================================
-- THE GRANT ITSELF
-- ===========================================================================
select is(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'applications'
      and has_column_privilege('authenticated', 'public.applications', c.column_name, 'UPDATE')),
  0,
  'authenticated may UPDATE no column of applications');

select is(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'applications'
      and has_column_privilege('authenticated', 'public.applications', c.column_name, 'INSERT')),
  0,
  'nor INSERT one');

select is(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'applications'
      and has_column_privilege('anon', 'public.applications', c.column_name, 'UPDATE')),
  0,
  'and neither may anon');

-- READING IS UNTOUCHED. Every screen in the product reads this table, and a
-- revoke that took SELECT with it would empty the whole application.
select ok(
  (select count(*)::int from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'applications'
      and has_column_privilege('authenticated', 'public.applications', c.column_name, 'SELECT')) > 50,
  'while SELECT is untouched, because every screen reads this table');

/* AND THE OTHER TWO VERBS, which round 7 did not name.
 *
 * 20261006660000 wrote `revoke insert, update`, because INSERT and UPDATE
 * were what the finding was about. The table sits on Supabase's ALTER DEFAULT
 * PRIVILEGES, which granted ALL, so naming two of four left DELETE and
 * TRUNCATE in place -- measured TRUE on dev, for anon as well as
 * authenticated, until 20261006720000.
 *
 * It matters because docs/HOTFIX-LIVE-FOR-BALAL.sql revokes all four on
 * production before cutover. Anything the hotfix closes and this branch
 * leaves open would be re-opened by the upgrade itself.
 *
 * READ BY RELATION OID rather than through information_schema. The four
 * assertions above take the obvious route, and it only works because nothing
 * else in the database is called `applications`: nothing orders the schema
 * filter before has_column_privilege, so with a second table of that name the
 * planner feeds it foreign column names and the query dies rather than fails.
 * These do not have that weakness.
 */
select ok(
  not has_table_privilege('authenticated', 'public.applications', 'DELETE')
  and not has_table_privilege('anon', 'public.applications', 'DELETE'),
  'and nobody in the browser may DELETE an application, whatever the policy says');

select ok(
  not has_table_privilege('authenticated', 'public.applications', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.applications', 'TRUNCATE'),
  'nor TRUNCATE the table');

select ok(
  has_table_privilege('authenticated', 'public.applications', 'SELECT')
  or (select count(*) from pg_attribute a
       where a.attrelid = 'public.applications'::regclass and a.attnum > 0
         and not a.attisdropped
         and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')) > 50,
  'while reading survives, at the table or column level, so no screen goes blank');

/* AND THE FUNCTION THE HOTFIX REPLACES ON PRODUCTION.
 *
 * This branch fixed the unknown-caller class from the other end, by wrapping
 * all 205 raising guards in coalesce (20261006470000). Production cannot take
 * 205 guards by hand, so its hotfix makes app_role() total instead. Both are
 * correct; carrying only one of them would leave production and dev holding
 * different definitions of the same function, with drift clean because drift
 * compares the files to dev and never looks at production.
 */
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal2"}', true);
select is(public.app_role(), ''::text,
  'a caller with no users row reads as nobody, not as unknown');

select ok(public.app_role() is not null,
  'and never as NULL, which is what let `if not (...) then raise` be skipped');

-- ===========================================================================
-- THE REPRODUCTIONS
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('a2000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Forge Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('a2000000-0000-0000-0000-0000000000f2','a2000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Forge Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('a2000000-0000-0000-0000-00000000c001'::uuid,'zzz.forge.mgr@f.test'),
  ('a2000000-0000-0000-0000-00000000c002'::uuid,'zzz.forge.neg@f.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('a2000000-0000-0000-0000-00000000c001','ZZZ Forge Mgr','zzz.forge.mgr@f.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('a2000000-0000-0000-0000-00000000c002','ZZZ Forge Neg','zzz.forge.neg@f.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'a2000000-0000-0000-0000-0000000000f2');
insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('a2000000-0000-0000-0000-00000000c001','agency','a2000000-0000-0000-0000-0000000000f1',null),
  ('a2000000-0000-0000-0000-00000000c002','branch',null,'a2000000-0000-0000-0000-0000000000f2');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values ('a2000000-0000-0000-0000-00000000e001','ZZZ-FORGE-1',(select id from public.partners where slug='opndoor-agents'),
   'a2000000-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000f2','a2000000-0000-0000-0000-00000000c002','ZZZ Forge Neg',
   'Mx','Faye','Forge','1990-01-01','faye@f.test','07700900101','1 Forge Street','London','FG1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '1 day');

-- A1: the forged payment.
select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$update public.applications
       set status = 'paid', payment_state = 'paid', paid_at = now(), paid_amount = 0
     where guarantee_ref = 'ZZZ-FORGE-1'$$,
  '42501', null,
  'a Manager cannot forge a payment, which the deed cron would have acted on unattended');

-- A2: the rewritten fee, which is what Stripe charges.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$update public.applications set fee_amount = 1.00 where guarantee_ref = 'ZZZ-FORGE-1'$$,
  '42501', null,
  'and a Negotiator cannot rewrite the fee their own tenant is about to be charged');

-- A3: erasing the record of an executed deed, and inventing a refund.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$update public.applications
       set refunded_amount = 9999.00, stripe_refund_id = 're_forged',
           deed_state = null, executed_pdf_path = null
     where guarantee_ref = 'ZZZ-FORGE-1'$$,
  '42501', null,
  'nor invent a refund, nor erase the record of an executed deed');

select throws_ok(
  $$insert into public.applications
      (guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
       partner_rate, agent_rate, referencing_mode)
    values ('ZZZ-FORGE-2',(select id from public.partners where slug='opndoor-agents'),
       'a2000000-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000f2',
       'a2000000-0000-0000-0000-00000000c002','ZZZ Forge Neg',
       'Mx','Fred','Forge','1990-01-01','fred@f.test','07700900102','2 Forge Street','London','FG2 2AA',
       1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced')$$,
  '42501', null,
  'and cannot write an application into existence already paid');

-- ===========================================================================
-- AND THE REAL DOORS STILL WORK
-- ===========================================================================
-- A revoke that stopped legitimate work would be the lock-down pattern the
-- functional guard suite exists for, so the two writes a Negotiator really
-- makes are asserted here too.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.add_application_note('ZZZ-FORGE-1','Spoke to the tenant.')$$,
  'while the Negotiator can still add a note to their own referral');
select lives_ok(
  $$select public.mark_withdrawn('ZZZ-FORGE-1','tenancy_fell_through','The tenant pulled out.')$$,
  'and can still withdraw it, through the RPC that asks the ladder');

select * from finish();
rollback;
