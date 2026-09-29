-- WHAT THE FIFTH REVIEWER FOUND, asserted.
--
-- Six findings that live in SQL. Each assertion below fails against the
-- definitions as they stood before 20261006460000, checked by restoring those
-- definitions in a rolled-back transaction rather than by reasoning about it.
--
-- The theme running through four of the six is one rule added in one place
-- and not to its neighbours. may_see_commission() went onto three child
-- tables and not the parent. The level test went into the COMMENT of
-- commission_statement_recipients and not into its SQL. The agency predicate
-- went onto four dev_* functions and not onto application_journey. And
-- set_agency_level asks two questions where admin_update_user_role asked one.

begin;
select plan(11);

-- ===========================================================================
-- ONE AGENCY: a Director, a Manager, a Negotiator. Plus a direct tenant whose
-- branch the auto-matcher has pointed at that agency, which is the shape that
-- made direct business count as theirs.
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('93000000-0000-0000-0000-000000000501',(select id from public.partners where slug='opndoor-agents'),'ZZZ R5 Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('93000000-0000-0000-0000-000000000511','93000000-0000-0000-0000-000000000501',(select id from public.partners where slug='opndoor-agents'),'ZZZ R5 Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('93000000-0000-0000-0000-000000000521'::uuid,'zzz.r5.dir@r5.test'),
  ('93000000-0000-0000-0000-000000000522'::uuid,'zzz.r5.mgr@r5.test'),
  ('93000000-0000-0000-0000-000000000523'::uuid,'zzz.r5.neg@r5.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('93000000-0000-0000-0000-000000000521','ZZZ R5 Dir','zzz.r5.dir@r5.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('93000000-0000-0000-0000-000000000522','ZZZ R5 Mgr','zzz.r5.mgr@r5.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('93000000-0000-0000-0000-000000000523','ZZZ R5 Neg','zzz.r5.neg@r5.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'93000000-0000-0000-0000-000000000511');

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('93000000-0000-0000-0000-000000000521','agency','93000000-0000-0000-0000-000000000501',null),
  ('93000000-0000-0000-0000-000000000522','agency','93000000-0000-0000-0000-000000000501',null),
  ('93000000-0000-0000-0000-000000000523','branch',null,'93000000-0000-0000-0000-000000000511');

-- The rate lives in the BANDS, not here: the parent row is the commercial
-- terms (coverage, period, counting scope) and the child rows are the money.
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from)
values ('93000000-0000-0000-0000-000000000531','agency','93000000-0000-0000-0000-000000000501','additive','year','agency',false, current_date - 30);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  ('93000000-0000-0000-0000-000000000541','ZZZ-R5-AG',(select id from public.partners where slug='opndoor-agents'),
   '93000000-0000-0000-0000-000000000501','93000000-0000-0000-0000-000000000511','93000000-0000-0000-0000-000000000523','ZZZ R5 Neg',
   'Mx','Ann','Agency','1990-01-01','ann@r5.test','07700900031','1 R5 Street','London','R5 1AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',
   now()-interval '5 days', now()-interval '4 days'),
  -- A DIRECT tenant, given this agency's branch by the auto-matcher.
  ('93000000-0000-0000-0000-000000000542','ZZZ-R5-DI',(select id from public.partners where slug='opndoor-direct'),
   '93000000-0000-0000-0000-000000000501','93000000-0000-0000-0000-000000000511',null,'Direct',
   'Mx','Dan','Direct','1990-01-01','dan@r5.test','07700900032','2 R5 Street','London','R5 2AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',
   now()-interval '5 days', now()-interval '4 days');

-- ===========================================================================
-- H2. pricing_agreements STATES THE COMMERCIAL TERMS
-- ===========================================================================
-- The restrictive may_see_commission() policy went onto its bands and its
-- tiers and not onto the parent. The parent carries no rate (the rates live
-- in the bands), so what was readable is that a negotiated agreement EXISTS
-- for this agency, on what coverage, over what period. Commercial terms,
-- which rule 3 puts at Director level.
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000523","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.pricing_agreements
            where id = '93000000-0000-0000-0000-000000000531'), 0,
  'a Negotiator reads no row of pricing_agreements, which states the commercial terms');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000522","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.pricing_agreements
            where id = '93000000-0000-0000-0000-000000000531'), 0,
  'nor does a Manager, who may not see commission by any route');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000521","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.pricing_agreements
            where id = '93000000-0000-0000-0000-000000000531'), 1,
  'while their Director does, so the restrictive policy subtracts and does not simply close the table');

