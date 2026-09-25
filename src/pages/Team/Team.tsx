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

   THE SCREEN IS NOT THE BOUNDARY. Every list here is already RLS-scoped —
   agencies_select, branches_select and users_select each narrow to the caller's
   positions — and every write runs through the same guard-checked RPC the admin
   screens use. Hiding is a courtesy; SQL is the rule. See team-scope.test.sql.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import {
  cancelInvite, getAgencies, getGroups, inviteUser, resendInvite, setUserStatus,
  updateUserRole, getUsers, userEmail,
  type Agency, type ManagedUser, type Role,
} from '@/data';
import * as positionsService from '@/data/positionsService';
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
        if (b.id) out.push({ id: b.id, name: multiAgency ? `${a.name} — ${b.name}` : b.name, kind: 'branch' });
      }
    }
    return out;
  }, [agencies, groups, multiAgency]);

  const branchTargets = useMemo(() => scopeTargets.filter((t) => t.kind === 'branch'), [scopeTargets]);

  /* NAMING THE LEVEL ONLY WHEN IT SAYS SOMETHING. On a single agency every
     position is at the same level and "Agency: Regent's Lettings" is the page
     header repeated; on a group it is the information. */
  const showLevel = multiAgency || groups.length > 0;

  /* PEOPLE UNDER THE STRUCTURE THEY SIT IN.
     A branch position files somebody at that branch. An agency or group
     position files them at the top, because that is what it means. Nobody is
     listed twice, and nobody is dropped: a person with no position at all is a
     negotiator, which is a real answer, and they go in their own block. */
  const { nodes, wide, unplaced } = useMemo(() => {
    /* NARROWED TO THE VIEWER'S OWN POSITIONS when they hold branch ones.
       branches_select lets anyone who can reach an agency see all of its
       branches, which is right for a picker and wrong here: a negotiator placed
       at one office should read their own team, not their agency's. A manager
       holds an agency or group position, or none, and keeps the whole tree. */
    const ownBranches = ownPositions.filter((p) => p.kind === 'branch').map((p) => p.targetId);
    const onlyBranchScoped = ownBranches.length > 0
      && !ownPositions.some((p) => p.kind === 'agency' || p.kind === 'group');
    const visible = new Set(ownBranches);

    const byKey = new Map<string, Node>();
    for (const a of agencies) {
      for (const b of a.branches ?? []) {
        if (!b.id) continue;
        if (onlyBranchScoped && !visible.has(b.id)) continue;
        byKey.set(b.id, { key: b.id, kind: 'branch', name: b.name, agencyName: a.name, people: [] });
      }
    }
    const wideList: ManagedUser[] = [];
    const none: ManagedUser[] = [];
    for (const u of people) {
      const held = positionsByUser[u.id] ?? [];
      const branch = held.filter((p) => p.kind === 'branch');
      if (branch.length === 1 && byKey.has(branch[0].targetId)) {
        byKey.get(branch[0].targetId)!.people.push(u);
      } else if (held.length) {
        // A group or agency position, or more than one branch: they are not "at"
        // any single office, and filing them under one would be a lie. A
        // branch-scoped viewer does not see them at all — they sit above.
        if (!onlyBranchScoped) wideList.push(u);
      } else if (!onlyBranchScoped) {
        // Somebody with no position could be anywhere in the agency, so a
        // branch-scoped viewer is not shown them.
        none.push(u);
      }
    }
    return { nodes: [...byKey.values()], wide: wideList, unplaced: none };
  }, [agencies, people, positionsByUser, ownPositions]);

  const headerName = multiAgency
    ? (groups[0]?.name ?? `${agencies.length} agencies`)
    : (agencies[0]?.name ?? 'Your team');

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
            Branches and agencies are set up by opndoor — ask us and we will add one.
          </p>
        </div>
        {canInvite && (
          <div className="page-head__actions">
            <Button variant="primary" onClick={() => setAddOpen(true)} arrow>Invite someone</Button>
          </div>
        )}
      </div>

      <div className="tm-blocks">
        {wide.length > 0 && (
          <Block
            title={multiAgency ? 'Across the group' : 'Across the agency'}
            sub={multiAgency
              ? 'Everyone whose remit covers more than one office.'
              : `Everyone whose remit covers the whole of ${agencies[0]?.name ?? 'the agency'}, not one office.`}
            list={wide}
          />
        )}

        {nodes.map((n) => (
          <Block
            key={n.key}
            title={multiAgency ? `${n.agencyName} — ${n.name}` : n.name}
            sub="Branch"
            list={n.people}
          />
        ))}

        {unplaced.length > 0 && (
          <Block
            title="Not placed yet"
            sub={canGrant
              ? 'These people see their own referrals and nothing else. Give them a position to file them at an office.'
              : 'These people see their own referrals and nothing else.'}
            list={unplaced}
          />
        )}
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
