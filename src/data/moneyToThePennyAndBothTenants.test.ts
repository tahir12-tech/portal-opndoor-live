/* TWO DECIMAL PLACES, THE LINK BESIDE COPY, AND HOW MANY TENANTS.
 *
 * Matt, 2026-10-01, verbatim: "Application detail: money always shows two
 * decimal places (£34,545.60, not £34,545.6), everywhere. Show the
 * payment link next to Copy on joint tenancy applications as on singles.
 * Say 'both tenants' for two, 'all 3 tenants' for three or more."
 *
 * THE TRAILING ZERO IS THE WHOLE OF THE FIRST ONE. toLocaleString drops
 * it, so a fee of £34,545.60 printed as £34,545.6 and read as a different
 * number from the one on the statement beside it.
 *
 * AND THE LINK WAS NOT MISSING, IT WAS NARROW. `min-width: 0` on a flex
 * child lets it shrink to nothing, and a joint tenancy renders this card
 * in the threaded journey column: the Copy button kept its width and the
 * input collapsed, so the row read as a button with nothing to copy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { everyTenant, tenancyProgress } from './tenancyGroups';
import { gbpPence } from '../lib/format';

describe('money on the application detail', () => {
  it('keeps the trailing zero', () => {
    expect(gbpPence(34545.6)).toBe('£34,545.60');
    expect(gbpPence(1000)).toBe('£1,000.00');
  });

  it('and the paid amount goes through that formatter, not toLocaleString', () => {
    const src = readFileSync('src/pages/ApplicationDetail/ApplicationDetail.tsx', 'utf8');
    expect(src).toContain('gbpPence(paymentInfo.paidAmount)');
    expect(src).not.toContain("paymentInfo.paidAmount.toLocaleString('en-GB')");
  });
});

describe('how many tenants', () => {
  it('says both for two', () => {
    expect(everyTenant(2)).toBe('both tenants');
  });

  it('and counts from three', () => {
    expect(everyTenant(3)).toBe('all 3 tenants');
    expect(everyTenant(4)).toBe('all 4 tenants');
  });

  it('and the tenancy line reads as English', () => {
    const g = (n: number) => ({ members: Array.from({ length: n }, () => ({})), fullyPaid: true } as never);
    expect(tenancyProgress(g(2))).toBe('Both tenants have paid');
    expect(tenancyProgress(g(3))).toBe('All 3 tenants have paid');
  });
});

describe('the payment link', () => {
  const css = readFileSync('src/pages/ApplicationDetail/ApplicationDetail.css', 'utf8');
  const rule = /\.pay-link input \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';

  it('cannot shrink to nothing beside the Copy button', () => {
    expect(rule).not.toMatch(/min-width:\s*0\s*;/);
    expect(rule).toMatch(/min-width:\s*1[0-9]{2}px/);
  });

  it('and the row wraps rather than squeezing it', () => {
    const row = /\.pay-link \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(row).toContain('flex-wrap: wrap');
  });
});
