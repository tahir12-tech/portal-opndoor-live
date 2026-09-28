/* The one shared rule that turns an application into commission lines.

   The ruling: application_commission_lines is authoritative; a historic row with
   no lines falls back to the scalar, attributed to the referring agency; and no
   surface implements that fallback itself. These pin the rule so a fifth surface
   cannot quietly grow a sixth interpretation of it. */
import { describe, expect, it } from 'vitest';
import { linesFor, payeesFor, totalRate, payeeKey, PayeeTotals } from './commissionSplit';
import type { FullApp } from './applicationsService';

/** Only the fields the split rule reads; the rest of FullApp is irrelevant here. */
const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-1', agency: 'Northgate Lettings', branch: 'Northgate Central',
  rent: 1000, agentRate: 0.1, partnerRate: 0.25,
  ...over,
} as FullApp);

describe('commission split: the shared fallback rule', () => {
  it('a historic row with no lines becomes ONE agency line at the scalar rate', () => {
    const a = app({ commissionLines: undefined, agentRate: 0.1, agency: 'Southbank Residential' });
    expect(linesFor(a)).toEqual([
      { level: 'agency', orgId: null, orgName: 'Southbank Residential', rate: 0.1 },
    ]);
    expect(totalRate(a)).toBe(0.1);
    expect(payeesFor(a, 2000)[0].amount).toBe(200);
  });

  it('an empty lines array is treated as historic, not as "earns nothing"', () => {
    // An application that earned something must never resolve to no payee: that
    // would silently drop money out of settlement.
    const a = app({ commissionLines: [], agentRate: 0.08 });
    expect(linesFor(a)).toHaveLength(1);
    expect(totalRate(a)).toBe(0.08);
  });

  it('a frozen split is used verbatim and is authoritative over the scalar', () => {
    const a = app({
      agentRate: 0.99, // deliberately wrong: the lines win
      commissionLines: [
        { level: 'agency', orgId: 'ag-1', orgName: 'Northgate Lettings', rate: 0.12 },
        { level: 'group', orgId: 'gr-1', orgName: 'Meridian Property Group', rate: 0.02 },
      ],
    });
    expect(totalRate(a)).toBeCloseTo(0.14, 10);
    const payees = payeesFor(a, 1500);
    expect(payees.map((p) => [p.orgName, p.amount])).toEqual([
      ['Northgate Lettings', 180],
      ['Meridian Property Group', 30],
    ]);
  });

  it('a branch line and an agency line of the same name never merge', () => {
    expect(payeeKey('agency', null, 'Kestrel')).not.toBe(payeeKey('branch', null, 'Kestrel'));
    expect(payeeKey('agency', 'id-1', 'A')).toBe(payeeKey('agency', 'id-1', 'B'));
  });

  it('totals accumulate per payee across applications, and the rollup is agency-only', () => {
    const t = new PayeeTotals();
    t.add(app({
      commissionLines: [
        { level: 'agency', orgId: 'ag-1', orgName: 'Northgate Lettings', rate: 0.12 },
        { level: 'group', orgId: 'gr-1', orgName: 'Meridian Property Group', rate: 0.02 },
      ],
    }), 1500);
    t.add(app({ commissionLines: undefined, agentRate: 0.1, agency: 'Harborview Lettings' }), 1000);

    // Every payee line is in the total...
    expect(t.total()).toBeCloseTo(180 + 30 + 100, 10);
    // ...and the agency rollup carries an agency's OWN lines only.
    const rollup = t.agencyRollup();
    expect(rollup.map((p) => p.orgName).sort()).toEqual(['Harborview Lettings', 'Northgate Lettings']);
    expect(rollup.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(280, 10);
    // The group is a payee in its own right, deliberately outside the rollup.
    expect(t.list().find((p) => p.level === 'group')?.amount).toBe(30);
  });

  it('the same application sums to the same money whichever way it is read', () => {
    // The reconciliation property settlement, League, Dashboard and exports rely on.
    const a = app({
      agentRate: 0.14,
      commissionLines: [
        { level: 'agency', orgId: 'ag-1', orgName: 'Northgate Lettings', rate: 0.12 },
        { level: 'group', orgId: 'gr-1', orgName: 'Meridian Property Group', rate: 0.02 },
      ],
    });
    const viaLines = payeesFor(a, 1500).reduce((s, p) => s + p.amount, 0);
    const viaScalar = 1500 * a.agentRate;
    expect(viaLines).toBeCloseTo(viaScalar, 10);
  });
});

/* THE FROZEN AMOUNT, and why it is not basis times rate.

   Reported on GR-20845 / GR-20846, a £2,000 tenancy split 54/46 with a fee of
   £2,307.69 at 25%:

     £1,246.15 x 25% = 311.5375 -> £311.54
     £1,061.54 x 25% = 265.3850 -> £265.39      sum £576.93
     £2,307.69 x 25% = 576.9225 -> £576.92      the tenancy's own commission

   The database now freezes the tenancy's commission apportioned across the
   tenants, last line taking the rounding, so the lines foot. This side has to
   read that number rather than recompute, or the portal and the statement would
   quote a payee two different figures for the same line. */
describe('the frozen amount', () => {
  it('is used verbatim when the line carries one', () => {
    const a = app({
      commissionLines: [
        { level: 'agency', orgId: 'ag-1', orgName: 'Regent’s Lettings', rate: 0.25, basisAmount: 1061.54, amount: 265.38 },
      ],
    });
    // 1061.54 x 0.25 is 265.385, which is NOT what this line is worth.
    expect(payeesFor(a, 1061.54)[0].amount).toBe(265.38);
  });

  it('falls back to basis times rate on a line frozen before the column existed', () => {
    const a = app({
      commissionLines: [
        { level: 'agency', orgId: 'ag-1', orgName: 'Northgate Lettings', rate: 0.1 },
      ],
    });
    expect(payeesFor(a, 2000)[0].amount).toBe(200);
  });

  /* THE ASSERTION THAT WOULD HAVE CAUGHT IT. Two applications of one tenancy,
     each reading its own frozen line, summing to the tenancy's commission. */
  it('lets a tenancy’s lines sum to the tenancy’s commission, to the penny', () => {
    const one = app({ ref: 'GR-20845', commissionLines: [
      { level: 'agency', orgId: 'ag-r', orgName: 'Regent’s Lettings', rate: 0.25, basisAmount: 1246.15, amount: 311.54 },
    ] });
    const two = app({ ref: 'GR-20846', commissionLines: [
      { level: 'agency', orgId: 'ag-r', orgName: 'Regent’s Lettings', rate: 0.25, basisAmount: 1061.54, amount: 265.38 },
    ] });

    const summed = payeesFor(one, 1246.15)[0].amount + payeesFor(two, 1061.54)[0].amount;
    expect(Number(summed.toFixed(2))).toBe(576.92);
  });

  /* AND THE TWO SIDES CANNOT EVEN AGREE ON HOW TO ROUND, which is the strongest
     argument for one frozen number rather than two implementations of the same
     sum.

     Postgres numeric rounds 265.385 half-UP and returns 265.39, which is where
     the reported £576.93 came from. JavaScript cannot represent 265.385: the
     nearest double is a hair below it, so toFixed(2) rounds DOWN to 265.38. The
     same expression, in the two languages that both price this line, gives two
     different pennies.

     So the client recomputing is not merely duplicated work, it is a second
     answer. This assertion pins the discrepancy so that nobody "simplifies"
     payeesFor back to feeBase x rate on the grounds that it looks equivalent. */
  it('does not recompute, because the two languages round the half differently', () => {
    // What JavaScript makes of it. Postgres's round(1061.54 * 0.25, 2) is 265.39.
    expect(Number((1061.54 * 0.25).toFixed(2))).toBe(265.38);

    // And the frozen amount is neither side's guess: it is the tenancy's
    // commission apportioned, which is 265.38 here for a different reason again
    // (the last line takes the remainder after 311.54).
    const two = app({ commissionLines: [
      { level: 'agency', orgId: 'ag-r', orgName: 'Regent’s Lettings', rate: 0.25, basisAmount: 1061.54, amount: 265.38 },
    ] });
    expect(payeesFor(two, 1061.54)[0].amount).toBe(265.38);
  });
});
