/* COMMISSION IS SET ON THE COMMISSION TAB, AND THE SHARE COMES OUT OF
 * THE TOTAL.
 *
 * Matt, 2026-09-30: "Supplier commission is one total rate, set per
 * supplier on its Commission tab (nothing hardcoded; Rightmove's happens
 * to be 35%), and that total includes the agents' share ... The
 * supplier's own share is the total minus the agent's share, never more
 * in total." And: "Remove the two flat commission boxes from Manage."
 *
 * WHAT IS WORTH ASSERTING HERE rather than in pgTAP. The database refuses
 * a share above the total and `commission_is_set_in_one_place.test.sql`
 * proves it. What only a render can show is that the SCREEN says so
 * before anybody presses save, and that it shows the subtraction at all:
 * two boxes with unrelated numbers was the old model, and the whole point
 * of the new one is that one comes out of the other.
 *
 * NOTHING HARDCODED HERE EITHER. The fixture's rates are read back
 * through fmtRatePct rather than written as "35%", so changing the
 * fixture cannot leave an assertion passing about a number that is no
 * longer on screen.
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
import { fmtRatePct } from '@/lib/format';

const SUPPLIER = 'zzz-comm-ui';
const TOTAL = 0.35;
const SHARE = 0.15;

const PARTNERS = [{
  id: SUPPLIER, name: 'ZZZ Commission Co', status: 'active', since: '2026-01-01',
  weight: 1, users: 0, apps: 0,
  referencingMode: 'pre_referenced_open', partnerRate: TOTAL, agentRate: SHARE,
  apiAccessEnabled: false, portalReferralsEnabled: true, primary: false,
  opndoorPaysAgents: false,
}] as unknown as Partner[];

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydratePartners(PARTNERS);
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openCommission() {
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
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

describe('the Commission tab is where commission is set', () => {
  it('offers a total and an agents’ share, seeded from the supplier', async () => {
    const v = await openCommission();
    const total = v.container.querySelector<HTMLInputElement>('#sc-total');
    const share = v.container.querySelector<HTMLInputElement>('#sc-share');
    expect(total, 'no total field').toBeTruthy();
    expect(share, 'no agents share field').toBeTruthy();
    expect(Number(total!.value) / 100).toBeCloseTo(TOTAL, 5);
    expect(Number(share!.value) / 100).toBeCloseTo(SHARE, 5);
  });

  /* THE SUBTRACTION. Two boxes cannot say "one of these comes out of the
     other". This line is the model, on screen. */
  it('and says what is left for the supplier once the agents are paid', async () => {
    const v = await openCommission();
    const sum = v.container.querySelector('.sc-sum');
    expect(sum, 'no summary line').toBeTruthy();
    /* THROUGH THE SAME FORMATTER THE SCREEN USES. My first attempt built
       the string by hand and asked for "20%" while the card correctly
       rendered "20.0%": the assertion was wrong and the code was right,
       which is the failure mode of writing an expectation twice. */
    expect(sum!.textContent).toContain(fmtRatePct(TOTAL - SHARE));
    expect(sum!.textContent).toContain(fmtRatePct(TOTAL));
    expect(sum!.textContent).toContain(fmtRatePct(SHARE));
  });

  it('and the switch for whether Opndoor pays the agents, off by default', async () => {
    const v = await openCommission();
    const box = v.container.querySelector<HTMLInputElement>('.sc-switch input');
    expect(box, 'no switch').toBeTruthy();
    expect(box!.checked).toBe(false);
    expect(v.container.textContent).toMatch(/Opndoor pays the agents directly/);
  });
});

describe('the share cannot exceed the total', () => {
  /* The database refuses it. The screen has to refuse it FIRST, or the
     admin's only feedback is a red toast after a round trip. */
  it('warns as soon as it does, before anything is saved', async () => {
    const v = await openCommission();
    const share = v.container.querySelector<HTMLInputElement>('#sc-share')!;
    await act(async () => { fireEvent.change(share, { target: { value: '40' } }); });
    expect(v.container.querySelector('.sc-sum--bad'), 'no warning state').toBeTruthy();
    expect(v.container.textContent).toMatch(/cannot be more than it/);
  });

  it('and the save button will not fire while it is wrong', async () => {
    const v = await openCommission();
    const share = v.container.querySelector<HTMLInputElement>('#sc-share')!;
    await act(async () => { fireEvent.change(share, { target: { value: '40' } }); });
    const save = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Save commission');
    expect(save, 'no save button').toBeTruthy();
    expect(save!.disabled).toBe(true);
  });
});

describe('what the tab no longer points at', () => {
  /* The old card showed two read-only figures and sent the reader to
     Manage, which is the half of "two screens editing one number" that
     lived here. */
  it('does not send the reader to Manage to edit rates', async () => {
    const v = await openCommission();
    expect(v.container.textContent).not.toMatch(/Edit rates and settings from/);
  });
});
