/* FIVE THINGS THE DEAL FORM SAID WRONGLY.
 *
 * Matt, 2026-10-03, verbatim: "Agency commission deal form: 1. Commission by
 * volume: the first row starts at 0 but the plain-English line says
 * 'Referrals 1 to 50'. Start the first row at 1. 2. '1 months' rent' should be
 * '1 month's rent' when the number is 1. 3. The plain-English summary starts
 * lowercase ('any number of tenants…'); capitalise it. 4. 'Standard terms'
 * should say the actual figures: 'No special deal. The tenant pays one month's
 * rent and we pay our standard 10%.' 5. Commission tab: remove '2 rates
 * explicitly set' when both rows say 'Inherits', and remove the 'Set rate'
 * buttons (deals are set with 'Set a deal')."
 *
 * ITEM 1 IS THE ONE WITH A REASON TO BE CAREFUL. The stored lowest tier has to
 * be 0: `agreement_volume` is 0 before the first referral of a period, and on
 * this model the bands carry no rate for an uncovered volume to fall back to.
 * `tierWords` has printed that row as "1" since it was written, deliberately,
 * with a comment telling the next person not to "fix" one of the two. What
 * Matt found is that the FORM showed the raw 0 beside its own sentence saying
 * 1. So the form now reads 1 and `toStoredFrom` puts the 0 back on the way to
 * the database -- the screen and the schema each say it their own way, and the
 * translation is one function with a name.
 *
 * ITEM 5's SECOND HALF IS READ LITERALLY: the "Set rate" button goes, and
 * "Change rate" stays where a rate already exists. A figure somebody can see
 * and cannot correct is worse than either, and the button Matt named is the
 * one that creates a second way to price a party.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dealWords, tierWords, toStoredFrom, feeBasisWords } from './AgreementEditor';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const EDITOR = read('src/pages/Agencies/AgreementEditor.tsx');
const HOME = read('src/pages/Agencies/AgencyHome.tsx');

describe('1. the volume table counts from 1', () => {
  it('seeds its first row at 1, which is what its own sentence says', () => {
    expect(EDITOR).toContain("[{ from: '1', to: '50', rate: '20' }, { from: '51', to: '', rate: '25' }]");
    expect(EDITOR).not.toContain("[{ from: '0', to: '50'");
  });

  it('and a stored 0 is shown as 1 when an existing deal is opened', () => {
    expect(EDITOR).toContain('from: String(Math.max(t.from, 1))');
  });

  /* THE DATABASE STILL GETS ITS ZERO, which is the half that must not break:
     without it the first referral of each period matches no tier. */
  it('while the opening row is stored as 0', () => {
    expect(toStoredFrom('1')).toBe(0);
    expect(toStoredFrom('0')).toBe(0);
    expect(toStoredFrom(1)).toBe(0);
  });

  it('and every row above it is stored as typed', () => {
    expect(toStoredFrom('51')).toBe(51);
    expect(toStoredFrom('2')).toBe(2);
  });

  it('and it is the exact inverse of what the sentence prints', () => {
    expect(tierWords(toStoredFrom('1'), 50)).toBe('1 to 50');
    expect(tierWords(toStoredFrom('51'), null)).toBe('51 and over');
  });

  /* THE REFUSAL SPEAKS THE FORM'S NUMBERS NOW, not the database's: with 1
     translated to 0, the only way to trip it is a lowest row of 2 or more,
     which really is a gap the administrator typed. */
  it('and the refusal names 1, since 0 is no longer a thing anybody types', () => {
    expect(EDITOR).toContain('The lowest volume tier must start at 1');
    expect(EDITOR).not.toContain('The lowest volume tier must start at 0');
  });
});

describe('2. the unit agrees with the number beside it', () => {
  it('reads "month’s rent" against a 1 and "months’ rent" otherwise', () => {
    expect(EDITOR).toContain("{Number(b.weeks) === 1 ? 'month’s rent' : 'months’ rent'}");
    expect(EDITOR).toContain("{Number(b.weeks) === 1 ? 'week’s rent' : 'weeks’ rent'}");
  });

  /* THE SENTENCE ALWAYS HAD THIS RULE. It is the control that did not, which
     is why the standard deal -- the commonest one there is -- read "1 months'
     rent" on the form and "one month's rent" in the summary underneath. */
  it('as feeBasisWords already did', () => {
    expect(feeBasisWords(1, 'months')).toBe("one month's rent");
    expect(feeBasisWords(3, 'weeks')).toBe('3 weeks of rent');
  });
});

describe('3. the summary is a sentence', () => {
  it('so it starts with a capital', () => {
    expect(dealWords([{ min: 1, max: null, weeks: 1, unit: 'months', rate: 0.1 }], []))
      .toMatch(/^Any number of tenants/);
  });

  it('including the share wording and the tiered wording', () => {
    expect(dealWords([{ min: 1, max: null, weeks: 1, unit: 'months', rate: null }],
      [{ from: 0, to: 50, rate: 0.2 }])).toMatch(/^Any number of tenants/);
  });

  it('and nothing agreed still reads as it did', () => {
    expect(dealWords([], [])).toBe('Nothing agreed yet.');
  });
});

describe('4. standard terms says the figures', () => {
  it('in Matt’s words', () => {
    expect(EDITOR).toContain('No special deal. The tenant pays one month’s rent and we pay our standard ${STANDARD_AGENT_PCT}%.');
  });

  it('and not "our usual commission"', () => {
    expect(EDITOR).not.toContain('we pay our usual commission');
  });

  /* ONE CONSTANT, so the sentence and the row the form seeds cannot disagree
     about what the standard is. */
  it('off the same constant the seeded band uses', () => {
    expect(EDITOR).toContain("unit: 'months', rate: STANDARD_AGENT_PCT }]");
  });
});

describe('5. the Commission tab', () => {
  it('counts the rates that are set, not the rows in the table', () => {
    expect(HOME).toContain('const explicit = set.filter((r) => r.rate != null).length;');
    expect(HOME).toContain("sub={explicit\n              ? `${explicit} ${plural(explicit, 'rate')} explicitly set`");
  });

  it('and offers no control at all on an inheriting row', () => {
    expect(HOME).toContain('{r.rate == null ? null : RateLine({');
  });
});
