/* THE COUNTS READ AS ENGLISH, AND GO ON DOING SO.
 *
 * Matt, 2026-10-01, verbatim: "Use singular and plural correctly everywhere
 * counts are shown (1 referral, 2 referrals; 1 branch, 2 branches; 1 person,
 * 2 people), with a shared helper and a check."
 *
 * This is the check. It has two halves and they are different jobs:
 *
 *   the helper is right        pluralOf / plural / countOf, on the three
 *                              rules Matt's examples pick out.
 *   nobody hand-rolls it       a scan of the source, because the fault was
 *                              never one wrong word -- it was thirty call
 *                              sites each solving it again, and the next
 *                              one will too unless something says no.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST. A render test can only catch the
 * screens somebody thought to render. The defect here is a HABIT, and it
 * shows up on whichever screen is written next. Reading the source is the
 * only way to be exhaustive about a habit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countOf, plural, pluralOf } from './plural';

describe('the helper', () => {
  /* MATT'S THREE EXAMPLES, which are three different rules. */
  it('adds s to a regular noun', () => {
    expect(pluralOf('referral')).toBe('referrals');
  });
  it('adds es after a sibilant, which is why `+ "s"` was never enough', () => {
    expect(pluralOf('branch')).toBe('branches');
    expect(pluralOf('match')).toBe('matches');
    expect(pluralOf('address')).toBe('addresses');
    expect(pluralOf('box')).toBe('boxes');
  });
  it('and knows the ones no rule reaches', () => {
    expect(pluralOf('person')).toBe('people');
  });

  it('turns a consonant + y into ies', () => {
    expect(pluralOf('agency')).toBe('agencies');
    expect(pluralOf('entry')).toBe('entries');
  });
  /* AND NOT A VOWEL + Y, or "day" becomes "daies". */
  it('but leaves a vowel + y alone', () => {
    expect(pluralOf('day')).toBe('days');
    expect(pluralOf('key')).toBe('keys');
  });

  it('keeps the capital where the noun starts a sentence', () => {
    expect(pluralOf('Branch')).toBe('Branches');
    expect(pluralOf('Person')).toBe('People');
  });

  /* ZERO IS PLURAL. English, and the case most likely to be got wrong by
     anybody writing `n > 1`. */
  it('treats zero as plural, and only one as singular', () => {
    expect(plural(0, 'referral')).toBe('referrals');
    expect(plural(1, 'referral')).toBe('referral');
    expect(plural(2, 'referral')).toBe('referrals');
  });

  it('and a caller that passes both words is always obeyed', () => {
    expect(plural(2, 'is', 'are')).toBe('are');
    expect(plural(1, 'is', 'are')).toBe('is');
  });

  it('puts the number and the noun together, grouped for reading', () => {
    expect(countOf(1, 'referral')).toBe('1 referral');
    expect(countOf(2, 'branch')).toBe('2 branches');
    expect(countOf(1, 'person')).toBe('1 person');
    expect(countOf(3, 'person')).toBe('3 people');
    expect(countOf(1284, 'referral')).toBe('1,284 referrals');
  });
});

/* ===========================================================================
   THE SCAN.
   =========================================================================== */
const ROOT = join(process.cwd(), 'src');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name)) continue;
    // The helper itself, and the generated API docs, which are prose.
    if (/[\\/](plural\.ts|partnerDocs\.generated\.ts)$/.test(p)) continue;
    out.push(p);
  }
  return out;
}

const FILES = sources(ROOT).map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')] as const);

