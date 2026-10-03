/* THE MANAGEMENT GUIDE PRINTED WHAT OPNDOOR PAYS ITS SUPPLIERS.
 *
 * Matt, 2026-10-03, verbatim: "Priority before launch: the Management help
 * guide shows a commission table 'Partner 25%, Agent 10%' to agency and
 * supplier management. Remove it now: it's wrong for most deals and reveals
 * what Opndoor pays suppliers. Each customer's guide should say 'Your
 * commission is set out in your agreement and shown on your Commission tab
 * and monthly statement.'"
 *
 * IT IS A DISCLOSURE, NOT A WORDING PROBLEM, which is why it jumped the
 * agreed order. The guide is listed with `minRole: 'management'` and
 * `needsCommission: true`, so it is served to agency Directors AND to
 * supplier management -- and it printed the supplier rate in a table headed
 * "Share of the fee".
 *
 * AND IT WAS WRONG FOR MOST DEALS ANYWAY. 25/10 is the old default that
 * 20261007680000 removed; Regent is on 3 or 5 weeks at 20% or 25%, Letly is
 * on a deliberate 0%, and every negotiated agreement since has its own
 * shape. A fixed table in a document nobody updates is the one place a rate
 * can go stale without anybody noticing.
 *
 * THIS GUARD IS THE RULE, NOT THE EDIT: no guide prints a commission rate,
 * whatever anybody adds later. The one sentence that replaced the table
 * points at the two places that are always right, which is the only durable
 * answer: the reader's own Commission tab and their monthly statement.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'public/help-docs');
const GUIDES = readdirSync(DIR).filter((f) => f.endsWith('.html'));

/** The prose, with the stylesheet taken out: `width: 50%` is not a rate. */
const prose = (f: string) =>
  readFileSync(join(DIR, f), 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '');

describe('the scan', () => {
  it('found the guides, so a broken scan cannot pass silently', () => {
    expect(GUIDES).toContain('management-guide.html');
    expect(GUIDES).toContain('referrer-guide.html');
    expect(GUIDES).toContain('opndoor-admin-guide.html');
  });
});

describe('no guide prints a commission rate', () => {
  it.each(GUIDES)('%s names no percentage at all', (f) => {
    const found = [...prose(f).matchAll(/\d+(\.\d+)?\s*%/g)].map((m) => m[0]);
    expect(found).toEqual([]);
  });

  /* THE TABLE ITSELF, BY ITS OWN HEADING, so re-adding it in another form
     is still caught. */
  it.each(GUIDES)('%s has no "share of the fee" table', (f) => {
    expect(prose(f).toLowerCase()).not.toContain('share of the fee');
  });
});

describe('what the management guide says instead', () => {
  const MG = prose('management-guide.html');

  it('is Matt’s sentence, pointing at the two places that are always right', () => {
    expect(MG).toContain('Your commission is set out in your agreement and shown on your Commission tab and monthly statement.');
  });

  /* AND THE FEE IS NO LONGER ALWAYS A MONTH, which is the same defect one
     paragraph up: "The guarantor fee is one month's rent per referral" is
     false for every agreement priced in weeks. */
  it('and does not claim the fee is always one month', () => {
    expect(MG).not.toContain("The guarantor fee is <b>one month's rent</b> per referral");
    expect(MG).toContain('usually one month');
  });

  it('and calls it the guarantee fee', () => {
    expect(MG).not.toContain('guarantor fee');
  });
});
