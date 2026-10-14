/* =====================================================================
   NO HELP DOCUMENT PRICES THE GUARANTEE FEE.

   Matt, 2026-10-05, item 1: "Help docs telling agents the fee is one
   month's rent (wrong for Regent): every fee mention must follow the
   agency's agreed fee basis or not state one."

   MEASURED ON DEV BEFORE CHANGING ANYTHING. resolve_fee for the first
   branch of all 18 agencies, at GBP 1,000 rent:

       17 agencies   months, 4.35   fee 1000.00   (standard terms)
       Regent's Lettings   weeks, 3.00   fee  692.31

   Regent is the one estate going live on Wednesday, and the documents
   were telling their agents and their tenants a figure GBP 307.69 too
   high. "Usually one month's rent" was true of everyone except the
   only agency it mattered for.

   =====================================================================
   WHY THE DOCUMENTS TAKE THE SECOND HALF OF THE SENTENCE
   =====================================================================

   "Follow the agency's agreed fee basis" is buildable on a screen that
   knows who is reading: the referral form already previews the real
   fee from the server (referral_fee_preview -> resolve_fee), and the
   payment link shows the amount due. It is NOT buildable in a leaflet.
   These documents are static files served to an iframe and printed to
   be handed to a tenant, so the page cannot know whose hand it is in.

   So they state no basis, and instead name WHO will tell the reader
   the number and WHEN. That is the product's own existing rule, not a
   new one: feeBasisOf() in commissionSplit.ts already returns
   kind:'none' with an empty phrase rather than naming a month, "because
   naming a month's rent would be a guess".

   THE PLURAL IS A DIFFERENT CLAIM AND STAYS. "Twelve months' rent" is
   the cover the deed provides, not the price of it. Those five
   landlord-guide claims are Matt's to check against the PandaDoc
   template and are explicitly off limits tonight, so the guard is
   written to catch the singular possessive and leave the plural alone.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DOCS = resolve(process.cwd(), 'public/help-docs');
const HTML = readdirSync(DOCS).filter((n) => n.endsWith('.html')).sort();

/** Entity forms count: the documents write apostrophes as &rsquo; as often
    as they write them literally, and a guard blind to one of them is the
    partner-sweep bug over again. */
const APOS = "(?:'|’|&rsquo;|&#8217;|&#x2019;)";
const PRICES_THE_FEE = new RegExp(
  `month${APOS}s rent`           // "one month's rent", the claim itself
  + `|weeks${APOS}? (?:of )?rent` // "5 weeks of rent", "five weeks' rent"
  + `|week${APOS}s rent`,
  'i',
);

const text = (n: string) => readFileSync(join(DOCS, n), 'utf8');

describe('the shipped help documents', () => {
  it('has documents to check at all, so an empty folder cannot pass', () => {
    expect(HTML.length).toBeGreaterThanOrEqual(10);
  });

  it.each(HTML)('%s states no fee basis', (name) => {
    const hits = text(name)
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => PRICES_THE_FEE.test(line))
      .map(([n, line]) => `${name}:${n}  ${line.trim().slice(0, 140)}`);
    expect(hits).toEqual([]);
  });

  /* THE PLURAL SURVIVES, asserted rather than assumed. If a later edit
     "fixes" the cover claims by deleting them, this fails and says so,
     instead of the guard above quietly passing over a thinner document. */
  it("still makes the twelve months' cover claim it is allowed to make", () => {
    const cover = HTML.filter((n) => /months(?:&rsquo;|'|’) rent/i.test(text(n)));
    expect(cover).toContain('opndoor-for-landlords.html');
    expect(cover).toContain('opndoor-sales-and-conversation-guide.html');
  });
});

/* THE REPLACEMENTS THEMSELVES. The guard above is satisfied by deleting a
   sentence; these pin what went in its place, so a reader is never left
   with no answer to "how much?" -- each one names where the real figure
   appears. */
describe('each document says where the real figure is instead', () => {
  it('the management guide sends a manager to the figure on the referral', () => {
    expect(text('management-guide.html')).toContain(
      'The guarantee fee is the fee agreed with your agency, and agreements differ, so the amount depends on yours. The figure shown against a referral is the one that was agreed for it',
    );
  });

  it('the referrer guide says the amount is on the referral before it is sent', () => {
    expect(text('referrer-guide.html')).toContain(
      'The exact amount is shown on the referral before you send it.',
    );
  });

  /* ALL THREE TENANT LEAFLETS, because (dk) made one per journey and a
     correction applied to two of three is the bug that follows. */
  it.each([
    'opndoor-for-tenants.html',
    'opndoor-for-tenants-decision.html',
    'opndoor-for-tenants-eligibility.html',
  ])('%s tells the tenant who will give them the amount', (name) => {
    expect(text(name)).toMatch(/shown on your payment link before you pay/);
    expect(text(name)).toMatch(/your agent(?:&rsquo;|'|’)s agreement/);
  });
});
