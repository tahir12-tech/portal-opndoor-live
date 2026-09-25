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
import { afterAll, describe, expect, it } from 'vitest';
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

/** The application export's single table, as { header: value } per row. */
function appRows() {
  const doc = buildRealApplicationDoc('superadmin', allTime, 'referred', BASIS_META.referred);
  const table = doc.sheets[0].doc.blocks.find((b) => b.kind === 'table') as
    { kind: 'table'; columns: { header: string }[]; rows: (string | number)[][] };
  const heads = table.columns.map((c) => c.header);
  return table.rows.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

describe('the application export, for a joint tenancy', () => {
  const rows = appRows();
  const lead = rows.find((r) => r['Guarantee reference'] === 'GR-1')!;
  const second = rows.find((r) => r['Guarantee reference'] === 'GR-2')!;

  it('is one row per applicant, as it always was', () => {
    expect(rows).toHaveLength(2);
  });

  it('says which tenancy each row belongs to, and where in it', () => {
    expect(lead['Tenancy ID']).toBe('T1');
    expect(lead['Tenancy position']).toBe('1 of 2');
    expect(second['Tenancy position']).toBe('2 of 2');
  });

  it('names the tenant who signs, which is why only they reach Deed Issued', () => {
    expect(lead['Lead tenant']).toBe('Yes');
    expect(second['Lead tenant']).toBe('No');
    expect(lead.Status).toBe('Deed Issued');
    expect(second.Status).toBe('Paid');
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

  it('says the fee basis, so a reader can see WHY it is not a month', () => {
    expect(lead['Fee basis (weeks of rent)']).toBe('5');
    expect(lead['Share of tenancy']).toBe('50%');
  });

  it('names the rent column for what it is, and gives a summable one beside it', () => {
    // Both rows carry the WHOLE let's rent: correct per row, catastrophic summed.
    expect(lead['Monthly rent (whole tenancy)']).toBe(2400);
    expect(second['Monthly rent (whole tenancy)']).toBe(2400);
    // The share IS summable, and sums to the rent.
    expect(rows.reduce((s, r) => s + Number(r['Share of rent']), 0)).toBe(2400);
  });

  it('pays commission off the frozen lines and names the payees', () => {
    // 25%, on what each applicant paid. Only paid, non-refunded rows earn.
    expect(lead['Agent commission']).toBeCloseTo(1384.62 * 0.25, 6);
    expect(lead['Commission rate']).toBe(0.25);
    expect(lead['Commission payees']).toBe("Regent's Lettings 25%");
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
    expect(head).toContain('Tenancy ID');
  });

  it('names the rent and the fee as the WHOLE tenancy’s, because they are', () => {
    expect(head).toContain('Monthly rent (whole tenancy)');
    expect(head).toContain('Guarantor fee (whole tenancy)');
  });
});
