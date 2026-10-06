/* THE LEADERBOARD'S SENTENCE AND ITS ORDER AGREE.
 *
 * Matt, 2026-10-04: 'it says "How you rank... by referrals sent" but ranks by
 * fees collected (Rosa Vance, 4 referrals, is 2nd behind Joe Joe's 3). Rank
 * by what the description says, or change the description to match; keep it
 * consistent with the Referrers tab admins see.'
 *
 * A SOURCE TEST, NOT A RENDER TEST, and deliberately. What went wrong was not
 * that a component rendered the wrong string: it was that a string in one
 * file described an ordering implemented in another, and nothing connected
 * them. Rendering the page would prove the sentence is on screen; it would
 * not prove the sentence is TRUE. So this reads both files and asserts they
 * cannot drift apart silently: the board must claim fees, and the ordering
 * must still be by fees. If somebody reorders groupRows to volume, the second
 * assertion fails and points at the sentence that needs rewriting with it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('the referrer leaderboard says how it actually ranks', () => {
  const page = read('src/pages/League/League.tsx');

  it('no longer claims to rank by referrals sent', () => {
    // The old sentence, which the board contradicted on screen.
    expect(page).not.toContain('by referrals sent in the selected period.');
  });

  it('says fees first, which is what it does', () => {
    for (const scope of ['at your branch', 'across your whole company']) {
      const line = page.split('\n').find((l) => l.includes(scope) && l.includes('How you rank'));
      expect(line, `the ${scope} sentence is still there`).toBeTruthy();
      expect(line).toContain('guarantee fees collected');
      // The tie-break is named, because it is what separates two people on
      // equal fees and is the half a reader can check against the table.
      expect(line).toContain('then by referrals sent');
    }
  });

  it('and the ordering it describes is still the one implemented', () => {
    /* groupRows is the single ordering for every board in the League,
       including the Referrers tab an admin reads. Matt's "keep it consistent
       with the Referrers tab admins see" is the reason the fix was the
       sentence and not the sort: reordering this one view would give a
       Negotiator and their Director two different leagues of one branch. */
    const live = read('src/data/liveAnalytics.ts');
    /* THE COMPARATOR ITSELF, not a mention of the word "fees" somewhere near
       it. My first version of this assertion matched /fees/i over the whole
       function and would have passed on a comment, which is the same class
       of mistake as the sentence it is here to guard. */
    const cmp = 'y.fees - x.fees || y.refs - x.refs || x.name.localeCompare(y.name)';
    expect(live, 'the league comparator is still fees, then referrals, then name').toContain(cmp);
  });
});
