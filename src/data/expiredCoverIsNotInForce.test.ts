/* =====================================================================
   AN EXPIRED GUARANTEE IS NOT IN FORCE, AND THE FIGURE IS TWELVE
   MONTHS, NOT WHAT IS LEFT OF THEM.

   Matt (dm): "Confirm 'Guaranteed rent in force' excludes deeds past
   their expiry date (not only cancelled ones), on screen, in exports
   and the bordereau. Show me with a test that moves a deed's expiry
   into the past. Also say whether the figure is the full 12 months'
   guaranteed rent or what remains, and label it accordingly."

   BOTH HALVES ANSWERED HERE, and they are different kinds of answer.

   THE FIRST IS A FACT and this file proves it: `inForceDuring` ends a
   guarantee at `coverEnds`, which is the stored expiry or a year less
   a day from the tenancy start, and asks `ends >= start` of the
   period. A deed whose year is over fails that for any later window.
   One rule, read by the tile, the exports and the bordereau alike --
   which is why inForce.ts exists at all: "an insurer's document
   disagreeing with our own reporting is worse than either being wrong
   alone."

   THE SECOND IS A DECISION, and the code has quietly been making it.
   `guaranteedInForce` adds `covered * 12` for every live deed: the
   FULL twelve months, not the months remaining. A guarantee eleven
   months through its year contributes the same as one signed
   yesterday. That is defensible -- it is the exposure WRITTEN, which
   is what an underwriter's bordereau is about -- and it is not what
   "in force" sounds like, which is why the label now says which.

   Nobody chose this in the open, so the test states it rather than
   leaving the next reader to infer it from an arithmetic line.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inForceDuring, coverEnds, guaranteedInForce, type InForceRow } from './inForce';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** A signed, unrefunded, unwithdrawn guarantee. */
const live = (over: Partial<InForceRow> = {}): InForceRow => ({
  deedState: 'executed',
  tenancyStart: d('2025-01-10'),
  expiry: d('2026-01-09'),
  refunded: false,
  withdrawn: false,
  rent: 1000,
  ...over,
});

/* THE WINDOW. A month well after the guarantee above has run out. */
const FROM = d('2026-06-01');
const TO = d('2026-06-30');

describe('a deed whose expiry has passed', () => {
  /* THE TEST MATT ASKED FOR, said in one line: move the expiry into
     the past and it leaves the book. */
  it('is not in force', () => {
    expect(inForceDuring(live(), FROM, TO)).toBe(false);
  });

  it('while the same deed with its expiry ahead still is', () => {
    expect(inForceDuring(live({ expiry: d('2026-12-31') }), FROM, TO)).toBe(true);
  });

  /* AND IT WAS IN FORCE WHEN IT WAS IN FORCE. Excluding an expired
     guarantee from a LATER month must not rewrite the months it
     really ran, or January's bordereau loses business the underwriter
     genuinely carried. */
  it('and is still in force for a month inside its own year', () => {
    expect(inForceDuring(live(), d('2025-06-01'), d('2025-06-30'))).toBe(true);
  });

  /* NO STORED EXPIRY FALLS BACK TO A YEAR LESS A DAY, so a row that
     never had one written back behaves the same. This is the arm that
     would silently keep old guarantees on the book forever if it
     defaulted to "no end". */
  it('and one with no stored expiry still ends a year after it started', () => {
    const noExpiry = live({ expiry: null });
    expect(coverEnds(noExpiry)?.getFullYear()).toBe(2026);
    expect(inForceDuring(noExpiry, FROM, TO)).toBe(false);
  });

  /* IT IS NOT ONLY CANCELLED ONES, which is Matt's parenthesis: this
     deed is executed, unrefunded and unwithdrawn. Nothing but the
     date takes it off. */
  it('and nothing about it is cancelled, refunded or withdrawn', () => {
    const a = live();
    expect(a.deedState).toBe('executed');
    expect(a.refunded).toBe(false);
    expect(a.withdrawn).toBe(false);
    expect(inForceDuring(a, FROM, TO)).toBe(false);
  });
});

describe('the figure itself', () => {
  /* TWELVE MONTHS PER LIVE DEED, not the months remaining. Stated as
     an assertion because it is a commercial decision sitting inside
     an arithmetic line, and the label on screen now has to match it. */
  it('is twelve months of rent for each guarantee still in force', () => {
    expect(guaranteedInForce([live({ expiry: d('2026-12-31') })], FROM, TO)).toBe(12000);
  });

  it('and is the same whether the year has one month left or eleven', () => {
    const nearlyOver = live({ tenancyStart: d('2025-07-10'), expiry: d('2026-07-09') });
    const justStarted = live({ tenancyStart: d('2026-05-10'), expiry: d('2027-05-09') });
    expect(guaranteedInForce([nearlyOver], FROM, TO))
      .toBe(guaranteedInForce([justStarted], FROM, TO));
  });

  /* A JOINT TENANT'S SHARE, NOT THE WHOLE RENT, so a tenancy's deeds
     sum to its rent exactly once. */
  it('and counts a joint tenant on their own share', () => {
    expect(guaranteedInForce([live({ expiry: d('2026-12-31'), shareAmount: 400 })], FROM, TO)).toBe(4800);
  });

  it('and an expired one contributes nothing', () => {
    expect(guaranteedInForce([live()], FROM, TO)).toBe(0);
  });
});

describe('the label', () => {
  /* "LABEL IT ACCORDINGLY". The tile said "Guaranteed rent in force
     (whole book, not affected by the period)", which answers WHICH
     DEEDS and says nothing about how much of each. A reader who
     assumed it was the outstanding exposure would be reading it as
     smaller than it is. */
  it('says the figure is twelve months per guarantee', () => {
    const dash = readFileSync(join(process.cwd(), 'src/pages/Dashboard/Dashboard.tsx'), 'utf8');
    expect(dash).toContain('12 months per live guarantee');
  });
});
