/* =====================================================================
   AgencyGrow — the growth actions on an agency/group detail page.
   - "Add a branch": add a branch under one of the org's agencies.
   - "Add another agency": on an independent agency, this creates the group above
     ("Meridian Property Group") and re-parents the existing agency, then adds the
     new agency under it; on a group, it just adds the new agency to the group.
   No group is ever created up front for an independent — only when it grows.
   ===================================================================== */
import { useState } from 'react';
import {
  createBranchLive, createAgencyWithBranch, createAgencyGroup, setAgencyGroup,
  lookupAddresses, addressLookupAvailable, type Agency, type AgencyGroup, type AddressOption,
} from '@/data';
import { useSession } from '@/session/SessionContext';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { MissingFields } from '@/components/ui/MissingFields';
import { useMissingFields } from '@/lib/useMissingFields';

export function AgencyGrow({ mode, agencies, group, anchorAgencyId, onClose, onDone }: {
  mode: 'branch' | 'agency';
  agencies: Agency[];
  group?: AgencyGroup;
  /** The node this was launched from, so the modal can name the parent. */
  anchorAgencyId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  /* PRESSED, which is what turns "Required" on. A form that has not been
     submitted is not missing anything, it is being filled in. */
  const [tried, setTried] = useState(false);

  // add-branch fields
  const [branchAgencyId, setBranchAgencyId] = useState(anchorAgencyId ?? agencies[0]?.id ?? '');
  const [branchName, setBranchName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [addrOptions, setAddrOptions] = useState<AddressOption[]>([]);
  const [addrLine, setAddrLine] = useState('');
  const [looking, setLooking] = useState(false);

  // add-agency fields
  const [groupName, setGroupName] = useState(group?.name ?? '');
  const [newAgency, setNewAgency] = useState('');
  const [newBranch, setNewBranch] = useState('');

  /* THE CONTACT EMAIL, OPTIONAL. Matt, 2026-10-02, correcting himself the
     same day: "Opndoor's own agencies (like Regent): no email required.
     Signed deeds go to whoever sent the referral (plus the people already
     ticked to receive them, as now). The agency or a branch can optionally
     add an email that also receives the deed; leave it blank and nothing
     is missing."

     This modal only grows OUR OWN estate, so nothing here is required.
     Its shape is still checked, because a mistyped address that is saved
     is worse than one that is refused. */
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');

  const findAddress = async () => {
    if (!postcode.trim()) return;
    setLooking(true);
    try {
      const res = await lookupAddresses(postcode);
      setAddrOptions(res.addresses);
      if (!res.available) toast('Address lookup is not configured. Enter it manually.', 'error');
    } finally { setLooking(false); }
  };

  /* THE SENTENCE. Every creation modal opens by saying what it is making and
     where it is going, in full, including the group above when there is one. */
  const targetAgency = agencies.find((a) => a.id === branchAgencyId) ?? agencies[0];
  const sentence = mode === 'branch'
    ? `You're adding a branch to ${targetAgency?.name ?? 'this agency'}${group ? `, part of ${group.name}` : ''}.`
    : group
      ? `You're adding an agency to ${group.name}.`
      : `You're creating the group ${groupName.trim() || '…'} above ${agencies[0]?.name ?? 'this agency'}, moving it in, and adding a second agency alongside it.`;

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // Blank is fine; a typo is not.
  const emailUsable = !contactEmail.trim() || EMAIL_RE.test(contactEmail.trim());

  /* =====================================================================
     WHAT IS MISSING, AS A LIST, because the button no longer hides it.

     Matt, 2026-10-04: "enable the button, and on press with anything missing,
     scroll to the first missing field, mark each one, and show 'N things
     still need filling in' by the button."

     THE LIST IS WHY THE BUTTON AND THE FIELDS CANNOT DISAGREE. The old
     `canBranch` and `canAgency` were booleans with no voice: they knew the
     form was incomplete and could only express it by going grey, and nothing
     anywhere said which of twelve fields they were waiting for. Deriving the
     refusal FROM the list means a refused press always has at least one
     marked field to count and to jump to. A boolean beside a separate set of
     error props is the arrangement where a press can still do nothing,
     because the two can drift apart.

     THE EMAIL IS HERE BUT MARKS ITSELF LIVE, and that is deliberate. A typo
     is a fact about something already typed and is worth saying at once; a
     "Required" on a field the reader has not reached yet is a scold. Both
     stop the save, so both belong in this list; only one waits for a press.
     The count still waits, because useMissingFields reads nothing until
     `tried`. */
  const problems: { field: string; why: string }[] = [];
  if (mode === 'branch') {
    if (!branchName.trim()) problems.push({ field: 'ag-branch-name', why: 'Required' });
    /* ONLY WHERE THE READER CAN ANSWER IT. The agency picker is drawn only
       when there is a choice to make; where it is not drawn the value is
       already the anchor or the only agency, so a problem naming it would be
       one nobody could clear. */
    if (!branchAgencyId && agencies.length > 1 && !anchorAgencyId) {
      problems.push({ field: 'ag-branch-agency', why: 'Required' });
    }
    if (!emailUsable) problems.push({ field: 'ag-branch-email', why: 'That is not an email address.' });
  } else {
    if (!group && !groupName.trim()) problems.push({ field: 'ag-groupname', why: 'Required' });
    if (!newAgency.trim()) problems.push({ field: 'ag-newagency', why: 'Required' });
    if (!newBranch.trim()) problems.push({ field: 'ag-newbranch', why: 'Required' });
    if (!emailUsable) problems.push({ field: 'ag-agency-email', why: 'That is not an email address.' });
  }
  const problemFor = (field: string) => problems.find((p) => p.field === field)?.why;

  const missing = useMissingFields<HTMLDivElement>(tried);

  const saveBranch = async () => {
    if (busy) return;
    /* SAYS WHY NOT, rather than nothing. This is the whole change: the press
       now always does one of two things, and the one it does when the form is
       incomplete is visible. */
    if (problems.length) { setTried(true); missing.jump(); return; }
    const agency = agencies.find((a) => a.id === branchAgencyId);
    if (!agency) return;
    setBusy(true);
    try {
      await createBranchLive(agency, {
        name: branchName.trim(), area: addrLine.trim() || postcode.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined, contactName: contactName.trim() || undefined,
      });
      await refresh();
      toast('Branch added.', 'ok');
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not add the branch.', 'error'); }
    finally { setBusy(false); }
  };

  const saveAgency = async () => {
    if (busy) return;
    if (problems.length) { setTried(true); missing.jump(); return; }
    setBusy(true);
    try {
      const existing = agencies[0];
      const partner = group?.partner ?? existing?.partner ?? '';
      let groupId = group?.id;
      if (!groupId) {
        // Independent growing into a group: create the group above and re-parent
        // the existing agency into it, then add the new agency alongside.
        const g = await createAgencyGroup(partner, groupName.trim());
        groupId = g.id;
        if (existing?.id) await setAgencyGroup(existing.id, groupId);
      }
      const { agencyId } = await createAgencyWithBranch({
        agencyName: newAgency.trim(), branchName: newBranch.trim(),
        contactEmail: contactEmail.trim() || undefined, contactName: contactName.trim() || undefined,
      });
      if (agencyId && groupId) await setAgencyGroup(agencyId, groupId);
      await refresh();
      toast('Agency added to the group.', 'ok');
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not add the agency.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={mode === 'branch'
        ? `Add branch to ${targetAgency?.name ?? 'agency'}`
        : group ? `Add agency to ${group.name}` : 'Add another agency'}
      sub={sentence}
      /* `disabled={busy}` AND NOTHING ELSE. It used to be
         `disabled={!canBranch}`, which is the failure this is fixing: a
         control that cannot be pressed cannot report, so the reader was left
         to guess which field the form wanted. */
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <MissingFields count={missing.count} onJump={missing.jump} />
        <Button variant="primary" onClick={mode === 'branch' ? saveBranch : saveAgency} disabled={busy}>{busy ? 'Saving…' : mode === 'branch' ? 'Add branch' : 'Add agency'}</Button></>}
    >
      {/* A PLAIN WRAPPER CARRYING THE REF, so the count and the jump read
          this dialog's fields and not a form behind it. */}
      <div ref={missing.formRef}>
      {mode === 'branch' ? (
        <>
          {agencies.length > 1 && !anchorAgencyId && (
            <Field label="Agency" htmlFor="ag-branch-agency" error={tried ? problemFor('ag-branch-agency') : undefined}>
              <select id="ag-branch-agency" value={branchAgencyId} onChange={(e) => setBranchAgencyId(e.target.value)}>
                {agencies.filter((a) => a.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Branch name" htmlFor="ag-branch-name" error={tried ? problemFor('ag-branch-name') : undefined}><input id="ag-branch-name" type="text" autoComplete="off" placeholder="e.g. Headingley" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></Field>
          <Field label="Postcode" htmlFor="ag-postcode" hint={addressLookupAvailable() ? 'Look up the address, then pick it.' : 'Lookup off; type the address below.'}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="ag-postcode" type="text" autoComplete="off" placeholder="e.g. LS6 3AA" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
              <Button variant="ghost" size="sm" onClick={findAddress} disabled={looking || !postcode.trim()}>{looking ? 'Finding…' : 'Find address'}</Button>
            </div>
          </Field>
          {addrOptions.length > 0 && (
            <Field label="Address" htmlFor="ag-addr">
              <select id="ag-addr" value={addrLine} onChange={(e) => setAddrLine(e.target.value)}>
                <option value="">Choose the address…</option>
                {addrOptions.map((o) => <option key={o.label} value={[o.line1, o.city, o.postcode].filter(Boolean).join(', ')}>{o.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Address (as stored)" htmlFor="ag-addrline" hint="Editable."><input id="ag-addrline" type="text" autoComplete="off" value={addrLine} onChange={(e) => setAddrLine(e.target.value)} /></Field>
          <Field
            label="Contact email (optional)"
            htmlFor="ag-branch-email"
            hint={`Overrides ${targetAgency?.name ?? 'the agency'}'s address for this branch. Leave it blank and the agency's is used.`}
            error={!emailUsable ? 'That is not an email address.' : undefined}>
            <input id="ag-branch-email" type="email" autoComplete="off" placeholder="lettings@example.co.uk" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </Field>
          <Field label="Contact name (optional)" htmlFor="ag-branch-cname">
            <input id="ag-branch-cname" type="text" autoComplete="off" placeholder="e.g. Jane Smith" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
        </>
      ) : (
        <>
          {!group && (
            <Field label="Group name" htmlFor="ag-groupname" hint="The group that will sit above both agencies." error={tried ? problemFor('ag-groupname') : undefined}><input id="ag-groupname" type="text" autoComplete="off" placeholder="e.g. Example Property Group" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></Field>
          )}
          <Field label="New agency name" htmlFor="ag-newagency" error={tried ? problemFor('ag-newagency') : undefined}><input id="ag-newagency" type="text" autoComplete="off" placeholder="e.g. Example Lettings" value={newAgency} onChange={(e) => setNewAgency(e.target.value)} /></Field>
          <Field label="Its first branch" htmlFor="ag-newbranch" error={tried ? problemFor('ag-newbranch') : undefined}><input id="ag-newbranch" type="text" autoComplete="off" placeholder="e.g. City Centre" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} /></Field>
          <Field label="Contact email (optional)" htmlFor="ag-agency-email"
            hint="A signed deed also goes here, and the first branch uses it too. Leave it blank and the deed still reaches whoever sent the referral."
            error={!emailUsable ? 'That is not an email address.' : undefined}>
            <input id="ag-agency-email" type="email" autoComplete="off" placeholder="lettings@example.co.uk" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </Field>
          <Field label="Contact name (optional)" htmlFor="ag-agency-cname">
            <input id="ag-agency-cname" type="text" autoComplete="off" placeholder="e.g. Jane Smith" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
        </>
      )}
      </div>
    </Modal>
  );
}
