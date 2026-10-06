-- AN UNFINISHED DIRECT APPLICATION CLOSES AFTER THIRTY QUIET DAYS, AND
-- REOPENS WHERE IT LEFT OFF.
--
-- Matt, 2026-10-02, verbatim:
--
--   "2. An unfinished direct application expires after 30 days with no
--       activity. Expiry loses nothing: if the tenant signs in again, it
--       reopens where they left off, back to In progress, same reference.
--    3. At 25 days with no activity, email the tenant: their application
--       will close in 5 days, with a link to carry on."
--
-- WHY THE FIXTURE USES THE REAL DIRECT PARTNER and not a zzz- one of its
-- own, as most of these files do: the sweeps filter on slug =
-- 'opndoor-direct' deliberately, because "direct" is the rail and not a
-- shape. A test partner would prove the arithmetic against a rail the
-- function will never meet.
--
-- "NO ACTIVITY" IS last_activity_at, which 20261007490000 added because
-- applications has no updated_at and a draft writes almost nothing to
-- activity_log. The fixtures set it directly, which is what a tenant who
-- stopped typing on that day leaves behind.

begin;
select plan(18);

create temp table d(k text, id uuid) on commit drop;
insert into d values
  ('applicant', '96000000-0000-0000-0000-00000000000a'),
  ('other',     '96000000-0000-0000-0000-00000000000b'),
  ('quiet30',   '96000000-0000-0000-0000-000000000030'),
  ('quiet29',   '96000000-0000-0000-0000-000000000029'),
  ('quiet25',   '96000000-0000-0000-0000-000000000025'),
  ('quiet40',   '96000000-0000-0000-0000-000000000040'),
  ('sentone',   '96000000-0000-0000-0000-000000000050'),
  ('agency',    '96000000-0000-0000-0000-000000000060');

/* AN APPLICANT IS AN auth.users ROW FIRST: applicants.id references it, so
   the identity has to exist before the tenant does. Same pattern as
   tenant_isolation.test.sql. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, '', now(), now(), now()
from (values
  ('96000000-0000-0000-0000-00000000000a'::uuid, 'zzz.quiet@example.test'),
  ('96000000-0000-0000-0000-00000000000b'::uuid, 'zzz.other@example.test')
) as x(id, email);

insert into public.applicants (id, email, first_name, last_name)
values ('96000000-0000-0000-0000-00000000000a', 'zzz.quiet@example.test', 'Quiet', 'Tenant'),
       ('96000000-0000-0000-0000-00000000000b', 'zzz.other@example.test', 'Other', 'Tenant');

/* FIVE SHAPES, one per thing the sweep has to get right. All but the last
   are on the real direct rail; `agency` is one of ours, which the sweep
   must not touch however quiet it is. */
