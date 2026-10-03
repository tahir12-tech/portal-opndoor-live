/* THE EXPORTS, WHICH ARE THE HOLE A GATED SCREEN DOES NOT CLOSE.
 *
 * Reporting's four export controls hand a Manager a file, and a file outlives
 * the screen it came off: it is emailed, kept and reconciled. So the rule has to
 * be held in the BUILDERS, not on the buttons, and it cuts both ways here.
 *
 * WHAT WENT WRONG IN BOTH DIRECTIONS. The application export carried Partner
 * commission, Agent commission and Commission rate columns computed straight off
 * the row (fee x the snapshotted rate): nothing upstream zeroed them, so a
 * Manager downloading their own referrals got the agency's income per
 * application, to the penny, with the rate beside it. And the first attempt at
 * the fix went too far the other way: four gates asked maySeeCommission to decide
 * who may open a DOCUMENT, so the moment a Manager stopped satisfying that
 * predicate they lost the agency breakdown, the league workbook and the whole
 * application export, which is the list of their own referrals. Losing a file is
 * not a smaller fault than leaking a column; it is the level being taken away.
 *
 * So every case below is a pair: the commission columns and blocks are absent for
 * a Manager, and the document is still THERE with its referrals, fees, volumes
 * and conversion in it. The Director beside them proves the figures exist to be
 * dropped.
 *
 * STAGING A MANAGER. maySeeCommission('management') returns the module-level
 * SEES_COMMISSION, which DEFAULTS TO TRUE so that mock and demo mode do not blank
 * every Director. A test that sets role 'management' and stops has staged a
 * Director and asserts nothing, so each case calls hydrateCommissionVisibility
 * explicitly and afterEach puts the module default back: it is shared state, and
 * a Director staged in another file in the same worker would silently become a
 * Manager.
 *
 * No Supabase: buildLivePerformanceDoc and buildRealApplicationDoc are exported
 * for exactly this reason (the live path is the one that ships, and liveAvailable
 * cannot be satisfied in a unit test), and with SUPABASE_ENABLED false the
 * statement builder's stored-reference lookup answers without a client.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCommissionStatements, getPeriods, hydrateCommissionVisibility, setHomePartner, statementMonths } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import {
  buildAgentStatementDoc, buildApplicationDoc, buildCommissionStatementDoc, buildExpiriesDoc,
  buildLeagueDoc, buildLivePerformanceDoc, buildPartnerStatementDoc, type BrandedExport,
} from '@/data/exportsService';
import { BASIS_META } from '@/data/exportsService';
import { buildRealApplicationDoc } from '@/data/exportsService';

const allTime = getPeriods().find((p) => p.id === 'alltime')!;
/* 'northwind' is opndoor_referenced in the mock partner seed, which makes a
   'management' user one of OUR agencies (the level's own case). 'harbourside' is
   a plain supplier: their staff are role 'management' too and are not an agency,
   so they keep the partner columns an agency never sees, and they are the reader
   who proves the cut is the commission and not the partner. */
const AGENCY_PARTNER = 'northwind';
const SUPPLIER_PARTNER = 'harbourside';
const MANAGEMENT = 'management' as const;

const D = (s: string) => new Date(s);
const LINES = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: AGENCY_PARTNER, partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 1661.54, feeBasisWeeks: 3, commissionLines: LINES,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
    ...o,
  };
}

/* May 2026 is the prior calendar month against the mock reference date
   (2026-06-26), which is the month every settlement and statement surface
   answers for. Two branches so the breakdowns a Manager keeps have more than one
   row to draw. */
function book(partner = AGENCY_PARTNER): FullApp[] {
  return [
    app({ ref: 'GR-E1', partner, status: 'deed', sentAt: D('2026-05-01'), paidAt: D('2026-05-04'),
      deedAt: D('2026-05-06'), tenancyStart: D('2026-06-01'), expiry: D('2027-05-31') }),
    app({ ref: 'GR-E2', partner, status: 'deed', branch: 'Marylebone', branchId: 'br-my',
      sentAt: D('2026-05-10'), paidAt: D('2026-05-12'), deedAt: D('2026-05-14'),
      tenancyStart: D('2026-06-15'), expiry: D('2027-06-14') }),
  ];
}

