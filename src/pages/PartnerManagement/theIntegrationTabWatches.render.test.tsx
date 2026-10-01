/* THE SUPPLIER'S INTEGRATION TAB WATCHES, IT DOES NOT DRIVE.
 *
 * Matt, 2026-10-01, verbatim: "Supplier Integration tab: add the API
 * access on/off switch here (moved from Settings), with a confirmation
 * that says how many active API keys will stop working if it's turned
 * off. Below it, read-only for Opndoor admin: their sandbox activity
 * (sandbox applications and their status), recent API requests and
 * errors, and webhook delivery history, same data as their Dev Centre.
 * Keys show by prefix only, with the existing Revoke; admin still can't
 * see full keys or create them."
 *
 * =====================================================================
 * "SAME DATA" IS LITERAL, AND THAT IS THE DESIGN DECISION
 * =====================================================================
 *
 * These are the Dev Centre's own components with their ACTIONS taken
 * away, not three new readers of the same tables. A second
 * implementation is how two screens come to disagree about what a
 * partner's traffic looked like, and the disagreement would surface in
 * a conversation about a failed integration.
 *
 * NO MIGRATION WAS NEEDED. Every one of the six readers already admits
 * an admin reading any partner -- `is_admin() and (p_partner is null or
 * ... = p_partner)` -- because the Dev Centre already lets an admin
 * choose a party. What was missing was only the panels.
 *
 * WHAT READ-ONLY MEANS HERE. Clearing a sandbox, replaying a delivery
 * and sending a test event all ACT on a developer's working state.
 * Looking at a partner's traffic is reading; emptying their sandbox
 * from a page about the supplier is not, and nothing on that page would
 * say it had happened.
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
import * as dev from '@/data/devCentreService';
import * as partnersSvc from '@/data/partnersService';
import type { Partner } from '@/data/types';
import { PartnerHome } from './PartnerHome';

const SUPPLIER = 'zzz-integration';
const PARTNER_UUID = 'e9000000-0000-0000-0000-0000000000a1';

function partners(apiOn: boolean): Partner[] {
  return [{
    id: SUPPLIER, dbId: PARTNER_UUID, name: 'ZZZ Integration Co', status: 'active',
    since: '2026-01-01', weight: 1, users: 0, apps: 0,
    referencingMode: 'pre_referenced_open', partnerRate: 0.35, agentRate: 0.15,
    apiAccessEnabled: apiOn, portalReferralsEnabled: true, primary: false,
    opndoorPaysAgents: false,
  }] as unknown as Partner[];
}

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue([]);
  vi.spyOn(partnersSvc, 'partnerActiveKeyCount').mockResolvedValue(0);
  vi.spyOn(dev, 'getSandboxApplications').mockResolvedValue([] as never);
  vi.spyOn(dev, 'getSandboxCounts').mockResolvedValue(null as never);
  vi.spyOn(dev, 'getApiLogs').mockResolvedValue([] as never);
  vi.spyOn(dev, 'getDeliveries').mockResolvedValue([] as never);
  vi.spyOn(dev, 'getWebhookEndpoints').mockResolvedValue([] as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function integrationTab(apiOn = true) {
  hydratePartners(partners(apiOn));
  const v = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  const tab = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === 'Integration')!;
  await act(async () => { fireEvent.click(tab); });
  await act(async () => {});
  await act(async () => {});
  return v;
}

describe('the three panels', () => {
  it('are all there once API access is on', async () => {
    const v = await integrationTab(true);
    const text = v.container.textContent ?? '';
    expect(text).toContain('Sandbox activity');
    expect(text).toContain('Recent API requests and errors');
    expect(text).toContain('Webhook delivery history');
  });

  /* THEY READ THIS SUPPLIER, not the whole estate. Passing null would
     show an admin every partner's traffic on one supplier's page, which
     is both wrong and the kind of wrong nobody notices on a quiet dev
     database. */
  it('and each asks for this supplier by id', async () => {
    await integrationTab(true);
    expect(dev.getSandboxApplications).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: PARTNER_UUID }));
    expect(dev.getDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: PARTNER_UUID }));
    /* THE LOG PANEL DEBOUNCES ITS QUERY by 250ms so typing in its search
       box does not fire one per keystroke, so it has not asked yet when
       the other two have. Waited for rather than slept through. */
    await waitFor(() => {
      expect(dev.getApiLogs).toHaveBeenCalledWith(
        expect.objectContaining({ partnerId: PARTNER_UUID }));
    });
  });

  /* NOT SHOWN BEFORE THERE IS ANYTHING TO SHOW. With API access off
     there is no traffic, no sandbox and no endpoint; three empty panels
     would read as broken rather than as not-yet-started. */
  it('and none of them is drawn while API access is off', async () => {
    const v = await integrationTab(false);
    const text = v.container.textContent ?? '';
    expect(text).not.toContain('Sandbox activity');
    expect(text).not.toContain('Webhook delivery history');
    expect(text).toContain('This supplier cannot hold API keys');
  });
});

describe('read-only means the actions are gone', () => {
  it('no clearing somebody else’s sandbox', async () => {
    const v = await integrationTab(true);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Clear sandbox');
  });

  it('no sending a test event at their endpoint', async () => {
    const v = await integrationTab(true);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.some((l) => l.includes('Send test event'))).toBe(false);
  });

  /* AND THE KEY RULE IS UNTOUCHED, which is the line in the instruction
     not to cross: "admin still can't see full keys or create them". The
     tab never renders the key list at all -- it says a count. */
  it('and nothing here mints or reveals a key', async () => {
    const v = await integrationTab(true);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.some((l) => /mint|new key|create key|reveal/i.test(l))).toBe(false);
  });

  /* REFRESH STAYS. It is a read, and a panel you cannot refresh is one
     an admin reloads the whole page for. */
  it('while refreshing is still allowed, because it only reads', async () => {
    const v = await integrationTab(true);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.some((l) => l.startsWith('Refresh'))).toBe(true);
  });
});
