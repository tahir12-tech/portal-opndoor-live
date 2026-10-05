# Handover: taking `partner-api` to production

**For Balal.** Written to be worked through in order. Nothing here has been run
against production by me; every command below is yours to run, and the first
section exists so that you never run one of them for the first time on the real
database.

Two project refs matter, and confusing them is the only unrecoverable mistake in
this document:

| | ref | what it is |
|---|---|---|
| **dev** | `nfufwcpgrhfgwtphegca` | where all of this was built and proved. Safe. |
| **production** | `xogpsaoyprgmxdkmcype` | the live portal. **Do not point anything at this until section 3.** |

You will also create a third, throwaway **clone**, and that is where you start.

---

## 0. What this actually is

`partner-api` is 284 migrations ahead of `origin/main`.

```
migrations on this branch      349
migrations on origin/main       65
new                            284

edge function directories       34   (plus _shared)
on origin/main                  21
```

*Counts refreshed 2026-09-30, and they are counted rather than remembered:
`ls supabase/migrations/*.sql | wc -l` against
`git ls-tree -r --name-only origin/main -- supabase/migrations/`. If you read
this on a later day, count them again rather than trusting the number.*

Production is running `origin/main`, whose schema has not changed since 5 July.
The branch is not a feature on top of it; it is most of a year of work, and the
single biggest risk in this handover is treating it as a normal deploy.

**The SCHEMA goes over in one push, all 268, in filename order, never split.**
That is Matt's instruction and it is also the only thing that works:
migrations are interleaved by date rather than by feature, and the later ones
replace functions the earlier ones create, so there is no subset that is both
coherent and smaller.

What is taken in **six bites** (section 5) is the ROLLOUT — what you deploy,
switch on and point at the database afterwards. The schema being present
changes nothing a user can see until its function is deployed, its cron is
scheduled or its screen is shipped. **After the push, production behaves
exactly as it did before**, and that is the property that makes this safe.

**Only bite 1 plus Regent's keying has to be true on the day.** The other
five can follow that week.

**One ordering rule inside that, and it is absolute: bite 1 before bite 2.**
The front end asks for a column that migration `20261007600000` adds, in the
select that runs at sign-in, so the new bundle against the old schema locks
every user out rather than degrading. Section 3.5 is the step, with the SQL
check to run before you deploy it.

---

## 0a. Read this before anything else: 2026-09-29

Four things changed after this document was written, and the first one comes
BEFORE the cutover rather than as part of it.

### There is no longer a separate hotfix. It is part of the cutover.

**Superseded, 2026-09-30.** There WAS a `docs/HOTFIX-LIVE-FOR-BALAL.md` to
apply to production before the cutover. Matt's decision: *"there is no
separate live hotfix. Everything in HOTFIX-LIVE-FOR-BALAL.md ships with the
cutover instead."* The document is retired and both files are deleted; there
is nothing for you to run by hand and nothing to do before the cutover.

Everything it contained is a migration on this branch, each with a test:

| what it closed | where it is now |
| --- | --- |
| a manager could mark an application paid without paying, by sending one request straight to the database | `20261006720000`, with `the_live_hotfix_holds.test.sql` and `the_browser_does_not_write_an_application.test.sql` |
| a sign-in with no user profile was treated as **allowed** rather than refused, by twelve functions -- one of which let such an account promote any negotiator, at any company, to manager | `20261006470000`, with `a_null_guard_refuses.test.sql` |
| a refund of anything other than the whole fee | `20261006910000`, with `a_refund_is_the_whole_fee.test.sql` |
| the scheduled-job log growing for ever | `20261006960000` |
| the Health screen timing out | `20261006950000`, with `the_health_screen_is_quick.test.sql` |

**The last two are not what the hotfix said they were**, and the difference
matters to you because one of them was an instruction you would not have
been able to carry out.

- The hotfix asked for an index on `cron.job_run_details`. **It cannot be
  created.** `create index` on that table is refused with "must be owner of
  table job_run_details": pg_cron's tables belong to `supabase_admin`, and
  neither a migration nor you running SQL as `postgres` can do it. Measured
  on dev.
- It also asked for 30-day retention, on the understanding that the log's
  SIZE was the problem. Measured: trimming to 30 days took the Health screen
  from 46.7 s to 37.1 s, against an 8 s cut-off; even 7 days only reached
  25.2 s. The size was never the cause.

  The cause was the query: one expensive set computed twice, each read
  seq-scanning 35 MB once per HTTP response. `20261006950000` reads it once,
  through the primary key. **46.7 s to 0.67 s on dev**, with the log still
  untrimmed. The retention job ships too, as housekeeping, and you should
  expect the first run to delete a few weeks' backlog in one go.

### Your local `main` is NOT what production runs

This is the one that could waste a day. The local branch `main` (`f2816a7`)
and the live repository's `origin/main` (`3520a26`) have **diverged**:
neither contains the other. `origin/main` carries eight commits from
27 August to 18 September that the local copy does not — deed email fixes, a
PandaDoc wait, a refund timeout, toast fixes.

Their `supabase/migrations` trees are **byte-identical**, 65 files each, so
every statement in this handover about the DATABASE is unaffected. It is the
application code that differs. **Apply the hotfix against the live
repository's branch, not the local one.**

### Ten more migrations, and what they are

They are in the apply order below like everything else; nothing special is
needed for them. Listed because three change behaviour you would otherwise
meet by surprise.

| | migration | what it does |
|---|---|---|
| 1 | `20261006720000_the_branch_is_at_least_as_strict_as_the_hotfix` | revokes DELETE and TRUNCATE on `applications` (round 7 named only INSERT and UPDATE), and brings `app_role()` into line with the production hotfix so the two databases hold the same definition |
| 2 | `20261006730000_no_portal_identity_has_two_spellings` | the sandbox guard accepts both spellings of "no portal identity". **Without this the partner API's sandbox stops working**, which is how it was found. |
| 3 | `20261006740000_the_cron_may_mint_a_statement_reference` | **the monthly commission statement has never been sent, to anybody.** The permission check refused the only caller that runs it. Not a production fault — that subsystem does not exist on `main` — but it would have shipped broken. |
| 4 | `20261006750000_a_counter_belongs_to_a_route` | volume counters become per-route, so an agency under two suppliers has two counters and not one pooled total |
| 5 | `20261006760000_an_agency_on_two_routes_shows_two_counters` | the same, on the screen |
| 6 | `20261006770000_a_statement_reference_is_a_commercial_artefact` | a Manager can no longer read statement references |
| 7 | `20261006780000_the_second_factor_is_not_optional_on_the_money` | **an Opndoor admin with only a password could change commission rates.** Nine tables were missing the MFA rule that eighteen others had. |
| 8 | `20261006790000_a_supplier_statement_has_a_stored_reference_too` | a supplier's statement can carry the stored `STMT-YYYY-MM-NNNN` |
| 9 | `20261006800000_an_admin_chooses_the_route` | admin New application can state which supplier a referral came through; the server refuses one the branch does not sit under |
| 10 | `20261006810000_one_create_referral_not_two` | drops the older `create_referral` overload the one above created |

### The part of the walk only you can do

`docs/THE-WALK.md`. Every rail was created on dev and every resolver asked
what it produced and **who it would tell** — the fees, the rates, the
recipients.

What could not be walked from here is payment, deed generation and the
emails: no card can be charged and no inbox can be read from a terminal. The
browser steps are listed at the end of that document.

**The one to watch is step 7: who is on the executed-deed email.** That has
been wrong before, and it is the step where being wrong costs a customer
their deed.

### Before go-live: check who the emails come FROM

Matt, 2026-10-01: "on live, emails must send from a verified opndoor.co
address, not onboarding@resend.dev, checked before go-live."

**UPDATED 2026-10-01.** Matt: "Every email is sent from
no-reply@opndoor.co (display name 'opndoor'), with no Reply-To ... The
sender address is a setting, not hardcoded. Add to HANDOVER-BALAL.md:
verify opndoor.co in Resend and set the sender to no-reply@opndoor.co
before go-live, with a check."

**The sender is now a SETTING, not an environment variable.** It lives
in `app_settings` under the key `email_from`, is read by
`public.email_from()`, and an Opndoor admin can change it without a
deploy. `mailer.ts` takes the first of these that is present:

| order | source | why it exists |
|---|---|---|
| 1 | `app_settings.email_from` | what an admin changes, audited |
| 2 | `EMAIL_FROM` | so a deployment can send before anybody can sign in to set it |
| 3 | `opndoor <no-reply@opndoor.co>` | so an email is never unsendable for want of configuration |

Each is a fallback for the one before being ABSENT, never for it being
wrong. **There is no Reply-To on any email** as of 2026-10-01: the
sender is a no-reply mailbox and the footer carries a mailto link to
support@opndoor.co.

**What to check, on the live project, before the first real send:**

1. The domain `opndoor.co` is VERIFIED in Resend, with its DKIM and SPF
   records live. An unverified domain is why `onboarding@resend.dev`
   exists, and Resend will refuse or rewrite a from-address on a domain
   it cannot verify.
2. The mailbox `no-reply@opndoor.co` exists on that domain. Note the
   HYPHEN: the old default was `noreply@`, which is a different mailbox.
3. `app_settings.email_from` reads `opndoor <no-reply@opndoor.co>`.
4. `EMAIL_FROM` is **unset** on live, so the setting is what is in
   force. If it is set it WINS, and an admin changing the setting will
   appear to do nothing.
5. `EMAIL_REVIEW_ADDRESS` is **unset** on live. It redirects every email
   to one inbox, which is right on dev and would mean no customer ever
   receives anything on production.

Point 5 is the one that is silent: everything succeeds, the logs say
sent, and the mail is all in one mailbox.

#### The check

Run this against LIVE. It answers 3 and 4 together, and prints what
every email will actually be sent from.

```sql
select
  coalesce(public.email_from(), '(setting unset)')        as setting,
  coalesce(current_setting('app.email_from_env', true),
           '(check the dashboard: EMAIL_FROM)')           as env_var_note,
  case
    when public.email_from() is null
      then 'FAIL: no setting; the function falls back to its built-in default'
    when public.email_from() not like '%no-reply@opndoor.co%'
      then 'FAIL: not the no-reply@opndoor.co mailbox'
    when public.email_from() !~ '^[^<>]+<[^<>@[:space:]]+@[^<>@[:space:]]+\.[^<>@[:space:]]+>$'
      then 'FAIL: not in the "Name <address>" shape Resend parses'
    else 'OK'
  end                                                      as verdict;
```

`env_var_note` cannot be read from SQL -- an edge function's environment
is not visible to Postgres -- so check `EMAIL_FROM` in the Supabase
dashboard under Edge Functions → Secrets and confirm it is **not set**.

And one live send, to yourself, from the invite flow. Confirm:

- it arrives from **opndoor &lt;no-reply@opndoor.co&gt;**;
- the footer reads **Questions? Email support@opndoor.co** and the
  address is a working mailto link;
- pressing **Reply** offers no-reply@opndoor.co and not a support
  address -- that is correct now, and is why the footer carries the
  mailto.

---

## 1. FIRST: rehearse on a clone. Do not skip this.

Nothing below has been run against a database that has production's DATA in it.
Dev has production's SCHEMA (I applied every migration there) but a different,
much smaller book. The rehearsal is how you find out what 178 migrations do to
real rows.

### 1.1 Make the clone

In the Supabase dashboard: production project, then Database, then Backups, then restore the
most recent backup **into a new project**. Call it something unmistakable, e.g.
`opndoor-cutover-rehearsal`. Note its ref; everything in this section uses it.

> Restoring into the SAME project is the mistake to avoid. If the dashboard ever
> offers "restore in place", you are on the wrong screen.

### 1.1b The fresh-database proof, which is the one that matters most

Apply the migrations to the clone **from zero, in filename order, in one run**,
and then run BOTH test suites against the clone before production is touched.
That is the only thing that proves the files are self-consistent. Everything
else I can tell you was measured against dev, and dev is a working copy that
has had migrations run against it by hand.

