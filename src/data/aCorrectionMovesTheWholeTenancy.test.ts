/* Q1. A CORRECTION MOVES THE WHOLE TENANCY, OR IT MOVES NOTHING.
 *
 * Matt, 2026-09-30, verbatim: "a start-date correction on a joint tenancy
 * moves every tenant's application and reissues every deed, never one."
 *
 * WHAT WAS WRONG. Migration 20261006860000 ("R5. A TENANCY HAS ONE START
 * DATE") rewrote `amend_tenancy_start` precisely because correcting one
 * application of a joint tenancy left "two executed instruments stating
 * different start dates for the same let", and because `expiry_date` is
 * GENERATED from `tenancy_start`, so the discrepancy is carried to the
 * underwriter on the bordereau.
 *
 * The AGENT path never went through that RPC and says so in its own header:
 * "It runs with the SERVICE ROLE because the agent has no login;
 * amend_tenancy_start is gated on AAL2 + ownership and cannot be reached
 * from here." What it did instead was
 *
 *     .update({ tenancy_start: proposed }).eq("id", full.id)
 *
 * -- one row, by id -- and then ran the void/archive/reissue lifecycle on
 * that one application. `public.tenancies.tenancy_start` was never touched.
 * So the co-tenant's executed deed kept the old date and the old generated
 * expiry: exactly the divergence R5 exists to prevent, reachable with no
 * sign-in, for seven days, by either tenant's agent.
 *
 * TWO THINGS COME WITH THE FIX AND NEITHER IS IN MATT'S SENTENCE. Both were
 * found by an adversarial check BEFORE any of it was built, and without
 * them this ships a worse bug than it fixes.
 *
 * 1. THE CLAIM HAS TO MOVE TO THE TENANCY. `deedEmail` mints and reuses a
 *    token per APPLICANT, so each tenant of a joint let has their own live
 *    seven-day link. Round 6's M4 moved the claim from the token to the
 *    application, which was right then. Correct the whole tenancy through
 *    tenant 1's link and tenant 2's link is still unused and still live --
 *    and clicking it would re-run the entire teardown across every sibling.
 *    That is M4 again, one level up.
 *
 * 2. EVERY SIBLING IS TESTED BEFORE ANYTHING IS WRITTEN. The RPC checks
 *    permission and eligibility for every application in the tenancy and
 *    aborts the lot on a single refusal. The agent path checked
 *    `withdrawn_at` on the clicked application alone, so without the same
 *    pre-check a correction would move a withdrawn sibling's date and tear
 *    down a deed that should not have been touched.
 *
 * WHY THIS IS A SOURCE TEST. These are Deno edge functions: vitest cannot
 * collect them, and tenancy-correction reaches Deno.env at module scope so
 * it cannot be imported either. The same reason, and the same shape, as
 * oneLiveCorrectionLink.test.ts beside it. What is asserted is the property
 * that was wrong: the SCOPE of each write.
 *
 * AND THE pgTAP FILE WILL NOT CATCH THIS, which is worth saying because it
 * looks as though it should. `a_tenancy_has_one_start_date.test.sql`
 * exercises the RPC, and the agent path deliberately bypasses the RPC --
 * which is exactly how this gap survived R5.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FN = join(process.cwd(), 'supabase/functions/tenancy-correction/index.ts');
const src = readFileSync(FN, 'utf8');

/** The source with its comments removed. Comments quote the old code on
    purpose, so a grep over the whole file finds the thing the fix deleted.
    Learned the hard way in round_sixs_remaining_lows.test.sql. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('the correction reads the tenancy, not just the application', () => {
  it('selects tenancy_id', () => {
    expect(code).toMatch(/tenancy_id/);
  });

  /* THE SIBLING SET IS RESOLVED EXPLICITLY. A correction that only ever
     touches `full.id` cannot be moving every tenant's application, whatever
     else the file says. */
  it('and resolves the sibling applications from it', () => {
    expect(code).toMatch(/\.eq\(\s*["']tenancy_id["']/);
  });
});

describe('every sibling is checked before anything is written', () => {
  /* R5's rule, brought to this path: test the lot, then write, so a
     refusal on one leaves nothing half-moved. */
  it('refuses when any sibling is withdrawn, not just the clicked one', () => {
    // The withdrawn test must be applied across the set rather than to one row.
    expect(code).toMatch(/withdrawn/);
    expect(code).toMatch(/some\(|every\(|filter\(/);
  });

  /* AND THE REFUSAL COMES BEFORE THE WRITE. A pre-check that runs after the
     first update is not a pre-check. */
  it('and the check precedes the first application update', () => {
    const firstWithdrawnCheck = code.search(/withdrawn/);
    const firstUpdate = code.search(/from\(["']applications["']\)\s*\n?\s*\.update/);
    expect(firstWithdrawnCheck, 'no withdrawn check at all').toBeGreaterThan(-1);
    expect(firstUpdate, 'no application update at all').toBeGreaterThan(-1);
    expect(firstWithdrawnCheck).toBeLessThan(firstUpdate);
  });
});

describe('the claim burns every link for the tenancy', () => {
  /* ROUND 6's M4, ONE LEVEL UP. Each applicant has their own live token, so
     claiming by application leaves the co-tenant's link live to re-run the
     whole teardown. */
  it('no longer claims by application id alone', () => {
    const claim = code.slice(code.indexOf('tenancy_correction_tokens'));
    expect(claim).not.toMatch(/\.eq\(\s*["']application_id["']\s*,\s*tok\.application_id\s*\)/);
  });

  it('and claims across every application in the tenancy', () => {
    const claim = code.slice(code.indexOf('tenancy_correction_tokens'));
    expect(claim).toMatch(/\.in\(\s*["']application_id["']/);
  });

  /* THE CONDITIONAL CLAIM SURVIVES. `.is("submitted_at", null)` is what
     makes the update atomic and gives exactly one winner between two
     simultaneous submits. Widening the scope must not lose it. */
  it('and is still the atomic claim, so two simultaneous submits have one winner', () => {
    const claim = code.slice(code.indexOf('tenancy_correction_tokens'));
    expect(claim).toMatch(/\.is\(\s*["']submitted_at["']\s*,\s*null\s*\)/);
  });
});

describe('the date is written to the tenancy as well as the applications', () => {
  /* `public.tenancies.tenancy_start` is the row R5 added for this. Leaving
     it behind means the applications agree with each other and disagree
     with the tenancy they belong to. */
  it('updates public.tenancies', () => {
    expect(code).toMatch(/from\(["']tenancies["']\)/);
  });

  it('and no longer updates one application by id', () => {
    expect(code).not.toMatch(/\.update\(\{\s*tenancy_start:\s*proposed\s*\}\)\s*\.eq\(\s*["']id["']\s*,\s*full\.id\s*\)/);
  });
});

describe('the deed lifecycle runs for every sibling', () => {
  /* The half that is easy to leave behind: the DATE moves for everybody and
     the DEEDS are reissued for one. That is the same divergence in a
     different column -- three applications agreeing on the start date, one
     corrected deed and two stating the old one. */
  it('is driven from the sibling set rather than the single application', () => {
    const lifecycle = code.slice(code.indexOf('deed_state'));
    expect(lifecycle).toMatch(/for\s*\(|\.map\(|forEach\(/);
  });
});

describe('what must NOT change', () => {
  /* A SINGLE TENANCY IS STILL A SINGLE TENANCY. tenancy_id is nullable, and
     most applications have none; the fix must not make a solo correction
     depend on a tenancy row that does not exist. */
  it('still handles an application with no tenancy', () => {
    expect(code).toMatch(/tenancy_id\s*(\?\?|===|!==|\?)/);
  });

  /* AND THE RANGE CHECK STAYS. The service-role write bypasses
     amend_tenancy_start, so its 2000-01-01 .. today+5y guard is repeated
     here and must survive the rewrite. */
  it('and still refuses a date outside the range the RPC allows', () => {
    expect(code).toMatch(/2000-01-01/);
    expect(code).toMatch(/5\s*\*\s*365/);
  });

  /* AND THE ALREADY-SUBMITTED MESSAGE STAYS PLAIN ENGLISH. Walk fix 14. */
  it('and still says in plain English when a link has already been used', () => {
    expect(src).toMatch(/already been submitted/i);
  });
});
