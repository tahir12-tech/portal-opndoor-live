/* =====================================================================
   Autosave, because a tenant will not finish this in one sitting.

   THE RULE: partial state persists AS THEY GO, never on a submit button. Losing
   an hour of a long form is the point at which somebody gives up and rings an
   agent instead, which is the exact outcome this journey exists to avoid.

   WHAT THIS DOES AND WHY EACH PART IS THERE

   Debounced, not per keystroke. A save on every character is a request per
   character and a rate limit waiting to happen. 700ms after they stop typing is
   below the threshold where somebody switches away expecting it to be saved.

   Only CHANGED keys are sent. The server upserts a patch, so sending the whole
   record would let a field somebody has not reached overwrite one they have.

   flush() on demand. Changing tab, closing the tab and submitting all have to
   force a pending save rather than wait out the debounce, because all three are
   moments where the user believes they are finished with a section.

   Failures are surfaced, never swallowed. A form that silently stops saving is
   worse than one that never saved, because the user has no reason to distrust
   it. The status this returns is rendered, always.
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function useAutosave(
  save: (patch: Record<string, unknown>) => Promise<unknown>,
  delay = 700,
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    // Cleared BEFORE the await, so edits made during the request are not lost
    // by a later clear. They queue into the next patch instead.
    pending.current = {};
    setStatus('saving');
    try {
      await saveRef.current(patch);
      setStatus(Object.keys(pending.current).length ? 'dirty' : 'saved');
    } catch {
      // Put them back, so a retry or the next edit carries them again. A failed
      // save must not quietly discard what the user typed.
      pending.current = { ...patch, ...pending.current };
      setStatus('error');
    }
  }, []);

  const set = useCallback((key: string, value: unknown) => {
    pending.current[key] = value;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void run(); }, delay);
  }, [delay, run]);

  const flush = useCallback(async () => { await run(); }, [run]);

  // Leaving the page with an unsaved edit is the failure this whole hook
  // exists to prevent, so the last write is forced on hide. visibilitychange
  // rather than beforeunload because mobile browsers do not reliably fire the
  // latter, and a phone is where a long form gets abandoned mid-sentence.
  useEffect(() => {
    const onHide = () => { if (Object.keys(pending.current).length) void run(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [run]);

  return { status, set, flush };
}
