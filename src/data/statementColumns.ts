/* =====================================================================
   WHAT DO THESE ROWS HAVE MORE THAN ONE OF?

   viewerShape.ts asks that about a VIEWER: counted over their whole book, how
   many agencies, branches and routes have they got, and therefore which
   columns and filters are worth the room. This asks it about the ROWS of one
   statement: this payee, this month, these lines.

   Same idea, different subject, so it is a second function rather than a flag
   on the first. A dimension with one value is not a dimension, it is a fact
   about the whole document, and a column repeating that fact on every line is
   a column the reader scans past to reach the money. But the two subjects
   genuinely differ and must not be collapsed into one: an agency with four
   branches keeps its Branch column on Applications all year (viewerShape,
   counted over the book) and loses it on a September statement where only
   Leeds paid (here, counted over the rows). Making viewerShape answer both
   would mean either narrowing it to a month, which every other screen would
   then inherit, or handing it rows it has no business holding.

   IT IS NOT A PERMISSION, for the same reason viewerShape is not one. RLS and
   maySeeCommission decided what this reader may see long before this counts it.
   This decides only whether saying it forty times is worth the room.

   A DROPPED COLUMN IS SIMPLY GONE, and until today it was not: the single value
   came back as onlyBranch / onlySource / onlyAgency and all four renderings
   relocated it into the header block, "Branch: Soho". That is withdrawn and the
   fields are gone with it. StatementShape below says why, at length, because the
   next reader's instinct will be to put them back.

   DUPLICATED, ON PURPOSE. Everything between the BEGIN and END markers below
   also exists, character for character, in
   supabase/functions/commission-statements/index.ts, which builds the PDF and
   the CSV. That is a Deno Edge Function: it cannot import from src/, and the
   rule is far too small to earn a published package. So it is copied, and
   statementColumns.test.ts reads both files and fails the moment the two
   blocks stop matching. The screen, the PDF and the CSV cannot drift.
   ===================================================================== */

// ---- BEGIN SHARED STATEMENT COLUMN RULE ----
// One rule, two copies, held identical by src/data/statementColumns.test.ts:
//   src/data/statementColumns.ts                        (the screen)
//   supabase/functions/commission-statements/index.ts   (the PDF and the CSV)
// Edit one and you must edit the other. The test fails until you do.

/** The three columns of a statement that can turn out to hold one value for
    every line. The rest (reference, tenant, date, share, rate, money) differ
    row by row by nature, and a statement with one line is still a statement. */
export type StatementDimension = 'agency' | 'branch' | 'source';

/** The only fields of a line this rule reads. A rendering that does not carry
    a dimension leaves it undefined, which is not the same as every row sharing
    a value: it means there is no such column to drop. */
export interface StatementRow {
  agency?: string | null;
  branch?: string | null;
  source?: string | null;
}

/** How many distinct values each dimension holds across these rows, and
    therefore which of the three columns is worth the room.

    NO onlyAgency / onlyBranch / onlySource, AND THAT IS A REVERSAL. The shape
    used to hand back the single surviving value of a collapsed dimension, and
    every rendering moved it into the header block as "Branch: Soho" and
    "Source: Agreement". The principle was that a fact should not be lost with
    its column. It is withdrawn. A statement is read by the payee, who knows
    which of their own branches this is, and a header that grows a line whenever
    a column shrinks is a header that changes shape month to month for no gain.
    Collapsing a column is about removing something that says nothing;
    relocating it puts the same nothing somewhere else. A dropped column is
    simply gone, so these fields went with the header lines they existed to
    feed. Do not add them back for that. */
export interface StatementShape {
  agencies: number;
  branches: number;
  sources: number;
  /** True when the dimension holds at most one value across these rows, which
      is when its column goes. Named after viewerShape's oneAgency/oneBranch so
      the two read as the single idea they are. */
  oneAgency: boolean;
  oneBranch: boolean;
  oneSource: boolean;
}

/** How many distinct values one dimension holds.

    AN ABSENT VALUE COUNTS AS A VALUE. A statement where some lines name a
    branch and some do not has two things to say and keeps the column; dropping
    it there would quietly attribute the unbranched lines to the named branch.
    Only when EVERY line is missing it does the dimension collapse.

    A COUNT AND NOTHING ELSE. This used to return the one distinct value beside
    it, which fed nothing but the header line a collapsed column left behind.
    That line is withdrawn, so the value has no reader. */
function countDimension(values: readonly (string | null | undefined)[]): number {
  const seen = new Set<string>();
  let blank = false;
  for (const v of values) {
    const s = (v ?? '').trim();
    if (s) seen.add(s);
    else blank = true;
  }
  return seen.size + (blank ? 1 : 0);
}

/**
 * What these rows have more than one of.
 *
 * NO ROWS ANSWERS ONE OF EVERYTHING, deliberately, exactly as viewerShape's
 * empty book does: an empty statement is not the place to offer a Branch
 * column. The `<= 1` is what puts zero and one together on purpose rather than
 * by accident, and it would not survive somebody rewriting it as `=== 1`.
 */
export function statementShape(rows: readonly StatementRow[]): StatementShape {
  const agencies = countDimension(rows.map((r) => r.agency));
  const branches = countDimension(rows.map((r) => r.branch));
  const sources = countDimension(rows.map((r) => r.source));
  return {
    agencies,
    branches,
    sources,
    oneAgency: agencies <= 1,
    oneBranch: branches <= 1,
    oneSource: sources <= 1,
  };
}

/** Whether this dimension's column should be left out of the table. */
export function dimensionCollapsed(shape: StatementShape, dim: StatementDimension): boolean {
  return dim === 'agency' ? shape.oneAgency : dim === 'branch' ? shape.oneBranch : shape.oneSource;
}

/** A statement column as the PDF and the CSV declare it. Structurally a
    PdfColumn from _shared/pdf.ts plus the dimension tag, so the surviving list
    can be handed straight to renderTablePdf. */
export interface StatementColumn {
  header: string;
  /** Points. The PDF lays out on these, the CSV ignores them, and the screen
      has no widths at all: it reads the booleans above and lets CSS do it. */
  width: number;
  align?: 'left' | 'right';
  /** Set only on the columns that can collapse. */
  dim?: StatementDimension;
}

/**
 * The columns that survive, with the dropped ones' width shared out.
 *
 * WHY REDISTRIBUTE. The PDF's widths are absolute points chosen to fill the
 * printable width of A4. Dropping a column and leaving the rest where they are
 * would pull the table up short of the right margin, so a statement with one
 * branch would look narrow and left-heavy rather than tidy: the reader would
 * see a rendering fault where we meant to save them a column.
 *
 * Proportional, because every column was sized to what it has to hold and
 * their relative sizes are still right. Handing the whole surplus to one column
 * would make that one luxurious and leave the others as tight as they were.
 *
 * Unrounded on purpose: the writer rounds to two decimals as it draws, so the
 * survivors still sum to exactly what the full set summed to, which is the
 * property that keeps the table inside the page.
 */
export function keepColumns(
  columns: readonly StatementColumn[],
  shape: StatementShape,
): StatementColumn[] {
  const keep = columns.filter((c) => !c.dim || !dimensionCollapsed(shape, c.dim));
  if (keep.length === columns.length) return columns.slice();
  const before = columns.reduce((s, c) => s + c.width, 0);
  const after = keep.reduce((s, c) => s + c.width, 0);
  if (!after) return keep.slice();
  const scale = before / after;
  return keep.map((c) => ({ ...c, width: c.width * scale }));
}
// ---- END SHARED STATEMENT COLUMN RULE ----
