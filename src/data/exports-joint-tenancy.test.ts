/* A JOINT TENANCY, THROUGH THE EXPORTS.

   Every export was written when a guarantee was one tenant paying one month's
   rent, and both halves of that stopped being true at once. A two-person let
   priced at five weeks produced, in a single spreadsheet: a Guarantor fee column
   showing the rent, a Monthly rent column silently repeated on both rows so the
   book appeared to double, a conversion rate of 50% because one deed covers two
   applicants, and no column anywhere saying the two rows were one let.

   This locks what a reader can now do with the file: sum the fee column and get
   the tenancy fee, sum the share-of-rent column and get the rent, and tell at a
   glance which rows belong together and which tenant signs. */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { BASIS_META } from '@/data';
import { buildRealApplicationDoc, buildExpiriesCsv } from '@/data/exportsService';
import { getPeriods } from '@/data';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

const LINES = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 2400, feeBasisWeeks: 5, commissionLines: LINES,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

/* £2,400 a month, two tenants, five weeks of rent for the tenancy = £2,769.23,
   split 50/50 to the penny. Only the LEAD reaches Deed Issued: one deed. */
const APPS: FullApp[] = [
  app({ ref: 'GR-1', status: 'deed', fee: 1384.62, sharePercent: 50, shareAmount: 1200,
    tenancyId: 'T1', tenancyPosition: 1,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: D('2026-05-06'),
    tenancyStart: D('2026-06-01'), expiry: D('2027-06-01') }),
  app({ ref: 'GR-2', status: 'paid', fee: 1384.61, sharePercent: 50, shareAmount: 1200,
    tenancyId: 'T1', tenancyPosition: 2,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04') }),
];

hydrateFull(APPS);
afterAll(() => hydrateFull([]));

/** The application export's single table. */
function appTable() {
  const doc = buildRealApplicationDoc('superadmin', allTime, 'referred', BASIS_META.referred);
  return doc.sheets[0].doc.blocks.find((b) => b.kind === 'table') as
    { kind: 'table'; columns: { header: string }[]; rows: (string | number)[][] };
}
/** ...as { header: value } per row. */
function appRows() {
  const table = appTable();
  const heads = table.columns.map((c) => c.header);
  return table.rows.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}
const appHeaders = () => appTable().columns.map((c) => c.header);

describe('the application export, for a joint tenancy', () => {
  const rows = appRows();
  const lead = rows.find((r) => r['Guarantee reference'] === 'GR-1')!;
  const second = rows.find((r) => r['Guarantee reference'] === 'GR-2')!;

  it('is one row per applicant, as it always was', () => {
    expect(rows).toHaveLength(2);
  });

  it('lines every row up with the header, whichever columns survive', () => {
    // Three columns now come and go with the book (Agency, Branch, Commission
    // payees), and a row built from a different list than the header is a file
    // where every value after the gap belongs to the wrong column.
    const table = appTable();
    for (const r of table.rows) expect(r).toHaveLength(table.columns.length);
  });

  it('says which tenancy each row belongs to, and where in it', () => {
    expect(lead['Tenancy ID']).toBe('T1');
    expect(lead['Tenancy position']).toBe('1 of 2');
    expect(second['Tenancy position']).toBe('2 of 2');
  });

  it('says what each tenant has actually reached, per row, and names no lead', () => {
    /* THERE IS NO LEAD TENANT COLUMN ANY MORE. It read Yes on position 1 and No
       on the rest, and it named something real while one deed covered a whole
       let and only the lead ever reached Deed Issued. Each tenant now signs
       their own deed over their own share, so "No" said nothing a reader could
       act on: whether THIS tenant's deed exists is Status and Deed issued date,
       on this tenant's own row, which is what the two rows below show. */
    expect(appHeaders()).not.toContain('Lead tenant');
    expect(lead.Status).toBe('Deed Issued');
    expect(second.Status).toBe('Paid');
    // Position in the tenancy is still stated, where it belongs.
    expect(lead['Tenancy position']).toBe('1 of 2');
  });

  it('charges each applicant their own share, and the shares sum to the tenancy fee', () => {
    expect(lead['Guarantor fee charged']).toBe(1384.62);
    expect(second['Guarantor fee charged']).toBe(1384.61);
    const summed = rows.reduce((s, r) => s + Number(r['Guarantor fee charged']), 0);
    expect(Math.round(summed * 100) / 100).toBe(2769.23);
    // ...and the total is stated outright on every row, so the two agree.
    expect(lead['Tenancy total fee']).toBe(2769.23);
    expect(second['Tenancy total fee']).toBe(2769.23);
  });

  /* THE COLUMN AND THE CELL BOTH CHANGED ON 2026-10-02. It was "Fee
     basis (weeks of rent)" over a bare number, which printed 4.35 for a
     one-month deal -- one month written as the number of weeks in one,
     which nobody reading a spreadsheet takes for a month. Matt: "show '1
     month' for one month's rent, and weeks only where the deal is in
     weeks (e.g. '5 weeks')." The cell states its unit and the heading
     stops promising one. Five weeks is still five weeks. */
  it('says the fee basis, so a reader can see WHY it is not a month', () => {
    expect(lead['Fee basis']).toBe('5 weeks');
    expect(lead['Share of tenancy']).toBe('50%');
  });

  it('names the rent column for what it is, and gives a summable one beside it', () => {
    // Both rows carry the WHOLE let's rent: correct per row, catastrophic summed.
    expect(lead['Monthly rent (whole tenancy)']).toBe(2400);
    expect(second['Monthly rent (whole tenancy)']).toBe(2400);
    // The share IS summable, and sums to the rent.
    expect(rows.reduce((s, r) => s + Number(r['Share of rent']), 0)).toBe(2400);
  });

  it('pays commission off the frozen lines, to the penny', () => {
    // 25%, on what each applicant paid. Only paid, non-refunded rows earn.
    // 1384.62 x 0.25 is 346.155, and the cell is the PENNY figure: every money
    // cell in every export is rounded once, by the one formatter, because a
    // column of half-pennies foots to a payment nobody can make.
    expect(lead['Agent commission']).toBe(346.16);
    /* TWO RATE COLUMNS SINCE 2026-10-02, and this is the agent's. One
       column headed "Commission rate" sat beside two commission AMOUNTS
       and could only ever be one of them, so a reader checking the
       supplier figure against it was dividing by the wrong number. */
    expect(lead['Agent commission rate']).toBe(0.25);
    expect(lead['Supplier commission rate']).toBe(0);
  });

  it('leaves out the payees column while every line has one payee', () => {
    /* It repeated the agency's own name and their own rate on every row, which
       the Commission rate column beside it already gives. The column comes back
       the moment a row splits between a group and an agency, which is the only
       time it says anything. */
    expect(appHeaders()).not.toContain('Commission payees');
  });

  it('leaves out the Agency and Branch columns over one agency and one branch', () => {
    // The same rule, from the same predicate (viewerShape), as the Applications
    // table these rows are exported from: a column of one repeated word.
    expect(appHeaders()).not.toContain('Agency');
    expect(appHeaders()).not.toContain('Branch');
  });

  it('pays no partner commission on the agent rail, whatever partner_rate says', () => {
    // partnerRate is 0.25 on both fixtures: populated, and owed to nobody.
    expect(lead['Partner commission']).toBe(0);
    expect(second['Partner commission']).toBe(0);
  });
});

describe('the expiries CSV', () => {
  /* The LIVE branch of buildExpiriesCsv is unreachable here: it is gated on
     liveAvailable(), which needs Supabase, and test mode runs the synthetic
     generator instead. What is testable — and what actually changed — is the
     column contract, which is built before the branch and shared by both. The
     live rows are proved on dev. */
  const out = buildExpiriesCsv('superadmin', 2027, 5)!;
  const head = out.csv.split('\n').find((l) => l.includes('Guarantee reference'))!;

  it('carries the tenancy columns an operator needs to chase the right people', () => {
    // Without a tenant count, someone chasing a two-person expiry rings one of
    // them and stops; the guarantee names both.
    expect(head).toContain('Tenants on the guarantee');
    /* "Joint with" REPLACED "Tenancy ID" on 2026-10-02. The id was a
       join key printed because it was the only thing saying "this row
       has siblings"; an operator chasing the right people wants the
       siblings' references, which is what the column holds now. Matt:
       'replace the Tenancy ID code with "Joint with" listing the other
       tenants' guarantee references (blank for single tenancies)'. */
    expect(head).toContain('Joint with');
    expect(head).not.toContain('Tenancy ID');
  });

  it('names the rent and the fee as the WHOLE tenancy’s, because they are', () => {
    expect(head).toContain('Monthly rent (whole tenancy)');
    expect(head).toContain('Guarantee fee (whole tenancy)');
    /* AND THE COLUMN BESIDE THEM IS THE TENANT'S, which it never said:
       guaranteedAnnual reads share_amount, so on a joint let the
       annualised figure is a share sitting next to two whole-tenancy
       ones with nothing to tell them apart. */
    expect(head).toContain("Annualised rent (this tenant's share)");
  });
});

/* THE POSITIVE HALF OF EACH COLLAPSE RULE.
 *
 * Fold F2 drops the Agency, Branch and Commission payees columns when they
 * say the same thing on every line. Everything above asserts that they GO.
 * Nothing asserted that they COME BACK, and a rule that only ever removes is
 * satisfied by deleting the columns outright -- which would pass every
 * assertion in this file while losing the agency's name from an export that
 * spans two agencies.
 *
 * Each block below hydrates a book where the column earns its place, and
 * restores the file's own book afterwards so the assertions above keep
 * reading what they were written against.
 */
describe('the same columns, over a book that needs them', () => {
  afterEach(() => hydrateFull(APPS));

  it('brings Agency and Branch back when the book holds two of each', () => {
    hydrateFull([
      ...APPS,
      app({ ref: 'GR-3', status: 'paid', agency: 'Northgate Lettings', agencyId: 'ag-n',
        branch: 'Northgate Central', sentAt: D('2026-05-02'), paidAt: D('2026-05-05') }),
    ]);
    expect(appHeaders()).toContain('Agency');
    expect(appHeaders()).toContain('Branch');
  });

  it('and leaves them out again the moment the second agency goes', () => {
    // The pair, so the assertion above cannot pass by the column being
    // unconditional after all.
    hydrateFull(APPS);
    expect(appHeaders()).not.toContain('Agency');
  });

  it('brings Commission payees back when a row pays more than one party', () => {
    hydrateFull([
      app({ ref: 'GR-4', status: 'paid', sentAt: D('2026-05-02'), paidAt: D('2026-05-05'),
        commissionLines: [
          { level: 'group', orgId: 'gr-1', orgName: 'Regent Group', rate: 0.05, source: 'agreement' },
          { level: 'agency', orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.2, source: 'agreement' },
        ] }),
    ]);
    expect(appHeaders()).toContain('Commission payees');
  });
});
