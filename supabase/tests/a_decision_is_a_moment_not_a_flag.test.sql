-- NOT IN NETWORK: A DECISION IS A MOMENT, NOT A FLAG.
--
-- Matt, 2026-09-30, verbatim: "Reconciliation, Not in network: give each
-- agency two actions, each with a confirmation box: 'Added to HubSpot'
-- (marks it done, records who and when, and removes it from the list) and
-- 'Ignore' (removes it, recorded). If the same agency is named again later
-- by another tenant, it reappears."
--
-- THE LAST SENTENCE IS WHAT THIS FILE IS FOR. Everything else here would
-- pass against a `handled boolean` on the agency name: the row goes, the
-- action is recorded, both buttons work. What a flag cannot do is come
-- back, and coming back is the case that matters -- a second tenant naming
-- the same agency is new evidence that we should be working with them, and
-- it is exactly what a done tick would hide.
--
-- SO THE ORDER OF THE ASSERTIONS IS THE ARGUMENT: the row leaves, and then
-- a LATER naming brings it back, and then an EARLIER one does not. The
-- third is what stops "it reappears" being implemented as "it never
-- really goes".

begin;
select plan(13);

insert into public.partners (id, slug, name, status, is_house_route)
values ('e9000000-0000-0000-0000-0000000000f1','zzz-nin-direct','ZZZ NIN Route','active',true)
on conflict (id) do nothing;

insert into public.agencies (id, partner_id, name)
values ('e9000000-0000-0000-0000-0000000000a9','e9000000-0000-0000-0000-0000000000f1','ZZZ NIN Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('e9000000-0000-0000-0000-0000000000b9','e9000000-0000-0000-0000-0000000000a9',
        'e9000000-0000-0000-0000-0000000000f1','ZZZ NIN Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e9000000-0000-0000-0000-00000000c001'::uuid,'zzz.nin.admin@o.test'),
  ('e9000000-0000-0000-0000-00000000c002'::uuid,'zzz.nin.mgmt@a.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e9000000-0000-0000-0000-00000000c001','ZZZ NIN Admin','zzz.nin.admin@o.test','superadmin',null,'active',true),
  ('e9000000-0000-0000-0000-00000000c002','ZZZ NIN Mgmt','zzz.nin.mgmt@a.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true);

/* TWO DIRECT TENANTS WHO BOTH NAMED THE SAME AGENCY WE DO NOT WORK WITH,
   a fortnight apart. The second is the one the whole rule is about. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, tenancy_start, referencing_mode, partner_rate, agent_rate,
   status, sent_at, livemode)
select x.id, x.ref, 'e9000000-0000-0000-0000-0000000000f1',
       'e9000000-0000-0000-0000-0000000000a9','e9000000-0000-0000-0000-0000000000b9',
       'Mx', x.first, 'Tenant', '1990-01-01', x.first || '@zzz.test', '07700900000',
       '1 ZZZ Street','London','SW1A 1AA',
       1500, '2026-07-01', 'opndoor_referenced', 0, 0,
       'sent', x.sent, true
from (values
  ('e9000000-0000-0000-0000-0000000000d1'::uuid,'ZZZ-NIN-1','Ana','2026-05-01T09:00:00Z'::timestamptz),
  ('e9000000-0000-0000-0000-0000000000d2'::uuid,'ZZZ-NIN-2','Bo', '2026-05-15T09:00:00Z'::timestamptz)
) as x(id, ref, first, sent);

insert into public.application_agency_match
  (application_id, typed_name, typed_name_key, state, created_at)
values
  ('e9000000-0000-0000-0000-0000000000d1','Foxglove Lettings','foxglove lettings','dismissed','2026-05-01T10:00:00Z'),
  ('e9000000-0000-0000-0000-0000000000d2','Foxglove Lettings','foxglove lettings','dismissed','2026-05-15T10:00:00Z');

-- ===========================================================================
-- 1. IT IS ON THE LIST, ONCE, WITH BOTH TENANTS COUNTED
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select tenants from public.not_in_network_agencies() where name_key = 'foxglove lettings'),
  2, 'both tenants who named the agency are counted on one row');

-- ===========================================================================
-- 2. AND NOBODY BUT OPNDOOR MAY ACT ON IT
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.decide_not_in_network('foxglove lettings','ignored',null)$$,
  '42501', null,
  'an agency Director may not decide what happens to another agency''s name');

select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.decide_not_in_network('foxglove lettings','maybe',null)$$,
  '22023', null, 'and a decision is either added or ignored, not anything else');

-- ===========================================================================
-- 3. ADDED TO HUBSPOT TAKES IT OFF, AND RECORDS WHO AND WHEN
-- ===========================================================================
select lives_ok(
  $$select public.decide_not_in_network('foxglove lettings','added','Foxglove Lettings')$$,
  'an Opndoor admin marks it added to HubSpot');

select is_empty(
  $$select 1 from public.not_in_network_agencies() where name_key = 'foxglove lettings'$$,
  'and it leaves the list');

reset role;
/* THE LATEST DECISION, not "the" decision. A name can be decided more
   than once over its life -- that is the whole design -- so a bare
   scalar subquery here would error the moment a second one exists, and
   an ERROR is a worse failure than an assertion: it stops the file and
   reports nothing about the rules below it. Found by the mutation
   check, where removing the permission guard let an agency Director's
   refused call succeed and left two rows. */
select is(
  (select decided_by from public.not_in_network_decisions
    where name_key = 'foxglove lettings' order by decided_at desc, id desc limit 1),
  'e9000000-0000-0000-0000-00000000c001'::uuid,
  'recorded against who decided it');

select ok(
  (select decided_at from public.not_in_network_decisions
    where name_key = 'foxglove lettings' order by decided_at desc, id desc limit 1) is not null,
  'and when');

select ok(
  exists (select 1 from public.org_audit
           where action = 'not_in_network_added'
             and detail like 'Foxglove Lettings%'),
  'and it is in the audit trail by name, because there is no agency row to point at');

-- ===========================================================================
-- 4. AND A LATER TENANT BRINGS IT BACK. THE WHOLE RULE.
-- ===========================================================================
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, tenancy_start, referencing_mode, partner_rate, agent_rate,
   status, sent_at, livemode)
