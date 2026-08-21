# Cutover checklist

**Everything here lives outside the code.** No migration carries any of it, so
`db push` finishing successfully tells you nothing about whether any of it is
done. Each item is something a person sets in a dashboard, and each one fails in
its own way if it is missed.

Written to be worked through under pressure. Every item has the same four
fields: **what**, **where**, **value**, **verify**. Do the verify. Several of
these fail silently, and the whole point of the list is that you cannot tell by
looking at the app.

> **Read this first.** The dangerous items are the ones that fail **silently**:
> the app keeps working, nothing errors, and a thing that should happen simply
> does not. They are marked **SILENT** below. Do those verifies even when you are
> behind.

---

# DO NOW, not at cutover

## 0. Rotate `REMINDERS_CRON_SECRET` on production

**Why this is not a cutover item.** The dev value was committed to the repo at
`supabase/EXPIRY-REMINDERS.md` and has been in git history for weeks, so it is in
**every clone anyone has ever taken**. Production uses the same secret. The
exposure exists today, not on cutover day.

It authenticates seven functions: `ops-alert`, `hubspot-sync`,
`payment-reminders`, `expiry-reminders`, `expiry-cohorts`, `weekly-digest` and
`referencing-callback`. Anyone holding it can trigger any of them, which means
firing real reminder and digest email to real partners and tenants.

**The one thing that makes this safe.** Each function accepts the presented
`x-ops-secret` against **either** the `REMINDERS_CRON_SECRET` env var **or** the
`ops_secrets.reminders_cron` row (`hubspot-sync/index.ts:94-99`). So there is no
window where a cron is refused, in either order.

**The corollary, and the reason to do both halves in one sitting:** the old
secret keeps working until **both** are changed. Doing one is not a rotation.

### Step 1: confirm production's shape before touching it

Do not assume it matches dev. Dev had **no** Vault row despite the docs
describing one.

```sql
select name from public.ops_secrets where name = 'reminders_cron';
select name from vault.secrets where name = 'reminders_cron_secret';
```

Expect one row from the first and **zero** from the second. If the second
returns a row, production has a Vault copy that dev does not, and it is a
**third** holder that must be updated too. Stop and say so before continuing.

### Step 2: generate the new value

```
python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(48)))"
```

Keep it in a password manager. Do not paste it into a file in this repo, which
is how the current one got out.

### Step 3: update `ops_secrets` first

This is the row the cron bodies read, so updating it first means the crons
immediately present the new value, and the function still accepts it via the old
env var.

```sql
update public.ops_secrets set secret = '<NEW>' where name = 'reminders_cron';
select secret = '<NEW>' as took from public.ops_secrets where name = 'reminders_cron';
```

**Check before continuing:** `took` is `true`, and

```sql
select jobname, status, start_time
  from cron.job_run_details order by start_time desc limit 10;
```

still shows `succeeded`. Wait for at least one job to run. `hubspot-sync` fires
every two minutes and is the fastest signal.

### Step 4: update the edge function secret

```
supabase secrets set REMINDERS_CRON_SECRET='<NEW>' --project-ref <PROD_REF>
```

**This is the step that closes the exposure.** Until it lands, the old value is
still accepted.

**Check:** the old secret must now be refused and the new one accepted.

```
curl -s -o /dev/null -w "old -> %{http_code}\n" -X POST \
  https://<PROD_REF>.supabase.co/functions/v1/hubspot-sync \
  -H "x-ops-secret: <OLD>" -H "Content-Type: application/json" -d '{"limit":1}'

curl -s -o /dev/null -w "new -> %{http_code}\n" -X POST \
  https://<PROD_REF>.supabase.co/functions/v1/hubspot-sync \
  -H "x-ops-secret: <NEW>" -H "Content-Type: application/json" -d '{"limit":1}'
```

**old must be 401.** If it is not, a holder was missed: re-check step 1's
queries and whether a Vault row exists.

