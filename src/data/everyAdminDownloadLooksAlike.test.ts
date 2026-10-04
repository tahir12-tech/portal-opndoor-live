/* THE FOUR ADMIN DOWNLOADS ARE ONE FAMILY.
 *
 * Matt, 2026-10-03, verbatim: "Admin exports: produce the Expiries export as
 * a branded Excel file using the existing branded template (BrandedDoc, as
 * the commission statements use), not a plain CSV. Header 'Scope: Whole book'
 * instead of 'All partners'. Do the same for Export summary, Application
 * export and the League exports so all admin downloads look alike. Keep
 * column headings and figures exactly as they are now. Deploy to dev and
 * check there."
 *
 * THREE OF THE FOUR WERE ALREADY BRANDED. Export summary, Application export
 * and the League workbooks all go through BrandedDoc; the expiries file was
 * the one left behind, and it was the one a renewals operator opens most.
 * Beside them it looked like a different product: no header band, no report
 * name, money as text that Excel will not sum.
 *
 * AND THEY DISAGREED ABOUT WHAT "EVERYTHING" IS CALLED -- "All partners
 * (opndoor whole book)" on one, "Whole estate" on the other three. "All
 * partners" is the least true of them: on the agency rail every agency
 * Opndoor has onboarded shares ONE partner, so a count of partners is a
 * count of rails. One phrase now, from one constant.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPeriods } from '@/data';
import {
  buildApplicationDoc, buildExpiriesDoc, buildLeagueDoc, buildPerformanceDoc,
  type BrandedExport,
} from '@/data/exportsService';

const ADMIN = 'superadmin' as const;
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

type Blk = { kind: string; items?: { label: string; value: string | number }[]; columns?: { header: string; type: string }[]; rows?: (string | number)[][] };
const blocks = (b: BrandedExport): Blk[] => b.sheets.flatMap((s) => s.doc.blocks as Blk[]);
const kv = (b: BrandedExport) => Object.fromEntries(blocks(b).flatMap((x) => (x.items ?? []).map((i) => [i.label, String(i.value)])));
const headers = (b: BrandedExport) => blocks(b).flatMap((x) => (x.columns ?? []).map((c) => c.header));

const FOUR: [string, BrandedExport][] = [
  ['Export summary', buildPerformanceDoc(ADMIN, allTime)],
  ['Application export', buildApplicationDoc(ADMIN, allTime, 'referred')!],
  ['League export', buildLeagueDoc(ADMIN, 'all', '', allTime)],
  ['Expiries export', buildExpiriesDoc(ADMIN, 2027, 5)!],
];

describe('all four admin downloads', () => {
  it.each(FOUR)('%s is a branded workbook with an .xlsx name', (_name, built) => {
    expect(built.sheets.length).toBeGreaterThan(0);
    expect(built.filename).toMatch(/\.xlsx$/);
    for (const s of built.sheets) {
      expect(s.doc.reportName, 'every sheet names its report').toBeTruthy();
      expect(s.doc.metaLine, 'every sheet carries the meta line').toContain('Generated');
      expect(s.doc.metaLine).toContain('GBP');
    }
  });

  it.each(FOUR)('%s calls the admin scope "Whole book"', (_name, built) => {
    const line = built.sheets.map((s) => s.doc.metaLine).join(' | ');
    expect(line).toContain('Whole book');
  });

  /* THE TWO PHRASES IT REPLACED, neither of which may come back. "Whole
     estate" is already banned from anything an agency opens; what is new
     is that it is gone from Opndoor's own copy too, so there is one
     phrase and not one per reader.

     THE WORD ALONE IS NOT THE TEST, because one of the demo agencies is
     called "Hartwell Estates" and a customer's own name is not the
     portal saying the word to them -- the same exception
     exports-agency-facing.test.ts makes. The PHRASE is what was wrong. */
  it.each(FOUR)('%s says neither "All partners" nor "Whole estate"', (_name, built) => {
    const all = JSON.stringify(built.sheets);
    expect(all).not.toMatch(/All partners/);
    expect(all).not.toMatch(/whole estate/i);
  });
});

describe('the expiries export in particular', () => {
  const built = buildExpiriesDoc(ADMIN, 2027, 5)!;

  it('is one sheet named Expiries, not a CSV', () => {
    expect(built.sheets.map((s) => s.name)).toEqual(['Expiries']);
    expect(built.filename).toBe('opndoor-expiries-2027-06.xlsx');
  });

  it('states the scope as a labelled line, which is what the CSV did', () => {
    expect(kv(built).Scope).toBe('Whole book');
    expect(kv(built).Month).toBe('June 2027');
  });

  /* KEEP COLUMN HEADINGS EXACTLY AS THEY ARE NOW. All fourteen, in order,
     as the CSV wrote them: this is the half of the instruction that is a
     promise not to improve anything on the way past. */
  it('keeps all fourteen column headings, in order and word for word', () => {
    expect(headers(built)).toEqual([
      'Guarantee reference', 'Tenant name', 'Tenants on the guarantee', 'Joint with',
      'Property address', 'Agency', 'Branch', 'Tenancy start', 'Expiry date',
      'Days remaining', 'Monthly rent (whole tenancy)', "Annualised rent (this tenant's share)",
      'Guarantee fee (whole tenancy)', 'Referrer',
    ]);
  });

  it('and has rows under them', () => {
    const table = blocks(built).find((b) => b.kind === 'table')!;
    expect(table.rows!.length).toBeGreaterThan(0);
    for (const r of table.rows!) expect(r).toHaveLength(14);
  });
});

/* AND THE OLD DOOR IS SHUT. A CSV builder left beside the new one is a
   button away from coming back. */
describe('nothing builds the expiries file as a CSV any more', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the builder is gone from the service', () => {
    expect(read('src/data/exportsService.ts')).not.toContain('buildExpiriesCsv');
  });

  it('and the dashboard downloads it through exportBranded', () => {
    const dash = read('src/pages/Dashboard/Dashboard.tsx');
    expect(dash).toContain('buildExpiriesDoc(role, +mv[0], +mv[1] - 1)');
    /* RETARGETED, NOT RELAXED. This read `void exportBranded(out)`, the exact
       call shape, and 2026-10-04 routed every export on this page through one
       `run` helper so a refusal or a throw reaches the reader as a sentence
       instead of as a dead button. The CLAIM is unchanged, and is the two
       assertions below: this file goes through exportBranded, and nothing
       here builds a CSV. Pinning the literal call pinned the wrong half. */
    expect(dash).toMatch(/void run\(buildExpiriesDoc\(/);
    expect(dash).toMatch(/const out = await exportBranded\(built, kind\)/);
    expect(dash).not.toContain('downloadCsv');
  });
});
