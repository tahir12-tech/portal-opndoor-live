/* WHICH SUPPLIERS A REFERRAL MAY BE FILED UNDER.
   Migration: 20261009080000.

   Matt (df): "list only suppliers that can take referrals (active, with
   a deal set). Hide paused, onboarding and no-deal suppliers."
   And, 2026-10-05, choosing between the three readings of "a deal set":
   "go with B, a negotiated agreement that has not ended."

   THE FIXTURE IS ONE OF EACH THING THE RULE EXCLUDES, because a filter
   is only as good as what it refuses: an agency-kind partner with a
   deal, a paused supplier with a deal, a supplier whose deal has ended,
   and a supplier with no deal at all. Only the fifth is offered.

   AN AGENCY-KIND PARTNER IS THE ONE MATT FOUND. "Harbour Lets" is an
   agency with a partner row of its own, and the old list -- every
   non-house partner -- offered it as a supplier. A referral filed
   under it puts its commission nowhere anybody reads. */
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('ee300000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.df.admin@opndoor.test','',now(),now(),now()),
  ('ee300000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.df.mgr@opndoor.test','',now(),now(),now()),
  ('ee300000-0000-0000-0000-00000000c003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.df.cust@supplier.test','',now(),now(),now());

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate) values
  ('ee300000-0000-0000-0000-0000000000a1'::uuid, 'zzz-df-good',    'ZZZ DF Good Supplier',   'active',     'supplier', 'pre_referenced_open', 0.2, 0.1),
  ('ee300000-0000-0000-0000-0000000000a2'::uuid, 'zzz-df-nodeal',  'ZZZ DF No Deal',         'active',     'supplier', 'pre_referenced_open', 0.2, 0.1),
  ('ee300000-0000-0000-0000-0000000000a3'::uuid, 'zzz-df-ended',   'ZZZ DF Ended Deal',      'active',     'supplier', 'pre_referenced_open', 0.2, 0.1),
  ('ee300000-0000-0000-0000-0000000000a4'::uuid, 'zzz-df-paused',  'ZZZ DF Paused',          'paused',     'supplier', 'pre_referenced_open', 0.2, 0.1),
  ('ee300000-0000-0000-0000-0000000000a5'::uuid, 'zzz-df-agency',  'ZZZ DF Agency Partner',  'active',     'agency',   'opndoor_referenced',  0.2, 0.1);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ee300000-0000-0000-0000-00000000c001','ZZZ DF Admin','zzz.df.admin@opndoor.test','superadmin', null,'active',true),
  ('ee300000-0000-0000-0000-00000000c002','ZZZ DF Manager','zzz.df.mgr@opndoor.test','opndoor_manager', null,'active',false),
  ('ee300000-0000-0000-0000-00000000c003','ZZZ DF Customer','zzz.df.cust@supplier.test','management',
   'ee300000-0000-0000-0000-0000000000a1'::uuid,'active',true);

/* A LIVE AGREEMENT for the good one, the paused one and the agency-kind
   one, so the only thing separating them from the answer is what the
   rule says it is. And an ENDED one for the third. */
insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, ended_at, is_standard) values
  ('ee300000-0000-0000-0000-0000000000b1'::uuid, 'partner', 'ee300000-0000-0000-0000-0000000000a1'::uuid, current_date - 30, null, false),
  ('ee300000-0000-0000-0000-0000000000b2'::uuid, 'partner', 'ee300000-0000-0000-0000-0000000000a3'::uuid, current_date - 60, current_date - 1, false),
  ('ee300000-0000-0000-0000-0000000000b3'::uuid, 'partner', 'ee300000-0000-0000-0000-0000000000a4'::uuid, current_date - 30, null, false),
  ('ee300000-0000-0000-0000-0000000000b4'::uuid, 'partner', 'ee300000-0000-0000-0000-0000000000a5'::uuid, current_date - 30, null, false);

-- ===========================================================================
-- 1. WHO MAY ASK.
-- ===========================================================================
select function_privs_are('public','suppliers_that_can_take_referrals',array[]::text[],
  'anon', array[]::text[], 'anon may not ask');
select function_privs_are('public','suppliers_that_can_take_referrals',array[]::text[],
  'authenticated', array['EXECUTE'], 'a signed-in user may ask, and the function decides');

-- ===========================================================================
-- 2. THE ANSWER, AS AN ADMIN.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ee300000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select string_agg(name, ', ' order by name) from public.suppliers_that_can_take_referrals()
    where name like 'ZZZ DF%'),
  'ZZZ DF Good Supplier',
  'only the active supplier with a live agreement');

/* EACH EXCLUSION NAMED, so a later change that lets one back in says
   which one. */
select is(
  (select count(*)::int from public.suppliers_that_can_take_referrals() where name = 'ZZZ DF No Deal'),
  0, 'not one with no agreement at all');
select is(
  (select count(*)::int from public.suppliers_that_can_take_referrals() where name = 'ZZZ DF Ended Deal'),
  0, 'not one whose agreement has ended');
select is(
  (select count(*)::int from public.suppliers_that_can_take_referrals() where name = 'ZZZ DF Paused'),
  0, 'not a paused one, however good its deal');
select is(
  (select count(*)::int from public.suppliers_that_can_take_referrals() where name = 'ZZZ DF Agency Partner'),
  0, 'and never an agency that happens to hold a partner row');

-- ===========================================================================
-- 3. AN OPNDOOR MANAGER GETS THE SAME LIST, which is the reason it is a
--    definer function at all: they draw this picker and may not read a
--    pricing agreement.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ee300000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
select is(
  (select string_agg(name, ', ' order by name) from public.suppliers_that_can_take_referrals()
    where name like 'ZZZ DF%'),
  'ZZZ DF Good Supplier',
  'an opndoor manager, who may not read a deal, still gets the list');

-- ===========================================================================
-- 4. AND A CUSTOMER GETS NOTHING. They never draw this picker, and the
--    list of who has a deal is not theirs to read.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ee300000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
select is(
  (select count(*)::int from public.suppliers_that_can_take_referrals()),
  0, 'a supplier''s own management is told nothing');

select * from finish();
rollback;
