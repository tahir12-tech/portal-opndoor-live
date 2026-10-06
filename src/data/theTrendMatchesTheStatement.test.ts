/* THE MONTHLY TREND SHOWS WHAT THE STATEMENT PAID.
 *
 * Matt, 2026-10-01, verbatim: "Monthly trend: September 2026 shows £0
 * commission earned, but the statement shows £1,601.54 paid in September.
 * Make the trend use the same figures as the statement."
 *
 * =====================================================================
 * WHY IT WAS STRUCTURALLY ZERO, FOR EVERY AGENCY, EVERY MONTH
 * =====================================================================
 *
 * liveMonths computed the measure as
 *
 *   feeBase * (isHousePartner(partner) ? 0 : partnerRate)
 *
 * which is right about the PARTNER cut: on a house route that cut is
 * opndoor's own margin and must never be shown as somebody's earnings.
 * But every agency Opndoor onboards shares the house partner
 * `opndoor-agents`, so for an agency reader the whole measure was zero by
 * construction: twelve bars of £0 under "Commission earned", beside a
 * statement that had just paid them.
 *
 * What an agency earns is the agency-side lines, and those are taken from
 * payeesFor, which is where the statement's own figures come from: the
 * frozen amount wins over the rate, so a joint tenancy's pennies land
 * exactly as commission_statement_lines has them.
 *
 * A supplier reader is untouched and keeps the partner cut, because that
 * is what THEY are paid. The measure is offered to nobody else:
 * trendMeasuresFor lists "Commission earned" on the non-Opndoor arm only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { hydratePartners } from './partnersService';
import { liveTrend } from './liveAnalytics';
import { ALL_PARTNERS } from './types';
import type { FullApp } from './applicationsService';
import type { Partner } from './types';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

/* An agency on the house partner, and a supplier that is its own partner.
   `partyIsAgency` reads referencingMode off the partner, so the two rails
   are told apart here exactly as the product tells them apart. */
const PARTNERS = [
  {
    id: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', since: '2025-01-01',
    weight: 1, users: 0, apps: 0, referencingMode: 'opndoor_referenced',
    partnerRate: 0.25, agentRate: 0.1, primary: false, kind: 'agency' },
  {
    id: 'zzz-supplier', name: 'ZZZ Supplier', status: 'active', since: '2025-01-01',
    weight: 1, users: 0, apps: 0, referencingMode: 'pre_referenced_open',
    partnerRate: 0.25, agentRate: 0.1, primary: false, kind: 'supplier' },
] as unknown as Partner[];

/* Test mode's clock is fixed at 2026-06-26, so the trailing twelve months
   are July 2025 to June 2026 and a June payment lands in the last bar. */
const PAID = D(2026, 5, 10);

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-TR-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", referrer: 'R', owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 5, 1), paidAt: PAID,
  deedAt: D(2026, 5, 12), tenancyStart: D(2026, 6, 1), expiry: D(2027, 5, 31),
  refunded: false, partiallyRefunded: false, withdrawn: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null, expired: false,
  ...over,
} as unknown as FullApp);

/** The last bar, which is the month the fixture was paid in. */
const june = (role: 'management' | 'superadmin', scope: string) => {
  const rows = liveTrend('month', role, scope as never);
  return rows[rows.length - 1];
};

beforeEach(() => { hydratePartners(PARTNERS); });
afterEach(() => { hydrateFull([]); });

describe('an agency Director’s trend', () => {
  it('shows what the agency earned, not a structural zero', () => {
    hydrateFull([app({})]);
    /* 25% of a £2,000 fee. Under the old rule this was £0, because the
       agency's partner IS the house partner. */
    expect(june('management', 'opndoor-agents').comm).toBe(500);
  });

  /* THE STATEMENT'S OWN ARITHMETIC. Where a line carries a frozen amount --
     which is what a joint tenancy's apportionment leaves behind -- the
     amount wins over the rate, so the bar and commission_statement_lines
     agree to the penny instead of to within a rounding. */
  it('and takes the frozen amount where there is one, as the statement does', () => {
    hydrateFull([app({
      commissionLines: [
        { level: 'agency', orgId: null, orgName: 'Regent’s Lettings', rate: 0.25, amount: 576.92 },
      ],
    } as Partial<FullApp>)]);
    expect(june('management', 'opndoor-agents').comm).toBe(576.92);
  });

  it('and still counts nothing for a refunded fee', () => {
    hydrateFull([app({ refunded: true, refundedAt: PAID, refundedAmount: 2000 })]);
    expect(june('management', 'opndoor-agents').comm).toBe(0);
  });

  /* A PARTIAL REFUND IS MONEY BACK, NOT A CANCELLED GUARANTEE, and the
     commission stays on the whole fee: the same rule the aggregate behind
     the tile applies, so the two cannot disagree. */
  it('and keeps the commission on a partially refunded one', () => {
    hydrateFull([app({ partiallyRefunded: true, refundedAmount: 10 })]);
    expect(june('management', 'opndoor-agents').comm).toBe(500);
  });
});

describe('a supplier’s trend is untouched', () => {
  it('still shows the supplier’s own partner cut', () => {
    hydrateFull([app({ ref: 'GR-TR-S', partner: 'zzz-supplier', agency: 'ZZZ Agency' })]);
    /* 25% partner rate on a £2,000 fee: theirs, not their agencies'. */
    expect(june('management', 'zzz-supplier').comm).toBe(500);
  });

  it('and not the agencies’ share as well', () => {
    hydrateFull([app({
      ref: 'GR-TR-S2', partner: 'zzz-supplier', agency: 'ZZZ Agency',
      partnerRate: 0.3, agentRate: 0.1,
    })]);
    expect(june('management', 'zzz-supplier').comm).toBe(600);
  });
});

describe('and Opndoor’s own books', () => {
  /* The measure is not offered to an admin at all -- trendMeasuresFor gives
     them `payable` instead -- but the figure underneath must still mean the
     partner cut rather than silently becoming the agency's. */
  it('read the whole estate with the partner cut, not the agency side', () => {
    hydrateFull([
      app({}),
      app({ ref: 'GR-TR-S3', partner: 'zzz-supplier', agency: 'ZZZ Agency' }),
    ]);
    expect(june('superadmin', ALL_PARTNERS).comm).toBe(500);
  });
});
