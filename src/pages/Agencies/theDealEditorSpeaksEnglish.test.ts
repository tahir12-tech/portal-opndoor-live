/* THE COMMISSION DEAL EDITOR SPEAKS ENGLISH.
 *
 * Matt, 2026-10-01, verbatim: "Commission deal editor: rewrite every
 * heading and description in plain English for someone agreeing a
 * commercial deal, with a short example where it helps. No internal
 * terms ('party', 'additive', 'own line', 'coverage', 'fee basis',
 * 'lands at'). For example: 'Fee: what the tenant pays, e.g. one
 * month's rent or 5 weeks' rent'; 'Commission: the % of that fee paid
 * to this agency'; 'Pricing by number of tenants: e.g. 1 tenant pays
 * one month's rent, 2 tenants pay 5 weeks' rent'. Show bands as '1
 * tenant', '2 tenants', '3 or more', and tiers as 'Referrals 1 to 50:
 * 20%, 51 and over: 25%'. Replace 'The next referral lands at' with a
 * plain summary of the whole deal. Explain 'Additive' in one sentence,
 * or hide it if it isn't needed."
 *
 * =====================================================================
 * THE WORDS WERE THE DATA MODEL'S
 * =====================================================================
 *
 * A band is a row with min, max, weeks and unit, and the screen said
 * exactly that: "From 1 To (blank) Fee basis 1 Unit months". Every one
 * of those is the right name for a column in a table and the wrong name
 * for the thing being agreed, which is "1 tenant pays one month's
 * rent". A commercial reader was being shown the storage.
 *
 * THE BANNED LIST IS CHECKED AGAINST THE STRINGS, NOT THE FILE. The
 * comments in this codebase necessarily discuss "additive" and
 * "coverage": those are the stored values and the words the SQL uses,
 * and they have not changed. What changed is what a person reads. So
 * this strips comments first, exactly as the em-dash check does, and
 * looks at what is left.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agreementSummary, dealWords, tenantsWords, tierWords } from './AgreementEditor';
import type { AgreementView } from '@/data/orgService';

const SRC = resolve(process.cwd(), 'src/pages/Agencies/AgreementEditor.tsx');
const code = readFileSync(SRC, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/* WHAT A READER ACTUALLY SEES: string literals and JSX text, with the
   comments gone. Not the whole file.

   `coverage` and `additive` SURVIVE AS CODE -- they are the stored
   values, the state variable and the column the SQL writes -- and
   renaming those would be a migration rather than a wording pass. A
   check that read the whole file would demand it. So this pulls out the
   quoted strings and the text between tags, which is the surface the
   instruction is about. */
