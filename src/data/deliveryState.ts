/* =====================================================================
   DID THE DEED GET THERE?

   One question, asked in one place, because it was previously asked in three
   and all three asked the wrong thing:

     status === 'deed' && !contactForApplication(agency, branch).contact

   That is the SUPPLIER rail's question. It looks for an agent_contacts mailbox,
   and an agency of ours does not have one: since 20260923120000 an estate deed
   goes to the org's active PEOPLE through deed_people_target. Regent has no
   mailbox at all, so every Regent deed answered "delivery failed" — which is
   what Rosa found on her own book, against a deed that had a perfectly good
   recipient and had never been sent anywhere.

   AND IT CONFLATED TWO STATES that want different audiences and different
   buttons:

     CANNOT DELIVER  Nobody on the rail's ladder can receive it. Nothing was
                     sent and nothing errored. It parks for a staff send. This
                     is an OPS state: there is nothing the agency can do, and
                     telling them their deed failed when it is sitting in our
                     queue is both alarming and untrue.
     DELIVERY FAILED A send was attempted and errored. There is an address it
                     went to and a reason it did not arrive. The AGENCY sees
                     this, because they are who is waiting and who can Resend.

   Both are now read off real columns that the delivery path writes, not
   inferred from the shape of the org tree. awaiting_staff_send has existed
   since 20260925150000 — added precisely because the activity row was not
   filterable — and had never once been selected by the client.
   ===================================================================== */
import type { Role } from './types';

export type DeliveryState =
  /** No deed yet, or a deed with no attempt made and nothing wrong. */
  | 'not_attempted'
  /** Sent, and nothing has errored since. */
  | 'delivered'
  /** A send was attempted and errored. Agency-visible; offers Resend. */
  | 'failed'
  /** Nobody to send to on this rail. Ops queue; admin-facing only. */
  | 'cannot_deliver';

/** The fields the rule needs, so both ApplicationSummary and FullApp satisfy it
    without either importing the other. */
export interface DeliveryFacts {
  status?: string;
  deedSentAt?: Date | null;
  awaitingStaffSend?: boolean;
  deliveryFailedAt?: Date | null;
}

/**
 * Which of the four a row is in.
 *
 * ORDER IS THE RULE. A row that errored is 'failed' even when it is also queued
 * for a staff send, because the failure is the newer and more actionable fact.
 * A row with nobody to send to was never attempted, so it is 'cannot_deliver'
 * and not 'failed'. A row with neither is simply not attempted, which is not a
 * problem and must not render as one.
 */
export function deliveryStateOf(a: DeliveryFacts): DeliveryState {
  if (a.status !== 'deed') return 'not_attempted';
  if (a.deliveryFailedAt) return 'failed';
  if (a.awaitingStaffSend) return 'cannot_deliver';
  if (a.deedSentAt) return 'delivered';
  return 'not_attempted';
}

/**
 * Who is shown which state.
 *
 * A failure is the agency's business: they are waiting for the deed and the
 * Resend is theirs to press. "Cannot deliver" is ours: it means our own record
 * of who can receive is incomplete, and it is on a staff queue. Showing that to
 * a customer invites them to fix something they have no control over — they
 * cannot add a person to their own org, by the Team ruling.
 */
export function maySeeDeliveryState(role: Role, state: DeliveryState): boolean {
  // EVERYONE sees a failure, referrers included: send_deed_to_agent already
  // admits the owning referrer, so the person who can fix it must be able to
  // see it. This is the one delivery surface that is not ops-only.
  if (state === 'failed') return true;
  if (state === 'cannot_deliver') return role === 'superadmin' || role === 'opndoor_manager';
  return false;
}

/** The badge, or null where this viewer sees nothing. Wording names the STATE,
    not the mechanism: nobody outside this file should have to know what
    awaiting_staff_send is. */
export function deliveryBadge(role: Role, a: DeliveryFacts): { label: string; title: string } | null {
  const state = deliveryStateOf(a);
  if (!maySeeDeliveryState(role, state)) return null;
  if (state === 'failed') {
    return {
      label: 'Delivery failed',
      title: 'The executed deed was sent and did not arrive. Open the application to see where it went and resend it.',
    };
  }
  return {
    label: 'Held for send',
    title: 'The deed is executed but nobody active could receive it automatically. It is queued for a staff send.',
  };
}
