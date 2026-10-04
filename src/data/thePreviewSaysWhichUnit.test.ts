/* THE LINE UNDER THE FIGURE ON THE NEW APPLICATION FORM.
 *
 * Matt, 2026-10-04, item 2 of four: the fee basis unit, "1 month", not
 * "1 weeks".
 *
 * A BAND WRITTEN IN MONTHS KEEPS ITS QUANTITY IN `feeBasisWeeks`. A one-month
 * band is 1, a five-week band is 5, and only the unit tells them apart.
 * `referral_fee_preview` did not return a unit and this label read the
 * quantity alone, so a Kestrel Central referral showed
 *
 *     GBP 2,000.00
 *     1 weeks of rent
 *
 * which is wrong twice: one week of that rent is GBP 461.54, and "1 weeks" is
 * not English. Measured on dev against live data, not a fixture.
 *
 * TESTED AGAINST THE PURE HELPER because the defect is in wording a pair of
 * values, and a rendered test of it would need a session, a branch and a
 * priced agreement to assert one string.
 */
import { describe, expect, it } from 'vitest';
import { feeBasisLabel, type FeePreview } from './feePreview';

const p = (over: Partial<FeePreview>): FeePreview => ({
  feeAmount: 2000, feeBasisWeeks: 4.35, feeBasisUnit: 'weeks',
  isStandard: false, shares: [2000], ...over,
});

describe('the basis under the fee says which unit', () => {
  /* THE DEFECT ITSELF, as the figure that was measured on dev. */
  it('says one month, not one week, for a one-month band', () => {
    expect(feeBasisLabel(p({ feeBasisWeeks: 1, feeBasisUnit: 'months' })))
      .toBe("one month's rent");
  });

  /* ONE WORDING FOR ONE BASIS, which is the ruling the emails, the Stripe
     line and the pay page already keep. A month reached by a band and a month
     reached by standard terms are the same sentence. */
  it('words a one-month band exactly as it words standard terms', () => {
    expect(feeBasisLabel(p({ feeBasisWeeks: 1, feeBasisUnit: 'months' })))
      .toBe(feeBasisLabel(p({ isStandard: true })));
  });

  it('still says weeks when the band is in weeks', () => {
    expect(feeBasisLabel(p({ feeBasisWeeks: 5, feeBasisUnit: 'weeks' })))
      .toBe('5 weeks of rent');
  });

  /* THE GRAMMAR, which was wrong on both units and is why this goes through
     `plural` rather than a hand-rolled 's'. */
  it('says 1 week, never 1 weeks', () => {
    expect(feeBasisLabel(p({ feeBasisWeeks: 1, feeBasisUnit: 'weeks' })))
      .toBe('1 week of rent');
  });

  it('says 2 months of rent for a two-month band', () => {
    expect(feeBasisLabel(p({ feeBasisWeeks: 2, feeBasisUnit: 'months' })))
      .toBe('2 months of rent');
  });

  /* A SHARE OF A BAND IS NOT A BAND. Two decimals is honest about an
     apportioned figure; rounding it would name terms nobody agreed. */
  it('keeps the decimals on an apportioned basis', () => {
    expect(feeBasisLabel(p({ feeBasisWeeks: 3.33, feeBasisUnit: 'weeks' })))
      .toBe('3.33 weeks of rent');
  });

  /* STANDARD TERMS SHORT-CIRCUIT, whatever the unit says, because a standard
     agreement is one month's rent exactly and never recomputed from its
     quantity. Its stored pair reads (4.35, 'months'), which is the one place
     the two columns genuinely disagree. */
  it('says one month for standard terms whatever the stored pair is', () => {
    expect(feeBasisLabel(p({ isStandard: true, feeBasisWeeks: 4.35, feeBasisUnit: 'months' })))
      .toBe("one month's rent");
  });
});
