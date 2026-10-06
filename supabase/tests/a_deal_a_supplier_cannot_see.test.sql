-- A DEAL NOBODY CAN SEE IS STILL PAID.
--
-- Matt (gg): "The Commission tab must also still show any agency- or
-- group-scope deal that already exists, so nothing can be hidden."
--
-- THE SET THAT CANNOT CONTAIN THE PROBLEM. supplier_share_deals asks
-- `scope_level = 'partner' and kind = 'agent_share'` -- every deal the
-- supplier's tab can write, and therefore exactly the deals that were
-- never the fault. The one on dev that prompted this, e4b75778, is
-- scope_level 'agency' and kind 'commission'.
--
-- WHAT IT MUST NOT DO is decide anything. resolve_pricing_agreement owns
-- which deal wins; this reports what exists. So the assertions are about
-- presence and absence, never about a rate being the one in force.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind)
values ('d9000000-0000-0000-0000-0000000000e1','zzz-ot-supplier','ZZZ OT Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier'),
       -- A SECOND SUPPLIER, because "in this supplier's estate" is the
       -- whole join and a function that ignored it would still pass every
       -- assertion made against one.
       ('d9000000-0000-0000-0000-0000000000e2','zzz-ot-other','ZZZ OT Other',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');

insert into public.agency_groups (id, name, partner_id)
values ('d9000000-0000-0000-0000-00000000bb01','ZZZ OT Group','d9000000-0000-0000-0000-0000000000e1');

insert into public.agencies (id, name, partner_id, group_id) values
  ('d9000000-0000-0000-0000-00000000aa01','ZZZ OT Agency','d9000000-0000-0000-0000-0000000000e1',
   'd9000000-0000-0000-0000-00000000bb01'),
  ('d9000000-0000-0000-0000-00000000aa02','ZZZ OT Agency Two','d9000000-0000-0000-0000-0000000000e1', null),
  -- A THIRD, only because enforce_agreement_exclusivity allows one live
  -- commission deal per party: the not-yet-in-force row below cannot sit
  -- beside the live one on the same agency.
  ('d9000000-0000-0000-0000-00000000aa03','ZZZ OT Agency Three','d9000000-0000-0000-0000-0000000000e1', null),
  ('d9000000-0000-0000-0000-00000000aa09','ZZZ OT Elsewhere','d9000000-0000-0000-0000-0000000000e2', null);

insert into public.pricing_agreements (id, scope_level, scope_id, kind, effective_from, ended_at, is_standard, is_default_share) values
  -- 1. THE HIDDEN ONE: agency scope, commission kind, live.
  ('d9000000-0000-0000-0000-00000000d001','agency','d9000000-0000-0000-0000-00000000aa01','commission', current_date - 1, null, false, false),
  -- 2. A GROUP-SCOPE ONE, which Matt names alongside the agency case.
  --    COMMISSION, AND NOT BY CHOICE: pricing_agreements_share_is_a_suppliers
  --    allows an agents'-share deal only at partner or agency scope, so a
  --    group can hold nothing else. Asserting a group/agent_share row would
  --    have been asserting a row the schema refuses.
  ('d9000000-0000-0000-0000-00000000d002','group','d9000000-0000-0000-0000-00000000bb01','commission', current_date - 1, null, false, false),
  -- 2b. AN AGENCY-SCOPE SHARE DEAL, which that same constraint DOES allow --
  --     so both kinds can hide, and the card words them differently ("what
  --     opndoor pays" against "what the agency gets"). A reader that only
  --     looked for the commission kind would miss half of them.
  ('d9000000-0000-0000-0000-00000000d007','agency','d9000000-0000-0000-0000-00000000aa02','agent_share', current_date - 1, null, false, false),
  -- 3. ENDED. History prices nothing, and listing it would bury the live one.
  ('d9000000-0000-0000-0000-00000000d003','agency','d9000000-0000-0000-0000-00000000aa01','commission', current_date - 5, now(), false, false),
  -- 4. NOT YET IN FORCE, on the same test resolve_pricing_agreement applies.
  ('d9000000-0000-0000-0000-00000000d004','agency','d9000000-0000-0000-0000-00000000aa03','commission', current_date + 7, null, false, false),
  -- 5. PARTNER SCOPE: the tab already shows this one, so showing it again
  --    under "set somewhere else" would be the screen contradicting itself.
  ('d9000000-0000-0000-0000-00000000d005','partner','d9000000-0000-0000-0000-0000000000e1','agent_share', current_date - 1, null, false, true),
  -- 6. ANOTHER SUPPLIER'S AGENCY.
  ('d9000000-0000-0000-0000-00000000d006','agency','d9000000-0000-0000-0000-00000000aa09','commission', current_date - 1, null, false, false);

insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('d9000000-0000-0000-0000-00000000d001', 1, null, 5, 'weeks', 0.22);

-- An admin, because supplier_offtab_deals reads a supplier's commercial
-- terms and is restricted to the same audience as supplier_share_deals.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d9000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ot.admin@r.test','',now(),now(),now()),
       ('d9000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ot.sup@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d9000000-0000-0000-0000-00000000c001','ZZZ OT Admin','zzz.ot.admin@r.test','superadmin',null,'active',true),
  ('d9000000-0000-0000-0000-00000000c002','ZZZ OT Manager','zzz.ot.sup@r.test','management',
   'd9000000-0000-0000-0000-0000000000e1','active',true);

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-2. IT FINDS THE DEAL THE OTHER READER CANNOT.
-- ===========================================================================
select is(
  (select count(*) from public.supplier_offtab_deals('zzz-ot-supplier')),
  3::bigint,
  'the agency-scope and group-scope deals are all found');

select is(
  (select array_agg(scope_name order by scope_name)
     from public.supplier_offtab_deals('zzz-ot-supplier')),
  array['ZZZ OT Agency','ZZZ OT Agency Two','ZZZ OT Group'],
  'and each is named by the agency or group it is written against');

-- The card says "what opndoor pays on referrals from X" for one kind and
-- "what X gets" for the other, so the kind has to survive the read.
select is(
  (select kind from public.supplier_offtab_deals('zzz-ot-supplier')
    where scope_name = 'ZZZ OT Agency Two'),
  'agent_share',
  'with its kind intact, because the two are worded differently on screen');

-- ===========================================================================
-- 3-5. AND NOTHING ELSE. Each of these would be a different kind of wrong
--      answer: history, a deal not yet in force, and the tab's own.
-- ===========================================================================
select ok(
  not exists (select 1 from public.supplier_offtab_deals('zzz-ot-supplier')
               where agreement_id = 'd9000000-0000-0000-0000-00000000d003'),
  'an ended deal is history and is not listed');

select ok(
  not exists (select 1 from public.supplier_offtab_deals('zzz-ot-supplier')
               where agreement_id = 'd9000000-0000-0000-0000-00000000d004'),
  'nor is one that does not start until next week');

select ok(
  not exists (select 1 from public.supplier_offtab_deals('zzz-ot-supplier')
               where agreement_id = 'd9000000-0000-0000-0000-00000000d005'),
  'nor the partner-scope deal the tab already shows for itself');

-- ===========================================================================
-- 6. NOR ANOTHER SUPPLIER'S. The estate comes from the agency, because the
--    agreement row does not record one.
-- ===========================================================================
select ok(
  not exists (select 1 from public.supplier_offtab_deals('zzz-ot-supplier')
               where scope_name = 'ZZZ OT Elsewhere'),
  'and a deal in another supplier''s estate is not this supplier''s business');

-- ===========================================================================
-- 7. A SUPPLIER'S OWN MANAGEMENT MAY NOT READ IT, which is the same
--    audience supplier_share_deals has. This card reports a fault in
--    opndoor's own record-keeping, and widening who reads a supplier's
--    commercial terms is not part of fixing it.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.supplier_offtab_deals('zzz-ot-supplier')$$,
  '42501',
  null,
  'and only opndoor reads it, as with every other deal on this tab');

reset role;
select * from finish();
rollback;
