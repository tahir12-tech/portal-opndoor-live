/* =====================================================================
   (v) A DEAL THAT CHARGES DIFFERENTLY AT TWO TENANTS SAYS SO.

   Matt (v): "'What each branch pays out' must show every band of a
   deal that varies by tenant count, e.g. '20% (1 tenant), 25% (2 or
   more)', not just the one-tenant rate."

   The payout TABLE was fixed and `bandSentence` written for it, with
   no test of its own. The BRANCH CARD line -- the same payees, drawn
   in one sentence higher up the same page, and the one a reader sees
   first -- was never changed, so a banded deal still printed a single
   rate there.

   THE TOTAL IS THE HALF THAT INVENTS A FIGURE. `payoutSentence` ends
   "= 45% of the fee", summed from each line's `rate`. On a banded
   deal that `rate` is the one-tenant band, so the sum is a number
   nobody is owed, printed as though it were the whole. Where any
   payee is banded the sentence now stops at the parts.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bandSentence } from './orgService';

const pct = (r: number) => `${r}%`;

describe('the bands as a sentence', () => {
  /* MATT'S OWN EXAMPLE, to the character. */
  it('is his wording for a deal that changes at two tenants', () => {
    expect(bandSentence([{ from: 1, to: 1, rate: 20 }, { from: 2, to: null, rate: 25 }], pct))
      .toBe('20% (1 tenant), 25% (2 or more)');
  });

  it('names a closed middle band by its range', () => {
    expect(bandSentence(
      [{ from: 1, to: 5, rate: 10 }, { from: 6, to: 10, rate: 15 }, { from: 11, to: null, rate: 24 }], pct,
    )).toBe('10% (1 to 5 tenants), 15% (6 to 10 tenants), 24% (11 or more)');
  });

  /* NULL, NOT "25% (1 OR MORE)". A flat deal rendered as a band would
     make every ordinary agency look banded, which is why the caller
     falls back to the plain rate rather than this string. */
  it.each([[null], [undefined], [[{ from: 1, to: null, rate: 25 }]]])('says nothing for a flat deal: %s', (b) => {
    expect(bandSentence(b as never, pct)).toBeNull();
  });
});

describe('the branch card draws the same bands as the table', () => {
  const src = readFileSync(join(process.cwd(), 'src/pages/Agencies/AgencyHome.tsx'), 'utf8');

  it('reads the bands in the one-line payout, not only in the table', () => {
    expect(src).toContain('${l.orgName} ${bandSentence(l.bands, pctLabel) ?? pctLabel(l.rate)} (${SOURCE_CAPTION[l.source]})');
  });

  /* THE SUM IS DROPPED, NOT RECOMPUTED. There is no honest single
     total for a split where one payee's share depends on the tenant
     count, so the line must not print one. */
  it('and drops the total rather than adding up one band of each', () => {
    expect(src).toContain("if (lines.some((l) => bandSentence(l.bands, pctLabel))) return `Pays out: ${parts.join(' + ')}`;");
  });

  /* THREE PLACES DRAW THE PAYEES: the table's sole-payee cell, the
     table's additive list, and the branch card line added above.
     Counted so a later edit cannot quietly drop one of them. */
  it('and the payout table still shows them in both its shapes', () => {
    expect(src.match(/bandSentence\((soleLine|l)\.bands, pctLabel\) \?\? pctLabel\(\1\.rate\)/g)?.length ?? 0).toBe(3);
  });
});
