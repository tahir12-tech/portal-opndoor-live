/* THE OPNDOOR TEAM COULD NOT BE ADDED TO.
 *
 * Matt, 2026-10-03, verbatim: "Blocker: Add opndoor team member with 'opndoor
 * manager' selected fails with 'A portal user is a manager, a referrer or a
 * developer.' The invite path doesn't accept the opndoor manager level. Fix it
 * so both opndoor admin and opndoor manager can be invited... 2. The two role
 * options in that dialog are in letter-spaced capitals. Use normal sentence
 * case like the rest of the portal's radio options, rename 'OPNDOOR ADMIN
 * (SUPER-ADMIN)' to 'opndoor admin', and say 'suppliers and agencies' instead
 * of 'partners'. 3. Breadcrumb and title 'Administration / Users' should say
 * 'opndoor team'."
 *
 * THE BLOCKER WAS ONE ALLOWLIST, THREE ROLES LONG, in SQL --
 * `create_invited_user`, whose own sentence that is. `invite-user` has had a
 * branch for both opndoor roles since it was written, which is why the failure
 * read as a level problem rather than a missing case. The SQL half and the
 * refusals that keep those seats Opndoor's are proved against dev in
 * the_opndoor_team_can_be_invited.test.sql; this file is the dialog.
 *
 * AND THE CAPITALS WERE NOBODY'S CHOICE. `.roleopt` IS a <label>, so inside a
 * `.field` it inherited `.field label` from portal.css -- 11px, weight 700,
 * letter-spacing .12em, uppercase. Right for the one-word caption over an
 * input; wrong for a radio option whose name is "opndoor admin" and whose body
 * is three sentences.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = read('src/pages/UserManagement/UserManagement.tsx');
const CSS = read('src/pages/UserManagement/UserManagement.css');
const MIG = read('supabase/migrations/20261007830000_the_opndoor_team_can_be_invited.sql');

describe('the two opndoor roles can be invited', () => {
  it('because the allowlist admits them', () => {
    expect(MIG).toContain("if p_role not in ('management', 'referrer', 'developer', 'superadmin', 'opndoor_manager') then");
  });

  /* AND THE SENTENCE NAMES ALL FIVE, so the next person who sends a bad role
     is told what the five are rather than three of them. */
  it('and the refusal for anything else names all five', () => {
    expect(MIG).toContain('A portal user is a manager, a referrer, a developer, an opndoor admin or an opndoor manager.');
  });

  /* THEY ARE OPNDOOR'S OWN SEATS, so only Opndoor may make one, with no
     partner and no position. Each refused by its own sentence rather than
     arriving as a constraint violation. */
  it('while only opndoor may create one', () => {
    expect(MIG).toContain('Only opndoor can add somebody to the opndoor team.');
    expect(MIG).toContain('An opndoor admin or manager belongs to no supplier or agency.');
    expect(MIG).toContain('An opndoor admin or manager holds no position at an agency.');
  });

  /* AND THE AGENCY LADDER NO LONGER RUNS ON A SUPPLIER INVITE, which is the
     second refusal this migration lifts and the SQL half of the same
     correction invite-user got. */
  it('and the agency ladder is asked on our own estate only', () => {
    expect(MIG).toContain("if v_our_estate and p_role in ('management', 'referrer') then");
    expect(MIG).toContain("select p.partner_kind = 'agency' into v_our_estate");
  });
});

describe('the dialog', () => {
  it('is in sentence case, not letter-spaced capitals', () => {
    expect(CSS).toContain('text-transform: none;');
    expect(CSS).toContain('letter-spacing: normal;');
  });

  it('calls the role "opndoor admin"', () => {
    expect(PAGE).toContain("name: 'opndoor admin',");
    // CODE ONLY: the comment above the option quotes the old name, which is
    // where the reason for the rename belongs.
    const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('opndoor admin (Super-admin)');
  });

  /* "partners" IS THE SCHEMA'S WORD FOR TWO DIFFERENT KINDS OF COMPANY, and
     the opndoor manager's description is where it leaked furthest: "every
     referral across all partners" and "cannot change partner settings". */
  it('and says suppliers and agencies, not partners', () => {
    const opts = PAGE.slice(PAGE.indexOf('const ROLE_OPTIONS'), PAGE.indexOf('function RoleOptions'));
    const code = opts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/all partners/);
    expect(code).not.toMatch(/partner settings/);
    expect(code).toContain('every supplier and agency');
  });
});

describe('the page', () => {
  /* ONE ROUTE, TWO PAGES, and the meta was written for the other one. The
     sidebar has said "opndoor team" all along, so a reader following it
     arrived at a page headed "Administration / Users". */
  /* THREE PAGES OUT OF ONE ROUTE SINCE 2026-10-03, not two. Matt: "the
     sidebar label 'Team' to match agencies", for a supplier's own Management.
     So the ternary this used to pin grew a middle arm, and the assertion is
     split into the three answers rather than one string. */
  it('is called the opndoor team in its title and breadcrumb', () => {
    expect(PAGE).toContain("teamMode ? 'opndoor team' : supplierRail ? 'Team' : 'Users',");
    expect(PAGE).toContain("teamMode ? ['Home', 'opndoor team'] : supplierRail ? ['Home', 'Team'] : ['Home', 'Administration', 'Users'],");
  });

  /* THE SUPPLIER'S PAGE IS NOW CHANGED ON PURPOSE, which is why this test no
     longer says "unchanged". It used to read a customer's staff page as one
     thing; it is two, and only ours still sits in an Administration section:

       a supplier's Management   Home / Team, matching the agency Team page,
                                 because "Administration" is Opndoor's own
                                 section and they are not in it
       an opndoor admin          Home / Administration / Users, unchanged

     The second is what the string below still pins. */
  it('while the admin\u2019s own view of a customer\u2019s staff is unchanged', () => {
    expect(PAGE).toContain("['Home', 'Administration', 'Users']");
  });

  /* AND THE NAV AGREES WITH THE BREADCRUMB, which is the whole complaint: the
     sidebar is what the reader follows, so a page headed something else is the
     defect whichever of the two is wrong. */
  it('and the sidebar calls it Team too', () => {
    const nav = read('src/constants/nav.ts');
    expect(nav).toContain("{ id: 'users', label: 'Team', to: '/users'");
    // Not in Opndoor's admin group any more.
    expect(nav).not.toMatch(/group: 'Administration'/);
  });
});
