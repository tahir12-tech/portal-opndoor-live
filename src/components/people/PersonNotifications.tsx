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
  EMPTY_PANEL, getPersonPanel, setPersonEvent, setPersonInternal,
  turnOffAllNotifications, whoDecidesThis, whoDecidesCopies,
  type InternalRow, type PersonPanel,
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
  /* IS THERE ANYBODY ABOVE THE READER IN THEIR OWN ESTATE? Matt (qq): when
     the subject is a peer the viewer cannot change, naming Management as the
     decider is wrong, because the viewer IS Management.

     A PROP RATHER THAN useSession, and the tests are why. Reading the
     session in here made a presentational dialog depend on a provider, and
     fourteen render tests that had never needed one broke at once. The
     callers are pages; they already hold the session and the question is
     about the reader, not about this dialog. */
  viewerIsTop?: boolean;
  onClose: () => void;
}

export function PersonNotifications({ userId, personName, viewerIsTop = false, onClose }: PersonNotificationsProps) {
  const toast = useToast();
  const [panel, setPanel] = useState<PersonPanel>(EMPTY_PANEL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /* OFFERED ONLY WHERE THERE IS SOMETHING TO TURN OFF. A reader who may
     not change any of this person's settings gets no button, rather than
     one that fails; and a panel whose every switchable row is already off
     has nothing for it to do. */
  const canTurnOffAll = (panel.mayEditEvents || panel.mayEditCopied || panel.mayEditStatements)
    && (panel.events.some((e) => !e.lockReason && e.enabled) || panel.copiedOn || panel.statementsOn);

  const turnOffAll = async () => {
    setBusy(true);
    try {
      const n = await turnOffAllNotifications(userId);
      await load();
      toast(n === 0
        ? 'There was nothing left to switch off.'
        : `${n === 1 ? '1 notification' : `${n} notifications`} switched off. The two that cannot be are still on.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not switch these off.');
    } finally {
      setBusy(false);
    }
  };

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
      footer={
        <>
          {/* TURN OFF ALL, and it says how many. Matt (ap) item 2 asks for
              the switch; the two locked rows are why it cannot simply
              report success. A control called "Turn off all" that leaves
              two on without saying so is lying about what it did, so the
              toast gives the count and the locked rows stay visible with
              their reasons beside them. */}
          {canTurnOffAll && (
            <Button variant="ghost" onClick={() => void turnOffAll()} disabled={busy}>
              {busy ? 'Working…' : 'Turn off all'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
        </>
      }
    >
      {loading ? <p className="soft">Loading…</p> : failed ? <p className="soft">{failed}</p> : (
        <div className="pn">
          {/* THE RULES, IN PLAIN ENGLISH, ONCE AT THE TOP. Matt (ap) item 4:
              "Explain these rules in plain English in each Notifications
              dialog."

              THE DIALOG WAS A LIST OF SWITCHES WITH NO STATED POLICY, so a
              reader could see that two boxes were locked and not know why,
              or what the default was for the rest. Both of those are rules
              rather than properties of a box, and a reason printed beside
              one checkbox cannot say "everything else is on by default".

              THE TWO THAT CAN NEVER BE SWITCHED OFF ARE NAMED HERE, not
              only where they are locked: somebody reading this to decide
              what to turn off needs to know the floor before they start,
              and "the signed deed always reaches the agency it is for" is
              the one that would otherwise look like a bug when it keeps
              arriving. */}
          <section className="pn__sec pn__rules">
            <h4 className="pn__h">How these work</h4>
            <ul className="pn__rulelist">
              <li>Everything here is <b>on by default</b>. Switch off anything this person does not want, including their copy of the signed deed.</li>
              <li>Two things can never be switched off: <b>account emails</b> (invites, password resets, two-factor), and <b>delivery of the signed deed to the agency it is for</b>, which goes to the office or agency email whatever anybody here has set.</li>
              <li>These settings only cover referrals this person can already see. Switching something on does not widen what they have access to.</li>
            </ul>
          </section>
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
                  <span className="pn__locked">{whoDecidesCopies(panel.partyKind, viewerIsTop)}</span>
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
                  <span className="pn__locked">{whoDecidesThis(panel.partyKind, viewerIsTop)}</span>
                )}
              </label>
            </section>
          )}

          {/* OPNDOOR'S OWN ALERTS, in the four groups the old Internal
              notifications page had. Matt, 2026-09-30: "for an Opndoor
              staff member it shows only Opndoor's internal alerts (the
              ones the old Internal notifications page listed), grouped
              Critical, Operations, Commercial, Information, each
              switchable per person".

              THE GROUPS COME FROM THE SERVER, in catalogue order, and are
              not a list written here: `ops_notification_types()` owns
              which alert sits in which group, and a second copy would
              eventually disagree with the one the alerts are actually
              routed by. */}
          {panel.partyKind === 'opndoor' && groupsOf(panel.internal).map(([group, rows]) => (
            <section className="pn__sec" key={group}>
              <h4 className="pn__h">{group}</h4>
              {group === 'Critical' && (
                <p className="pn__note">
                  A critical alert can never be left with nobody. The last person receiving one cannot switch it off.
                </p>
              )}
              <ul className="pn__list">
                {rows.map((a) => (
                  <li key={a.type} className="pn__row pn__row--ev">
                    <input
                      type="checkbox"
                      aria-label={a.label}
                      checked={a.enabled}
                      disabled={!!a.lockReason || !panel.mayEditInternal || busy}
                      onChange={(ev) => void run(() => setPersonInternal(userId, a.type, ev.target.checked))}
                    />
                    <span className="pn__lbl">{a.label}</span>
                    {/* THE REASON, BESIDE THE BOX. Item 9's complaint,
                        and Matt's again: "explained beside any box that
                        can't be unticked". */}
                    {a.lockReason && <span className="pn__locked">{a.lockReason}</span>}
                    {!a.lockReason && !panel.mayEditInternal && (
                      <span className="pn__locked">Only Opndoor admin changes internal alert routing.</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {/* THE AGENCY SECTIONS ARE NOT DRAWN FOR OPNDOOR AT ALL. "It
              must not show the agency sections". The server returns no
              events for an Opndoor person, so this is the belt to that
              brace and, more usefully, the place a reader finds out
              why. */}
          {panel.partyKind !== 'opndoor' && (
          <section className="pn__sec">
            <h4 className="pn__h">Events they are told about</h4>
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
          )}
        </div>
      )}
    </Modal>
  );
}

/** The alerts in catalogue order, split into their groups, first seen
    first. Not sorted here: `ops_notification_types()` returns them in the
    order the page should read, and re-sorting would be a second opinion
    about it. */
function groupsOf(rows: InternalRow[]): [string, InternalRow[]][] {
  const out: [string, InternalRow[]][] = [];
  for (const r of rows) {
    const found = out.find(([g]) => g === r.group);
    if (found) found[1].push(r);
    else out.push([r.group, [r]]);
  }
  return out;
}
