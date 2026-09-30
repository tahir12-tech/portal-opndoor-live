# Hotfix for the live system

**For Balal. 2026-09-29.** The file to run is `HOTFIX-LIVE-FOR-BALAL.sql`,
next to this one. It is two statements and takes a few seconds.

It can be applied now, on its own, without waiting for the new version. It
changes no data, deletes nothing, and adds no tables or columns. If anything
about it looks wrong when you get there, stop and ask; nothing here is urgent
enough to be worth guessing about.

---

## The short version

Three things are open on the live system today. The first two are security;
the third is a screen that is quietly dying and will be dead before long.

1. **Anyone logged in as a manager can mark an application paid without paying
   for it.** They cannot do it through any screen. They can do it by sending
   one request directly to the database, which anybody technical can do from a
   browser console with their own normal login. The same permission also lets
   them change the rent figure that every commission calculation is based on,
   and point an issued Deed of Guarantee at a different document.

2. **A sign-in that has no user profile attached to it is treated as allowed,
   rather than refused.** Four of the actions on an application, plus eight
   others, ask "is this person allowed to do this?", get back "I don't know",
   and carry on. One of those eight lets such an account promote any
   negotiator, at any company, to manager.

   Production had exactly two accounts of this shape, both with MFA set up,
   until you deleted them this morning. The fault is still there; only those
   two accounts are gone.

3. **The Health screen is getting slower every day and will soon stop
   working altogether.** It is the screen that tells you whether the
   automatic overnight jobs are running, so losing it is how you stop finding
   out that something has stopped.

   The cause is a log. Every time a scheduled job runs, the database writes a
   line to a log table, and nothing has ever deleted them. Two of the jobs
   run every minute and every two minutes, so it grows by roughly 2,000 lines
   a day, for ever. The Health screen reads that whole log to work out
   whether each job is healthy.

   Measured on the test system, that had already reached 57,000 lines and the
   Health screen's query was taking **twenty seconds** against an
   eight-second cut-off. Production has been running longer than the test
   system, so it is further along the same curve.

Neither of the first two is being exploited as far as anyone can tell. Both
are the kind of thing that only needs to happen once. The third is not a
security problem at all -- it is housekeeping that was never set up, and it
is included here because it is two lines and you are already going in.

---

## What the fix does

**The first statement** takes away a permission nobody uses. Supabase hands
out full write access to every new table automatically, and for the
applications table that was never narrowed. No screen in the product writes to
that table directly: everything goes through a named action that carries its
own authority, or through a background job. Those keep working untouched.
Reading is not affected at all, so every screen still shows what it shows now.

**The second statement** replaces one small function so that, when it cannot
tell who the caller is, it says "nobody" instead of "I don't know". Every
permission check then refuses instead of shrugging. Nothing changes for anyone
with a normal account.

---

## How it was tested, given production cannot be

There is no copy of production to rehearse on, so the live database's shape was
rebuilt from the code that produced it and the fix was run against that:
`supabase/tests/the_live_hotfix_holds.test.sql`. It shows, in order, that a
manager really can fake a payment today, that all 53 fields on an application
are writable today, that an account with no profile really can withdraw
somebody else's application today, and then that after the two statements all
of that is refused, while withdrawing an application the proper way still
works, every screen still reads, and a normal user is entirely unaffected.
19 checks, all passing.

---

## Before you run it

Paste this into the SQL editor on the **live** project. It only reads.

```sql
select
  has_table_privilege('authenticated','public.applications','UPDATE') as browser_can_write_now,
  has_table_privilege('authenticated','public.applications','SELECT') as browser_can_read_now,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_role')            as app_role_count;
```

Expect `browser_can_write_now = true`, `browser_can_read_now = true`,
`app_role_count = 1`.

If `browser_can_write_now` is already **false**, the first statement has been
applied before, or something else has changed. Stop and ask.

Then check the function is the one this fix expects, because it has never been
read on the live database, only in the code:

```sql
select pg_get_functiondef(oid)
  from pg_proc
 where proname = 'app_role' and pronamespace = 'public'::regnamespace;
```

It should be a one-line function reading `role` from `public.users`. If it
already mentions `coalesce`, the second statement has been applied before.
Stop and ask.

---

## Run it

Open `HOTFIX-LIVE-FOR-BALAL.sql` and paste it into the SQL editor.

**Statements 1 to 3 can go in together.** Statement 4, the very last one, has
to be run **on its own afterwards**. It builds an index using a mode that
keeps the table usable while it works, and that mode is not allowed to run
alongside other statements. If you paste everything at once you will get

> cannot run inside a transaction block

against that last statement and nothing else. That is not a failure and
nothing is half-done: just run that one statement again on its own.

**What statements 3 and 4 do, in plain words.** Statement 3 deletes log lines
older than thirty days and sets up a nightly job to keep doing it, at 3:20am.
Statement 4 adds the index the Health screen's lookup actually needs -- there
was only one index on that table and it was on a column nothing searches by,
which is why every lookup read the entire log from one end to the other.

Thirty days is kept so there is a fortnight of margin for looking back at a
problem. Nothing reads that log beyond a day in normal use.