That distinction is not theoretical. On dev, an earlier migration had been
re-applied after a later one, so dev and the files disagreed, and a revoke
that made **every user invite fail** sat green in the test suite for a day
because the tests were measuring dev. Three separate locks were found the same
way: new invites, "Remove position", and `set_home_branch`. All are fixed, and
the process that hid them is what this step exists to defeat.

```bash
# From zero, in filename order, in ONE run. Never file by file, and never
# re-running one that has already gone in.
supabase link --project-ref <clone-ref>
supabase db push            # applies every migration in supabase/migrations, in order

# Then BOTH suites, against the clone.
supabase test db            # the pgTAP suite: 35 files
npm test                    # the web suite: 89 files
npm run typecheck
```

Two of those suites are there specifically to catch what bit us:

- `supabase/tests/the_work_still_works.test.sql` asserts that the ordinary
  actions still SUCCEED: invite a user, move them, remove a position,
  change a level, deactivate, reset MFA, read your own book, withdraw, add a
  note, reach the deed path. Every other file in that directory asserts a
  refusal. A suite of refusals cannot see a lock that stops real work, and
  that is exactly what shipped green.
- `supabase/tests/definer_grants.test.sql` asserts that no SECURITY DEFINER
  function is callable by `anon`, and that every one callable by
  `authenticated` is on an allowlist derived from the migration FILES.

**If `supabase db push` fails part way, stop.** Do not apply the rest by hand
and do not re-run the one that failed. Fix the migration, re-make the clone,
and start again. A half-applied chain is the state that produced every problem
above.

### 1.1c Check the files against themselves, before you even make the clone

Two of these need no database at all and take seconds:

```bash
npm run schema:final   # replays every migration in filename order and reports
                       # the final grant state, plus any function whose return
                       # type changes without a DROP (a 42P13 on a clean apply)
npm test               # includes migrationPatterns and testsRunAsTheirRole
```

And once the clone exists and is linked, this compares the two:

```bash
QSH=<a script that runs SQL against the clone> npm run drift
```

`npm run drift` computes what a clean apply of the files WOULD produce -- grants,
function bodies, policies, triggers, column privileges -- and diffs it against a
live database. Against dev it must print "No drift". Against the clone, after
`supabase db push`, it must print the same. If it does not, the clone and the
files disagree and something was applied out of order.

### 1.2 Capture the before picture

These run under `psql`, not the SQL editor: `10_capture.sql` takes a `label`
variable and is run **twice**, once before the migrations and once after, so the
comparison is between two labelled snapshots of the same database.

```bash
export CLONE="postgres://postgres:<password>@db.<clone-ref>.supabase.co:5432/postgres"
cd scratchpad/invariance

psql "$CLONE" -v ON_ERROR_STOP=1 -f 00_setup.sql
psql "$CLONE" -v ON_ERROR_STOP=1 -f 10_capture.sql -v label=before
```

`00_setup.sql` creates the capture tables. `10_capture.sql` walks every table
through `to_jsonb(t.*)` and every function through the catalogue, so it runs
unchanged against both the old schema and the new one. That last property is the
whole trick: the same script describes both worlds.

### 1.3 Apply the migrations

```bash
cd ../..                                  # back to the repo root
npx supabase link --project-ref <clone-ref>
npx supabase db push
```

`db push` applies only what is missing, in filename order. Expect 178. If it
stops, it stops on the first failure: everything before it is applied and
committed, everything after is not. Fix and re-run; it is resumable.

### 1.4 Capture the after picture, and compare

```bash
cd scratchpad/invariance
psql "$CLONE" -v ON_ERROR_STOP=1 -f 10_capture.sql -v label=after
psql "$CLONE" -v ON_ERROR_STOP=1 -f 20_compare.sql
psql "$CLONE" -v ON_ERROR_STOP=1 -f 30_expected_changes.sql
psql "$CLONE" -v ON_ERROR_STOP=1 -f 40_new_surface.sql
```

`20_compare.sql` diffs before against after. `30_expected_changes.sql` is the
allow-list: the things that are SUPPOSED to move, so the diff can be read rather
than stared at. `40_new_surface.sql` lists what is newly reachable, which is how
you check that nothing became reachable that should not have.

**What a good result looks like:** every existing application's `status` and
commission unchanged; no partner's rates moved; no policy removed from a table
that had one. New tables, new columns and new functions are expected and listed.

**The one change you SHOULD see and must not be alarmed by:** every existing
application gains `fee_amount = monthly_rent` and `fee_basis_weeks = 4.33`. That
is `20260928100000` backfilling the fee, and it is a no-op in money terms,
because until this branch the fee WAS one month's rent.

**Stop and tell Matt** if any existing row's `status` or commission moved.

> The scripts' own headers say "166 migrations". They were written when there
> were 166; there are now 201. The scripts themselves are generic and do not
> count, so the number in the comment is stale and harmless. The same goes for
> any count written in this document before the branch stopped moving: the
> authoritative answer is always the `ls | wc -l` in 1.4, never a number typed
> into prose.

### 1.4b The commission rates and deals survived, and a referral still freezes them

**Why this check is new.** `20261007680000` stopped "Add supplier" handing out a
silent 25% / 10% commission deal. It drops the DEFAULT on
`partners.partner_rate` and `partners.agent_rate` and makes both columns
nullable, so a supplier created from now on has no deal until somebody sets
one.

**It changes no existing row**, and that is exactly the claim to verify rather
than take on trust: dropping a default cannot alter a value that is already
there, and on dev all eleven partners kept their rates. The clone is where that
is confirmed against LIVE data, which nobody has inspected.

**And one thing genuinely behaves differently afterwards.** `resolve_rates` now
coalesces its answer to `0` as a last resort. Before, the columns were NOT NULL
so there was nothing to coalesce; now a partner with no rate and no agreement
prices a referral at nothing rather than failing on
`applications.partner_rate`'s NOT NULL. That is deliberate (refusing such a
referral outright is an After-launch item), but it means **a supplier whose
rates went missing would be silent instead of loud**. Hence check 3.

#### 1. Every partner's rates are exactly what they were

```sql
-- Run BEFORE the migrations, keep the output, run again AFTER, and diff.
-- `20_compare.sql` covers this generically; this is the same claim in a form
-- you can read without reading a diff.
select slug, partner_rate, agent_rate
  from public.partners
 order by slug;
```

- [ ] identical before and after, row for row

#### 2. Every live supplier's commission agreement is still there

```sql
select p.slug,
       p.partner_rate,
       p.agent_rate,
       count(pa.id) filter (where pa.kind = 'commission'  and pa.ended_at is null) as commission_deals,
       count(pa.id) filter (where pa.kind = 'agent_share' and pa.ended_at is null) as share_deals
  from public.partners p
  left join public.pricing_agreements pa
         on pa.scope_level = 'partner' and pa.scope_id = p.id
 where p.partner_kind = 'supplier'
 group by p.slug, p.partner_rate, p.agent_rate
 order by p.slug;
```

- [ ] every supplier that had an agreement before still has one
- [ ] Rightmove's row reads the rates you expect, and you have checked them
      against what Rightmove is actually contracted to

#### 3. Any supplier with rates but NO agreement row: LIST IT FOR MATT

Matt's own words: *"If any live supplier has rates without an agreement row
(like New Supplier 2 on dev), list it for me before go-live."*

```sql
select p.slug, p.name, p.partner_rate, p.agent_rate
  from public.partners p
 where p.partner_kind = 'supplier'
   and (p.partner_rate is not null or p.agent_rate is not null)
   and not exists (
     select 1 from public.pricing_agreements pa
      where pa.scope_level = 'partner' and pa.scope_id = p.id
        and pa.kind = 'commission' and pa.ended_at is null)
 order by p.name;
```

**On dev this returns four: ACME TEST, New Suplier, New Supplier 2 and New
Supplier 3.** Each got 25% / 10% from the old default with nobody agreeing it,
and each has `rate_edits = 0` in `partner_audit`. They are test rows and were
deliberately left alone.

On LIVE the same query may return a real company being paid a rate nobody
recorded a deal for. That is a commercial question and not a technical one.

- [ ] query run, output pasted to Matt, **before go-live**
- [ ] empty result, or Matt has seen the list and said to proceed

#### 4. A test referral through Rightmove freezes the real rates, not 0

Do this during the clone walk (section 11), with a referral through Rightmove
rather than a hand-written insert: the point is to exercise `resolve_rates` and
`freeze_commission_lines` the way the product does.

```sql
-- Replace GR-XXXXX with the reference the walk created.
select a.guarantee_ref,
       a.partner_rate        as frozen_on_the_application,
       a.agent_rate          as frozen_agent_rate,
       l.level, l.rate, l.basis_amount, l.amount
  from public.applications a
  left join public.application_commission_lines l on l.application_id = a.id
 where a.guarantee_ref = 'GR-XXXXX'
 order by l.level;
```

- [ ] `frozen_on_the_application` is Rightmove's real rate, **not 0 and not
      null**
- [ ] there is a `supplier` line, and its `rate` matches
- [ ] the `amount` is that rate times `basis_amount`, to the penny

**A zero here is the failure this check exists for.** It would mean the
referral resolved no rate and took the new fallback, and it would be silent
everywhere else: the application is created, the statement shows nothing owed,
and the first person to notice is Rightmove.

**Stop and tell Matt** if any of the four boxes above is unticked.

### 1.5 Then walk it

Deploy functions and secrets to the clone (sections 6 and 7 with `$CLONE`), then
run the clone walk in section 11. That is the rehearsal proper: the migrations
applying cleanly is necessary and not sufficient.

**Point the new front end at the clone for this, and do it in the cutover order:
migrations (1.3), then the front end.** This is where the 3.5 dependency gets
rehearsed rather than discovered. Signing in to the clone on the new bundle is
the test, and it is the same single action that proves it on the day.

---

## 2. Knowing what is applied where

The question "which migrations does this database have" is answerable directly.
Run against any project:

```sql
-- What the database thinks it has applied.
select version, name
from supabase_migrations.schema_migrations
order by version;
```

```sql
-- How many, and where it stops.
select count(*) as applied,
       min(version) as first,
       max(version) as last
from supabase_migrations.schema_migrations;
```

To diff a database against this branch, run the first query, save it, and:

```bash
# the branch's list
ls supabase/migrations/*.sql | xargs -n1 basename | sed 's/_.*//' | sort > /tmp/branch.txt
# paste the database's version column into /tmp/db.txt, then:
comm -23 /tmp/branch.txt /tmp/db.txt   # on the branch, NOT in the database
comm -13 /tmp/branch.txt /tmp/db.txt   # in the database, NOT on the branch  <-- investigate any
```

The second list should be empty. Anything in it was applied to that database by
hand and is not in version control, which you need to know about before you push
anything.

---

## 3. Production runbook

Do this only after section 1 has passed on a clone.

### 3.1 Before you touch anything

```bash
# A fresh backup, taken by you, whose restore point you know.
# Dashboard -> Database -> Backups -> "Backup now". Wait for it to complete.
# Write the timestamp here: ____________________
```

Confirm you are pointed at the right project and say it out loud:

```bash
npx supabase link --project-ref xogpsaoyprgmxdkmcype
npx supabase projects list      # confirm the linked one is highlighted
```

### 3.2 Announce

The migrations take a few minutes and the schema changes under the running app.
Nothing here drops a column or a table, so a browser holding the old bundle keeps
working, but a referral created mid-push could land before its own new columns
exist. Pick a quiet window. Twenty minutes is plenty.

### 3.3 Push

```bash
npx supabase db push
```

Watch it. If it fails, note the migration it failed ON: everything before it is
applied and committed, everything after is not.

### 3.4 Verify before you let anyone in

