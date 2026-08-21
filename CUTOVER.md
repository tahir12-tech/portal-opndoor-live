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
| `EMAIL_FROM` | 14 fns | An address on a **verified domain** | Resend refuses every send to anyone but the account owner |
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
| `REMINDERS_CRON_SECRET` | 7 fns | Any long random string, and it must **match `ops_secrets.reminders_cron` in the database** | Every cron-driven function returns 401 |
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
