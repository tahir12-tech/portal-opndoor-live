/* =====================================================================
   INVITING SOMEONE TO A SUPPLIER, FROM THE SUPPLIER'S OWN PAGE.

   Matt, 2026-10-01, verbatim: "Supplier People tab: add an 'Invite
   someone' button, using the supplier Add user form (no branch, levels
   Management and Referrer, plus Developer when API access is on)."

   =====================================================================
   WHY A COMPONENT AND NOT A LINK TO /users
   =====================================================================

   The People tab already IS the supplier's user list -- the Users and
   Manage buttons came off the suppliers list a week ago and everything
   that pointed at `/users?partner=...` now points here. Sending somebody
   back there to invite would undo that, and would ask them to pick the
   supplier they are already looking at.

   THE FORM IS THE SUPPLIER ARM OF THE EXISTING ONE, not a new idea about
   inviting. Same `inviteUser`, same role descriptions, same modal. What
   it drops is everything the supplier rail has no answer for:

     the Supplier select   they are on that supplier's page.
     the Branch field      Matt, 2026-09-30: "suppliers' own staff do the
                           referring, so a supplier user has no branch."
                           `user_must_hold_a_position` returns early off
                           the estate for the same reason.
     the Position field    a position is an estate thing; on the supplier
                           rail `partner_id` IS the company boundary.

   =====================================================================
   AND DEVELOPER IS OFFERED ONLY WHERE THERE IS AN API TO DEVELOP AGAINST
   =====================================================================

   "plus Developer when API access is on". It is the same
   `apiAccessEnabled` the Integration tab switches and the Dev Centre
   panels are gated on, so the three cannot disagree: a Developer invited
   to a supplier with the API off would sign in to a Dev Centre that is
   not there.

   It is a convenience, not a boundary. The server decides who may hold
   the role; this only decides what is worth offering.
   ===================================================================== */
import { useState } from 'react';
import { inviteUser } from '@/data/usersService';
import type { Role } from '@/data/types';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SupplierLevelOptions, supplierLevelsFor } from './SupplierLevels';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

/* THE LEVELS COME FROM `SUPPLIER_LEVELS` in types.ts, beside the estate's
   AGENCY_LEVELS, and the (role, seesCommission) pair is read off the chosen
   entry rather than written here. `everyInviteSaysTheLevel.test.ts` requires
   that of every inviteUser call site, and it is right to: a hand-written
   pair is correct today and is exactly how a fourth combination gets
   invented. My first version wrote `seesCommission: false` inline and that
   rule caught it within the minute. */
export function SupplierInvite({
  partnerId, partnerName, apiAccessEnabled, onInvited,
}: {
  /** The slug, which is what inviteUser takes as `partner`. */
  partnerId: string;
  partnerName: string;
  apiAccessEnabled: boolean;
  onInvited: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<Role>('referrer');

  const levels = supplierLevelsFor(apiAccessEnabled);

  function openInvite() {
    setFirst(''); setLast(''); setEmail('');
    setLevel('referrer');
    setOpen(true);
  }

  async function send() {
    if (busy) return;
    const addr = email.trim();
    if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      toast('Enter a valid work email to invite.'); return;
    }
    /* THE LEVEL HAS TO BE ONE WE OFFERED. Turning API access off while
       this dialog is open would otherwise still send a Developer. */
    const chosen = levels.find((l) => l.role === level);
    if (!chosen) {
      toast('That level is not available for this supplier.'); return;
    }
    setBusy(true);
    try {
      await inviteUser({
        firstName: first.trim(),
        lastName: last.trim(),
        email: addr,
        /* THE PAIR, OFF THE ENTRY. `sees_commission` is the half that
           separates a Director from a Manager on OUR estate; the supplier
           rail has no such pair, and SUPPLIER_LEVELS says so once rather
           than every call site deciding again. */
        role: chosen.role,
        seesCommission: chosen.seesCommission,
        partner: partnerId,
        // No branch and no position: see the header.
        branch: '',
      });
      setOpen(false);
      onInvited();
      const what = chosen.level;
      toast(`Invitation sent to ${addr} as ${what} at ${partnerName}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the invitation.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={openInvite}>Invite someone</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        title={`Invite someone to ${partnerName}`}
        sub="They will be emailed a link to set a password. Their access level can be changed afterwards."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={send} arrow disabled={busy}>
              {busy ? 'Sending…' : 'Send invite'}
            </Button>
          </>
        )}
      >
        <div className="form-grid">
          <Field label="First name">
            <input type="text" placeholder="Jane" value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label="Last name">
            <input type="text" placeholder="Smith" value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
          <Field label="Work email" span2>
            <input type="email" placeholder="jane@example.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        {/* THE SHARED LIST. The change-role dialog offers the same three
            and reads the same descriptions; two copies is how an invite
            dialog and a change dialog come to disagree about what a
            Developer is. */}
        <SupplierLevelOptions value={level} onChange={setLevel} apiAccessEnabled={apiAccessEnabled} />
      </Modal>
    </>
  );
}
