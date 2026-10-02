-- TWO QUESTIONS, NOT ONE.
--
-- referencing_mode was answering both "who checks the tenant" (the journey) and
-- "what kind of relationship is this" (the estate). Every agency we had did
-- both, so they travelled together. Regent is the case that pulls them apart:
-- one of ours — org tree, negotiated agreement, joint tenancies, commission
-- split per tenancy — who references their own tenants and whose applicants
-- must therefore go straight to payment.
--
-- Asked as one question Regent is impossible. These assertions are the
-- statement that they are two, and the guarantee that a supplier partner is
-- untouched by the separation.

begin;
select plan(20);

-- THE ESTATE: a partner whose agencies are ours.
/* `partner_kind` SAYS WHICH IS WHICH, since 20261007600000. Before it, the
   referencing_mode column beside it decided, which is the inference that
   migration removed: an agency that references its own tenants is still ours,
   and a supplier that lets us reference its tenants is still a supplier. The
   two rows below are exactly that pair, so this fixture would read backwards
   without the kind. */
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('94000000-0000-0000-0000-000000000001', 'zzz-estate', 'Our Estate', 'opndoor_referenced', 0.25, 0.10, true, 'agency'),
-- A SUPPLIER: hands us finished referrals, one tenant at a time.
       ('94000000-0000-0000-0000-000000000009', 'zzz-supplier', 'A Supplier', 'pre_referenced_open', 0.25, 0.10, true, 'supplier');

insert into public.agencies (id, partner_id, name, referencing_mode) values
  -- REGENT'S SHAPE: ours, references its own tenants.
  ('94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', 'Regent Shape', 'pre_referenced_open'),
  /* THE OTHER TWO SAID "null" FOR "inherit the partner's", which stopped
     being an option on 2026-10-02: Matt removed "Follow the default" and
     the column is NOT NULL. Each now states the mode it was inheriting,
     which is what every assertion below was already measuring. */
  -- An ordinary one of ours: we reference its tenants.
  ('94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 'Ordinary Agency', 'opndoor_referenced'),
  -- The supplier's.
  ('94000000-0000-0000-0000-000000000007', '94000000-0000-0000-0000-000000000009', 'Supplier Agency', 'pre_referenced_open');
insert into public.branches (id, agency_id, partner_id, name) values
  ('94000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', 'Regent Branch'),
  ('94000000-0000-0000-0000-000000000005', '94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 'Ordinary Branch'),
  ('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000007', '94000000-0000-0000-0000-000000000009', 'Supplier Branch');

-- ---------------------------------------------------------------------------
-- THE TWO QUESTIONS GIVE DIFFERENT ANSWERS, which is the whole point.
-- ---------------------------------------------------------------------------
select ok(
  public.is_agent_estate('94000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000001'),
  'Regent''s shape is one of OUR agencies');
select is(
  public.resolve_referencing_mode('94000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000001'),
  'pre_referenced_open',
  'and it references its own tenants: two questions, two answers, on one branch');

select ok(
  public.is_agent_estate('94000000-0000-0000-0000-000000000005', '94000000-0000-0000-0000-000000000001'),
  'an ordinary agency of ours is also ours');
select is(
  public.resolve_referencing_mode('94000000-0000-0000-0000-000000000005', '94000000-0000-0000-0000-000000000001'),
  'opndoor_referenced',
  'and we reference its tenants, which is what it always did');

select ok(
  not public.is_agent_estate('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000009'),
  'a supplier''s agency is not ours');

-- AN AGENCY'S REFERENCING CHOICE CANNOT TAKE IT OUT OF THE ESTATE. This is the
-- single assertion that stops the two questions collapsing back into one.
update public.agencies set referencing_mode = 'pre_referenced_screened'
 where id = '94000000-0000-0000-0000-000000000003';
select ok(
  public.is_agent_estate('94000000-0000-0000-0000-000000000005', '94000000-0000-0000-0000-000000000001'),
  'an agency opting out of eligibility is STILL one of ours');
-- PUT IT BACK. Said null until 2026-10-02, when "Follow the default" went
-- and the column became NOT NULL; the mode it was inheriting is now stated
-- on the fixture, so restoring it means naming it.
update public.agencies set referencing_mode = 'opndoor_referenced'
 where id = '94000000-0000-0000-0000-000000000003';

-- ...and a supplier's agency cannot opt INTO the estate by changing its route.
update public.agencies set referencing_mode = 'opndoor_referenced'
 where id = '94000000-0000-0000-0000-000000000007';
select ok(
  not public.is_agent_estate('94000000-0000-0000-0000-000000000008', '94000000-0000-0000-0000-000000000009'),
  'and a supplier''s agency cannot join the estate by asking us to reference its tenants');
update public.agencies set referencing_mode = 'pre_referenced_open'
 where id = '94000000-0000-0000-0000-000000000007';

-- ---------------------------------------------------------------------------
-- WHAT THE ESTATE DECIDES.
-- ---------------------------------------------------------------------------
-- Regent's deal, expressed the way deals are expressed.
insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, coverage, period, counting_scope)
values ('94000000-0000-0000-0000-00000000000a', 'agency', '94000000-0000-0000-0000-000000000002', current_date, 'additive', 'year', 'agency');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate) values
  ('94000000-0000-0000-0000-00000000000a', 1, 1, 3, 0.20),
  ('94000000-0000-0000-0000-00000000000a', 2, null, 5, 0.25);

