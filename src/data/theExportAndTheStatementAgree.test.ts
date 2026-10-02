/* ONE PENNY, ON A DOCUMENT A PAYEE RECONCILES AGAINST.
 *
 * Matt, 2026-10-02, verbatim: "GR-20846 shows agent commission £265.39
 * here and £265.38 on Regent's commission statement. Every export,
 * statement and screen must take commission from the same stored
 * amount, never recalculate and round differently. Find every place
 * commission is recomputed rather than read, fix them, and add a test
 * that the export and statement agree to the penny for every
 * application."
 *
 * GR-20846 ON DEV, exactly: fee £1,061.54, agency rate 0.25, frozen
 * line amount £265.38. 1061.54 x 0.25 is 265.385, which rounds UP the
 * moment anything multiplies it out. Measured across dev's twelve
 * applications that carry commission lines, it is the only one where
 * the two disagree -- which is what made it survive: eleven rows agreed
 * and the twelfth was a half-penny.
 *
 * AND NO ROUNDING RULE HERE COULD HAVE FIXED IT. The stored amount is
 * not "fee x rate, rounded". A tenancy is priced once and its
 * commission apportioned across the tenants with the last line taking
 * the remainder, so GR-20845 and GR-20846 sum to the tenancy's £576.92
 * and not to the £576.93 two independently-rounded halves give. The
 * server did that arithmetic and wrote the answer down. The only way to
 * agree with it is to read it.
 *
 * THE FIXTURE IS THAT PAIR, rebuilt: a joint tenancy whose frozen
 * amounts do not equal fee x rate, so a surface that multiplies fails
 * this file and a surface that reads passes it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods } from '@/data';
import { hydrateFull, hydrateApplications, type FullApp } from '@/data/applicationsService';
import { buildRealApplicationDoc } from '@/data/exportsService';
import { getAgentCommissionSettlement, liveAggregate } from '@/data/liveAnalytics';
import { agentAmountOf } from '@/data/commissionSplit';

const D = (s: string) => new Date(s);

/** GR-20845 and GR-20846 as dev holds them: one tenancy, two tenants,
    £576.92 of commission apportioned 311.54 / 265.38. Multiplying gives
    311.54 and 265.39, which sum to a penny more than was ever owed. */
const PAIR: FullApp[] = [
  {
    ref: 'GR-20845', rent: 2000, fee: 1246.15, partner: 'northwind',
    agency: "Regent's Lettings", branch: "Regent's Park", referrer: 'Rosa Vance', owner: 0,
    status: 'paid', partnerRate: 0.25, agentRate: 0.25,
    tenancyId: 'T-1', tenancyPosition: 1, sharePercent: 54,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: null, tenancyStart: D('2026-07-01'),
    expiry: null, refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    commissionLines: [{ level: 'agency', orgId: 'ag-1', orgName: "Regent's Lettings", rate: 0.25, amount: 311.54 }],
  },
  {
    ref: 'GR-20846', rent: 2000, fee: 1061.54, partner: 'northwind',
    agency: "Regent's Lettings", branch: "Regent's Park", referrer: 'Rosa Vance', owner: 0,
    status: 'paid', partnerRate: 0.25, agentRate: 0.25,
    tenancyId: 'T-1', tenancyPosition: 2, sharePercent: 46,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: null, tenancyStart: D('2026-07-01'),
    expiry: null, refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    // THE HALF PENNY. 1061.54 x 0.25 = 265.385.
    commissionLines: [{ level: 'agency', orgId: 'ag-1', orgName: "Regent's Lettings", rate: 0.25, amount: 265.38 }],
  },
] as unknown as FullApp[];

const allTime = getPeriods().find((p) => p.id === 'alltime')!;
const META = { label: 'everything', recon: '', hint: '' };

beforeAll(() => { hydrateFull(PAIR); hydrateApplications([], []); });
afterAll(() => { hydrateFull([]); hydrateApplications([], []); });

/** The Agent commission cell of the application export, by reference. */
function exportCommission(): Map<string, number> {
  const built = buildRealApplicationDoc('superadmin', allTime, 'referred', META);
  const doc = built.sheets[0].doc;
  const table = doc.blocks.find((b) => b.kind === 'table' && (b.columns ?? []).some((c) => c.header === 'Agent commission'));
  const cols = (table as { columns: { header: string }[] }).columns.map((c) => c.header);
  const refAt = cols.indexOf('Guarantee reference');
  const commAt = cols.indexOf('Agent commission');
  const out = new Map<string, number>();
  for (const row of (table as { rows: unknown[][] }).rows) {
    out.set(String(row[refAt]), Number(row[commAt]));
  }
  return out;
}

