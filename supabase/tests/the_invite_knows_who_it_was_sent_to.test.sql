/* (zz) THE INVITE SUMMARY CARRIES THE NAME AND THE MOBILE.
   Migration: 20261009060000.

   Matt: "when a referred tenant opens their invite, prefill the account
   form with the name, email and mobile from the referral (editable)."

   The agent has just typed all three into the referral. The register form
   asked for all three again, because the only thing the invite could tell
   it was the email.

   SERVICE ROLE ONLY, unchanged. The tenant-auth edge function is the one
   caller and the token is the secret -- it was emailed to the person whose
   name and number these are. Nothing here widens who may ask; it widens
   what the same question answers, about the same person, to the same
   holder of the same link. */
begin;
select plan(7);

-- ===========================================================================
-- 1. STILL NOBODY ELSE'S TO CALL.
-- ===========================================================================
select function_privs_are('public','tenant_invite_summary',array['uuid'],
  'anon', array[]::text[], 'anon may not read an invite summary');
select function_privs_are('public','tenant_invite_summary',array['uuid'],
  'authenticated', array[]::text[], 'nor may a signed-in user');
select function_privs_are('public','tenant_invite_summary',array['uuid'],
  'service_role', array['EXECUTE'], 'the edge function may, and only it');

-- ===========================================================================
-- 2. WHAT IT NOW ANSWERS.
-- ===========================================================================
insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values ('eb100000-0000-0000-0000-00000000f001'::uuid, 'zzz-inv-supplier', 'ZZZ Invite Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.2, 0.1);
insert into public.agencies (id, name, partner_id, review_state, livemode)
values ('eb100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ Invite Agency',
        'eb100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);
insert into public.branches (id, name, agency_id, partner_id, review_state, livemode)
values ('eb100000-0000-0000-0000-00000000f0b1'::uuid, 'ZZZ Invite Office',
        'eb100000-0000-0000-0000-00000000f0a1'::uuid,
        'eb100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

/* A REFERRER, because assert_application_attributed refuses an
   application with neither a referrer nor an applicant on a route that is
   not a house one. Attribution cannot be silently missing, and a fixture
   is not an exception to that. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('eb100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.inv.ref@supplier.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('eb100000-0000-0000-0000-00000000c001','ZZZ Invite Referrer','zzz.inv.ref@supplier.test',
        'referrer', 'eb100000-0000-0000-0000-00000000f001'::uuid,'active',false);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, livemode, status, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_email, tenant_phone, tenant_dob,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start,
   partner_rate, agent_rate, fee_amount, referencing_mode)
values ('eb100000-0000-0000-0000-00000000fa01'::uuid, 'GR-ZZZINV',
        'eb100000-0000-0000-0000-00000000f001'::uuid,
        'eb100000-0000-0000-0000-00000000f0a1'::uuid,
        'eb100000-0000-0000-0000-00000000f0b1'::uuid, true, 'sent',
        'eb100000-0000-0000-0000-00000000c001'::uuid,
        'Ms', 'Samira', 'Patel', 'zzz.samira@tenant.test', '07700900123', '1992-03-14',
        '12 Bramble Court', 'Sheffield', 'S7 1FD', 1450, current_date + 30,
        /* The rates are NOT NULL on this table: resolve_rates fills them on
           every real row, and a fixture has to say them out loud. */
        0.2, 0.1, 1450, 'pre_referenced_open');

insert into public.tenant_invites (token, application_id, email, expires_at)
values ('eb100000-0000-0000-0000-00000000f111'::uuid,
        'eb100000-0000-0000-0000-00000000fa01'::uuid, 'zzz.samira@tenant.test', now() + interval '7 days');

select is(
  (select first_name from public.tenant_invite_summary('eb100000-0000-0000-0000-00000000f111')),
  'Samira', 'the first name the agent typed');
select is(
  (select last_name from public.tenant_invite_summary('eb100000-0000-0000-0000-00000000f111')),
  'Patel', 'and the last name');
select is(
  (select phone from public.tenant_invite_summary('eb100000-0000-0000-0000-00000000f111')),
  '07700900123', 'and the mobile');

/* WHAT IT ALREADY ANSWERED IS UNCHANGED, which a drop-and-recreate makes
   worth asserting: the columns were added to the end of a row type that
   four other callers read positionally in SQL. */
select is(
  (select prop_addr1 || ' / ' || email || ' / ' || valid::text
     from public.tenant_invite_summary('eb100000-0000-0000-0000-00000000f111')),
  '12 Bramble Court / zzz.samira@tenant.test / true',
  'and everything it said before, unchanged');

select * from finish();
rollback;