/* THE PLACEHOLDER AGENCY AND BRANCH. A direct application has no agent,
   and agency_id/branch_id are NOT NULL, so each house rail carries an
   "Unattached" pair for the row to point at. sync_application_partner
   refuses an application with no branch, which is how this fixture found
   out. Looked up by name rather than by id so the test does not pin a
   seeded uuid. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, applicant_id, status,
   tenant_first_name, tenant_last_name,
   tenant_email, monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode, last_activity_at, created_at, livemode)
select x.id, x.ref,
       (select id from public.partners where slug = 'opndoor-direct'),
       (select a.id from public.agencies a
         where a.partner_id = (select id from public.partners where slug = 'opndoor-direct')
           and a.is_placeholder limit 1),
       (select b.id from public.branches b
         where b.partner_id = (select id from public.partners where slug = 'opndoor-direct') limit 1),
       x.applicant, x.status, 'Quiet', 'Tenant', x.email, x.rent, current_date + 60, 0.25, 0.10, 'opndoor_referenced',
       now() - (x.quiet || ' days')::interval, now() - (x.quiet || ' days')::interval, true
from (values
  ('96000000-0000-0000-0000-000000000030'::uuid, 'ZZZ-Q30', '96000000-0000-0000-0000-00000000000a'::uuid, 'draft', 'zzz.q30@example.test', 0::numeric, 30),
  ('96000000-0000-0000-0000-000000000029'::uuid, 'ZZZ-Q29', '96000000-0000-0000-0000-00000000000b'::uuid, 'draft', 'zzz.q29@example.test', 0::numeric, 29),
  ('96000000-0000-0000-0000-000000000025'::uuid, 'ZZZ-Q25', null::uuid,                                   'draft', 'zzz.q25@example.test', 0::numeric, 25),
  ('96000000-0000-0000-0000-000000000040'::uuid, 'ZZZ-Q40', null::uuid,                                   'draft', 'zzz.q40@example.test', 0::numeric, 40)
) as x(id, ref, applicant, status, email, rent, quiet);

/* AN APPLICATION THAT LAPSED THE OTHER WAY: expired already, with no
   expired_from, which is every expiry in the system that is not this one. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, applicant_id, status, tenant_title, tenant_first_name, tenant_last_name,
   tenant_dob, tenant_phone, tenant_email, prop_addr1, prop_city, prop_postcode, monthly_rent,
   tenancy_start, partner_rate, agent_rate, referencing_mode, sent_at, last_activity_at, created_at, expired_at, livemode)
values ('96000000-0000-0000-0000-000000000050', 'ZZZ-SENT',
        (select id from public.partners where slug = 'opndoor-direct'),
        (select a.id from public.agencies a
          where a.partner_id = (select id from public.partners where slug = 'opndoor-direct')
            and a.is_placeholder limit 1),
        (select b.id from public.branches b
          where b.partner_id = (select id from public.partners where slug = 'opndoor-direct') limit 1),
        '96000000-0000-0000-0000-00000000000a', 'expired', 'Ms', 'Lapsed', 'Tenant',
        '1990-01-01', '07700 900123', 'zzz.sent@example.test', '1 Test Road', 'London', 'NW1 8LH', 1500,
        current_date + 60, 0.25, 0.10, 'opndoor_referenced',
        -- Stated, because a non-draft row is stamped sent_at = now() otherwise,
        -- and applications_journey_sequence then reads expired_at < sent_at.
        now() - interval '75 days', now() - interval '60 days', now() - interval '60 days', now() - interval '45 days', true);

/* AND ONE OF OURS, quiet for a year. The rail is the whole of the rule. */
/* A REFERRER, because our estate is not a house route and
   assert_application_attributed refuses an application there with neither
   a referrer nor an applicant: "Attribution cannot be silently missing."
   Which is the right rule, and it is also what makes this fixture an
   honest agency-rail row rather than a direct one wearing a partner id. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, status, tenant_first_name, tenant_last_name, tenant_email,
   monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode, last_activity_at, created_at, livemode)
values ('96000000-0000-0000-0000-000000000060', 'ZZZ-AGENCY',
        (select id from public.partners where slug = 'opndoor-agents'),
        (select a.id from public.agencies a
          where a.partner_id = (select id from public.partners where slug = 'opndoor-agents')
            and a.is_placeholder limit 1),
        (select b.id from public.branches b
          where b.partner_id = (select id from public.partners where slug = 'opndoor-agents') limit 1),
        (select u.id from public.users u
          where u.partner_id = (select id from public.partners where slug = 'opndoor-agents') limit 1),
        'draft', 'Agency', 'Draft', 'zzz.agency@example.test', 0, current_date + 60, 0.25, 0.10, 'opndoor_referenced',
        now() - interval '365 days', now() - interval '365 days', true);

-- ---------------------------------------------------------------------------
-- WHAT THE SWEEP CLOSES.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.applications
    where guarantee_ref in ('ZZZ-Q30','ZZZ-Q29','ZZZ-Q25','ZZZ-Q40') and status = 'draft'),
  4, 'four unfinished applications, before anything runs');

select ok(
  public.expire_stale_drafts(current_date) >= 2,
  'the sweep closes the ones that have been quiet thirty days or more');

select is(
  (select status from public.applications where guarantee_ref = 'ZZZ-Q30'),
  'expired', 'thirty quiet days closes it, on the day and not the day after');

select is(
  (select status from public.applications where guarantee_ref = 'ZZZ-Q40'),
  'expired', 'and so does forty');

/* THE DAY BEFORE IS STILL OPEN. The off-by-one here is the difference
   between Matt's sentence and the fifteen-day sweep's, whose own comment
   records that its fourteen-day interval lands on the sixteenth day. */
