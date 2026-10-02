-- A PRE-REFERENCED AGENCY OF OURS MAY REFER A PAIR, AND IT PRICES AT FIVE WEEKS.
--
-- I told Matt the opposite, in docs/REGENT-ON-MAIN.md and in QUEUE.md under
-- NM-1b: that Regent's 5-week / 25% band was unreachable because a joint
-- tenancy is refused for anyone pre-referenced. The citation was
-- 20261003110000_joint_is_agent_rail_only.sql:55, which refuses
-- create_joint_referral unless referencing_mode = 'opndoor_referenced'.
--
-- That guard was replaced THE NEXT DAY, by
-- 20261004100000_estate_and_journey_are_two_questions.sql, and has been
-- superseded six times since. The last definition is at
-- 20261006470000:1438 and it asks a different question.
--
-- THE MISTAKE, because it is the useful part. I treated "pre-referenced" and
-- "on our agent estate" as the same axis, so an agency could be one or the
-- other. They are two questions:
--
--   the JOURNEY    referencing_mode -- are this tenant's references already
--                  done before the referral reaches us? A property of the
--                  work, frozen onto each application.
--   the ESTATE     is_agent_estate(branch, route) -- is this branch one of
--                  the agencies Opndoor onboarded? A property of the
--                  RELATIONSHIP, read from the ROUTE PARTNER.
--
-- An agency can be both. Regent is: it sits under the house partner
-- opndoor-agents, so it is on the estate, and it carries
-- referencing_mode = 'pre_referenced_open', so its tenants arrive already
-- referenced. A joint tenancy needs an agency of ours to sit under, which is
-- the estate question, and it has one.
--
-- WHAT THE OLD DOCUMENTS WERE NOT WRONG ABOUT, and the correction keeps it:
-- they were answering "Regent onboards as their OWN partner, pre-referenced".
-- In THAT shape the route partner is Regent's own pre-referenced partner,
-- is_agent_estate reads false, and joint tenancies really are refused -- so
-- the 5-week band really would be unreachable. The refusal is about which
-- ESTATE the referral comes from, not about whether references are done.
-- Both shapes are asserted below, which is the only way to show the
-- distinction is the estate and not the journey.
--
-- WHY IT GOES THROUGH create_joint_referral RATHER THAN THE RESOLVERS.
-- estate_and_journey.test.sql already proves the resolvers in isolation. The
-- guard I misread is in the CREATE path, and nothing called it. So this
-- asserts the guard, the money, and what is frozen onto the rows.
--
-- The numbers: rent 2400, two tenants, five weeks.
--   fee   = round(2400 * 12 / 52 * 5, 2) = 2769.23
--   split = apportion(2769.23, [50, 50]) = 1384.62 + 1384.61
--           (the last applicant takes the rounding, 20261002100000)
--   commission = one agency line at 0.2500
-- At one tenant the same agreement gives three weeks at 0.2000, which is the
-- contrast that makes "the band moved" mean something.

begin;
select plan(12);

-- ===========================================================================
-- TWO ESTATES, IDENTICAL IN EVERY WAY EXCEPT WHOSE THEY ARE
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind)
values
  -- The house route: this is what makes is_agent_estate true. Stands in for
  -- opndoor-agents so the test does not depend on seed data. `partner_kind`
  -- is what makes it true since 20261007600000; the mode beside it no
  -- longer decides, which is the point of this file read one layer up.
  ('97000000-0000-0000-0000-0000000000d1','zzz-regent-estate','ZZZ Regent Estate',
   'opndoor_referenced', 0.25, 0.10, true,  true,  true, false, 'agency'),
  -- The control: a supplier, which is the shape the old documents assumed.
  ('97000000-0000-0000-0000-0000000000d2','zzz-regent-supplier','ZZZ Regent Supplier',
   'pre_referenced_open', 0.25, 0.10, false, false, true, true, 'supplier');

