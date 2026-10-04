/* WHAT (bb) GRANTS AN OPNDOOR MANAGER, AND WHAT IT WITHHOLDS.
 *
 * Matt (bb): "give them the Suppliers list and each supplier's page
 * read-only (no editing settings, commission, keys or people), and New
 * application on behalf of any supplier or agency, the same form admins
 * use. Still no commission, settlements, bordereau, opndoor team or
 * Health."
 *
 * THE WITHHOLDING IS THE HARDER HALF, which is why most of this file is
 * about it. A grant is easy to widen too far, and this one withholds five
 * things in the sentence that gives three.
 *
 * AND IT ALMOST DID. `/partners` and `/health` were sharing one route
 * guard, so admitting a manager to Suppliers admitted them to Health in the
 * same edit -- caught only because the comment above the group still said
 * "admin only" when the roles no longer did.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV } from '@/constants/nav';

const APP = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const item = (id: string) => NAV.flatMap((g) => g.items).find((i) => i.id === id);
/** The RequireRole guard immediately above a route. */
const guardFor = (path: string) => {
  const i = APP.indexOf(`<Route path="${path}"`);
  expect(i, `${path} is not routed`).toBeGreaterThan(-1);
  return APP.slice(APP.lastIndexOf('<Route element={<RequireRole', i), i);
};

describe('what an opndoor manager now reaches', () => {
  it('the Suppliers list, in the sidebar and on the route', () => {
    expect(item('partners')!.roles).toContain('opndoor_manager');
    expect(guardFor('/partners')).toContain('opndoor_manager');
  });

  it('a supplier\'s own page', () => {
    expect(guardFor('/partners/:key')).toContain('opndoor_manager');
  });

  it('and New application, which the database now admits too', () => {
    expect(item('new')!.roles).toContain('opndoor_manager');
    expect(guardFor('/new-application')).toContain('opndoor_manager');
  });
});

describe('and what it still refuses them', () => {
  /* THE ONE THAT NEARLY WENT. Health shared a guard with Suppliers. */
  it('Health, which shared a route guard with Suppliers until this change', () => {
    expect(item('health')!.roles).not.toContain('opndoor_manager');
    expect(guardFor('/health')).not.toContain('opndoor_manager');
    expect(guardFor('/health')).toContain("roles={['superadmin']}");
  });

  /* RECONCILIATION went the other way earlier tonight, (cc), and must stay
     gone: a grant in one direction is not licence to undo one in the
     other. */
  it('Reconciliation, which (cc) took away and this does not give back', () => {
    expect(item('reconcile')!.roles).toEqual(['superadmin']);
    expect(guardFor('/reconciliation')).not.toContain('opndoor_manager');
  });

  /* THE OPNDOOR TEAM PAGE. Named in (bb)'s own list of exclusions. */
  it('and the opndoor team page', () => {
    const team = item('users') ?? item('team');
    if (team) expect(team.roles).not.toContain('opndoor_manager');
  });
});

describe('the SQL half, which the queue entry warned about', () => {
  /* "That server guard has to learn about opndoor_manager, or the form will
     offer a choice the database refuses." Both moved in the same change;
     this asserts they did not drift apart again. */
  it('both creators ask is_opndoor_staff, not is_admin', () => {
    const mig = readFileSync(resolve(process.cwd(),
      'supabase/migrations/20261008180000_an_opndoor_manager_may_refer_on_anybodys_behalf.sql'), 'utf8');
    const fns = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(fns).not.toContain('public.is_admin()');
    expect(fns.split('public.is_opndoor_staff()').length - 1).toBeGreaterThanOrEqual(5);
  });

  /* AND THE MONEY DID NOT MOVE WITH IT: set_agency_rates and the agreement
     writers keep their own admin check, which is what keeps this inside
     what (bb) granted. */
  it('while the rate and agreement writers are untouched', () => {
    /* THE SQL, NOT THE HEADER. The migration's comment NAMES
       set_agency_rates and create_agreement as the things it deliberately
       leaves alone, so a whole-file check fails on the explanation -- the
       same mistake I made in aJointAmendReissuesEveryDeed an hour ago. */
    const mig = readFileSync(resolve(process.cwd(),
      'supabase/migrations/20261008180000_an_opndoor_manager_may_refer_on_anybodys_behalf.sql'), 'utf8');
    const sql = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(sql).not.toContain('set_agency_rates');
    expect(sql).not.toContain('create_agreement');
    // And it touches exactly the two creators, nothing else.
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g))
      .toEqual(['CREATE OR REPLACE FUNCTION public.create_referral',
                'CREATE OR REPLACE FUNCTION public.create_joint_referral']);
  });
});
