/* The bordereau is 13.5% of ONE MONTH'S RENT per deed, whatever the party pays.

   M4 lets an agency negotiate a 3- or 5-week fee basis, so fee_amount and
   monthly_rent stop being the same number. The underwriter's premium must not
   follow the fee: it is a statement about the tenancy, not about our pricing. */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { hydrateFull } from './applicationsService';
import { buildLiveBordereau } from './exportsService';
import type { FullApp } from './applicationsService';

const RENT = 2000;
const start = new Date(2026, 5, 10);

/** One deed-issued application whose FEE deliberately differs from its rent. */
const app = (fee: number): FullApp => ({
  ref: 'GR-BORD-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings', branch: "Regent's Park",
  rent: RENT, fee, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', refunded: false, tenancyStart: start, deedAt: start, expiry: null,
} as unknown as FullApp);

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

/** Two applicants on ONE tenancy: one deed, so one bordereau row. */
const joint = (ref: string, tenancyId: string, feeShare: number): FullApp => ({
  ...app(feeShare), ref, tenancyId,
} as unknown as FullApp);

describe('bordereau is one row per deed', () => {
  it('emits ONE row for a joint tenancy, not one per applicant', () => {
    hydrateFull([joint('GR-J-1', 'ten-1', 1153.85), joint('GR-J-2', 'ten-1', 1153.84)]);
    const { rows, issued } = buildLiveBordereau(2026, 5, 13.5);
    expect(issued).toBe(1);
    expect(rows).toHaveLength(1);
    // ...and that one row is 13.5% of the WHOLE tenancy rent, charged once.
    expect(rows[0][rows[0].length - 2]).toBe(270);
  });

  it('still emits one row per single-tenant application', () => {
    hydrateFull([
      { ...app(RENT), ref: 'GR-S-1' } as unknown as FullApp,
      { ...app(RENT), ref: 'GR-S-2' } as unknown as FullApp,
    ]);
    expect(buildLiveBordereau(2026, 5, 13.5).issued).toBe(2);
  });
});

describe('bordereau premium basis', () => {
  it('is 13.5% of the RENT when the fee equals the rent', () => {
    hydrateFull([app(RENT)]);
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    expect(rows).toHaveLength(1);
    // Columns: ... rent, insurance, 'On Cover'
    expect(rows[0][rows[0].length - 3]).toBe(RENT);
    expect(rows[0][rows[0].length - 2]).toBe(270); // 2000 * 0.135
  });

  it('is STILL 13.5% of the rent when the party is on a 3-week negotiated fee', () => {
    // 3 weeks of a £2,000 rent is £1,384.62 — the premium must ignore it entirely.
    hydrateFull([app(1384.62)]);
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    expect(rows[0][rows[0].length - 3]).toBe(RENT);
    expect(rows[0][rows[0].length - 2]).toBe(270);
  });

  it('is STILL 13.5% of the rent when the party is on a 5-week negotiated fee', () => {
    hydrateFull([app(2307.69)]);
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    expect(rows[0][rows[0].length - 2]).toBe(270);
  });
});
