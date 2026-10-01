/* =====================================================================
   TEAM — one page for an agency of ours, replacing Agencies and Users both.

   WHY IT REPLACES TWO PAGES. An agency manager was being shown two screens
   written for somebody else. /agencies is an admin's view of an ESTATE: a book
   of agencies you are looking at from outside, with rate cards, referencing
   settings and other people's branches. /users is a flat list of names with a
   "Partner" column and no structure at all, so a manager could see who their
   people were or where they sat, never both. Neither answers the only question
   an agency manager actually has: who is at which office, and can they get in.

   So: their people, grouped by the structure they actually have. Branches for
   an agency manager; agencies and branches for a group director. Nothing else.

   STRUCTURE IS READ-ONLY HERE, and that is a ruling, not an omission. Opndoor
   sets up and changes branches and agencies from the admin Agencies section,
   because the structure decides commission, deed delivery and scope, and a
   customer adding a branch at 5pm on a Friday moves all three. This supersedes
   the earlier skeleton-group design in which a group director added their own
   branches on first login.

   GROUPING ONLY WHERE THERE IS STRUCTURE. The first cut grouped unconditionally,
   on the belief that the grouping IS the information. It is, for a group
   director. For a single-office agency it drew an "Across the agency" card, one
   branch card and an empty "Not placed yet" card over three people who all work
   in the same room: three headings, no information, and an empty state that
   reads like something is broken. A level earns its heading from the second
   node in it. See teamLayout below.

   NO COMMISSION FIGURE LIVES ON THIS PAGE, and that is the audited answer for
   the Director / Manager split rather than an accident. There is no money on it
   at all: a person, their email, their level, whether they can get in, and where
   they sit. A Manager is role 'management' without sees_commission and reads
   every word of it, which is the point of the level, so nothing here takes the
   `commission` flag on RoleOnly.

   THE TWO THINGS THAT LOOK LIKE COMMISSION AND ARE NOT. The level pill says
   "Director" or "Manager", which names who is entitled to see the money and
   states no figure, so it stays for everyone: a Manager already knows their own
   level and hiding a colleague's would make the page lie about the shape of the
   agency. And "Make Negotiator" / "Make Manager" moves somebody between the two
   roles; it cannot grant the commission bit, so it is not a way to promote
   yourself to Director. The commission-statement tick is genuinely absent, by
   the earlier admin-only ruling: see the note further down where it used to be.

   THE SCREEN IS NOT THE BOUNDARY. Every list here is already RLS-scoped —
   agencies_select, branches_select and users_select each narrow to the caller's
   positions — and every write runs through the same guard-checked RPC the admin
   screens use. Hiding is a courtesy; SQL is the rule. See team-scope.test.sql.
   ===================================================================== */
// Walk fix 19: the possessive is formed in one place.
import { possessive } from '@/lib/format';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  cancelInvite, getAgencies, getGroups, inviteUser, resendInvite, setUserStatus,
  resetUserMfa, resetUserPassword, setAgencyLevel, getUsers, userEmail,
  agencyLevelOf, AGENCY_LEVELS, levelsGrantableBy, mayActOn, mayActOnOrEqual, type Actor, type AgencyLevel,
  type Agency, type ManagedUser,
} from '@/data';
import * as positionsService from '@/data/positionsService';
import { PersonNotifications } from '@/components/people/PersonNotifications';
import { viewerShape, type ViewerShape } from '@/data/viewerShape';
import { PositionModal, type ScopeTarget } from '@/pages/UserManagement/PositionModal';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import '@/pages/UserManagement/UserManagement.css';
import './Team.css';
import { plural, countOf } from '@/lib/plural';
import { personInitials, personLabel } from '@/data/personLabel';

/* THE TWO ROLES AN AGENCY HAS. Described in the words of the business the
   reader is in, not the portal's internals: no "partner", no "estate", no
   "full visibility of all tracking and analytics". Matches the role pills. */
/* THREE LEVELS, from the one list in types.ts, so the invite dialog, the admin
   people table and this page cannot describe the same level differently. The
   copy is the client's own wording. */
const ROLE_PILL: Record<string, string> = {
  Director: 'role-tag--mgmt',
  Manager: 'role-tag--mgmt',
  Negotiator: 'role-tag--ref',
  Developer: 'role-tag--dev',
};

/** What to call this person. Opndoor's own roles keep their own names; an
    agency person is one of the three levels. */
function levelLabel(u: ManagedUser): string {
  return agencyLevelOf(u.role, u.seesCommission === true) ?? 'Developer';
}

const STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  pending: ['Invited', 'warn'],
  deactivated: ['Deactivated', 'muted'],
};


/** One node of the structure, and the people who sit at it. */
interface Node {
  key: string;
  kind: positionsService.ScopeKind;
  name: string;
  /** The agency this node belongs to, for the group-director view's grouping. */
  agencyName: string;
  people: ManagedUser[];
}

/** One agency, the people whose remit is the whole of it, and its offices. */
export interface AgencyBlock {
  key: string;
  name: string;
  /** Covers this agency, not one of its offices. */
  wide: ManagedUser[];
  branches: Node[];
}

