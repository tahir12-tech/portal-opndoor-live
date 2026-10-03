/* THE LEAGUE SAYS WHAT EACH COLUMN IS.
 *
 * Matt, 2026-10-01, verbatim: "Agency League (signed in as a Regent
 * Director): every column has a clear heading (Referrals, Fees collected,
 * Paid, Deeds, Sent to paid, Sent to deed); rename the '7d' column to
 * 'Change this week' with a tooltip explaining 'new' and '-'; change
 * 'Every negotiator ranked' to 'Everyone who has referred, ranked';
 * remove 'Agency referral' from the header line."
 *
 * "7d" was how the figure is computed, not what it tells you, and the two
 * things the column prints most often -- the word "new" and a dash -- were
 * explained nowhere on the page.
 *
 * "Agency referral" is the name of the house route an agency sits on. It
 * had already been taken off the scope arm of the eyebrow and was still on
 * the selector arm, which is the one a Director hits.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { introFor } from './League';

const SRC = readFileSync('src/pages/League/League.tsx', 'utf8');

describe('the movement column', () => {
  it('is called what it tells you, not how it is worked out', () => {
    expect(SRC).toContain('>Change this week<');
    expect(SRC).not.toMatch(/>7d</);
  });

  it('and explains its two blanks, which nothing else on the page does', () => {
    expect(SRC).toContain('MOVEMENT_TITLE');
    const title = /const MOVEMENT_TITLE = ([\s\S]*?);\n/.exec(SRC)?.[1] ?? '';
    expect(title).toContain('"new"');
    expect(title).toContain('"-"');
    expect(title).toContain('seven days ago');
  });

  /* BOTH TABLES, because the page draws two and they had the same header. */
  it('on both boards', () => {
    expect(SRC.match(/>Change this week</g)?.length).toBe(2);
  });
});

describe('the opening sentence', () => {
  it('names everyone who has referred, not one level of them', () => {
    expect(introFor([{ id: 'referrer', label: 'Referrers' }] as never))
      .toBe('Everyone who has referred, ranked in full.');
  });

  it('and still lists the boards when there are several', () => {
    expect(introFor([
      { id: 'agency', label: 'Agencies' },
      { id: 'referrer', label: 'Referrers' },
      /* "referrer", NOT "negotiator". Matt, 2026-10-03: "League description:
         'Every agency, branch, referrer and supplier ranked in full.'" The TAB
         was renamed on 2026-10-02 and this sentence was not, so the page
         called one board two things two lines apart. */
    ] as never)).toBe('Every agency and referrer ranked in full.');
  });
});

describe('the columns a Regent Director reads', () => {
  /* HIS LIST, IN HIS WORDS. The two conversion columns were title-cased
     ("Sent to Paid"), which is a different label from the one he asked for
     and the kind of difference that makes a checklist unusable. */
  it('are headed as he named them', () => {
    for (const h of ['Referrals', 'Fees collected', 'Paid', 'Deeds', 'Sent to paid', 'Sent to deed']) {
      expect(SRC, `no column headed ${h}`).toContain(`'${h}'`);
    }
    expect(SRC).not.toContain("'Sent to Paid'");
    expect(SRC).not.toContain("'Sent to Deed'");
  });
});

describe('the header line', () => {
  /* THE RAIL IS NOT A PARTY TO AN AGENCY READER. Both arms of the eyebrow
     are guarded now; the bug was that only one was. */
  it('never names the rail to the agency sitting on it', () => {
    /* The page draws two eyebrows; the one that can name a partner is the
       second. Matched on the partner expression rather than on position,
       so a reordered page cannot make this pass by reading the other. */
    const line = (SRC.match(/<Eyebrow>Performance[\s\S]*?<\/Eyebrow>/g) ?? [])
      .find((l) => l.includes('partnerName')) ?? '';
    expect(line).toContain('!agencyViewer && partner');
    expect(line).toContain('!agencyViewer && !partner');
  });
});
