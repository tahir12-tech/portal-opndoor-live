/* =====================================================================
   WHAT A FORM DOES WHEN YOU PRESS SEND AND SOMETHING IS MISSING.

   Matt, 2026-10-03: "New application form: when Send is pressed with required
   fields missing, scroll to the first missing field, highlight every missing
   field in red with 'Required', and show a message at the Send button: '3
   fields still need filling in' with a link that jumps to the first one. Same
   for every form in the portal."

   =====================================================================
   WHY THIS READS THE DOM RATHER THAN A LIST OF FIELD NAMES
   =====================================================================

   "Same for every form in the portal" is the hard half. A mechanism that each
   form feeds an ordered list of its own required fields is a mechanism every
   form implements slightly differently, and the lists go stale the first time
   somebody adds a field: the new one is missing from the count, the jump skips
   it, and nothing fails.

   `Field` already puts `is-invalid` on a field it is showing an error for.
   That class IS the red highlight, it is already correct on every form built
   out of `Field`, and the DOM already holds them in the order the reader sees.
   So the count, the first one and the jump all fall out of one query, and a
   field added tomorrow is counted without anybody wiring it up.

   WHAT A FORM STILL HAS TO DO, and it is two lines: stop disabling its submit
   button while invalid, and show every error once submit has been pressed.
   A disabled button cannot be pressed, so there is nothing to report and
   nothing to jump to -- which is what the New application form did, and why
   pressing Send there appeared to do nothing at all.

   NOT A REPLACEMENT FOR THE FIELD'S OWN MESSAGE. The sentence by the button
   is a count and a way back; the field says what is wrong with it.
   ===================================================================== */

/** Every field a form is currently showing as invalid, in the order they appear. */
export function invalidFields(form: Element | null): HTMLElement[] {
  if (!form) return [];
  return [...form.querySelectorAll<HTMLElement>('.field.is-invalid')];
}

/**
 * The count sentence by the submit button.
 *
 * MATT'S OWN WORDS FOR THE PLURAL, and the singular is the one worth getting
 * right because it is the commonest case: one field left is what a reader
 * usually has, and "1 fields still need filling in" is the sort of thing that
 * makes a careful person distrust the rest of the page.
 */
export function missingFieldsLine(n: number): string {
  if (n <= 0) return '';
  return n === 1
    ? '1 field still needs filling in'
    : `${n} fields still need filling in`;
}

/**
 * Scroll the first invalid field into view and put the cursor in it.
 *
 * FOCUS AS WELL AS SCROLL, which the instruction does not say and the reader
 * needs: arriving at the right part of a long form with the cursor somewhere
 * else means typing into nothing. The control inside the field is what takes
 * focus, not the wrapper.
 *
 * `preventScroll` ON THE FOCUS CALL, because focus() scrolls too, and the two
 * fight: the browser's jump is instant and lands the field under the sticky
 * header, which is the bug this function exists to avoid. One smooth scroll,
 * then focus without moving anything.
 *
 * REDUCED MOTION IS HONOURED. Somebody who has asked their machine not to
 * animate should not be given a smooth scroll, and 'auto' still arrives.
 */
export function focusFirstInvalid(form: Element | null): HTMLElement | null {
  const first = invalidFields(form)[0];
  if (!first) return null;
  const reduced = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    first.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  } catch {
    // jsdom, and any browser without the options form. Nothing is lost: the
    // focus below still moves the reader to the right place.
  }
  const control = first.querySelector<HTMLElement>('input, select, textarea, [tabindex]');
  try {
    (control ?? first).focus({ preventScroll: true });
  } catch {
    (control ?? first).focus?.();
  }
  return first;
}
