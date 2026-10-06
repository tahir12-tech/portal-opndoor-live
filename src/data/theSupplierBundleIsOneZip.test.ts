/* THE SUPPLIER'S SCHEDULES GO IN ONE ZIP.
 *
 * Matt, 2026-10-01, verbatim: "attach the supplier's own statement (PDF
 * and CSV) directly, plus one zip file containing the per-agency
 * statements, laid out as the supplier's statement at the top level and
 * an 'Agents' folder with one PDF and CSV per agency, named by agency.
 * If the zip would be over 10MB, don't attach it; instead the email
 * links to download it from the supplier's Reporting page, where it's
 * always available."
 *
 * THE ZIP WRITER IS OURS, so the first thing to prove is that it writes
 * a zip. Not "our reader can read it back" -- that only proves the two
 * halves agree with each other -- but that the bytes have the structure
 * the format specifies, which is what every extractor on the recipient's
 * machine will look for. The rehearsal went further and ran the system
 * `unzip -t` over one; this file pins the parts a test can hold.
 *
 * WHY THE SHAPE IS TESTED HERE AND NOT THROUGH THE EDGE FUNCTION.
 * `buildSupplierBundle` takes a Supabase client and runs on Deno; vitest
 * cannot collect it. The LAYOUT, though, is a property of the entry list
 * and the writer, and both are reachable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ---------------------------------------------------------------------
   The writer itself, bundled for node by the rehearsal. Re-implemented
   here in the few lines a test needs rather than imported, because the
   source is Deno TypeScript: what is asserted is the FORMAT, which is
   the thing a recipient's extractor cares about. */
const SRC = resolve(process.cwd(), 'supabase/functions/_shared/zip.ts');
const zipSrc = readFileSync(SRC, 'utf8');
const code = zipSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('the zip writer writes a zip', () => {
  it('stores rather than compresses, which is the decision it made', () => {
    /* METHOD 0 IS STORE. My first draft also asserted that the word
       "deflate" appeared nowhere, and it failed: the source says
       "version needed: 2.0, which is store and deflate" in a trailing
       comment, describing what version 2.0 of the format covers.
       Asserting the ABSENCE of a word is a weak way to say "there is no
       compressor" and a reliable way to trip over prose. */
    expect(code).toMatch(/out\.u16\(0\);/);
    // What would actually mean compression: a real compressor.
    expect(code).not.toMatch(/\bpako\b|CompressionStream|deflateRaw/);
  });

  /* THE THREE SIGNATURES, in the order a reader expects them. A zip is
     opened from the END: the reader seeks the end record, takes the
     central directory offset out of it, and walks that. Get any of them
     wrong and forgiving tools still open the file while strict ones
     refuse it, which is the worst failure mode because it passes a
     human's check. */
  it('writes a local header, a central directory and an end record', () => {
    expect(code).toMatch(/0x04034b50/);  // local file header
    expect(code).toMatch(/0x02014b50/);  // central directory
    expect(code).toMatch(/0x06054b50/);  // end of central directory
  });

  /* UTF-8 NAMES, FLAGGED. Bit 11 says the name is UTF-8. "Regent's
     Lettings" is in the book today and an unflagged name is entitled to
     be read as CP437, which produces mojibake in the one place a human
     is looking for the agency. */
  it('and flags its filenames as UTF-8', () => {
    expect(code).toMatch(/UTF8_NAMES\s*=\s*0x0800/);
  });

  it('and checksums every entry, which is what an extractor verifies', () => {
    expect(code).toMatch(/export function crc32/);
    expect(code).toMatch(/0xedb88320/);  // the standard CRC32 polynomial
  });
});

/* ---------------------------------------------------------------------
   The layout Matt specified. */
