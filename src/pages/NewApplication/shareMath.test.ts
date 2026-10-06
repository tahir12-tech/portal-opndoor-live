/* The share arithmetic. Locked because both values are stored, so a disagreement
   between them is a disagreement in the record rather than on the screen. */
import { describe, expect, it } from 'vitest';
import {
  amountFromPercent, percentFromAmount, DEFAULT_SHARE_PERCENT,
  duplicateEmailIndex, equalSharePercents, rebalanceShares, shareSumError, shareTotal,
} from './shareMath';

describe('share of the rent', () => {
  it('defaults to the whole rent, because one applicant is the common case', () => {
    expect(DEFAULT_SHARE_PERCENT).toBe(100);
    expect(amountFromPercent(1450, 100)).toBe(1450);
  });

  it('derives each direction and round-trips', () => {
    expect(amountFromPercent(1450, 40)).toBe(580);
    expect(percentFromAmount(1450, 580)).toBe(40);
  });

  it('rounds money to pence rather than leaking thirds', () => {
    // A third of 1000 is 333.333..., which must not reach a money column.
    expect(amountFromPercent(1000, 33.333)).toBe(333.33);
  });

  it('treats a zero share as real, not as missing', () => {
    // The case the joint-tenancy group rule exists for: one applicant carries
    // the rent and another carries nothing.
    expect(amountFromPercent(1450, 0)).toBe(0);
  });

  it('has no percentage for a zero rent rather than an infinite one', () => {
    // Reachable: the rent field is empty while somebody is still typing.
    expect(percentFromAmount(0, 100)).toBeNull();
  });

  it('refuses a share larger than the whole rent', () => {
    expect(amountFromPercent(1450, 101)).toBeNull();
  });

  it('rejects nonsense rather than producing it', () => {
    expect(amountFromPercent(NaN, 40)).toBeNull();
    expect(amountFromPercent(1450, -1)).toBeNull();
    expect(percentFromAmount(1450, -1)).toBeNull();
  });
});

describe('equal shares, when a tenant is added', () => {
  it('splits two ways exactly', () => {
    expect(equalSharePercents(2)).toEqual([50, 50]);
  });

  it('gives the last tenant the rounding so three thirds still make a whole', () => {
    // 33.333 x 3 is 99.999, which would open the form on a validation error
    // nobody caused.
    expect(equalSharePercents(3)).toEqual([33.333, 33.333, 33.334]);
    expect(shareTotal(equalSharePercents(3))).toBe(100);
  });

  it('holds for awkward counts too', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13]) {
      expect(shareTotal(equalSharePercents(n))).toBe(100);
    }
  });

  it('is the whole rent for one tenant', () => {
    expect(equalSharePercents(1)).toEqual([100]);
  });
});

describe('the shares must describe the whole tenancy', () => {
  it('accepts a sum of 100', () => {
    expect(shareSumError([60, 40])).toBeNull();
    expect(shareSumError([33.333, 33.333, 33.334])).toBeNull();
  });

  it('names the gap rather than restating the rule', () => {
    expect(shareSumError([50, 30])).toBe('The shares total 80%. Add 20% more.');
    expect(shareSumError([60, 60])).toBe('The shares total 120%. Take off 20%.');
  });

  it('forgives a rounding penny', () => {
    expect(shareSumError([50, 49.995])).toBeNull();
  });
});

describe('no applicant twice', () => {
  it('finds the repeat, case and whitespace insensitively', () => {
    expect(duplicateEmailIndex(['a@b.com', 'c@d.com'])).toBe(-1);
    expect(duplicateEmailIndex(['a@b.com', ' A@B.com '])).toBe(1);
    expect(duplicateEmailIndex(['a@b.com', 'c@d.com', 'a@b.com'])).toBe(2);
  });

  it('ignores the blanks on a half-typed form', () => {
    expect(duplicateEmailIndex(['', '', 'a@b.com'])).toBe(-1);
  });
});

/* AUTO-BALANCE: editing one share spreads what is left over the untouched ones.

   An agent typing 60 into the first of three means "and split the rest between
   the other two". Re-spreading across ALL of them would overwrite the 60 that
   was just typed; spreading across none would leave the form invalid until every
   box had been filled by hand. Untouched-only is the reading that matches what
   the typing means, and it is the only one of the three that is not obviously
   wrong, which is why the rule is worth pinning. */
describe('auto-balancing the shares', () => {
  const none = new Set<number>();

  it('splits the remainder over the two nobody has touched', () => {
    expect(rebalanceShares([33.333, 33.333, 33.334], 0, 60, none)).toEqual([60, 20, 20]);
  });

  it('leaves a share already typed by hand alone', () => {
    // 60 was typed, then 30 into the second: only the third absorbs the rest.
    expect(rebalanceShares([60, 20, 20], 1, 30, new Set([0]))).toEqual([60, 30, 10]);
  });

  /* AND IT STOPS. With every share set by hand there is nobody left to absorb
     the remainder, so the numbers stand exactly as typed and shareSumError is
     what tells the agent the total is wrong. Silently moving a figure somebody
     deliberately set would be worse than the error. */
  it('stops once every share has been edited', () => {
    const out = rebalanceShares([60, 30, 10], 2, 25, new Set([0, 1]));
    expect(out).toEqual([60, 30, 25]);
    expect(shareTotal(out)).toBe(115);
    expect(shareSumError(out)).not.toBeNull();
  });

  it('still balances a two-tenant split, which is the common case', () => {
    expect(rebalanceShares([50, 50], 0, 46, none)).toEqual([46, 54]);
  });

  /* THE LAST UNTOUCHED SHARE TAKES THE ROUNDING, as apportion does on the fee and
     the rent, so a remainder that does not divide evenly still sums to exactly
     100 rather than to 99.999. */
  it('sums to exactly 100 when the remainder does not divide evenly', () => {
    const out = rebalanceShares([25, 25, 25, 25], 0, 10, none);
    expect(shareTotal(out)).toBe(100);
    expect(out[0]).toBe(10);
  });

  it('holds for three untouched tenants sharing an awkward remainder', () => {
    const out = rebalanceShares([25, 25, 25, 25], 0, 1, none);
    expect(shareTotal(out)).toBe(100);
  });

  /* A share typed over 100 leaves a negative remainder. Showing the others as
     negative percentages would be nonsense; they go to zero and shareSumError
     names the overshoot. */
  it('does not produce negative shares when one is typed over 100', () => {
    const out = rebalanceShares([50, 50], 0, 120, none);
    expect(out[1]).toBe(0);
    expect(out.every((n) => n >= 0)).toBe(true);
    expect(shareSumError(out)).not.toBeNull();
  });

  it('ignores an index that is not there rather than growing the array', () => {
    expect(rebalanceShares([50, 50], 5, 10, none)).toEqual([50, 50]);
  });
});
