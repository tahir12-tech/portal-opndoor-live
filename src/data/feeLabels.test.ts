/* What the tenant is TOLD they are paying.

   The fee and the rent were the same number for as long as every referral was
   one month's rent, so several screens print the rent under the words
   "guarantor fee". They are not the same number for an agency on a negotiated
   basis — three weeks is 0.69 of a month — nor for one tenant of a joint
   tenancy, who pays a share of even that.

   Being shown £2,400 and charged £1,661.54 is not a display bug. It is a
   misstatement of price to a consumer, on the page where they hand over a card. */
import { describe, expect, it } from 'vitest';
import { getApplicationDetail, hydrateApplications } from './applicationsService';
import { APPLICATION_RECORDS, APPLICATIONS_LIST } from './mock/applications';
import type { ApplicationSummary } from './types';

/** Rebuild the working copies with one summary row's fee overridden. */
function withFee(ref: string, fee: number | null, sharePercent?: number) {
  const list: ApplicationSummary[] = APPLICATIONS_LIST.map((r) =>
    r.ref === ref ? { ...r, fee, ...(sharePercent != null ? { sharePercent } : {}) } : { ...r });
  const records = APPLICATION_RECORDS.map((r) =>
    r.ref === ref && sharePercent != null ? { ...r, sharePercent } : { ...r });
  hydrateApplications(list, records);
  return getApplicationDetail(ref);
}

const REF = 'GR-20418';          // Amelia Hartley, £2,450/month
const RENT = 2450;

describe('the guarantor fee is stated as the fee, not the rent', () => {
  it('says one month’s rent when that is what it is', () => {
    const d = withFee(REF, RENT);
    expect(d.feeGBP).toBe('£2,450.00');
    expect(d.feeBasisLabel).toBe("one month's rent");
  });

  it('states three weeks as three weeks, not as a month', () => {
    // Regent's single-tenant deal on a £2,450 rent: 2450 x 12 / 52 x 3.
    const threeWeeks = Math.round((RENT * 12 / 52) * 3 * 100) / 100;
    const d = withFee(REF, threeWeeks);
    expect(d.feeGBP).toBe('£1,696.15');
    expect(d.feeBasisLabel).toBe('3 weeks of rent');
    // The thing that must never happen again:
    expect(d.feeGBP).not.toBe(d.rent);
  });

  it('names the share when one tenant of a tenancy is paying part of it', () => {
    const fiveWeeks = Math.round((RENT * 12 / 52) * 5 * 100) / 100;
    const d = withFee(REF, Math.round(fiveWeeks / 2 * 100) / 100, 50);
    expect(d.feeBasisLabel).toMatch(/weeks of rent \(this tenant's 50% share\)/);
  });

  it('falls back to the rent, silently, on a row that never carried a fee', () => {
    // Every application created before the fee was snapshotted. The rent IS the
    // honest answer there, and the label is simply absent rather than guessed.
    const d = withFee(REF, null);
    expect(d.feeGBP).toBeUndefined();
    expect(d.feeBasisLabel).toBeUndefined();
    /* TO THE PENNY SINCE 2026-10-03. `rent` was `£${n.toLocaleString()}`,
       which has no minimum fraction digits, so £2,450.00 printed as
       £2,450 and £23,030.40 as £23,030.4 -- the figure on GR-23853 that
       Matt reported. The fallback itself is unchanged: this row still
       shows the rent because it carries no fee. */
    expect(d.rent).toBe('£2,450.00');
  });
});
