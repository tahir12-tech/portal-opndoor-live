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
    expect(emptyTabSentence('deed', null, false)).toBe('No applications with a deed issued.');
    expect(emptyTabSentence('sent', null, false)).toBe('No applications sent and not yet paid.');
  });
});

/* AND EACH CLAUSE DESCRIBES THE SET, NOT THE TAB'S NAME.
 *
 * Matt, 2026-10-03, verbatim: "the Paid tab should say 'No [direct]
 * applications paid and waiting for a deed', not 'No … applications paid'.
 * Check each tab's empty message matches exactly what that tab holds."
 *
 * This corrects what the test above asserted when the file was written the
 * same morning: naming the tab is not describing the set. Three clauses were
 * wrong by that test, and each one is wrong in the same direction -- it
 * described a SUPERSET, which is the kind of sentence that reads as false
 * when the neighbouring tab has rows in it.
 */
describe('each clause against its own filter', () => {
  /* Paid is `status = 'paid'`, and a deed has its own status, so this tab
     holds what has paid and has NOT got a deed. Matt's sentence. */
  it('Paid is paid and waiting for a deed, not paid', () => {
    expect(emptyTabSentence('paid', null, false)).toBe('No applications paid and waiting for a deed.');
    expect(emptyTabSentence('paid', 'direct', false)).toBe('No direct applications paid and waiting for a deed.');
  });

  /* `awaitingSignature` is deed_state = 'awaiting_tenant': the deed is with
     the TENANT. "Awaiting signature" did not say whose, and on a joint
     tenancy that is the question. */
  it('Awaiting signature says who is signing', () => {
    expect(emptyTabSentence('awaiting', null, false))
      .toBe('No applications waiting for a tenant to sign their deed.');
  });

  /* 'failed' means the deed WAS sent and the address bounced; a row with
     nobody to send to is 'cannot_deliver' and is the other tab. The two
     clauses used to describe one state between them. */
  it('Delivery failed is a send that did not arrive, not one that never went', () => {
    expect(emptyTabSentence('delivery-failed', null, false))
      .toBe('No applications whose signed deed was sent and did not arrive.');
    expect(emptyTabSentence('cannot-deliver', null, false))
      .toBe('No applications with nowhere to send the deed.');
  });

  /* THE TWO TABS THAT SHARE A FILTER, worded from two directions, and both
     true of it: `sent` and `fee-unpaid` are both `status = 'sent'`. One tab
     is the funnel step, the other is the chase list. */
  it('while Sent and Fee unpaid are one filter said two ways, both true', () => {
    expect(emptyTabSentence('sent', null, false)).toBe('No applications sent and not yet paid.');
    expect(emptyTabSentence('fee-unpaid', null, false)).toBe('No applications waiting on the guarantee fee.');
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
