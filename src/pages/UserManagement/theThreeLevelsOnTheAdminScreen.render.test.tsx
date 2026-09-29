/* THE ADMIN SCREEN SAYS THE SAME THREE WORDS AS EVERY OTHER SCREEN.
 *
 * Q-06 item G: "Three agency levels ... Same three names on admin screens."
 * Team and the agency People tab already say Director, Manager, Negotiator.
 * /users said "Management" and "Referrer", which are the internal role words
 * and which nobody at an agency holds. A Director and a Manager read
 * identically there, which is the same complaint that produced ruling 2 in
 * the overview-tree work.
 *
 * AND THE CONTROL COULD NOT DO THE THING. "Edit role" writes `role`. Director
 * and Manager SHARE a role and differ only by the commission bit, so that
 * dialog could not move anybody between them at all -- the two levels an
 * agency actually argues about. `set_agency_level` is the one RPC that moves
 * both columns together, and Team has used it for days.
 *
 * THE TRAP, and the reason the label is a module rather than a third copy of
 * one expression: /users lists BOTH RAILS side by side. The expression Team
 * uses is correct only because Team lists the estate alone. On a supplier's
 * manager it would print "Director", a level that does not exist on that rail
 * at all (decision D11). So the last describe block is the one that matters
 * most.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import * as users from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import { hydrateCommissionVisibility } from '@/data';
import { App } from '@/App';

const ESTATE = 'opndoor-agents';
const SUPPLIER = 'harbourside';

/* One of each, on both rails, because the point is that the same role reads
   differently depending on which rail the person is on. */
const PEOPLE: ManagedUser[] = [
  { id: 'u-dir', name: 'Rosa Director', email: 'rosa@zzz.test', role: 'management',
    seesCommission: true, partner: ESTATE, status: 'active', lastActive: 'today' },
  { id: 'u-mgr', name: 'Nadia Manager', email: 'nadia@zzz.test', role: 'management',
    seesCommission: false, partner: ESTATE, status: 'active', lastActive: 'today' },
  { id: 'u-neg', name: 'Tom Negotiator', email: 'tom@zzz.test', role: 'referrer',
    seesCommission: false, partner: ESTATE, status: 'active', lastActive: 'today' },
  { id: 'u-sup', name: 'Sam Supplier', email: 'sam@zzz.test', role: 'management',
    seesCommission: true, partner: SUPPLIER, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  localStorage.removeItem('grp_partner');
  hydrateCommissionVisibility(true);
  vi.spyOn(users, 'getUsers').mockReturnValue(PEOPLE);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); hydrateCommissionVisibility(true); });

async function openUsers() {
  const view = render(
    <MemoryRouter initialEntries={['/users']}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openUsers>>;
const rowFor = (v: View, name: string) =>
  [...v.container.querySelectorAll<HTMLElement>('table.dt tbody tr')]
    .find((tr) => (tr.textContent ?? '').includes(name));
const levelOf = (v: View, name: string) =>
  rowFor(v, name)?.querySelector('.role-tag')?.textContent ?? '';

describe('the level column on /users', () => {
  it('calls an agency Director a Director, not "Management"', async () => {
    const v = await openUsers();
    expect(levelOf(v, 'Rosa Director')).toBe('Director');
  });

  it('and distinguishes the Manager beside them, who shares the same role', async () => {
    const v = await openUsers();
    expect(levelOf(v, 'Nadia Manager')).toBe('Manager');
  });

  it('and calls a Negotiator a Negotiator, not "Referrer"', async () => {
    const v = await openUsers();
    expect(levelOf(v, 'Tom Negotiator')).toBe('Negotiator');
  });

  it('so the two management levels no longer read identically', async () => {
    const v = await openUsers();
    expect(levelOf(v, 'Rosa Director')).not.toBe(levelOf(v, 'Nadia Manager'));
  });
});

/* THE HALF THAT IS EASY TO GET WRONG. */
describe('a supplier’s own management, on the same screen', () => {
  it('is NOT called a Director, because that level does not exist on their rail', async () => {
    const v = await openUsers();
    expect(levelOf(v, 'Sam Supplier')).not.toBe('Director');
    expect(levelOf(v, 'Sam Supplier')).toBe('Management');
  });
});

describe('the legend under the heading', () => {
  it('names the three levels rather than the two internal roles', async () => {
    const v = await openUsers();
    const legend = v.container.querySelector('.toolbar')?.textContent ?? '';
    expect(legend).toMatch(/Director/);
    expect(legend).toMatch(/Manager/);
    expect(legend).toMatch(/Negotiator/);
  });
});
