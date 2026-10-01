/* THE DEV CENTRE IS FOR DEVELOPERS.
 *
 * Matt, 2026-10-01, verbatim: "Dev Centre is for developers only: hide it
 * from supplier Management and Referrer users entirely. Opndoor admin keeps
 * the ability to revoke keys from the supplier's Integration tab."
 *
 * WHAT THE PREDICATE USED TO ASK. After an early return for superadmin it
 * checked only whether the PARTNER had an API -- nothing about the person.
 * So every role at an API-enabled supplier passed it: Management by
 * deliberate exception (the route said "here only to revoke a leaked key")
 * and Referrer because nobody had asked. A referrer saw the nav item and was
 * then bounced to /help by the route guard, which is a hidden door with a
 * sign on it.
 *
 * NOTHING PINNED ANY OF THIS. The whole suite passed with the change already
 * made, which is why these exist.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mayUseDevCentre } from './capabilities';
import { hydratePartners } from './partnersService';
import { ALL_PARTNERS, type Partner, type Role } from './types';

const SUPPLIER = 'zzz-api';
const NO_API = 'zzz-noapi';
const OURS = 'zzz-agency-rail';

beforeEach(() => {
  hydratePartners([
    { id: SUPPLIER, name: 'ZZZ API Co', status: 'active', since: '2026-01', weight: 1, users: 1, apps: 0,
      referencingMode: 'pre_referenced_open', apiAccessEnabled: true },
    { id: NO_API, name: 'ZZZ No API', status: 'active', since: '2026-01', weight: 1, users: 1, apps: 0,
      referencingMode: 'pre_referenced_open', apiAccessEnabled: false },
    { id: OURS, name: 'ZZZ Our Agency Rail', status: 'active', since: '2026-01', weight: 1, users: 1, apps: 0,
      referencingMode: 'opndoor_referenced', apiAccessEnabled: true },
  ] as unknown as Partner[]);
});
afterEach(() => { hydratePartners([]); });

describe('who may reach the Dev Centre', () => {
  it('a developer at a supplier with the API on', () => {
    expect(mayUseDevCentre('developer', SUPPLIER)).toBe(true);
  });

  /* THE TWO MATT NAMED. Management was admitted on purpose, to revoke a
     leaked key; that capability is now Opndoor admin's, on the supplier's
     Integration tab. Referrer was admitted by omission. */
  it('and not a supplier’s Management', () => {
    expect(mayUseDevCentre('management', SUPPLIER)).toBe(false);
  });
  it('and not a supplier’s Referrer', () => {
    expect(mayUseDevCentre('referrer', SUPPLIER)).toBe(false);
  });

  /* BUT OPNDOOR ADMIN KEEPS IT. Matt, correcting me the same day: "the
     instruction only covered supplier Management and Referrer users."
     What admin sees inside is a separate rule and a separate place: a
     key prefix and a Revoke, never a full key and never a Create. */
  it('and Opndoor admin, who keeps the route', () => {
    expect(mayUseDevCentre('superadmin', SUPPLIER)).toBe(true);
  });

  /* AND NOT OPNDOOR OPERATIONS STAFF, who never had it: the route's own
     role list has never carried opndoor_manager. */
  it('but not Opndoor operations staff, who never had it', () => {
    expect(mayUseDevCentre('opndoor_manager', SUPPLIER)).toBe(false);
  });
});

describe('and the party still has to have an API', () => {
  it('so not at a supplier with API access switched off', () => {
    expect(mayUseDevCentre('developer', NO_API)).toBe(false);
  });

  /* INCLUDING FOR ADMIN. A party with no API has no Dev Centre, whoever
     is looking: that was true before the role test was added and stays
     true under it. */
  it('and not even for admin there', () => {
    expect(mayUseDevCentre('superadmin', NO_API)).toBe(false);
  });

  /* AN AGENCY OF OURS IS NOT A PARTY WITH AN API, whoever references its
     tenants -- so the rail test stays, under the role test. */
  it('and not on our own agency rail, whatever the flag says', () => {
    expect(mayUseDevCentre('developer', OURS)).toBe(false);
  });

  it('and not across the whole estate, which is not one party', () => {
    expect(mayUseDevCentre('developer', ALL_PARTNERS)).toBe(false);
  });

  it('and not for a partner that does not exist', () => {
    expect(mayUseDevCentre('developer', 'zzz-nobody')).toBe(false);
  });
});

describe('every role, in one place', () => {
  /* THE WHOLE TABLE, so a role added later has to be thought about here
     rather than inheriting whatever the last condition happened to do. */
  it('reads as two yeses and the rest no', () => {
    const roles: Role[] = ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'];
    const yes = roles.filter((r) => mayUseDevCentre(r, SUPPLIER));
    expect(yes).toEqual(['superadmin', 'developer']);
  });
});

/* ===========================================================================
   AND WHAT ADMIN SEES ONCE THEY ARE IN.

   Matt, 2026-10-01, correcting the above: "Restore it for Opndoor admin,
   keeping the existing rule that admin never sees or creates full keys."

   Pinned here because the rule and the route are now two separate decisions
   and this is the file that reads as being about both. The rule itself is
   stronger than "never full keys": in the Dev Centre an admin sees no key
   LIST at all -- `canSeeCredentials = !isAdmin` -- only a card saying so and
   a break-glass revoke that takes a prefix the admin already holds from
   wherever it leaked.

   READ OFF THE SOURCE, not rendered: the gate is one expression in
   DevCentre.tsx and the panels are driven by it, so the assertion that
   matters is that the expression still excludes admin. A render test here
   would need the whole Dev Centre and would prove less.
   =========================================================================== */
describe('the rule about keys, which the route does not govern', () => {
  const src = readFileSync(join(process.cwd(), 'src/pages/DevCentre/DevCentre.tsx'), 'utf8');

  it('gives an admin no credentials panel at all', () => {
    expect(src).toMatch(/const canSeeCredentials = !isAdmin;/);
  });

  /* AND NO MINT. Creating a key is the developer's, and `canManage` is
     what the Mint button hangs off. */
  it('and no ability to mint one', () => {
    expect(src).toMatch(/canManage=\{isDeveloper\}/);
  });

  /* AND DOES NOT EVEN FETCH THEM, which is the half a screen-only gate
     would miss: a key list hidden by CSS has still been over the wire. */
  it('and does not fetch the keys it is not allowed to show', () => {
    expect(src).toMatch(/canSeeCredentials \? getApiKeys\(scope\) : Promise\.resolve\(\[\]\)/);
  });
});
