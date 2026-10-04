-- A CHANGE OPNDOOR MADE WAS MADE BY OPNDOOR.
--
-- Matt (bm): "Customer-facing emails and screens: when Opndoor staff make
-- a change (start date, withdrawal, anything), say 'by opndoor', never the
-- staff member's name. Check every email template and activity line shown
-- to agency and supplier users."
--
-- THE HALF THAT WOULD HAVE BEEN WRONG. The obvious reading is "replace the
-- name", and applied to mark_withdrawn that takes a CUSTOMER'S OWN name off
-- their own action: an agency Manager may withdraw their own referral, and
-- naming the colleague who did it is the whole value of the line to the
-- Director reading it. The rule is about US. So this file asserts both
-- directions on the same function, because one assertion would have passed
-- for the wrong implementation.
--
-- AND THE AUDIT IS NOT DELETED. decline_application's activity line was the
-- only record of which of us declined; 20261008250000 adds `decided_by`
-- first, so the answer moves to the row rather than disappearing.

begin;
select plan(7);

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('d6000000-0000-0000-0000-0000000000a0','zzz-bm-house','ZZZ BM House',
        'opndoor_referenced', false, 'agency');

insert into public.agencies (id, partner_id, name, review_state)
values ('d6000000-0000-0000-0000-0000000000b0','d6000000-0000-0000-0000-0000000000a0',
        'ZZZ BM Agency','confirmed');
insert into public.branches (id, agency_id, partner_id, name, review_state)
values ('d6000000-0000-0000-0000-0000000000c0','d6000000-0000-0000-0000-0000000000b0',
        'd6000000-0000-0000-0000-0000000000a0','ZZZ BM Office','confirmed');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email, '', now(), now(), now()
from (values
  ('d6000000-0000-0000-0000-0000000000e1'::uuid,'zzz.bm.mgr@a.test'),
  ('d6000000-0000-0000-0000-0000000000e2'::uuid,'zzz.bm.admin@o.test')
) as v(id, email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('d6000000-0000-0000-0000-0000000000e1','ZZZ BM Manager','zzz.bm.mgr@a.test',
        'management','d6000000-0000-0000-0000-0000000000a0','active', true),
       -- OPNDOOR STAFF HOLD NO PARTNER, which users_partner_by_role enforces.
       ('d6000000-0000-0000-0000-0000000000e2','ZZZ BM Admin','zzz.bm.admin@o.test',
        'superadmin', null,'active', true);

insert into public.user_scopes (user_id, kind, agency_id)
values ('d6000000-0000-0000-0000-0000000000e1','agency','d6000000-0000-0000-0000-0000000000b0');

-- Three referrals: two to withdraw (one by each kind of person) and one to
-- decline. Every field is here to satisfy assert_application_complete.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, status,
   tenant_title, tenant_first_name, tenant_last_name, tenant_email, tenant_phone,
   tenant_dob, prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start,
   partner_rate, agent_rate, referencing_mode)
select v.id, v.ref,
       'd6000000-0000-0000-0000-0000000000a0','d6000000-0000-0000-0000-0000000000b0',
       'd6000000-0000-0000-0000-0000000000c0',
       -- assert_application_attributed refuses a referral with nobody
       -- behind it off a house route. The manager is the referrer, which
       -- also makes assertion 1 the ordinary case rather than a special
       -- permission.
       'd6000000-0000-0000-0000-0000000000e1', v.st,
       'Mr','ZZZ','Tenant', v.ref || '@t.test','07700 900000',
       '1990-01-01','1 ZZZ Street','London','SW1A 1AA', 1000, '2026-11-01',
       0.25, 0.10, 'opndoor_referenced'
from (values
  ('d6000000-0000-0000-0000-0000000000f1'::uuid,'GR-ZZZ-BM1','sent'),
  ('d6000000-0000-0000-0000-0000000000f2'::uuid,'GR-ZZZ-BM2','sent'),
  ('d6000000-0000-0000-0000-0000000000f3'::uuid,'GR-ZZZ-BM3','referencing')
) as v(id, ref, st);

-- ===========================================================================
-- 1-2. THE CUSTOMER'S OWN MANAGER KEEPS THEIR NAME.
--
--      This is the assertion that stops the obvious over-correction. An
--      agency Director reading their own history needs to know which of
--      their team withdrew a referral; "opndoor" there would be a lie as
--      well as a loss.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d6000000-0000-0000-0000-0000000000e1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.mark_withdrawn('GR-ZZZ-BM1', 'duplicate', null)$$,
  'an agency manager may withdraw their own agency''s referral');
reset role;

select is(
  (select actor from public.activity_log
    where application_id = 'd6000000-0000-0000-0000-0000000000f1' and kind = 'withdrawn'),
  'ZZZ BM Manager',
  'and the line names them, because a colleague is who the reader wants');

-- ===========================================================================
-- 3-4. OPNDOOR DOING THE SAME THING SAYS "opndoor".
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d6000000-0000-0000-0000-0000000000e2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.mark_withdrawn('GR-ZZZ-BM2', 'duplicate', null)$$,
  'and opndoor may withdraw it too');
reset role;

select is(
  (select actor from public.activity_log
    where application_id = 'd6000000-0000-0000-0000-0000000000f2' and kind = 'withdrawn'),
  'opndoor',
  'but the line says opndoor, never which of us');

-- ===========================================================================
-- 5-7. A DECLINE IS ALWAYS OURS, AND THE RECORD SURVIVES IT.
--
--      decline_application is guarded by is_opndoor_staff(), so unlike
--      mark_withdrawn there is no customer caller to name -- and the
--      message itself embedded the name, not just the actor column.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d6000000-0000-0000-0000-0000000000e2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.decline_application('GR-ZZZ-BM3', 'no guarantor cover available')$$,
  'opndoor declines an application awaiting a decision');
reset role;

select is(
  (select message from public.activity_log
    where application_id = 'd6000000-0000-0000-0000-0000000000f3' and kind = 'application_declined'),
  'Application declined by opndoor (no guarantor cover available).',
  'the sentence says opndoor, not the admin who pressed it');

/* THE HALF THAT MAKES THE MASK SAFE. Without this the name was simply
   gone: decline_application recorded only decided_by_kind. */
select is(
  (select decided_by from public.applications
    where id = 'd6000000-0000-0000-0000-0000000000f3'),
  'd6000000-0000-0000-0000-0000000000e2'::uuid,
  'while who actually declined it is still recorded, on the row');

select * from finish();
rollback;
