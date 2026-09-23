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

export function AgencyGrow({ mode, agencies, group, onClose, onDone }: {
  mode: 'branch' | 'agency';
  agencies: Agency[];
  group?: AgencyGroup;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);

  // add-branch fields
  const [branchAgencyId, setBranchAgencyId] = useState(agencies[0]?.id ?? '');
  const [branchName, setBranchName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [addrOptions, setAddrOptions] = useState<AddressOption[]>([]);
  const [addrLine, setAddrLine] = useState('');
  const [looking, setLooking] = useState(false);

  // add-agency fields
  const [groupName, setGroupName] = useState(group?.name ?? '');
  const [newAgency, setNewAgency] = useState('');
  const [newBranch, setNewBranch] = useState('');

  const findAddress = async () => {
    if (!postcode.trim()) return;
    setLooking(true);
    try {
      const res = await lookupAddresses(postcode);
      setAddrOptions(res.addresses);
      if (!res.available) toast('Address lookup is not configured — enter it manually.', 'error');
    } finally { setLooking(false); }
  };

  const canBranch = mode === 'branch' && !!branchName.trim() && !!branchAgencyId && !busy;
  const canAgency = mode === 'agency' && !!newAgency.trim() && !!newBranch.trim() && (group ? true : !!groupName.trim()) && !busy;

  const saveBranch = async () => {
    if (!canBranch) return;
    const agency = agencies.find((a) => a.id === branchAgencyId);
    if (!agency) return;
    setBusy(true);
    try {
      await createBranchLive(agency, { name: branchName.trim(), area: addrLine.trim() || postcode.trim() || undefined });
      await refresh();
      toast('Branch added.', 'ok');
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not add the branch.', 'error'); }
    finally { setBusy(false); }
  };

  const saveAgency = async () => {
    if (!canAgency) return;
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
      const { agencyId } = await createAgencyWithBranch({ agencyName: newAgency.trim(), branchName: newBranch.trim() });
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
      title={mode === 'branch' ? 'Add a branch' : group ? 'Add an agency to the group' : 'Add another agency'}
      sub={mode === 'branch'
        ? 'Add a branch under this organisation.'
        : group ? 'Add a new agency to this group.' : 'This creates the group above and moves the existing agency into it.'}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={mode === 'branch' ? saveBranch : saveAgency} disabled={mode === 'branch' ? !canBranch : !canAgency}>{busy ? 'Saving…' : mode === 'branch' ? 'Add branch' : 'Add agency'}</Button></>}
    >
      {mode === 'branch' ? (
        <>
          {agencies.length > 1 && (
            <Field label="Agency" htmlFor="ag-branch-agency">
              <select id="ag-branch-agency" value={branchAgencyId} onChange={(e) => setBranchAgencyId(e.target.value)}>
                {agencies.filter((a) => a.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Branch name" htmlFor="ag-branch-name"><input id="ag-branch-name" type="text" autoComplete="off" placeholder="e.g. Headingley" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></Field>
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
        </>
      ) : (
        <>
          {!group && (
            <Field label="Group name" htmlFor="ag-groupname" hint="The group that will sit above both agencies."><input id="ag-groupname" type="text" autoComplete="off" placeholder="e.g. Meridian Property Group" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></Field>
          )}
          <Field label="New agency name" htmlFor="ag-newagency"><input id="ag-newagency" type="text" autoComplete="off" placeholder="e.g. Southbank Residential" value={newAgency} onChange={(e) => setNewAgency(e.target.value)} /></Field>
          <Field label="Its first branch" htmlFor="ag-newbranch"><input id="ag-newbranch" type="text" autoComplete="off" placeholder="e.g. City Centre" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} /></Field>
        </>
      )}
    </Modal>
  );
}
