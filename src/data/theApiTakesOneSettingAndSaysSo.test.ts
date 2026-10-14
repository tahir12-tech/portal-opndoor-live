/* =====================================================================
   THE PARTNER API TAKES ONE CHECKING SETTING, AND REFUSES THE OTHER TWO
   IN SO MANY WORDS.

   Matt, 2026-10-05, item 12: "A test sending a referral through the
   partner API on each of the three checking settings, including a
   supplier-estate agency inheriting its supplier's setting."

   THE ANSWER TO "ON EACH OF THE THREE" IS NOT THREE REFERRALS. Two of
   the three cannot be sent through the API at all: the edge function
   dispatches on the partner's mode and returns 501 not_implemented for
   both of them, deliberately. The comment in the dispatch says why, and
   it is the right call:

       "Refusing is deliberate. There is no criteria engine, so this
        partner would otherwise be silently accepted on every
        application, which is indistinguishable from working and would
        be discovered commercially."

   So this file pins the refusal. A test that merely sent one referral
   and passed would leave the two refusals unguarded -- and a later
   change that let a screened partner through would be invisible until a
   tenant nobody screened had a guarantee.

   THE OTHER HALF IS SQL and is in
   the_api_freezes_the_setting_it_inherits.test.sql: an agency in a
   supplier's estate holds no setting of its own, so a referral freezes
   the supplier's, proved on all three settings against the same agency.

   SOURCE-READ, like the other edge-function guards in this directory:
   Deno is not installed here, so the function cannot be executed, and
   the dispatch is a shape that reads clearly.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'supabase/functions/_shared/partnerApplications.ts'), 'utf8');

describe('the dispatch', () => {
  /* ONE SWITCH, IN ONE PLACE. The file says so itself, and it is what
     makes a fourth setting one branch rather than a search. */
  it('is a single switch on the partner’s mode', () => {
    expect(SRC).toContain('// ---- mode dispatch');
    expect(SRC).toMatch(/A single switch on the partner's mode, deliberately in one place/);
  });

  it.each([
    ['opndoor_referenced', 'opndoor checks tenants itself'],
    ['pre_referenced_screened', 'opndoor applies its own criteria too'],
  ])('refuses %s (%s) with 501 not_implemented', (mode) => {
    const at = SRC.indexOf(`mode === "${mode}"`);
    expect(at, `${mode} is named in the dispatch`).toBeGreaterThan(0);
    const branch = SRC.slice(at, at + 700);
    expect(branch).toContain('status: 501');
    expect(branch).toContain('not_implemented');
  });

  /* AND THE SCREENED REFUSAL CARRIES ITS REASON, because this is the one
     somebody will be tempted to delete: it looks like a gap and it is a
     decision. */
  it('and says why the screened one is refused rather than accepted', () => {
    expect(SRC).toMatch(/There is no criteria engine/);
    expect(SRC).toMatch(/indistinguishable from working/);
  });

  it('accepts only straight-to-payment', () => {
    expect(SRC).toContain('if (mode !== "pre_referenced_open") {');
  });

  /* THE CATCH-ALL IS NOT THE SAME LINE TWICE. A fourth setting added to
     the database tomorrow reaches the final guard, not one of the two
     named arms, and is refused rather than falling through into the
     straight-to-payment path. */
  it('and refuses anything it has never heard of, the same way', () => {
    const at = SRC.indexOf('if (mode !== "pre_referenced_open") {');
    const branch = SRC.slice(at, at + 400);
    expect(branch).toContain('501');
    expect(branch).toContain('not_implemented');
  });
});

describe('what the caller is told', () => {
  /* ONE MESSAGE, NOT A HINT ABOUT OUR ROADMAP. "not yet available" is
     the whole of what a partner integration needs: retrying will not
     help, and the fix is a conversation rather than a code change at
     their end. */
  it('is one sentence, and the same one for every refused setting', () => {
    const msgs = [...SRC.matchAll(/message: "This partner's referencing mode is not yet available\."/g)];
    expect(msgs.length).toBe(3);
  });
});