beforeEach(() => {
  setHomePartner(AGENCY_PARTNER);
  hydrateFull(book());
});
afterEach(() => {
  // The module default, or a Director in the next file becomes a Manager.
  hydrateCommissionVisibility(true);
  setHomePartner(AGENCY_PARTNER);
});
afterAll(() => hydrateFull([]));

function beManager(): void { hydrateCommissionVisibility(false); }
function beDirector(): void { hydrateCommissionVisibility(true); }

/* ---- walking a built document ----------------------------------------------
   Every header, label and section title in it, and separately every table cell,
   so a commission figure cannot hide in a column whose heading says something
   else, or in a heading over an empty table. */
function headers(built: BrandedExport): string[] {
  return built.sheets.flatMap((s) => s.doc.blocks.flatMap((b) => (b.kind === 'table' ? b.columns.map((c) => c.header) : [])));
}
function labels(built: BrandedExport): string[] {
  return built.sheets.flatMap((s) => s.doc.blocks.flatMap((b) => {
    if (b.kind === 'keyvalue') return b.items.map((i) => i.label);
    if (b.kind === 'section') return [b.title];
    return [];
  }));
}
/** Every word the document says anywhere: headers, labels, section titles, the
    meta line, and every text cell. The backstop for a surface nobody listed. */
function words(built: BrandedExport): string {
  const cells = built.sheets.flatMap((s) => s.doc.blocks.flatMap((b) => (b.kind === 'table' ? b.rows.flat().map(String) : b.kind === 'keyvalue' ? b.items.map((i) => String(i.value)) : [])));
  return [...headers(built), ...labels(built), ...cells, ...built.sheets.map((s) => s.doc.metaLine), ...built.sheets.map((s) => s.doc.reportName)].join(' | ');
}
function tableRows(built: BrandedExport): (string | number)[][] {
  return built.sheets.flatMap((s) => s.doc.blocks.flatMap((b) => (b.kind === 'table' ? b.rows : [])));
}
const mentionsCommission = (built: BrandedExport) => /commission/i.test(words(built));

describe('the performance export', () => {
  it('carries no commission block, total or rate for a Manager', () => {
    beManager();
    const built = buildLivePerformanceDoc(MANAGEMENT, allTime);
    expect(mentionsCommission(built)).toBe(false);
    // Not a single money line labelled as earnings, and no settlement section:
    // "what you are owed" has no version that is not money.
    expect(labels(built).some((l) => /settlement/i.test(l))).toBe(false);
  });

  it('still gives that Manager the summary, the breakdowns and the trend', () => {
    /* The document is theirs. Only its earnings come off, and what is left has
       to be a performance export rather than a husk of one. */
    beManager();
    const built = buildLivePerformanceDoc(MANAGEMENT, allTime);
    expect(built.sheets).toHaveLength(1);
    expect(labels(built)).toEqual(expect.arrayContaining(['Referrals sent', 'Deeds issued']));
    expect(labels(built)).toEqual(expect.arrayContaining(['Breakdown by branch', 'Monthly trend (last 12 months)']));
    // Fees collected is the tenant's price, not our income, and it stays.
    expect(headers(built)).toContain('Fees collected');
    expect(tableRows(built).length).toBeGreaterThan(0);
  });

  it('gives their Director the same document with the earnings in it', () => {
    beDirector();
    const built = buildLivePerformanceDoc(MANAGEMENT, allTime);
    expect(mentionsCommission(built)).toBe(true);
    expect(labels(built).some((l) => /Commission settlement/i.test(l))).toBe(true);
    expect(labels(built).some((l) => /Commission payable to/i.test(l))).toBe(true);
    // And the same summary the Manager kept, so the two differ in exactly one thing.
    expect(labels(built)).toEqual(expect.arrayContaining(['Referrals sent', 'Deeds issued']));
  });
});

