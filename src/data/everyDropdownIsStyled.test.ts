/* =====================================================================
   NO DROPDOWN RENDERS AS THE OPERATING SYSTEM'S OWN CONTROL.

   Matt, 2026-10-03: "the 'All levels' and 'Any status' filters are unstyled
   browser dropdowns. Use the same styled select as the agency People page, and
   sweep the portal for any other unstyled dropdowns (filters, forms, dialogs)
   and switch them to the shared component."

   THE SWEEP IS EASY AND THE RULE IS THE POINT. There were 49 `<select>`s in
   the product and 24 of them were already right, because `.field select` has
   been styled since the forms were written. That is exactly why this went
   unnoticed for so long: the common case looked fine, and the exceptions were
   the filter bars nobody styles twice.

   WHAT COUNTS AS STYLED, in the order the scan asks:

     a className         `.sel` (the shared look) or a bar's own, which three
                         controls legitimately have -- see the exemptions.
     inside a `<Field>`  `.field select` covers it.
     inside a .field div the same rule, reached through the class rather than
                         the component.

   THE EXEMPTIONS ARE NAMED, NOT PATTERN-MATCHED, so adding one is a decision
   somebody writes down rather than a class name that happens to satisfy a
   regex.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    if (!name.endsWith('.tsx') || name.includes('.test.')) return [];
    return [full];
  });
}

/** Comments stripped: these files explain themselves at length, and several
    of those explanations contain the words `<select>`. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

/* THE THREE THAT KEEP THEIR OWN, each for a stated reason:

   .fchip select     Applications. The select is an invisible overlay on a
                     drawn chip with its own caret; styling it would put a
                     second border and a second arrow inside the first.
   .users-chip select Inline inside a pill that draws its own border.
   .pay__field select The tenant-facing payment page, which has its own
                     stylesheet and is not part of the portal's chrome. */
const EXEMPT_CLASSES = ['fchip', 'users-chip', 'pay__field'];

describe('every dropdown in the portal', () => {
  const files = tsxFiles(ROOT);

  it('found the files, so a broken scan cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.endsWith('PeopleTable.tsx'))).toBe(true);
  });

  it('carries a class, or sits in a Field that styles it', () => {
    const bare: string[] = [];
    for (const f of files) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/<select(?![A-Za-z])[^>]*>/g)) {
        if (m[0].includes('className')) continue;
        const before = src.slice(Math.max(0, m.index! - 1200), m.index!);
        // Inside the <Field> component, or inside a div carrying .field.
        if (before.lastIndexOf('<Field') > before.lastIndexOf('</Field>')) continue;
        if (before.lastIndexOf('className="field') > before.lastIndexOf('</div>')) continue;
        // Or inside one of the three wrappers that style their own.
        if (EXEMPT_CLASSES.some((c) => {
          const at = before.lastIndexOf(`className="${c}`);
          return at >= 0 && at > before.lastIndexOf('</span>') && at > before.lastIndexOf('</div>');
        })) continue;
        bare.push(`${f.slice(ROOT.length + 1)}:${src.slice(0, m.index!).split('\n').length}`);
      }
    }
    expect(bare).toEqual([]);
  });
});

describe('the shared look is defined once', () => {
  const portal = readFileSync(join(ROOT, 'styles/portal.css'), 'utf8');

  it('exists, with the arrow drawn', () => {
    expect(portal).toMatch(/^\.sel \{/m);
    // appearance:none removes the platform arrow; without one of our own the
    // control reads as a text box nobody can type in.
    expect(portal).toMatch(/\.sel \{[\s\S]*?appearance: none/);
    expect(portal).toMatch(/\.sel \{[\s\S]*?background-image: url\("data:image\/svg\+xml/);
  });

  it('and keeps the focus ring every other control has', () => {
    expect(portal).toMatch(/\.sel:focus \{[\s\S]*?box-shadow: 0 0 0 3px rgba\(211,100,251,0\.15\)/);
  });

  /* ONE DEFINITION. The agency People page's own rule was the reference Matt
     pointed at; it is now layout and its selects carry `.sel`, so the two
     cannot come apart. */
  it('and the agency People filters no longer define their own', () => {
    const ah = readFileSync(join(ROOT, 'pages/Agencies/AgencyHome.css'), 'utf8');
    expect(ah).not.toMatch(/\.ah-filters select/);
  });
});
