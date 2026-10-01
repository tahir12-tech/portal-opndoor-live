/* WHAT A PEOPLE LIST SAYS SOMEBODY SEES. */
import { describe, expect, it } from 'vitest';
import { describePosition } from './positionsService';

/* ===========================================================================
   A DEVELOPER SEES A GREAT DEAL, AND THE COLUMN SHOULD SAY SO.

   Matt, 2026-10-01, verbatim: 'People lists: a Developer's "Sees" reads "Dev
   Centre and API (no commission)" instead of "-".'

   TWO LISTS WERE WRONG IN TWO DIFFERENT WAYS, which is how it survived: the
   supplier's people tab fell through to "-" and /users fell through to "Own
   referrals". Both read as "almost nothing" for somebody who reads the whole
   supplier's book read-only plus the Dev Centre -- and ROLE_OPTIONS already
   records what that costs: "Sees the Dev Centre only" read as seeing
   nothing, which made the role look useless and led to it being handed out
   as management instead.
   =========================================================================== */
describe('what a Developer sees', () => {
  it('is named, not dashed', () => {
    expect(describePosition([], true, 'developer')).toBe('Dev Centre and API (no commission)');
  });

  /* THE ABSENCE OF A POSITION MEANS THE ROLE DECIDES, which is the same
     reasoning the superadmin arm above it was written for. A developer
     holds no position because there is no ladder for them to stand on. */
  it('whether or not they hold a position', () => {
    expect(describePosition([], true, 'developer')).not.toBe('Own referrals');
  });

  /* AND IT SAYS THE ONE THING A PEOPLE LIST IS READ FOR: whether this
     person can see the money. */
  it('and says they cannot see commission', () => {
    expect(describePosition([], true, 'developer')).toMatch(/no commission/);
  });

  /* THE OTHER ROLES ARE UNTOUCHED. */
  it('while nobody else is affected', () => {
    expect(describePosition([], true, 'superadmin')).toBe('Everything');
    expect(describePosition([], true, 'referrer')).toBe('Own referrals');
    expect(describePosition([], true, 'management')).toBe('Own referrals');
  });
});
