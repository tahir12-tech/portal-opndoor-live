/* A JOINT START-DATE CHANGE REISSUES EVERY TENANT'S DEED.
 *
 * Matt (bn), a blocker: "Changing Jane's start date (20 Nov -> 29 Nov)
 * reissued only Jane's deed; John got no corrected-deed email. On a joint
 * tenancy, a start-date change must move every tenant's date together and
 * reissue every tenant's deed (signed or not). Emails: each tenant gets
 * their own corrected-deed email; the referrer (and anyone copied) gets ONE
 * 'start date changed' email for the tenancy listing every tenant."
 *
 * THE DATE WAS NEVER THE BUG, which measuring first established and which
 * changes what needs fixing. GR-26262 and GR-26263 both read 2026-11-29
 * with matching expiries, so `amend_tenancy_start` had moved the whole
 * tenancy -- it has done since 20261006860000. What stayed behind was the
 * INSTRUMENT: John's deed still executed, still saying 20 November, on an
 * application whose expiry is generated from the 29th.
 *
 * THE EDGE FUNCTION READ ONE APPLICATION. The RPC is tenancy-wide; the
 * function that voids, archives and regenerates ran once, on the row the
 * caller named.
 *
 * A SOURCE TEST, because Deno is not installed here and the behaviour is a
 * control-flow property: does the deed work happen once per sibling, and
 * does the referrer's notice happen once per tenancy. The SQL half -- that
 * the dates move together at two and at three -- is
 * a_joint_start_date_moves_everybody.test.sql, which exercises the real
 * database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FN = readFileSync(
  resolve(process.cwd(), 'supabase/functions/amend-tenancy-start/index.ts'), 'utf8');

/** The body of the per-application helper, which is where the deed work is. */
const amendOne = FN.slice(FN.indexOf('const amendOne ='), FN.indexOf('    /* 2) THE DEED LIFECYCLE'));
/** Everything after it: the loop and the one-per-tenancy decisions. */
const after = FN.slice(FN.indexOf('    /* 2) THE DEED LIFECYCLE'));

describe('the deed work runs once per tenant', () => {
  it('reads the whole tenancy, not just the application named', () => {
    expect(after).toContain('tenancy_id.eq.');
    expect(after).toContain('for (const a of siblings)');
  });

  /* THE AMENDED ROW IS ALWAYS IN THE LIST. A read that returned nothing
     would otherwise reissue no deeds at all, which is the same failure in
     the other direction and would look like success. */
  it('and falls back to the amended application if that read finds nothing', () => {
    expect(after).toContain('family && family.length ? family : [app]');
  });

  /* EACH SIBLING IS IN ITS OWN STATE, which is why this is a loop over the
     same branches rather than one outcome repeated: on the tenancy Matt
     reported, Jane was awaiting signature and John had signed. */
  it('and branches per sibling, so a signed and an unsigned deed both reissue', () => {
    expect(amendOne).toContain('a.deed_state === "executed" || a.status === "deed"');
    expect(amendOne).toContain('a.deed_state === "awaiting_tenant"');
    // The helper never reads the outer application: that was the bug.
    expect(amendOne).not.toContain('app.');
  });

  it('and each tenant gets their own corrected-deed email', () => {
    expect(amendOne).toContain('deliverSigningInvite(service, a.id, { reissue: true');
  });
});

describe('but the referrer hears once', () => {
  /* THE GRAIN IS THE TENANCY, not the tenant. Left inside the branches, the
     notice would fire once per sibling the moment a joint tenancy went
     through -- the same duplicate-notice fault as (bc), reintroduced by the
     loop. */
  it('the notice is outside the loop, not in it', () => {
    // THE CALL, not the word: the helper still explains in a comment why the
    // notice moved out, and a test that cannot tell those apart is a test
    // that punishes the explanation.
    expect(amendOne).not.toContain('await notifyReferrer(');
    expect(after).toContain('await notifyReferrer(service, app.id, "corrected"');
  });

  it('and exactly once in the whole function', () => {
    expect(FN.split('await notifyReferrer(').length - 1).toBe(1);
  });

  /* AND IT REPORTS WHAT HAPPENED, not what was attempted: `deedReissued`
     is computed from the outcomes rather than assumed by the branch that
     sent it. */
  it('saying whether anything was actually reissued', () => {
    expect(after).toContain('deedReissued: reissued > 0');
  });
});

describe('and one HTTP answer comes out', () => {
  /* The helper returns outcomes; only the caller replies. A stray
     `return json(...)` inside the loop would answer after the first
     sibling and silently skip the rest -- which is the original bug's
     shape, so it is worth a test of its own. */
  it('with no reply escaping the per-tenant helper', () => {
    expect(amendOne).not.toContain('return json(');
  });

  it('and a failure on any tenant is reported, naming them', () => {
    expect(after).toContain('failures.map((f) => f.error)');
    expect(amendOne).toContain('${a.guarantee_ref}');
  });
});
