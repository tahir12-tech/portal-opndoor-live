/* A REFUNDED FEE CANCELS THAT TENANT'S GUARANTEE, ON EVERY SCREEN.
 *
 * Matt (ak): "Mark their deed 'Cancelled: fee refunded' everywhere
 * (application page, tenancy box, exports, bordereau from the refund date),
 * never 'Deed executed'. In the tenancy box show 'Refunded · deed cancelled',
 * and the count as '2 of 3 tenants paid, 1 refunded'."
 *
 * THE INTERESTING FAILURE IS NOT THE MISSING LABEL, IT IS THE ORDERING.
 * Cancelling a guarantee deliberately does NOT move `status` off 'deed': the
 * application did reach the deed stage, and every status filter, count and
 * export depends on it staying there. Three separate places short-circuit on
 * `status === 'deed'` for unrelated reasons, written months apart, and each
 * of them would happily report a cancelled guarantee as executed. A test
 * that only checked MEMBER_DEED_LABEL.cancelled would have passed while all
 * three said "Deed executed" on screen.
 */
import { describe, it, expect } from 'vitest';
import { MEMBER_DEED_LABEL, memberDeedTone, groupTenancies, tenancyProgress, tenancyPaidTally } from './tenancyGroups';
import { deedCardState } from './paymentService';
import type { ApplicationSummary } from './types';

const app = (over: Partial<ApplicationSummary>): ApplicationSummary => ({
  ref: 'GR-1', tenant: 'A Tenant', status: 'deed', rent: 1800, fee: 600,
  agency: 'An Agency', branch: 'An Office', prop: '1 Test Street',
  tenancyId: 'T1', tenancyPosition: 1, sharePercent: 33, refunded: false,
  deedState: 'executed',
  ...over,
} as ApplicationSummary);

describe('the deed state itself', () => {
  it('is called what Matt called it', () => {
    expect(MEMBER_DEED_LABEL.cancelled).toBe('Cancelled: fee refunded');
  });

  /* NOT 'done'. An executed deed and a cancelled one must not read the same
     at a glance, which is the whole job of the tone. */
  it('does not read as a completed deed', () => {
    expect(memberDeedTone('cancelled')).toBe('problem');
    expect(memberDeedTone('executed')).toBe('done');
  });

  /* THE DEED CARD'S FALLBACK IS 'preparing', so an unhandled state tells the
     agent a deed is on its way. On a cancelled guarantee that is the worst
     available answer. */
  it('is not mistaken for a deed being prepared', () => {
    expect(deedCardState({ deedState: 'cancelled', pandadocDocumentId: 'doc_1' })).toBe('cancelled');
    expect(deedCardState({ deedState: 'cancelled', pandadocDocumentId: null })).toBe('cancelled');
  });
});

