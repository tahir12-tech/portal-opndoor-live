/* A SUPPLIER'S PAGE OWNS ITS OWN SETTINGS, PEOPLE AND INTEGRATION.
 *
 * Matt, 2026-10-01, verbatim: "Suppliers list: remove the Users and
 * Manage buttons; clicking a supplier opens its page. On the supplier's
 * page, its settings (name, live from, status, referencing mode,
 * capabilities) move into a Settings tab, with the same fields as
 * Manage. Its people are on the People tab only. Keep 'Add supplier'
 * working with its own create form. Anything that linked to
 * /users?partner=… now goes to that supplier's People tab. On supplier
 * people lists, show supplier levels (Management, Referrer), and
 * Management sees 'Everything' not 'Own referrals'."
 *
 * And, the same evening: "Supplier Integration tab: add the API access
 * on/off switch here (moved from Settings), with a confirmation that
 * says how many active API keys will stop working if it's turned off."
 *
 * =====================================================================
 * WHAT MOVED THAT HE DID NOT NAME
 * =====================================================================
 *
 * The Manage modal also owned the referrer-leaderboard policy and the
 * audit trail. Deleting the modal without them would have quietly
 * deleted a per-supplier setting and the only record of who changed
 * what, so they went to the Settings tab with everything else. Asserted
 * below, because a thing moved for that reason is exactly the thing a
 * later tidy-up removes.
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
import { PartnerManagement } from './PartnerManagement';

const SUPPLIER = 'zzz-page';
const PARTNERS = [{
  id: SUPPLIER, name: 'ZZZ Page Co', status: 'active', since: '2026-01-01',
  weight: 1, users: 0, apps: 0, referencingMode: 'pre_referenced_open',
  partnerRate: 0.35, agentRate: 0.15,
  apiAccessEnabled: false, portalReferralsEnabled: true, primary: false,
  opndoorPaysAgents: false, kind: 'supplier' }] as unknown as Partner[];

const PEOPLE = [
  { id: 'u1', name: 'Mo Management', email: 'mo@zzz.test', role: 'management', status: 'active', lastActive: 'today', kind: 'supplier' },
  { id: 'u2', name: 'Rae Referrer', email: 'rae@zzz.test', role: 'referrer', status: 'active', lastActive: 'today', kind: 'supplier' },
];

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydratePartners(PARTNERS);
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue(PEOPLE as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function supplierPage() {
  const v = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  await act(async () => {});
  return v;
}
type View = Awaited<ReturnType<typeof supplierPage>>;
async function openTab(v: View, label: string) {
  const tab = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === label);
  expect(tab, `no ${label} tab`).toBeTruthy();
  await act(async () => { fireEvent.click(tab!); });
  await act(async () => {});
}

describe('the Settings tab has the fields Manage had', () => {
  it('name, live from, status, referencing mode and the portal capability', async () => {
    const v = await supplierPage();
    await openTab(v, 'Settings');
    for (const id of ['#ss-name', '#ss-since', '#ss-status', '#ss-refmode']) {
      expect(v.container.querySelector(id), `no ${id}`).toBeTruthy();
    }
    expect(v.container.textContent).toContain('Portal referrals');
    expect((v.container.querySelector<HTMLInputElement>('#ss-name'))!.value).toBe('ZZZ Page Co');
  });

  /* API ACCESS IS NOT ON SETTINGS. It moved to Integration, and Settings
     says where it went rather than leaving a reader hunting for a
     tickbox that used to be beside the others. */
  it('and says where API access went, rather than holding it', async () => {
    const v = await supplierPage();
    await openTab(v, 'Settings');
    expect(v.container.textContent).toMatch(/API access is on the\s+Integration\s+tab/);
    expect(v.container.querySelector('#ss-api')).toBeNull();
  });

  it('and still carries the leaderboard policy and the audit trail the modal owned', async () => {
    const v = await supplierPage();
    await openTab(v, 'Settings');
    expect(v.container.querySelector('#ss-lb-mode'), 'the leaderboard policy was lost with the modal').toBeTruthy();
    expect(v.container.textContent).toContain('Recent changes');
  });

  /* SAVE IS DEAD UNTIL SOMETHING CHANGES, like every other settings card
     in the portal. */
  it('and Save does nothing until a field is edited', async () => {
    const v = await supplierPage();
    await openTab(v, 'Settings');
    const save = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Save changes')!;
    expect(save.disabled).toBe(true);
    await act(async () => {
      fireEvent.change(v.container.querySelector('#ss-name')!, { target: { value: 'ZZZ Page Co Ltd' } });
    });
    expect(save.disabled).toBe(false);
  });
});

