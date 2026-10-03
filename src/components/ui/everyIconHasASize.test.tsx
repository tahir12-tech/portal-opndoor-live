/* NO ICON RENDERS WITHOUT A SIZE.
 *
 * Matt, 2026-10-03: "the info icon beside the 'Conversion is period
 * throughput' note renders at full page size (same bug as the supplier
 * Overview warning icon). Sweep the whole portal for every icon that can
 * render without a size, give them all a size, and add a check that fails the
 * build if an icon is used without one."
 *
 * =====================================================================
 * WHY THE SWEEP IS ONE LINE IN THE COMPONENT AND NOT 286 CALL SITES
 * =====================================================================
 *
 * `size` was optional and the element went out as `<svg viewBox="0 0 24 24">`
 * with no width and no height when it was omitted. An SVG with a viewBox and
 * no intrinsic size fills its container.
 *
 * 286 of the portal's 340 `<Icon>` usages pass no size, and nearly all of them
 * look right because their CONTAINER is sized by CSS: `.btn svg`,
 * `.sb__link svg`, `.funnel-note svg` and some forty more rules. The two Matt
 * found are the two whose container had no such rule. `.funnel-note svg` sets
 * 14px and `.lt-note svg` set only `flex` and `margin-top`, which is why one
 * copy of the identical sentence was fine and the other filled the card.
 *
 * So the defect is not 286 careless call sites. It is a component whose
 * default was "as big as you like", and the fix is a floor on the component.
 * Stamping a number on all 286 would put a second opinion about size next to
 * every CSS rule that already owns it, and the two would drift the first time
 * a rule changed.
 *
 * WHAT THIS GUARD IS FOR. The floor cannot be felt from a call site, so
 * nothing at a call site would notice it being removed. These tests fail if
 * the default goes, if a name is added that renders nothing, or if the
 * element ever goes out without dimensions again.
 *
 * AND WHY A TEST RATHER THAN A COMPILE ERROR. A required prop WOULD fail
 * `npm run build`, and it is the one shape that cannot coexist with a default
 * -- you can have the floor or the compile error, not both. The floor is worth
 * more: it fixes all 286 at once and cannot be got wrong at a call site. This
 * is the same gate every other portal-wide rule in the repo uses
 * (oneMoneyFormatter, oneDateFormat, theCountsReadAsEnglish).
 */
import { describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Icon, type IconName } from './Icon';

/** Every name the component declares, read off the source so a new one is
 *  covered the day it is added rather than the day somebody remembers. */
function everyIconName(): IconName[] {
  const src = readFileSync(join(process.cwd(), 'src/components/ui/Icon.tsx'), 'utf8');
  const block = src.slice(src.indexOf('export type IconName'), src.indexOf('const PATHS'));
  return [...block.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] as IconName);
}

const svgOf = (el: HTMLElement) => el.querySelector('svg')!;

describe('an icon with no size given', () => {
  it('still goes out with width and height', () => {
    const { container } = render(<Icon name="info" />);
    const svg = svgOf(container);
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    cleanup();
  });

  /* THE WHOLE SET, because the defect was in the shared element and not in
     any one glyph: a name that rendered unsized would be the same page-filling
     bug on whichever screen used it. */
  it('and so does every single icon in the set', () => {
    const names = everyIconName();
    expect(names.length).toBeGreaterThan(40);
    const unsized: string[] = [];
    for (const name of names) {
      const { container } = render(<Icon name={name} />);
      const svg = svgOf(container);
      if (!svg.getAttribute('width') || !svg.getAttribute('height')) unsized.push(name);
      cleanup();
    }
    expect(unsized).toEqual([]);
  });
});

describe('a size that is given', () => {
  it('is used, so nothing that already states one moves', () => {
    const { container } = render(<Icon name="alert" size={14} />);
    expect(svgOf(container).getAttribute('width')).toBe('14');
    cleanup();
  });
});

/* =====================================================================
   AND THE COMPONENT KEEPS ITS FLOOR.

   The two tests above pass if someone deletes the default and adds
   `width={16}` to the one call site they were looking at. This is the rule
   itself: the default is in the signature, and the dimensions are
   unconditional. Both halves, because either one alone brings the bug back --
   a default with a conditional `dims` still omits them when size is
   explicitly `undefined`.
   ===================================================================== */
describe('the component', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/components/ui/Icon.tsx'), 'utf8');

  it('defaults the size in its signature', () => {
    expect(SRC).toMatch(/export function Icon\(\{[^}]*\bsize = \d+/);
  });

  it('and sets width and height unconditionally', () => {
    expect(SRC).toContain('const dims = { width: size, height: size };');
    expect(SRC).not.toMatch(/size != null \? \{ width: size, height: size \} : \{\}/);
  });
});

/* =====================================================================
   THE TWO MATT FOUND, as the regression cases they are.

   Both are "an icon in a note, beside a sentence". They are asserted on the
   stylesheet rather than by rendering, because what was wrong was the absence
   of a CSS rule, and a render test in jsdom does not load the stylesheet --
   the same reason NotInNetwork's own comment gives for not testing its layout
   that way.
   ===================================================================== */
describe('the two notes that were reported', () => {
  it('League’s period-throughput note sizes its icon, as the Dashboard’s does', () => {
    const league = readFileSync(join(process.cwd(), 'src/pages/League/League.css'), 'utf8');
    const dash = readFileSync(join(process.cwd(), 'src/pages/Dashboard/Dashboard.css'), 'utf8');
    const rule = (css: string, sel: string) =>
      css.slice(css.indexOf(`${sel} svg`)).split('}')[0];
    expect(rule(league, '.lt-note')).toMatch(/width:\s*14px/);
    expect(rule(dash, '.funnel-note')).toMatch(/width:\s*14px/);
  });
});
