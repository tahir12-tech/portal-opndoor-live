/* A TENANT COUNT IS NOT A REFERRAL VOLUME, AND THE EDITOR SAYS SO.
 *
 * Matt, 2026-10-01, verbatim: "Commission deal editor: make the choice
 * between pricing by number of tenants and pricing by number of referrals
 * unmistakable, each with a one-line example ("e.g. 1 tenant 3 weeks' rent,
 * 2 tenants 5 weeks'" vs "e.g. first 5 referrals a month at 10%, then
 * 15%"). Warn before saving a tenant band above 4 tenants, since that's
 * almost certainly meant as referral volume."
 *
 * WHY THE TWO ARE CONFUSABLE AT ALL: both controls take small integers and
 * sit next to each other, and the old names described different KINDS of
 * thing -- one said what it varied by, the other said what happened. A 5
 * typed into the wrong one is invisible, prices every referral wrongly, and
 * is frozen onto each as it is created.
 */
import { describe, expect, it } from 'vitest';
import { suspectTenantCounts, TENANT_BAND_WARN_ABOVE } from './AgreementEditor';

describe('which band edges look like a volume', () => {
  it('four is a big household, and allowed without a word', () => {
    expect(suspectTenantCounts([{ min: '1', max: '4' }])).toEqual([]);
  });

  /* FIVE IS WHERE IT STARTS, which is the line Matt drew. */
  it('five is where the warning starts', () => {
    expect(suspectTenantCounts([{ min: '1', max: '5' }])).toEqual([5]);
  });

  it('and the number that is obviously a volume is caught', () => {
    expect(suspectTenantCounts([{ min: '1', max: '50' }])).toEqual([50]);
  });

  it('on either edge of the band, since either can be typed', () => {
    expect(suspectTenantCounts([{ min: '51', max: '' }])).toEqual([51]);
  });

  /* EVERY ONE, and each named once: the dialog lists them, and a reader
     checking their own typing wants all of them, not the first. */
  it('and every distinct one across every band', () => {
    expect(suspectTenantCounts([
      { min: '1', max: '4' }, { min: '5', max: '50' }, { min: '51', max: '' },
    ])).toEqual([5, 50, 51]);
  });

  /* AN OPEN-ENDED TOP BAND IS THE NORMAL SHAPE -- "3 or more" -- and must
     not be warned about for having no maximum. */
  it('but an open-ended band is not suspicious for being open', () => {
    expect(suspectTenantCounts([{ min: '3', max: '' }])).toEqual([]);
  });

  it('and the threshold is the one Matt named', () => {
    expect(TENANT_BAND_WARN_ABOVE).toBe(4);
  });
});
