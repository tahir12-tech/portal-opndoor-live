/* A BOARD SAYS THE SUPPLIER ONCE, AND NAMES WHAT IT IS SAYING.
 *
 * Matt, 2026-10-03, in three messages that end up as one rule:
 *
 *   "League Suppliers tab (screen and export): the supplier's name repeats as
 *    its own subtitle ('Kestrel Lettings / Kestrel Lettings') and in the
 *    export's Detail column. Drop the repeat: no subtitle on the Suppliers
 *    tab, and leave Detail blank or remove it there."
 *
 *   "rename the 'Detail' column to 'Route' on the Agencies and Branches
 *    exports; on Suppliers drop it."
 *
 *   "replace 'Detail' with separate 'Agency' and 'Route' columns on the
 *    Branches export (e.g. Kestrel Central | Kestrel Lettings | Kestrel
 *    Lettings), 'Route' alone on the Agencies export, and no Detail column on
 *    Suppliers."
 *
 * THE REPEAT IN THAT EXAMPLE IS DELIBERATE, and it is the thing worth getting
 * right. On a branch of Kestrel's Frost the agency and the route are BOTH
 * "Kestrel Lettings", and Matt keeps both. A repeat is only wrong where
 * nothing says what the second one is: one column headed "Detail" holding
 * "Kestrel Lettings · Kestrel Lettings" is noise, and two columns headed
 * "Agency" and "Route" holding the same two words are a fact.
 *
 * So the screen and the export part company here, for a reason:
 *   the screen  drops the tag where the row IS the partner, because a tag has
 *               no heading and cannot say what it is
 *   the export  keeps both, under headings that do
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rowIsItsOwnPartner, withQualifier } from '@/data/viaSupplier';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const EXPORTS = read('src/data/exportsService.ts');
const LEAGUE = read('src/pages/League/League.tsx');

describe('the predicate the screen asks', () => {
  it('is true where the row is its own partner, which is every Suppliers row', () => {
    expect(rowIsItsOwnPartner({ name: 'Kestrel Lettings', partner: 'Kestrel Lettings' })).toBe(true);
  });

  it('and false on an ordinary row, which keeps its tag', () => {
    expect(rowIsItsOwnPartner({ name: 'Frost Partnership', partner: 'Kestrel Lettings' })).toBe(false);
  });

  /* ASKED OF THE ROW, NOT THE VIEW, so the next board with the same shape is
     covered: an agency that shares its supplier's name prints the same two
     words too, which is the "Kestrel Lettings (via Kestrel Lettings)" family. */
  it('and sees through a via-label, so the two forms of one name still match', () => {
    expect(rowIsItsOwnPartner({
      name: 'Kestrel Lettings (via Kestrel Lettings)', partner: 'Kestrel Lettings',
    })).toBe(true);
  });

  it('and says nothing about a row with no partner at all', () => {
    expect(rowIsItsOwnPartner({ name: 'Regent’s Lettings', partner: '' })).toBe(false);
    expect(rowIsItsOwnPartner({ name: '', partner: 'Kestrel Lettings' })).toBe(false);
  });
});

const LEAGUE_EXPORTS = readFileSync(join(process.cwd(), 'src/data/exportsService.ts'), 'utf8');

describe('the screen', () => {
  /* (bz) NARROWED TO THE SUPPLIERS BOARD, which reverses the reasoning
     above and is worth spelling out.

     The comment at the top of this file says the predicate is "ASKED OF
     THE ROW, NOT THE VIEW, so the next board with the same shape is
     covered: an agency that shares its supplier's name prints the same
     two words too". That generality was the point, and it was wrong --
     it listed Matt's complaint as a feature.

     Matt, 2026-10-05: 'give the "Kestrel Lettings" agency row its
     "Kestrel Lettings" badge like the others.' On the SUPPLIERS board
     a row really is its own partner and the badge is the same words
     twice. On the AGENCIES board that row is one agency of several in
     Kestrel's estate, and the badge is the only thing on it saying
     so -- a badge column with one blank cell reads as "this one has no
     estate", which is a worse lie than a repeat. The test is which
     board, not which words.

     THE PREDICATE ITSELF IS UNCHANGED and its unit tests above still
     hold: it still answers "is this row its own partner" correctly,
     including through a via-label. What changed is who asks it. */
  it('draws no partner tag on a supplier row that is the partner', () => {
    expect(LEAGUE).toContain("showPartner && r.partner && !(view === 'supplier' && rowIsItsOwnPartner(r))");
  });

  it('and no subtitle under it either, on that board only', () => {
    expect(LEAGUE).toContain("{!hasSubCol && !(view === 'supplier' && rowIsItsOwnPartner(r)) && <div className=\"lt-sub\">{r.sub}</div>}");
  });

  /* AND THE AGENCY ROW KEEPS BOTH. The assertion that would have
     failed before this change, named so the narrowing cannot be
     quietly widened back. */
  it('but an agency row that shares its supplier\u2019s name keeps its badge', () => {
    expect(LEAGUE).not.toContain('showPartner && r.partner && !rowIsItsOwnPartner(r)');
    expect(LEAGUE).not.toContain('{!hasSubCol && !rowIsItsOwnPartner(r) &&');
  });
});

