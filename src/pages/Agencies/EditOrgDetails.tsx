/* CORRECTING AN AGENCY'S OR OFFICE'S OWN DETAILS.
 *
 * Matt: "Supplier Management (not Referrers) can edit their own agencies'
 * and offices' name, address and email, from the agency's Overview: an
 * 'Edit' button, the same duplicate-name check as adding, a confirmation
 * for email changes ('Signed deeds will go to...'), recorded in Recent
 * changes with who did it."
 *
 * ONE DIALOG FOR BOTH, because the three fields and the three rules are the
 * same; what differs is which RPC answers and what a cleared email means.
 * Two dialogs would be two places for the confirmation wording to drift.
 *
 * THE DUPLICATE CHECK IS THE SERVER'S, not a second copy here. It already
 * exists for adding and knows the scope each name is unique within -- an
 * agency within its PARTNER, an office within its AGENCY -- and a client
 * copy would be a third opinion on a question the database settles.
 */
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { setAgencyDetails, setBranchDetails } from '@/data';

export interface EditOrgTarget {
  level: 'agency' | 'branch';
  id: string;
  name: string;
  address?: string | null;
  email?: string | null;
}

export function EditOrgDetails({ target, onClose, onSaved }: {
  target: EditOrgTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [address, setAddress] = useState(target.address ?? '');
  const [email, setEmail] = useState(target.email ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);

  const what = target.level === 'agency' ? 'agency' : 'office';
  const was = (target.email ?? '').trim().toLowerCase();
  const now = email.trim().toLowerCase();
  const emailChanged = was !== now;

  const save = async () => {
    /* THE CONFIRMATION IS FOR THE EMAIL ALONE, because it is the only one of
       the three that changes where a legal document goes. A name or an
       address is a correction; the email is a redirection, and somebody
       typing it has to be told what they have just redirected. */
    if (emailChanged && !confirming) { setConfirming(true); return; }
    setBusy(true); setErr('');
    try {
      if (target.level === 'agency') await setAgencyDetails(target.id, name, address, email);
      else await setBranchDetails(target.id, name, address, email);
      onSaved();
      onClose();
    } catch (e) {
      // The server's own words: the duplicate-name message and the
      // supplier-must-keep-an-email message are both written for a reader.
      setErr(e instanceof Error ? e.message : `Could not save the ${what}.`);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <Modal
        open
        onClose={() => { if (!busy) setConfirming(false); }}
        width={460}
        title={`Change where signed deeds go?`}
        sub={now
          ? `Signed deeds for ${target.name} will go to ${email.trim()} from now on. Deeds already delivered are not affected.`
          : target.level === 'branch'
            ? `This office will no longer have its own email, so signed deeds for it will go to the agency's address instead.`
            : `Signed deeds for ${target.name} will have no address to go to.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save and redirect deeds'}
            </Button>
          </>
        }
      >
        {err && <p className="soft" style={{ color: 'var(--danger)' }}>{err}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      width={460}
      title={`Edit ${target.name}`}
      sub={target.level === 'agency'
        ? 'Their name, address and the email signed deeds go to.'
        : 'This office’s name, address and its own email. Leave the email blank to use the agency’s.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          {/* PRESSABLE WITH A FIELD EMPTY, so the refusal can be read. The
              house rule since 2026-10-03: a button that does nothing is
              worse than one that explains itself. */}
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={target.level === 'agency' ? 'Agency name' : 'Office name'} span2>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Address" span2>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" placeholder="Street, town, postcode" />
        </Field>
        <Field label={target.level === 'agency' ? 'Email for signed deeds' : 'Office email (optional)'} span2>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      {err && <p className="soft" style={{ color: 'var(--danger)' }}>{err}</p>}
    </Modal>
  );
}
