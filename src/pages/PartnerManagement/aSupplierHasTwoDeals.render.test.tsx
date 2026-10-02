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
 * REBUILT ON 2026-10-01, SAME EVENING: "Rebuild the supplier Commission
 * tab, plain English only ... 1. 'Who does opndoor pay?' Two options ...
 * 2. 'Kestrel Lettings gets' ... 3. 'Agencies get' ... 5. A worked example
 * that updates live." So the card titles, the switch and the summary
 * sentence this file was written against are all gone, and the claims that
 * outlived them are asserted in the new words:
 *
 *   two deals on the tab, each with its own editor          -> still here
 *   no deal must not look broken                            -> still here
 *   the deal read back as a sentence                        -> still here
 *   the share editor sets no fee                            -> still here
 *   one way to set commission: no second pair of inputs     -> still here
 *   which arithmetic each arrangement gets                  -> the example
 *   the cap, and what the statements do                     -> their lines
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
    expect(v.container.textContent).toContain('ZZZ Deals Co gets');
    expect(v.container.textContent)
      .toContain('Of that, agencies get (shown on the statements ZZZ Deals Co passes on)');
  });

  /* NO DEAL IS THE COMMON STATE and must not look broken. It says what
     prices the referral instead, which is the flat pair on the card
     above. */
  it('and says what prices a referral when there is no deal', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    /* THE FLAT PERCENTAGE IS WHAT PRICES IT, and the card says the figure
       rather than the word "none": a reader checking what a referral pays
       gets an answer either way. */
    expect(v.container.textContent).toMatch(/35% of the fee, on every referral/);
    expect(v.container.textContent).toMatch(/15% of the fee, on every referral/);
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
        : null);
    /* THE SHARE DEALS COME FROM THEIR OWN READER NOW, because there may be
       several of them. `getSupplierDeal` cannot answer for them: it is built
       on active_agreement_of_kind, which returns one row and picks WHICH by
       effective_from. */
    vi.spyOn(org, 'getSupplierShareDeals').mockResolvedValue([{
      ...view({ agreementId: 'a2', bands: [{ min: 1, max: null, weeks: 0, unit: 'weeks', rate: 0.15 }] }),
      isDefault: true, members: [],
    }]);
    const v = await commissionTab();
    const text = v.container.textContent ?? '';
    expect(text).toContain("1 tenant pays one month's rent, and we pay 35% of that");
    expect(text).toContain('2 or more pay 5 weeks of rent, and we pay 40% of that');
    /* AND THE SHARE'S SENTENCE NAMES NO FEE, because a share sets none. */
    expect(text).toContain('15% of the fee goes to the agency');
    expect(text).not.toMatch(/any number of tenants pay .* and we pay 15%/);
  });

  /* ONE CHANGE PER DEAL, whether or not there is one to change: the card
     leads with what is true now and the editor is behind it. "Agree a
     deal" and "Change the deal" were two labels for one door. */
  it('and offers a Change on each of the two deals', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.filter((l) => l === 'Change')).toHaveLength(2);
  });

  /* AN AGENCY ON DIFFERENT TERMS IS NOW SET HERE, which is the change.

     It used to be: "per-agency overrides are agency-scope deals and belong
     on the agency's page; a second place to set the same thing is how two
     screens come to disagree", and this card said so instead of offering
     one. Matt's third message moved the question: "extra deals that each
     apply to agencies picked from a searchable list of that supplier's
     agencies". So the supplier's page IS the place now, and the card that
     pointed elsewhere is gone with the reason for it.

     The agency-scope override still exists and is still preferred over
     everything here -- see several_agents_share_deals.test.sql -- it is
     just no longer the only way to put one agency on its own terms. */
  it('and offers to put a group of agencies on their own deal', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    vi.spyOn(org, 'getSupplierShareDeals').mockResolvedValue([{
      ...view({ agreementId: 'a2', bands: [{ min: 1, max: null, weeks: 0, unit: 'weeks', rate: 0.10 }] }),
      isDefault: true, members: [],
    }]);
    const v = await commissionTab();
    const t = v.container.textContent ?? '';
    expect(t).toContain('Agencies on different terms');
    expect(t).toMatch(/unless it is named on one of these/);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels).toContain('Add');
  });
});

