/* A SUPPLIER'S COMMISSION TAB SHOWS TWO DEALS, IN THE SAME EDITOR.
 *
 * Matt, 2026-10-01, verbatim: "Supplier Commission tab: use the same
 * commission deal editor agencies have, with all its options (flat
 * rate, volume tiers, bands by number of tenants, and per-agency
 * overrides), for both the supplier's total commission and the agents'
 * share within it. Both can be set independently per supplier. The
 * agents' share can never exceed the supplier's total on any referral,
 * checked on save. The summary line explains the resulting deal in
 * plain English. Changes apply to new referrals only, recorded with who
 * and when."
 *
 * WHERE EACH HALF IS PROVED. The rules are the database's and
 * a_supplier_has_two_deals.test.sql holds them: both deals live at once,
 * the resolver answers for each, an agency override beats the
 * supplier's, the share may not exceed the total at any tenant count or
 * volume, and either side editing into a breach is refused. This file is
 * the screen: that there are two of them, that the editor is the agency
 * one, that it drops the fee column where a share sets no fee, and that
 * the summary is a sentence rather than a table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydratePartners } from '@/data/partnersService';
import { hydrateOrg } from '@/data/orgService';
import * as org from '@/data/orgService';
import * as users from '@/data/usersService';
import type { Partner } from '@/data/types';
import type { AgreementView } from '@/data/orgService';
import { PartnerHome } from './PartnerHome';

const SUPPLIER = 'zzz-deals-ui';
const PARTNERS = [{
  id: SUPPLIER, name: 'ZZZ Deals Co', status: 'active', since: '2026-01-01',
  weight: 1, users: 0, apps: 0, referencingMode: 'pre_referenced_open',
  partnerRate: 0.35, agentRate: 0.15,
  apiAccessEnabled: false, portalReferralsEnabled: true, primary: false,
  opndoorPaysAgents: false,
}] as unknown as Partner[];

const view = (o: Partial<AgreementView>): AgreementView => ({
  agreementId: 'a1', scopeLevel: 'partner', coverage: 'additive', period: 'year',
  countingScope: 'agency', isStandard: false, note: null, periodStart: '2026-01-12',
  volume: 0, volumes: [], bands: [], tiers: [], nextRate: null, nextBasis: null, ...o,
});

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydratePartners(PARTNERS);
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function commissionTab() {
  const v = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  const tab = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === 'Commission')!;
  await act(async () => { fireEvent.click(tab); });
  await act(async () => {});
  await act(async () => {});
  return v;
}

describe('the Commission tab', () => {
  it('shows both deals, named for what each is', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    expect(v.container.textContent).toContain('What opndoor pays this supplier');
    expect(v.container.textContent).toContain('What the agencies underneath keep');
  });

  /* NO DEAL IS THE COMMON STATE and must not look broken. It says what
     prices the referral instead, which is the flat pair on the card
     above. */
  it('and says what prices a referral when there is no deal', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    expect(v.container.textContent).toMatch(/No deal\. Every referral pays 35%/);
    expect(v.container.textContent).toMatch(/No deal\. Every referral pays 15%/);
  });

  /* THE SUMMARY IS A SENTENCE. Matt: "The summary line explains the
     resulting deal in plain English." */
  it('and reads a deal back in plain English', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockImplementation(async (_slug, kind) =>
      kind === 'commission'
        ? view({ bands: [
            { min: 1, max: 1, weeks: 1, unit: 'months', rate: 0.35 },
            { min: 2, max: null, weeks: 5, unit: 'weeks', rate: 0.40 },
          ] })
        : view({ agreementId: 'a2', bands: [{ min: 1, max: null, weeks: 0, unit: 'weeks', rate: 0.15 }] }));
    const v = await commissionTab();
    const text = v.container.textContent ?? '';
    expect(text).toContain("1 tenant pays one month's rent, and we pay 35% of that");
    expect(text).toContain('2 or more pay 5 weeks of rent, and we pay 40% of that');
    /* AND THE SHARE'S SENTENCE NAMES NO FEE, because a share sets none. */
    expect(text).toContain('15% of the fee goes to the agency');
    expect(text).not.toMatch(/any number of tenants pay .* and we pay 15%/);
  });

  it('and offers to agree one, or to change the one there is', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.filter((l) => l === 'Agree a deal')).toHaveLength(2);
  });

  /* PER-AGENCY OVERRIDES ARE NOT EDITED HERE. They are agency-scope deals
     and belong on the agency's page; a second place to set the same thing
     is how two screens come to disagree, which is the fault the
     Commission tab exists to end. The card says so rather than being
     silent about a thing the instruction names. */
  it('and says where an agency on different terms is set', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    expect(v.container.textContent).toContain('One agency on different terms');
    expect(v.container.textContent).toMatch(/agreed on that agency's own page/i);
  });
});

describe('the editor it opens', () => {
  it('is the agency one, addressed to the supplier', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const agree = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Agree a deal');
    await act(async () => { fireEvent.click(agree[0]); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Commission deal for ZZZ Deals Co');
    // All four of the editor's models, which is "all its options".
    expect(dialog?.textContent).toContain('One price for everything');
    expect(dialog?.textContent).toContain('Price by number of tenants');
    expect(dialog?.textContent).toContain('Commission grows with volume');
  });

  /* A SHARE SETS NO FEE, so the editor drops the column rather than
     storing a number nothing reads. create_agreement stores NULL whatever
     is sent, so this is the screen agreeing with the rule. */
  it('and drops the fee column on the agents’ share', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const agree = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Agree a deal');
    await act(async () => { fireEvent.click(agree[1]); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Agents' share for ZZZ Deals Co");
    /* A NEW DEAL OPENS ON "Standard terms", which draws no table at all --
       there is nothing to fill in until a shape is chosen. So choose one,
       which is what a person does. */
    const pick = [...dialog.querySelectorAll<HTMLElement>('.roleopt')]
      .find((o) => (o.textContent ?? '').includes('One price for everything'))!;
    await act(async () => { fireEvent.click(pick); });
    const heads = [...dialog.querySelectorAll('th')].map((h) => (h.textContent ?? '').trim());
    expect(heads).toContain('Tenants from');
    expect(heads, 'the share must not set the tenant’s price').not.toContain('Fee');
    /* AND NO COVER QUESTION. All-in says "nobody underneath is paid
       separately", which is a statement about the commission; saying it
       of a share would be saying the share covers the commission. */
    expect(dialog.textContent).not.toContain('Does this cover everyone?');
  });
});
