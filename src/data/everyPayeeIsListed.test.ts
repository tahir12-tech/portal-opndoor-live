/* THE PAYEE LIST IS EVERY PAYEE, AND THE TOTAL IS THE SETTLEMENT'S.
 *
 * Matt, 2026-10-03: "Reporting, 'Commission statement' payee list (admin):
 * label supplier-estate agencies '(via [supplier])' as elsewhere, and include
 * suppliers as payees (e.g. Kestrel Lettings, Level 'Supplier', with its
 * statement), so every payee Opndoor owes for the month is listed. Totals must
 * match Settlements."
 *
 * WHY THE SUPPLIER WAS MISSING. `accruePayees` reads `payeesFor`, which reads
 * `linesFor`, which filters the 'supplier' level out. That filter is right for
 * every other caller -- the rankings, the aggregate, totalRate are all asking
 * about the agency side -- so the supplier's own debt had a frozen line, a
 * settlement row and a statement of its own, and no row on the one list headed
 * "every payee Opndoor owes".
 *
 * AND WHY `payeesFor` IS NOT REUSED FOR IT. Under "the supplier pays its own
 * agents" that function correctly returns nothing, because Opndoor pays no
 * agency on such a referral -- but Opndoor still owes the SUPPLIER its cut.
 * The two questions came apart on 2026-10-03 and this is one of the places it
 * shows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { hydratePartners } from './partnersService';
import { ALL_PARTNERS, hydrateCommissionVisibility } from './types';
import { getCommissionStatements, getCommissionSettlement, getAgentCommissionSettlement } from './liveAnalytics';
import type { FullApp } from './applicationsService';
import type { Partner } from './types';

const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', kind: 'agency', isHouse: true, opndoorPaysAgents: false },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', kind: 'supplier', opndoorPaysAgents: true },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

/* Test mode's clock is fixed at 2026-06-26, so May 2026 is the prior
   settlement month and what both settlements report on. */
const PAID = new Date(2026, 4, 10);
const MONTH = '2026-05';

const app = (over: Partial<FullApp> = {}): FullApp => ({
  ref: 'GR-A', partner: 'kestrel-lettings', agency: 'Frost Partnership',
  branch: 'Frost Mayfair', referrer: 'R', owner: 0,
  rent: 2400, fee: 2400, agentRate: 0.1, partnerRate: 0.25,
  status: 'paid', paidAt: PAID,
  refunded: false, partiallyRefunded: false, withdrawn: false,
  opndoorPaysAgentsAtFreeze: true,
  commissionLines: [
    { level: 'agency', orgId: 'ag-frost-kes', orgName: 'Frost Partnership', rate: 0.1, amount: 240 },
    { level: 'supplier', orgId: 'kes', orgName: 'Kestrel Lettings', rate: 0.25, amount: 600 },
  ],
  ...over,
} as unknown as FullApp);

/* ONE OF OURS TOO, so the list has both estates in it: that is the condition
   the via-label exists for and the only way to show it is applied here. */
const ours = (over: Partial<FullApp> = {}): FullApp => ({
  ...app(),
  ref: 'GR-B', partner: 'opndoor-agents', agency: 'Frost Partnership',
  branch: 'Frost Soho', opndoorPaysAgentsAtFreeze: null,
  commissionLines: [
    { level: 'agency', orgId: 'ag-frost-ours', orgName: 'Frost Partnership', rate: 0.1, amount: 240 },
  ],
  ...over,
} as unknown as FullApp);

beforeEach(() => { hydratePartners(PARTNERS); hydrateCommissionVisibility(true); });
afterEach(() => { hydrateFull([]); hydratePartners([]); hydrateCommissionVisibility(true); });

const list = () => getCommissionStatements('superadmin', ALL_PARTNERS, MONTH);

describe('the payee list', () => {
  it('holds the supplier, at level Supplier, with its own total', () => {
    hydrateFull([app()]);
    const sup = list().find((s) => s.level === 'supplier');
    expect(sup, 'the supplier is not on the list').toBeTruthy();
    expect(sup?.payeeName).toBe('Kestrel Lettings');
    expect(sup?.total).toBe(600);
  });

  it('and its statement, line by line, not just a total', () => {
    hydrateFull([app()]);
    const sup = list().find((s) => s.level === 'supplier');
    expect(sup?.lines.map((l) => [l.ref, l.commission])).toEqual([['GR-A', 600]]);
  });

  /* THE LABEL. Two Frost Partnerships, one per estate, and before this the
     list showed the name twice with nothing to tell them apart. */
  it('and names a supplier-estate agency with its supplier', () => {
    hydrateFull([app(), ours()]);
    const names = list().filter((s) => s.level === 'agency').map((s) => s.payeeName).sort();
    expect(names).toEqual(['Frost Partnership', 'Frost Partnership (via Kestrel Lettings)']);
  });

  /* MATT'S OWN TEST OF THE WHOLE CHANGE. The list is what Opndoor owes, and
     Settlements is what Opndoor owes; they are two readings of one month and
     must foot to each other. */
  it('and foots to Settlements, which is the point of listing them together', () => {
    hydrateFull([app(), ours()]);
    const listTotal = list().reduce((s, r) => s + r.total, 0);
    const settlement =
      getCommissionSettlement('superadmin', ALL_PARTNERS).partners.reduce((s, p) => s + p.commission, 0)
      + getAgentCommissionSettlement('superadmin', ALL_PARTNERS).total;
    expect(listTotal).toBe(settlement);
    // 240 + 240 agency, 600 supplier.
    expect(listTotal).toBe(1080);
  });
});

describe('what is NOT a payee of Opndoor', () => {
  /* THE HOUSE CUT. On the agency rail the partner share is Opndoor's own
     margin, and `ourMarginIsNotTheirs` exists because it once reached a
     Director's page as their earnings. A new supplier arm must not be the
     route back in. */
  it('the house partner, however much agency business it carries', () => {
    hydrateFull([ours()]);
    expect(list().some((s) => s.level === 'supplier')).toBe(false);
  });

  /* AND THE SUPPLIER'S AGENCY, WHERE THE SUPPLIER SETTLES IT. Opndoor owes
     that agency nothing on such a referral, so it is not on a list of who
     Opndoor owes -- and the supplier's own total is unchanged. */
  it('and a supplier-estate agency on a referral frozen as carved', () => {
    hydrateFull([app({ opndoorPaysAgentsAtFreeze: false })]);
    const rows = list();
    expect(rows.filter((s) => s.level === 'agency')).toEqual([]);
    expect(rows.find((s) => s.level === 'supplier')?.total).toBe(600);
  });
});
