/* A JOINT REFERRAL TAKES THE SAME ESTATE CHECK AS A SINGLE ONE.
   Migration: 20261008010000.

   Matt, 2026-10-04: "apply the same estate check to joint referrals as single
   ones, so Kestrel's agency share on a joint referral follows the deal (10%),
   not the tenant count."

   THE ASSERTION THAT MATTERS is the one comparing the two paths. Before this
   migration a supplier's single referral froze the share from its agent_share
   deal and its JOINT referral froze the estate's additive split, so the same
   supplier under the same deal paid its agencies a different rate depending
   on how many people were on the tenancy. The fixture gives the two sources
   different numbers on purpose, so a path reading the wrong one cannot pass by
   coincidence. */
begin;
select plan(9);

-- ===========================================================================
-- FIXTURES. A carved supplier whose two possible share sources DISAGREE.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate,
                             opndoor_pays_agents)
values ('ee000000-0000-0000-0000-00000000f001','zzz-estate-sup','ZZZ Estate Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false);
insert into public.agencies (id, partner_id, name) values
  ('ee000000-0000-0000-0000-00000000a001','ee000000-0000-0000-0000-00000000f001','ZZZ Estate Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('ee000000-0000-0000-0000-00000000b001','ee000000-0000-0000-0000-00000000a001',
   'ee000000-0000-0000-0000-00000000f001','ZZZ Estate Office');

/* THE OTHER SOURCE: an agency-scope COMMISSION deal whose two-or-more band
   pays 20%, double the supplier's flat agent_rate of 10%. This is dev's real
   Kestrel shape, and it is what commission_total returns. */
insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, effective_from, is_standard, kind)
values ('ee000000-0000-0000-0000-00000000d001','agency','ee000000-0000-0000-0000-00000000a001',
        'additive','month','agency', current_date - 1, false, 'commission');
insert into public.pricing_agreement_bands
  (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('ee000000-0000-0000-0000-00000000d001', 1, 1, 1, 'months', 0.10),
       ('ee000000-0000-0000-0000-00000000d001', 2, null, 5, 'weeks', 0.20);

-- AND OUR OWN ESTATE, to prove the agency rail did not move.
insert into public.agencies (id, partner_id, name) values
  ('ee000000-0000-0000-0000-00000000a002',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ Own Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('ee000000-0000-0000-0000-00000000b002','ee000000-0000-0000-0000-00000000a002',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ Own Office');
update public.agencies set agent_rate = 0.1500
 where id = 'ee000000-0000-0000-0000-00000000a002';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ee000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.estate@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ee000000-0000-0000-0000-00000000c001','ZZZ Estate Admin','zzz.estate@opndoor.test',
   'superadmin', null,'active',true);

/* THE TWO SOURCES REALLY DO DISAGREE, asserted before anything is created so
   that the assertions below are known to be discriminating. */
select is(
  public.commission_total('ee000000-0000-0000-0000-00000000b001',
                          'ee000000-0000-0000-0000-00000000f001', 2),
  0.20::numeric,
  'the estate split would say 20% at two tenants');
select is(
  (select r.agent_rate from public.resolve_rates(
     'ee000000-0000-0000-0000-00000000b001','ee000000-0000-0000-0000-00000000f001', 2) r),
  0.10::numeric,
  'and the supplier''s own deal says 10%');

select set_config('request.jwt.claims',
  '{"sub":"ee000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. THE SUPPLIER RAIL: the deal, not the tenant count.
-- ===========================================================================
select lives_ok(
  $$select public.create_joint_referral(
      'ee000000-0000-0000-0000-00000000b001',
      '[{"title":"Mr","first":"Es","last":"One","dob":"1990-01-01","email":"zzz.e1@t.test","phone":"07700900601","share_percent":50},
        {"title":"Ms","first":"Es","last":"Two","dob":"1991-01-01","email":"zzz.e2@t.test","phone":"07700900602","share_percent":50}]'::jsonb,
      '1 Estate Street', null, 'London', null, 'SW1A 1AA', 2000, current_date + 30)$$,
  'a two-tenant joint referral through a supplier is created');

/* THE SINGLE REFERRAL FOR THE COMPARISON, created here and read back below:
   `applications` carries no table grant for `authenticated`, every reader
   goes through an RPC, so the assertions run as ourselves. */
select lives_ok(
  $$select public.create_referral(
      'ee000000-0000-0000-0000-00000000b001','Mr','Es','Three','1990-01-01',
      'zzz.e3@t.test','07700900603','1 Estate Street', null,'London', null,'SW1A 1AA',
      2000, current_date + 30)$$,
  'and a single referral through the same supplier is created');

reset role;

select is(
  (select count(*)::int from public.applications
    where tenant_email in ('zzz.e1@t.test','zzz.e2@t.test') and agent_rate = 0.10),
  2,
  'both applications freeze the supplier''s own 10%, not the estate''s 20%');

/* THE SAME NUMBER AS A SINGLE REFERRAL, which is the instruction stated as a
   relationship rather than as a literal: whatever the deal says, both paths
   have to say it. */
select is(
  (select agent_rate from public.applications where tenant_email = 'zzz.e3@t.test'),
  (select distinct agent_rate from public.applications
    where tenant_email in ('zzz.e1@t.test','zzz.e2@t.test')),
  'and the joint path freezes the same rate the single path does');

set local role authenticated;

-- ===========================================================================
-- 2. OUR OWN ESTATE IS UNTOUCHED, which is why the existing predicate was
--    used rather than a new one.
-- ===========================================================================
select lives_ok(
  $$select public.create_joint_referral(
      'ee000000-0000-0000-0000-00000000b002',
      '[{"title":"Mr","first":"Ow","last":"One","dob":"1990-01-01","email":"zzz.o1@t.test","phone":"07700900701","share_percent":50},
        {"title":"Ms","first":"Ow","last":"Two","dob":"1991-01-01","email":"zzz.o2@t.test","phone":"07700900702","share_percent":50}]'::jsonb,
      '2 Own Street', null, 'London', null, 'SW1A 1AA', 2000, current_date + 30)$$,
  'a joint referral on our own estate is created');

reset role;

select is(
  (select count(*)::int from public.applications a
    where a.tenant_email in ('zzz.o1@t.test','zzz.o2@t.test')
      and a.agent_rate = public.commission_total(a.branch_id, a.partner_id, 2)),
  2,
  'our own estate still takes the additive split');

/* AND STILL FREEZES IT. The lines ARE the split, so the gate has to move them
   together with the rate or a statement reads one and the application the
   other. */
select is(
  (select count(*)::int from public.application_commission_lines l
    join public.applications a on a.id = l.application_id
   where a.tenant_email in ('zzz.o1@t.test','zzz.o2@t.test')),
  2,
  'and still freezes a split line per applicant');

select * from finish();
rollback;
