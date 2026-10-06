/* HOME'S "AWAITING A DECISION" TABLE STOPPED AT EIGHT AND SAID NOTHING.
 *
 * Matt, 2026-10-03, verbatim: "Home 'Awaiting a decision': show '8 of N' and
 * a 'View all' link when there are more."
 *
 * I reported this table in the top-ten sweep and left it alone, because it
 * grows with APPLICATIONS rather than with agencies and the instruction that
 * day was about agencies. This is the answer to that report: it was taking
 * `.slice(0, 8)` and printing no count, so eight rows and eighty rows looked
 * identical -- and this is the ops queue, where "is that all of it" is the
 * question the page exists to answer.
 *
 * N IS THE SCOPED COUNT. `awaitingDecisionCount()` is the whole book and was
 * already on the page for the tile above; the eight rows come from
 * `getApplications({ ...scopeOpts, status: 'referencing' })`. Taking N from
 * the tile would have compared two different questions, so the table now
 * holds the whole scoped set and slices it.
 *
 * AND THE LINK IS NOT THE ONE IN THE CARD HEAD. "View all applications" there
 * clears every filter, deliberately -- Matt, 2026-10-02, "'View all
 * applications' clears them all" -- so it cannot double as the way to the
 * rest of THIS cohort. The new one carries `status=referencing`, which is the
 * filter the eight rows already are.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/pages/Home/Home.tsx'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the table', () => {
  it('holds the whole scoped cohort and shows the first eight', () => {
    expect(code).toContain("getApplications({ ...scopeOpts, status: 'referencing' })");
    expect(code).toContain('const needs = needsAll.slice(0, NEEDS_SHOWN);');
    expect(code).toContain('const NEEDS_SHOWN = 8;');
  });

  /* ONE NUMBER, NOT A LITERAL BESIDE A SLICE. The sentence and the slice read
     the same constant, so they cannot disagree about how many are shown. */
  it('and counts the rows it drew, rather than restating the eight', () => {
    expect(code).toContain('{needs.length} of {countOf(needsAll.length, \'application\')} awaiting a decision');
  });

  it('only when there are more than it is showing', () => {
    expect(code).toContain('{needsAll.length > needs.length && (');
  });
});

describe('the link', () => {
  it('opens the same cohort the rows came from', () => {
    expect(code).toContain('to="/applications?status=referencing"');
  });

  /* AND THE HEAD'S LINK IS UNCHANGED, because it answers a different
     question and clearing the filters is its job. */
  it('while the card head still clears every filter', () => {
    expect(code).toContain('to="/applications">View all applications');
  });
});

describe('what it no longer does', () => {
  it('slice silently', () => {
    expect(code).not.toContain(".slice(0, 8)");
  });

  /* N IS NOT THE WHOLE BOOK'S COUNT. That figure is on the page, for the
     tile, and using it here would put an unscoped N beside eight scoped
     rows. */
  it('or take its total from the unscoped tile count', () => {
    expect(code).not.toMatch(/of \{awaitingDecisionCount/);
    expect(code).not.toMatch(/countOf\(awaiting,/);
  });
});