describe('the application export and the commission statement', () => {
  it('agree to the penny on every application', () => {
    const fromExport = exportCommission();
    // The statement's own figures, per application, from the settlement the
    // downloaded statement is built out of.
    const st = getAgentCommissionSettlement('superadmin', ALL_PARTNERS, 'prior');
    const fromStatement = new Map<string, number>();
    for (const payee of st.payees) {
      for (const ap of payee.apps) {
        fromStatement.set(ap.ref, (fromStatement.get(ap.ref) ?? 0) + ap.commission);
      }
    }
    expect(fromStatement.size).toBeGreaterThan(0);
    for (const [ref, amount] of fromStatement) {
      expect(fromExport.get(ref), `${ref} disagrees between the export and the statement`)
        .toBeCloseTo(amount, 2);
    }
  });

  /* THE SPECIFIC PENNY, named so a future reader knows which case this
     file is about and does not "simplify" the fixture into one that
     cannot fail. */
  it('and GR-20846 is £265.38 in both, not £265.39 in one', () => {
    expect(exportCommission().get('GR-20846')).toBeCloseTo(265.38, 2);
    expect(agentAmountOf(PAIR[1])).toBeCloseTo(265.38, 2);
    // What it would have been if anything multiplied the rate out.
    expect(Math.round(1061.54 * 0.25 * 100) / 100).toBeCloseTo(265.39, 2);
  });

  /* AND THE TENANCY STILL SUMS TO WHAT WAS OWED. This is the reason the
     stored amount is not "fee x rate rounded": two independently-rounded
     halves give £576.93 against a tenancy commission of £576.92. */
  it('and the joint tenancy sums to the commission that was apportioned', () => {
    const e = exportCommission();
    expect((e.get('GR-20845') ?? 0) + (e.get('GR-20846') ?? 0)).toBeCloseTo(576.92, 2);
  });

  /* THE AGGREGATE IS THE THIRD SURFACE, and it is the one the dashboard
     tile and the summary export both read. It has to foot to the same
     pennies or the three documents disagree in a different place. */
  it('and the aggregate foots to the same figure', () => {
    const agg = liveAggregate('superadmin', ALL_PARTNERS, allTime);
    expect(agg.agentCommNet).toBeCloseTo(576.92, 2);
  });
});

/* =====================================================================
   AND THE FIVE OTHER THINGS ON THE SAME DOCUMENT.

   Matt, 2026-10-02, items 2 to 6 of the same instruction. They are
   asserted here rather than in a file of their own because they are the
   same document and the same fixture, and splitting them would mean two
   files hydrating the same two applications.
   ===================================================================== */
import { readFileSync } from 'node:fs';

const EXPORTS_SRC = readFileSync('src/data/exportsService.ts', 'utf8');

describe('the application export', () => {
  /* 2. "Direct signups show 'Unattached' for Agency and Branch; show
     blank, as on screen." Each house rail carries a placeholder agency
     and branch so an application's NOT NULL agency_id resolves; it is
     our own plumbing and not a company. */
  it('never prints the placeholder agency or branch', () => {
    expect(EXPORTS_SRC).toContain('orgCell(a.agency)');
    expect(EXPORTS_SRC).toContain('orgCell(a.branch)');
  });

  /* 3. "Unfinished applications: leave 'Guarantor fee charged' blank and
     Payment state 'Not yet at payment' until the tenant actually reaches
     payment." A direct application is born empty and filled step by
     step, so "Awaiting payment" against a form somebody is still typing
     reads as a tenant sitting on an invoice. */
  it('says an unfinished application is not yet at payment', () => {
    expect(EXPORTS_SRC).toContain("const unfinished = a.status === 'draft';");
    expect(EXPORTS_SRC).toContain("unfinished ? 'Not yet at payment'");
    expect(EXPORTS_SRC).toContain("unfinished ? '' : money(feeBaseFor(a))");
  });

  /* 'sent' IS waiting for the tenant to pay and keeps the old words:
     the new wording must not swallow the case it was never about. */
  it('and leaves "Awaiting payment" where that is what it is', () => {
    expect(EXPORTS_SRC).toContain("a.paidAt ? 'Paid' : 'Awaiting payment'");
  });

  /* 4 and 5 are asserted against real rows in
     exports-joint-tenancy.test.ts, which has a five-week joint fixture:
     "5 weeks" in the Fee basis cell and the two rate columns. Here only
     the column list, which that file cannot see. */
  it('carries two commission rate columns, not one', () => {
    expect(EXPORTS_SRC).toContain("{ header: 'Supplier commission rate', type: 'pct' }");
    expect(EXPORTS_SRC).toContain("header: agency ? 'Commission rate' : 'Agent commission rate'");
  });

  it('and a Fee basis column that does not promise weeks', () => {
    expect(EXPORTS_SRC).toContain("{ header: 'Fee basis', type: 'text' }");
    expect(EXPORTS_SRC).not.toContain("'Fee basis (weeks of rent)'");
  });

  /* 6. "Share of tenancy: show 100% for every single-tenant
     application, never blank." A sole tenant has no recorded share
     because their share is all of it, which the statement has said in
     these words since it was written. */
  it('and says 100% for a sole tenant rather than leaving the cell empty', () => {
    expect(EXPORTS_SRC).toContain("a.sharePercent == null ? '100%'");
  });
});
