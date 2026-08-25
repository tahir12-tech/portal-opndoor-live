/* =====================================================================
   The step footer, and the three sections that were placeholders.

   WHY A BUTTON ON EVERY STEP WHEN IT AUTOSAVES ANYWAY.
   Because autosave is invisible. A section with nothing to press reads as
   unfinished no matter how many times a badge says "Saved": people have been
   trained by twenty years of forms that you are not done until you press
   something. So every step ends with one, it says what comes next by name, and
   pressing it flushes the save and moves them on. The saving was never the
   problem; the absence of an ending was.

   It never BLOCKS. Somebody who wants to skip ahead and come back can, and the
   footer says what is still outstanding rather than refusing. The only step
   that gates is the fee, and that gate is in SQL.
   ===================================================================== */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import * as api from '@/tenant/tenantApi';

export function StepFooter({
  done, nextLabel, onNext, onBack, outstanding, isLast, busy,
}: {
  done: boolean;
  nextLabel: string | null;
  onNext: () => void;
  onBack?: () => void;
  outstanding?: string;
  isLast?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="apfoot-wrap">
      {/* The reason you cannot continue is the prominent thing, not grey text
          beside a live button. The button is disabled until the step is done,
          so it cannot be pressed into a save that will bounce. */}
      {!done && outstanding && (
        <div className="apfoot__blocking" role="status">
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
            <Button variant="primary" arrow disabled={busy || !done} onClick={onNext}>
              {busy ? 'Saving…' : nextLabel}
            </Button>
          )}
          {isLast && !nextLabel && (
            <span className="apfoot__note">Finish the sections above to send your application.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Documents. The only one of the three that is fully live today, because the
   storage, the upload path and the index all exist.
   --------------------------------------------------------------------------- */
const DOC_LABELS: Record<string, string> = {
  bank_statement: 'Bank statement',
  proof_of_address: 'Proof of address',
  p60_or_pension_award: 'P60 or pension award letter',
  tax_return: 'Tax return',
  other_upload: 'Other document',
  reference_report: 'Eligibility report',
  summary_report: 'Summary report',
  review_summary_report: 'Review summary',
  provider_signature: 'Signature',
};

export function DocumentsPanel({
  applicationId, documents, editable, onChanged,
}: {
  applicationId: string;
  documents: api.ApplicationBundle['documents'];
  editable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = documents.filter((d) => !['reference_report', 'summary_report', 'review_summary_report', 'provider_signature'].includes(d.kind));
  const theirs = documents.filter((d) => !mine.includes(d));

  const upload = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      await api.uploadDocument(applicationId, 'other_upload', file);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload that.');
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHead title="Documents" sub="Everything you have sent us, and anything still outstanding." />
      <CardBody>
        {err && <div className="ap-alert" role="alert">{err}</div>}

        {mine.length === 0 ? (
          <p className="ap-p">
            Nothing yet. Documents you attach on the Income and Address steps appear here,
            and you can add anything else below.
          </p>
        ) : (
          <ul className="apdoc">
            {mine.map((d) => (
              <li key={d.id} className="apdoc__item">
                <Icon name="file" />
                <div className="apdoc__txt">
                  <div className="apdoc__name">{d.filename}</div>
                  <div className="apdoc__meta">
                    {DOC_LABELS[d.kind] ?? d.kind}
                    {d.bytes ? ` · ${Math.max(1, Math.round(d.bytes / 1024))} KB` : ''}
                  </div>
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
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            <div className="ap-actions">
              <Button variant="quiet" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /> {busy ? 'Uploading…' : 'Add a document'}
              </Button>
            </div>
          </>
        )}

        {theirs.length > 0 && (
          <>
            <h3 className="ap-h3">From your eligibility check</h3>
            <ul className="apdoc">
              {theirs.map((d) => (
                <li key={d.id} className="apdoc__item">
                  <Icon name="file" />
                  <div className="apdoc__txt">
                    <div className="apdoc__name">{DOC_LABELS[d.kind] ?? d.kind}</div>
                    <div className="apdoc__meta">Held on your file</div>
                  </div>
                </li>
              ))}
            </ul>
            {/* Deliberately not downloadable here. These are the provider's
                reports about the applicant and releasing them is a decision
                nobody has made; the row proves they exist. */}
            <p className="soft">Ask us if you need a copy of any of these.</p>
          </>
        )}
      </CardBody>
    </Card>
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
export function IdCheckPanel({
  applicationId, documents, editable, onChanged,
}: {
  applicationId: string;
  documents: api.ApplicationBundle['documents'];
  editable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const has = documents.some((d) => d.kind === 'other_upload');

  return (
    <Card>
      <CardHead title="ID check" sub="So we know you are you." />
      <CardBody>
        <p className="ap-p">
          We confirm your identity from a photo of your passport, driving licence or
          biometric residence permit.
        </p>
        <div className={`ap-pre ${has ? 'ap-pre--ok' : 'ap-pre--wait'}`}>
          {has
            ? <>You have uploaded identity documents. We will come back to you if anything else is needed.</>
            : <>The guided check on your phone is not switched on yet. In the meantime, upload a clear
               photo of your ID here and we will do it manually.</>}
        </div>
        {editable && (
          <>
            <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg"
              onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                setBusy(true);
                try { await api.uploadDocument(applicationId, 'other_upload', f); onChanged(); }
                finally { setBusy(false); }
              }} />
            <div className="ap-actions">
              <Button variant="quiet" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /> {busy ? 'Uploading…' : 'Upload a photo of my ID'}
              </Button>
            </div>
          </>
        )}
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

  return (
    <Card>
      <CardHead title="Financials" sub="Showing the income you told us about is real." />
      <CardBody>
        <p className="ap-p">
          We need to see the income on your application. The quickest way is to connect your
          bank securely, read-only, so there is nothing to find and nothing to upload.
        </p>
        <div className={`ap-pre ${statements.length ? 'ap-pre--ok' : 'ap-pre--wait'}`}>
          {statements.length
            ? <>You have uploaded {statements.length} statement{statements.length === 1 ? '' : 's'}. That is enough for now.</>
            : <>Connecting your bank is not switched on yet. Upload a recent bank statement instead
               and it does the same job.</>}
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
        {editable && (
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
