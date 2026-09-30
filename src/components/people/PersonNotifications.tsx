/* =====================================================================
   ONE PERSON'S NOTIFICATIONS. The same panel on all three parties.

   Walk fixes 9, 10 and 12. Reached from a person's row, like permissions,
   replacing three screens: the Internal notifications page, the agency
   People tab's two tickbox columns plus its "Who is told what" grid, and
   the same grid on the supplier page.

   WHAT ITEM 9 WAS ACTUALLY COMPLAINING ABOUT. "Headings run into their
   labels", "the description is repeated", "it isn't clear whose
   notifications you are changing", "ticked boxes can't be unticked and
   nothing says why". Every one of those follows from the same thing: a grid
   of everybody at once has no subject, so it cannot say whose settings
   these are and has nowhere to put a reason. A panel with one person's name
   at the top has a subject, and a locked row has room for its own sentence.

   THE SERVER DECIDES WHAT MAY BE CHANGED, per section, and this file only
   draws it. The three settings have three different rules and a screen that
   re-derived them would eventually disagree with the server -- presenting
   as a control that looks live, accepts a click and throws.

   AND "DOES THIS APPLY" IS NOT "MAY YOU CHANGE IT". A Negotiator's level
   cannot receive a commission statement, so that section is absent rather
   than disabled: a greyed control implies somebody could switch it on.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_PANEL, getPersonPanel, setPersonEvent, type PersonPanel,
} from '@/data/personNotifications';
import {
  COMMISSION_STATEMENT_LABEL, COMMISSION_STATEMENT_NOTE, NOTIFY_LABEL, NOTIFY_NOTE,
  setReceivesCommissionStatements, setReceivesNotifications,
} from '@/data/positionsService';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import './PersonNotifications.css';

export interface PersonNotificationsProps {
  userId: string;
  /** Used only until the panel loads, so the title is right immediately. */
  personName: string;
  onClose: () => void;
}

export function PersonNotifications({ userId, personName, onClose }: PersonNotificationsProps) {
  const toast = useToast();
  const [panel, setPanel] = useState<PersonPanel>(EMPTY_PANEL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPanel(await getPersonPanel(userId));
      setFailed(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not load this person’s notifications.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  /* RELOADED RATHER THAN PATCHED after every write. The server decides what
     is locked and what may be changed, and a write can move either -- so
     patching one row in place would leave the rest of the panel describing
     a state that no longer exists. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not change that.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={`Notifications for ${panel.name || personName}`}
      sub="What this person is emailed, for the referrals they can already see."
      footer={<Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>}
    >
      {loading ? <p className="soft">Loading…</p> : failed ? <p className="soft">{failed}</p> : (
        <div className="pn">
          {panel.copiedApplies && (
            <section className="pn__sec">
              <h4 className="pn__h">Copied on colleagues’ referrals</h4>
              <p className="pn__note">{NOTIFY_NOTE}</p>
              <label className="pn__row">
                <input
                  type="checkbox"
                  aria-label={NOTIFY_LABEL}
                  checked={panel.copiedOn}
                  disabled={!panel.mayEditCopied || busy}
                  onChange={(e) => void run(() => setReceivesNotifications(userId, e.target.checked))}
                />
                <span className="pn__lbl">{NOTIFY_LABEL}</span>
                {/* SAID WHERE THE CONTROL IS. A disabled box with no
                    explanation is the thing item 9 objected to. */}
                {!panel.mayEditCopied && (
                  <span className="pn__locked">A Director decides who is copied in.</span>
                )}
              </label>
            </section>
          )}

          {panel.statementsApply && (
            <section className="pn__sec">
              <h4 className="pn__h">Monthly statements</h4>
              <p className="pn__note">{COMMISSION_STATEMENT_NOTE}</p>
              <label className="pn__row">
                <input
                  type="checkbox"
                  aria-label={COMMISSION_STATEMENT_LABEL}
                  checked={panel.statementsOn}
                  disabled={!panel.mayEditStatements || busy}
                  onChange={(e) => void run(() => setReceivesCommissionStatements(userId, e.target.checked))}
                />
                <span className="pn__lbl">{COMMISSION_STATEMENT_LABEL}</span>
                {!panel.mayEditStatements && (
                  <span className="pn__locked">A Director, or Opndoor, decides this.</span>
                )}
              </label>
            </section>
          )}

          <section className="pn__sec">
            <h4 className="pn__h">
              {panel.partyKind === 'opndoor' ? 'Internal alerts they receive' : 'Events they are told about'}
            </h4>
            {panel.events.length === 0 && <p className="soft">Nothing to show.</p>}
            <ul className="pn__list">
              {panel.events.map((e) => (
                <li key={e.type} className="pn__row pn__row--ev">
                  <input
                    type="checkbox"
                    aria-label={e.label}
                    checked={e.enabled}
                    disabled={!!e.lockReason || !panel.mayEditEvents || busy}
                    onChange={(ev) => void run(() => setPersonEvent(userId, e.type, ev.target.checked))}
                  />
                  <span className="pn__lbl">{e.label}</span>
                  {/* ITEM 9: "ticked boxes can't be unticked and nothing
                      says why". The reason, beside the box. */}
                  {e.lockReason && <span className="pn__locked">{e.lockReason}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
