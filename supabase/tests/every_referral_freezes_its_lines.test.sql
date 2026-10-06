/* EVERY REFERRAL FREEZES ITS COMMISSION LINES, WHATEVER THE ROUTE.
   Migration: 20261008060000.

   Matt, 2026-10-04: "Every referral freezes its commission lines at
   creation, whatever the route ... backfill the stored lines for existing
   supplier referrals ... from their frozen rates."

   ALL THREE CREATION PATHS GATED THE FREEZE ON `v_estate`, false for a
   supplier, so a portal-created supplier referral stored nothing. It looked
   fine because dev's older supplier rows were seeded with their lines. */
begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate, opndoor_pays_agents)
values ('e5500000-0000-0000-0000-00000000f001','zzz-freeze-sup','ZZZ Freeze Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false);
insert into public.agencies (id, partner_id, name) values
  ('e5500000-0000-0000-0000-00000000a001','e5500000-0000-0000-0000-00000000f001','ZZZ Freeze Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e5500000-0000-0000-0000-00000000b001','e5500000-0000-0000-0000-00000000a001',
   'e5500000-0000-0000-0000-00000000f001','ZZZ Freeze Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e5500000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.frz@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e5500000-0000-0000-0000-00000000c001','ZZZ Freeze Admin','zzz.frz@opndoor.test','superadmin',null,'active',true);

select set_config('request.jwt.claims',
  '{"sub":"e5500000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. THE SINGLE PORTAL PATH, which is how GR-25831 was made.
-- ===========================================================================
select lives_ok(
  $$select public.create_referral(
      'e5500000-0000-0000-0000-00000000b001','Mr','Sol','Freeze','1990-01-01',
      'zzz.s1@t.test','07700900801','1 Freeze Way', null,'London', null,'SW1A 1AA',
      1000, current_date + 30)$$,
  'a single supplier referral is created');

reset role;
select is(
  (select count(*)::int from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email = 'zzz.s1@t.test'),
  2,
  'and it stores two lines, the supplier''s and the agency''s');

/* FROM THE ROW, NOT FROM commission_split. The fixture's agent_rate is
   0.1000 and there is no agency-scope deal, so this would pass either way on
   a clean fixture; it is asserted against the APPLICATION's own value so the
   claim is "it restates the row" rather than "it happens to match". */
select is(
  (select l.rate from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email = 'zzz.s1@t.test' and l.level = 'agency'),
  (select agent_rate from public.applications where tenant_email = 'zzz.s1@t.test'),
  'the agency line restates the rate frozen on the application');

select is(
  (select l.rate from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email = 'zzz.s1@t.test' and l.level = 'supplier'),
  (select partner_rate from public.applications where tenant_email = 'zzz.s1@t.test'),
  'and the supplier line restates the total frozen on it');

select is(
  (select l.amount from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email = 'zzz.s1@t.test' and l.level = 'supplier'),
  250.00::numeric,
  'and the money is the fee times that rate');

-- ===========================================================================
-- 2. THE JOINT PORTAL PATH, which 20261008010000 had gated.
-- ===========================================================================
set local role authenticated;
select lives_ok(
  $$select public.create_joint_referral(
      'e5500000-0000-0000-0000-00000000b001',
      '[{"title":"Mr","first":"Jo","last":"Frz","dob":"1990-01-01","email":"zzz.j1@t.test","phone":"07700900802","share_percent":50},
        {"title":"Ms","first":"Di","last":"Frz","dob":"1991-01-01","email":"zzz.j2@t.test","phone":"07700900803","share_percent":50}]'::jsonb,
      '2 Freeze Way', null, 'London', null, 'SW1A 1AA', 1000, current_date + 30)$$,
  'a joint supplier referral is created');

reset role;
select is(
  (select count(*)::int from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email in ('zzz.j1@t.test','zzz.j2@t.test')),
  4,
  'and each of its two applications stores both lines');

/* APPORTIONED, NOT DOUBLED. Each applicant's line is their share of the
   tenancy's commission, so the pair sums to the whole rather than each
   carrying it. */
select is(
  (select sum(l.amount) from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email in ('zzz.j1@t.test','zzz.j2@t.test') and l.level = 'supplier'),
  250.00::numeric,
  'and the two supplier lines sum to the tenancy''s commission, not twice it');

-- ===========================================================================
-- 3. IDEMPOTENT, which the backfill depends on.
-- ===========================================================================
select lives_ok(
  $$select public.freeze_commission_lines(
      (select id from public.applications where tenant_email = 'zzz.s1@t.test'),
      'e5500000-0000-0000-0000-00000000b001','e5500000-0000-0000-0000-00000000f001',
      1, 1000)$$,
  'freezing twice is safe, which is what lets the backfill reuse this shape');

select * from finish();
rollback;
