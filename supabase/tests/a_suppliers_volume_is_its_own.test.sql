-- A SUPPLIER'S NEGOTIATED VOLUME IS ITS OWN.
--
-- Round 6, M13, found while fixing M3 and M5 rather than by a reviewer.
--
-- `agreement_volume` counts the applications that decide which band of a
-- negotiated agreement a party is in. Round 5's H5 added a rail test to stop a
-- matched DIRECT tenant pushing an agency into a better band, and wrote it as
-- an inclusion:
--
--     and public.application_channel(ap.id) = 'Agent referral'
--
-- which is the same mistake `agency_weekly_digest` made and 20261006580000
-- corrected: there are THREE rails, so including one excludes two. A SUPPLIER
-- with a negotiated agreement therefore counts zero applications forever, its
-- tier never advances, and it is charged the worst band of a deal it has
-- already outgrown. Nobody would see it: the count is simply always 0.
--
-- ASSERTION 1 FAILS against the code before 20261006590000 (the supplier's own
-- paid business counts 0). Assertions 2 and 3 are round 5's H5, unchanged, so
-- that the fix cannot be a regression of it.

begin;
select plan(8);

-- ===========================================================================
-- A SUPPLIER WITH A NEGOTIATED AGREEMENT, AND AN AGENCY WITH ONE
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('93000000-0000-0000-0000-0000000000f1','zzz-vol-supplier','ZZZ Volume Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

insert into public.agencies (id, partner_id, name) values
  ('93000000-0000-0000-0000-0000000000f2','93000000-0000-0000-0000-0000000000f1','ZZZ Volume Supplier Agency'),
  ('93000000-0000-0000-0000-0000000000f3',(select id from public.partners where slug='opndoor-agents'),'ZZZ Volume Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('93000000-0000-0000-0000-0000000000f4','93000000-0000-0000-0000-0000000000f2','93000000-0000-0000-0000-0000000000f1','ZZZ Volume Supplier Office'),
  ('93000000-0000-0000-0000-0000000000f5','93000000-0000-0000-0000-0000000000f3',(select id from public.partners where slug='opndoor-agents'),'ZZZ Volume Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('93000000-0000-0000-0000-00000000d001'::uuid,'zzz.vol.supref@v.test'),
  ('93000000-0000-0000-0000-00000000d002'::uuid,'zzz.vol.neg@v.test'),
  ('93000000-0000-0000-0000-0000000000da'::uuid,'zzz.vol.tenant@v.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('93000000-0000-0000-0000-00000000d001','ZZZ Vol Sup Ref','zzz.vol.supref@v.test','referrer','93000000-0000-0000-0000-0000000000f1','active',false,null),
  ('93000000-0000-0000-0000-00000000d002','ZZZ Vol Neg','zzz.vol.neg@v.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'93000000-0000-0000-0000-0000000000f5');
insert into public.user_scopes (user_id, kind, branch_id) values
  ('93000000-0000-0000-0000-00000000d002','branch','93000000-0000-0000-0000-0000000000f5');

insert into public.applicants (id, email, first_name, last_name)
values ('93000000-0000-0000-0000-0000000000da','zzz.vol.tenant@v.test','Della','Direct');

-- One agreement per party, counted at AGENCY scope.
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from)
values
  ('93000000-0000-0000-0000-0000000000e1','agency','93000000-0000-0000-0000-0000000000f2','additive','year','agency',false, current_date - 30),
  ('93000000-0000-0000-0000-0000000000e2','agency','93000000-0000-0000-0000-0000000000f3','additive','year','agency',false, current_date - 30);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  -- The SUPPLIER's own paid referral. Its whole negotiated deal turns on this
  -- being counted.
  ('93000000-0000-0000-0000-00000000c001','ZZZ-VOL-SU','93000000-0000-0000-0000-0000000000f1',
   '93000000-0000-0000-0000-0000000000f2','93000000-0000-0000-0000-0000000000f4','93000000-0000-0000-0000-00000000d001','ZZZ Vol Sup Ref',null,
   'Mx','Sam','Supplier','1990-01-01','sam@v.test','07700900091','1 Vol Street','London','VL1 1AA',1000,current_date+30,'paid',true,0.25,0.10,'pre_referenced_open',now()-interval '5 days',now()-interval '4 days'),
  -- The AGENCY's own paid referral.
  ('93000000-0000-0000-0000-00000000c002','ZZZ-VOL-AG',(select id from public.partners where slug='opndoor-agents'),
   '93000000-0000-0000-0000-0000000000f3','93000000-0000-0000-0000-0000000000f5','93000000-0000-0000-0000-00000000d002','ZZZ Vol Neg',null,
   'Mx','Ann','Agency','1990-01-01','ann@v.test','07700900092','2 Vol Street','London','VL2 2AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',now()-interval '5 days',now()-interval '4 days'),
  -- A DIRECT tenant the matcher pointed at the agency's branch. Round 5's H5.
  ('93000000-0000-0000-0000-00000000c003','ZZZ-VOL-DI',(select id from public.partners where slug='opndoor-direct'),
   '93000000-0000-0000-0000-0000000000f3','93000000-0000-0000-0000-0000000000f5',null,'Direct','93000000-0000-0000-0000-0000000000da',
   'Mx','Della','Direct','1990-01-01','zzz.vol.tenant@v.test','07700900093','3 Vol Street','London','VL3 3AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',now()-interval '5 days',now()-interval '4 days');

-- ===========================================================================
-- THE FINDING
-- ===========================================================================
select is(
  public.agreement_volume('93000000-0000-0000-0000-0000000000e1','93000000-0000-0000-0000-0000000000f4','93000000-0000-0000-0000-0000000000f1'), 1,
  'a supplier''s own paid referral counts toward its own negotiated volume');

-- ===========================================================================
-- AND ROUND 5's H5, UNCHANGED
-- ===========================================================================
select is(
  public.agreement_volume('93000000-0000-0000-0000-0000000000e2','93000000-0000-0000-0000-0000000000f5',(select id from public.partners where slug='opndoor-agents')), 1,
  'while the agency counts its own referral and NOT the direct tenant at the same branch');

-- Said the other way, so the number above cannot be right by accident: three
-- paid applications exist at these two branches, and the two agreements see
-- one each.
select is(
  (select count(*)::int from public.applications
    where guarantee_ref in ('ZZZ-VOL-SU','ZZZ-VOL-AG','ZZZ-VOL-DI') and paid_at is not null), 3,
  'there really are three paid applications in play');

-- AND THE EXCLUSION HOLDS ON THE SUPPLIER SIDE TOO, which is the half the
-- inclusion form could never express: a direct tenant matched to a SUPPLIER's
-- branch must not advance that supplier's band either.
--
-- (Not asserted: that passing a mismatched agreement and branch returns 0.
-- agreement_volume derives its counting context from p_branch and uses the
-- agreement only for its period and scope LEVEL, so a mismatched pair is
-- meaningless rather than wrong. Callers always pass a matching pair. Saying
-- so here so the absence is a decision and not an oversight.)
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  ('93000000-0000-0000-0000-00000000c004','ZZZ-VOL-SUDI',(select id from public.partners where slug='opndoor-direct'),
   '93000000-0000-0000-0000-0000000000f2','93000000-0000-0000-0000-0000000000f4',null,'Direct','93000000-0000-0000-0000-0000000000da',
   'Mx','Della','Direct','1990-01-01','zzz.vol.tenant@v.test','07700900094','4 Vol Street','London','VL4 4AA',1000,current_date+30,'paid',true,0.25,0.10,'opndoor_referenced',now()-interval '5 days',now()-interval '4 days');

select is(
  public.agreement_volume('93000000-0000-0000-0000-0000000000e1','93000000-0000-0000-0000-0000000000f4','93000000-0000-0000-0000-0000000000f1'), 1,
  'and a direct tenant matched to the SUPPLIER''s branch does not advance its band either');

-- ===========================================================================
-- AND A COUNTER BELONGS TO A ROUTE. Q-05 amendments 3 and 4, settled by
-- Matt's ruling of 2026-08-17: "an agency exists once and is never duplicated
-- per supplier, so an agency under two suppliers is ONE party shown with TWO
-- counters."
--
-- The same agency, ZZZ Volume Agency, now transacts on a second route: a
-- referral at its own branch that came down the supplier's route instead of
-- the house one. applications.partner_id is the route, stated at creation --
-- sync_application_partner only derives it when the caller is silent -- so
-- this needs no new tables and no duplicate agency row.
--
-- Before 20261006750000 the count was route-blind, so both routes returned 2
-- and volume bought through the supplier paid for a better band on the house
-- route, and the other way round.
-- ===========================================================================
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  ('93000000-0000-0000-0000-00000000c005','ZZZ-VOL-X2','93000000-0000-0000-0000-0000000000f1',
   '93000000-0000-0000-0000-0000000000f3','93000000-0000-0000-0000-0000000000f5',
   '93000000-0000-0000-0000-00000000d001','ZZZ Vol Sup Ref',null,
   'Mx','Cross','Route','1990-01-01','zzz.vol.cross@v.test','07700900095','5 Vol Street','London','VL5 5AA',
   1000,current_date+30,'paid',true,0.25,0.10,'pre_referenced_open',now()-interval '5 days',now()-interval '4 days');

select is(
  public.agreement_volume('93000000-0000-0000-0000-0000000000e2','93000000-0000-0000-0000-0000000000f5',
                          (select id from public.partners where slug='opndoor-agents')), 1,
  'an agency on two routes counts only the house route''s business against the house route');

select is(
  public.agreement_volume('93000000-0000-0000-0000-0000000000e2','93000000-0000-0000-0000-0000000000f5',
                          '93000000-0000-0000-0000-0000000000f1'), 1,
  'and only the supplier route''s against the supplier route: one party, two counters, not one pooled total');

select is(
  (select count(*)::int from public.applications
    where agency_id = '93000000-0000-0000-0000-0000000000f3' and paid_at is not null
      and public.application_channel(id) <> 'Direct'), 2,
  'and the two really are two, so neither count above is 1 by accident');

-- THE FOURTH SCOPE. A supplier counting its whole book: every route-partner
-- application, whichever agency under it. Two here -- its own agency's, and
-- the one it introduced at ZZZ Volume Agency -- where the agency-scoped
-- reading of the same route sees only one.
insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from)
values ('93000000-0000-0000-0000-0000000000e3','partner','93000000-0000-0000-0000-0000000000f1',
        'additive','year','route',false, current_date - 30);

select is(
  public.agreement_volume('93000000-0000-0000-0000-0000000000e3','93000000-0000-0000-0000-0000000000f4',
                          '93000000-0000-0000-0000-0000000000f1'), 2,
  'while a route-scoped agreement counts the supplier''s whole book across every agency under it');

select * from finish();
rollback;
