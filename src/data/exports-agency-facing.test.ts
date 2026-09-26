/* WHAT AN AGENCY IS ALLOWED TO READ IN THEIR OWN EXPORT.
 *
 * Every export in this service was written for Opndoor looking across a book of
 * agencies, and then handed to the agencies themselves. So a Regent's manager
 * downloading their own performance file got a "Partner" column naming house
 * plumbing on every row, a "Commission by partner" table splitting their money
 * with a party they have never heard of, a "Breakdown by agency" ranking a
 * population of one, and a header announcing the "Whole estate" they do not own.
 *
 * The rule is: on a document addressed to one of our agencies the words
 * "partner" and "estate" do not appear at all. This walks the generated
 * documents and holds that, plus the four rulings that came with it: breakdowns
 * only where there is more than one of the thing, pence in every money column, a
 * commission headline with no invented blended rate, and no expiry date for a
 * guarantee that has not been issued.
 *
 * COPY VERSUS DATA. The assertion walks every header, title, label and meta line
 * of every document (that is copy: the portal wrote it). It walks the CELLS too
 * wherever the rows come from this file's own fixtures or from the synthetic
 * model in exportsService. It cannot walk the cells of the documents fed by
 * src/data/mock — those contain demo agencies called "Hartwell Estates" — and it
 * should not: a real customer may be called Foo Estates, and their own name on
 * their own export is not the portal saying "estate" to them.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { BASIS_META, getPeriods } from '@/data';
import {
  buildAgentStatementDoc, buildApplicationDoc, buildExpiriesCsv, buildLeagueDoc,
  buildLivePerformanceDoc, buildPartnerStatementDoc, buildPerformanceDoc,
  buildRealApplicationDoc, type BrandedExport,
} from '@/data/exportsService';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

/* 'northwind' is opndoor_referenced in the mock partner seed, which is what
   makes isAgencyUser true for a management/referrer user pinned to it: one of
   OUR agencies, on the agent rail. 'management' is the role an agency manager
   and a supplier's manager share, which is the whole reason the exports ask
   isAgencyUser and not the role. */
const AGENCY_ROLE = 'management' as const;
const ADMIN_ROLE = 'superadmin' as const;

const LINES = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 2400, feeBasisWeeks: 5, commissionLines: LINES,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
    ...o,
  };
}

/* One agency, two branches. The joint tenancy has BOTH tenants at Deed Issued:
   each tenant signs their own deed over their own share once they have paid, so
   a sibling at 'paid' is waiting for their own deed and not for the lead's. */
const TWO_BRANCHES: FullApp[] = [
  app({ ref: 'GR-1', status: 'deed', fee: 1384.62, sharePercent: 50, shareAmount: 1200,
    tenancyId: 'T1', tenancyPosition: 1,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: D('2026-05-06'),
    tenancyStart: D('2026-06-01'), expiry: D('2027-05-31') }),
  app({ ref: 'GR-2', status: 'deed', fee: 1384.61, sharePercent: 50, shareAmount: 1200,
    tenancyId: 'T1', tenancyPosition: 2,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: D('2026-05-07'),
    tenancyStart: D('2026-06-01'), expiry: D('2027-05-31') }),
  // Paid, no deed yet, and carrying a tenancy start AND a stored expiry: the
  // row that proves the Expiry column is gated on the deed, not on the date.
  app({ ref: 'GR-3', status: 'paid', branch: 'Marylebone', branchId: 'br-my', fee: 1661.54,
    rent: 2400, sentAt: D('2026-05-10'), paidAt: D('2026-05-12'),
    tenancyStart: D('2026-06-15'), expiry: D('2027-06-14') }),
];

/* The same book narrowed to one branch, for the collapse rule. */
const ONE_BRANCH: FullApp[] = TWO_BRANCHES.map((a) => ({ ...a, branch: "Regent's Park", branchId: 'br-rp' }));

type Block = { kind: string; title?: string; items?: { label: string; value: string | number }[]; columns?: { header: string; type: string }[]; rows?: (string | number)[][] };

/** Everything the PORTAL wrote: sheet names, titles, meta lines, section
    headings, key/value pairs and column headers. */
