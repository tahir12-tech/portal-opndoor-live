-- AN OPNDOOR MANAGER MAY REFER ON ANYBODY'S BEHALF, AND NOTHING MORE.
--
-- Matt (bb): "opndoor managers: give them the Suppliers list and each
-- supplier's page read-only (no editing settings, commission, keys or
-- people), and New application on behalf of any supplier or agency, the
-- same form admins use. Still no commission, settlements, bordereau,
-- opndoor team or Health."
--
-- RECORDED ON 2026-10-04 AND NEVER BUILT, in either half. The queue entry
-- said it in terms -- "that server guard has to learn about
-- opndoor_manager, or the form will offer a choice the database refuses" --
-- and neither the guard nor the form moved.
--
-- THE REFUSAL WAS STRUCTURAL, not a missing role in a list: the guard was
-- `is_admin() or (role in ('management','referrer') and pid =
-- app_partner())`, and an opndoor_manager has no partner at all, so the
-- second arm could not be true for them on any branch in the estate.
--
-- THE HALF THAT MATTERS MOST HERE IS WHAT STAYED SHUT. A grant is easy to
-- widen too far, and the sentence granting this one withholds five things
-- in its next breath. Assertions 4 and 5 are those.

begin;
select plan(5);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d6000000-0000-0000-0000-0000000000d1','zzz-om-supplier','ZZZ OM Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('d6000000-0000-0000-0000-0000000000a1','d6000000-0000-0000-0000-0000000000d1','ZZZ OM Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d6000000-0000-0000-0000-0000000000b1','d6000000-0000-0000-0000-0000000000a1',
   'd6000000-0000-0000-0000-0000000000d1','ZZZ OM Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d6000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.om.mgr@r.test','',now(),now(),now()),
       ('d6000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.om.sup@r.test','',now(),now(),now());
-- Opndoor staff sit on no estate: users_partner_by_role requires a NULL
-- partner_id for them, which is exactly why the old guard's second arm
-- could never be true for one.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d6000000-0000-0000-0000-00000000c001','ZZZ OM Manager','zzz.om.mgr@r.test','opndoor_manager',
   null,'active',true),
  ('d6000000-0000-0000-0000-00000000c002','ZZZ OM Supplier Mgmt','zzz.om.sup@r.test','management',
   'd6000000-0000-0000-0000-0000000000d1','active',true);

select set_config('request.jwt.claims',
  '{"sub":"d6000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-2. THEY MAY REFER, on a partner that is not theirs, which is the whole
--      of the grant. Proved on the real dev manager too (test@123.com
--      created GR-26537 against Kestrel, rolled back).
-- ===========================================================================
select is(public.app_role(), 'opndoor_manager',
  'the caller really is an opndoor manager, not an admin wearing one');

select lives_ok(
  $$select public.create_referral(
      'd6000000-0000-0000-0000-0000000000b1',
      'Mx','Omm','Tenant', date '1990-01-01','zzz.om.t@r.test','07700900980',
      '1 Manager Street', null, 'London', null, 'MG1 1AA', 1200, current_date + 40)$$,
  'and may send a referral on a supplier''s behalf, which was refused outright');

-- ===========================================================================
-- 3. AND SO MAY THEY CHOOSE THE ROUTE, which is the same question asked of
--    the same person and used to name admins alone in its error.
-- ===========================================================================
select lives_ok(
  $$select public.create_referral(
      'd6000000-0000-0000-0000-0000000000b1',
      'Mx','Omm','Routed', date '1990-01-01','zzz.om.r@r.test','07700900981',
      '2 Manager Street', null, 'London', null, 'MG1 1AA', 1200, current_date + 40,
      'd6000000-0000-0000-0000-0000000000d1')$$,
  'and may file it under a chosen route');

-- ===========================================================================
-- 4-5. AND NOTHING ELSE MOVED. (bb) withholds commission and settings in
--      the same sentence that grants the rest, so the grant is only safe if
--      those are still refused. `set_agency_rates` is the money, and it
--      keeps its own is_admin().
-- ===========================================================================
select throws_ok(
  $$select public.set_agency_rates('d6000000-0000-0000-0000-0000000000a1', 0.5, 0.2)$$,
  '42501',
  null,
  'but may NOT set an agency''s rates: the money stayed with admins');

reset role;
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_referral','create_joint_referral')
      and pg_get_functiondef(p.oid) like '%public.is_admin()%'),
  0::bigint,
  'and no is_admin() is left in either creator, so the two cannot disagree');

select * from finish();
rollback;