describe('the editor it opens', () => {
  it('is the agency one, addressed to the supplier', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const change = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Change');
    await act(async () => { fireEvent.click(change[0]); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Commission deal for ZZZ Deals Co');
    /* All four of the editor's models, which is "all its options". The
       two middle names changed on 2026-10-01 so the choice between
       tenants and referrals is unmistakable; see
       theTwoCountsAreUnmistakable.render.test.tsx. */
    expect(dialog?.textContent).toContain('One price for everything');
    expect(dialog?.textContent).toContain('Price by number of TENANTS on the tenancy');
    expect(dialog?.textContent).toContain('Price by number of REFERRALS they send');
  });

  /* A SHARE SETS NO FEE, and the editor no longer has a fee column to
     drop: it asks for a percentage and nothing else. The shared editor hid
     the column for an agents' share, which left a form built around a
     question it was not asking. */
  it('and the agents’ share editor asks for a percentage and no fee', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const change = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Change');
    await act(async () => { fireEvent.click(change[1]); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('What the agencies get');
    expect(dialog.textContent).toContain('How the percentage works');
    expect(dialog.querySelector('input[aria-label="Percentage"]')).toBeTruthy();
    /* NO FEE QUESTION AT ALL: no weeks, no months, no fee column. */
    expect(dialog.textContent).not.toMatch(/month’s rent|weeks’ rent/);
    const heads = [...dialog.querySelectorAll('th')].map((h) => (h.textContent ?? '').trim());
    expect(heads, 'the share must not set the tenant’s price').not.toContain('Fee');
    /* AND NO COVER QUESTION. All-in says "nobody underneath is paid
       separately", which is a statement about the commission; saying it
       of a share would be saying the share covers the commission. */
    expect(dialog.textContent).not.toContain('Does this cover everyone?');
  });
});

describe('the old commission card', () => {
  it('is gone, with its inputs and its Save', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    expect(v.container.querySelector('#sc-total')).toBeNull();
    expect(v.container.querySelector('#sc-share')).toBeNull();
    expect(v.container.querySelector('.sc-tiers')).toBeNull();
    const saves = [...v.container.querySelectorAll('button')]
      .filter((b) => /save commission/i.test(b.textContent ?? ''));
    expect(saves).toEqual([]);
  });

  /* AND WHAT IT OWNED IS STILL HERE. Removing the card must not take the
     choice or the arithmetic with it: those are the two things on it that
     were not a duplicate of a deal. The switch is two radio options now --
     Matt, 2026-10-01: "1. 'Who does opndoor pay?' Two options" -- because
     a switch has an on state and an off state, and neither of these two
     arrangements is the absence of the other. */
  it('but the choice of who opndoor pays came across', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const v = await commissionTab();
    const t = v.container.textContent ?? '';
    expect(t).toContain('Who does opndoor pay?');
    expect(t).toContain('ZZZ Deals Co only. They pay their agencies themselves.');
    expect(t).toContain('ZZZ Deals Co and each agency, separately.');
    /* AND THE ONE IN FORCE IS THE ONE SHOWN AS CHOSEN. The fixture supplier
       settles its own agents. */
    const chosen = [...v.container.querySelectorAll('.roleopt.is-sel')].map((e) => e.textContent ?? '');
    expect(chosen.join(' ')).toContain('They pay their agencies themselves');
  });

  /* THE SENTENCE THE TWO CARDS CANNOT WRITE SEPARATELY: that one rate comes
     out of the other. It is the worked example now -- Matt, 2026-10-01: "5.
     A worked example that updates live" -- which is the same claim in money
     instead of percentages, and money is what somebody checks. */
  it('and so did the arithmetic saying who ends up with what', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null);
    const t = ((await commissionTab()).container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('On a £1,000.00 fee: opndoor pays ZZZ Deals Co £350.00, of which £150.00 goes to the agency.');
  });

  /* AND IT SAYS SO ONLY OF THE COMMONEST REFERRAL once a deal varies, rather
     than printing a figure that is true some of the time. */
  it('and hedges the example when a deal varies by volume', async () => {
    vi.spyOn(org, 'getSupplierDeal').mockImplementation(async (_s: string, kind: string) =>
      (kind === 'commission'
        ? view({ tiers: [{ from: 0, to: 50, rate: 0.3 }, { from: 51, to: null, rate: 0.4 }] })
        : null) as AgreementView | null);
    const t = (await commissionTab()).container.textContent ?? '';
    expect(t).toContain('On a single-tenant referral; it changes with the deals below');
  });
});

