/* =====================================================================
   THE EXPIRIES DIALOG OPENS ON A MONTH THAT HAS SOMETHING IN IT.

   Matt, 2026-10-03: "Expiries dialog (agency and supplier views): say 'Your
   agency's guarantees only' (or 'your company's' for suppliers) instead of
   'Your partner only', and 'Management get this list by email six weeks before
   the month begins' instead of 'receive this cohort'. Open on the next month
   that has any guarantees expiring; if none, next month, with a note 'Nothing
   expiring yet; your earliest is [month]'."

   IT OPENED ON TODAY PLUS 42 DAYS, which is the six weeks the reminder email
   goes out at and is a reasonable guess at what a renewals operator wants. For
   a new agency it is a month with nothing in it: the reader pressed Download
   and got an empty file, which reads as a broken export rather than as an
   empty cohort.

   "NEXT MONTH" MEANS THE NEXT ONE WITH ANYTHING, not the next calendar month,
   which is why this month counts when something expires later in it. The
   fallback is the next calendar month, and then the note is what tells the two
   kinds of emptiness apart.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextExpiryMonth } from './exportsService';

const PAGE = readFileSync(join(process.cwd(), 'src/pages/Dashboard/Dashboard.tsx'), 'utf8');
/* COMMENTS STRIPPED FOR THE "no longer says" ASSERTIONS, which is a lesson
   this repo has learned twice already: the comment explaining a copy change
   quotes the words it replaced, so a raw scan reads the explanation as the
   change not having happened. The positive assertions read the whole file,
   because a string that only exists in a comment is not shipped either. */
const CODE = PAGE.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the month it opens on', () => {
  /* IN MOCK MODE THERE IS NO LIVE BOOK, which is the fallback path, and it is
     worth asserting because every vitest run is in it: the helper must not
     throw or answer with an empty string where there is nothing to read. */
  it('falls back to next month, and says it has nothing', () => {
    const r = nextExpiryMonth('superadmin', new Date(2026, 9, 3));
    expect(r.month).toBe('2026-11');
    expect(r.hasAny).toBe(false);
    expect(r.earliest).toBeNull();
  });

  it('and rolls the year over in December', () => {
    expect(nextExpiryMonth('superadmin', new Date(2026, 11, 20)).month).toBe('2027-01');
  });

  /* A READER WHO MAY NOT HAVE THE DOCUMENT gets the fallback and no book
     read: `readsTheWholeBook` is the same allowlist the dialog and the button
     are gated on, so this cannot be the thing that leaks a book-wide figure. */
  it('and reads nothing at all for a referrer', () => {
    const r = nextExpiryMonth('referrer', new Date(2026, 9, 3));
    expect(r.month).toBe('2026-11');
    expect(r.hasAny).toBe(false);
  });
});

describe('the dialog', () => {
  /* RESOLVED ON OPEN, NOT AT MOUNT, which is the bug the obvious
     implementation has: the book is hydrated after the first render, so a
     month computed in a useState initialiser is the fallback for everybody. */
  it('resolves the month when it opens', () => {
    expect(PAGE).toContain('const n = nextExpiryMonth(role);');
    expect(PAGE).toContain('setExpMonth(n.month);');
  });

  it('and carries the note when there is nothing yet', () => {
    expect(PAGE).toContain('Nothing expiring yet; your earliest is {formatMonth(expEarliest)}.');
    // And a book with no issued deeds at all, where there is no earliest to name.
    expect(PAGE).toContain('Nothing expiring yet. Guarantees appear here once a deed has been issued.');
  });

  /* THROUGH THE ONE MONTH FORMATTER. `oneDateFormat` refuses a hand-rolled
     one and is right to: the first draft of this reached for
     `toLocaleDateString` and the guard caught it. `formatMonth` already takes
     yyyy-mm, which is exactly what the month input holds. */
  it('and names the month through the shared formatter', () => {
    expect(PAGE).toContain('{formatMonth(expEarliest)}');
    expect(CODE).not.toMatch(/toLocaleDateString/);
  });
});

describe('the two sentences', () => {
  /* "partner" IS THE SCHEMA'S WORD for two different kinds of company, and on
     the agency rail it is the HOUSE partner every agency shares -- so "your
     partner only" named Opndoor to the one reader it was written for. */
  it('say whose guarantees, per rail, and never "your partner"', () => {
    expect(PAGE).toContain('"Your company\'s guarantees only."');
    expect(PAGE).toContain('"Your agency\'s guarantees only."');
    expect(CODE).not.toMatch(/Your partner only/);
  });

  it('and say "get this list", not "receive this cohort"', () => {
    expect(PAGE).toContain('Management get this list by email six weeks before the month begins.');
    expect(CODE).not.toMatch(/receive this cohort/);
  });
});
