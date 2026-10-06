/* WALK FIX 1. "Opndoor team page: the three dots on your own row open an
 * empty menu. Either hide them, or show the actions you can take on your own
 * account (rename, reset your own MFA)."
 *
 * WHY IT WAS EMPTY. Every item in the menu is gated on `canEditRole`,
 * `mayAct` or `canDeactivate`, and all three are false on your own row:
 * `mayActOn` is strictly-below, and self is at your own level. Correct for
 * what they gate -- you do not change your own level or remove your own
 * access -- and it left a control that opens onto nothing. The deactivated
 * branch already had a fallback sentence; the active branch did not.
 *
 * MATT OFFERED EITHER. Showing the two actions, because they exist and both
 * work, which is the more useful of the two and the half he enumerated.
 *
 * AND THE TWO ARE NOT THE SAME RULE, which is the whole of the care here.
 * Walked on dev, as each of the two kinds of caller, before any of this was
 * written:
 *
 *   rename yourself           opndoor admin: allowed    Director: allowed
 *   reset your own two-factor opndoor admin: allowed    Director: REFUSED,
 *                             "You cannot do this to your own account."
 *   deactivate yourself       refused for both
 *
 * `admin_update_user_name` skips the ladder when the target is the caller --
 * `assert_may_act_on_user` names that as the documented exception in its own
 * comment. `admin_reset_user_mfa` always asks the ladder, and the ladder
 * returns early for opndoor staff BEFORE it reaches its self check, so the
 * exemption is theirs alone. Drawing "Reset two-factor" on a Director's own
 * row would therefore be a button that always throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import * as users from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import { setHomePartner } from '@/data/partnersService';
import { HOME_PARTNER } from '@/data/mock/partners';
import { hydrateCommissionVisibility } from '@/data';
import { App } from '@/App';

/* WHO IS SIGNED IN. `currentUserId` comes from the Supabase profile, and in
   mock mode there is none, so it is null and `isSelf` can never be true --
   the case under test is simply unreachable here without saying who the
   viewer is. The PROVIDER stays real; only that one field is answered, so
   every other rule on the page (the ladder, the last-admin guard, the
   partner scope) is the page's own and not the test's. */
const ME = 'u-me';
vi.mock('@/session/SessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/session/SessionContext')>();
  return { ...actual, useSession: () => ({ ...actual.useSession(), currentUserId: ME }) };
});

const TEAM: ManagedUser[] = [
  { id: ME, name: 'Me Myself', email: 'me@opndoor.co', role: 'superadmin',
    seesCommission: true, partner: null, status: 'active', lastActive: 'today' },
  /* A SECOND ACTIVE ADMIN, because isLastActiveAdmin would otherwise be true
     and this would be measuring that rule instead of this one. */
  { id: 'u-other', name: 'Other Admin', email: 'other@opndoor.co', role: 'superadmin',
    seesCommission: true, partner: null, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

/* A SUPPLIER'S MANAGEMENT, not an agency's. /users is opndoor admin plus a
   SUPPLIER's management staff; an agency manager's people live on /team and
   the route redirects them there. So this is the non-opndoor viewer who can
   actually reach their own row on this screen. */
const SUPPLIER = 'harbourside';
const SUPPLIER_STAFF: ManagedUser[] = [
  { id: ME, name: 'Sam Supplier', email: 'sam@harbour.test', role: 'management',
    seesCommission: true, partner: SUPPLIER, status: 'active', lastActive: 'today' },
  { id: 'u-col', name: 'Kim Colleague', email: 'kim@harbour.test', role: 'referrer',
    seesCommission: false, partner: SUPPLIER, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

beforeEach(() => { hydrateCommissionVisibility(true); });
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); hydrateCommissionVisibility(true);
  // A module singleton, not localStorage, so it outlives the render.
  setHomePartner(HOME_PARTNER);
});

async function open(who: 'superadmin' | 'management', book: ManagedUser[], path: string, partner?: string) {
  localStorage.setItem('grp_role', who);
  /* A non-admin's scope is their HOME partner, which is a module singleton
     rather than anything in localStorage. Without this the viewer is on the
     house agency partner and /users redirects them to /team. */
  setHomePartner(partner ?? HOME_PARTNER);
  vi.spyOn(users, 'getUsers').mockReturnValue(book);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof open>>;

/** Open the three dots on the row naming this person, and read the menu. The
 *  menu is portalled to the body, so it is read from there and not from the
 *  page container. */
async function menuOn(v: View, name: string): Promise<string[]> {
  const row = [...v.container.querySelectorAll<HTMLElement>('table.dt tbody tr')]
    .find((tr) => (tr.textContent ?? '').includes(name));
  expect(row, `no row for ${name}`).toBeTruthy();
  const dots = row!.querySelector<HTMLButtonElement>('.rowmenu__btn');
  expect(dots, `no three-dots control on ${name}'s row`).toBeTruthy();
  await act(async () => { dots!.click(); });
  const menu = document.querySelector('.rowmenu__pop, .rowmenu__menu, [class*="rowmenu"][class*="pop"]')
    ?? document.body;
  return [...menu.querySelectorAll('.rowmenu__item, .rowmenu__empty')]
    .map((b) => (b.textContent ?? '').trim());
}

describe('an Opndoor admin, on their own row', () => {
  /* THE DEFECT, STATED. Not "the wrong items": no items. */
  it('does not open an empty menu', async () => {
    const v = await open('superadmin', TEAM, '/opndoor-team');
    expect(await menuOn(v, 'Me Myself')).not.toEqual([]);
  });

  it('is offered the two things they can actually do to their own account', async () => {
    const v = await open('superadmin', TEAM, '/opndoor-team');
    const items = await menuOn(v, 'Me Myself');
    expect(items).toContain('Edit name');
    expect(items).toContain('Reset two-factor');
  });

  /* AND NOT THE THINGS THE SERVER REFUSES ON YOUR OWN ROW. Dev refused
     deactivate-self with "You cannot deactivate your own account."; changing
     your own level is refused by the ladder trigger. */
  it('and not the ones the server refuses on your own account', async () => {
    const v = await open('superadmin', TEAM, '/opndoor-team');
    const items = await menuOn(v, 'Me Myself');
    expect(items).not.toContain('Remove access');
    expect(items).not.toContain('Change level');
    expect(items).not.toContain('Edit role');
  });

  it('while somebody else\'s row is unchanged', async () => {
    const v = await open('superadmin', TEAM, '/opndoor-team');
    const items = await menuOn(v, 'Other Admin');
    expect(items).toContain('Remove access');
    expect(items).toContain('Send password reset');
  });
});

/* THE HALF THAT IS NOT OPNDOOR'S. /users admits a supplier's management
   staff, so "your own row" is not always an admin's. */
describe("a supplier's management, on their own row", () => {
  it('may rename themselves', async () => {
    const v = await open('management', SUPPLIER_STAFF, '/users', SUPPLIER);
    expect(await menuOn(v, 'Sam Supplier')).toContain('Edit name');
  });

  /* THE ASYMMETRY. `assert_may_act_on_user` exempts opndoor staff before it
     reaches its self check, so the exemption is theirs alone and this
     control would throw here. Dev refused the equivalent call in so many
     words: "You cannot do this to your own account." */
  it('but is NOT offered a reset of their own two-factor, which the server refuses', async () => {
    const v = await open('management', SUPPLIER_STAFF, '/users', SUPPLIER);
    expect(await menuOn(v, 'Sam Supplier')).not.toContain('Reset two-factor');
  });
});
