/* =====================================================================
   "DEAL FOR FROST PARTNERSHIP AND 2 OTHERS".

   Matt's own example, 2026-10-01, and it is a sentence with three shapes
   rather than a template: one agency names itself, two says "and 1
   other", three or more counts the rest. Kept out of the dialog so the
   list of deals can head each row with the same words the dialog was
   titled with -- a deal that is called one thing while it is being
   written and another once it is saved reads as two deals.
   ===================================================================== */
import { plural } from '@/lib/plural';

export const AgencyPercentEditorTitles = {
  dealFor(names: string[]): string {
    if (names.length === 0) return 'A deal for some of the agencies';
    const [first, ...rest] = names;
    if (rest.length === 0) return `Deal for ${first}`;
    return `Deal for ${first} and ${rest.length} ${plural(rest.length, 'other')}`;
  },
};
