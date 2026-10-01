-- ONE DELIVERY PER SIGNED DEED, AND THE PANEL SAYS WHEN IT WENT.
--
-- Matt, 2026-10-01: "On GR-20846: the activity shows 'Deed of Guarantee
-- delivered to the agent' twice (16:49 and 16:51), and the Delivery panel says
-- the deed was sent at 16:45, before the tenant signed at 16:49. Find why the
-- signed deed was emailed to the agent twice and stop duplicates (one delivery
-- per signed deed unless someone presses Resend), and make the Delivery panel
-- show the time and recipients of the actual signed-deed email."
--
-- Migration: 20261007320000_one_delivery_per_signed_deed.sql
--
-- =========================================================================
-- THE FAULT WAS ONE THING, AND THE DUPLICATE WAS ITS CONSEQUENCE
-- =========================================================================
--
-- Nothing recorded when the signed deed was delivered, so the panel answered
-- "Sent" with deed_sent_at -- the moment the deed went to the TENANT to be
-- signed, which is before anybody signed it. On GR-20846 that read 15:45:47
-- against a signature at 15:49:06, so the panel looked stale, and two minutes
-- later a person pressed send and the agent got a second copy.
--
-- So the assertions come in that order: the panel's answer, then the refusal.

begin;
select plan(16);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('99000000-0000-0000-0000-0000000000f1', 'zzz-deliv', 'ZZZ Delivery', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agencies (id, partner_id, name)
values ('99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000f1', 'ZZZ Delivery Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('99000000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000f1', 'ZZZ Delivery Office');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('99000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'admin@zzz-deliv.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status)
values ('99000000-0000-0000-0000-0000000000ff', 'Delivery Admin', 'admin@zzz-deliv.test', 'superadmin', null, 'active');

-- A signed deed: sent for signature at 15:45, signed at 15:49. The two
-- timestamps the panel kept confusing.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at,
   deed_sent_at, deed_issued_at, deed_state)
values
  ('99000000-0000-0000-0000-0000000000e1','GR-ZZZ-DLV','99000000-0000-0000-0000-0000000000f1',
   '99000000-0000-0000-0000-0000000000a1','99000000-0000-0000-0000-0000000000b1','ZZZ Ref',
   'Mx','Dee','Livery','1990-01-01','dee@zzz.test','07700900002',
   '1 Deed Rd','London','N1 1AA',2000,current_date+30,'deed',true,0.25,0.10,'opndoor_referenced',
   /* GR-20846's own clock, because the constraint between these five is
      part of what the panel was reading wrongly: sent, paid, out for
      signature, signed. */
   timestamptz '2026-09-27 15:43:02+00', timestamptz '2026-09-27 15:45:41+00',
   timestamptz '2026-09-27 15:45:47+00', timestamptz '2026-09-27 15:49:06+00', 'executed');

insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary)
values ('99000000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000f1',
        'ZZZ Manager', 'manager@zzz-deliv.test', true);

select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. BEFORE ANY DELIVERY: NOT DELIVERED, WHATEVER deed_sent_at SAYS
-- ===========================================================================
/* The fault in one assertion. deed_sent_at has been set since 15:45 and the
   deed has gone to nobody, and the panel used to call that "delivered". */
select is(
  (select state from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  'not_attempted',
  'a deed out for signature is not a deed delivered, however long ago it was sent');

select is(
  (select delivered_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  null, 'and there is no delivery time to show');

-- ===========================================================================
-- 2. THE FIRST DELIVERY
-- ===========================================================================
select lives_ok(
  $$ select public.record_delivery_attempt('99000000-0000-0000-0000-0000000000e1', true,
       'manager@zzz-deliv.test', 'branch_contact', null,
       'manager@zzz-deliv.test, copies@zzz-deliv.test') $$,
  'the signed deed is delivered');

select is(
  (select state from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  'delivered', 'which is what makes it delivered');

select isnt(
  (select delivered_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  timestamptz '2026-09-27 15:45:47+00',
  'and the time shown is the delivery, not the signature request');

select cmp_ok(
  (select delivered_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  '>', timestamptz '2026-09-27 15:49:06+00',
  'which is after the tenant signed, as a delivery of a signed deed must be');

/* EVERYONE IT WENT TO. One email addresses the referrer and their copies, so
   a "sent to" naming one of them is a quarter of an answer. */
select is(
  (select delivered_to from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  'manager@zzz-deliv.test, copies@zzz-deliv.test',
  'and every address it was sent to, not just the first');

select is(
  (select resent_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  null, 'and nothing has been resent');

-- ===========================================================================
-- 3. THE SECOND SEND IS REFUSED UNLESS IT SAYS IT IS A RESEND
-- ===========================================================================
set local role authenticated;
select throws_ok(
  $$ select public.send_deed_to_agent('99000000-0000-0000-0000-0000000000e1') $$,
  '22023', null,
  'a second send to the same contact is refused: one delivery per signed deed');

/* AND THE REFUSAL SAYS WHEN AND TO WHOM, because "already sent" without those
   two facts is what makes somebody press it again.

   Caught into a table rather than asserted with throws_like, which this
   pgTAP install does not have: the plan ran 15 of 16 and the runner called
   it a pass, which is its own small lesson about assertions that vanish. */
create temporary table zzz_err(msg text) on commit drop;
do $$
begin
  perform public.send_deed_to_agent('99000000-0000-0000-0000-0000000000e1');
exception when others then
  insert into zzz_err(msg) values (sqlerrm);
end $$;

select matches(
  (select msg from zzz_err),
  'manager@zzz-deliv\.test',
  'and names who already has it');

select lives_ok(
  $$ select public.send_deed_to_agent('99000000-0000-0000-0000-0000000000e1', null, false, true) $$,
  'while a resend that says so is allowed, which is the half Matt kept');

/* AN OVERRIDE IS A DIFFERENT SEND TO A DIFFERENT PERSON, and is not the
   duplicate this rule is about. */
select lives_ok(
  $$ select public.send_deed_to_agent('99000000-0000-0000-0000-0000000000e1', 'someone.else@zzz-deliv.test', false) $$,
  'and sending to a different address is not a second copy to the same one');
reset role;

-- ===========================================================================
-- 4. A RESEND IS RECORDED AS A RESEND, NOT AS THE DELIVERY
-- ===========================================================================
/* WHAT THE FIRST DELIVERY SAID, held so the resend can be compared against
   it. `now()` is the transaction's clock, so inside one test the two stamps
   are equal to the microsecond: the claim worth asserting is that the first
   one did not MOVE, not that time passed. */
create temporary table zzz_first on commit drop as
select delivered_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1');

select lives_ok(
  $$ select public.record_delivery_attempt('99000000-0000-0000-0000-0000000000e1', true,
       'manager@zzz-deliv.test', 'branch_contact', null, 'manager@zzz-deliv.test') $$,
  'the deed is sent again');

select isnt(
  (select resent_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  null, 'which is recorded as a resend');

select is(
  (select delivered_to from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  'manager@zzz-deliv.test, copies@zzz-deliv.test',
  'and the first delivery keeps its own recipients, so "when did it go" still answers');

/* THE ONE THAT MUST NOT MOVE. deed_delivered_at is what "has this been
   delivered" is checked against; a later send overwriting it would make every
   resend look like a first delivery. */
select is(
  (select delivered_at from public.my_application_delivery('99000000-0000-0000-0000-0000000000e1')),
  (select delivered_at from zzz_first),
  'and the first delivery is still the first: a resend does not become it');

select * from finish();
rollback;
