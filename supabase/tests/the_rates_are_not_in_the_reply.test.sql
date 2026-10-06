-- R4. THE COMMISSION RATES ARE NOT IN THE REPLY.
--
-- `20260811180000_revoke_commission_columns.sql` took SELECT on
-- `partner_rate` and `agent_rate` away from `authenticated`, and
-- `applications_column_grants.test.sql` asserts that revoke still holds. It
-- does. The table is shut.
--
-- But six SECURITY DEFINER functions are declared `returns applications`, and
-- a composite carries every column. A definer function runs as the OWNER, so
-- the column revoke does not apply to it, and the whole row goes back to the
-- caller -- rates included. The front door was locked and the reply posts the
-- key through it.
--
-- MEASURED on a clean local apply, as a Negotiator
-- (`may_see_commission()` = false) calling `create_referral`:
--
--     reply partner_rate   0.3000
--     reply agent_rate     0.1000
--
-- Rule 3: commercial terms are Director-level. A Manager is `management` with
-- `sees_commission = false` and must not see them either, which is the
-- assertion most likely to be got wrong, because a Manager passes every other
-- test in the product.
--
-- SIX, NOT FOUR. The finding said four. Enumerated against the catalogue --
-- `returns applications` or `setof applications`, SECURITY DEFINER, and
-- executable by `authenticated` -- it is six: amend_tenancy_start,
-- create_joint_referral, create_referral, decline_application,
-- mark_withdrawn, set_application_status. The other six with that return type
-- are not callable by `authenticated` at all.
--
-- WHAT MUST NOT HAPPEN: the STORED row keeps its real rates. This is a
-- redaction of the reply, not of the record. Assertion 8 is that, and it is
-- the one that matters most -- blanking the stored rate would silently
-- destroy the commission on every referral a negotiator creates.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('cc000000-0000-0000-0000-0000000000d1','zzz-r4-supplier','ZZZ R4 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('cc000000-0000-0000-0000-0000000000a1','cc000000-0000-0000-0000-0000000000d1','ZZZ R4 Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('cc000000-0000-0000-0000-0000000000b1','cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-0000000000d1','ZZZ R4 Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('cc000000-0000-0000-0000-00000000c001'::uuid,'zzz.r4.neg@r.test'),
  ('cc000000-0000-0000-0000-00000000c002'::uuid,'zzz.r4.mgr@r.test'),
  ('cc000000-0000-0000-0000-00000000c003'::uuid,'zzz.r4.dir@r.test')
) as x(id,email);

-- The three levels, on a supplier so no position is required.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('cc000000-0000-0000-0000-00000000c001','ZZZ R4 Negotiator','zzz.r4.neg@r.test','referrer',
   'cc000000-0000-0000-0000-0000000000d1','active',false),
  ('cc000000-0000-0000-0000-00000000c002','ZZZ R4 Manager','zzz.r4.mgr@r.test','management',
   'cc000000-0000-0000-0000-0000000000d1','active',false),
  ('cc000000-0000-0000-0000-00000000c003','ZZZ R4 Director','zzz.r4.dir@r.test','management',
   'cc000000-0000-0000-0000-0000000000d1','active',true);

-- ===========================================================================
-- 1-3. THE NEGOTIATOR. Creates the referral, and must not be told the terms.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(public.may_see_commission(), false, 'a Negotiator may not see commission');

create temp table _r4 on commit drop as
select * from public.create_referral(
  'cc000000-0000-0000-0000-0000000000b1','Mx','Neg','Reply','1990-01-01',
  'zzz.r4.neg.t@r.test','07700900971','1 Reply St',null,'London',null,'RP1 1AA',
  2400, current_date + 30);

select is((select partner_rate from _r4), null::numeric,
  'and create_referral does not hand them the partner rate');
select is((select agent_rate from _r4), null::numeric,
  'nor the agent rate');

-- ===========================================================================
-- 4-5. THE MANAGER. `management`, but not a Director. The easy one to miss.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(public.may_see_commission(), false,
  'a Manager is management, and still may not see commission');

select is(
  (select partner_rate from public.mark_withdrawn(
     (select guarantee_ref from _r4), 'duplicate', null)),
  null::numeric,
  'and mark_withdrawn does not hand a Manager the rates either');

-- ===========================================================================
-- 6-7. THE DIRECTOR. Must still get them: a redaction that blinds the
-- Director too would be the worse bug, and it is the half a careless fix
-- breaks.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(public.may_see_commission(), true, 'a Director may see commission');

select is(
  (select partner_rate from public.create_referral(
     'cc000000-0000-0000-0000-0000000000b1','Mx','Dir','Reply','1990-01-01',
     'zzz.r4.dir.t@r.test','07700900972','2 Reply St',null,'London',null,'RP2 2AA',
     2400, current_date + 30)),
  0.30::numeric,
  'and still receives the real partner rate');

-- ===========================================================================
-- 8-9. THE RECORD IS UNTOUCHED. Redacting the REPLY must never redact the
-- ROW: the commission is computed from the stored rates, so blanking them
-- would destroy the money on every referral a negotiator creates.
-- ===========================================================================
reset role;
select is(
  (select partner_rate from public.applications where tenant_email = 'zzz.r4.neg.t@r.test'),
  0.30::numeric,
  'the STORED partner rate on the negotiator''s referral is real and intact');

select is(
  (select agent_rate from public.applications where tenant_email = 'zzz.r4.neg.t@r.test'),
  0.10::numeric,
  'and so is the stored agent rate');

select * from finish();
rollback;
