/* =====================================================================
   WHO SEES COMMISSION, IN ONE PLACE, FOR ALL EIGHT READERS.

   Matt (dr2): "Make 'who sees commission' consistent everywhere and
   true: agency Director, supplier Management and opndoor admin see
   it; agency Manager, referrers, Developers and opndoor manager
   don't."

   =====================================================================
   WHAT THE CHECK FOUND
   =====================================================================

   The rule itself was already right, in both halves, and I checked
   both rather than taking either on trust.

   THE PREDICATE: maySeeCommission (types.ts:36) admits superadmin
   outright, admits `management` only when the commission bit is set,
   and refuses everything else -- so opndoor_manager, referrers and
   developers are out by role.

   THE DATA, measured on dev 2026-10-05: agency management splits 7
   with the bit and 1 without, which is Directors and a Manager;
   supplier management is 3 with it; every referrer and the one
   developer are without; opndoor_manager is without. Exactly Matt's
   list.

   THE ONE PLACE IT WAS BROKEN WAS HELP, and this test exists because
   of how it broke. `HelpViewer.admin` is true for an opndoor manager
   as well as an admin -- correct for the RAIL, since both read agency
   and supplier material -- and the commission gate was reading that
   flag. So a manager was shown the commission guide while every other
   surface in the product correctly refused them. Fixed by giving the
   commission arm its own question; pinned here so the two can never
   drift apart again.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { maySeeCommission, hydrateCommissionVisibility } from './types';
import { mayOpenResource, mayOpenFaq, type HelpViewer } from '@/pages/Help/Help';

/** Matt's eight, and his answer for each. */
const EXPECTED: { label: string; role: Parameters<typeof maySeeCommission>[0]; bit: boolean; sees: boolean }[] = [
  { label: 'opndoor admin', role: 'superadmin', bit: false, sees: true },
  { label: 'opndoor manager', role: 'opndoor_manager', bit: false, sees: false },
  { label: 'agency Director', role: 'management', bit: true, sees: true },
  { label: 'agency Manager', role: 'management', bit: false, sees: false },
  { label: 'agency Negotiator', role: 'referrer', bit: false, sees: false },
  { label: 'supplier Management', role: 'management', bit: true, sees: true },
  { label: 'supplier Referrer', role: 'referrer', bit: false, sees: false },
  { label: 'supplier Developer', role: 'developer', bit: false, sees: false },
];

describe('the product-wide rule', () => {
  it.each(EXPECTED.map((e) => [e.label, e] as const))('%s', (_label, e) => {
    hydrateCommissionVisibility(e.bit);
    expect(maySeeCommission(e.role)).toBe(e.sees);
  });

  /* AN OPNDOOR ADMIN SEES IT WITHOUT THE BIT, which is not an
     oversight: the bit is the agency rail's Director marker, carried
     on a position, and opndoor's own staff hold no position. A test
     that set the bit for them would be testing a row that cannot
     exist -- dev has superadmin with sees_commission false. */
  it('and an opndoor admin needs no commission bit, having no position to carry one', () => {
    hydrateCommissionVisibility(false);
    expect(maySeeCommission('superadmin')).toBe(true);
  });

  /* THE BIT ALONE IS NOT ENOUGH. If it were ever set on a referrer's
     row -- by a migration, a fixture, a mistake -- the role must
     still refuse. Defence against the data, not just the UI. */
  it('while the bit on a referrer or a developer changes nothing', () => {
    hydrateCommissionVisibility(true);
    expect(maySeeCommission('referrer')).toBe(false);
    expect(maySeeCommission('developer')).toBe(false);
    expect(maySeeCommission('opndoor_manager')).toBe(false);
  });
});

describe('and Help agrees with it', () => {
  const viewer = (e: typeof EXPECTED[number]): HelpViewer => ({
    role: e.role,
    seesCommission: e.bit,
    agency: e.label.startsWith('agency'),
    admin: e.role === 'superadmin' || e.role === 'opndoor_manager',
  });
  const MONEY = { id: 'x', icon: 'doc', type: 'Guide', title: 'T', desc: 'D', meta: '', needsCommission: true };

  it.each(EXPECTED.map((e) => [e.label, e] as const))(
    '%s is shown commission material exactly when the rule says so', (label, e) => {
      hydrateCommissionVisibility(e.bit);
      expect(mayOpenResource(MONEY, viewer(e)), label).toBe(e.sees);
      expect(mayOpenFaq({ needsCommission: true }, viewer(e)), label).toBe(e.sees);
    });

  /* THE REGRESSION, NAMED. An opndoor manager is `admin: true` for
     the rail, and the commission gate used to read that flag. */
  it('and an opndoor manager is refused it despite being admin for the rail', () => {
    hydrateCommissionVisibility(false);
    const mgr: HelpViewer = { role: 'opndoor_manager', seesCommission: false, agency: false, admin: true };
    expect(mgr.admin, 'the rail flag is still true, which is the point').toBe(true);
    expect(mayOpenResource(MONEY, mgr)).toBe(false);
  });
});
