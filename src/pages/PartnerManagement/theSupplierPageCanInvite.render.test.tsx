/* THE SUPPLIER'S PEOPLE TAB CAN INVITE SOMEBODY.
 *
 * Matt, 2026-10-01, verbatim: "Supplier People tab: add an 'Invite someone'
 * button, using the supplier Add user form (no branch, levels Management and
 * Referrer, plus Developer when API access is on)."
 *
 * The three things that make it the SUPPLIER form rather than the estate one
 * are all absences -- no Supplier select, no Branch, no Position -- so most
 * of this file asserts that something is not there. Each absence has a
 * reason the supplier rail already holds elsewhere, and each would be a 400
 * from invite-user or a field collecting a value no boundary reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydratePartners } from '@/data/partnersService';
import { hydrateOrg } from '@/data/orgService';
import * as users from '@/data/usersService';
import type { ManagedUser, Partner } from '@/data/types';
import { PartnerHome } from './PartnerHome';

const SUPPLIER = 'zzz-invite';
const base = {
  id: SUPPLIER, name: 'ZZZ Invite Co', status: 'active', since: '2026-01-01',
  weight: 1, users: 1, apps: 0, referencingMode: 'pre_referenced_open',
  partnerRate: 0.3, agentRate: 0.1, portalReferralsEnabled: true, primary: false,
};
const withApi = (on: boolean) => [{ ...base, apiAccessEnabled: on }] as unknown as Partner[];

const PEOPLE: ManagedUser[] = [
  { id: 'u-1', name: 'Sam Supplier', email: 'sam@zzz.test', role: 'management',
    seesCommission: false, partner: SUPPLIER, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

let invite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue(PEOPLE);
  invite = vi.fn().mockResolvedValue({ id: 'new', name: 'A', email: 'a@b.co', role: 'referrer', status: 'pending', partner: SUPPLIER });
  vi.spyOn(users, 'inviteUser').mockImplementation(invite as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function peopleTab(apiOn = false) {
  hydratePartners(withApi(apiOn));
  const v = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  const tab = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === 'People')!;
  await act(async () => { fireEvent.click(tab); });
  await act(async () => {});
  return v;
}
type View = Awaited<ReturnType<typeof peopleTab>>;

const button = (v: View, label: string) =>
  [...v.container.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);

async function openInvite(v: View) {
  const b = button(v, 'Invite someone');
  expect(b, 'no "Invite someone" button on the People tab').toBeTruthy();
  await act(async () => { fireEvent.click(b!); });
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog, 'the button did not open the form').toBeTruthy();
  return dialog as HTMLElement;
}
const levelNames = (d: HTMLElement) =>
  [...d.querySelectorAll('.roleopt__name')].map((e) => (e.textContent ?? '').trim());
const labels = (d: HTMLElement) =>
  [...d.querySelectorAll('label')].map((e) => (e.textContent ?? '').trim());

describe('the People tab', () => {
  it('offers to invite somebody', async () => {
    expect(button(await peopleTab(), 'Invite someone')).toBeTruthy();
  });

  it('and the button opens the form, named for the supplier', async () => {
    const d = await openInvite(await peopleTab());
    expect(d.textContent).toContain('Invite someone to ZZZ Invite Co');
  });
});

describe('the levels it offers', () => {
  /* "levels Management and Referrer" -- and NOT the estate's Director,
     Manager and Negotiator, which are positions on our own rail. */
  it('are Management and Referrer with the API off', async () => {
    expect(levelNames(await openInvite(await peopleTab(false))))
      .toEqual(['Management', 'Referrer']);
  });

  /* "plus Developer when API access is on", which is the same switch the
     Integration tab throws and the Dev Centre panels read. */
  it('and gain Developer when API access is on', async () => {
    expect(levelNames(await openInvite(await peopleTab(true))))
      .toEqual(['Management', 'Referrer', 'Developer']);
  });

  /* AND THE ABSENCE IS EXPLAINED, so an admin looking for Developer does
     not have to guess which switch governs it. */
  it('and says where Developer comes from when it is missing', async () => {
    const d = await openInvite(await peopleTab(false));
    expect(d.textContent).toMatch(/Developer is offered once API access is switched on/);
  });
});

