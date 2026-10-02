/* WHAT A PEOPLE LIST SAYS SOMEBODY SEES. */
import { describe, expect, it } from 'vitest';
import { agencySees, supplierSees } from './positionsService';

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

   ASKED OF agencySees AND supplierSees since 2026-10-02, where it used to be
   asked of describePosition. That function answered this question AND "where
   do they sit" in one string, which is why the answer lived in a column
   called Office; Matt split the two columns and the function went with it.
   The subject has not changed: it is still two lists that must not word one
   role two ways, and there are still exactly two of them.
   =========================================================================== */
describe('what a Developer sees', () => {
  it('is named, not dashed', () => {
    expect(agencySees('developer', null)).toBe('Dev Centre and API (no commission)');
    expect(supplierSees('developer')).toBe('Dev Centre and API (no commission)');
  });

  /* THE ABSENCE OF A POSITION MEANS THE ROLE DECIDES, which is the same
     reasoning the superadmin arm was written for. A developer holds no
     position because there is no ladder for them to stand on. */
  it('whether or not they hold a position', () => {
    expect(agencySees('developer', null)).not.toBe('Own referrals');
    expect(agencySees('developer', 'branch')).toBe(agencySees('developer', null));
  });

  /* AND IT SAYS THE ONE THING A PEOPLE LIST IS READ FOR: whether this
     person can see the money. */
  it('and says they cannot see commission', () => {
    expect(agencySees('developer', null)).toMatch(/no commission/);
    expect(supplierSees('developer')).toMatch(/no commission/);
  });

  /* THE OTHER ROLES ARE UNTOUCHED, and the two rails answer for
     themselves: a supplier's Management sees the whole company because
     partner_id IS the boundary there, while ours is narrowed by a
     position. */
  it('while nobody else is affected', () => {
    expect(agencySees('superadmin', null)).toBe('Everything');
    expect(agencySees('referrer', 'branch')).toBe('Own referrals');
    expect(agencySees('management', 'agency')).toBe('The whole agency');
    expect(supplierSees('management')).toBe('Everything');
    expect(supplierSees('referrer')).toBe('Own referrals');
  });
});
