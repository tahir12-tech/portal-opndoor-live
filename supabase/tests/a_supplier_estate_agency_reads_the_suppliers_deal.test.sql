-- AN AGENCY INSIDE A SUPPLIER'S ESTATE READS THE SUPPLIER'S DEAL.
--
-- Matt (kk), repeated as (cj): "Commission tab of an agency inside a
-- supplier's estate ... shows Opndoor's agency standard ... which is
-- wrong. Show the supplier's deal for this agency instead, e.g. 'On
-- Kestrel Lettings' agency deal: 10% (1 to 5 tenants), 15% (6 to 10)',
-- and who pays it per the supplier's current setting."
--
-- WHY THE TAB WAS WRONG RATHER THAN BROKEN. agreement_for_agency
-- resolves the 'commission' kind, which is what opndoor pays the
-- ROUTE. On our own estate the agency IS the route and the answer is
-- right; on the supplier rail the supplier is, so the tab was
-- answering a different question correctly and printing it under the
-- agency's name. The agency's own money there is 'agent_share'.
--
-- THE DEFAULT AND THE NAMED DEAL ARE BOTH TESTED, because the
-- difference is the whole reason a supplier has more than one: an
-- agency named on a bespoke deal must not read the default, and the
-- resolver's membership arm is the only thing stopping it.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind, opndoor_pays_agents)
values ('d5000000-0000-0000-0000-00000000ff01','zzz-sd-supplier','ZZZ SD Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier', false);

insert into public.agencies (id, partner_id, name, review_state) values
  ('d5000000-0000-0000-0000-00000000aa01','d5000000-0000-0000-0000-00000000ff01','ZZZ SD Default','confirmed'),
  ('d5000000-0000-0000-0000-00000000aa02','d5000000-0000-0000-0000-00000000ff01','ZZZ SD Named','confirmed');
insert into public.branches (id, agency_id, partner_id, name, review_state) values
  ('d5000000-0000-0000-0000-00000000bb01','d5000000-0000-0000-0000-00000000aa01','d5000000-0000-0000-0000-00000000ff01','ZZZ SD Office One','confirmed'),
  ('d5000000-0000-0000-0000-00000000bb02','d5000000-0000-0000-0000-00000000aa02','d5000000-0000-0000-0000-00000000ff01','ZZZ SD Office Two','confirmed');

-- The supplier's default agents' share, and one bespoke deal that only
-- the second agency is named on.
insert into public.pricing_agreements (id, scope_level, scope_id, kind, effective_from, is_standard, is_default_share) values
  ('d5000000-0000-0000-0000-00000000d001','partner','d5000000-0000-0000-0000-00000000ff01','agent_share', current_date - 1, false, true),
  ('d5000000-0000-0000-0000-00000000d002','partner','d5000000-0000-0000-0000-00000000ff01','agent_share', current_date - 1, false, false);
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_unit, agent_rate) values
  ('d5000000-0000-0000-0000-00000000d001', 1, 5, 'months', 0.10),
  ('d5000000-0000-0000-0000-00000000d001', 6, 10, 'months', 0.15),
  ('d5000000-0000-0000-0000-00000000d002', 1, null, 'months', 0.22);
insert into public.pricing_agreement_members (agreement_id, agency_id)
values ('d5000000-0000-0000-0000-00000000d002','d5000000-0000-0000-0000-00000000aa02');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email,'',now(),now(),now()
from (values
  ('d5000000-0000-0000-0000-00000000c001'::uuid,'zzz.sd.admin@o.test'),
  ('d5000000-0000-0000-0000-00000000c002'::uuid,'zzz.sd.mgr@o.test')
) as v(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d5000000-0000-0000-0000-00000000c001','ZZZ SD Admin','zzz.sd.admin@o.test','superadmin',null,'active',true),
  -- An opndoor MANAGER: reaches the org and may NOT be shown money.
  ('d5000000-0000-0000-0000-00000000c002','ZZZ SD Manager','zzz.sd.mgr@o.test','opndoor_manager',null,'active',false);

select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-3. THE DEFAULT DEAL, ITS BANDS, AND WHO PAYS IT.
-- ===========================================================================
select is(
  (select supplier_name from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa01')),
  'ZZZ SD Supplier',
  'the deal is named as the supplier''s, not as opndoor''s standard');

select is(
  (select jsonb_array_length(bands) from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa01')),
  2,
  'and carries the supplier''s two bands, which is the sentence Matt asked for');

/* THE CURRENT SETTING, NOT A FROZEN FLAG, and Matt called the difference
   out himself: a statement follows what was frozen because that is what
   was paid; a deal page describes the arrangement as it stands. */
select is(
  (select opndoor_pays_agents from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa01')),
  false,
  'and says the supplier pays this agency, from the supplier''s setting now');

-- ===========================================================================
-- 4-5. AN AGENCY NAMED ON A BESPOKE DEAL READS THAT ONE.
-- ===========================================================================
select is(
  (select agreement_id from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa02')),
  'd5000000-0000-0000-0000-00000000d002'::uuid,
  'an agency named on a deal gets that deal, not the default');

select is(
  (select is_default from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa02')),
  false,
  'and the page can say so, because it is not the default');

-- ===========================================================================
-- 6. NOTHING ON OUR OWN ESTATE, where the agency's own agreement is the
--    answer and a second, emptier one would contradict it.
-- ===========================================================================
reset role;
insert into public.agencies (id, partner_id, name, review_state)
values ('d5000000-0000-0000-0000-00000000aa09',
        (select id from public.partners where slug='opndoor-agents'),'ZZZ SD Ours','confirmed');
insert into public.branches (id, agency_id, partner_id, name, review_state)
values ('d5000000-0000-0000-0000-00000000bb09','d5000000-0000-0000-0000-00000000aa09',
        (select id from public.partners where slug='opndoor-agents'),'ZZZ SD Our Office','confirmed');
select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*) from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa09')),
  0::bigint,
  'one of our own agencies has no supplier deal to read');

-- ===========================================================================
-- 7-8. A DEAL IS MONEY, SO may_see_commission DECIDES AS WELL AS REACH.
--      An opndoor manager reaches every org and is refused this.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa01')$$,
  '42501',
  null,
  'an opndoor manager may not read a supplier''s terms');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.supplier_deal_for_agency('d5000000-0000-0000-0000-00000000aa01')$$,
  '42501',
  null,
  'and nobody reads it without MFA');

reset role;
select * from finish();
rollback;
