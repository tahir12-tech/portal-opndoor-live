/* THE COLUMN RULE, AND THE TWO COPIES OF IT.

   Three jobs, and the last is the reason the file exists at all.

   The RULE, asserted on rows rather than through a rendering: a dimension
   holding one value across the rows is not a dimension, and its column goes.
   All three renderings ask this one function, so this is where it is pinned.

   The SCREEN, drawn, because "drops the column" has to mean the header as well
   as the cells, and because a total row that still spans ten columns of eight
   shears the table.

   The DUPLICATE. The PDF and the CSV are built by a Deno Edge Function that
   cannot import from src/, so the rule is copied into
   supabase/functions/commission-statements/index.ts. A copy that drifts is
   worse than no copy: the agency would read one set of columns on the screen
   and another in the email, for the same month, with nothing to say which was
   right. So the last tests read both files off disk, hold the two blocks to
   being character for character the same, and check the copy is actually the
   one the attachments are built from. */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import {
  dimensionCollapsed, keepColumns, statementShape,
  type StatementColumn, type StatementRow,
} from '@/data/statementColumns';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { ALL_PARTNERS } from '@/data/types';
import { CommissionStatement } from '@/components/CommissionStatement';

/* A line as the rule sees it. Only the three dimensions matter; the money and
   the dates it sits beside cannot collapse and are not passed. */
const row = (branch: string | null, source: string | null, agency?: string | null): StatementRow =>
  ({ branch, source, ...(agency === undefined ? {} : { agency }) });

/* The PDF's real column set, trimmed to the shape that matters here: two
   collapsible columns among fixed ones, and a sum worth watching. */
const COLUMNS: StatementColumn[] = [
  { header: 'Reference', width: 44 },
  { header: 'Tenant', width: 68 },
  { header: 'Branch', width: 54, dim: 'branch' },
  { header: 'Share', width: 36, align: 'right' },
  { header: 'Source', width: 66, dim: 'source' },
  { header: 'Commission', width: 60, align: 'right' },
];
const TOTAL_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0);

describe('the statement column rule', () => {
  it('drops Branch when every line is the same branch, and keeps it when two are not', () => {
    const one = statementShape([row('Leeds', 'standard'), row('Leeds', 'standard')]);
    expect(one.branches).toBe(1);
    expect(one.oneBranch).toBe(true);
    expect(dimensionCollapsed(one, 'branch')).toBe(true);

    const two = statementShape([row('Leeds', 'standard'), row('York', 'standard')]);
    expect(two.branches).toBe(2);
    expect(two.oneBranch).toBe(false);
  });

  it('drops Source when every line shares one, and keeps it when they are mixed', () => {
    const one = statementShape([row('Leeds', 'agreement'), row('York', 'agreement')]);
    expect(one.oneSource).toBe(true);

    const mixed = statementShape([row('Leeds', 'agreement'), row('Leeds', 'standard')]);
    expect(mixed.sources).toBe(2);
    expect(mixed.oneSource).toBe(false);
  });

  it('counts, and does not hand back the value a dropped column held', () => {
    /* A REVERSAL, PINNED SO IT IS NOT QUIETLY UNDONE. The shape used to return
       onlyAgency / onlyBranch / onlySource, and every rendering moved the value
       into its header block as "Branch: Leeds". A dropped column is simply gone
       now, and these three fields existed only to feed those header lines, so
       they are gone with them. Asserted on the keys rather than on the values
       because the fields no longer typecheck. */
    const shape = statementShape([row('Leeds', 'agreement'), row('Leeds', 'agreement')]);
    expect(Object.keys(shape).sort()).toEqual([
      'agencies', 'branches', 'oneAgency', 'oneBranch', 'oneSource', 'sources',
    ]);
  });

  it('keeps Source when some lines recorded one and some did not', () => {
    // The historic line. "Some of these are the standard and some we cannot say"
    // is two things, and dropping the column would quietly call them all
    // standard, which is the whole reason the source is stored.
    const shape = statementShape([row('Leeds', 'standard'), row('Leeds', null)]);
    expect(shape.sources).toBe(2);
    expect(shape.oneSource).toBe(false);
  });

  it('drops a dimension no line has at all', () => {
    const shape = statementShape([row('', null), row(null, null)]);
    expect(shape.branches).toBe(1);
    expect(shape.oneBranch).toBe(true);
    expect(shape.sources).toBe(1);
    expect(shape.oneSource).toBe(true);
  });

  it('keeps Agency on a group statement spanning two agencies', () => {
    const group = statementShape([
      row('Leeds', 'agreement', "Regent's Lettings"),
      row('Soho', 'agreement', 'Foxglove'),
    ]);
    expect(group.agencies).toBe(2);
    expect(group.oneAgency).toBe(false);
    expect(dimensionCollapsed(group, 'agency')).toBe(false);

    // The same group in a month where only one of its agencies paid.
    const one = statementShape([
      row('Leeds', 'agreement', "Regent's Lettings"),
      row('York', 'agreement', "Regent's Lettings"),
    ]);
    expect(one.agencies).toBe(1);
    expect(one.oneAgency).toBe(true);
    expect(dimensionCollapsed(one, 'agency')).toBe(true);
  });

  it('answers one of everything for a statement with no lines', () => {
    // Deliberate, and the same answer viewerShape gives an empty book: nothing
    // to count is not a reason to offer a column.
    const shape = statementShape([]);
    expect(shape.oneAgency && shape.oneBranch && shape.oneSource).toBe(true);
    expect([shape.agencies, shape.branches, shape.sources]).toEqual([0, 0, 0]);
  });

  it('ignores a difference that is only whitespace', () => {
    expect(statementShape([row('Leeds', 'standard'), row(' Leeds ', 'standard')]).oneBranch).toBe(true);
  });
});

