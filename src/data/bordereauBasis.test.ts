/* The bordereau is 13.5% of ONE MONTH'S RENT per deed, whatever the party pays.

   M4 lets an agency negotiate a 3- or 5-week fee basis, so fee_amount and
   monthly_rent stop being the same number. The underwriter's premium must not
   follow the fee: it is a statement about the risk, not about our pricing.

   And each tenant of a joint tenancy signs their own deed over their own share,
   so "per deed" now means per tenant. The premium follows what each deed
   guarantees, and the shares sum to the rent exactly, so the underwriter is
   billed the same money as before, itemised per risk. */
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

/** One applicant of a joint tenancy: their own deed, over their own share. */
const joint = (ref: string, tenancyId: string, feeShare: number, shareAmount: number): FullApp => ({
  ...app(feeShare), ref, tenancyId, shareAmount,
} as unknown as FullApp);

/* ONE ROW PER DEED, AND EACH ROW IS A SHARE.

   This suite previously asserted the opposite — one row per TENANCY, on the
   whole rent — and it was right while one deed covered the whole let. Each
   tenant now signs their own deed guaranteeing their own share, so each is a
   separate risk the underwriter carries and a separate row.

   The reason the change is safe is the second assertion here: the shares are
   apportioned to the penny, so a tenancy's rows sum to exactly what its single
   row used to be. The underwriter is billed the same money, itemised. */
describe('bordereau is one row per deed', () => {
  const pair = () => [
    joint('GR-J-1', 'ten-1', 1153.85, 1000),
    joint('GR-J-2', 'ten-1', 1153.84, 1000),
  ];

  it('emits one row PER TENANT of a joint tenancy, because each holds a deed', () => {
    hydrateFull(pair());
    const { rows, issued } = buildLiveBordereau(2026, 5, 13.5);
    expect(issued).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it('charges each row 13.5% of one month of THAT tenant’s share', () => {
    hydrateFull(pair());
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    // Columns: ... rent-covered, insurance, 'On Cover'
    expect(rows.map((r) => r[r.length - 3])).toEqual([1000, 1000]);
    expect(rows.map((r) => r[r.length - 2])).toEqual([135, 135]);
  });

  it('and the tenancy’s rows sum to 13.5% of one month of the FULL rent', () => {
    hydrateFull(pair());
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    const premiums = rows.reduce((t, r) => t + Number(r[r.length - 2]), 0);
    const covered = rows.reduce((t, r) => t + Number(r[r.length - 3]), 0);
    expect(covered).toBe(RENT);
    // Exactly what the single tenancy row used to be billed.
    expect(premiums).toBe(270);
  });

  it('holds on a tenancy whose shares do not divide evenly', () => {
    // £1,750 three ways used to round to £1,750.01 of shares; apportion fixes it
    // at source, so the bordereau foots. These are the apportioned values.
    hydrateFull([
      joint('GR-T-1', 'ten-2', 100, 583.45),
      joint('GR-T-2', 'ten-2', 100, 583.28),
      joint('GR-T-3', 'ten-2', 100, 583.27),
    ]);
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    const covered = rows.reduce((t, r) => t + Number(r[r.length - 3]), 0);
    expect(Math.round(covered * 100) / 100).toBe(1750);
  });

  it('still emits one row per single-tenant application, on the whole rent', () => {
    hydrateFull([
      { ...app(RENT), ref: 'GR-S-1' } as unknown as FullApp,
      { ...app(RENT), ref: 'GR-S-2' } as unknown as FullApp,
    ]);
    const { rows, issued } = buildLiveBordereau(2026, 5, 13.5);
    expect(issued).toBe(2);
    // No share, so the whole rent is covered and the premium is unchanged.
    expect(rows.map((r) => r[r.length - 2])).toEqual([270, 270]);
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
