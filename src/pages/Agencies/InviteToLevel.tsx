/* =====================================================================
   InviteToLevel — invite a person from the level they belong to (a branch, a
   brand, or a group), reached from the People blocks on the agency page.

   A branch invite places a negotiator at that branch immediately (home branch).
   A brand/group manager is invited here; their exact position is set from Users
   once they accept — inviteUser returns before the real account id exists, so the
   scope grant cannot be attached in the same step.
   ===================================================================== */
import { useState } from 'react';
import { AGENCY_LEVELS, inviteUser, type AgencyLevel, type Role } from '@/data';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export interface InviteContext {
  level: 'group' | 'brand' | 'branch';
  /** Owning partner slug — passed to the invite, never shown. */
  partner: string;
  /** The node's display name (group / brand / branch), for the modal copy. */
  name: string;
  groupId?: string;
  agencyId?: string;
  branchId?: string;
  /** Offer the three agency levels explicitly rather than inferring one from the
      node. Used by the People tab, where an admin is adding somebody to an
      agency rather than to a particular node and may set any level. */
  chooseLevel?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteToLevel({ ctx, onClose, onInvited }: { ctx: InviteContext; onClose: () => void; onInvited: () => void }) {
  const toast = useToast();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  // At a branch you can invite a negotiator (referrer, placed at the branch) or a
  // branch manager. Above a branch, the person is a manager/director.
  const [branchRole, setBranchRole] = useState<Role>('referrer');
  const [chosen, setChosen] = useState<AgencyLevel>('Negotiator');
  const [busy, setBusy] = useState(false);

  /* THE LEVEL, AND THE BUG THAT WAS IN IT.

     inviteUser takes role AND seesCommission, because Director and Manager are
     the same role and differ only in that bit. This dialog never sent it, and
     users.sees_commission defaults to false, so EVERY person invited from here
     landed as a Manager. The group dialog is titled "Invite group director" and
     created a Manager: it said the level out loud and then did not set it.

     Both paths now send the pair. The inferred path says what each title has
     always promised (a group director is a Director, an agency or branch manager
     is a Manager), and the explicit path is the People tab, where an admin picks
     from the same three levels the Team dialog offers. */
  const inferredLevel: AgencyLevel = ctx.level === 'group' ? 'Director'
    : ctx.level === 'brand' ? 'Manager'
    : branchRole === 'management' ? 'Manager' : 'Negotiator';
  const level: AgencyLevel = ctx.chooseLevel ? chosen : inferredLevel;
  const spec = AGENCY_LEVELS.find((l) => l.level === level)!;
  const role: Role = spec.role;

  const levelWord = ctx.level === 'group' ? 'group' : ctx.level === 'brand' ? 'agency' : 'branch';
  const titleFor = ctx.chooseLevel ? 'Invite someone'
    : ctx.level === 'group' ? 'Invite group director'
    : ctx.level === 'brand' ? 'Invite agency manager'
    : 'Invite branch manager or negotiator';

  const canSend = !!email.trim() && EMAIL_RE.test(email.trim()) && !busy && !!ctx.partner;

  // The position granted on creation. A negotiator (referrer) is placed by their
  // home branch instead of a scope; a group/brand/branch manager gets a scope.
  /* A NEGOTIATOR IS PLACED BY THEIR HOME BRANCH AND HOLDS NO POSITION, which the
     model has always said and which the explicit-level path would otherwise have
     broken: the scope came from the NODE, so choosing Negotiator on an agency's
     People tab would have granted them an agency-wide position, making a person
     who should see their own referrals see everybody's.

     So the scope follows the LEVEL chosen, not the node it was chosen from. A
     Negotiator invited from the People tab gets neither a scope nor a branch,
     lands unplaced, and the admin sets where they sit with Position on their
     row, which is what the dialog's closing line tells them to do. */
  const scope: { scopeKind?: 'group' | 'agency' | 'branch'; scopeTarget?: string } =
    level === 'Negotiator' ? {}
    : ctx.level === 'group' && ctx.groupId ? { scopeKind: 'group', scopeTarget: ctx.groupId }
    : ctx.level === 'brand' && ctx.agencyId ? { scopeKind: 'agency', scopeTarget: ctx.agencyId }
    : ctx.level === 'branch' && ctx.branchId ? { scopeKind: 'branch', scopeTarget: ctx.branchId }
    : {};

  const send = async () => {
    if (!canSend) { if (!EMAIL_RE.test(email.trim())) toast('Enter a valid email address.', 'error'); return; }
    setBusy(true);
    try {
      await inviteUser({
        firstName: first.trim(), lastName: last.trim(), email: email.trim(),
        role, seesCommission: spec.seesCommission,
        partner: ctx.partner,
        // The home branch is the branch node's own, and only a branch node has
        // one. From the People tab there is no branch in hand, so a Negotiator
        // arrives unplaced rather than placed at a guess.
        branch: ctx.branchId,
        ...scope,
      });
      toast(`Invited, and placed at ${ctx.name}.`, 'ok');
      onInvited();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the invitation.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={titleFor}
      sub={`${ctx.name} · they will be invited to Opndoor and land in this ${levelWord}.`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={send} disabled={!canSend}>{busy ? 'Sending…' : 'Send invite'}</Button></>}
    >
      <div className="form-grid">
        <Field span2 label={<>Work email <span className="req" aria-hidden="true">*</span></>} htmlFor="inv-email"><input id="inv-email" type="email" autoComplete="off" placeholder="name@agency.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="First name" htmlFor="inv-first" hint="Optional"><input id="inv-first" type="text" autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Last name" htmlFor="inv-last" hint="Optional"><input id="inv-last" type="text" autoComplete="off" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
      </div>
      {ctx.chooseLevel && (
        <div className="roleopts" style={{ marginTop: 14 }}>
          {AGENCY_LEVELS.map((o) => (
            <label key={o.level} className={`roleopt${level === o.level ? ' is-sel' : ''}`} onClick={() => setChosen(o.level)}>
              <span className="roleopt__radio" />
              <div><div className="roleopt__name">{o.level}</div><div className="roleopt__desc">{o.desc}</div></div>
            </label>
          ))}
        </div>
      )}
      {!ctx.chooseLevel && ctx.level === 'branch' && (
        <Field label="Position" htmlFor="inv-role" hint="A negotiator works this branch; a branch manager runs it.">
          <select id="inv-role" value={branchRole} onChange={(e) => setBranchRole(e.target.value as Role)}>
            <option value="referrer">Negotiator</option>
            <option value="management">Branch manager</option>
          </select>
        </Field>
      )}
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '10px 0 0' }}>
        {ctx.chooseLevel
          ? `They are invited to ${ctx.name} and can work as soon as they accept. Set where they sit with Position on their row.`
          : `They are placed on this ${levelWord} the moment they are invited, and can work it as soon as they accept.`}
      </p>
    </Modal>
  );
}
