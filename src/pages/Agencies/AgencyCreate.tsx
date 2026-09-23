/* =====================================================================
   AgencyCreate — the admin "Add agency" onboarding flow. Agencies are invite-only
   and created by Opndoor; this is the only way one gets onto the platform.

   Collects: agency name; first branch name + a postcode-looked-up address;
   commission (defaulted to the Opndoor standard, editable, as percentages); and an
   optional first invite (name, email, level: agency manager or branch manager). No
   group is created — the agency is independent until it grows. Creating with the
   invite sends it; without leaves the org empty with invite affordances on its tree.
   ===================================================================== */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createAgencyWithBranch, getRatesFor, inviteUser,
  lookupAddresses, addressLookupAvailable, type AddressOption,
} from '@/data';
import { useSession } from '@/session/SessionContext';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { fmtRatePct } from '@/lib/format';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// New agencies are agent-rail, under the direct house partner (never named).
const HOUSE = 'opndoor-agents';

export function AgencyCreate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const base = useMemo(() => getRatesFor(HOUSE), []);

  const [name, setName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [addrOptions, setAddrOptions] = useState<AddressOption[]>([]);
  const [addrLine, setAddrLine] = useState(''); // the chosen/typed address, stored as the branch area
  const [looking, setLooking] = useState(false);
  const [agentPct, setAgentPct] = useState(String(+(base.agent * 100).toFixed(2)));
  const [invFirst, setInvFirst] = useState('');
  const [invLast, setInvLast] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invLevel, setInvLevel] = useState<'agency' | 'branch'>('agency');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName(''); setBranchName(''); setPostcode(''); setAddrOptions([]); setAddrLine('');
    setAgentPct(String(+(base.agent * 100).toFixed(2)));
    setInvFirst(''); setInvLast(''); setInvEmail(''); setInvLevel('agency');
  };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const findAddress = async () => {
    if (!postcode.trim()) return;
    setLooking(true);
    try {
      const res = await lookupAddresses(postcode);
      setAddrOptions(res.addresses);
      if (!res.available) toast('Address lookup is not configured — enter the address manually.', 'error');
      else if (res.addresses.length === 0) toast('No addresses found for that postcode.', 'error');
    } finally { setLooking(false); }
  };

  const pctToFrac = (s: string): number | null => {
    const n = parseFloat(s.replace('%', '').trim());
    return isNaN(n) ? null : n / 100;
  };
  const validPct = (s: string) => { const n = parseFloat(s.replace('%', '').trim()); return !isNaN(n) && n >= 0 && n <= 100; };

  const emailOk = !invEmail.trim() || EMAIL_RE.test(invEmail.trim());
  const canSave = !!name.trim() && !!branchName.trim() && validPct(agentPct) && emailOk && !busy;

  const save = async () => {
    if (!canSave) { if (invEmail.trim() && !emailOk) toast('Enter a valid invite email, or clear it.', 'error'); return; }
    setBusy(true);
    try {
      // ONE rate: the agency commission (agent_rate). Store an override only when the
      // admin changed it from the standard; equal to standard means inherit (null).
      // partner_rate is left null — on the agent rail it is the house/Opndoor cut,
      // never paid to anyone and never overridden per agency.
      const aFrac = pctToFrac(agentPct);
      const agentRate = aFrac != null && Math.abs(aFrac - base.agent) > 1e-9 ? aFrac : null;
      const { agencyId, branchId } = await createAgencyWithBranch({
        agencyName: name.trim(), branchName: branchName.trim(),
        branchArea: addrLine.trim() || postcode.trim() || undefined,
        partnerRate: null, agentRate,
      });
      if (invEmail.trim()) {
        await inviteUser({
          firstName: invFirst.trim(), lastName: invLast.trim(), email: invEmail.trim(),
          role: 'management', partner: HOUSE,
          scopeKind: invLevel, scopeTarget: invLevel === 'agency' ? agencyId : branchId,
        });
        toast('Agency created and the first manager invited.', 'ok');
      } else {
        toast('Agency created.', 'ok');
      }
      // Re-hydrate so the new agency is in the working copy before we open its page.
      await refresh();
      reset();
      onClose();
      if (agencyId) navigate(`/agencies/${encodeURIComponent(agencyId)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the agency.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add agency"
      sub="Create a new agency and its first branch. Opndoor onboards agencies; there is no self-registration."
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} disabled={!canSave}>{busy ? 'Creating…' : 'Create agency'}</Button></>}
    >
      <Field label="Agency name" htmlFor="ac-name"><input id="ac-name" type="text" autoComplete="off" placeholder="e.g. Northgate Lettings" value={name} onChange={(e) => setName(e.target.value)} /></Field>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>First branch</div>
        <Field label="Branch name" htmlFor="ac-branch"><input id="ac-branch" type="text" autoComplete="off" placeholder="e.g. Leeds Central" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></Field>
        <Field label="Postcode" htmlFor="ac-postcode" hint={addressLookupAvailable() ? 'Look up the address, then pick it.' : 'Address lookup is off; type the address below.'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="ac-postcode" type="text" autoComplete="off" placeholder="e.g. LS1 5AB" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
            <Button variant="ghost" size="sm" onClick={findAddress} disabled={looking || !postcode.trim()}>{looking ? 'Finding…' : 'Find address'}</Button>
          </div>
        </Field>
        {addrOptions.length > 0 && (
          <Field label="Address" htmlFor="ac-addr">
            <select id="ac-addr" value={addrLine} onChange={(e) => setAddrLine(e.target.value)}>
              <option value="">Choose the address…</option>
              {addrOptions.map((o) => <option key={o.label} value={[o.line1, o.city, o.postcode].filter(Boolean).join(', ')}>{o.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Address (as stored)" htmlFor="ac-addrline" hint="Auto-filled from the picked address; editable."><input id="ac-addrline" type="text" autoComplete="off" placeholder="Line 1, City, Postcode" value={addrLine} onChange={(e) => setAddrLine(e.target.value)} /></Field>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Commission <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}>· default is the Opndoor standard ({fmtRatePct(base.agent)})</span></div>
        <Field label="Agency commission %" htmlFor="ac-agent" hint="This agency's share of the guarantee fee."><input id="ac-agent" inputMode="decimal" value={agentPct} onChange={(e) => setAgentPct(e.target.value)} /></Field>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>First invite <span style={{ fontWeight: 400, color: 'var(--ink-mute)' }}>(optional)</span></div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>Leave the email blank to create the agency empty; you can invite from its page later.</p>
        <div className="form-grid">
          <Field span2 label="Email" htmlFor="ac-inv-email"><input id="ac-inv-email" type="email" autoComplete="off" placeholder="manager@agency.co.uk" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} /></Field>
          <Field label="First name" htmlFor="ac-inv-first" hint="Optional"><input id="ac-inv-first" type="text" autoComplete="off" value={invFirst} onChange={(e) => setInvFirst(e.target.value)} /></Field>
          <Field label="Last name" htmlFor="ac-inv-last" hint="Optional"><input id="ac-inv-last" type="text" autoComplete="off" value={invLast} onChange={(e) => setInvLast(e.target.value)} /></Field>
          <Field span2 label="Level" htmlFor="ac-inv-level">
            <select id="ac-inv-level" value={invLevel} onChange={(e) => setInvLevel(e.target.value as 'agency' | 'branch')}>
              <option value="agency">Agency manager</option>
              <option value="branch">Branch manager</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
