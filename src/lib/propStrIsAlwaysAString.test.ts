/* =====================================================================
   THE PROPERTY STRING IS A STRING. (bw)'s ACTUAL CAUSE.

   Matt: "Blocker: Admin -> Applications, typing '26262' in the search
   box turns the whole page blank (crash)."

   It was the HEADER's search, not the list's, and the row that did it
   was none of the ones he was looking for.

       function propStr(addr1: string, postcode: string | null): string {
         if (!postcode) return addr1;              // null in, null out
         ...

   `addr1` is typed `string` and `prop_addr1` is nullable, so a row with
   neither an address nor a postcode produced `prop: null` on a summary
   whose type promises a string. Dev holds four: expired referrals that
   never got as far as an address.

   NOTHING NOTICED WHILE NOBODY CALLED A STRING METHOD ON IT. The list
   renders {r.prop} and React draws null as nothing; matchesQuery
   interpolates it into a template and gets "null". GlobalSearch calls
   `a.prop.toLowerCase()` over allSummaries() -- the whole book, no
   scope filter -- inside a useMemo, so the throw lands in render, React
   unmounts the tree, and the page is white. Two characters was enough,
   from any page with the header on it.

   =====================================================================
   WHY THIS FILE AND NOT ONLY THE RENDER TEST
   =====================================================================

   searchNeverBlanksThePage.render.test.tsx is the test Matt asked for
   and it is worth having, but it CANNOT catch this and I checked rather
   than assuming: with the guard taken back out of GlobalSearch it still
   passes, because vitest runs against the mock seed and no seeded row
   has a null address. A render test over data that cannot contain the
   fault is not a test of the fault.

   So the assertion lives where the bug is: a pure function, every input
   shape the column allows, and the one rule that matters -- it returns
   a string, always.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { propStr } from './hydrate';

describe('propStr', () => {
  /* THE FOUR SHAPES THE TWO NULLABLE COLUMNS ALLOW. The last is the one
     on dev, and the one that blanked the page. */
  it.each([
    ['1 ZZZ Street', 'SW1A 1AA'],
    ['1 ZZZ Street', null],
    [null, 'SW1A 1AA'],
    [null, null],
  ])('returns a string for (%s, %s)', (addr1, postcode) => {
    const out = propStr(addr1 as string | null, postcode as string | null);
    expect(typeof out).toBe('string');
    // The thing that actually threw. Not a flourish: `typeof null` is
    // "object", so the line above already covers it -- this names the
    // call site so the reason survives a refactor of the assertion.
    expect(() => out.toLowerCase()).not.toThrow();
  });

  it('still reads "addr1, OUTCODE" when it has both', () => {
    expect(propStr('14 Chalcot Road', 'NW1 8LH')).toBe('14 Chalcot Road, NW1');
  });

  /* AND DOES NOT INVENT PUNCTUATION AROUND A MISSING HALF. A leading
     ", NW1" or a trailing "14 Chalcot Road," reads as a broken record
     rather than a partial one. */
  it('and one half alone, with no stray comma', () => {
    expect(propStr('14 Chalcot Road', null)).toBe('14 Chalcot Road');
    expect(propStr(null, 'NW1 8LH')).toBe('NW1');
    expect(propStr(null, null)).toBe('');
  });
});
