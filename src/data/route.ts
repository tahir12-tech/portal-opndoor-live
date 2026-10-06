/* =====================================================================
   A ROUTE IS A RAIL OR A SUPPLIER, AND HARBOUR LETS IS NEITHER.

   Matt, 2026-10-02, verbatim: "'Commission by route': Harbour Lets is an
   agency, so it belongs in 'Agency referral', not listed as its own
   route. Only real suppliers appear as routes."

   WHAT WAS HAPPENING. `livePartnerBreakdown` groups by `app.partner` and
   names each group with `partnerName`, which renders a HOUSE partner as
   its rail ("Agency referral", "Direct") and anything else as itself.
   That is right for a supplier and wrong for every other partner row:
   Harbour Lets has its own partners row, is not a house route, and so
   got a route of its own on a table whose rows are supposed to be the
   three rails plus the suppliers.

   THE SAME FAULT AS THE SUPPLIERS LIST, which Matt reported the same
   day: "Harbour Lets shows as a supplier, but it's an agency." Both
   screens were deciding "is this a supplier" by asking "does it have a
   partner row", and the answer to that is yes for every agency on our
   estate's parent too. `partyIsSupplier` is the predicate that actually
   knows, and it is the one the Suppliers list was fixed onto.

   THREE ANSWERS, AND THE THIRD IS THE NEW ONE:

     a house partner    its rail. 'Agency referral', 'Direct', 'Provider
                        hand-over'.
     a supplier         itself. This is what a route means on this table.
     anything else      an agency that happens to hold a partner row, so
                        the rail it refers on: 'Agency referral'. It is
                        folded into that row rather than dropped, because
                        its referrals are real and the column totals have
                        to keep footing to the summary above them.
   ===================================================================== */
import { partyIsSupplier } from './capabilities';
import { houseRouteLabel, isHousePartner } from './channel';
import { partnerName } from './partnersService';

/** The route an application on this partner belongs to: a stable key for
    grouping, and the name to print. */
export function routeOf(slug: string | null | undefined): { key: string; name: string } {
  const s = (slug ?? '').trim();
  if (!s) return { key: 'opndoor-agents', name: 'Agency referral' };
  if (isHousePartner(s)) return { key: s, name: houseRouteLabel(s) };
  if (partyIsSupplier(s)) return { key: s, name: partnerName(s) };
  /* AN AGENCY WITH A PARTNER ROW. The key is the house agency rail's own
     slug, so this group and the real agency-referral group are one row
     and not two that happen to share a name. */
  return { key: 'opndoor-agents', name: 'Agency referral' };
}
