/* RESEND INVITE CANNOT ASK FOR A POSITION THE PERSON ALREADY HOLDS.
 *
 * Round 5, H3. Everybody on our estate holds a position, so invite-user
 * refuses to create anybody without one. That refusal was also reached on the
 * RE-INVITE path, which creates nobody: `resendInvite` in usersService sends a
 * name, an email and a role and no scope at all, so `scopeKind` was empty and
 * every "Resend invite" on the estate answered
 *
 *   Choose the group, brand or branch this person will hold.
 *
 * for a person who was already holding one. A rule about creating people,
 * enforced on a path that creates nobody. That is a lock, and a lock is as
 * much a defect as a hole: the difference is only who it inconveniences.
 *
 * WHAT THIS ASSERTS AND WHY IT IS NOT A GREP. The other edge-function guards
 * in this directory read source text, because Deno is not installed here and
 * `npm test` cannot collect the Deno suites. This one does not have to:
 * `_shared/invitePosition.ts` imports nothing, so the real decision can be
 * imported and exercised. It is the logic under test, not a regex hoping to
 * describe it.
 *
 * THE FOUR CASES THAT MUST NOT MOVE are asserted alongside, because the
 * obvious fix -- drop the requirement when scopeKind is empty -- would bring
 * back the unpositioned account that 20261006300000 exists to forbid.
 */
import { describe, expect, it } from 'vitest';
import {
  NEEDS_A_POSITION,
  resolveInvitePosition,
  type PositionAsk,
} from '../../supabase/functions/_shared/invitePosition.ts';

/** A management re-invite as usersService.resendInvite actually sends it:
 *  no scopeKind, no scopeTarget, no branch. */
const resend = (over: Partial<PositionAsk> = {}): PositionAsk => ({
  inviteeOnOurEstate: true,
  scopeKind: null,
  scopeTarget: null,
  role: 'management',
  homeBranchId: null,
  alreadyPositioned: true,
  ...over,
});

describe('re-inviting somebody who already holds a position', () => {
  /* THE ASSERTION THE FILE IS FOR. */
  it('is allowed, and asks for no position', () => {
    const out = resolveInvitePosition(resend());
    expect(out).toEqual({ ok: true, scopeKind: null, scopeTarget: null });
  });

  it('is allowed for a negotiator too, who also sends no branch on a resend', () => {
    const out = resolveInvitePosition(resend({ role: 'referrer' }));
    expect(out.ok).toBe(true);
  });
});

describe('and the rule it must not repeal', () => {
  it('still refuses a NEW person on the estate with no position', () => {
    const out = resolveInvitePosition(resend({ alreadyPositioned: false }));
    expect(out).toEqual({ ok: false, error: NEEDS_A_POSITION });
  });

  /* THE CASE THAT MAKES "already exists" THE WRONG TEST. Somebody created
     before 20261006300000 can exist and hold nothing, and that is precisely
     the state the constraint outlaws. Re-inviting them must still ask. */
  it('still refuses an EXISTING person on the estate who holds no position', () => {
    const out = resolveInvitePosition(resend({ alreadyPositioned: false }));
    expect(out.ok).toBe(false);
  });

  it('still derives a branch position for a new negotiator placed at a branch', () => {
    const out = resolveInvitePosition(resend({
      alreadyPositioned: false, role: 'referrer', homeBranchId: 'b-1',
    }));
    expect(out).toEqual({ ok: true, scopeKind: 'branch', scopeTarget: 'b-1' });
  });

  it('still asks nothing of an invitee who is not on our estate', () => {
    const out = resolveInvitePosition(resend({
      inviteeOnOurEstate: false, alreadyPositioned: false,
    }));
    expect(out.ok).toBe(true);
  });

  it('passes an explicit position straight through', () => {
    const out = resolveInvitePosition(resend({
      alreadyPositioned: false, scopeKind: 'agency', scopeTarget: 'a-1',
    }));
    expect(out).toEqual({ ok: true, scopeKind: 'agency', scopeTarget: 'a-1' });
  });
});
