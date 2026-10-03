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
import { ALL_PARTNERS, type PartnerScope } from './types';

/* =====================================================================
   AND ONLY WHERE BOTH ESTATES ARE IN VIEW, 2026-10-02.

   Matt, reading Kestrel's own Reporting: "Don't add '(via Kestrel
   Lettings)' to agency and branch names in the supplier's own view;
   it's only needed where Opndoor sees both estates."

   WHICH IS THE LABEL'S OWN REASON, APPLIED TO ITSELF. It exists so that
   two companies called Frost Partnership can be told apart. In Kestrel's
   view there is only ever one of them, so the label distinguishes
   nothing and the reader is told their own supplier's name on every row
   of their own page.

   ASKED OF THE SCOPE, NOT THE ROLE, so an admin under View as Kestrel
   and Kestrel's own director get the same page -- the rule the whole
   supplier-Reporting fix turned on. `ALL_PARTNERS` is the only scope
   that holds more than one estate: every other scope is one partner,
   whoever is reading it.

   REQUIRED RATHER THAN DEFAULTED. A default would be a surface that
   silently got the old answer, which is exactly how this label reached
   the supplier's own page.
   ===================================================================== */
export function bothEstatesInView(scope: PartnerScope): boolean {
  return scope === ALL_PARTNERS;
}

/**
 * A party's name, with its supplier named after it when it has one.
 *
 * `name` is the agency or branch as it is stored; `partnerSlug` is the
 * estate it belongs to; `scope` is who is reading. Returns the name
 * unchanged for our own estate, for the house rails and for any reader
 * narrowed to one estate, so a caller can apply it unconditionally.
 */
export function viaSupplier(scope: PartnerScope, name: string | null | undefined, partnerSlug: string | null | undefined): string {
  const n = (name ?? '').trim();
  const slug = (partnerSlug ?? '').trim();
  if (!n || !slug) return n;
  if (!bothEstatesInView(scope)) return n;
  if (!partyIsSupplier(slug)) return n;
  const supplier = partnerName(slug);
  // A supplier whose name we cannot resolve is worse labelled than not:
  // "Frost Partnership (via )" tells the reader nothing and looks broken.
  return supplier ? `${n} (via ${supplier})` : n;
}

/* =====================================================================
   A ROW THAT IS ITS OWN PARTNER SAYS SO ONCE.

   Matt, 2026-10-03: "League Suppliers tab (screen and export): the
   supplier's name repeats as its own subtitle ('Kestrel Lettings /
   Kestrel Lettings') and in the export's Detail column. Drop the repeat:
   no subtitle on the Suppliers tab, and leave Detail blank or remove it
   there."

   THE THIRD INSTRUCTION IN THIS FAMILY, after "(via …)" on a row whose
   tag already names the supplier and "(via …)" in a column that already
   carries it. Every one of them is the same sentence: the partner is
   attribution, and attribution is worth nothing on a row whose subject
   IS the partner. On the Suppliers board `keyOf` sets `name` and
   `partner` to the same string, which is what makes that exactly
   checkable rather than a special case for one tab.

   ASKED OF THE ROW, NOT THE VIEW, deliberately. `view === 'supplier'`
   would fix the board Matt is looking at and leave the next one -- an
   agency that shares its supplier's name, which is the shape behind
   "Kestrel Central's subtitle still shows Kestrel Lettings (via Kestrel
   Lettings)". A row that would print the same words twice is the thing
   to test for.

   ONE PREDICATE FOR THE SCREEN AND THE EXPORT, because they are two
   renderings of one table and this file exists because they drifted.
   ===================================================================== */
export function rowIsItsOwnPartner(
  row: { name?: string | null; partner?: string | null },
): boolean {
  const name = (row.name ?? '').trim();
  const partner = (row.partner ?? '').trim();
  return !!name && !!partner && withoutVia(name) === withoutVia(partner);
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
