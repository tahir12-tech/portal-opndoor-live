-- A NEW SUPPLIER STARTS WITH NO DEAL.
--
-- Matt, 2026-10-03: "New suppliers must never get a default commission deal.
-- Today 'Add supplier' silently sets 25% of the fee with agencies at 10% (e.g.
-- ACME TEST). Change it so a new supplier starts with no deal at all."
--
-- THE DEFAULT WAS IN TWO PLACES, which is why it had gone unnoticed:
-- create_partner's parameters defaulted to 0.25 and 0.10, AND the columns
-- carried the same defaults, so an insert naming neither still produced a
-- deal. Both are gone and the columns are nullable.
--
-- NULL IS NOT ZERO. "No deal has been agreed" and "a deal of nothing" are
-- different facts and both are real: Letly sits at 0.00/0.00 on dev with a
-- commission agreement to match. Every assertion below turns on that
-- distinction.
--
-- AND A REFERRAL IS STILL CREATED. Matt moved "new referrals are refused" to
-- After launch, so resolve_rates coalesces to 0: a null would hit
-- applications.partner_rate's NOT NULL and refuse the referral with a
-- constraint error, which is the deferred behaviour arriving by accident.

begin;
select plan(9);

-- ===========================================================================
-- 1. THE COLUMNS THEMSELVES
-- ===========================================================================
select is(
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='partners' and column_name='partner_rate'),
  null, 'partner_rate has no column default to supply a silent deal');

select is(
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='partners' and column_name='agent_rate'),
  null, 'and neither has agent_rate');

select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='partners' and column_name='partner_rate'),
  'YES', 'and partner_rate may be null, which is what "no deal" is');

-- ===========================================================================
-- 2. A PARTNER INSERTED WITH NO RATE HAS NO RATE
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('9b000000-0000-0000-0000-0000000000f1','zzz-nodeal-sup','ZZZ No Deal Supplier',
        'pre_referenced_open', false, 'supplier');

select is(
  (select partner_rate from public.partners where slug='zzz-nodeal-sup'),
  null, 'a supplier created without a rate has none, rather than 25%');

select is(
  (select agent_rate from public.partners where slug='zzz-nodeal-sup'),
  null, 'and no agents'' share either, rather than 10%');

-- ===========================================================================
-- 3. AND A REFERRAL UNDER IT IS STILL PRICED, AT NOTHING
--
-- The half Matt deferred. resolve_rates must answer a number, because
-- applications.partner_rate is NOT NULL and the alternative is a constraint
-- error with no message.
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('9b000000-0000-0000-0000-0000000000f2','9b000000-0000-0000-0000-0000000000f1','ZZZ No Deal Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('9b000000-0000-0000-0000-0000000000f3','9b000000-0000-0000-0000-0000000000f2',
   '9b000000-0000-0000-0000-0000000000f1','ZZZ No Deal Office');

select is(
  (select r.partner_rate from public.resolve_rates(
     '9b000000-0000-0000-0000-0000000000f3','9b000000-0000-0000-0000-0000000000f1', 1) r),
  0::numeric, 'a referral under a dealless supplier resolves to 0, not to null');

select is(
  (select r.agent_rate from public.resolve_rates(
     '9b000000-0000-0000-0000-0000000000f3','9b000000-0000-0000-0000-0000000000f1', 1) r),
  0::numeric, 'and its agents'' share likewise, so nothing is owed to anybody');

-- ===========================================================================
-- 4. A RATE THAT IS SET STILL WINS, AND ZERO IS STILL A DEAL
--
-- The precedence this function has always had is untouched; the coalesce was
-- added at the END of it. Letly's shape is the one to protect: 0.00 is a
-- deal of nothing and must not be read as "unset" and replaced.
-- ===========================================================================
update public.partners set partner_rate = 0.00, agent_rate = 0.00
 where slug = 'zzz-nodeal-sup';

select is(
  (select r.partner_rate from public.resolve_rates(
     '9b000000-0000-0000-0000-0000000000f3','9b000000-0000-0000-0000-0000000000f1', 1) r),
  0.00::numeric, 'a deal of zero resolves to zero, which it already did');

update public.partners set partner_rate = 0.35
 where slug = 'zzz-nodeal-sup';

select is(
  (select r.partner_rate from public.resolve_rates(
     '9b000000-0000-0000-0000-0000000000f3','9b000000-0000-0000-0000-0000000000f1', 1) r),
  0.35::numeric, 'and a real rate still wins over the new fallback');

select * from finish();
rollback;
