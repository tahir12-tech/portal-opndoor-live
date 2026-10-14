/* THE PARTNER API, ON EACH OF THE THREE CHECKING SETTINGS.
   Migration: none. This is a test of what already exists.

   Matt, 2026-10-05, item 12: "A test sending a referral through the
   partner API on each of the three checking settings, including a
   supplier-estate agency inheriting its supplier's setting."

   WHAT IT IS ACTUALLY ASKING. Two different things decide the setting on
   an API referral and they are in different languages:

     the EDGE FUNCTION dispatches on the PARTNER's mode and refuses two of
     the three outright (501 not_implemented) -- pinned in
     theApiTakesOneSettingAndSaysSo.test.ts, because that half is
     TypeScript;

     create_referral_api FREEZES resolve_referencing_mode(branch, partner),
     which is a coalesce: the AGENCY's own mode first, the partner's
     second.

   SO THE INHERITANCE IS THE COALESCE, and this file proves it on all
   three settings: an agency in a supplier's estate holds no mode, so every
   referral through it freezes the supplier's. That is also why
   20261009030000 refuses a mode being set on such an agency -- a value
   there would not sit beside the supplier's, it would override it, and
   the edge function would still be dispatching on the supplier's. The two
   would disagree silently, which is the failure this inheritance exists to
   prevent. */
begin;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ea100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.api.ref@supplier.test','',now(),now(),now());

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values ('ea100000-0000-0000-0000-00000000f001'::uuid, 'zzz-api-supplier', 'ZZZ API Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.2, 0.1);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ea100000-0000-0000-0000-00000000c001','ZZZ API Referrer','zzz.api.ref@supplier.test',
        'referrer', 'ea100000-0000-0000-0000-00000000f001'::uuid,'active',false);

/* THE AGENCY HOLDS NO MODE OF ITS OWN, which is the state every
   supplier-estate agency is in and which the server now enforces. */
insert into public.agencies (id, name, partner_id, review_state, livemode, referencing_mode)
values ('ea100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ API Agency',
        'ea100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, null);
insert into public.branches (id, name, agency_id, partner_id, review_state, livemode)
values ('ea100000-0000-0000-0000-00000000f0b1'::uuid, 'ZZZ API Office',
        'ea100000-0000-0000-0000-00000000f0a1'::uuid,
        'ea100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);
insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary)
values ('ea100000-0000-0000-0000-00000000f0b1'::uuid, 'ea100000-0000-0000-0000-00000000f001'::uuid,
        'ZZZ API Office', 'zzz.api.office@supplier.test', true);

select is(
  (select referencing_mode from public.agencies where id = 'ea100000-0000-0000-0000-00000000f0a1'),
  null,
  'the agency holds no checking setting of its own');

-- ===========================================================================
-- ONE REFERRAL PER SETTING, each through the same agency.
-- ===========================================================================
/* THE SUPPLIER'S SETTING IS MOVED BETWEEN THEM, which is the only thing
   that changes: same agency, same office, same referrer, same tenant
   shape. So the frozen value can only have come from the supplier. */

update public.partners set referencing_mode = 'pre_referenced_open'
 where id = 'ea100000-0000-0000-0000-00000000f001';
select is(
  (select referencing_mode::text from public.create_referral_api(
     'ea100000-0000-0000-0000-00000000f001'::uuid, true,
     'ea100000-0000-0000-0000-00000000c001'::uuid,
     'ea100000-0000-0000-0000-00000000f0b1'::uuid,
     'Ms', 'Ada', 'Open', '1990-01-01', 'zzz.api.open@tenant.test', '07700900001',
     '1 Test Street', null, 'London', null, 'SW1A 1AA', 1200, current_date + 30)),
  'pre_referenced_open',
  'straight to payment: the referral freezes the supplier''s setting');

update public.partners set referencing_mode = 'pre_referenced_screened'
 where id = 'ea100000-0000-0000-0000-00000000f001';
select is(
  (select referencing_mode::text from public.create_referral_api(
     'ea100000-0000-0000-0000-00000000f001'::uuid, true,
     'ea100000-0000-0000-0000-00000000c001'::uuid,
     'ea100000-0000-0000-0000-00000000f0b1'::uuid,
     'Ms', 'Bea', 'Screened', '1990-01-01', 'zzz.api.screened@tenant.test', '07700900002',
     '2 Test Street', null, 'London', null, 'SW1A 1AA', 1200, current_date + 30)),
  'pre_referenced_screened',
  'opndoor applies its own criteria too: the same inheritance');

update public.partners set referencing_mode = 'opndoor_referenced'
 where id = 'ea100000-0000-0000-0000-00000000f001';
select is(
  (select referencing_mode::text from public.create_referral_api(
     'ea100000-0000-0000-0000-00000000f001'::uuid, true,
     'ea100000-0000-0000-0000-00000000c001'::uuid,
     'ea100000-0000-0000-0000-00000000f0b1'::uuid,
     'Ms', 'Cleo', 'Checked', '1990-01-01', 'zzz.api.checked@tenant.test', '07700900003',
     '3 Test Street', null, 'London', null, 'SW1A 1AA', 1200, current_date + 30)),
  'opndoor_referenced',
  'opndoor checks tenants itself: the same inheritance again');

-- ===========================================================================
-- AND THE THREE ARE REALLY DIFFERENT, not one value read three times.
-- ===========================================================================
select is(
  (select count(distinct referencing_mode)::int from public.applications
    where guarantee_ref is not null
      and branch_id = 'ea100000-0000-0000-0000-00000000f0b1'),
  3,
  'three referrals, three different frozen settings');

/* THE FREEZE IS THE POINT. Changing the supplier's setting afterwards must
   not move a referral that has already been made: each application carries
   its own, which is what makes a past month's journey readable. */
update public.partners set referencing_mode = 'pre_referenced_open'
 where id = 'ea100000-0000-0000-0000-00000000f001';
select is(
  (select referencing_mode::text from public.applications
    where tenant_email = 'zzz.api.checked@tenant.test'),
  'opndoor_referenced',
  'and a setting changed afterwards does not move a referral already made');

/* AND THE AGENCY STILL HOLDS NOTHING, so nothing here created the override
   the inheritance exists to avoid. */
select is(
  (select referencing_mode from public.agencies where id = 'ea100000-0000-0000-0000-00000000f0a1'),
  null,
  'and the agency still holds no setting of its own');

select * from finish();
rollback;