describe('the columns the rule leaves', () => {
  it('drops the header as well as the cells', () => {
    const shape = statementShape([row('Leeds', 'standard'), row('Leeds', 'standard')]);
    const kept = keepColumns(COLUMNS, shape).map((c) => c.header);
    expect(kept).toEqual(['Reference', 'Tenant', 'Share', 'Commission']);
  });

  it('shares the dropped width out, so the table still reaches the right margin', () => {
    const shape = statementShape([row('Leeds', 'standard'), row('Leeds', 'standard')]);
    const kept = keepColumns(COLUMNS, shape);
    const width = kept.reduce((s, c) => s + c.width, 0);
    // The sum is the whole point: a PDF column set that no longer fills the
    // printable width prints a narrow, left-heavy table that reads as a fault.
    expect(width).toBeCloseTo(TOTAL_WIDTH, 6);
    // Proportional: every survivor is wider than it was, and the widest is
    // still the widest. Handing the surplus to one column would pass the sum
    // above and leave the rest as tight as they were.
    expect(kept[0].width).toBeGreaterThan(44);
    expect(kept[1].width).toBeGreaterThan(kept[0].width);
  });

  it('leaves the set alone, widths included, when nothing collapses', () => {
    const shape = statementShape([row('Leeds', 'standard'), row('York', 'agreement')]);
    expect(keepColumns(COLUMNS, shape)).toEqual(COLUMNS);
  });

  it('keeps the declared order', () => {
    const shape = statementShape([row('Leeds', 'standard'), row('York', 'standard')]);
    expect(keepColumns(COLUMNS, shape).map((c) => c.header))
      .toEqual(['Reference', 'Tenant', 'Branch', 'Share', 'Commission']);
  });
});

/* ---------------------------------------------------------------------
   The screen, which is the third rendering and the only one this suite can
   actually draw. The PDF and the CSV are proved by the lock below instead.

   createElement rather than JSX because this file is .ts: everything else in it
   is data, and renaming it to .tsx to draw one table would be the tail wagging
   the dog. */
const paid = (ref: string, branch: string, source: 'agreement' | 'standard'): FullApp => ({
  ref, rent: 2000, fee: 2000, status: 'paid', paidAt: new Date('2026-05-06'),
  partner: 'northwind', partnerRate: 0.25, agentRate: 0.1,
  agency: 'Foxglove', agencyId: 'ag-fox', branch, referrer: 'Priya', owner: 0,
  sentAt: null, deedAt: null, tenancyStart: null, expiry: null,
  refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedState: null, deedSentAt: null, deedViewedAt: null,
  commissionLines: [{ level: 'agency', orgId: 'ag-fox', orgName: 'Foxglove', rate: 0.2, source }],
  withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
});

