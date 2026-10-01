-- ONE RAIL EXCLUDED, NOT ONE RAIL INCLUDED.
--
-- The ruling is "direct-rail applications never count as the matched agency's
-- business". That is an exclusion of ONE rail, and there are three, so writing
-- it as an inclusion of one says something different and wrong.
--
-- Round 6 found both readings in the same codebase:
--   commission_statement_lines  had NO rail test, so a matched direct
--                               application became an agency-level statement
--                               PAYEE and the statement is posted to that
--                               agency's Directors
--   agency_weekly_digest        pinned `= 'Agent referral'`, so every SUPPLIER
--                               agency's digest came back all zeros and the
--                               reader was dropped
--
-- Both assertions below fail against the code before 20261006580000, in
-- opposite directions.

begin;
select plan(6);

-- ===========================================================================
-- A SUPPLIER AGENCY, AN AGENCY-RAIL AGENCY, AND A MATCHED DIRECT TENANT
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('92000000-0000-0000-0000-0000000000d1','zzz-rail-supplier','ZZZ Rail Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

insert into public.agencies (id, partner_id, name) values
  ('92000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Rail Agency'),
  ('92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-0000000000d1','ZZZ Rail Supplier Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('92000000-0000-0000-0000-0000000000b1','92000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Rail Office'),
  ('92000000-0000-0000-0000-0000000000b2','92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-0000000000d1','ZZZ Rail Supplier Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('92000000-0000-0000-0000-00000000c001'::uuid,'zzz.rail.neg@r.test'),
  ('92000000-0000-0000-0000-00000000c002'::uuid,'zzz.rail.supref@r.test'),
  ('92000000-0000-0000-0000-0000000000aa'::uuid,'zzz.rail.tenant@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('92000000-0000-0000-0000-00000000c001','ZZZ Rail Neg','zzz.rail.neg@r.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'92000000-0000-0000-0000-0000000000b1'),
  ('92000000-0000-0000-0000-00000000c002','ZZZ Rail Sup Ref','zzz.rail.supref@r.test','referrer','92000000-0000-0000-0000-0000000000d1','active',false,null);
insert into public.user_scopes (user_id, kind, branch_id) values
  ('92000000-0000-0000-0000-00000000c001','branch','92000000-0000-0000-0000-0000000000b1');

insert into public.applicants (id, email, first_name, last_name)
values ('92000000-0000-0000-0000-0000000000aa','zzz.rail.tenant@r.test','Dana','Direct');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  -- The AGENCY rail: real business, must keep counting.
  ('92000000-0000-0000-0000-00000000e001','ZZZ-RAIL-AG',(select id from public.partners where slug='opndoor-agents'),
   '92000000-0000-0000-0000-0000000000a1','92000000-0000-0000-0000-0000000000b1','92000000-0000-0000-0000-00000000c001','ZZZ Rail Neg',null,
   'Mx','Ann','Agency','1990-01-01','ann@r.test','07700900081','1 Rail Street','London','RL1 1AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',now()-interval '3 days',now()-interval '2 days'),
  -- The SUPPLIER rail: also real business, and the digest was dropping it.
  ('92000000-0000-0000-0000-00000000e002','ZZZ-RAIL-SU','92000000-0000-0000-0000-0000000000d1',
   '92000000-0000-0000-0000-0000000000a2','92000000-0000-0000-0000-0000000000b2','92000000-0000-0000-0000-00000000c002','ZZZ Rail Sup Ref',null,
   'Mx','Sam','Supplier','1990-01-01','sam@r.test','07700900082','2 Rail Street','London','RL2 2AA',1000,current_date+30,'paid',true,0.25,0.10,'pre_referenced_open',now()-interval '3 days',now()-interval '2 days'),
  -- The DIRECT rail, pointed at the agency's branch by the matcher, which is
  -- what gives it a real agency_id.
  ('92000000-0000-0000-0000-00000000e003','ZZZ-RAIL-DI',(select id from public.partners where slug='opndoor-direct'),
   '92000000-0000-0000-0000-0000000000a1','92000000-0000-0000-0000-0000000000b1',null,'Direct','92000000-0000-0000-0000-0000000000aa',
   'Mx','Dana','Direct','1990-01-01','zzz.rail.tenant@r.test','07700900083','3 Rail Street','London','RL3 3AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',now()-interval '3 days',now()-interval '2 days');

-- The direct partner's rate is what held M5 at zero. Set it, so the assertion
-- is about the RAIL and not about a number somebody can edit on a screen.
update public.partners set agent_rate = 0.10 where slug = 'opndoor-direct';

/* THE MONTH OF THE FIXTURE, NOT THE MONTH OF THE CLOCK. These three
   assertions asked for `date_trunc('month', now())` while the fixture
   pays `now() - interval '2 days'`, which is the same month for
   twenty-eight or so days out of thirty and a different one for the
   other two. It went red at 00:01 on the 1st of October against code
   that had not changed: every paid row was in September and the
   statement was asked for October.

   A test that passes because of the date is not passing. Both halves now
   read from the same instant. */
-- ===========================================================================
-- M5. A DIRECT TENANT IS NOT AN AGENCY'S PAYEE
-- ===========================================================================
select is(
  (select count(*)::int from public.commission_statement_lines(date_trunc('month', now() - interval '2 days')::date)
    where guarantee_ref = 'ZZZ-RAIL-DI'), 0,
  'a matched direct application is not a statement line for the agency it was matched to');

select is(
  (select count(*)::int from public.commission_statement_lines(date_trunc('month', now() - interval '2 days')::date)
    where guarantee_ref = 'ZZZ-RAIL-AG'), 1,
  'while the agency''s own referral still is');

/* CHANGED TWICE IN ONE DAY, 2026-09-30, and the second change undid the
   first. Worth recording both, because the line count moved for opposite
   reasons and a reader finding only the end state would think it had
   always been this.

   IT ASKED FOR ONE AND MEANT THE AGENCY'S. The supplier's own cut was not
   a statement line anywhere, which is what made supplier statements a new
   document rather than a new recipient. Supplier statements added the
   supplier's line, so it briefly asserted two.

   THEN NM-C 5 TOOK THE AGENCY'S AWAY. Matt: "for a supplier like
   Rightmove, Opndoor pays only the supplier; the supplier pays its own
   agents, so no agency commission line is created under a supplier
   referral unless the supplier's agreement says Opndoor pays agents
   directly." So it is one line again, and it is the other one.

   STILL A LEVEL AND NOT A COUNT, because what this file is about is
   which rails are excluded, and `count = 1` would pass just as happily
   if the surviving line were the agency's. The agency arm under the
   setting is asserted in a_supplier_gets_its_own_statement, which owns
   its own supplier. */
select bag_eq(
  $$select level from public.commission_statement_lines(date_trunc('month', now() - interval '2 days')::date)
     where guarantee_ref = 'ZZZ-RAIL-SU'$$,
  $$values ('partner')$$,
  'and the supplier''s referral is not excluded either -- one line, the supplier''s own, because Opndoor pays only the supplier');

-- ===========================================================================
-- M3. THE DIGEST KEEPS THE SUPPLIER AND DROPS THE DIRECT TENANT
-- ===========================================================================
select is(
  (select d.paid from public.agency_weekly_digest(now() - interval '7 days', now()) d
    where d.agency_id = '92000000-0000-0000-0000-0000000000a2'), 1,
  'a supplier agency''s weekly digest carries its own business, rather than coming back all zeros');

select is(
  (select d.paid from public.agency_weekly_digest(now() - interval '7 days', now()) d
    where d.agency_id = '92000000-0000-0000-0000-0000000000a1'), 1,
  'and the agency-rail agency counts its own referral once');

-- The direct tenant sits at that same branch, so "once" is the assertion: if
-- the exclusion were missing it would be two.
-- Both agencies have exactly one paid application at the same rent, so if the
-- direct tenant were counted the agency-rail figure would be twice the
-- supplier's rather than equal to it.
select is(
  (select d.fees from public.agency_weekly_digest(now() - interval '7 days', now()) d
    where d.agency_id = '92000000-0000-0000-0000-0000000000a1'),
  (select d.fees from public.agency_weekly_digest(now() - interval '7 days', now()) d
    where d.agency_id = '92000000-0000-0000-0000-0000000000a2'),
  'and its fees are its own, not its own plus a direct tenant''s');

select * from finish();
rollback;
