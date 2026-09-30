/* =====================================================================
   Users — manage partner staff, or the opndoor team (?team=opndoor).
   opndoor admin accounts never appear in a partner list; the opndoor team
   view lists only opndoor staff; Management sees only its own partner.

   Lifecycle is real (Pending / Active / Deactivated) and every state-changing
   action (role change, deactivate, reactivate, reset 2FA) runs through an
   audited, guard-checked service call: a hard role-model wall (partner users
   are Referrer/Management only; opndoor staff are admin only), self-service
   lockout guards (no deactivating/demoting yourself or the last active admin),
   and a confirmation dialog stating the consequence. Reachable by opndoor admin
   + Management (route guard).
   ===================================================================== */
// Walk fix 19: the possessive is formed in one place.
import { possessive } from '@/lib/format';
import { LEVEL_PILL, holdsAgencyLevel, personLevelLabel } from '@/data/levelLabel';
import { ChangeLevelModal } from '@/components/people/ChangeLevelModal';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PositionModal, type ScopeTarget } from './PositionModal';
import { PersonNotifications } from '@/components/people/PersonNotifications';
import * as positionsService from '@/data/positionsService';
import { AGENCY_LEVELS, getAgencies, getGroups, isOpndoorStaff, levelsGrantableBy, mayActOn, mayActOnOrEqual, type Actor, type AgencyLevel } from '@/data';
import { isHousePartner } from '@/data/channel';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  getPartner, getPartners, getUserAudit, getUsers, homePartner, inviteUser, partnerName,
  cancelInvite, resendInvite, resetUserMfa, resetUserPassword, setUserStatus, updateUserName, updateUserRole, userEmail, userPartnerName,
  type ManagedUser, type Role, type UserAuditEntry,
} from '@/data';
import { ALL_PARTNERS } from '@/data';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import './UserManagement.css';

const ROLE_META: Record<Role, [string, string]> = {
  superadmin: ['opndoor admin', 'role-tag--super'],
  opndoor_manager: ['opndoor manager', 'role-tag--super'],
  management: ['Management', 'role-tag--mgmt'],
  referrer: ['Referrer', 'role-tag--ref'],
  developer: ['Developer', 'role-tag--dev'],
};

const STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  pending: ['Pending', 'warn'],
  deactivated: ['Deactivated', 'muted'],
};

const AUDIT_LABEL: Record<string, string> = { status: 'Status', role: 'Role', reset_mfa: '2FA' };
const dmy = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

interface RoleOption {
  id: Role;
  name: string;
  desc: string;
}
const ROLE_OPTIONS: RoleOption[] = [
  { id: 'superadmin', name: 'opndoor admin (Super-admin)', desc: "opndoor's internal admin. Full control of the portal: manages agencies, branches and users, keeps opndoor's own records in step, edits help resources, and sees every referral." },
  { id: 'opndoor_manager', name: 'opndoor manager', desc: "opndoor operations staff. Sees every referral across all partners and works the day-to-day queues: the eligibility decision, reconciliation and direct-agency matches. Cannot change partner settings or commission, create partners, or manage the opndoor team." },
  { id: 'management', name: 'Management', desc: "Partner management. The same screens and tools as a referrer, but across the whole partner with full visibility of all tracking and analytics. Manages the partner's own agencies, branches and team, with edits applying straight away. Cannot change portal settings." },
  { id: 'referrer', name: 'Referrer', desc: 'Sees and tracks only their own referrals. Can add agencies and branches on the fly while referring.' },
  // "Sees the Dev Centre only" read as seeing nothing, which made the role look
  // useless and led to it being handed out as management instead. It says what a
  // developer CAN do first, and is specific about the line: the whole partner's
  // book read-only, never the money.
  { id: 'developer', name: 'Developer', desc: "Partner-side integrator, for whoever builds against the API. Sees the applications list and detail, the dashboard and the league for the whole partner, read-only, plus the Dev Centre: their own API keys and webhook endpoints, request logs, delivery history with replay, and a full sandbox to rehearse in. They cannot create a referral or change an application, and they never see commission, settlement, exports or the bordereau." },
];

const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('');

interface ConfirmSpec {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  success: string;
  run: () => Promise<void>;
}

function RoleOptions({ options, selected, onSelect }: { options: RoleOption[]; selected: Role; onSelect: (r: Role) => void }) {
  return (
    <div className="roleopts">
      {options.map((o) => (
        <label key={o.id} className={`roleopt${selected === o.id ? ' is-sel' : ''}`} onClick={() => onSelect(o.id)}>
          <span className="roleopt__radio" />
          <div><div className="roleopt__name">{o.name}</div><div className="roleopt__desc">{o.desc}</div></div>
        </label>
      ))}
    </div>
  );
}

