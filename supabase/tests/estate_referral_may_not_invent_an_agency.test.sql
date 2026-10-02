-- AN AGENCY USER CANNOT CREATE AN AGENCY OR AN OFFICE, BY ANY ROUTE.
--
-- Our estate is set up by us (20261004160000). That ruling closed the two
-- direct inserts with RLS, and 20261005200000 closed the third route, which the
-- first migration could not reach: create_referral_target is SECURITY DEFINER,
-- and DEFINER runs as the owner, so the owner bypasses the very policies that
-- were added to stop this. The function inserted into agencies and branches
-- with those policies never consulted.
--
-- So this file enumerates the routes rather than testing a feature, because
-- "the screen does not offer it" is not the claim. The claim is about the
-- DATABASE, and the person most likely to find the third route is the one who
-- watched the first two close.
--
-- THE HALF THAT WOULD ACTUALLY HAVE SHIPPED BROKEN is asserted last, twice:
-- resolving an existing office must still work, because every referral on our
-- estate submits an agency and a branch by name and needs the branch id back,
-- and a supplier must still be able to invent one, because on that rail it is
-- the product. A guard that refused both would have stopped Regent sending
-- anything at all, and stopped Rightmove sending a referral for an agent we had
-- not heard of yet.

begin;
select plan(8);

-- ---------------------------------------------------------------------------
-- TWO PARTNERS, DIFFERENT RAILS. The estate question is asked of the partner
-- (is_our_estate_partner: referencing_mode = 'opndoor_referenced'), so the two
-- fixtures differ in exactly that column and in nothing else.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('96000000-0000-0000-0000-000000000001', 'zzz-estate',   'ZZZ House Route', 'opndoor_referenced', 0.25, 0.10, true, 'agency'),
  ('96000000-0000-0000-0000-000000000002', 'zzz-supplier', 'ZZZ Supplier',    'pre_referenced_open', 0.25, 0.10, false, 'supplier');

insert into public.agencies (id, partner_id, name) values
  ('96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-000000000001', 'ZZZ Estate Lettings');
insert into public.branches (id, agency_id, partner_id, name) values
  ('96000000-0000-0000-0000-00000000000b', '96000000-0000-0000-0000-00000000000a',
   '96000000-0000-0000-0000-000000000001', 'ZZZ Estate Park');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('96000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rosa@zzzestate.test',   '', now(), now(), now()),
  ('96000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supp@zzzsupplier.test', '', now(), now(), now());

insert into public.users (id, full_name, email, role, partner_id, status) values
  ('96000000-0000-0000-0000-00000000000d', 'Rosa Estate',  'rosa@zzzestate.test',   'management', '96000000-0000-0000-0000-000000000001', 'active'),
  ('96000000-0000-0000-0000-00000000000e', 'Sam Supplier', 'supp@zzzsupplier.test', 'management', '96000000-0000-0000-0000-000000000002', 'active');

-- THE AGENCY POSITION, and the test is wrong without it. On the agent rail reach
-- comes from a position rather than from sharing a partner, and the house route
-- carries every one of our agencies, so a manager with no position can read none
-- of it. Without this row the direct-insert assertion below was refused by the
-- branches trigger ("agency not found", because she could not see the agency)
-- rather than by the policy it is meant to be testing, which would have passed
-- for the wrong reason. This matches the real Regent manager on dev, who holds
-- exactly one agency scope.
insert into public.user_scopes (user_id, kind, agency_id) values
  ('96000000-0000-0000-0000-00000000000d', 'agency', '96000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- THE AGENCY USER, on our house route.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(public.is_our_estate_partner(public.app_partner()),
  'the fixture puts this manager on our own estate');

-- ROUTE 1 and 2: the direct inserts, closed by RLS in 20261004160000.
select throws_ok(
  $$insert into public.agencies (partner_id, name)
    values (public.app_partner(), 'Invented By A Referral')$$,
  '42501', null,
  'route 1, inserting an agency directly, is refused by RLS');

select throws_ok(
  $$insert into public.branches (agency_id, partner_id, name)
    values ('96000000-0000-0000-0000-00000000000a', public.app_partner(), 'Invented Office')$$,
  '42501', null,
  'route 2, inserting a branch directly, is refused by RLS');

-- ROUTE 3: the one DEFINER rights walked past. Before 20261005200000 both of
-- these returned a uuid and left a row in our estate.
--
-- EVERY CALL NAMES p_partner_slug, and that is not decoration. There are two
-- overloads, at eight parameters and at nine, and every parameter after the
-- second carries a default, so a call with eight arguments or fewer matches both
-- and Postgres refuses it as "not unique". Naming the ninth is the only way to
-- address one of them unambiguously, which means the nine-parameter version is
-- the only one any caller can actually reach. It is also the one the edge
-- function calls (it passes p_partner_slug). The eight is guarded too, for the
-- day somebody drops the nine.
select throws_ok(
  $$select public.create_referral_target(
      p_agency => 'Totally Invented Agency', p_branch => 'Invented Branch',
      p_agency_email => 'x@invented.test', p_partner_slug => null)$$,
  '42501', null,
  'route 3, inventing an agency through create_referral_target, is refused');

select throws_ok(
  $$select public.create_referral_target(
      p_agency => 'ZZZ Estate Lettings', p_branch => 'An Office We Do Not Have',
      p_partner_slug => null)$$,
  '42501', null,
  'and inventing an OFFICE under an agency that does exist is refused too');

-- AND NOTHING WAS LEFT BEHIND. throws_ok rolls back to a savepoint, so this is
-- asserting the guard fired before the insert rather than after it.
reset role;
select is((select count(*)::int from public.agencies where name = 'Totally Invented Agency'),
  0, 'and no agency was created on the way to being refused');

-- ---------------------------------------------------------------------------
-- BUT RESOLVING STILL WORKS, which is the normal path for every referral we
-- send. Same function, same call shape, an office that exists.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  public.create_referral_target(
    p_agency => 'ZZZ Estate Lettings', p_branch => 'ZZZ Estate Park', p_partner_slug => null),
  '96000000-0000-0000-0000-00000000000b'::uuid,
  'resolving an office we do have returns it, so referrals still send');

-- ---------------------------------------------------------------------------
-- AND THE SUPPLIER RAIL IS UNTOUCHED. An agent Rightmove has not sent us
-- before turns up mid-form, and the referral must not stop.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select isnt(
  public.create_referral_target(
    p_agency => 'Brand New Agent', p_branch => 'Their Only Office',
    p_agency_email => 'hello@brandnew.test', p_partner_slug => null),
  null,
  'a supplier still invents an agency mid-referral, because there that is the product');

select * from finish();
rollback;
