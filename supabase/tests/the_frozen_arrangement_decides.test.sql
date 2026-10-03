-- WHO OPNDOOR PAYS IS DECIDED BY THE ARRANGEMENT FROZEN AT CREATION.
--
-- Matt, 2026-10-03: "under that setting [opndoor pays the agents] the
-- supplier's commission and the agency's commission are separate and the total
-- is their sum ... If a referral is frozen under 'the supplier pays its own
-- agents', the agency's share comes out of the supplier's total and Opndoor
-- pays only the supplier."
--
-- THE FROZEN ROWS CANNOT TELL THE TWO APART. freeze_commission_lines writes an
-- agency line and a supplier line, each its own rate on the same basis,
-- neither reduced by the other, under BOTH arrangements. It never read
-- opndoor_pays_agents. So the arrangement was being supplied by
-- partners.opndoor_pays_agents at READ time -- a mutable column, which on dev
-- moved twice under Kestrel with GR-FROST-KES created between the two flips.
-- Its statement and its settlement were therefore read under an arrangement it
-- was never sold under, and would have changed shape again at the next flip.
--
-- 20261007610000 snapshots it onto the application. 20261007620000 makes these
-- two readers ask the snapshot. This file is the proof, and it is built so that
-- the partner's LIVE flag is the opposite of one of the two referrals': if
-- either reader goes back to the live flag, half of these assertions fail.
--
-- NO FROZEN AMOUNT IS ASSERTED TO HAVE CHANGED, because none did. What is
-- asserted is how the same stored amounts are combined.

begin;
select plan(12);

-- ===========================================================================
-- ONE SUPPLIER, LIVE FLAG = "the supplier pays its own agents" (carved).
-- Two referrals under it, frozen one each way. June 2026, which holds nothing
-- on dev and is named in no other test file.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind, opndoor_pays_agents)
values ('98000000-0000-0000-0000-0000000000b1','zzz-frozen-sup','ZZZ Frozen Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, false, 'supplier', false);

insert into public.agencies (id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000b2','98000000-0000-0000-0000-0000000000b1','ZZZ Frozen Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000b3','98000000-0000-0000-0000-0000000000b2',
   '98000000-0000-0000-0000-0000000000b1','ZZZ Frozen Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('98000000-0000-0000-0000-0000000000b4'::uuid,'zzz.frozen.ref@f.test')
) as x(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('98000000-0000-0000-0000-0000000000b4','ZZZ Frozen Referrer','zzz.frozen.ref@f.test',
        'referrer','98000000-0000-0000-0000-0000000000b1','active',false);

-- THE TWO REFERRALS. Identical money, opposite frozen arrangements. Both on a
-- GBP 2,400 basis at 25% and 10%, so the figures below are Matt's own: 600,
-- 240, and 840 as their sum.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, fee_amount, tenancy_start, referencing_mode,
   partner_rate, agent_rate, status, sent_at, paid_at, livemode, payment_state,
   opndoor_pays_agents_at_freeze)
values
  ('98000000-0000-0000-0000-0000000000c1','ZZZ-FROZEN-SIBLINGS',
   '98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000b2',
   '98000000-0000-0000-0000-0000000000b3','98000000-0000-0000-0000-0000000000b4',
   'Ms','Sib','Tester','1990-01-01','zzz.sib@f.test','07700900101',
   '1 ZZZ Frozen Street','London','SW1A 1AA',
   2400, 2400, '2026-07-01', 'pre_referenced_open',
   0.25, 0.10, 'paid', '2026-06-10T10:00:00Z', '2026-06-15T10:00:00Z', true, 'paid',
   -- Opndoor pays the agents. The partner's live flag says the OPPOSITE.
   true),
  ('98000000-0000-0000-0000-0000000000c2','ZZZ-FROZEN-CARVED',
   '98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000b2',
   '98000000-0000-0000-0000-0000000000b3','98000000-0000-0000-0000-0000000000b4',
   'Mr','Carve','Tester','1990-01-01','zzz.carve@f.test','07700900102',
   '2 ZZZ Frozen Street','London','SW1A 1AA',
   2400, 2400, '2026-07-01', 'pre_referenced_open',
   0.25, 0.10, 'paid', '2026-06-10T10:00:00Z', '2026-06-15T10:00:00Z', true, 'paid',
   false);

-- ===========================================================================
-- 1. THE SNAPSHOT SURVIVED THE INSERT, and the trigger did not overwrite it.
-- ===========================================================================
select is(
  (select opndoor_pays_agents_at_freeze from public.applications
    where guarantee_ref = 'ZZZ-FROZEN-SIBLINGS'),
  true, 'a stated arrangement is kept, not re-derived from the partner');

select is(
  (select opndoor_pays_agents_at_freeze from public.applications
    where guarantee_ref = 'ZZZ-FROZEN-CARVED'),
  false, 'and so is the other one');

-- AND THE TRIGGER STAMPS ONE WHEN THE CALLER STATES NOTHING, which is the
-- path every new referral takes. The partner's flag is false, so false.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, fee_amount, tenancy_start, referencing_mode,
   partner_rate, agent_rate, status, sent_at, livemode)
