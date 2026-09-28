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

`partner-api` is 178 migrations and 13 edge functions ahead of `origin/main`.

```
migrations on this branch      243
migrations on origin/main       65
new                            178

edge function directories       33   (plus _shared)
on origin/main                  21
new                             12
```

Production is running `origin/main`, whose schema has not changed since 5 July.
The branch is not a feature on top of it; it is most of a year of work, and the
single biggest risk in this handover is treating it as a normal deploy.

So it goes over in **six bites** (section 5), each of which leaves production
working. It is not all-or-nothing and you should not attempt it as one.

**What has to be true by Monday 28 September** is only bite 1 plus Regent's
keying. The other five can follow that week.

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
> were 166; there are now 178. The scripts themselves are generic and do not
> count, so the number in the comment is stale and harmless.

### 1.5 Then walk it

Deploy functions and secrets to the clone (sections 6 and 7 with `$CLONE`), then
run the clone walk in section 11. That is the rehearsal proper: the migrations
applying cleanly is necessary and not sufficient.

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

### 3.5 Rollback

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
the earlier ones created. There is no subset of the 178 that is both coherent and
smaller. The schema goes over in **one push**.

What IS bitten is the ROLLOUT: what you deploy, switch on and point at the
database afterwards. The schema being present changes nothing a user can see
until its function is deployed, its cron is scheduled or its screen is shipped.
That is the property that makes this safe, and it is worth understanding before
you start: **after the push, production behaves exactly as it did before.**

| # | bite | what you do | user-visible effect | Monday? |
|---|---|---|---|---|
| **1** | **Schema** | `db push`. All 178. | **None.** New tables, columns and functions nothing yet calls. | **YES** |
| **2** | **The app** | Deploy the built front end. | Everything the UI does: the estate screens, Team, the new Applications and Reporting, agreements. **This is the big one to watch.** | **YES** |
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

## 12. Things I could not finish, and things to watch

**Not done:**

- **The `commission-statements` function has not been deployed to any project.**
  The code, the migration, the cron and the recipients flag are all in place and
  proved on dev; the function itself needs `npx supabase functions deploy
  commission-statements`. Nothing depends on it before 1 November.
- **UK bank holidays are a static table** in the function, covering 2026 to 2030.
  It must be extended before it runs out. There is a guard that treats an unknown
  year as all-working-days rather than failing silently, but that is a fallback,
  not a plan.
- **Bounces are not detected.** "Delivery failed" currently means the email
  provider refused the send. There is no bounce webhook anywhere in the tree. The
  columns are shaped to receive one.

**Watch:**

- **`partner_weekly_climbers`** still ranks referrers by summed `monthly_rent`
  and feeds the "Climber of the week" line of the digest. Same defect as the two
  aggregates fixed in bite 4, not fixed.
- **`public/help-docs/*.html`** still tell agents the guarantee fee is one
  month's rent. True for standard terms, false for Regent.
- **The demo agency "Hartwell Estates"** appears in mock data and so in demo-mode
  exports. Cosmetic, but it is a name on a screen.

---

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
