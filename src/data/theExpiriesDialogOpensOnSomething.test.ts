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

  /* (cv)'s THIRD PART, 2026-10-05. Matt asked for the default to "say
     so"; the note told a reader the book was empty and nothing told
     the reader who DID land somewhere why they had. Shown only where
     the month came from the book, because on the fallback the note is
     the explanation and the two sentences would contradict. */
  it('and says why it opened there when the month came from the book', () => {
    expect(CODE).toContain('Opens on the earliest month with a guarantee expiring.');
    expect(CODE).toContain('{expHasAny && (');
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

/* =====================================================================
   (cv) AND MATT HAS NOW DECIDED IT, 2026-10-05: "keep next month as
   the default. Record the decision and pin it with a test."

   THE RULE HE IS KEEPING, stated here because I owed him the statement
   and the question (cv) asked was "what month does it default to, and
   why?":

       the earliest month that still has a guarantee expiring, FOR THAT
       READER; and where their book has none, the next calendar month,
       with a note naming their earliest if they have one later.

   So "next month" is the default in the sense the dialog's own
   fallback is: where there is nothing to open on, it opens on next
   month rather than on a month in 2027 or on nothing at all.

   THE FALLBACK WAS THE ONLY HALF UNDER TEST. Everything above runs in
   mock mode, where there is no live book, so every assertion was of
   the fallback. The decision to keep the rule is worth nothing if the
   rule itself is unpinned, so these hydrate a book and read the other
   half.
   ===================================================================== */
import { afterAll, beforeEach, vi } from 'vitest';
import { hydrateFull, type FullApp } from './applicationsService';

/* THE LIVE PATH IS BEHIND SUPABASE_ENABLED, and every vitest run is in
   mock mode: nextExpiryMonth returns the fallback before it reads a
   book at all. That is why every assertion above this line is of the
   fallback, and it is why these mock the flag -- the rule Matt kept is
   on the other side of it. */
vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  return { ...actual, SUPABASE_ENABLED: true, sb: () => { throw new Error('no client in this test'); } };
});

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const LINE = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

/* THE SPREAD GOES FIRST and the dates are set after it. Written the
   other way round, `...o` put the caller's `expiry` STRING back over
   the Date built from it, and expiryOf handed exportsService a string
   to call getFullYear on. */
function deed(o: { ref: string; expiry: string } & Partial<FullApp>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0, rent: 2400, fee: 2400, feeBasisWeeks: 4.35, commissionLines: LINE,
    sentAt: D('2026-01-05'), paidAt: D('2026-01-08'), deedAt: D('2026-01-10'),
    tenancyStart: D('2026-02-01'), status: 'deed',
    refunded: false, partiallyRefunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: 'executed', deedSentAt: null, deedViewedAt: null,
    ...o,
    expiry: D(o.expiry),
  } as unknown as FullApp;
}

/* TODAY IS 3 OCTOBER 2026 for all of these, fixed, because "the earliest
   month still ahead" is a statement about a clock. */
const TODAY = new Date(2026, 9, 3);

beforeEach(() => hydrateFull([]));
afterAll(() => hydrateFull([]));

describe('(cv) the rule Matt kept, with a book to read', () => {
  it('opens on the earliest month that still has one', () => {
    hydrateFull([
      deed({ ref: 'GR-LATER', expiry: '2027-03-19' }),
      deed({ ref: 'GR-SOONEST', expiry: '2026-12-02' }),
      deed({ ref: 'GR-MIDDLE', expiry: '2027-01-30' }),
    ]);
    const r = nextExpiryMonth('superadmin', TODAY);
    expect(r.month).toBe('2026-12');
    expect(r.hasAny).toBe(true);
  });

  /* THIS MONTH COUNTS when something expires later in it, which is the
     half "next month" would get wrong: a guarantee expiring on the 28th
     is still ahead of a reader on the 3rd. */
  it('including this month, where something expires later in it', () => {
    hydrateFull([deed({ ref: 'GR-THISMONTH', expiry: '2026-10-28' })]);
    expect(nextExpiryMonth('superadmin', TODAY).month).toBe('2026-10');
  });

  /* AND ONE THAT HAS ALREADY GONE DOES NOT DECIDE THE MONTH. The file
     never lists an expired guarantee, so it must not choose the month
     either, or the dialog opens on a month whose rows are all filtered
     out -- the empty-file complaint in another costume. */
  it('and never on a month whose guarantees have already expired', () => {
    hydrateFull([
      deed({ ref: 'GR-GONE', expiry: '2026-08-11' }),
      deed({ ref: 'GR-AHEAD', expiry: '2027-02-04' }),
    ]);
    expect(nextExpiryMonth('superadmin', TODAY).month).toBe('2027-02');
  });

  /* NOR A CANCELLED ONE. Same reason: the file filters a refunded
     guarantee out, so it cannot be what the dialog opens on. */
  it('and never on a refunded one', () => {
    hydrateFull([
      deed({ ref: 'GR-REFUNDED', expiry: '2026-11-09', refunded: true }),
      deed({ ref: 'GR-REAL', expiry: '2027-04-04' }),
    ]);
    expect(nextExpiryMonth('superadmin', TODAY).month).toBe('2027-04');
  });

  /* AND THE DEFAULT MATT KEPT: a book with nothing ahead opens on next
     month, and says so rather than opening on a month in 2027. */
  it('falls back to next month when nothing is ahead at all', () => {
    hydrateFull([deed({ ref: 'GR-OLD', expiry: '2026-07-01' })]);
    const r = nextExpiryMonth('superadmin', TODAY);
    expect(r.month).toBe('2026-11');
    expect(r.hasAny).toBe(false);
  });
});
