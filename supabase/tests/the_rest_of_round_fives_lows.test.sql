-- THE REST OF ROUND FIVE'S LOWS, asserted.
--
-- The five that live in SQL. Measured on dev before 20261006500000:
--
--   PUBLIC-executable functions in public   10
--   applications policies saying `to public`  4
--   is_aal2 in staff_payment_page_token     false
--   is_aal2 in agency_branches_for_match    false
--
-- The first two are CATALOGUE assertions rather than behavioural ones, and
-- that is deliberate: the defect is not that one particular function was open,
-- it is that ten were and nobody noticed. An assertion over the whole
-- catalogue is the only shape that stops the eleventh.

begin;
select plan(9);

-- ===========================================================================
-- 1. NOTHING IN public IS PUBLIC-EXECUTABLE
-- ===========================================================================
-- Postgres grants EXECUTE to PUBLIC on every new function, and ALTER DEFAULT
-- PRIVILEGES does not take on this project (measured in 20261006330000), so
-- this is the state that comes back by itself unless something says no.
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  0,
  'no function in public is executable by PUBLIC');

-- ===========================================================================
-- 2. EVERY applications POLICY NAMES ITS ROLE
-- ===========================================================================
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'applications'
      and roles::text <> '{authenticated}'),
  0,
  'every policy on applications is addressed to authenticated, not to public');

-- ===========================================================================
-- 3. THE TWO THAT LACKED THE STEP-UP
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Lows Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Lows Office'),
  ('98000000-0000-0000-0000-0000000000b2','98000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Lows Annexe');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('98000000-0000-0000-0000-00000000c001'::uuid,'zzz.lows.dir@l.test'),
  ('98000000-0000-0000-0000-00000000c002'::uuid,'zzz.lows.neg@l.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('98000000-0000-0000-0000-00000000c001','ZZZ Lows Dir','zzz.lows.dir@l.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('98000000-0000-0000-0000-00000000c002','ZZZ Lows Neg','zzz.lows.neg@l.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'98000000-0000-0000-0000-0000000000b1');

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('98000000-0000-0000-0000-00000000c001','agency','98000000-0000-0000-0000-0000000000a1',null),
  ('98000000-0000-0000-0000-00000000c002','branch',null,'98000000-0000-0000-0000-0000000000b1');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   -- expiry_date is GENERATED from tenancy_start (guarantee_expiry), so the
   -- reminder window is entered by choosing the start date, not by setting the
   -- expiry. current_date - 355 lands the expiry nine days out, inside the 30.
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at, deed_issued_at)
values ('98000000-0000-0000-0000-00000000e001','ZZZ-LOWS-1',(select id from public.partners where slug='opndoor-agents'),
   '98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-00000000c002','ZZZ Lows Neg',
   'Mx','Lois','Lows','1990-01-01','lois@l.test','07700900061','1 Lows Street','London','LW1 1AA',1000,current_date - 355,'deed',true,0.25,0.10,'opndoor_referenced',
   now()-interval '360 days', now()-interval '359 days', now()-interval '358 days');

-- A PASSWORD-ONLY SESSION. aal1, which is what somebody has between signing in
-- and completing the second factor.
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$select public.staff_payment_page_token('ZZZ-LOWS-1')$$,
  '42501', 'MFA required',
  'a password-only session cannot mint a 90-day payment page token');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.agency_branches_for_match('98000000-0000-0000-0000-0000000000a1')$$,
  '42501', 'MFA required',
  'nor read the match branch list');

-- AND THE STEP-UP IS A STEP-UP, not a closure: the same caller at aal2 gets
-- the ordinary answer, which for this one is the ordinary refusal on level.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.staff_payment_page_token('ZZZ-LOWS-1')$$,
  'while the referrer who sent it still mints one at aal2');

-- ===========================================================================
-- 4. users_mgmt_insert IS CONTAINED
-- ===========================================================================
-- The Director holds the AGENCY, so both branches are within reach; a row
-- pointed at a branch of another agency is not.
reset role;
insert into public.agencies (id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Lows Elsewhere');
insert into public.branches (id, agency_id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000b3','98000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Lows Elsewhere Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('98000000-0000-0000-0000-00000000c003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.lows.new@l.test','',now(),now(),now());

select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id)
    values ('98000000-0000-0000-0000-00000000c003','ZZZ Lows New','zzz.lows.new@l.test','referrer',
            (select id from public.partners where slug='opndoor-agents'),'active',false,
            '98000000-0000-0000-0000-0000000000b3')$$,
  '42501', null,
  'a Director cannot create a person at a branch of an agency they do not hold');

select lives_ok(
  $$insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id)
    values ('98000000-0000-0000-0000-00000000c003','ZZZ Lows New','zzz.lows.new@l.test','referrer',
            (select id from public.partners where slug='opndoor-agents'),'active',false,
            '98000000-0000-0000-0000-0000000000b2')$$,
  'and can create one at their own other office, so the containment is not a closure');

-- ===========================================================================
-- 5. A DEACTIVATED REFERRER IS NOT AN EXPIRY RECIPIENT
-- ===========================================================================
reset role;
select is(
  (select r.referrer_email from public.fire_expiry_reminders(current_date) r
    where r.guarantee_ref = 'ZZZ-LOWS-1'),
  'zzz.lows.neg@l.test',
  'the active referrer is the expiry recipient');

reset role;
delete from public.expiry_reminders where application_id = '98000000-0000-0000-0000-00000000e001';
update public.users set status = 'deactivated' where id = '98000000-0000-0000-0000-00000000c002';
select is(
  (select r.referrer_email from public.fire_expiry_reminders(current_date) r
    where r.guarantee_ref = 'ZZZ-LOWS-1'),
  null,
  'and once they have left the reminder resolves to nobody, rather than to them');

select * from finish();
rollback;