describe('the export columns', () => {
  /* THE HEADINGS AND THE CELLS ARE DECLARED IN TWO PLACES AND MUST AGREE
     EXACTLY, or every cell after them shifts a column and the sheet is wrong
     in a way that still opens. Both are asserted, on the same three views. */
  it('are none on Suppliers, Route on Agencies, Agency and Route on Branches', () => {
    expect(EXPORTS).toContain("const detailCols: Column[] = view === 'supplier' ? []");
    expect(EXPORTS).toContain("[{ header: 'Agency', type: 'text' }, { header: 'Route', type: 'text' }]");
    expect(EXPORTS).toContain("[{ header: 'Route', type: 'text' }]");
  });

  it('and the cells follow the same three-way split', () => {
    expect(EXPORTS).toContain("const detailCells = view === 'supplier' ? []");
    expect(EXPORTS).toContain("view === 'branch' ? (forCustomer ? [sub] : [sub, route])");
  });

  /* =====================================================================
     AND NONE OF IT ON A CUSTOMER'S COPY, 2026-10-03.

     Matt: "League exports as an agency or supplier: drop the 'Route' column
     (and 'Agency or supplier'), which only mean something in Opndoor's view."

     THE SPLIT ABOVE IS STILL THE SPLIT, for Opndoor, and this is a second
     axis on top of it: the ROUTE is which of our rails the row came in on,
     and both columns exist to tell two estates apart in one file. A
     customer's export holds one estate, so Route is their own name repeated
     down every row.

     THE AGENCY COLUMN SURVIVES on their Branches sheet, which is the half of
     the 2026-10-02 instruction that is about THEIR structure rather than
     ours: a branch row still has to say which of their agencies it is in.
     ===================================================================== */
  it('and a customer gets neither Route nor "Agency or supplier"', () => {
    expect(EXPORTS).toContain("(forCustomer ? [] : [{ header: 'Route', type: 'text' }])");
    expect(EXPORTS).toContain("return forCustomer ? [first, ...core] : [first, { header: 'Agency or supplier', type: 'text' }, ...core];");
    // The cells go with the headings, or every column after them shifts.
    expect(EXPORTS).toContain("if (forCustomer) return [name, r.refs, money(r.fees), r.paid, r.deed, r.sp, r.conv];");
  });

  /* THE AUDIENCE, NOT THE RAIL. `agency` is already in scope at that site and
     would have been the easy thing to reach for; it answers false for a
     supplier's Management, who is just as much a customer reading their own
     book. */
  it('and the test is the audience rather than the rail', () => {
    expect(EXPORTS).toContain('const forCustomer = customerFacing(role);');
    expect(EXPORTS).toContain('function customerFacing(role: Role): boolean {\n  return !isOpndoorStaff(role);');
  });

  /* COMMENTS STRIPPED, because the comment above this very code quotes
     Matt's "replace 'Detail' with separate columns" and a raw scan reads
     the explanation of the change as the change not having happened. The
     icon guard learned the same thing an hour earlier. */
  it('and "Detail" is gone from the league sheet entirely', () => {
    const fn = EXPORTS.slice(EXPORTS.indexOf('function leagueColumns'), EXPORTS.indexOf('function leagueRows'));
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("'Detail'");
  });

  /* THE ROUTE IS ONLY FILLED WHERE THE SHEET SPANS MORE THAN ONE PARTNER.
     Narrowed to one, it would be the same word on every row, which is the
     noise this whole change is about. */
  it('and the Route cell is empty when the sheet is one partner', () => {
    expect(EXPORTS).toContain("const route = showPartner && r.partner ? r.partner : '';");
  });
});

/* =====================================================================
   AND NEVER TWO BRACKETS. (bp)(3) and (bu) are one fault reported
   twice: a name that already carries "(via X)" handed to something
   that appends its own parenthetical.
   ===================================================================== */
describe('a qualifier on a via-labelled name', () => {
  it('folds into the existing bracket rather than adding a second', () => {
    expect(withQualifier('Frost Partnership (via Kestrel Lettings)', 'agency'))
      .toBe('Frost Partnership (agency, via Kestrel Lettings)');
  });

  /* (bu) EXACTLY: the estate is the thing "via" already names, so
     appending it produced "Frost Partnership (via Kestrel Lettings)
     (Kestrel Lettings)". Say it once. */
  it('and drops a qualifier that only repeats the estate', () => {
    expect(withQualifier('Frost Partnership (via Kestrel Lettings)', 'Kestrel Lettings'))
      .toBe('Frost Partnership (via Kestrel Lettings)');
    expect(withQualifier('Frost Partnership (via Kestrel Lettings)', 'kestrel lettings'))
      .toBe('Frost Partnership (via Kestrel Lettings)');
  });

  it('and an ordinary name still gets an ordinary bracket', () => {
    expect(withQualifier('Regent’s Lettings', 'agency')).toBe('Regent’s Lettings (agency)');
  });

  /* NOTHING TO ADD IS NOT A BRACKET. An empty level would otherwise
     print "Frost Partnership ()". */
  it('and no qualifier leaves the name alone', () => {
    expect(withQualifier('Regent’s Lettings', '')).toBe('Regent’s Lettings');
    expect(withQualifier('Regent’s Lettings', null)).toBe('Regent’s Lettings');
  });

  it('and the export uses it', () => {
    expect(LEAGUE_EXPORTS).toContain('withQualifier(a.agency, a.level)');
    expect(LEAGUE_EXPORTS).not.toContain('${a.agency} (${a.level})');
  });
});