values
  ('e9000000-0000-0000-0000-0000000000d3','ZZZ-NIN-3','e9000000-0000-0000-0000-0000000000f1',
   'e9000000-0000-0000-0000-0000000000a9','e9000000-0000-0000-0000-0000000000b9',
   'Mx','Cass','Tenant','1990-01-01','cass@zzz.test','07700900000',
   '3 ZZZ Street','London','SW1A 1AA',
   1500,'2026-08-01','opndoor_referenced',0,0,
   'sent', now(), true);

/* LATER THAN THE DECISION, AND SAID IN MINUTES RATHER THAN `now()`.
   `now()` is the TRANSACTION timestamp and is constant for the whole of
   this file, so a naming stamped `now()` is SIMULTANEOUS with a decision
   the RPC also stamped `now()` -- and the rule is "named again LATER",
   which `>` correctly refuses. Written this way the fixture tests
   laterness, which is what Matt asked for, instead of testing a tie and
   calling the right answer a failure. */
insert into public.application_agency_match
  (application_id, typed_name, typed_name_key, state, created_at)
values ('e9000000-0000-0000-0000-0000000000d3','Foxglove Lettings','foxglove lettings','dismissed',
        now() + interval '1 minute');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select tenants from public.not_in_network_agencies() where name_key = 'foxglove lettings'),
  3, 'a third tenant names them and the agency is back, with its whole history rather than as a new row');

-- ===========================================================================
-- 5. AND AN EARLIER NAMING DOES NOT, which is what stops "it reappears"
--    meaning "it never really goes".
-- ===========================================================================
/* ITS OWN AGENCY, and that is not tidiness. Every decision in this file
   is stamped by the RPC with `now()`, which in Postgres is the
   TRANSACTION timestamp and is therefore the same instant for all of
   them. So a second decision about Foxglove could never be later than
   the naming that brought it back, and reusing it here would test
   nothing but that arithmetic. Bramble has one naming, in April, and
   one decision after it. */
reset role;
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, tenancy_start, referencing_mode, partner_rate, agent_rate,
   status, sent_at, livemode)
values
  ('e9000000-0000-0000-0000-0000000000d4','ZZZ-NIN-4','e9000000-0000-0000-0000-0000000000f1',
   'e9000000-0000-0000-0000-0000000000a9','e9000000-0000-0000-0000-0000000000b9',
   'Mx','Dee','Tenant','1990-01-01','dee@zzz.test','07700900000',
   '4 ZZZ Street','London','SW1A 1AA',
   1500,'2026-08-01','opndoor_referenced',0,0,
   'sent','2026-04-01T09:00:00Z', true);
insert into public.application_agency_match
  (application_id, typed_name, typed_name_key, state, created_at)
values ('e9000000-0000-0000-0000-0000000000d4','Bramble & Co','bramble & co','dismissed','2026-04-01T10:00:00Z');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select isnt_empty(
  $$select 1 from public.not_in_network_agencies() where name_key = 'bramble & co'$$,
  'a second agency is on the list too');

select lives_ok(
  $$select public.decide_not_in_network('bramble & co','ignored','Bramble & Co')$$,
  'ignoring one takes it off, the same as adding one does');

select is_empty(
  $$select 1 from public.not_in_network_agencies() where name_key = 'bramble & co'$$,
  'and it is gone');

/* THE ONE THAT STOPS "it reappears" MEANING "it never really goes": a
   tenant who named them BEFORE the decision is not new evidence, and
   must not bring the row back. */
reset role;
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, tenancy_start, referencing_mode, partner_rate, agent_rate,
   status, sent_at, livemode)
values
  ('e9000000-0000-0000-0000-0000000000d5','ZZZ-NIN-5','e9000000-0000-0000-0000-0000000000f1',
   'e9000000-0000-0000-0000-0000000000a9','e9000000-0000-0000-0000-0000000000b9',
   'Mx','Eve','Tenant','1990-01-01','eve@zzz.test','07700900000',
   '5 ZZZ Street','London','SW1A 1AA',
   1500,'2026-08-01','opndoor_referenced',0,0,
   'sent','2026-03-01T09:00:00Z', true);
insert into public.application_agency_match
  (application_id, typed_name, typed_name_key, state, created_at)
values ('e9000000-0000-0000-0000-0000000000d5','Bramble & Co','bramble & co','dismissed','2026-03-01T10:00:00Z');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select is_empty(
  $$select 1 from public.not_in_network_agencies() where name_key = 'bramble & co'$$,
  'while a tenant who named them BEFORE the decision does not bring it back');

select * from finish();
rollback;
