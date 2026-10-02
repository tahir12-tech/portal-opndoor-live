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
      referencingMode: 'pre_referenced_open', apiAccessEnabled: true, kind: 'supplier' },
    { id: NO_API, name: 'ZZZ No API', status: 'active', since: '2026-01', weight: 1, users: 1, apps: 0,
      referencingMode: 'pre_referenced_open', apiAccessEnabled: false, kind: 'supplier' },
    { id: OURS, name: 'ZZZ Our Agency Rail', status: 'active', since: '2026-01', weight: 1, users: 1, apps: 0,
      referencingMode: 'opndoor_referenced', apiAccessEnabled: true, kind: 'agency' },
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

  /* AND NOT OPNDOOR ADMIN EITHER, since 2026-10-02. This case said the
     opposite yesterday, and the reversal is deliberate rather than the
     earlier mistake happening again.

       Matt, 2026-10-01: "Admin keeps the Dev Centre route; the
       instruction only covered supplier Management and Referrer users."
       I had removed four roles when the instruction named two.

       Matt, 2026-10-02: "Change of decision: Opndoor admin does not
       need the Dev Centre in the sidebar; the supplier's Integration
       tab covers it. Leave it off for admin, and update the test and
       QUEUE.md so it isn't restored."

     WHAT CHANGED IS THE NEED, not the reading. Admin was restored
     because revoking a leaked key had nowhere else to happen; it has
     somewhere now. "so it isn't restored" is why this case keeps the
     history instead of being deleted: the next reader finding ruling 2
     on its own would put it back. */
  it('and not Opndoor admin, whose need the Integration tab covers', () => {
    expect(mayUseDevCentre('superadmin', SUPPLIER)).toBe(false);
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

  /* INCLUDING FOR ADMIN, who is now refused twice over: by the role
     test and by the missing API. Kept rather than deleted, because the
     party rule has to go on holding on its own -- if admin were ever
     admitted again, this is the case that would still refuse them at a
     supplier with no API. */
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
  it('reads as one yes and the rest no', () => {
    const roles: Role[] = ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'];
    const yes = roles.filter((r) => mayUseDevCentre(r, SUPPLIER));
    // One, since 2026-10-02: it is for developers, and nobody else.
    expect(yes).toEqual(['developer']);
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

/* ===========================================================================
   AND NO SCREEN CLAIMS MORE OR LESS THAN IT SHOWS.

   Matt, 2026-10-01: "Align the admin wording about API keys everywhere: say
   exactly what admin can see on that screen ... No screen should claim more
   or less than it shows."

   THREE SCREENS MAKE A CLAIM and two of them were wrong in OPPOSITE
   directions, which is why neither looked wrong on its own:

     Dev Centre, Credentials   said "not how many there are" -- true of
                               that screen, read as a rule about the
                               product, and contradicted by the next one.
     Integration tab           said admin "can see that keys exist", which
                               understates a line printing the exact count.
     Dev Centre, Break glass   said nothing about full keys at all.

   ASSERTED ON THE SOURCE, because what is being checked is the agreement
   between three files. A render test per screen would prove each sentence
   appears and nothing about whether they agree.
   =========================================================================== */
describe('what each screen claims about keys', () => {
  const config = readFileSync(join(process.cwd(), 'src/pages/DevCentre/Configuration.tsx'), 'utf8');
  const devcentre = readFileSync(join(process.cwd(), 'src/pages/DevCentre/DevCentre.tsx'), 'utf8');
  const integration = readFileSync(join(process.cwd(), 'src/pages/PartnerManagement/PartnerHome.tsx'), 'utf8');

  /* THE ONE SENTENCE THAT IS TRUE EVERYWHERE, and the only claim all three
     may make: it is the boundary itself. */
  it('every one of them says admin never sees or creates a full key', () => {
    for (const [name, src] of [['Configuration', config], ['DevCentre', devcentre], ['Integration', integration]] as const) {
      expect(src, `${name} does not say it`)
        .toMatch(/never see.{0,30}create a full key|never see a key, its prefix, or create one|never see a key or create one/i);
    }
  });

  /* AND THE COUNT, WHICH IS THE ONE THEY DISAGREED ABOUT. The Integration
     tab now LISTS the keys rather than only counting them, so the
     sentence it makes is the stronger one. */
  it('the Integration tab says the keys are there, because they are', () => {
    expect(integration).toMatch(/Each active key is listed below, with a Revoke beside it/);
  });

  it('and the Dev Centre says it is not there, because it is not', () => {
    expect(config).toMatch(/not how many/);
  });

  /* AND POINTS AT WHERE IT IS, so "you cannot see how many" does not read
     as "nobody can". */
  it('and names where the count actually lives', () => {
    expect(config).toMatch(/Integration tab/);
  });

  /* THE REVOKE IS HERE NOW, since 2026-10-02. Matt: "Opndoor admin can
     revoke a single key here ... removing any mention of Break glass or
     the Dev Centre for admin."

     This case said the opposite yesterday, and it had to: admin's only
     way to stop one key was Break glass, and a tab that did not say so
     left them hunting. Both halves moved together -- the button arrived
     and the direction left -- which is why the assertion is inverted
     rather than deleted. A direction to a screen admin can no longer
     open would be worse than the old one. */
  it('and no longer sends an admin to the Dev Centre, which they cannot open', () => {
    /* THE SENTENCE ITSELF, not a match over the file. The comments
       above the copy record why the direction was removed and quote
       the instruction that removed it, so a whole-file match would make
       the explanation fail the rule it explains. Naming the removed
       sentence is also the more honest assertion: it is the exact text
       a reader used to be sent by. */
    expect(integration).not.toMatch(/To revoke a single key you need its prefix/);
    expect(integration).not.toMatch(/under Break glass in the Dev Centre/);
    // And the sentence that replaced it does not send anybody anywhere.
    expect(integration).toMatch(/the supplier\u2019s own developer does that\./);
  });

  it('and offers the revoke itself instead', () => {
    expect(integration).toMatch(/<SupplierApiKeys /);
    const keys = readFileSync(join(process.cwd(), 'src/pages/PartnerManagement/SupplierApiKeys.tsx'), 'utf8');
    // Matt's own confirmation sentence, both halves.
    expect(keys).toMatch(/This key stops working immediately/);
    expect(keys).toMatch(/keep working/);
  });

  /* AND IT LISTS THE THREE THINGS HE NAMED, and not the prefix: "List
     each active key by its name, when it was created and when it was
     last used". The prefix is in the security event the revoke writes,
     where a developer reading the log needs it; it is not on screen,
     which is what keeps "admin never sees a key" true of the screen as
     well as of the data. */
  it('by name, created and last used, and not by prefix', () => {
    const keys = readFileSync(join(process.cwd(), 'src/pages/PartnerManagement/SupplierApiKeys.tsx'), 'utf8');
    expect(keys).toMatch(/k\.name/);
    expect(keys).toMatch(/Created \{formatDate\(k\.created_at\)\}/);
    expect(keys).toMatch(/last used \$\{formatDate\(k\.last_used_at\)\}|last used \$\{/);
    expect(keys).not.toMatch(/k\.key_prefix/);
  });

  /* THE CLAIM THAT WAS WRONG, pinned so it cannot come back. */
  it('and nothing still says admin can only see "that keys exist"', () => {
    expect(integration).not.toMatch(/can see that keys exist/);
  });
});
