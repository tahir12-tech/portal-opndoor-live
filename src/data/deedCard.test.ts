/* WHAT THE GUARANTEE DEED CARD SAYS, AND WHEN IT MAY OFFER TO GENERATE.

   Reported from the walk on GR-20846: the card read "Deed could not be generated.
   Check the branch has an agent contact, then retry." while the deed had in fact
   generated at 16:45, been signed, and been delivered. The activity log said so;
   the card said the opposite.

   Two separate defects sat behind that one sentence.

   THE CONDITION was `deedState !== 'awaiting_tenant'` used as a catch-all, so every
   state that was not exactly "awaiting the tenant" produced an allegation of
   failure. A paid application with no document and no error is not a failure, it is
   a deed being prepared, which is the normal state in the seconds after payment and
   the state a page loaded at that moment keeps showing, because loadPayment reads
   once on mount and only re-polls behind ?paid=1.

   THE REMEDY was supplier-rail language. On our own estate the recipient resolves
   from the agency's own active people, so "check the branch has an agent contact"
   named a thing an agency user's screens do not have and a remedy they could not
   carry out.

   The rule is extracted here so it can be asserted at all: it used to be an inline
   conditional inside JSX, which is why it went four months without one. */
import { describe, expect, it } from 'vitest';
import { DEED_PREPARING_WINDOW_MIN, deedCardState, deedIsOverdue, mayGenerateDeed } from './paymentService';

const pi = (deedState: string | null, pandadocDocumentId: string | null) =>
  ({ deedState, pandadocDocumentId } as Parameters<typeof deedCardState>[0]);

describe('the deed card', () => {
  it('shows the tenant is signing when a document exists and is out', () => {
    expect(deedCardState(pi('awaiting_tenant', 'P4aQBKNwxqmBWajkuBTUGB'))).toBe('awaiting_tenant');
  });

  /* THE STATE THAT DID NOT EXIST, and the reason for the report. */
  it('says a deed is being prepared when nothing has happened yet', () => {
    expect(deedCardState(pi(null, null))).toBe('preparing');
  });

  it('never alleges a failure for a state that is merely early', () => {
    // The old condition returned the error card for both of these.
    expect(deedCardState(pi(null, null))).not.toBe('error');
    expect(deedCardState(pi(null, 'P4aQBKNwxqmBWajkuBTUGB'))).not.toBe('error');
  });

  /* A half-written row: the state says the tenant is signing and there is no
     document for them to sign. Treated as preparing rather than as awaiting, so the
     card does not promise a signing journey that has no document behind it. */
  it('treats awaiting_tenant with no document as still preparing', () => {
    expect(deedCardState(pi('awaiting_tenant', null))).toBe('preparing');
  });

  it('still reports the three real failures', () => {
    expect(deedCardState(pi('error', null))).toBe('error');
    expect(deedCardState(pi('declined', 'doc'))).toBe('declined');
    expect(deedCardState(pi('voided', 'doc'))).toBe('voided');
  });

  it('reports a failure even where a document exists, because the state is the fact', () => {
    // A declined or voided deed has a document; the document is not the question.
    expect(deedCardState(pi('error', 'doc'))).toBe('error');
  });
});

describe('whether Generate can do anything', () => {
  /* claim_tenancy_deed refuses when a document id is already present, so with a
     live document the button is an offer the database declines. That is the guard
     against a second PandaDoc document (asked directly during the walk: clicking
     Generate while the error showed did NOT create one), and it is also why the
     control must not be shown: nothing happens and the reader learns nothing. */
  it('is refused once a document exists', () => {
    expect(mayGenerateDeed(pi('error', 'P4aQBKNwxqmBWajkuBTUGB'))).toBe(false);
    expect(mayGenerateDeed(pi('awaiting_tenant', 'doc'))).toBe(false);
  });

  it('is offered only when there is nothing to resend', () => {
    expect(mayGenerateDeed(pi('error', null))).toBe(true);
    expect(mayGenerateDeed(pi(null, null))).toBe(true);
  });
});