-- THE AGENCY THAT IS BOTH. On our estate, and pre-referenced. This one column
-- is the whole point of the file: if it were null the test would prove
-- nothing, because the estate answer alone would carry it.
insert into public.agencies (id, partner_id, name, referencing_mode) values
  ('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000d1',
   'ZZZ Regent Shape','pre_referenced_open'),
  /* THE CONTROL CARRIES NO ANSWER OF ITS OWN... or it did. Since
     2026-10-02 `referencing_mode` is NOT NULL -- Matt removed "Follow
     the default" -- so the supplier's agency states the mode its
     partner has rather than inheriting it. Which is what the column
     meant by null here, and the assertions below are unchanged. */
  ('97000000-0000-0000-0000-0000000000a2','97000000-0000-0000-0000-0000000000d2',
   'ZZZ Supplier Shape', 'pre_referenced_open');

insert into public.branches (id, agency_id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000a1',
   '97000000-0000-0000-0000-0000000000d1','ZZZ Regent Park'),
  ('97000000-0000-0000-0000-0000000000b2','97000000-0000-0000-0000-0000000000a2',
   '97000000-0000-0000-0000-0000000000d2','ZZZ Supplier Branch');

-- REGENT'S DEAL: three weeks at 20% for one tenant, five weeks at 25% for two
-- or more. Agency-scoped and additive, exactly as it sits on dev. No
-- commission_tiers rows, deliberately: dev has none either, and a tier would
-- override the band's rate and hide what is being asserted.
insert into public.pricing_agreements
  (id, scope_level, scope_id, effective_from, period, counting_scope, coverage, is_standard)
values ('97000000-0000-0000-0000-0000000000f1','agency','97000000-0000-0000-0000-0000000000a1',
        current_date - 30, 'year', 'agency', 'additive', false);

insert into public.pricing_agreement_bands
  (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values
  ('97000000-0000-0000-0000-0000000000f1', 1, 1,    3.00, 'weeks', 0.2000),
  ('97000000-0000-0000-0000-0000000000f1', 2, null, 5.00, 'weeks', 0.2500);

-- A REAL DIRECTOR, not a superadmin: is_admin() short-circuits the scope
-- ladder, so an admin caller would leave the realistic path untested.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('97000000-0000-0000-0000-00000000c001'::uuid,'zzz.regent.director@r.test'),
  ('97000000-0000-0000-0000-00000000c002'::uuid,'zzz.supplier.manager@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('97000000-0000-0000-0000-00000000c001','ZZZ Regent Director','zzz.regent.director@r.test',
   'management','97000000-0000-0000-0000-0000000000d1','active', true),
  ('97000000-0000-0000-0000-00000000c002','ZZZ Supplier Manager','zzz.supplier.manager@r.test',
   'management','97000000-0000-0000-0000-0000000000d2','active', true);

/* ONLY THE DIRECTOR ON OUR OWN ESTATE HOLDS A POSITION. The supplier's
   manager used to hold one on the supplier's own agency; Matt ruled on
   2026-10-02 that "nobody is ever positioned at an agency or branch in a
   supplier's estate ... A supplier's own staff sit at the supplier level
   only", and 20261007400000 refuses it. Their authority comes from
   `partner_id`, which on that rail IS the company, so the referral below
   is unaffected -- which is the point worth having a test say. */
insert into public.user_scopes (user_id, kind, agency_id) values
  ('97000000-0000-0000-0000-00000000c001','agency','97000000-0000-0000-0000-0000000000a1');

-- ===========================================================================
-- THE TWO QUESTIONS ARE DIFFERENT QUESTIONS
-- ===========================================================================
select is(
  public.resolve_referencing_mode('97000000-0000-0000-0000-0000000000b1',
                                  '97000000-0000-0000-0000-0000000000d1'),
  'pre_referenced_open'::text,
  'the JOURNEY says this agency''s tenants arrive already referenced');

select ok(
  public.is_agent_estate('97000000-0000-0000-0000-0000000000b1',
                         '97000000-0000-0000-0000-0000000000d1'),
  'and the ESTATE says the branch is still one of ours -- both true at once, which is what I denied');

select ok(
  not public.is_agent_estate('97000000-0000-0000-0000-0000000000b2',
                             '97000000-0000-0000-0000-0000000000d2'),
  'while a supplier''s own branch is not on our estate, which is the shape the old answer assumed');

-- ===========================================================================
-- THE BAND MOVES WITH THE NUMBER OF TENANTS
-- ===========================================================================
select is(
  (select fee_basis_weeks from public.resolve_fee(
     '97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000d1', 2400, 1)),
  3.00::numeric, 'one tenant prices at three weeks');

select is(
  (select fee_basis_weeks from public.resolve_fee(
     '97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000d1', 2400, 2)),
  5.00::numeric, 'and a PAIR prices at five weeks, the band I said was unreachable');

select is(
  (select fee_amount from public.resolve_fee(
     '97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000d1', 2400, 2)),
  2769.23::numeric, 'which on a 2400 rent is 2769.23, five weeks of it');

select is(
  public.commission_total('97000000-0000-0000-0000-0000000000b1',
                          '97000000-0000-0000-0000-0000000000d1', 2),
  0.2500::numeric, 'and the pair earns 25 per cent, not the single tenant''s 20');

-- ===========================================================================
-- AND THE CREATE PATH ACTUALLY ALLOWS IT, which is where the guard lives and
-- what nothing was asserting.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_joint_referral(
      '97000000-0000-0000-0000-0000000000b1',
      '[{"title":"Mx","first":"Rhea","last":"Regent","dob":"1992-04-01",
         "email":"zzz.rhea@r.test","phone":"07700900301","share_percent":50},
        {"title":"Mx","first":"Remy","last":"Regent","dob":"1993-05-02",
         "email":"zzz.remy@r.test","phone":"07700900302","share_percent":50}]'::jsonb,
      '1 Regent Street', null, 'London', null, 'W1B 2AA', 2400, current_date + 30)$$,
  'a Director of a pre-referenced agency ON OUR ESTATE may refer a pair');

