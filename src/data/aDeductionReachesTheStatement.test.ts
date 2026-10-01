/* A CARRIED DEDUCTION ACTUALLY REACHES THE NEXT STATEMENT.
 *
 * Matt, 2026-10-01, verbatim: Opndoor admin chooses "(a) reissue a
 * corrected statement to the payee, or (b) carry the amount as a
 * deduction line on the payee's next statement."
 *
 * THE QUEUE'S OWN WARNING ABOUT THIS ONE: "A deduction line must
 * actually appear on the next statement if (b) is chosen, or the choice
 * is a note to nobody." The database half is proved by
 * a_refund_after_a_statement_is_a_question.test.sql, which shows the
 * deduction being owed, carried once and never twice. What is left is
 * the run: that it reads them, puts them on the paper, nets the money
 * down, and settles them ONLY after the statement has gone.
 *
 * =====================================================================
 * WHAT WAS RUN FOR REAL, AND WHAT IS PINNED HERE
 * =====================================================================
 *
 * The documents were built for real in a rehearsal, with and without a
 * deduction, and read back: the PDF shows "Commission this month
 * £1,200.00", two refund lines of -£300.00 and -£150.00, and "Total
 * payable £750.00" with no truncation; the email subject, heading and
 * invoice sentence all carry £750.00; the CSV lists every deduction by
 * guarantee and by the statement it came from. The no-deduction case was
 * run beside it and is byte-for-byte the statement it always was.
 *
 * A rehearsal is not a test, though, because nothing re-runs it. This
 * file pins the decisions in the run that a rehearsal of the DOCUMENTS
 * cannot reach: the ordering of the settle, and the two cases where a
 * deduction must NOT be swallowed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FN = resolve(process.cwd(), 'supabase/functions/commission-statements/index.ts');
const src = readFileSync(FN, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('the run reads the deductions and puts them on the paper', () => {
  it('asks the database for them once, for the month', () => {
    expect(code).toMatch(/rpc\("statement_deductions", \{ p_month: monthStart \}\)/);
    expect(code).toMatch(/deductionsByPayee/);
  });

  it('and passes them into every document the payee gets', () => {
    // The agency pair, the supplier bundle, and the email.
    expect(code).toMatch(/statementPdf\(p, lines, label, reference, invoiceEmail, deductions\)/);
    expect(code).toMatch(/statementCsv\(p, lines, label, reference, invoiceEmail, deductions\)/);
    expect(code).toMatch(/buildSupplierBundle\(service, p, monthStart, monthKey, label, reference, invoiceEmail, deductions\)/);
    expect(code).toMatch(/\.\.\.\(deductions\.length \? \{ deductions \} : \{\}\)/);
  });

  /* THE AGENCY SCHEDULES DO NOT GET IT. A schedule is the supplier's
     working for what IT owes one of ITS agents; a refund Opndoor is
     recovering from the supplier is none of that agency's business, and
     putting it there would tell an agency its own commission had been
     cut when it had not. */
  it('but not into the per-agency schedules inside the supplier zip', () => {
    const builder = code.slice(
      code.indexOf('export async function buildSupplierBundle'),
      code.indexOf('export function scheduleSlug'),
    );
    expect(builder).toMatch(/supplierStatementPdf\(p, sl, label, reference, invoiceEmail, deductions\)/);
    expect(builder).toMatch(/supplierSchedulePdf\(p\.org_name, ag\.agency_name, mine, label\)/);
    expect(builder).not.toMatch(/supplierSchedulePdf\([^)]*deductions/);
    expect(builder).not.toMatch(/supplierScheduleCsv\([^)]*deductions/);
  });
});