values
  ('98000000-0000-0000-0000-0000000000c3','ZZZ-FROZEN-STAMPED',
   '98000000-0000-0000-0000-0000000000b1','98000000-0000-0000-0000-0000000000b2',
   '98000000-0000-0000-0000-0000000000b3','98000000-0000-0000-0000-0000000000b4',
   'Mr','Stamp','Tester','1990-01-01','zzz.stamp@f.test','07700900103',
   '3 ZZZ Frozen Street','London','SW1A 1AA',
   2400, 2400, '2026-07-01', 'pre_referenced_open',
   0.25, 0.10, 'sent', '2026-06-10T10:00:00Z', true);

select is(
  (select opndoor_pays_agents_at_freeze from public.applications
    where guarantee_ref = 'ZZZ-FROZEN-STAMPED'),
  false, 'a new referral is stamped from the partner as it stands at creation');

-- ===========================================================================
-- 2. THE SUPPLIER'S OWN STATEMENT. Same two referrals, two shapes.
-- ===========================================================================
select is(
  (select total_amount from public.supplier_statement_lines(
     '98000000-0000-0000-0000-0000000000b1', date '2026-06-01')
    where guarantee_ref = 'ZZZ-FROZEN-SIBLINGS'),
  840.00, 'frozen as siblings, the total is the SUM of the two shares');

select is(
  (select supplier_amount from public.supplier_statement_lines(
     '98000000-0000-0000-0000-0000000000b1', date '2026-06-01')
    where guarantee_ref = 'ZZZ-FROZEN-SIBLINGS'),
  600.00, 'and the supplier keeps its whole 25%, not 25% less the agency');

select is(
  (select total_amount from public.supplier_statement_lines(
     '98000000-0000-0000-0000-0000000000b1', date '2026-06-01')
    where guarantee_ref = 'ZZZ-FROZEN-CARVED'),
  600.00, 'frozen as carved, the total is the 25% and the agency sits inside it');

select is(
  (select supplier_amount from public.supplier_statement_lines(
     '98000000-0000-0000-0000-0000000000b1', date '2026-06-01')
    where guarantee_ref = 'ZZZ-FROZEN-CARVED'),
  360.00, 'and the supplier keeps what is left after the carve-out');

-- THE AGENTS' SHARE IS THE SAME NUMBER UNDER BOTH, which is the point: what
-- changes is who pays it, never how much it is.
select is(
  (select count(distinct agent_amount)::int from public.supplier_statement_lines(
     '98000000-0000-0000-0000-0000000000b1', date '2026-06-01')
    where guarantee_ref in ('ZZZ-FROZEN-SIBLINGS','ZZZ-FROZEN-CARVED')),
  1, 'the agents'' share is the same figure under either arrangement');

-- ===========================================================================
-- 3. THE SETTLEMENT RUN. The agency is a payee of Opndoor only when the
--    arrangement frozen on the referral says Opndoor pays it.
-- ===========================================================================
select ok(
  exists (select 1 from public.commission_statement_lines(date '2026-06-01')
           where guarantee_ref = 'ZZZ-FROZEN-SIBLINGS' and level = 'agency'),
  'the siblings referral puts the agency on Opndoor''s statement run');

select ok(
  not exists (select 1 from public.commission_statement_lines(date '2026-06-01')
               where guarantee_ref = 'ZZZ-FROZEN-CARVED' and level = 'agency'),
  'and the carved one does not, because Opndoor pays only the supplier');

-- THE FIGURES, as a payee total. One agency line of 240 from the siblings
-- referral and nothing from the carved one.
select is(
  (select sum(commission) from public.commission_statement_lines(date '2026-06-01')
    where guarantee_ref in ('ZZZ-FROZEN-SIBLINGS','ZZZ-FROZEN-CARVED')
      and level = 'agency'),
  240.00, 'so Opndoor owes the agency 240 across the two, not 480 and not 0');

-- ===========================================================================
-- 4. AND THE LIVE FLAG IS NOT WHAT DECIDES, asserted by moving it.
--
-- The partner's flag has been false throughout. Set it true and NOTHING above
-- may change: both referrals carry their own snapshot. This is the assertion
-- that fails if either reader goes back to supplier_settles_its_own_agents.
-- ===========================================================================
update public.partners set opndoor_pays_agents = true
 where id = '98000000-0000-0000-0000-0000000000b1';

select ok(
  (select total_amount from public.supplier_statement_lines(
     '98000000-0000-0000-0000-0000000000b1', date '2026-06-01')
    where guarantee_ref = 'ZZZ-FROZEN-CARVED') = 600.00
  and not exists (select 1 from public.commission_statement_lines(date '2026-06-01')
                   where guarantee_ref = 'ZZZ-FROZEN-CARVED' and level = 'agency'),
  'flipping the partner''s live flag changes neither the statement nor the run');

select * from finish();
rollback;
