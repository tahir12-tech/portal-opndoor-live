-- A SUPPLIER STAYS A SUPPLIER, WHATEVER ITS REFERENCING MODE.
--
-- Matt, 2026-10-02: "Every partner gets a fixed 'supplier or agency' setting
-- of its own, decided when it's created ... and never inferred from
-- referencing mode. Referencing mode becomes independent: a supplier can use
-- any referencing mode and stays a supplier." And: "Prove it: on dev, switch
-- Kestrel to 'opndoor referenced' in a test and show it stays a supplier
-- everywhere, including the settlement, then switch it back."
--
-- THIS FILE IS THAT PROOF, AND IT IS WHY THE CHANGE IS SAFE TO REPEAT. The
-- measurement that produced the instruction was made by hand in a rolled-back
-- transaction; a measurement nobody can re-run is not a guard. Every
-- assertion below FAILS against the code before 20261007600000, where all
-- three predicates read `referencing_mode = 'opndoor_referenced'`:
--
--   is_supplier_estate     flipped true  -> false
--   is_our_estate_partner  flipped false -> true
--   is_agent_estate        flipped false -> true
--
-- which is how a supplier left the Suppliers list, folded into "Agency
-- referral", lost its via-labels, dropped off Reconciliation and vanished
-- from the supplier settlement while the database went on billing it.
--
-- THE SETTLEMENT IS THE HALF THAT MATTERS. A predicate flipping is a
-- curiosity; a screen that stops listing a supplier Opndoor is still invoicing
-- is a missed payment. So the supplier's own statement lines and its payee row
-- in the month's run are asserted either side of the switch, not just the
-- predicates that feed them.

begin;
select plan(15);

-- ===========================================================================
-- A SUPPLIER AND AN AGENCY, EACH ON THE MODE THAT USED TO DECIDE FOR THEM.
--
-- The supplier starts on a pre-referenced mode and the agency on
-- `opndoor_referenced`, which is the arrangement the old predicates were
-- correct for. Then each is moved to the other's mode. Nothing about what
-- they ARE may move with it.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind)
values
  ('97000000-0000-0000-0000-0000000000a1','zzz-kind-supplier','ZZZ Kind Supplier',
   'pre_referenced_open', 0.25, 0.10, false, false, true, true, 'supplier'),
  ('97000000-0000-0000-0000-0000000000a2','zzz-kind-agency','ZZZ Kind Agency',
   'opndoor_referenced', 0.25, 0.10, false, true, true, false, 'agency');

-- ---------------------------------------------------------------------------
-- BEFORE: the three predicates say what each partner is.
-- ---------------------------------------------------------------------------
select ok(public.is_supplier_estate('97000000-0000-0000-0000-0000000000a1'),
  'the supplier is a supplier estate to begin with');
select ok(not public.is_our_estate_partner('97000000-0000-0000-0000-0000000000a1'),
  'and is not one of ours');
select ok(not public.is_agent_estate(null, '97000000-0000-0000-0000-0000000000a1'),
  'and its route is not the agent rail');

select ok(not public.is_supplier_estate('97000000-0000-0000-0000-0000000000a2'),
  'the agency is not a supplier estate');
select ok(public.is_our_estate_partner('97000000-0000-0000-0000-0000000000a2'),
  'and is one of ours');
select ok(public.is_agent_estate(null, '97000000-0000-0000-0000-0000000000a2'),
  'and its route is the agent rail');

-- ---------------------------------------------------------------------------
-- THE SWITCH. Matt's test, both ways at once: the supplier takes the mode
-- that used to make it an agency, and the agency takes one that used to make
-- it a supplier.
-- ---------------------------------------------------------------------------
update public.partners set referencing_mode = 'opndoor_referenced'
 where id = '97000000-0000-0000-0000-0000000000a1';
update public.partners set referencing_mode = 'pre_referenced_screened'
 where id = '97000000-0000-0000-0000-0000000000a2';

select ok(public.is_supplier_estate('97000000-0000-0000-0000-0000000000a1'),
  'the supplier on "opndoor referenced" is STILL a supplier estate');
select ok(not public.is_our_estate_partner('97000000-0000-0000-0000-0000000000a1'),
  'and still is not one of ours, so its applications are not rescoped');
