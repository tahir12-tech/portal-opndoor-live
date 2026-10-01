// =====================================================================
// A ZIP WRITER, STORE ONLY.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY, which is the same answer
// _shared/pdf.ts gives and for the same reason. A supplier's statement
// email carries its own statement plus one schedule per agency, which at
// two agencies is six attachments and at twenty is unreadable. Matt asked
// for a zip. Taking a zip library into a Deno function is a runtime
// dependency and a supply chain nobody here chose, and the format we
// actually need is the simplest one it has.
//
// STORE, NOT DEFLATE, and that is a decision rather than laziness. The
// payload is PDFs and CSVs: the PDFs are already mostly incompressible
// text streams at these sizes, the CSVs are a few hundred bytes each, and
// deflate would mean shipping an inflate-compatible compressor to save a
// fraction of a megabyte on a file the recipient opens once. Every
// extractor on every platform reads a stored zip.
//
// =====================================================================
// THE FORMAT, in the order the bytes go out
// =====================================================================
//
//   for each file:
//     local file header   PK\x03\x04  + name, then the bytes themselves
//   central directory:
//     one record per file PK\x01\x02  + name + where its local header is
//   end of central directory:
//                         PK\x05\x06  + how many, how big, and where
//
// A reader opens a zip from the END: it seeks the end record, reads the
// central directory offset out of it, and walks that. So the central
// directory's offsets must be exact, in the same way the PDF writer's
// xref offsets must be: wrong by one and forgiving tools still open the
// file while strict ones refuse it, which is the worst failure because it
// passes a human's check and breaks in somebody's finance workflow.
//
// NO DIRECTORY ENTRIES. A folder in a zip is a path with a slash in it.
// "Agents/Foo.pdf" creates the folder in every extractor; a separate
// zero-length entry for "Agents/" is optional and we do not write one.
//
// UTF-8 NAMES, FLAGGED. Bit 11 of the general-purpose flags says the name
// is UTF-8. Agency names carry apostrophes and accents -- "Regent's
// Lettings" is in the book today -- and without the flag an extractor is
// entitled to read the bytes as CP437 and produce mojibake in the one
// place a human is looking for the agency's name.

/** One file in the archive. `path` may contain forward slashes. */
export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

/* CRC32, table driven. The zip's own integrity check, per file: an
   extractor compares it after inflating and refuses a mismatch. Built
   once on first use rather than at module load, because most requests to
   this function never make a zip. */
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A growable little-endian byte buffer. The zip format is little-endian
    throughout, which is the opposite of the PDF writer's ASCII, so this
    is its own small thing rather than a shared one. */
class Buf {
  private parts: Uint8Array[] = [];
  private n = 0;
  get length() { return this.n; }
  raw(b: Uint8Array) { this.parts.push(b); this.n += b.length; }
  u16(v: number) { this.raw(new Uint8Array([v & 0xff, (v >>> 8) & 0xff])); }
  u32(v: number) {
    this.raw(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.n);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

/* DOS TIME, which is what a zip stores: a 1980-epoch date in two 16-bit
   words, seconds in units of two. Nothing reads it but a file browser's
   "modified" column, and an invalid one makes an archive look corrupt in
   Windows Explorer. Clamped at 1980 because the format cannot say
   earlier. */
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(d.getUTCFullYear(), 1980);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const UTF8_NAMES = 0x0800;

/**
 * The archive, as bytes.
 *
 * `at` is the modification stamp written on every entry. It is a
 * parameter rather than `new Date()` so a test can build the same
 * archive twice and get the same bytes.
 */
export function makeZip(entries: readonly ZipEntry[], at: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosTime(at);
  const out = new Buf();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.bytes);
    central.push({ name, crc, size: e.bytes.length, offset: out.length });

    out.u32(0x04034b50);        // local file header
    out.u16(20);                // version needed: 2.0, which is store and deflate
    out.u16(UTF8_NAMES);
    out.u16(0);                 // method 0 = stored
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(e.bytes.length);    // compressed size, which for stored IS the size
    out.u32(e.bytes.length);
    out.u16(name.length);
    out.u16(0);                 // no extra field
    out.raw(name);
    out.raw(e.bytes);
  }

  const cdAt = out.length;
  for (const c of central) {
    out.u32(0x02014b50);        // central directory header
    out.u16(20);                // version made by
    out.u16(20);                // version needed
    out.u16(UTF8_NAMES);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(c.crc);
    out.u32(c.size);
    out.u32(c.size);
    out.u16(c.name.length);
    out.u16(0);                 // extra
    out.u16(0);                 // comment
    out.u16(0);                 // disk number
    out.u16(0);                 // internal attributes
    out.u32(0);                 // external attributes
    out.u32(c.offset);          // where this file's local header is
    out.raw(c.name);
  }
  const cdSize = out.length - cdAt;

  out.u32(0x06054b50);          // end of central directory
  out.u16(0);                   // this disk
  out.u16(0);                   // the disk the directory starts on
  out.u16(central.length);      // entries on this disk
  out.u16(central.length);      // entries in total
  out.u32(cdSize);
  out.u32(cdAt);
  out.u16(0);                   // no archive comment

  return out.done();
}
