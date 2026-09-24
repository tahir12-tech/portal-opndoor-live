-- THE ALL-IN GUARD, DOWNWARD, and the rail a joint tenancy may run on.
--
-- covering_all_in_agreement stops a party pricing itself UNDER a deal that
-- covers it. all_in_agreement_below stops a party pricing itself OVER one it
-- would breach: an agency on a 30% all-in whose group then adds 5% pays 35%,
-- which is under the 50% cap and is simply not the number anybody signed.
--
-- The guard is a TRIGGER, so it holds through set_node_rate, through
-- set_group_rates (which never goes near set_node_rate), and through a raw
-- UPDATE. A trigger cannot take an argument, so the deliberate override travels
-- as a transaction-local setting that only the RPC sets.
--
-- Also asserted here: a joint tenancy is agent-rail only. That belongs with
-- these because it is the same shape of rule — refused at the function that
-- actually knows, rather than only in the screen that might not.

begin;
select plan(22);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('93000000-0000-0000-0000-000000000001', 'zzz-guard-rail', 'Guard Rail', 'opndoor_referenced', 0.25, 0.10, true),
       ('93000000-0000-0000-0000-000000000009', 'zzz-guard-supplier', 'Guard Supplier', 'pre_referenced_open', 0.25, 0.10, true);
insert into public.agency_groups (id, partner_id, name)
values ('93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001', 'Guard Group');
insert into public.agencies (id, partner_id, name, group_id)
values ('93000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000001', 'Guard Agency', '93000000-0000-0000-0000-000000000002'),
       ('93000000-0000-0000-0000-000000000007', '93000000-0000-0000-0000-000000000009', 'Supplier Agency', null);
insert into public.branches (id, agency_id, partner_id, name)
values ('93000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000001', 'Guard Branch'),
       ('93000000-0000-0000-0000-000000000008', '93000000-0000-0000-0000-000000000007', '93000000-0000-0000-0000-000000000009', 'Supplier Branch');

-- An admin to be, because set_node_rate and create_agreement are MFA- and
-- admin-gated. Impersonated by setting the JWT claims, not by logging in — the
-- same move create_referral_position_scope.test.sql makes.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token) values
  ('93000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@zzz-guard.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status)
values ('93000000-0000-0000-0000-0000000000ff', 'Guard Admin', 'admin@zzz-guard.test', 'superadmin', null, 'active');
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);

-- The agency signs an all-in at 30%.
insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, coverage)
values ('93000000-0000-0000-0000-00000000000a', 'agency', '93000000-0000-0000-0000-000000000003', current_date, 'all_in');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('93000000-0000-0000-0000-00000000000a', 1, null, 4.35, 0.30);

select is(
  public.commission_total('93000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000001'),
  0.30::numeric, 'the all-in agency pays exactly what it signed');

-- ---------------------------------------------------------------------------
-- WHICH WAY EACH LOOKS.
-- ---------------------------------------------------------------------------
select is(
  public.all_in_agreement_below('group', '93000000-0000-0000-0000-000000000002'),
  '93000000-0000-0000-0000-00000000000a'::uuid,
  'the group can see the all-in beneath it');
select is(
  public.all_in_agreement_below('agency', '93000000-0000-0000-0000-000000000003'),
  null, 'and a party never counts its own agreement as being below itself');
select is(
  public.covering_all_in_agreement('branch', '93000000-0000-0000-0000-000000000004'),
  '93000000-0000-0000-0000-00000000000a'::uuid,
  'while the branch beneath it still sees the deal above, as it always did');

-- ---------------------------------------------------------------------------
-- THE REFUSAL, through all three doors, naming the deal and the arithmetic.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.set_node_rate('group', '93000000-0000-0000-0000-000000000002', 0.05)$$,
  '22023', null,
  'set_node_rate refuses a group line over an all-in below');

select throws_ok(
  $$select public.set_group_rates('93000000-0000-0000-0000-000000000002', null, 0.05)$$,
  '22023', null,
  'and so does set_group_rates, which never goes near set_node_rate');

select throws_ok(
  $$update public.agency_groups set agent_rate = 0.05
     where id = '93000000-0000-0000-0000-000000000002'$$,
  '22023', null,
  'and so does a raw UPDATE, which is the whole reason this is a trigger');

select matches(
  public.all_in_breach_detail('group', '93000000-0000-0000-0000-000000000002', 0.05),
  'Guard Agency.*30\.00%.*35\.00%',
  'the refusal names the deal below, what was agreed, and what would actually be paid');

-- An ADDITIVE AGREEMENT above an all-in is NOT a breach, and refusing it was a
-- false positive (20261003120000). resolve_pricing_agreement takes the single
-- most specific agreement and 'agency' sorts before 'group', so the all-in wins
-- for that agency's branches and the group's deal never reaches them; the group
-- slot then reads g.agent_rate, which is null because the group holds an
-- agreement rather than a rate. The deal is real for every OTHER agency in the
-- group -- it is simply inert for this one.
select lives_ok(
  $$select public.create_agreement('group', '93000000-0000-0000-0000-000000000002', 'additive', 'year', 'group',
      '[{"min":1,"max":null,"weeks":4.35,"rate":0.05}]'::jsonb, '[]'::jsonb, null, true)$$,
  'a group AGREEMENT above an all-in is allowed: it never reaches that agency''s branches');
