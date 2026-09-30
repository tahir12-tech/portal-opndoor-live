/* A SUPPLIER'S NAMED STATEMENT ADDRESSES HAVE A SCREEN.
 *
 * Matt, 2026-09-30, verbatim: "Opndoor admin can also add named email
 * addresses that aren't portal users (e.g. a finance inbox) to receive a
 * supplier's statement."
 *
 * The migration gave that a table and three RPCs. Without a screen the
 * sentence is only true of somebody holding a psql prompt, so the card is
 * part of the instruction rather than a nicety, and this is what says it
 * is there.
 *
 * A PARTNER PER TEST, which looks fussy and is not. The mock-mode store
 * behind the service is a module-level object with no reset -- the same
 * shape as every other mock list in partnersService -- so a test that
 * added an address would leak it into the next test's empty state. Each
 * test hydrates its own supplier and asks about that one.
 *
 * WHAT IS NOT ASSERTED HERE, deliberately: that a non-admin cannot use
 * any of this. The screen hiding the card is courtesy; the boundary is
 * is_admin + is_aal2 inside all three RPCs, and it is asserted from the
 * supplier's own side in a_supplier_gets_its_own_statement.test.sql,
 * where it cannot be undone by a change to a route guard.
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
import type { Partner } from '@/data/types';
import { PartnerHome } from './PartnerHome';

function partners(slug: string): Partner[] {
  return [{
    id: slug, name: 'ZZZ Statement Co', status: 'active', since: '2026-01-01',
    weight: 1, users: 0, apps: 0,
    referencingMode: 'pre_referenced_open', partnerRate: 0.25, agentRate: 0.1,
    apiAccessEnabled: false, portalReferralsEnabled: true, primary: false,
  }] as unknown as Partner[];
}

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openCommission(slug: string) {
  hydratePartners(partners(slug));
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${slug}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  const tab = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === 'Commission');
  if (!tab) throw new Error('no Commission tab');
  await act(async () => { fireEvent.click(tab); });
  await act(async () => {});
  return view;
}

async function addAddress(v: Awaited<ReturnType<typeof openCommission>>, email: string) {
  const field = v.container.querySelector<HTMLInputElement>('#sr-add-email');
  if (!field) throw new Error('no address field');
  await act(async () => { fireEvent.change(field, { target: { value: email } }); });
  const btn = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Add address');
  if (!btn) throw new Error('no Add address button');
  await act(async () => { fireEvent.click(btn); });
}

describe('the Commission tab carries the statement addresses', () => {
  it('has the card at all, which is the half of the instruction the migration could not build', async () => {
    const v = await openCommission('zzz-stmt-a');
    expect(v.container.textContent).toMatch(/Monthly statement addresses/);
  });

  /* THE EMPTY STATE SAYS WHAT HAPPENS ANYWAY. An admin who sees an empty
     list must not conclude that nobody is being written to: the people
     half is a tick on each person and is already on. */
  it('and its empty state says the statement still goes to the Management users who have it on', async () => {
    const v = await openCommission('zzz-stmt-b');
    expect(v.container.textContent).toMatch(/Management users who have it switched on/);
  });

  /* THE OTHER HALF IS NAMED. Nobody can change the per-person tick from
     this card, so it has to say where that is done. */
  it('and points at People for the staff half, rather than leaving an admin to hunt', async () => {
    const v = await openCommission('zzz-stmt-c');
    expect(v.container.textContent).toMatch(/set person by person, under/);
    expect(v.container.textContent).toMatch(/only Opndoor can change that/i);
  });
});

describe('adding one', () => {
  it('puts the address on the list', async () => {
    const v = await openCommission('zzz-stmt-d');
    await addAddress(v, 'finance@zzz.test');
    expect(v.container.textContent).toMatch(/finance@zzz\.test/);
  });

  /* LOWER-CASED, the same as the RPC does it, so the screen and the
     database do not disagree about what was added. */
  it('and lower-cases it, which is what the database stores', async () => {
    const v = await openCommission('zzz-stmt-e');
    await addAddress(v, 'Finance@ZZZ.test');
    expect(v.container.textContent).toMatch(/finance@zzz\.test/);
    expect(v.container.textContent).not.toMatch(/Finance@ZZZ\.test/);
  });
});

describe('removing one', () => {
  /* WALK FIX 23. Matt: "Apply the same rule to any other admin action that
     changes records in one click." Taking an address off a statement is
     one of those, and the sentence has to name the record. */
  it('asks first, naming the address and the supplier', async () => {
    const v = await openCommission('zzz-stmt-f');
    await addAddress(v, 'finance@zzz.test');
    const rm = [...v.container.querySelectorAll<HTMLButtonElement>('.sr-row button')]
      .find((b) => (b.textContent ?? '').trim() === 'Remove');
    if (!rm) throw new Error('no Remove button');
    await act(async () => { fireEvent.click(rm); });
    const dialog = document.body.textContent ?? '';
    expect(dialog).toMatch(/Stop sending the statement here/);
    expect(dialog).toMatch(/finance@zzz\.test/);
    expect(dialog).toMatch(/ZZZ Statement Co/);
  });

  it('and takes it off once confirmed', async () => {
    const v = await openCommission('zzz-stmt-g');
    await addAddress(v, 'finance@zzz.test');
    const rm = [...v.container.querySelectorAll<HTMLButtonElement>('.sr-row button')]
      .find((b) => (b.textContent ?? '').trim() === 'Remove');
    await act(async () => { fireEvent.click(rm!); });
    const go = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Remove address');
    if (!go) throw new Error('no confirm button');
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => {
      if (v.container.querySelector('.sr-row')) throw new Error('still listed');
    });
    expect(v.container.textContent).not.toMatch(/finance@zzz\.test/);
  });
});
