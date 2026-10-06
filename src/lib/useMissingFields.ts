/* =====================================================================
   THE THREE LINES A FORM NEEDS TO JOIN IN.

   Matt, 2026-10-03: "Same for every form in the portal."

   THAT SENTENCE IS THE WHOLE DESIGN CONSTRAINT. A mechanism that takes a
   page of wiring is a mechanism that reaches the form somebody is looking at
   and no others, so this is a hook returning everything a form needs:

     const { formRef, count, jump } = useMissingFields(submitted);
     ...  <form ref={formRef}>              or  <div ref={formRef}> for a dialog
     ...  <MissingFields count={count} onJump={jump} />
     ...  and the submit button stops being disabled while invalid

   THE LAST LINE IS THE ONE THAT MATTERS and is not about this file. A button
   disabled until the form is valid cannot be pressed, so there is nothing to
   count and nowhere to jump, and the reader is left hunting. That is what
   every form in the portal did.

   `showErrors` RATHER THAN A CONSTANT TRUE: a form that has not been
   submitted yet is not "missing" anything, it is being filled in, and a count
   that starts at 6 and ticks down is a scold. It goes live on the first press.
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { focusFirstInvalid, invalidFields } from './missingFields';

export function useMissingFields<T extends HTMLElement = HTMLElement>(showErrors: boolean) {
  const formRef = useRef<T | null>(null);
  const [count, setCount] = useState(0);
  /* NO DEPENDENCY ARRAY, deliberately. The answer changes when the FIELDS
     change, which is every render of the form, and there is no value here to
     depend on: the truth is in the DOM. setCount with an unchanged number is
     a no-op in React, so this settles immediately rather than looping. */
  useEffect(() => {
    setCount(showErrors ? invalidFields(formRef.current).length : 0);
  });
  /* AFTER THE PAINT. The press that reveals the errors has not re-rendered
     yet, so at the moment the handler runs the DOM holds no invalid field at
     all and the jump would find nothing. One frame later it holds every one. */
  const jump = () => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
    } else {
      focusFirstInvalid(formRef.current);
    }
  };
  return { formRef, count, jump };
}
