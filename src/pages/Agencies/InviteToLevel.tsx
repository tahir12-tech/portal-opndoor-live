/* =====================================================================
   InviteToLevel — invite a person from the level they belong to (a branch, a
   brand, or a group), reached from the People blocks on the agency page.

   A branch invite places a negotiator at that branch immediately (home branch).
   A brand/group manager is invited here; their exact position is set from Users
   once they accept — inviteUser returns before the real account id exists, so the
   scope grant cannot be attached in the same step.
   ===================================================================== */
import { useState } from 'react';
import { inviteUser, type Role } from '@/data';
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
  const [busy, setBusy] = useState(false);

  const role: Role = ctx.level === 'branch' ? branchRole : 'management';
  const levelWord = ctx.level === 'group' ? 'group' : ctx.level === 'brand' ? 'brand' : 'branch';
  const titleFor = ctx.level === 'group' ? 'Invite a group director' : ctx.level === 'brand' ? 'Invite a brand manager' : 'Invite to this branch';
  const placesNow = ctx.level === 'branch' && role === 'referrer';

  const canSend = !!email.trim() && EMAIL_RE.test(email.trim()) && !busy && !!ctx.partner;

  const send = async () => {
    if (!canSend) { if (!EMAIL_RE.test(email.trim())) toast('Enter a valid email address.', 'error'); return; }
    setBusy(true);
    try {
      await inviteUser({ firstName: first.trim(), lastName: last.trim(), email: email.trim(), role, partner: ctx.partner, branch: ctx.branchId });
      toast(placesNow ? `Invited to ${ctx.name}.` : `Invited. Set their ${levelWord} position from Users once they accept.`, 'ok');
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
      {ctx.level === 'branch' && (
        <Field label="Position" htmlFor="inv-role" hint="A negotiator works this branch; a branch manager runs it.">
          <select id="inv-role" value={branchRole} onChange={(e) => setBranchRole(e.target.value as Role)}>
            <option value="referrer">Negotiator</option>
            <option value="management">Branch manager</option>
          </select>
        </Field>
      )}
      {!placesNow && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '10px 0 0' }}>
          They are invited as a manager for this organisation; their exact {levelWord} position is assigned from <b>Users</b> once they accept the invite.
        </p>
      )}
    </Modal>
  );
}