function copyOf(built: BrandedExport): string[] {
  const out: string[] = [];
  for (const s of built.sheets) {
    out.push(s.name, s.doc.reportName, s.doc.metaLine);
    for (const b of s.doc.blocks as Block[]) {
      if (b.title) out.push(b.title);
      for (const it of b.items ?? []) out.push(it.label, String(it.value));
      for (const c of b.columns ?? []) out.push(c.header);
    }
  }
  return out;
}

/** Every table cell. */
function cellsOf(built: BrandedExport): string[] {
  const out: string[] = [];
  for (const s of built.sheets) {
    for (const b of s.doc.blocks as Block[]) {
      for (const r of b.rows ?? []) for (const v of r) out.push(String(v));
    }
  }
  return out;
}

/** Every column declared by every table. */
function columnsOf(built: BrandedExport): { header: string; type: string }[] {
  return built.sheets.flatMap((s) => (s.doc.blocks as Block[]).flatMap((b) => b.columns ?? []));
}

function sections(built: BrandedExport): string[] {
  return built.sheets.flatMap((s) => (s.doc.blocks as Block[]).filter((b) => b.kind === 'section').map((b) => b.title!));
}

function labels(built: BrandedExport): string[] {
  return built.sheets.flatMap((s) => (s.doc.blocks as Block[]).flatMap((b) => (b.items ?? []).map((i) => i.label)));
}

