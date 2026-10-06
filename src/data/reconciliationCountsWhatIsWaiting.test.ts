/* ONE PAGE, FOUR PLACES STATING ITS TOTAL, THREE OF THEM WRONG.
 *
 * Matt, 2026-10-02, verbatim:
 *
 *   "1. The 'All' tab must include every item from every tab; it
 *       currently says 'Nothing to check' while 'Supplier agencies with
 *       no email' has 2 and 'Not in network' has 1. The top three tiles
 *       must also count what's actually waiting.
 *    2. Home's Reconciliation count and the sidebar badge must equal the
 *       'All' count, including 'Not in network'.
 *    3. Home's Reconciliation link opens on whichever tab has items (or
 *       All)."
 *
 * DEV, MEASURED BEFORE CHANGING ANYTHING: review queue 0, agent matches
 * 0, refund questions 0, supplier agencies with no email 2, not in
 * network 1. Three things waiting, and the All tab said "Nothing to
 * check" over three tiles reading 0, with Home's tile reading 2 and the
 * sidebar badge reading 2.
 *
 * Each of the four had its own arithmetic. The All tab and the tiles
 * counted the review queue; Home and the sidebar counted the review
 * queue plus matches plus the no-email agencies, which was the morning's
 * fix (`f1f98e1`) getting the two kinds it knew about. The sum is the
 * part that was wrong four times, so the sum is the part that must be
 * written once.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  reconciliationTotals, reconciliationLandingTab, NO_RECONCILIATION_WORK,
} from './reconciliationService';

const of = (over: Partial<Record<'review' | 'matches' | 'refunds' | 'noEmail' | 'notInNetwork', number>> = {}) =>
  reconciliationTotals({
    review: { length: over.review ?? 0 },
    matches: Array.from({ length: over.matches ?? 0 }, () => ({ state: 'needs_review' })),
    refunds: { length: over.refunds ?? 0 },
    noEmail: { length: over.noEmail ?? 0 },
    notInNetwork: { length: over.notInNetwork ?? 0 },
  });

describe('what is waiting on reconciliation', () => {
  /* DEV'S OWN STATE, which is the one Matt was looking at. */
  it('counts the two agencies with no email and the one not in network', () => {
    expect(of({ noEmail: 2, notInNetwork: 1 }).all).toBe(3);
  });

  it('and every one of the five kinds', () => {
    expect(of({ review: 1, matches: 2, refunds: 3, noEmail: 4, notInNetwork: 5 }).all).toBe(15);
  });

  /* "Not in network" IS IN IT because he said so in those words. It is
     the one tab that cannot be actioned on the page -- it is a list to
     retype into HubSpot -- and it is still something waiting for a
     person, which is what the number counts. */
  it('including Not in network, which is the one that was argued about', () => {
    expect(of({ notInNetwork: 1 }).all).toBe(1);
  });

  /* THE MATCH QUEUE IS COUNTED BY WHAT IS WAITING, not by what it holds.
     Home counted it this way and the page's own tab counted every row,
     so the two disagreed about one queue before there was one number. */
  it('and counts only the agent matches still needing review', () => {
    const t = reconciliationTotals({
      review: { length: 0 },
      matches: [{ state: 'needs_review' }, { state: 'matched' }, { state: 'dismissed' }],
      refunds: { length: 0 }, noEmail: { length: 0 }, notInNetwork: { length: 0 },
    });
    expect(t.matches).toBe(1);
    expect(t.all).toBe(1);
  });

  it('and nothing waiting is nothing', () => {
    expect(of().all).toBe(0);
    expect(NO_RECONCILIATION_WORK.all).toBe(0);
  });
});

/* =====================================================================
   WHERE A READER LANDS.
   ===================================================================== */
