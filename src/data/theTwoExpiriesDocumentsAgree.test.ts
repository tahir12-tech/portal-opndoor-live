/* ONE SUBJECT, TWO DOCUMENTS, AND THEY DISAGREED ABOUT WHAT IT WAS.
 *
 * Matt, 2026-10-02: "Bring the agency-facing 'guarantees expiring'
 * monthly email and its spreadsheet into line with the admin Expiries
 * export: 'Guarantee fee' not 'Guarantor fee', 'Annualised rent (this
 * tenant's share)' on joint tenancies, 'Joint with' instead of a
 * Tenancy ID, dates as '20 Nov 2026' in the email body, and no
 * Opndoor-internal columns."
 *
 * HE FOUND IT BY DOWNLOADING THE WRONG ONE. The admin Expiries export
 * was fixed in fec2309 and the old headings he saw came from the OTHER
 * file: `expiry-cohorts`, a monthly email to each agency with its own
 * shorter column set, which that commit never touched. Two files
 * answering "which guarantees are expiring" with different columns is
 * how a fix looks like it did not land.
 *
 * SO THE TEST IS THAT THEY MATCH, not that each is individually right.
 * A column added to one and not the other puts them back where they
 * were.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const ADMIN = readFileSync('src/data/exportsService.ts', 'utf8');
const COHORT = readFileSync('supabase/functions/expiry-cohorts/index.ts', 'utf8');

/** The admin file's column list, as written. */
const adminCols = () => {
  const line = ADMIN.split('\n').find((l) => l.includes("const colHeader: CsvRow = ["))!;
  return [...line.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]).filter((c) => c !== 'CsvRow');
};

describe('the two expiries documents', () => {
  it('ask for the same columns, in the same order', () => {
    const cols = adminCols();
    // The cohort list is written across three lines; the order is what matters.
    const block = COHORT.slice(COHORT.indexOf('const COLS = ['), COHORT.indexOf('];', COHORT.indexOf('const COLS = [')));
    const cohortCols = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(cohortCols).toEqual(cols);
  });

  /* THE THREE LABELS BY NAME, so a reader of this file knows which
     instruction it is about without diffing two column lists. */
  it('and carry the three labels Matt named', () => {
    for (const col of ['Joint with', "Annualised rent (this tenant's share)", 'Guarantee fee (whole tenancy)']) {
      expect(COHORT, `the cohort file is missing ${col}`).toContain(col);
      expect(ADMIN, `the admin file is missing ${col}`).toContain(col);
    }
  });

  it('and neither says Guarantor fee any more', () => {
    expect(COHORT).not.toMatch(/Guarantor fee/);
  });

  /* "NO OPNDOOR-INTERNAL COLUMNS" is the other half, and the admin set
     happens to contain none -- no commission, and Agency and Branch are
     the reader's own -- which is why the two can be the same list
     rather than one being a subset. Asserted so a commission column
     added to the admin file cannot be copied into an agency's. */
  it('and neither carries commission, which an agency may not read here', () => {
    const cols = adminCols();
    expect(cols.filter((c) => /commission|supplier|partner/i.test(c))).toEqual([]);
  });
});

describe('the cohort email', () => {
  /* "JOINT WITH" NEEDS THE WHOLE BOOK. A joint tenant whose own
     guarantee expires in a different month is not in this month's set
     and is still their joint tenant, so the siblings are a second query
     rather than a scan of the rows in hand. */
  it('finds joint tenants that are not themselves in this month', () => {
    expect(COHORT).toContain('const siblings = new Map<');
    expect(COHORT).toContain('.in("tenancy_id", tenancyIds)');
  });

  it('and never lists a row as joint with itself', () => {
    expect(COHORT).toContain('mates.filter((m) => m.ref !== a.guarantee_ref)');
  });

  /* THE PORTAL'S ONE DATE FORMAT, which this document was not using:
     20/11/2026 is the one shape that is read differently on two
     continents. */
  it('and writes dates as "20 Nov 2026"', () => {
    expect(COHORT).toContain('const MONTH_ABBR = ["Jan"');
    expect(COHORT).toContain('`${Number(m[3])} ${MONTH_ABBR[Number(m[2]) - 1]} ${m[1]}`');
  });

  it('and says the month in words, not as a sort key', () => {
    expect(COHORT).toContain('function monthWords(');
    expect(COHORT).toContain('Guarantees expiring in ${monthWords(cohortMonth)}');
    expect(COHORT).not.toContain('Guarantees expiring in ${cohortMonth}');
  });

  /* A TEST RUN STILL DOES NOT TOUCH THE LEDGER. That rule predates this
     change and is the one that matters most here: a test send that
     marked a cohort as sent would make the real run skip a month of
     expiring guarantees and report it as a clean `skipped`. */
  it('and a test run still leaves the real send to happen', () => {
    expect(COHORT).toContain('if (!test) {');
    expect(COHORT).toContain('ledgerWritten: !test');
  });
});
