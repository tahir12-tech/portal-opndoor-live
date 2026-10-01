/* THE STATEMENT AND THE SETTLEMENT ARE THE SAME NUMBER.

   An agency reads its commission off a statement; Opndoor pays it off a
   settlement. If those two ever differ by a penny the conversation that follows
   is not about a rounding error, it is about whether we are paying what we say.

   They are the same code — accruePayees — so this suite is not testing that two
   implementations agree. It is testing that the CONTRACT holds at the seam:
   same window (the prior calendar month), same exclusions (refunds out), same
   per-payee split, and that the statement's per-line detail sums to the
   settlement's single figure rather than merely resembling it.

   The fixture is deliberately the hard shape: a joint tenancy priced once and
   split by share, an additive split with a group taking a cut above the agency,
   a refund inside the month, and a payment in the wrong month. */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import {
  getAgentCommissionSettlement, getCommissionStatements, statementMonths,
} from '@/data/liveAnalytics';

const D = (s: string) => new Date(s);

/* Test mode's fixed "now" is 2026-06-26, so the settlement month is May 2026. */
const MAY = '2026-05';

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'status'>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.25, agentRate: 0.1,
    agency: 'Foxglove', branch: 'South Kensington', referrer: 'Priya', owner: 0,
    fee: o.rent, sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

/* A joint tenancy on £2,400 a month at Regent's terms: five weeks of rent for
   the tenancy (£2,769.23), split 50/50 to the penny, 25% by agreement, with a
   group taking 3% above them. Each applicant's own fee is the basis for their
   own lines, so the two tenants' lines sum to the tenancy's commission. */
const JOINT_LINES = [
  { level: 'agency' as const, orgId: 'ag-regent', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const },
  { level: 'group' as const, orgId: 'gp-regent', orgName: 'Regent Group', rate: 0.03, source: 'rate' as const },
];

const APPS: FullApp[] = [
  // The tenancy: two applicants, one fee, split to the penny.
  app({ ref: 'J1', rent: 2400, fee: 1384.62, status: 'paid', paidAt: D('2026-05-06'),
    agency: "Regent's Lettings", agencyId: 'ag-regent', branch: "Regent's Park",
    tenancyId: 'ten-1', tenancyPosition: 1, sharePercent: 50, commissionLines: JOINT_LINES }),
  app({ ref: 'J2', rent: 2400, fee: 1384.61, status: 'paid', paidAt: D('2026-05-06'),
    agency: "Regent's Lettings", agencyId: 'ag-regent', branch: "Regent's Park",
    tenancyId: 'ten-1', tenancyPosition: 2, sharePercent: 50, commissionLines: JOINT_LINES }),
  // A single tenant of the same agency, three weeks, 20%.
  app({ ref: 'S1', rent: 2400, fee: 1661.54, status: 'paid', paidAt: D('2026-05-20'),
    agency: "Regent's Lettings", agencyId: 'ag-regent', branch: "Regent's Park",
    commissionLines: [
      { level: 'agency', orgId: 'ag-regent', orgName: "Regent's Lettings", rate: 0.20, source: 'agreement' },
      { level: 'group', orgId: 'gp-regent', orgName: 'Regent Group', rate: 0.03, source: 'rate' },
    ] }),
  // Refunded inside the month: earns nothing, appears nowhere.
  app({ ref: 'X1', rent: 2000, fee: 2000, status: 'paid', paidAt: D('2026-05-11'),
    refunded: true, refundedAt: D('2026-05-14'), refundedAmount: 2000,
    agency: "Regent's Lettings", agencyId: 'ag-regent', branch: "Regent's Park",
    commissionLines: [{ level: 'agency', orgId: 'ag-regent', orgName: "Regent's Lettings", rate: 0.20, source: 'agreement' }] }),
  // Paid in April: a different month's statement.
  app({ ref: 'A1', rent: 1000, fee: 1000, status: 'paid', paidAt: D('2026-04-15'),
    agency: 'Harborview Lettings', agencyId: 'ag-harbor', branch: 'Brighton Marina',
    commissionLines: [{ level: 'agency', orgId: 'ag-harbor', orgName: 'Harborview Lettings', rate: 0.10, source: 'standard' }] }),
];

hydrateFull(APPS);
afterAll(() => hydrateFull([]));

const p2 = (n: number) => Math.round(n * 100) / 100;

describe('the statement foots to the settlement', () => {
  const settlement = getAgentCommissionSettlement('superadmin', ALL_PARTNERS);
  const statements = getCommissionStatements('superadmin', ALL_PARTNERS, MAY);

  it('covers the same month', () => {
    expect(settlement.monthLabel).toBe('May 2026');
    expect(statements[0].monthLabel).toBe('May 2026');
  });

  it('has one statement per settlement payee, and no others', () => {
    expect(statements.map((s) => s.payeeKey).sort())
      .toEqual(settlement.payees.map((p) => p.key).sort());
  });

  it('every payee total matches the settlement payee, to the penny', () => {
    for (const p of settlement.payees) {
      const st = statements.find((s) => s.payeeKey === p.key)!;
      expect(p2(st.total)).toBe(p2(p.commission));
    }
  });

  it('and the statement lines sum to their own total', () => {
    for (const st of statements) {
      expect(p2(st.lines.reduce((s, l) => s + l.commission, 0))).toBe(p2(st.total));
    }
  });

  it('the grand total matches the settlement total', () => {
    expect(p2(statements.reduce((s, st) => s + st.total, 0))).toBe(p2(settlement.total));
  });
});