```sql
-- 1. Count. Should match the branch.
select count(*) from supabase_migrations.schema_migrations;

-- 2. Nothing lost. Every one of these should return zero.
select count(*) from public.applications where status is null;
select count(*) from public.applications where fee_amount is null;
select count(*) from public.partners where partner_rate is null;

-- 3. The fee backfill is a no-op in money terms.
select count(*) as should_be_zero
from public.applications
where abs(fee_amount - monthly_rent) > 0.005
  and pricing_agreement_id is null;

-- 4. The new sequence guard found nothing pre-existing.
select count(*) as out_of_order from public.applications where sequence_anomaly;
```

### 3.5 Deploy the front end, and NOT before the migrations

**This is bite 2 (section 5), and it has a hard dependency on bite 1 that the
earlier wording did not state.** Do it after 3.3 has succeeded and 3.4 is clean.
Not alongside, not first.

**Why the order is mandatory, not tidy.** The new bundle asks the `partners`
table for a column called `partner_kind`, by name, in the select that runs
immediately after sign-in (`src/lib/hydrate.ts`). It is added by migration
`20261007600000`. Against a database that has not had that migration applied,
PostgREST answers that select with an error, `hydrateFromSupabase` throws, and
`SessionContext` deliberately does not set `ready` when hydration fails. The
symptom is not a missing Suppliers list or a blank chart:

> **Nobody can sign in.** Every user who authenticates is returned to the
> sign-in screen with no way forward, including you.

It is the same fail-closed shape as `generateDeed` and its lease in 6b, and it
fails for the whole estate rather than one journey. There is no partial state
and nothing to notice early: the first person to try is the first to find out.

The reverse order is harmless. The migration on its own changes nothing a user
can see, because the old bundle never asks for the column.

```bash
# ONLY after 3.3 succeeded and 3.4 returned zeros.
npm run typecheck && npm run build
# then publish dist/ the way this project publishes it,
# keeping the previous build's artefact (see "Why bite 2 is the one to watch").
```

#### The check, before you deploy the front end

Run this against **production**. It must return `t`. If it returns `f`, or no
row, stop: 3.3 has not finished and the bundle will lock everyone out.

```sql
select exists (
  select 1 from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'partners'
     and column_name  = 'partner_kind'
) as safe_to_deploy_the_front_end;
```

Belt and braces, because the column existing is not quite the same as the
migration having been recorded:

```sql
-- Should return one row. If it returns none, the column came from somewhere
-- other than the migration and you want to know why before you ship.
select version from supabase_migrations.schema_migrations
 where version = '20261007600000';
```

> **Run that second one on production or the clone, NOT on dev.** Both of those
> get their migrations through `supabase db push`, which records every file it
> applies, so the ledger is trustworthy there. Dev does not: its
> `schema_migrations` stops at `20260922110000` while the branch has 411 files,
> because everything since has been applied to dev directly. That is the
> standing reason `npm run drift` is the authority on this project and the
> ledger is not. On dev the first check returns `t` and the second returns
> nothing, and neither tells you anything is wrong.

If you want the bluntest possible version of the first check, ask the database
the same question the app asks. It errors rather than returning `f`, which on a
pre-deploy gate is the more useful shape:

```sql
select partner_kind from public.partners limit 1;
```

#### And the check after it

Sign in as one real user on the new bundle before you let anyone else in. A
successful sign-in is the whole test: it is the thing that breaks, and it
cannot half-work.

- [ ] `safe_to_deploy_the_front_end` returned `t`
- [ ] `20261007600000` is in `schema_migrations`
- [ ] front end deployed, previous artefact kept
- [ ] signed in successfully on the new bundle

### 3.6 Rollback

**There is no "unapply migrations" button, and you should not go looking for
one.** 178 migrations include column drops, type changes and data backfills; a
reverse script would be longer than the forward one and would itself be
unrehearsed. The rollback is the backup.

| situation | what to do |
|---|---|
| `db push` failed part way and the app is broken | Restore the backup from 3.1. You lose anything written since. This is why the window is short and announced. |
| `db push` succeeded, app is broken | Restore the backup. Same cost. |
| `db push` succeeded, app works, one screen is wrong | **Do not restore.** Fix forward. A restore to undo a cosmetic fault costs real money written since the backup. |
| One bite is wrong and later bites are not applied | Nothing to roll back: bites 2 to 6 are additive and unreferenced until their code ships. |

The practical consequence: **the decision to restore has to be taken within
minutes, not hours**, because the cost is everything written since. Agree in
advance who makes that call.

---

## 4. Keying Regent

`scratchpad/regent/01-key-regent.sql`. Copy it into the production SQL editor and
read it before running; it is 159 lines and commented throughout.

It is **idempotent** and **self-verifying**: it opens a transaction, makes the
agency, and then prints ten verification rows. You read them, and then you type
`COMMIT` or `ROLLBACK` yourself. It does not commit for you.

What it makes:

- **Regent Property**, an agency under the house partner `opndoor-agents`. That
  is what puts them in our estate: org tree, agreement, joint tenancies,
  commission split per tenancy.
- **Their own referencing route** (`pre_referenced_open`), so their applicants go
  straight to a payment link with no eligibility form.
- **Their deal**, as a pricing agreement: 1 tenant 3 weeks at 20%, 2 or more 5
  weeks at 25%.

What it deliberately does not make:

- **No explicit `agent_rate` on the agency.** The agreement IS their rate. A
  party holds one or the other, never both, and the trigger refuses the pair.
- **No user invite.** Inviting Rosa is a UI action so that she gets a real
  branded email. Do it from the portal after the script commits.

The ten verification rows to read before committing:

| # | check | expected |
|---|---|---|
| 1 | agency exists, on the estate, referencing its own tenants | true |
| 2 | no explicit rate on the agency | true |
| 3 | branches | 1 |
| 4 | exactly one live agreement | 1 |
| 5 | the bands | 1 tenant / 3 wks / 20%, 2+ / 5 wks / 25% |
| 6 | a £2,000 single tenant is charged | £1,384.62 |
| 7 | a £2,000 pair is charged, once | £2,307.69 |
| 8 | commission at one / at two | 20% / 25% |
| 9 | the form will offer a second tenant | true |
| 10 | deed delivery is ready | **false until Rosa accepts her invite** |

Row 10 being false is expected and is not a blocker: deed delivery resolves to
*active* people, and an invited-but-not-accepted manager is not active. It turns
true when she signs in. **Check it again after she does**, because until it is
true her deeds park for a staff send.

---

## 5. The six bites

**First, a correction to how this sounds.** "Six bites" does not mean six
database pushes. It cannot: migrations apply in filename order, they are
interleaved by date rather than by feature, and the later ones replace functions
the earlier ones created. There is no subset of the 268 that is both coherent and
smaller. The schema goes over in **one push**.

What IS bitten is the ROLLOUT: what you deploy, switch on and point at the
database afterwards. The schema being present changes nothing a user can see
until its function is deployed, its cron is scheduled or its screen is shipped.
That is the property that makes this safe, and it is worth understanding before
you start: **after the push, production behaves exactly as it did before.**

| # | bite | what you do | user-visible effect | Monday? |
|---|---|---|---|---|
| **1** | **Schema** | `db push`. All 268, in filename order, in one run. | **None.** New tables, columns and functions nothing yet calls. | **YES** |
| **2** | **The app** | Deploy the built front end. **Only after bite 1: see 3.5.** | Everything the UI does: the estate screens, Team, the new Applications and Reporting, agreements. **This is the big one to watch.** | **YES** |
| **3** | **Regent** | Run the keying script (section 4), invite Rosa. | Regent exists and can refer. | **YES** |
| 4 | Core functions | Deploy the 12 new edge functions; set their secrets; point the webhooks. | The tenant journey end to end: payment page, deeds, tenant portal, partner API. | only what Regent's journey touches |
| 5 | Scheduled work | Schedule `commission-statements-0700/0800`. Everything else is already scheduled. | The monthly statement email. | no, first send 1 November |
| 6 | Integrations | HubSpot sync, partner webhooks, the Dev Centre. | Partner-facing plumbing. | no |

**For Monday you need 1, 2, 3, and the part of 4 that Regent's own journey
touches**: `payment-page`, `stripe-webhook`, `pandadoc-webhook`,
`send-deed-to-agent`, `create-referral`. The rest can follow that week.

### Why bite 2 is the one to watch

Bite 1 is invisible and bite 3 is one reversible script. Bite 2 replaces every
screen at once, and it is the only step with no partial state: a user has either
the old bundle or the new one. If something is wrong, rolling back is
redeploying the previous build, which is fast and costs nothing. **Keep the
previous build's artefact.**

**And it depends on bite 1, which is new in this release.** The bundle asks
`partners` for `partner_kind` (migration `20261007600000`) in the select that
runs at sign-in, and that select failing stops sign-in for everybody rather
than breaking one screen. Deploy bite 2 against a database without bite 1 and
nobody can get in, you included. **Section 3.5 is the step and the check.** The
table above is in dependency order for this reason, not only for nerves.

### A dependency worth knowing

The per-tenant deed rule (`20261005110000`) supersedes the one-deed-per-tenancy
rule from earlier in the same push. Both are in bite 1, so this does not bite
you, but if Regent sends a joint tenancy the deeds are per tenant from the
first one. There is no retrofit for tenancies issued under the old rule, and
production has none, because production has no joint tenancies at all.

## 6. `supabase/config.toml`, and deploying the functions

The file in the repo is the source of truth. The entries that matter are the JWT
gates: a function invoked by a cron, by a third-party webhook, or by a browser
with no session cannot present a user JWT, so it must be listed with
`verify_jwt = false` and authenticate itself another way. The platform check runs
*before* the function's first line, so a missing entry is a 401 nobody sees.

**Corrected 26 September.** This section previously said there were seventeen
entries and that `partner-api` was deliberately not among them, keeping the
default gate and validating its key "after the platform has already required a
JWT". That was wrong, and wrong in the direction that breaks partners:
`partner-api` is deployed with `verify_jwt = false`, and its own header comment
has always said `verify_jwt = FALSE, required`, because a partner presents an API
key and not a Supabase JWT. If you had deployed it with the gate on, every partner
integration would have returned 401 before reaching any of our code. Five entries
were missing altogether; they are in the file now and the reconciliation below
returns clean.

There are **22** entries, all `verify_jwt = false`, grouped by what authenticates
them instead:

| authenticated by | functions |
|---|---|
| a provider's request signature | `stripe-webhook`, `pandadoc-webhook` |
| `x-ops-secret` / `x-reminders-secret`, from `ops_secrets` | `payment-reminders`, `expiry-reminders`, `expiry-cohorts`, `renewal-notices`, `weekly-digest`, `hubspot-sync`, `ops-alert`, `commission-statements`, `partner-webhooks` |
| a partner API key the function validates | `partner-api` |
| a tokenised link the recipient was sent | `payment-page`, `payment-confirmation`, `send-password-reset`, `tenancy-correction` |
| the tenant's own session, issued by the function | `tenant-auth`, `tenant-portal` |
| the referencing provider's token | `referencing-inbound`, `referencing-callback` |
| a signed-in portal user, checked by the function, plus its own CORS preflight | `create-referral`, `invite-user` |

`create-referral` and `invite-user` are the two to look at again rather than
inherit: their source headers say `verify_jwt = true` and their deployments say
false, and they have disagreed for as long as both have existed. The file records
the deployment, because the deployment is what runs. Settle it deliberately and
fix the losing side.

### 6a. Reconcile before you deploy

Never deploy functions in bulk without checking this first. It takes a minute and
it is the difference between a safe deploy and a silent outage:

```bash
npx supabase functions list --project-ref <REF> --output json > /tmp/fns.json
python3 - <<'EOF'
import json, re
fns = json.load(open('/tmp/fns.json'))
cfg = open('supabase/config.toml').read()
declared = {m.group(1): m.group(2) == 'true' for m in re.finditer(
    r'^\[functions\.([\w-]+)\]\s*\n(?:[^\[]*?)^verify_jwt\s*=\s*(true|false)', cfg, re.M)}
bad = [(f['slug'], f['verify_jwt'], declared.get(f['slug'], True))
       for f in fns if declared.get(f['slug'], True) != f['verify_jwt']]
print('declared:', len(declared), '| mismatches:', len(bad))
for s, dep, eff in bad:
    print(f'  {s}: deployed {dep}, a deploy would set {eff}')
EOF
```

