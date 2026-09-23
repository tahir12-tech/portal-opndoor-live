-- The additive commission rule, pinned to its four worked examples.
--
-- These moved here from a TypeScript mirror that drew the agency page. The mirror
-- is gone: commission_split is the only implementation, so the examples have to be
-- asserted against the function that actually freezes onto an application.
--
--   nothing set            -> agency 10%                        = 10%
--   group 2% only          -> agency 10% + group 2%             = 12%
--   branch 10% + group 2%  -> branch 10% + group 2%, agency 0   = 12%
--   agency 12% + group 2%  -> agency 12% + group 2%             = 14%
--
-- A branch rate REPLACES the agency's default (the branch is doing the referring)
-- but never its explicit rate.

begin;
select plan(13);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate)
values ('90000000-0000-0000-0000-000000000001', 'zzz-split-rail', 'Split Test Rail', 'opndoor_referenced', 0.25, 0.10);
insert into public.agency_groups (id, partner_id, name)
values ('90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Split Test Group');
insert into public.agencies (id, partner_id, name, group_id)
values ('90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Split Test Agency', '90000000-0000-0000-0000-000000000002');
insert into public.branches (id, agency_id, partner_id, name)
values ('90000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Split Test Branch');

-- 1. Nothing set: the agency earns the Opndoor standard, alone.
select is(
  (select count(*)::int from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001')),
  1, 'nothing set: exactly one line');
select is(
  (select level from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001')),
  'agency', 'nothing set: the line is the agency''s');
select is(
  public.commission_total('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001'),
  0.10::numeric, 'nothing set: total is the Opndoor standard 10%');

-- 2. A group rate alone ADDS to the agency default; it no longer replaces it.
update public.agency_groups set agent_rate = 0.02 where id = '90000000-0000-0000-0000-000000000002';
select is(
  public.commission_total('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001'),
  0.12::numeric, 'group 2% only: agency 10% + group 2% = 12%');
select is(
  (select rate from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001') where level = 'agency'),
  0.10::numeric, 'group 2% only: the agency still earns the standard');
select is(
  (select rate from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001') where level = 'group'),
  0.02::numeric, 'group 2% only: the group earns its own 2%');

-- 3. A branch rate replaces the agency's DEFAULT: the agency drops out entirely.
update public.branches set agent_rate = 0.10 where id = '90000000-0000-0000-0000-000000000004';
select is(
  public.commission_total('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001'),
  0.12::numeric, 'branch 10% + group 2%: total is still 12%');
select ok(
  not exists (select 1 from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001') where level = 'agency'),
  'branch 10% + group 2%: the agency earns nothing and is not a line');
select is(
  (select rate from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001') where level = 'branch'),
  0.10::numeric, 'branch 10% + group 2%: the branch earns its own 10%');

-- 4. An EXPLICIT agency rate is never displaced by a branch rate; they add.
update public.branches set agent_rate = null where id = '90000000-0000-0000-0000-000000000004';
update public.agencies set agent_rate = 0.12 where id = '90000000-0000-0000-0000-000000000003';
select is(
  public.commission_total('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001'),
  0.14::numeric, 'agency 12% + group 2% = 14%');
update public.branches set agent_rate = 0.01 where id = '90000000-0000-0000-0000-000000000004';
select is(
  public.commission_total('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001'),
  0.15::numeric, 'a branch rate ADDS to an explicit agency rate rather than replacing it');

-- The preview answers the same arithmetic without writing, which is the only
-- reason the rule is extracted: the editor and the save cannot disagree.
update public.branches set agent_rate = null where id = '90000000-0000-0000-0000-000000000004';
select is(
  (select worst_total from public.commission_preview('group', '90000000-0000-0000-0000-000000000002', 0.05)),
  0.17::numeric, 'preview: agency 12% + a drafted group 5% would total 17%');
select is(
  (select worst_total from public.commission_preview('agency', '90000000-0000-0000-0000-000000000003', null)),
  0.12::numeric, 'preview: clearing the agency rate drops it back to the standard, so 10% + group 2%');

select * from finish();
rollback;