export function UserManagement({ team = false }: { team?: boolean } = {}) {
  const { role, seesCommission, currentUserId, selectedPartner, setSelectedPartner, refresh: refreshData } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const partnerParam = params.get('partner');
  // The Opndoor team is its own route (/opndoor-team) now; the legacy ?team=opndoor
  // query param is still honoured so old links keep working.
  const teamMode = (team || params.get('team') === 'opndoor') && role === 'superadmin';

  usePageMeta(teamMode ? 'opteam' : 'users', 'Users', ['Home', 'Administration', 'Users']);

  // Drill-in from Partners: ?partner=<id> scopes this view.
  useEffect(() => {
    if (partnerParam && getPartner(partnerParam)) setSelectedPartner(partnerParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerParam]);

  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuUp, setMenuUp] = useState(false);
  // #80 The popover is portalled to document.body (so the table's overflow can
  // never clip it); this holds the trigger's viewport rect for positioning.
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  // add-user modal
  const [addOpen, setAddOpen] = useState(false);
  const [addFirst, setAddFirst] = useState('');
  const [addLast, setAddLast] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<Role>('referrer');
  const [addPartnerId, setAddPartnerId] = useState('');
  const [addBranch, setAddBranch] = useState('');
  /* THE LEVEL AND THE POSITION, for an invite onto our own estate. Round 5,
     M10. This screen sent neither: no seesCommission, so every management
     invite landed as a Manager and a Director could not be created here at
     all; and no scopeKind, so invite-user refused the invite outright with
     "Choose the group, brand or branch this person will hold". Team already
     asks for the level this way, out of the one AGENCY_LEVELS list, so the
     two screens cannot invent different combinations. */
  const [addLevel, setAddLevel] = useState<AgencyLevel>('Negotiator');
  const [addScope, setAddScope] = useState('');
  // edit-role modal
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [levelUser, setLevelUser] = useState<ManagedUser | null>(null);
  const [editRole, setEditRole] = useState<Role>('referrer');
  const [editAudit, setEditAudit] = useState<UserAuditEntry[]>([]);
  const [showAllUserAudit, setShowAllUserAudit] = useState(false); // #113 cap Recent changes at 6
  // edit-name modal. Separate from edit-role because the two are granted the same
  // way but done at different times: a partner-API-provisioned user is named once,
  // then their role is set, and neither should force the other.
  // Positions. Loaded for everybody on screen so the column can show what each
  // person covers, which is the question the column exists to answer.
  const [positionUser, setPositionUser] = useState<ManagedUser | null>(null);
  const [notifUser, setNotifUser] = useState<ManagedUser | null>(null);
  const [positionsByUser, setPositionsByUser] = useState<Record<string, positionsService.Position[]>>({});
  const [ownPositions, setOwnPositions] = useState<positionsService.Position[]>([]);

  const [nameUser, setNameUser] = useState<ManagedUser | null>(null);
  const [nameVal, setNameVal] = useState('');

  useEffect(() => {
    const close = () => setMenuOpenId(null);
    document.addEventListener('click', close);
    // The portalled popover no longer travels with the table, so close it on
    // scroll/resize rather than letting it float out of place.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  const allUsers = getUsers({ viewer: role, team: teamMode, scope: selectedPartner });
  const showPartner = role === 'superadmin' && !teamMode;

  // Search across name, email, role label and partner (item: dead search fix).
  const q = query.trim().toLowerCase();
  const users = q
    ? allUsers.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        userEmail(u).toLowerCase().includes(q) ||
        /* WHAT THE EYE SEES. Searching the internal role word while the
           column shows the level is the dead search the comment above is
           about: typing "Director" would match nothing. */
        personLevelLabel(u).toLowerCase().includes(q) ||
        userPartnerName(u.partner).toLowerCase().includes(q))
    : allUsers;

  // Self-service + last-admin guards (also enforced server-side in the RPCs).
  const activeAdmins = allUsers.filter((u) => u.role === 'superadmin' && u.status === 'active').length;
  const isSelf = (u: ManagedUser) => currentUserId != null && u.id === currentUserId;
  const isLastActiveAdmin = (u: ManagedUser) => u.role === 'superadmin' && u.status === 'active' && activeAdmins <= 1;

  /* THE LEVEL LADDER, ON THIS SCREEN TOO.

     /users is not admin-only: App.tsx admits roles ['superadmin','management'],
     so a supplier's management staff reach it and were offered every control on
     everybody in their partner, their own Director included. isSelf and
     isLastActiveAdmin were the only limits, and neither is about seniority.

     Opndoor staff rank above all three agency levels, so mayActOn returns true
     for them and this narrows nothing for an admin. assert_may_act_on_user and
     the users_level_ladder_guard trigger refuse regardless; this is about not
     offering a control that cannot work. */
  const actor: Actor = { id: currentUserId, role, seesCommission };
  const mayAct = (u: ManagedUser) => mayActOn(actor, { id: u.id, role: u.role, seesCommission: u.seesCommission === true });

  const canDeactivate = (u: ManagedUser) => u.status === 'active' && !isSelf(u) && !isLastActiveAdmin(u) && mayAct(u);
  const canEditRole = (u: ManagedUser) => !isSelf(u) && !isLastActiveAdmin(u) && mayAct(u);

  /* WHOSE NOTIFICATIONS THIS READER MAY OPEN. AT OR BELOW, not strictly
     below, and so not `mayAct`: a person may always change their own event
     choices, and `mayAct` is false on your own row because it governs things
     done TO somebody. A pending invite has never signed in, so there is
     nothing to set and nobody to email. */
  const canNotify = (u: ManagedUser) =>
    u.status !== 'pending'
    && mayActOnOrEqual(actor, { id: u.id, role: u.role, seesCommission: u.seesCommission === true });

  /* WALK FIX 1: THE TWO THINGS YOU MAY DO TO YOUR OWN ACCOUNT.
     "The three dots on your own row open an empty menu. Either hide them, or
     show the actions you can take on your own account (rename, reset your own
     MFA)." Every other item is gated on mayAct, canEditRole or canDeactivate,
     and all three are false on your own row because they govern things done
     TO somebody -- correctly, and that is what left the menu empty.

     AND THE TWO DO NOT HAVE THE SAME RULE, which is why they are two
     predicates. Walked on dev, as each kind of caller, before this was
     written:

       rename yourself            admin: allowed   supplier management: allowed
       reset your own two-factor  admin: allowed   supplier management: REFUSED

     `admin_update_user_name` skips the ladder when the target is the caller,
     and `assert_may_act_on_user` names that as the documented exception in
     its own comment. `admin_reset_user_mfa` always asks the ladder, whose
     opndoor-staff early return comes BEFORE its self check -- and its own
     authorisation arm is `is_admin()`, which is superadmin alone. So the
     self exemption belongs to an Opndoor admin and to nobody else, and
     drawing the control anywhere else would be a button that always throws. */
  const canRename = (u: ManagedUser) => (isSelf(u) ? true : canEditRole(u));
  const canResetOwnMfa = (u: ManagedUser) =>
    isSelf(u) && u.status === 'active' && role === 'superadmin';

  // ---- role-aware framing ----
  let eyebrow = 'Administration · opndoor admin';
  /* WALK FIX 4. "Partner staff by partner ... view all partners at once"
     said the internal word three times in one sentence. The product calls
     these companies Suppliers and Agencies now; "partner" survives only as
     the internal name for a ROUTE, which is a different thing. */
  let sub = 'Staff at your suppliers and agencies. Open one from the Suppliers screen, or see everyone at once here.';
  let cardTitle = selectedPartner === ALL_PARTNERS ? 'All partner users' : `${partnerName(selectedPartner)} users`;
  let cardSub = selectedPartner === ALL_PARTNERS ? 'Every partner, with a Partner column' : 'Users for this partner';
  if (teamMode) {
    eyebrow = 'opndoor · internal team';
    sub = 'opndoor’s own staff. They see every supplier and agency, and never appear in a customer’s own people list.';
    cardTitle = 'opndoor team';
    cardSub = 'opndoor admin staff only';
  } else if (role === 'management') {
    eyebrow = 'Administration · Management';
    sub = 'Your team’s access to the portal. Add colleagues as Management or Referrer; opndoor admin accounts are managed by opndoor.';
    cardTitle = 'All users';
    cardSub = 'Your team';
  }

  // ---- action runners ----
  async function runConfirm() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await confirm.run();
      await refreshData();
      refresh();
      toast(confirm.success);
      setConfirm(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doDirect(fn: () => Promise<void>, success: string) {
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

  function openEditRole(u: ManagedUser) {
    setEditUser(u);
    setEditRole(u.role);
    setEditAudit([]);
    getUserAudit(u.id).then(setEditAudit).catch(() => setEditAudit([]));
  }

  function openEditName(u: ManagedUser) {
    setNameUser(u);
    // A user auto-provisioned by the partner API has their email as their name.
    // Offering that back as the starting value just invites them to keep it, so
    // start empty and let them type the real name.
    setNameVal(u.name === userEmail(u) ? '' : u.name);
  }

  const loadPositions = useCallback(async (ids: string[]) => {
    const out: Record<string, positionsService.Position[]> = {};
    await Promise.all(ids.map(async (id) => {
      try { out[id] = await positionsService.getPositions(id); } catch { out[id] = []; }
    }));
    setPositionsByUser(out);
  }, []);

  /* WHO MAY GRANT A POSITION is decided once, here, from the caller's OWN
     position. An opndoor admin always may; a partner-wide manager may, which is
     what management has always meant; a group or agency position may; a BRANCH
     position may not, because granting positions from a branch would be a way
     out of the branch you were given. set_user_scope refuses it in SQL as well,
     so this only decides whether the button is drawn. */
  const canGrantPositions = positionsService.mayGrantPositions(role, ownPositions);

  /* WALK FIX 5. "Opndoor admins see everything by their role and must never
     be given an office or position. Remove this dialog for Opndoor team
     members." It is not a permission question -- an admin may grant
     positions all day -- it is a question about the TARGET, which is why it
     is a second test beside canGrantPositions rather than folded into it.

     set_user_scope and set_home_branch refuse an Opndoor-staff target in SQL
     since 20261006940000, so this hides a dialog that could no longer write
     anything. It was worse than dead before that: the dialog said "Own
     referrals only" about somebody who sees every referral there is, asked
     for an office, and offered agency and supplier branches to a person who
     belongs to neither. */
  const canPosition = (u: ManagedUser) => canGrantPositions && !isOpndoorStaff(u.role);

  /* What the caller can hand out. An admin sees every brand and branch; anybody
     else sees exactly what agencies_select and branches_select let them, so the
     options are already scoped by the same rule that will judge the write. */
  const scopeTargets = useMemo<ScopeTarget[]>(() => {
    const out: ScopeTarget[] = [];
    // Scoped by the caller's own partner selection, so the options are already
    // narrowed by the same rule that will judge the write.
    // A whole group first (this option was dead until groups were loaded).
    for (const g of getGroups(selectedPartner)) {
      if (g.id) out.push({ id: g.id, name: g.name, kind: 'group' });
    }
    for (const a of getAgencies(selectedPartner)) {
      // Mock mode has no ids. A position needs one, so those rows are skipped
      // rather than offered as options that cannot be saved.
      if (a.id) out.push({ id: a.id, name: a.name, kind: 'agency' });
      for (const b of a.branches ?? []) {
        if (b.id) out.push({ id: b.id, name: `${a.name}, ${b.name}`, kind: 'branch' });
      }
    }
    return out;
  }, [selectedPartner]);

  // The branches a negotiator can be placed at on invite: the caller's own reach
  // (same narrowing as the position options above). Recording one makes the new
  // negotiator visible to the inviting manager from day one, before any referral.
  const branchTargets = useMemo(() => scopeTargets.filter((t) => t.kind === 'branch'), [scopeTargets]);

  /* OUR OWN ESTATE, where a person is a LEVEL holding a POSITION rather than a
     bare role. Everywhere else (the supplier rail) the partner IS the company
     and the role radio is the right question. */
  const addOnEstate = !teamMode && isHousePartner(addPartnerId);
  const grantableLevels = useMemo(() => levelsGrantableBy(actor), [actor]);

  useEffect(() => {
    if (currentUserId) {
      positionsService.getPositions(currentUserId).then(setOwnPositions).catch(() => setOwnPositions([]));
    }
  }, [currentUserId]);

  useEffect(() => {
    const ids = users.map((u) => u.id);
    if (ids.length) void loadPositions(ids);
  }, [users, loadPositions]);

  function handleAction(action: string, u: ManagedUser) {
    if (action === 'edit-role') { openEditRole(u); return; }
    if (action === 'edit-name') { openEditName(u); return; }
    if (action === 'reset-password') {
      void doDirect(() => resetUserPassword(u.id), `Password reset link sent to ${userEmail(u)}.`);
      return;
    }
    if (action === 'resend') {
      void doDirect(() => resendInvite(u.id), `Invitation resent to ${userEmail(u)}.`);
      return;
    }
    if (action === 'cancel-invite') {
      setConfirm({
        title: `Cancel the invite to ${userEmail(u)}?`,
        body: <>The pending user is removed and their invite link stops working. You can invite this email again afterwards.</>,
        confirmLabel: 'Cancel invite',
        danger: true,
        success: `Invitation to ${userEmail(u)} cancelled.`,
        run: () => cancelInvite(u.id),
      });
      return;
    }
    if (action === 'reset-2fa') {
      setConfirm({
        title: `Reset 2FA for ${u.name}?`,
        body: <>Their current authenticator stops working immediately and they are signed out. They set up a new authenticator at their next sign in.</>,
        confirmLabel: 'Reset 2FA',
        success: `Two-factor authentication reset for ${u.name}. They will set it up again at next sign in.`,
        run: () => resetUserMfa(u.id),
      });
      return;
    }
    /* WALK FIX 1. The same call, a different sentence, because the
       consequence lands on the person reading it: admin_reset_user_mfa
       deletes the factors AND the sessions, so this signs YOU out. Telling
       somebody about to sign themselves out that "they are signed out" is
       the kind of copy that produces a support call. */
    if (action === 'reset-own-2fa') {
      setConfirm({
        title: 'Reset your own two-factor?',
        body: <>Your current authenticator stops working immediately and you are signed out. You set up a new one the next time you sign in, so have your phone with you.</>,
        confirmLabel: 'Reset my two-factor',
        success: 'Two-factor reset. Sign in again and set up your new authenticator.',
        run: () => resetUserMfa(u.id),
      });
      return;
    }
    if (action === 'deactivate') {
      setConfirm({
        title: `Deactivate ${u.name}?`,
        body: <>They are signed out immediately and blocked from signing in. Reactivating them is the only way to restore access.</>,
        confirmLabel: 'Deactivate',
        danger: true,
        success: `${u.name} has been deactivated and can no longer sign in.`,
        run: () => setUserStatus(u.id, 'deactivated'),
      });
      return;
    }
    if (action === 'reactivate') {
      setConfirm({
        title: `Reactivate ${u.name}?`,
        body: <>They will be able to sign in again with their existing password and two-factor authentication.</>,
        confirmLabel: 'Reactivate',
        success: `${u.name} has been reactivated and can sign in again.`,
        run: () => setUserStatus(u.id, 'active'),
      });
    }
  }

  function toggleMenu(id: string, btn: HTMLElement) {
    setMenuOpenId((cur) => {
      if (cur === id) { setMenuRect(null); return null; }
      // Capture the trigger's viewport rect; the portalled popover is positioned
      // fixed from it. Flip upward when there is not enough room below the button.
      const rect = btn.getBoundingClientRect();
      setMenuRect(rect);
      setMenuUp(window.innerHeight - rect.bottom < 260);
      return id;
    });
  }

  // The action items for a row, rendered inside the portalled popover.
  function menuItems(u: ManagedUser): ReactNode {
    if (u.status === 'deactivated') {
      return mayAct(u)
        ? <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('reactivate', u); }}><Icon name="check" />Restore access</button>
        : <div className="rowmenu__empty">Nothing you can change here.</div>;
    }
    if (u.status === 'pending') {
      return (
        <>
          {canPosition(u) && (
            <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); setPositionUser(u); }}>
              <Icon name="org" />Set what they see
            </button>
          )}
          {mayAct(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('resend', u); }}><Icon name="send" />Resend invite</button>}
          {canEditRole(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('edit-name', u); }}><Icon name="edit" />Edit name</button>}
          {/* CHANGE LEVEL ON THE ESTATE, EDIT ROLE OFF IT. On our own estate a
              person holds one of three LEVELS, and moving them is one RPC that
              writes role and sees_commission together. "Edit role" there could
              not move anybody between Director and Manager at all, because
              those two share a role and differ only by the commission bit. On
              the supplier rail there are no levels (D11), so the role dialog
              is still the right control there. */}
          {canEditRole(u) && (holdsAgencyLevel(u)
            ? <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); setLevelUser(u); }}><Icon name="org" />Change level</button>
            : <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('edit-role', u); }}><Icon name="edit" />Edit role</button>)}
          <div className="rowmenu__sep" />
          {mayAct(u) && <button className="rowmenu__item rowmenu__item--danger" onClick={() => { setMenuOpenId(null); handleAction('cancel-invite', u); }}><Icon name="ban" />Cancel invite</button>}
        </>
      );
    }
    return (
      <>
        {/* WALK FIX 1. `canRename`, not `canEditRole`: renaming is the one
            thing on this menu you may do to your own account, and gating it
            with the level change left the whole menu empty on your own row. */}
        {canRename(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('edit-name', u); }}><Icon name="edit" />Edit name</button>}
        {/* CHANGE LEVEL ON THE ESTATE, EDIT ROLE OFF IT. On our own estate a
            person holds one of three LEVELS, and moving them is one RPC that
            writes role and sees_commission together. "Edit role" there could
            not move anybody between Director and Manager at all, because
            those two share a role and differ only by the commission bit. On
            the supplier rail there are no levels (D11), so the role dialog
            is still the right control there. */}
        {canEditRole(u) && (holdsAgencyLevel(u)
          ? <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); setLevelUser(u); }}><Icon name="org" />Change level</button>
          : <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('edit-role', u); }}><Icon name="edit" />Edit role</button>)}
        {/* WALK FIX 10: "reached from their row (the three dots menu)". Beside
            "Set what they see" on purpose, because they answer the same shape
            of question about a person. */}
        {canNotify(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); setNotifUser(u); }}><Icon name="send" />Notifications</button>}
        {mayAct(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('reset-password', u); }}><Icon name="lock" />Send password reset</button>}
        {mayAct(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('reset-2fa', u); }}><Icon name="phone" />Reset two-factor</button>}
        {/* WALK FIX 1, the second half. An Opndoor admin replacing the phone
            their authenticator lives on. Their own row only, and theirs
            alone: the server's self exemption for this is is_admin(). It
            signs them out, so the confirmation says so. */}
        {canResetOwnMfa(u) && <button className="rowmenu__item" onClick={() => { setMenuOpenId(null); handleAction('reset-own-2fa', u); }}><Icon name="phone" />Reset two-factor</button>}
        {canDeactivate(u) && <>
          <div className="rowmenu__sep" />
          <button className="rowmenu__item rowmenu__item--danger" onClick={() => { setMenuOpenId(null); handleAction('deactivate', u); }}><Icon name="ban" />Remove access</button>
        </>}
      </>
    );
  }

  function openAdd() {
    setAddFirst('');
    setAddLast('');
    setAddEmail('');
    setAddRole(teamMode ? 'superadmin' : 'referrer');
    setAddPartnerId(selectedPartner !== ALL_PARTNERS ? selectedPartner : homePartner());
    // Pre-pick the only branch a single-branch manager could mean; otherwise they choose.
    setAddBranch(branchTargets.length === 1 ? branchTargets[0].id : '');
    setAddLevel('Negotiator');
    setAddScope('');
    setAddOpen(true);
  }
  async function sendInvite() {
    const email = addEmail.trim();
    if (busy) return;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid work email to invite.'); return; }
    // A partner manager placing a negotiator must say which branch, or the new user
    // is invisible to a scoped inviter until their first referral. opndoor admins,
    // who see everyone, may leave it unset.
    const chosen = addOnEstate ? grantableLevels.find((l) => l.level === addLevel) : null;
    if (addOnEstate && !chosen) { toast('You can only invite someone at or below your own level.'); return; }
    const effRole: Role = chosen ? chosen.role : addRole;
    if (effRole === 'referrer' && role === 'management' && branchTargets.length > 0 && !addBranch) {
      toast('Choose the branch this negotiator will work at.'); return;
    }
    /* A Director or a Manager on our estate holds a position, and invite-user
       refuses the invite without one. Asking here means a sentence in the
       dialog rather than a 400 after the name and email have been typed. */
    const scope = addOnEstate && effRole === 'management'
      ? scopeTargets.find((t) => t.id === addScope) : undefined;
    if (addOnEstate && effRole === 'management' && !scope) {
      toast('Choose the group, brand or branch this person will hold.'); return;
    }
    setBusy(true);
    try {
      const rec = await inviteUser({
        firstName: addFirst.trim(), lastName: addLast.trim(), email,
        // The LEVEL is what was chosen; the role and the commission bit are what
        // it means. Both come from AGENCY_LEVELS so this screen and Team cannot
        // drift apart.
        role: effRole, seesCommission: chosen?.seesCommission === true,
        partner: addPartnerId,
        branch: effRole === 'referrer' ? addBranch : '',
        scopeKind: scope?.kind, scopeTarget: scope?.id,
      });
      await refreshData();
      refresh();
      setAddOpen(false);
      const what = chosen ? chosen.level : ROLE_META[addRole][0];
      toast(`Invitation sent to ${email} as ${what}${(addRole === 'superadmin' || addRole === 'opndoor_manager') ? '' : ` at ${partnerName(rec.partner)}`}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the invitation.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Save-role opens a confirmation stating the consequence (then runs the update).
  function requestSaveRole() {
    if (!editUser || editRole === editUser.role) { setEditUser(null); return; }
    const u = editUser;
    const from = ROLE_META[u.role][0];
    const to = ROLE_META[editRole][0];
    setEditUser(null);
    setConfirm({
      title: `Change ${possessive(u.name)} role?`,
      body: <><b>{from}</b> → <b>{to}</b>. Their access changes immediately at their next page load. {editRole === 'management' ? 'They will see everything in your organisation.' : editRole === 'referrer' ? 'They will see only their own referrals.' : ''}</>,
      confirmLabel: 'Change role',
      success: `${possessive(u.name)} role updated to ${to}.`,
      run: () => updateUserRole(u.id, editRole),
    });
  }

  // Save-name confirms like save-role does, so the two read the same way.
  function requestSaveName() {
    if (!nameUser) return;
    const next = nameVal.trim();
    const u = nameUser;
    if (!next || next === u.name) { setNameUser(null); return; }
    setNameUser(null);
    setConfirm({
      title: `Rename ${u.name}?`,
      body: <>They will appear as <b>{next}</b> across the portal. Referrals they have already made keep the name recorded at the time, so rename before they refer rather than after.</>,
      confirmLabel: 'Save name',
      success: `Renamed to ${next}.`,
      run: () => updateUserName(u.id, next),
    });
  }

  // The opndoor team screen offers the two Opndoor-internal roles; a partner-side
  // invite offers neither (opndoor_manager is opndoor staff, and invite-user
  // rejects it from a management caller anyway).
  const addOptions = teamMode
    ? ROLE_OPTIONS.filter((o) => o.id === 'superadmin' || o.id === 'opndoor_manager')
    /* AND NEVER `developer` ON THE ESTATE, which SQL refuses outright:
       admin_update_user_role's own words are that the developer role is for
       supplier integration staff. Since Q-06 item G an estate row opens the
       Change level dialog instead and never reaches this list at all, so
       this is the brace to that belt -- it stops the option returning if
       anything else ever opens the role dialog on an estate row. */
    : ROLE_OPTIONS.filter((o) => o.id !== 'superadmin' && o.id !== 'opndoor_manager'
        && !(o.id === 'developer' && !!editUser && isHousePartner(editUser.partner ?? '')));
  // Role-model wall: the edit dialog only offers roles on the target's side of it.
  const editTargetIsTeam = !!editUser && (editUser.partner === 'opndoor' || editUser.role === 'superadmin');
  const editRoleOptions = editTargetIsTeam
    ? ROLE_OPTIONS.filter((o) => o.id === 'superadmin' || o.id === 'opndoor_manager')
    /* AND NEVER `developer` ON THE ESTATE, which SQL refuses outright:
       admin_update_user_role's own words are that the developer role is for
       supplier integration staff. Since Q-06 item G an estate row opens the
       Change level dialog instead and never reaches this list at all, so
       this is the brace to that belt -- it stops the option returning if
       anything else ever opens the role dialog on an estate row. */
    : ROLE_OPTIONS.filter((o) => o.id !== 'superadmin' && o.id !== 'opndoor_manager'
        && !(o.id === 'developer' && !!editUser && isHousePartner(editUser.partner ?? '')));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow__dot" /><span>{eyebrow}</span></div>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Users</h1>
          <p className="page-head__sub">{sub}</p>
        </div>
        <div className="page-head__actions">
          <Button variant="primary" size="sm" onClick={openAdd}><Icon name="plus" /> Add user</Button>
        </div>
      </div>

      {/* role legend */}
      <div className="toolbar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        {teamMode ? (
          <span className="role-tag role-tag--super">opndoor admin · full control of the portal</span>
        ) : (
          <>
            {/* The three levels, in the words the rest of the product uses
                and in ladder order. Taken from AGENCY_LEVELS so the legend
                and the invite dialog cannot describe a level differently. */}
            {AGENCY_LEVELS.map((l) => (
              <span key={l.level} className={`role-tag ${LEVEL_PILL[l.level]}`}>
                {l.level} · {l.desc.replace(/\.$/, '').toLowerCase()}
              </span>
            ))}
          </>
        )}
      </div>

      <Card>
        <CardHead
          title={cardTitle}
          sub={cardSub}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {showPartner && (
                <span className="users-chip">
                  <Icon name="shield" />Partner:{' '}
                  <select value={selectedPartner} onChange={(e) => setSelectedPartner(e.target.value)}>
                    <option value={ALL_PARTNERS}>All partners</option>
                    {getPartners().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </span>
              )}
              <div className="users-search">
                <Icon name="search" />
                <input type="text" placeholder="Search users" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
          }
        />
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>User</th>
                {showPartner && <th>Partner</th>}
                <th>Role</th>
                <th>Sees</th>
                <th>Last active</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const rm = ROLE_META[u.role];
                const sp = STATUS_PILL[u.status] ?? STATUS_PILL.pending;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="who">
                        <span className="who__av">{initials(u.name)}</span>
                        <div><div className="dt__name">{u.name}</div><div className="dt__sub">{userEmail(u)}</div></div>
                      </div>
                    </td>
                    {showPartner && <td className="soft">{userPartnerName(u.partner)}</td>}
                    {/* THE LEVEL, NOT THE ROLE. This screen lists both rails
                        side by side, so the word has to follow the rail:
                        Director / Manager / Negotiator on our estate, and the
                        role's own word on the supplier rail, where those
                        levels do not exist (D11). */}
                    <td><span className={`role-tag ${LEVEL_PILL[personLevelLabel(u)] ?? rm[1]}`}>{personLevelLabel(u)}</span></td>
                    <td className="soft">{positionsService.describePosition(positionsByUser[u.id] ?? [], true, u.role)}</td>
                    <td className="soft">{u.lastActive}</td>
                    <td><Pill variant={sp[1]}>{sp[0]}</Pill></td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="rowmenu">
                        <button
                          className="rowmenu__btn"
                          aria-label="User actions"
                          onClick={(e) => { e.stopPropagation(); toggleMenu(u.id, e.currentTarget); }}
                        >
                          <Icon name="dots" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={showPartner ? 7 : 6} className="soft" style={{ textAlign: 'center', padding: '28px 0' }}>{q ? `No users match “${query.trim()}”.` : 'No users to show yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ADD USER */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        width={560}
        title={teamMode ? 'Add opndoor team member' : 'Add user'}
        sub={teamMode ? 'Add opndoor staff. An admin has full control of the portal; a manager runs the day-to-day queues across every supplier and agency, but not the sensitive settings.' : 'Invite a colleague and set their access level.'}
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={sendInvite} arrow disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</Button></>}
      >
        <div className="form-grid">
          <Field label="First name"><input type="text" placeholder="James" value={addFirst} onChange={(e) => setAddFirst(e.target.value)} /></Field>
          <Field label="Last name"><input type="text" placeholder="Okafor" value={addLast} onChange={(e) => setAddLast(e.target.value)} /></Field>
          <Field label="Work email" span2><input type="email" placeholder="james@brackenhouse.co.uk" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} /></Field>
          {addRole !== 'superadmin' && addRole !== 'opndoor_manager' && (
            <Field label="Partner company" span2 hint="The partner company this user belongs to.">
              <select value={addPartnerId} onChange={(e) => setAddPartnerId(e.target.value)}>
                {getPartners().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        {/* ON OUR ESTATE A PERSON IS A LEVEL, NOT A ROLE. Director and Manager
            are the same role and differ only by sees_commission, so a role
            radio cannot express the difference and this screen could never
            create a Director. The levels offered are the ones this inviter may
            hand out, which is at or below their own. Round 5, M10. */}
        {addOnEstate ? (
          <Field label="Level" hint="Director sees what the agency earns. Manager sees everything else. Negotiator sees their own referrals.">
            <select
              aria-label="Level"
              value={addLevel}
              onChange={(e) => { setAddLevel(e.target.value as AgencyLevel); setAddScope(''); }}
            >
              {grantableLevels.map((l) => <option key={l.level} value={l.level}>{l.level}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Role">
            <RoleOptions options={addOptions} selected={addRole} onSelect={setAddRole} />
          </Field>
        )}
        {/* AND A DIRECTOR OR MANAGER HOLDS A POSITION. Everybody on our estate
            does: invite-user refuses the invite without one, and before this
            was asked here that refusal arrived as a 400 after the whole form
            had been filled in. */}
        {addOnEstate && addLevel !== 'Negotiator' && (
          <Field label="Position" hint="The group, brand or branch this person runs. It is what they can see and who they can act on.">
            <select aria-label="Position" value={addScope} onChange={(e) => setAddScope(e.target.value)}>
              <option value="">Select a group, brand or branch</option>
              {scopeTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        {(addOnEstate ? addLevel === 'Negotiator' : addRole === 'referrer') && branchTargets.length > 0 && (
          <Field label="Branch" hint="Where this negotiator works. They show in your team from the moment you invite them.">
            <select value={addBranch} onChange={(e) => setAddBranch(e.target.value)}>
              <option value="">Select a branch</option>
              {branchTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
      </Modal>

      {/* EDIT ROLE */}
      <Modal
        open={nameUser !== null}
        onClose={() => setNameUser(null)}
        title={<>Edit name · {nameUser?.name ?? 'User'}</>}
        sub={nameUser ? userEmail(nameUser) : ''}
        footer={<><Button variant="ghost" onClick={() => setNameUser(null)}>Cancel</Button><Button variant="primary" onClick={requestSaveName} disabled={!nameVal.trim()}>Save name</Button></>}
      >
        <Field label="Full name">
          <input
            type="text"
            value={nameVal}
            maxLength={120}
            placeholder="Jane Smith"
            onChange={(e) => setNameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && nameVal.trim()) requestSaveName(); }}
          />
        </Field>
        <p className="soft" style={{ fontSize: 13, marginTop: 8 }}>
          Referrals already made keep the name recorded at the time, so this changes how they appear from here on rather than retrospectively.
        </p>
      </Modal>

      {/* The estate's own control. Mounted beside the role dialog rather than
          replacing it, because /users lists both rails and each needs its own. */}
      {levelUser && (
        <ChangeLevelModal
          actor={actor}
          person={{ id: levelUser.id, name: levelUser.name, current: personLevelLabel(levelUser) }}
          onClose={() => setLevelUser(null)}
          onDone={(m) => { toast(m); setLevelUser(null); void refreshData(); refresh(); }}
          onError={(m) => toast(m, 'error')}
        />
      )}
      <Modal
        open={editUser !== null}
        onClose={() => setEditUser(null)}
        title={<>Edit role · {editUser?.name ?? 'User'}</>}
        sub={editUser ? userEmail(editUser) : ''}
        footer={<><Button variant="ghost" onClick={() => setEditUser(null)}>Cancel</Button><Button variant="primary" onClick={requestSaveRole} disabled={editTargetIsTeam}>Save role</Button></>}
      >
        {editTargetIsTeam ? (
          <p className="soft" style={{ fontSize: 13, marginBottom: 6 }}>opndoor admin is the only role for internal staff. To move someone to a partner, they must be re-invited under that partner.</p>
        ) : (
          <Field label="Role">
            <RoleOptions options={editRoleOptions} selected={editRole} onSelect={setEditRole} />
          </Field>
        )}
        {!editTargetIsTeam && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Recent changes</div>
            {editAudit.length > 0 ? (
              <>
                <ul className="pm-audit">
                  {(showAllUserAudit ? editAudit : editAudit.slice(0, 6)).map((e, i) => (
                    <li key={i} className="pm-audit__row">
                      <span className="pm-audit__field">{AUDIT_LABEL[e.action] ?? e.action}</span>
                      <span className="pm-audit__delta">{e.oldValue} → <b>{e.newValue}</b></span>
                      <span className="pm-audit__meta">{e.actor} · {dmy(e.at)}</span>
                    </li>
                  ))}
                </ul>
                {editAudit.length > 6 && (
                  <button type="button" className="pm-audit__more" onClick={() => setShowAllUserAudit((v) => !v)}>
                    {showAllUserAudit ? 'Show fewer' : `Show all (${editAudit.length})`}
                  </button>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>No changes recorded yet. Role changes, deactivations and 2FA resets for this user will appear here.</p>
            )}
          </div>
        )}
      </Modal>

      {positionUser && canGrantPositions && (
        <PositionModal
          user={positionUser}
          targets={scopeTargets}
          onClose={() => setPositionUser(null)}
          onSaved={() => { void loadPositions(users.map((u) => u.id)); }}
        />
      )}

      {/* Walk fixes 9 and 10. No reload on close: the panel owns its own, and
          nothing on this table reads what it changes. */}
      {notifUser && (
        <PersonNotifications
          userId={notifUser.id}
          personName={notifUser.name || userEmail(notifUser)}
          onClose={() => setNotifUser(null)}
        />
      )}

      {/* CONFIRM (role change / deactivate / reactivate / reset 2FA) */}
      <Modal
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        width={440}
        title={confirm?.title ?? ''}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button variant="primary" className={confirm?.danger ? 'btn--danger' : undefined} onClick={runConfirm} disabled={busy}>{busy ? 'Working…' : confirm?.confirmLabel}</Button></>}
      >
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{confirm?.body}</p>
      </Modal>

      {/* #80 Row actions popover, portalled to the body so the table's overflow
          can never clip it, positioned fixed from the trigger's rect. */}
      {menuOpenId && menuRect && (() => {
        const u = users.find((x) => x.id === menuOpenId);
        if (!u) return null;
        const style: React.CSSProperties = menuUp
          ? { position: 'fixed', bottom: window.innerHeight - menuRect.top + 4, left: Math.max(8, menuRect.right - 184) }
          : { position: 'fixed', top: menuRect.bottom + 4, left: Math.max(8, menuRect.right - 184) };
        return createPortal(
          <div className="rowmenu__pop rowmenu__pop--portal" style={style}>{menuItems(u)}</div>,
          document.body,
        );
      })()}
    </>
  );
}
