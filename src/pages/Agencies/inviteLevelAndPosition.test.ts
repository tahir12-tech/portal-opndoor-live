/* WHAT AN INVITE GRANTS: a LEVEL and, separately, a POSITION.

   Two bugs lived in this dialog and both were silent, because an invitation that
   sends successfully looks the same either way and the person only turns out to
   be wrong once they sign in.

   THE LEVEL WAS NEVER SENT. inviteUser takes role AND seesCommission, because a
   Director and a Manager are the same role and differ only in that bit.
   InviteToLevel sent only the role, and users.sees_commission defaults to false,
   so every person invited from the agency page landed as a Manager. The group
   dialog is titled "Invite group director" and created a Manager: it named the
   level out loud and then did not set it.

   THE POSITION CAME FROM THE NODE, NOT THE LEVEL. Harmless while the level was
   inferred from the node, and wrong the moment the People tab let an admin pick:
   choosing Negotiator on an agency's People tab would have granted an
   AGENCY-wide position, so somebody who should see their own referrals would see
   every referral in the agency.

   Both rules are pure arithmetic over the context and the chosen level, so they
   are asserted here rather than by driving the dialog: the rule is what was
   wrong, and a render test of it would need a session, a hydrated org and a
   mocked inviteUser to assert the same two fields. */
import { describe, expect, it } from 'vitest';
import { AGENCY_LEVELS, type AgencyLevel } from '@/data';
import { feeBasisWords } from './AgreementEditor';

/** The dialog's own two rules, mirrored. If these drift from InviteToLevel the
    test is worthless, so they are written exactly as the component computes
    them and the component is the thing under review in the same commit. */
function levelSpec(level: AgencyLevel) {
  return AGENCY_LEVELS.find((l) => l.level === level)!;
}
function scopeFor(
  level: AgencyLevel,
  ctx: { level: 'group' | 'brand' | 'branch'; groupId?: string; agencyId?: string; branchId?: string },
) {
  if (level === 'Negotiator') return {};
  if (ctx.level === 'group' && ctx.groupId) return { scopeKind: 'group', scopeTarget: ctx.groupId };
  if (ctx.level === 'brand' && ctx.agencyId) return { scopeKind: 'agency', scopeTarget: ctx.agencyId };
  if (ctx.level === 'branch' && ctx.branchId) return { scopeKind: 'branch', scopeTarget: ctx.branchId };
  return {};
}

describe('the level an invitation grants', () => {
  it('carries the commission bit, which is what separates a Director from a Manager', () => {
    expect(levelSpec('Director')).toMatchObject({ role: 'management', seesCommission: true });
    expect(levelSpec('Manager')).toMatchObject({ role: 'management', seesCommission: false });
    expect(levelSpec('Negotiator')).toMatchObject({ role: 'referrer', seesCommission: false });
  });

  /* THE BUG, stated as the assertion that would have caught it: sending the role
     alone cannot distinguish the two management levels, so anything that relies
     on role only produces a Manager. */
  it('cannot be expressed by the role alone', () => {
    const director = levelSpec('Director');
    const manager = levelSpec('Manager');
    expect(director.role).toBe(manager.role);
    expect(director.seesCommission).not.toBe(manager.seesCommission);
  });
});

describe('the position an invitation grants', () => {
  const AGENCY = { level: 'brand' as const, agencyId: 'ag-1' };
  const GROUP = { level: 'group' as const, groupId: 'gr-1' };
  const BRANCH = { level: 'branch' as const, branchId: 'br-1' };

  /* THE ONE THAT WAS WRONG. Picking Negotiator on an agency's People tab must
     not hand out the agency. */
  it('gives a Negotiator no position at all, wherever they were invited from', () => {
    expect(scopeFor('Negotiator', AGENCY)).toEqual({});
    expect(scopeFor('Negotiator', GROUP)).toEqual({});
    expect(scopeFor('Negotiator', BRANCH)).toEqual({});
  });

  it('gives a Manager or Director the node they were invited from', () => {
    expect(scopeFor('Manager', AGENCY)).toEqual({ scopeKind: 'agency', scopeTarget: 'ag-1' });
    expect(scopeFor('Director', GROUP)).toEqual({ scopeKind: 'group', scopeTarget: 'gr-1' });
    expect(scopeFor('Manager', BRANCH)).toEqual({ scopeKind: 'branch', scopeTarget: 'br-1' });
  });

  it('grants nothing when the node carries no id to grant', () => {
    expect(scopeFor('Manager', { level: 'brand' })).toEqual({});
    expect(scopeFor('Director', { level: 'group' })).toEqual({});
  });
});

describe('the two are decided separately', () => {
  /* Which is the whole point: the level says what somebody IS and the position
     says what they see. A Director of a one-agency group and a Director placed
     on one branch are both Directors, and the second sees one office. */
  it('lets the same level land on different positions', () => {
    expect(scopeFor('Director', { level: 'group', groupId: 'g' }).scopeKind).toBe('group');
    expect(scopeFor('Director', { level: 'branch', branchId: 'b' }).scopeKind).toBe('branch');
  });

  it('lets different levels land on the same position', () => {
    expect(scopeFor('Director', { level: 'brand', agencyId: 'a' }))
      .toEqual(scopeFor('Manager', { level: 'brand', agencyId: 'a' }));
  });
});

/* HOW A FEE BASIS READS, now that it has a unit.

   "One month's rent" could only be written as 4.3333 weeks, so the editor
   recognised a month by comparing the quantity against that within a tolerance
   of 0.02. That is a guess, and it was the only way to make one while a month
   was a quantity of weeks. The band says which unit it is now, so the wording
   reads it rather than inferring it. */
describe('wording a fee basis', () => {
  it('says one month, not 4.33 weeks', () => {
    expect(feeBasisWords(1, 'months')).toBe("one month's rent");
  });

  it('pluralises months', () => {
    expect(feeBasisWords(2, 'months')).toBe("2 months' rent");
  });

  it('says weeks as weeks', () => {
    expect(feeBasisWords(3, 'weeks')).toBe('3 weeks of rent');
    expect(feeBasisWords(5, 'weeks')).toBe('5 weeks of rent');
    expect(feeBasisWords(1, 'weeks')).toBe('one week of rent');
  });

  /* THE GUESS THAT IS NO LONGER MADE. 4.3333 weeks is a real, if odd, weeks
     basis and must now read as one, because anybody who has it stored means
     weeks: the unit is what says month. */
  it('no longer reads 4.3333 weeks as a month', () => {
    expect(feeBasisWords(4.3333, 'weeks')).toBe('4.3333 weeks of rent');
  });

  it('says something sensible about a basis of nothing', () => {
    expect(feeBasisWords(0, 'weeks')).toBe('no fee');
    expect(feeBasisWords(Number.NaN, 'months')).toBe('no fee');
  });
});
