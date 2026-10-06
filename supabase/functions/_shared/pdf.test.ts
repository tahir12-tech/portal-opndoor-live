// Run: deno test supabase/functions/_shared/pdf.test.ts
//
// The assertion that earns its keep is the xref one. A PDF with wrong byte
// offsets in its cross-reference table opens perfectly in Preview and Chrome,
// which rebuild the table when it does not add up, and fails in the strict
// readers and in most server-side parsers. So the bug would survive a human
// opening the attachment and check that it "looks fine", and surface weeks
// later on a finance team's machine. Nothing else here can catch that, so the
// test walks every declared offset and demands the bytes there actually begin
// that object.
//
// The rest guards the two encoding decisions that are invisible until they are
// wrong: a pound sign must be the single WinAnsi byte 0xA3 (UTF-8 would draw
// two wrong glyphs), and a bracket in an agency's name must be escaped or it
// closes the string early and the content stream turns to noise.
import { assert, assertEquals, assertStringIncludes } from
  "https://deno.land/std@0.224.0/assert/mod.ts";
import { fitText, renderTablePdf, textWidth, toWinAnsi, USABLE_WIDTH } from "./pdf.ts";

const COLUMNS = [
  { header: "Reference", width: 120 },
  { header: "Tenant", width: 200 },
  { header: "Commission", width: 100, align: "right" as const },
];

const doc = (rows: string[][]) => ({
  title: "opndoor commission statement",
  meta: [["Payee", "Regent Lettings"], ["Month", "September 2026"]] as Array<[string, string]>,
  columns: COLUMNS,
  rows,
  total: { label: "Total", value: "£1,024.62" },
  footer: "Paid by the 15th of the following month.",
});

const row = (n: number) => [`GR-${20000 + n}`, `Tenant ${n}`, "£332.31"];
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

/** The file as latin1 text, so byte offsets and string indices are the same
    number. A UTF-8 decode would shift every index after the first £. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

Deno.test("it is a PDF: the header, the marker and the trailer", () => {
  const text = latin1(renderTablePdf(doc(rows(3))));
  assert(text.startsWith("%PDF-1.4"), "must open with the version header");
  assert(text.trimEnd().endsWith("%%EOF"), "must close with the end of file marker");
  assertStringIncludes(text, "/Type /Catalog");
  assertStringIncludes(text, "/Type /Pages");
  assertStringIncludes(text, "/BaseFont /Helvetica");
  assertStringIncludes(text, "/Encoding /WinAnsiEncoding");
  assertStringIncludes(text, "/MediaBox [0 0 595.28 841.89]");
});

Deno.test("the object count is Catalog, Pages, Font and two per page", () => {
  const text = latin1(renderTablePdf(doc(rows(3))));
  const declared = Number(/\/Size (\d+)/.exec(text)?.[1]);
  const written = [...text.matchAll(/^(\d+) 0 obj$/gm)].length;
  // One page of three rows: catalog, pages, font, page, contents.
  assertEquals(written, 5);
  // /Size counts the free object 0 as well as the five real ones.
  assertEquals(declared, 6);
  assertEquals(Number(/\/Count (\d+)/.exec(text)?.[1]), 1);
});

/** Every offset the xref declares, checked against the bytes it points at. */
function assertXrefPointsAtObjects(bytes: Uint8Array) {
  const text = latin1(bytes);
  const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(text);
  assert(table, "there must be an xref table before the trailer");
  const size = Number(table[1]);
  const entries = table[2].match(/.{20}/gs) ?? [];
  assertEquals(entries.length, size, "one 20 byte entry per object, including the free one");
  assertEquals(entries[0], "0000000000 65535 f \n", "object 0 is the head of the free list");

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    assertEquals(entry.length, 20, `entry ${i} is not 20 bytes`);
    assert(/^\d{10} 00000 n \n$/.test(entry), `entry ${i} is malformed: ${JSON.stringify(entry)}`);
    const offset = Number(entry.slice(0, 10));
    assertEquals(
      text.slice(offset, offset + `${i} 0 obj`.length),
      `${i} 0 obj`,
      `xref says object ${i} starts at byte ${offset}, and it does not`,
    );
  }

  // startxref must point at the table itself, or a reader never finds it.
  const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  assertEquals(text.slice(start, start + 4), "xref");
}

Deno.test("every xref offset points at the object it claims", () => {
  assertXrefPointsAtObjects(renderTablePdf(doc(rows(3))));
});

