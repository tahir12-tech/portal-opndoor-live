/* =====================================================================
   TWO FROSTS, AND ONLY ONE OF THEM IS OURS.

   Matt, 2026-10-02, verbatim: "Wherever an agency or branch from a
   supplier's estate appears alongside Opndoor's (branch and agency
   charts, referrer list, settlements, payees, statements), label it with
   its supplier, e.g. 'Frost Partnership (via Kestrel Lettings)', so two
   same-named companies can always be told apart."

   THIS IS THE COST OF SEPARATE ESTATES ARRIVING ON A SHARED SCREEN. The
   estate rule is that the same real company can exist twice -- Frost as
   Opndoor's client and Frost under Kestrel -- as two rows that never
   link and never share data. On dev that is exactly what there is: a
   Frost Partnership under `opndoor-agents` with one application and a
   Frost Partnership under `kestrel-lettings` with one. Every screen that
   keeps them apart is doing its job. Admin Reporting is the screen that
   puts them next to each other on purpose, and there the two rows read
   identically.

   ONE FUNCTION, SIX SURFACES. Matt names the six, which is what makes a
   helper worth having: written at each site it would be written six
   ways, and the first one that said "(Kestrel)" instead of "(via Kestrel
   Lettings)" would be a reader deciding they are two different things.

   WHICH ESTATES GET IT. Only a supplier's. `partyIsSupplier` is the
   three-way split the rails already turn on -- not a house partner, not
   an agency-shaped one -- so:

     opndoor-agents     our own clients, no label. The screen is ours and
                        an unlabelled row is one of ours, which is the
                        default worth having.
     opndoor-direct     the house rails. Nothing to say.
     kestrel-lettings   a supplier. Labelled.
     harbour-lets       referencing_mode opndoor_referenced, so NOT a
                        supplier: it is an agency with a partner row, and
                        that is the subject of the second half of the
                        same instruction. It gets no "via" either way,
                        because there is no supplier to name.
   ===================================================================== */
import { partyIsSupplier } from './capabilities';
import { partnerName } from './partnersService';

/**
 * A party's name, with its supplier named after it when it has one.
 *
 * `name` is the agency or branch as it is stored; `partnerSlug` is the
 * estate it belongs to. Returns the name unchanged for our own estate and
 * for the house rails, so a caller can apply it unconditionally.
 */
export function viaSupplier(name: string | null | undefined, partnerSlug: string | null | undefined): string {
  const n = (name ?? '').trim();
  const slug = (partnerSlug ?? '').trim();
  if (!n || !slug) return n;
  if (!partyIsSupplier(slug)) return n;
  const supplier = partnerName(slug);
  // A supplier whose name we cannot resolve is worse labelled than not:
  // "Frost Partnership (via )" tells the reader nothing and looks broken.
  return supplier ? `${n} (via ${supplier})` : n;
}

/** True where `viaSupplier` would add something, for a caller that needs to
    decide whether to draw a second line rather than extend the first. */
export function isSupplierEstate(partnerSlug: string | null | undefined): boolean {
  const slug = (partnerSlug ?? '').trim();
  return !!slug && partyIsSupplier(slug);
}
