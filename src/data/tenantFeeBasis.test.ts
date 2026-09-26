/* THE CLIENT AND THE EMAIL MUST AGREE ABOUT WHAT A FEE IS.

   The same arithmetic exists twice on purpose: once in
   supabase/functions/_shared/emailTemplates.ts, which runs on Deno and cannot be
   imported into the browser bundle (its layout module reaches for Deno.env), and
   once in src/data/tenantFeeBasis.ts for the screens. Two copies is a drift risk,
   so this file imports BOTH and asserts they return the same answer on the same
   numbers. If somebody changes one, this goes red.

   Importing the Deno module HERE is fine and is the point: vitest can load it
   (the templates themselves touch no Deno API), and a test is not the browser
   bundle. It is client CODE that must not import it. */
import { describe, expect, it } from 'vitest';
import { tenantFeeBasis, tenantFeeBasisPhrase, tenantFeeBasisWeeks } from './tenantFeeBasis';
import {
  feeBasisPhrase as emailPhrase, feeBasisWeeksOf as emailWeeks,
} from '../../supabase/functions/_shared/emailTemplates';

/** Real numbers off dev: GR-20837, and a 50/50 joint on a £2,400 tenancy. */
const CASES: [string, number | null, number | null][] = [
  ['GR-20837, three weeks', 692.31, 1000],
  ['standard terms, one month', 2000, 2000],
  ['five weeks', 1153.85, 1000],
  ['a joint share against the share', 346.15, 500],
  ['a joint share on a bigger tenancy', 923.08, 2400],
  ['no fee recorded', null, 1000],
  ['no rent to measure against', 692.31, 0],
  ['both missing', null, null],
  ['a fee that is not a whole number of weeks', 800, 1000],
];

describe('the two implementations agree', () => {
  for (const [name, fee, base] of CASES) {
    it(name, () => {
      expect(tenantFeeBasisWeeks(fee, base)).toEqual(emailWeeks(fee, base));
      expect(tenantFeeBasis(fee, base)).toEqual(emailPhrase(emailWeeks(fee, base)));
    });
  }
});

describe('what a tenant is told', () => {
  it('names three weeks on the reported referral', () => {
    expect(tenantFeeBasis(692.31, 1000)).toBe('3 weeks of rent');
  });

  it('still calls a month a month', () => {
    expect(tenantFeeBasis(2000, 2000)).toBe('one month of rent');
  });

  /* THE MANUFACTURED MONTH. Every surface computing a basis takes the fee and the
     rent; several of them fall back to the rent when fee_amount is null, because
     they have to show a figure. If the BASIS took that fallback too, rent over
     rent is exactly 52/12 weeks and the page would state "one month of rent" as a
     verified fact about a row that never recorded a fee. Callers pass the raw
     fee_amount for this reason, and a null fee has to answer null. */
  it('says nothing when no fee was recorded, rather than inventing a month', () => {
    expect(tenantFeeBasis(null, 1000)).toBeNull();
    expect(tenantFeeBasis(0, 1000)).toBeNull();
    // And the trap itself: passing the rent as the fee IS a month, which is why
    // the fallback must never reach this function.
    expect(tenantFeeBasis(1000, 1000)).toBe('one month of rent');
  });

  it('measures a share against the share, not the tenancy', () => {
    // £346.15 of a £2,400 tenancy is 3 weeks of this tenant's £500 share, and
    // 0.75 weeks of the whole rent. The second is the discount every joint tenant
    // would appear to be on.
    expect(tenantFeeBasis(346.15, 500)).toBe('3 weeks of rent');
    expect(tenantFeeBasis(346.15, 2400)).not.toBe('3 weeks of rent');
  });

  it('does not round a basis the agreement does not state', () => {
    // 800 on 1000 is 3.47 weeks. Rounding it to 3 would state a band nobody
    // agreed; two decimals is uglier and true.
    expect(tenantFeeBasis(800, 1000)).toBe('3.47 weeks of rent');
  });

  it('is null for a nonsense basis rather than throwing', () => {
    expect(tenantFeeBasisPhrase(null)).toBeNull();
    expect(tenantFeeBasisPhrase(0)).toBeNull();
    expect(tenantFeeBasisPhrase(-2)).toBeNull();
  });
});
