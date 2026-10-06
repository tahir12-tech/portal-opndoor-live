/* WALK FIXES 2 AND 11. AN OPNDOOR ADMIN SEES EVERYTHING, AND SHOULD SAY SO.
 *
 * Matt, walking dev:
 *   2.  "'Sees: Own referrals' is shown for an Opndoor admin. Admin sees
 *        everything; it should say so."
 *   11. "The Opndoor team list shows 'Sees: Own referrals' for every admin,
 *        including new invites (Matthew Dwyer). Same fix as item 2, applies
 *        to every Opndoor team member."
 *
 * ONE FIX, and Matt says so himself. He hit it twice because the label was
 * computed in one place and rendered on two screens, so fixing it on either
 * screen would have left the other. It belongs where the sentence is made.
 *
 * WHY IT SAID THAT. The old `describePosition` returned 'Own referrals'
 * whenever the person held no position. For an agency negotiator that is
 * exactly right -- no position means they see their own work. For an Opndoor
 * admin it is precisely backwards: they hold no position BECAUSE their role
 * already grants them everything, and the absence means the opposite of what
 * the function assumed. So the answer cannot come from the positions alone.
 * It needs the role, which is the thing that actually decides.
 *
 * =====================================================================
 * AND ON 2026-10-02 THE QUESTION WAS SPLIT IN TWO.
 * =====================================================================
 *
 * `describePosition` answered "what do they see" AND "where do they sit" in
 * one string, which is why "Everything" was being printed in a column headed
 * Office. Matt: "Office column on every people screen: show the branch name
 * for someone positioned at a branch, and 'Whole agency' for someone
 * positioned at the agency." So there are now two functions and two columns,
 * and the defect above has two forms to guard rather than one:
 *
 *   agencySees   must say "Everything" for an opndoor admin, and must NOT
 *                say it for a negotiator
 *   officeLabel  must say NOTHING for an opndoor admin, because they hold no
 *                office -- the same absence, read correctly this time
 *
 * THE REGRESSION GUARD IS STILL THE IMPORTANT HALF. 'Own referrals' is
 * correct and must stay for a negotiator; a fix that made everybody
 * "Everything" would read as working while telling an agency their
 * negotiator sees the whole estate.
 */
import { describe, expect, it } from 'vitest';
import { agencySees, officeLabel } from './positionsService';
import type { Position } from './positionsService';

const NONE: Position[] = [];
const AT_A_BRANCH: Position[] = [
  { kind: 'branch', targetId: 'br-1', targetName: "Regent's Park" } as Position,
];
const AT_THE_AGENCY: Position[] = [
  { kind: 'agency', targetId: 'ag-1', targetName: "Regent's Lettings" } as Position,
];

describe('an Opndoor team member', () => {
  it('sees everything, because their role grants it and not a position', () => {
    expect(agencySees('superadmin', null)).toBe('Everything');
  });

  it('and so does an opndoor manager', () => {
    expect(agencySees('opndoor_manager', null)).toBe('Everything');
  });

  /* ITEM 11's SPECIFIC CASE: a brand new invite holds no position yet and is
     not deactivated or special in any way. The role is known at invite time,
     so nothing about being pending changes the answer. */
  it('including one who has only just been invited and holds nothing yet', () => {
    expect(agencySees('superadmin', null)).toBe('Everything');
  });

  /* THE SAME ABSENCE, IN THE OTHER COLUMN. They hold no position, so they
     hold no office, and the cell is empty rather than borrowing the Sees
     answer. PeopleTable drops a column no row fills, so the opndoor team
     page has no Office column at all -- which is the truth about opndoor's
     own staff. */
  it('and holds no office, so the Office cell says nothing', () => {
    expect(officeLabel(NONE)).toBe('');
  });
});

describe('everybody else is unchanged', () => {
  /* THE HALF THAT MUST NOT MOVE. */
  it('a negotiator still sees their own referrals', () => {
    expect(agencySees('referrer', 'branch')).toBe('Own referrals');
    expect(agencySees('referrer', 'agency')).toBe('Own referrals');
  });

  /* AN AGENCY MANAGER WHO HAS NOT BEEN PLACED is a row our estate does not
     admit -- a constraint trigger refuses it, and app_may_reach_application_org
     has no partner-wide arm, so an unpositioned caller reaches nothing. The
     cell says "none of the above" rather than naming a reach they do not
     have. */
  it('and an agency manager who has not been placed claims nothing', () => {
    expect(agencySees('management', null)).toBe('-');
  });

  it('and a placed person still reads as where they are placed', () => {
    expect(officeLabel(AT_A_BRANCH)).toBe("Regent's Park");
    expect(officeLabel(AT_THE_AGENCY)).toBe('Whole agency');
  });
});
