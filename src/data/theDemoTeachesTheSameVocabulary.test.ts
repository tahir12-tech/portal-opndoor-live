/* =====================================================================
   THE DEMO DOES NOT TEACH A BASIS NOBODY IS ON.

   Matt, 2026-10-05: "Demo mode: change 'of one month's rent' to 'of
   the guarantee fee'."

   THE OLD LABEL WAS TRUE, which is why it survived: the synthetic
   model prices every referral at a month, so "20% of one month's
   rent" described its own figures correctly. The problem is who reads
   it. A demo is shown to a prospect, and analyticsService's own rule
   a few lines above the label says "the demo must not teach a
   different vocabulary" -- while this one taught the basis that (1)
   removed from every shipped document this morning, because Regent is
   three weeks and the documents were wrong for them.

   AND THE NEW WORDS ARE TRUER OF THE LIVE PATH TOO. Commission is a
   percentage of the FEE, whatever the fee happens to be, so "of the
   guarantee fee" is right on every deal rather than right on most.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/data/analyticsService.ts'), 'utf8');

/** Comments out: this file explains itself at length, and the rule is
    about what a READER sees, not about what the source discusses. */
const copy = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n'"`]*\/\/[^\n]*$/gm, ' ');

describe('the demo and mock dashboards', () => {
  it('describe commission as a share of the fee', () => {
    expect(copy).toContain('of the guarantee fee');
  });

  /* THE WHOLE POINT. Any surviving "month's rent" in the copy of this
     file is the demo naming a basis, which is the thing being removed. */
  it('and name no basis at all', () => {
    const offenders = copy
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /month(?:'|’)s rent|weeks of rent/i.test(line))
      .map(([n, line]) => `analyticsService.ts:${n}  ${line.trim().slice(0, 120)}`);
    expect(offenders).toEqual([]);
  });

  /* THE SENTENCE UNDER THE FIGURES went the same way. feeBasisOf says
     "each at its agreed fee basis" for a real book that holds more than
     one; the demo now says the same kind of thing rather than picking
     one basis and stating it. */
  it('and the basis line says the basis is agreed, not what it is', () => {
    expect(copy).toContain("feeBasisCopy: 'at the agreed fee basis'");
  });
});
