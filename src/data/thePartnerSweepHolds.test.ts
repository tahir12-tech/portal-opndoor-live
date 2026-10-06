/* "PARTNER" IS NOT A WORD THE READER USES.
 *
 * Matt (n): 'Sweep all user-facing text (screens, empty states, emails,
 * exports, help) for "partner" and replace it with "supplier" or "agency"
 * as appropriate... Leave internal code names alone.'
 *
 * IT WAS DONE ONCE AND REGREW, which is why this file exists rather than a
 * second sweep. "partner" is the internal name for a ROUTE and is correct
 * in identifiers, in SQL and in our own screens; it is wrong in front of a
 * customer, and the two are a search away from each other. Nothing checked.
 *
 * THE DEV CENTRE IS THE PART THAT MATTERED. A supplier's own Developer
 * reads those pages, and five strings there called their employer "a
 * partner" -- including one offering to revoke "a partner's API key".
 *
 * WHAT THIS DOES NOT POLICE, deliberately: opndoor's own surfaces. Health,
 * the Finance pages and the admin Suppliers screen are read by us, where
 * "partner" is the right word for the thing it names. A guard that swept
 * those too would be a guard somebody turns off.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Pages a customer reads. Not an exhaustive list of the product -- an
 *  exhaustive one would include ours, and the point is the boundary. */
const CUSTOMER_FACING = [
  'src/pages/DevCentre/DevCentre.tsx',
  'src/pages/DevCentre/Configuration.tsx',
  'src/pages/DevCentre/GettingStarted.tsx',
  'src/pages/DevCentre/Sandbox.tsx',
  'src/pages/Pay/PayLanding.tsx',
  'src/pages/Apply/Apply.tsx',
];

const read = (p: string) => {
  try { return readFileSync(resolve(process.cwd(), p), 'utf8'); } catch { return ''; }
};

/** Text a reader actually sees: the contents of JSX text nodes and of
 *  string literals, with identifiers, imports and comments left alone --
 *  "Leave internal code names alone" is half the instruction. */
function visibleText(src: string): string[] {
  const out: string[] = [];
  // Strip block and line comments first: a comment explaining the rule must
  // not fail the rule, which is a mistake this suite has made before.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/>([^<>{}]{4,})</g)) out.push(m[1]);
  for (const m of code.matchAll(/(?:title|placeholder|aria-label|sub|label)="([^"]{4,})"/g)) out.push(m[1]);
  /* ENTITIES ARE DECODED BEFORE THE CODE TEST, and that is not cosmetic.
     The filter below drops anything containing a `;` as code -- and
     `&rsquo;` ends in one, so EVERY sentence with a curly apostrophe was
     thrown away unread. That is most of the copy in this product, and it
     is how "the documentation are for the partner's developers" sat one
     line under a string this very file asserts on and still passed. The
     guard was green because it was not looking. */
  const decoded = out.map((t) => t
    .replace(/&rsquo;|&lsquo;/g, '\u2019')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;|&ndash;/g, '-'));
  /* CODE THAT HAPPENS TO SIT BETWEEN ANGLE BRACKETS IS NOT TEXT. A generic
     like `useState<Partner[]>` and a fragment of a destructuring both match
     the first pattern, and my first run of this reported
     "const [partners, setPartners] = useState" as a customer-facing
     string. A reader's sentence has no `=`, `(` or `;` in it. */
  return decoded.filter((t) => !/[=(){};]/.test(t));
}

describe('no customer-facing screen calls a supplier a partner', () => {
  it.each(CUSTOMER_FACING)('%s', (file) => {
    const src = read(file);
    if (!src) return;
    const offenders = visibleText(src)
      .filter((t) => /\bpartners?\b/i.test(t))
      // "partners@opndoor.co" is a real address, not the word. The same
      // exemption the agency FAQ sweep needed.
      .filter((t) => !/partners@opndoor/i.test(t))
      /* "THE PARTNER API" IS THE API'S NAME, which is what Matt's "leave
         internal code names alone" protects: a supplier's developer reads
         our docs, finds `partner-api` in the URL and the function name, and
         renaming it in prose alone would leave the documentation and the
         thing it documents disagreeing. The sweep is about calling a
         COMPANY a partner. */
      .filter((t) => !/partner API/i.test(t));
    expect(offenders, `${file} still says "partner" to a customer`).toEqual([]);
  });
});

describe('and the Dev Centre in particular', () => {
  /* NAMED, because this is the one a supplier's Developer reads and the one
     the earlier sweep missed entirely. */
  it('calls them a supplier where it used to say partner', () => {
    const dev = read('src/pages/DevCentre/DevCentre.tsx');
    expect(dev).toContain("revoke a supplier's API key");
    expect(dev).toContain("This stops a supplier's integration immediately.");
    expect(dev).toContain("this supplier&rsquo;s API keys");
  });

  it('including the fallback when the name is not resolved', () => {
    expect(read('src/pages/DevCentre/DevCentre.tsx')).toContain("?? 'this supplier'");
  });

  /* THE SENTENCE THE ENTITY HID. It is pinned by hand as well as by the
     sweep, because the sweep only found it once visibleText stopped
     reading `&rsquo;` as code -- and a guard that was blind to most of
     the product's copy should leave behind the one case that proved it. */
  it('and the paragraph whose curly apostrophe hid it from the sweep', () => {
    const dev = read('src/pages/DevCentre/DevCentre.tsx');
    expect(dev).toContain('the documentation are for the supplier&rsquo;s developers');
    expect(dev).not.toContain('for the partner&rsquo;s developers');
  });
});
