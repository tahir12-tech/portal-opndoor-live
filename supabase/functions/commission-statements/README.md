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

**The 1st, or the next day that is neither a weekend nor a UK bank holiday.**
Both matter: a statement is what a payment follows, and the payment cannot move
until the banks are open.

`UK_BANK_HOLIDAYS` in `index.ts` is a **static table** of England and Wales
dates from [gov.uk/bank-holidays](https://www.gov.uk/bank-holidays), because a
cron cannot depend on reaching gov.uk at 08:00 on the 1st. It covers **2026 to
2030** and **must be extended before it runs out**. If the function is asked
about a year the table does not cover it logs loudly, reports
`schedule.bankHolidaysKnownForYear: false` on every response, and still skips
weekends, which need no table. It never silently skips a month.

The substitute holidays are in the table as the dates they are **observed**, not
the dates they commemorate, which is what lets the rule work without knowing
why a date is closed.

Across the table that gives the 1st every month except these:

| Month | Sends | Why |
| --- | --- | --- |
| January 2026 | Fri 2 Jan | New Year's Day |
| January 2027 | Mon 4 Jan | New Year's Day, then a weekend |
| **January 2028** | **Tue 4 Jan** | **Sat 1st, Sun 2nd, then Mon 3rd is the substitute for New Year's Day** |
| May 2028 | Tue 2 May | Early May bank holiday |
| January 2029 | Tue 2 Jan | New Year's Day |
| January 2030 | Wed 2 Jan | New Year's Day |

Plus every month whose 1st simply falls at a weekend, which the rule handles
without a table: August 2026 sends Mon 3 Aug, April 2028 sends Mon 3 Apr, and so
on.

**January 2028 is the one worth reading twice.** It is three days late, and
that is the rule working rather than a fault: Saturday, Sunday, then the
substitute Monday for a New Year's Day that itself fell at the weekend. The
December 2027 statements go out on Tuesday 4 January 2028.

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

## The statement reference

`STMT-YYYY-MM-NNNN`, in the PDF's header block, in the CSV's, and in the email
body. It is **stored, not derived**:
`public.commission_statement_ref(p_month, p_payee_key)` assigns `NNNN` once per
payee per month and returns that same answer on every later call.

It replaces a reference derived from the payee's **name**
(`STMT-AG-REGENT-S-LETTINGS-202609`), which was readable and wrong: rename the
agency and September's reference changed, so the statement a finance team filed
last month and the one they download today were the same money under two numbers.
The payee key is id-based, so a rename now moves nothing. See
`20261005190000_a_statement_has_a_number.sql`, which also says why the number is
neither a hash nor a rank.

The portal's own download of the same statement (`buildCommissionStatementDoc`
in `src/data/exportsService.ts`) calls the **same RPC with the same payee key**,
so the number on the emailed PDF and the number on the spreadsheet an agency
exports from Reporting are one number. Neither side computes one of its own.

**A dry run does not ask for a number.** With this RPC the first call *is* the
assignment, and `?dry=1` writes nothing, so a rehearsal would take a real number
for a statement nobody received and leave a hole in the month's sequence. Every
payee a dry run reaches is one that has not been posted, so there is no number
yet and the header prints `Assigned when the statement is posted`.

**A failed reference skips that payee**, counted in `failed` and reported in the
staff settlement email, exactly as a failed recipient lookup is. Nothing is
written to `commission_statement_sends`, so a re-run posts the statement once the
RPC answers. A statement is reconciled by its reference: posting one with no
number, while the portal shows the same statement with one, is worse than posting
it an hour later.

## Columns that say the same thing on every line

A **Branch** column that reads "Leeds" forty times is forty words the reader
scans past to reach the money, and it is the common case: most payees ran one
branch in the month, and most months are all one rate source. So:

- **Branch** is dropped when every line in that payee's statement is the same
  branch, or when no line has one at all.
