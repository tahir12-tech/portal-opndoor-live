/* Per-role gating of the two deed actions on an awaiting-signature deed.
   - "Resend signature request" (tenant nudge): owning Referrer, Management, admin.
   - "Replace and resend deed" (void + reissue): Management and opndoor admin only.
   Run with `npm run smoke`. */
import { describe, expect, it } from 'vitest';
import { amendStartBlockedReason, canAmendTenancyStart, canReplaceDeed, canSendDeed } from '@/data';
import type { Role } from '@/data/types';

const ROLES: Role[] = ['referrer', 'management', 'superadmin'];

describe('Replace and resend deed (canReplaceDeed)', () => {
  it('is Management and opndoor admin only, never a Referrer', () => {
    expect(canReplaceDeed('referrer')).toBe(false);
    expect(canReplaceDeed('management')).toBe(true);
    expect(canReplaceDeed('superadmin')).toBe(true);
  });
});

describe('Resend signature request audience (canSendDeed proxy: owning Referrer / Management / admin)', () => {
  it('every authorised viewer of their own awaiting deed qualifies', () => {
    // A Referrer viewing their OWN application qualifies; Management/admin always do.
    for (const role of ROLES) expect(canSendDeed(role, true)).toBe(true);
  });
  it('a Referrer never qualifies on an application they do not own', () => {
    expect(canSendDeed('referrer', false)).toBe(false);
    // Management and admin still qualify regardless of ownership.
    expect(canSendDeed('management', false)).toBe(true);
    expect(canSendDeed('superadmin', false)).toBe(true);
  });
});

/* THE AMEND BOUNDARY IS THE START DATE, and used to be the deed state.
 *
 * Matt, 2026-10-04: "agency and supplier users can change a start date only
 * before the tenancy starts (signed or not); after the start date, only
 * Opndoor staff can."
 *
 * The describe block below was called "is deed-state aware" and asserted
 * that an executed deed was Management-only. That is no longer true, and the
 * assertions are REPLACED rather than added to: a suite that holds both
 * rules holds neither. What survives unchanged is ownership, which the new
 * rule does not touch.
 */
describe('Amend boundary (canAmendTenancyStart) turns on the start date', () => {
  it('before the start, an owning Referrer may amend whatever the deed state', () => {
    expect(canAmendTenancyStart('referrer', 'sent', true)).toBe(true);
    expect(canAmendTenancyStart('referrer', 'paid', true, 'awaiting_tenant')).toBe(true);
    expect(canAmendTenancyStart('referrer', 'paid', true, 'error')).toBe(true);
    expect(canAmendTenancyStart('referrer', 'paid', true, null)).toBe(true);
    // THE WIDENING. A signed deed used to stop them here.
    expect(canAmendTenancyStart('referrer', 'deed', true, 'executed', false)).toBe(true);
  });
  it('a Referrer cannot amend one they do not own', () => {
    expect(canAmendTenancyStart('referrer', 'sent', false)).toBe(false);
    expect(canAmendTenancyStart('referrer', 'paid', false, 'awaiting_tenant')).toBe(false);
    // Ownership outlives the rule change, including after the start date.
    expect(canAmendTenancyStart('referrer', 'paid', false, null, true)).toBe(false);
  });
  it('once the tenancy has started, only an opndoor admin may', () => {
    // THE NARROWING. All three of these could amend the day before.
    expect(canAmendTenancyStart('referrer', 'paid', true, null, true)).toBe(false);
    expect(canAmendTenancyStart('management', 'deed', false, 'executed', true)).toBe(false);
    // BOTH STAFF ROLES. Matt, 2026-10-04: "any Opndoor staff (admins and
    // opndoor managers) can change a start date at any time". This asserted
    // false until 20261008100000 widened the RPC's reach guard from
    // is_admin() to is_opndoor_staff(); the predicate could not say yes
    // before the guard did.
    expect(canAmendTenancyStart('opndoor_manager', 'paid', false, null, true)).toBe(true);
    expect(canAmendTenancyStart('superadmin', 'deed', false, 'executed', true)).toBe(true);
  });
  it('and opndoor staff may before the start as well, which "at any time" covers', () => {
    expect(canAmendTenancyStart('opndoor_manager', 'paid', false, null, false)).toBe(true);
    expect(canAmendTenancyStart('opndoor_manager', 'deed', false, 'executed', false)).toBe(true);
  });
  it('management still amends a signed deed before the start', () => {
    expect(canAmendTenancyStart('management', 'deed', false, 'executed')).toBe(true);
    expect(canAmendTenancyStart('superadmin', 'paid', false, 'executed')).toBe(true);
  });
});

/* THE SENTENCE THE DIALOG SHOWS, and who is shown it.
 *
 * Matt: "Show the reason in the dialog for everyone else ('The tenancy has
 * started. Contact opndoor to change the date.')." A reason is only worth
 * saying to somebody the start date is actually standing in the way of, so
 * the null cases matter as much as the sentence: a Referrer looking at
 * someone else's referral never had the button and must not be told that a
 * date is the reason. */
describe('amendStartBlockedReason says why, to the right people', () => {
  const REASON = 'The tenancy has started. Contact opndoor to change the date.';
  it('tells an agency Manager and an owning Negotiator', () => {
    expect(amendStartBlockedReason('management', false, true)).toBe(REASON);
    expect(amendStartBlockedReason('referrer', true, true)).toBe(REASON);
  });
  it('says nothing before the tenancy starts', () => {
    expect(amendStartBlockedReason('management', false, false)).toBeNull();
    expect(amendStartBlockedReason('referrer', true, false)).toBeNull();
  });
  it('says nothing to someone who may still do it, or never could', () => {
    expect(amendStartBlockedReason('superadmin', false, true)).toBeNull();
    // Staff, so nothing is blocking them and there is nothing to explain.
    expect(amendStartBlockedReason('opndoor_manager', false, true)).toBeNull();
    // Not theirs. The start date is not what is stopping them.
    expect(amendStartBlockedReason('referrer', false, true)).toBeNull();
  });
});
