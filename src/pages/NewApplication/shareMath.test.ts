/* The share arithmetic. Locked because both values are stored, so a disagreement
   between them is a disagreement in the record rather than on the screen. */
import { describe, expect, it } from 'vitest';
import {
  amountFromPercent, percentFromAmount, DEFAULT_SHARE_PERCENT,
  duplicateEmailIndex, equalSharePercents, shareSumError, shareTotal,
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