describe('the money that leaves the bank', () => {
  it('the recorded send total is the net, not the month’s commission', () => {
    const insert = code.slice(code.indexOf('commission_statement_sends").insert({'));
    expect(insert.slice(0, 300)).toMatch(/recipients: to\.length, total: netTotal/);
  });

  /* THE STAFF SETTLEMENT EMAIL TOTALS THIS. A grand total of the gross
     would be larger than the sum of the statements that make it up, and
     the one document that is supposed to say what Opndoor owes out for
     the month would be the one document that is wrong. */
  it('and so is the grand total on the staff settlement', () => {
    expect(code).toMatch(/const grand = payees\.reduce\(\s*\(s, p\) => s \+ num\(p\.total\) - deductedTotal\(/);
  });
});

describe('a deduction is never quietly lost', () => {
  /* SETTLED AFTER THE SEND, NOT BEFORE. A deduction marked carried on a
     statement that failed to send would be money forgiven: it would
     never appear on another statement and nothing would say so. */
  it('settles only after the statement has actually gone', () => {
    const loop = code.slice(code.indexOf('const res = await sendMessage({'));
    const failed = loop.indexOf('if (!res.ok) { failed += 1; continue; }');
    const settle = loop.indexOf('settle_statement_deductions');
    expect(failed).toBeGreaterThan(0);
    expect(settle).toBeGreaterThan(0);
    expect(failed, 'the settle happens before the send is known to have worked').toBeLessThan(settle);
  });

  /* AND A MONTH TOO SMALL TO ABSORB IT IS NOT A STATEMENT. Sending one
     for nought or for a negative figure would be asking a payee to
     invoice us for money they owe. The deduction stays unsettled and
     waits for a month with enough in it. */
  it('and a month the deduction swallows posts nothing and settles nothing', () => {
    expect(code).toMatch(/if \(netTotal <= 0 && deductions\.length\) \{ nothingDue \+= 1; continue; \}/);
    const guard = code.indexOf('if (netTotal <= 0 && deductions.length)');
    const settle = code.indexOf('settle_statement_deductions');
    expect(guard).toBeLessThan(settle);
  });
});

describe('the corrected statement, if that is what was chosen', () => {
  const reissue = code.slice(
    code.indexOf('async function serveReissue'),
    code.indexOf('Deno.serve(async (req)'),
  );

  it('is Opndoor staff only', () => {
    expect(reissue).toMatch(/prof\?\.role !== "superadmin" && prof\?\.role !== "opndoor_manager"/);
    expect(reissue).toMatch(/if \(!authHeader\) return json\([\s\S]{0,80}401\)/);
  });

  /* THE DECISION IS THE AUTHORITY. "Nothing happens automatically" means
     this endpoint refuses rather than treating the call as the choice. */
  it('and refuses unless a person already chose to reissue', () => {
    expect(reissue).toMatch(/if \(q\.decision !== "reissue"\)/);
    expect(reissue).toMatch(/if \(q\.reissued_at\)/);
  });

  /* ITS OWN NUMBER. Two documents sharing one reference breaks
     reconciliation on the exact field a finance team keys by, and the
     payee is holding both pieces of paper. */
  it('and takes its own reference, not the one the first statement used', () => {
    expect(reissue).toMatch(/p_payee_key: `\$\{q\.payee_key\}#reissue`/);
    expect(reissue).toMatch(/message\.subject = `Corrected commission statement/);
    expect(reissue).toMatch(/This replaces the statement we sent you/);
  });

  /* NOT POSTED TO commission_statement_sends. That table is the run's
     idempotency key, one row per (month, payee): a second row would
     either collide or make next month's run think it had already
     posted. The question row is what records the reissue. */
  it('and does not write a second send row for the month', () => {
    expect(reissue).not.toMatch(/commission_statement_sends/);
    expect(reissue).toMatch(/mark_refund_question_reissued/);
  });

  /* A PAYEE WHOSE ONLY BUSINESS THAT MONTH WAS THE REFUNDED ONE. There
     is no corrected statement to send, and a document for nought is not
     a document. */
  it('and says so when the correction leaves nothing at all', () => {
    expect(reissue).toMatch(/has no commission left for/);
  });
});