**new should be 200.** A **500 is also a pass for the rotation**: it means auth
succeeded and something downstream failed. On dev the 500 was
`No HubSpot access token configured`. Read the body before treating it as a
failure.

### Step 5: watch one full cycle

```sql
select jobname, status, start_time, return_message
  from cron.job_run_details
 where start_time > now() - interval '30 minutes'
 order by start_time desc;
```

Every row `succeeded`. **A 401 in `return_message` is the failure signal.**

### Rollback

If a cron starts 401ing, put the old value back in the row the crons read. This
takes effect on the next tick with no deploy:

```sql
update public.ops_secrets set secret = '<OLD>' where name = 'reminders_cron';
```

That restores service immediately, because the function accepts either source
and the env var can stay on the new value while you work out what happened.
**The exposure reopens for as long as the old value is live**, so treat it as
buying time rather than as a fix, and retry the same day.

### Afterwards

The old value remains in git history. Rotating makes it worthless, which is the
only fix short of rewriting history and breaking every clone. Do not attempt the
rewrite.

---

## 1. Supabase Auth settings

### 1.1 Email OTP Expiration
- **What.** How long a password reset link and a magic-link token stay valid.
- **Where.** Supabase dashboard, Authentication, Emails, **Email OTP Expiration**, in seconds.
- **Value.** `1800` (30 minutes).
- **Verify.**
  ```
  curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    https://api.supabase.com/v1/projects/<REF>/config/auth \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print({k:v for k,v in d.items() if 'exp' in k.lower()})"
  ```
  Or request a reset, then try the link at 31 minutes and confirm it is refused.
- **Why it matters.** Three places in the product tell the user 30 minutes: the
  reset page twice and the reset email once. Supabase's default is 3600, so
  **doing nothing makes the product lie**, not break.
- **Not coupled to the six-digit codes.** Those are ours: `issue_email_code`
  writes `expires_at` into `tenant_email_codes` at issue time and
  `verify_email_code` reads it back. Changing this setting cannot move them.

### 1.2 Site URL and redirect allow list
- **What.** Where Supabase Auth is willing to send somebody after a link.
- **Where.** Authentication, URL Configuration.
- **Value.** The production portal origin. Every `APP_URL` value below must be on the allow list.
- **Verify.** Complete one real password reset end to end. A wrong value here
  produces a link that lands on an error page rather than the reset form.

---

## 2. Edge function secrets

Set with `supabase secrets set NAME=value --project-ref <REF>`. The API returns
hashes, not values, so **you cannot read one back to check it**. Verify by
exercising the path.

