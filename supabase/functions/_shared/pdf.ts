// =====================================================================
// A PDF writer, for one job.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY. The only PDFs this repo produced
// were PandaDoc's: a template rendered on their side and downloaded as bytes.
// A commission statement has no template, and the branded exports the portal
// offers are xlsx from a browser-only library that an Edge Function cannot
// load. The alternative was a third-party PDF package in a Deno function, which
// is a runtime dependency and a supply chain that nobody here chose.
//
// So: a PDF, written out by hand, for exactly one shape of document. A header
// block of label and value pairs, a table, a total, a footer. Nothing else.
// This is not a general PDF library and must not grow into one; if a second
// kind of document needs a PDF, think again rather than adding a flag here.
//
// WHY THAT IS SMALLER THAN IT SOUNDS. An uncompressed, text-only PDF is a plain
// text container:
//
//   %PDF-1.4              header
//   1 0 obj ... endobj    Catalog, points at the Pages node
//   2 0 obj ... endobj    Pages, lists the Kids
//   3 0 obj ... endobj    Font, one of the base 14, so nothing is embedded
//   4 0 obj ... endobj    Page, points at its Contents
//   5 0 obj ... endobj    Contents, a stream of drawing operators
//   xref                  the byte offset of every object above
//   trailer               points at the Catalog
//   %%EOF
//
// Text is drawn with:  BT /F1 9 Tf 40 700 Td (some text) Tj ET
//
// THE ONE THING THAT MUST BE EXACT: the xref byte offsets. A reader seeks
// straight to them. Get one wrong and the file still opens in the forgiving
// readers (Preview, Chrome) and fails in the strict ones (some Acrobat builds,
// most server-side parsers), which is the worst possible failure mode because
// it passes a human's check and breaks in a finance team's workflow. That is
// why the document is built as a byte array and each object's offset is
// recorded at the moment it is appended, never computed from a string length
// afterwards. It is also what pdf.test.ts spends most of its assertions on.
//
// ENCODING. The font declares /WinAnsiEncoding, which means the bytes inside a
// string literal are Windows-1252, NOT UTF-8. That is the whole reason a pound
// sign works: £ is the single byte 0xA3 in WinAnsi, where UTF-8 would write two
// bytes and the reader would draw two wrong glyphs. Every string therefore goes
// through toWinAnsi() before it reaches the file.
//
// MEASURING. Right-aligned money needs the real advance widths, so the tables
// below are Helvetica's own AFM widths, in 1/1000 of an em. Not an
// approximation: a monospace guess puts "£1,024.62" and "£332.31" in visibly
// different places when they should share a right edge.
// =====================================================================

/** A4 portrait, in points. */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/**
 * Helvetica advance widths for WinAnsi codes 32..126, in 1/1000 em, from the
 * Adobe Helvetica AFM. Index 0 is code 32 (space).
 */
const W_ASCII: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32..47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48..63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64..79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80..95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96..111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 112..126
];

/**
 * Helvetica advance widths for WinAnsi codes 128..255. Index 0 is code 128.
 *
 * The accented Latin letters genuinely share their base letter's width in
 * Helvetica (eacute is 556, the same as e), so these are exact and not a
 * rounding. The five codes WinAnsi leaves undefined get the space width; the
 * encoder never emits them, so the value only has to exist.
 */
const W_HIGH: readonly number[] = [
  556, 278, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 278, 611, 278, // 128..143
  278, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 278, 500, 667, // 144..159
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, // 160..175
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, // 176..191
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, // 192..207
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, // 208..223
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, // 224..239
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500, // 240..255
];

/**
 * The Unicode code points that WinAnsi puts in 0x80..0x9F, where Unicode itself
 * has control characters. Without this map a curly apostrophe in an agency's
 * name becomes a question mark, which looks like a bug in the statement.
 */
const WINANSI_HIGH: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

const QUESTION = 0x3f;
const SPACE = 0x20;

/**
 * A string as WinAnsi bytes, which is what a /WinAnsiEncoding font reads.
 *
 * Anything with no WinAnsi glyph becomes a question mark. A tenant with a name
 * outside Latin-1 gets question marks in the PDF, which is wrong but visible;
 * dropping the characters silently would leave a statement addressed to a
 * shorter name and nobody would notice.
 */
