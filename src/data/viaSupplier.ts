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

/* =====================================================================
   AND WHERE THE ROW ALREADY SAYS IT, TAKE IT OFF AGAIN.

   Matt, 2026-10-02: "where a row already shows its supplier (the tag on
   screen, the Detail column in exports), drop '(via …)' from the name so
   it isn't said twice."

   THE RULE IS ABOUT THE SURFACE, NOT THE NAME. `viaSupplier` was written
   for the charts, where a bar has nothing but a label and the estate has
   nowhere else to live. League has a Supplier column, its export has a
   Detail column, and a supplier reading their own Reporting has an
   entire page of their own rows -- on all three the label is the same
   fact twice on one line.

   SO THE LABEL IS APPLIED BY THE SURFACE AND REMOVED BY THE SURFACE,
   rather than every caller deciding whether to ask for it: the rows are
   built once, in `groupRows`, and the two screens that already state the
   estate strip it here. One function to grep for, and the shape of the
   suffix is written down once.
   ===================================================================== */

/** `viaSupplier`'s suffix, removed. Leaves a name with no suffix alone. */
export function withoutVia(name: string | null | undefined): string {
  return (name ?? '').replace(/\s*\(via [^)]*\)\s*$/, '').trim();
}
