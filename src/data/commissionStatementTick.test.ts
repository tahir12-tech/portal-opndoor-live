/* WHO MAY CHANGE WHO RECEIVES THE MONTHLY COMMISSION STATEMENT.

   The rule is set_receives_commission_statements (20261005140000) and the SQL
   is the one that counts; supabase/tests/commission_statement_recipients.test.sql
   pins it there. This pins the SCREEN's copy of the same question, because the
   screen has to decide whether to draw the control at all and a copy that is
   wrong shows somebody a switch that fails with a refusal.

   The case worth the file on its own is the fifth one: an agency manager may
   not switch off the group director above them. SQL gets that from CONTAINMENT
   rather than overlap, and overlap is what every other "can I see this
   colleague" predicate in the portal answers, so reusing one of those here
   would look right and hand an agency manager the group's money post.

   The other half is what mayGrantPositions would have got wrong: it returns
   true for a partner-wide manager holding no position, and SQL requires
   app_has_scope(). */
import { describe, expect, it } from 'vitest';
import {
  mayChangeCommissionTick, mayGrantPositions, topLevelHeld,
  type OrgEdges, type Position, type ScopeKind,
} from './positionsService';

/* One group, two agencies, three branches.

     Statement Group
       Regent's Lettings   -> Head office, Riverside
       Northside Homes     -> Northside office                                */
const GROUP = 'g1';
const REGENTS = 'a1';
const NORTHSIDE = 'a2';
const HEAD = 'b1';
const RIVERSIDE = 'b2';
const NORTH_OFFICE = 'b3';

const TREE: OrgEdges = {
  agencyOfBranch: new Map([[HEAD, REGENTS], [RIVERSIDE, REGENTS], [NORTH_OFFICE, NORTHSIDE]]),
  groupOfAgency: new Map([[REGENTS, GROUP], [NORTHSIDE, GROUP]]),
};

const at = (kind: ScopeKind, targetId: string): Position[] =>
  [{ id: `p-${kind}-${targetId}`, kind, targetId, targetName: targetId }];

const DIRECTOR = at('group', GROUP);
const REGENTS_MANAGER = at('agency', REGENTS);
const NORTHSIDE_MANAGER = at('agency', NORTHSIDE);
const HEAD_MANAGER = at('branch', HEAD);
const NOBODY: Position[] = [];

const may = (
  role: string,
  own: Position[],
  target: Position[],
  targetHomeBranchId: string | null = null,
) => mayChangeCommissionTick({ role, own, target, targetHomeBranchId, tree: TREE });

describe('an opndoor admin', () => {
  it('may change anyone, which is what "for anyone" means', () => {
    expect(may('superadmin', NOBODY, DIRECTOR)).toBe(true);
    expect(may('superadmin', NOBODY, HEAD_MANAGER)).toBe(true);
  });
});

describe('who is not asked at all', () => {
  it('refuses a referrer, however they are placed', () => {
    expect(may('referrer', HEAD_MANAGER, HEAD_MANAGER)).toBe(false);
  });

  /* THE ONE mayGrantPositions GETS WRONG. Partner-wide management may hand out
     positions; it may not move the money post, because SQL asks for
     app_has_scope() and this person has none. */
  it('refuses a manager holding no position, where mayGrantPositions allows one', () => {
    expect(mayGrantPositions('management', NOBODY)).toBe(true);
    expect(may('management', NOBODY, REGENTS_MANAGER)).toBe(false);
  });
});

describe('down the ladder', () => {
  it('lets a group director change an agency manager under them', () => {
    expect(may('management', DIRECTOR, REGENTS_MANAGER)).toBe(true);
  });

  it('and a branch manager under either of their agencies', () => {
    expect(may('management', DIRECTOR, HEAD_MANAGER)).toBe(true);
    expect(may('management', DIRECTOR, at('branch', NORTH_OFFICE))).toBe(true);
  });

  it('lets an agency manager change a branch manager in their own agency', () => {
    expect(may('management', REGENTS_MANAGER, at('branch', RIVERSIDE))).toBe(true);
  });

  it('and a negotiator, who holds no position and is placed by their home branch', () => {
    expect(may('management', REGENTS_MANAGER, NOBODY, HEAD)).toBe(true);
    expect(may('management', HEAD_MANAGER, NOBODY, HEAD)).toBe(true);
  });

  it('lets a director change another director of the same group', () => {
    expect(may('management', DIRECTOR, DIRECTOR)).toBe(true);
  });
});

describe('up the ladder, and sideways', () => {
  /* THE LEAK THIS PREVENTS. Overlap would say yes here: the director is in the
     manager's chain and is rightly visible to them on Team. Containment says
     no, because the group reaches Northside's branches too. */
  it('does NOT let an agency manager switch off the group director above them', () => {
    expect(may('management', REGENTS_MANAGER, DIRECTOR)).toBe(false);
  });

  it('does not let a branch manager reach the agency manager above them', () => {
    expect(may('management', HEAD_MANAGER, REGENTS_MANAGER)).toBe(false);
  });

  it('does not let one agency reach into another', () => {
    expect(may('management', REGENTS_MANAGER, NORTHSIDE_MANAGER)).toBe(false);
    expect(may('management', REGENTS_MANAGER, at('branch', NORTH_OFFICE))).toBe(false);
  });

  it('does not let one branch reach a sibling branch', () => {
    expect(may('management', HEAD_MANAGER, at('branch', RIVERSIDE))).toBe(false);
  });

  /* A person spanning two agencies is contained by neither of them, only by
     the group. Every claim has to be dominated, not just the nearest one. */
  it('refuses a target who spans more than the caller holds', () => {
    const across = [...at('agency', REGENTS), ...at('agency', NORTHSIDE)];
    expect(may('management', REGENTS_MANAGER, across)).toBe(false);
    expect(may('management', DIRECTOR, across)).toBe(true);
  });
});

describe('a person attached to nothing', () => {
  /* commission_statement_party returns null for them and the RPC refuses with
     "not attached to a group, agency or branch", so there is no control to
     draw. An empty target set must never read as "contained in everything". */
  it('is refused rather than reachable by everybody', () => {
    expect(may('management', DIRECTOR, NOBODY, null)).toBe(false);
    expect(may('superadmin', NOBODY, NOBODY, null)).toBe(true); // admin is asked no further
  });
});

describe('the party top position', () => {
  it('is the group where there is a group', () => {
    expect(topLevelHeld([...HEAD_MANAGER, ...REGENTS_MANAGER, ...DIRECTOR])).toBe('group');
  });

  it('is the agency where there is no group', () => {
    expect(topLevelHeld([...HEAD_MANAGER, ...REGENTS_MANAGER])).toBe('agency');
  });

  it('is the branch where that is all anybody holds', () => {
    expect(topLevelHeld([...HEAD_MANAGER])).toBe('branch');
  });

  it('is nothing at all when nobody holds a position', () => {
    expect(topLevelHeld([])).toBe(null);
  });
});
