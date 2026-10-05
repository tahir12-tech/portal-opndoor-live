/* =====================================================================
   (oo) PRINT STYLES: NO BROWSER FURNITURE, AND ONE PAGE STAYS ONE PAGE.

   Matt: "'Save as PDF' on the help leaflets and guides: the PDF
   includes the browser's own header and footer (date, page title,
   localhost address) and the one-page tenant leaflet spills onto two
   pages. Set the print styles so no browser header or footer appears,
   and one-page leaflets fit on one A4 page."

   =====================================================================
   MEASURED, NOT ESTIMATED
   =====================================================================

   Chrome is on this machine, so every document was printed headlessly
   and its pages counted, before and after. Page counts are a fact and
   there was no reason to guess at them:

       document                        before   after
       opndoor-for-tenants                  2       1
       opndoor-for-tenants-decision         2       1
       opndoor-for-tenants-eligibility      3       1
       referral-checklist                   2       2
       opndoor-for-letting-agents           3       3
       management-guide                     -       4
       referrer-guide                       -       4
       opndoor-admin-guide                  -       2
       opndoor-for-landlords                -       2
       sales-and-conversation-guide         -       7

   THE FIRST ATTEMPT MOVED ALMOST NOTHING, and the reason is worth
   keeping: the leaflets' own type is in PIXELS. Setting the print body
   to 9.3pt left .lead, .card p, li and the stat labels exactly as they
   were, because each carries its own px size. The sizes that actually
   set the height are the px ones.

   THE HEADER AND FOOTER ARE PRINTED INTO THE PAGE MARGIN by Chrome, so
   the only way to be rid of them from a stylesheet is to have no page
   margin: `@page{margin:0}`, with the ink keeping its margin from the
   sheet's own padding. A reader who has ticked "Headers and footers" in
   the print dialog can still turn them back on, which is theirs to do
   and not something CSS can or should override.

   AND THE ONE THAT IS THREE PAGES IS CALLED A GUIDE NOW. Matt,
   2026-10-05: "don't cut content. Rename it 'Agent guide' everywhere
   it's listed." So `opndoor-for-letting-agents.html` is not in the
   one-page list below and is not meant to be: three A4 pages is what
   a guide is. Its shelf entry, its type chip and its own <title> all
   say guide.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DOCS = resolve(process.cwd(), 'public/help-docs');
const HTML = readdirSync(DOCS).filter((n) => n.endsWith('.html')).sort();
const text = (n: string) => readFileSync(join(DOCS, n), 'utf8');

const LEAFLETS = [
  'opndoor-for-tenants.html',
  'opndoor-for-tenants-decision.html',
  'opndoor-for-tenants-eligibility.html',
];

describe('no browser header or footer', () => {
  it.each(HTML)('%s prints to a page with no margin for Chrome to write in', (name) => {
    expect(text(name)).toContain('@page{margin:0;size:A4}');
    expect(text(name)).not.toContain('@page{margin:16mm 18mm}');
  });

  /* AND THE INK STILL HAS A MARGIN. @page{margin:0} alone would print
     the text to the edge of the paper, which is a worse document than
     one with a date in the corner. */
  it.each(HTML)('%s keeps its margin as the sheet’s own padding', (name) => {
    expect(text(name)).toContain('.pad{padding:14mm 16mm}');
  });
});

describe('a one-page leaflet', () => {
  /* THE COMPACT BLOCK IS PRINT-ONLY. A leaflet read on a screen scrolls,
     and shrinking it there to suit paper would make the common case
     worse to fix the rarer one. */
  it.each(LEAFLETS)('%s has a print block, and only a print block', (name) => {
    const src = text(name);
    const at = src.indexOf('(oo) A ONE-PAGE LEAFLET IS ONE PAGE');
    expect(at, 'the compact print rules are there').toBeGreaterThan(0);
    const after = src.slice(at);
    expect(after.slice(0, after.indexOf('{'))).not.toContain('</style>');
    expect(after).toMatch(/@media print\{\s*\n\s*body\{font-size:8\.6pt/);
  });

  /* THE PIXEL SIZES, which are the ones that set the height. Named
     individually because the first attempt changed only the body and
     moved the page count not at all. */
  it.each(LEAFLETS)('%s overrides the px type that ignores the body size', (name) => {
    const src = text(name);
    for (const rule of ['.card p{font-size:', '.lead{font-size:', '.plain li{font-size:', '.card h3{font-size:']) {
      expect(src.slice(src.indexOf('(oo) A ONE-PAGE LEAFLET IS ONE PAGE'))).toContain(rule);
    }
  });

  /* THE GUIDES ARE NOT LEAFLETS and must not have been shrunk: they are
     read, often on a screen, and four pages of guide is not a defect. */
  it.each(HTML.filter((n) => !LEAFLETS.includes(n)))('%s is left at its own size', (name) => {
    expect(text(name)).not.toContain('body{font-size:8.6pt');
  });
});

describe('the agent guide', () => {
  /* RENAMED RATHER THAN CUT. Matt, 2026-10-05. The file name stays:
     renaming a published path breaks a link somebody may hold. */
  it('is listed as a guide, not as a one-pager', () => {
    const shelf = readFileSync(resolve(process.cwd(), 'src/data/mock/help.ts'), 'utf8');
    expect(shelf).toContain("type: 'Guide', title: 'Agent guide'");
    expect(shelf).not.toContain('Agent one-pager');
    expect(shelf).not.toMatch(/one-page flyer/);
  });

  /* AND ITS OWN TITLE IS ITS OWN. It carried "opndoor management
     guide" from the template it was built from last night, so the
     browser tab and any saved PDF were named after another document. */
  it('and names itself in the browser tab', () => {
    expect(text('opndoor-for-letting-agents.html')).toContain('<title>opndoor agent guide</title>');
  });
});
