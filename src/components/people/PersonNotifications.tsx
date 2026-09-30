/* =====================================================================
   ONE PERSON'S NOTIFICATIONS. The same panel on all three parties.

   Walk fixes 9, 10 and 12. Reached from a person's row, like permissions,
   and it replaces three different screens:

     the Internal notifications page   (a grid of every type x every person)
     the agency People tab             (two tickbox columns + a separate grid)
     the supplier People tab           (the same grid)

   WHAT ITEM 9 WAS ACTUALLY COMPLAINING ABOUT. "Headings run into their
   labels", "the description is repeated", "it isn't clear whose
   notifications you are changing", "ticked boxes can't be unticked and
   nothing says why". Every one of those is a consequence of the same thing:
   a grid of everybody at once has no subject, so it cannot say whose
   settings these are, and it has nowhere to put a reason. A panel with one
   person's name at the top has a subject, and a locked row has room for its
   own sentence beside it.

   THE PARTY-WIDE WARNING IS LOAD-BEARING. On the agency and supplier rails
   the event switches belong to the PARTY, not the person, because that is
   how the server stores them. Drawn without saying so, a Director would
   change one person's panel and silently change every colleague's. It is
   said once above the list rather than on every row, which is what
   `anyPartyWide` is for.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  buildPersonPanel, type PartyKind, type PersonPanel,
} from '@/data/personNotifications';
import {
  getNotificationMatrix, mayEditNotificationMatrix, setNotificationSetting, type Party,
} from '@/data/notificationMatrixService';
import { getOpsRoutingMatrix, setOpsRoute } from '@/data/opsRoutingService';
import {
  COMMISSION_STATEMENT_LABEL, COMMISSION_STATEMENT_NOTE, NOTIFY_LABEL, NOTIFY_NOTE,
  getCommissionStatementTicks, getNotificationTicks,
  setReceivesCommissionStatements, setReceivesNotifications,
} from '@/data/positionsService';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import './PersonNotifications.css';

export interface PersonNotificationsProps {
  party: PartyKind;
  /** The party's ids, for the matrix. Not used on Opndoor. */
  partyRef?: Party;
  userId: string;
  personName: string;
  /** The party's display name, so the party-wide warning can name it. */
  partyName?: string;
  canEdit: boolean;
  onClose: () => void;
}

const EMPTY: PersonPanel = { copied: null, statements: null, events: [], anyPartyWide: false };

export function PersonNotifications(p: PersonNotificationsProps) {
  const toast = useToast();
  const [panel, setPanel] = useState<PersonPanel>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mayEditEvents, setMayEditEvents] = useState(false);

  const load = useCallback(async () => {
    try {
      const ops = p.party === 'opndoor' ? await getOpsRoutingMatrix() : [];
      const matrix = p.party === 'opndoor' || !p.partyRef ? [] : await getNotificationMatrix(p.partyRef);
      const [notify, statements] = await Promise.all([
        getNotificationTicks([p.userId]),
        getCommissionStatementTicks([p.userId]),
      ]);
      setMayEditEvents(
        p.party === 'opndoor' ? p.canEdit
        : p.partyRef ? await mayEditNotificationMatrix(p.partyRef) : false,
      );
      setPanel(buildPersonPanel({
        party: p.party,
        userId: p.userId,
        copiedOnReferrals: notify[p.userId] ?? null,
        getsStatements: statements[p.userId] ?? null,
        ops,
        matrix,
      }));
    } catch {
      setPanel(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [p.party, p.partyRef, p.userId, p.canEdit]);

  useEffect(() => { void load(); }, [load]);

  /* RELOADED RATHER THAN PATCHED after every write. Turning one alert off
     changes the LIVE COUNT of its type, which is what decides whether the
     remaining rows are locked -- so patching one row in place would leave
     the others showing a stale lock. This is the same reason the page it
     replaces reloaded. */
  const flipEvent = async (type: string, recipient: string | null, on: boolean) => {
    setBusy(true);
    try {
      if (p.party === 'opndoor') await setOpsRoute(type, 'person', p.userId, on);
      else if (p.partyRef && recipient) await setNotificationSetting(p.partyRef, type, recipient, on);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally { setBusy(false); }
  };

  const flipTick = async (which: 'copied' | 'statements', on: boolean) => {
    setBusy(true);
    try {
      if (which === 'copied') await setReceivesNotifications(p.userId, on);
      else await setReceivesCommissionStatements(p.userId, on);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) p.onClose(); }}
      title={`Notifications for ${p.personName}`}
      sub="What this person is emailed. Everything here is about them alone unless a line says otherwise."
      footer={<Button variant="ghost" onClick={p.onClose} disabled={busy}>Close</Button>}
    >
      {loading ? <p className="soft">Loading…</p> : (
        <div className="pn">
          {p.party === 'agency' && panel.copied && (
            <section className="pn__sec">
              <h4 className="pn__h">Copied on referrals</h4>
              <p className="pn__note">{NOTIFY_NOTE}</p>
              <label className="pn__row">
                <input
                  type="checkbox"
                  aria-label={NOTIFY_LABEL}
                  checked={panel.copied.on}
                  disabled={!p.canEdit || busy}
                  onChange={(e) => void flipTick('copied', e.target.checked)}
                />
                <span>{NOTIFY_LABEL}</span>
              </label>
            </section>
          )}

          {panel.statements && (
            <section className="pn__sec">
              <h4 className="pn__h">Monthly statements</h4>
              <p className="pn__note">{COMMISSION_STATEMENT_NOTE}</p>
              <label className="pn__row">
                <input
                  type="checkbox"
                  aria-label={COMMISSION_STATEMENT_LABEL}
                  checked={panel.statements.on}
                  disabled={!p.canEdit || busy}
                  onChange={(e) => void flipTick('statements', e.target.checked)}
                />
                <span>{COMMISSION_STATEMENT_LABEL}</span>
              </label>
            </section>
          )}

          <section className="pn__sec">
            <h4 className="pn__h">
              {p.party === 'opndoor' ? 'Internal alerts they receive' : 'Events they are told about'}
            </h4>
            {/* SAID ONCE, ABOVE THE LIST. Not on every row, which is how the
                screen this replaces ended up repeating its own description. */}
            {panel.anyPartyWide && (
              <p className="pn__warn" role="note">
                These are {p.partyName ? `${p.partyName}'s` : "the whole company's"} settings, not
                this person's. Changing one changes it for everyone here.
              </p>
            )}
            {panel.events.length === 0 && <p className="soft">Nothing to show.</p>}
            <ul className="pn__list">
              {panel.events.map((e) => (
                <li key={`${e.type}:${e.recipient ?? 'self'}`} className="pn__row pn__row--ev">
                  <input
                    type="checkbox"
                    aria-label={e.recipient ? `${e.label} to ${e.recipient}` : e.label}
                    checked={e.on}
                    disabled={!!e.locked || !mayEditEvents || busy}
                    onChange={(ev) => void flipEvent(e.type, e.recipient, ev.target.checked)}
                  />
                  <span className="pn__lbl">{e.label}</span>
                  {/* THE REASON, BESIDE THE BOX. Item 9: "ticked boxes can't
                      be unticked and nothing says why". */}
                  {e.locked && <span className="pn__locked">{e.locked}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