select is(
  (select fee_amount from public.resolve_fee('94000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000001', 2000, 1)),
  1384.62::numeric, 'one tenant is charged three weeks of rent');
select is(
  (select fee_amount from public.resolve_fee('94000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000001', 2000, 2)),
  2307.69::numeric, 'two tenants are charged five weeks, once');
select is(
  public.commission_total('94000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000001', 1),
  0.20::numeric, 'and the agency earns 20% of it at one tenant');
select is(
  public.commission_total('94000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000001', 2),
  0.25::numeric, 'and 25% at two — the band the supplier rail could never reach');

-- The apportionment the form previews with and the referral charges by.
select is(public.apportion(2307.69, array[50,50]::numeric[]), array[1153.85, 1153.84]::numeric[],
  'the five-week fee splits to the penny, the last tenant taking the rounding');

-- ---------------------------------------------------------------------------
-- WHAT THE SUPPLIER KEEPS. This is the Rightmove guarantee.
-- ---------------------------------------------------------------------------
select is(
  (select fee_amount from public.resolve_fee('94000000-0000-0000-0000-000000000008','94000000-0000-0000-0000-000000000009', 2000, 1)),
  2000::numeric, 'a supplier''s referral is still one month''s rent');
select is(
  (select fee_amount from public.resolve_fee('94000000-0000-0000-0000-000000000008','94000000-0000-0000-0000-000000000009', 2000, 2)),
  2000::numeric, 'and stays one month''s rent however many tenants are asked about');
select is(
  (select r.agent_rate from public.resolve_rates('94000000-0000-0000-0000-000000000008','94000000-0000-0000-0000-000000000009') r),
  0.10::numeric, 'and its commission is still the flat snapshotted rate');
select is(
  (select count(*)::int from public.commission_split('94000000-0000-0000-0000-000000000008','94000000-0000-0000-0000-000000000009', 1)),
  1, 'with the one standard line it has always had');

-- ---------------------------------------------------------------------------
-- A JOINT TENANCY NEEDS ONLY THE RAIL. Not an agreement, not a referencing mode.
-- Standard terms for a tenancy are one month's rent for the WHOLE tenancy, split
-- by share, at the standard rate on the tenancy — not one month each.
-- ---------------------------------------------------------------------------
select is(
  (select fee_amount from public.resolve_fee(
     '94000000-0000-0000-0000-000000000005','94000000-0000-0000-0000-000000000001', 2400, 2)),
  2400::numeric,
  'a standard-terms agency of ours: a pair is one month''s rent for the tenancy, not one month each');
select is(
  public.apportion(2400, array[50,50]::numeric[]), array[1200.00, 1200.00]::numeric[],
  'split by share');
select is(
  public.commission_total('94000000-0000-0000-0000-000000000005','94000000-0000-0000-0000-000000000001', 2),
  0.10::numeric,
  'at the standard rate on the tenancy, which is 10% of one fee and not of two');
select is(
  (select source from public.commission_split(
     '94000000-0000-0000-0000-000000000005','94000000-0000-0000-0000-000000000001', 2) where level='agency'),
  'standard', 'and the line says it is the standard, having no agreement to name');

select * from finish();
rollback;