/* WHEN "BEING PREPARED" STOPS BEING TRUE.

   Reported from the walk on GR-20763: paid on 20 September, seen on 28 September,
   and the card read "Deed sent for signature shortly after payment" with no
   control of any kind. Two things had to be true at once for that.

   The card's whole branch required `pi.deedState` to be set, and GR-20763 had it
   null: generation was never ATTEMPTED rather than having failed, so the state a
   failure would have written was never written. Null is the state this card most
   needs to speak to, and it was the one state it fell silent on.

   And "being prepared" was unconditional, which was right for the seconds after
   payment and wrong for ever afterwards. Nothing was preparing it: the only
   automatic generation in the system was stripe-webhook at the moment of payment,
   so past Stripe's own redelivery window nothing was coming at all. The hourly
   sweep (20261006100000) is the other half of this fix; the window here is the
   same 30 minutes it uses, so the card and the cron never disagree about whether
   a deed is late. */
describe('a deed that has not turned up', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const app = (over: Partial<Parameters<typeof deedIsOverdue>[0]> = {}) =>
    ({ status: 'paid', paymentState: 'paid', pandadocDocumentId: null, paidAt: ago(60), ...over }) as Parameters<typeof deedIsOverdue>[0];

  it('is not overdue in the minutes after payment, when it really is in flight', () => {
    expect(deedIsOverdue(app({ paidAt: ago(1) }))).toBe(false);
    expect(deedIsOverdue(app({ paidAt: ago(DEED_PREPARING_WINDOW_MIN - 1) }))).toBe(false);
  });

  it('is overdue once the window has passed, which is GR-20763 eight days later', () => {
    expect(deedIsOverdue(app({ paidAt: ago(DEED_PREPARING_WINDOW_MIN + 1) }))).toBe(true);
    expect(deedIsOverdue(app({ paidAt: ago(60 * 24 * 8) }))).toBe(true);
  });

  it('is not overdue once a document exists, however long ago it was paid', () => {
    expect(deedIsOverdue(app({ paidAt: ago(60 * 24 * 8), pandadocDocumentId: 'EWBPU7owvEQj9NKLiSQ7Qn' }))).toBe(false);
  });

  /* The money went back, so the guarantee it paid for must not be issued and the
     card must not invite anyone to issue it. Same exclusion the sweep makes. */
  it('is never overdue on a refunded application', () => {
    expect(deedIsOverdue(app({ paymentState: 'refunded' }))).toBe(false);
  });

  it('says nothing about an application that has not paid', () => {
    expect(deedIsOverdue(app({ status: 'sent' }))).toBe(false);
    expect(deedIsOverdue(app({ status: 'draft' }))).toBe(false);
  });

  /* A paid row with no paid_at is a broken row, not a late deed. Guessing a
     timestamp for it would offer Generate on something nobody understands. */
  it('does not guess when there is no payment timestamp', () => {
    expect(deedIsOverdue(app({ paidAt: null }))).toBe(false);
    expect(deedIsOverdue(app({ paidAt: 'not a date' }))).toBe(false);
  });

  /* THE PAIR THAT DECIDES THE BUTTON. Overdue and no document is the only
     combination that offers Generate; the card says "being prepared" inside the
     window and offers Resend once a document exists. */
  it('offers Generate only when it is both overdue and undocumented', () => {
    const late = app();
    expect(deedIsOverdue(late) && mayGenerateDeed(late)).toBe(true);
    const fresh = app({ paidAt: ago(2) });
    expect(deedIsOverdue(fresh) && mayGenerateDeed(fresh)).toBe(false);
    const done = app({ pandadocDocumentId: 'doc' });
    expect(deedIsOverdue(done) && mayGenerateDeed(done)).toBe(false);
  });
});