/** The statement panel over a given book: its headers, and the block under the
    payee's name that a dropped column must NOT add a line to. */
function draw(book: FullApp[]) {
  hydrateFull(book);
  const view = render(createElement(CommissionStatement, { role: 'superadmin', scope: ALL_PARTNERS }));
  const head = view.container.querySelector('.stmt__head');
  return {
    heads: [...view.container.querySelectorAll('th')].map((t) => t.textContent),
    /* The lines of the payee block, read off its own wrapper rather than by
       class, so a header line reintroduced under any name is still caught. */
    headLines: [...(head?.querySelector('div')?.children ?? [])].map((d) => d.textContent),
    headText: head?.textContent ?? '',
    colSpan: view.container.querySelector('.stmt__total td')?.getAttribute('colspan'),
    cells: [...(view.container.querySelector('tbody tr')?.querySelectorAll('td') ?? [])].length,
  };
}

afterEach(cleanup);
afterAll(() => hydrateFull([]));

describe('the statement on screen', () => {
  it('drops both headers, and names neither value under the payee', () => {
    const { heads, headLines, headText, colSpan, cells } = draw([
      paid('R1', 'Soho', 'agreement'), paid('R2', 'Soho', 'agreement'),
    ]);
    expect(heads).toEqual(['Reference', 'Tenant', 'Tenancy', 'Share', 'Paid', 'Fee charged', 'Rate', 'Commission']);
    /* THE REVERSAL, ON THE SCREEN. This block used to grow a third line here,
       "Branch: Soho · Source: Agreement". A dropped column is simply gone, so
       the block is the payee and the level, whatever the table below drops. */
    expect(headLines).toHaveLength(2);
    expect(headText).not.toContain('Soho');
    expect(headText).not.toContain('Agreement');
    // The body and the total row follow the header, or the table shears.
    expect(cells).toBe(heads.length);
    expect(colSpan).toBe(String(heads.length - 1));
  });

  it('keeps both columns, and still says nothing extra, when the lines differ', () => {
    const { heads, headLines } = draw([
      paid('R1', 'Soho', 'agreement'), paid('R2', 'Leeds', 'standard'),
    ]);
    expect(heads).toContain('Branch');
    expect(heads).toContain('Source');
    // The same two lines as above: this block's shape does not depend on the
    // table's, which is the whole point of withdrawing the relocation.
    expect(headLines).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------------
   The lock. */
/* From the project root, which is where vitest runs. Not from import.meta.url:
   under vite that is a served URL rather than a file one, and fileURLToPath
   throws on it. */
const SRC = resolve(process.cwd(), 'src/data/statementColumns.ts');
const EDGE = resolve(process.cwd(), 'supabase/functions/commission-statements/index.ts');

/** The block between the markers, with trailing whitespace off each line so a
    stray space cannot fail a run for nothing. */
function sharedBlock(file: string): string {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('// ---- BEGIN SHARED STATEMENT COLUMN RULE ----');
  const end = text.indexOf('// ---- END SHARED STATEMENT COLUMN RULE ----');
  expect(start, `${file} has no BEGIN marker`).toBeGreaterThan(-1);
  expect(end, `${file} has no END marker`).toBeGreaterThan(start);
  return text.slice(start, end).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();
}

describe('the client and the Edge Function hold the same rule', () => {
  it('is the same block in both files, character for character', () => {
    // If this fails you changed one copy. Change the other: the screen, the PDF
    // and the CSV have to drop the same columns for the same month, and nothing
    // else in the build can see both files at once.
    expect(sharedBlock(EDGE)).toBe(sharedBlock(SRC));
  });

  it('is actually applied to the PDF and the CSV, not merely present', () => {
    // The copy could be perfect and unused. These two are the seams: the
    // columns the PDF draws, and the header row the CSV writes, both come from
    // the rule rather than from the full declared set.
    const edge = readFileSync(EDGE, 'utf8');
    expect(edge).toContain('keepColumns(STATEMENT_COLUMNS, shape)');
    expect(edge).toContain('columns.map((c) => c.header)');
  });
});

