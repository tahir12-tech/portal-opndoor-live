/* =====================================================================
   (bq)(br) THE APPLICATION EXPORT'S STATUS, CARVED SHARE, BLANKS AND
   VOIDED DEEDS.

   Matt: "1) every fully refunded application's Status is 'Refunded'
   (GR-23854 says 'Paid', GR-23853 'Deed cancelled'); 2) where the
   supplier passes on the agencies' share, show the agency's share as
   'Included in supplier commission' consistently with the Performance
   export fix; 3) agency-route rows leave the supplier commission and
   rate blank, not '£0.00 / 0%'; 4) an application whose deed was voided
   for a correction and awaits re-signing shows 'Awaiting signature',
   not 'Paid' (GR-26262). Same rules in every export and on screen."

   And (br): "'Activity in period' column: include 'Refunded' (and 'Deed
   cancelled' where it applies) when that happened in the period."

   =====================================================================
   THE FIXTURES ARE HIS FOUR ROWS, AS THEY ARE ON DEV
   =====================================================================

     GR-23854  status paid  payment refunded  deed voided           said "Paid"
     GR-23853  status deed  payment refunded  deed cancelled        said "Deed cancelled"
     GR-26262  status paid  payment paid      deed awaiting_tenant  said "Paid"
     GR-26263  status deed  payment paid      deed executed         said "Deed Issued", correctly

   Three failures of three different kinds -- the refund ignored, the
   deed state beating the refund, the deed state ignored -- which is why
   one ordered rule replaces the export's own composition rather than
   three patches being added to it. The rule lives in
   applicationsService, with the lists and the application page.
   ===================================================================== */
