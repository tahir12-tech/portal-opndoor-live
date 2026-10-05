/* =====================================================================
   ON THE JOURNEY WITH TWO FEES, A REFUND LINE MUST SAY WHICH ONE.

   Matt (du): "on the 'opndoor checks' tenant leaflet, change 'Full
   refund if it falls through' so it says it's a full refund of the
   guarantee fee, not the £20. Check every tenant-facing refund line
   on that journey says the same."

   =====================================================================
   THE COPY WAS TRUE AND BECAME AMBIGUOUS WITHOUT BEING EDITED
   =====================================================================

   "If the tenancy doesn't go ahead, you get a full refund of the fee"
   was exactly right while there was one fee. Adding the GBP 20
   eligibility check to that journey turned it into a promise of money
   the tenant will not get, in a document an agent prints and hands
   over -- and nothing about the sentence changed.

   THAT IS THE GENERAL HAZARD and the reason this file exists rather
   than a one-line edit: the next person to add a charge to a journey
   will not think to re-read every sentence containing the word "fee".
   This one does it for them.

   WHAT THE SWEEP FOUND. Only the leaflet. The refund email already
   says "Your guarantee fee has been refunded" (emailTemplates.ts:750)
   and the payment page already says "The guarantee fee is
   non-refundable from your tenancy start date"
   (PayLanding.tsx:408). Both were written when there was one fee and
   both happen to name it, so both survive -- which is worth recording,
   because it is luck rather than design and the test now makes it
   design.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => (existsSync(join(process.cwd(), p)) ? readFileSync(join(process.cwd(), p), 'utf8') : '');

/** Every tenant-facing surface on the two-fee journey. */
const SURFACES: [string, string][] = [
  ['the eligibility-journey leaflet', 'public/help-docs/opndoor-for-tenants-eligibility.html'],
  ['the refund email', 'supabase/functions/_shared/emailTemplates.ts'],
  ['the payment page', 'src/pages/Pay/PayLanding.tsx'],
  ['the apply journey', 'src/pages/Apply/Apply.tsx'],
];

/* A refund sentence that names no fee. "refund of the fee", "refund
   the fee", "the fee is refundable" -- anything where the only noun is
   a bare "fee". A sentence naming the guarantee fee or the GBP 20 is
   fine, which is the whole point. */
const BARE = /\b(?:full )?refund(?:ed|able)?\s+(?:of\s+)?the\s+fee\b/i;

describe('a refund line on the two-fee journey', () => {
  it.each(SURFACES)('%s names which fee', (_label, path) => {
    const src = read(path);
    expect(src, `${path} is missing`).not.toBe('');
    const sentences = src.split(/(?<=[.!?])\s+|\n/);
    const bare = sentences.filter((t) => BARE.test(t)).map((t) => t.trim().slice(0, 120));
    expect(bare).toEqual([]);
  });

  /* THE LEAFLET SAYS BOTH HALVES, which is the fix Matt asked for:
     the guarantee fee comes back, the GBP 20 does not. Naming only
     the first would leave a reader to assume the second. */
  it('and the leaflet says both halves', () => {
    const leaflet = read('public/help-docs/opndoor-for-tenants-eligibility.html');
    expect(leaflet).toContain('full refund of the <b>guarantee fee</b>');
    expect(leaflet).toContain('&pound;20 eligibility check fee is not refunded');
  });

  /* AND THE ONE-FEE LEAFLET IS LEFT ALONE. On that journey "the fee"
     is unambiguous, and rewriting it would be change for its own
     sake. Asserted so a later sweep does not "tidy" it. */
  it('while the one-fee leaflet is untouched', () => {
    const plain = read('public/help-docs/opndoor-for-tenants.html');
    expect(plain).toContain('full refund of the fee');
  });
});

/* =====================================================================
   (dr1) THE REFERRER GUIDE DESCRIBES ALL THREE ROUTES.

   Matt: "don't just hide things. For 'applies its own criteria' and
   'opndoor checks', the Referrer guide, tenant leaflet and status
   FAQs must describe that route's actual journey (decision or
   eligibility step before payment), not drop the material. The
   current guide tells them 'Press Send and the tenant gets a secure
   link to pay', which is wrong for those routes."

   ONE GUIDE, THREE ROUTES, rather than three guides. The guide is a
   static file served to every reader, so it cannot know which setting
   its reader is on; what it CAN do is stop asserting one route as
   though it were the only one. A reader on any of the three now finds
   their own journey named, and the Overview tells them which is
   theirs.

   THE STATUS TABLE HAD THE SAME HOLE. It listed Sent, Paid, Awaiting
   signature and Deed issued, and no Awaiting decision -- a status two
   of the three routes pass through on every referral.
   ===================================================================== */
describe('the Referrer guide', () => {
  const guide = read('public/help-docs/referrer-guide.html');

  it('no longer asserts the straight-to-payment route as the only one', () => {
    expect(guide).not.toContain('Press <b>Send</b> and the tenant gets a secure link to pay.');
    expect(guide).toContain('What happens next depends on how tenants are checked');
  });

  it.each([
    ['accepts them as sent', 'secure link to pay the guarantee fee straight away'],
    ['applies its own criteria too', 'Awaiting decision'],
    ['opndoor checks tenants itself', '&pound;20 per tenant'],
  ])('names the %s route and what happens on it', (_setting, phrase) => {
    expect(guide).toContain(phrase);
  });

  /* THE GBP 20 SAYS THE SAME THREE THINGS HERE AS EVERYWHERE ELSE,
     because a reader who meets the figure in two documents and two
     descriptions of it believes neither. */
  it('and states the three GBP 20 facts in the same words', () => {
    expect(guide).toContain('&pound;20 per tenant');
    expect(guide).toContain('does not come off it');
    expect(guide).toContain('is not refunded in any case');
  });

  it('and the status table admits Awaiting decision exists', () => {
    expect(guide).toContain('<b>Awaiting decision</b>');
  });
});

