/* =====================================================================
   A REFUND LANDED ON COMMISSION WE HAD ALREADY STATEMENTED.

   Matt, 2026-10-01, verbatim: "Refund after a commission statement has
   been sent: when a refund lands on an application whose commission was
   already on a sent statement, raise an internal alert to Opndoor naming
   the payee, the statement reference and the commission affected. On that
   alert, Opndoor admin chooses, with a confirmation box: (a) reissue a
   corrected statement to the payee, or (b) carry the amount as a
   deduction line on the payee's next statement. Nothing happens
   automatically. Record who chose what and when."

   NOTHING HAPPENS AUTOMATICALLY, which is why there is a screen at all.
   The obvious build reverses the commission and moves on; a statement
   already sent is a document somebody may have invoiced against, and
   changing what it said without telling them is how a payee's books stop
   matching ours.

   THE TWO ANSWERS ARE NOT SYMMETRICAL, and the screen should not pretend
   they are. Deducting is quiet and reversible in effect: the money comes
   off a statement that has not been written yet, and the payee reads
   about it in plain words when it does. Reissuing sends a second document
   for a month the payee may already have invoiced for, and arrives
   without warning. So deducting leads, and reissue is the quieter
   control with the longer confirmation.

   WHY THE REISSUE IS TWO CALLS. decideRefundQuestion records the choice
   in the database; reissueCorrectedStatement sends the document. If the
   send fails the decision still stands and the row shows it as awaiting
   its document, which is recoverable. One call that did both would
   either lose the decision or send the statement twice.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  decideRefundQuestion, loadRefundQuestions, reissueCorrectedStatement,
  type RefundQuestion,
} from '@/data';
import { gbpPence, possessive } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Button } from '@/components/ui/Button';
import './NotInNetwork.css';
import { plural } from '@/lib/plural';

/** The payee's kind, in the reader's words. A payee_key level is a
    machine word and "partner" in particular is the wrong one on screen:
    on this rail a partner is a supplier. */
const LEVEL_WORD: Record<string, string> = {
  partner: 'Supplier',
  agency: 'Agency',
  group: 'Group',
  branch: 'Branch',
};

export function RefundQuestions({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [rows, setRows] = useState<RefundQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await loadRefundQuestions());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the refunded statement lines.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const after = async () => { await load(); onChanged?.(); };

  /* (b) CARRY IT. The confirmation says where the money will actually
     show up, because "deduct" on its own does not tell the reader that
     the payee will see a line about it on their next statement. */
  const carry = (r: RefundQuestion) => ask({
    title: 'Carry it onto the next statement',
    body: (
      <>
        Take <b>{gbpPence(r.commission)}</b> off <b>{r.payeeName}</b>&rsquo;s next statement,
        as a refund on <b>{r.guaranteeRef}</b>?
        {' '}Their next statement will show the deduction and name {r.statementReference}.
        {' '}The statement already sent is left exactly as it is.
      </>
    ),
    confirmLabel: 'Carry as a deduction',
    run: async () => {
      setBusy(true);
      try {
        await decideRefundQuestion(r.id, 'deduct');
        await after();
        // Same hand-rolled possessive as the statements card, same fix.
        toast(`${gbpPence(r.commission)} will come off ${possessive(r.payeeName)} next statement.`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not record that.', 'error');
      } finally { setBusy(false); }
    },
  });

  /* (a) REISSUE. The confirmation is longer because the action is louder:
     a second document for a month the payee may have invoiced for, sent
     the moment the box is confirmed. */
  const reissue = (r: RefundQuestion) => ask({
    title: 'Send a corrected statement',
    body: (
      <>
        Send <b>{r.payeeName}</b> a corrected statement for <b>{r.statementMonth}</b>, replacing{' '}
        <b>{r.statementReference}</b>?
        {' '}It goes out now, to their statement recipients, with its own reference and a note
        saying which document it replaces.
        {' '}If they have already invoiced against the old one, tell them.
      </>
    ),
    confirmLabel: 'Send corrected statement',
    run: async () => {
      setBusy(true);
      try {
        await decideRefundQuestion(r.id, 'reissue');
        const res = await reissueCorrectedStatement(r.id);
        await after();
        if (res.ok) {
          toast(`Corrected statement ${res.reference} sent to ${res.recipients} ${plural(res.recipients ?? 0, 'recipient')}.`);
        } else {
          /* THE DECISION STUCK AND THE DOCUMENT DID NOT. Said plainly,
             because the half-done state is the one a person has to act
             on and silence would leave them believing it was sent. */
          toast(`Recorded, but the statement did not go out: ${res.error}`, 'error');
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not record that.', 'error');
      } finally { setBusy(false); }
    },
  });

  if (loading) return <div className="empty is-shown">Loading.</div>;
  if (rows.length === 0) {
    return (
      <div className="empty is-shown">
        No refund has landed on commission we had already put on a statement. They appear here
        when one does, and nothing is changed until somebody decides what to do about it.
      </div>
    );
  }

  return (
    <div className="nin">
      <p className="nin__lede">
        These fees were refunded after we had already sent the payee a statement carrying the
        commission on them. Nothing has been changed. Choose, for each one, whether to send a
        corrected statement or to take the amount off the next one.
      </p>
      {rows.map((r) => (
        <section className="nin__card" key={r.id}>
          <div className="nin__head">
            <div>
              <h3 className="nin__name">{r.payeeName}</h3>
              <div className="nin__meta">
                {LEVEL_WORD[r.payeeLevel] ?? r.payeeLevel} · <b>{gbpPence(r.commission)}</b> on{' '}
                {r.guaranteeRef}
                {r.tenantName && <> ({r.tenantName})</>}
                {r.refundedAt && <> · refunded {r.refundedAt}</>}
              </div>
            </div>
            <div className="nin__acts">
              {/* DEDUCTING LEADS. It is the quieter of the two: the money
                  comes off a document nobody has seen yet. */}
              <Button variant="dark" size="sm" disabled={busy} onClick={() => carry(r)}>
                Carry as a deduction
              </Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => reissue(r)}>
                Reissue statement
              </Button>
            </div>
          </div>

          <dl className="nin__contact">
            <dt>Already sent on</dt><dd>{r.statementReference}</dd>
            <dt>Statement month</dt><dd>{r.statementMonth}</dd>
            <dt>Commission affected</dt><dd>{gbpPence(r.commission)}</dd>
          </dl>
        </section>
      ))}
      {confirmEl}
    </div>
  );
}