Deno.test("the offsets still land once a pound sign has shifted them", () => {
  // The regression this exists for: measuring the file with a UTF-8 length
  // while writing it as WinAnsi bytes. Every offset after the first £ would be
  // one byte out, and only a reader that trusts the table would notice.
  assertXrefPointsAtObjects(renderTablePdf({
    ...doc(rows(2)),
    meta: [["Payee", "Ashworth & Coe £"], ["Month", "September 2026"]],
  }));
});

Deno.test("rows overflow onto more pages, and the offsets survive it", () => {
  const bytes = renderTablePdf(doc(rows(200)));
  const text = latin1(bytes);
  const pageCount = Number(/\/Count (\d+)/.exec(text)?.[1]);
  assert(pageCount >= 3, `200 rows should not fit on two A4 pages, got ${pageCount}`);
  // Catalog, Pages, Font, then a page object and a content stream for each page.
  assertEquals([...text.matchAll(/^(\d+) 0 obj$/gm)].length, 3 + pageCount * 2);
  assertEquals([...text.matchAll(/\/Type \/Page\b/g)].length, pageCount);
  assertStringIncludes(text, `(Page 1 of ${pageCount})`);
  assertStringIncludes(text, `(Page ${pageCount} of ${pageCount})`);
  assertXrefPointsAtObjects(bytes);
});

Deno.test("a declared stream Length is the real byte length", () => {
  // A wrong /Length is the other silent corruption: the reader stops mid
  // stream and draws half a page.
  const text = latin1(renderTablePdf(doc(rows(40))));
  const declared = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
  assert(declared.length > 0, "there must be at least one content stream");
  for (const m of declared) {
    const from = m.index! + m[0].length;
    const length = Number(m[1]);
    assertEquals(text.slice(from + length, from + length + 11), "\nendstream\n");
  }
});

Deno.test("a pound sign is the single WinAnsi byte 0xA3", () => {
  assertEquals([...toWinAnsi("£9")], [0xa3, 0x39]);
  const bytes = renderTablePdf(doc([["GR-1", "Tenant", "£12.00"]]));
  assert(bytes.includes(0xa3), "the file must carry a raw 0xA3");
  // And never the UTF-8 pair, which would draw two wrong glyphs.
  const text = latin1(bytes);
  assertEquals(text.includes("Â£"), false, "£ was written as UTF-8, not WinAnsi");
});

Deno.test("brackets and backslashes are escaped inside a string", () => {
  const text = latin1(renderTablePdf(doc([["GR-1", "Nash (North) \\ Co", "£1.00"]])));
  assertStringIncludes(text, "(Nash \\(North\\) \\\\ Co)");
});

Deno.test("a character with no WinAnsi glyph becomes a question mark, not nothing", () => {
  // Dropping it would leave a statement addressed to a shorter name and nobody
  // would see that it had happened.
  assertEquals([...toWinAnsi("A中B")], [0x41, 0x3f, 0x42]);
  // A curly apostrophe does have a glyph, at WinAnsi 0x92.
  assertEquals([...toWinAnsi("O’Neill")].slice(0, 2), [0x4f, 0x92]);
  // A newline inside a cell would break the content stream, so it is a space.
  assertEquals([...toWinAnsi("a\nb")], [0x61, 0x20, 0x62]);
});

Deno.test("widths are Helvetica's, so money can be right aligned", () => {
  // From the Adobe Helvetica AFM: M is 833/1000 em, i is 222/1000.
  assertEquals(Math.round(textWidth("M", 1000)), 833);
  assertEquals(Math.round(textWidth("i", 1000)), 222);
  // The measure has to be proportional, or a right edge made of digits and
  // commas drifts. "1,024.62" and "332.31" are not the same width.
  assert(textWidth("£1,024.62", 7.5) > textWidth("£332.31", 7.5));
});

Deno.test("an overlong cell is truncated to fit, not left to run over", () => {
  const long = "Ashworth and Coe Residential Lettings, Northern Division";
  const cut = fitText(long, 80, 7.5);
  assert(cut.length < long.length, "it should have been shortened");
  assert(textWidth(cut, 7.5) <= 80, "the shortened cell must fit its column");
  assert(cut.endsWith("…"), "a truncated cell should say so");
  // Something that already fits is left exactly as it was.
  assertEquals(fitText("GR-20762", USABLE_WIDTH, 7.5), "GR-20762");
});
