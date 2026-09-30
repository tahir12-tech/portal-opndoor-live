-- EVERY BROWSER RPC IS POINTED AT SOMEBODY ELSE'S OBJECT.
--
-- definer_grants.test.sql asserts WHO may call each SECURITY DEFINER
-- function. That is only half the guarantee: being callable is not the same
-- as being guarded, and a definer function runs as its owner with RLS
-- switched off inside it, so the check it makes for itself is the whole
-- boundary.
--
-- So this file takes the allowlisted functions that the agency rail actually
-- uses, and calls each one AS ONE AGENCY'S DIRECTOR, AGAINST THE OTHER
-- AGENCY'S OBJECT. Both agencies are on the same house partner, which is the
-- only arrangement in which any of this is visible: `partner_id =
-- app_partner()` is true for both of them.
--
-- The acceptable answers are a refusal or an empty result. A row is a
-- finding. The assertions are written to accept either, because some of
-- these narrow with a predicate and some raise, and which one a given
-- function chose is not the property worth locking down.
--
-- WHAT IS NOT HERE, said plainly rather than left to be noticed: the twenty
-- dev-centre RPCs (dev_api_*, dev_webhook_*, dev_sandbox_*) and the handful
-- of opndoor-admin globals (set_app_setting_num, update_partner_settings,
-- admin_break_glass_revoke_key, trigger_crm_sync). They are supplier-rail
-- developer tooling and admin tooling; 20261006270000 already refuses an API
-- key and a webhook endpoint on the house route, and invite-user refuses to
-- create a developer there at all. They are listed as uncovered in
-- definerAllowlistCoverage.test.ts rather than quietly omitted.

begin;
select plan(44);

-- ===========================================================================
-- OURS AND THEIRS, one house partner.
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Reach Ours'),
  ('97000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Reach Theirs');
insert into public.agency_groups (id, partner_id, name) values
  ('97000000-0000-0000-0000-00000000ab02',(select id from public.partners where slug='opndoor-agents'),'ZZZ Reach Theirs Group');
