/* =====================================================================
   The step footer, and the three sections that were placeholders.

   THE BUTTON IS THE SAVE. Every step ends with one, it says what comes next by
   name, and pressing it writes that step and moves them on. Nothing saves behind
   them: typing only updates a local mirror, so a half-finished value never
   reaches a database that only accepts finished ones. A failed save is shown
   here against the step, and they press again.

   It never BLOCKS. Somebody who wants to skip ahead and come back can, and the
   footer says what is still outstanding rather than refusing. The only step
   that gates is the fee, and that gate is in SQL.
   ===================================================================== */
import { useContext, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import * as api from '@/tenant/tenantApi';
import { REQUIRED_BANK_STATEMENTS } from '@/tenant/formSpec';
import { RevealMissingContext } from './reveal';

export function StepFooter({
  done, nextLabel, onNext, onBack, outstanding, isLast, busy, saveError, onBlocked,
}: {
  done: boolean;
  nextLabel: string | null;
  onNext: () => void;
  onBack?: () => void;
  outstanding?: string;
  isLast?: boolean;
  busy?: boolean;
  saveError?: string | null;
  /** Pressed while blocked: the parent reveals and scrolls to the missing field. */
  onBlocked?: () => void;
}) {
  const blockerRef = useRef<HTMLDivElement>(null);
  // The button stays pressable while blocked (it is not a dead grey rectangle), but
  // a press does not proceed: it flashes the blocker here and asks the parent to
  // reveal and scroll to the missing field, so it is obvious why nothing happened.
  const press = () => {
    if (done) { onNext(); return; }
    const b = blockerRef.current;
    if (b) { b.classList.remove('is-flash'); void b.offsetWidth; b.classList.add('is-flash'); }
    onBlocked?.();
  };
  return (
    <div className="apfoot-wrap">
      {/* The reason you cannot continue is the prominent thing. Pressing the button
          while blocked flashes this and jumps to the field that still needs doing. */}
      {!done && outstanding && (
        <div className="apfoot__blocking" role="status" ref={blockerRef}>
          <Icon name="alert" strokeWidth={2.2} /> <span>{outstanding}</span>
        </div>
      )}
      <div className="apfoot">
        <div className="apfoot__left">
          {onBack && (
            <Button variant="quiet" onClick={onBack}><Icon name="arrowLeft" /> Back</Button>
          )}
        </div>
        <div className="apfoot__right">
          {nextLabel && (
            <Button variant="primary" arrow disabled={busy} aria-disabled={!done || undefined} onClick={press}>
              {busy ? 'Saving…' : nextLabel}
            </Button>
          )}
          {isLast && !nextLabel && (
            <span className="apfoot__note">Finish the sections above to send your application.</span>
          )}
        </div>
      </div>
      {saveError && (
        <div className="apfoot__blocking" role="alert">
          <Icon name="alert" strokeWidth={2.2} /> <span>{saveError} Press continue to try again.</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ID check and Financials.

   Both are REAL steps with a REAL manual path today, and a vendor path that is
   a named seam. The vendor sessions run on the referencing partner's own
   accounts under their credentials, which this repo does not hold, so the
   button that starts one cannot exist yet. What CAN exist is the alternative
   the process document already describes: uploading the evidence instead.

   So neither is a placeholder saying "coming soon". Each says what it is for,
   offers the path that works, and names the one that does not yet.
   --------------------------------------------------------------------------- */
/* The single switch for the ID scan. False until the partner's credentials are
   wired in: the Start button stays disabled, and on the send screen ID check
   shows as outstanding but does not gate Send. Flip it true and the button
   enables and ID check becomes a hard gate like the rest (wire idDone in Apply to
   the vendor's completion signal at the same time). One line, one behaviour change. */
export const ID_CHECK_ENABLED: boolean = false;

export function IdCheckPanel() {
  // Scan only. A photo of a passport uploaded as a file is not an identity check,
  // so there is no upload here and no id_document kind: the guided scan (document
  // plus liveness) is the single route. Anyone it will not work for reaches us by
  // hand, so paying does not leave them unable to finish.
  return (
    <Card>
      <CardHead title="ID check" sub="So we know you are you." />
      <CardBody>
        <p className="ap-p">
          We confirm your identity with a guided scan of your passport, driving licence or
          biometric residence permit, and a quick liveness check, on your phone.
        </p>

        {/* The guided scan is the only route, disabled until it is switched on. */}
        <div className="ap-actions">
          <Button variant="primary" disabled={!ID_CHECK_ENABLED}>Start the check</Button>
        </div>
        {!ID_CHECK_ENABLED && (
          <p className="soft">Not switched on yet. We will email you a link the moment it is.</p>
        )}

        {/* The fallback for anyone the scan cannot serve: reach a human, not a dead end. */}
        <p className="ap-p">
          No smartphone, or the scan will not work for you? Email{' '}
          <a href="mailto:hello@opndoor.co">hello@opndoor.co</a> and we will sort your ID
          another way. You have paid, and we will not leave you unable to finish.
        </p>
      </CardBody>
    </Card>
  );
}

export function FinancialsPanel({
  applicationId, documents, editable, onChanged,
}: {
  applicationId: string;
  documents: api.ApplicationBundle['documents'];
  editable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const statements = documents.filter((d) => d.kind === 'bank_statement');
  // A completed open-banking connection satisfies financials on its own. None is
  // produced yet (the button is off), so this is dormant until the vendor is wired.
  const connected = documents.some((d) => d.kind === 'bank_connection');
  const enough = statements.length >= REQUIRED_BANK_STATEMENTS;

  return (
    <Card>
      <CardHead title="Financials" sub="Showing the income you told us about is real." />
      <CardBody>
        <p className="ap-p">
          The quickest way is to connect your bank: we read your income straight from it, with
          nothing to upload.
        </p>

        {/* Primary route: the bank connection, shown but not switched on yet. */}
        <div className="ap-actions">
          <Button variant="primary" disabled>Connect your bank</Button>
        </div>
        <p className="soft">Not switched on yet. We will turn it on soon.</p>

        {/* Secondary route: three months of statements. */}
        <h3 className="ap-h3">Or send statements</h3>
        <div className={`ap-pre ${connected || enough ? 'ap-pre--ok' : 'ap-pre--wait'}`}>
          {connected
            ? <>Your bank is connected. Nothing else needed here.</>
            : enough
              ? <>You have uploaded {statements.length} statements. That is the three months we need.</>
              : <>You have uploaded {statements.length} of {REQUIRED_BANK_STATEMENTS}. Add a bank statement for each of the last three months, or connect your bank when it is on.</>}
        </div>
        {statements.length > 0 && (
          <ul className="apdoc">
            {statements.map((d) => (
              <li key={d.id} className="apdoc__item">
                <Icon name="file" />
                <div className="apdoc__txt">
                  <div className="apdoc__name">{d.filename}</div>
                  <div className="apdoc__meta">Bank statement</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {editable && !connected && (
          <>
            <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg"
              onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                setBusy(true);
                try { await api.uploadDocument(applicationId, 'bank_statement', f); onChanged(); }
                finally { setBusy(false); }
              }} />
            <div className="ap-actions">
              <Button variant="quiet" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /> {busy ? 'Uploading…' : 'Upload a bank statement'}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* A document uploaded through the real Documents flow (a kind + label) rather
   than a dead kind:'file' form field, which never rendered a control. Used for
   proof of address on the address step and for the income supporting documents
   (bank statement, tax returns, P60), so both go to storage and show in the
   Documents tab. */
export function DocUpload({
  applicationId, documents, kind, label, editable, onChanged, link,
}: {
  applicationId: string;
  documents: { id: string; kind: string; filename: string; income_id?: string | null; address_id?: string | null }[];
  kind: string;
  label: string;
  editable: boolean;
  onChanged: () => void;
  link?: { income_id?: string | null; address_id?: string | null };
}) {
  // Scoped to this row when a link is given, so one income's bank statement does
  // not appear under another.
  const mine = documents.filter((d) => d.kind === kind
    && (!link?.income_id || d.income_id === link.income_id)
    && (!link?.address_id || d.address_id === link.address_id));
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="ap-proof">
      {mine.length > 0 && (
        <ul className="apdoc">
          {mine.map((d) => (
            <li key={d.id} className="apdoc__item">
              <Icon name="file" />
              <div className="apdoc__txt">
                <div className="apdoc__name">{d.filename}</div>
                <div className="apdoc__meta">{label}</div>
              </div>
              {editable && (
                <Button variant="quiet" size="sm"
                  onClick={async () => { await api.deleteDocument(applicationId, d.id); onChanged(); }}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <>
          <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg"
            onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              setBusy(true);
              try { await api.uploadDocument(applicationId, kind, f, link); onChanged(); }
              finally { setBusy(false); }
            }} />
          <div className="ap-actions">
            <Button variant="quiet" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> {busy ? 'Uploading…' : mine.length ? 'Upload another' : `Upload ${label.toLowerCase()}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* Proof of address on the address step: a REQUIRED file, given the full field
   treatment (caps label, asterisk, helper, a bordered dropzone with drag and
   drop, and empty/uploading/uploaded/error states). It reuses api.uploadDocument
   like every other upload, so the file goes to storage and shows in the Documents
   tab. One per address, scoped to that address, and required on every one. Kept
   separate from DocUpload, which stays the plain button the income documents use. */
const PROOF_MAX_BYTES = 10 * 1024 * 1024;
const PROOF_OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function proofSizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Client-side gate so wrong type or over-size is named before an upload starts. */
function proofProblem(file: File): string | null {
  const typeOk = PROOF_OK_TYPES.includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name);
  if (!typeOk) return 'That is not a PDF, JPG or PNG. Choose one of those.';
  if (file.size > PROOF_MAX_BYTES) return 'That file is over 10MB. Choose a smaller PDF, JPG or PNG.';
  return null;
}

export function ProofUpload({
  applicationId, documents, addressId, ensureId, editable, onChanged,
}: {
  applicationId: string;
  documents: { id: string; kind: string; filename: string; bytes: number | null; address_id: string | null }[];
  /** The saved address this proof belongs to, or null until the row has an id. */
  addressId: string | null;
  /** Saves the address row if needed and returns its id, so the file is stored
      against this address even before the step is submitted. */
  ensureId: () => Promise<string | null>;
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const reveal = useContext(RevealMissingContext);
  // Scoped to this address, so one address's proof never shows under another. A
  // row with no id yet can have no stored proof.
  const mine = addressId
    ? documents.filter((d) => d.kind === 'proof_of_address' && d.address_id === addressId)
    : [];
  const current = mine[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const take = async (file: File | undefined) => {
    if (!file) return;
    const problem = proofProblem(file);
    if (problem) { setErr(problem); return; }
    setErr(null); setBusy(true);
    try {
      // The file is stored against its address, so save the row first if it has no
      // id yet, then scope the upload to it.
      const aid = addressId ?? await ensureId();
      // Without an address to hang it on, an upload would not count and would strand
      // the tenant behind a disabled Continue. Surface it instead of uploading blind.
      if (!aid) throw new Error('Could not save this address just now. Try again.');
      // Upload BEFORE removing any previous proof, so a mid-replace failure can never
      // leave the address with no proof at all (mine is normally empty here anyway).
      await api.uploadDocument(applicationId, 'proof_of_address', file, { address_id: aid });
      for (const d of mine) await api.deleteDocument(applicationId, d.id);
      // Awaited so the control stays in its uploading state through the reload.
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload that. Try again.');
    } finally { setBusy(false); }
  };

  // A required field, kept as a small link (the "which proof" dropdown above labels
  // the pair as a required section). After a blocked Continue with no proof for this
  // address, it names why here too, not only in the footer.
  const shownErr = err ?? (reveal && !current ? 'Upload a proof of address to continue.' : null);

  return (
    <div className={`ap-proof${shownErr ? ' is-invalid' : ''}`}>
      {current && (
        <ul className="apdoc">
          <li className="apdoc__item">
            <Icon name="file" />
            <div className="apdoc__txt">
              <div className="apdoc__name">{current.filename}</div>
              <div className="apdoc__meta">{current.bytes ? `${proofSizeLabel(current.bytes)} · ` : ''}Proof of address</div>
            </div>
            {editable && (
              <Button variant="quiet" size="sm"
                onClick={async () => { await api.deleteDocument(applicationId, current.id); await onChanged(); }}>
                Remove
              </Button>
            )}
          </li>
        </ul>
      )}
      {editable && !current && (
        <>
          <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void take(f); }} />
          <div className="ap-actions">
            <Button variant="quiet" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> {busy ? 'Uploading…' : 'Upload proof of address'}
            </Button>
          </div>
        </>
      )}
      {shownErr && <p className="field-error" role="alert">{shownErr}</p>}
    </div>
  );
}
