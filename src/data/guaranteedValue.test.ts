/* A TENANCY'S DEEDS GUARANTEE THE TENANCY'S RENT, NOT A MULTIPLE OF IT.

   Reported from the walk on GR-20846, a £2,000 tenancy split 46/54: the tenant's own
   page showed "Guaranteed annual rent £24,000" against a deed covering their share,
   which is £920 a month and £11,040 a year.

   Every surface that stated or summed this used `rent * 12`, and rent is the whole
   tenancy's. So each of a tenancy's deeds claimed the whole rent, and any total over
   them counted it once per deed: £48,000 of guaranteed value on a £2,000 tenancy.
   That is not a display quirk. It is the number in "Total guaranteed rent value" on
   the dashboard, in the export key-values and in the expiry bordereau, and it
   overstated the book by the joint share of it.

   THE INVARIANT is what makes the figure checkable, and it is the reason to prefer
   the share to the whole: the shares sum to the rent, so the deeds sum to twelve
   months of it, exactly. £11,040 + £12,960 = £24,000. A test of one deed in
   isolation cannot catch the double count; a test of the sum can only pass when
   every deed carries its own share. */
import { describe, expect, it } from 'vitest';
import { guaranteedAnnual } from './applicationsService';

/** GR-20846 and its co-tenant GR-20845, as they are on dev. */
const TENANCY_RENT = 2000;
const JOINT = [
  { ref: 'GR-20846', rent: TENANCY_RENT, shareAmount: 920 },   // 46%
  { ref: 'GR-20845', rent: TENANCY_RENT, shareAmount: 1080 },  // 54%
];

describe('one deed', () => {
  it('guarantees twelve months of the share it covers', () => {
    expect(guaranteedAnnual(JOINT[0])).toBe(11040);
    expect(guaranteedAnnual(JOINT[1])).toBe(12960);
  });

  it('guarantees twelve months of the rent on a sole tenancy', () => {
    // No share recorded means the deed covers the whole rent, which is the common case.
    expect(guaranteedAnnual({ rent: 1000, shareAmount: null })).toBe(12000);
    expect(guaranteedAnnual({ rent: 1000 })).toBe(12000);
  });

  /* A zero or absent share is "no share was agreed", not "this deed guarantees
     nothing". Reading it as nothing would silently drop a deed out of every total. */
  it('falls back to the whole rent rather than guaranteeing nothing', () => {
    expect(guaranteedAnnual({ rent: 1000, shareAmount: 0 })).toBe(12000);
  });
});

describe('a tenancy, summed', () => {
  /* THE ASSERTION THAT CATCHES THE DEFECT. Against `rent * 12` this sums to 48000. */
  it('sums to twelve months of the tenancy rent, exactly', () => {
    const total = JOINT.reduce((n, a) => n + guaranteedAnnual(a), 0);
    expect(total).toBe(TENANCY_RENT * 12);
    expect(total).toBe(24000);
  });

  it('does not double count, which is what it used to do', () => {
    const total = JOINT.reduce((n, a) => n + guaranteedAnnual(a), 0);
    const doubled = JOINT.reduce((n, a) => n + a.rent * 12, 0);
    expect(doubled).toBe(48000);
    expect(total).not.toBe(doubled);
  });

  /* THREE WAYS, AND TO THE PENNY. apportion() splits to the penny with the last
     share taking the rounding, so a tenancy that does not divide evenly still sums
     to the rent. Re-deriving a share from a rounded percentage would not: 33.333% of
     £1,750 three times is £1,749.98. This is why guaranteedAnnual reads the frozen
     share AMOUNT and never the percentage. */
  it('holds for a three-way split that does not divide evenly', () => {
    const rent = 1750;
    const thirds = [583.34, 583.33, 583.33].map((shareAmount) => ({ rent, shareAmount }));
    const total = thirds.reduce((n, a) => n + guaranteedAnnual(a), 0);
    expect(Number(total.toFixed(2))).toBe(rent * 12);
  });

  it('holds for a sole tenancy, which is a tenancy of one deed', () => {
    expect(guaranteedAnnual({ rent: 1750, shareAmount: null })).toBe(1750 * 12);
  });
});
