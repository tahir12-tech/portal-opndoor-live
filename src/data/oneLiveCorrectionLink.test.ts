/* A CORRECTION IS A PROPERTY OF THE APPLICATION, NOT OF A LINK.
 *
 * Round 6, M4. Round 5 closed the same-token replay of the tenancy-correction
 * link. It did not close this one:
 *
 *   `_shared/deedEmail.ts` minted a NEW seven-day token on EVERY call, and it
 *   is called by the PandaDoc completion webhook, by every manual "Send deed
 *   to agent", and by every reissue. All the outstanding tokens stay live for
 *   their seven days.
 *
 *   `tenancy-correction` claimed `.eq("token", token)`, i.e. the one presented.
 *
 * So the destructive action replayed on the NEXT link. Submitting one archives
 * the signed PDF, resets the status to paid, nulls executed_pdf_path and
 * pandadoc_document_id and reissues the deed for signing; submitting the
 * second does it all again. No sign-in is needed -- the token IS the
 * authorisation -- and the links sit in an agent's inbox. Dev already carried
 * the precondition: two applications with two unused live tokens each.
 *
 * Two changes, and both are needed. Reusing the live token stops the
 * accumulation; claiming by application burns any straggler, including the
 * ones minted before the reuse landed.
 *
 * Source tests: these are Deno edge functions, `npm test` cannot collect them
 * (vitest.config.ts), and tenancy-correction reaches Deno.env at module scope
 * so it cannot be imported either. What is checked is exactly the property
 * that broke -- the scope of the claim, and whether a second token is minted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fn = (p: string) => readFileSync(join(process.cwd(), 'supabase', 'functions', p), 'utf8');

describe('minting the correction link', () => {
  const src = fn('_shared/deedEmail.ts');

  it('looks for a live one before minting another', () => {
    const reuse = src.indexOf('.is("submitted_at", null)');
    const mint = src.indexOf('.insert({\n        application_id: target.appId');
    expect(reuse, 'no lookup for an unsubmitted token').toBeGreaterThan(-1);
    expect(mint, 'no insert found').toBeGreaterThan(-1);
    expect(reuse).toBeLessThan(mint);
  });

  it('only reuses one that has not expired', () => {
    expect(src).toMatch(/\.gt\("expires_at"/);
  });

  it('still mints when there is none, so a first deed always carries a link', () => {
    expect(src).toMatch(/if \(!tokenValue\) \{[\s\S]*?\.insert\(\{/);
  });
});

/* AND THE HAND-OVER RAIL'S KEY, which is the same mistake in another table.
 * Round 6, M6 and M1: `table_id` is the PROVIDER's row number, unique in
 * their system and not in ours, and both keys put it in one global namespace.
 * Any token could claim another agency's hand-over -- the provider is then
 * answered "User already sent to guarantor.", marks it delivered, and that
 * tenant is never created -- or walk the integer space reading back other
 * agencies' states and raw error text. Re-keyed on (partner, livemode,
 * table_id), taken from the authenticated TOKEN and never from the payload.
 */
describe('the referencing hand-over ledger', () => {
  const src = fn('referencing-inbound/index.ts');

  it('claims in the partner and mode namespace, not the global one', () => {
    const claim = src.slice(src.indexOf('.from("referencing_inbound_events").insert('));
    expect(claim.slice(0, 400)).toMatch(/partner_id: token\.partner_id/);
    expect(claim.slice(0, 400)).toMatch(/livemode: token\.livemode/);
  });

  it('reads a replay back in the same namespace, so the error text belongs to the caller', () => {
    const read = src.slice(src.indexOf('const { data: prior }'));
    expect(read.slice(0, 300)).toMatch(/\.eq\("partner_id", token\.partner_id\)/);
    expect(read.slice(0, 300)).toMatch(/\.eq\("livemode", token\.livemode\)/);
  });

  it('and stamps the outcome on its own row only', () => {
    const fin = src.slice(src.indexOf('const finish = async'));
    expect(fin.slice(0, 500)).toMatch(/\.eq\("partner_id", token\.partner_id\)/);
  });

  it('never takes either from the payload', () => {
    expect(src).not.toMatch(/partner_id: *(String\()?body\./);
    expect(src).not.toMatch(/livemode: *(Boolean\()?body\./);
  });

  /* The callback writes back by the PRIMARY KEY now, because table_id alone no
     longer identifies a link. */
  it('and the callback stamps a link by its primary key', () => {
    const cb = fn('referencing-callback/index.ts');
    expect(cb).not.toMatch(/\.eq\("table_id", row\.table_id\)/);
    expect(cb).toMatch(/\.eq\("application_id", row\.application_id\)/);
  });
});

describe('claiming the correction', () => {
  const src = fn('tenancy-correction/index.ts');

  /* THE DEFECT, AND THE SCOPE HAS WIDENED ONCE SINCE.
     M4 moved the claim from the presented TOKEN to the APPLICATION,
     because deedEmail mints one on every deed send and the others stayed
     live. Matt's Q1 answer of 2026-09-30 moved it again, to the TENANCY:
     "a start-date correction on a joint tenancy moves every tenant's
     application and reissues every deed, never one."

     THAT IS THE SAME DEFECT ONE LEVEL UP, which is why the assertion
     widens rather than being replaced. Each tenant of a joint let has
     their OWN live seven-day link, so a correction that moved the whole
     tenancy while claiming only the clicked application left the
     co-tenant's link live to re-run the entire teardown.

     M4's property is UNCHANGED and still asserted: the claim is still
     wider than the presented token, and the clicked application is
     always in `ids`, so every token for it is still burned. */
  it('claims every unsubmitted token for the TENANCY, not just the one presented', () => {
    const claim = src.slice(src.indexOf('const { data: claimedRows }'));
    expect(claim.slice(0, 500)).toMatch(/\.in\("application_id", ids\)/);
    expect(claim.slice(0, 500)).not.toMatch(/\.eq\("token", token\)/);
  });

  it('still refuses when the presented token was not among them', () => {
    // Burning somebody else's live token alongside does not make this submit
    // legitimate: the presented one must have been unclaimed.
    expect(src).toMatch(/claimedRows \?\? \[\]\)\.some\(\(r: \{ token: string \}\) => r\.token === token\)/);
  });

  it('keeps the claim as the atomic step, before anything is applied', () => {
    const claim = src.indexOf('const { data: claimedRows }');
    const apply = src.indexOf('.update({ tenancy_start: proposed })');
    expect(claim).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(claim);
    expect(src).toMatch(/\.is\("submitted_at", null\)\s*\n\s*\.select\("token"\)/);
  });
});
