/* =====================================================================
   WHAT A DIRECTOR SEES ON ANOTHER DIRECTOR'S ROW.

   Matt, 2026-10-03: "Agency Team page (Director view): on other Directors'
   rows, show a small note instead of the missing actions: 'To change or remove
   a Director, contact your account manager at partners@opndoor.co.'"

   THE ACTIONS WERE ALREADY ABSENT AND THAT WAS CORRECT. Everything on that row
   that acts on somebody is gated on `mayActOn`, which is strictly-below and is
   the client twin of `assert_may_act_on_user`'s closing `v_caller >= v_target`.
   Two Directors are both level 1, so the ladder refuses, and the code said so:
   "Hiding is a courtesy: the ladder refuses in SQL either way."

   WHAT IT MISSED is that a reader cannot tell "you may not" from "this is
   broken" by looking at nothing. On a page full of buttons, one empty cell
   reads as a bug -- which is exactly how it was reported on the supplier rail
   the same day ("the '...' menu on each row opens an empty box").

   SO IT IS ONE RULE AND ONE SENTENCE, shared through personConfirm, and this
   file is the agency half of it. The supplier half is in
   theSupplierTeamPage.render.test.tsx.
   ===================================================================== */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { hydrateCommissionVisibility } from '@/data';
import * as users from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import { App } from '@/App';
import { beforeEach } from 'vitest';

const ME = 'u-me';
const ESTATE = 'opndoor-agents';

/* THE TEAM IS PINNED, because the mock seed's Brackenhouse holds Managers and
   Negotiators and no Director at all -- so a Director viewing it outranks
   everybody and the peer case, which is the whole subject, cannot be reached.
   One of each level, plus the viewer's own row, which the seed also lacks. */
const TEAM: ManagedUser[] = [
  { id: ME, name: 'Me Myself', email: 'me@zzz.test', role: 'management',
    seesCommission: true, partner: ESTATE, status: 'active', lastActive: 'today' },
  { id: 'u-dir', name: 'Other Director', email: 'dir@zzz.test', role: 'management',
    seesCommission: true, partner: ESTATE, status: 'active', lastActive: 'today' },
  { id: 'u-mgr', name: 'A Manager', email: 'mgr@zzz.test', role: 'management',
    seesCommission: false, partner: ESTATE, status: 'active', lastActive: 'today' },
  { id: 'u-neg', name: 'A Negotiator', email: 'neg@zzz.test', role: 'referrer',
    seesCommission: false, partner: ESTATE, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

vi.mock('@/session/SessionContext', async (io) => {
  const actual = await io<typeof import('@/session/SessionContext')>();
  return { ...actual, useSession: () => ({ ...actual.useSession(), currentUserId: ME }) };
});

beforeEach(() => { vi.spyOn(users, 'getUsers').mockReturnValue(TEAM); });
afterEach(() => { cleanup(); hydrateCommissionVisibility(true); vi.restoreAllMocks(); });

/* THE SAME HARNESS notificationTickbox USES, including the expand-every-group
   step: Team opens with every block collapsed, so a test that only waits sees
   no rows and would pass whatever the row contained. */
async function openTeam(director: boolean) {
  localStorage.setItem('grp_role', 'management');
  hydrateCommissionVisibility(director);
  const view = render(
    <MemoryRouter initialEntries={['/team']}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
  await waitFor(() => { if (!view.container.querySelector('.tm-group')) throw new Error('no groups yet'); });
  for (const b of [...view.container.querySelectorAll('.tm-group')]) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { (b as HTMLButtonElement).click(); });
  }
  await waitFor(() => { if (!view.container.querySelector('.ppl-table tbody tr')) throw new Error('no rows'); });
  return view;
}

const rows = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('.ppl-table tbody tr')];
const NOTE = /To change or remove a Director, contact your account manager at partners@opndoor\.co\./;

describe('a Director looking at their own team', () => {
  it('is told why another Director’s row has no actions', async () => {
    const v = await openTeam(true);
    const peer = rows(v).find((r) => (r.textContent ?? '').includes('Other Director'));
    expect(peer).toBeTruthy();
    expect(peer!.textContent ?? '').toMatch(NOTE);
  });

  /* AND NOT INSTEAD OF ACTIONS THAT DO WORK. A Negotiator is below a Director,
     so that row keeps its buttons and must not carry the note -- which is the
     assertion that would catch the condition being written as `!may` alone,
     without the row's own level in it. */
  it('and does not see it on a row they can actually act on', async () => {
    const v = await openTeam(true);
    const below = rows(v).find((r) => (r.textContent ?? '').includes('A Negotiator'));
    expect(below).toBeTruthy();
    expect(below!.textContent ?? '').not.toMatch(/contact your account manager/);
    expect([...below!.querySelectorAll('button')].map((b) => b.textContent))
      .toContain('Remove access');
  });

  /* YOUR OWN ROW IS NOT A CASE OF BEING OUTRANKED. `may` is false there too --
     self is at your own level -- so a note written on `!may` alone would tell a
     Director to email Opndoor about themselves. */
  it('and never about themselves', async () => {
    const v = await openTeam(true);
    const own = rows(v).find((r) => (r.textContent ?? '').includes('Me Myself'));
    expect(own).toBeTruthy();
    expect(own!.textContent ?? '').not.toMatch(/contact your account manager/);
  });
});

describe('a Manager looking at the same team', () => {
  /* THE NOTE NAMES THE LEVEL IT IS ABOUT, so a Manager reads "a Director" on
     the row above them. The sentence is Matt's, and the article comes from the
     level word rather than being hard-coded into one page. */
  it('is told the same thing about the Director above them', async () => {
    const v = await openTeam(false);
    /* BY NAME, not by level word: viewing as a Manager leaves the viewer's own
       pinned row still reading "Director", so a search for the word finds that
       one first and the assertion would be about the wrong row. */
    const above = rows(v).find((r) => (r.textContent ?? '').includes('Other Director'));
    expect(above).toBeTruthy();
    expect(above!.textContent ?? '').toMatch(NOTE);
  });
});
