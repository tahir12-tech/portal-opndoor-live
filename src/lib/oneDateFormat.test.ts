/* ONE DATE FORMAT, EVERYWHERE ON SCREEN.
 *
 * Matt, 2026-10-01, verbatim: "Show dates the same way everywhere on screen
 * ('29 Sep 2026'), including the supplier Referrals tab and 'Live from'
 * (e.g. 'Live from Aug 2026'), with one shared date formatter."
 *
 * Two halves, as with the plural helper: the formatter is right, and nobody
 * writes their own. The scan is the half that keeps it true, because the
 * fault was never one wrong date -- it was eight spellings, each correct
 * where it stood.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatMonth } from './format';

describe('the formatter', () => {
  it('writes a date the way Matt asked for', () => {
    expect(formatDate('2026-09-29')).toBe('29 Sep 2026');
  });

  it('and a month the way he asked for that', () => {
    expect(formatMonth('2026-08')).toBe('Aug 2026');
  });

  it('with no leading zero on the day, which reads as a code', () => {
    expect(formatDate('2026-09-01')).toBe('1 Sep 2026');
  });

  /* A BARE 'YYYY-MM-DD' IS A CALENDAR DAY, NOT AN INSTANT. `new Date` reads
     it as midnight UTC, which is the day before once the clocks go back --
     so a tenancy starting 1 Nov would have printed 31 Oct. Taken apart
     rather than parsed. */
  it('and a plain date string is the day it says, in any season', () => {
    expect(formatDate('2026-11-01')).toBe('1 Nov 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('and a Date is formatted in London, not wherever the browser is', () => {
    expect(formatDate(new Date('2026-09-29T12:00:00Z'))).toBe('29 Sep 2026');
  });

  it('and a month accepts a full date too, since a column may hold one', () => {
    expect(formatMonth('2026-08-20')).toBe('Aug 2026');
  });

  /* NOTHING IS NOT A DATE. Every caller prints this into a cell and most
     have their own '-' for an empty one, so returning one here would give
     "- -". */
  it('and nothing in gives nothing out', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatMonth(undefined)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });
});

/* ===========================================================================
   AND NOBODY WRITES THEIR OWN.
   =========================================================================== */
const ROOT = join(process.cwd(), 'src');
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

/* THE EXEMPTIONS, each for a reason and each named.

   lib/format.ts        is the formatter.
   data/exportsService  CSV and PDF, which a finance team reconciles in a
                        spreadsheet. Matt's instruction says "on screen",
                        and a spreadsheet sorts dd/mm/yyyy as text.
   lib/validation.ts    PARSES a typed date; it does not print one. */
const EXEMPT = [/[\\/]lib[\\/]format\.ts$/, /[\\/]data[\\/]exportsService\.ts$/, /[\\/]lib[\\/]validation\.ts$/];

const FILES = sources(ROOT)
  .filter((p) => !EXEMPT.some((re) => re.test(p)))
  .map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')] as const);

describe('nobody writes their own date format', () => {
  it('found the source to read, so a broken scan cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  /* `toLocaleDateString` is the one that looks harmless: it gives whatever
     the browser's locale decides unless every option is spelled out, so two
     call sites with different options are two formats and a call site with
     none is as many formats as there are readers. */
  it('with toLocaleDateString', () => {
    const offenders: string[] = [];
    for (const [file, text] of FILES) {
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/toLocaleDateString\s*\(/.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /* AND THE HAND-ROLLED dd/mm/yyyy, which was in four files. */
  it('or by pasting the day, the month and the year together', () => {
    const offenders: string[] = [];
    for (const [file, text] of FILES) {
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!/getDate\(\)[^\n]*getMonth\(\)/.test(line)) return;
        /* A HYPHEN AFTER THE YEAR IS AN ISO VALUE, NOT A DISPLAY DATE.
           `${d.getFullYear()}-${month}` is what an `<input type="month">`
           parses; it calls the same getters and nobody reads it. Every
           display format in this product separates with a space or a
           slash, so the hyphen is the tell -- neater than an allowlist,
           and still true for the next one somebody writes. */
        if (/getFullYear\(\)\}-/.test(line)) return;
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