reset role;

select is(
  (select count(*)::int from public.applications
    where branch_id = '97000000-0000-0000-0000-0000000000b1'),
  2, 'and it makes two applications, one per tenant');

/* THE JOURNEY IS STILL FROZEN ONTO THE ROWS. The estate question opened the
   door; it did not change what kind of referral this is. If this came back
   'opndoor_referenced' the guard would have been widened rather than
   corrected, and Regent's tenants would be sent through referencing we have
   already been told is done. */
select is(
  (select distinct referencing_mode from public.applications
    where branch_id = '97000000-0000-0000-0000-0000000000b1'),
  'pre_referenced_open'::text,
  'each application still records the pre-referenced journey, which the estate answer did not overwrite');

select is(
  (select sum(fee_amount) from public.applications
    where branch_id = '97000000-0000-0000-0000-0000000000b1'),
  2769.23::numeric,
  'the two fees sum to the five-week fee exactly, with no penny lost to rounding twice');

-- ===========================================================================
-- THE CONTROL, AND IT IS NOW THE OPPOSITE CONTROL.
--
-- This asserted that a supplier is REFUSED a joint tenancy, which was right:
-- Q-06 item H said "single tenant (no Add another tenant)" of that path.
-- Walk fix 26, batch 16, reverses it -- "Suppliers may refer joint
-- tenancies, the same way agencies can" -- and batch 16 is newer.
--
-- Inverted rather than deleted, because the SHAPE of the assertion is still
-- the useful one: the same deal, the same rent, the same pair, on a rail
-- that is not ours. What changed is the expected answer, and a reader
-- finding Q-06's rule needs to be able to see which one is live.
--
-- The money is asserted in full in
-- supabase/tests/a_supplier_may_refer_a_joint_tenancy.test.sql, including
-- that the direct rail still refuses.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_joint_referral(
      '97000000-0000-0000-0000-0000000000b2',
      '[{"title":"Mx","first":"Sam","last":"Supplier","dob":"1992-04-01",
         "email":"zzz.sam@r.test","phone":"07700900303","share_percent":50},
        {"title":"Mx","first":"Sky","last":"Supplier","dob":"1993-05-02",
         "email":"zzz.sky@r.test","phone":"07700900304","share_percent":50}]'::jsonb,
      '2 Supplier Street', null, 'London', null, 'W1B 3AA', 2400, current_date + 30)$$,
  'while a supplier may now refer one too, which Q-06 item H forbade and batch 16 allows');

reset role;
select * from finish();
rollback;