describe('the landing tab', () => {
  it('is the one tab with items when there is exactly one', () => {
    expect(reconciliationLandingTab(of({ matches: 2 }))).toBe('matches');
    expect(reconciliationLandingTab(of({ refunds: 1 }))).toBe('refunds');
    expect(reconciliationLandingTab(of({ noEmail: 2 }))).toBe('noemail');
    expect(reconciliationLandingTab(of({ notInNetwork: 1 }))).toBe('notinnetwork');
  });

  /* ALL WHEN SEVERAL HAVE THEM, because All is where they can be seen
     together -- which is only true now that All holds them. Dev is this
     case: two with no email and one not in network. */
  it('and All when more than one has them', () => {
    expect(reconciliationLandingTab(of({ noEmail: 2, notInNetwork: 1 }))).toBe('all');
  });

  /* THE REVIEW QUEUE HAS NO TAB OF ITS OWN: All is its list. Naming
     'review' would send a reader to a tab that does not exist. */
  it('and All when the only work is the review queue, which All already shows', () => {
    expect(reconciliationLandingTab(of({ review: 3 }))).toBe('all');
  });

  it('and All when there is nothing, rather than inventing a tab', () => {
    expect(reconciliationLandingTab(of())).toBe('all');
  });
});

/* =====================================================================
   AND THE FOUR SURFACES READ IT.

   Asserted against the call sites because the defect was never in the
   arithmetic of any one of them: it was that there were four
   arithmetics. A screen that computes its own sum again is the fault
   coming back, whatever that sum happens to be today.
   ===================================================================== */
const read = (f: string) => readFileSync(f, 'utf8');

describe('every surface that states the total', () => {
  it('the Reconciliation page takes it from the shared function', () => {
    const src = read('src/pages/Reconciliation/Reconciliation.tsx');
    expect(src).toContain('setTotals(reconciliationTotals(');
    expect(src).toContain("{ id: 'all', label: 'All', count: totals.all }");
  });

  /* THE TILES, which read the review queue and so said 0 on dev. The
     first is the page's total; the two beside it say out loud that they
     are of the new records, because a part that does not add up to the
     whole beside it is the "two numbers that cannot both be a total"
     Matt named on Applications. */
  it('and so do the three tiles above it', () => {
    const src = read('src/pages/Reconciliation/Reconciliation.tsx');
    expect(src).toContain('<div className="qstat__n">{totals.all}</div>');
    expect(src).toContain('<div className="qstat__l">Waiting</div>');
    expect(src).toContain('of the {queue.length} new {plural(queue.length');
  });

  it('Home reads it and links at the tab that has the work', () => {
    const src = read('src/pages/Home/Home.tsx');
    expect(src).toContain('n: recon.all');
    expect(src).toContain('to: `/reconciliation?tab=${reconciliationLandingTab(recon)}`');
  });

  it('and the sidebar badge is the same number, not a subset of it', () => {
    const src = read('src/components/layout/Sidebar.tsx');
    expect(src).toContain('const reconcileBadge = recon.all;');
    // The three-term sum it used to add up here.
    expect(src).not.toContain('reconciliationPendingCount() + matchCount');
  });

  /* AND "ALL" SHOWS WHAT IT COUNTS. A tab counting four kinds and
     listing one is the defect in its first form: Matt clicked a number
     and got "Nothing to check". */
  it('and the All tab renders every section that has items', () => {
    const src = read('src/pages/Reconciliation/Reconciliation.tsx');
    for (const section of ['AgencyMatchQueue', 'RefundQuestions', 'NoAgencyEmail', 'NotInNetwork']) {
      const all = src.slice(src.indexOf("{filter === 'all' && ("));
      expect(all, `All does not render ${section}`).toContain(`<${section}`);
    }
  });

  /* AND ITS EMPTY STATE WAITS FOR THE WHOLE PAGE. "Nothing to check"
     over a not-in-network list is the contradiction Matt reported. */
  it('and says nothing is waiting only when nothing is', () => {
    const src = read('src/pages/Reconciliation/Reconciliation.tsx');
    expect(src).toContain('!loading && totals.all === 0');
  });
});