describe('nobody hand-rolls a plural', () => {
  it('found the source to read, so a broken scan cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  /* THE TERNARY. `x === 1 ? 'branch' : 'branches'` and its many spellings.
     Each one was correct where it stood; together they are a rule nobody
     owns, and `=== 1 ? '' : 's'` is wrong the moment its noun gains a
     sibilant.

     NARROWED TO TERNARIES THAT ARE ACTUALLY PLURALISING, which took two
     goes. The first version flagged every `=== 1 ? a : b` and caught class
     names (`=== 1 ? 'is-one' : 'is-many'`) and genuine sentence choices
     ("One thing is missing" / "3 things are missing"), which are not this
     habit and have no business being forced through a plural helper. A
     check that cries wolf gets an allowlist and then gets ignored.

     So a line is flagged only where the two branches ARE a singular and
     its plural: either suffix-splicing onto a noun outside the quotes
     (`branch${n === 1 ? '' : 'es'}`), or two whole words where the second
     is the plural of the first. That is precisely the habit and nothing
     else. */
  const SUFFIXES = new Set(['s', 'es', 'ies', 'y']);
  const isPluralising = (a: string, b: string): boolean => {
    if (a === b) return false;
    // `thing${n === 1 ? '' : 's'}` -- the noun is outside the quotes.
    if (a === '' && SUFFIXES.has(b)) return true;
    // `deliver${n === 1 ? 'y' : 'ies'}` -- both halves are suffixes.
    if (SUFFIXES.has(a) && SUFFIXES.has(b)) return true;
    // Two whole words, one the plural of the other.
    return /^[A-Za-z]+$/.test(a) && /^[A-Za-z]+$/.test(b) && pluralOf(a) === b;
  };

  it('with a ternary on the count', () => {
    const re = /[=!]==?\s*1\s*\?\s*(['"`])([^'"`]*)\1\s*:\s*(['"`])([^'"`]*)\3/;
    const offenders: string[] = [];
    for (const [file, text] of FILES) {
      text.split('\n').forEach((line, i) => {
        // Commented-out code is not shipped copy.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const m = line.match(re);
        if (!m || !isPluralising(m[2], m[4])) return;
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /* THE OTHER SHAPE: a number interpolated straight in front of a bare
     plural noun, which reads "1 referrals" exactly once in every hundred
     and is the version nobody notices until a customer has one referral.

     THE NOUN LIST IS DELIBERATELY SHORT and holds only the words this
     product counts. A general "any word ending in s" would catch "its",
     "this" and every possessive on the page, and a check that cries wolf
     gets an allowlist and then gets ignored. */
  const NOUNS = [
    'referrals', 'branches', 'people', 'agencies', 'applications', 'users',
    'tenants', 'deals', 'payees', 'days', 'rows', 'offices', 'suppliers',
    'members', 'changes', 'customers', 'matches', 'responses', 'keys',
    'statements', 'addresses', 'contacts', 'invites', 'entries',
  ];
  /* AND ONLY WHERE THE THING IN FRONT IS A COUNT. `{partnerName(p)} users`
     and `{branchName} contacts` are a NAME and a noun, which is not this
     rule and never reads wrongly. Asking "does this interpolation look like
     a number" is what separates them, and it is the same question the rule
     itself is about: Matt's instruction is "everywhere COUNTS are shown".

     AVERAGES ARE EXEMPT and stay plural. "1.0 days" is right where the
     figure is a mean, and `plural()` would make it "1.0 day" on the one
     dataset that averages exactly one. */
  const COUNTISH = /(\.length\b|\bcount\b|Count\b|\btotal\b|Total\b|\bn\b|\bdays?Until\b|\bpaid\b|\bsent\b)/;
  it('and with a count interpolated in front of a bare plural', () => {
    const re = new RegExp(String.raw`\{([^{}'"\n]+)\}\s+(${NOUNS.join('|')})\b`);
    const offenders: string[] = [];
    for (const [file, text] of FILES) {
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const m = line.match(re);
        if (!m) return;
        // `{plural(...)}` and `{countOf(...)}` ARE the fix, not the fault.
        if (/\b(plural|countOf|pluralOf)\s*\(/.test(line)) return;
        // A JSX attribute (`agencies={agencies}`) is not screen copy.
        if (new RegExp(String.raw`[A-Za-z]=\{`).test(m[0])) return;
        /* AND A PROPERTY NAMED AFTER THE NOUN ITSELF: `{a.referrals}
           referrals` is a count by any reading, and the first version of
           COUNTISH missed it because it has no `.length` or `count` in it.
           Found by reading the supplier Overview after the sweep, which
           still said "1 referrals". */
        const endsInTheNoun = new RegExp(String.raw`\b${m[2]}\s*$`).test(m[1].trim());
        if (!COUNTISH.test(m[1]) && !endsInTheNoun) return;
        if (/avg|average/i.test(m[1])) return;
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