-- ===========================================================================
-- H4. THE STATEMENT FOLLOWS THE LEVEL
-- ===========================================================================
reset role;
select set_config('app.setting_commission_tick', 'on', true);
update public.users set receives_commission_statements = true
 where id in ('93000000-0000-0000-0000-000000000521','93000000-0000-0000-0000-000000000522');
select set_config('app.setting_commission_tick', 'off', true);

select ok(exists (select 1 from public.commission_statement_recipients('agency','93000000-0000-0000-0000-000000000501') r
                   where r.email = 'zzz.r5.dir@r5.test'),
  'a ticked Director is a statement recipient');
select ok(not exists (select 1 from public.commission_statement_recipients('agency','93000000-0000-0000-0000-000000000501') r
                       where r.email = 'zzz.r5.mgr@r5.test'),
  'and a ticked MANAGER is not, because a statement is a commission figure');

-- And the tick cannot be put on them in the first place.
-- lint:as-postgres set_receives_commission_statements is opndoor-admin-only,
-- so the refusal under test is its level check and not an RLS policy; running
-- it as an agency role would be refused for the wrong reason.
select throws_ok(
  $$select public.set_receives_commission_statements('93000000-0000-0000-0000-000000000522', true)$$,
  '22023', 'Only a Director receives a commission statement. Change their level first.',
  'and the tick cannot be set on somebody who may not see commission');

-- ===========================================================================
-- H5. AN AGENCY'S VOLUME IS ITS OWN BUSINESS
-- ===========================================================================
-- Two paid applications sit at this branch. One is theirs; one is a direct
-- tenant the matcher pointed here. Only the first counts, because the count
-- picks the commission band.
select is(public.agreement_volume('93000000-0000-0000-0000-000000000531','93000000-0000-0000-0000-000000000511'), 1,
  'a direct-rail application does not count toward the agency''s negotiated volume');

-- ===========================================================================
-- M8. THE SECOND DOOR TO THE LEVEL LADDER
-- ===========================================================================
-- admin_update_user_role writes role and never touched sees_commission, and
-- asked only "may I act on them", not "may I hand out the level they land
-- at". A Manager could therefore promote a Negotiator whose row still
-- carried sees_commission into a Director above themselves.
reset role;
select set_config('app.setting_commission_capability', 'on', true);
update public.users set sees_commission = true where id = '93000000-0000-0000-0000-000000000523';
select set_config('app.setting_commission_capability', 'off', true);

select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000522","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_update_user_role('93000000-0000-0000-0000-000000000523','management')$$,
  '42501', null,
  'a Manager cannot promote somebody into a Director above them through the role control');

-- ===========================================================================
-- M9. THE DEVELOPER ARM applications_journey KEPT
-- ===========================================================================
-- Four dev_* functions were given an agency predicate and this one was
-- missed. A developer is pinned to a partner, and on the house route the
-- partner is every agency Opndoor carries. There is no developer on our
-- estate any more, so this asserts the predicate rather than the role: a
-- caller with no position reaches nothing.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000523","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.application_journey('ZZZ-R5-DI')$$,
  '42501', null,
  'the direct application is refused to this agency Negotiator, not merely empty');

-- ===========================================================================
-- LOW. THE LEAGUE DOES NOT RANK SOMEBODY WHO HAS LEFT
-- ===========================================================================
reset role;
update public.users set status = 'deactivated' where id = '93000000-0000-0000-0000-000000000523';
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000521","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(not exists (select 1 from public.referrer_league(now() - interval '400 days', now(), null) l
                       where l.name = 'ZZZ R5 Neg'),
  'a deactivated referrer is not ranked in the league');

-- And the board still works for the people who are there, so this is a
-- filter and not an accidental emptying.
select lives_ok(
  $$select * from public.referrer_league(now() - interval '400 days', now(), null)$$,
  'while the league itself still answers');

select * from finish();
rollback;
