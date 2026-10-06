-- A CHANGE IS ONLY A CHANGE IF SOMETHING CHANGED.
--
-- Matt, 2026-10-01: "Only record a change when a value actually changed."
--
-- Migration: 20261007260000_a_change_is_only_a_change_if_something_changed.sql
--
-- =========================================================================
-- THE ROW THIS FILE EXISTS FOR, which is on dev
-- =========================================================================
--
--   live_from   2026-08  ->  2026-08
--
-- `live_from` is a DATE; the screen edits a MONTH and sends `${since}-01`.
-- So saving a supplier whose stored date is the 20th moved the column from
-- 2026-08-20 to 2026-08-01 and recorded a change between two values that
-- print identically. Every other field in update_partner_settings compares
-- with `is distinct from` and was already right.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, status, live_from, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('98000000-0000-0000-0000-0000000000f1', 'zzz-nochange', 'ZZZ No Change', 'pre_referenced_open', 0.25, 0.10, false, 'active', '2026-08-20', true, false, 'supplier');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('98000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'zzz.nochange@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('98000000-0000-0000-0000-00000000c001','ZZZ Change Admin','zzz.nochange@o.test','superadmin',null,'active',true);

select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. SAVING THE FORM UNCHANGED RECORDS NOTHING
-- ===========================================================================
/* THE SCREEN'S OWN ROUND TRIP. It reads live_from as 'YYYY-MM' and sends
   back `${since}-01`, so this is exactly what pressing Save without
   touching anything does to a supplier stored on the 20th. */
select lives_ok(
  $$select public.update_partner_settings(
      'zzz-nochange', 'ZZZ No Change', 'active', '2026-08-01'::date,
      0.25, 0.10, 'pre_referenced_open', true, false)$$,
  'saving the form unchanged is allowed');

select is(
  (select count(*)::int from public.partner_audit a
    join public.partners p on p.id = a.partner_id
   where p.slug = 'zzz-nochange'),
  0, 'and records no change at all, which it used to record one of');

-- AND THE DATE STILL MOVED, which is the point: the COLUMN changed and the
-- trail is right not to mention it, because nobody changed anything.
select is(
  (select live_from from public.partners where slug = 'zzz-nochange'),
  '2026-08-01'::date, 'though the stored date was normalised to the first');

-- ===========================================================================
-- 2. A REAL CHANGE IS STILL RECORDED
-- ===========================================================================
select lives_ok(
  $$select public.update_partner_settings(
      'zzz-nochange', 'ZZZ No Change', 'active', '2026-09-01'::date,
      0.25, 0.10, 'pre_referenced_open', true, false)$$,
  'moving it to another month is allowed');

select is(
  (select count(*)::int from public.partner_audit a
    join public.partners p on p.id = a.partner_id
   where p.slug = 'zzz-nochange' and a.field = 'live_from'),
  1, 'and IS recorded, so the fix did not simply stop recording');

select results_eq(
  $$select old_value, new_value from public.partner_audit a
      join public.partners p on p.id = a.partner_id
     where p.slug = 'zzz-nochange' and a.field = 'live_from'$$,
  $$values ('2026-08'::text, '2026-09'::text)$$,
  'with the two months the sentence reads out');

-- ===========================================================================
-- 3. AND THE OTHER FIELDS WERE ALREADY RIGHT, so this has not broken them
-- ===========================================================================
select lives_ok(
  $$select public.update_partner_settings(
      'zzz-nochange', 'ZZZ Renamed', 'paused', '2026-09-01'::date,
      0.30, 0.10, 'pre_referenced_open', true, true)$$,
  'changing four things at once is allowed');

select is(
  (select count(*)::int from public.partner_audit a
    join public.partners p on p.id = a.partner_id
   where p.slug = 'zzz-nochange' and a.field in ('name','status','partner_rate','api_access_enabled')),
  4, 'and records one row for each of them');

/* AND NOT ONE FOR THE AGENTS' SHARE, which was passed unchanged in the
   same call. The regression this guards is somebody "fixing" the no-op by
   recording everything. */
select is(
  (select count(*)::int from public.partner_audit a
    join public.partners p on p.id = a.partner_id
   where p.slug = 'zzz-nochange' and a.field = 'agent_rate'),
  0, 'and none for the one field that did not move');

select * from finish();
rollback;
