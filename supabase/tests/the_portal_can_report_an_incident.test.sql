/* THE PORTAL CAN SAY IT COULD NOT READ SOMETHING, AND ONLY THAT.
   Migration: 20261008020000.

   Matt, 2026-10-04: "... and log it to Health."

   THE TESTS THAT MATTER ARE THE REFUSALS. report_ops_incident is
   service_role only because it takes free text and SENDS IT OUT; this
   function is the one door the browser gets, so what it will not do is the
   whole of its value. */
begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ef100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.portal@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ef100000-0000-0000-0000-00000000c001','ZZZ Portal','zzz.portal@opndoor.test',
   'referrer', (select id from public.partners where slug='opndoor-agents'),'active',false);

-- ===========================================================================
-- 1. THE DOOR IS SHUT TO anon AND OPEN TO A SIGNED-IN USER.
-- ===========================================================================
select function_privs_are('public','report_portal_incident',array['text','text'],
  'anon', array[]::text[],
  'anon may not report a portal incident');
select function_privs_are('public','report_portal_incident',array['text','text'],
  'authenticated', array['EXECUTE'],
  'a signed-in user may');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ef100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}', true);

/* A REFERRER, NOT AN ADMIN, and deliberately aal1: reporting that a screen
   failed is not a privileged act and must not need MFA, or the people most
   likely to hit it cannot tell us. */
select lives_ok(
  $$select public.report_portal_incident('portal_statement_reference_unreadable','2026-08')$$,
  'an ordinary signed-in referrer can report one');

-- ===========================================================================
-- 2. AND IT WILL NOT BE USED FOR ANYTHING ELSE.
-- ===========================================================================
select throws_ok(
  $$select public.report_portal_incident('anything_i_like','2026-08')$$,
  '22023', null,
  'a type that is not on the allowlist is refused');

select throws_ok(
  $$select public.report_portal_incident('portal_statement_reference_unreadable','; drop table x')$$,
  '22023', null,
  'and a month that is not a month is refused');

reset role;

-- ===========================================================================
-- 3. WHAT IT WROTE, which is the alert Health counts.
-- ===========================================================================
select is(
  (select count(*)::int from public.ops_alerts
    where alert_type = 'portal_statement_reference_unreadable'),
  1,
  'one alert was written');

/* NOTHING THE CALLER SENT IS IN THE TEXT. The detail is built inside the
   function, so a signed-in user cannot put their own words in front of
   whoever reads an operational alert. */
select alike(
  (select detail from public.ops_alerts
    where alert_type = 'portal_statement_reference_unreadable' limit 1),
  '%could not read the statement reference for 2026-08%',
  'and its text was built here, from the month and nothing else');

-- ===========================================================================
-- 4. AND HEALTH COUNTS IT, or we logged to a table nobody reads.
-- ===========================================================================
/* auth.users FIRST: public.users carries a foreign key to it. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ef100000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.padmin@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ef100000-0000-0000-0000-00000000c002','ZZZ Portal Admin','zzz.padmin@opndoor.test',
        'superadmin', null,'active',true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ef100000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
select is(
  ((public.cron_health() -> 'counts' ->> 'portal_errors'))::int,
  1,
  'and Health shows it in the last 24 hours');

select * from finish();
rollback;
