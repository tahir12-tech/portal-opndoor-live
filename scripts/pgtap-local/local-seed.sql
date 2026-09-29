-- LOCAL HARNESS SEED. Not product data and not a migration: it supplies the
-- two things dev happens to have and an empty database does not, so the suite
-- measures the product rather than the gaps in this cluster.
--
-- 1. AN OPNDOOR SUPERADMIN. Several tests build a JWT from
--    (select id from public.users where role='superadmin' and status='active'),
--    which is NULL here, making the whole claims string NULL and every guard
--    read as "no second factor". Dev has one; the fixtures create none.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-00000000ad01','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','local.admin@opndoor.test','',now(),now(),now())
on conflict (id) do nothing;

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('00000000-0000-4000-8000-00000000ad01','Local Admin','local.admin@opndoor.test',
        'superadmin', null, 'active', true)
on conflict (id) do nothing;

-- 2. ONE ATTRIBUTED HTTP RESPONSE. health_tells_you_what_to_do asserts
--    bool_and(e ? 'job') over recent_http; over an EMPTY array bool_and is
--    NULL, so the assertion fails vacuously rather than because anything is
--    wrong. Dev has 546 of these. One run plus one response inside its
--    five-minute correlation window is enough to make the assertion real.
insert into cron.job_run_details (jobid, runid, database, username, command,
                                  status, return_message, start_time, end_time)
select j.jobid, 900001, current_database(), 'postgres', j.command,
       'succeeded', 'local seed', now() - interval '10 minutes',
       now() - interval '10 minutes' + interval '20 milliseconds'
  from cron.job j order by j.jobid limit 1
on conflict (runid) do nothing;

insert into net._http_response (id, status_code, content_type, headers, content,
                                timed_out, error_msg, created)
values (900001, 200, 'application/json', '{}'::jsonb, '{"ok":true}', false, null,
        now() - interval '10 minutes' + interval '1 second')
on conflict (id) do nothing;