import { afterAll, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { BASIS_META, getPeriods } from '@/data';
import { buildRealApplicationDoc } from '@/data/exportsService';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;
const AGENCY_LINE = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.2, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 2400, feeBasisWeeks: 5, commissionLines: AGENCY_LINE,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: null,
    tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

/* AND TWO SUPPLIER-RAIL ROWS FOR (bq)(2), one of each arrangement.
   `harbourside` is a supplier in the mock book, so these rows have a
   supplier to be paid and an agency share to place. The flag is frozen
   per referral, which is why a single month can hold both. */
const SUPPLIER_LINES = [
  { level: 'supplier' as const, orgId: null, orgName: 'Harbourside Homes', rate: 0.2, source: 'standard' as const },
  { level: 'agency' as const, orgId: 'ag-h', orgName: 'Harbour Agency', rate: 0.1, source: 'standard' as const },
];

const APPS: FullApp[] = [
  // His three wrong rows, and the one that was right.
  app({ ref: 'GR-23854', status: 'paid', refunded: true, refundedAt: D('2026-05-20'), refundedAmount: 3321.69, deedState: 'voided' }),
  app({ ref: 'GR-23853', status: 'deed', refunded: true, refundedAt: D('2026-05-21'), refundedAmount: 2214.46, deedState: 'cancelled', deedAt: D('2026-05-10') }),
  app({ ref: 'GR-26262', status: 'paid', deedState: 'awaiting_tenant' }),
  app({ ref: 'GR-26263', status: 'deed', deedState: 'executed', deedAt: D('2026-05-12') }),
  app({ ref: 'GR-CARVED', status: 'deed', deedState: 'executed', deedAt: D('2026-05-12'),
    partner: 'harbourside', agency: 'Harbour Agency', agencyId: 'ag-h',
    commissionLines: SUPPLIER_LINES, opndoorPaysAgentsAtFreeze: false }),
  app({ ref: 'GR-SIBLING', status: 'deed', deedState: 'executed', deedAt: D('2026-05-12'),
    partner: 'harbourside', agency: 'Harbour Agency', agencyId: 'ag-h',
    commissionLines: SUPPLIER_LINES, opndoorPaysAgentsAtFreeze: true }),
];

hydrateFull(APPS);
afterAll(() => hydrateFull([]));

function rowsFor(basis: 'referred' | 'activity') {
  const doc = buildRealApplicationDoc('superadmin', allTime, basis, BASIS_META[basis]);
  const table = doc.sheets[0].doc.blocks.find((b) => b.kind === 'table') as
    { columns: { header: string }[]; rows: (string | number)[][] };
  const heads = table.columns.map((c) => c.header);
  return table.rows.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}
const byRef = (basis: 'referred' | 'activity', ref: string) =>
  rowsFor(basis).find((r) => r['Guarantee reference'] === ref)!;

describe('(bq)(1)(4) the Status column, on Matt’s own four rows', () => {
  it.each([
    ['GR-23854', 'Refunded', 'refunded with the deed voided: the refund was never consulted'],
    ['GR-23853', 'Refunded', 'refunded with the deed cancelled: the deed state beat the refund'],
    ['GR-26262', 'Awaiting signature', 'deed out and unsigned after a correction: read as Paid'],
    ['GR-26263', 'Deed Issued', 'executed, and this one was always right'],
  ])('%s reads "%s"', (ref, expected) => {
    expect(byRef('referred', ref).Status).toBe(expected);
  });

  /* THE ROW MUST NOT CONTRADICT ITSELF, which is what made the old
     version worse than wrong: Status said "Deed Issued" while Payment
     state said "Refunded" two cells along, and a reader could take
     either as the live fact. */
  it('and never says Deed Issued on an ended guarantee', () => {
    const r = byRef('referred', 'GR-23853');
    expect(r.Status).not.toBe('Deed Issued');
    expect(r['Payment state']).toBe('Refunded');
  });
});

describe('(bq)(3) a blank is not a zero', () => {
  /* THESE FIXTURES ARE ON THE AGENCY RAIL, where there is no supplier at
     all, and partnerRate is 0.2 and populated: resolve_rates fills it on
     every row. £0.00 and 0% stated a fact about a party that does not
     exist, in columns a reader can sum. */
  it('leaves the supplier commission and rate empty on an agency-route row', () => {
    const r = byRef('referred', 'GR-26263');
    expect(r['Supplier commission']).toBe('');
    expect(r['Supplier commission rate']).toBe('');
  });

  it('and the agency’s own commission is still a figure', () => {
    expect(byRef('referred', 'GR-26263')['Agent commission']).toBeGreaterThan(0);
  });
});

describe('(br) Activity in period names the refund', () => {
  it('lists Refunded where the refund fell in the window', () => {
    expect(String(byRef('activity', 'GR-23854')['Activity in period'])).toContain('Refunded');
  });

  /* BOTH, because the refund did two things to this row. */
  it('and Deed cancelled beside it where the deed went with it', () => {
    const ev = String(byRef('activity', 'GR-23853')['Activity in period']);
    expect(ev).toContain('Refunded');
    expect(ev).toContain('Deed cancelled');
  });

  it('and says neither on a row that was not refunded', () => {
    const ev = String(byRef('activity', 'GR-26263')['Activity in period']);
    expect(ev).not.toContain('Refunded');
    expect(ev).not.toContain('Deed cancelled');
  });
});

describe('(bq)(2) the carved share is reported, never added', () => {
  /* THE SAME SHAPE AS THE PERFORMANCE EXPORT FIX, which Matt named: a
     third column beside the two amounts. The agency's share is INSIDE
     the supplier's figure on a carved referral, so stating it in the
     Agent commission column as well would give a reader summing the two
     the same money twice -- the Â£1,326.15 on a referral that pays
     Â£947.25 that started all of this. */
  it('puts a passed-on share in its own column and not in the agent one', () => {
    const r = byRef('referred', 'GR-CARVED');
    expect(r['Agent commission']).toBe('');
    expect(Number(r['Included in supplier commission'])).toBeGreaterThan(0);
  });

  /* AND A DIRECTLY-PAID SHARE REALLY IS EXTRA, so it stays where it was. */
  it('and leaves a directly-paid share as a payable amount', () => {
    const r = byRef('referred', 'GR-SIBLING');
    expect(Number(r['Agent commission'])).toBeGreaterThan(0);
    expect(r['Included in supplier commission']).toBe('');
  });

  /* THE AGENCY RAIL HAS NEITHER, because it has no supplier to carve
     anything out of. The column exists on the sheet and is empty there. */
  it('and says nothing of either on a row with no supplier at all', () => {
    expect(byRef('referred', 'GR-26263')['Included in supplier commission']).toBe('');
  });
});
