/* THE USERS SCREEN CAN INVITE ONTO OUR OWN ESTATE.
 *
 * Round 5, M10. Two defects in one dialog, both invisible until somebody tried
 * it against a real database:
 *
 *   It sent no `seesCommission`, and Director and Manager are the SAME role
 *   differing only by that boolean. So every management invite landed as a
 *   Manager and a Director could not be created from this screen at all --
 *   which on a brand new agency means nobody who may see commission and
 *   nobody who can promote anyone to it.
 *
 *   It sent no `scopeKind`, and everybody on our estate holds a position
 *   (20261006300000 makes an unpositioned active person a constraint
 *   violation). invite-user therefore refused the invite outright with
 *   "Choose the group, brand or branch this person will hold" -- after the
 *   whole form had been filled in, with nothing in the dialog to answer it.
 *
 * Team already asks for the level out of the one AGENCY_LEVELS list. This
 * makes Users ask the same question the same way, so the two screens cannot
 * invent a fourth combination between them.
 *
 * THE ASSERTION THAT MATTERS is the last one: what reaches inviteUser. A test
 * that only looked for a control on the page would pass while the dialog still
 * dropped the value on the floor, which is exactly how this shipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import * as users from '@/data/usersService';
import { hydrateCommissionVisibility, hydrateOrg } from '@/data';
import { App } from '@/App';

const ESTATE = 'opndoor-agents';

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  localStorage.setItem('grp_partner', ESTATE); // loadString, not JSON
  hydrateCommissionVisibility(true);
  /* THE POSITION OPTIONS NEED REAL IDS. The screen deliberately skips org rows
     without one ("a position needs an id, so those rows are skipped rather
     than offered as options that cannot be saved"), and the mock seed has
     none, so without this the Position select is correctly empty and the
     assertion below would have nothing to choose. */
  hydrateOrg([{
    id: 'ag-zzz', partner: ESTATE, name: 'ZZZ Invite Agency',
    referrals: 0, guaranteed: '0',
    branches: [{ id: 'br-zzz', name: 'ZZZ Invite Office', referrals: 0, guaranteed: '0' }],
  } as never]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); hydrateCommissionVisibility(true); });

async function openAddUser() {
  const view = render(
    <MemoryRouter initialEntries={['/users']}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
  const add = [...document.querySelectorAll('button')]
    .find((b) => /add user/i.test(b.textContent ?? ''));
  if (!add) throw new Error('no Add user button');
  await act(async () => { add.click(); });
  return view;
}

/* The Modal renders through a portal into document.body, so every query here
   is document-wide rather than scoped to the render container. */
const sel = (_v: unknown, label: string) =>
  document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);

describe('inviting onto our own estate', () => {
  it('asks for a level, and offers Director', async () => {
    const v = await openAddUser();
    const level = sel(v, 'Level');
    expect(level).toBeTruthy();
    expect([...level!.options].map((o) => o.value)).toContain('Director');
  });

  it('asks for a position once the level is one that holds one', async () => {
    const v = await openAddUser();
    await act(async () => { fireEvent.change(sel(v, 'Level')!, { target: { value: 'Director' } }); });
    expect(sel(v, 'Position')).toBeTruthy();
  });

  it('does not ask a Negotiator for a position, who is placed by their branch', async () => {
    const v = await openAddUser();
    await act(async () => { fireEvent.change(sel(v, 'Level')!, { target: { value: 'Negotiator' } }); });
    expect(sel(v, 'Position')).toBeNull();
  });

  /* THE ONE THE DEFECT WAS. */
  it('sends the level AND the position to inviteUser', async () => {
    const invite = vi.spyOn(users, 'inviteUser')
      .mockResolvedValue({ id: 'p1', name: 'A B', email: 'a@b.co', role: 'management',
        lastActive: 'Pending invite', status: 'pending', partner: ESTATE } as never);
    const v = await openAddUser();

    const type = (ph: RegExp, value: string) => {
      const el = [...document.querySelectorAll('input')]
        .find((i) => ph.test(i.getAttribute('placeholder') ?? ''));
      if (!el) throw new Error(`no input matching ${ph}`);
      fireEvent.change(el, { target: { value } });
    };
    await act(async () => {
      /* ANCHORED, SINCE 2026-10-03. The example names became "Jane" and
         "Smith" in the invented-names sweep, and an unanchored /jane/i now
         also matches the email hint "jane@example.co.uk" two fields down.
         The exact placeholder is the stable thing to find a field by. */
      type(/^Jane$/, 'Rosa');
      type(/^Smith$/, 'Bell');
      type(/@/, 'rosa@zzz.test');
      fireEvent.change(sel(v, 'Level')!, { target: { value: 'Director' } });
    });
    const position = sel(v, 'Position')!;
    const target = [...position.options].find((o) => o.value)!;
    await act(async () => { fireEvent.change(position, { target: { value: target.value } }); });

    const send = [...document.querySelectorAll('button')]
      .find((b) => /send invite/i.test(b.textContent ?? ''))!;
    await act(async () => { send.click(); });

    await waitFor(() => expect(invite).toHaveBeenCalled());
    const arg = invite.mock.calls.at(-1)![0];
    // Director is management WITH the commission bit. Sending the role alone is
    // what made every invite a Manager.
    expect(arg.role).toBe('management');
    expect(arg.seesCommission).toBe(true);
    // And the position, without which invite-user refuses the whole invite.
    expect(arg.scopeTarget).toBe(target.value);
    expect(['group', 'agency', 'branch']).toContain(arg.scopeKind);
  });
});