select is(
  public.commission_total('93000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000001'),
  0.30::numeric, 'and the all-in agency still pays exactly the 30% it signed');
-- Put it back, so what follows tests the rate path from a clean state.
update public.pricing_agreements set ended_at = now()
 where scope_level = 'group' and scope_id = '93000000-0000-0000-0000-000000000002' and not is_standard;

-- ---------------------------------------------------------------------------
-- WHAT IS NOT A BREACH.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.set_node_rate('group', '93000000-0000-0000-0000-000000000002', null)$$,
  'clearing a rate removes a line, so it can never breach a deal below');

update public.pricing_agreements set coverage = 'additive'
 where id = '93000000-0000-0000-0000-00000000000a';
select lives_ok(
  $$select public.set_node_rate('group', '93000000-0000-0000-0000-000000000002', 0.05)$$,
  'an ADDITIVE agreement below is not breached: other levels adding on top is its definition');
select is(
  public.commission_total('93000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000001'),
  0.35::numeric, 'and that is exactly the 30% + 5% the ruling describes');

-- ---------------------------------------------------------------------------
-- THE DELIBERATE OVERRIDE, and that it does not leak.
-- ---------------------------------------------------------------------------
update public.agency_groups set agent_rate = null where id = '93000000-0000-0000-0000-000000000002';
update public.pricing_agreements set coverage = 'all_in'
 where id = '93000000-0000-0000-0000-00000000000a';

select lives_ok(
  $$select public.set_node_rate('group', '93000000-0000-0000-0000-000000000002', 0.05, true)$$,
  'confirmed, it goes through');
select is(
  (select count(*)::int from public.org_audit
    where action = 'all_in_breach_confirmed'
      and entity_id in ('93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000003')),
  2, 'and is audited against BOTH parties: the one who set it and the one whose deal moved');
select throws_ok(
  $$update public.agency_groups set agent_rate = 0.07
     where id = '93000000-0000-0000-0000-000000000002'$$,
  '22023', null,
  'the confirmation does not stand for the next write, even in the same transaction');

-- ---------------------------------------------------------------------------
-- THE MIRROR: the same breach reached by doing the two writes in the other
-- order. Without this the guard is bypassed by signing the deal second.
-- ---------------------------------------------------------------------------
update public.pricing_agreements set ended_at = now()
 where id = '93000000-0000-0000-0000-00000000000a';
update public.agency_groups set agent_rate = null where id = '93000000-0000-0000-0000-000000000002';
-- The group's line goes on FIRST, while there is nothing below it to breach.
select lives_ok(
  $$select public.set_node_rate('group', '93000000-0000-0000-0000-000000000002', 0.05)$$,
  'a group line with no all-in below it is simply a group line');

select throws_ok(
  $$select public.create_agreement('agency', '93000000-0000-0000-0000-000000000003', 'all_in', 'year', 'agency',
      '[{"min":1,"max":null,"weeks":4.35,"rate":0.30}]'::jsonb, '[]'::jsonb, null, true)$$,
  '22023', null,
  'and an all-in signed UNDERNEATH it is the same breach, refused the same way');

select lives_ok(
  $$select public.create_agreement('agency', '93000000-0000-0000-0000-000000000003', 'all_in', 'year', 'agency',
      '[{"min":1,"max":null,"weeks":4.35,"rate":0.30}]'::jsonb, '[]'::jsonb, null, true, true)$$,
  'confirmed, the deal is signed');

-- ---------------------------------------------------------------------------
-- RE-PARENTING: a fourth door that touches no rate at all, so no rate trigger
-- would ever see it.
-- ---------------------------------------------------------------------------
update public.agencies set group_id = null where id = '93000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.set_agency_group('93000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000002')$$,
  '22023', null,
  'moving an all-in agency under a group that already charges is refused too');

-- ---------------------------------------------------------------------------
-- A JOINT TENANCY IS AGENT-RAIL ONLY.
-- ---------------------------------------------------------------------------
select is(
  public.origin_referencing_mode('Supplier Agency', 'Supplier Branch', 'zzz-guard-supplier'),
  'pre_referenced_open',
  'the form can ask which rail an origin runs on before it offers a second tenant');

select throws_ok(
  $$select public.create_joint_referral('93000000-0000-0000-0000-000000000008',
      '[{"title":"Ms","first":"A","last":"One","dob":"1990-01-01","email":"a@example.test","phone":"07700 900001","share_percent":50},
        {"title":"Mr","first":"B","last":"Two","dob":"1991-01-01","email":"b@example.test","phone":"07700 900002","share_percent":50}]'::jsonb,
      '1 Test Road', null, 'London', null, 'NW1 8LH', 2000, current_date + 30)$$,
  '22023', null,
  'and the RPC refuses a joint tenancy on a pre-referenced rail whatever the form offered');

select * from finish();
rollback;