describe('the application export', () => {
  const meta = BASIS_META.paid;

  it('drops the three commission columns and keeps the fee the tenant paid', () => {
    /* THE WORST OF THE FOUR, because nothing upstream defended it: these cells
       are computed here, from the row's own snapshotted rate, so the columns were
       the agency's income per application with the rate beside it. The fee stays:
       it is what the tenant was charged, on a referral this Manager owns. */
    beManager();
    const built = buildRealApplicationDoc(MANAGEMENT, allTime, 'paid', meta);
    const h = headers(built);
    expect(h).not.toContain('Commission');
    expect(h).not.toContain('Agent commission');
    expect(h).not.toContain('Supplier commission');
    expect(h).not.toContain('Commission rate');
    expect(h).not.toContain('Commission payees');
    expect(mentionsCommission(built)).toBe(false);
    // Still the list of their own referrals, with every fact about them on it.
    expect(h).toEqual(expect.arrayContaining(['Guarantee reference', 'Status', 'Guarantee fee charged', 'Monthly rent (whole tenancy)']));
    expect(tableRows(built)).toHaveLength(2);
  });

  it('keeps those columns for their Director, with a figure and a rate in them', () => {
    beDirector();
    const built = buildRealApplicationDoc(MANAGEMENT, allTime, 'paid', meta);
    const h = headers(built);
    expect(h).toContain('Commission');
    expect(h).toContain('Commission rate');
    const row = tableRows(built)[0];
    // The figure is real, not a zero the Manager could have been shown instead:
    // 25% of a £1,661.54 fee.
    expect(row[h.indexOf('Commission')]).toBeCloseTo(415.39, 2);
    expect(row[h.indexOf('Commission rate')]).toBeCloseTo(0.25, 4);
  });

  it('is not refused to a Manager outright, which is the fix that overshot', () => {
    // buildApplicationDoc gates the DOCUMENT on seesEveryReferral, not on the
    // commission predicate: asking the predicate here left the Applications
    // export button downloading nothing for the level that runs the branch.
    beManager();
    expect(buildApplicationDoc(MANAGEMENT, allTime, 'paid')).not.toBeNull();
    // And a Negotiator is still refused it, as they always were.
    expect(buildApplicationDoc('referrer', allTime, 'paid')).toBeNull();
  });
});

describe('the league workbook', () => {
  it('loses its commission columns and keeps all three boards', () => {
    /* The boards ARE a Manager's job: every branch and every member of the team.
       Refusing the workbook is right for a Negotiator, who may not read other
       people's boards at all, and wrong for a Manager. */
    beManager();
    const built = buildLeagueDoc(MANAGEMENT, AGENCY_PARTNER, '', allTime);
    expect(built.sheets.map((s) => s.name)).toEqual(['Agencies', 'Branches', 'Referrers']);
    expect(mentionsCommission(built)).toBe(false);
    expect(headers(built)).toEqual(expect.arrayContaining(['Referrals', 'Fees collected']));
  });

  it('keeps them for their Director', () => {
    beDirector();
    const built = buildLeagueDoc(MANAGEMENT, AGENCY_PARTNER, '', allTime);
    expect(mentionsCommission(built)).toBe(true);
    expect(built.sheets.map((s) => s.name)).toEqual(['Agencies', 'Branches', 'Referrers']);
  });
});