**It must print `mismatches: 0`.** A non-zero line names a function whose
deployed gate disagrees with the file, and deploying it will change its gate. Fix
the file first, or deploy that one on its own with the flag it needs.

### 6b. Deploy all of them

> **MIGRATIONS FIRST, FUNCTIONS SECOND. This release makes that mandatory, not
> just tidy.** `generateDeed` now takes a lease (`take_deed_lease`, migration
> `20261005280000`) before it will generate anything, and it **fails closed**: if
> the RPC is not there, it generates no deed and records the failure. Deploy the
> functions against a database without that migration and *every* deed stops,
> loudly. The order in section 1.3 and 3.3 already puts migrations first; this is
> the reason not to improvise.
>
> **The front end has the same shape, and worse reach.** It asks `partners` for
> `partner_kind` (`20261007600000`) at sign-in, and against a database without
> it nobody can sign in at all. See 3.5. Two fail-closed dependencies on the
> same push, in the same direction: schema, then everything that reads it.
>
> Fail-closed is the deliberate choice. A delayed deed parks as needs-attention
> after three attempts and a person fixes it in minutes. Two live signable
> guarantees for one tenancy, one of which nothing in the portal is tracking, is
> not recoverable at all.

With the reconciliation clean, the flags come from the file and no flag needs
typing:

```bash
npx supabase functions deploy --project-ref <REF>
```

Deploy **every** function, not only the ones you changed. Functions bundle
`supabase/functions/_shared/*`, so a change to one shared file makes every
function that imports it stale, and the staleness is invisible: the function keeps
answering, with old code. On 26 September, 29 of 33 functions on dev were running
code older than the repo, and the tenant payment email was stating the rent as the
fee for two days because `create-referral` had been fixed at 10:17 and deployed at
10:16.

To see what is behind before you start:

```bash
git log -1 --format=%ct -- supabase/functions/_shared    # newest shared change
# compare against updated_at in /tmp/fns.json (milliseconds)
```

### 6c. The order, and what to check after each

Deploy in this order. It is not a dependency order (functions are independent);
it is the order that lets you catch a break before it costs you a real payment.

| # | function | gate | check it answers |
|---|---|---|---|
| 1 | `tenant-auth` | false | `POST` with no body returns its own JSON error, not a platform 401 |
| 2 | `tenant-portal` | false | same |
| 3 | `payment-page` | false | `GET /functions/v1/payment-page?token=bad` returns its own "not found", not 401 |
| 4 | `create-referral` | false | `POST` with no auth returns its own `{"ok":false,...}` |
| 5 | `payment-confirmation` | false | its own error |
| 6 | `stripe-webhook` | false | unsigned `POST` returns a signature error, **not** 401. A 401 here means the gate is on and every payment will be lost |
| 7 | `pandadoc-webhook` | false | unsigned `POST` returns a signature error, not 401 |
| 8 | `send-deed-to-agent`, `send-deed-to-landlord`, `deed-download` | true | `POST` with no auth returns 401 (correct: these are staff-invoked) |
| 9 | the cron set | false | `POST` without `x-ops-secret` returns its own refusal, not 401 |
| 10 | `partner-api`, `partner-webhooks` | false | `POST` with no key returns its own error, not 401 |
| 11 | everything else | per file | it answers at all |

The distinction to watch for throughout: **a platform 401 has an empty or generic
body; our refusals are JSON we wrote.** If a function that should authenticate
itself returns a bare 401, its gate is on and the entry is missing from
`config.toml`.

After the chain is deployed, re-walk from the pay link (section 11): the payment
email, the `/pay` page, the Stripe redirect, the webhook, the deed. That walk
exercises 1 to 8 in the order a tenant hits them.

---

## 7. Secrets

Set on the project, not in the repo. Eighteen names, plus sandbox variants.

```bash
npx supabase secrets set --project-ref <ref> \
  SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
  APP_URL=https://portal.opndoor.co \
  PORTAL_ENV=production \
  RESEND_API_KEY=... EMAIL_FROM=... EMAIL_REPLY_TO=... \
  OPS_ALERT_ADDRESS=... \
  STRIPE_SECRET_KEY=sk_live_... STRIPE_PUBLISHABLE_KEY=pk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
  PANDADOC_API_KEY=... PANDADOC_TEMPLATE_ID=... \
  REMINDERS_CRON_SECRET=... \
  HUBSPOT_ACCESS_TOKEN=... \
  REFERENCING_API_URL=... REFERENCING_API_EMAIL=... REFERENCING_API_PASSWORD=... REFERENCING_API_TOKEN=...
```

**`EMAIL_REVIEW_ADDRESS` must NOT be set on production.** When it is set, every
outbound email is redirected to it. That is what makes the clone safe and what
would make production silent.

**The `_TEST` suffix is not a convenience.** Sandbox reads `NAME_TEST` and
**never falls back to the live value** (`_shared/livemodeCredentials.ts`). So on
production you set the base names; on the clone you set the `_TEST` ones and a
sandbox key cannot accidentally charge a real card.

Also seed, in SQL, on each project:

```sql
-- The cron secret, read at run time by every scheduled job.
insert into public.ops_secrets (name, secret) values ('reminders_cron', '<same value as REMINDERS_CRON_SECRET>')
on conflict (name) do update set secret = excluded.secret;

-- The base URL the crons post to. Without it every cron job no-ops, deliberately.
-- Note this lives in ops_secrets too, not in a settings table: ops_functions_base_url()
-- reads `select secret from ops_secrets where name = 'functions_base_url'`.
insert into public.ops_secrets (name, secret) values ('functions_base_url', 'https://<ref>.supabase.co')
on conflict (name) do update set secret = excluded.secret;
```

That second one is the guard that stops a restored clone's crons posting at
production. **Set it last, and check it first if a clone starts doing something
alarming.**

---

## 7a. APP_URL: the address every emailed link is built on

**Walk fix 34.** Get this wrong and every invitation, password reset and
payment link in the product points somewhere the recipient cannot reach.

`APP_URL` is an Edge Function secret, and `_shared/safeOrigin.ts` prefers it
over anything the caller sends -- deliberately, so that whoever calls a
function cannot choose where a genuine Opndoor-branded email points. That
makes it the single place the live address is set, and the single place it
can be wrong.

**It was wrong on dev**, which is how this was found: `APP_URL` was
`http://localhost:5173` while the dev portal runs on `5174`, so accepting an
invitation went to a dead address. Fixed on dev on 2026-09-30.

### The cutover step

Set it to the live portal address, with no trailing slash:

```
APP_URL=https://<the live portal hostname>
```

Set it the same way as the other secrets in section 7. It is read at
invocation, so **no redeploy is needed** after changing it -- but see the
check below, because "no redeploy needed" is also why a wrong value goes
unnoticed.

### The check, before you hand back

The Management API returns secrets as a SHA-256 digest of the value, never
the value. That is enough to prove it exactly, without the value ever being
printed:

```bash
# What is set:
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/<live-ref>/secrets" \
  | python3 -c "import json,sys;print([s['value'] for s in json.load(sys.stdin) if s['name']=='APP_URL'][0])"

# What it SHOULD be:
python3 -c "import hashlib;print(hashlib.sha256(b'https://<the live portal hostname>').hexdigest())"
```

The two must be identical. If they are not, the value is not what you think
it is -- including a stray trailing slash or `http` where you meant `https`,
both of which produce a completely different digest.

### And then actually click one

Invite yourself, open the email, and click the link. The digest proves the
string; only clicking proves the address resolves, the certificate is valid,
and `/accept-invite` is served. Two different questions.

### The other half: Supabase Auth's own redirect allow-list

`APP_URL` decides what the link says. Supabase Auth decides whether it will
honour a redirect to it. In **Authentication -> URL Configuration** on the
live project:

- **Site URL** must be the live portal address.
- **Redirect URLs** must include `https://<the live portal hostname>/**`.

On dev the allow-list still carries `localhost:3000`, `:5173` and `:5174`,
which is right for dev and must NOT be copied to production.

**And Site URL is not cosmetic, which is the part worth knowing.** It is the
FALLBACK GoTrue uses whenever a link is generated with no `redirect_to`, or
with one the allow-list refuses. Measured on dev on 2026-09-30: Site URL was
`http://localhost:3000`, a port nothing runs on, so any link that lost its
`redirect_to` for any reason landed nowhere -- silently, because the link
itself looks perfectly normal. Set to `http://localhost:5174` on dev the same
day.

So there are two ways an invitation can point at a dead address and only one
of them is `APP_URL`. Check both.

### The check for this half

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/<live-ref>/config/auth" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('site_url =',d['site_url']);print('allow    =',d['uri_allow_list'])"
```

`site_url` must be the live portal address and the allow list must contain
it. Unlike the secrets endpoint this returns the real value, so you can read
it directly.

**Then prove it end to end, without sending anybody an email.** The admin
`generate_link` endpoint returns a link without delivering it:

```bash
curl -s -X POST "https://<live-ref>.supabase.co/auth/v1/admin/generate_link?redirect_to=https%3A%2F%2F<host>%2Faccept-invite" \
  -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE" \
  -H "Content-Type: application/json" \
  -d '{"type":"recovery","email":"<your own address>"}' \
  | python3 -c "import json,sys,urllib.parse;l=json.load(sys.stdin)['action_link'];print(urllib.parse.parse_qs(urllib.parse.urlparse(l).query)['redirect_to'])"