/** The application export's single table, as { header: value } per row. */
function appRows(role: typeof AGENCY_ROLE | typeof ADMIN_ROLE) {
  const doc = buildRealApplicationDoc(role, allTime, 'referred', BASIS_META.referred);
  const table = (doc.sheets[0].doc.blocks as Block[]).find((b) => b.kind === 'table')!;
  const heads = table.columns!.map((c) => c.header);
  return table.rows!.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

const FORBIDDEN = [/partner/i, /estate/i];
function expectClean(strings: string[], where: string): void {
  for (const s of strings) {
    for (const rx of FORBIDDEN) {
      // The message names the offending string, so a failure says what leaked.
      expect(`${where}: ${s}`, `${where} must not say ${rx}`).not.toMatch(rx);
    }
  }
}

describe('an agency-facing export never says partner or estate', () => {
  beforeEach(() => hydrateFull(TWO_BRANCHES));
  afterAll(() => hydrateFull([]));

  it('the live performance export, every cell and every header', () => {
    const built = buildLivePerformanceDoc(AGENCY_ROLE, allTime);
    expectClean(copyOf(built), 'live performance copy');
    expectClean(cellsOf(built), 'live performance cells');
  });

  it('the live application export, every cell and every header', () => {
    const built = buildRealApplicationDoc(AGENCY_ROLE, allTime, 'referred', BASIS_META.referred);
    expectClean(copyOf(built), 'live application copy');
    expectClean(cellsOf(built), 'live application cells');
  });

  it('the demo performance export, every cell and every header', () => {
    // The synthetic model lives in exportsService itself, so its rows are ours
    // to keep clean and the cells are walked here too.
    const built = buildPerformanceDoc(AGENCY_ROLE, allTime);
    expectClean(copyOf(built), 'demo performance copy');
    expectClean(cellsOf(built), 'demo performance cells');
  });

  it('the demo application and league exports, in everything the portal wrote', () => {
    // Cells excluded, and only here: these rows come from src/data/mock, whose
    // demo agencies include one called "Hartwell Estates". A customer's own name
    // is not the portal saying the word to them.
    expectClean(copyOf(buildApplicationDoc(AGENCY_ROLE, allTime, 'referred')!), 'demo application copy');
    expectClean(copyOf(buildLeagueDoc(AGENCY_ROLE, 'northwind', '', allTime)), 'league copy');
  });

  it('the expiries file, header block and all', () => {
    const out = buildExpiriesCsv(AGENCY_ROLE, 2027, 5)!;
    // "Scope: Your partner" told an agency their book belongs to someone else.
    expectClean([out.csv], 'expiries csv');
    expect(out.csv).toContain("Regent's Lettings");
  });

  it('the settlement statement the agency can download from the dashboard', () => {
    // The Dashboard offers this one to anyone who can see the settlement, the
    // agency's own manager included, so it is theirs as much as ours.
    const built = buildAgentStatementDoc(AGENCY_ROLE, 'northwind', 'northwind', "Regent's Lettings");
    expectClean(copyOf(built), 'agent statement copy');
    expectClean(cellsOf(built), 'agent statement cells');
  });

  it('refuses to build a partner statement for an agency at all', () => {
    // There is no version of this document that is theirs: the payee is a party
    // they are not, for a figure that is a structural zero on their rail.
    expect(buildPartnerStatementDoc(AGENCY_ROLE, 'northwind', 'northwind').sheets).toEqual([]);
    // Opndoor still gets it.
    expect(buildPartnerStatementDoc(ADMIN_ROLE, 'all', 'northwind').sheets).toHaveLength(1);
  });

  it('still gives the admin the partner columns, because they are Opndoor', () => {
    const perf = buildLivePerformanceDoc(ADMIN_ROLE, allTime);
    expect(sections(perf)).toContain('Commission by partner (this period)');
    expect(columnsOf(perf).map((c) => c.header)).toContain('Partner commission (net)');
    const apps = buildRealApplicationDoc(ADMIN_ROLE, allTime, 'referred', BASIS_META.referred);
    const heads = columnsOf(apps).map((c) => c.header);
    expect(heads).toContain('Partner');
    expect(heads).toContain('Partner commission');
    expect(apps.sheets[0].doc.metaLine).toContain('Whole estate');
  });
});

describe('breakdowns appear only where there is more than one of the thing', () => {
  beforeEach(() => hydrateFull(TWO_BRANCHES));
  afterAll(() => hydrateFull([]));

  it('drops the agency breakdown over a single agency, and keeps it for the admin', () => {
    expect(sections(buildLivePerformanceDoc(AGENCY_ROLE, allTime))).not.toContain('Breakdown by agency');
    expect(sections(buildPerformanceDoc(AGENCY_ROLE, allTime))).not.toContain('Breakdown by agency');
    expect(sections(buildLivePerformanceDoc(ADMIN_ROLE, allTime))).toContain('Breakdown by agency');
  });

  it('keeps the branch breakdown over two branches, and attributes it like the referrer table', () => {
    const built = buildLivePerformanceDoc(AGENCY_ROLE, allTime);
    expect(sections(built)).toContain('Breakdown by branch');
    expect(columnsOf(built).map((c) => c.header)).toContain('Attributed commission (net)');
    // The note that explains an empty branch row, the same one the League board
    // states on screen.
    expect(labels(built)).toContain('Note');
    expect(copyOf(built).join(' ')).toContain('A branch earns commission only where it holds a rate of its own');
  });

  it('drops the branch breakdown over a single branch', () => {
    hydrateFull(ONE_BRANCH);
    expect(sections(buildLivePerformanceDoc(AGENCY_ROLE, allTime))).not.toContain('Breakdown by branch');
    expect(sections(buildPerformanceDoc(AGENCY_ROLE, allTime))).not.toContain('Breakdown by branch');
    // The referrer breakdown survives: people are the dimension a shop still has
    // several of.
    expect(sections(buildLivePerformanceDoc(AGENCY_ROLE, allTime))).toContain('Breakdown by referrer');
  });
});

describe('the commission headline states the agreed terms, not a blended rate', () => {
  beforeEach(() => hydrateFull(TWO_BRANCHES));
  afterAll(() => hydrateFull([]));

  it('names the amount and no percentage, live and in the demo model', () => {
    for (const built of [buildLivePerformanceDoc(AGENCY_ROLE, allTime), buildPerformanceDoc(AGENCY_ROLE, allTime)]) {
      const ls = labels(built);
      expect(ls).toContain('Commission (agreed terms)');
      // No "(20% of one month's rent)" anywhere: a single rate across a period of
      // mixed rates is a number that appears in no agreement.
      expect(ls.filter((l) => /commission/i.test(l) && /\d+%/.test(l))).toEqual([]);
    }
  });

  it('leaves the admin headline, with its effective rate, alone', () => {
    const ls = labels(buildLivePerformanceDoc(ADMIN_ROLE, allTime));
    expect(ls.some((l) => /^Agent commission \(\d+% of /.test(l))).toBe(true);
  });
});

describe('every money column carries pence', () => {
  beforeEach(() => hydrateFull(TWO_BRANCHES));
  afterAll(() => hydrateFull([]));

  it('no export declares a whole-pound money column', () => {
    const built: BrandedExport[] = [
      buildLivePerformanceDoc(AGENCY_ROLE, allTime),
      buildLivePerformanceDoc(ADMIN_ROLE, allTime),
      buildPerformanceDoc(AGENCY_ROLE, allTime),
      buildPerformanceDoc(ADMIN_ROLE, allTime),
      buildRealApplicationDoc(AGENCY_ROLE, allTime, 'referred', BASIS_META.referred),
      buildRealApplicationDoc(ADMIN_ROLE, allTime, 'activity', BASIS_META.activity),
      buildApplicationDoc(AGENCY_ROLE, allTime, 'referred')!,
      buildLeagueDoc(AGENCY_ROLE, 'northwind', '', allTime),
      buildLeagueDoc(ADMIN_ROLE, 'all', '', allTime),
    ];
    for (const b of built) {
      const whole = columnsOf(b).filter((c) => c.type === 'money').map((c) => c.header);
      expect(whole).toEqual([]);
    }
  });

  it('a refund is stated to the penny rather than rounded to the pound', () => {
    hydrateFull([
      ...TWO_BRANCHES,
      app({ ref: 'GR-9', status: 'paid', fee: 1384.61, sentAt: D('2026-05-02'), paidAt: D('2026-05-05'),
        refunded: true, refundedAt: D('2026-05-20'), refundedAmount: 1384.61 }),
    ]);
    const row = appRows(AGENCY_ROLE).find((r) => r['Guarantee reference'] === 'GR-9')!;
    expect(row['Refund amount']).toBe('£1,384.61');
  });
});

describe('an expiry date needs a deed', () => {
  beforeEach(() => hydrateFull(TWO_BRANCHES));
  afterAll(() => hydrateFull([]));

  it('is blank while the guarantee has not been issued, even with a stored date', () => {
    const rows = appRows(AGENCY_ROLE);
    const paidOnly = rows.find((r) => r['Guarantee reference'] === 'GR-3')!;
    expect(paidOnly.Status).toBe('Paid');
    expect(paidOnly['Tenancy start date']).toBe('15/06/2026');
    expect(paidOnly['Expiry date']).toBe('');
  });

  it('is shown once the deed exists, for each tenant of a joint tenancy', () => {
    const rows = appRows(AGENCY_ROLE);
    // Both siblings hold their own deed now, so both carry their own expiry.
    expect(rows.find((r) => r['Guarantee reference'] === 'GR-1')!['Expiry date']).toBe('31/05/2027');
    expect(rows.find((r) => r['Guarantee reference'] === 'GR-2')!['Expiry date']).toBe('31/05/2027');
  });
});

describe('the agency reads their own name where the estate used to be', () => {
  beforeEach(() => hydrateFull(TWO_BRANCHES));
  afterAll(() => hydrateFull([]));

  it('names the agency in the meta line of every document they can open', () => {
    for (const built of [
      buildLivePerformanceDoc(AGENCY_ROLE, allTime),
      buildPerformanceDoc(AGENCY_ROLE, allTime),
      buildRealApplicationDoc(AGENCY_ROLE, allTime, 'referred', BASIS_META.referred),
      buildApplicationDoc(AGENCY_ROLE, allTime, 'referred')!,
      buildLeagueDoc(AGENCY_ROLE, 'northwind', '', allTime),
    ]) {
      expect(built.sheets[0].doc.metaLine).toContain("Regent's Lettings");
    }
  });

  it('carries their own commission column, and no partner one', () => {
    const heads = columnsOf(buildRealApplicationDoc(AGENCY_ROLE, allTime, 'referred', BASIS_META.referred)).map((c) => c.header);
    expect(heads).toContain('Commission');
    expect(heads).not.toContain('Agent commission');
    expect(heads).not.toContain('Partner commission');
    expect(heads).not.toContain('Partner');
  });
});
