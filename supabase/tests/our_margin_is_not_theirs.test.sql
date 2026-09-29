-- OUR MARGIN IS NOT THEIRS.
--
-- Round 7, E. Round 6 found an agency Director's Reporting page stating
-- Opndoor's own 25% house cut on their own book, and fixed it in the client.
-- This is the same disclosure through two SECURITY DEFINER functions the
-- client calls on every login, which that fix did not cover.
--
-- Measured on dev before 20261006680000, as Regent's Director:
--   my_partner_rates()                  ->  partner_rate 0.2500
--   application_commission_rates(null)  ->  partner_rate 0.2500, all 7 rows
--
-- On the AGENCY rail the house partner's "partner rate" is Opndoor's share of
-- the guarantee fee. Rule 3 makes commercial terms Director-level; it does not
-- make OUR terms theirs.
--
-- AND THE PREDICATE ITSELF IS ASSERTED, because the first fix used
-- `partners.is_house_route` and changed nothing: opndoor-agents -- the one
-- partner whose rate is our margin, and the whole reason for the predicate --
-- is NOT flagged is_house_route. Only re-running the reproduction caught it.

begin;
select plan(7);  -- is_house_partner_id is exercised by name in the first three

-- ===========================================================================
-- THE PREDICATE
-- ===========================================================================
select ok(public.is_house_partner_id((select id from public.partners where slug = 'opndoor-agents')),
  'opndoor-agents is one of ours, though its is_house_route column says false');
select ok(public.is_house_partner_id((select id from public.partners where slug = 'opndoor-direct')),
  'and so is opndoor-direct');
select ok(not public.is_house_partner_id(
  (select id from public.partners where slug not in ('opndoor-direct','referencing-partner','opndoor-agents') limit 1)),
  'while a real supplier is not');

-- ===========================================================================
-- AN AGENCY DIRECTOR
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('a3000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Margin Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('a3000000-0000-0000-0000-0000000000f2','a3000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Margin Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('a3000000-0000-0000-0000-00000000c001'::uuid,'zzz.margin.dir@m.test'),
  ('a3000000-0000-0000-0000-00000000c002'::uuid,'zzz.margin.neg@m.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('a3000000-0000-0000-0000-00000000c001','ZZZ Margin Dir','zzz.margin.dir@m.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('a3000000-0000-0000-0000-00000000c002','ZZZ Margin Neg','zzz.margin.neg@m.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'a3000000-0000-0000-0000-0000000000f2');
insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('a3000000-0000-0000-0000-00000000c001','agency','a3000000-0000-0000-0000-0000000000f1',null),
  ('a3000000-0000-0000-0000-00000000c002','branch',null,'a3000000-0000-0000-0000-0000000000f2');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values ('a3000000-0000-0000-0000-00000000e001','ZZZ-MARGIN-1',(select id from public.partners where slug='opndoor-agents'),
   'a3000000-0000-0000-0000-0000000000f1','a3000000-0000-0000-0000-0000000000f2','a3000000-0000-0000-0000-00000000c002','ZZZ Margin Neg',
   'Mx','Mary','Margin','1990-01-01','mary@m.test','07700900111','1 Margin Street','London','MG1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '1 day');

select set_config('request.jwt.claims',
  '{"sub":"a3000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select partner_rate from public.my_partner_rates()), 0::numeric,
  'a Director reads no house margin from my_partner_rates');
select is((select partner_rate from public.application_commission_rates(null)
            where application_id = 'a3000000-0000-0000-0000-00000000e001'), 0::numeric,
  'nor from the rates on their own application');

-- AND THEIR OWN RATE IS STILL THEIRS. Zeroing the wrong one would be the same
-- mistake in the other direction: an agency Director must see what THEY earn.
select is((select agent_rate from public.my_partner_rates()), 0.1000::numeric,
  'while their own agent rate is untouched, because that one is theirs');

-- ===========================================================================
-- AND OPNDOOR STILL SEES THE REAL NUMBER
-- ===========================================================================
-- A rate we cannot read is a rate we cannot bill on.
reset role;
select set_config('request.jwt.claims',
  ('{"sub":"' || (select id from public.users where role = 'superadmin' and status = 'active' limit 1)
   || '","role":"authenticated","aal":"aal2"}'), true);
set local role authenticated;
select is(
  (select r.partner_rate from public.my_partner_rates() r
    where r.partner_id = (select id from public.partners where slug = 'opndoor-agents')),
  0.2500::numeric,
  'an opndoor admin still reads the real house rate');

select * from finish();
rollback;