describe('the three commission statements', () => {
  /* These are not documents with commission in them, they ARE commission: a
     payee, a month, a rate per line and a total payable. There is nothing to
     narrow, so each refuses whole, and a refused export downloads nothing rather
     than an empty workbook (exportBranded returns early on no sheets). */
  const refused = (built: BrandedExport) => {
    expect(built.sheets).toHaveLength(0);
    expect(built.filename).toMatch(/unavailable$/);
  };

  it('refuse a Manager the partner and agent statements', async () => {
    beManager();
    refused(await buildPartnerStatementDoc(MANAGEMENT, SUPPLIER_PARTNER, SUPPLIER_PARTNER));
    refused(await buildAgentStatementDoc(MANAGEMENT, AGENCY_PARTNER, AGENCY_PARTNER, "Regent's Lettings"));
  });

  it('refuse a Manager the month statement, and build it for their Director', async () => {
    /* The month and the payee are read off the Director's own statement rather
       than spelled out here: a payee key is an identity the accumulator owns, and
       a test that hard-codes one passes for the wrong reason the day it changes
       shape (an empty document is refused too). */
    beDirector();
    const months = statementMonths(MANAGEMENT, AGENCY_PARTNER);
    expect(months.length, 'no statement month in the staged book').toBeGreaterThan(0);
    const monthKey = months[0].key;
    const payee = getCommissionStatements(MANAGEMENT, AGENCY_PARTNER, monthKey)[0];
    expect(payee, 'no payee in the staged book').toBeTruthy();

    const asDirector = await buildCommissionStatementDoc(MANAGEMENT, AGENCY_PARTNER, monthKey, payee.payeeKey);
    expect(asDirector.sheets.length, 'the Director must get a statement, or the refusal proves nothing').toBe(1);
    expect(headers(asDirector)).toEqual(expect.arrayContaining(['Rate', 'Commission']));

    beManager();
    refused(await buildCommissionStatementDoc(MANAGEMENT, AGENCY_PARTNER, monthKey, payee.payeeKey));
    // And refused at the model behind it, for a caller that reaches past the builder.
    expect(getCommissionStatements(MANAGEMENT, AGENCY_PARTNER, monthKey)).toEqual([]);
  });

  it('give a Manager no months to ask for in the first place', () => {
    /* The month list is itself a commission surface: it says when there was
       money and how far back the ledger runs, and every entry on it opens a
       statement. */
    beManager();
    expect(statementMonths(MANAGEMENT, AGENCY_PARTNER)).toEqual([]);
  });
});

describe("a supplier's Manager, who is not an agency", () => {
  beforeEach(() => {
    setHomePartner(SUPPLIER_PARTNER);
    hydrateFull(book(SUPPLIER_PARTNER));
  });

  it('loses the commission columns and nothing else', () => {
    /* A supplier partner's staff hold role 'management' as well, and the level
       split is not about them: what has to come off their file is the earnings,
       and nothing that is merely OURS. The Partner column stays, because a
       supplier's own document is about the partner. */
    beManager();
    const built = buildRealApplicationDoc(MANAGEMENT, allTime, 'paid', BASIS_META.paid);
    expect(mentionsCommission(built)).toBe(false);
    expect(headers(built)).toContain('Supplier');
    expect(headers(built)).toContain('Guarantee fee charged');
    expect(tableRows(built)).toHaveLength(2);
  });

  it('loses Commission by supplier from the performance export, and their Director keeps it', () => {
    beManager();
    const asManager = buildLivePerformanceDoc(MANAGEMENT, allTime);
    expect(labels(asManager).some((l) => /Commission by supplier/i.test(l))).toBe(false);
    expect(mentionsCommission(asManager)).toBe(false);

    beDirector();
    const asDirector = buildLivePerformanceDoc(MANAGEMENT, allTime);
    expect(labels(asDirector).some((l) => /Commission by supplier/i.test(l))).toBe(true);
  });
});

describe('the expiries file, which has no commission in it at all', () => {
  it('is unchanged for a Manager, because gating it would take away the level', () => {
    /* A cohort of guarantees about to lapse is renewal work, and renewal work is
       exactly what a Manager is for. It states no earnings, so the predicate has
       no business here and buildExpiriesDoc asks the two-role question instead. */
    beManager();
    const asManager = buildExpiriesDoc(MANAGEMENT, 2027, 4);
    expect(asManager).not.toBeNull();
    const text = (b: NonNullable<typeof asManager>) => JSON.stringify(b.sheets);
    expect(text(asManager!)).toMatch(/Guarantee reference/);
    expect(text(asManager!)).not.toMatch(/commission/i);
    beDirector();
    const asDirector = buildExpiriesDoc(MANAGEMENT, 2027, 4);
    expect(text(asDirector!)).toBe(text(asManager!));
  });
});
