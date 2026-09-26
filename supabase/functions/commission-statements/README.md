# Monthly commission statements

The `commission-statements` Edge Function posts, on the **first working day of
each month**, the **previous calendar month's** commission statement: one email
per payee that earned anything, with the total in the subject and in the body,
the constituent applications attached, and a link to the same statement in the
portal. Opndoor staff get one consolidated settlement email the same morning.

Nothing here is scheduled or applied automatically. The SQL below is what a
human runs.

> The other cron docs live one level up (`supabase/EXPIRY-COHORTS.md`,
> `supabase/EXPIRY-REMINDERS.md`, `supabase/WEEKLY-DIGEST.md`). This one sits
> beside its function because it was written with it.

## Shape, and why it matches the others

- **pg_cron + service-role Edge Function.** Two daily jobs at 07:00 and 08:00
  UTC; the function self-gates to exactly 08:00 Europe/London, so the off-hour
  run no-ops and the pair survives the BST/GMT change. `verify_jwt = false`.
- **Fire day.** The first working day of the month, weekends skipped. **UK bank
  holidays are not in this repo and are not handled**: if the 1st is a Monday
  bank holiday the statements go out that morning. Fixing that needs a holiday
  calendar somebody owns, not a hardcoded list that goes stale.
- **Idempotency.** `commission_statement_sends (statement_month, payee_key)`
  records one row per statement posted, and `@settlement` for the consolidated
  email. A retry, a re-run or a redeploy mid-run posts nothing twice.
- **Auth.** `x-reminders-secret == REMINDERS_CRON_SECRET` (or the `ops_secrets`
  mirror), or a signed-in opndoor-admin JWT with `{ "test": true }`.
- **Test build** redirects every email to `EMAIL_REVIEW_ADDRESS`, through the
  shared sender, so a rehearsal cannot reach a real agency.

## What the statement says

Computed in SQL by `commission_statement_lines` / `commission_statement_payees`,
to the same rule as the Reporting page: applications that **paid** in the month,
refunds excluded, one line per payee per application, commission = the amount the
rate applied to times the rate. The screen's copy of that rule lives in
`src/data/liveAnalytics.ts`; the migration comments say where and why the two
deliberately differ.

Recipients are every **active** person with *Receives commission statements*
ticked at the payee's own level **or above it**, plus the party's finance address
where one is set. Never below: a branch manager does not receive the agency's
statement.

## Dry run (prove it without sending)

Add `?dry=1` to either path. It computes everything, sends nothing, writes
nothing, and returns exactly who would be written to and with what figure.

```bash
curl -s -X POST \
  'https://<PROJECT-REF>.supabase.co/functions/v1/commission-statements?dry=1' \
  -H 'Content-Type: application/json' \
  -H 'apikey: <ANON-KEY>' \
  -H 'Authorization: Bearer <OPNDOOR-ADMIN-JWT>' \
  -d '{"test":true,"month":"2026-09"}'
```

`month` is optional and only honoured on the manual path; without it the function
takes the previous calendar month. Read `would`, `unaddressed` and
`totalPayable` in the response before scheduling anything.

## Schedule (run once, in the SQL editor)

Replace `<PROJECT-REF>` and use the anon key as `apikey`. The Vault secret is the
same one the other reminder crons use, so it is almost certainly already there.

```sql
-- Vault secret (once): select vault.create_secret('<REMINDERS_CRON_SECRET>', 'reminders_cron_secret');
select cron.schedule('commission-statements-0700', '0 7 * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT-REF>.supabase.co/functions/v1/commission-statements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<ANON-KEY>',
      'x-reminders-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);
select cron.schedule('commission-statements-0800', '0 8 * * *', $$
  select net.http_post(
    url    := 'https://<PROJECT-REF>.supabase.co/functions/v1/commission-statements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<ANON-KEY>',
      'x-reminders-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);
```

Daily rather than monthly on purpose: the function decides whether today is the
first working day, so the schedule never has to encode a moving date, and the
decision sits next to the weekday rule it depends on.

## Two things still outstanding

1. **The attachment is a CSV, not a PDF.** This repo has no PDF writer. Deeds are
   PDFs because PandaDoc renders them; the portal's branded exports are xlsx from
   a browser-only library. See `ATTACHMENT_FORMAT` in `index.ts`.
2. **The payment terms sentence is a placeholder.** `PAYMENT_TERMS_LINE` reads
   `PAYMENT TERMS: [to be supplied]` and is rendered verbatim in the email and in
   the attachment. Replace that one string with the real wording. Do not invent
   it.

## Before the first live run

- `[functions.commission-statements] verify_jwt = false` must be added to
  `supabase/config.toml`, or the cron's `x-reminders-secret` never gets a chance
  to be checked and every run comes back 401.
- `supabase functions deploy commission-statements`.
- Apply `20261005140000_commission_statement_recipients.sql`.
- Check the backfill: every payee should have somebody ticked. The dry run's
  `unaddressed` list is the fastest way to see who does not.
