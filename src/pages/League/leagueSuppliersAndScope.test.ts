/* THE LEAGUE GAINS A SUPPLIERS BOARD, AND ONE SEARCHABLE FILTER.
 *
 * Matt, 2026-09-30, across three messages that converge:
 *
 *   "add a Suppliers tab alongside Agencies, Branches and Negotiators,
 *    ranking each supplier on the same measures. Admin only; agencies
 *    and suppliers never see it. Also remove the 'Unattached / Direct'
 *    row from the Agencies table (direct signups aren't an agency), and
 *    replace the 'All partners' dropdown wording with plain labels."
 *
 *   "replace the 'All partners' dropdown with a searchable filter that
 *    can narrow to any single agency (e.g. Regent's Lettings), group or
 *    supplier, or to all agencies or all suppliers. Branches and
 *    Negotiators tabs follow the selection."
 *
 * WHY A SOURCE TEST FOR THE GATE. "Admin only" is a rule about a tab
 * that must not EXIST for a customer -- an empty board still tells a
 * supplier the ranking is there -- and the cheapest honest way to pin
 * "this tab is built only for Opndoor staff" is to read the condition
 * that builds it. The RANKING itself is exercised through the data
 * layer below, where the rows are real.
 *
 * THE "Unattached / Direct" ROW needs nothing here: it is the same
 * `keyOf` fix as Q3 on Reporting, asserted in directIsNobodysAgency,
 * and the League reads the same function. Saying so is the point of
 * this paragraph -- a reader looking for that assertion should not
 * conclude it is missing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveLeague } from '@/data/liveAnalytics';
import { ALL_PARTNERS, type Period } from '@/data/types';

const src = readFileSync(resolve(process.cwd(), 'src/pages/League/League.tsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('the Suppliers board', () => {
  it('is one of the tabs', () => {
    expect(code).toMatch(/id: 'supplier', label: 'Suppliers'/);
  });

  /* OPNDOOR ONLY. The tab is filtered out for everybody else rather
     than rendered empty. */
  it('and is built only for Opndoor staff', () => {
    expect(code).toMatch(/t\.id === 'supplier' && opndoorStaff/);
  });

  it('and ranks on the same measures as the other boards', () => {
    // Same keys as the agency board, which is what "the same measures" means.
    const cols = code.slice(code.indexOf('supplier: ['), code.indexOf('supplier: [') + 400);
    for (const key of ['refs', 'fees', 'paid', 'deed', 'sp', 'conv']) {
      expect(cols, `the supplier board is missing ${key}`).toMatch(new RegExp(`'${key}'`));
    }
  });
});

describe('the filter', () => {
  it('is the searchable picker, not a partner dropdown', () => {
    expect(code).toMatch(/<ScopePicker/);
    expect(code).not.toMatch(/<PartnerSelect/);
  });

  /* THE WORDING MATT ASKED TO LOSE. The dropdown could only ever name a
     PARTNER, so an admin could not narrow to one agency at all: every
     agency we onboard shares the house partner. */
  it('and "All partners" is gone with it', () => {
    expect(code).not.toMatch(/All partners/);
  });

  /* ONE SELECTION, SHARED. Every tab reads the same `sel`, which is how
     "Branches and Negotiators tabs follow the selection" is true without
     each board remembering its own. */
  it('and every board is asked with the shared selection', () => {
    expect(code).toMatch(/getLeague\(view, \{[^}]*sel: scopeSel/);
  });
});

/* ---------------------------------------------------------------------
   AND THE BOARD ACTUALLY RANKS SUPPLIERS, through the data layer. */
const D = (y: number, m: number, d: number) => new Date(y, m, d);
const ALLTIME = { id: 'alltime', label: 'All time' } as Period;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-L1', partner: 'opndoor-agents', agency: 'Regent Property', branch: 'Regent Property',
  agencyId: 'ag-1', branchId: 'br-1', referrer: 'Tom', referrerId: 'u-1', owner: 1,
  rent: 2000, fee: 2000, agentRate: 0.1, partnerRate: 0.25,
  status: 'paid', sentAt: D(2026, 5, 1), paidAt: D(2026, 5, 2),
  ...over,
} as unknown as FullApp);

describe('ranking suppliers', () => {
  it('lists a real supplier and never the house partner', () => {
    hydrateFull([
      app({ ref: 'GR-L1', partner: 'opndoor-agents' }),
      app({ ref: 'GR-L2', partner: 'kestrel-lettings' }),
      app({ ref: 'GR-L3', partner: 'kestrel-lettings' }),
    ]);
    const rows = liveLeague('supplier', 'superadmin', ALL_PARTNERS, '', ALLTIME);
    // The house partner carries every agency referral and is not a supplier.
    expect(rows.map((r) => r.name)).not.toContain('Agency referral');
    expect(rows.length).toBe(1);
    expect(rows[0].refs).toBe(2);
    hydrateFull([]);
  });

  /* AND THE DIRECT RAIL IS NOT A SUPPLIER EITHER, which is the same
     isHousePartner test and the reason it is that test and not
     isDirectRail. */
  it('and never the direct rail', () => {
    hydrateFull([app({ ref: 'GR-L4', partner: 'opndoor-direct', referrerId: null })]);
    expect(liveLeague('supplier', 'superadmin', ALL_PARTNERS, '', ALLTIME)).toEqual([]);
    hydrateFull([]);
  });
});
