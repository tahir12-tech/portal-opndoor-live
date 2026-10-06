-- R6. A COMMISSION RATE CHANGES THROUGH THE FRONT DOOR OR NOT AT ALL.
--
-- Commission rates and negotiated bands were writable straight from the
-- browser. `partners.partner_rate`, `partners.agent_rate`,
-- `pricing_agreement_bands.agent_rate` and `commission_tiers.agent_rate` all
-- carried UPDATE for `authenticated`, and RLS let an opndoor admin through.
-- So a PATCH moved a commission rate with nothing recording that it happened.
--
-- The governed path exists and is good: `update_partner_settings` is
-- SECURITY DEFINER and writes `partner_audit`. It was simply OPTIONAL.
--
-- THE BANDS ARE WORSE THAN THE RATES, and this is the part the finding did
-- not say. The 50% cap is enforced by `assert_agreement_within_cap`, which is
-- called by the RPC that saves an agreement -- it is NOT a trigger. So a
-- direct INSERT of a band bypasses the cap entirely: an admin could write a
-- 90% band from the browser and no check would ever see it. Assertion 5 is
-- that, and it is the reason INSERT and DELETE are revoked here and not only
-- UPDATE.
--
-- WHY COLUMN GRANTS RATHER THAN A TABLE REVOKE on `partners`: nothing found
-- in the client PATCHes that table today, but it carries a dozen
-- non-commercial columns and a blanket revoke would be a wider change than
-- the finding. The commercial columns are named and taken; everything else is
-- handed straight back. Assertion 3 is the guard on that.
--
-- AND THE ORDER MATTERS. A column-level REVOKE cannot subtract from a
-- table-level GRANT: the table revoke must come FIRST, then the columns are
-- granted back. That is the lesson from the live hotfix, and assertion 1
-- would pass vacuously if it were done the other way round.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('ce000000-0000-0000-0000-0000000000d1','zzz-r6-supplier','ZZZ R6 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('ce000000-0000-0000-0000-0000000000a1','ce000000-0000-0000-0000-0000000000d1','ZZZ R6 Agency');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ce000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.r6.admin@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ce000000-0000-0000-0000-00000000c001','ZZZ R6 Admin','zzz.r6.admin@r.test','superadmin',null,'active',true);

insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, is_standard)
values ('ce000000-0000-0000-0000-0000000000e1','agency','ce000000-0000-0000-0000-0000000000a1',
        current_date - 10, false);
insert into public.pricing_agreement_bands (id, agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('ce000000-0000-0000-0000-0000000000f1','ce000000-0000-0000-0000-0000000000e1',
        1, null, 4.35, 0.20);

-- ===========================================================================
-- THE PRIVILEGE ITSELF. Checked before any attempt, because a privilege that
-- is absent makes every "it was refused" assertion below vacuous.
-- ===========================================================================
select is(
  has_column_privilege('authenticated', 'public.partners', 'partner_rate', 'UPDATE'),
  false,
  'authenticated holds no UPDATE on partners.partner_rate');

select is(
  has_column_privilege('authenticated', 'public.partners', 'agent_rate', 'UPDATE'),
  false,
  'nor on partners.agent_rate');

-- THE REGRESSION GUARD. Everything that is not a commission rate is still
-- writable, so this is a scalpel and not a table revoke.
select is(
  has_column_privilege('authenticated', 'public.partners', 'name', 'UPDATE'),
  true,
  'while every non-commercial column on partners is handed straight back');

-- ===========================================================================
-- THE ADMIN, WITH A SECOND FACTOR, IS STILL REFUSED. RLS lets them through;
-- the grant is what stops them, which is why this is measured as the admin
-- rather than as a manager who would be refused anyway.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(public.is_admin(), true, 'the caller really is an opndoor admin, so RLS is not what refuses');

select throws_ok(
  $$update public.partners set agent_rate = 0.45 where id = 'ce000000-0000-0000-0000-0000000000d1'$$,
  '42501', 'permission denied for table partners',
  'an admin cannot move a commission rate straight from the browser');

-- ===========================================================================
-- THE BANDS. A direct INSERT would bypass assert_agreement_within_cap
-- entirely, because the cap is called by the save RPC and is not a trigger.
-- ===========================================================================
select throws_ok(
  $$insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
    values ('ce000000-0000-0000-0000-0000000000e1', 2, null, 5.00, 0.90)$$,
  '42501', 'permission denied for table pricing_agreement_bands',
  'and cannot write a 90% band straight in, which would never meet the cap');

select throws_ok(
  $$update public.pricing_agreement_bands set agent_rate = 0.90
     where id = 'ce000000-0000-0000-0000-0000000000f1'$$,
  '42501', 'permission denied for table pricing_agreement_bands',
  'nor raise an existing band past it');

reset role;

-- ===========================================================================
-- AND THE FRONT DOOR STILL OPENS. A fix that shut the governed path too
-- would stop Opndoor changing its own rates at all.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.update_partner_settings('zzz-r6-supplier','ZZZ R6 Supplier','active',
      current_date, 0.30, 0.12, 'pre_referenced_open', true, true)$$,
  'the governed RPC still changes a rate, which is the whole point of closing the other door');

select * from finish();
rollback;
