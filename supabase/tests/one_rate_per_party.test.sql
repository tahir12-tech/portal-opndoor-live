-- ONE RATE PER PARTY, and what an agreement's coverage reaches.
--
-- The rule is structural, not precedence: a party holds an explicit rate OR a
-- negotiated agreement, never both, and the refusal comes from a TRIGGER so it
-- holds however the row is written. These assertions are the statement of that
-- rule that survives someone "simplifying" set_node_rate.
--
--   additive (the default)  the agreement resolves the party's own line and
--                           every other level still adds
--   all-in                  the agreement is the whole commission for its
--                           subtree; lines ABOVE it still add, deliberately

begin;
select plan(17);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate)
values ('91000000-0000-0000-0000-000000000001', 'zzz-rate-rail', 'One Rate Rail', 'opndoor_referenced', 0.25, 0.10);
insert into public.agency_groups (id, partner_id, name)
values ('91000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'One Rate Group');
insert into public.agencies (id, partner_id, name, group_id)
values ('91000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', 'One Rate Agency', '91000000-0000-0000-0000-000000000002'),
       ('91000000-0000-0000-0000-000000000005', '91000000-0000-0000-0000-000000000001', 'One Rate Sibling', '91000000-0000-0000-0000-000000000002');
insert into public.branches (id, agency_id, partner_id, name)
values ('91000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', 'One Rate Branch'),
       ('91000000-0000-0000-0000-000000000006', '91000000-0000-0000-0000-000000000005', '91000000-0000-0000-0000-000000000001', 'Sibling Branch');

-- ---------------------------------------------------------------------------
-- A rate, then an agreement on top of it: refused.
-- ---------------------------------------------------------------------------
update public.agencies set agent_rate = 0.12 where id = '91000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.agreement_conflicts('agency', '91000000-0000-0000-0000-000000000003', 'additive')),
  1, 'the screen can see the one arrangement an agreement would replace');
select is(
  (select detail from public.agreement_conflicts('agency', '91000000-0000-0000-0000-000000000003', 'additive')),
  'holds its own rate of 12.00%', 'and it names the rate, not just its existence');

select throws_ok(
  $$insert into public.pricing_agreements (scope_level, scope_id, effective_from)
    values ('agency', '91000000-0000-0000-0000-000000000003', current_date)$$,
  '22023', null,
  'an agreement cannot land on a party that already holds a rate, even by raw insert');

-- ---------------------------------------------------------------------------
-- An agreement, then a rate on top of it: refused, by trigger.
-- ---------------------------------------------------------------------------
update public.agencies set agent_rate = null where id = '91000000-0000-0000-0000-000000000003';
insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, coverage)
values ('91000000-0000-0000-0000-00000000000a', 'agency', '91000000-0000-0000-0000-000000000003', current_date, 'additive');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('91000000-0000-0000-0000-00000000000a', 1, null, 5, 0.20);

select throws_ok(
  $$update public.agencies set agent_rate = 0.15 where id = '91000000-0000-0000-0000-000000000003'$$,
  '22023', null,
  'a rate cannot land on a party an agreement already prices');
select lives_ok(
  $$update public.agencies set agent_rate = null where id = '91000000-0000-0000-0000-000000000003'$$,
  'clearing to null is always allowed, so a party is never stuck');

-- ADDITIVE: the agreement supplies the agency's line and other levels still add.
select is(
  public.commission_total('91000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001'),
  0.20::numeric, 'additive: the agreement alone gives 20%');
update public.agency_groups set agent_rate = 0.02 where id = '91000000-0000-0000-0000-000000000002';
select is(
  public.commission_total('91000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001'),
  0.22::numeric, 'additive: an explicit group line still adds on top, 20% + 2%');
update public.branches set agent_rate = 0.03 where id = '91000000-0000-0000-0000-000000000004';
select is(
  public.commission_total('91000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001'),
  0.25::numeric, 'additive: and so does an explicit branch line, 20% + 2% + 3%');

-- ---------------------------------------------------------------------------
-- ALL-IN at the agency: the subtree goes quiet, the group above does not.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.agreement_conflicts('agency', '91000000-0000-0000-0000-000000000003', 'all_in')),
  2, 'all-in also has to clear what is inside the subtree: the branch rate and the standing agreement');

update public.branches set agent_rate = null where id = '91000000-0000-0000-0000-000000000004';

-- The group's 2% line is above this agency, and an all-in landing UNDER a line
-- that already exists is the same breach as the line being added over it later
-- (20261003120000). So the setup for the all-in case now has to say out loud
-- that it is deliberate — which is the rule, not a workaround for it.
select throws_ok(
  $$update public.pricing_agreements set coverage = 'all_in'
     where id = '91000000-0000-0000-0000-00000000000a'$$,
  '22023', null,
  'an all-in signed underneath an existing group line is refused, the same as the line being added above it');

select set_config('app.confirm_all_in_breach', 'on', true);
update public.pricing_agreements set coverage = 'all_in', ended_at = null
 where id = '91000000-0000-0000-0000-00000000000a';
select set_config('app.confirm_all_in_breach', 'off', true);

select is(
  (select count(*)::int from public.commission_split('91000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001')),
  2, 'all-in at the agency: the agency''s line, and the group above it');
select is(
  public.commission_total('91000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000001'),
  0.22::numeric, 'all-in at the agency covers its branches but NOT its group: 20% + 2%');
select throws_ok(
  $$update public.branches set agent_rate = 0.03 where id = '91000000-0000-0000-0000-000000000004'$$,
  '22023', null,
  'nothing inside an all-in subtree may set a rate of its own');
select is(
  public.commission_total('91000000-0000-0000-0000-000000000006','91000000-0000-0000-0000-000000000001'),
  0.12::numeric, 'a sibling agency outside the deal is untouched: standard 10% + group 2%');

-- THE CAP, against the shape as configured.
select is(
  public.assert_agreement_within_cap('91000000-0000-0000-0000-00000000000a'),
  0.22::numeric, 'all-in: the cap sees the agreement plus the lines ABOVE it');
update public.pricing_agreements set coverage = 'additive' where id = '91000000-0000-0000-0000-00000000000a';
select is(
  public.assert_agreement_within_cap('91000000-0000-0000-0000-00000000000a'),
  0.22::numeric, 'additive with no branch line: the same 22%');
update public.pricing_agreement_bands set agent_rate = 0.49
 where agreement_id = '91000000-0000-0000-0000-00000000000a';
select throws_ok(
  $$select public.assert_agreement_within_cap('91000000-0000-0000-0000-00000000000a')$$,
  '22023', null,
  'and 49% plus the 2% group line breaks the 50% cap');

select * from finish();
rollback;