function readable(src: string): string {
  const out: string[] = [];
  // Quoted strings and template literals.
  for (const m of src.matchAll(/'([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*"|`([^`\\]|\\.)*`/g)) {
    out.push(m[0]);
  }
  /* JSX TEXT: prose between a > and a <, on one line. The naive form
     (anything between the two) also matches across TypeScript generics
     -- `useState<'additive' | 'all_in'>` ends in a `>` and the next
     `<` is lines away -- which dragged in whole blocks of code and made
     this check fail on identifiers it was never about. So: must start
     with a letter, must not contain the punctuation of an expression. */
  for (const m of src.matchAll(/>\s*([A-Za-z][^<>{}=()|\n]{2,})\s*</g)) out.push(m[1]);
  return out.join('\n');
}

describe('no internal vocabulary reaches the screen', () => {
  /* EACH ONE NAMED SEPARATELY, so a failure says which word came back
     rather than "the regex matched". */
  const BANNED: [string, RegExp][] = [
    ['party', /\bpart(y|ies)\b/i],
    ['additive', /\badditive\b/i],
    ['own line', /\bown line\b/i],
    ['coverage', /\bcoverage\b/i],
    ['fee basis', /\bfee basis\b/i],
    ['lands at', /\blands at\b/i],
  ];

  const SHOWN = readable(code)
    /* The two stored values, as literals. 'additive' and 'all_in' are
       written into the database and read back; they are not words on a
       screen. */
    .replace(/'additive'/g, ' ').replace(/"additive"/g, ' ');

  it.each(BANNED)('the word "%s" is gone', (_word, re) => {
    expect(SHOWN).not.toMatch(re);
  });

  /* THE CHECK CAN FAIL. A regex that matched nothing would pass this
     file for ever. */
  it('and the check would catch one if it were there', () => {
    expect(/\bparty\b/i.test('this party is paid')).toBe(true);
  });
});

describe('a band says who it applies to', () => {
  it('names one tenant, several, and the open-ended top', () => {
    expect(tenantsWords(1, 1)).toBe('1 tenant');
    expect(tenantsWords(2, 2)).toBe('2 tenants');
    expect(tenantsWords(3, null)).toBe('3 or more');
  });

  it('and a range', () => {
    expect(tenantsWords(2, 4)).toBe('2 to 4 tenants');
  });

  /* OPEN-ENDED FROM ONE IS EVERY TENANCY. "1 or more" invites the reader
     to look for the band above it, and on a flat deal there is none. */
  it('and a single open-ended band is every tenancy, not "1 or more"', () => {
    expect(tenantsWords(1, null)).toBe('any number of tenants');
  });
});

describe('a volume step says which referrals', () => {
  it('reads as Matt wrote it', () => {
    expect(tierWords(1, 50)).toBe('1 to 50');
    expect(tierWords(51, null)).toBe('51 and over');
  });

  /* THE STORED LOWEST TIER STARTS AT 0, because agreement_volume is 0
     before the first referral of a period. Nobody agreeing a deal says
     "referrals 0 to 50", so the words start at 1 and the stored number
     does not move. The two differ ON PURPOSE, which is why it is
     asserted rather than left to look like a bug. */
  it('and says 1, not 0, for a tier the database stores as starting at 0', () => {
    expect(tierWords(0, 50)).toBe('1 to 50');
  });
});

describe('the whole deal, in a sentence', () => {
  /* AND IT STARTS WITH A CAPITAL, since 2026-10-03. Matt: "The plain-English
     summary starts lowercase ('any number of tenants…'); capitalise it." The
     sentence is built from a table row, and "any number of tenants" reads
     correctly in the middle of a list and wrongly at the front of a
     paragraph, which is where this is printed. */
  it('a flat deal reads as one price and one commission', () => {
    expect(dealWords(
      [{ min: 1, max: null, weeks: 1, unit: 'months', rate: 0.2 }],
      [],
    )).toBe("Any number of tenants pay one month's rent, and we pay 20% of that.");
  });

  /* A ROW THAT ALREADY STARTS WITH A FIGURE IS UNTOUCHED, which is most of
     them: "1 tenant pays ..." has nothing to capitalise. */
  it('and a deal that opens on a number is unchanged by that', () => {
    expect(dealWords([{ min: 1, max: 1, weeks: 3, unit: 'weeks', rate: 0.2 }], []))
      .toMatch(/^1 tenant pays/);
  });

  /* REGENT'S REAL DEAL, which is what this wording was specified
     against: "1 tenant pays one month's rent, 2 tenants pay 5 weeks'
     rent". */
  /* AND THE VERB AGREES, which Matt's own example shows: "1 tenant pays
     one month's rent, 2 tenants pay 5 weeks' rent". */
  it('a deal priced by tenant count names each one', () => {
    expect(dealWords(
      [
        { min: 1, max: 1, weeks: 3, unit: 'weeks', rate: 0.2 },
        { min: 2, max: null, weeks: 5, unit: 'weeks', rate: 0.25 },
      ],
      [],
    )).toBe('1 tenant pays 3 weeks of rent, and we pay 20% of that; '
      + '2 or more pay 5 weeks of rent, and we pay 25% of that.');
  });

  /* A TIERED DEAL NAMES NO RATE ON THE BAND, because the band does not
     carry one: the tiers do. Saying one would contradict them. */
  it('a tiered deal puts every rate on the volume steps', () => {
    const s = dealWords(
      [{ min: 1, max: null, weeks: 3, unit: 'weeks', rate: null }],
      [{ from: 0, to: 50, rate: 0.2 }, { from: 51, to: null, rate: 0.25 }],
    );
    expect(s).toContain('Any number of tenants pay 3 weeks of rent');
    expect(s).toContain('We pay by volume. Referrals 1 to 50: 20%, 51 and over: 25%.');
    expect(s).not.toMatch(/pay null|NaN|undefined/);
  });

  it('and says something sensible with nothing filled in', () => {
    expect(dealWords([], [])).toBe('Nothing agreed yet.');
  });
});

/* The one-line version, on the Overview tree. Same words, shorter. */
describe('the one-line summary agrees with the sentence', () => {
  const view = (o: Partial<AgreementView>): AgreementView => ({
    agreementId: 'a', scopeLevel: 'agency', coverage: 'additive', period: 'year',
    countingScope: 'agency', isStandard: false, note: null, periodStart: null, volume: 0,
    bands: [], tiers: [], nextRate: null, nextBasis: null, ...o,
  });

  it('both name the tenant counts, and neither says "Agreement:"', () => {
    const a = view({
      bands: [
        { min: 1, max: 1, weeks: 3, unit: 'weeks', rate: 0.2 },
        { min: 2, max: null, weeks: 5, unit: 'weeks', rate: 0.25 },
      ],
    });
    const line = agreementSummary(a)!;
    expect(line).toContain('1 tenant');
    expect(line).toContain('2 or more');
    expect(line.startsWith('Deal:')).toBe(true);
  });
});

/* =====================================================================
   AND IT MAY ONLY OFFER PERIODS THE SYSTEM HAS.

   Found while doing the wording pass: the control offered Month,
   Quarter and Year. Quarter is refused by the check on
   pricing_agreements.period, so choosing it put a raw constraint error
   in front of somebody agreeing a deal; and had it saved,
   agreement_period_start has no quarter arm, so the period start would
   be NULL, the volume count nought for ever, and every referral priced
   at the LOWEST tier on a deal agreed on the opposite basis. Week and
   lifetime, which are both real, were missing.

   the_editor_offers_only_real_periods.test.sql pins the database's
   side. This pins the control's, so the two lists cannot drift apart
   again.
   ===================================================================== */
describe('the period control', () => {
  const periods = code.slice(code.indexOf('Count referrals over'), code.indexOf('Count referrals from'));

  it('offers the four the database allows', () => {
    for (const v of ['week', 'month', 'year', 'lifetime']) {
      expect(periods, `the control no longer offers ${v}`).toContain(`value: '${v}'`);
    }
  });

  it('and not the one it refuses', () => {
    expect(periods).not.toContain("'quarter'");
    expect(code).not.toMatch(/'month' \| 'quarter' \| 'year'/);
  });
});
