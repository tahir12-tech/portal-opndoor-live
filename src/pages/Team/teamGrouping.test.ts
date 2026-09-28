/* THE TEAM PAGE GROUPS BY STRUCTURE ONLY WHERE THERE IS STRUCTURE.

   The rule under test is one sentence: a level earns a heading from the second
   node in it. One agency with one office is a flat list of people; two offices
   is a card each with the agency-level people above them; several agencies is
   agency then branch.

   Tested against teamLayout rather than the rendered page because the ruling is
   a decision, not a layout: the decision is what regressed, and a DOM test of it
   would need a session, a hydrated org tree and a positions fetch to assert the
   same three booleans.

   THE TWO READINGS OF "MORE THAN ONE" are the interesting half, and they are
   asserted in both directions: an office that has people and no referrals yet is
   still an office (the book says one, the tree says two, the grouping stays),
   and a book that has seen two branch names under a tree holding one is not
   grounds for drawing a structure that is not there. */
import { describe, expect, it } from 'vitest';
import { teamLayout } from './Team';
import type { Position } from '@/data/positionsService';
import type { Agency, ManagedUser } from '@/data';

const ONE = { oneAgency: true, oneBranch: true };
const MANY_BRANCHES = { oneAgency: true, oneBranch: false };

function person(id: string, name: string): ManagedUser {
  return { id, name, email: `${id}@regents.co.uk`, role: 'referrer', lastActive: 'today', status: 'active', partner: 'northwind' };
}

function agency(id: string, name: string, branches: [string, string][]): Agency {
  return {
    id, partner: 'northwind', name, referrals: 0, guaranteed: '£0',
    branches: branches.map(([bid, bname]) => ({ id: bid, name: bname, area: '', referrals: 0, guaranteed: '£0' })),
  };
}

const at = (kind: Position['kind'], targetId: string, targetName: string): Position[] =>
  [{ id: `p-${targetId}`, kind, targetId, targetName }];

describe('one agency, one office', () => {
  const REGENTS = [agency('a1', "Regent's Lettings", [['b1', 'Head office']])];
  const MANAGER = person('u1', 'Priya Nair');
  const NEG = person('u2', 'Tom Searle');
  const NEW_STARTER = person('u3', 'Alice Frank');

  const layout = () => teamLayout({
    agencies: REGENTS,
    people: [MANAGER, NEG, NEW_STARTER],
    positionsByUser: {
      u1: at('agency', 'a1', "Regent's Lettings"),
      u2: at('branch', 'b1', 'Head office'),
      u3: [],
    },
    ownPositions: [],
    shape: ONE,
  });

  it('is one list of people, not three cards', () => {
    const l = layout();
    expect(l.grouped).toBe(false);
    expect(l.flat.map((u) => u.name)).toEqual(['Priya Nair', 'Tom Searle', 'Alice Frank']);
  });

  it('drops nobody on the way: the unplaced new starter is in the list', () => {
    // The old page filed her under "Not placed yet", a card of her own next to
    // an "Across the agency" card of one and a branch card of one.
    expect(layout().flat.some((u) => u.name === 'Alice Frank')).toBe(true);
  });

  it('holds the grouped buckets too, so nothing is lost if the shape changes', () => {
    const l = layout();
    expect(l.agencies).toHaveLength(1);
    expect(l.agencies[0].branches[0].people.map((u) => u.id)).toEqual(['u2']);
  });
});

describe('one agency, two offices', () => {
  const FOXGLOVE = [agency('a1', 'Foxglove Residential', [['b1', 'Chelsea'], ['b2', 'Fulham']])];
  const people = [person('u1', 'Priya Nair'), person('u2', 'Tom Searle'), person('u3', 'Dana Okoye')];

  const layout = (shape: { oneAgency: boolean; oneBranch: boolean }) => teamLayout({
    agencies: FOXGLOVE,
    people,
    positionsByUser: {
      u1: at('agency', 'a1', 'Foxglove Residential'),
      u2: at('branch', 'b1', 'Chelsea'),
      u3: at('branch', 'b2', 'Fulham'),
    },
    ownPositions: [],
    shape,
  });

  it('groups by branch, with the agency-level person above them', () => {
    const l = layout(MANY_BRANCHES);
    expect(l.grouped).toBe(true);
    expect(l.agencies[0].wide.map((u) => u.id)).toEqual(['u1']);
    expect(l.agencies[0].branches.map((b) => b.name)).toEqual(['Chelsea', 'Fulham']);
    expect(l.agencies[0].branches[1].people.map((u) => u.id)).toEqual(['u3']);
  });

  it('keeps the grouping when the second office has people but no referrals yet', () => {
    /* The book cannot see an office that has never referred, so viewerShape
       answers "one branch" for a Fulham that opened last week. Collapsing on
       that would put two offices' people in one undifferentiated list on the
       one screen whose subject is which office somebody is at. */
    expect(layout(ONE).grouped).toBe(true);
  });

  it('never files anybody twice', () => {
    const l = layout(MANY_BRANCHES);
    const placed = [...l.groupWide, ...l.unplaced, ...l.agencies.flatMap((a) => [...a.wide, ...a.branches.flatMap((b) => b.people)])];
    expect(placed).toHaveLength(3);
    expect(new Set(placed.map((u) => u.id)).size).toBe(3);
  });
});

