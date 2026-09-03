import { createContext } from 'react';

/* True after a blocked "Save and continue" was pressed. Required-but-empty fields
   then show themselves as missing (red), so the reason the button did not proceed
   is on the offending fields as well as in the footer blocker. Reset on step change.
   The default is false, so a field outside a provider behaves exactly as before. */
export const RevealMissingContext = createContext(false);
