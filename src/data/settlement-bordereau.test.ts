/* Locks the settlement-rule and live-bordereau follow-ups. Test mode "now" is the
   fixed demo date 2026-06-26, so the prior calendar month is May 2026 and the
   settlement date is 15 June 2026. */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getRatesFor, buildLiveBordereau } from '@/data';
import { getCommissionSettlement } from '@/data/liveAnalytics';
import { hydrateFull, hydrateApplications, type FullApp } from '@/data/applicationsService';
import type { AppRecord } from '@/data/mock/applications';

const D = (s: string) => new Date(s);
function full(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'partner' | 'status'>): FullApp {
  const rates = getRatesFor(o.partner); // snapshot = the partner's rate at creation
  return {
    partnerRate: rates.partner, agentRate: rates.agent,
    agency: 'Ag', branch: 'Br', referrer: 'R', owner: 0,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

describe('getCommissionSettlement (prior calendar month, net of refunds, payable 15th)', () => {
  const APPS: FullApp[] = [
    full({ ref: 'P1', rent: 1000, partner: 'northwind', status: 'paid', paidAt: D('2026-05-10') }),
    full({ ref: 'P2', rent: 2000, partner: 'northwind', status: 'paid', paidAt: D('2026-05-20') }),
    full({ ref: 'P3', rent: 1500, partner: 'harbourside', status: 'paid', paidAt: D('2026-05-15') }),
    full({ ref: 'P4', rent: 3000, partner: 'northwind', status: 'paid', paidAt: D('2026-05-25'), refunded: true, refundedAt: D('2026-05-26'), refundedAmount: 3000 }),
    full({ ref: 'P5', rent: 900, partner: 'northwind', status: 'paid', paidAt: D('2026-06-05') }), // this month, not prior
    full({ ref: 'P6', rent: 900, partner: 'northwind', status: 'paid', paidAt: D('2026-04-30') }), // prior-prior
  ];
  hydrateFull(APPS);
  afterAll(() => hydrateFull([]));

  const st = getCommissionSettlement('superadmin', ALL_PARTNERS);
  const rm = getRatesFor('northwind').partner;
  const zo = getRatesFor('harbourside').partner;

  it('buckets the prior calendar month and settles on the 15th', () => {
    expect(st.monthLabel).toBe('May 2026');
    expect(st.settlementDate.getFullYear()).toBe(2026);
    expect(st.settlementDate.getMonth()).toBe(5); // June (0-based)
    expect(st.settlementDate.getDate()).toBe(15);
  });
  it('one figure per partner, net of refunds, with constituent apps', () => {
    const byName = Object.fromEntries(st.partners.map((p) => [p.partner, p]));
    expect(byName.northwind.commission).toBeCloseTo(3000 * rm, 6); // P1+P2; P4 refunded, P5/P6 wrong month
    expect(byName.northwind.apps.map((a) => a.ref).sort()).toEqual(['P1', 'P2']);
    expect(byName.harbourside.commission).toBeCloseTo(1500 * zo, 6);
    expect(byName.harbourside.apps.length).toBe(1);
  });
});

describe('buildLiveBordereau (tenancy-start anchored, live rows, frozen format)', () => {
  const rec = (ref: string, o: Partial<AppRecord>): AppRecord => ({
    ref, name: 'John Doe', title: 'Mr', role: '', addr1: '1 Street', postcode: 'E1 1AA', branch: 'Br', agency: 'Ag',
    rent: 1200, status: 'deed', date: '2026-05-10', referrer: 'R', owner: 0,
    firstName: 'John', lastName: 'Doe', dob: '1990-01-15', addr2: '', city: 'London', county: 'Greater London', ...o,
  });
  // DATE columns are local-midnight after hydrate (toLocalDate), so use the local
  // constructor here - this keeps the bordereau window/format timezone-robust.
  const LD = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  const FULL: FullApp[] = [
    full({ ref: 'GR-1', rent: 1200, partner: 'northwind', status: 'deed', tenancyStart: LD(2026, 5, 10), deedAt: LD(2026, 4, 20), expiry: LD(2027, 5, 9) }),
    full({ ref: 'GR-2', rent: 1500, partner: 'harbourside', status: 'deed', tenancyStart: LD(2026, 5, 25), deedAt: LD(2026, 4, 30), expiry: LD(2027, 5, 24) }),
    full({ ref: 'GR-3', rent: 2000, partner: 'northwind', status: 'deed', tenancyStart: LD(2026, 5, 5), deedAt: LD(2026, 4, 10), refunded: true }), // refunded -> excluded
    full({ ref: 'GR-4', rent: 1000, partner: 'northwind', status: 'deed', tenancyStart: LD(2026, 6, 1), deedAt: LD(2026, 5, 10) }), // wrong month
    full({ ref: 'GR-5', rent: 1000, partner: 'northwind', status: 'paid', tenancyStart: LD(2026, 5, 12) }), // not deed
  ];
  hydrateFull(FULL);
  hydrateApplications([], [rec('GR-1', {}), rec('GR-2', { firstName: 'Jane', lastName: 'Roe' }), rec('GR-3', {}), rec('GR-4', {}), rec('GR-5', {})]);
  afterAll(() => { hydrateFull([]); hydrateApplications([], []); });

  const out = buildLiveBordereau(2026, 4, 13.5); // May 2026

  it('anchors the month on tenancy commencement date and buckets it', () => {
    expect(out.monthLabel).toBe('May 2026');
    expect(out.issued).toBe(2);
  });
  it('includes only Deed-Issued, non-refunded tenancies commencing in the month', () => {
    expect(out.rows.map((r) => r[0]).sort()).toEqual(['GR-1', 'GR-2']); // GR-3 refunded, GR-4 wrong month, GR-5 not deed
  });
  it('maps real fields onto the 18 template columns (A–R)', () => {
    const g1 = out.rows.find((r) => r[0] === 'GR-1')!;
    expect(g1.length).toBe(18);
    expect(g1[1]).toBe('Mr');            // Tenant Title
    expect(g1[2]).toBe('John');          // First Name
    expect(g1[3]).toBe('Doe');           // Last Name
    expect(g1[4]).toBe('15/01/1990');    // DOB dd/mm/yyyy (always populated)
    expect(g1[5]).toBe('Tenant');        // Tenant Role
    expect(g1[11]).toBe('Ag');           // Landlord Name = agency name (#116)
    expect(g1[12]).toBe('20/04/2026');   // Issue Date = deedAt
    expect(g1[13]).toBe('10/05/2026');   // Tenancy date
    expect(g1[15]).toBe(1200);           // Monthly Rent (numeric)
    expect(g1[16]).toBeCloseTo(1200 * 0.135, 6); // Insurance = rent × rate (£ amount)
    expect(g1[17]).toBe('On Cover');     // Status vocabulary aligned to the template
  });
});