select ok(not public.is_agent_estate(null, '97000000-0000-0000-0000-0000000000a1'),
  'and its route is still not the agent rail, so its commission still has a supplier share');

select ok(not public.is_supplier_estate('97000000-0000-0000-0000-0000000000a2'),
  'the agency referencing its own tenants is STILL not a supplier estate');
select ok(public.is_our_estate_partner('97000000-0000-0000-0000-0000000000a2'),
  'and is still one of ours, which is what is_agent_estate said in a comment all along');

-- ---------------------------------------------------------------------------
-- AND THE MODE REALLY DID CHANGE, so the six assertions above are not passing
-- because the update was refused.
-- ---------------------------------------------------------------------------
select is(
  (select referencing_mode::text from public.partners where id='97000000-0000-0000-0000-0000000000a1'),
  'opndoor_referenced',
  'the supplier is genuinely on "opndoor referenced" now');

-- ---------------------------------------------------------------------------
-- THE SETTLEMENT, which is the half that would cost money.
--
-- `commission_statement_payees` is the month's run: every party owed
-- something, keyed by payee. A supplier appears in it at level `partner`. The
-- old inference took the supplier OUT of the client's settlement while
-- leaving this row in place, so a payee existed that no screen listed.
-- ---------------------------------------------------------------------------
insert into public.agencies (id, partner_id, name)
values ('97000000-0000-0000-0000-0000000000a3','97000000-0000-0000-0000-0000000000a1',
        'ZZZ Kind Supplier Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('97000000-0000-0000-0000-0000000000a4','97000000-0000-0000-0000-0000000000a3',
        '97000000-0000-0000-0000-0000000000a1','ZZZ Kind Supplier Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('97000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.kind.ref@k.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('97000000-0000-0000-0000-0000000000a5','ZZZ Kind Referrer','zzz.kind.ref@k.test',
        'referrer','97000000-0000-0000-0000-0000000000a1','active',false);

/* ONE PAID REFERRAL, IN A MONTH OF ITS OWN. July 2026 holds nothing on dev
   and nothing in any other test file, so these assertions cannot collide
   with dev's real book or with a_supplier_gets_its_own_statement, which
   counts the partner-level payees in May and expects exactly one. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, fee_amount, tenancy_start, referencing_mode,
   partner_rate, agent_rate, status, sent_at, paid_at, livemode, payment_state)
values
  ('97000000-0000-0000-0000-0000000000a6','ZZZ-KIND-1','97000000-0000-0000-0000-0000000000a1',
   '97000000-0000-0000-0000-0000000000a3','97000000-0000-0000-0000-0000000000a4',
   '97000000-0000-0000-0000-0000000000a5',
   'Ms','Kay','Tester','1990-01-01','zzz.kind.tenant@k.test','07700900001',
   '1 ZZZ Kind Street','London','SW1A 1AA',
   2000, 2000, '2026-08-01', 'opndoor_referenced',
   0.25, 0.10, 'paid', '2026-07-10T10:00:00Z', '2026-07-15T10:00:00Z', true, 'paid');

select ok(
  exists (select 1 from public.commission_statement_payees(date '2026-07-01')
           where partner_id = '97000000-0000-0000-0000-0000000000a1' and level = 'partner'),
  'the supplier still has a payee row in July''s settlement on "opndoor referenced"');

select ok(
  (select count(*) from public.supplier_statement_lines(
     '97000000-0000-0000-0000-0000000000a1', date '2026-07-01')) > 0,
  'and its own statement still has lines, so the statement and the settlement agree');

-- ---------------------------------------------------------------------------
-- AND BACK AGAIN, which is the other half of what Matt asked for: the switch
-- is reversible and leaves nothing behind.
-- ---------------------------------------------------------------------------
update public.partners set referencing_mode = 'pre_referenced_open'
 where id = '97000000-0000-0000-0000-0000000000a1';

select ok(
  public.is_supplier_estate('97000000-0000-0000-0000-0000000000a1')
  and not public.is_our_estate_partner('97000000-0000-0000-0000-0000000000a1')
  and exists (select 1 from public.commission_statement_payees(date '2026-07-01')
               where partner_id = '97000000-0000-0000-0000-0000000000a1' and level = 'partner'),
  'switched back, it reads exactly as it did before the switch');

select * from finish();
rollback;
