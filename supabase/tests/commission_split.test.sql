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
select plan(17);

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
/* THE PREVIEW NEEDS AN IDENTITY NOW, and this suite had none.
   commission_preview is gated on may_see_commission() (20261005170000), which
   is false with no claims set: no auth.uid(), no admin, no capability. The
   rest of the file tests pure rule functions that take their inputs as
   arguments and rightly do not care who is asking, so nothing here
   authenticated. The preview is the one that does care, because its entire
   output is a percentage.

   An Opndoor admin is the honest caller: setting a rate is admin only, so the
   rate editor's what-if is reached by nobody else. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('90000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@zzzsplit.test', '', now(), now(), now());
insert into public.users (id, full_name, email, role, status)
values ('90000000-0000-0000-0000-0000000000ad', 'Split Admin', 'admin@zzzsplit.test', 'superadmin', 'active');
select set_config('request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);

select is(
  (select worst_total from public.commission_preview('group', '90000000-0000-0000-0000-000000000002', 0.05)),
  0.17::numeric, 'preview: agency 12% + a drafted group 5% would total 17%');
select is(
  (select worst_total from public.commission_preview('agency', '90000000-0000-0000-0000-000000000003', null)),
  0.12::numeric, 'preview: clearing the agency rate drops it back to the standard, so 10% + group 2%');

-- A LINE NAMES ITS SOURCE, so no screen has to infer it. "No explicit rate set"
-- is true of a standard line AND of an agreement line, which is how a
-- negotiated 20% came to be captioned "Opndoor standard 20%".
select is(
  (select source from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001')
    where level = 'agency'),
  'rate', 'an explicit agency rate reports itself as a set rate');

update public.agencies set agent_rate = null where id = '90000000-0000-0000-0000-000000000003';
update public.agency_groups set agent_rate = null where id = '90000000-0000-0000-0000-000000000002';
select is(
  (select source from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001')
    where level = 'agency'),
  'standard', 'with nothing set, the line is the partner standard and says so');

insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, coverage)
values ('90000000-0000-0000-0000-00000000000a', 'agency', '90000000-0000-0000-0000-000000000003', current_date, 'additive');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('90000000-0000-0000-0000-00000000000a', 1, null, 3, 0.20);
select is(
  (select source from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001')
    where level = 'agency'),
  'agreement', 'and a negotiated rate reports itself as an agreement, not as the standard');
select is(
  (select rate from public.commission_split('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001')
    where level = 'agency'),
  0.20::numeric, 'at the agreement''s rate, which is not the 10% standard');

select * from finish();
rollback;
