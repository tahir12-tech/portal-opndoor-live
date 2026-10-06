/* A REFERRAL COUNTS AS SENT ONCE IT WAS SENT, AND FEE UNPAID MEANS ASKED.
 *
 * Matt, 2026-10-03, two instructions that turn out to be one question:
 *
 *   "Reporting 'Referrals sent' (Every customer table, funnel, charts,
 *    exports) leaves out referrals that later expired unpaid: Northgate
 *    Lettings shows 8 sent on Reporting but has 14 applications, 6 of them
 *    expired. A referral counts as sent once it was sent to the tenant,
 *    whatever happened after. Unfinished direct applications that never
 *    reached the tenant being asked to pay are the only ones left out."
 *
 *   "'Fee unpaid' ... should list every application where the tenant has been
 *    asked for the guarantee fee and hasn't paid (today the 3 Sent referrals
 *    ...), not unfinished direct applications that haven't reached payment
 *    (GR-20626). Its count must match."
 *
 * BOTH ASK "WAS THE TENANT EVER ASKED TO PAY", so both read one predicate.
 *
 * AND `sentAt` IS NOT THAT PREDICATE, which is the trap this file exists to
 * nail down. EVERY direct draft carries `sent_at` from creation -- that is
 * what `expired_from` was added for in 20261007530000, when the thirty-day
 * close matched nothing because it was looking at `sent_at`. Measured on dev:
 * GR-20626 is `status = 'draft'` with `sent_at` set and no rent given.
 *
 * SO IT IS THE STATUS, AND WHAT THE STATUS USED TO BE. Dev holds eight
 * referrals that expired unpaid and seven unfinished direct drafts that were
 * closed after thirty days; both are `expired`, and only `expired_from` tells
 * them apart.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countByStatus, getApplications, hydrateApplications, hydrateFull, reachedPayment } from './applicationsService';
import { liveAggregate } from './liveAnalytics';
import { hydratePartners } from './partnersService';
import { ALL_PARTNERS, hydrateCommissionVisibility } from './types';
import type { FullApp } from './applicationsService';
import type { ApplicationSummary, Partner } from './types';

const row = (
  ref: string, status: ApplicationSummary['status'], extra: Partial<ApplicationSummary> = {},
): ApplicationSummary => ({
  ref, tenant: `Tenant ${ref}`, prop: '1 Example Road, N1 1AA', branch: 'Main',
  agency: 'ZZZ Agency', ben: '', rent: 1500, status, date: '2026-05-10', owner: 0,
  partner: 'opndoor-agents', referrer: null,
  ...extra,
} as unknown as ApplicationSummary);

/* DEV'S OWN SHAPE IN MINIATURE, and the two kinds of `expired` are the point:
   one was sent and nobody paid, the other was never sent to anybody. */
const BOOK: ApplicationSummary[] = [
  row('GR-SENT', 'sent'),
  row('GR-PAID', 'paid'),
  row('GR-DEED', 'deed'),
  // Sent, received, never paid. Counts as sent.
  row('GR-EXP-SENT', 'expired'),
  // An unfinished direct application closed after thirty days. Never asked.
  row('GR-EXP-DRAFT', 'expired', { expiredFrom: 'draft' } as never),
  // Still a draft. Never asked. GR-20626's shape, sent_at and all.
  row('GR-DRAFT', 'draft', { registered: true, feePaid: false } as never),
];

const opts = { role: 'superadmin' as const, scope: ALL_PARTNERS as string };

beforeEach(() => { hydrateApplications(BOOK, []); });
afterEach(() => { hydrateApplications([], []); });

describe('was the tenant ever asked to pay', () => {
  it('yes once it was sent, whatever happened after', () => {
    expect(reachedPayment({ status: 'sent' })).toBe(true);
    expect(reachedPayment({ status: 'paid' })).toBe(true);
    expect(reachedPayment({ status: 'deed' })).toBe(true);
    expect(reachedPayment({ status: 'expired' })).toBe(true);
  });

  /* MATT'S "the only ones left out", and both forms of it. */
  it('and no for a draft, and for a draft that was closed after thirty days', () => {
    expect(reachedPayment({ status: 'draft' })).toBe(false);
    expect(reachedPayment({ status: 'expired', expiredFrom: 'draft' })).toBe(false);
  });

  /* WITHDRAWN IS IN, which Matt did not name and his sentence does: "the only
     ones left out" is exhaustive, and a withdrawn referral reached the tenant
     exactly as an expired one did. Dev holds none, so no figure moves for it
     today. Asserted so the decision is visible rather than implied. */
  it('and yes for a withdrawn one, because it was sent before it was withdrawn', () => {
    expect(reachedPayment({ status: 'withdrawn' })).toBe(true);
  });
});