describe('a group of agencies', () => {
  const GROUP = [
    agency('a1', 'Foxglove Residential', [['b1', 'Chelsea']]),
    agency('a2', 'Marylebone & Co', [['b2', 'Fitzrovia']]),
  ];

  const l = teamLayout({
    agencies: GROUP,
    people: [person('u1', 'Group Director'), person('u2', 'Foxglove Head'), person('u3', 'Fitzrovia Neg')],
    positionsByUser: {
      u1: at('group', 'g1', 'ABC group'),
      u2: at('agency', 'a1', 'Foxglove Residential'),
      u3: at('branch', 'b2', 'Fitzrovia'),
    },
    ownPositions: [],
    shape: { oneAgency: false, oneBranch: false },
  });

  it('is agency then branch, with the group-wide people above both', () => {
    expect(l.grouped).toBe(true);
    expect(l.groupWide.map((u) => u.id)).toEqual(['u1']);
    expect(l.agencies.map((a) => a.name)).toEqual(['Foxglove Residential', 'Marylebone & Co']);
    expect(l.agencies[0].wide.map((u) => u.id)).toEqual(['u2']);
    expect(l.agencies[1].branches[0].people.map((u) => u.id)).toEqual(['u3']);
  });

  it('files a group position above every agency, however few the group holds', () => {
    // Even where the group reaches one agency today, a group remit is not an
    // agency remit; it is merged into the agency's card rather than drawn as a
    // second card with the same heading.
    const one = teamLayout({
      agencies: [GROUP[0]],
      people: [person('u1', 'Group Director'), person('u2', 'Chelsea Neg')],
      positionsByUser: { u1: at('group', 'g1', 'ABC group'), u2: at('branch', 'b1', 'Chelsea') },
      ownPositions: [],
      shape: ONE,
    });
    expect(one.groupWide).toEqual([]);
    expect(one.grouped).toBe(false);
    expect(one.flat.map((u) => u.id)).toEqual(['u1', 'u2']);
  });
});

describe('a negotiator placed at one office', () => {
  /* branches_select would show them every office their agency has. This page
     is their team, not their agency's, so the tree is narrowed to the branches
     they actually hold and anybody sitting above them is not listed. */
  const FOXGLOVE = [agency('a1', 'Foxglove Residential', [['b1', 'Chelsea'], ['b2', 'Fulham']])];

  const l = teamLayout({
    agencies: FOXGLOVE,
    people: [person('u1', 'Agency Manager'), person('u2', 'Chelsea Neg'), person('u3', 'Fulham Neg'), person('u4', 'Unplaced')],
    positionsByUser: {
      u1: at('agency', 'a1', 'Foxglove Residential'),
      u2: at('branch', 'b1', 'Chelsea'),
      u3: at('branch', 'b2', 'Fulham'),
      u4: [],
    },
    ownPositions: at('branch', 'b1', 'Chelsea'),
    shape: ONE,
  });

  it('sees their own office only, as one flat list', () => {
    expect(l.grouped).toBe(false);
    expect(l.flat.map((u) => u.id)).toEqual(['u2']);
  });

  it('is not shown the people above them or the ones nobody has placed', () => {
    expect(l.groupWide).toEqual([]);
    expect(l.unplaced).toEqual([]);
  });
});

describe('a tree with nothing in it', () => {
  it('lists the people rather than drawing empty structure', () => {
    // A brand-new agency whose branches have not been set up yet. Every person
    // is unplaced because there is nowhere to place them.
    const l = teamLayout({
      agencies: [agency('a1', "Regent's Lettings", [])],
      people: [person('u1', 'Priya Nair')],
      positionsByUser: { u1: [] },
      ownPositions: [],
      shape: ONE,
    });
    expect(l.grouped).toBe(false);
    expect(l.flat.map((u) => u.id)).toEqual(['u1']);
    // And when it does group, an agency with no offices and nobody above them
    // is not a heading with nothing under it.
    const grouped = teamLayout({
      agencies: [agency('a1', 'Has offices', [['b1', 'One'], ['b2', 'Two']]), agency('a2', 'Empty shell', [])],
      people: [],
      positionsByUser: {},
      ownPositions: [],
      shape: { oneAgency: false, oneBranch: false },
    });
    expect(grouped.agencies.map((a) => a.name)).toEqual(['Has offices']);
  });
});

/* AT SCALE: THE FILTER, which is the other half of making this page usable for a
   group of several hundred.

   matchesPerson is asserted here rather than through the rendered page for the
   same reason teamLayout is: the rule is a decision about a person, and a DOM
   test of it would need a session, a hydrated tree and a positions fetch to
   assert the same booleans. */
