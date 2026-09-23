/* The additive rule, pinned to the same four worked examples the migration
   states. This mirror draws the agency page; commission_split() in SQL is what
   actually freezes onto an application, so these two must not drift. */
import { describe, expect, it } from 'vitest';
import { splitLines, splitTotal, payoutSentence } from './commissionModel';

const base = {
  standard: 0.10,
  branchName: 'Northgate Central',
  agencyName: 'Northgate Lettings',
  groupName: 'Meridian Property Group',
};

describe('additive commission: the four worked examples', () => {
  it('nothing set -> the agency earns the Opndoor standard, alone', () => {
    const i = { ...base, groupName: null };
    expect(splitLines(i)).toEqual([
      { level: 'agency', orgId: null, orgName: 'Northgate Lettings', rate: 0.10 },
    ]);
    expect(splitTotal(i)).toBeCloseTo(0.10, 10);
  });

  it('group 2% only -> agency 10% + group 2% = 12%', () => {
    const i = { ...base, groupRate: 0.02 };
    expect(splitLines(i).map((l) => [l.level, l.rate])).toEqual([
      ['agency', 0.10], ['group', 0.02],
    ]);
    expect(splitTotal(i)).toBeCloseTo(0.12, 10);
  });

  it('branch 10% + group 2% -> the agency drops out entirely', () => {
    const i = { ...base, branchRate: 0.10, groupRate: 0.02 };
    expect(splitLines(i).map((l) => l.level)).toEqual(['branch', 'group']);
    expect(splitTotal(i)).toBeCloseTo(0.12, 10);
  });

  it('agency 12% + group 2% -> 14%, and a branch rate never displaces an explicit agency rate', () => {
    const i = { ...base, agencyRate: 0.12, groupRate: 0.02 };
    expect(splitTotal(i)).toBeCloseTo(0.14, 10);
    // adding a branch rate ADDS, it does not replace an explicit agency rate
    expect(splitTotal({ ...i, branchRate: 0.01 })).toBeCloseTo(0.15, 10);
  });
});

describe('the branch payout sentence', () => {
  it('reads as one plain line for the single-payee case', () => {
    expect(payoutSentence({ ...base, agencyRate: 0.12, groupName: null }))
      .toBe('A referral here pays out: Northgate Lettings 12% = 12% of the fee');
  });

  it('sums the multi-payee case in the order it is paid', () => {
    expect(payoutSentence({ ...base, agencyRate: 0.12, groupRate: 0.02 }))
      .toBe('A referral here pays out: Northgate Lettings 12% + Meridian Property Group 2% = 14% of the fee');
  });
});
