/* =====================================================================
   "3 fields still need filling in", beside the button that would not work.

   Matt, 2026-10-03: "show a message at the Send button: '3 fields still need
   filling in' with a link that jumps to the first one."

   BESIDE THE BUTTON IS THE POINT. The field errors are already on screen, and
   on a form the length of New application they are a screen and a half above
   the thing the reader just pressed. The reader's question at that moment is
   "why did nothing happen", and it has to be answered where they are looking.

   A BUTTON, NOT AN ANCHOR, for the jump. An <a href="#id"> would work and
   would also put a fragment in the address bar, so the back button starts
   stepping through the fields somebody failed to fill in. It is an action, not
   a destination.

   IT DRAWS NOTHING WHEN THERE IS NOTHING TO SAY, so a caller can render it
   unconditionally and a form that has just been corrected goes quiet on its
   own.
   ===================================================================== */
import { missingFieldsLine } from '@/lib/missingFields';
import './MissingFields.css';

export function MissingFields({ count, onJump }: {
  /** How many fields the form is showing as invalid. Nothing is drawn at 0. */
  count: number;
  /** Takes the reader to the first one. From useMissingFields. */
  onJump: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="missingfields" role="alert">
      <span>{missingFieldsLine(count)}.</span>
      <button type="button" className="missingfields__jump" onClick={onJump}>
        Go to the first one
      </button>
    </div>
  );
}