/* =====================================================================
   (dr3) THE CARVED-SHARE LINE, EXPLAINED IN THE PORTAL'S OWN WORDS.

   Matt: "Supplier Management guide: explain the 'Your agencies'
   share, included above for you to pass on' line on their screen and
   statement, in the same words the portal uses."

   "IN THE SAME WORDS" IS THE WHOLE INSTRUCTION, and it is why this
   test reads the constants rather than the sentences. A guide that
   paraphrased the label would send a supplier looking for a line
   that does not exist under that name. The four phrases are
   whoPaysTheAgency's exported constants -- the same strings the tile
   and the statement render -- so if anybody rewords the product, this
   fails until the guide is reworded with it.
   ===================================================================== */
describe('the Management guide on the carved share', () => {
  const guide = read('public/help-docs/management-guide.html');

  it.each([
    ['OWED_TO_YOU'],
    ['PASSED_ON_BY_SUPPLIER'],
    ['PAID_DIRECT_BY_OPNDOOR'],
    ['TOTAL_ON_YOUR_REFERRALS'],
    ['PAYABLE_TO_YOU'],
  ])('quotes the portal’s own %s label', async (name) => {
    const mod = await import('@/data/whoPaysTheAgency');
    const phrase = (mod as unknown as Record<string, string>)[name];
    expect(phrase, `${name} is not exported`).toBeTruthy();
    // The guide is HTML, so the curly apostrophe is an entity there.
    const asHtml = phrase.replace(/’/g, '&rsquo;');
    expect(guide.includes(phrase) || guide.includes(asHtml), `${name}: "${phrase}"`).toBe(true);
  });

  /* THE ARITHMETIC, WHICH IS THE POINT OF THE SECTION. A supplier who
     adds the two figures invoices us twice for the same money. */
  it('and says plainly that the carved share is already inside the figure above it', () => {
    expect(guide).toContain('already inside');
    expect(guide).toContain('counts the same money twice');
  });

  it('and that a month can show both, because it is frozen per referral', () => {
    expect(guide).toContain('fixed on each referral');
  });
});

/* =====================================================================
   (ds) THE AGENT ONE-PAGER IS AN HTML GUIDE NOW.

   Matt: "The Sales and conversation guide and the Agent one-pager
   open as PDFs in the browser's PDF viewer, while every other guide
   opens as an HTML page in the modal with the Save as PDF button.
   Rebuild both as HTML guides in the same template as the Management
   guide ... keeping their content, with the commission fix from my
   last message applied."

   READ FROM RENDERED PAGES, NOT EXTRACTED TEXT. Three extraction
   attempts corrupted the digits -- the cap came out "GBP 12f,fff" --
   because the PDF uses subset fonts whose text is glyph codes.
   Rendering each page to an image and reading it sidesteps the
   encoding, which is what Matt proposed and what worked.

   EVERY FIGURE CROSS-CHECKED against the rendered page AND the
   landlord guide, which is the safeguard that makes a visual read
   safe: 12 months, GBP 120,000, GBP 10,000 all agree.
   ===================================================================== */
describe('the agent one-pager', () => {
  const page = read('public/help-docs/opndoor-for-letting-agents.html');

  it('is an HTML guide in the management template', () => {
    expect(page, 'the HTML one-pager is missing').not.toBe('');
    expect(page).toContain('class="printbtn" onclick="window.print()"');
    expect(page).toContain('lockup__mark');
  });

  /* THE FIGURES, each one read off the render and each one matching
     the landlord guide. If either source changes, this fails. */
  it.each([['12 months'], ['&pound;120,000'], ['&pound;10,000 of legal costs']])(
    'carries %s, as the rendered page and the landlord guide both say', (figure) => {
      expect(page).toContain(figure);
      const landlord = read('public/help-docs/opndoor-for-landlords.html');
      const bare = figure.replace('&pound;', '').replace(' of legal costs', '');
      expect(landlord, `the landlord guide does not agree about ${figure}`).toContain(bare);
    });

  /* (dr2) THE COMMISSION IS GONE. The original led on "10% commission
     to your agency", carried a 10% stat tile and repeated it in the
     plain-English box: a rate that is per agreement, stated as a
     fixed number, in a flyer handed to an agency that may be on a
     different one. */
  it('states no commission rate', () => {
    /* THE BODY, NOT THE FILE. The template's stylesheet is inherited
       from the Management guide and is full of 50% and 100% widths;
       scanning the whole file reports CSS as copy. The rule is about
       what a reader sees. */
    const body = page.slice(page.indexOf('<body')).replace(/<style[\s\S]*?<\/style>/gi, '');
    expect(body).not.toMatch(/\d+\s?%/);
    expect(body.toLowerCase()).not.toContain('commission to your agency');
  });

  /* AND NOT A FEE BASIS EITHER, for the same reason the FAQs may not
     name one: it is per agreement. The original said "the fee of one
     month's rent". */
  it('and no fee basis, because that is per agreement too', () => {
    expect(page.toLowerCase()).not.toContain("one month's rent");
  });
});
