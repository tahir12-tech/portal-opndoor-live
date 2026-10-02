/* =====================================================================
   "ADD EMAIL", WHERE THE GAP IS REPORTED.

   Matt, 2026-10-02: "Agencies tab: next to 'No agency email', an 'Add
   email' button that sets the agency's email in place, with a
   confirmation, recorded in Recent changes. Each branch's email can be
   added or changed the same way."

   IN PLACE, which is the word that shapes this. The contacts modal on
   the Agencies screen already does the full job -- name, role, phone,
   which one is primary -- and sending somebody there from here would be
   three clicks and a different screen to type one address into. So this
   is one field, inline, on the row that says the address is missing.

   ONE FIELD, AND THE REST DEFAULTED. A contact needs a name in SQL; an
   address typed here is the agency's own mailbox rather than a person,
   so the name defaults to the agency's. `is_primary` is true because
   the whole point is to be the one a deed resolves to.

   IT WRITES THROUGH THE SAME RPCs the modal uses, so the audit row, the
   one-primary rule and the reach check are all the ones that already
   exist. Nothing here is a second way to store a contact.
   ===================================================================== */
import { useState } from 'react';
import { addContactLive, updateContactLive, type Agency, type AgentContact, type Branch } from '@/data';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function AddContactEmail({ agency, branch, current, onSaved, label }: {
  agency: Agency;
  /** The branch this address belongs to, or null for the agency's own. */
  branch?: Branch | null;
  /** The contact being replaced, where there is one. */
  current?: AgentContact | null;
  onSaved: () => void;
  label?: string;
}) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(current?.email ?? '');
  const [busy, setBusy] = useState(false);

  const owner = branch ? branch.name : agency.name;
  const ok = EMAIL_RE.test(email.trim());

  const save = () => {
    const next = email.trim();
    ask({
      title: current ? `Change the email for ${owner}?` : `Set the email for ${owner}?`,
      /* WHAT IT ACTUALLY DOES, naming the thing that moves. An address on
         an agency is the default every one of its offices inherits, and
         saying so here is the difference between a field and a decision. */
      body: current
        ? <>Signed deeds for {owner} will go to <b>{next}</b> instead of <b>{current.email}</b>. It is recorded in Recent changes.</>
        : branch
          ? <>Signed deeds for {owner} will go to <b>{next}</b>, instead of the agency&rsquo;s address. It is recorded in Recent changes.</>
          : <>Signed deeds for {owner} will go to <b>{next}</b>, and every office of theirs without its own address will use it too. It is recorded in Recent changes.</>,
      confirmLabel: current ? 'Change email' : 'Set email',
      run: async () => {
        setBusy(true);
        try {
          const rec: AgentContact = {
            // The mailbox is the agency's, not a person's, so it is named
            // after whoever owns it rather than left blank.
            name: current?.name || owner,
            email: next,
            phone: current?.phone ?? '',
            role: current?.role ?? '',
            primary: true,
          };
          if (current) {
            /* THE INDEX IS MOCK MODE'S HANDLE and the id is live's;
               `updateContactLive` takes both and uses whichever its
               mode needs. The list it indexes into is the owner's own
               contacts, which is where `current` came from. */
            const list = (branch ? branch.contacts : agency.contacts) ?? [];
            const i = list.findIndex((c) => (c.id && current.id ? c.id === current.id : c.email === current.email));
            await updateContactLive(agency, branch ?? null, i < 0 ? 0 : i, current.id, rec);
          } else {
            await addContactLive(agency, branch ?? null, rec);
          }
          toast(`Email set for ${owner}.`, 'ok');
          setOpen(false);
          onSaved();
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not save the email.', 'error');
        } finally { setBusy(false); }
      },
    });
  };

  if (!open) {
    return (
      <>
        {confirmEl}
        <button type="button" className="ph-addemail" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
          <Icon name="mail" size={12} /> {label ?? (current ? 'Change email' : 'Add email')}
        </button>
      </>
    );
  }

  return (
    <>
      {confirmEl}
      <span className="ph-addemail__form" onClick={(e) => e.stopPropagation()}>
        <input
          type="email"
          autoComplete="off"
          autoFocus
          placeholder="lettings@agency.co.uk"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) save(); if (e.key === 'Escape') setOpen(false); }}
          aria-label={`Email for ${owner}`}
        />
        <Button variant="dark" size="sm" disabled={!ok || busy} onClick={save}>Save</Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      </span>
    </>
  );
}
