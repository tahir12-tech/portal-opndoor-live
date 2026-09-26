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

## 6. `supabase/config.toml`

The file in the repo is the source of truth and is already correct. The entries
that matter are the JWT gates: a function invoked by a cron or by a third-party
webhook cannot present a user JWT, so it must be listed with `verify_jwt = false`
and authenticate itself another way.

All seventeen entries in the file are `verify_jwt = false`, grouped by what
authenticates them instead:

| authenticated by | functions |
|---|---|
| a provider's request signature | `stripe-webhook`, `pandadoc-webhook` |
| `x-reminders-secret`, from `ops_secrets` | `payment-reminders`, `expiry-reminders`, `expiry-cohorts`, `renewal-notices`, `weekly-digest`, `hubspot-sync`, `ops-alert`, **`commission-statements`** (new) |
| a tokenised link the recipient was sent | `payment-page`, `payment-confirmation`, `send-password-reset`, `tenancy-correction` |
| the tenant's own session, issued by the function | `tenant-auth` |
| the referencing provider's token | `referencing-inbound`, `referencing-callback` |

`partner-api` is **not** in the list and keeps the default JWT gate: it
authenticates with a partner API key it validates itself, after the platform has
already required a JWT.

If you deploy `commission-statements` without its entry, the cron gets a 401 and
the statements silently never send. There is no alert for that, which is worth
fixing later.

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

Fifteen jobs after this branch, thirteen of which already exist on production.

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
| `hubspot-sync` | `*/2 * * * *` | |
| `partner-webhooks` | `* * * * *` | |
| `rate-limit-cleanup` | `7 * * * *` | |

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
`supabase/DEEDS-TESTING.md` section 3. What is **new on this branch**:

**Two merge tokens, added for joint tenancies:**

| token | when | value |
|---|---|---|
| `guaranteed_amount` | joint only | What this deed guarantees: this tenant's share of the monthly rent, e.g. `£1,234.56` |
| `co_tenant_names` | joint only | The other tenants, comma separated |

The existing six (`reference_number`, `tenant_name`, `tenancy_start_date`,
`rental_address`, `agent_email`, `issue_date`) are unchanged. `tenant_name` now
carries **every** tenant on a joint tenancy.

**On a tenancy of one, the two new tokens are not sent at all.** That is what
keeps a single-tenant deed byte-identical to the one production issues today, and
it is asserted in `supabase/tests/deed_per_tenant.test.sql`. So the template must
render them **conditionally**: put them in a block that reads correctly when both
are blank, or in a section only a joint deed reaches. A PandaDoc token that is
never supplied renders empty, it does not remove the surrounding sentence.

Suggested placement, wording for the client to settle:

> ...jointly and severally with `[co_tenant_names]`, in respect of
> `[guaranteed_amount]` per calendar month.

**Still one signer role.** Opndoor's signature is a static facsimile image, not a
second recipient. One consequence to flag to Matt: PandaDoc's `document.completed`
signs and executes in one step, so **"signed" and "executed" are the same event**
and no screen can show them apart. If Opndoor is to countersign each deed for
real, the template needs a second signer role and the webhook needs to key on
recipient-level completion.

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
