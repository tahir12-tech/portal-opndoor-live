-- A TENANCY'S COMMISSION LINES SUM TO THE TENANCY'S COMMISSION.
--
-- Reported from the walk on GR-20845 / GR-20846: a £2,000 tenancy split 54/46,
-- fee £2,307.69, commission 25%.
--
--   £1,246.15 x 25% = 311.5375 -> £311.54
--   £1,061.54 x 25% = 265.3850 -> £265.39      sum £576.93
--   £2,307.69 x 25% = 576.9225 -> £576.92      the tenancy's own commission
--
-- A penny over, on every statement and reconciliation that adds those two lines.
-- The fee and the rent were already apportioned so their parts sum to the whole
-- exactly; commission was the last figure still rounded per line, so two halves of
-- one rounding could both go up.
--
-- AND IT WAS INTERMITTENT. The other joint tenancy on dev, £2,769.23 split 50/50,
-- summed correctly by luck. Half of them looked fine, which is why this is an
-- invariant over the sum and not a check of one figure.

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- THE ARITHMETIC, on the exact numbers that were reported. No fixtures, nothing
-- to set up, and it fails loudly if apportion ever stops taking the rounding on
-- the last share.
-- ---------------------------------------------------------------------------
select is(
  (select sum(x) from unnest(public.apportion(round(2307.69 * 0.25, 2), array[54, 46]::numeric[])) x),
  576.92::numeric,
  'the reported tenancy: apportioned, the lines sum to its commission exactly');

select is(
  round(1246.15 * 0.25, 2) + round(1061.54 * 0.25, 2),
  576.93::numeric,
  'and rounded per line they sum to a penny more, which is what was happening');

select is(
  public.apportion(round(2307.69 * 0.25, 2), array[54, 46]::numeric[]),
  array[311.54, 265.38]::numeric[],
  'the last line takes the rounding, so it is 265.38 and not 265.39');

-- An uneven three-way split is the case a 50/50 cannot expose: the remainder has
-- somewhere to hide when there are only two shares.
select is(
  (select sum(x) from unnest(public.apportion(round(2307.69 * 0.25, 2), array[33.33, 33.33, 33.34]::numeric[])) x),
  576.92::numeric,
  'and a three-way uneven split still sums to the tenancy commission to the penny');

-- ---------------------------------------------------------------------------
-- END TO END, through create_joint_referral, because the arithmetic being right
-- is not the same as the create path passing it the tenancy's numbers.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock, portal_referrals_enabled, partner_kind)
values ('97000000-0000-0000-0000-000000000001', 'zzz-comm', 'ZZZ Comm Estate', 'opndoor_referenced', 0.25, 0.10, true, true, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('97000000-0000-0000-0000-00000000000a', '97000000-0000-0000-0000-000000000001', 'ZZZ Comm Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-00000000000a', '97000000-0000-0000-0000-000000000001', 'Comm Park');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('97000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@zzzcomm.test', '', now(), now(), now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('97000000-0000-0000-0000-0000000000d1', 'Ada Comm', 'adm@zzzcomm.test', 'superadmin', null, 'active', true);

select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);

-- A rent whose fee does not divide cleanly three ways, and a split that is not
-- thirds either. If any of this were even the defect would hide.
select lives_ok($$
  select public.create_joint_referral(
    '97000000-0000-0000-0000-0000000000b1',
    '[{"title":"Ms","first":"Ann","last":"Comm","dob":"1990-01-01","email":"ann@zzzcomm.test","phone":"07700 900011","share_percent":41.5},
      {"title":"Mr","first":"Ben","last":"Comm","dob":"1991-01-01","email":"ben@zzzcomm.test","phone":"07700 900012","share_percent":33.25},
      {"title":"Mx","first":"Cai","last":"Comm","dob":"1992-01-01","email":"cai@zzzcomm.test","phone":"07700 900013","share_percent":25.25}]'::jsonb,
    '1 Comm Road', null, 'London', null, 'NW1 1CM', 1975, current_date + 30)
$$, 'a three-tenant referral on an uneven split is created');

select is(
  (select count(*)::int from public.applications where prop_postcode = 'NW1 1CM'),
  3, 'three applications, one per tenant');

-- THE PREMISE, AND A GUARD ON THIS TEST ITSELF. The three shares must actually
-- differ, or the fixture has drifted to an even split and everything below would
-- pass without exercising the defect at all: an even split is the case that was
-- already correct by luck. (Written as a count of DISTINCT fee shares, because
-- comparing a sum to itself is the vacuous assertion this replaced.)
select is(
  (select count(distinct fee_amount)::int from public.applications where prop_postcode = 'NW1 1CM'),
  3,
  'the three fee shares really are different, so the rounding has somewhere to go');

-- THE ASSERTION MATT ASKED FOR. Every payee's lines across the tenancy sum to
-- that payee's commission on the whole tenancy, to the penny. Driven off the
-- table rather than hardcoded, so it holds whatever the fee turns out to be.
select is(
  (select count(*)::int
     from (
       select l.level, coalesce(l.org_id::text, l.org_name) as payee,
              sum(l.amount) as lines_sum,
              round(sum(l.basis_amount) * max(l.rate), 2) as tenancy_commission
         from public.applications a
         join public.application_commission_lines l on l.application_id = a.id
        where a.prop_postcode = 'NW1 1CM'
        group by 1, 2
     ) g
    where g.lines_sum <> g.tenancy_commission),
  0,
  'every payee''s lines sum to their commission on the whole tenancy, exactly');

-- And the same sum computed the OLD way is what this test would have caught.
-- Asserted as "not worse than", because on a lucky split the two agree.
select ok(
  (select sum(l.amount) <= sum(round(l.basis_amount * l.rate, 2))
     from public.applications a
     join public.application_commission_lines l on l.application_id = a.id
    where a.prop_postcode = 'NW1 1CM'),
  'and never exceeds what per-line rounding produced, which only ever rounded up');

-- Nobody's line is null: a missing amount would fall back to the old arithmetic
-- at read time and quietly reintroduce the drift.
select is(
  (select count(*)::int from public.applications a
     join public.application_commission_lines l on l.application_id = a.id
    where a.prop_postcode = 'NW1 1CM' and l.amount is null),
  0, 'every line carries a frozen amount, so no reader falls back to recomputing');

-- ---------------------------------------------------------------------------
-- A TENANCY OF ONE IS UNCHANGED, which is most of the book.
-- ---------------------------------------------------------------------------
select lives_ok($$
  select public.create_referral(
    '97000000-0000-0000-0000-0000000000b1', 'Ms', 'Solo', 'Comm', '1990-01-01',
    'solo@zzzcomm.test', '07700 900014', '2 Comm Road', null, 'London', null, 'NW1 1CS',
    1975, current_date + 30)
$$, 'a single-tenant referral still works through the same freeze');

select is(
  (select count(*)::int from public.applications a
     join public.application_commission_lines l on l.application_id = a.id
    where a.prop_postcode = 'NW1 1CS'
      and l.amount <> round(l.basis_amount * l.rate, 2)),
  0,
  'and its line is worth exactly what it always was: one tenant, rounded once');

select * from finish();
rollback;
