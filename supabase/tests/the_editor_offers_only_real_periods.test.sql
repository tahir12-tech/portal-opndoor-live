-- THE DEAL EDITOR MAY ONLY OFFER PERIODS THAT EXIST.
--
-- Found while rewording the commission deal editor, 2026-10-01: the
-- control offered Month, Quarter and Year.
--
-- QUARTER WAS REFUSED BY THE DATABASE. The check on
-- pricing_agreements.period allows week, month, year and lifetime, so
-- choosing Quarter and pressing Save produced a raw constraint error in
-- front of an administrator agreeing a commercial deal.
--
-- AND IT WOULD NOT HAVE WORKED IF IT HAD SAVED, which is the worse half.
-- agreement_period_start has an arm for each of the four and none for
-- quarter, so a stored 'quarter' makes it return NULL; agreement_volume
-- then compares paid_at >= NULL, matches nothing, and the count reads
-- nought for ever. Every referral would price at the LOWEST tier,
-- silently, on a deal that was agreed on the opposite basis.
--
-- WEEK AND LIFETIME WERE MISSING FROM THE CONTROL and are both real, so
-- the editor was wrong in two directions at once.
--
-- This file pins the agreement between the three places that have to
-- hold the same list: the check constraint, the period-start function,
-- and (by the vitest file beside it) the control.

begin;
select plan(6);

-- ---------------------------------------------------------------------------
-- 1. THE CONSTRAINT IS THE LIST.
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.pricing_agreements'::regclass
      and conname = 'pricing_agreements_period_check'),
  'CHECK ((period = ANY (ARRAY[''week''::text, ''month''::text, ''year''::text, ''lifetime''::text])))',
  'the four periods an agreement may be stored with');

-- ---------------------------------------------------------------------------
-- 2. AND EVERY ONE OF THEM RESOLVES TO A REAL START DATE.
-- ---------------------------------------------------------------------------
/* ONE AGREEMENT PER PARTY, enforced by enforce_agreement_exclusivity, so
   this is four agencies rather than four agreements on one. The first
   draft put them all on one agency and the trigger refused it, which is
   the trigger doing its job. */
insert into public.agencies (id, partner_id, name)
select x.id, (select id from public.partners where slug = 'opndoor-agents'), x.nm
from (values
  ('e8000000-0000-0000-0000-0000000000a1'::uuid, 'ZZZ Period Agency W'),
  ('e8000000-0000-0000-0000-0000000000a2'::uuid, 'ZZZ Period Agency M'),
  ('e8000000-0000-0000-0000-0000000000a3'::uuid, 'ZZZ Period Agency Y'),
  ('e8000000-0000-0000-0000-0000000000a4'::uuid, 'ZZZ Period Agency L')
) as x(id, nm);

insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from)
values
  ('e8000000-0000-0000-0000-00000000e001','agency','e8000000-0000-0000-0000-0000000000a1','additive','week','agency',false,current_date - 30),
  ('e8000000-0000-0000-0000-00000000e002','agency','e8000000-0000-0000-0000-0000000000a2','additive','month','agency',false,current_date - 30),
  ('e8000000-0000-0000-0000-00000000e003','agency','e8000000-0000-0000-0000-0000000000a3','additive','year','agency',false,current_date - 30),
  ('e8000000-0000-0000-0000-00000000e004','agency','e8000000-0000-0000-0000-0000000000a4','additive','lifetime','agency',false,current_date - 30);

select isnt(public.agreement_period_start('e8000000-0000-0000-0000-00000000e001'), null,
  'a weekly agreement has a period start');
select isnt(public.agreement_period_start('e8000000-0000-0000-0000-00000000e002'), null,
  'and a monthly one');
select isnt(public.agreement_period_start('e8000000-0000-0000-0000-00000000e003'), null,
  'and a yearly one');
select isnt(public.agreement_period_start('e8000000-0000-0000-0000-00000000e004'), null,
  'and a lifetime one, which is the day it started');

-- ---------------------------------------------------------------------------
-- 3. AND QUARTER IS REFUSED RATHER THAN STORED AND IGNORED.
-- ---------------------------------------------------------------------------
/* THE REFUSAL IS THE SAFE BEHAVIOUR, and it is asserted so that nobody
   "helpfully" widens the constraint without also giving
   agreement_period_start an arm for it. A period the counter cannot
   measure is worse stored than refused: the deal looks agreed and
   prices every referral at the lowest tier. */
/* A FIFTH AGENCY, with no agreement on it, so the refusal under test is
   the PERIOD check and not the exclusivity trigger. The first draft
   reused one that already had one and caught 22023 instead of 23514:
   the right outcome for the wrong reason, which is the failure mode of
   asserting that something throws without saying what. */
insert into public.agencies (id, partner_id, name)
select 'e8000000-0000-0000-0000-0000000000a5',
       (select id from public.partners where slug = 'opndoor-agents'), 'ZZZ Period Agency Q';

select throws_ok(
  $$ insert into public.pricing_agreements
       (scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from)
     values ('agency','e8000000-0000-0000-0000-0000000000a5','additive','quarter','agency',false,current_date) $$,
  '23514', null,
  'a quarterly agreement is refused, because nothing could count it');

select * from finish();
rollback;
