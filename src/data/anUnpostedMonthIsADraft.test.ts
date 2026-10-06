/* AN UNPOSTED MONTH IS A DRAFT, AND HAS NO REFERENCE.
 *
 * Matt, 2026-10-03, with a screenshot of an October statement carrying
 * STMT-2026-10-0001: "Statements for a month not yet posted (e.g. October 2026
 * today): label them 'Draft: month in progress, figures may change' on screen
 * and in exports, and don't show a reference even if one was assigned before
 * the reference fix."
 *
 * 20261007650000 stopped READING from minting, which fixed everything from
 * that moment and left behind the numbers already taken -- three on dev,
 * including October's, minted on 26 September when somebody opened a month
 * that had not ended. 20261007770000 makes POSTEDNESS the test rather than
 * existence: `commission_statement_sends` records a statement actually sent,
 * and only that is a fact about the world.
 *
 * TWO SENTENCES FOR ONE STATE, deliberately, because a reader needs both
 * answers. `REFERENCE_ON_POST` says why there is no number;
 * `draftLabel` says the figures underneath are still moving, which is the one
 * that stops a finance team filing a total that will change.
 *
 * AND A MONTH THAT HAS ENDED IS NOT "IN PROGRESS". Matt's wording describes
 * the current month, which is his example. The same state exists for a past
 * month the run has not posted -- two of September's five payees on dev --
 * and telling somebody September is in progress on 3 October would be false.
 * His words are kept exactly for the current month; the other case says what
 * is true instead.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAFT_IN_PROGRESS, DRAFT_NOT_POSTED, REFERENCE_ON_POST,
  draftLabel, isPostedReference,
} from './exportsService';

/* Test mode's clock is fixed at 2026-06-26, so June is the current month. */
const CURRENT = '2026-06';
const PAST = '2026-04';
const FUTURE = '2026-08';

describe('a posted statement', () => {
  it('has a reference and is not a draft', () => {
    expect(isPostedReference('STMT-2026-05-0001')).toBe(true);
    expect(draftLabel('2026-05', 'STMT-2026-05-0001')).toBeNull();
  });
});

describe('an unposted statement', () => {
  /* THE SENTINEL IS NOT A REFERENCE, which is what stops a filename, a sort
     key or a draft test treating it as one. */
  it('reads as unposted however the reference field is filled', () => {
    expect(isPostedReference(REFERENCE_ON_POST)).toBe(false);
    expect(isPostedReference('-')).toBe(false);
    expect(isPostedReference('')).toBe(false);
  });

  it('in the current month says the month is in progress, in Matt’s words', () => {
    expect(draftLabel(CURRENT, REFERENCE_ON_POST)).toBe(DRAFT_IN_PROGRESS);
    expect(DRAFT_IN_PROGRESS).toBe('Draft: month in progress, figures may change');
  });

  /* A MONTH THAT HAS ENDED IS STILL A DRAFT UNTIL IT IS POSTED, and saying
     "in progress" about it would be false. */
  it('in a past month says it is not posted, because it is not in progress', () => {
    expect(draftLabel(PAST, REFERENCE_ON_POST)).toBe(DRAFT_NOT_POSTED);
    expect(DRAFT_NOT_POSTED).not.toContain('in progress');
  });

  /* A MONTH THAT HAS NOT STARTED is "in progress" rather than "not posted":
     nothing can have been posted for it and nothing is overdue. */
  it('and a future month reads as in progress rather than overdue', () => {
    expect(draftLabel(FUTURE, REFERENCE_ON_POST)).toBe(DRAFT_IN_PROGRESS);
  });

  /* BOTH SENTENCES SAY SOMETHING DIFFERENT. If these ever collapse into one
     string, one of the two questions has stopped being answered. */
  it('and the two sentences are not the same sentence', () => {
    expect(DRAFT_IN_PROGRESS).not.toBe(REFERENCE_ON_POST);
    expect(DRAFT_IN_PROGRESS).toContain('figures may change');
    expect(REFERENCE_ON_POST).toContain('Reference');
  });
});

describe('the exports and the screen read the same helper', () => {
  it('so a statement cannot be a draft in one and final in the other', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    // All three statement exports, and the panel.
    const ex = read('src/data/exportsService.ts');
    expect((ex.match(/draftLabel\(st\.monthKey, ref\)/g) ?? []).length).toBe(6); // 3 sites, twice each
    expect(read('src/components/CommissionStatement.tsx')).toContain('draftLabel(st.monthKey, r)');
  });
});
