/* SUPPLIER MANAGEMENT COULD NOT SEE ITS OWN COMPANY'S COMMISSION.
 *
 * Matt, 2026-10-03, verbatim: "I invited Matthew Dwyer as 'Management' from
 * Kestrel's own Add user dialog, whose only options are Management, Referrer
 * and Developer. So supplier 'Management' invited that way gets
 * sees_commission = false, which is the defect: supplier Management must see
 * commission. Fix the supplier invite, and fix View as to read the viewed
 * person's access, not the admin's."
 *
 * I READ IT WRONG FIRST AND MATT CORRECTED ME. I reported that the user "was
 * created at a level without commission access", because on the AGENCY rail
 * Director and Manager are both `role = 'management'` and `sees_commission` is
 * the only thing between them -- so false there means "a Manager", which is a
 * real level that is not shown commission. THE SUPPLIER RAIL HAS NO SUCH
 * LADDER: SUPPLIER_LEVELS is the whole of it, three levels, and Management is
 * the top. False there did not mean a junior level. It meant nobody invited
 * through that dialog could ever see the one figure a supplier's management is
 * there for.
 *
 * TWO BUGS, AND THE SECOND HID THE FIRST. View as answered from the ADMIN:
 * `maySeeCommission` is unconditionally true for superadmin, and View as
 * changes the scope, not the role. So Opndoor saw a Kestrel page with
 * commission on it that no Kestrel user could open -- which is the opposite of
 * what View as is for.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPLIER_LEVELS, AGENCY_LEVELS } from '@/data/types';
import { topLevelSeesCommission } from '@/data/capabilities';
import { hydratePartners } from '@/data/partnersService';
import { ALL_PARTNERS } from '@/data/types';
import type { Partner } from '@/data/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the supplier rail’s levels', () => {
  it('are three, and Management is the top', () => {
    expect(SUPPLIER_LEVELS.map((l) => l.level)).toEqual(['Management', 'Referrer', 'Developer']);
  });

  it('and Management sees commission', () => {
    expect(SUPPLIER_LEVELS.find((l) => l.level === 'Management')!.seesCommission).toBe(true);
  });

  /* AND THE OTHER TWO DO NOT, which is unchanged and is the half that must
     not move: a Referrer sees their own referrals and a Developer is
     explicitly given nothing. */
  it('while a Referrer and a Developer do not', () => {
    expect(SUPPLIER_LEVELS.find((l) => l.level === 'Referrer')!.seesCommission).toBe(false);
    expect(SUPPLIER_LEVELS.find((l) => l.level === 'Developer')!.seesCommission).toBe(false);
  });

  /* THE AGENCY LADDER IS UNTOUCHED, and this is why the two cannot share a
     rule: there, false is a real level called Manager. */
  it('and the agency ladder still has a level that does not, by design', () => {
    expect(AGENCY_LEVELS.map((l) => l.level)).toContain('Manager');
    expect(AGENCY_LEVELS.find((l) => l.level === 'Director')!.seesCommission).toBe(true);
    expect(AGENCY_LEVELS.find((l) => l.level === 'Manager')!.seesCommission).toBe(false);
  });
});

describe('the invite', () => {
  const FN = read('supabase/functions/invite-user/index.ts');

  /* THE AGENCY LADDER RAN ON SUPPLIER INVITES TOO, and did two wrong things:
     it translated "Management" into an agency level through `seesCommission`,
     and `level_rank_of` is null for a supplier's own people, so a supplier's
     Management inviting a colleague would have been refused with a sentence
     about a ladder they are not on. */
  it('asks the agency level ladder on our own estate only', () => {
    expect(FN).toContain('if (onOurEstate && (role === "management" || role === "referrer")) {');
  });

  it('and still asks it there', () => {
    expect(FN).toContain('assert_may_grant_level');
    expect(FN).toContain('seesCommission ? "Director" : "Manager"');
  });
});

describe('View as', () => {
  const SESSION = read('src/session/SessionContext.tsx');
  const PARTNERS = [
    { id: 'kestrel-lettings', name: 'Kestrel Lettings', kind: 'supplier' },
    { id: 'opndoor-agents', name: 'Agency referral', kind: 'agency', isHouse: true },
    { id: 'opndoor-direct', name: 'Direct', kind: 'house' },
  ].map((p) => ({ ...p, status: 'active', since: '2026-01', weight: 1, users: 0, apps: 0 })) as unknown as Partner[];

  it('reads the viewed party’s rail, not the reader', () => {
    expect(SESSION).toContain('hydrateCommissionVisibility(topLevelSeesCommission(viewingAs));');
  });

  /* BOTH RAILS' TOP LEVEL SEES COMMISSION since the same day, so this answers
     true for every party we carry -- which is the point: true by construction
     rather than by the admin's own level happening to be generous. */
  it('and both rails answer true, which is why the fix shows nothing new', () => {
    hydratePartners(PARTNERS);
    expect(topLevelSeesCommission('kestrel-lettings')).toBe(true);
    expect(topLevelSeesCommission('opndoor-agents')).toBe(true);
    hydratePartners([]);
  });

  /* THE DIRECT RAIL IS NOBODY'S PARTY: Opndoor's own business, with no
     customer management to stand in for. */
  it('while the direct rail has no customer to be truthful to', () => {
    hydratePartners(PARTNERS);
    expect(topLevelSeesCommission('opndoor-direct')).toBe(false);
    hydratePartners([]);
  });

  it('and the whole book is the admin’s own view, unchanged', () => {
    expect(topLevelSeesCommission(ALL_PARTNERS)).toBe(true);
  });

  /* RESTORED BY THE EFFECT'S CLEANUP, not by an else arm. `SEES_COMMISSION` is
     module state, so an else arm leaves it swapped when the provider unmounts
     while viewing -- and the next reader in the same runtime inherits a
     stranger's answer. Two render tests in this repo caught exactly that, and
     the same leak is reachable by signing out from inside View as. */
  it('and puts the reader’s own answer back when it unmounts', () => {
    expect(SESSION).toContain('return () => { hydrateCommissionVisibility(own); };');
  });

  /* AND IT IS RESTORED, NOT RECOMPUTED: in mock and demo mode there is no row
     to recompute from, and that default is deliberate. */
  it('restored rather than recomputed from the profile', () => {
    expect(SESSION).toContain('const own = commissionVisibility();');
    expect(SESSION).not.toContain("hydrateCommissionVisibility(profile?.seesCommission === true || role === 'superadmin')");
  });
});
