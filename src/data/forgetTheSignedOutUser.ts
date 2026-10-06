/* =====================================================================
   FORGET THE SIGNED-OUT USER'S BOOK.

   ROUND 6, the last of the eight lows: "localStorage working copies
   survive sign-out." `grp_org_v3` is the whole agencies-and-branches
   working copy INCLUDING agent contacts -- names, emails and phone
   numbers at every agency the signed-out user could reach -- and
   `grp_partners_v2` carries every partner's commission rates.

   TWO HALVES, AND THEY MUST HAPPEN IN ONE SYNCHRONOUS BREATH.

   Removing the key is not enough: the services read localStorage once, at
   import, and hold the rows in module memory afterwards. A sign-out and a
   sign-in in the SAME TAB never re-import, so the new user would be handed
   the previous user's agencies out of RAM with the key already gone.

   AND THE FIRST VERSION OF THIS DID IT WITH A DYNAMIC import(), which is
   worse than not doing it. The clear would land one microtask later --
   after the new user's hydrate on a fast re-sign-in -- so it would wipe
   the INCOMING user's book instead of the outgoing one's, intermittently,
   depending on network timing. A cleanup that races the thing it is
   cleaning up for is a bug with a good intention.

   SO THIS MODULE EXISTS TO HOLD THE STATIC IMPORTS. storage.ts cannot:
   orgService and partnersService both import it, so importing them back
   is a cycle. Nothing imports this except SessionContext and its test.
   ===================================================================== */
import { clearStoredWorkingCopies } from './storage';
import { hydrateGroups, hydrateOrg } from './orgService';
import { hydratePartners } from './partnersService';

/** Called by signOut, and by the seat change when a different user
    resolves in the same runtime -- which today resets the scope and the
    recents and leaves the org and partner trees standing. */
export function forgetTheSignedOutUser(): void {
  clearStoredWorkingCopies();
  hydrateOrg([]);
  hydrateGroups([]);
  hydratePartners([]);
}
