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
