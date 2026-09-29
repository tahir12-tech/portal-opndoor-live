-- TENANT ISOLATION, ASSERTED RATHER THAN ASSUMED.
--
-- THE STANDING GUARD. Every other test in this directory asserts that one rule
-- works. This one asserts that the boundary between parties holds, across every
-- surface at once, for every role that exists. It is the file that should fail
-- when somebody adds a definer function without a guard, widens a policy, or
-- writes a recipient list keyed on the partner.
--
-- WHY IT HAS TO EXIST. On the agency rail there is no partner boundary: every
-- independently onboarded agency shares the house partner 'opndoor-agents'. So
-- `partner_id = app_partner()` -- the expression this codebase reached for
-- roughly eighty times -- does not mean "my company", it means "every agency
-- Opndoor carries". Reading each of those eighty sites tells you very little;
-- calling them as one agency's manager against another agency's object tells
-- you everything, and that is what this file does.
--
-- THE FIXTURE is the shape the product actually has, not a convenient one:
--
--   ZZZ Alpha Group          a group, two agencies, three branches
--     ZZZ Alpha North          two branches (Central, West)
--     ZZZ Alpha South          one branch (Quay)
--   ZZZ Beta Lettings        a single-office agency on the SAME house partner
--   ZZZ Gamma Supplier       a supplier, its own partner, its own agency
--   a DIRECT tenant          on opndoor-direct, with their own named contact
--
-- and the people, one per role that exists:
--
--   alpha.group      Director, GROUP position over Alpha Group
--   alpha.brand      Manager, AGENCY position on Alpha North
--   alpha.branch     Manager, BRANCH position on Alpha Central
--   alpha.neg        Negotiator, BRANCH position on Alpha Central
--   beta.dir         Director of the single-office agency
--   gamma.mgmt       the supplier's management
--   gamma.ref        the supplier's referrer
--   gamma.dev        the supplier's developer
--
-- EVERY ASSERTION IS "WHAT CAN THEY REACH", counted, not "does this raise".
-- A refusal and an empty result are both acceptable answers to "show me
-- somebody else's data"; returning a row is not, and only counting catches the
-- difference between a policy that filters and a guard that throws.

begin;
select plan(88);

