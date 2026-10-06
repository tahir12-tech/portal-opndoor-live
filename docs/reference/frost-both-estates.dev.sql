-- THE FROST FIXTURE, on dev, in both estates. Matt, 2026-10-01: "set up a
-- test 'Frost' in both estates on dev, refer once each way".
--
-- Idempotent: it removes its own rows first, so it can be re-run and so the
-- whole fixture can be dropped by running the delete block alone.
-- Everything it creates is named "Frost Partnership" or carries the
-- frost.dev.test / frost.example domains.

-- ---- clean ----------------------------------------------------------------
delete from public.application_commission_lines
 where application_id in (select id from public.applications where guarantee_ref in ('GR-FROST-OURS','GR-FROST-KES'));
delete from public.applications where guarantee_ref in ('GR-FROST-OURS','GR-FROST-KES');
delete from public.applicants where email in ('tess.ours@frost.dev.test','tom.kestrel@frost.dev.test');
delete from auth.users where id in ('f0057000-0000-4000-8000-00000000d001','f0057000-0000-4000-8000-00000000d002');
delete from public.user_scopes where user_id = 'f0057000-0000-4000-8000-000000000001';
delete from public.users where id = 'f0057000-0000-4000-8000-000000000001';
delete from auth.identities where user_id = 'f0057000-0000-4000-8000-000000000001';
delete from auth.users where id = 'f0057000-0000-4000-8000-000000000001';
delete from public.agent_contacts where branch_id in
  (select b.id from public.branches b join public.agencies a on a.id=b.agency_id where a.name='Frost Partnership');
delete from public.branches where agency_id in (select id from public.agencies where name='Frost Partnership');
delete from public.agencies where name = 'Frost Partnership';

-- ---- the two estates ------------------------------------------------------
insert into public.agencies (id, partner_id, name, review_state, finance_email) values
  ('f0057000-0000-4000-8000-00000000a001',
   (select id from public.partners where slug='opndoor-agents'),
   'Frost Partnership','confirmed','finance@frost.example'),
  ('f0057000-0000-4000-8000-00000000a002',
   (select id from public.partners where slug='kestrel-lettings'),
   'Frost Partnership','confirmed','finance@frost-via-kestrel.example');

insert into public.branches (id, agency_id, partner_id, name, review_state) values
  ('f0057000-0000-4000-8000-00000000b001','f0057000-0000-4000-8000-00000000a001',
   (select id from public.partners where slug='opndoor-agents'),'Frost Mayfair','confirmed'),
  ('f0057000-0000-4000-8000-00000000b002','f0057000-0000-4000-8000-00000000a002',
   (select id from public.partners where slug='kestrel-lettings'),'Frost Mayfair','confirmed');

-- A branch mailbox in EACH estate, same branch name, different address. Which
-- one a deed goes to is the question the fixture exists to answer.
insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary) values
  ('f0057000-0000-4000-8000-00000000b001',(select id from public.partners where slug='opndoor-agents'),
   'Frost Mayfair (ours)','mayfair@frost.example',true),
  ('f0057000-0000-4000-8000-00000000b002',(select id from public.partners where slug='kestrel-lettings'),
   'Frost Mayfair (Kestrel)','mayfair@frost-via-kestrel.example',true);

-- ---- Frost's own login, in OPNDOOR's estate only --------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('f0057000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','director@frost.dev.test',
        extensions.crypt('Frost!Dev2026', extensions.gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at, last_sign_in_at)
values (gen_random_uuid(),'f0057000-0000-4000-8000-000000000001','email',
        'f0057000-0000-4000-8000-000000000001',
        jsonb_build_object('sub','f0057000-0000-4000-8000-000000000001',
                           'email','director@frost.dev.test',
                           'email_verified',true,'phone_verified',false),
        now(), now(), null);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission,
                          receives_commission_statements, home_branch_id)
values ('f0057000-0000-4000-8000-000000000001','Fran Frost','director@frost.dev.test','management',
        (select id from public.partners where slug='opndoor-agents'),'active',true,true,
        'f0057000-0000-4000-8000-00000000b001');

insert into public.user_scopes (user_id, kind, agency_id)
values ('f0057000-0000-4000-8000-000000000001','agency','f0057000-0000-4000-8000-00000000a001');

-- ---- one referral each way ------------------------------------------------
-- A tenant IS an auth user: applicants.id points at auth.users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('f0057000-0000-4000-8000-00000000d001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tess.ours@frost.dev.test','',now(),now(),now()),
  ('f0057000-0000-4000-8000-00000000d002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tom.kestrel@frost.dev.test','',now(),now(),now());

insert into public.applicants (id, email, first_name, last_name) values
  ('f0057000-0000-4000-8000-00000000d001','tess.ours@frost.dev.test','Tess','Ours'),
  ('f0057000-0000-4000-8000-00000000d002','tom.kestrel@frost.dev.test','Tom','Kestrel');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  ('f0057000-0000-4000-8000-00000000e001','GR-FROST-OURS',
   (select id from public.partners where slug='opndoor-agents'),
   'f0057000-0000-4000-8000-00000000a001','f0057000-0000-4000-8000-00000000b001',
   'f0057000-0000-4000-8000-000000000001','Fran Frost','f0057000-0000-4000-8000-00000000d001',
   'Ms','Tess','Ours','1992-04-04','tess.ours@frost.dev.test','07700900001',
   '1 Mount Street','London','W1K 3NG',2400, current_date + 28,'paid',true,
   0.25,0.10,'opndoor_referenced', now() - interval '6 days', now() - interval '5 days'),
  ('f0057000-0000-4000-8000-00000000e002','GR-FROST-KES',
   (select id from public.partners where slug='kestrel-lettings'),
   'f0057000-0000-4000-8000-00000000a002','f0057000-0000-4000-8000-00000000b002',
   (select id from public.users where email='director@kestrel.dev.test'),'Kestrel Director',
   'f0057000-0000-4000-8000-00000000d002',
   'Mr','Tom','Kestrel','1990-02-02','tom.kestrel@frost.dev.test','07700900002',
   '2 Mount Street','London','W1K 3NG',2400, current_date + 28,'paid',true,
   0.25,0.10,'pre_referenced_open', now() - interval '6 days', now() - interval '5 days');

insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount, amount, source) values
  ('f0057000-0000-4000-8000-00000000e001','agency','f0057000-0000-4000-8000-00000000a001','Frost Partnership',0.10,2400,240,'standard'),
  ('f0057000-0000-4000-8000-00000000e002','agency','f0057000-0000-4000-8000-00000000a002','Frost Partnership',0.10,2400,240,'standard');

select 'seeded' as done;
