/* THE LEAGUE, FOUR INSTRUCTIONS IN ONE DAY.
 *
 * Matt, 2026-10-02, across four messages:
 *
 *   "rename 'Partner comm.' to 'Supplier comm.' on every tab"
 *   "where a row already shows its supplier (the tag on screen, the
 *    Detail column in exports), drop '(via …)' from the name so it
 *    isn't said twice"
 *   "add the dashboard's one-line note that a rate can exceed 100% when
 *    payments land this period for referrals sent earlier"
 *   "the people tab is 'Negotiators' on screen and 'Referrers' in its
 *    export. Call it 'Referrers' in both ... and add an 'Agency or
 *    supplier' column on screen and in the export"
 *   "League Suppliers tab export: it's titled 'League table: Referrers'
 *    with a 'Referrer' column. Title it 'League table: Suppliers' with a
 *    'Supplier' column. Check every League tab's export is titled after
 *    its own tab."
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutVia, viaSupplier } from '@/data/viaSupplier';
import { ALL_PARTNERS } from '@/data/types';

const LEAGUE = readFileSync('src/pages/League/League.tsx', 'utf8');
const EXPORTS = readFileSync('src/data/exportsService.ts', 'utf8');

describe('the supplier is said once', () => {
  it('and the suffix comes off cleanly', () => {
    expect(withoutVia('Frost Partnership (via Kestrel Lettings)')).toBe('Frost Partnership');
  });

  /* A NAME WITH NO SUFFIX IS UNTOUCHED, which matters because the same
     function runs over every row on a board where only some are in a
     supplier's estate. */
  it('and a name that never had one is left alone', () => {
    expect(withoutVia('Frost Partnership')).toBe('Frost Partnership');
    expect(withoutVia("Regent's Lettings")).toBe("Regent's Lettings");
  });

  /* ROUND TRIP. The label the charts add is exactly the label these two
     surfaces take off, which is the whole point of both living in one
     file: a change to the suffix cannot break only one of them. */
  it('and it is exactly the suffix viaSupplier adds', () => {
    expect(withoutVia(viaSupplier(ALL_PARTNERS, 'Frost Partnership', 'kestrel-lettings'))).toBe('Frost Partnership');
  });

  /* A NAME WITH A BRACKET OF ITS OWN keeps it: the pattern is anchored
     to the end and to the word "via", not to any parenthesis. */
  it('and does not eat a bracket that is part of the name', () => {
    expect(withoutVia('Frost (Chelsea) Ltd')).toBe('Frost (Chelsea) Ltd');
  });

  it('on screen, where the row carries the supplier tag', () => {
    expect(LEAGUE).toContain('showPartner ? withoutVia(r.name) : r.name');
  });

  it('and in the export, where the Detail column carries it', () => {
    expect(EXPORTS).toContain('const name = showPartner ? withoutVia(r.name) : r.name;');
  });
});

describe('every board says which board it is', () => {
  /* THE OLD SHAPE WAS A TERNARY WITH NO ELSE WORTH THE NAME: agency,
     branch, and "Referrer" for everything else. True while there were
     three boards; the Suppliers board was added as a fourth and fell
     into the else. A map has to be extended to compile. */
  it('from one map, not a ternary that swallows the fourth', () => {
    expect(EXPORTS).toContain('const LEAGUE_NOUN: Record<LeagueView, { sheet: string; column: string }>');
    expect(EXPORTS).toContain("supplier: { sheet: 'Suppliers', column: 'Supplier' }");
    expect(EXPORTS).not.toMatch(/name: view === 'agency' \? 'Agencies' : view === 'branch' \? 'Branches' : 'Referrers'/);
  });

  it('and the sheet is named from it', () => {
    expect(EXPORTS).toContain('[{ view, name: LEAGUE_NOUN[view].sheet }]');
  });

  it('and so is the first column', () => {
    expect(EXPORTS).toContain('const first: Column = { header: LEAGUE_NOUN[view].column, type: \'text\' };');
  });
});

describe('the people board', () => {
  it('is called Referrers, not Negotiators', () => {
    expect(LEAGUE).toContain("{ id: 'referrer', label: 'Referrers' }");
    expect(LEAGUE).not.toContain("label: 'Negotiators'");
  });

  it('and says where each of them works, on screen', () => {
    expect(LEAGUE).toContain("['sub', 'Agency or supplier', false]");
  });

  /* THE CELL IS NO LONGER CALLED `detail`, and the assertion followed it
     rather than being deleted. 2026-10-03 split that one column into named
     ones per board -- Agency and Route on Branches, Route on Agencies, none
     on Suppliers -- and the referrer board kept its single "Agency or
     supplier" cell, which is the shape the instruction before gave it. What
     is asserted is still the pair: the heading exists, and the referrer arm
     puts something under it. */
  it('and in the export, which had no such column at all', () => {
    expect(EXPORTS).toContain("{ header: 'Agency or supplier', type: 'text' }");
    expect(EXPORTS).toContain("return [name, who, r.refs,");
  });
});

describe('the commission column', () => {
  it('says Supplier on every tab', () => {
    expect(LEAGUE).not.toContain("'Partner comm.'");
    // Three of the four boards carry it; the referrer board never has.
    expect(LEAGUE.match(/'Supplier comm\.'/g) ?? []).toHaveLength(3);
  });
});

describe('the conversion columns', () => {
  /* A RATE OVER 100% READS AS A BUG AND IS NOT ONE. Each column counts
     the events inside the period, so a referral sent in August and paid
     in September is a payment with no sent to divide by. The dashboard
     said so; the board that ranks people on those columns did not. */
  it('carry the dashboard\'s own note', () => {
    expect(LEAGUE).toContain('period throughput');
    expect(LEAGUE).toContain('a rate can exceed 100%');
  });
});
