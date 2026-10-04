/* THE DEAL DIALOG PRINTS A DATE A PERSON WOULD WRITE.
 *
 * Matt (w): "Agency deal dialog: dates as '23 Sep 2026', not '2026-09-23';
 * 'number of tenants' and 'number of referrals' in normal case, not
 * capitals."
 *
 * THE CAPITALS HALF WAS DONE; THE DATE HALF WAS NOT, and the reason it
 * survived is that it never looked like a formatting decision: `periodStart`
 * is `effective_from` straight off the row, rendered with no formatter at
 * all, so the dialog printed the database's own spelling at the reader.
 *
 * AND THE FORMATTER MATTERS MORE THAN THE SHAPE HERE. `new Date('2026-10-01')`
 * is midnight UTC, which is 30 September once the clocks go back -- so the
 * obvious fix would have made a deal appear to start the day before it did,
 * for four months of the year. formatDate takes a bare YYYY-MM-DD apart
 * rather than parsing it, which is why it is the one to use.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatDate } from '@/lib/format';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('the agreement dialog', () => {
  it('formats the agreed date rather than printing the stored one', () => {
    const src = read('src/pages/Agencies/AgreementEditor.tsx');
    expect(src).toContain('formatDate(live.periodStart)');
    // The raw field is no longer rendered on its own anywhere in the file.
    expect(src).not.toContain('<b>{live.periodStart ??');
  });

  it('and that formatter gives Matt\'s shape', () => {
    expect(formatDate('2026-09-23')).toBe('23 Sep 2026');
  });

  /* THE BST BOUNDARY, which is the reason for this formatter rather than
     `new Date(...)`: 1 October parsed as an instant is 30 September in
     London once the clocks have gone back. */
  it('without moving the date across a timezone', () => {
    expect(formatDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatDate('2026-11-01')).toBe('1 Nov 2026');
  });
});

describe('and the deal form keeps normal case', () => {
  /* ALREADY TRUE, and asserted so it stays that way: this is the half of
     (w) that was done, and the two halves live in different files. */
  it('says "number of tenants", not "Number of tenants"', () => {
    const src = read('src/pages/PartnerManagement/AgencyPercentEditor.tsx');
    expect(src).toContain('number of tenants');
    expect(src).not.toContain('Number of tenants');
  });
});
