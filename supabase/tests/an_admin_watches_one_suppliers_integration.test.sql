-- AN ADMIN WATCHES ONE SUPPLIER'S INTEGRATION, NOT EVERY SUPPLIER'S.
--
-- Matt, 2026-10-01: "Below it, read-only for Opndoor admin: their sandbox
-- activity (sandbox applications and their status), recent API requests and
-- errors, and webhook delivery history, same data as their Dev Centre."
--
-- =========================================================================
-- WHY THIS FILE EXISTS WHEN NO MIGRATION DID
-- =========================================================================
--
-- The six readers already admitted an admin reading any partner:
-- `is_admin() and (p_partner is null or ... = p_partner)`, because the Dev
-- Centre has always let an admin choose a party. So the Integration tab
-- needed panels and no new SQL.
--
-- WHICH IS EXACTLY WHY THE SCOPING WANTS A TEST. Nothing changed in the
-- database, so nothing in the database would notice if the screen passed
-- NULL -- and `p_partner is null` is not an error, it is "every partner".
-- An admin opening one supplier's page would be shown the whole estate's
-- traffic, on a page headed with one supplier's name, and on a quiet
-- database it would look exactly right.
--
-- AND IT CANNOT BE PROVED AGAINST DEV'S OWN DATA: no partner on dev has a
-- single API call or sandbox application, so every reader answers 0 for
-- everybody and a wrong scope is indistinguishable from a right one. Hence
-- a fixture with two suppliers, each with traffic of its own.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, api_access_enabled)
values ('96000000-0000-0000-0000-000000000001', 'zzz-watched', 'ZZZ Watched', 'pre_referenced_open', 0.3, 0.1, false, true),
       ('96000000-0000-0000-0000-000000000002', 'zzz-other',   'ZZZ Other',   'pre_referenced_open', 0.3, 0.1, false, true);
insert into public.agencies (id, partner_id, name)
values ('96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-000000000001', 'ZZZ Watched Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('96000000-0000-0000-0000-00000000000b', '96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-000000000001', 'ZZZ Watched Office');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('96000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'admin@zzz-watch.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','',''),
       ('96000000-0000-0000-0000-0000000000fe', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'dev@zzz-other.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status) values
  ('96000000-0000-0000-0000-0000000000ff', 'Watch Admin', 'admin@zzz-watch.test', 'superadmin', null, 'active'),
  /* THE OTHER SUPPLIER'S OWN DEVELOPER, who must see their own and nobody
     else's. The readers' second arm is `app_role() = 'developer' and
     ... = app_partner()`, and it is the arm that keeps one partner out of
     another's logs. */
  ('96000000-0000-0000-0000-0000000000fe', 'Other Dev', 'dev@zzz-other.test', 'developer',
   '96000000-0000-0000-0000-000000000002', 'active');

-- Traffic for each: two calls and a sandbox application for the watched one,
-- one call for the other.
insert into public.partner_api_request_log (partner_id, method, path, status_code, error_code, duration_ms, created_at)
values ('96000000-0000-0000-0000-000000000001', 'POST', '/referrals', 201, null, 120, now() - interval '1 hour'),
       ('96000000-0000-0000-0000-000000000001', 'POST', '/referrals', 422, 'rent_missing', 40, now() - interval '2 hours'),
       ('96000000-0000-0000-0000-000000000002', 'GET',  '/referrals', 200, null, 30, now() - interval '1 hour');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode, payment_state)
values ('96000000-0000-0000-0000-0000000000d1', 'ZZZ-SBX-1', '96000000-0000-0000-0000-000000000001',
        '96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-00000000000b',
        '96000000-0000-0000-0000-0000000000fe',
        'Ms','Ada','Tester','1990-01-01','ada@zzzwatch.test','07700900000',
        '1 ZZZ Street','London','SW1A 1AA', 1000, 1000, current_date + 30,
        'pre_referenced_open', 0.3, 0.1, 'sent', now() - interval '1 day', false, 'awaiting');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. THE ADMIN SEES THE SUPPLIER THEY ASKED FOR
-- ===========================================================================
select is(
  (select count(*)::int from public.dev_api_logs('96000000-0000-0000-0000-000000000001', null, 7, 50)),
  2, 'an admin reads the watched supplier''s API calls');

select is(
  (select count(*)::int from public.dev_sandbox_applications('96000000-0000-0000-0000-000000000001', null, 50)),
  1, 'and its sandbox applications');

select is(
  (select count(*)::int from public.dev_api_errors_by_method('96000000-0000-0000-0000-000000000001', 7)),
  1, 'and the errors, grouped, which is what the panel charts');

-- ===========================================================================
-- 2. AND NOT THE OTHER SUPPLIER'S, WHICH IS THE POINT
-- ===========================================================================
select is(
  (select count(*)::int from public.dev_api_logs('96000000-0000-0000-0000-000000000002', null, 7, 50)),
  1, 'asking for the other supplier returns the other supplier''s calls');

select is(
  (select count(*)::int from public.dev_sandbox_applications('96000000-0000-0000-0000-000000000002', null, 50)),
  0, 'and it has no sandbox of its own');

/* THE FAULT A SCREEN CAN HAVE WITHOUT THE DATABASE NOTICING. Passing NULL is
   not an error; it means EVERY partner. A panel on one supplier's page that
   forgot to pass the id would show the whole estate's traffic under that
   supplier's name, and on a quiet database it would look right. */
select cmp_ok(
  (select count(*)::int from public.dev_api_logs(null, null, 7, 50)),
  '>=', 3,
  'and passing nothing means EVERY supplier, which is why the panel must pass the id');

-- ===========================================================================
-- 3. A DEVELOPER STILL SEES ONLY THEIR OWN
-- ===========================================================================
/* Widening the admin's reach must not have widened anybody else's. The
   second arm of every reader is the one keeping one partner out of
   another's logs. */
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-0000000000fe","role":"authenticated","aal":"aal2"}', true);

/* ASKING FOR SOMEBODY ELSE GIVES YOU YOUR OWN, NOT NOTHING, and that is
   worth writing down rather than asserting a count of nought.

   The readers' developer arm ignores p_partner entirely:

     (is_admin() and (p_partner is null or l.partner_id = p_partner))
     or (app_role() = 'developer' and l.partner_id = app_partner())

   so a developer who passes another partner's id is not refused, they
   are answered with their own rows. My first draft expected 0 and got
   1, and the 1 was their own call. The security property is not "the
   count is nought", it is "no row belongs to anybody else", and that is
   what is asserted. A count would have passed just as happily on a
   fixture where the other supplier happened to have no traffic. */
select is(
  (select count(*)::int from public.dev_api_logs('96000000-0000-0000-0000-000000000001', null, 7, 50) l
     where l.path <> '/referrals' or l.method <> 'GET'),
  0, 'the other supplier''s developer gets none of the watched supplier''s calls, only their own');

select is(
  (select count(*)::int from public.dev_sandbox_applications('96000000-0000-0000-0000-000000000001', null, 50)),
  0, 'nor its sandbox');

select is(
  (select count(*)::int from public.dev_api_logs(null, null, 7, 50)),
  1, 'and asking for everything gives them only their own');

select * from finish();
rollback;