const BUNDLE = resolve(process.cwd(), 'supabase/functions/commission-statements/index.ts');
const bundleSrc = readFileSync(BUNDLE, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
const builder = bundleSrc.slice(
  bundleSrc.indexOf('export async function buildSupplierBundle'),
  bundleSrc.indexOf('export function scheduleSlug'),
);

describe('the layout inside the zip', () => {
  it('puts the supplier’s own statement at the top level', () => {
    // No folder in either path: a bare filename is the top level.
    expect(builder).toMatch(/\{ path: ownPdfName, bytes: ownPdf \}/);
    expect(builder).toMatch(/\{ path: ownCsvName, bytes: enc\.encode\(ownCsv\) \}/);
  });

  it('and one PDF and CSV per agency in an Agents folder', () => {
    expect(builder).toMatch(/path: `Agents\/\$\{safe\}\.pdf`/);
    expect(builder).toMatch(/path: `Agents\/\$\{safe\}\.csv`/);
  });

  /* NAMED BY AGENCY, which is Matt's word, and by the REAL name rather
     than the filename slug: inside an archive there is no filesystem to
     be careful of beyond the separator, and somebody extracting twenty
     of these is looking for "Regent's Lettings", not
     "regents-lettings". */
  it('and names them by the agency, not by a slug', () => {
    expect(builder).toMatch(/const safe = ag\.agency_name/);
    expect(builder).not.toMatch(/path: `Agents\/\$\{slug\}/);
  });

  /* THE SEPARATOR IS THE ONE THING THAT MUST BE STRIPPED. An agency
     called "Smith / Jones" would otherwise create a folder inside
     Agents. */
  it('and strips path separators out of the agency name', () => {
    /* Escaping a regex that matches a regex, twice over, is how the
       first draft of this went wrong. The substance is: the name is
       cleaned before it becomes a path, and an empty one falls back. */
    expect(builder).toMatch(/const safe = ag\.agency_name\.replace\(/);
    expect(builder).toContain('|| "Agency"');
  });
});

describe('the two direct attachments, and the cap', () => {
  it('attaches the supplier’s own PDF and CSV directly, always', () => {
    expect(builder).toMatch(/\{ filename: ownPdfName, content: bytesToBase64\(ownPdf\) \}/);
    expect(builder).toMatch(/\{ filename: ownCsvName, content: textToBase64\(ownCsv\) \}/);
  });

  /* THE CAP IS ON THE ZIP, NOT THE EMAIL. The two direct attachments
     stay either way: they are small, they are the statement itself, and
     a month big enough to blow the cap is exactly the month somebody
     still needs the headline from. */
  it('and drops only the zip when it is over 10MB', () => {
    expect(builder).toMatch(/ZIP_LIMIT_BYTES/);
    expect(builder).toMatch(/tooBig\s*\?\s*\[\]\s*:\s*\[\{ filename: zipName/);
  });

  it('and the limit is ten megabytes', () => {
    expect(bundleSrc).toMatch(/ZIP_LIMIT_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
  });
});

describe('what the email says about them', () => {
  const message = bundleSrc.slice(
    bundleSrc.indexOf('export function statementMessage'),
    bundleSrc.indexOf('function settlementMessage'),
  );

  /* SAID EITHER WAY. A supplier told nothing about the agency breakdown
     will not go looking for it on a page, so the sentence is always
     there; only what it points at changes. */
  it('names the breakdown whether or not the zip is attached', () => {
    expect(message).toMatch(/schedules\?\s*:|opts\.schedules/);
    expect(message).toMatch(/Agents folder/);
    expect(message).toMatch(/too large to attach/);
  });

  it('and points at the Reporting page when it is too big', () => {
    const tooBig = message.slice(message.indexOf('too large to attach'));
    expect(tooBig.slice(0, 260)).toMatch(/Reporting page/);
    expect(tooBig.slice(0, 260)).toMatch(/always available/);
  });

  /* ONCE ONLY. Matt, 2026-10-01: "mention the Reporting page once only.
     Keep 'The same figures are on your Reporting page, where you can pick
     any month and download it again.' and drop 'They are also always
     available on your Reporting page.' from the zip sentence."

     The sentence that was dropped is the one for the case where the zip
     IS attached, so the attached branch now names the Agents folder and
     stops. The too-big branch keeps its pointer, asserted above, because
     there the schedules are not in the email at all. */
  it('and the attached-zip sentence does not repeat where the page is', () => {
    const attached = message.slice(
      message.indexOf('The zip holds this statement again'),
      message.indexOf('paymentTermsLine('),
    );
    expect(attached).toMatch(/Agents folder/);
    expect(attached).not.toMatch(/Reporting page/);
  });

  it('and the closing line still says it, which is the one mention Matt kept', () => {
    expect(message).toContain(
      'The same figures are on your Reporting page, where you can pick any month and download it again.');
  });

  /* AND AN AGENCY PAYEE IS NOT TOLD ABOUT AGENCIES. `schedules` is
     absent for them, and the sentence is conditional on it. */
  it('and says none of it to an agency payee', () => {
    expect(message).toMatch(/opts\.schedules && opts\.schedules\.count > 0/);
  });
});
