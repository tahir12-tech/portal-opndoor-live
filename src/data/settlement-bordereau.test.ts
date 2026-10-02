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
  /* ONE FIGURE PER SUPPLIER, and `northwind` stopped being one on
     2026-10-02. It is `opndoor_referenced`, which makes it an
     agency-shaped partner rather than a supplier -- the same shape as
     Harbour Lets, which Matt had taken off the Suppliers list and out of
     the route table earlier the same day. Opndoor owes such a party
     nothing on a referral from its own estate, and the aggregate and the
     route breakdown have always returned zero for it; this accumulator
     was the one surface that did not, so it listed a payee with a figure
     nobody is invoiced for. Harbourside, which holds no referencingMode
     and so is a real supplier, is unchanged. */
  it('one figure per supplier, net of refunds, with constituent apps', () => {
    const byName = Object.fromEntries(st.partners.map((p) => [p.partner, p]));
    expect(byName.harbourside.commission).toBeCloseTo(1500 * zo, 6);
    expect(byName.harbourside.apps.length).toBe(1);
  });

  it('and an agency-shaped partner is not a payee at all', () => {
    expect(st.partners.map((p) => p.partner)).not.toContain('northwind');
    // Not a zero row either: a payee owed nothing is not a payee.
    expect(st.partners.every((p) => p.commission > 0)).toBe(true);
  });
});

/* WALK FIX 8 CHANGED WHAT THIS DOCUMENT IS.
 *
 * It was "guarantees COMMENCING in the month". Matt: "only guarantees with
 * an executed deed, IN FORCE DURING the period, and not refunded or
 * withdrawn." So the window is no longer the month a guarantee was written
 * in; it is every guarantee on cover at any point during it, and a deed the
 * tenant has not signed is not one.
 *
 * WHAT MOVED IN THIS FILE, rather than being quietly re-baselined:
 *
 *   the fixtures gained `deedState`. They were written when `status ===
 *   'deed'` was the whole test, so none of them said whether the tenant had
 *   signed. GR-5 keeps a null deed state and stays excluded, as it always
 *   was; GR-4 gains 'awaiting_tenant' so it is now excluded for TWO reasons
 *   and the assertion below names both.
 *
 *   GR-4 is no longer "wrong month". Its cover starts on 1 June and runs a
 *   year, so under the old rule it was out of May's bordereau and under the
 *   new one it would be IN it -- May ends before its cover begins, so it is
 *   still out, but for a different reason. It is now also unsigned, which is
 *   the clause that keeps it out however the dates move.
 *
 *   one assertion is renamed from "commencing in the month" to what is now
 *   true. The old wording described a rule that no longer exists, and
 *   leaving it would have left the file passing while teaching the wrong
 *   thing.
 *
 * The clause-by-clause coverage of the new rule is in
 * bordereauIsTheBookInForce.test.ts; this file keeps the column mapping and
 * the format, which are unchanged. */
describe('buildLiveBordereau (in force during the month, live rows, frozen format)', () => {
  const rec = (ref: string, o: Partial<AppRecord>): AppRecord => ({
    ref, name: 'John Doe', title: 'Mr', role: '', addr1: '1 Street', postcode: 'E1 1AA', branch: 'Br', agency: 'Ag',
    rent: 1200, status: 'deed', date: '2026-05-10', referrer: 'R', owner: 0,
    firstName: 'John', lastName: 'Doe', dob: '1990-01-15', addr2: '', city: 'London', county: 'Greater London', ...o,
  });
  // DATE columns are local-midnight after hydrate (toLocalDate), so use the local
  // constructor here - this keeps the bordereau window/format timezone-robust.
  const LD = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  const FULL: FullApp[] = [
    full({ ref: 'GR-1', rent: 1200, partner: 'northwind', status: 'deed', deedState: 'executed', tenancyStart: LD(2026, 5, 10), deedAt: LD(2026, 4, 20), expiry: LD(2027, 5, 9) }),
    full({ ref: 'GR-2', rent: 1500, partner: 'harbourside', status: 'deed', deedState: 'executed', tenancyStart: LD(2026, 5, 25), deedAt: LD(2026, 4, 30), expiry: LD(2027, 5, 24) }),
    full({ ref: 'GR-3', rent: 2000, partner: 'northwind', status: 'deed', deedState: 'executed', tenancyStart: LD(2026, 5, 5), deedAt: LD(2026, 4, 10), expiry: LD(2027, 5, 4), refunded: true }), // refunded -> excluded
    // Cover begins after May ends, AND nobody has signed it. Two reasons.
    full({ ref: 'GR-4', rent: 1000, partner: 'northwind', status: 'deed', deedState: 'awaiting_tenant', tenancyStart: LD(2026, 6, 1), deedAt: LD(2026, 5, 10), expiry: LD(2027, 5, 31) }),
    full({ ref: 'GR-5', rent: 1000, partner: 'northwind', status: 'paid', tenancyStart: LD(2026, 5, 12) }), // no deed at all
  ];
  hydrateFull(FULL);
  hydrateApplications([], [rec('GR-1', {}), rec('GR-2', { firstName: 'Jane', lastName: 'Roe' }), rec('GR-3', {}), rec('GR-4', {}), rec('GR-5', {})]);
  afterAll(() => { hydrateFull([]); hydrateApplications([], []); });

  const out = buildLiveBordereau(2026, 4, 13.5); // May 2026

  it('labels the month and counts what was on cover in it', () => {
    expect(out.monthLabel).toBe('May 2026');
    expect(out.issued).toBe(2);
  });
  it('includes only executed, non-refunded guarantees in force during the month', () => {
    // GR-3 refunded, GR-4 starts after May and is unsigned, GR-5 has no deed.
    expect(out.rows.map((r) => r[0]).sort()).toEqual(['GR-1', 'GR-2']);
  });
  it('maps real fields onto the 18 template columns (A–R)', () => {
    const g1 = out.rows.find((r) => r[0] === 'GR-1')!;
    expect(g1.length).toBe(18);
    expect(g1[1]).toBe('Mr');            // Tenant Title
    expect(g1[2]).toBe('John');          // First Name
    expect(g1[3]).toBe('Doe');           // Last Name
    expect(g1[4]).toBe('15/01/1990');    // DOB dd/mm/yyyy (always populated)
    expect(g1[5]).toBe('Tenant');        // Tenant Role
    /* LANDLORD NAME IS THE LANDLORD, OR NOTHING, since 2026-10-02. It
       was the AGENCY name, which is right only if you read "landlord"
       as "whoever we deal with" -- and on a direct signup there is no
       agency, so the cell took the house rail's "Unattached"
       placeholder onto a document that goes to an underwriter. Matt:
       "show the landlord's name where we hold it, otherwise leave it
       blank." This fixture holds no landlord, so it is blank. */
    expect(g1[11]).toBe('');             // Landlord Name = landlord_name, or nothing (#116)
    expect(g1[12]).toBe('20/04/2026');   // Issue Date = deedAt
    expect(g1[13]).toBe('10/05/2026');   // Tenancy date
    expect(g1[15]).toBe(1200);           // Monthly Rent (numeric)
    expect(g1[16]).toBeCloseTo(1200 * 0.135, 6); // Insurance = rent × rate (£ amount)
    expect(g1[17]).toBe('On Cover');     // Status vocabulary aligned to the template
  });
});
