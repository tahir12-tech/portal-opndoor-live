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
import { deedCardState, mayGenerateDeed } from './paymentService';

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
