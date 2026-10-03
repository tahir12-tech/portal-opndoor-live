/* OCTOBER'S COMMISSION IS PAID IN NOVEMBER.
 *
 * Matt, 2026-10-03, verbatim: "Agency Reporting (Director view), commission
 * statement: the October 2026 draft says 'Opndoor pays this on 15 Oct 2026'.
 * Each month's commission is paid on the 15th of the following month, so
 * October's is 15 Nov 2026. Fix the date for every month shown, and for a
 * draft say 'Opndoor pays this on 15 Nov 2026, once the month's statement is
 * posted'."
 *
 * WRONG BY A WHOLE MONTH, AND WRONG IN THE DIRECTION THAT MAKES US LOOK LATE.
 * The Dashboard built the sentence from `agentSettlement.settlementDate`,
 * which is the SETTLEMENT RUN's date: the 15th after the run's own prior
 * calendar month. That is the right date for the run and the wrong date for a
 * statement, because the reader picks the month -- so it was only ever right
 * for whichever month the run happened to be settling.
 *
 * AND IT PRINTED WITH OR WITHOUT A STATEMENT. Because the line lived on the
 * Dashboard rather than in the statement, it appeared even for a reader whose
 * statement card says "Nothing has been paid yet" -- a payment date for a
 * payment that does not exist. Two of this repo's render tests were asserting
 * exactly that, and both now assert the opposite.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paidOnFor, paidOnSentence } from './exportsService';
import { formatDate } from '@/lib/format';

describe('when a month is paid', () => {
  it('is the 15th of the month after it', () => {
    expect(formatDate(paidOnFor('2026-10')!)).toBe('15 Nov 2026');
    expect(formatDate(paidOnFor('2026-09')!)).toBe('15 Oct 2026');
  });

  /* DECEMBER ROLLS OVER, which is the one case an off-by-one in the month
     arithmetic would get wrong and nobody would see until January. */
  it('and December is paid in January of the next year', () => {
    expect(formatDate(paidOnFor('2026-12')!)).toBe('15 Jan 2027');
  });

  it('and January is paid in February', () => {
    expect(formatDate(paidOnFor('2027-01')!)).toBe('15 Feb 2027');
  });

  it('while anything that is not a month key answers nothing', () => {
    expect(paidOnFor('')).toBeNull();
    expect(paidOnFor('2026')).toBeNull();
    expect(paidOnFor('2026-13')).toBeNull();
    expect(paidOnFor('not-a-month')).toBeNull();
  });
});

describe('the sentence', () => {
  it('is Matt’s, for a posted month', () => {
    expect(paidOnSentence('2026-09', true)).toBe('Opndoor pays this on 15 Oct 2026.');
  });

  /* A DRAFT SAYS THE DATE AND THE CONDITION, both: the date is still the
     15th of the following month, and what is not yet true is that the
     statement has been posted. Saying only the date promises a payment
     against figures that can still move. */
  it('and names the condition on a draft, with the same date', () => {
    expect(paidOnSentence('2026-10', false))
      .toBe("Opndoor pays this on 15 Nov 2026, once the month's statement is posted.");
  });

  it('and says nothing at all without a month', () => {
    expect(paidOnSentence('', true)).toBeNull();
  });
});

describe('where it is printed', () => {
  const STMT = readFileSync(join(process.cwd(), 'src/components/CommissionStatement.tsx'), 'utf8');
  const DASH = readFileSync(join(process.cwd(), 'src/pages/Dashboard/Dashboard.tsx'), 'utf8');

  it('is the statement, which knows its own month', () => {
    expect(STMT).toContain('paidOnSentence(shownMonth, monthPosted)');
  });

  /* ON FIRST PAINT, not a tick later: `monthKey` is set by an effect, so
     reading it alone left the footer silent for a frame -- and silent in any
     test that renders without awaiting one. */
  it('from the month on screen, which is set before the effect runs', () => {
    expect(STMT).toContain("const shownMonth = monthKey || months[0]?.key || '';");
  });

  it('and no longer the Dashboard, from the settlement run’s date', () => {
    expect(DASH).not.toContain('Opndoor pays this on <b>{agentSettleDate}</b>');
  });

  /* POSTED IS PER PAYEE AND THIS LINE IS PER MONTH, so the month counts as
     posted only when every payee shown is. A month with one payee still
     unposted is a draft, which is the safer way round: it promises less. */
  it('and a month is posted only when every payee on it is', () => {
    expect(STMT).toContain('shown.every((st) => isPostedReference(refs[refKey(st.monthKey, st.payeeKey)] ?? \'\'))');
  });
});
