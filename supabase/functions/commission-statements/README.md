# Monthly commission statements

The `commission-statements` Edge Function posts, on the **1st of each month or
the next day that is not a UK bank holiday**, the **previous calendar month's**
commission statement: one email per payee that earned anything, with the total
in the subject and in the body, the constituent applications attached **as a
PDF**, and a link to the same statement in the portal. Opndoor staff get one
consolidated settlement email the same morning.

Nothing here is scheduled or applied automatically. The SQL below is what a
human runs.

> The other cron docs live one level up (`supabase/EXPIRY-COHORTS.md`,
> `supabase/EXPIRY-REMINDERS.md`, `supabase/WEEKLY-DIGEST.md`). This one sits
> beside its function because it was written with it.

## Shape, and why it matches the others

- **pg_cron + service-role Edge Function.** Two daily jobs at 07:00 and 08:00
  UTC; the function self-gates to exactly 08:00 Europe/London, so the off-hour
  run no-ops and the pair survives the BST/GMT change. `verify_jwt = false`.
- **Idempotency.** `commission_statement_sends (statement_month, payee_key)`
  records one row per statement posted, and `@settlement` for the consolidated
  email. A retry, a re-run or a redeploy mid-run posts nothing twice.
- **Auth.** `x-reminders-secret == REMINDERS_CRON_SECRET` (or the `ops_secrets`
  mirror), or a signed-in opndoor-admin JWT with `{ "test": true }`.
- **Test build** redirects every email to `EMAIL_REVIEW_ADDRESS`, through the
  shared sender, so a rehearsal cannot reach a real agency.

## The send day

**The 1st, or the next day that is not a UK bank holiday. Weekends do not
matter.** A Saturday or Sunday 1st is a send day: statements are an email and a
PDF, nobody has to be at a desk to receive one, and only a bank holiday moves
the date, because that is when the payment behind the statement cannot clear.

`UK_BANK_HOLIDAYS` in `index.ts` is a **static table** of England and Wales
dates from [gov.uk/bank-holidays](https://www.gov.uk/bank-holidays), because a
cron cannot depend on reaching gov.uk at 08:00 on the 1st. It covers **2026 to
2030** and **must be extended before it runs out**. If the function is asked
about a year the table does not cover it logs loudly, reports
`schedule.bankHolidaysKnownForYear: false` on every response, and falls back to
sending on the 1st. It never silently skips a month.

Across the table that gives the 1st every month except these:

| Month | Sends | Why |
| --- | --- | --- |
| January 2026 | Fri 2 Jan | New Year's Day |
| January 2027 | **Sat 2 Jan** | New Year's Day, and a Saturday is a send day |
| January 2028 | **Sat 1 Jan** | 1 January is not itself the holiday; the substitute is Mon 3 Jan |
| May 2028 | Tue 2 May | the 1st is the Early May bank holiday |
| January 2029 | Tue 2 Jan | New Year's Day |
| January 2030 | Wed 2 Jan | New Year's Day |

January 2028 is the one worth reading twice. When New Year's Day falls on a
Saturday, gov.uk lists the substitute Monday as the bank holiday and not the
Saturday, so under this rule the December 2027 statements go out on Saturday
1 January 2028. That is the rule working, not a bug.

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

**Payment terms** are one exported constant, `PAYMENT_TERMS_LINE`, currently
`Paid by the 15th of the following month.` It renders verbatim in the email body
and along the bottom of every page of the PDF. Change that one string and both
follow.

**An empty cell is a single hyphen.** A line that recorded no commission source,
or no share, prints `-`. Not blank, which reads as a rendering failure on a money
document, and not "None", which is a value rather than an absence.

## The attachment

A **PDF**, `opndoor-commission-YYYY-MM.pdf`, written by
`supabase/functions/_shared/pdf.ts`.

That file is a small, dependency-free PDF writer for exactly this one shape of
document: a header block, a table, a total, a footer. A4 portrait, Helvetica
(one of the base 14, so nothing is embedded), `/WinAnsiEncoding` so a pound sign
is the single byte `0xA3`, real Helvetica AFM advance widths so the money
columns share a right edge, page breaks with the title and column headers
repeated, and an exact `xref` table.

It is **not a general PDF library and must not become one.** If a second kind of
document needs a PDF, that is a decision to take deliberately, not a flag to add
to this writer.

`deno test supabase/functions/_shared/pdf.test.ts` covers it. The assertion that
earns its keep is the one that walks every byte offset the `xref` declares and
checks the object really starts there. A PDF with a wrong `xref` opens fine in
Preview and Chrome, which rebuild the table, and fails in strict readers and
server-side parsers, so the bug survives a human opening the attachment and
saying it looks fine.

**What was lost.** This used to be a CSV, which opened in Excel and reconciled
line by line. A PDF does not. Anyone who needs the numbers in a spreadsheet
downloads the month from the Reporting page, which still exports xlsx.

## Dry run (prove it without sending)

Add `?dry=1` to either path. It computes everything, **builds each PDF and
throws it away**, sends nothing, writes nothing, and returns exactly who would
be written to, with what figure, and with what attached.

```bash
curl -s -X POST \
  'https://<PROJECT-REF>.supabase.co/functions/v1/commission-statements?dry=1' \
  -H 'Content-Type: application/json' \
  -H 'apikey: <ANON-KEY>' \
  -H 'Authorization: Bearer <OPNDOOR-ADMIN-JWT>' \
  -d '{"test":true,"month":"2026-09"}'
```

`month` is optional and only honoured on the manual path; without it the function
takes the previous calendar month.

Read these four before scheduling anything:

- `schedule.sendDate` and `schedule.isSendDay`, which is the day rule's answer
  for the month you are standing in.
- `schedule.bankHolidaysKnownForYear`, which must be `true`.
- `attachment.format`, which must be `pdf`, and `would[].attachment.bytes`,
  which proves the writer ran rather than that a row was counted.
- `would`, `unaddressed` and `totalPayable`.

The PDF is built on the dry path on purpose. A rehearsal that only counted rows
would prove the recipients and not the attachment, and a malformed statement
would first be noticed by an agency on the 1st.

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
send day, so the schedule never has to encode a moving date, and the decision
sits next to the bank holiday table it depends on.

## Before the first live run

- `[functions.commission-statements] verify_jwt = false` in
  `supabase/config.toml`, or the cron's `x-reminders-secret` never gets a chance
  to be checked and every run comes back 401. (Already there.)
- `supabase functions deploy commission-statements`.
- Apply `20261005140000_commission_statement_recipients.sql`.
- Check the backfill: every payee should have somebody ticked. The dry run's
  `unaddressed` list is the fastest way to see who does not.
- Open one dry-run PDF and look at it. The writer is new.
