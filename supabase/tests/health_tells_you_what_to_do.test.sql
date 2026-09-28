-- HEALTH IS MACHINERY, AND THE RPC HAS TO CARRY WHAT THE PAGE NEEDS TO SAY.
--
-- Three things this asserts, all of them things the old snapshot could not do.
--
-- 1. A RESPONSE KNOWS WHICH JOB IT CAME FROM. net._http_response has no URL,
--    and pg_net deletes the queue row that had one as soon as the response
--    lands, so "which call was this" is genuinely gone by read time. The RPC
--    now attributes each response to the job whose run window contains it.
--    Correlated, not known: the key exists on every row and may be null.
--
-- 2. THE BASE URL IS REPORTED, and each job says whether it depends on it.
--    Four crons end their command with `where ops_functions_base_url() is not
--    null`; with the secret unset they do nothing and cron records SUCCEEDED.
--    The page cannot warn about a state the snapshot does not describe.
--
-- 3. NEEDS ATTENTION IS GONE, because it is a human work queue and Home has
--    it. Asserted as an absence so nobody restores it here by reflex.
--
-- THE GATE IS ASSERTED FIRST, because everything above is internal telemetry
-- and the function is SECURITY DEFINER: if the gate were wrong, it would be
-- wrong for every caller at once.

begin;
select plan(13);

-- ---------------------------------------------------------------------------
-- THE GATE. Admin and AAL2, both raising 42501.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('97000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'health.admin@zzz.test', '', now(), now(), now()),
       ('97000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'health.nobody@zzz.test', '', now(), now(), now());
-- An opndoor admin belongs to no partner; a management user must belong to one
-- (users_partner_by_role), so the non-admin is given the house agency partner.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('97000000-0000-0000-0000-0000000000a1', 'Health Admin', 'health.admin@zzz.test', 'superadmin', null, 'active', true);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
select '97000000-0000-0000-0000-0000000000a2', 'Health Nobody', 'health.nobody@zzz.test', 'management',
       (select id from public.partners order by created_at limit 1), 'active', false;

-- A signed-in admin who has NOT completed a second factor.
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok('select public.cron_health()', '42501', null,
  'an admin without a second factor is refused');

-- AAL2, but not an admin.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok('select public.cron_health()', '42501', null,
  'a non-admin with a second factor is refused too');

-- ---------------------------------------------------------------------------
-- THE SNAPSHOT, read as the admin the page runs as.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok('select public.cron_health()', 'an AAL2 admin gets the snapshot');

create temp table snap as select public.cron_health() as j;

-- THE SNAPSHOT IS TAKEN AS THE ADMIN; THE ASSERTIONS ARE NOT. `authenticated`
-- holds no privilege on the cron schema at all, which is the point of the
-- SECURITY DEFINER function, so the checks below that compare the snapshot
-- against cron.job have to run as the test rather than as the caller.
reset role;

-- The keys the page reads. Asserted by name: a rename here is a blank section
-- on the page rather than an error, which is the failure mode worth locking.
select ok((select j ? 'functions_base_url' from snap),
  'the snapshot carries the base URL four crons silently depend on');
select ok((select j ? 'http_by_job' from snap),
  'and the responses grouped by job, so one chatty job cannot fill the list');
select ok((select j ? 'recent_http' from snap) and (select j ? 'jobs' from snap) and (select j ? 'counts' from snap),
  'alongside the jobs, the recent responses and the 24h counts');

-- THE ABSENCE, stated on purpose. Needs attention is a person's backlog and
-- lives on Home; a machinery page carrying it invites the operator to think
-- the backlog is theirs.
select ok(not (select j ? 'needs_attention' from snap),
  'and no longer the human work queue, which moved to Home');

-- ---------------------------------------------------------------------------
-- ATTRIBUTION. Every response carries the key, whatever its value.
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(e ? 'job') from snap, jsonb_array_elements((select j from snap) -> 'recent_http') e),
  'every recent response says which job it is attributed to');

-- A job named on a response must be a real cron job, never invented.
select ok(
  (select bool_and(e ->> 'job' is null or exists (
     select 1 from cron.job c where c.jobname = e ->> 'job'))
   from snap, jsonb_array_elements((select j from snap) -> 'recent_http') e),
  'and the name it gives is a job that exists, or nothing at all');

-- ERRORS FIRST. The HTTP errors count links straight to these, so the order is
-- the feature: a failure below forty rows of 2xx is a failure nobody reads.
select ok(
  (select coalesce(bool_and(ok_flag), true) from (
     select (e ->> 'ok')::boolean as ok_flag,
            row_number() over () as rn
       from snap, jsonb_array_elements((select j from snap) -> 'recent_http') e
   ) t where rn > (select count(*) from snap, jsonb_array_elements((select j from snap) -> 'recent_http') e2
                    where (e2 ->> 'ok')::boolean is false)),
  'failing responses are listed before the successful ones');

-- ---------------------------------------------------------------------------
-- THE BASE-URL GUARD, read off each job's own command rather than a list.
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(e ? 'needs_base_url') from snap, jsonb_array_elements((select j from snap) -> 'jobs') e),
  'every job says whether its command is gated on the base URL');

-- Exactly the jobs whose command mentions it, so a job that gains or loses the
-- guard is described correctly with nothing here edited.
select is(
  (select count(*)::int from snap, jsonb_array_elements((select j from snap) -> 'jobs') e
    where (e ->> 'needs_base_url')::boolean),
  (select count(*)::int from cron.job where command ilike '%ops_functions_base_url%'),
  'and it is true for exactly the jobs whose command names it');

-- THE GROUPING IS OVER THE SAME ROWS. A per-job total that disagreed with the
-- list would be two answers to one question.
select ok(
  (select coalesce(sum((e ->> 'errors')::int), 0) from snap, jsonb_array_elements((select j from snap) -> 'http_by_job') e)
  >= (select count(*) from snap, jsonb_array_elements((select j from snap) -> 'recent_http') e2
       where (e2 ->> 'ok')::boolean is false),
  'the per-job error tallies account for every failure the list shows');

select * from finish();
rollback;
