/* =====================================================================
   WHERE OPNDOOR'S INVOICES GO. THE SETTING, AND THE PLACE IT LIVES.

   Matt, 2026-10-01: "The invoice email is not hardcoded and has no
   default: make it a setting Opndoor admin fills in. Until it's set,
   don't send statements; show a clear warning on Home and Health saying
   the invoice email needs setting. Tell me where the setting lives."
   Then: "Invoice email: default it to accounts@opndoor.co, as a setting
   Opndoor admin can change later. No warning needed while it's set."

   IT LIVES HERE: Health, under Settings. Health is where the things that
   stop a scheduled job from running are already shown, and an unset
   invoice address stops the monthly statement run dead. Putting it on a
   settings page of its own would separate the switch from the one screen
   that says what happens when it is off.

   THE SENTENCE IT FILLS IN IS SHOWN, not described. "Please send an
   invoice to opndoor for £2,572.50, quoting statement reference
   STMT-..., to accounts@opndoor.co" is what a payee reads, and an admin
   changing the address should see the line they are changing rather
   than guess at it from a field label.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { getInvoiceEmail, setInvoiceEmail, type InvoiceEmailSetting } from '@/data';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDate } from '@/lib/format';

export function InvoiceEmailCard({ onChanged }: { onChanged?: (set: boolean) => void }) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [setting, setSetting] = useState<InvoiceEmailSetting | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getInvoiceEmail();
      setSetting(s);
      setDraft(s.email ?? '');
      onChanged?.(s.email != null);
    } catch {
      /* A READ THAT FAILS IS NOT AN EMPTY SETTING. Saying "not set" here
         because the select errored would tell an admin to fill in a field
         that is already filled in, and the warning beside it would be
         about nothing. The card shows its own failure instead. */
      setSetting(null);
    }
  }, [onChanged]);

  useEffect(() => { void load(); }, [load]);

  const dirty = setting != null && draft.trim() !== (setting.email ?? '');

  const save = () => {
    const next = draft.trim();
    ask({
      /* CLEARING IT IS THE LOUD CASE, and it gets the louder box: with no
         address the monthly run posts nothing at all, which is a thing to
         do deliberately and not by emptying a field. */
      title: next ? 'Change the invoice address' : 'Clear the invoice address',
      body: next
        ? (<>Statements will tell every payee to send their invoice to <b>{next}</b>.
            {' '}It appears on the email, the PDF and the CSV, from the next statement onwards.</>)
        : (<>With no invoice address, <b>no statement can be posted at all</b>: the monthly run
            refuses rather than sending a statement that cannot say where to invoice.
            {' '}Home and Health will both warn until it is set again.</>),
      confirmLabel: next ? 'Save address' : 'Clear it',
      run: async () => {
        setBusy(true);
        try {
          await setInvoiceEmail(next);
          await load();
          toast(next ? `Invoices will be sent to ${next}.` : 'Invoice address cleared. No statement can be posted.');
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not save that.', 'error');
        } finally { setBusy(false); }
      },
    });
  };

  return (
    <Card style={{ marginBottom: 18 }}>
      <CardHead
        title="Settings"
        sub="Where payees are told to send their invoice. It appears on every commission statement."
      />
      <CardBody>
        {setting == null ? (
          <p className="ie-note muted">Could not read the setting. It has not been changed.</p>
        ) : (
          <>
            <label htmlFor="inv-email" className="ie-label">Invoice email</label>
            <div className="ie-row">
              <input
                id="inv-email"
                className="inp"
                type="email"
                value={draft}
                placeholder="accounts@opndoor.co"
                disabled={busy}
                aria-label="Invoice email"
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button variant="dark" size="sm" disabled={busy || !dirty} onClick={save}>
                Save
              </Button>
              {dirty && (
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => setDraft(setting.email ?? '')}>
                  Cancel
                </Button>
              )}
            </div>

            {/* THE LINE THEY ARE EDITING, as a payee will read it. */}
            <p className="ie-note muted">
              {setting.email ? (
                <>
                  On every statement: &ldquo;Please send an invoice to opndoor for [total], quoting
                  statement reference [reference], to <b>{setting.email}</b>, including your bank
                  details. Invoices received by the 8th are paid by the 15th.&rdquo;
                </>
              ) : (
                <>
                  <Icon name="alert" size={13} /> Not set, so no statement can be posted. The monthly
                  run refuses rather than sending a statement that cannot say where to invoice.
                </>
              )}
            </p>
            {setting.changedBy && (
              <p className="ie-by muted">
                Last changed by {setting.changedBy}
                {setting.changedAt && <> on {formatDate(setting.changedAt)}</>}.
              </p>
            )}
          </>
        )}
      </CardBody>
      {confirmEl}
    </Card>
  );
}