describe('the Fee unpaid tab', () => {
  /* THE THREE MATT NAMED, in miniature: the one `sent` row and nothing else.
     It used to be the drafts, which is the opposite set. */
  it('lists the sent referrals that have not paid, and no drafts', () => {
    const rows = getApplications({ ...opts, status: 'fee-unpaid' });
    expect(rows.map((r) => r.ref)).toEqual(['GR-SENT']);
  });

  /* "Its count must match." They used to match on the wrong answer, which is
     why nothing caught this until the list was fixed and they came apart. */
  it('and its count is that same set', () => {
    expect(countByStatus(opts).feeUnpaid)
      .toBe(getApplications({ ...opts, status: 'fee-unpaid' }).length);
    expect(countByStatus(opts).feeUnpaid).toBe(1);
  });

  /* AND IT IS NO LONGER A SUBSET OF DRAFT, which is what moved. Invited still
     is, and must not have moved with it. */
  it('while Invited is still about drafts', () => {
    expect(countByStatus(opts).draft).toBe(1);
    expect(countByStatus(opts).invited).toBe(0); // the one draft is registered
  });
});

/* =====================================================================
   AND THE CONVERSION RATES, WHICH MATT ASKED ME TO CHECK.

   "Check the conversion rates still make sense after the change."

   THEY MOVE, AND DOWN, AND THAT IS THE POINT. Sent is the denominator of
   both rates, and referrals that expired unpaid are now in it. Northgate on
   dev goes from 8 sent to 14, so its Sent-to-Paid goes from 8/8 = 100% to
   8/14 = 57%. The old number was not a better rate; it was a rate that threw
   away every referral that did not convert, which is the only kind a
   conversion rate is for.

   A 100% CONVERSION IS THE TELL. Under the old rule an agency whose every
   paid referral was counted and whose every unpaid one was deleted could
   only ever read 100%, which is what Northgate did.
   ===================================================================== */
const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', kind: 'agency', isHouse: true },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

/* Test mode's clock is fixed at 2026-06-26, so a May date is inside "all". */
const SENT = new Date(2026, 4, 10);
const full = (ref: string, over: Partial<FullApp>): FullApp => ({
  ref, partner: 'opndoor-agents', agency: 'ZZZ Agency', branch: 'Main', referrer: 'R', owner: 0,
  rent: 1500, fee: 1500, agentRate: 0.1, partnerRate: 0.25,
  status: 'sent', sentAt: SENT, paidAt: null,
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  ...over,
} as unknown as FullApp);

describe('the conversion rate after the change', () => {
  beforeEach(() => { hydratePartners(PARTNERS); hydrateCommissionVisibility(true); });
  afterEach(() => { hydrateFull([]); hydratePartners([]); });

  /* TWO PAID, TWO EXPIRED-AFTER-SENDING, ONE NEVER SENT. */
  it('counts every referral that reached the tenant, and nothing that did not', () => {
    hydrateFull([
      full('GR-P1', { status: 'paid', paidAt: SENT }),
      full('GR-P2', { status: 'paid', paidAt: SENT }),
      full('GR-E1', { status: 'expired', expired: true }),
      full('GR-E2', { status: 'expired', expired: true }),
      full('GR-DRAFT', { status: 'draft' }),
      full('GR-CLOSED', { status: 'expired', expired: true, expiredFrom: 'draft' } as Partial<FullApp>),
    ]);
    const a = liveAggregate('superadmin', ALL_PARTNERS, 'all');
    expect(a.sent).toBe(4);   // two paid, two expired after sending
    expect(a.paid).toBe(2);
  });

  /* THE RATE ITSELF, stated as the arithmetic rather than as a number, so
     this says WHY it fell rather than pinning a figure. */
  it('so Sent-to-Paid is 2 of 4 and not 2 of 2, which is what 100% hid', () => {
    hydrateFull([
      full('GR-P1', { status: 'paid', paidAt: SENT }),
      full('GR-P2', { status: 'paid', paidAt: SENT }),
      full('GR-E1', { status: 'expired', expired: true }),
      full('GR-E2', { status: 'expired', expired: true }),
    ]);
    const a = liveAggregate('superadmin', ALL_PARTNERS, 'all');
    expect(a.paid / a.sent).toBe(0.5);
  });
});