| Secret | Read by | Production value | If missing |
| ------ | ------- | ---------------- | ---------- |
| `SUPABASE_URL` | 28 fns | Set automatically | Nothing runs |
| `SUPABASE_SERVICE_ROLE_KEY` | 27 fns | Set automatically | Nothing runs |
| `SUPABASE_ANON_KEY` | 15 fns | Set automatically | Password checks fail |
| `RESEND_API_KEY` | 15 fns | The live Resend key | **Registration refuses with 503.** Loud, deliberately |
| `EMAIL_FROM` | 14 fns | An address on a **verified domain** | Resend refuses every send to anyone but the account owner. **Set it explicitly.** Each module carries its own default and they diverge: nine say `noreply@opndoor.co` and six say `payments@opndoor.co`, so leaving it unset sends from two different addresses depending on which email it is, and only whichever is verified will deliver |
| `EMAIL_REPLY_TO` | 14 fns | `hello@opndoor.co` | Falls back to a default in code. **SILENT** |
| `EMAIL_REVIEW_ADDRESS` | 4 fns | **UNSET.** Leave it unset | If set, **every tenant email is redirected and no tenant is ever contacted.** SILENT and severe |
| `APP_URL` | 13 fns | The production portal origin | Links in emails point at the wrong host, or nowhere |
| `STRIPE_SECRET_KEY` | 2 fns | `sk_live_...` | Payments cannot be created |
| `STRIPE_SECRET_KEY_TEST` | 1 fn | `sk_test_...` | **Sandbox partners cannot transact.** SILENT for live traffic |
| `STRIPE_WEBHOOK_SECRET` | webhook | Live endpoint signing secret | Every webhook fails signature. Payments never settle |
| `PANDADOC_API_KEY` | 1 fn | Live PandaDoc key | Deeds cannot be issued |
| `PANDADOC_API_KEY_TEST` | 1 fn | Sandbox key | Sandbox deeds fail |
| `PANDADOC_TEMPLATE_ID` | deed fn | The live template id | Deed issue fails |
| `PANDADOC_WEBHOOK_SHARED_KEY` | webhook | Matches the PandaDoc webhook config | Executed deeds never come back |
| `HUBSPOT_ACCESS_TOKEN` | 1 fn | The live private-app token | CRM sync stops. **SILENT**: the cron runs and reports success |
| `OPS_ALERT_ADDRESS` | 1 fn | The ops inbox | **Failure alerts go nowhere.** SILENT, and it is the alarm itself |
| `REMINDERS_CRON_SECRET` | 7 fns | A **fresh** value, matching `ops_secrets.reminders_cron`. **See section 0: the current one is exposed and must be rotated now, not at cutover** | Every cron-driven function returns 401 |
| `PORTAL_ENV` | 1 fn | `production` | Environment banner is wrong |
| `REFERENCING_API_URL` | 1 fn | Lettings live base URL | Rail 4 cannot call back |
| `REFERENCING_API_EMAIL` / `_PASSWORD` / `_TOKEN` | 1 fn | Lettings credentials | Rail 4 cannot call back |

**`EMAIL_REVIEW_ADDRESS` is the one to check twice.** It is the switch that makes
non-production safe, and leaving it set on production means no tenant, agent or
landlord ever receives anything, with no error anywhere.

**Verify the whole mail path in one go:** trigger a password reset for a real
address on production and confirm it arrives at that address, not somewhere else.

---

## 3. Cron jobs

**A migration cannot create most of these**, because it cannot know which
project it is on: the job body posts to `https://<ref>.supabase.co/functions/v1/...`
and the ref is not knowable from inside a migration. So they are created by hand.

Two are created by migrations and will already exist: `hubspot-sync` and
`rate-limit-cleanup`. **Everything else in this table must be created.**

> On the dev project today only those two exist. Dev is not a template for this
> section; the list below is.

| Job | Schedule | What stops without it |
| --- | -------- | --------------------- |
| `partner-webhooks` | `* * * * *` | **Partners are never notified of anything.** SILENT: deliveries queue forever |
| `payment-reminders-0700` / `-0800` | `0 7 * * *` / `0 8 * * *` | Unpaid referrals are never chased |
| `expiry-reminders-0700` / `-0800` | `0 7 * * *` / `0 8 * * *` | Guarantees expire with no warning |
| `expiry-cohorts-0700` / `-0800` | `0 7 * * *` / `0 8 * * *` | The monthly expiry cohort is never sent |
| `weekly-digest-0700` / `-0800` | `0 7 * * 1` / `0 8 * * 1` | Partners get no weekly digest |
| `referencing-callback` | `*/10 * * * *` | Executed deeds never reach Lettings. Rail 4 only |
| `hubspot-map-check` | daily | Field-map drift is never noticed. **SILENT by design** |

Each is documented with its exact statement: `supabase/PAYMENT-REMINDERS.md`,
`supabase/EXPIRY-REMINDERS.md`, `supabase/EXPIRY-COHORTS.md`,
`supabase/WEEKLY-DIGEST.md`, `PARTNER-API.md`, `TENANT-PLATFORM-SETUP.md`.

