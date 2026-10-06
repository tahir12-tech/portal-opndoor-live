/* NM-O. A SUPPLIER USER HAS NO BRANCH, AND IS NOT A "PARTNER".
 *
 * Matt, 2026-09-30, verbatim: "Supplier Add user form: suppliers' own staff
 * do the referring, so a supplier user has no branch. Remove the Branch
 * field from inviting or editing a supplier user entirely, for every role;
 * the agency and branch are chosen on each referral instead. Replace
 * 'Partner company' and 'partner' with 'Supplier' throughout, including the
 * role descriptions."
 *
 * THE MODEL ALREADY AGREED WITH HIM, which a read-only sweep confirmed
 * before any of this was built. Exactly four functions in the whole schema
 * still mention `users.home_branch_id` and none is a boundary;
 * `user_must_hold_a_position` returns early when the partner is not
 * `opndoor_referenced` and says why -- "on the supplier rail partner_id IS
 * the company boundary ... requiring a position there would be ceremony
 * with no boundary behind it." League, statements and notifications, the
 * three Matt named, all resolve from positions or from the APPLICATION's
 * branch, never from the user's. So this is a form and copy change.
 *
 * WHY THIS IS A SOURCE TEST, AND IT IS NOT LAZINESS. The first version
 * mounted the whole app through the /users route, copying the harness
 * inviteOntoTheEstate.render.test.tsx uses. It did not fail -- it HUNG,
 * every run, until the timeout, and went on hanging through three attempts
 * at the fixture. A test that hangs is worse than a weaker test that
 * reports: it blocks the suite and tells you nothing.
 *
 * And what is actually being asserted here is exact. The three things that
 * had to change are a CONDITION, a GUARD and four literal STRINGS, and each
 * is checked as written rather than inferred from a rendering. The one
 * thing a render would add -- that the field is absent on screen -- follows
 * from the condition, which is asserted in both directions.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING, for the reason
 * round_sixs_remaining_lows.test.sql records: the house style writes the
 * old code into the comment explaining the fix, so a grep over the raw
 * file finds the thing the fix deleted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(process.cwd(), 'src/pages/UserManagement/UserManagement.tsx');
const raw = readFileSync(FILE, 'utf8');
const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('the Branch field', () => {
  /* THE CONDITION IS THE RAIL, NOT THE ROLE, and "for every role" is
     Matt's own qualifier. The old test drew the field for a supplier's
     Referrer and not for their Management, so a role-shaped fix would
     have left the other arm to come back. */
  it('is offered on our own estate and nowhere else', () => {
    expect(code).toMatch(/addOnEstate && addLevel === 'Negotiator' && branchTargets\.length > 0/);
  });

  it('and the old rail-or-role condition is gone', () => {
    expect(code).not.toMatch(/addOnEstate \? addLevel === 'Negotiator' : addRole === 'referrer'/);
  });
});

describe('the guard that would have blocked on an absent control', () => {
  /* THE ONE THAT MATTERS. This refused a Manager's Referrer invite until a
     branch was picked -- and the SERVER never asked: invite-user's
     equivalent is gated on `callerScoped`, true only for a caller holding
     user_scopes rows, which a supplier's staff never do. Remove the field
     and leave this, and a supplier's Manager is stopped by a toast naming
     a control that is no longer on the screen. */
  it('only applies on our own estate now', () => {
    expect(code).toMatch(/addOnEstate && effRole === 'referrer' && role === 'management'/);
  });

  it('and its wording is plain English, not "branch"', () => {
    // Walk fix 14: "branch" is our vocabulary, "office" is theirs.
    expect(code).not.toMatch(/Choose the branch this negotiator will work at/);
  });
});

describe('the invite payload', () => {
  it('carries no home branch off the estate', () => {
    expect(code).toMatch(/branch:\s*addOnEstate && effRole === 'referrer' \? addBranch : ''/);
  });
});

describe('the copy', () => {
  it('calls the company a Supplier', () => {
    expect(code).toMatch(/label="Supplier"/);
  });

  it('and no longer says "Partner company"', () => {
    expect(code).not.toMatch(/label="Partner company"/);
  });

  /* THE HINT TOO. The select under it is fed by getPartners(), which
     strips every house partner and returns supplier companies only, so
     the old label was already wrong about its own contents. */
  it('and the hint under it says supplier as well', () => {
    expect(code).not.toMatch(/The partner company this user belongs to/);
    expect(code).toMatch(/The supplier this person works for/);
  });

  it('and the role descriptions say Supplier', () => {
    expect(code).not.toMatch(/Partner-side integrator/);
    expect(code).toMatch(/Supplier management\./);
  });
});

describe('what must NOT be renamed', () => {
  /* THE BOUNDARY KEEPS ITS NAME. On the supplier rail the partner IS the
     company boundary, and renaming it in code is a far larger and riskier
     change than the copy fix asked for. suppliersAreCalledSuppliers.test.ts
     exists to stop a sweep doing it; this extends that cover to the invite
     surface, which is where the sweep would start. */
  it('the identifiers the isolation model is built on', () => {
    for (const id of ['addPartnerId', 'getPartners']) {
      expect(raw, `${id} was renamed`).toMatch(new RegExp(`\\b${id}\\b`));
    }
  });

  it('and the payload key invite-user reads', () => {
    expect(code).toMatch(/partner:\s*addPartnerId/);
  });
});

describe('and the estate keeps its Branch field, which is the control', () => {
  /* WALK FIX 13 EXISTS BECAUSE AN AGENCY INVITE WITHOUT A POSITION IS
     REFUSED BY THE SERVER: "Everybody on our estate holds a position...
     jane@jane.com has none." So removing the field for a supplier must not
     remove it for an agency. Without this assertion the whole file is
     satisfiable by deleting the control outright. */
  it('the estate arm of the condition survives', () => {
    expect(code).toMatch(/addOnEstate && addLevel === 'Negotiator'/);
  });

  it('and so does the position the estate invite sends', () => {
    expect(code).toMatch(/scopeKind:\s*scope\?\.kind/);
  });
});
