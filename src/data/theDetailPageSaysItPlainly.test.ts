/* THE APPLICATION DETAIL, THREE THINGS. GR-23853.
 *
 * Matt, 2026-10-03:
 *   1. "'Rent to be guaranteed £23,030.4' must show two decimal places; check
 *       every money figure on this page and the tenant pages."
 *   2. "'names all 2 tenants' should read 'names both tenants' (and 'all 3
 *       tenants' for three or more)."
 *   3. "Delivery panel: after a start-date correction it still shows the old
 *       deed's delivery ... Show the current deed's state ..., with the
 *       earlier delivery listed as superseded."
 *
 * ON (1), AND WHY THERE IS A GUARD AND NOT JUST A FIX. Matt gave this rule on
 * 2026-10-01 -- "money always shows two decimal places (£34,545.60, not
 * £34,545.6), everywhere" -- and only the paid amount was changed then. Bare
 * `toLocaleString` has no MINIMUM fraction digits, so it drops a trailing
 * zero and £23,030.40 reads as £23,030.4 beside a statement that says
 * otherwise. A rule given twice is a rule that needs a test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gbpPence } from '@/lib/format';
import { allOf, countOf } from '@/lib/plural';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('money on the detail page and the tenant pages', () => {
  it('always has two decimal places, including a trailing zero', () => {
    expect(gbpPence(23030.4)).toBe('£23,030.40');
    expect(gbpPence(1500)).toBe('£1,500.00');
    expect(gbpPence(34545.6)).toBe('£34,545.60');
  });

  /* THE GUARD. Every one of these files prints money a tenant or an agent
     reads on the application detail or on the tenant journey, and each of
     them had its own `£${n.toLocaleString(...)}`. The rule is not "use a
     helper" for its own sake: it is that `toLocaleString` without
     minimumFractionDigits silently drops the penny. */
  const TENANT_FACING = [
    'src/data/applicationsService.ts',
    'src/pages/Pay/paymentApi.ts',
    'src/pages/Apply/Apply.tsx',
    'src/pages/Apply/FrontDoor.tsx',
  ];

  it('and no tenant-facing file formats a pound sign by hand', () => {
    const offenders: string[] = [];
    for (const f of TENANT_FACING) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // `£` immediately followed by an interpolation or a JSX expression that
      // calls toLocaleString is the shape that drops the penny.
      if (/£\$\{[^}]*toLocaleString/.test(src) || /£\{[^}]*toLocaleString/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a sentence about how many tenants', () => {
  /* ENGLISH HAS A WORD FOR TWO. "all 2 tenants" is a machine counting. */
  it('says both for two', () => {
    expect(allOf(2, 'tenant')).toBe('both tenants');
  });

  it('and all N for three or more, which is Matt’s own second case', () => {
    expect(allOf(3, 'tenant')).toBe('all 3 tenants');
    expect(allOf(11, 'tenant')).toBe('all 11 tenants');
  });

  /* ONE IS NEITHER. A caller that can reach it is describing one thing, and
     "all 1 tenant" and "both" are each wrong in their own way. */
  it('and the tenant for one', () => {
    expect(allOf(1, 'tenant')).toBe('the tenant');
  });

  /* THE HALF THAT MUST NOT MOVE: countOf is still the plain count, and the
     quantifier is a separate decision. */
  it('while countOf is unchanged, because it answers a different question', () => {
    expect(countOf(2, 'tenant')).toBe('2 tenants');
  });

  it('and the detail page asks for the quantifier, not "all" plus a count', () => {
    const src = read('src/pages/ApplicationDetail/ApplicationDetail.tsx');
    expect(src).toContain("names {allOf(siblings.length, 'tenant')}");
    expect(src).not.toContain("names all {countOf(siblings.length, 'tenant')}");
  });
});

describe('the delivery panel after a correction', () => {
  const src = read('src/pages/ApplicationDetail/ApplicationDetail.tsx');

  /* 20261007640000 already stopped the panel CLAIMING the archived deed's
     delivery. What was left was silence: "Goes to: ..." and nothing about
     why the delivery the reader remembers had gone. */
  it('says the corrected deed is awaiting the tenant’s signature', () => {
    expect(src).toContain("Corrected deed awaiting the tenant&rsquo;s signature");
    expect(src).toContain("delivery.deedState === 'awaiting_tenant'");
  });

  it('and lists the earlier delivery as superseded rather than dropping it', () => {
    expect(src).toContain('Superseded');
    expect(src).toContain('delivery.supersededTo');
    expect(src).toContain('before the correction');
  });

  /* IT READS THE COLUMNS THE CORRECTION WRITES. The panel's RPC had no way
     to see either fact until 20261007710000 widened it. */
  it('and the RPC carries both facts to it', () => {
    const mig = read('supabase/migrations/20261007710000_the_delivery_panel_says_what_is_current.sql');
    expect(mig).toContain('a.deed_state::text, a.deed_delivery_superseded_at, a.deed_delivery_superseded_to');
  });
});