-- ===========================================================================
-- THE FIXTURE
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('90000000-0000-0000-0000-00000000ac01', 'zzz-gamma', 'ZZZ Gamma Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

insert into public.agency_groups (id, partner_id, name)
values ('90000000-0000-0000-0000-00000000ab01',
        (select id from public.partners where slug='opndoor-agents'), 'ZZZ Alpha Group');

insert into public.agencies (id, partner_id, group_id, name) values
  ('90000000-0000-0000-0000-0000000000a1', (select id from public.partners where slug='opndoor-agents'),
   '90000000-0000-0000-0000-00000000ab01', 'ZZZ Alpha North'),
  ('90000000-0000-0000-0000-0000000000a2', (select id from public.partners where slug='opndoor-agents'),
   '90000000-0000-0000-0000-00000000ab01', 'ZZZ Alpha South'),
  ('90000000-0000-0000-0000-0000000000a3', (select id from public.partners where slug='opndoor-agents'),
   null, 'ZZZ Beta Lettings'),
  ('90000000-0000-0000-0000-0000000000a4', '90000000-0000-0000-0000-00000000ac01',
   null, 'ZZZ Gamma Agency');

insert into public.branches (id, agency_id, partner_id, name) values
  ('90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Alpha Central'),
  ('90000000-0000-0000-0000-0000000000b2','90000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Alpha West'),
  ('90000000-0000-0000-0000-0000000000b3','90000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Alpha Quay'),
  ('90000000-0000-0000-0000-0000000000b4','90000000-0000-0000-0000-0000000000a3',(select id from public.partners where slug='opndoor-agents'),'ZZZ Beta Office'),
  ('90000000-0000-0000-0000-0000000000b5','90000000-0000-0000-0000-0000000000a4','90000000-0000-0000-0000-00000000ac01','ZZZ Gamma Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('90000000-0000-0000-0000-00000000c001'::uuid,'zzz.alpha.group@iso.test'),
  ('90000000-0000-0000-0000-00000000c002'::uuid,'zzz.alpha.brand@iso.test'),
  ('90000000-0000-0000-0000-00000000c003'::uuid,'zzz.alpha.branch@iso.test'),
  ('90000000-0000-0000-0000-00000000c004'::uuid,'zzz.alpha.neg@iso.test'),
  ('90000000-0000-0000-0000-00000000c005'::uuid,'zzz.beta.dir@iso.test'),
  ('90000000-0000-0000-0000-00000000c006'::uuid,'zzz.gamma.mgmt@iso.test'),
  ('90000000-0000-0000-0000-00000000c007'::uuid,'zzz.gamma.ref@iso.test'),
  ('90000000-0000-0000-0000-00000000c008'::uuid,'zzz.gamma.dev@iso.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('90000000-0000-0000-0000-00000000c001','ZZZ Alpha Group Dir','zzz.alpha.group@iso.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('90000000-0000-0000-0000-00000000c002','ZZZ Alpha Brand Mgr','zzz.alpha.brand@iso.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('90000000-0000-0000-0000-00000000c003','ZZZ Alpha Branch Mgr','zzz.alpha.branch@iso.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('90000000-0000-0000-0000-00000000c004','ZZZ Alpha Neg','zzz.alpha.neg@iso.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'90000000-0000-0000-0000-0000000000b1'),
  ('90000000-0000-0000-0000-00000000c005','ZZZ Beta Dir','zzz.beta.dir@iso.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('90000000-0000-0000-0000-00000000c006','ZZZ Gamma Mgmt','zzz.gamma.mgmt@iso.test','management','90000000-0000-0000-0000-00000000ac01','active',true,null),
  ('90000000-0000-0000-0000-00000000c007','ZZZ Gamma Ref','zzz.gamma.ref@iso.test','referrer','90000000-0000-0000-0000-00000000ac01','active',false,'90000000-0000-0000-0000-0000000000b5'),
  ('90000000-0000-0000-0000-00000000c008','ZZZ Gamma Dev','zzz.gamma.dev@iso.test','developer','90000000-0000-0000-0000-00000000ac01','active',false,null);

insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id) values
  ('90000000-0000-0000-0000-00000000c001','group','90000000-0000-0000-0000-00000000ab01',null,null),
  ('90000000-0000-0000-0000-00000000c002','agency',null,'90000000-0000-0000-0000-0000000000a1',null),
  ('90000000-0000-0000-0000-00000000c003','branch',null,null,'90000000-0000-0000-0000-0000000000b1'),
  ('90000000-0000-0000-0000-00000000c005','agency',null,'90000000-0000-0000-0000-0000000000a3',null),
  -- The Negotiator holds a BRANCH position. They used to hold none and be
  -- located by home_branch_id; 20261006300000 made a position mandatory on
  -- this estate, because that column is one its own subject can PATCH.
  ('90000000-0000-0000-0000-00000000c004','branch',null,null,'90000000-0000-0000-0000-0000000000b1'),
  ('90000000-0000-0000-0000-00000000c007','branch',null,null,'90000000-0000-0000-0000-0000000000b5');

-- One application per branch, each referred by somebody who belongs there.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at, deed_issued_at)
values
  ('90000000-0000-0000-0000-00000000e001','GR-ISO-AC',(select id from public.partners where slug='opndoor-agents'),
   '90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000b1',
   '90000000-0000-0000-0000-00000000c004','ZZZ Alpha Neg','Mx','Anna','Central','1990-01-01','anna@iso.test','07700900001',
   '1 Central Rd','London','N1 1AA',1500,current_date+30,'deed',true,0.25,0.10,'opndoor_referenced',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days'),
  ('90000000-0000-0000-0000-00000000e002','GR-ISO-AQ',(select id from public.partners where slug='opndoor-agents'),
   '90000000-0000-0000-0000-0000000000a2','90000000-0000-0000-0000-0000000000b3',
   '90000000-0000-0000-0000-00000000c001','ZZZ Alpha Group Dir','Mx','Quinn','Quay','1990-01-01','quinn@iso.test','07700900002',
   '2 Quay Rd','London','N1 2AA',1500,current_date+30,'deed',true,0.25,0.10,'opndoor_referenced',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days'),
  ('90000000-0000-0000-0000-00000000e003','GR-ISO-BO',(select id from public.partners where slug='opndoor-agents'),
   '90000000-0000-0000-0000-0000000000a3','90000000-0000-0000-0000-0000000000b4',
   '90000000-0000-0000-0000-00000000c005','ZZZ Beta Dir','Mx','Bella','Beta','1990-01-01','bella@iso.test','07700900003',
   '3 Beta Rd','London','N1 3AA',1500,current_date+30,'deed',true,0.25,0.10,'opndoor_referenced',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days'),
  ('90000000-0000-0000-0000-00000000e004','GR-ISO-GS','90000000-0000-0000-0000-00000000ac01',
   '90000000-0000-0000-0000-0000000000a4','90000000-0000-0000-0000-0000000000b5',
   '90000000-0000-0000-0000-00000000c007','ZZZ Gamma Ref','Mx','Gus','Gamma','1990-01-01','gus@iso.test','07700900004',
   '4 Gamma Rd','London','N1 4AA',1500,current_date+30,'deed',true,0.25,0.10,'pre_referenced_open',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days'),
  ('90000000-0000-0000-0000-00000000e005','GR-ISO-DR',(select id from public.partners where slug='opndoor-direct'),
   '90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000b1',
   null,null,'Mx','Dana','Direct','1990-01-01','dana@iso.test','07700900005',
   '5 Direct Rd','London','N1 5AA',1500,current_date+30,'deed',true,0.25,0.10,'pre_referenced_open',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days');

-- The direct tenant names their own contact. The agency rail must never
-- displace it, which is what the auto-match used to do.
insert into public.application_delivery_contacts (application_id, kind, agency_name, first_name, last_name, phone, email)
values ('90000000-0000-0000-0000-00000000e005','letting_agent','ZZZ Tenant Choice','Dana','Choice','07700900099','zzz.tenantchoice@iso.test');

-- The supplier's branch keeps its mailbox: that IS the deed path on that rail.
insert into public.agent_contacts (branch_id, name, email, is_primary)
values ('90000000-0000-0000-0000-0000000000b5','ZZZ Gamma Desk','zzz.gammadesk@iso.test',true);

-- ===========================================================================
-- EVERY PERSONA, EVERY SURFACE. One block each: become them, then count what
-- they can reach that is NOT theirs. Written out rather than looped, because a
-- helper function cannot survive the runner's statement splitter and because
-- an isolation test that hides its own arithmetic is worth very little.
-- ===========================================================================

-- ---- the group Director ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'the group Director reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
select cmp_ok((select count(*)::int from public.applications a where a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000a2']::uuid[])), '>', 0,
  'while still reaching their own');
reset role;

-- ---- the brand Manager ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'the brand Manager reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
select cmp_ok((select count(*)::int from public.applications a where a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[])), '>', 0,
  'while still reaching their own');
reset role;

-- ---- the branch Manager ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'the branch Manager reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
select cmp_ok((select count(*)::int from public.applications a where a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[])), '>', 0,
  'while still reaching their own');
reset role;

-- ---- the Negotiator ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'the Negotiator reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a1']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
reset role;

-- ---- the single-office Director ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c005","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'the single-office Director reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
select cmp_ok((select count(*)::int from public.applications a where a.agency_id = any(array['90000000-0000-0000-0000-0000000000a3']::uuid[])), '>', 0,
  'while still reaching their own');
reset role;

-- ---- the supplier's management ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c006","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'the supplier''s management reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
select cmp_ok((select count(*)::int from public.applications a where a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[])), '>', 0,
  'while still reaching their own');
reset role;

-- ---- the supplier's referrer ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c007","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'the supplier''s referrer reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
reset role;

-- ---- the supplier's developer ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c008","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.applications a where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'the supplier''s developer reaches no application outside their own agencies');
select is((select count(*)::int from public.agencies g where g.name like 'ZZZ %' and not (g.id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency, though they share a partner with three');
select is((select count(*)::int from public.branches b where b.name like 'ZZZ %' and not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency''s branches');
select is((select count(*)::int from public.activity_log al join public.applications a on a.id=al.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and nothing in another agency''s activity trail');
select is((select count(*)::int from public.agent_contacts c join public.branches b on b.id=c.branch_id
            where not (b.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other agency''s agent contacts');
select is((select count(*)::int from public.commission_statement_refs r
            where split_part(r.payee_key,':',2) ~ '^[0-9a-f-]{36}$'
              and not (split_part(r.payee_key,':',2)::uuid = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no other party''s statement reference');
select is((select count(*)::int from public.application_delivery_contacts d
            join public.applications a on a.id=d.application_id
            where not (a.agency_id = any(array['90000000-0000-0000-0000-0000000000a4']::uuid[]))), 0,
  'and no tenant-named delivery contact outside their agencies');
reset role;

-- ===========================================================================
-- RULE 4: THE DEED AND THE NOTIFICATIONS REACH THE PERSON WHO SENT IT
-- ===========================================================================
select is((select r.email from public.agency_notification_recipients('90000000-0000-0000-0000-00000000e001') r),
  'zzz.alpha.neg@iso.test',
  'an agency referral notifies the Negotiator who sent it, not their manager');
select is((select t.email from public.deed_delivery_target('90000000-0000-0000-0000-00000000e001') t),
  'zzz.alpha.neg@iso.test',
  'and the executed deed goes to the same person');
select is((select t.source from public.deed_delivery_target('90000000-0000-0000-0000-00000000e001') t), 'referrer',
  'said plainly in the source, so "where did it go" has an answer');

-- A ticked colleague is copied only within the position they hold.
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = true where id = '90000000-0000-0000-0000-00000000c002';
select set_config('app.setting_notifications_tick', 'off', true);

select ok(exists (select 1 from public.agency_notification_recipients('90000000-0000-0000-0000-00000000e001') r
                   where r.email = 'zzz.alpha.brand@iso.test'),
  'a ticked agency-positioned Manager is copied on their own agency''s referral');
select ok(not exists (select 1 from public.agency_notification_recipients('90000000-0000-0000-0000-00000000e003') r
                       where r.email = 'zzz.alpha.brand@iso.test'),
  'and is NOT copied on another agency''s, though they share a partner');

-- RULE 2: the other two rails are untouched by any of this.
select is((select count(*)::int from public.agency_notification_recipients('90000000-0000-0000-0000-00000000e004')), 0,
  'a supplier referral has no agency-rail recipients at all');
select is((select t.email from public.deed_delivery_target('90000000-0000-0000-0000-00000000e004') t), 'zzz.gammadesk@iso.test',
  'its deed goes to the branch agent contact, as it always did');
select is((select t.email from public.deed_delivery_target('90000000-0000-0000-0000-00000000e005') t), 'zzz.tenantchoice@iso.test',
  'and a DIRECT tenant''s deed goes to the contact the tenant named');
select is((select t.source from public.deed_delivery_target('90000000-0000-0000-0000-00000000e005') t), 'delivery_contact',
  'never to the agency its branch happens to point at');

-- ===========================================================================
-- RULE 3: A SCHEDULED EMAIL IS SCOPED TO ITS READER
-- ===========================================================================
select ok(not exists (
    select 1 from public.staff_notification_scopes((select id from public.partners where slug='opndoor-agents')) s
     where s.user_id = '90000000-0000-0000-0000-00000000c002'
       and s.agency_id <> '90000000-0000-0000-0000-0000000000a1'),
  'the digest reaches a brand Manager for their own agency and no other');
select ok(exists (
    select 1 from public.staff_notification_scopes((select id from public.partners where slug='opndoor-agents')) s
     where s.user_id = '90000000-0000-0000-0000-00000000c001'
       and s.agency_id = '90000000-0000-0000-0000-0000000000a2'),
  'a GROUP-positioned Director reaches both agencies in their group');
select ok(not exists (
    select 1 from public.staff_notification_scopes((select id from public.partners where slug='opndoor-agents')) s
     where s.user_id = '90000000-0000-0000-0000-00000000c001'
       and s.agency_id = '90000000-0000-0000-0000-0000000000a3'),
  'and not the single-office agency beside them, which is not in it');
select ok(not exists (
    select 1 from public.staff_notification_scopes((select id from public.partners where slug='opndoor-agents')) s
     where s.user_id = '90000000-0000-0000-0000-00000000c004'),
  'a Negotiator is not a digest reader: their scope is their own referrals');

-- The digest FIGURES are per agency too, not per partner.
select ok((select count(distinct agency_id)::int
             from public.agency_weekly_digest(now()-interval '400 days', now())
            where agency_name like 'ZZZ %') >= 3,
  'the weekly digest counts each agency separately, so no reader is shown the sum of four');

-- ===========================================================================
-- RULE 1, THROUGH THE DEFINER FUNCTIONS, which have no policy in front of them
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"90000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.agreement_for_agency('90000000-0000-0000-0000-0000000000a3')), 0,
  'a Manager cannot read another agency''s commercial agreement');
-- deed_target used to answer this caller with an empty set. It now refuses to
-- be called at all: 20261006330000 revoked it from public, anon and
-- authenticated, because the only caller is pandadoc.ts holding service_role.
-- Zero rows and "you may not ask" are both correct answers, and the second is
-- the better one: a function that answers nothing is one grant away from
-- answering something. Asserted as the refusal it now is, not relaxed.
select throws_ok(
  $$select public.deed_target('90000000-0000-0000-0000-00000000e003')$$,
  '42501', null,
  'nor another agency''s deed target: the browser may not call it at all');
-- Same again, and this one is worth keeping for what it used to catch:
-- tenancy_tenant_names was gated only on its tenancy CTE, and the solo branch
-- of its CASE read applications unguarded, so the names came back for an
-- agency the caller could not reach. That is fixed, AND the function is
-- service_role only now. Both facts are asserted, because a later grant would
-- silently undo this line and nothing else would notice.
select throws_ok(
  $$select public.tenancy_tenant_names('90000000-0000-0000-0000-00000000e003')$$,
  '42501', null,
  'nor those tenant names one level down, where the first gate missed a branch');
select is((select count(*)::int from public.application_commission_rates()
            a join public.applications ap on ap.id = a.application_id
            where ap.agency_id <> '90000000-0000-0000-0000-0000000000a1'), 0,
  'nor any other agency''s per-application commission rates');
select throws_ok(
  $$select public.admin_add_branch('90000000-0000-0000-0000-0000000000a3','ZZZ Intruder',null,'x@x.test','X','07700900000')$$,
  '42501', null, 'nor add a branch to another agency');
select throws_ok(
  $$select public.set_agency_group('90000000-0000-0000-0000-0000000000a3', null)$$,
  '42501', null, 'nor move another agency out of its group');
select throws_ok(
  $$select public.attach_user_to_agency('90000000-0000-0000-0000-00000000c005','90000000-0000-0000-0000-0000000000a3')$$,
  '42501', null, 'nor attach somebody to another agency');
select throws_ok(
  $$select public.set_referrer_leaderboard_mode('opndoor-agents','private')$$,
  '42501', null, 'nor set how every agency on the house route ranks its people');
-- MATCHES NOTHING, rather than raising. users_mgmt_update excludes the row, so
-- the UPDATE finds nothing to update and returns quietly. That is the stronger
-- outcome and the assertion has to say which it is: the next line proves the
-- row is not even visible.
select lives_ok(
  $$update public.users set full_name = 'Renamed' where id = '90000000-0000-0000-0000-00000000c006'$$,
  'and a write to a supplier''s user raises nothing, because it matches nothing');
select is((select full_name from public.users where id = '90000000-0000-0000-0000-00000000c006'), null,
  'because they cannot even see that row');

/* ===========================================================================
   AND THE STATEMENT REFERENCE, WHICH HAS JUST BEEN LOOSENED.
   ===========================================================================
   20261006740000 lets the monthly cron through commission_statement_ref,
   because until then the gate refused the only caller that ever runs it and
   no statement had ever been sent. A loosening is exactly where a hole gets
   made, so the three refusals that have to survive it are asserted here
   rather than left implied. All three held before that migration and hold
   after; they are here to fail if the new arm is ever widened.

   The arm added is `auth.uid() is null and the verified JWT role is
   service_role`. Both halves matter: a signed-in caller always has a uid, so
   no browser session can reach it however the key is spelled. */

-- A DIRECTOR MAY NOT READ A PARTY THEY DO NOT HOLD. c001 holds the Alpha
-- group; Beta is a different agency on the same house partner, which is
-- precisely the case where partner_id is a route and not a boundary.
select set_config('request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.commission_statement_ref('2026-11','opndoor-agents|agency:90000000-0000-0000-0000-0000000000a3')$$,
  '42501', null,
  'a Director still cannot mint a statement reference for another agency on the same partner');

-- A MANAGER IS NOT A DIRECTOR. c002 holds Alpha North, the very agency in the
-- key, and still may not: rule 3, commercial terms are Director-level, and
-- the test is the capability rather than the role.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.commission_statement_ref('2026-11','opndoor-agents|agency:90000000-0000-0000-0000-0000000000a1')$$,
  '42501', null,
  'and a Manager without sees_commission cannot, even for their OWN agency');

-- AND THE NEW ARM IS NOT REACHABLE BY CLAIMING TO BE THE CRON. A signed-in
-- caller has a uid, so the `auth.uid() is null` half refuses them whatever
-- the role claim says.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-00000000c002","role":"service_role","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.commission_statement_ref('2026-11','opndoor-agents|agency:90000000-0000-0000-0000-0000000000a3')$$,
  '42501', null,
  'and a signed-in caller cannot reach the cron arm by carrying a service_role claim');

reset role;

select * from finish();
rollback;