export function toWinAnsi(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? QUESTION;
    let b: number;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) b = SPACE; // a newline inside a table cell would break the stream
    else if (cp < 0x20 || cp === 0x7f) b = SPACE;
    else if (cp <= 0x7e) b = cp;
    else if (cp >= 0xa0 && cp <= 0xff) b = cp; // WinAnsi and Latin-1 agree from 0xA0 up, which is where £ (0xA3) lives
    else b = WINANSI_HIGH[cp] ?? QUESTION;
    out[n++] = b;
  }
  return out.subarray(0, n);
}

function widthOfByte(b: number): number {
  if (b >= 32 && b <= 126) return W_ASCII[b - 32];
  if (b >= 128) return W_HIGH[b - 128];
  return 0;
}

/** The width of a string set in Helvetica at `size`, in points. */
export function textWidth(s: string, size: number): number {
  let em = 0;
  for (const b of toWinAnsi(s)) em += widthOfByte(b);
  return (em * size) / 1000;
}

/**
 * The string shortened, with an ellipsis, until it fits `max` points.
 *
 * A cell that overflows does not wrap: it runs under the next column and the
 * table stops being readable. Truncating is the lesser harm, and the full value
 * is always in the portal.
 */
export function fitText(s: string, max: number, size: number): string {
  if (textWidth(s, size) <= max) return s;
  // One ellipsis glyph, not three full stops: WinAnsi has it at 0x85 and the
  // encoder maps it, so it costs one byte and one character of the column.
  const dots = String.fromCharCode(0x2026);
  let cut = s;
  while (cut.length > 1 && textWidth(cut + dots, size) > max) cut = cut.slice(0, -1);
  return cut + dots;
}

// ---------------------------------------------------------------------
// Byte assembly
// ---------------------------------------------------------------------

