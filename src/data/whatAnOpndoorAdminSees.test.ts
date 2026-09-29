/* WALK FIXES 2 AND 11. AN OPNDOOR ADMIN SEES EVERYTHING, AND SHOULD SAY SO.
 *
 * Matt, walking dev:
 *   2.  "'Sees: Own referrals' is shown for an Opndoor admin. Admin sees
 *        everything; it should say so."
 *   11. "The Opndoor team list shows 'Sees: Own referrals' for every admin,
 *        including new invites (Matthew Dwyer). Same fix as item 2, applies
 *        to every Opndoor team member."
 *
 * ONE FIX, and Matt says so himself. He hit it twice because the label is
 * computed in `describePosition` and rendered on two screens, so fixing it on
 * either screen would have left the other. It belongs where the sentence is
 * made.
 *
 * WHY IT SAID THAT. `describePosition` returns 'Own referrals' whenever the
 * person holds no position. For an agency negotiator that is exactly right --
 * no position means they see their own work. For an Opndoor admin it is
 * precisely backwards: they hold no position BECAUSE their role already
 * grants them everything, and the absence means the opposite of what the
 * function assumes.
 *
 * So the function cannot answer from the positions alone. It needs the role,
 * which is the thing that actually decides.
 *
 * THE REGRESSION GUARD IS THE IMPORTANT HALF. 'Own referrals' is correct and
 * must stay for a negotiator; a fix that made everybody "Everything" would
 * read as working while telling an agency their negotiator sees the whole
 * estate.
 */
import { describe, expect, it } from 'vitest';
import { describePosition } from './positionsService';
import type { Position } from './positionsService';

const NONE: Position[] = [];
const AT_A_BRANCH: Position[] = [
  { kind: 'branch', targetId: 'br-1', targetName: "Regent's Park" } as Position,
];

describe('an Opndoor team member', () => {
  it('sees everything, because their role grants it and not a position', () => {
    expect(describePosition(NONE, true, 'superadmin')).toBe('Everything');
  });

  it('and so does an opndoor manager', () => {
    expect(describePosition(NONE, true, 'opndoor_manager')).toBe('Everything');
  });

  /* ITEM 11's SPECIFIC CASE: a brand new invite holds no position yet and is
     not deactivated or special in any way. The role is known at invite time,
     so nothing about being pending changes the answer. */
  it('including one who has only just been invited and holds nothing yet', () => {
    expect(describePosition(NONE, false, 'superadmin')).toBe('Everything');
  });
});

describe('everybody else is unchanged', () => {
  /* THE HALF THAT MUST NOT MOVE. */
  it('a negotiator with no position still sees their own referrals', () => {
    expect(describePosition(NONE, true, 'referrer')).toBe('Own referrals');
  });

  it('and so does an agency manager who has not been placed', () => {
    expect(describePosition(NONE, true, 'management')).toBe('Own referrals');
  });

  it('and a placed person still reads as where they are placed', () => {
    expect(describePosition(AT_A_BRANCH, true, 'management')).toBe("Branch: Regent's Park");
    expect(describePosition(AT_A_BRANCH, false, 'management')).toBe("Regent's Park");
  });

  /* CALLED WITHOUT A ROLE, as the older call sites do until they are
     updated, it must behave exactly as it always did rather than silently
     changing what a screen says. */
  it('and with no role given at all, nothing changes', () => {
    expect(describePosition(NONE)).toBe('Own referrals');
    expect(describePosition(AT_A_BRANCH)).toBe("Branch: Regent's Park");
  });
});
