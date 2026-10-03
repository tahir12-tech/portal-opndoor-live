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
import { rowIsItsOwnPartner } from '@/data/viaSupplier';

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

describe('the screen', () => {
  it('draws no partner tag on a row that is the partner', () => {
    expect(LEAGUE).toContain('showPartner && r.partner && !rowIsItsOwnPartner(r)');
  });

  it('and no subtitle under it either', () => {
    expect(LEAGUE).toContain('{!hasSubCol && !rowIsItsOwnPartner(r) && <div className="lt-sub">{r.sub}</div>}');
  });
});

describe('the export columns', () => {
  /* THE HEADINGS AND THE CELLS ARE DECLARED IN TWO PLACES AND MUST AGREE
     EXACTLY, or every cell after them shifts a column and the sheet is wrong
     in a way that still opens. Both are asserted, on the same three views. */
  it('are none on Suppliers, Route on Agencies, Agency and Route on Branches', () => {
    expect(EXPORTS).toContain("const detailCols: Column[] = view === 'supplier' ? []");
    expect(EXPORTS).toContain("? [{ header: 'Agency', type: 'text' }, { header: 'Route', type: 'text' }]");
    expect(EXPORTS).toContain(": [{ header: 'Route', type: 'text' }];");
  });

  it('and the cells follow the same three-way split', () => {
    expect(EXPORTS).toContain("const detailCells = view === 'supplier' ? []");
    expect(EXPORTS).toContain("view === 'branch' ? [sub, route]");
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
