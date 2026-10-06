/* RECONCILIATION IS ADMINS ONLY, IN ALL FOUR PLACES.
 *
 * Matt (cc): "Also remove Reconciliation from opndoor managers (sidebar,
 * Home tile and the page itself); admins only. Update the opndoor manager
 * description in the invite dialog to match."
 *
 * IT WAS NOT DONE, AND NOTHING SAID SO. Found on 2026-10-04 while writing
 * the level key for the opndoor team page: the sidebar, the route and both
 * Home tiles still admitted opndoor_manager, and the invite dialog still
 * promised them "reconciliation and direct-agency matches". The instruction
 * had been recorded and the work had not happened, which is exactly the gap
 * a queue cannot catch by itself.
 *
 * "THE PAGE ITSELF IS THE ONLY ONE THAT COUNTS." The sidebar and the tiles
 * are how you GET there; removing them leaves the address, and an address
 * you can still type is still access. So the route assertion is the real
 * one and the other three are about not offering a door that is locked.
 *
 * A SOURCE TEST, because the alternative is rendering four surfaces to prove
 * a role list. What actually has to hold is that one role name appears in
 * none of four places, and that is a property of the files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV } from '@/constants/nav';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('reconciliation is admins only', () => {
  it('the ROUTE refuses an opndoor manager, which is the one that counts', () => {
    const app = read('src/App.tsx');
    const guard = app.slice(app.indexOf('path="/reconciliation"') - 400, app.indexOf('path="/reconciliation"'));
    expect(guard).toContain("roles={['superadmin']}");
    expect(guard).not.toContain('opndoor_manager');
  });

  it('the sidebar does not offer a door that is locked', () => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.id === 'reconcile');
    expect(item, 'the Reconciliation nav item still exists').toBeTruthy();
    expect(item!.roles).toEqual(['superadmin']);
  });

  /* THE ELIGIBILITY QUEUE IS NOT RECONCILIATION and an opndoor manager keeps
     it. Asserted beside the removal because the risk in a change like this
     is taking one rung too many, and (bb) gave them this one deliberately. */
  it('but they keep Awaiting decision, which is a different queue', () => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.id === 'decisions');
    expect(item!.roles).toContain('opndoor_manager');
  });

  it('neither Home tile is offered to a level the route redirects', () => {
    const home = read('src/pages/Home/Home.tsx');
    // Both tiles land on /reconciliation; Agency matches is one of its tabs.
    for (const tile of ['Agency matches', 'Reconciliation']) {
      const line = home.split('\n').find((l) => l.includes(`label: '${tile}'`));
      expect(line, `the ${tile} tile is still built`).toBeTruthy();
      expect(line, `the ${tile} tile is gated on admin`).toContain('reconcilable ?');
    }
  });

  it('and the invite dialog no longer promises it', () => {
    const um = read('src/pages/UserManagement/UserManagement.tsx');
    const desc = um.split('\n').find((l) => l.includes("id: 'opndoor_manager', name: 'opndoor manager'"));
    expect(desc).toBeTruthy();
    // The old text named two queues that are both tabs of that one page.
    expect(desc).not.toContain('reconciliation and direct-agency matches');
    expect(desc).toContain('Cannot');
    expect(desc).toContain('Reconciliation');
  });
});
