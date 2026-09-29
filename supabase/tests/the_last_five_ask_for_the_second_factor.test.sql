-- THE LAST FIVE ASK FOR THE SECOND FACTOR.
--
-- Round 6, M8. Seven SECURITY DEFINER functions answered a password-only
-- session, where RLS deliberately gives nothing. Two were plpgsql and were
-- fixed in 20261006570000; these five are `language sql`, and I left them at
-- the time because a step-up needs a predicate on every union arm and doing
-- that mechanically to five multi-arm bodies at the end of a long session is
-- exactly how the two precedence bugs earlier that day happened.
--
-- The safe form is not a predicate per arm at all. Each becomes plpgsql with
-- the guard first and `return query <the original body, untouched>`, which is
-- the shape every other guarded function in this schema already has. All five
-- are called exactly once, standalone, from the client by .rpc(), and none is
-- called from another SQL function, so nothing loses inlining that had it.
--
-- Five of these fail against the code before 20261006600000: is_aal2() appears
-- in none of the five bodies, so a session at aal1 gets the ordinary answer.
-- The other five assertions are the half that matters just as much: the same
-- caller at aal2 is not refused, so this is a step-up and not a closure.

begin;
select plan(10);

-- ===========================================================================
-- ONE AGENCY WITH A DIRECTOR WHO MAY SEE COMMISSION
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('94000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Stepup Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('94000000-0000-0000-0000-0000000000f2','94000000-0000-0000-0000-0000000000f1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Stepup Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('94000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.stepup.dir@s.test','',now(),now(),now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('94000000-0000-0000-0000-00000000e001','ZZZ Stepup Dir','zzz.stepup.dir@s.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('94000000-0000-0000-0000-00000000e001','agency','94000000-0000-0000-0000-0000000000f1');

insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from)
values ('94000000-0000-0000-0000-0000000000f3','agency','94000000-0000-0000-0000-0000000000f1','additive','year','agency',false, current_date - 30);

-- ===========================================================================
-- AT aal1: A PASSWORD-ONLY SESSION, which is what somebody has between
-- signing in and completing the second factor, or when never enrolled.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-00000000e001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

select throws_ok(
  $$select * from public.agreement_for_agency('94000000-0000-0000-0000-0000000000f1')$$,
  '42501', 'MFA required',
  'agreement_for_agency, which states a negotiated deal, asks for the second factor');

select throws_ok(
  $$select * from public.commission_preview('agency','94000000-0000-0000-0000-0000000000f1', 0.15::numeric)$$,
  '42501', 'MFA required',
  'and commission_preview, which prices a change before it is made');

select throws_ok(
  $$select * from public.commission_split_batch(array['94000000-0000-0000-0000-0000000000f2']::uuid[])$$,
  '42501', 'MFA required',
  'and commission_split_batch, which says who is paid what at each branch');

select throws_ok(
  $$select * from public.org_rate_tiers()$$,
  '42501', 'MFA required',
  'and org_rate_tiers, which is every rate at every tier the caller reaches');

select throws_ok(
  $$select * from public.org_deed_readiness()$$,
  '42501', 'MFA required',
  'and org_deed_readiness, which is the shape of the caller''s estate');

-- ===========================================================================
-- AT aal2: THE SAME CALLER IS NOT REFUSED
-- ===========================================================================
-- A step-up that turned into a closure would be the lock-down pattern this
-- suite exists to catch, so every one of the five is asked again.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-00000000e001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select * from public.agreement_for_agency('94000000-0000-0000-0000-0000000000f1')$$,
  'and at aal2 the Director reads their agreement');
select lives_ok(
  $$select * from public.commission_preview('agency','94000000-0000-0000-0000-0000000000f1', 0.15::numeric)$$,
  'and prices a change');
select lives_ok(
  $$select * from public.commission_split_batch(array['94000000-0000-0000-0000-0000000000f2']::uuid[])$$,
  'and reads the split at their branch');
select lives_ok(
  $$select * from public.org_rate_tiers()$$,
  'and their rate tiers');
select lives_ok(
  $$select * from public.org_deed_readiness()$$,
  'and the shape of their estate');

select * from finish();
rollback;