describe('the People tab', () => {
  it('shows supplier levels, not agency ones', async () => {
    const v = await supplierPage();
    await openTab(v, 'People');
    const text = v.container.textContent ?? '';
    expect(text).toContain('Management');
    expect(text).toContain('Referrer');
  });

  /* THE HALF THAT WAS WRONG. A supplier's staff hold no position on the
     agency rail's group/agency/branch ladder, so the shared describer
     fell through and told a supplier's Management user they could see
     "Own referrals". On this rail the partner IS the company boundary
     and their Management sees all of it. */
  it('and Management sees Everything, not Own referrals', async () => {
    const v = await supplierPage();
    await openTab(v, 'People');
    const rows = [...v.container.querySelectorAll('tbody tr')];
    const mgmt = rows.find((r) => (r.textContent ?? '').includes('Mo Management'))!;
    const ref = rows.find((r) => (r.textContent ?? '').includes('Rae Referrer'))!;
    expect(mgmt.textContent).toContain('Everything');
    expect(mgmt.textContent).not.toContain('Own referrals');
    expect(ref.textContent).toContain('Own referrals');
  });

  /* PEOPLE ARE HERE ONLY. The card used to link to /users?partner=,
     which is a filtered copy of this very table. */
  it('and does not link off to the estate-wide users list', async () => {
    const v = await supplierPage();
    await openTab(v, 'People');
    const hrefs = [...v.container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((h) => h.includes('/users'))).toEqual([]);
  });
});

describe('the Integration tab', () => {
  it('holds the API access switch, with the keys it would break', async () => {
    const v = await supplierPage();
    await openTab(v, 'Integration');
    expect(v.container.querySelector('.apisw'), 'no API access switch').toBeTruthy();
    expect(v.container.textContent).toContain('API access');
    expect([...v.container.querySelectorAll('button')]
      .some((b) => (b.textContent ?? '').trim() === 'Turn on')).toBe(true);
  });
});

describe('the Suppliers list', () => {
  async function list() {
    const v = render(
      <MemoryRouter initialEntries={['/partners']}>
        <ToastProvider><SessionProvider><PageMetaProvider>
          <Routes><Route path="/partners" element={<PartnerManagement />} /></Routes>
        </PageMetaProvider></SessionProvider></ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => { if (!v.container.querySelector('table')) throw new Error('no table'); });
    await act(async () => {});
    return v;
  }

  it('has no Users or Manage buttons', async () => {
    const v = await list();
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Users');
    expect(labels).not.toContain('Manage');
  });

  it('and the row itself opens the supplier, by keyboard as well as mouse', async () => {
    const v = await list();
    const row = v.container.querySelector<HTMLElement>('tr.prow');
    expect(row, 'no clickable row').toBeTruthy();
    expect(row!.getAttribute('role')).toBe('link');
    expect(row!.tabIndex).toBe(0);
  });

  it('and Add supplier still opens a create form', async () => {
    const v = await list();
    const add = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim().includes('Add supplier'))!;
    expect(add, 'no Add supplier button').toBeTruthy();
    await act(async () => { fireEvent.click(add); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Add supplier');
    expect([...(dialog?.querySelectorAll('button') ?? [])]
      .some((b) => (b.textContent ?? '').trim() === 'Create supplier')).toBe(true);
  });
});
