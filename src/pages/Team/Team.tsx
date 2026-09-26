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

   THE SCREEN IS NOT THE BOUNDARY. Every list here is already RLS-scoped —
   agencies_select, branches_select and users_select each narrow to the caller's
   positions — and every write runs through the same guard-checked RPC the admin
   screens use. Hiding is a courtesy; SQL is the rule. See team-scope.test.sql.
   ===================================================================== */
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  cancelInvite, getAgencies, getGroups, inviteUser, resendInvite, setUserStatus,
  updateUserRole, getUsers, userEmail,
  type Agency, type ManagedUser, type Role,
} from '@/data';
import * as positionsService from '@/data/positionsService';
import { viewerShape, type ViewerShape } from '@/data/viewerShape';
import { PositionModal, type ScopeTarget } from '@/pages/UserManagement/PositionModal';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import '@/pages/UserManagement/UserManagement.css';
import './Team.css';

/* THE TWO ROLES AN AGENCY HAS. Described in the words of the business the
   reader is in, not the portal's internals: no "partner", no "estate", no
   "full visibility of all tracking and analytics". Matches the role pills. */
const ROLE_CHOICES: { id: Role; name: string; desc: string }[] = [
  { id: 'management', name: 'Management', desc: 'Sees the whole agency: every referral, every branch, the money, and this page. Can invite colleagues and set where they sit.' },
  { id: 'referrer', name: 'Referrer', desc: 'Sees their own referrals and nothing else. The right answer for a negotiator.' },
];

const ROLE_PILL: Record<string, [string, string]> = {
  management: ['Management', 'role-tag--mgmt'],
  referrer: ['Referrer', 'role-tag--ref'],
  developer: ['Developer', 'role-tag--dev'],
};

const STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  pending: ['Invited', 'warn'],
  deactivated: ['Deactivated', 'muted'],
};

const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('');

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