describe('what the supplier form does not ask', () => {
  /* Matt, 2026-09-30: "suppliers' own staff do the referring, so a supplier
     user has no branch." `user_must_hold_a_position` returns early off the
     estate for the same reason, so both fields collected a value no
     boundary reads. */
  it('no branch', async () => {
    expect(labels(await openInvite(await peopleTab())).join(' | ')).not.toMatch(/Branch/);
  });
  it('no position', async () => {
    expect(labels(await openInvite(await peopleTab())).join(' | ')).not.toMatch(/Position/);
  });
  /* AND NOT WHICH SUPPLIER, because they are standing on its page. */
  it('and not which supplier, which is the page they are on', async () => {
    const d = await openInvite(await peopleTab());
    expect(labels(d).join(' | ')).not.toMatch(/^Supplier|\| Supplier/);
    expect(d.querySelectorAll('select')).toHaveLength(0);
  });
});

describe('sending one', () => {
  async function fill(d: HTMLElement, addr: string) {
    const [first, last] = [...d.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    const email = d.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      fireEvent.change(first, { target: { value: 'Ada' } });
      fireEvent.change(last, { target: { value: 'Tester' } });
      fireEvent.change(email, { target: { value: addr } });
    });
  }
  /* OFF THE DOCUMENT, not off the dialog element: the modal renders its
     footer outside the node that carries role="dialog", so a search
     scoped to the dialog finds the fields and not the button that
     submits them. */
  const send = async () => {
    /* startsWith, not ===: the primary button carries an arrow glyph, so
       its textContent is "Send invite\u2192". */
    const b = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((x) => (x.textContent ?? '').trim().startsWith('Send invite'));
    expect(b, 'no "Send invite" button').toBeTruthy();
    await act(async () => { fireEvent.click(b!); });
  };

  it('pins the invite to this supplier, with no branch', async () => {
    const d = await openInvite(await peopleTab());
    await fill(d, 'ada@zzz.test');
    await send();
    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite.mock.calls[0][0]).toMatchObject({
      email: 'ada@zzz.test', partner: SUPPLIER, role: 'referrer', branch: '',
    });
  });

  /* `sees_commission` is the half that separates a Director from a Manager
     on OUR estate. A supplier rail has no such pair, and setting it would
     invent a level with no name. */
  it('and never sets the estate commission bit', async () => {
    const d = await openInvite(await peopleTab());
    await fill(d, 'ada@zzz.test');
    await send();
    expect(invite.mock.calls[0][0].seesCommission).toBe(false);
  });

  it('and sends the level that was chosen', async () => {
    const d = await openInvite(await peopleTab(true));
    await fill(d, 'dev@zzz.test');
    const dev = [...d.querySelectorAll<HTMLElement>('.roleopt')]
      .find((o) => (o.textContent ?? '').includes('Developer'))!;
    await act(async () => { fireEvent.click(dev); });
    await send();
    expect(invite.mock.calls[0][0].role).toBe('developer');
  });

  /* AND REFUSES BEFORE IT SENDS, rather than letting the function answer.
     An invite with a typo in the address is a silent failure otherwise. */
  it('but refuses an address that is not one', async () => {
    const d = await openInvite(await peopleTab());
    await fill(d, 'not-an-email');
    await send();
    expect(invite).not.toHaveBeenCalled();
  });
});

