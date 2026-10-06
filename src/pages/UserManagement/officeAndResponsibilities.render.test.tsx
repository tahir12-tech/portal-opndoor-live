/* WALK FIXES 5 AND 6. THE DIALOG, AND WHO IT IS NOT FOR.
 *
 * Item 5, verbatim: "The 'What [person] can see' dialog opens for Opndoor
 * team members and treats them like agency staff: it says 'Own referrals
 * only', asks for an office, and offers agency and supplier branches, and
 * choosing one would limit that person to that branch. Opndoor admins see
 * everything by their role and must never be given an office or position.
 * Remove this dialog for Opndoor team members, and make sure a position can
 * never narrow what an Opndoor admin sees, even if one was set."
 *
 * Item 6, verbatim: "The 'What [person] can see' dialog mixes two things.
 * Split it into two clearly labelled parts: 'Works at' (their home office,
 * which decides their team, league and commission statement) and 'Oversees'
 * (the branches, brand or agency they manage, which decides what they can
 * see). Retitle the dialog 'Office and responsibilities'."
 *
 * WHERE EACH HALF IS TESTED. The second half of item 5 -- that a position
 * cannot narrow an admin even if one was set -- is a server property and is
 * measured in supabase/tests/an_opndoor_admin_has_no_office.test.sql, where
 * a position is written straight onto an admin and their reads are compared
 * with an unpositioned admin's over four tables. Asserting it here would be
 * asserting a mock.
 *
 * THIS FILE IS THE SCREEN: the dialog is not offered for an Opndoor team
 * member, and for everybody else it is the two labelled parts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { SessionProvider } from '@/session/SessionContext';
import * as positions from '@/data/positionsService';
import * as usersService from '@/data/usersService';
import { hydrateCommissionVisibility } from '@/data';
import { PositionModal } from './PositionModal';
import { App } from '@/App';
import type { ManagedUser } from '@/data/usersService';

afterEach(() => { cleanup(); vi.restoreAllMocks(); hydrateCommissionVisibility(true); });

const TARGETS = [
  { id: 'br-1', name: 'ZZZ Office', kind: 'branch' as const },
  { id: 'ag-1', name: 'ZZZ Agency', kind: 'agency' as const },
];

const person = (over: Partial<ManagedUser> = {}): ManagedUser => ({
  id: 'u1', name: 'Rosa Bell', email: 'rosa@zzz.test', role: 'management',
  lastActive: 'today', status: 'active', partner: 'opndoor-agents', ...over,
} as ManagedUser);

async function openDialog(user: ManagedUser, held: positions.Position[] = []) {
  vi.spyOn(positions, 'getPositions').mockResolvedValue(held as never);
  const view = render(
    <ToastProvider>
      <PositionModal user={user} targets={TARGETS} onClose={() => {}} onSaved={() => {}} />
    </ToastProvider>,
  );
  await waitFor(() => {
    if ((document.body.textContent ?? '').includes('Loading')) throw new Error('still loading');
  });
  await act(async () => {});
  return view;
}
const body = () => document.body.textContent ?? '';
const headings = () => [...document.body.querySelectorAll('.pos-h')].map((h) => h.textContent);

describe('item 6: the dialog says which of the two things each part is', () => {
  it('is called Office and responsibilities', async () => {
    await openDialog(person());
    expect(body()).toMatch(/Office and responsibilities/);
    // The old title asked one question about two different things.
    expect(body()).not.toMatch(/What Rosa Bell can see/);
  });

  it('has a Works at part and an Oversees part, each its own heading', async () => {
    await openDialog(person());
    expect(headings()).toContain('Works at');
    expect(headings()).toContain('Oversees');
  });

  /* THE LABELS ARE NOT THE POINT ON THEIR OWN. Matt named what each part
     DECIDES, and that is what makes the split useful rather than cosmetic:
     the reader has to be able to tell which of the two they want. */
  it('and each says what it decides, so the reader can tell them apart', async () => {
    await openDialog(person());
    /* Matt named the three things Works at decides -- "their team, league
       and commission statement" -- so the three are asserted rather than
       one sentence of copy, which is free to read better than his list
       without dropping any of it. */
    for (const decides of [/\bteam\b/i, /\bleague\b/i, /commission statement/i]) {
      expect(body()).toMatch(decides);
    }
    expect(body()).toMatch(/what they can see/i);
  });

  it('still shows the Own referrals answer for somebody who oversees nobody', async () => {
    await openDialog(person({ role: 'referrer' }));
    expect(body()).toMatch(/Own referrals/);
  });
});

/* ITEM 5, THE SCREEN HALF. The dialog is reached from the three dots on the
   opndoor team page, on a pending invite's row -- that is the one call site
   in this file, and it is the row Matt was on. */
describe('item 5: an Opndoor team member is not offered it at all', () => {
  const TEAM: ManagedUser[] = [
    { id: 'u-adm', name: 'New Admin', email: 'newadmin@opndoor.co', role: 'superadmin',
      seesCommission: true, partner: null, status: 'pending', lastActive: 'never' },
    { id: 'u-ops', name: 'New Ops', email: 'newops@opndoor.co', role: 'opndoor_manager',
      seesCommission: false, partner: null, status: 'pending', lastActive: 'never' },
  ] as unknown as ManagedUser[];
  const AGENCY: ManagedUser[] = [
    { id: 'u-neg', name: 'New Negotiator', email: 'neg@zzz.test', role: 'referrer',
      seesCommission: false, partner: 'opndoor-agents', status: 'pending', lastActive: 'never' },
  ] as unknown as ManagedUser[];

  async function openPage(book: ManagedUser[], path: string) {
    localStorage.setItem('grp_role', 'superadmin');
    localStorage.removeItem('grp_partner');
    hydrateCommissionVisibility(true);
    vi.spyOn(usersService, 'getUsers').mockReturnValue(book);
    const view = render(
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
    await act(async () => {});
    return view;
  }

  type View = Awaited<ReturnType<typeof openPage>>;
  async function menuOn(v: View, name: string): Promise<string[]> {
    const row = [...v.container.querySelectorAll<HTMLElement>('table.dt tbody tr')]
      .find((tr) => (tr.textContent ?? '').includes(name));
    expect(row, `no row for ${name}`).toBeTruthy();
    const dots = row!.querySelector<HTMLButtonElement>('.rowmenu__btn');
    expect(dots, `no three-dots on ${name}'s row`).toBeTruthy();
    await act(async () => { dots!.click(); });
    return [...document.body.querySelectorAll('.rowmenu__item, .rowmenu__empty')]
      .map((b) => (b.textContent ?? '').trim());
  }

  it('is not offered to an Opndoor admin', async () => {
    const v = await openPage(TEAM, '/opndoor-team');
    expect(await menuOn(v, 'New Admin')).not.toContain('Set what they see');
  });

  it('nor to an Opndoor manager', async () => {
    const v = await openPage(TEAM, '/opndoor-team');
    expect(await menuOn(v, 'New Ops')).not.toContain('Set what they see');
  });

  /* AND IS STILL OFFERED WHERE IT BELONGS, or this would have removed the
     control rather than removing it from the rows it cannot apply to. */
  it('but is still offered on an agency person', async () => {
    const v = await openPage(AGENCY, '/users');
    expect(await menuOn(v, 'New Negotiator')).toContain('Set what they see');
  });
});
