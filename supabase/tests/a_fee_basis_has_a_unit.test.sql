-- A FEE BASIS HAS A UNIT, AND A MONTH IS EXACTLY THE RENT.
--
-- A week is rent x 12 / 52, so one month is 52/12 = 4.3333... weeks, which does
-- not terminate. The editor offered 4.3333 with a note explaining it, and the
-- arithmetic came out at 0.99999... of the rent.
--
-- The tell was already in the code: resolve_fee has a special case returning
-- p_rent exactly for standard terms, because the weeks expression does not land
-- on a month. Standard terms dodged it and a NEGOTIATED agreement of one month
-- could not.
--
-- These assertions are about money on the one figure a tenant is asked to pay,
-- so they are written as exact equalities and not as tolerances.

begin;
select plan(14);

-- ---------------------------------------------------------------------------
-- THE ARITHMETIC. No fixtures: fee_from_basis is immutable and takes everything
-- it needs, which is why it was worth extracting.
-- ---------------------------------------------------------------------------
select is(public.fee_from_basis(2000, 1, 'months'), 2000.00::numeric,
  'one month of a £2,000 rent is £2,000, exactly');

-- THE DEFECT, priced. This is what "one month" cost before the unit existed.
select is(public.fee_from_basis(2000, 4.3333, 'weeks'), 1999.98::numeric,
  'and as 4.3333 weeks it was £1,999.98, which is twopence short of a month');

select isnt(public.fee_from_basis(2000, 4.3333, 'weeks'), public.fee_from_basis(2000, 1, 'months'),
  'so the two are not the same number, which is the whole reason for the unit');

select is(public.fee_from_basis(2000, 2, 'months'), 4000.00::numeric,
  'two months is twice the rent, with no rounding anywhere to accumulate');

-- WEEKS ARE UNCHANGED. Regent is priced in weeks and must not move by a penny.
select is(public.fee_from_basis(2000, 3, 'weeks'), 1384.62::numeric,
  'three weeks of £2,000 is £1,384.62, as it always was');
select is(public.fee_from_basis(2000, 5, 'weeks'), 2307.69::numeric,
  'and five weeks is £2,307.69, which is Regent''s joint basis');
select is(public.fee_from_basis(1000, 3, 'weeks'), 692.31::numeric,
  'and three weeks of £1,000 is £692.31');

-- An absent unit is weeks, because that is what every row held before today.
select is(public.fee_from_basis(2000, 3, null), public.fee_from_basis(2000, 3, 'weeks'),
  'no unit means weeks, so an unmigrated caller prices exactly as it did');

-- ---------------------------------------------------------------------------
-- THROUGH AN AGREEMENT, because the arithmetic being right is not the same as
-- the band carrying the unit to it.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock, portal_referrals_enabled, partner_kind)
values ('98000000-0000-0000-0000-000000000001', 'zzz-unit', 'ZZZ Unit Estate', 'opndoor_referenced', 0.25, 0.10, true, true, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('98000000-0000-0000-0000-00000000000a', '98000000-0000-0000-0000-000000000001', 'ZZZ Unit Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-00000000000a', '98000000-0000-0000-0000-000000000001', 'Unit Park');

insert into public.pricing_agreements (id, scope_level, scope_id, is_standard, effective_from)
values ('98000000-0000-0000-0000-0000000000e1', 'agency', '98000000-0000-0000-0000-00000000000a', false, current_date - 1);

-- One month at 15%, which is the deal that could not previously be expressed.
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('98000000-0000-0000-0000-0000000000e1', 1, null, 1, 'months', 0.15);

select is(
  (select fee_basis_unit from public.resolve_pricing_agreement(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000001', 1)),
  'months', 'the resolver carries the unit out of the band');

select is(
  (select fee_amount from public.resolve_fee(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000001', 2000, 1)),
  2000.00::numeric,
  'and one month at 15% prices a £2,000 tenancy at exactly £2,000');

select is(
  (select agent_rate from public.resolve_fee(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000001', 2000, 1)),
  0.15::numeric, 'at the band''s rate, which the unit does not touch');

-- Switch the same band to weeks and the price moves, which is the control: if
-- both answered the same the unit would be doing nothing.
update public.pricing_agreement_bands
   set fee_basis_weeks = 3, fee_basis_unit = 'weeks'
 where agreement_id = '98000000-0000-0000-0000-0000000000e1';

select is(
  (select fee_amount from public.resolve_fee(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000001', 2000, 1)),
  1384.62::numeric,
  'the same band in weeks prices at three weeks, so the unit is what decided it');

-- ---------------------------------------------------------------------------
-- STANDARD TERMS ARE ONE MONTH, and now say so rather than answering 4.35 weeks.
-- The fee was always the rent exactly, by a special case; only the WORDING was
-- wrong, and every screen reads the unit to word it.
-- ---------------------------------------------------------------------------
select is(
  (select fee_basis_unit from public.resolve_fee(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000001', 2000, 9)),
  'weeks',
  'a tenant count outside every band falls back to weeks rather than inventing a month');

insert into public.pricing_agreements (id, scope_level, scope_id, is_standard, effective_from)
values ('98000000-0000-0000-0000-0000000000e2', 'agency', '98000000-0000-0000-0000-00000000000a', true, current_date);

select is(
  (select fee_basis_unit from public.resolve_fee(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-000000000001', 2000, 1)),
  'months',
  'standard terms answer months, because that is what one month''s rent is');

select * from finish();
rollback;