/* ===========================================================================
   EVERY ACTION ON THE PEOPLE TAB DOES THE THING, HERE.

   Matt, 2026-10-01, verbatim: 'Supplier People tab: "Change role" opens the
   role dialog right here (Management, Referrer, Developer), instead of a
   message pointing to the Users page. Check every other action on supplier
   and agency People tabs works in place, with no message sending you
   elsewhere.'

   WHAT IT WAS: `onChangeLevel={() => toast('Change a supplier user's role
   from Users.')}` -- a button that tells you where the button is. It is the
   fault the Users and Manage buttons came off the suppliers list for a week
   ago, and it survived because the tab was built by wiring up
   `PersonActions`, whose other six callbacks all do their job. One no-op in
   a row of working controls does not look like anything.
   =========================================================================== */
describe('changing a role, on the page the person is on', () => {
  const rowButton = (v: Awaited<ReturnType<typeof peopleTab>>, label: string) =>
    [...v.container.querySelectorAll<HTMLButtonElement>('.ah-rowacts button')]
      .find((b) => (b.textContent ?? '').trim() === label);

  it('offers Change role on the row', async () => {
    expect(rowButton(await peopleTab(), 'Change role')).toBeTruthy();
  });

  /* THE ASSERTION THAT WOULD HAVE CAUGHT IT: a dialog, not a toast. */
  it('and opens a dialog rather than telling you to go to Users', async () => {
    const v = await peopleTab();
    await act(async () => { fireEvent.click(rowButton(v, 'Change role')!); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, 'Change role opened no dialog').toBeTruthy();
    expect(dialog!.textContent).toContain('Change Sam Supplier’s role');
    expect(document.body.textContent).not.toMatch(/from Users/i);
  });

  it('and offers the supplier’s three levels, not the estate’s', async () => {
    const v = await peopleTab(true);
    await act(async () => { fireEvent.click(rowButton(v, 'Change role')!); });
    const names = [...document.querySelectorAll('[role="dialog"] .roleopt__name')]
      .map((e) => (e.textContent ?? '').trim());
    expect(names).toEqual(['Management', 'Referrer', 'Developer']);
    expect(names).not.toContain('Director');
  });

  /* THE SAME API GATE AS THE INVITE, because they read one list. */
  it('and drops Developer where API access is off', async () => {
    const v = await peopleTab(false);
    await act(async () => { fireEvent.click(rowButton(v, 'Change role')!); });
    const names = [...document.querySelectorAll('[role="dialog"] .roleopt__name')]
      .map((e) => (e.textContent ?? '').trim());
    expect(names).toEqual(['Management', 'Referrer']);
  });

  /* AND SAVING IS REFUSED UNTIL SOMETHING CHANGES, so the dialog cannot
     write the role somebody already has and report it as a change. */
  it('and will not save a role they already hold', async () => {
    const v = await peopleTab();
    await act(async () => { fireEvent.click(rowButton(v, 'Change role')!); });
    const save = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim().startsWith('Change role') && b.closest('.modal'));
    expect(save, 'no save button in the dialog').toBeTruthy();
    expect(save!.disabled).toBe(true);
  });
});

describe('and every other action on the row', () => {
  /* THE SWEEP. Each of these is a control that must DO something, not say
     where something is. They are asserted as present-and-wired here; what
     each one does is tested where it is implemented. */
  it('is a real control, with nothing pointing elsewhere', async () => {
    const v = await peopleTab();
    const labels = [...v.container.querySelectorAll<HTMLButtonElement>('.ah-rowacts button')]
      .map((b) => (b.textContent ?? '').trim());
    expect(labels).toEqual([
      'Change role', 'Notifications', 'Send password reset', 'Reset two-factor', 'Remove access',
    ]);
  });

  /* AND NO POSITION BUTTON, which is right rather than missing: a
     supplier's staff hold no position, because partner_id IS the company
     boundary on this rail and there is no ladder to stand on. */
  it('and no Position, which this rail has no ladder for', async () => {
    const v = await peopleTab();
    const labels = [...v.container.querySelectorAll('.ah-rowacts button')]
      .map((b) => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Position');
  });
});