import { matchesPerson, teamFilterActive, NO_TEAM_FILTER, TEAM_PAGE_SIZE } from './Team';

function staff(over: Partial<ManagedUser>): ManagedUser {
  return {
    id: 'u1', name: 'Rosa Vance', email: 'rosa@regents.co.uk', role: 'management',
    lastActive: 'today', status: 'active', partner: 'northwind', seesCommission: true, ...over,
  } as ManagedUser;
}

describe('searching the team', () => {
  it('matches everybody when nothing is set', () => {
    expect(matchesPerson(staff({}), NO_TEAM_FILTER)).toBe(true);
    expect(teamFilterActive(NO_TEAM_FILTER)).toBe(false);
  });

  it('finds a person by part of their name, whatever the case', () => {
    expect(matchesPerson(staff({}), { ...NO_TEAM_FILTER, q: 'vance' })).toBe(true);
    expect(matchesPerson(staff({}), { ...NO_TEAM_FILTER, q: 'ROSA' })).toBe(true);
    expect(matchesPerson(staff({}), { ...NO_TEAM_FILTER, q: 'nadia' })).toBe(false);
  });

  /* Email as well as name, because the person asking about a colleague often has
     the address and not the spelling of the name. */
  it('finds a person by part of their email', () => {
    expect(matchesPerson(staff({}), { ...NO_TEAM_FILTER, q: 'regents.co.uk' })).toBe(true);
    expect(matchesPerson(staff({}), { ...NO_TEAM_FILTER, q: 'rosa@' })).toBe(true);
  });

  it('ignores surrounding spaces, so a pasted name still matches', () => {
    expect(matchesPerson(staff({}), { ...NO_TEAM_FILTER, q: '  Vance  ' })).toBe(true);
    // And a search of only spaces is not a search at all.
    expect(teamFilterActive({ ...NO_TEAM_FILTER, q: '   ' })).toBe(false);
  });
});

describe('filtering the team by level and status', () => {
  /* THE LEVEL IS THE PAIR, not the role. Director and Manager are both
     'management' and differ only in the commission bit, so filtering on role
     would put them in one bucket and make the control useless. */
  it('tells a Director from a Manager, though both are management', () => {
    const director = staff({ seesCommission: true });
    const manager = staff({ seesCommission: false });
    expect(matchesPerson(director, { ...NO_TEAM_FILTER, level: 'Director' })).toBe(true);
    expect(matchesPerson(director, { ...NO_TEAM_FILTER, level: 'Manager' })).toBe(false);
    expect(matchesPerson(manager, { ...NO_TEAM_FILTER, level: 'Manager' })).toBe(true);
    expect(matchesPerson(manager, { ...NO_TEAM_FILTER, level: 'Director' })).toBe(false);
  });

  it('calls a referrer a Negotiator, as every other surface does', () => {
    const neg = staff({ role: 'referrer', seesCommission: false });
    expect(matchesPerson(neg, { ...NO_TEAM_FILTER, level: 'Negotiator' })).toBe(true);
  });

  it('filters the three statuses, invited included', () => {
    expect(matchesPerson(staff({ status: 'pending' }), { ...NO_TEAM_FILTER, status: 'pending' })).toBe(true);
    expect(matchesPerson(staff({ status: 'active' }), { ...NO_TEAM_FILTER, status: 'pending' })).toBe(false);
    expect(matchesPerson(staff({ status: 'deactivated' }), { ...NO_TEAM_FILTER, status: 'deactivated' })).toBe(true);
  });

  it('ands the filters together rather than oring them', () => {
    const p = staff({ seesCommission: false, status: 'pending' });
    expect(matchesPerson(p, { q: 'rosa', level: 'Manager', status: 'pending' })).toBe(true);
    // One mismatch is enough to exclude, which is what makes narrowing work.
    expect(matchesPerson(p, { q: 'rosa', level: 'Director', status: 'pending' })).toBe(false);
    expect(matchesPerson(p, { q: 'nadia', level: 'Manager', status: 'pending' })).toBe(false);
  });

  it('knows when anything is set, which is what forces the groups open', () => {
    expect(teamFilterActive({ ...NO_TEAM_FILTER, level: 'Director' })).toBe(true);
    expect(teamFilterActive({ ...NO_TEAM_FILTER, status: 'active' })).toBe(true);
    expect(teamFilterActive({ ...NO_TEAM_FILTER, q: 'x' })).toBe(true);
  });
});

describe('the page size', () => {
  /* Fifty: long enough that an ordinary office never pages, short enough that a
     group-wide list does not render eight hundred rows for one screenful. Pinned
     because both halves of that sentence stop being true if somebody tunes it. */
  it('is fifty', () => {
    expect(TEAM_PAGE_SIZE).toBe(50);
  });
});