insert into public.branches (id, agency_id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Reach Ours Office'),
  ('97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Reach Theirs Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values ('97000000-0000-0000-0000-00000000c001'::uuid,'zzz.reach.ourdir@r.test'),
             ('97000000-0000-0000-0000-00000000c002'::uuid,'zzz.reach.theirdir@r.test'),
             ('97000000-0000-0000-0000-00000000c003'::uuid,'zzz.reach.theirneg@r.test')) as x(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('97000000-0000-0000-0000-00000000c001','ZZZ Reach Our Dir','zzz.reach.ourdir@r.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('97000000-0000-0000-0000-00000000c002','ZZZ Reach Their Dir','zzz.reach.theirdir@r.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('97000000-0000-0000-0000-00000000c003','ZZZ Reach Their Neg','zzz.reach.theirneg@r.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'97000000-0000-0000-0000-0000000000b2');
insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('97000000-0000-0000-0000-00000000c001','agency','97000000-0000-0000-0000-0000000000a1',null),
  ('97000000-0000-0000-0000-00000000c002','agency','97000000-0000-0000-0000-0000000000a2',null),
  ('97000000-0000-0000-0000-00000000c003','branch',null,'97000000-0000-0000-0000-0000000000b2');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values ('97000000-0000-0000-0000-00000000e002','ZZZ-REACH-THEIRS',(select id from public.partners where slug='opndoor-agents'),
   '97000000-0000-0000-0000-0000000000a2','97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-00000000c003','ZZZ Reach Their Neg',
   'Mx','Ben','Theirs','1990-01-01','ben.reach@r.test','07700900002','2 Theirs Street','London','TH1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now());

insert into public.agent_contacts (id, agency_id, partner_id, name, email, is_primary)
values ('97000000-0000-0000-0000-00000000f002','97000000-0000-0000-0000-0000000000a2',
        (select id from public.partners where slug='opndoor-agents'),'ZZZ Reach Theirs Desk','theirsdesk@r.test',true);

-- ===========================================================================
-- AS OUR DIRECTOR, POINTED AT THEIRS
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ---- the predicates themselves, which everything above is built on --------
-- These are the only definer functions deliberately left callable that are
-- not RPCs, so they get asserted directly rather than through a caller.
select ok(not public.app_may_reach_agency('97000000-0000-0000-0000-0000000000a2'),
  'app_may_reach_agency says no to the other agency');
select ok(public.app_may_reach_agency('97000000-0000-0000-0000-0000000000a1'),
  'and yes to their own, so it is not simply answering false');
select ok(not public.app_may_reach_branch('97000000-0000-0000-0000-0000000000b2'),
  'app_may_reach_branch says no to the other agency''s office');
select ok(not public.app_may_reach_user('97000000-0000-0000-0000-00000000c002'),
  'app_may_reach_user says no to the other agency''s Director');
select ok(not public.app_may_reach_contact('97000000-0000-0000-0000-0000000000a2', null,
            (select id from public.partners where slug='opndoor-agents')),
  'app_may_reach_contact says no to a contact owned by the other agency');
select ok(not public.app_may_reach_application_org(
            (select id from public.partners where slug='opndoor-agents'),
            '97000000-0000-0000-0000-0000000000a2','97000000-0000-0000-0000-0000000000b2'),
  'app_may_reach_application_org says no, though the partner matches for both');
select ok(not public.app_reachable_agency('97000000-0000-0000-0000-0000000000a2'),
  'app_reachable_agency agrees');
select ok(not public.app_reachable_group('97000000-0000-0000-0000-00000000ab02',
            (select id from public.partners where slug='opndoor-agents')),
  'app_reachable_group says no to a group they hold no position over');
select ok(not public.user_within_caller_scope('97000000-0000-0000-0000-00000000c003'),
  'user_within_caller_scope says no to the other agency''s Negotiator');
-- may_act_on_user is a policy predicate now: user_scopes_delete calls it, so
-- authenticated must be able to execute it or Remove position raises
-- "permission denied for function" rather than refusing. Asserted in both
-- directions so neither the grant nor the rule can go quietly.
select ok(not public.may_act_on_user('97000000-0000-0000-0000-00000000c002'),
  'may_act_on_user says no to another agency''s Director');
select ok(public.may_act_on_user('97000000-0000-0000-0000-00000000c003') = false,
  'and no to their Negotiator, who is in another agency whatever their level');
select ok(not public.is_admin(), 'and an agency Director is not an admin, which the rest of this file assumes');

-- ---- reads on somebody else's application ---------------------------------
-- These three REFUSE rather than returning nothing, which is the stronger
-- answer; agent_rail_funnel narrows instead, which is the right shape for a
-- count. Both are acceptable and the difference is asserted as it is rather
-- than normalised, so a function that silently changes from one to the other
-- is visible here.
select throws_ok($$select * from public.application_journey('ZZZ-REACH-THEIRS')$$,
  '42501', null, 'application_journey refuses another agency''s guarantee');
select throws_ok($$select * from public.my_application_delivery('97000000-0000-0000-0000-00000000e002')$$,
  '42501', null, 'my_application_delivery will not name their deed recipient');
select throws_ok($$select public.staff_payment_page_token('ZZZ-REACH-THEIRS')$$,
  '42501', null, 'staff_payment_page_token mints no 90-day bearer token for their application');
select is((select invited from public.agent_rail_funnel(null)), 0,
  'agent_rail_funnel counts nothing of theirs');
select throws_ok($$select * from public.agency_match_queue()$$,
  '42501', null, 'and the agency match queue, which pairs typed names to real agencies, is admin-only');
-- NM-N. The list of agencies a direct tenant named that we do not work with.
-- Same two guards as the queue above it, so the same refusal for an agency
-- Director: the typed names and agent contacts on it are Opndoor's prospect
-- list across every direct signup, and none of it is theirs.
select throws_ok($$select * from public.not_in_network_agencies()$$,
  '42501', null, 'and the not-in-network prospect list, which is Opndoor''s own, is staff-only');

-- ---- writes on somebody else's application --------------------------------
select throws_ok($$select public.add_application_note('ZZZ-REACH-THEIRS','hello')$$,
  '42501', null, 'add_application_note cannot write a business note onto their application');
select throws_ok($$select public.mark_withdrawn('ZZZ-REACH-THEIRS','because','x')$$,
  '42501', null, 'mark_withdrawn cannot withdraw it');
select throws_ok($$select public.amend_tenancy_start('97000000-0000-0000-0000-00000000e002', current_date + 60)$$,
  '42501', null, 'amend_tenancy_start cannot move its tenancy date');
select throws_ok($$select public.decline_application('ZZZ-REACH-THEIRS','no')$$,
  '42501', null, 'decline_application cannot decline it');
select throws_ok($$select public.set_application_status('97000000-0000-0000-0000-00000000e002','paid')$$,
  '42501', null, 'set_application_status cannot advance it');
select throws_ok($$select public.send_deed_to_landlord('97000000-0000-0000-0000-00000000e002','L','l@r.test')$$,
  '42501', null, 'send_deed_to_landlord cannot overwrite its landlord and send');

-- ---- their org: contacts, deed recipients, rates, mode --------------------
select throws_ok($$select public.org_add_contact('97000000-0000-0000-0000-0000000000a2',null,'X','role','x@r.test','07700900000',true)$$,
  '42501', null, 'org_add_contact cannot add a contact to their agency');
select throws_ok($$select public.org_update_contact('97000000-0000-0000-0000-00000000f002','X','role','x@r.test','07700900000',true)$$,
  '42501', null, 'org_update_contact cannot rewrite the contact their deeds go to');
select throws_ok($$select public.org_remove_contact('97000000-0000-0000-0000-00000000f002')$$,
  '42501', null, 'org_remove_contact cannot delete it');
select throws_ok($$select public.set_branch_deed_recipient('97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-00000000c001')$$,
  '42501', null, 'set_branch_deed_recipient cannot point their office''s deeds at themselves');
select throws_ok($$select public.clear_branch_deed_recipient('97000000-0000-0000-0000-0000000000b2')$$,
  '42501', null, 'clear_branch_deed_recipient cannot clear their nomination');
select throws_ok($$select public.set_agency_rates('97000000-0000-0000-0000-0000000000a2', 0.30, 0.20)$$,
  '42501', null, 'set_agency_rates cannot reprice their business');
select throws_ok($$select public.set_agency_referencing_mode('97000000-0000-0000-0000-0000000000a2','pre_referenced_open')$$,
  '42501', null, 'set_agency_referencing_mode cannot move their agency onto another rail');

-- ---- their people ---------------------------------------------------------
select throws_ok($$select public.set_home_branch('97000000-0000-0000-0000-00000000c003','97000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'set_home_branch cannot move their Negotiator into our office');
select throws_ok($$select public.admin_cancel_invite('97000000-0000-0000-0000-00000000c002')$$,
  '42501', null, 'admin_cancel_invite cannot cancel their Director');
-- A Director granting Director is at their own level and allowed, which is
-- the ladder's rule rather than a reach rule; the_level_ladder.test.sql is
-- where the refusals live. Asserted positively here so the function is
-- covered by name and a change that started refusing it would be seen.
-- assert_may_grant_position is the containment half of placing somebody,
-- shared by set_user_scope and create_invited_user. Asked directly, because
-- its vacuous-for-a-branchless-target bug was invisible through its callers.
select throws_ok(
  $$select public.assert_may_grant_position('agency','97000000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'assert_may_grant_position refuses the other agency');
select throws_ok(
  $$select public.assert_may_grant_position('group','97000000-0000-0000-0000-00000000ab02')$$,
  '42501', null, 'and a group they hold no position over');
select lives_ok(
  $$select public.assert_may_grant_position('agency','97000000-0000-0000-0000-0000000000a1')$$,
  'while their own agency is allowed, so it is not simply refusing everything');

select lives_ok($$select public.assert_may_grant_level('Director')$$,
  'assert_may_grant_level lets a Director grant at their own level');

-- ---- and the whole-estate reads -------------------------------------------
select ok(not exists (select 1 from public.referrer_league(now() - interval '400 days', now(), null) l
                       where l.name like 'ZZZ Reach Their%'),
  'the referrer league does not rank another agency''s people beside their own');
select ok(not exists (select 1 from public.reconciliation_queue() q
                       where q.name like 'ZZZ Reach Theirs%'),
  'and the reconciliation queue does not offer another agency''s org for confirmation');

-- ---- the commission tiers, which used to be a table grant ----------------
-- A Director may see commission, so they get their OWN tiers and no others.
-- The three columns came off agencies/agency_groups/branches entirely in
-- 20261006350000, so there is no second way to ask.
select is((select count(*)::int from public.org_rate_tiers()
            where org_id in ('97000000-0000-0000-0000-0000000000a2',
                             '97000000-0000-0000-0000-0000000000b2',
                             '97000000-0000-0000-0000-00000000ab02')), 0,
  'org_rate_tiers returns no tier belonging to the other agency');
select ok(exists (select 1 from public.org_rate_tiers()
                   where org_id = '97000000-0000-0000-0000-0000000000a1'),
  'and does return their own, so the gate is not simply answering empty');

-- ---- the eligibility widener ---------------------------------------------
select ok(public.viewer_runs_eligibility_journey(null),
  'viewer_runs_eligibility_journey answers for the agencies they hold');

-- ---- and a Negotiator sees no commission tier at all ----------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.org_rate_tiers()), 0,
  'a Negotiator gets no commission tiers, which is what may_see_commission means');

-- ---- creating a person without a position --------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_invited_user(
      '97000000-0000-0000-0000-00000000cfff','ghost@r.test','Ghost','management',
      (select id from public.partners where slug='opndoor-agents'), null, false, null, null)$$,
  '22023', null,
  'create_invited_user refuses to make somebody on our estate with no position');

select * from finish();
rollback;