- **Source** is dropped when every line shares one rate source.
- **Agency** would follow the same rule on a group statement spanning two
  agencies. There is no Agency column yet, because `commission_statement_lines`
  returns the payee, the branch and the frozen source and nothing between them;
  the rule already answers for that dimension, so the column is a row in the RPC
  and an entry in `STATEMENT_COLUMNS` when somebody wants it.

**Dropped means dropped, header included**, never a column of blanks, and
nothing takes its place.

The value used to. A collapsed column put its one value into the header block as
its own line, `Branch: Leeds`, `Source: Opndoor standard`, in the PDF, in the
CSV, in the exported spreadsheet and under the payee's name on the Reporting
page, on the principle that a fact should not be lost with its column. **That is
withdrawn.** A statement is read by the payee, who knows which of their own
branches this is, and a header block that grows a line whenever a column shrinks
is a block that changes shape month to month for no gain. Collapsing a column is
about removing something that says nothing; relocating it puts the same nothing
somewhere else. So `StatementShape` no longer carries `onlyBranch`,
`onlySource` or `onlyAgency` at all: they existed only to be relocated.

A mixed statement keeps its column. Some lines with a branch and some without is
**two** things to say, not one, and collapsing it there would quietly attribute
the unbranched lines to the named branch.

**The PDF redistributes.** Its widths are absolute points chosen to fill the
printable width of A4, so dropping a column without sharing its points out would
leave the table short of the right margin and looking like a fault. `keepColumns`
scales the survivors proportionally: eight columns still sum to the same 514pt
that ten did.

### One rule, two copies

The rule lives in **`src/data/statementColumns.ts`** and is **copied verbatim**
into `index.ts`, between the markers `// ---- BEGIN SHARED STATEMENT COLUMN RULE
----` and `// ---- END SHARED STATEMENT COLUMN RULE ----`. An Edge Function runs
on Deno and cannot import from `src/`, and a rule this small does not earn a
published package.

`src/data/statementColumns.test.ts` reads **both files** and fails the moment the
two blocks differ by a character, so the screen, the PDF and the CSV cannot end
up dropping different columns for the same month. **If you change one copy,
change the other.** The test will tell you if you forget.

The question it answers is deliberately not `viewerShape`'s. That one asks what
a *viewer* has more than one of, counted over their whole book; this asks what
*these rows* have more than one of. Same idea, different subject: an agency with
four branches keeps its Branch column on Applications all year and loses it on a
September statement where only Leeds paid.

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

**And a CSV, second.** The PDF is the statement; the CSV is the working. Both
are attached, PDF first, because a mail client shows the first attachment as the
document and the order is the only signal of which is which. They are built from
the same rows in the same pass, so there is no second query and no way for them
to disagree.

One deliberate difference between them: where the PDF prints a single hyphen for
an empty cell, the CSV leaves the cell **empty**. A hyphen is a typographic
answer to a blank box on a printed page, and in a spreadsheet column somebody is
going to sum it is a value that breaks the sum.

## Dry run (prove it without sending)

Add `?dry=1` to either path. It computes everything, **builds both attachments
and throws them away**, sends nothing, writes nothing, and returns exactly who
would be written to, with what figure, and with what attached.

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
- `attachments`, which must list `pdf` then `csv` in that order, and
  `would[].attachments[].bytes`, which proves both were actually built rather
  than that a row was counted.
- `would[].columns`, which is the column rule's answer for that payee. It is
  the only way to see which columns a statement came out with without opening
  the PDF.
- `would[].reference`, which on a dry run reads `Assigned when the statement is
  posted` for every payee. A number here would mean the rehearsal had assigned
  one.
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
- Apply `20261005140000_commission_statement_recipients.sql` and
  `20261005190000_a_statement_has_a_number.sql` (the reference table and its
  function; already applied on dev).
- Check the backfill: every payee should have somebody ticked. The dry run's
  `unaddressed` list is the fastest way to see who does not.
- Open one dry-run PDF and look at it. The writer is new.
