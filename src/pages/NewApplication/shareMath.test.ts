/* The share arithmetic. Locked because both values are stored, so a disagreement
   between them is a disagreement in the record rather than on the screen. */
import { describe, expect, it } from 'vitest';
import { amountFromPercent, percentFromAmount, shareWarning, DEFAULT_SHARE_PERCENT } from './shareMath';

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
    expect(shareWarning(1450, 0, 0)).toContain('zero share is allowed');
  });

  it('has no percentage for a zero rent rather than an infinite one', () => {
    // Reachable: the rent field is empty while somebody is still typing.
    expect(percentFromAmount(0, 100)).toBeNull();
  });

  it('refuses a share larger than the whole rent', () => {
    expect(amountFromPercent(1450, 101)).toBeNull();
    expect(shareWarning(1450, 101, 1500)).toContain('cannot be more than');
  });

  it('warns when the two disagree by more than rounding', () => {
    expect(shareWarning(1450, 40, 580)).toBeNull();          // agrees
    expect(shareWarning(1450, 40, 580.01)).toBeNull();       // a penny is arithmetic
    expect(shareWarning(1450, 40, 700)).toContain('do not agree');
  });

  it('rejects nonsense rather than producing it', () => {
    expect(amountFromPercent(NaN, 40)).toBeNull();
    expect(amountFromPercent(1450, -1)).toBeNull();
    expect(percentFromAmount(1450, -1)).toBeNull();
  });
});