select is(
  (select status from public.applications where guarantee_ref = 'ZZZ-Q29'),
  'draft', 'twenty-nine does not');

select is(
  (select status from public.applications where guarantee_ref = 'ZZZ-Q25'),
  'draft', 'and neither does twenty-five, which is when the warning goes out');

select is(
  (select status from public.applications where guarantee_ref = 'ZZZ-AGENCY'),
  'draft', 'and one of OUR agency''s drafts is untouched after a year: this is the direct rail''s rule');

-- ---------------------------------------------------------------------------
-- CLOSING LOSES NOTHING.
-- ---------------------------------------------------------------------------
select is(
  (select guarantee_ref from public.applications where id = '96000000-0000-0000-0000-000000000030'),
  'ZZZ-Q30', 'the reference is the same reference');

select is(
  (select expired_from from public.applications where guarantee_ref = 'ZZZ-Q30'),
  'draft', 'and the row records that it closed unfinished, which is what lets it reopen');

-- ---------------------------------------------------------------------------
-- THE WARNING, AFTER THE SWEEP AND ONLY IN THE BAND.
-- ---------------------------------------------------------------------------
/* RUN IN THIS ORDER ON PURPOSE, and the caller does the same: warning
   first would email "this closes in five days" about ZZZ-Q40, which the
   same run has just closed. */
create temp table warned on commit drop as
  select * from public.fire_draft_closing_notices(current_date);

select is(
  (select count(*)::int from warned where guarantee_ref = 'ZZZ-Q25'),
  1, 'twenty-five quiet days earns the warning');

select is(
  (select count(*)::int from warned where guarantee_ref = 'ZZZ-Q29'),
  1, 'and so does twenty-nine, which is inside the band and still open');

select is(
  (select count(*)::int from warned where guarantee_ref in ('ZZZ-Q30','ZZZ-Q40')),
  0, 'but nothing the sweep has just closed is warned about closing');

select is(
  (select days_quiet from warned where guarantee_ref = 'ZZZ-Q25'),
  25, 'and the notice carries the real number of quiet days, so the email can say the real days left');

select is(
  (select closes_on from warned where guarantee_ref = 'ZZZ-Q25'),
  (current_date + 5), 'which at twenty-five days is five');

select is(
  (select count(*)::int from public.fire_draft_closing_notices(current_date)
    where guarantee_ref in ('ZZZ-Q25','ZZZ-Q29')),
  0, 'and a second run the same day warns nobody twice: the ledger IS the idempotency');

-- ---------------------------------------------------------------------------
-- AND IT REOPENS WHERE IT LEFT OFF.
-- ---------------------------------------------------------------------------
select ok(
  public.reopen_expired_draft('96000000-0000-0000-0000-00000000000a') >= 1,
  'signing in reopens what closed unfinished');

select is(
  (select status || ':' || coalesce(expired_at::text, 'no expiry') || ':' || coalesce(expired_from, 'no reason')
     from public.applications where guarantee_ref = 'ZZZ-Q30'),
  'draft:no expiry:no reason',
  'back to In progress, with the expiry and its reason cleared');

/* THE HALF THAT MUST NOT MOVE. ZZZ-SENT belongs to the SAME applicant and
   is expired, and it stays expired: an application that lapsed with the
   fee unpaid is finished business, and reinstating it is a decision
   somebody makes rather than a side effect of signing in. */
select is(
  (select status from public.applications where guarantee_ref = 'ZZZ-SENT'),
  'expired', 'and an application that lapsed any other way stays closed, even for the same tenant');

select * from finish();
rollback;
