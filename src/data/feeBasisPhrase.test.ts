/* THE FEE BASIS IS READ, NOT RECOVERED FROM THE MONEY.
 *
 * Matt, 2026-10-12, two findings that are one fault:
 *   "Reporting's Net fees caption says 'one month's rent each'. Wrong for
 *    Regent and Brithive. Make it true for any fee basis."
 *   "The payment panel showed '£1.16 · 5.03 weeks of rent' on a £2 rent joint
 *    test with a 5-week deal. Show the agreed weeks, not a figure
 *    back-calculated from the rounded pence."
 *
 * His exact figures are the first test, because they are the proof that the
 * old arithmetic was arithmetic and not a wrong number.
 */
import { describe, expect, it } from 'vitest';
import { agreedBasisPhrase, basisFromMoney, WEEKS_IN_A_MONTH } from './feeBasisPhrase';
import { feeLabels } from './applicationsService';

describe('Matt’s £2 joint test', () => {
  /* £2 rent, five-week deal, two tenants at 50%. The tenancy fee is
     2 * 12/52 * 5 = 2.3077, to the penny 2.31, and a half share is 1.16 after
     apportionment. (1.16 * 52) / (1.00 * 12) = 5.0267. */
  it('read 5.03 weeks from the money, which is what he saw', () => {
    expect(basisFromMoney(1.16, 1.0)).toBe('5.03 weeks of rent');
  });

  it('and reads the agreed five weeks from the snapshot', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 5, feeBasisUnit: 'weeks' })).toBe('5 weeks of rent');
  });

  /* THE WHOLE PANEL LINE, through the function the screen calls, with the
     share suffix the agency wording already carried. */
  it('so the payment panel says the agreed weeks and this tenant’s share', () => {
    expect(feeLabels({ rent: 2, fee: 1.16, sharePercent: 50, feeBasisWeeks: 5, feeBasisUnit: 'weeks' }))
      .toEqual({ feeGBP: '£1.16', feeBasisLabel: "5 weeks of rent (this tenant's 50% share)" });
  });

  /* AND WITHOUT A SNAPSHOT IT STILL SAYS SOMETHING, because rows written
     before the columns existed are still on the books. This is the old
     behaviour, kept deliberately as the fallback. */
  it('and falls back to the old arithmetic where there is no snapshot', () => {
    expect(feeLabels({ rent: 2, fee: 1.16, sharePercent: 50 }).feeBasisLabel)
      .toBe("5.03 weeks of rent (this tenant's 50% share)");
  });
});

describe('the agreed basis as a phrase', () => {
  it('says one month’s rent for standard terms, which is stored as 4.35', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 4.35 })).toBe("one month's rent");
    expect(Math.abs(4.35 - WEEKS_IN_A_MONTH)).toBeLessThan(0.02);
  });

  it('and for a band written as one month', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 1, feeBasisUnit: 'months' })).toBe("one month's rent");
  });

  /* A BAND IN MONTHS KEEPS ITS QUANTITY IN THE WEEKS COLUMN, so without the
     unit a two-month deal would read "2 weeks of rent" -- a quarter of the
     fee, in the one direction a tenant would not query. */
  it('and says months where the unit is months', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 2, feeBasisUnit: 'months' })).toBe('2 months of rent');
  });

  it('reads an absent unit as weeks, which is every row before 20261008000000', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 3 })).toBe('3 weeks of rent');
    expect(agreedBasisPhrase({ feeBasisWeeks: 3, feeBasisUnit: null })).toBe('3 weeks of rent');
  });

  it('says "week" for one of them, because that is English', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 1, feeBasisUnit: 'weeks' })).toBe('1 week of rent');
  });

  it('drops a trailing zero, because a basis is a number people say out loud', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 5.0 })).toBe('5 weeks of rent');
    expect(agreedBasisPhrase({ feeBasisWeeks: 3.5 })).toBe('3.5 weeks of rent');
  });

  /* NULL IS A REAL ANSWER and the caller must fall back rather than print
     "0 weeks of rent" or an empty clause. */
  it.each([[null], [undefined], [0], [-1]])('answers nothing for %s', (q) => {
    expect(agreedBasisPhrase({ feeBasisWeeks: q as never })).toBeNull();
  });
});

describe('Regent and Brithive, which is what item 5 was about', () => {
  /* REGENT: 1 tenant 3 weeks, 2 or more 5 weeks. BRITHIVE: a supplier on its
     own deal. Neither is one month's rent, and the caption said it was. */
  it('names three weeks and five weeks, not one month', () => {
    expect(agreedBasisPhrase({ feeBasisWeeks: 3 })).toBe('3 weeks of rent');
    expect(agreedBasisPhrase({ feeBasisWeeks: 5 })).toBe('5 weeks of rent');
    expect(agreedBasisPhrase({ feeBasisWeeks: 3 })).not.toContain('month');
    expect(agreedBasisPhrase({ feeBasisWeeks: 5 })).not.toContain('month');
  });

  /* AND TWO ROWS ON ONE DEAL AGREE BY CONSTRUCTION, which the quotient could
     not promise: two rents that round differently gave two quotients and the
     caption then read as a mixed book. */
  it('gives one phrase for two rows on the same deal whatever their rents', () => {
    const said = [1200, 1333.33, 2.0].map((rent) =>
      agreedBasisPhrase({ feeBasisWeeks: 5, feeBasisUnit: 'weeks' }) ?? basisFromMoney(rent, rent));
    expect(new Set(said).size).toBe(1);
    expect(said[0]).toBe('5 weeks of rent');
  });
});
