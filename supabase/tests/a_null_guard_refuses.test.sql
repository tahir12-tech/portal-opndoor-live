-- A NULL GUARD REFUSES.
--
-- applications.referrer_id is nullable. A direct tenant has no referrer, and
-- neither does an API application with no human sender. Every authorisation
-- guard in this schema is shaped
--
--   if not (is_admin() or (app_role() = 'referrer' and a.referrer_id = auth.uid()) or ...)
--
-- and for a Negotiator reading an application with no referrer that is
-- `true and NULL` = NULL, so the OR is NULL, `not NULL` is NULL, and an
-- `if NULL then raise` DOES NOT FIRE. The gate returns "I do not know" and
-- every one of these functions reads that as a yes.
--
-- EVERY REFUSAL BELOW IS ALLOWED BY THE CODE AS IT STANDS BEFORE
-- 20261006470000. Two of them are writes: one withdraws another company's
-- application, and one mints a 90-day bearer token to its payment page. They
-- are asserted as writes, with a follow-up count, because a test that only
-- asserted the error code would still pass if the function raised after doing
-- the damage.
--
-- The last three assertions are the other half. coalesce(cond, false) turns
-- "I do not know" into "refuse", and a refusal that lands on the owner's own
-- application would be the lock-down breaking legitimate work again.

begin;
select plan(14);