export function Team() {
  usePageMeta('team', 'Team', ['Home', 'Team']);
  const { role, partnerScope, currentUserId, refresh: refreshData, dataVersion } = useSession();
  const toast = useToast();

  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [busy, setBusy] = useState(false);
  const [positionsByUser, setPositionsByUser] = useState<Record<string, positionsService.Position[]>>({});
  const [ownPositions, setOwnPositions] = useState<positionsService.Position[]>([]);
  const [posUser, setPosUser] = useState<ManagedUser | null>(null);
  /* Who receives the monthly commission statement. Held here rather than on
     ManagedUser: it is read off users.receives_commission_statements by two
     screens, and hydrate's user list is shared by every screen in the portal. */
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [tickBusy, setTickBusy] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addFirst, setAddFirst] = useState('');
  const [addLast, setAddLast] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<Role>('referrer');
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
    let alive = true;
    positionsService.getCommissionStatementTicks(people.map((u) => u.id))
      .then((t) => { if (alive) setTicks(t); })
      .catch(() => { if (alive) setTicks({}); });
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

  const layout = useMemo(
    () => teamLayout({ agencies, people, positionsByUser, ownPositions, shape }),
    [agencies, people, positionsByUser, ownPositions, shape],
  );

  const headerName = multiAgency
    ? (groups[0]?.name ?? `${agencies.length} agencies`)
    : (agencies[0]?.name ?? 'Your team');

  /* ---- WHO RECEIVES THE MONTHLY COMMISSION STATEMENT --------------------

     The tree, flattened to the two edges the containment question needs. Built
     from the hydrated org tables, which RLS has already narrowed to this
     viewer's reach, which is also why mayChangeCommissionTick errs towards
     refusing rather than guessing at what it cannot see. */
  const tree = useMemo<positionsService.OrgEdges>(() => {
    const agencyOfBranch = new Map<string, string>();
    const groupOfAgency = new Map<string, string>();
    for (const a of agencies) {
      if (!a.id) continue;
      if (a.groupId) groupOfAgency.set(a.id, a.groupId);
      for (const b of a.branches ?? []) if (b.id) agencyOfBranch.set(b.id, a.id);
    }
    return { agencyOfBranch, groupOfAgency };
  }, [agencies]);

  /* THE PARTY'S TOP POSITION. Group directors where there is a group, else
     agency managers, else branch managers: the level a statement is addressed
     at, and the level the backfill defaulted the tick on for. */
  const topPosition = useMemo(
    () => positionsService.topLevelHeld(Object.values(positionsByUser).flat()),
    [positionsByUser],
  );

  /* Shown only to somebody who may actually change this person, so nobody is
     offered a switch SQL is going to refuse. The screen is still not the
     boundary: set_receives_commission_statements asks the same question again
     and is the one that counts. */
  const mayTick = (u: ManagedUser) => positionsService.mayChangeCommissionTick({
    role,
    own: ownPositions,
    target: positionsByUser[u.id] ?? [],
    targetHomeBranchId: u.homeBranchId,
    tree,
  });

  const showsTick = (u: ManagedUser) => {
    const atTop = topPosition != null && (positionsByUser[u.id] ?? []).some((p) => p.kind === topPosition);
    /* ALREADY ON IS ALWAYS SHOWN, whoever holds it, so a tick can be switched
       off wherever it ended up. Otherwise the control is offered at the top
       position only, and only to somebody active: the recipients function
       writes to active people alone, because a pending invite has never signed
       in and the portal link in the statement goes nowhere they can open. A
       switch with no effect is worse than no switch. */
    if (!ticks[u.id] && (!atTop || u.status !== 'active')) return false;
    return mayTick(u);
  };

  /* The explanation earns its line once, on the first row that carries the
     control, rather than under every name in the list. */
  const firstTickRow = layout.flat.find((u) => showsTick(u))?.id ?? null;

  async function toggleTick(u: ManagedUser, next: boolean) {
    if (tickBusy) return;
    setTickBusy(u.id);
    try {
      const now = await positionsService.setReceivesCommissionStatements(u.id, next);
      // The row, not a full reload: one boolean moved and nothing else on this
      // page depends on it. The RPC's own answer, not `next`, so the screen
      // shows what the database settled on.
      setTicks((t) => ({ ...t, [u.id]: now }));
      toast(now
        ? `${u.name} now receives commission statements.`
        : `${u.name} no longer receives commission statements.`);
    } catch (e) {
      // SQL's refusal, word for word. The rule lives there; a paraphrase here
      // would be a second copy of it, free to be wrong.
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally {
      setTickBusy(null);
    }
  }

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
    if (addRole === 'referrer' && branchTargets.length > 1 && !addBranch) {
      toast('Choose the branch this person works at.', 'error'); return;
    }
    const branch = addRole === 'referrer' ? (addBranch || branchTargets[0]?.id || '') : '';
    await run(async () => {
      await inviteUser({
        firstName: first, lastName: last, email, role: addRole,
        partner: partnerScope, branch: '',
        ...(branch ? { scopeKind: 'branch' as const, scopeTarget: branch } : {}),
      });
      setAddOpen(false);
      setAddFirst(''); setAddLast(''); setAddEmail(''); setAddBranch(''); setAddRole('referrer');
    }, `Invitation sent to ${email}.`);
  }

  function PersonRow({ u }: { u: ManagedUser }) {
    const [pillLabel, pillCls] = ROLE_PILL[u.role] ?? [u.role, 'role-tag--ref'];
    const [statusLabel, statusVariant] = STATUS_PILL[u.status] ?? ['Active', 'deed' as PillVariant];
    const held = positionsByUser[u.id] ?? [];
    const isSelf = u.id === currentUserId;
    return (
      <div className="tm-person">
        <span className="tm-person__avatar">{initials(u.name)}</span>
        <div className="tm-person__id">
          <div className="tm-person__name">{u.name}{isSelf && <span className="tm-you">You</span>}</div>
          <div className="tm-person__email">{userEmail(u)}</div>
        </div>
        <span className={`role-tag ${pillCls}`}>{pillLabel}</span>
        <Pill variant={statusVariant}>{statusLabel}</Pill>
        <span className="tm-person__pos">{positionsService.describePosition(held, showLevel)}</span>
        <div className="tm-person__acts">
          {u.status === 'pending' && canInvite && (
            <>
              <Button variant="quiet" size="sm" disabled={busy}
                onClick={() => void run(() => resendInvite(u.id), `Invitation resent to ${userEmail(u)}.`)}>
                Resend
              </Button>
              <Button variant="quiet" size="sm" disabled={busy}
                onClick={() => void run(() => cancelInvite(u.id), `Invitation to ${userEmail(u)} cancelled.`)}>
                Cancel invite
              </Button>
            </>
          )}
          {canGrant && u.status !== 'pending' && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => setPosUser(u)}>Position</Button>
          )}
          {canInvite && !isSelf && u.status === 'active' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => void run(() => setUserStatus(u.id, 'deactivated'), `${u.name} deactivated.`)}>
              Deactivate
            </Button>
          )}
          {canInvite && !isSelf && u.status === 'deactivated' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => void run(() => setUserStatus(u.id, 'active'), `${u.name} reactivated.`)}>
              Reactivate
            </Button>
          )}
          {canInvite && !isSelf && u.status === 'active' && (
            <Button variant="quiet" size="sm" disabled={busy}
              onClick={() => void run(
                () => updateUserRole(u.id, u.role === 'management' ? 'referrer' : 'management'),
                `${u.name} is now ${u.role === 'management' ? 'a Referrer' : 'Management'}.`,
              )}>
              {u.role === 'management' ? 'Make Referrer' : 'Make Management'}
            </Button>
          )}
        </div>
        {showsTick(u) && (
          /* Its own line under the name rather than another button in the row:
             the label is a sentence, and the one line explaining it needs the
             width. */
          <label className="tm-stmt">
            <input
              type="checkbox"
              checked={!!ticks[u.id]}
              disabled={tickBusy !== null}
              onChange={(e) => void toggleTick(u, e.target.checked)}
            />
            <span className="tm-stmt__lbl">{positionsService.COMMISSION_STATEMENT_LABEL}</span>
            {u.id === firstTickRow && (
              <span className="tm-stmt__why">{positionsService.COMMISSION_STATEMENT_NOTE}</span>
            )}
          </label>
        )}
      </div>
    );
  }

  function Block({ title, sub, list }: { title: string; sub: string; list: ManagedUser[] }) {
    return (
      <Card>
        <CardHead title={title} sub={sub} />
        <div className="tm-list">
          {list.length === 0
            ? <div className="tm-empty">Nobody here yet.</div>
            : list.map((u) => <PersonRow key={u.id} u={u} />)}
        </div>
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

      <div className="tm-blocks">
        {!layout.grouped ? (
          /* ONE OFFICE: ONE LIST. No heading on the card either — the page head
             above it already names the agency, and "Across the agency" over the
             only card on the screen is the header said twice. */
          <Card>
            <div className="tm-list">
              {layout.flat.length === 0
                ? <div className="tm-empty">Nobody here yet.</div>
                : layout.flat.map((u) => <PersonRow key={u.id} u={u} />)}
            </div>
          </Card>
        ) : (<>
          {layout.groupWide.length > 0 && (
            <Block
              title="Across the group"
              sub="Everyone whose remit covers more than one agency."
              list={layout.groupWide}
            />
          )}

          {/* AGENCY THEN BRANCH. In group scope the agency is a heading with its
              own offices under it, rather than every office in the group in one
              run with its agency name glued to the front. */}
          {layout.agencies.map((a) => (
            <Fragment key={a.key}>
              {multiAgency && <h2 className="tm-agency">{a.name}</h2>}
              {a.wide.length > 0 && (
                <Block
                  title={multiAgency ? `Across ${a.name}` : 'Across the agency'}
                  sub={`Everyone whose remit covers the whole of ${a.name}, not one office.`}
                  list={a.wide}
                />
              )}
              {a.branches.map((n) => (
                <Block key={n.key} title={n.name} sub="Branch" list={n.people} />
              ))}
            </Fragment>
          ))}

          {layout.unplaced.length > 0 && (
            <Block
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
        <div className="roleopts" style={{ marginTop: 14 }}>
          {ROLE_CHOICES.map((o) => (
            <label key={o.id} className={`roleopt${addRole === o.id ? ' is-sel' : ''}`} onClick={() => setAddRole(o.id)}>
              <span className="roleopt__radio" />
              <div><div className="roleopt__name">{o.name}</div><div className="roleopt__desc">{o.desc}</div></div>
            </label>
          ))}
        </div>
        {addRole === 'referrer' && branchTargets.length > 1 && (
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