```

It must print your live `/accept-invite` address. If it prints the Site URL
instead, the allow-list does not contain what you asked for.

**One trap, found doing exactly this on dev.** `redirect_to` must be a QUERY
PARAMETER on that endpoint. Passed inside the JSON body as
`options.redirect_to` it is accepted, ignored, and silently replaced with the
Site URL -- which reads as "the allow-list is wrong" when nothing is wrong at
all. The supabase-js client sends it correctly; a hand-written curl is where
this bites.

---

## 8. Crons

Sixteen jobs after this branch, thirteen of which already exist on production.

```sql
select jobname, schedule, active from cron.job order by jobname;
```

| job | schedule (UTC) | why two |
|---|---|---|
| `expiry-cohorts-0700` / `-0800` | `0 7,8 * * *` | pg_cron is UTC, London is not. One of the pair is always 08:00 London; the function self-gates and the off-hour run no-ops. |
| `expiry-reminders-0700` / `-0800` | `0 7,8 * * *` | same |
| `payment-reminders-0700` / `-0800` | `0 7,8 * * *` | same |
| `renewal-notices-0700` / `-0800` | `0 7,8 * * *` | same |
| `weekly-digest-0700` / `-0800` | `0 7,8 * * 1` | same, Mondays |
| **`commission-statements-0700` / `-0800`** | `0 7,8 * * *` | **NEW.** Daily, and the FUNCTION decides whether today is the send day. |
| **`deed-sweep-hourly`** | `20 * * * *` | **NEW.** Hourly, not a pair: there is no London hour to hit, only how long a paid tenant may wait without a deed. |
| `hubspot-sync` | `*/2 * * * *` | |
| `partner-webhooks` | `* * * * *` | |
| `rate-limit-cleanup` | `7 * * * *` | |

**The pairs are deliberate and are not to be tidied away.** `CUTOVER.md` records
the same decision in the same words: the database runs in UTC, the second job
covers British Summer Time, both fire, and the ledger makes the second a no-op.
I checked that claim rather than taking it on trust: `fire_payment_reminders`
claims into `payment_reminders` with `on conflict do nothing` and skips when the
insert finds nothing, so a second run the same day returns no rows and sends no
email. Asserted in `supabase/tests/pay_link_outlives_a_day.test.sql`. If you find
yourself about to delete one of a pair, read this paragraph again.

### 7.9 EVERY MIGRATION IN THIS BATCH, IN APPLY ORDER

They apply in filename order, so this is the order they run. The count and the
list are what to diff against `supabase_migrations.schema_migrations` on the
clone if anything looks wrong; the authoritative count is always the
`ls | wc -l` in 1.4, never this prose.

| # | migration | what it changes |
|---|---|---|
| 1 | `20261006089000_make_manager_has_never_worked` | `admin_update_user_role` wrote seven columns that did not exist; Make Manager had never worked |
| 2 | `20261006090000_the_level_ladder` | Director / Manager / Negotiator as ranks, `may_act_on_user`, `assert_may_grant_level` |
| 3 | `20261006091000_every_person_control_respects_the_ladder` | eight person controls gated, plus the `users_level_ladder_guard` trigger |
| 4 | `20261006100000_a_paid_application_with_no_deed_is_found` | `deeds_awaiting_generation` |
| 5 | `20261006101000_deed_sweep_cron` | the hourly deed sweep at `:20`. **Inert unless `functions_base_url` is set (see 8.1).** |
| 6 | `20261006110000_commission_is_apportioned_not_rounded_twice` | commission apportioned to the penny; re-freezes affected rows |
| 7 | `20261006120000_a_fee_basis_has_a_unit` | Weeks / Months on a fee basis. **Rewrites seven pricing functions; watch this one in the rehearsal.** |
| 8 | `20261006130000_replay_what_the_missing_map_skipped` | winds the HubSpot cursor back for partners whose events drained without an association |
| 9 | `20261006140000_health_tells_you_what_to_do` | `cron_health` gains per-job attribution and the base URL; drops `needs_attention` |
| 10 | `20261006150000_a_manager_may_not_edit_another_agency` | scopes `users_mgmt_update`; adds `receives_notifications`, its RPC and its trigger guard |
| 11 | `20261006160000_the_deed_goes_to_whoever_sent_the_referral` | the deed goes to the referrer; drops the nominated override; fixes the direct rail |
| 12 | `20261006170000_an_agency_is_the_boundary_not_the_partner` | **the riskiest one.** Rescopes the three `applications` policies from partner to agency |
| 13 | `20261006180000_the_resend_follows_the_same_rule_and_reminders_fire` | manual Resend uses the one resolver; `fire_expiry_reminders` stops writing a column that never existed |
| 14 | `20261006190000_a_cron_email_is_scoped_to_the_reader` | `staff_notification_scopes`: a scheduled email's recipients per reader |
| 15 | `20261006200000_a_scheduled_send_is_ledgered_per_reader` | `user_id` on the digest and cohort ledgers |
| 16 | `20261006210000_the_weekly_digest_counts_one_agency` | `agency_weekly_digest`, so the digest's figures are one agency's |

Numbers 10 to 16 are the batch that changes who receives and who can see. If
you want the smallest possible cutover, 1 to 9 stand on their own and 10 to 16
can follow after a rehearsal; nothing in 1 to 9 depends on them.

### 8.0 WHAT CHANGED IN THIS BATCH THAT YOU MUST VERIFY AFTER CUTOVER

Seven migrations in this batch change who receives things and who can see
things. Two are worth a deliberate check on the clone before you believe the
rest.

**20261006170000 is the riskiest migration on this branch.** It rescopes
`applications_select`, `applications_update` and `applications_insert` from the
partner to the AGENCY, because every agency shares the `opndoor-agents` house
partner. Get it wrong in one direction and an agency sees nothing; in the other
and they see each other. On the clone, sign in as one agency's Director and
confirm they see their own applications and only their own:

```sql
-- As that Director's session, through the app rather than psql.
-- Or in psql, impersonating: set the JWT claims and `set local role authenticated`.
select count(*), count(distinct agency_id) from public.applications;
```

One agency, and a count that matches what that agency has sent. If it returns
zero, the person has no `user_scopes` row: give them a position. An
unpositioned management user now reaches nothing, deliberately, because the
old fallback was "the whole partner".

**The three scheduled emails are now per reader.** `weekly-digest`,
`expiry-cohorts` and `expiry-reminders` resolved recipients as every management
user on the partner and built their content the same way, so on the house route
each agency received the others' figures, and the cohort CSV carried the
others' tenants. After the push, the first Monday digest should show one
agency's numbers to that agency. `partner_digest_sends` and
`expiry_cohort_sends` gained a `user_id`; rows with a null `user_id` are
pre-cutover partner-level sends and are expected.

**Expiry reminders start working for the first time.** `fire_expiry_reminders`
wrote to a column that has never existed and only ever inside its loop body, so
it was silent every day nothing was due and would have thrown `42703` the first
day something was. Expect reminder emails to begin, and
`public.expiry_reminders` to start filling.

### 8.05 HUBSPOT: THE TOKEN, AND SUCCESSES ON THE HEALTH PAGE

`hubspot-sync` answers `{"ok":false,"error":"No HubSpot access token
configured."}` when its secret is missing, and does so on every run: on dev
that is currently 68 failures out of 211 calls in 24 hours. It is a secret gap
rather than a code fault, and it is invisible unless somebody reads the
response body, which is why the Health page now does.

**After the push, in this order:**

1. Confirm the secret is set on production (`HUBSPOT_ACCESS_TOKEN`, or whatever
   the project names it in Edge Function secrets). The function reads it at
   call time, so setting it needs no redeploy.
2. Open `/health` as an Opndoor admin and find `hubspot-sync` under Recent
   responses. It groups by job now, so it will not be buried under
   `partner-webhooks`.
3. The latest response for that job must be a **2xx**. A 500 whose body names
   the token means step 1 did not take.
4. Then check the replay from `20261006130000` landed: section 14.2 has the
   before/after cursor queries and the expected notice.

**What "working" looks like:** `hubspot-sync` showing recent 2xx responses and
an error count of zero over the window, beside `partner-webhooks` doing the
same. Any other job showing errors is read the same way: the page states what
each failure means and what to do about it.

#### 8.05a HUBSPOT HAS NEVER RUN END TO END. NOT ONCE.

**Read this before trusting anything above.** Measured on dev, 2026-10-03:

| fact | value |
|---|---|
| `ops_secrets.hubspot_access_token` | **does not exist, and never has** |
| `hubspot_disabled` | `'true'`, set 28 Sep 16:41 |
| partners marked stuck (`stuck_error`) | none, all eleven |
| the cron | active, every 2 minutes, 1,440 successes in 2 days |

So **no record has ever been written to HubSpot from this codebase**. The
sync's happy path -- resolving a company, creating an applicant object,
associating the two, advancing a pipeline stage -- has been read and
reviewed and never executed. Everything in 8.05 above tells you how to
see that it is RUNNING; none of it tells you it WORKS, because nothing
here could.

That is not a reason to delay the cutover: HubSpot is a reporting
integration and no tenant, agent or payment depends on it. It is a
reason not to tick it off on the strength of a 2xx.

**Do this once, on live, before you hand back:**

1. **Confirm the token is set.**

   ```sql
   select name, (secret is not null and secret <> '') as is_set
     from public.ops_secrets
    where name = 'hubspot_access_token';
   ```

   Empty result or `is_set = false` means the sync will do nothing. It
   may instead be set as an edge-function env var, which the function
   also reads; the Edge Functions secrets page is the other place to
   look.

   - [ ] a token is set, in one of the two places

2. **Confirm the sync is NOT disabled.**

   ```sql
   select secret from public.ops_secrets where name = 'hubspot_disabled';
   ```

   **Production should have no such row.** If it returns `true`, the
   function returns early and syncs nothing, exactly as dev has been
   doing since 28 September. Dev carries the row deliberately; a clone
   taken from production will not, unless somebody adds it.

   - [ ] no `hubspot_disabled` row, or it is not `true`

3. **Sync one company and look at it in HubSpot.** This is the step that
   has never been done. Pick one real agency, let the cron run (it is
   every two minutes), then open HubSpot and find that company by name.

   - [ ] the company is in HubSpot
   - [ ] its properties are the ones the field map says, not blanks
   - [ ] a second run does not create a duplicate of it

4. **Then check the alerting is quiet rather than broken.** Since
   `20261007740000` the same failure alerts once and not once an hour.
   A silent `hubspot_sync_error:config` therefore no longer proves the
   token is fine -- it may mean it was reported yesterday and latched.

   ```sql
   select alert_type, detail, first_at, last_at
     from public.ops_alert_state
    where alert_type like 'hubspot%';
   ```

   An empty result is the good answer. A row means the sync is failing
   and has already said so once.

   - [ ] no row, or Matt has seen what it says

**Stop and tell Matt** if step 3 cannot be completed. A HubSpot integration
that has never moved a record is not a thing to declare working.

### 8.1 VERIFY THE BASE URL BEFORE YOU TRUST ANY CRON

Four of these jobs end their command with

```sql
... where public.ops_functions_base_url() is not null;
```

so if that function returns null the job **runs on schedule, succeeds, and does
nothing**. `cron.job_run_details` shows "succeeded" every time, because the job's
work is a `select` that matched no rows. There is no error anywhere to find.

**The four that go silent:**

| job | what stops |
|---|---|
| `commission-statements-0700` / `-0800` | the monthly statement emails |
| `hubspot-sync` | the whole CRM sync |
| `deed-sweep-hourly` | the safety net that generates a deed for a paid application that never got one |

The other jobs are unaffected because they carry the URL as a literal, which is
the thing `20260811210000` warns about: a literal survives every later
correction. That is why these four read it at run time instead, and why it has
to be right.

**THE HEALTH PAGE NOW LEADS WITH THIS**, so you can check it without a psql
prompt. `/health` reads the setting and, when it is missing, opens with a red
banner naming the jobs that are reporting success while making no call, and the
one thing to do about it. Each job row also says whether its command depends on
the base URL, read off the command text rather than a list, so a job that gains
or loses the guard describes itself correctly.

While you are on that page: it is machinery only now, for whoever runs the
deployment. The human work queue that used to sit on it ("Needs attention") is
on Home, where the person clearing it is. Every failing row carries one line of
what it means and one of what to do, naming the secret, the function or the
application, and a row with nothing to act on is no longer drawn in red.

Recent responses are grouped by job. Read the attribution with one caveat, which
the page states: pg_net throws away the request URL when the response lands, so
a response is matched to the job whose run window contains it. Two jobs firing
in the same second can be attributed to each other. It is right about which job
is failing and can be wrong about which of two simultaneous jobs a single row
belongs to.

**This is a VERIFY step, not a setting.** Production has an
`ops_secrets.functions_base_url` row already. The failure mode is that it is
empty or points somewhere else, which is exactly what dev was: empty, with four
crons quietly idle. Run this after the push, before you believe any cron result:

```sql
-- Must return the PRODUCTION functions URL, not null and not another project.
select public.ops_functions_base_url() as base_url;

-- And the row behind it, so you can see whether it is missing or just blank.
select name, secret is not null and secret <> '' as is_set
  from public.ops_secrets order by name;
```

Expected: `https://xogpsaoyprgmxdkmcype.supabase.co`, and `is_set` true for both
`functions_base_url` and `reminders_cron`.

If it is null or wrong, set it and re-check before moving on:

```sql
update public.ops_secrets
   set secret = 'https://xogpsaoyprgmxdkmcype.supabase.co'
 where name = 'functions_base_url';
```

Until that query returns the production URL, a green `cron.job_run_details` for
any of those four jobs means nothing.

**Why the statements cron is daily and not monthly:** the send day is the 1st, or
the next day that is not a UK bank holiday. That cannot be written as a cron
expression, and `0 7 1 * *` would silently skip any month whose 1st is a bank
holiday. The cheap daily wake-up that almost always answers "not the send day" is
the honest implementation.

---

## 8a. Settings that live nowhere but the dashboard

Matt asked for these listed, and the reason is the one thing they have in
common: **none of them is in a migration**, so `npm run drift` cannot see
them, they leave no trace in git, and a clone made from a database backup
does not necessarily carry them. Every one has to be set by hand on
production and checked by eye.

| setting | where | how you know it is wrong |
| --- | --- | --- |
| **`hubspot_sync_env.is_active`** | a boolean UPDATE, by hand | The HubSpot sync does nothing, silently. There is no migration that flips it and nothing reports that it is off. Found while writing `docs/HUBSPOT-CONSEQUENCES.md`; it is the single most invisible switch in the system. |
| **Edge function secrets** | Dashboard → Edge Functions → Secrets, or `supabase secrets set` | Section 7 lists every one. A missing secret usually shows as a function erroring, but two of them fail SILENTLY: see below. |
| **`ops_secrets.functions_base_url`** | a row in the database, not a settings table | Every cron becomes inert. Nothing errors, nothing is logged, the jobs simply post nowhere. Section 8.1. |
| **`ops_secrets.reminders_cron`** | a row in the database | The crons are refused by the functions they call, one alert per run. |
| **MFA enforcement** | Dashboard → Authentication | Not a portal setting at all. The product requires AAL2 throughout and 27 tables now carry a restrictive policy that denies at AAL1, so if enrolment is not enforced a user can reach a signed-in state that sees almost nothing and reads as broken. |
| **Auth redirect URLs and email templates** | Dashboard → Authentication → URL Configuration | Invitations and password resets land on the wrong host, or nowhere. |
| **Storage bucket names and their policies** | Dashboard → Storage | The deed PDFs. `deed-download` signs a path inside the application's own folder and refuses anything else, so a wrong bucket is a 404 rather than a leak. |
| **Stripe keys, live vs test** | Edge function secrets | `_shared/livemodeCredentials.ts` is the only file that chooses between them, and a sandbox application must never reach the live key. |
| **PandaDoc template and webhook** | PandaDoc, plus the webhook URL | Deeds stop generating, or generate against the wrong template. |

**The check that catches most of these at once** is the Health screen after
deploy: it names the failing job and what to do about it, rather than showing
a red dot. If Health is clean and `hubspot-sync` shows successes, the crons,
the base URL and the ops secret are all right.

---

## 9. Webhooks

Three inbound, all pointed at the project by hand in a third-party dashboard.
**These are the things most often forgotten on a new project**, and each fails
silently rather than loudly.

| provider | URL | events | secret |
|---|---|---|---|
| **Stripe** | `https://<ref>.supabase.co/functions/v1/stripe-webhook` | `checkout.session.completed`, `charge.refunded` | `STRIPE_WEBHOOK_SECRET`, per mode |
| **PandaDoc** | `https://<ref>.supabase.co/functions/v1/pandadoc-webhook` | `document_state_changed` (at least `document.completed`, `document.viewed`) | shared secret in the URL query, see the function |
| **Referencing provider** | `https://<ref>.supabase.co/functions/v1/referencing-callback` | provider's verdict callback | `REFERENCING_API_TOKEN` |

Stripe keeps **separate endpoint lists per mode**. A test-mode endpoint on the
clone and a live-mode endpoint on production are two different registrations with
two different signing secrets, and configuring one does not configure the other.

**After Regent's first live referral, check** that the Stripe endpoint shows a
2xx for it. A silently failing webhook looks exactly like a tenant who has not
paid.

---

## 10. PandaDoc template

The template is not in the repo; it lives in the PandaDoc workspace and is
referenced by `PANDADOC_TEMPLATE_ID`. Full build instructions are in
`supabase/DEEDS-TESTING.md` section 3.

### THE TEMPLATE DOES NOT CHANGE FOR THIS RELEASE. No action for Balal.

Ruling, 27 September. Each tenant signs their **own** deed, for their own share,
**naming all the tenants**. The share is recorded on the application and on the
bordereau, **not in the document**. So a joint tenant's deed renders exactly as a
single tenant's does, from the same six merge tokens:

| token | value |
|---|---|
| `reference_number` | The guarantee reference, one per deed |
| `tenant_name` | Every tenant on the tenancy, comma separated. On a tenancy of one, that one person |
| `tenancy_start_date` | dd/mm/yyyy |
| `rental_address` | Title-cased, postcode raw |
| `agent_email` | Where the executed deed is delivered |
| `issue_date` | Generation date, Europe/London, server-side, never recipient-editable |

An earlier draft of this branch sent two extra tokens on joint tenancies,
`guaranteed_amount` and `co_tenant_names`, and this section used to ask for a
template change to render them. **Both have been removed from the code.** They
needed the template change to render at all, and an unsupplied PandaDoc token
renders empty without removing the sentence around it, so shipping them against
today's template would have printed a deed reading "in respect of  per calendar
month": an amount the deed appears to state and does not. On a financial
instrument that is worse than not stating it.

The only thing a joint deed says differently is `tenant_name`, which lists every
tenant so the document says which tenancy it belongs to. That needs no template
work, because the token already exists and already prints there.

**Still one signer role.** Opndoor's signature is a static facsimile image, not a
second recipient. One consequence to flag to Matt: PandaDoc's `document.completed`
signs and executes in one step, so **"signed" and "executed" are the same event**
and no screen can show them apart. If Opndoor is to countersign each deed for
real, the template needs a second signer role and the webhook needs to key on
recipient-level completion.

### 10.1 The deed-chain alerts, and what each one means

These arrive by email through `ops-alert` and are also rows in `public.ops_alerts`,
deduped to one per type per hour. Read them here:

```sql
select hour_bucket, alert_type, detail from public.ops_alerts
 order by hour_bucket desc limit 50;
```

**Raise them only through `public.report_ops_incident(type, detail)`.** Never
insert into `ops_alerts` directly: `hour_bucket` is `not null` with no default, so
a direct insert fails, and the call sites wrote `.then(() => {}, () => {})` around
it, which swallowed the error. Three alerts had therefore never been raised once
in their lives (`stripe_livemode_mismatch`, `pandadoc_livemode_mismatch`,
`hubspot_map_drift`), which is fixed on this branch. Verified by running the
insert as it stood against dev: zero rows written.

| alert | what happened | what to do |
|---|---|---|
| `deed_generation_failed` | Generation failed for one application. The row keeps the reason and retries; three consecutive failures park it as needs-attention | Usually per-application. If many arrive at once, suspect `PANDADOC_API_KEY` or `PANDADOC_TEMPLATE_ID` |
| `deed_no_delivery_contact` | Paid, but nothing resolves as a delivery contact, so no deed was generated | Add the branch contact, or activate a person at the agency, then press Generate on the application |
| `deed_pdf_unavailable` | The tenant signed, but the executed PDF could not be downloaded from PandaDoc. The deed is **not** executed and PandaDoc will redeliver | Expect this to clear itself within minutes: PandaDoc renders the PDF after it fires the callback. If it repeats for over an hour, the PDF is not being rendered and the deed needs executing by hand |
| `deed_pdf_not_stored` | The PDF downloaded but Storage refused it. Not executed; PandaDoc will redeliver | Check the `deeds` bucket exists and the service key can write it |
| `deed_orphan_document` | A document was created at PandaDoc but the send failed, and we could not void it | Void the named document id in PandaDoc. The application generates a fresh deed on retry |
| `deed_stamp_partial` | The document id was recorded but the surrounding deed columns were not. Signing works; the status may read stale | Correct the row at leisure. Nothing is lost |
| `deed_document_unattached` | The worst one. A deed was sent but the row could not be stamped even with the id alone, so nothing can match the signature. The document is voided automatically where possible | If the alert says the void also failed, void the named id in PandaDoc by hand |
| `deed_awaiting_staff_send` | The deed is executed but there is nobody to deliver it to | Nominate a recipient or activate a manager, then use Send deed to agent |
| `deed_delivery_target_unreadable` | The deed is executed but resolving where to send it failed, so it is queued | Use Send deed to agent once the database is answering |
| `deed_executed_after_refund` | A completion arrived for a refunded application. The deed was refused and not issued | Void the named document in PandaDoc |
| `pandadoc_completed_unknown_document` | A completion matched no application | Either a superseded document (benign) or this project's shared key is verifying **another environment's** callbacks, which means that environment's deeds are not being executed. Check which |
| `pandadoc_livemode_mismatch` | A callback's mode does not match the application it names | A sandbox event replayed against a live application, or one shared key configured for both modes. Neither is fixed by choosing one |

---

## 10.2 HubSpot: the fault, and the fix that is already on this branch

> **Correcting an earlier draft of this section.** It told you to check
> `hubspot_partner_map` for unmapped partners and insert portal ids by hand. That
> described the state before `20261005250000`, which is ON this branch, and it
> named a column (`portal_id`) the table does not have. Verified on dev while
> walking onboarding: every partner is mapped, including one created through the
> Suppliers page minutes earlier. There is no by-hand step here.

The sync needs two facts per partner and they used to be created by different
things, which was the whole of the problem.

| table | what it is | created by |
|---|---|---|
| `hubspot_sync_cursor_partner` | how far the sync has got | a trigger, since 20260812030000 |
| `hubspot_partner_map` | the partner's CRM mapping | a trigger, **since 20261005250000** |

**THE FAULT, as it was.** Seven partners held cursors and `hubspot_partner_map`
was empty: the August migration seeded the cursor and nothing seeded the map. So
the sync ran every two minutes, found a cursor, looked for a mapping, found none
and wrote nothing, while `cron.job_run_details` reported "succeeded" throughout,
because the cron's job is to POST and the POST returned 200.

**THE FIX, on this branch.** `20261005250000` backfills every existing partner
and adds an AFTER INSERT trigger mirroring the cursor trigger, so the two facts
are created together and cannot drift apart again. AFTER INSERT rather than
BEFORE, so a failure wiring the CRM cannot abort the creation of the partner
itself.

**What to check on the clone**, after the migrations, using the columns that
exist:

```sql
select p.slug, m.partner_id is not null as mapped, m.active
  from public.partners p
  left join public.hubspot_partner_map m on m.partner_id = p.id
 order by mapped, p.slug;
```

Every row should say mapped. If any does not, the backfill in `20261005250000`
did not run and you are missing that migration, which is a different problem
from the one this section used to describe.

**THE SILENT FAILURE THAT REMAINS IS HUBSPOT'S OWN.** It ACCEPTS a write to a
property that does not exist and discards it, returning 200. So a mapped,
running, apparently healthy sync can be writing nothing. `hubspot-sync` checks
the property list and raises `hubspot_map_drift` when a mapped property is
missing, which is the canary for exactly that. **That alert had never fired in
its life**, because it was raised by a direct insert into `ops_alerts` and
`hour_bucket` is `not null` with no default, so the insert failed every time and
the error was swallowed. Fixed on this branch; see 10.1.

**`hubspot_sync_events` being empty on dev is normal** and always has been: dev
has no HubSpot token, so there is nothing to record. The first proven sync
anywhere will be the one on your clone, which is why 14.2 walks it.

---

## 11. The walks

### 11.1 On the clone

`scratchpad/walk/SUNDAY-WALK.md`, 1,396 lines, two complete journeys step by
step with the exact figures to expect at each screen.

Read its **"READ THIS BEFORE YOU BOOK THE TIME"** section first. It lists five
blockers found while writing it.

**Three of those five have since been fixed, and the walk script has not been
updated.** Do not spend time on them:

| blocker | status now |
|---|---|
| **A**, the working tree does not compile | **Fixed.** `npm run typecheck` and `npm run build` are clean, and 567 tests pass. |
| **C**, the commission rate for Regent | **Fixed.** Their deal is a pricing agreement, created by the keying script in section 4, and verified by its own rows 5 to 8. |
| **D**, the tenant is shown one number and charged another | **Fixed.** The payment page built its displayed fee from `monthly_rent` while charging `fee_amount`: a tenant was shown £2,400 under the words "One month's rent" and charged £1,661.54. Both now read the fee, on all four surfaces. |

The two that still stand, and you will hit both:

- **Blocker B, Stripe will refuse on any new project ref.** A new project needs
  its own Stripe test webhook registered before any payment step works.
- **Blocker E, MFA.** Nobody walks anything without an authenticator app. Set it
  up before you sit down, not during.

Then:

- **Walk 1, Rightmove, exactly as today.** This is the regression test that
  matters: a supplier referral must behave on the clone exactly as it behaves on
  production now. If anything differs, stop.
- **Walk 2, Regent.** The new shape: pre-referenced, straight to payment, the
  three-week fee, the 20% agreement, joint tenancies.

`EMAIL_REVIEW_ADDRESS` must be set on the clone for both.

#### Rightmove's rail, which decides which email their tenants get

Matt, 2026-10-04. Two checks, and they are one question asked at both ends.

**1. `refers_own_stock` must be FALSE for Rightmove on live.**

```sql
select slug, name, partner_kind, refers_own_stock
  from public.partners where partner_kind = 'supplier';
```

It is `false` for every supplier except one on dev, and Kestrel's `true` was
set to `false` on 2026-10-04 to match how Rightmove is configured. The column
means ownership only: true for a party referring stock it manages itself,
false for one referring on behalf of agencies it does not own, which is what
a supplier is.

**2. A Rightmove referral's tenant email must be the SUPPLIER wording.**

This is what the flag decides, which is why it is worth checking rather than
assuming. `create-referral` picks the rail from it, and the rail picks the
opening sentence:

| `refers_own_stock` | rail | the tenant reads |
|---|---|---|
| false | `supplier` | "opndoor is acting as guarantor for your tenancy at ADDRESS. The last step is the guarantee fee." |
| true | `agency` | "AGENCY has arranged an opndoor guarantee for your tenancy at ADDRESS. To put it in place, ..." |

The first is the approved supplier wording. The second names the agency and
is for a pre-referenced AGENCY referral, where the agency made the decision
and opndoor took no view.

**So a `true` on live would put Rightmove's tenants on the agency email**,
which names a company and asserts that company arranged the guarantee. Send
one sandbox referral through Rightmove and read the opening line of the
tenant's email; it must be the first row of that table.

#### Rightmove's agencies must inherit Rightmove's checking setting

Matt, 2026-10-04, after a Kestrel referral sent its tenant opndoor's full
application email under an arrangement where opndoor checks nothing.

`agencies.referencing_mode` was NOT NULL DEFAULT 'opndoor_referenced', so
every agency always had its own opinion and `resolve_referencing_mode`'s
inheritance arm was unreachable. 20261008050000 drops the default, allows
null, and sets every agency in a supplier estate to inherit EXCEPT any whose
audit trail records a deliberate change.

**After migrating the clone, both of these:**

```sql
-- 1. Every Rightmove agency inherits. Expect no rows.
select a.name, a.referencing_mode
  from public.agencies a join public.partners p on p.id = a.partner_id
 where p.partner_kind = 'supplier' and a.referencing_mode is not null;
```

Any row that DOES come back is an agency whose setting somebody changed on
purpose; the migration spared it and said so in a NOTICE as it applied. Read
that notice in the apply output and check each one is intended rather than
assuming the empty result.

**2. Send a test Rightmove referral and watch where the tenant lands.** It
must go STRAIGHT TO PAYMENT, with no application form and no request for
address history, income or documents. That is the behaviour the SQL above
only predicts.

### 11.2 On production, after the cutover

A short confidence walk, not the full 1,396 lines. In order:

1. **Sign in as yourself.** The portal loads, the dashboard has its usual
   numbers. Compare the headline figures to a screenshot taken before the push.
2. **Open three existing applications** at different statuses: one Sent, one
   Paid, one Deed Issued. Each renders, the money is unchanged, the timeline runs
   forwards.
3. **Download one export** and compare it to one taken before the push. Fee
   columns now carry pence and the fee, not the rent; everything else matches.
4. **Run the Regent keying script** (section 4) and read its ten rows.
5. **Invite Rosa** from the portal, and have her accept. Check verification row
   10 turns true.
6. **As Rosa, send one real Regent referral** for a real tenancy. Watch:
   - the fee preview appears once she enters the rent, showing 3 weeks
   - the tenant gets a payment link with no eligibility form
   - Stripe shows a 2xx on the webhook
   - the deed generates and delivers to Rosa
7. **Check the Applications list as Rosa.** No Route column, no Agency column, no
   Branch column, and the Delivery failed filter is empty.

Stop at any step that does not match and tell Matt before continuing.

---

## 12. What is not done, and what to watch after you go live

This section is yours, not a status report: everything in it is either
something you will have to do or something that will look like a fault and
is not.

**Not done:**

- **UK bank holidays are a static table** in the function, covering 2026 to 2030.
  It must be extended before it runs out. There is a guard that treats an unknown
  year as all-working-days rather than failing silently, but that is a fallback,
  not a plan.
- **Bounces are not detected.** "Delivery failed" currently means the email
  provider refused the send. There is no bounce webhook anywhere in the tree. The
  columns are shaped to receive one.

**Watch:**

- **An `opndoor_manager` sees a blank Reporting page.** Found 2026-09-30 and
  deliberately not fixed: `paymentMetrics.scopeFull` has a positive allowlist
  naming only `referrer`, `superadmin` and `management`, so that role is
  handed an empty set and every live figure comes out zero. The role was
  added later and the list was never widened. It is not a leak -- it shows
  too little, not too much -- and it is not in the queue, so it is here
  rather than fixed. An opndoor_manager who says "Reporting is empty" is
  seeing this, not a data problem.
- **`partner_weekly_climbers`** still ranks referrers by summed `monthly_rent`
  and feeds the "Climber of the week" line of the digest. Same defect as the two
  aggregates fixed in bite 4, not fixed.
- **`public/help-docs/*.html`** still tell agents the guarantee fee is one
  month's rent. True for standard terms, false for Regent.
- **The demo agency "Hartwell Estates"** appears in mock data and so in demo-mode
  exports. Cosmetic, but it is a name on a screen.

---

## 12a. After launch: what is recorded and not built, 2026-10-05

Everything below is in `docs/QUEUE.md` verbatim under the letter given.
None of it blocks Wednesday; all of it was reported by Matt after the
go-live branch was cut, and it is here so nothing is carried only in
somebody's head.

### Scale, and the one question nobody has asked

**(dg) The sign-in load.** The pickers now search on the server
(`search_agencies_for_referral`), so the referral form no longer
depends on the whole book. But `src/lib/hydrate.ts:171` and `:175`
still select EVERY agency and EVERY branch the caller's RLS allows,
with no limit, at sign-in. It has NOT been capped, deliberately: that
array also feeds Reporting, the League, the exports and the league
grouping, so a blanket `.limit()` would not make those slow, it would
make them WRONG, silently. Wrong money is worse than a slow form.

**THE QUESTION TO ASK BEFORE DOING ANYTHING: how many agencies will
Rightmove have on day one?** At a few hundred none of this bites. The
three options are written out in QUEUE.md under (dg).

`orgService.ts` also persists that whole array to localStorage on every
write, and `saveJSON` swallows a quota failure; at thousands of
agencies that is a silent failure on every on-the-fly create.

### Help and the documents

Most of Matt's review list is DONE and is listed here only so nobody
re-does it: (dr1) the Referrer guide now describes all three routes
and its status table admits Awaiting decision exists; (dr2) who sees
commission is pinned for all eight readers; (dr3) the carved-share
lines are explained in the portal's own words; (dr4) only suppliers
are told they can add an agency while referring; (dr5) the referral
checklist is a checklist; (dr6) and (dr9) were defects in the
exporter, not the product; (dr7) one answer per question; (dt)/(du)
the GBP 20 copy and the refund lines.

**STILL OPEN, and these are the ones to pick up:**

**(ds) DONE.** Both the Agent one-pager and the Sales and
conversation guide are now HTML in the management-guide template, so
every item in Help opens the same way and nothing drops into the
browser's PDF viewer. Both were read from RENDERED PAGES, not
extracted text, and every figure was cross-checked against the render
and against the landlord guide.

**If you ever need to read a shipped PDF, do it the same way.** Both
used subset fonts, so extraction returns `(a)(a)(a)` or, worse,
most of the words with the DIGITS CORRUPTED -- it rendered the
GBP 120,000 cap as "GBP 12f,fff". Never transcribe a figure from an
extraction. Render and read:

    osascript -l JavaScript scripts/render-pdf-pages.js \
      public/help-docs/<file>.pdf /tmp/pages tag

The two source PDFs are still in `public/help-docs/` and are no longer
referenced by the shelf. Delete them once Matt has reviewed the HTML.

**(dj) The API docs do not vary by checking setting.** A supplier
Developer gets the same text whichever journey their organisation is
on. The three exported files are identical by construction and each
says so at the top. The content and the "If your checking setting
changes" section are unwritten.

**(dr1) remainder.** The guide and the status FAQs now cover all three
routes. The TENANT LEAFLET has two versions (straight-to-payment and
opndoor-checks) and the middle route -- "applies its own criteria" --
shares the first, which is right about the fee and silent about the
decision step. Worth a third version or a sentence.

**(ds) The two PDFs.** The Sales and conversation guide and the Agent
one-pager open in the browser's PDF viewer while every other item
opens as HTML in the modal. They are to be rebuilt as HTML in the
management-guide template. FIRST OBSTACLE, measured: both PDFs use
subset fonts, so their text is glyph codes needing per-font ToUnicode
resolution. A naive extraction returns `(a)(a)(a)`; a merged-CMap one
recovers most words but CORRUPTS DIGITS -- it renders the cap as
"GBP 12f,fff". Do not transcribe those figures from an extraction.

**(dr8) The landlord guide's figures are unverified.** It claims 12
months, a GBP 120,000 cap, GBP 10,000 of legal costs, notify within
two weeks of the second month of arrears, and payments beginning one
month after eviction proceedings start. **The deed's own text is not in
this repo** -- it is a PandaDoc template reached by
`PANDADOC_TEMPLATE_ID` -- so none of it could be checked against the
instrument. The claims ARE internally consistent: the same figures
appear in the landlord guide and the agent one-pager and nowhere else.
Somebody with the template must check all five.

### Smaller, all recorded with evidence in QUEUE.md

- **(ca)** The Branches board's missing agency line. Matt has ruled:
  keep the collapse, do not print the name twice. Closed.
- **(cj)/(kk)** part 3, **(cq)/(cy)** the referrer byline and historic
  activity actors, **(cp)** the draft-month reference error,
  **(ck)** the duplicate check, **(ci)** server-side refusal of a
  referencing mode on a supplier-estate agency, **(cl)** the opndoor
  manager on a supplier page, **(cm)** the back link, **(cs)** the
  audit of supplier edits, **(cu)** sign-in landing, **(cv)** the
  Expiries default month, **(cw)** the sandbox proof, **(cx)** the
  switchable deed notification, **(db)** the go-live checklist,
  **(df)** supplier pickers, **(bq)(br)(bs)** the export fixes,
  **(bx)** GR-26263's stale signed deed, **(by)** the refunded page,
  **(cg)** "Fees collected", **(nn)(oo)(pp)(zz)**.

### One thing that is NOT in the queue and should be watched

`orgLines` in `src/data/commissionSplit.ts` falls back to matching a
payee by NAME where a frozen commission line has no `org_id`. Every
line on dev today carries one, so it fires on nothing -- but if any
ever lands without an id, a renamed agency silently reports GBP 0
commission. Measured 2026-10-05: 27 lines, 0 without an id.

## 13. If something goes wrong

1. **Do not restore production to fix a cosmetic fault.** The cost is every row
   written since the backup.
2. **Do restore, fast, if the app is down.** Minutes matter; the cost grows with
   every one.
3. **The clone is free.** Any question of the form "what happens if" has an
   answer you can get in ten minutes by restoring another one, and none of those
   answers is worth guessing at on production.

---

## 14. Post-cutover smoke test, before you hand back

Run this **after** the migrations, the deploys and the secrets are all in, and
**before** you tell anyone it is live. Four things, in this order, because each
one depends on the one above it. Write the answers in the boxes: if you hand back
with a box empty, nobody knows whether it works.

The whole point of this list is that **every one of these faults is silent**. A
deed that never generates, a sync that never runs and a pay link that dies
tomorrow all look exactly like a quiet Tuesday.

### 14.1 One Regent referral, all the way to a deed

| step | what you do | what proves it | box |
|---|---|---|---|
| 1 | Sign in as a Regent user and send a referral to an address you control | the referral appears at status **Sent** | ____ |
| 2 | Open the email | the fee is the **agreed fee**, not the rent, and the sentence under it names the basis ("3 weeks of rent") | ____ |
| 3 | Check the link | it is `https://<app>/pay?token=...`. **If it contains `checkout.stripe.com`, stop**: the deploy is stale and every link will die in 24 hours | ____ |
| 4 | Open the link and pay with a real card | Stripe takes the payment | ____ |
| 5 | Watch the application | it reaches **Paid**, then a deed is generated | ____ |
| 6 | Sign the deed from the tenant's email | it reaches **Deed issued** | ____ |
| 7 | Check the agent got it | the executed deed lands with the agency contact | ____ |

**If it stops at Paid with no deed**, that is the deed fault. Go to 14.4 and copy
the `stripe-webhook` and `pandadoc-webhook` logs.

### 14.2 One HubSpot sync

The sync is **per partner and cursor-based**: each partner has a row in
`hubspot_sync_cursor_partner` recording how far it has got, and a partner that
fails is marked stuck rather than retried for ever.

```sql
-- 1. IS ANY PARTNER STUCK? This is the whole diagnosis in one query.
--    stuck_error is the message that stopped it. On a healthy system every
--    stuck_since is null, which is what dev shows today.
select partner_id, last_at, stuck_since, left(stuck_error, 200) as stuck_error
  from public.hubspot_sync_cursor_partner
 order by stuck_since nulls last, updated_at desc;
```

**This will be the first proven sync anywhere.** `hubspot_sync_events` is empty on
dev and always has been, because dev has no HubSpot token: the sync has nothing
to authenticate with and has therefore never applied an event. So there is no
"it worked on dev" to compare against, and your run on the clone is the first
real evidence the chain works end to end. Treat an empty table before your run as
expected, and a row after it as the thing you were sent to establish.

Wait two minutes (the cron runs `*/2 * * * *`) or invoke `hubspot-sync` by
hand with the ops secret, and:

```sql
-- 2. A row per event applied, newest first. THIS IS THE PROOF.
select id, target, application_id, applied_at
  from public.hubspot_sync_events
 order by applied_at desc limit 5;
```

**Do not try `select count(*) from public.hubspot_pending_events()`.** It takes
five arguments (`p_partner, p_last_at, p_last_id, p_kinds, p_limit`) and is
driven by the cursor, so it is not a queue you can peek at without supplying a
partner and its position. Read `hubspot_sync_cursor_partner` instead.

**The failure modes, in the order they are worth checking:**

| what you see | what it means |
|---|---|
| `stuck_since` set on one partner, others fine | that partner hit an error and was parked. `stuck_error` names it. The others keep syncing, which is the design |
| no rows in `hubspot_sync_events` and nothing stuck | the function is not being reached. Almost always a 401: see 14.4 |
| a 403 in the function logs | the token. `HUBSPOT_ACCESS_TOKEN` is absent, expired, or lacks a scope |
| the same error every two minutes for ever | one poisoned event. Check `stuck_error` and the newest applied event to see where it halted |

#### The production alert you will be replaying

Production has been raising this **daily since at least 25 September**:

```
hubspot-sync referral_created GR-20675: no partner map for partner_id
1f305284-a6d8-4eb0-9b06-b5fe50648b7b
```

Two migrations deal with it and they do different halves, which is why both are
needed:

| migration | what it does |
|---|---|
| `20261005250000` | backfills `hubspot_partner_map` and adds the trigger, so every partner has a mapping and every NEW event associates correctly |
| `20261006130000` | winds that partner's cursor back, so the events already drained **without** an association are read again |

**Why the backfill alone is not enough.** A missing map row goes through
`configGap()` in hubspot-sync, which warns and raises an incident and does NOT
throw. So the event is not an error: the applicant properties are written, the
event completes, and the cursor moves past it, while the association step
deliberately leaves its ledger key unwritten because it did not happen. The
application ends up with an applicant in HubSpot attached to no partner company,
and a cursor that has already gone past the only events that would retry it.
`ensureAssoc` runs once per EVENT, so an application whose events are all drained
is never revisited.

**Why the replay is safe.** Every step that already succeeded wrote its ledger
key to `hubspot_sync_events`, so the replay reads "applied" and skips it. The one
step with no key is the one that failed. A replay therefore does exactly the
missing work and nothing else.

**What to expect on the clone.** `20261006130000` prints a notice naming how many
partners it rewound. On a database with nothing missing it rewinds none, which is
what it does on dev for seven of the eight partners; dev's eighth is
`opndoor-agents`, rewound from 17 September to 14 September. On production expect
at least `1f305284-...` to move.

```sql
-- BEFORE the migrations, note this partner's position:
select partner_id, last_at from public.hubspot_sync_cursor_partner
 where partner_id = '1f305284-a6d8-4eb0-9b06-b5fe50648b7b';

-- AFTER the migrations, last_at should be EARLIER than it was.
-- Then let the cron run and check the association keys appear:
select id, target, application_id, applied_at
  from public.hubspot_sync_events
 where id like 'assoc:%:partner'
 order by applied_at desc limit 10;
```

**The outcome you are looking for:** rows appearing with ids of the form
`assoc:<application>:partner`, and the daily "no partner map" alert stopping. If
the alert persists after a full cron cycle, the map row for that partner is still
missing, which means `20261005250000` did not run: check it is applied before
looking anywhere else.

### 14.3 A pay link opened the next day

Send a referral, then **open its pay link tomorrow**. It must still work.

This is the one fault you cannot test in the same sitting, and it is the one that
has recurred. The token lives 90 days and is refreshed on every reminder and
resend (asserted in `supabase/tests/pay_link_outlives_a_day.test.sql`). What dies
in 24 hours is a Stripe Checkout session, which is what the old deployment
emailed. So if step 3 above showed a `/pay?token=` link, this will pass; check it
anyway, because it is the only way to be sure the deployed code is the code in
this repo.

### 14.4 Reading `cron_health` and the function logs

`cron_health()` is an admin RPC, not a table. Run it signed in as an opndoor
admin at AAL2 (it refuses otherwise), from the SQL editor or the Health screen:

```sql
select jsonb_pretty(public.cron_health());
```

**Read it in this order, and mind the trap it was written for:**

1. **`counts`** is the summary. On a healthy production morning:
   `{"anomalies":0,"http_errors":0,"deed_failures":0,"email_failures":0,"webhook_failures":0}`.
   Any non-zero is where to look first.
2. **`recent_http`** is the authoritative signal. Each entry has a real
   `status_code` and the response `content`, e.g.
   `{"status_code":200,"content":"{\"ok\":true,\"claimed\":0,...}"}`.
3. **`jobs[].last_status` is NOT the authoritative signal, and this is the trap.**
   The crons run `select net.http_post(...)`, so `cron.job_run_details` reports
   `succeeded` the moment the request is **queued**. A cron whose function
   answers **401** shows `last_status: "succeeded"` for ever. That is the
   silent-401 class, incident #1, and it is exactly how "the HubSpot sync is
   broken" looks from the database: a green cron and no data.
   Trust `recent_http.status_code`, and if `http_status_code` on a job is `null`
   it means the correlation could not be made, **not** that it succeeded.

A 401 from a cron means the function's `verify_jwt` gate is on when it should be
off. Check section 6a: the reconciliation must print `mismatches: 0`.

**Function logs**: Dashboard → Edge Functions → the function → Logs, or
`npx supabase functions logs <name> --project-ref <REF>`.

### 14.4a The Dev Centre on live: the sandbox banner must be gone

Matt, 2026-10-03: *"on live, confirm the Dev Centre banner 'This project
reaches nothing real. No card is charged…' does not appear (it's dev-only), and
that live keys are clearly marked as creating real applications."*

