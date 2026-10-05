/* =====================================================================
   ON THE JOURNEY WITH TWO FEES, A REFUND LINE MUST SAY WHICH ONE.

   Matt (du): "on the 'opndoor checks' tenant leaflet, change 'Full
   refund if it falls through' so it says it's a full refund of the
   guarantee fee, not the £20. Check every tenant-facing refund line
   on that journey says the same."

   =====================================================================
   THE COPY WAS TRUE AND BECAME AMBIGUOUS WITHOUT BEING EDITED
   =====================================================================

   "If the tenancy doesn't go ahead, you get a full refund of the fee"
   was exactly right while there was one fee. Adding the GBP 20
   eligibility check to that journey turned it into a promise of money
   the tenant will not get, in a document an agent prints and hands
   over -- and nothing about the sentence changed.

   THAT IS THE GENERAL HAZARD and the reason this file exists rather
   than a one-line edit: the next person to add a charge to a journey
   will not think to re-read every sentence containing the word "fee".
   This one does it for them.

   WHAT THE SWEEP FOUND. Only the leaflet. The refund email already
   says "Your guarantee fee has been refunded" (emailTemplates.ts:750)
   and the payment page already says "The guarantee fee is
   non-refundable from your tenancy start date"
   (PayLanding.tsx:408). Both were written when there was one fee and
   both happen to name it, so both survive -- which is worth recording,
   because it is luck rather than design and the test now makes it
   design.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => (existsSync(join(process.cwd(), p)) ? readFileSync(join(process.cwd(), p), 'utf8') : '');

/** Every tenant-facing surface on the two-fee journey. */
const SURFACES: [string, string][] = [
  ['the eligibility-journey leaflet', 'public/help-docs/opndoor-for-tenants-eligibility.html'],
  ['the refund email', 'supabase/functions/_shared/emailTemplates.ts'],
  ['the payment page', 'src/pages/Pay/PayLanding.tsx'],
  ['the apply journey', 'src/pages/Apply/Apply.tsx'],
];

/* A refund sentence that names no fee. "refund of the fee", "refund
   the fee", "the fee is refundable" -- anything where the only noun is
   a bare "fee". A sentence naming the guarantee fee or the GBP 20 is
   fine, which is the whole point. */
const BARE = /\b(?:full )?refund(?:ed|able)?\s+(?:of\s+)?the\s+fee\b/i;

describe('a refund line on the two-fee journey', () => {
  it.each(SURFACES)('%s names which fee', (_label, path) => {
    const src = read(path);
    expect(src, `${path} is missing`).not.toBe('');
    const sentences = src.split(/(?<=[.!?])\s+|\n/);
    const bare = sentences.filter((t) => BARE.test(t)).map((t) => t.trim().slice(0, 120));
    expect(bare).toEqual([]);
  });

  /* THE LEAFLET SAYS BOTH HALVES, which is the fix Matt asked for:
     the guarantee fee comes back, the GBP 20 does not. Naming only
     the first would leave a reader to assume the second. */
  it('and the leaflet says both halves', () => {
    const leaflet = read('public/help-docs/opndoor-for-tenants-eligibility.html');
    expect(leaflet).toContain('full refund of the <b>guarantee fee</b>');
    expect(leaflet).toContain('&pound;20 eligibility check fee is not refunded');
  });

  /* AND THE ONE-FEE LEAFLET IS LEFT ALONE. On that journey "the fee"
     is unambiguous, and rewriting it would be change for its own
     sake. Asserted so a later sweep does not "tidy" it. */
  it('while the one-fee leaflet is untouched', () => {
    const plain = read('public/help-docs/opndoor-for-tenants.html');
    expect(plain).toContain('full refund of the fee');
  });
});
