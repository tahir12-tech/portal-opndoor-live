/* =====================================================================
   MOVING SOMEBODY BETWEEN THE THREE LEVELS.

   Lifted out of Team.tsx, unchanged in behaviour, because Q-06 item G puts
   the same control on the admin /users screen and item A puts it on the
   supplier detail page's People tab. Three copies of a dialog that grants
   capability is three places for the ladder to be spelled differently.

   TWO THINGS IT DOES THAT A NAIVE VERSION WOULD NOT.

   It offers `levelsGrantableBy(actor)` rather than all three: you cannot
   grant a level you do not hold, so a Manager is never shown Director. That
   is the client half of the ladder; SQL refuses it either way
   (set_agency_level), and the lens exists so the refusal is not the first
   time anybody hears about it.

   And it filters out the level the person already holds, because "change
   level" to the level they are on is not a change, and an option that does
   nothing reads as a bug.

   THE WRITE IS ONE RPC. set_agency_level moves `role` and `sees_commission`
   together, which is the whole reason it exists: they are one fact about a
   person stored in two columns, and anything that writes one without the
   other can make a Director who cannot see commission.
   ===================================================================== */
// Walk fix 19: the possessive is formed in one place.
import { possessive } from '@/lib/format';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { levelsGrantableBy, setAgencyLevel, type Actor, type AgencyLevel } from '@/data';

/** "a Director" / "a Manager" / "a Negotiator", so the sentence reads. */
const withArticle = (l: AgencyLevel) => `a ${l}`;

export function ChangeLevelModal({
  actor, person, onClose, onDone, onError,
}: {
  actor: Actor;
  person: { id: string; name: string; current: string };
  onClose: () => void;
  /** Called with the toast line to show, so the host page keeps its own
      toast and busy handling rather than this growing a second set. */
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pick, setPick] = useState<AgencyLevel | null>(null);
  const [busy, setBusy] = useState(false);

  const options = levelsGrantableBy(actor).filter((o) => o.level !== person.current);

  const save = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await setAgencyLevel(person.id, pick);
      onDone(`${person.name} is now ${withArticle(pick)}.`);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change that level.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      width={460}
      title={`Change ${possessive(person.name)} level`}
      sub="This changes what they can see and do across the portal."
      onClose={onClose}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!pick || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Change level'}
        </Button>
      </>}
    >
      <div className="roleopts">
        {options.map((o) => (
          <label
            key={o.level}
            className={`roleopt${pick === o.level ? ' is-sel' : ''}`}
            onClick={() => setPick(o.level)}
          >
            <span className="roleopt__radio" />
            <div>
              <div className="roleopt__name">{o.level}</div>
              <div className="roleopt__desc">{o.desc}</div>
            </div>
          </label>
        ))}
      </div>
      {pick && (
        <p className="soft" style={{ marginTop: 14 }}>
          Make {person.name} {withArticle(pick)}?
        </p>
      )}
    </Modal>
  );
}