**Two jobs per daily task, at 07:00 and 08:00, is deliberate**, not a mistake:
the database runs in UTC and the second covers British Summer Time. Both fire;
the ledger makes the second a no-op. Do not "tidy" one away.

**Verify.**
```sql
select jobname, schedule, active from cron.job order by jobname;
select jobname, status, start_time
  from cron.job_run_details order by start_time desc limit 20;
```
A healthy row has `status = 'succeeded'`. A job that exists and has never run is
as broken as one that does not exist, and looks fine in the first query.

**Before any of them work:** `ops_secrets.functions_base_url` must hold this
project's own URL, and `ops_secrets.reminders_cron` must match the
`REMINDERS_CRON_SECRET` above. A mismatch gives every job a 401 that only
appears in `cron.job_run_details`.

---

## 4. Stripe

### 4.1 Live webhook endpoint
- **What.** Where Stripe posts payment outcomes. **The webhook is the only thing that ever marks an application paid.** No webhook, no payments, ever, however well checkout works.
- **Where.** Stripe dashboard, Developers, Webhooks, in **live** mode.
- **Value.** URL `https://<REF>.supabase.co/functions/v1/stripe-webhook`. Events: **`checkout.session.completed`** and **`charge.refunded`**. Those are the only two the code handles; adding more is harmless, missing either is not.
- **Verify.** Take one real payment, then `select count(*) from stripe_events;`. Zero after a completed checkout means the endpoint is wrong, the secret is wrong, or the events were not selected.

### 4.2 Test-mode webhook endpoint
- Same URL, registered in **test** mode, for sandbox partners. Its signing secret goes in `STRIPE_WEBHOOK_SECRET_TEST`.
- Without it, sandbox rehearsals appear to work and never settle. **SILENT.**

---

## 5. PandaDoc

- **What.** Where PandaDoc posts deed outcomes.
- **Where.** PandaDoc dashboard, webhooks.
- **Value.** URL `https://<REF>.supabase.co/functions/v1/pandadoc-webhook`, with the shared key matching `PANDADOC_WEBHOOK_SHARED_KEY`. Events handled: **`document.completed`**, **`document.viewed`**, **`document.voided`**, **`document.declined`**.
- **Verify.** Issue one deed, sign it, then confirm `executed_pdf_path` is populated and the PDF is in the `deeds` bucket. `document.completed` is what stores the executed copy; without it a signed deed is never retrieved.

---

## 6. Resend

- **What.** The sending domain.
- **Where.** resend.com/domains, plus DNS.
- **Value.** A verified domain, and `EMAIL_FROM` set to an address on it.
- **Verify.** Send to an address that is **not** the Resend account owner. Without a verified domain Resend returns `403 validation_error` and will only deliver to the account owner, so **it appears to work when you test it yourself**. This is the trap: your own inbox is the one address that cannot detect the fault.

---

## 7. Storage

Three private buckets: **`applicant-docs`**, **`deeds`**, **`reference-reports`**.

- **Verify.** `select id, public from storage.buckets;` and confirm all three exist with `public = false`.
- **A public bucket here exposes identity documents and executed deeds to anyone with a URL.** Check the boolean, not the dashboard's colour.
- There are no policies on `storage.objects`: access runs through the service role in Edge Functions. If policies appear, something has been added by hand.

---

## 8. Database extensions

`pg_cron` and `pg_net` must be enabled, or every cron item above fails at
creation. A migration enables them, so this should already be true.

**Verify.** `select extname from pg_extension where extname in ('pg_cron','pg_net');` returns both.

---

## Final pass

Work down this list and then, in order:

1. Register a tenant on production and confirm the code arrives **at their address**.
2. Take one real payment and confirm `stripe_events` grows.
3. Issue one deed, sign it, confirm the executed PDF lands in `deeds`.
4. `select jobname, status from cron.job_run_details order by start_time desc limit 20;` and confirm recent successes.

If all four pass, every item above is set. If any fails, the item it depends on
is the one to check first.
