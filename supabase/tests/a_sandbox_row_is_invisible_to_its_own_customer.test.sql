/* (cw) A SANDBOX APPLICATION IS INVISIBLE TO THE CUSTOMER IT BELONGS TO.
   Migration: none. This pins what already holds, after proving it by hand.

   Matt: "create a single-tenant test referral through the partner API on
   dev, then show me where it appears ... Confirm it's invisible
   everywhere else in the portal and that Opndoor sends no email."

   DONE FOR REAL FIRST, on 2026-10-05: a sandbox key minted for Kestrel, a
   POST to the deployed partner-api on dev, GR-TEST-1 created, and Kestrel
   Management shown to see nothing. This file is so that it stays true.

   =====================================================================
   WHAT ACTUALLY ISOLATES IT, which is worth knowing before changing any
   of it: NOT the client. hydrate.ts never mentions livemode and neither
   does applications_select. It is applications_live_only, a RESTRICTIVE
   policy for ALL commands whose whole qualification is the word
   `livemode`. Restrictive means it ANDs with everything else, so there is
   no reader and no verb it does not apply to, and no client filter to
   forget.

   A PERMISSIVE policy in its place would be a disaster that looks
   identical in every screenshot: permissive policies OR together, so one
   would simply widen what everybody can see. The test below asserts the
   kind as well as the existence.
   ===================================================================== */
begin;
select plan(6);

-- ===========================================================================
-- 1. THE POLICY, BY NAME AND BY KIND.
-- ===========================================================================
select is(
  (select polpermissive from pg_policy
    where polrelid = 'public.applications'::regclass and polname = 'applications_live_only'),
  false,
  'applications_live_only is RESTRICTIVE, so it ANDs rather than widens');

select is(
  (select pg_get_expr(polqual, polrelid) from pg_policy
    where polrelid = 'public.applications'::regclass and polname = 'applications_live_only'),
  'livemode',
  'and its whole qualification is livemode');

select is(
  (select polcmd::text from pg_policy
    where polrelid = 'public.applications'::regclass and polname = 'applications_live_only'),
  '*',
  'for every command, not only select');

-- ===========================================================================
-- 2. AND WHAT THAT MEANS FOR THE CUSTOMER WHOSE SANDBOX IT IS.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ec100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.sbx.mgmt@supplier.test','',now(),now(),now());
insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate, api_access_enabled)
values ('ec100000-0000-0000-0000-00000000f001'::uuid, 'zzz-sbx-supplier', 'ZZZ Sandbox Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.2, 0.1, true);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ec100000-0000-0000-0000-00000000c001','ZZZ Sandbox Manager','zzz.sbx.mgmt@supplier.test',
        'management', 'ec100000-0000-0000-0000-00000000f001'::uuid,'active',true);
insert into public.agencies (id, name, partner_id, review_state, livemode)
values ('ec100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ Sandbox Agency',
        'ec100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);
insert into public.branches (id, name, agency_id, partner_id, review_state, livemode)
values ('ec100000-0000-0000-0000-00000000f0b1'::uuid, 'ZZZ Sandbox Office',
        'ec100000-0000-0000-0000-00000000f0a1'::uuid,
        'ec100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

/* ONE SANDBOX ROW AND ONE LIVE ROW, the same shape, the same supplier,
   the same office. The only difference is the column, which is the
   point: the reader below must see exactly one of them. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, livemode, status, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_email, tenant_phone, tenant_dob,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start,
   partner_rate, agent_rate, fee_amount, referencing_mode)
values
  ('ec100000-0000-0000-0000-00000000fa01'::uuid, 'GR-ZZZSBX', 'ec100000-0000-0000-0000-00000000f001'::uuid,
   'ec100000-0000-0000-0000-00000000f0a1'::uuid, 'ec100000-0000-0000-0000-00000000f0b1'::uuid,
   false, 'sent', 'ec100000-0000-0000-0000-00000000c001'::uuid,
   'Ms','Sandbox','Row','zzz.sbx@tenant.test','07700900001','1990-01-01',
   '1 Sandbox Street','Sheffield','S7 1FD', 1200, current_date + 30, 0.2, 0.1, 1200, 'pre_referenced_open'),
  ('ec100000-0000-0000-0000-00000000fa02'::uuid, 'GR-ZZZLIVE', 'ec100000-0000-0000-0000-00000000f001'::uuid,
   'ec100000-0000-0000-0000-00000000f0a1'::uuid, 'ec100000-0000-0000-0000-00000000f0b1'::uuid,
   true, 'sent', 'ec100000-0000-0000-0000-00000000c001'::uuid,
   'Ms','Live','Row','zzz.live@tenant.test','07700900002','1990-01-01',
   '2 Live Street','Sheffield','S7 1FD', 1200, current_date + 30, 0.2, 0.1, 1200, 'pre_referenced_open');

/* BOTH READERS CREATED BEFORE THE ROLE SWITCH: `authenticated` may not
   write to auth.users, which this test found by trying. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ec100000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.sbx.admin@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ec100000-0000-0000-0000-00000000c002','ZZZ Sandbox Admin','zzz.sbx.admin@opndoor.test',
        'superadmin', null,'active',true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ec100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select coalesce(string_agg(guarantee_ref, ', ' order by guarantee_ref), 'NOTHING')
     from public.applications
    where guarantee_ref in ('GR-ZZZSBX', 'GR-ZZZLIVE')),
  'GR-ZZZLIVE',
  'their own management sees the live row and not the sandbox one');

/* NOT A COUNT EITHER. A row that cannot be read but can be counted is
   still a leak, and a figure on Reporting is a count. */
select is(
  (select count(*)::int from public.applications where livemode = false),
  0,
  'and cannot count what they cannot read');

-- ===========================================================================
-- 3. AN ADMIN IS NOT AN EXCEPTION.
-- ===========================================================================
/* RESTRICTIVE MEANS RESTRICTIVE: is_admin() widens applications_select and
   cannot widen this. Asserted because "admin sees everything" is the
   assumption most likely to be made about any other policy here. */
select set_config('request.jwt.claims',
  '{"sub":"ec100000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);

select is(
  (select count(*)::int from public.applications where guarantee_ref = 'GR-ZZZSBX'),
  0,
  'and neither does an opndoor admin, through the portal');

select * from finish();
rollback;
