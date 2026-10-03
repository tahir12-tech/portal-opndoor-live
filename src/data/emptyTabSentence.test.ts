/* AN EMPTY TAB SAYS WHICH TAB.
 *
 * Matt, 2026-10-03: "when a status tab is empty, say which, e.g. 'No direct
 * applications awaiting a decision', instead of 'No applications match your
 * filters', and make the selected tab clearly highlighted."
 *
 * "MATCH YOUR FILTERS" IS TRUE AND USELESS. The reader has just pressed a tab;
 * what they want to know is whether THAT tab is empty, and the old sentence
 * made them look back at seven chips to work out which it meant.
 *
 * A PHRASE PER TAB, NOT THE LABEL. The strip's labels are <Pill> elements and
 * several are adjectives on their own, so dropping one into a sentence gives
 * "No applications Paid". Each tab carries a clause written to follow
 * "applications".
 */
import { describe, expect, it } from 'vitest';
import { emptyTabSentence } from './emptyTabSentence';

describe('a status tab with nothing in it', () => {
  /* MATT'S OWN EXAMPLE, word for word. */
  it('names the origin and the tab', () => {
    expect(emptyTabSentence('referencing', 'direct', false))
      .toBe('No direct applications awaiting a decision.');
  });

  it('and drops the origin when the whole book is in view', () => {
    expect(emptyTabSentence('referencing', null, false))
      .toBe('No applications awaiting a decision.');
  });

  /* THE ADJECTIVE TABS, which are the reason this is a clause map and not
     the label: "No applications Paid" is what reusing the label would give. */
  it('and reads as English on the tabs whose label is an adjective', () => {
    expect(emptyTabSentence('paid', null, false)).toBe('No applications paid.');
    expect(emptyTabSentence('deed', null, false)).toBe('No applications with a deed issued.');
    expect(emptyTabSentence('sent', null, false)).toBe('No applications sent and not yet paid.');
  });
});

describe('the All tab keeps the old words', () => {
  /* Nothing is selected there, so the filters really ARE the only thing that
     can be excluding anything, and naming them is the useful answer. */
  it('because there the filters are the only possible reason', () => {
    expect(emptyTabSentence('all', null, false)).toBe('No applications match your filters.');
    expect(emptyTabSentence('all', 'direct', false)).toBe('No direct applications match your filters.');
  });
});

describe('a search beats everything', () => {
  /* Somebody who has typed a name wants to know the NAME found nothing, not
     which tab they happen to be standing on. */
  it('so the sentence is about the search, whatever the tab', () => {
    expect(emptyTabSentence('paid', 'direct', true)).toBe('Nothing matches that search.');
    expect(emptyTabSentence('all', null, true)).toBe('Nothing matches that search.');
  });
});

describe('a tab nobody has worded yet', () => {
  /* Still reads, and still names the filters rather than pretending to name
     the tab. The same rule changeSentence follows for an unknown field. */
  it('falls back rather than printing its id', () => {
    expect(emptyTabSentence('some-new-tab', null, false)).toBe('No applications match your filters.');
    expect(emptyTabSentence('some-new-tab', null, false)).not.toContain('some-new-tab');
  });
});

describe('the selected tab is visibly selected', () => {
  /* `.ftab.is-active` already paints a dark ground, and every label on the
     strip is a <Pill> carrying its own colour -- whose rule is the more
     specific -- so the text kept its status colour on a dark background and
     the selected tab read as just another one. */
  it('because the active tab makes its pill inherit the button’s colour', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(process.cwd(), 'src/styles/portal.css'), 'utf8');
    expect(css).toContain('.ftab.is-active .pill { color: inherit; }');
    expect(css).toContain('.ftab.is-active { background: var(--valhalla); color: #fff; }');
  });
});