/* ===========================================================================
   TWO DEAL SHAPES, AND THE SWITCH CHOOSES WHICH.

   Matt, 2026-10-01, verbatim: "Supplier Commission tab, two deal shapes
   chosen by the 'Opndoor pays the agents directly' switch. Off (paid through
   the supplier): one total commission, all paid to the supplier, which
   settles with its agents; the agents' share sits within that total and is
   only used for the per-agency statements. On (paid directly by Opndoor):
   the supplier's own commission and the agents' commission are separate
   deals, each can be flat or tiered, and Opndoor pays each party its own;
   the total is the sum. The plain-English summary explains whichever
   applies."

   THE ARITHMETIC IS THE DATABASE'S and two_deal_shapes_not_one.test.sql
   holds it: who Opndoor pays, how much, that the cap on the agents' rate is
   an OFF-shape rule, and that the share-within-total guard does not bite
   under ON. This file is the sentence: that the screen says the right one of
   the two, and never the other one's arithmetic.

   The fixture supplier settles its own agents, so `paysOn()` re-hydrates it
   with the switch thrown. Both are asserted, because a summary that is right
   about one shape and silent about the other is the defect.
   =========================================================================== */
async function paysOn() {
  hydratePartners([{ ...PARTNERS[0], opndoorPaysAgents: true }] as unknown as Partner[]);
  return commissionTab();
}

describe('the two deal shapes', () => {
  beforeEach(() => { vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(null); });

  /* OFF: ONE figure leaves Opndoor and the agencies' share comes out of it,
     so the example subtracts and the first number is the whole of it. */
  it('paid through the supplier: one total, and the agencies’ share comes out of it', async () => {
    const t = ((await commissionTab()).container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('opndoor pays ZZZ Deals Co £350.00, of which £150.00 goes to the agency');
    expect(t).toContain('This comes out of what ZZZ Deals Co gets, so it can never be more than it.');
  });

  /* AND IT MUST NOT CLAIM THE SIBLING TOTAL. £500 is supplier + agency,
     which is the right answer under the other shape and a wrong one here. */
  it('and never adds the two together under that shape', async () => {
    const t = ((await commissionTab()).container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).not.toContain('Total £500.00');
    expect(t).not.toMatch(/and the agency £150\.00/);
  });

  /* ON: TWO figures leave Opndoor and neither is taken out of the other, so
     the example adds. Nothing comes out of anything. */
  it('paid directly: two separate deals, and the total is their sum', async () => {
    const t = ((await paysOn()).container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('opndoor pays ZZZ Deals Co £350.00 and the agency £150.00. Total £500.00.');
    expect(t).toContain('Opndoor pays each agency');
  });

  it('and does not describe the agencies’ share as coming out of the supplier’s', async () => {
    const t = ((await paysOn()).container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).not.toContain('of which');
    expect(t).not.toContain('can never be more than it');
  });

  /* THE CAP IS ONLY PROMISED UNDER THE SHAPE THAT ENFORCES IT. Under ON that
     sentence would be false: the guard that enforced it is deliberately
     off, because a supplier on 5% introducing agencies on 20% is what the
     shape exists for. */
  it('and the cap is only promised under the shape that enforces it', async () => {
    expect((await commissionTab()).container.textContent ?? '')
      .toContain('can never be more than it');
    cleanup();
    expect((await paysOn()).container.textContent ?? '')
      .toContain('may be more than ZZZ Deals Co gets');
  });

  /* AND THE CHOICE SAYS WHAT THE STATEMENTS DO, which is the half of the
     instruction that is not arithmetic: "off, one supplier statement plus
     per-agency schedules for them to forward; on, the supplier is paid its
     own share and each agency gets its own statement from Opndoor."

     AND THE SECOND HALF OF THAT STOPPED BEING TRUE on 2026-10-02.
     20261007410000 stopped sending a statement to an agency in a
     supplier's estate at all -- "all commission statements for a
     supplier's agencies go to the supplier ... whatever the 'Opndoor
     pays the agents directly' setting" -- so the money may go to the
     agency and the paperwork does not. Matt gave the replacement
     sentence the same day: "opndoor pays each agency its share
     directly. All statements still go to Kestrel Lettings."

     The case is kept and turned over, because what it protects is
     unchanged: the switch has to say what it does to the PAPERWORK, and
     that is the half no arithmetic on the page states. */
  it('and names the statements each shape produces', async () => {
    expect((await commissionTab()).container.textContent ?? '')
      .toMatch(/per-agency schedules for them to forward on/);
    cleanup();
    const on = (await paysOn()).container.textContent ?? '';
    expect(on).toMatch(/opndoor pays each agency its share directly/);
    expect(on).toMatch(/All statements still go to/);
    // And the promise that is no longer kept is gone.
    expect(on).not.toMatch(/gets its own statement from opndoor/);
  });
});