**Why this is in the smoke test and not just a nice-to-have.** That sentence is
true of dev and is a lie on production. A supplier's developer reading it on
the live Dev Centre would conclude that nothing they do can charge a card or
email a tenant, and the first thing they would do is test with a live key
against a real address. The banner is the one piece of copy on the site whose
being wrong actively invites the mistake it describes.

**It is gated on the project, not on the key.** `DevCentre.tsx` draws the note
only when `env.id !== 'production'`, and `env` is resolved from the Supabase
project the app is pointed at. So on live it should be absent by construction;
this step is confirming the gate works where it matters, because a gate nobody
has watched fire is a gate nobody knows about.

| step | what you do | what proves it | box |
|---|---|---|---|
| 1 | Sign in to **live** as an opndoor admin and open the Dev Centre | the page loads | ____ |
| 2 | Read the banner at the top | it says a key's prefix decides the mode: `opnd_test_` creates sandbox applications, `opnd_live_` creates real ones | ____ |
| 3 | Look for the second paragraph | **"This project reaches nothing real"** is **NOT** there. If it is, the app is pointed at a non-production project, or the env resolver is wrong: **stop and tell us** | ____ |
| 4 | Look at the environment chip beside it | it reads **Production**, not Sandbox or Development | ____ |
| 5 | Mint a key and read its row | a live key is labelled as creating **real** applications, and the prefix on it is `opnd_live_` | ____ |

