-- WHERE AGENCIES AND SUPPLIERS SEND THEIR COMMISSION INVOICES.
--
-- Matt, 2026-10-01, across three messages about one setting:
--   "...to [invoice email], including your bank details." then
--   "The invoice email is not hardcoded and has no default: make it a
--    setting Opndoor admin fills in. Until it's set, don't send
--    statements; show a clear warning on Home and Health saying the
--    invoice email needs setting." then
--   "Invoice email: default it to accounts@opndoor.co, as a setting
--    Opndoor admin can change later. No warning needed while it's set."
--
-- THE THIRD MESSAGE GAVE THE ADDRESS AND KEPT THE SECOND'S MACHINERY.
-- "No warning needed WHILE IT'S SET" is not "drop the warning": it is
-- the guard still standing for the case where somebody clears it, which
-- is now unlikely rather than the starting state. So the assertions
-- below run in both states, and the one that matters most is the
-- CLEARED one, because that is the path nobody will exercise by hand.

begin;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('ea000000-0000-0000-0000-00000000c001'::uuid,'zzz.inv.admin@o.test'),
  ('ea000000-0000-0000-0000-00000000c002'::uuid,'zzz.inv.mgmt@a.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ea000000-0000-0000-0000-00000000c001','ZZZ Inv Admin','zzz.inv.admin@o.test','superadmin',null,'active',true),
  ('ea000000-0000-0000-0000-00000000c002','ZZZ Inv Mgmt','zzz.inv.mgmt@a.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true);

-- ===========================================================================
-- 1. SEEDED, SO THE RUN CAN POST
-- ===========================================================================
select is(
  (select public.statement_invoice_email()),
  'accounts@opndoor.co',
  'the invoice address is the one Matt gave, seeded as a setting rather than written into a function');

select ok(
  (select public.statements_can_be_posted()),
  'and the monthly run can post, which is what the address being set means');

-- ===========================================================================
-- 2. ONLY OPNDOOR CHANGES IT
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$select public.set_app_setting_text('statement_invoice_email','theirs@agency.test')$$,
  '42501', null,
  'an agency Director may not change where Opndoor is invoiced');

select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

/* NOT A FULL RFC CHECK, deliberately: one that is wrong about a real
   address is worse than one that lets a typo through to a bounce. But a
   value with no @ in it is not an address by any reading, and this
   field's whole job is to be one. */
select throws_ok(
  $$select public.set_app_setting_text('statement_invoice_email','not-an-address')$$,
  '22023', null, 'and a value that is not an email address is refused');

select lives_ok(
  $$select public.set_app_setting_text('statement_invoice_email','finance@opndoor.test')$$,
  'an Opndoor admin changes it');

reset role;
select is(
  (select public.statement_invoice_email()),
  'finance@opndoor.test', 'and the statements would quote the new one');

select ok(
  exists (select 1 from public.settings_audit
           where key = 'statement_invoice_email' and new_value = 'finance@opndoor.test'),
  'and the change is audited, like every other setting');

-- ===========================================================================
-- 3. CLEARED, WHICH IS THE GUARD. The path nobody exercises by hand.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.set_app_setting_text('statement_invoice_email','')$$,
  'an admin can clear it, which is the state the guard exists for');

reset role;
/* NULL, NOT AN EMPTY STRING. Everything downstream tests for null, and a
   blank would print "to , including your bank details" on a document
   telling somebody where to send an invoice. */
select is(
  (select public.statement_invoice_email()),
  null::text, 'and it reads as nothing at all rather than as an empty address');

select ok(
  not (select public.statements_can_be_posted()),
  'so the monthly run posts nothing, which is what Home and Health warn about');

select * from finish();
rollback;
