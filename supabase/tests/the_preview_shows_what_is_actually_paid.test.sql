-- R3. THE PREVIEW MUST SHOW WHAT IS ACTUALLY PAID.
--
-- `commission_preview` is what an operator is shown before they change a
-- rate: "this would take the worst branch to N% of the fee". It computes that
-- from the party's own rate COLUMNS and the partner standard, and never looks
-- at pricing agreements at all.
--
-- For an agency priced by agreement that is not a small discrepancy, it is a
-- different number entirely -- because `enforce_agreement_exclusivity` means a
-- party holds a rate OR an agreement and never both. So an agreement-priced
-- agency has NO rate column, the preview falls through to the partner
-- standard, and the figure shown bears no relation to what is paid.
--
-- MEASURED on a clean local apply, one agency, one agreement, two bands:
--
--     the agreement's joint band              0.30
--     assert_agreement_within_cap sees        0.30   (correct)
--     commission_preview shows the operator   0.10   <-- the defect
--
-- WHAT DID NOT REPRODUCE, and is recorded rather than "fixed". The finding
-- also claimed the 50% cap is not enforced for joint tenancies. It is.
-- `agreement_max_rate` takes the MAX agent_rate across every band, joint
-- bands included, and `assert_agreement_within_cap` refuses on it -- measured,
-- with a 0.55 joint band rejected by name:
--
--     "This agreement could take a branch to 55.00% of the guarantee fee.
--      The most a branch may pay out in total is 50%."
--
-- Assertion 5 pins that down so the claim is not re-raised, and so that the
-- cap cannot be quietly removed later.

begin;
select plan(6);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('cb000000-0000-0000-0000-0000000000d1','zzz-r3-supplier','ZZZ R3 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true);

-- NO agent_rate on the agency: it is priced by agreement, and a party holds
-- one or the other, never both.
insert into public.agencies (id, partner_id, name, agent_rate) values
  ('cb000000-0000-0000-0000-0000000000a1','cb000000-0000-0000-0000-0000000000d1','ZZZ R3 Agency', null);
insert into public.branches (id, agency_id, partner_id, name) values
  ('cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-0000000000a1',
   'cb000000-0000-0000-0000-0000000000d1','ZZZ R3 Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('cb000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.r3.admin@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('cb000000-0000-0000-0000-00000000c001','ZZZ R3 Admin','zzz.r3.admin@r.test','superadmin',null,'active',true);

-- THE REGENT SHAPE: a single band and a joint band, the joint one paying more.
insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, is_standard)
values ('cb000000-0000-0000-0000-0000000000e1','agency','cb000000-0000-0000-0000-0000000000a1',
        current_date - 10, false);
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('cb000000-0000-0000-0000-0000000000e1', 1, 1, 3.00, 0.20),
       ('cb000000-0000-0000-0000-0000000000e1', 2, null, 5.00, 0.30);

-- ===========================================================================
-- 1-2. WHAT IS ACTUALLY PAID. Established first, so the preview has something
-- true to be compared against rather than a number chosen to suit it.
-- ===========================================================================
select is(
  public.agreement_max_rate('cb000000-0000-0000-0000-0000000000e1'),
  0.30::numeric,
  'the agreement pays 30% at its worst band, which is the joint one');

select is(
  (select coalesce(sum(s.rate),0) from public.commission_split_for(
     'cb000000-0000-0000-0000-0000000000b1','cb000000-0000-0000-0000-0000000000d1',
     'cb000000-0000-0000-0000-0000000000e1', 0.30) s),
  0.30::numeric,
  'and the split actually pays that out');

-- ===========================================================================
-- 3-4. WHAT THE OPERATOR IS SHOWN. This is the defect.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select worst_total from public.commission_preview(
     'agency','cb000000-0000-0000-0000-0000000000a1', 0.10)),
  0.30::numeric,
  'the preview shows the AGREEMENT rate, not the partner standard it falls back to');

select is(
  (select branches_affected from public.commission_preview(
     'agency','cb000000-0000-0000-0000-0000000000a1', 0.10)),
  1,
  'and still counts the branch it would affect');

reset role;

-- ===========================================================================
-- 5. THE CAP IS ENFORCED, INCLUDING ON THE JOINT BAND. The half of the
-- finding that did NOT reproduce, pinned so it cannot regress and so the
-- claim is not raised a third time.
-- ===========================================================================
-- Its own agency, because a party holds ONE agreement and never two.
insert into public.agencies (id, partner_id, name, agent_rate) values
  ('cb000000-0000-0000-0000-0000000000a2','cb000000-0000-0000-0000-0000000000d1','ZZZ R3 Capped Agency', null);
insert into public.branches (id, agency_id, partner_id, name) values
  ('cb000000-0000-0000-0000-0000000000b2','cb000000-0000-0000-0000-0000000000a2',
   'cb000000-0000-0000-0000-0000000000d1','ZZZ R3 Capped Office');

insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, is_standard)
values ('cb000000-0000-0000-0000-0000000000e2','agency','cb000000-0000-0000-0000-0000000000a2',
        current_date - 5, false);
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('cb000000-0000-0000-0000-0000000000e2', 1, 1, 3.00, 0.20),
       ('cb000000-0000-0000-0000-0000000000e2', 2, null, 5.00, 0.55);

select throws_ok(
  $$select public.assert_agreement_within_cap('cb000000-0000-0000-0000-0000000000e2')$$,
  '22023',
  'This agreement could take a branch to 55.00% of the guarantee fee. The most a branch may pay out in total is 50%.',
  'a JOINT band over the cap is refused, by name and by figure');

select is(
  public.agreement_max_rate('cb000000-0000-0000-0000-0000000000e2'),
  0.55::numeric,
  'because the cap reads the MAX across every band, joint bands included');

select * from finish();
rollback;