**If step 3 fails, nothing else in this section matters.** A live Dev Centre
that claims to reach nothing real is worse than one with no banner at all.

### 14.5 If something still fails, copy these to us

We cannot see production. For each fault, copy **the whole log line including the
timestamp**, not a summary, and redact nothing structural (we redact tokens
ourselves; `payment_url` and anything matching `token`, `secret` or `key` is
already redacted by `_shared/redact.ts` before it is logged).

| fault | copy from | what we need to see |
|---|---|---|
| **Deed not generating** | `stripe-webhook` logs around the payment | whether `checkout.session.completed` arrived at all, and its HTTP response. If it is absent, the Stripe endpoint is not registered for this mode |
| | `pandadoc-webhook` logs | any `Invalid signature`, and whether `document.completed` arrived |
| | the Stripe dashboard, that endpoint's delivery list | the response code Stripe recorded. Stripe retries a 5xx and gives up on a 4xx |
| | the PandaDoc dashboard, the document | whether it was created at all, and which recipient email it went to |
| | SQL | `select guarantee_ref, status, deed_state, pandadoc_document_id, paid_at from public.applications where guarantee_ref = '...'` |
| **HubSpot sync** | `hubspot-sync` logs, the most recent 20 lines | the status code and body. A 401 is the gate; a 403 from HubSpot is the token; a repeated identical error every two minutes is one poisoned event blocking the queue |
| | SQL | the `hubspot_sync_cursor_partner` row for that partner, especially `stuck_since` and `stuck_error`, and the newest 5 rows of `hubspot_sync_events` |
| | `cron_health()` | the `hubspot-sync` entry, and `recent_http` around its schedule |
| **Pay link dead** | the email itself | the full href. `checkout.stripe.com` means a stale deploy; `/pay?token=` means look further |
| | `payment-page` logs for that token | `410` is genuinely expired, `404` is an unknown token, `400` is a malformed one |
| | SQL | `select guarantee_ref, expires_at, first_viewed_at from public.payment_page_tokens where guarantee_ref = '...'` |

For any of them, `select jsonb_pretty(public.cron_health())` and the output of
the section 6a reconciliation are worth sending unprompted. Between them they
answer "is it deployed, is it gated, and did it run" without another round trip.
