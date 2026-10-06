/* THE CORRECTED-DEED NOTE WAS SHOUTING, AND THEN IT STOPPED APPEARING.
 *
 * Matt, 2026-10-03, verbatim: "Corrected-deed note in the signed-deed emails
 * (tenant and agent): style it as a normal-weight paragraph in the email's
 * body text style, with at most a subtle left border, not large bold
 * letter-spaced text in a box. Dates as '1 Oct 2026', not '01 Oct 2026'."
 *
 * IT WAS USING `callout`, which is the layout's CODE block: 22px, bold,
 * letter-spaced .08em, centred, in a filled box with a border. That is right
 * for a six-character reference and wrong for a two-line sentence, which
 * arrived looking like a billboard above the actual email. The layout now has
 * a `note` block -- the body paragraph, with a rule down its left edge -- and
 * `callout` keeps its own job.
 *
 * AND THE NOTE HAD ALREADY STOPPED APPEARING AT ALL, which is why this file
 * also tests the label. 20261007640000 fixed the corrected-deed blocker by
 * MOVING the earlier delivery to `deed_delivery_superseded_at` and nulling
 * `deed_delivered_at`. `correctedFromLabel` was still asking the nulled
 * column, so from that migration onwards the sentence that says "this
 * replaces the one sent on ..." could never be produced on the very emails it
 * exists for: the correction clears the only date it read. Restyling a note
 * nobody can see is not a fix, so both halves are here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  executedDeedAgentEmail, executedDeedTenantEmail,
} from '../../supabase/functions/_shared/emailTemplates.ts';
import { renderHtml, renderText } from '../../supabase/functions/_shared/emailLayout.ts';

/* deedEmail.ts REACHES Deno.env AT MODULE LOAD, through emailRecipients, so it
   cannot be imported statically here: the import is hoisted above everything
   and the module evaluates before any shim could exist. The shim goes up
   front and the module is loaded on demand inside the one describe that needs
   it. The templates and the layout have no such dependency and stay static. */
(globalThis as unknown as { Deno?: unknown }).Deno = { env: { get: () => '' } };
const deedEmail = () => import('../../supabase/functions/_shared/deedEmail.ts');

const base = {
  guaranteeRef: 'GR-23853', tenantName: 'Joint One',
  propertyAddr: '1 Example Road, N1 1AA', tenancyStartLabel: '29 December 2026',
};

const agentHtml = renderHtml(executedDeedAgentEmail({ ...base, correctedFrom: '1 Oct 2026' }));
const tenantHtml = renderHtml(executedDeedTenantEmail({
  guaranteeRef: base.guaranteeRef, propertyAddr: base.propertyAddr,
  tenancyStartLabel: base.tenancyStartLabel, correctedFrom: '1 Oct 2026',
}));

/** The one table cell holding the note, in either email. */
function noteCell(html: string): string {
  const cells = html.split('<td').filter((c) => c.includes('This corrected deed replaces'));
  expect(cells, 'the note is in exactly one cell').toHaveLength(1);
  return cells[0];
}

describe.each([['the agent’s copy', agentHtml], ['the tenant’s copy', tenantHtml]])('%s', (_which, html) => {
  const cell = () => noteCell(html);

  it('sets the note in the body text style, at normal weight', () => {
    expect(cell()).toContain('font:400 15px/1.65');
  });

  it('with a subtle left border and nothing else around it', () => {
    expect(cell()).toContain('border-left:3px solid');
    expect(cell()).not.toContain('border-radius');
    expect(cell()).not.toContain('background:');
  });

  it('and none of the callout shouting', () => {
    expect(cell()).not.toContain('letter-spacing');
    expect(cell()).not.toContain('font:700 22px');
    expect(cell()).not.toContain('text-align:center');
  });

  /* THE SENTENCE IS UNCHANGED, which is the other half of a styling fix:
     nothing about the words was reported. */
  it('while the words are what they were', () => {
    expect(renderText(executedDeedAgentEmail({ ...base, correctedFrom: '1 Oct 2026' })))
      .toContain('This corrected deed replaces the one sent on 1 Oct 2026.');
  });
});

/* THE CODE BLOCK KEEPS ITS OWN STYLE, so this was a change of which block the
   note uses and not a flattening of the layout. */
describe('the callout block', () => {
  const LAYOUT = readFileSync('supabase/functions/_shared/emailLayout.ts', 'utf8');

  it('is still the big centred one, for a code', () => {
    expect(LAYOUT).toContain('font:700 22px/1.3 ${FONT};color:${VALHALLA};letter-spacing:.08em;text-align:center;');
  });

  it('and the note is a block of its own, not a restyled callout', () => {
    expect(LAYOUT).toContain('| { note: string }');
    expect(LAYOUT).toContain('if ("note" in b) {');
  });
});

/* ---- the label, which is what the note says ---- */

/** The one row `correctedFromLabel` reads, behind the client's shape. */
const svc = (row: Record<string, unknown> | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
});

describe('correctedFromLabel', () => {
  it('reads the superseded delivery, which is where a correction puts it', async () => {
    const { correctedFromLabel } = await deedEmail();
    expect(await correctedFromLabel(svc({
      deed_delivered_at: null,
      deed_delivery_superseded_at: '2026-10-01T20:21:00Z',
      deed_issued_at: '2026-10-03T11:28:44Z',
    }), 'id')).toBe('1 Oct 2026');
  });

  /* THE DAY HAS NO LEADING ZERO, which is the second half of the
     instruction. 1 October is the case that shows it. */
  it('and says "1 Oct 2026", not "01 Oct 2026"', async () => {
    const { correctedFromLabel } = await deedEmail();
    const label = await correctedFromLabel(svc({
      deed_delivered_at: null, deed_delivery_superseded_at: '2026-10-01T09:00:00Z', deed_issued_at: null,
    }), 'id');
    expect(label).toBe('1 Oct 2026');
    expect(label).not.toMatch(/^0/);
  });

  /* THE HISTORIC PATH. A row corrected before 20261007640000 still holds the
     earlier delivery in `deed_delivered_at`, and there the newer issue stamp
     is the only thing separating a correction from a plain resend. */
  it('still reads a pre-migration row, where the delivery was left in place', async () => {
    const { correctedFromLabel } = await deedEmail();
    expect(await correctedFromLabel(svc({
      deed_delivered_at: '2026-10-01T20:21:00Z',
      deed_delivery_superseded_at: null,
      deed_issued_at: '2026-10-03T11:28:44Z',
    }), 'id')).toBe('1 Oct 2026');
  });

  it('and a plain resend of the same deed is not a correction', async () => {
    const { correctedFromLabel } = await deedEmail();
    expect(await correctedFromLabel(svc({
      deed_delivered_at: '2026-10-03T11:30:00Z',
      deed_delivery_superseded_at: null,
      deed_issued_at: '2026-10-01T09:00:00Z',
    }), 'id')).toBeNull();
  });

  it('nor is a first delivery, which has nothing to replace', async () => {
    const { correctedFromLabel } = await deedEmail();
    expect(await correctedFromLabel(svc({
      deed_delivered_at: null, deed_delivery_superseded_at: null, deed_issued_at: '2026-10-03T11:28:44Z',
    }), 'id')).toBeNull();
    expect(await correctedFromLabel(svc(null), 'id')).toBeNull();
  });
});