/** A growable byte buffer. Offsets are read off it while it is being built. */
class Bytes {
  private buf = new Uint8Array(8192);
  private n = 0;
  get length(): number {
    return this.n;
  }
  private room(extra: number) {
    if (this.n + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  /** Append raw bytes. */
  raw(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  /** Append an ASCII string. PDF syntax (operators, dictionaries) only: never
      user text, which has to go through toWinAnsi first. */
  ascii(s: string): void {
    this.room(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.n++] = s.charCodeAt(i) & 0x7f;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/**
 * A PDF literal string: WinAnsi bytes, with the three characters that would
 * otherwise end or nest the string escaped.
 */
function pdfString(s: string): Uint8Array {
  const src = toWinAnsi(s);
  const out = new Uint8Array(src.length * 2 + 2);
  let n = 0;
  out[n++] = 0x28; // (
  for (const b of src) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out[n++] = 0x5c; // ( ) \
    out[n++] = b;
  }
  out[n++] = 0x29; // )
  return out.subarray(0, n);
}

/** Points, trimmed to two decimals, so the content stream is not full of
    floating point tails like 786.8900000000001. */
const pt = (n: number): string => (Math.round(n * 100) / 100).toString();

// ---------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------

export interface PdfColumn {
  header: string;
  /** Width in points. The columns must sum to no more than USABLE_WIDTH. */
  width: number;
  /** Money and counts right-align; everything else reads better left. */
  align?: "left" | "right";
}

export interface PdfTableDoc {
  /** The line at the top of every page. */
  title: string;
  /** Label and value pairs under the title, on the first page only. */
  meta?: Array<[string, string]>;
  columns: PdfColumn[];
  rows: string[][];
  /** The closing line, set against the right edge of the table. */
  total?: { label: string; value: string };
  /** One quiet sentence along the bottom of every page. */
  footer?: string;
}

const MARGIN_X = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 44;
export const USABLE_WIDTH = A4_WIDTH - MARGIN_X * 2; // 515.28

const SIZE_TITLE = 15;
const SIZE_META = 9;
const SIZE_TABLE = 7.5;
const SIZE_FOOTER = 7.5;
const LEADING = 11.5;
/** Quiet, but not so quiet that payment terms look like boilerplate nobody
    meant. The footer is where a statement conventionally carries them. */
const GRAY_FOOTER = 0.3;

/** One drawing instruction. The page is laid out into these first, because the
    page count is not known until the last row is placed and the footer has to
    say "Page 2 of 3". */
type Op =
  | { t: "text"; x: number; y: number; size: number; s: string; gray?: number }
  | { t: "rule"; y: number; x1: number; x2: number; gray: number };

/** Draw a row of cells inside the column grid, each clipped to its column. */
function cells(ops: Op[], cols: readonly PdfColumn[], values: readonly string[], y: number, size: number, gray?: number) {
  let x = MARGIN_X;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const text = fitText(values[i] ?? "", col.width - 4, size);
    const tx = col.align === "right" ? x + col.width - 4 - textWidth(text, size) : x;
    ops.push({ t: "text", x: tx, y, size, s: text, ...(gray == null ? {} : { gray }) });
    x += col.width;
  }
}

/**
 * A header block, a table and a total, as the bytes of a PDF file.
 *
 * Pages break when the rows run out of room; the title and the column headers
 * repeat at the top of each one, so a page torn out of the middle still says
 * what it is.
 */
export function renderTablePdf(doc: PdfTableDoc): Uint8Array {
  const cols = doc.columns;
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);
  // A warning, not a throw. Columns too wide for A4 run off the right edge,
  // which is bad; refusing to build the file would mean a payee gets no
  // statement at all on the 1st, which is worse. The log line is how it gets
  // noticed, and a dry run surfaces it before a real send.
  if (tableWidth > USABLE_WIDTH) {
    console.warn(
      `pdf: columns total ${Math.round(tableWidth)}pt and the page fits ${Math.round(USABLE_WIDTH)}pt. ` +
        `The right-hand columns will run off the page.`,
    );
  }
  const tableRight = MARGIN_X + tableWidth;
  const pages: Op[][] = [];
  let ops: Op[] = [];
  let y = 0;

  /** Start a page and lay down the repeating furniture. Returns the baseline
      of the first body row. */
  const startPage = (first: boolean) => {
    ops = [];
    pages.push(ops);
    y = A4_HEIGHT - MARGIN_TOP - SIZE_TITLE;
    ops.push({ t: "text", x: MARGIN_X, y, size: first ? SIZE_TITLE : SIZE_META + 1, s: doc.title });
    y -= first ? 20 : 16;

    if (first && doc.meta?.length) {
      for (const [label, value] of doc.meta) {
        ops.push({ t: "text", x: MARGIN_X, y, size: SIZE_META, s: label, gray: 0.4 });
        ops.push({ t: "text", x: MARGIN_X + 118, y, size: SIZE_META, s: fitText(value, USABLE_WIDTH - 118, SIZE_META) });
        y -= 13;
      }
      y -= 8;
    }

    // Column headers, with a rule under them.
    cells(ops, cols, cols.map((c) => c.header), y, SIZE_TABLE, 0.35);
    y -= 5;
    ops.push({ t: "rule", y, x1: MARGIN_X, x2: tableRight, gray: 0.55 });
    y -= LEADING;
  };

  startPage(true);
  // Room for the last row plus the total line and the footer, or the total
  // lands on a page of its own with nothing above it.
  const floor = MARGIN_BOTTOM + LEADING * 2 + 8;
  for (const row of doc.rows) {
    if (y < floor) startPage(false);
    cells(ops, cols, row, y, SIZE_TABLE);
    y -= LEADING;
  }

  if (doc.total) {
    if (y < MARGIN_BOTTOM + LEADING + 8) startPage(false);
    y += LEADING - 6;
    ops.push({ t: "rule", y, x1: MARGIN_X, x2: tableRight, gray: 0.55 });
    y -= LEADING + 1;
    const valueW = textWidth(doc.total.value, SIZE_TABLE);
    const labelW = textWidth(doc.total.label, SIZE_TABLE);
    const lastW = cols[cols.length - 1]?.width ?? 60;
    ops.push({ t: "text", x: tableRight - 4 - valueW, y, size: SIZE_TABLE, s: doc.total.value });
    ops.push({ t: "text", x: tableRight - lastW - 10 - labelW, y, size: SIZE_TABLE, s: doc.total.label });
  }

  // Footers last, now that the count is known.
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (doc.footer) {
      page.push({
        t: "text", x: MARGIN_X, y: MARGIN_BOTTOM, size: SIZE_FOOTER, gray: GRAY_FOOTER,
        s: fitText(doc.footer, USABLE_WIDTH - 90, SIZE_FOOTER),
      });
    }
    const n = `Page ${i + 1} of ${pages.length}`;
    page.push({
      t: "text", x: MARGIN_X + USABLE_WIDTH - textWidth(n, SIZE_FOOTER), y: MARGIN_BOTTOM,
      size: SIZE_FOOTER, gray: GRAY_FOOTER, s: n,
    });
  }

  return serialise(pages);
}

/** Ops to a content stream's bytes. */
function contentStream(page: readonly Op[]): Uint8Array {
  const b = new Bytes();
  let gray = 0; // the PDF default is black; only emit a change
  for (const op of page) {
    if (op.t === "rule") {
      b.ascii(`${pt(op.gray)} G 0.7 w ${pt(op.x1)} ${pt(op.y)} m ${pt(op.x2)} ${pt(op.y)} l S\n`);
      continue;
    }
    const g = op.gray ?? 0;
    if (g !== gray) {
      b.ascii(`${pt(g)} g\n`);
      gray = g;
    }
    b.ascii(`BT /F1 ${pt(op.size)} Tf ${pt(op.x)} ${pt(op.y)} Td `);
    b.raw(pdfString(op.s));
    b.ascii(" Tj ET\n");
  }
  return b.done();
}

/**
 * Objects to a file, recording every byte offset as it goes.
 *
 * Numbering: 1 Catalog, 2 Pages, 3 Font, then each page takes two, the page
 * object at 4 + 2i and its contents at 5 + 2i.
 */
function serialise(pages: readonly Op[][]): Uint8Array {
  const out = new Bytes();
  const total = 3 + pages.length * 2;
  const offsets = new Array<number>(total).fill(0);

  const object = (n: number, body: Uint8Array | string) => {
    offsets[n - 1] = out.length;
    out.ascii(`${n} 0 obj\n`);
    if (typeof body === "string") out.ascii(body);
    else out.raw(body);
    out.ascii("\nendobj\n");
  };

  out.ascii("%PDF-1.4\n");
  // The convention that tells anything sniffing the file that it is binary and
  // must not be line-ending-translated in transit.
  out.raw(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  // One of the base 14, so there is nothing to embed. WinAnsiEncoding is what
  // makes byte 0xA3 draw a pound sign; the default encoding would not.
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  for (let i = 0; i < pages.length; i++) {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(A4_WIDTH)} ${pt(A4_HEIGHT)}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );

    const stream = contentStream(pages[i]);
    offsets[contentId - 1] = out.length;
    out.ascii(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n`);
    out.raw(stream);
    out.ascii("\nendstream\nendobj\n");
  }

  // The cross-reference table. Every entry is exactly 20 bytes: a 10 digit
  // offset, a space, a 5 digit generation, a space, the type, and a two byte
  // end of line. Readers index into this arithmetically, so a short line
  // corrupts every entry after it.
  const xrefAt = out.length;
  out.ascii(`xref\n0 ${total + 1}\n`);
  out.ascii("0000000000 65535 f \n");
  for (let i = 0; i < total; i++) {
    out.ascii(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  out.ascii(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return out.done();
}

// NO BASE64 HELPER HERE, ON PURPOSE. The mailer already exports bytesToBase64,
// chunked so a large attachment does not overflow the argument stack, and a
// second copy would be the one that goes stale. A caller attaching a PDF
// imports it from ./mailer.ts alongside sendMessage.
//
// That also keeps this module importing nothing at all, which is what lets
// pdf.test.ts run with no permissions: mailer.ts reads Deno.env at module
// scope, and a pure generator should not need an --allow-env to be tested.