-- ===========================================================================
-- ONE AGENCY, ONE NEGOTIATOR, AND THREE APPLICATIONS AT THEIR OWN BRANCH
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Null Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Null Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('96000000-0000-0000-0000-00000000c001'::uuid,'zzz.null.neg@n.test'),
  ('96000000-0000-0000-0000-00000000c002'::uuid,'zzz.null.dir@n.test'),
  -- applicants.id references auth.users: a tenant signs in too.
  ('96000000-0000-0000-0000-0000000000aa'::uuid,'nala@n.test'),
  ('96000000-0000-0000-0000-00000000c003'::uuid,'zzz.null.np@n.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('96000000-0000-0000-0000-00000000c001','ZZZ Null Neg','zzz.null.neg@n.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'96000000-0000-0000-0000-0000000000b1'),
  ('96000000-0000-0000-0000-00000000c002','ZZZ Null Dir','zzz.null.dir@n.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null);

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('96000000-0000-0000-0000-00000000c001','branch',null,'96000000-0000-0000-0000-0000000000b1'),
  ('96000000-0000-0000-0000-00000000c002','agency','96000000-0000-0000-0000-0000000000a1',null);

-- assert_application_attributed refuses an application with neither a referrer
-- nor an applicant unless its partner is a house route, and opndoor-agents is
-- not one. So the agency-rail application below is attributed to the TENANT,
-- which is what a tenant-initiated referral matched to an agency looks like,
-- and is the only way referrer_id is NULL on that rail.
insert into public.applicants (id, email, first_name, last_name)
values ('96000000-0000-0000-0000-0000000000aa','nala@n.test','Nala','Api');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values
  -- ANOTHER COMPANY'S TENANT. The direct rail, pointed at this branch by the
  -- auto-matcher, which is how a direct application acquires an agency_id at all.
  ('96000000-0000-0000-0000-00000000e001','ZZZ-NULL-DI',(select id from public.partners where slug='opndoor-direct'),
   '96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000b1',null,'Direct',null,
   'Mx','Nula','Direct','1990-01-01','nula@n.test','07700900041','1 Null Street','London','NL1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '2 days'),
  -- An application on the AGENCY rail with no human sender, which is what an
  -- API-created referral looks like. Same NULL, same branch, different rail.
  ('96000000-0000-0000-0000-00000000e002','ZZZ-NULL-AP',(select id from public.partners where slug='opndoor-agents'),
   '96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000b1',null,'API','96000000-0000-0000-0000-0000000000aa',
   'Mx','Nala','Api','1990-01-01','nala@n.test','07700900042','2 Null Street','London','NL2 2AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '2 days'),
  -- And one the Negotiator actually sent, as the control.
  ('96000000-0000-0000-0000-00000000e003','ZZZ-NULL-OWN',(select id from public.partners where slug='opndoor-agents'),
   '96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000b1','96000000-0000-0000-0000-00000000c001','ZZZ Null Neg',null,
   'Mx','Owen','Own','1990-01-01','owen@n.test','07700900043','3 Null Street','London','NL3 3AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now()-interval '2 days');

-- ===========================================================================
-- AS THE NEGOTIATOR, against the direct application they have no part in
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- THE ONE THAT SURFACED IT.
select throws_ok(
  $$select * from public.application_journey('ZZZ-NULL-DI')$$,
  '42501', null,
  'a Negotiator cannot read the journey of a direct application with no referrer');

-- THE WRITE THAT MATTERS MOST: a bearer token to the payment page, good for
-- ninety days, for another company's tenant.
select throws_ok(
  $$select public.staff_payment_page_token('ZZZ-NULL-DI')$$,
  '42501', null,
  'and cannot mint a payment page token for it');

-- THE OTHER WRITE: this application is at Sent, so before the fix the guard
-- passed and the withdrawal went through.
select throws_ok(
  $$select public.mark_withdrawn('ZZZ-NULL-DI','duplicate','x')$$,
  '42501', null,
  'and cannot withdraw it');

select throws_ok(
  $$select public.add_application_note('ZZZ-NULL-DI','x')$$,
  '42501', null,
  'and cannot write a note on it');

select throws_ok(
  $$select public.amend_tenancy_start('96000000-0000-0000-0000-00000000e001', current_date + 60)$$,
  '42501', null,
  'and cannot move its tenancy start date');

select throws_ok(
  $$select public.clear_awaiting_staff_send('96000000-0000-0000-0000-00000000e001')$$,
  '42501', null,
  'and cannot clear its awaiting-staff-send flag');

select throws_ok(
  $$select public.send_deed_to_agent('96000000-0000-0000-0000-00000000e001', null, false)$$,
  '42501', null,
  'and cannot send its deed to an agent');

select throws_ok(
  $$select public.send_deed_to_landlord('96000000-0000-0000-0000-00000000e001', null, null)$$,
  '42501', null,
  'and cannot send its deed to a landlord');

-- THE AGENCY RAIL, same NULL. Here the branch predicate admits them, so the
-- first gate passes and the refusal has to come from the `owned` test, which
-- was `if r = 'referrer' and not owned` -- NULL again, and so never fired.
select throws_ok(
  $$select * from public.my_application_delivery('96000000-0000-0000-0000-00000000e002')$$,
  '42501', null,
  'nor read the delivery contact of an unattributed application in their own branch');

-- ===========================================================================
-- AND NOTHING WAS WRITTEN ON THE WAY TO THE REFUSAL
-- ===========================================================================
reset role;
select is((select count(*)::int from public.payment_page_tokens
            where application_id = '96000000-0000-0000-0000-00000000e001'), 0,
  'no payment token was created for the direct application');
select is((select status from public.applications where id = '96000000-0000-0000-0000-00000000e001'),
  'sent',
  'and the direct application is still at Sent, not withdrawn');

-- ===========================================================================
-- THE REFUSAL DID NOT LAND ON THE OWNER
-- ===========================================================================
-- coalesce(cond, false) can only turn NULL into a refusal, so the risk it
-- carries is refusing work that should succeed. This is that half.
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select * from public.application_journey('ZZZ-NULL-OWN')$$,
  'while the Negotiator still reads the journey of the application they sent');
select lives_ok(
  $$select public.add_application_note('ZZZ-NULL-OWN','Spoke to the tenant.')$$,
  'and still writes a note on it');

-- ===========================================================================
-- THE DENY-IF SHAPE: set_home_branch
-- ===========================================================================
-- `if public.app_role() <> 'management' then raise` is NULL for a caller with
-- no users row, so the role check does not fire. Against a target on our
-- estate the very next check catches them anyway, which is why this needs a
-- target whose partner_id is NULL too: then `v_target.partner_id is distinct
-- from public.app_partner()` is NULL distinct from NULL, which is FALSE, and
-- the caller walks past both. The refusal then comes four checks further down
-- from assert_may_act_on_user, and its MESSAGE is what makes this fail first.
reset role;
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id)
-- users_partner_by_role allows a NULL partner only for Opndoor's own staff,
-- so that is who the target has to be. The point is the caller's missing row,
-- not the target's job.
values ('96000000-0000-0000-0000-00000000c003','ZZZ Null Nopartner','zzz.null.np@n.test','opndoor_manager',null,'active',false,null);

select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000cfff","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_home_branch('96000000-0000-0000-0000-00000000c003', null)$$,
  '42501', 'not permitted',
  'a caller with no users row is refused by the role check itself, which NULL had been skipping');

select * from finish();
rollback;
