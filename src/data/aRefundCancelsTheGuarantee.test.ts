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
import { deedCardState, cancelledByRefund, CANCELLED_BY_REFUND_LABEL } from './paymentService';
import { applicationStatusLabel, applicationStatusTone, applicationStageClass } from './applicationsService';
import { inForceDuring } from './inForce';
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


/* HOW A REFUND READS, AFTER MATT WALKED IT. (az), 2026-10-04.
 *
 * GR-23853 refunded in Stripe and GR-23854 followed automatically, which is
 * the cascade working. What he found wrong was all presentation, and all one
 * cause: every screen was reading `deed_state` and answering what happened to
 * the DOCUMENT, where the reader is asking what happened to the GUARANTEE.
 *
 * THE TWO SHAPES, measured on dev and used as the fixtures below:
 *   GR-23853  signed, then cancelled  -> status 'deed',  deed_state 'cancelled'
 *   GR-23854  never signed, voided    -> status 'paid',  deed_state 'voided'
 * Both refunded. Three deed states (counting 'error'), one outcome.
 */
describe('a refund ends the guarantee, whatever became of the document', () => {
  it('reads the signed case and the abandoned one apart', () => {
    expect(cancelledByRefund({ refunded: true, deedState: 'cancelled' })).toBe('signed');
    expect(cancelledByRefund({ refunded: true, deedState: 'voided' })).toBe('unsigned');
    expect(cancelledByRefund({ refunded: true, deedState: 'awaiting_tenant' })).toBe('unsigned');
    expect(cancelledByRefund({ refunded: true, deedState: 'error' })).toBe('unsigned');
  });

  /* NOTHING TO SAY WHERE NO DEED EXISTED. "Signing cancelled" would describe
     a signing that never started; the status pill says Refunded and that is
     the whole story. */
  it('says nothing about a deed where there never was one', () => {
    expect(cancelledByRefund({ refunded: true, deedState: null })).toBeNull();
  });

  /* A PART REFUND LEAVES THE GUARANTEE STANDING (R2), on this path as on
     every other. The caller passes `refunded`, which is false for a partial
     one, so this is really a test that no caller is tempted to pass "some
     money went back". */
  it('and an unrefunded deed is not cancelled by anything here', () => {
    expect(cancelledByRefund({ refunded: false, deedState: 'executed' })).toBeNull();
  });

  it('with Matt\'s two labels', () => {
    expect(CANCELLED_BY_REFUND_LABEL.signed).toBe('Cancelled: fee refunded');
    expect(CANCELLED_BY_REFUND_LABEL.unsigned).toBe('Signing cancelled: fee refunded');
  });
});

describe('every list that shows a stage says Refunded', () => {
  /* THE PILE-UP MATT SAW: "Deed Issued / Paid + Refunded + Not paid", three
     facts from three columns, each true. One answer now, and the same one in
     every list -- there were four copies of the status map before this. */
  it('on the two shapes, whatever their underlying status', () => {
    expect(applicationStatusLabel({ status: 'deed', refunded: true })).toBe('Refunded');
    expect(applicationStatusLabel({ status: 'paid', refunded: true })).toBe('Refunded');
  });

  it('and leaves every other row alone', () => {
    expect(applicationStatusLabel({ status: 'deed', refunded: false })).toBe('Deed Issued');
    expect(applicationStatusLabel({ status: 'sent' })).toBe('Sent');
  });

  /* WITHDRAWN AND EXPIRED STILL WIN. They are terminal states of the
     APPLICATION; a refund on one is a footnote to it, not a replacement. */
  it('but does not overwrite a terminal state', () => {
    expect(applicationStatusLabel({ status: 'withdrawn', refunded: true })).toBe('Withdrawn');
    expect(applicationStatusLabel({ status: 'expired', refunded: true })).toBe('Expired');
  });

  /* THE COLOUR MOVES WITH THE WORD. A refund must not wear the green of an
     issued deed, in either the pill or the CSS-class lists. */
  it('and the colour follows the word, in both kinds of list', () => {
    expect(applicationStatusTone({ status: 'deed', refunded: true })).toBe('muted');
    expect(applicationStatusTone({ status: 'deed', refunded: false })).toBe('deed');
    expect(applicationStageClass({ status: 'deed', refunded: true })).toBe('st-neutral');
    expect(applicationStageClass({ status: 'deed', refunded: false })).toBe('st-ok');
  });
});

describe('the tenancy box, after the walk', () => {
  /* GR-23854's SHAPE: refunded while out for signature, so deed_state is
     'voided'. It read "Deed voided", which is a filing action, not an
     outcome. */
  it('calls an unsigned refunded deed cancelled, not voided', () => {
    const g = groupTenancies([
      app({ ref: 'GR-A', tenancyPosition: 1, status: 'deed', deedState: 'cancelled', refunded: true }),
      app({ ref: 'GR-B', tenancyPosition: 2, status: 'paid', deedState: 'voided', refunded: true }),
    ]).get('T1')!;
    for (const m of g.members) {
      expect(m.deed, `${m.ref} should read cancelled`).toBe('cancelled');
      expect(MEMBER_DEED_LABEL[m.deed]).toBe('Cancelled: fee refunded');
    }
  });

  /* A VOIDED DEED THAT WAS NOT REFUNDED IS STILL VOIDED. The rule is about
     refunds, not about the word; a deed voided to be reissued must keep
     saying so. */
  it('and leaves a voided deed that was not refunded alone', () => {
    const g = groupTenancies([
      app({ ref: 'GR-A', tenancyPosition: 1, status: 'paid', deedState: 'voided', refunded: false }),
      app({ ref: 'GR-B', tenancyPosition: 2 }),
    ]).get('T1')!;
    expect(g.members.find((m) => m.ref === 'GR-A')!.deed).toBe('voided');
  });
});

/* ITEM 6 IS A CHECK, NOT A CHANGE, and Matt asked for it as one: "Check
 * Reporting's rent in force and the bordereau leave cancelled deeds out."
 * Both read inForceDuring, which I changed this afternoon to end cover at
 * the refund date rather than exclude the row outright -- so the answer is
 * yes for every period AFTER the refund and deliberately no for the ones it
 * ran in. Proved rather than asserted, because I am the one who changed it.
 */
describe('rent in force and the bordereau, after a cancellation', () => {
  const D = (s: string) => new Date(`${s}T12:00:00Z`);
  const NOV: [Date, Date] = [D('2026-11-01'), D('2026-11-30')];
  const row = {
    deedState: 'cancelled' as const, tenancyStart: D('2026-08-01'), expiry: D('2027-07-31'),
    refunded: true, refundedAt: D('2026-10-20'), partiallyRefunded: false,
    withdrawn: false, rent: 1800, shareAmount: null,
  };

  it('a cancelled deed is out of every period after the refund', () => {
    expect(inForceDuring(row, ...NOV)).toBe(false);
  });

  it('and still in the ones it actually ran in', () => {
    expect(inForceDuring(row, D('2026-09-01'), D('2026-09-30'))).toBe(true);
  });
});