describe('what a statement line says', () => {
  const statements = getCommissionStatements('superadmin', ALL_PARTNERS, MAY);
  const agency = statements.find((s) => s.level === 'agency')!;
  const group = statements.find((s) => s.level === 'group')!;

  it('names the payee, never the partner behind it', () => {
    /* THE HOUSE PARTNER MUST NOT REACH A CUSTOMER'S STATEMENT. Asserted over
       every DISPLAYED string, which is the surface the rule is about. payeeKey
       is excluded deliberately: it is an opaque identity used to match a
       statement to its settlement line, is namespaced by partner so two
       same-named agencies under different partners never merge, and is never
       rendered. If it ever is rendered, this assertion is the wrong one to
       relax — the rendering is. */
    expect(agency.payeeName).toBe("Regent's Lettings");
    const shown = statements.flatMap((st) => [
      st.payeeName, st.monthLabel,
      ...st.lines.flatMap((l) => [l.ref, l.tenant, l.branch, l.tenancyPlace, l.source ?? '']),
    ]).join(' | ');
    expect(shown).not.toMatch(/opndoor-agents|Opndoor Agents|northwind|Northwind/i);
  });

  it('carries the fee THIS applicant paid, not the tenancy fee', () => {
    const j1 = agency.lines.find((l) => l.ref === 'J1')!;
    const j2 = agency.lines.find((l) => l.ref === 'J2')!;
    expect(j1.fee).toBe(1384.62);
    expect(j2.fee).toBe(1384.61);
    // ...and the two together are the tenancy's five-week fee.
    expect(p2(j1.fee + j2.fee)).toBe(2769.23);
  });

  /* CHANGED 2026-10-01, and the old assertion is why the change was
     asked for. It pinned "1 of 2" and, for a solo let, the EMPTY
     STRING: the column answered "which tenant is this" and said nothing
     at all for the common case.

     Matt: 'The Tenancy column shows "Single" for one tenant, or "Joint
     (2)", "Joint (3)" and so on with the number of tenants on that
     tenancy, instead of "1 of 2" and "-".' On a commission statement the
     payee is reconciling money: what they need is whether this fee is a
     whole let or a share of a joint one. The position made them work
     out that two more lines exist somewhere.

     AND IT IS NEVER EMPTY NOW, which is the half worth asserting
     separately: the drop-empty-column rule would otherwise remove the
     column on any statement of solo lets. */
  it('says what KIND of let each line is', () => {
    const j1 = agency.lines.find((l) => l.ref === 'J1')!;
    expect(j1.tenancyId).toBe('ten-1');
    expect(j1.tenancyPlace).toBe('Joint (2)');
    expect(j1.sharePercent).toBe(50);
    // A solo let says so, rather than saying nothing.
    expect(agency.lines.find((l) => l.ref === 'S1')!.tenancyPlace).toBe('Single');
  });

  it('and the other half of the joint tenancy says the same thing, not its own position', () => {
    // "1 of 2" and "2 of 2" differed; both lines are the same KIND of let.
    expect(agency.lines.find((l) => l.ref === 'J2')!.tenancyPlace).toBe('Joint (2)');
  });

  /* GUARANTEE REFERENCE ORDER, LOWEST FIRST. Matt, same message. The
     screen and the attachments listed one month two ways. */
  it('and the lines read in guarantee reference order', () => {
    const refs = agency.lines.map((l) => l.ref);
    expect(refs).toEqual([...refs].sort((a, b) => a.localeCompare(b)));
  });

  it('names the rate AND where it came from, off the frozen line', () => {
    const j1 = agency.lines.find((l) => l.ref === 'J1')!;
    const s1 = agency.lines.find((l) => l.ref === 'S1')!;
    expect([j1.rate, j1.source]).toEqual([0.25, 'agreement']);
    expect([s1.rate, s1.source]).toEqual([0.20, 'agreement']);
    expect(group.lines[0].source).toBe('rate');
  });

  it('excludes a refund inside the month and a payment outside it', () => {
    const refs = agency.lines.map((l) => l.ref).sort();
    expect(refs).toEqual(['J1', 'J2', 'S1']);
  });

  it('the group is its own statement, not folded into the agency’s', () => {
    expect(p2(group.total)).toBe(p2((1384.62 + 1384.61 + 1661.54) * 0.03));
    expect(p2(agency.total)).toBe(p2((1384.62 + 1384.61) * 0.25 + 1661.54 * 0.20));
  });
});

describe('the months on offer', () => {
  it('are the months with money in them, newest first, refunds ignored', () => {
    expect(statementMonths('superadmin', ALL_PARTNERS).map((m) => m.key)).toEqual(['2026-05', '2026-04']);
  });

  it('a month with nothing in it yields no statements rather than empty ones', () => {
    expect(getCommissionStatements('superadmin', ALL_PARTNERS, '2026-03')).toEqual([]);
  });
});
