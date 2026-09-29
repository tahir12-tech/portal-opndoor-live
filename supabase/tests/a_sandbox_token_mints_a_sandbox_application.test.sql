-- A SANDBOX TOKEN MINTS A SANDBOX APPLICATION.
--
-- Round 5, M6. referencing_inbound_tokens carries `livemode` and
-- referencing-inbound selects it, and then the create never received it:
-- `create_referencing_inbound_application` wrote the literal `true`. So a
-- partner testing against their sandbox token minted LIVE applications on our
-- estate -- real refs off the live sequence, real rows in the agency's book,
-- and real email to real tenants, because livemode is the flag every sender
-- tests.
--
-- BOTH ASSERTIONS FAIL BEFORE 20261006490000, the first because the function
-- had no such parameter at all and the second because it could only ever
-- answer `true`.

begin;
select plan(6);

-- ===========================================================================
-- A HOUSE-ROUTE PARTNER WITH A BRANCH THE HAND-OVER CAN LAND AT
-- ===========================================================================
-- The rail is pre_referenced_open and the attribution guard allows a NULL
-- referrer only on a house route, which is what this function relies on.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('97000000-0000-0000-0000-0000000000d1','zzz-inbound','ZZZ Inbound Partner',
        'pre_referenced_open', 0.25, 0.10, true, false, true, true);

insert into public.agencies (id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000d1','ZZZ Inbound Agency');
-- The function lands a hand-over at the route's branch named 'Unattached',
-- which is what "nobody here referred them" means structurally.
insert into public.branches (id, agency_id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000b1','97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000d1','Unattached');

-- ===========================================================================
-- THE SANDBOX HAND-OVER
-- ===========================================================================
select lives_ok(
  $$select public.create_referencing_inbound_application(
      900001::bigint, '97000000-0000-0000-0000-0000000000d1'::uuid,
      'Mx','Sandy','Sandbox','1990-01-01'::date,'sandy@inbound.test','07700900051',
      '1 Sandbox Street','London','SB1 1AA', 1000::numeric, (current_date + 30)::date,
      null, null, null, null, 'ZZZAGY1', 'TRN-SANDBOX', false)$$,
  'the hand-over accepts the token''s livemode as an argument');

select is((select livemode from public.applications
            where id = (select application_id from public.application_provider_links where table_id = 900001)),
  false,
  'and a SANDBOX token mints a sandbox application, not a live one');

-- ===========================================================================
-- AND A LIVE TOKEN IS UNCHANGED
-- ===========================================================================
-- The fix must not make everything sandbox, which a defaulted boolean would.
select lives_ok(
  $$select public.create_referencing_inbound_application(
      900002::bigint, '97000000-0000-0000-0000-0000000000d1'::uuid,
      'Mx','Libby','Live','1990-01-01'::date,'libby@inbound.test','07700900052',
      '2 Sandbox Street','London','SB2 2AA', 1000::numeric, (current_date + 30)::date,
      null, null, null, null, 'ZZZAGY1', 'TRN-LIVE', true)$$,
  'a live token still mints an application');

select is((select livemode from public.applications
            where id = (select application_id from public.application_provider_links where table_id = 900002)),
  true,
  'and it is a live one');

-- ===========================================================================
-- THE REPLAY IS STILL A REPLAY
-- ===========================================================================
-- table_id is the idempotency key. A redelivery must return the first
-- application rather than mint a second, and must not flip its livemode.
select is(
  (select (public.create_referencing_inbound_application(
      900001::bigint, '97000000-0000-0000-0000-0000000000d1'::uuid,
      'Mx','Sandy','Sandbox','1990-01-01'::date,'sandy@inbound.test','07700900051',
      '1 Sandbox Street','London','SB1 1AA', 1000::numeric, (current_date + 30)::date,
      null, null, null, null, 'ZZZAGY1', 'TRN-SANDBOX', true)).id),
  (select application_id from public.application_provider_links where table_id = 900001),
  'a redelivery returns the application already minted');

select is((select livemode from public.applications
            where id = (select application_id from public.application_provider_links where table_id = 900001)),
  false,
  'and replaying it as live does not promote a sandbox application');

select * from finish();
rollback;