describe('the tenancy box', () => {
  /* THREE TENANTS, ONE REFUNDED: Matt's worked example, and GR-25235's
     tenancy on dev. */
  const three = [
    app({ ref: 'GR-A', tenancyPosition: 1, status: 'deed', deedState: 'executed' }),
    app({ ref: 'GR-B', tenancyPosition: 2, status: 'deed', deedState: 'cancelled', refunded: true }),
    app({ ref: 'GR-C', tenancyPosition: 3, status: 'deed', deedState: 'executed' }),
  ];
  const group = () => groupTenancies(three).get('T1')!;

  /* THE ORDERING BUG, caught here rather than on screen. status is still
     'deed' on the refunded member, and deedOf short-circuits on that. */
  it('calls the refunded member cancelled, though its status still says deed', () => {
    const m = group().members.find((x) => x.ref === 'GR-B')!;
    expect(m.status).toBe('deed');
    expect(m.deed).toBe('cancelled');
    expect(MEMBER_DEED_LABEL[m.deed]).toBe('Cancelled: fee refunded');
  });

  it('and leaves the co-tenants alone', () => {
    for (const ref of ['GR-A', 'GR-C']) {
      expect(group().members.find((x) => x.ref === ref)!.deed).toBe('executed');
    }
  });

  it('counts it the way Matt wrote it', () => {
    expect(tenancyProgress(group())).toBe('2 of 3 tenants paid, 1 refunded');
  });

  it('and the short heading tally agrees with the sentence', () => {
    expect(tenancyPaidTally(group())).toBe('2 of 3 paid, 1 refunded');
  });

  /* THE TAIL IS CONDITIONAL. Most tenancies have no refund, and "(0
     refunded)" on every one of them is noise that trains people to stop
     reading the line. */
  it('says nothing about refunds where there are none', () => {
    const clean = groupTenancies([
      app({ ref: 'GR-A', tenancyPosition: 1 }),
      app({ ref: 'GR-B', tenancyPosition: 2 }),
    ]).get('T1')!;
    expect(tenancyProgress(clean)).toBe('Both tenants have paid');
    expect(tenancyPaidTally(clean)).toBe('2 of 2 paid');
  });

  /* THE END STATE OF A COMPLETED CASCADE. Every tenant refunded is not "no
     tenant has paid yet": they all did, and they all got it back. */
  it('says so plainly when the whole tenancy has been refunded', () => {
    const all = groupTenancies([
      app({ ref: 'GR-A', tenancyPosition: 1, deedState: 'cancelled', refunded: true }),
      app({ ref: 'GR-B', tenancyPosition: 2, deedState: 'cancelled', refunded: true }),
    ]).get('T1')!;
    expect(tenancyProgress(all)).toBe('Both tenants have been refunded');
  });
});

/* AND IN THE EXPORT, which (ak) names among the everywheres.
 *
 * THE ROW USED TO CONTRADICT ITSELF, which is worse than being plainly
 * wrong: the Status column read "Deed Issued" (because `status` stays at
 * 'deed' through a cancellation) while the Payment state column beside it
 * read "Refunded". A reader could take either half as the live fact, and
 * the two columns are inches apart.
 */
describe('the application export', () => {
  it('says the deed was cancelled, not issued', async () => {
    const { buildRealApplicationDoc } = await import('./exportsService');
    const { hydrateFull } = await import('./applicationsService');
    const base = {
      partner: 'opndoor-agents', agency: 'An Agency', branch: 'An Office',
      rent: 1800, fee: 600, agentRate: 0.25, partnerRate: 0.25,
      status: 'deed' as const, tenancyStart: new Date('2026-06-01'),
      deedAt: new Date('2026-06-01'), expiry: null,
      sentAt: new Date('2026-06-01'), paidAt: new Date('2026-06-01'),
      referrer: 'A Referrer', partiallyRefunded: false,
    };
    hydrateFull([
      { ...base, ref: 'GR-CANX', refunded: true, refundedAt: new Date('2026-06-10'),
        refundedAmount: 600, deedState: 'cancelled' },
      { ...base, ref: 'GR-LIVE', refunded: false, refundedAt: null,
        refundedAmount: null, deedState: 'executed' },
    ] as never[]);

    const built = buildRealApplicationDoc(
      'superadmin',
      { from: new Date('2026-06-01'), to: new Date('2026-06-30') },
      'referred',
      { label: 'June 2026', recon: '', hint: '' },
    );
    /* THE ROWS LIVE IN THE SHEET'S DOC, as a table block. Reading
       `sheet.rows` returns undefined and every assertion below would then
       pass vacuously on an empty array -- which is how a test that proves
       nothing looks from the outside. */
    const table = built?.sheets?.[0]?.doc?.blocks?.find((b) => b.kind === 'table');
    const rows = ((table as { rows?: (string | number)[][] } | undefined)?.rows ?? []);
    expect(rows.length, 'the export produced rows at all').toBeGreaterThan(0);
    const cancelled = rows.find((r) => r.includes('GR-CANX'));
    const live = rows.find((r) => r.includes('GR-LIVE'));

    expect(cancelled, 'the cancelled row is still exported: it happened').toBeTruthy();
    expect(cancelled).toContain('Deed cancelled');
    expect(cancelled).not.toContain('Deed Issued');
    // And the row it sits next to is untouched, so this is the cancellation
    // and not the export losing its status column.
    expect(live).toContain('Deed Issued');

    hydrateFull([]);
  });
});
