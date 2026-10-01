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

  /* AND NOT OPNDOOR ADMIN, which is the reading of "for developers only"
     together with the sentence naming where admin's key work now lives.
     Admin loses the route, not the capability: the Integration tab has
     carried the revoke, the API switch and read-only copies of the
     sandbox, request-log and webhook panels since 2026-10-01. */
  it('and not Opndoor admin, whose key work is the Integration tab', () => {
    expect(mayUseDevCentre('superadmin', SUPPLIER)).toBe(false);
  });
  it('nor Opndoor operations staff', () => {
    expect(mayUseDevCentre('opndoor_manager', SUPPLIER)).toBe(false);
  });
});

describe('and the party still has to have an API', () => {
  it('so not at a supplier with API access switched off', () => {
    expect(mayUseDevCentre('developer', NO_API)).toBe(false);
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
  it('reads as one yes and the rest no', () => {
    const roles: Role[] = ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'];
    const yes = roles.filter((r) => mayUseDevCentre(r, SUPPLIER));
    expect(yes).toEqual(['developer']);
  });
});
