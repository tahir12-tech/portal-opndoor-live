/* =====================================================================
   ADD AN AGENCY, OR A BRANCH, IN THIS SUPPLIER'S ESTATE.

   Matt, 2026-10-02: "an 'Add agency' button (name, address, agency
   email required) and, on each agency, 'Add branch' (name, address,
   email optional; it uses the agency email if blank). Both create the
   agency or branch in this supplier's estate, never in Opndoor's."

   THE ESTATE IS THE SENTENCE WITH TEETH, and it is not enforced here.
   `admin_create_agency_and_branch` takes the slug and
   `admin_add_branch` takes the agency, so what lands where is decided
   by the arguments this dialog passes, and the agency email is required
   or not by `is_supplier_estate` inside the function rather than by
   this form. The form asks for it because a server error on the last
   step is a worse way to learn than a field.

   THE ADDRESS BECOMES THE OFFICE, which is how the Add agency wizard
   has worked since 2026-10-01: Matt's own "that becomes its office
   behind the scenes, never shown separately". A new agency gets one
   office named after it, carrying the address that was typed, so a
   single-office agency renders as nothing extra.
   ===================================================================== */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAgencyWithBranch, createBranchLive, getAgencies, type Agency } from '@/data';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/session/SessionContext';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SupplierAddOrg({ mode, partnerSlug, partnerName, agency, onClose, onDone, onUseExisting }: {
  mode: 'agency' | 'branch';
  partnerSlug: string;
  partnerName: string;
  /** The agency a branch is going under. Unused when adding an agency. */
  agency?: Agency | null;
  onClose: () => void;
  /** Saved. The name that was created, for a caller that has to select it. */
  onDone: (name: string) => void;
  /* USE THE ONE THEY ALREADY HAVE, WHERE THERE IS SOMEWHERE TO USE IT.

     Matt, 2026-10-03: "It's checked against that supplier's existing agencies
     and offices first (case-insensitive), offering 'Use [existing] instead?'
     rather than creating a duplicate."

     A LINK IS THE WRONG OFFER ON A REFERRAL FORM, which is why this is a prop
     and not a second copy of the dialog. On the Agencies page "Open it
     instead?" is exactly right: the reader came to manage agencies and the
     existing one is where the managing happens. On the New application form
     the reader is halfway through a referral, and navigating to the agency
     page throws it away -- so there the offer SELECTS the existing one in the
     form behind this dialog and closes. Same check, same sentence, and the
     verb follows where the reader is. */
  onUseExisting?: (name: string) => void;
}) {
  const toast = useToast();
  const { refresh, dataVersion } = useSession();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  /* =====================================================================
     THE REAL REASON, NEXT TO THE NAME.

     Matt, 2026-10-03: "adding an agency whose name already exists in that
     supplier's estate (e.g. 'Frost Partnership' under Kestrel) fails with
     the generic 'Something went wrong saving that change.' Show the real
     reason inside the form, next to the name: 'Kestrel Lettings already
     has an agency called Frost Partnership. Open it instead?' with a link
     to it."

     CHECKED HERE AS WELL AS AT THE SERVER, which is not belt-and-braces
     for its own sake: the server's sentence arrives after a round trip and
     as a toast, and the reader is looking at the field. This answers while
     they type. 20261007720000 is the one that cannot be bypassed -- two
     admins adding the same name at once reach the constraint, not this.

     CASE-INSENSITIVE, matching the server's check rather than the raw
     unique index: an estate holding "Frost Partnership" and "frost
     partnership" is the mistake this message exists to prevent. */
  /* AND THE SAME CHECK ON AN OFFICE, which this did not have. Matt's sentence
     names both -- "checked against that supplier's existing agencies AND
     offices" -- and the office was the half that mattered more in practice: a
     supplier referring through "Mayfair" twice in a week is the likeliest
     duplicate in the whole estate, and the unique index that catches a
     duplicate AGENCY name has no twin on branches, so there was nothing
     downstream to catch it either.

     WITHIN THIS AGENCY, not across the estate: two agencies in one supplier's
     book may each have a Mayfair office, and they are different offices. */
  const existing: { name: string; id?: string } | null = useMemo(() => {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    if (mode === 'agency') {
      return getAgencies(partnerSlug).find((a) => a.name.trim().toLowerCase() === n) ?? null;
    }
    const br = (agency?.branches ?? []).find((b) => b.name.trim().toLowerCase() === n);
    return br ? { name: br.name, id: br.id } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, name, partnerSlug, agency, dataVersion]);

  const alreadyHas = existing
    ? mode === 'agency'
      ? `${partnerName} already has an agency called ${existing.name}.`
      : `${agency?.name ?? 'This agency'} already has an office called ${existing.name}.`
    : '';

  const nameError = existing ? (
    <>
      {alreadyHas}{' '}
      {onUseExisting ? (
        <button type="button" className="ah-linkbtn" onClick={() => onUseExisting(existing.name)}>
          Use {existing.name} instead?
        </button>
      ) : mode === 'agency' ? (
        <Link to={`/agencies/${encodeURIComponent(existing.id ?? existing.name)}`}>Open it instead?</Link>
      ) : null}
    </>
  ) : undefined;

  const emailGiven = !!email.trim();
  const emailShaped = !emailGiven || EMAIL_RE.test(email.trim());
  // Required for an agency in a supplier's estate; optional for a branch,
  // which falls back to the agency's.
  const emailOk = mode === 'agency' ? (emailGiven && emailShaped) : emailShaped;
  const can = !!name.trim() && !!address.trim() && emailOk && !busy && !existing;

  const save = async () => {
    if (!can) return;
    setBusy(true);
    try {
      if (mode === 'agency') {
        await createAgencyWithBranch({
          agencyName: name.trim(),
          // The office is named after the agency and carries the address.
          branchName: name.trim(),
          branchArea: address.trim(),
          contactEmail: email.trim(),
          partnerSlug,
        });
        toast(`${name.trim()} added to ${partnerName}.`, 'ok');
      } else {
        if (!agency) throw new Error('No agency to add a branch to.');
        await createBranchLive(agency, {
          name: name.trim(),
          area: address.trim(),
          contactEmail: email.trim() || undefined,
        });
        toast(`${name.trim()} added to ${agency.name}.`, 'ok');
      }
      await refresh();
      onDone(name.trim());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={mode === 'agency' ? `Add an agency to ${partnerName}` : `Add a branch to ${agency?.name ?? 'this agency'}`}
      sub={mode === 'agency'
        ? `It belongs to ${partnerName}. It will not appear on Opndoor's own Agencies list, and it never has logins.`
        : `It belongs to ${partnerName}, under ${agency?.name ?? 'this agency'}.`}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!can}>
          {busy ? 'Saving…' : mode === 'agency' ? 'Add agency' : 'Add branch'}
        </Button>
      </>}
    >
      <Field label={mode === 'agency' ? 'Agency name' : 'Branch name'} htmlFor="sao-name"
        error={nameError}>
        <input id="sao-name" type="text" autoComplete="off" autoFocus
          placeholder={mode === 'agency' ? 'e.g. Example Lettings' : 'e.g. Mayfair'}
          value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Address" htmlFor="sao-addr"
        hint={mode === 'agency' ? 'Where they work from. This becomes their office.' : 'Where this office is.'}>
        <input id="sao-addr" type="text" autoComplete="off"
          placeholder="e.g. 14 Mount Street, London W1K 3NG"
          value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>

      <Field
        label={mode === 'agency' ? 'Agency email' : 'Branch email (optional)'}
        htmlFor="sao-email"
        hint={mode === 'agency'
          ? 'Where a signed deed goes. Every office of theirs uses it unless it has its own.'
          : `Leave it blank to use ${agency?.name ?? 'the agency'}’s address.`}
        error={emailGiven && !emailShaped ? 'That is not an email address.' : undefined}>
        <input id="sao-email" type="email" autoComplete="off"
          placeholder="lettings@example.co.uk"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
    </Modal>
  );
}
