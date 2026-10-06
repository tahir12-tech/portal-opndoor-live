/* =====================================================================
   CONFIRM — one way to ask "are you sure", for the whole product.

   WALK FIX 23, Matt verbatim: "'Set branch' and 'Not in network' act
   immediately. Both need a confirmation box first, saying in plain English
   what will happen (for example 'Link this tenant's agent to Foo Lettings,
   Foo Central?'). Apply the same rule to any other admin action that
   changes records in one click."

   WHY A COMPONENT RATHER THAN A THIRD HAND-ROLLED DIALOG. `Modal` is the
   shared scrim and it is good. What sits on top of it is not shared at
   all: EIGHT screens each keep their own state object and rebuild the same
   footer, in four different vocabularies -- `{title, body, confirmLabel,
   danger, success, run}` in UserManagement, the same minus two in
   DevCentre, the same plus `blocking` and `refreshAfter` in OrgManagement,
   and `{line, cta, run, done}` in Team. Two of those files already have a
   comment about it. PartnerHome's says it plainly: "which is how the two
   action sets already in the product came to disagree about confirmation."

   THE EIGHT INCUMBENTS ARE DELIBERATELY NOT CONVERTED HERE. Landing the
   component and rewriting eight screens in one diff touches
   UserManagement, Team, Help, OrgManagement, DevCentre, PartnerManagement,
   AgreementEditor and Sandbox at once, which is the kind of change nobody
   can review. This lands the component and the new confirmations use it;
   the incumbents move one page per commit afterwards.

   THE SENTENCE MUST NAME THE RECORD. Matt's example is "Link this tenant's
   agent to Foo Lettings, Foo Central?" -- not "Are you sure?". A
   confirmation that does not say which record it is about is the same
   click with an extra step in front of it, and it trains people to press
   through. So `body` takes a node and callers build it from the row.
   ===================================================================== */
import { useCallback, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmSpec {
  title: ReactNode;
  /** What will actually happen, in plain English, naming the record. */
  body: ReactNode;
  /** The affirmative button. Says the ACTION, never "OK" or "Confirm". */
  confirmLabel: string;
  /** Destructive or hard to undo: the affirmative button goes red. */
  danger?: boolean;
  /** The work. Any throw is left to the caller's own toast, as before. */
  run: () => void | Promise<void>;
}

/**
 * ONE CONFIRMATION AT A TIME, per page.
 *
 * Returns `ask` to raise one and the element to render. A page holds no
 * state slot, no runner and no footer of its own: `ask({...})` is the
 * whole of it at the call site.
 */
export function useConfirm(): { ask: (spec: ConfirmSpec) => void; confirmEl: ReactNode } {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((s: ConfirmSpec) => setSpec(s), []);

  const close = useCallback(() => { if (!busy) setSpec(null); }, [busy]);

  const go = useCallback(async () => {
    if (!spec || busy) return;
    setBusy(true);
    try {
      await spec.run();
      setSpec(null);
    } finally {
      /* CLEARED EVEN ON A THROW, so a failed action does not leave the
         dialog stuck with its button disabled and no way out but Escape.
         The dialog STAYS OPEN on a throw, deliberately: the caller's toast
         explains what went wrong, and closing the dialog underneath it
         would leave the reader unsure whether the thing had happened. */
      setBusy(false);
    }
  }, [spec, busy]);

  const confirmEl = spec ? (
    <Modal
      open
      onClose={close}
      title={spec.title}
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button
            variant={spec.danger ? 'primary' : 'dark'}
            size="sm"
            className={spec.danger ? 'btn--danger' : undefined}
            onClick={() => void go()}
            disabled={busy}
          >
            {busy ? 'Working…' : spec.confirmLabel}
          </Button>
        </>
      )}
    >
      <p className="confirm__body">{spec.body}</p>
    </Modal>
  ) : null;

  return { ask, confirmEl };
}