**Neither touches anything that matters.** They delete log lines and add an
index. No application, no payment, no deed, no email, and not the schedule
itself -- the jobs live in a different table that is not touched. Both are
safe to run at any time of day, with people using the system.

---

## After you run it: the check that it took effect

This only reads. Every answer must match.

```sql
select
  has_table_privilege('authenticated','public.applications','UPDATE') as browser_can_write,
  has_table_privilege('authenticated','public.applications','INSERT') as browser_can_create,
  has_table_privilege('authenticated','public.applications','DELETE') as browser_can_delete,
  has_table_privilege('anon','public.applications','UPDATE')          as logged_out_can_write,
  has_table_privilege('authenticated','public.applications','SELECT') as browser_can_still_read,
  (select count(*) from pg_attribute a
    where a.attrelid = 'public.applications'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))
                                                                      as writable_fields;
```

| answer | must be |
| --- | --- |
| `browser_can_write` | **false** |
| `browser_can_create` | **false** |
| `browser_can_delete` | **false** |
| `logged_out_can_write` | **false** |
| `browser_can_still_read` | **true** — if this is false, something went wrong; tell me |
| `writable_fields` | **0** |

**Why it is written this way.** The obvious way to check permissions is to look
at the permissions table, and that would have been a trap: it cannot see
permissions granted to "everyone" rather than to a named account, so it can
report a clean pass while the browser can still write. The questions above ask
the database directly, which cannot miss it.

Then check the second statement, which needs two answers, not one. Both read
only, and both undo themselves.

```sql
-- A real person still gets their real role.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.users
                             where role = 'management' and status = 'active' limit 1),
                    'role','authenticated','aal','aal2')::text, true);
select public.app_role() as a_real_manager_reads_as;
rollback;

-- Somebody with no profile now reads as nobody, rather than as unknown.
begin;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated","aal":"aal2"}', true);
select public.app_role() as a_ghost_reads_as, public.app_role() is null as still_unknown;
rollback;
```

`a_real_manager_reads_as` must be **management**. `a_ghost_reads_as` must be
empty, and `still_unknown` must be **false**.

**The first of those two matters more than it looks.** If the function were
pasted slightly wrong, it could return empty for *everybody*. An opndoor admin
would not notice, because admin access is checked a different way — but every
manager and negotiator in the product would quietly lose access to everything.
The first query is what catches that, so please do run it.

---

## And the check for statements 3 and 4

Also read-only.

```sql
select
  (select count(*) from cron.job_run_details
     where end_time < now() - interval '30 days')            as old_lines_left,
  (select count(*) from cron.job where jobname = 'job-log-cleanup')
                                                             as nightly_cleanup_set_up,
  (select count(*) from pg_indexes
     where schemaname = 'cron' and tablename = 'job_run_details'
       and indexname = 'job_run_details_jobid_start')        as health_index_there,
  (select count(*) from cron.job_run_details)                as lines_now;
```

| answer | must be |
| --- | --- |
| `old_lines_left` | **0** |
| `nightly_cleanup_set_up` | **1** |
| `health_index_there` | **1** |
| `lines_now` | any number -- it is just how much log is left, and it will be a lot smaller than before |

Then **open the Health screen**. It should load immediately. That is the
whole point of statements 3 and 4, and it is the only check that proves it
from the outside.

If `health_index_there` comes back **0**, statement 4 did not run. That is
the one that has to go in on its own; see "Run it" above. Everything else
will still have worked.

---

## Please do not test it the other way round

It is tempting to prove the hole by faking a payment before applying the fix.
Don't, not on the live system. It would leave a real application marked paid,
with a commission figure attached, that nobody paid for, and there is no clean
way to undo that. That proof has already been done, against a rebuilt copy, in
the test file named above.

If anything at all needs trying by hand, use the dev project
(`nfufwcpgrhfgwtphegca`), never the live one.

---

## What this does not fix

Worth knowing so nobody assumes more than it does.

- **Referrals can still be created by an account with no profile.** The
  creation path checks the caller's *company* rather than their role, so
  replacing the role function does not reach it. It cannot be fixed the same
  way: the same company value is used elsewhere to tell an opndoor admin from
  a partner user, and admins legitimately have no company, so changing it
  would break adding agencies and branches. It needs a slightly larger change
  and its own testing. The new version already fixes it. Listed for Matt in
  `docs/QUEUE.md`.
- **A manager can still edit an agent contact's email address**, which is
  where an executed deed is sent. That is a different table with a deliberate
  permission behind it, not an accident, so it is a decision rather than a
  bug.
- **A manager can still edit colleagues' user records directly**, without it
  appearing in the audit trail.
- **A negotiator can still move the tenancy dates on an application that has
  already been paid**, through the proper amend action, which does not re-issue
  the deed.

None of these are new today, and none of them are changed by this fix.

---

## If something goes wrong

The first statement is reversible by granting the permissions back:

```sql
grant insert, update, delete on public.applications to anon, authenticated;
```

The second is reversible by putting the original function back:

```sql
create or replace function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.users where id = auth.uid() $$;
```

Neither undo loses any data. But if a screen stops working after this, that
would be genuinely surprising and worth telling me about before reverting, so
it can be understood rather than just put back.
