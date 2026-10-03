/* =====================================================================
   CHANGING A SUPPLIER PERSON'S ROLE, ON THE PAGE THEY ARE ON.

   Matt, 2026-10-01, verbatim: 'Supplier People tab: "Change role" opens
   the role dialog right here (Management, Referrer, Developer), instead
   of a message pointing to the Users page.'

   WHAT IT REPLACED: `onChangeLevel={() => toast('Change a supplier
   user's role from Users.')}`. A button that tells you where the button
   is. It is the same fault the Users and Manage buttons came off the
   suppliers list for a week ago, and it survived because the People tab
   was built by wiring up `PersonActions`, whose other six callbacks all
   do their job -- one no-op in a row of working controls does not look
   like anything.

   THE THREE LEVELS COME FROM `SUPPLIER_LEVELS`, through the same
   component the invite dialog uses, so the two cannot describe a
   Developer differently. Developer appears only where API access is on.

   AND THE LADDER IS THE SERVER'S. `admin_update_user_role` decides who
   may change whom; this dialog decides what is worth offering. A
   refusal comes back as its own sentence rather than being pre-empted
   here, because the one thing worse than a refused change is a control
   that quietly offers less than the rules allow.
   ===================================================================== */
import { useState } from 'react';
import { updateUserRole } from '@/data/usersService';
import type { Role } from '@/data/types';
import { Button } from '@/components/ui/Button';
import { levelChangeAsk } from '@/components/people/personConfirm';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { SupplierLevelOptions, supplierLevelsFor } from './SupplierLevels';
import { possessive } from '@/lib/format';

export function SupplierRoleDialog({
  user, apiAccessEnabled, onClose, onSaved,
}: {
  user: { userId: string; name: string; current: Role };
  apiAccessEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(user.current);
  const [busy, setBusy] = useState(false);

  const levels = supplierLevelsFor(apiAccessEnabled);
  const chosen = levels.find((l) => l.role === role);
  /* THE CURRENT ROLE MAY NOT BE ON OFFER -- a Developer at a supplier
     whose API access was switched off afterwards. Saving an unchanged
     role is then impossible, which is right: there is nothing to save.
     Changing them to one of the two that ARE offered still works. */
  const unchanged = role === user.current;

  async function save() {
    if (busy || unchanged || !chosen) return;
    setBusy(true);
    try {
      await updateUserRole(user.userId, role);
      toast(`${user.name} is now ${chosen.level}.`);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that role.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={`Change ${possessive(user.name)} role`}
      sub="It applies immediately. They see the change the next time the page loads."
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} arrow disabled={busy || unchanged || !chosen}>
            {busy ? 'Saving…' : 'Change role'}
          </Button>
        </>
      )}
    >
      <SupplierLevelOptions value={role} onChange={setRole} apiAccessEnabled={apiAccessEnabled} />
      {/* OLD AND NEW, both named. Matt, 2026-10-03: "Change level (show old
          and new level)." The dialog named the person and the levels on
          offer; what it never said is which one they are leaving. Same
          sentence as the agency ladder's, from personConfirm, with "role"
          as the word this rail uses (decision D11). */}
      {!unchanged && chosen && (() => {
        const was = levels.find((l) => l.role === user.current);
        const q = levelChangeAsk(user.name, was?.level ?? user.current, chosen.level, 'role');
        return <p className="ph-note soft"><b>{q.title}</b> {q.body}</p>;
      })()}
      {!chosen && (
        /* THEY HOLD A ROLE THE SUPPLIER CAN NO LONGER GRANT. Said
           plainly: the alternative is a dialog with nothing selected and
           no explanation. */
        <p className="ph-note muted">
          They are a Developer, and this supplier no longer has API access. Choose another role, or
          turn API access back on from the Integration tab.
        </p>
      )}
    </Modal>
  );
}
