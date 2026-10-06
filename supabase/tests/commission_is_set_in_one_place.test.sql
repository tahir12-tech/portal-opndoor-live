-- A SUPPLIER'S COMMISSION IS SET IN ONE PLACE, AND THE SHARE CANNOT
-- EXCEED THE TOTAL.
--
-- Matt, 2026-09-30, verbatim: "Supplier commission is edited only on the
-- supplier's Commission tab, under the new model: the supplier's total
-- rate, the agents' share within it with volume tiers, and whether
-- Opndoor pays agents directly. Remove the two flat commission boxes from
-- Manage."
--
-- THE ASSERTION THAT MATTERS MOST IS THE REFUSAL. Under the carve-out the
-- agents' share comes OUT of the total, so a share above the total is not
-- a large share, it is a contradiction. `supplier_agent_rate()` caps it so
-- the statement arithmetic can never go negative, and a cap is a safety
-- net rather than an answer: the editor has to refuse, or an admin sets
-- 40% on a 35% total, sees it saved, and the supplier is quietly paid
-- nothing at all.
--
-- AND THE HOUSE PARTNER IS REFUSED HERE TOO. `opndoor-agents` carries
-- every agency referral on the estate and its partner_rate is Opndoor's
-- own margin. An admin who could set a "total commission" on it would be
-- editing our own margin through a screen that calls it a supplier's.

begin;
select plan(11);

insert into public.partners (id, slug, name, status, is_house_route, partner_rate, agent_rate)
values ('e7000000-0000-0000-0000-0000000000f1','zzz-comm-sup','ZZZ Commission Supplier','active',false,0.30,0.12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e7000000-0000-0000-0000-00000000c001'::uuid,'zzz.comm.admin@o.test'),
  ('e7000000-0000-0000-0000-00000000c002'::uuid,'zzz.comm.mgmt@s.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e7000000-0000-0000-0000-00000000c001','ZZZ Comm Admin','zzz.comm.admin@o.test','superadmin',null,'active',true),
  ('e7000000-0000-0000-0000-00000000c002','ZZZ Comm Mgmt','zzz.comm.mgmt@s.test','management',
   'e7000000-0000-0000-0000-0000000000f1','active',true);

-- ===========================================================================
-- AS AN OPNDOOR ADMIN
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_supplier_commission('zzz-comm-sup', 0.35, 0.15, false)$$,
  'an Opndoor admin sets the total, the agents'' share and who pays them, in one call');

/* READ AS POSTGRES. `authenticated` has no SELECT on public.partners --
   the estate reads it through hydrate and the RPCs -- so a bare select
   here fails on permission and says nothing about the write. The persona
   is resumed before the next call. */
reset role;
select is(
  (select partner_rate from public.partners where slug = 'zzz-comm-sup'),
  0.35::numeric, 'the total is stored as the partner rate, which is what that column now means');

select is(
  (select agent_rate from public.partners where slug = 'zzz-comm-sup'),
  0.15::numeric, 'and the agents'' share beside it, carved out of the total rather than added to it');

select is(
  (select opndoor_pays_agents from public.partners where slug = 'zzz-comm-sup'),
  false, 'and the setting, which stays off unless somebody turns it on');

set local role authenticated;

/* THE REFUSAL. 40% carved out of a 35% total is not a configuration, it
   is a contradiction, and the value that would otherwise be stored makes
   the supplier's own share zero on every referral. */
select throws_ok(
  $$select public.set_supplier_commission('zzz-comm-sup', 0.35, 0.40, false)$$,
  '22023', null,
  'the agents'' share cannot be larger than the total it is carved out of');

reset role;
select is(
  (select agent_rate from public.partners where slug = 'zzz-comm-sup'),
  0.15::numeric, 'and the refusal leaves the old figures alone rather than half-saving');
set local role authenticated;

/* NOT OUR OWN MARGIN. The house partner every agency shares has a
   partner_rate too, and it is not a supplier total. */
select throws_ok(
  $$select public.set_supplier_commission('opndoor-agents', 0.35, 0.15, false)$$,
  '22023', null, 'and the house agency partner is not a supplier, so its rate is not set here');

-- THE TRAIL. Somebody reconciling a month needs the day the setting moved.
select lives_ok(
  $$select public.set_supplier_commission('zzz-comm-sup', 0.35, 0.15, true)$$,
  'turning on "Opndoor pays the agents" is allowed');

reset role;
select ok(
  exists (select 1 from public.partner_audit
           where partner_id = 'e7000000-0000-0000-0000-0000000000f1'
             and field = 'opndoor_pays_agents'),
  'and it is audited, because it changes who Opndoor pays');

-- ===========================================================================
-- AND NOBODY ELSE, WHICH IS "edited only on the supplier's Commission tab"
-- MEANING OPNDOOR'S COMMISSION TAB
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_supplier_commission('zzz-comm-sup', 0.90, 0.10, false)$$,
  '42501', null,
  'a supplier''s own Management may not set its commission, though the RPC is granted to authenticated');

-- The tiers reader narrows rather than raising, the same shape as the
-- statement-address list, so the assertion is emptiness.
select is_empty(
  $$select 1 from public.supplier_commission_tiers('zzz-comm-sup')$$,
  'nor read the tiers behind it');

select * from finish();
rollback;
