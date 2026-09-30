/* THE DELIVERY PANEL SHOWS WHAT HAPPENED, NOT WHAT WOULD HAPPEN.
 *
 * Matt, 2026-09-30, verbatim: "Application detail: the Delivery panel
 * must show where the deed was actually sent and when, from the send
 * record, never who it would go to under today's rules. If it hasn't
 * been sent, say who it will go to. On GR-20845 it should show
 * manager@regent.dev.test."
 *
 * WHAT WAS WRONG, in one expression:
 *
 *     {delivery.attemptedTo ?? (dlvWouldGo || '-')}
 *
 * under the label "Sent to". With nothing recorded it printed whoever
 * the ladder resolves to NOW. The two answers diverge the moment anybody
 * changes a deed recipient, a primary contact or a branch after a deed
 * went out, and then the panel confidently names somebody who never
 * received it. The comment twelve lines above it already said the two
 * are different questions and the panel must not answer one with the
 * other, and the code did it anyway, which is why this is a source test:
 * prose above an expression does not constrain it.
 *
 * WHY A SOURCE TEST AND NOT A RENDER. The panel only draws in live mode
 * -- `loadDelivery` returns null without Supabase, and
 * deedPerTenant.render.test.tsx asserts that absence on purpose -- so
 * there is no mock-mode render in which these rows exist. What is
 * asserted is the property that was wrong: which FIELD each row reads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src/pages/ApplicationDetail/ApplicationDetail.tsx');
const src = readFileSync(SRC, 'utf8');

/** The source with comments stripped. They quote the old expression on
    purpose, so a grep over the whole file finds the thing the fix
    deleted. Learned in round_sixs_remaining_lows.test.sql. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('a delivered deed says where it actually went', () => {
  it('no longer falls back to today’s resolved recipient', () => {
    expect(code).not.toMatch(/attemptedTo\s*\?\?\s*\(\s*dlvWouldGo/);
  });

  /* AND THE RUNG WITH IT. `attemptedSource ?? source` was the same
     substitution one line down: it would explain where TODAY's address
     comes from, printed beside an address from months ago. */
  it('nor to today’s rung for the address it used', () => {
    expect(code).not.toMatch(/attemptedSource\s*\?\?\s*delivery\.source/);
  });

  it('and says so plainly when there is no record, rather than guessing', () => {
    expect(code).toMatch(/attemptedTo\s*\?\?\s*'Not recorded'/);
  });
});

/* THE RENDER BLOCK, not the label ternary above it. Both mention every
   dlvState, and a bare indexOf finds the ternary first: my first draft
   sliced from there and asserted against the wrong 600 characters. */
const body = code.slice(code.indexOf('const deliveryBody'));
const arm = (state: string) => body.slice(body.indexOf(`dlvState === '${state}'`), body.indexOf(`dlvState === '${state}'`) + 900);

describe('what must NOT change', () => {
  /* THE OTHER HALF OF THE INSTRUCTION: "If it hasn't been sent, say who
     it will go to." The not_attempted and cannot_deliver arms are
     PREDICTIONS and are meant to be, so the fix must not have turned an
     unsent application's panel blank. */
  it('an unsent deed still says who it will go to', () => {
    expect(arm('not_attempted')).toMatch(/Goes to/);
    expect(arm('not_attempted')).toMatch(/dlvWouldGo/);
  });

  it('and one nobody can receive still says who it would have gone to', () => {
    expect(arm('cannot_deliver')).toMatch(/Would go to/);
    expect(arm('cannot_deliver')).toMatch(/dlvWouldGo/);
  });

  /* A FAILED ATTEMPT ALREADY DID THIS RIGHT and is the shape the
     delivered arm should always have had. */
  it('and a failed attempt still reports the address it actually tried', () => {
    expect(arm('failed')).toMatch(/attemptedTo\s*\?\?\s*'Not recorded'/);
  });
});

describe('a single-office agency has no Branch line on Referring agent', () => {
  /* NM-P, and the point is that it is keyed on the AGENCY rather than on
     the reader. The two collapses beside it are about the reader's own
     scope and are a different rule; an admin was being shown a Branch
     row repeating the agency's own name. */
  it('asks showsOffices about the agency, not the viewer', () => {
    const card = code.slice(code.indexOf('const referrerCard'), code.indexOf('const [notes'));
    expect(card).toMatch(/showsOffices\(d\.agency\)/);
    // The admin arm is the one that had no collapse at all.
    expect(card).toMatch(/if \(!agencyViewer\)[\s\S]{0,200}branch: offices/);
  });
});
