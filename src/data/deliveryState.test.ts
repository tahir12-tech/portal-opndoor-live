/* THE TWO DELIVERY STATES, AND WHO SEES WHICH.

   Rosa opened the Delivery failed filter on her own book and found a deed that
   had never been sent anywhere and had a perfectly good recipient waiting for
   it. Three faults met on that row and this file locks the fix for all three:

     1. The filter asked the SUPPLIER rail's question (is there an agent_contacts
        mailbox?) of an agency that delivers to its PEOPLE. Every Regent deed
        answered "failed".
     2. "Nobody to send to" and "a send that errored" were one flag, so an ops
        queue was reported to a customer as a failure.
     3. Nothing recorded whether a send had been attempted at all, so "not yet"
        and "went wrong" were indistinguishable.

   The fixture is deliberately the four states side by side, because the bug was
   not that one of them was computed wrongly: it was that only one of them
   existed. */
import { describe, expect, it } from 'vitest';
import { deliveryStateOf, deliveryBadge, maySeeDeliveryState } from './deliveryState';

const D = (s: string) => new Date(s);

const notADeed = { status: 'paid' as const };
const neverAttempted = { status: 'deed' as const };
const delivered = { status: 'deed' as const, deedSentAt: D('2026-09-20') };
const held = { status: 'deed' as const, awaitingStaffSend: true };
const failed = { status: 'deed' as const, deedSentAt: D('2026-09-20'), deliveryFailedAt: D('2026-09-21') };

describe('which state a row is in', () => {
  it('a row that is not a deed has no delivery state to report', () => {
    expect(deliveryStateOf(notADeed)).toBe('not_attempted');
  });

  it('an issued deed with no attempt and nothing wrong is simply not attempted', () => {
    // THE ROSA CASE. Executed by a seed, never sent, recipient fine. Under the
    // old proxy this was "Delivery failed" because Regent has no mailbox.
    expect(deliveryStateOf(neverAttempted)).toBe('not_attempted');
  });

  it('a sent deed with no error is delivered', () => {
    expect(deliveryStateOf(delivered)).toBe('delivered');
  });

  it('nobody to send to is "cannot deliver", not a failure', () => {
    expect(deliveryStateOf(held)).toBe('cannot_deliver');
  });

  it('a send that errored is a failure', () => {
    expect(deliveryStateOf(failed)).toBe('failed');
  });

  it('a failure outranks the queue, because it is the newer and actionable fact', () => {
    // A row can be both: the send errored AND it is queued for a human. What the
    // reader needs to know is that somebody tried and it did not arrive.
    expect(deliveryStateOf({ ...failed, awaitingStaffSend: true })).toBe('failed');
  });
});

describe('who is shown which state', () => {
  it('everybody sees a failure, including the agency and the owning referrer', () => {
    // They are who is waiting for the deed, and send_deed_to_agent already lets
    // management-in-scope and the owning referrer resend it.
    for (const role of ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'] as const) {
      expect(maySeeDeliveryState(role, 'failed')).toBe(true);
    }
  });

  it('only Opndoor sees "cannot deliver", because only Opndoor can clear it', () => {
    expect(maySeeDeliveryState('superadmin', 'cannot_deliver')).toBe(true);
    expect(maySeeDeliveryState('opndoor_manager', 'cannot_deliver')).toBe(true);
    // An agency cannot add a person to its own org (the Team ruling), so telling
    // them their deed is stuck invites them to fix something they cannot reach.
    expect(maySeeDeliveryState('management', 'cannot_deliver')).toBe(false);
    expect(maySeeDeliveryState('referrer', 'cannot_deliver')).toBe(false);
  });

  it('nobody is shown a badge for the two states that are not problems', () => {
    expect(maySeeDeliveryState('superadmin', 'delivered')).toBe(false);
    expect(maySeeDeliveryState('superadmin', 'not_attempted')).toBe(false);
  });
});

describe('the badge', () => {
  it('gives an agency manager nothing on the row Rosa reported', () => {
    expect(deliveryBadge('management', neverAttempted)).toBeNull();
  });

  it('gives an agency manager a failure when there genuinely is one', () => {
    expect(deliveryBadge('management', failed)?.label).toBe('Delivery failed');
  });

  it('gives an agency manager nothing when the deed is merely queued with us', () => {
    expect(deliveryBadge('management', held)).toBeNull();
    expect(deliveryBadge('superadmin', held)?.label).toBe('Held for send');
  });

  it('names the state and never the mechanism', () => {
    // Nobody outside deliveryState.ts should have to know what
    // awaiting_staff_send is, least of all a letting agent.
    const shown = [
      deliveryBadge('superadmin', failed), deliveryBadge('superadmin', held),
    ].map((b) => `${b?.label} ${b?.title}`).join(' ');
    expect(shown).not.toMatch(/awaiting_staff_send|deed_state|agent_contacts|null/i);
  });
});
