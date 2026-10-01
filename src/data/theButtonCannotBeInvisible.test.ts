/* THE EMAIL BUTTON CANNOT BE A BLANK GAP.
 *
 * Matt, 2026-10-01, verbatim: "Commission statement emails: the 'Open
 * your statement' button doesn't render; there's a blank gap above 'If
 * the button does not work'. Fix it for agency and supplier statement
 * emails, and check every other email that has a button."
 *
 * THE CAUSE WAS ONE DECLARATION. The button's colour lived only in
 * `background:` on the <td> -- the shorthand -- while the anchor carried
 * `color:#fff` and no background of its own. Mail clients rewrite and
 * drop CSS, and the `background` shorthand on a table cell is among the
 * first things Gmail drops; the moment it goes, white text sits on a
 * white cell at full height. A button that is invisible and still
 * occupies 43 points IS a blank gap, which is why it read as a
 * rendering fault rather than a missing element.
 *
 * "EVERY OTHER EMAIL THAT HAS A BUTTON" IS ALL OF THEM, AND THAT IS THE
 * USEFUL FINDING. There are fifteen `action:` blocks across the
 * templates -- Pay the guarantee fee, Review and sign, Set up your
 * account, Open your statement, Open Reporting and the rest -- and every
 * one is rendered by the single `action` block in emailLayout's
 * renderHtml. One implementation, so one fix, and this file guards it
 * for all fifteen.
 *
 * WHY A SOURCE TEST. These are Deno edge functions: vitest cannot
 * collect them and emailLayout is imported by modules that reach
 * Deno.env at load. What is asserted is the property that was wrong --
 * whether a single stripped declaration can hide the button.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LAYOUT = resolve(process.cwd(), 'supabase/functions/_shared/emailLayout.ts');
const src = readFileSync(LAYOUT, 'utf8');

/** The source with comments stripped: they quote the old markup on
    purpose, so a grep over the whole file finds what the fix deleted. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

/** Just the action block, which is the only button in the product. */
const action = code.slice(code.indexOf('const action = m.action'), code.indexOf('const fallback'));

describe('the one button every email uses', () => {
  it('exists, so this file is testing something', () => {
    expect(action).toMatch(/<a href=/);
    expect(action.length).toBeGreaterThan(100);
  });

  /* THE ANCHOR CARRIES ITS OWN BACKGROUND. This is the one that makes
     the button survive a cell stripped bare, and it is what was
     missing. */
  it('colours the anchor itself, not only the cell', () => {
    const anchor = action.slice(action.indexOf('<a href='));
    expect(anchor).toMatch(/background-color:/);
  });

  /* AND THE CELL CARRIES IT TWICE: the bgcolor attribute, which predates
     CSS in email and is essentially never stripped, and the longhand,
     which survives where the shorthand does not. */
  it('and the cell carries bgcolor as well as a background-color', () => {
    const cell = action.slice(action.indexOf('<td'), action.indexOf('<a href='));
    expect(cell).toMatch(/bgcolor=/);
    expect(cell).toMatch(/background-color:/);
  });

  /* THE SHORTHAND IS GONE. Keeping it alongside the longhand would be
     harmless, but its absence is what says the fix was understood
     rather than piled on top. */
  it('and no longer relies on the background shorthand', () => {
    expect(action).not.toMatch(/background:\s*\$\{HELIOTROPE\}/);
  });

  /* WHITE TEXT IS ONLY SAFE BECAUSE OF THE ABOVE. Asserted so that
     nobody later removes a background and leaves the colour. */
  it('and white text never stands alone', () => {
    const anchor = action.slice(action.indexOf('<a href='));
    const white = /color:#ffffff|color:#fff\b/.test(anchor);
    if (white) expect(anchor, 'white text with no background of its own').toMatch(/background-color:/);
  });
});

describe('every email button goes through it', () => {
  /* The finding that makes one fix enough. If somebody hand-rolls a
     second button somewhere, this stops being true and the next
     invisible button will not be caught by the file above. */
  it('and nothing hand-rolls another one', () => {
    const fns = resolve(process.cwd(), 'supabase/functions');
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const n of readdirSync(dir)) {
        const p = `${dir}/${n}`;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.ts')) out.push(p);
      }
      return out;
    };
    const offenders = walk(fns)
      .filter((f) => !f.endsWith('emailLayout.ts'))
      .filter((f) => {
        const t = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
        // A button is an anchor styled as a block with padding. An inline
        // text link ("Reset it here") is neither and is fine.
        return /<a href=[^>]*display:\s*inline-block/.test(t);
      });
    expect(offenders, 'a second button implementation would need its own fix').toEqual([]);
  });
});