export interface TeamLayout {
  /** Is there structure worth drawing? False means one list, no headings. */
  grouped: boolean;
  /** Everybody, in one list, for when there is not. */
  flat: ManagedUser[];
  /** Above the agency level. Only ever filled in group scope. */
  groupWide: ManagedUser[];
  agencies: AgencyBlock[];
  unplaced: ManagedUser[];
}

/** The agency a set of positions covers, or null when it covers more than one
    (or something outside the tree we drew, which means the same thing here). */
function owningAgency(
  held: positionsService.Position[],
  byAgency: Map<string, AgencyBlock>,
  byBranch: Map<string, AgencyBlock>,
): AgencyBlock | null {
  const found = new Set<AgencyBlock>();
  for (const p of held) {
    // A group remit sits above every agency by definition, so it never files
    // under one however few agencies the group happens to hold today.
    if (p.kind === 'group') return null;
    const block = p.kind === 'agency' ? byAgency.get(p.targetId) : byBranch.get(p.targetId);
    if (!block) return null;
    found.add(block);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * PEOPLE UNDER THE STRUCTURE THEY SIT IN, AND ONLY WHERE THERE IS STRUCTURE.
 *
 * A branch position files somebody at that branch. An agency or group position
 * files them above it, because that is what it means. Nobody is listed twice,
 * and nobody is dropped: a person with no position at all is a negotiator,
 * which is a real answer, and they go in their own block.
 *
 * Then the collapse. One agency with one office is not a structure, it is a
 * shop, and drawing it as one produced the pathology this exists to end: an
 * "Across the agency" card, one branch card and an empty "Not placed yet" card
 * for what is really one list of three people. Grouping earns its room from the
 * second node at a level and not before.
 *
 * WHICH READING OF "MORE THAN ONE". viewerShape counts the viewer's BOOK, which
 * is the shared predicate across Reporting, League, Applications and here, and
 * is the right one for a screen deciding how much of itself to draw. But this
 * screen's subject is the org tree rather than the book, and the two can
 * honestly disagree: a second office opened last week has people in it and no
 * referrals yet, so the book says one branch while the tree says two. So a
 * dimension survives if EITHER reading has more than one of it. Erring towards
 * the grouping costs a card; erring the other way puts two offices' people in
 * one undifferentiated list, which is the thing the page exists to show.
 *
 * Exported and pure so the ruling can be tested without a DOM: see Team.test.ts.
 */
export function teamLayout(input: {
  agencies: Agency[];
  people: ManagedUser[];
  positionsByUser: Record<string, positionsService.Position[]>;
  ownPositions: positionsService.Position[];
  shape: Pick<ViewerShape, 'oneAgency' | 'oneBranch'>;
}): TeamLayout {
  const { agencies, people, positionsByUser, ownPositions, shape } = input;

  /* NARROWED TO THE VIEWER'S OWN POSITIONS when they hold branch ones.
     branches_select lets anyone who can reach an agency see all of its
     branches, which is right for a picker and wrong here: a negotiator placed
     at one office should read their own team, not their agency's. A manager
     holds an agency or group position, or none, and keeps the whole tree. */
  const ownBranches = ownPositions.filter((p) => p.kind === 'branch').map((p) => p.targetId);
  const onlyBranchScoped = ownBranches.length > 0
    && !ownPositions.some((p) => p.kind === 'agency' || p.kind === 'group');
  const visible = new Set(ownBranches);

  const blocks: AgencyBlock[] = [];
  const blockOfAgency = new Map<string, AgencyBlock>();
  const blockOfBranch = new Map<string, AgencyBlock>();
  const nodeOfBranch = new Map<string, Node>();
  for (const a of agencies) {
    const block: AgencyBlock = { key: a.id ?? a.name, name: a.name, wide: [], branches: [] };
    blocks.push(block);
    if (a.id) blockOfAgency.set(a.id, block);
    for (const b of a.branches ?? []) {
      if (!b.id) continue;
      if (onlyBranchScoped && !visible.has(b.id)) continue;
      const node: Node = { key: b.id, kind: 'branch', name: b.name, agencyName: a.name, people: [] };
      block.branches.push(node);
      nodeOfBranch.set(b.id, node);
      blockOfBranch.set(b.id, block);
    }
  }

  const groupWide: ManagedUser[] = [];
  const unplaced: ManagedUser[] = [];
  for (const u of people) {
    const held = positionsByUser[u.id] ?? [];
    const branch = held.filter((p) => p.kind === 'branch');
    if (branch.length === 1 && nodeOfBranch.has(branch[0].targetId)) {
      nodeOfBranch.get(branch[0].targetId)!.people.push(u);
      continue;
    }
    // Somebody above a single office, or with no position at all, could be
    // anywhere in the agency, so a branch-scoped viewer is not shown them.
    if (onlyBranchScoped) continue;
    if (!held.length) { unplaced.push(u); continue; }
    const owner = owningAgency(held, blockOfAgency, blockOfBranch);
    if (owner) owner.wide.push(u); else groupWide.push(u);
  }

  /* ONE AGENCY: there is no "above" it that is not simply it. Merging rather
     than keeping the bucket avoids two cards with the same heading, which is
     what a group position inside a single-agency scope used to produce. */
  if (blocks.length === 1 && groupWide.length) {
    blocks[0].wide.unshift(...groupWide);
    groupWide.length = 0;
  }

  const branchCount = blocks.reduce((n, b) => n + b.branches.length, 0);
  const manyAgencies = !shape.oneAgency || blocks.length > 1;
  const manyBranches = !shape.oneBranch || branchCount > 1;

  return {
    grouped: manyAgencies || manyBranches,
    // Agency-level people first, then each office, then anyone unplaced: the
    // same precedence the grouped view reads in, minus the headings.
    flat: [
      ...groupWide,
      ...blocks.flatMap((b) => [...b.wide, ...b.branches.flatMap((n) => n.people)]),
      ...unplaced,
    ],
    groupWide,
    // An agency with no offices in reach and nobody above them is a heading
    // with nothing under it.
    agencies: blocks.filter((b) => b.branches.length > 0 || b.wide.length > 0),
    unplaced,
  };
}

/* =====================================================================
   TEAM AT SCALE.

   The page was written for an agency of five and is now the only screen a group
   of several hundred has. Three things make it work at that size, and each one
   has a rule worth stating.

   SEARCH IS THE PRIMARY CONTROL, because at two hundred people nobody browses.
   Name or email, because those are the two things a person asking about a
   colleague actually has.

   GROUPS COLLAPSE, BUT NOT WHILE YOU ARE SEARCHING. Collapsed-by-default is right
   for browsing a structure: the headings and their counts are the information,
   and opening one is a deliberate act. It is exactly wrong while a filter is on,
   where it would answer a search with a row of closed doors. So a filter expands
   the groups that match and the collapse comes back when the filter clears.

   FIFTY TO A GROUP. Long enough that an ordinary office never pages, short enough
   that a group-wide list does not render eight hundred rows to show the first
   screenful.
   ===================================================================== */

/** How many people a group shows before it offers the rest. */
export const TEAM_PAGE_SIZE = 50;

export interface TeamFilter {
  /** Name or email, case-insensitive, trimmed. '' means no search. */
  q: string;
  /** An agency level, or '' for any. */
  level: AgencyLevel | '';
  /** 'active' | 'pending' | 'deactivated', or '' for any. */
  status: string;
}

export const NO_TEAM_FILTER: TeamFilter = { q: '', level: '', status: '' };

export function teamFilterActive(f: TeamFilter): boolean {
  return f.q.trim() !== '' || f.level !== '' || f.status !== '';
}

/** Does this person match the filter? Pure, and exported so the rule can be
    asserted without rendering: see teamGrouping.test.ts. */
export function matchesPerson(u: ManagedUser, f: TeamFilter): boolean {
  const q = f.q.trim().toLowerCase();
  if (q) {
    /* Name OR email, and the email through userEmail() rather than u.email,
       because mock and demo rows derive one and a raw u.email is blank there. */
    const hay = `${u.name} ${userEmail(u)}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.level && levelLabel(u) !== f.level) return false;
  if (f.status && u.status !== f.status) return false;
  return true;
}

export function Team() {
  usePageMeta('team', 'Team', ['Home', 'Team']);
  const { role, seesCommission, partnerScope, currentUserId, refresh: refreshData, dataVersion } = useSession();
  const toast = useToast();

  /* WHO IS ASKING. Director and Manager are the same role and differ only in the
     commission bit, so nothing here can be decided from `role` alone. This is a
     lens for deciding which buttons to draw; assert_may_act_on_user and the
     users_level_ladder_guard trigger are the rule, and both refuse independently
     of anything below. */
  const actor: Actor = useMemo(
    () => ({ id: currentUserId, role, seesCommission }),
    [currentUserId, role, seesCommission],
  );

  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [busy, setBusy] = useState(false);
  const [positionsByUser, setPositionsByUser] = useState<Record<string, positionsService.Position[]>>({});
  const [ownPositions, setOwnPositions] = useState<positionsService.Position[]>([]);
  const [posUser, setPosUser] = useState<ManagedUser | null>(null);
  /* The person whose notifications panel is open. The bulk read of "who is
     copied" that used to sit beside this went with the column: the panel
     reads one person, when it is opened. */
  const [notifUser, setNotifUser] = useState<ManagedUser | null>(null);
  /** The Change level chooser, and the one-line confirmation it asks before acting. */
  const [levelUser, setLevelUser] = useState<ManagedUser | null>(null);
  const [levelPick, setLevelPick] = useState<AgencyLevel | null>(null);
  /** A one-line confirmation for the destructive-ish row actions. */
  const [confirm, setConfirm] = useState<{ line: string; cta: string; run: () => Promise<void>; done: string } | null>(null);
  /* Who receives the monthly commission statement. Held here rather than on
     ManagedUser: it is read off users.receives_commission_statements by two
     screens, and hydrate's user list is shared by every screen in the portal. */

  const [addOpen, setAddOpen] = useState(false);
  const [addFirst, setAddFirst] = useState('');
  const [addLast, setAddLast] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addLevel, setAddLevel] = useState<AgencyLevel>('Negotiator');
  const [addBranch, setAddBranch] = useState('');

  /* THE STRUCTURE. Straight from the hydrated org tables, which RLS has already
     narrowed to what this person's positions reach — the same narrowing that
     will judge any write. An agency manager gets one agency; a group director
     gets several. Nobody gets one they do not hold. */
  const agencies: Agency[] = useMemo(() => getAgencies(partnerScope), [partnerScope, dataVersion]);
  const groups = useMemo(() => getGroups(partnerScope), [partnerScope, dataVersion]);
  const multiAgency = agencies.length > 1;

  const people = useMemo(
    () => getUsers({ viewer: role, scope: partnerScope, team: false }).filter((u) => u.role !== 'superadmin' && u.role !== 'opndoor_manager'),
    [role, partnerScope, dataVersion, version],
  );

  const [filter, setFilter] = useState<TeamFilter>(NO_TEAM_FILTER);
  /** '' is every office. Only offered where there is more than one to choose. */
  const [place, setPlace] = useState('');
  const filtering = teamFilterActive(filter) || place !== '';
  /** Which groups the reader has opened. Only consulted when not filtering. */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  /** How many rows each group is showing, keyed the same way. */
  const [shown, setShown] = useState<Record<string, number>>({});

  /* FILTERED BEFORE GROUPING, not after, so a group's count is the number of
     MATCHES in it rather than its total with most of them hidden. A heading that
     says 12 and opens onto 2 is worse than no heading. */
  const visiblePeople = useMemo(
    () => people.filter((u) => matchesPerson(u, filter)),
    [people, filter],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, positionsService.Position[]> = {};
      await Promise.all(people.map(async (u) => {
        try { out[u.id] = await positionsService.getPositions(u.id); } catch { out[u.id] = []; }
      }));
      if (alive) setPositionsByUser(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.map((p) => p.id).join(','), version]);

  useEffect(() => {
    if (!currentUserId) { setOwnPositions([]); return; }
    let alive = true;
    positionsService.getPositions(currentUserId)
      .then((p) => { if (alive) setOwnPositions(p); })
      .catch(() => { if (alive) setOwnPositions([]); });
  }, [currentUserId, version]);

  /* Who may hand out a position. Same rule as the admin screen, read from the
     CALLER's own position: partner-wide or a group/agency position may; a branch
     manager may not, because granting from a branch is a way out of the branch
     you were given. set_user_scope refuses it in SQL either way. */
  const canGrant = positionsService.mayGrantPositions(role, ownPositions);
  const canInvite = role === 'management';

  /* Everything this person could place somebody at: exactly their own reach,
     which is what makes "no agency user sees structure outside their scope"
     true of the position picker as well as of the page. */
  const scopeTargets = useMemo<ScopeTarget[]>(() => {
    const out: ScopeTarget[] = [];
    for (const g of groups) if (g.id) out.push({ id: g.id, name: g.name, kind: 'group' });
    for (const a of agencies) {
      if (a.id) out.push({ id: a.id, name: a.name, kind: 'agency' });
      for (const b of a.branches ?? []) {
        if (b.id) out.push({ id: b.id, name: multiAgency ? `${a.name}, ${b.name}` : b.name, kind: 'branch' });
      }
    }
    return out;
  }, [agencies, groups, multiAgency]);

  const branchTargets = useMemo(() => scopeTargets.filter((t) => t.kind === 'branch'), [scopeTargets]);

  /* NAMING THE LEVEL ONLY WHEN IT SAYS SOMETHING. On a single agency every
     position is at the same level and "Agency: Regent's Lettings" is the page
     header repeated; on a group it is the information. */
  const showLevel = multiAgency || groups.length > 0;

  /* WHAT THIS VIEWER HAS MORE THAN ONE OF. The same question Reporting, League
     and Applications ask, asked the same way, so a single-office agency gets
     one answer across the portal instead of four screens' worth of opinions. */
  const shape = useMemo(() => viewerShape(role, partnerScope), [role, partnerScope, dataVersion]);

  /* POSITION ONLY WHERE THERE IS SOMEWHERE TO CHOOSE BETWEEN.
     On a one-office agency the modal opened on a list of one, where "covers the
     whole agency" and "covers the one branch" describe the same people: a choice
     with no difference behind it. So the control is not offered at all and the row
     shows the level and the level actions. This is the same question showLevel
     already asks two declarations up, and the same question Reporting, League and
     Applications ask, so a single-office agency gets one answer across the portal. */
  const posIsAChoice = groups.length > 0 || multiAgency || branchTargets.length > 1;

  const layout = useMemo(
    () => teamLayout({ agencies, people: visiblePeople, positionsByUser, ownPositions, shape }),
    [agencies, visiblePeople, positionsByUser, ownPositions, shape],
  );

  /** Every office the reader could narrow to, and whether narrowing is a choice
      at all. One office is not a filter, it is the page. */
  const placeOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    for (const a of layout.agencies) {
      if (multiAgency) out.push({ id: `agency:${a.key}`, label: a.name });
      for (const n of a.branches) out.push({ id: `branch:${n.key}`, label: multiAgency ? `${a.name}, ${n.name}` : n.name });
    }
    return out;
  }, [layout.agencies, multiAgency]);
  const placeIsAChoice = placeOptions.length > 1;

  /** The blocks and offices left after the place filter. Applied to the LAYOUT
      rather than to people, because "which office" is a question about the tree
      and the tree is what the layout already resolved. */
  const blocks = useMemo(() => {
    if (!place) return layout.agencies;
    const [kind, id] = place.split(':');
    return layout.agencies
      .filter((a) => (kind === 'agency' ? a.key === id : a.branches.some((n) => n.key === id)))
      .map((a) => (kind === 'agency' ? a : { ...a, wide: [], branches: a.branches.filter((n) => n.key === id) }));
  }, [layout.agencies, place]);

  const matchCount = useMemo(
    () => (place
      ? blocks.reduce((n, a) => n + a.wide.length + a.branches.reduce((m, x) => m + x.people.length, 0), 0)
      : visiblePeople.length),
    [blocks, place, visiblePeople.length],
  );

  const clearFilters = () => { setFilter(NO_TEAM_FILTER); setPlace(''); };

  const headerName = multiAgency
    ? (groups[0]?.name ?? countOf(agencies.length, 'agency'))
    : (agencies[0]?.name ?? 'Your team');

  /* ---- WHO RECEIVES THE MONTHLY COMMISSION STATEMENT --------------------

  /* The commission-statement tick used to live on this page, offered at the
     party's top position. It is now ADMIN ONLY, on the person's row in
     Agencies: who is paid what is Opndoor's record, not a setting an agency
     adjusts about itself. The org-tree helpers that supported it went with it;
     mayChangeCommissionTick and topLevelHeld remain in positionsService for the
     admin screen and for the SQL guard that is the actual rule. */

  /* doSetNotify stood here, for the tickbox column. The panel owns that
     setting now, together with the event choices and the monthly statement,
     and owns the toast and the reload with it. */

  async function run(fn: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refreshData();
      refresh();
      toast(success);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    const first = addFirst.trim();
    const last = addLast.trim();
    const email = addEmail.trim();
    if (!first || !last || !email) { toast('Give a first name, a last name and an email address.', 'error'); return; }
    // A negotiator with no branch is invisible to their own manager until their
    // first referral, so the branch is asked for at invite rather than later.
    if (addLevel === 'Negotiator' && branchTargets.length > 1 && !addBranch) {
      toast('Choose the branch this person works at.', 'error'); return;
    }
    /* ONE OFFICE MEANS THE BRANCH IS IMPLIED, so it is defaulted and never asked.
       Asking would be a select of one, and the answer is already known. */
    const branch = addLevel === 'Negotiator' ? (addBranch || branchTargets[0]?.id || '') : '';
    await run(async () => {
      const chosen = levelsGrantableBy(actor).find((l) => l.level === addLevel);
      /* The dialog only offers grantable levels, so this cannot normally miss. It
         is a real check rather than a `!` because the alternative to a clear
         message here is a crash on a level somebody reached some other way. */
      if (!chosen) throw new Error('You can only invite someone at or below your own level.');
      await inviteUser({
        firstName: first, lastName: last, email,
        // The LEVEL is what the inviter chose; role and the commission bit are
        // what it means. Kept together in AGENCY_LEVELS so no screen can invent
        // a fourth combination.
        role: chosen.role, seesCommission: chosen.seesCommission,
        /* THE BRANCH GOES IN `branch`, WHICH IS THE BUG THAT MADE THIS FAIL.
           invite-user reads the home branch from `branch` and refuses a scoped
           caller who sends none ("Choose the branch this negotiator will work
           at"). This sent `branch: ''` every time and put the office in
           scopeKind/scopeTarget instead, so inviting a Negotiator from Team was
           refused by the server for ANY caller holding a position, one office or
           twenty. Rosa holds one agency position, so it never worked for her.

           And no scopeKind: a Negotiator is placed by their home branch and needs
           no position, which usersService's own comment on scopeKind already
           says. Sending one asked set_user_scope to grant a position the model
           says a Negotiator does not have. */
        partner: partnerScope, branch,
      });
      setAddOpen(false);
      setAddFirst(''); setAddLast(''); setAddEmail(''); setAddBranch(''); setAddLevel('Negotiator');
    }, `Invitation sent to ${email}.`);
  }

  function PersonRow({ u }: { u: ManagedUser }) {
    const pillLabel = levelLabel(u);
    const pillCls = ROLE_PILL[pillLabel] ?? 'role-tag--ref';
    const [statusLabel, statusVariant] = STATUS_PILL[u.status] ?? ['Active', 'deed' as PillVariant];
    const held = positionsByUser[u.id] ?? [];
    const isSelf = u.id === currentUserId;
    const may = canInvite && mayActOn(actor, { id: u.id, role: u.role, seesCommission: u.seesCommission === true });
    /* AT OR BELOW, not strictly below. set_receives_notifications admits a
       peer and admits yourself; `may` above is strictly-below because it
       governs things done TO somebody. Using `may` here hid the control from
       every Manager on a team of Managers, and from anybody looking at their
       own row, while SQL would have accepted the change. */
    const mayTick = canInvite
      && mayActOnOrEqual(actor, { id: u.id, role: u.role, seesCommission: u.seesCommission === true });
    return (
      <div className="tm-person">
        <span className="tm-person__avatar">{personInitials(personLabel(u.name, userEmail(u)))}</span>
        <div className="tm-person__id">
          {/* The email once, with what is missing under it. */}
          <div className="tm-person__name">{personLabel(u.name, userEmail(u)).title}{isSelf && <span className="tm-you">You</span>}</div>
          <div className="tm-person__email">{personLabel(u.name, userEmail(u)).sub}</div>
        </div>
        <span className={`role-tag ${pillCls}`}>{pillLabel}</span>
        <Pill variant={statusVariant}>{statusLabel}</Pill>
        <span className="tm-person__pos">{positionsService.describePosition(held, showLevel, u.role)}</span>
        <div className="tm-person__acts">
          {/* NOTIFICATIONS, ON THE PERSON. A loose "Receives notifications"
              tickbox stood in its own column here. It was one of three
              places the same subject was split across, which is what walk
              fix 12 was about, and it could only ever answer a third of the
              question: not which events this person is told about, and not
              whether they get a monthly statement.

              `mayTick` is AT OR BELOW, not strictly below, and so is not
              `may`: a person may always change their own event choices, and
              `may` is false on your own row because it governs things done
              TO somebody. It is the client twin of caller_may_set_for. */}
          {mayTick && u.status !== 'pending' && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setNotifUser(u)}>Notifications</Button>
          )}
          {/* NOTHING AT ALL AGAINST SOMEONE AT OR ABOVE YOU. `may` is false for
              your own row too, since self is somebody at your own level, which is
              why the old !isSelf tests have gone rather than been kept beside it.
              Hiding is a courtesy: the ladder refuses in SQL either way, and it
              refuses at the table as well as at the RPC. */}
          {may && u.status === 'pending' && (
            <>
              <Button variant="quiet" size="sm" disabled={busy}
                onClick={() => void run(() => resendInvite(u.id), `Invitation resent to ${userEmail(u)}.`)}>
                Resend invite
              </Button>
              <Button variant="quiet" size="sm" disabled={busy}
                onClick={() => setConfirm({
                  line: `Cancel the invitation to ${u.name}?`,
                  cta: 'Cancel invitation',
                  run: () => cancelInvite(u.id),
                  done: `Invitation to ${userEmail(u)} cancelled.`,
                })}>
                Cancel invite
              </Button>
            </>
          )}
          {may && canGrant && posIsAChoice && u.status !== 'pending' && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setPosUser(u)}>Position</Button>
          )}
          {/* ONE CONTROL, NOT A FLIP. "Make Manager" could only ever toggle between
              two of the three levels and could not say which way it was going on a
              Director's row. The chooser offers the levels this actor may hand out,
              which is at or below their own, minus the one they already hold. */}
          {may && u.status === 'active' && levelsGrantableBy(actor).some((l) => l.level !== levelLabel(u)) && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => { setLevelPick(null); setLevelUser(u); }}>
              Change level
            </Button>
          )}
          {may && u.status !== 'pending' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => setConfirm({
                line: `Send ${u.name} a password reset link?`,
                cta: 'Send reset link',
                run: () => resetUserPassword(u.id),
                // Says what happened and nothing about the account: the same
                // answer whether or not the address turned out to be reachable.
                done: 'Password reset link sent.',
              })}>
              Send password reset
            </Button>
          )}
          {may && u.status !== 'pending' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => setConfirm({
                line: `Reset two-factor for ${u.name}? They will set up a new authenticator the next time they sign in.`,
                cta: 'Reset two-factor',
                /* The email's success is reported by the caller that can show it;
                   this confirm dialog has its own success line. */
                run: async () => { await resetUserMfa(u.id); },
                done: `${u.name} will enrol a new authenticator at their next sign in.`,
              })}>
              Reset two-factor
            </Button>
          )}
          {may && u.status === 'active' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => setConfirm({
                // Says what it keeps, because "remove" reads like deletion and this
                // is not one: the person, their referrals and the history stay.
                line: `Remove ${possessive(u.name)} access? Their referrals and history are kept, and you can restore access later.`,
                cta: 'Remove access',
                run: () => setUserStatus(u.id, 'deactivated'),
                done: `${u.name} no longer has access.`,
              })}>
              Remove access
            </Button>
          )}
          {may && u.status === 'deactivated' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => void run(() => setUserStatus(u.id, 'active'), `${u.name} has access again.`)}>
              Restore access
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* A GROUP: collapsed by default, counted in its heading, paged at fifty.

     `id` keys both the open set and the page size, so two groups cannot share a
     state slot and opening one cannot page another.

     While a filter is on it is forced open: a search that answered with a row of
     closed doors would make the search useless, and the count in the heading is
     then the number of MATCHES here, which is the thing worth seeing. */
  function Block({ id, title, sub, list }: { id: string; title: string; sub: string; list: ManagedUser[] }) {
    const isOpen = filtering || opened.has(id);
    const limit = shown[id] ?? TEAM_PAGE_SIZE;
    const page = list.slice(0, limit);
    const rest = list.length - page.length;
    const toggle = () => setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    return (
      <Card>
        {/* The whole heading is the control, not a chevron beside it: at this
            size the heading is what a reader is already aiming at. */}
        <button
          type="button"
          className={`tm-group${isOpen ? ' is-open' : ''}`}
          onClick={toggle}
          aria-expanded={isOpen}
          disabled={filtering}
        >
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={16} />
          <span className="tm-group__txt">
            <CardHead title={title} sub={sub} />
          </span>
          <span className="tm-group__n">{list.length}</span>
        </button>
        {isOpen && (
          <div className="tm-list">
            {list.length === 0
              ? <div className="tm-empty">{filtering ? 'Nobody here matches.' : 'Nobody here yet.'}</div>
              : page.map((u) => <PersonRow key={u.id} u={u} />)}
            {rest > 0 && (
              <div className="tm-more">
                <Button variant="quiet" size="sm"
                  onClick={() => setShown((p) => ({ ...p, [id]: limit + TEAM_PAGE_SIZE }))}>
                  Show {Math.min(rest, TEAM_PAGE_SIZE)} more
                </Button>
                <span className="soft">{page.length} of {list.length}</span>
              </div>
            )}
          </div>
        )}
      </Card>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>Your organisation</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>{headerName}</h1>
          <p className="page-head__sub">
            Everyone with access, and where they sit. Invite a colleague, set where they work, and
            remove access when they leave.
            {' '}
            {/* Said once, plainly, rather than leaving a manager hunting for an
                Add branch button that is deliberately not here. */}
            Branches and agencies are set up by opndoor. Ask us and we will add one.
          </p>
        </div>
        {canInvite && (
          <div className="page-head__actions">
            <Button variant="primary" onClick={() => setAddOpen(true)} arrow>Invite someone</Button>
          </div>
        )}
      </div>

      {/* THE FILTER BAR. Search always; level and status always, because they are
          questions about a person and every agency has people; office only where
          there is more than one, for the same reason the Position control is
          hidden there. A one-office agency therefore gets search plus two
          selects, which is the whole of the fold for them. */}
      <div className="tm-filters">
        <input
          type="search"
          className="inp tm-search"
          value={filter.q}
          placeholder="Search by name or email"
          aria-label="Search people by name or email"
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
        />
        <select
          aria-label="Level" value={filter.level}
          onChange={(e) => setFilter((f) => ({ ...f, level: e.target.value as AgencyLevel | '' }))}
        >
          <option value="">Any level</option>
          {AGENCY_LEVELS.map((l) => <option key={l.level} value={l.level}>{l.level}</option>)}
        </select>
        <select
          aria-label="Status" value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="pending">Invited</option>
          <option value="deactivated">Deactivated</option>
        </select>
        {placeIsAChoice && (
          <select aria-label="Office" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">Everywhere</option>
            {placeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {filtering && (
          <div className="tm-filters__state">
            <span className="soft">{matchCount} {plural(matchCount, 'person')}</span>
            <Button variant="quiet" size="sm" onClick={clearFilters}>Clear</Button>
          </div>
        )}
      </div>

      <div className="tm-blocks">
        {filtering && matchCount === 0 ? (
          /* Said once, here, rather than as an empty state inside every group:
             a search that matches nothing should answer in one sentence, not with
             a column of empty headings. */
          <Card>
            <div className="tm-empty">Nobody matches that. Try a different name, or clear the filters.</div>
          </Card>
        ) : !layout.grouped ? (
          /* ONE OFFICE: ONE LIST. No heading on the card either — the page head
             above it already names the agency, and "Across the agency" over the
             only card on the screen is the header said twice. */
          <Card>
            <div className="tm-list">
              {layout.flat.length === 0
                ? <div className="tm-empty">Nobody here yet.</div>
                : layout.flat.slice(0, shown.flat ?? TEAM_PAGE_SIZE).map((u) => <PersonRow key={u.id} u={u} />)}
              {layout.flat.length > (shown.flat ?? TEAM_PAGE_SIZE) && (
                <div className="tm-more">
                  <Button variant="quiet" size="sm"
                    onClick={() => setShown((p) => ({ ...p, flat: (p.flat ?? TEAM_PAGE_SIZE) + TEAM_PAGE_SIZE }))}>
                    Show {Math.min(layout.flat.length - (shown.flat ?? TEAM_PAGE_SIZE), TEAM_PAGE_SIZE)} more
                  </Button>
                  <span className="soft">{Math.min(shown.flat ?? TEAM_PAGE_SIZE, layout.flat.length)} of {layout.flat.length}</span>
                </div>
              )}
            </div>
          </Card>
        ) : (<>
          {layout.groupWide.length > 0 && !place && (
            <Block
              id="group-wide"
              title="Across the group"
              sub="Everyone whose remit covers more than one agency."
              list={layout.groupWide}
            />
          )}

          {/* AGENCY THEN BRANCH. In group scope the agency is a heading with its
              own offices under it, rather than every office in the group in one
              run with its agency name glued to the front. */}
          {blocks.map((a) => (
            <Fragment key={a.key}>
              {multiAgency && <h2 className="tm-agency">{a.name}</h2>}
              {a.wide.length > 0 && (
                <Block
                  id={`wide:${a.key}`}
                  title={multiAgency ? `Across ${a.name}` : 'Across the agency'}
                  sub={`Everyone whose remit covers the whole of ${a.name}, not one office.`}
                  list={a.wide}
                />
              )}
              {a.branches.map((n) => (
                <Block key={n.key} id={`branch:${n.key}`} title={n.name} sub="Branch" list={n.people} />
              ))}
            </Fragment>
          ))}

          {layout.unplaced.length > 0 && !place && (
            <Block
              id="unplaced"
              title="Not placed yet"
              sub={canGrant
                ? 'These people see their own referrals and nothing else. Give them a position to file them at an office.'
                : 'These people see their own referrals and nothing else.'}
              list={layout.unplaced}
            />
          )}
        </>)}
      </div>

      {posUser && (
        <PositionModal
          user={posUser}
          targets={scopeTargets}
          onClose={() => setPosUser(null)}
          onSaved={() => { setPosUser(null); void refreshData().then(refresh); }}
        />
      )}

      {notifUser && (
        <PersonNotifications
          userId={notifUser.id}
          personName={notifUser.name || userEmail(notifUser)}
          onClose={() => setNotifUser(null)}
        />
      )}

      {/* CHANGE LEVEL. The levels this actor may set, which is at or below their
          own, minus the one this person already holds, because "make them what
          they already are" is not a choice. One line of confirmation before it
          acts, naming the person and the level. */}
      {levelUser && (
        <Modal
          open
          width={460}
          title={`Change ${possessive(levelUser.name)} level`}
          sub="This changes what they can see and do across the portal."
          onClose={() => { setLevelUser(null); setLevelPick(null); }}
          footer={<>
            <Button variant="ghost" disabled={busy} onClick={() => { setLevelUser(null); setLevelPick(null); }}>Cancel</Button>
            <Button
              variant="primary" disabled={!levelPick || busy}
              onClick={() => {
                const target = levelUser; const pick = levelPick;
                if (!target || !pick) return;
                void run(async () => {
                  await setAgencyLevel(target.id, pick);
                  setLevelUser(null); setLevelPick(null);
                }, `${target.name} is now ${pick === 'Director' ? 'a Director' : pick === 'Manager' ? 'a Manager' : 'a Negotiator'}.`);
              }}
            >
              {busy ? 'Saving…' : 'Change level'}
            </Button>
          </>}
        >
          <div className="roleopts">
            {levelsGrantableBy(actor)
              .filter((o) => o.level !== levelLabel(levelUser))
              .map((o) => (
                <label key={o.level} className={`roleopt${levelPick === o.level ? ' is-sel' : ''}`} onClick={() => setLevelPick(o.level)}>
                  <span className="roleopt__radio" />
                  <div><div className="roleopt__name">{o.level}</div><div className="roleopt__desc">{o.desc}</div></div>
                </label>
              ))}
          </div>
          {levelPick && (
            <p className="soft" style={{ marginTop: 14 }}>
              Make {levelUser.name} {levelPick === 'Director' ? 'a Director' : levelPick === 'Manager' ? 'a Manager' : 'a Negotiator'}?
            </p>
          )}
        </Modal>
      )}

      {/* ONE LINE, THEN ACT. Team had no confirmation on anything, which was fine
          while the only actions were a role flip and a deactivate. Removing access,
          resetting somebody's second factor and mailing a reset link all deserve a
          sentence first, and they all read the same way, so they share one dialog. */}
      {confirm && (
        <Modal
          open
          width={440}
          title={confirm.cta}
          onClose={() => setConfirm(null)}
          footer={<>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy}
              onClick={() => {
                const c = confirm;
                void run(async () => { await c.run(); setConfirm(null); }, c.done);
              }}>
              {busy ? 'Working…' : confirm.cta}
            </Button>
          </>}
        >
          <p>{confirm.line}</p>
        </Modal>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        width={560}
        title="Invite someone"
        sub="They get an email with a link to set a password and their second factor. Nothing is visible to them until they do."
        footer={<>
          <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void sendInvite()} arrow disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</Button>
        </>}
      >
        <div className="form-grid">
          <Field label="First name"><input type="text" value={addFirst} onChange={(e) => setAddFirst(e.target.value)} /></Field>
          <Field label="Last name"><input type="text" value={addLast} onChange={(e) => setAddLast(e.target.value)} /></Field>
          <Field label="Email" span2><input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} /></Field>
        </div>
        {/* ONLY THE LEVELS THIS INVITER MAY HAND OUT, which is at or below their
            own: a Director sees all three, a Manager sees Manager and Negotiator.
            Note this is AT or below, unlike the row actions, which are strictly
            below: growing a second Manager is an agency's own business, acting on
            one is not. Offering Director to a Manager used to send the invite and
            silently downgrade it to Manager, so the person arrived at the wrong
            level with an email saying otherwise. */}
        <div className="roleopts" style={{ marginTop: 14 }}>
          {levelsGrantableBy(actor).map((o) => (
            <label key={o.level} className={`roleopt${addLevel === o.level ? ' is-sel' : ''}`} onClick={() => setAddLevel(o.level)}>
              <span className="roleopt__radio" />
              <div><div className="roleopt__name">{o.level}</div><div className="roleopt__desc">{o.desc}</div></div>
            </label>
          ))}
        </div>
        {addLevel === 'Negotiator' && branchTargets.length > 1 && (
          <div style={{ marginTop: 14 }}>
            <Field label="Which branch?" span2 hint="So they appear in the right place here from day one, before their first referral.">
              <select value={addBranch} onChange={(e) => setAddBranch(e.target.value)}>
                <option value="">Choose a branch</option>
                {branchTargets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
