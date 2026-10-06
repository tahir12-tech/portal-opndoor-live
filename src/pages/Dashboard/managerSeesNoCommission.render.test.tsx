/* A MANAGER NEVER SEES A FIGURE. THIS IS THE FILE THAT HOLDS IT.

   An agency has three levels and two of them are role 'management': a Director
   sees what the agency earns, a Manager sees everything else. Every gate on the
   client read the role alone, and 'management' is what a Manager is, so the
   level meant nothing to the person using it: Reporting opened on twelve bars of
   commission with the agency's payable in bold above the funnel, the commission
   statement drew the month in full with a rate on every line and an Export
   button beside it, and the settlement blocks named every payee and the amount
   due. The database was never the leak. may_see_commission() returns nothing to
   them and the four rate routes are closed; the SCREEN read the figures out of
   analytics and printed them.

   HOW A MANAGER IS STAGED, and why it matters that it is done deliberately.
   maySeeCommission('management') returns the module-level SEES_COMMISSION, which
   hydrateCommissionVisibility sets from the signed-in user's own row and which
   DEFAULTS TO TRUE, because mock and demo mode hydrate nothing and every Director
   in them would otherwise read a page of blanks. So a test that stages role
   'management' and stops there has staged a DIRECTOR and asserts nothing. Every
   Manager case below calls hydrateCommissionVisibility(false) first, and every one
   of them is written beside the Director reading the same screen off the same
   book: "returns nothing" is only worth having next to a case that returns
   something.

   WHAT IS DELIBERATELY NOT GATED, and is asserted here as hard as the gates are.
   The fee the TENANT was charged, the rent, the guaranteed value, the volumes,
   the conversion, the charts, the exports and the application record are the
   Manager's own referrals. Gating those does not protect the agency's income, it
   removes the level: a Manager who cannot say what their own tenant paid cannot
   do the job the level exists for. So the fees tile, the funnel, the charts and
   the export buttons are asserted PRESENT for a Manager, and the application
   record is asserted to read identically for both levels.

   Live mode is staged rather than mocked away: SUPABASE_ENABLED is the switch
   into the live analytics path, and the settlement, statement and breakdown
   surfaces exist only on that path. There is no client behind the flag, which is
   why `supabase` is null (SessionContext then resolves straight to ready) and
   sb() throws: nothing under test here may reach the network. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Mutable through a getter so one file can hold both paths: the live analytics
   the settlement and statement surfaces live on, and the mock book the
   application record is read from. vi.hoisted because the factory is evaluated
   during the imports below, before a plain module-scope binding exists. */
const flags = vi.hoisted(() => ({ live: true }));
vi.mock('@/lib/supabase', () => ({
  get SUPABASE_ENABLED() { return flags.live; },
  supabase: null,
  sb: () => { throw new Error('This test runs with no Supabase client.'); },
}));

import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateCommissionVisibility, setHomePartner } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { hydrateOrg } from '@/data/orgService';
import { CommissionStatement } from '@/components/CommissionStatement';
import { App } from '@/App';
import { OrgManagement } from '@/pages/OrgManagement/OrgManagement';
import { Dashboard } from './Dashboard';

/* 'northwind' is opndoor_referenced in the mock partner seed and is the home
   partner in mock mode, which is what makes a 'management' user one of OUR
   agencies rather than a supplier's manager. 'harbourside' is a plain supplier:
   the one surface below that only a supplier ever sees (Commission by route)
   needs a reader who is not agency-facing. */
const AGENCY_PARTNER = 'northwind';
const SUPPLIER_PARTNER = 'harbourside';

function deed(o: Partial<FullApp> & Pick<FullApp, 'ref'>): FullApp {
  return {
    partner: AGENCY_PARTNER, partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0, status: 'deed',
    // Three weeks of rent (2400 x 36 / 52), a negotiated basis rather than a
    // month, so the fee copy is exercised as Regent's actually is.
    rent: 2400, fee: 1661.54, feeBasisWeeks: 3,
    commissionLines: [{ level: 'agency', orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' }],
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
    ...o,
  };
}

/* TWO MONTHS, BECAUSE THE PAGE ASKS TWO QUESTIONS. The hero tiles, the charts
   and Commission by route are the SELECTED PERIOD, which defaults to this
   calendar month; settlement is the PRIOR calendar month and ignores the filter.
   Dated from now rather than from fixed days so neither row falls out of its
   window as the calendar moves. */
function thisMonth(): Date {
  return new Date();
}
function priorMonth(): Date {
  const n = new Date();
  // The 15th, so no month's length can push the date into a neighbouring one.
  return new Date(n.getFullYear(), n.getMonth() - 1, 15);
}

function agencyBook(partner = AGENCY_PARTNER): FullApp[] {
  const now = thisMonth();
  const then = priorMonth();
  return [
    deed({ ref: 'GR-NOW1', partner, sentAt: now, paidAt: now, deedAt: now }),
    deed({ ref: 'GR-WAS1', partner, sentAt: then, paidAt: then, deedAt: then }),
  ];
}

/* STAGE THE WHOLE OF LIVE MODE, not half of it. hydrate() loads the
   applications and the ORG in one pass, and the client narrows the book to the
   agencies the org contains (reachableAgencyNames), because on the agency rail
   the partner is a route and not a company. A test that stages the book but
   leaves the org as the mock seed is staging a state the product never reaches:
   agencies that do not contain the staged applications' own agency. */
function stageOrg(names: string[]) {
  hydrateOrg(names.map((name, i) => ({
    partner: AGENCY_PARTNER, name, referrals: 0, guaranteed: '£0',
    id: `ag-staged-${i}`, branches: [],
  })));
}

beforeEach(() => {
  localStorage.clear();
  flags.live = true;
  setHomePartner(AGENCY_PARTNER);
  hydrateFull(agencyBook());
  stageOrg(["Regent's Lettings"]);
});

afterEach(() => {
  cleanup();
  /* BACK TO THE MODULE DEFAULT, or this file poisons every other file sharing
     the worker: SEES_COMMISSION is module state, and a Director staged in
     somebody else's test would silently become a Manager. */
  hydrateCommissionVisibility(true);
  setHomePartner(AGENCY_PARTNER);
});
// Leave the working copy as the rest of the suite expects to find it.
afterAll(() => hydrateFull([]));

/** Stage the level, not just the role. A Manager is role 'management' WITHOUT
    sees_commission; a Director is the same role WITH it. */
function beManager(): void { hydrateCommissionVisibility(false); }
function beDirector(): void { hydrateCommissionVisibility(true); }

/* The page on its own rather than through <App />: this is a test about one
   screen, and routing the whole shell in only makes it depend on every other
   page compiling. */
async function openDashboard(role = 'management') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Dashboard /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.herorow')) throw new Error('dashboard not ready'); });
  return view;
}

type View = { container: HTMLElement };
const text = (v: View) => v.container.textContent ?? '';
/** The money tile that states earnings, found by its own structure as well as by
    its copy. Not by the word alone: analyticsService also blanks every commission
    string for a Manager, so a tile that had lost its gate would be found empty
    and a text-only search would call the leak a pass. .comm-headline is the
    element that carries the amount and only this tile has one. */
const commissionTile = (v: View) => [...v.container.querySelectorAll<HTMLElement>('.hero-kpi')]
  .find((el) => el.querySelector('.comm-headline') || /Commission/.test(el.textContent ?? '')) ?? null;
const feesTile = (v: View) => v.container.querySelector<HTMLElement>('.hero-kpi--dark');
const trendMeasures = (v: View) => [...v.container.querySelectorAll<HTMLSelectElement>('select[aria-label="Measure for the trend"]')]
  .flatMap((s) => [...s.options].map((o) => o.label));
const trendMeasureValue = (v: View) => v.container.querySelector<HTMLSelectElement>('select[aria-label="Measure for the trend"]')?.value;
const buttonLabels = (v: View) => [...v.container.querySelectorAll('.page-head__actions button')].map((b) => (b.textContent ?? '').trim());

/* =====================================================================
   1. REPORTING
   ===================================================================== */
describe('Reporting, read by a Manager', () => {
  it('draws no commission tile at all, where a Director gets one with an amount in it', async () => {
    /* THE TILE GOES WHOLE, because the amount IS the tile: commHeadline is the
       net commission, the second line is the other side of the same split, and
       the muted line under it is the commission reversed on refunds. There is no
       narrower version of it to show a Manager. */
    beManager();
    const asManager = await openDashboard();
    expect(commissionTile(asManager)).toBeNull();
    cleanup();

    beDirector();
    const asDirector = await openDashboard();
    const tile = commissionTile(asDirector);
    expect(tile, 'a Director must still have the tile, or this test proves nothing').not.toBeNull();
    expect(tile!.querySelector('.comm-headline')!.textContent).toMatch(/^£[\d,.]+$/);
  });

  it('keeps the fees tile, the funnel and the charts, which are the level itself', async () => {
    /* The fee is what the TENANT was charged: the price of the product and a
       fact about referrals this Manager owns and answers the phone about. Gating
       it would leave them a dashboard with no money on it at all, which is not a
       Manager, and they can already read each fee one by one on Applications. */
    beManager();
    const view = await openDashboard();
    const fees = feesTile(view);
    expect(fees).not.toBeNull();
    expect(fees!.textContent).toMatch(/Net fees/);
    expect(fees!.textContent).toMatch(/£/);
    // Volumes, conversion and the guaranteed value stay with it.
    /* RENAMED 2026-10-02. Matt: "'Total guaranteed rent value' doesn't
       change with the period, because it's everything currently
       guaranteed. Label it 'Guaranteed rent in force (whole book, not
       affected by the period)' so it isn't read as this period's
       figure." What this test is about -- that a Manager keeps the
       figure -- is unchanged. */
    /* (dm) EXTENDED, NOT REPLACED. Matt's 2026-10-02 wording quoted
       above is still every word of this label; (dm) added what the
       figure IS -- twelve months per live guarantee, not the months
       remaining -- because the old label answered which deeds and
       left how much of each to be guessed. Both halves asserted, so
       neither can be dropped as the other is edited. */
    expect(fees!.textContent).toMatch(/Guaranteed rent in force/);
    expect(fees!.textContent).toMatch(/12 months per live guarantee/);
    expect(fees!.textContent).toMatch(/\(whole book, not affected by the period\)/);
    expect(view.container.querySelector('.funnel')).not.toBeNull();
    expect(view.container.querySelectorAll('.chartrow .card').length).toBeGreaterThan(0);
    expect(text(view)).toMatch(/Operational health/);
  });

  it('is still offered every export button, because the documents are theirs', async () => {
    // The builders each drop the commission lines and columns for a Manager (see
    // managerExportsNoCommission.test.ts); gating the buttons would take the
    // whole document away to remove a block of it.
    beManager();
    const view = await openDashboard();
    expect(buttonLabels(view)).toEqual(expect.arrayContaining(['Export summary', 'Application export', 'Expiries']));
  });

  it('is never offered Commission earned as a trend measure, and opens on fees', async () => {
    /* The CARD is not gated: "Monthly volume trend" is twelve months of a
       Manager's own branches by every part of the line. Its measure dropdown
       offered Commission earned and OPENED ON IT, so their first sight of this
       page was twelve bars of agency earnings. The option goes, the card stays. */
    beManager();
    const asManager = await openDashboard();
    expect(trendMeasures(asManager)).toEqual(['Fees collected', 'Referral count']);
    expect(trendMeasureValue(asManager)).toBe('value');
    // The chart itself is still drawn, with bars in it.
    expect(asManager.container.querySelectorAll('.bars .bar').length).toBeGreaterThan(0);
    cleanup();

    beDirector();
    const asDirector = await openDashboard();
    expect(trendMeasures(asDirector)).toContain('Commission earned');
    expect(trendMeasureValue(asDirector)).toBe('commission');
  });

  it('gets no Settlements section, no payee, and no "Settlements due" line above the funnel', async () => {
    /* The needs-attention line was the loudest leak on the page and the only
       commission figure here that was never inside a RoleOnly: it read
       "Settlements due 15 October: £X partner / £Y agent" at the top of the
       screen, above the funnel, and anchored to the settlement blocks below. */
    beManager();
    const asManager = await openDashboard();
    expect(asManager.container.querySelector('.na-stat--pay')).toBeNull();
    expect(text(asManager)).not.toMatch(/Settlements due/);
    expect(asManager.container.querySelector('#settlements')).toBeNull();
    expect(text(asManager)).not.toMatch(/commission settlement/i);
    expect(text(asManager)).not.toMatch(/payable to/i);
    cleanup();

    /* AND SINCE 2026-10-01 THE DIRECTOR GETS NONE OF IT EITHER, which is
       Matt's instruction and not a loosening of this one: the blocks are
       Opndoor's settlement run, and an agency's own money is the
       statement below them. What a Director has that a Manager does not
       is the statement itself, which is the line this now asserts. */
    beDirector();
    const asDirector = await openDashboard();
    expect(asDirector.container.querySelector('.na-stat--pay')).toBeNull();
    expect(text(asDirector)).not.toMatch(/Settlements due/);
    expect(asDirector.container.querySelector('#settlements')).toBeNull();
    expect(text(asDirector)).toMatch(/Opndoor pays this on/);
  });

  it('reads no commission anywhere on the whole page, at any grain', async () => {
    /* The backstop, over the rendered page rather than over a list of selectors:
       a surface added later that states earnings fails here even if nobody
       thought to write a test for it. Every phrase below is one the page used to
       print to a Manager. */
    beManager();
    const view = await openDashboard();
    const body = text(view);
    expect(body).not.toMatch(/Your commission/);
    expect(body).not.toMatch(/Agency commission/);
    expect(body).not.toMatch(/Commission earned/);
    expect(body).not.toMatch(/Commission by route/);
    expect(body).not.toMatch(/Agent commission/);
    expect(body).not.toMatch(/Your commission/);
    expect(body).not.toMatch(/Commission payable/);
    /* And no element that exists only to carry one of those amounts:
       .comm-headline is the commission tile's figure and .settle__amt is a
       settlement line's, so either of them on this page is a leak whatever the
       copy around it says. */
    expect(view.container.querySelector('.comm-headline')).toBeNull();
    expect(view.container.querySelectorAll('.settle__amt')).toHaveLength(0);
  });
});

describe("Reporting, read by a supplier's Manager", () => {
  /* THE PREMISE OF THIS BLOCK WAS OVERRULED, 2026-10-03, and the comment it
     replaces is worth keeping to say what changed. It read:

       "A supplier partner's staff are role 'management' too and they are not
        an agency: Commission by route is a table ABOUT them, so agencyFacing
        leaves it on their screen and only the commission predicate can take
        it off."

     That was the gate's reasoning, not a decision anybody had taken, and the
     table is not about them: it lists the three rails and EVERY supplier, so
     Kestrel's own Director was shown its competitors and what Opndoor pays
     them. Matt: "hide the 'Commission by route' table; it's Opndoor-only. The
     supplier's commission is already shown in the summary and its statement."

     SO NEITHER LEVEL SEES IT NOW, and the Manager/Director distinction this
     block existed to prove moves to a surface a supplier actually has: their
     own commission tile. That distinction is the thing worth protecting and
     it is unchanged. */
  beforeEach(() => {
    setHomePartner(SUPPLIER_PARTNER);
    hydrateFull(agencyBook(SUPPLIER_PARTNER));
    stageOrg(["Regent's Lettings"]);
  });

  it('never shows Commission by route, at either level, because it is Opndoor’s', async () => {
    beManager();
    const asManager = await openDashboard();
    expect(text(asManager)).not.toMatch(/Commission by route/);
    expect(asManager.container.querySelectorAll('.settle table')).toHaveLength(0);
    // Not at the cost of the rest of the page: the volumes are still theirs.
    expect(feesTile(asManager)!.textContent).toMatch(/Net fees/);
    cleanup();

    beDirector();
    const asDirector = await openDashboard();
    expect(text(asDirector)).not.toMatch(/Commission by route/);
  });

  /* AND THE LEVEL STILL DECIDES WHAT THEY SEE, which is what this block is
     for. The Director has a commission tile and the Manager does not; that
     rule is untouched by the table going. */
  it('while their Director still sees their own commission and the Manager does not', async () => {
    beManager();
    const asManager = await openDashboard();
    expect(commissionTile(asManager)).toBeNull();
    cleanup();

    beDirector();
    const asDirector = await openDashboard();
    expect(commissionTile(asDirector)).not.toBeNull();
  });
});

/* =====================================================================
   2. THE COMMISSION STATEMENT
   ===================================================================== */
describe('the commission statement', () => {
  /* Two things are under test, and they are separate. On Reporting the whole
     section is wrapped, EYEBROW INCLUDED: "Your commission" standing over an
     empty space tells a Manager exactly what they are not being shown, which is
     worse than the heading being absent. And the panel itself refuses as well as
     its callers, for the third caller nobody has written yet. */
  it('is absent from a Manager\'s Reporting page, heading and all', async () => {
    beManager();
    const asManager = await openDashboard();
    expect(text(asManager)).not.toMatch(/Your commission/);
    expect(asManager.container.querySelector('.stmt')).toBeNull();
    expect(asManager.container.querySelector('.stmt__table')).toBeNull();
    cleanup();

    beDirector();
    const asDirector = await openDashboard();
    expect(text(asDirector)).toMatch(/Your commission/);
    expect(asDirector.container.querySelector('.stmt__table')).not.toBeNull();
  });

  it('refuses itself when a caller forgets, and says which it is', async () => {
    /* REFUSED WHOLE, not blanked column by column: the total is commission, the
       rate is commission, the month list is a list of months the agency earned
       in, and the Export button is the statement entire. A line rather than null,
       because a caller that failed to gate has already drawn a heading and a void
       under it reads as a page that failed to load. */
    beManager();
    const view = render(<CommissionStatement role="management" scope={AGENCY_PARTNER} />);
    expect(text(view)).toMatch(/Commission figures are not shown at your level/);
    // Nothing of the statement survives: no table, no month selector, no export.
    expect(view.container.querySelector('.stmt__table')).toBeNull();
    expect(view.container.querySelector('select')).toBeNull();
    expect(view.container.querySelector('button')).toBeNull();
    expect(text(view)).not.toMatch(/£/);
    expect(text(view)).not.toMatch(/%/);
  });

  it('draws the month in full for a Director, off the same book', async () => {
    // The same component, the same role, the same scope and the same hydrated
    // applications: the only thing that differs is sees_commission.
    beDirector();
    const view = render(<CommissionStatement role="management" scope={AGENCY_PARTNER} />);
    expect(text(view)).not.toMatch(/not shown at your level/);
    const heads = [...view.container.querySelectorAll('.stmt__table thead th')].map((th) => (th.textContent ?? '').trim());
    expect(heads).toEqual(expect.arrayContaining(['Rate', 'Commission', 'Fee charged']));
    expect(view.container.querySelector('.stmt__total')!.textContent).toMatch(/£/);
  });
});

/* =====================================================================
   3. APPLICATION DETAIL
   ===================================================================== */
describe('the application record', () => {
  /* NOTHING ON THIS PAGE IS A COMMISSION SURFACE, and that is a ruling rather
     than an omission, so it is asserted as positively as the gates are. Every
     figure on the record is a fact about the REFERRAL: the guarantee fee as
     charged and the basis it was charged on, the rent, the share of a joint
     tenancy, the deed. A Manager owns this referral and answers the phone about
     it, so the correct page for them is the SAME page, and the test says so by
     rendering both levels and comparing.

     Mock mode, because the record is read from the mock book here and the live
     path would go to the network for its payment and journey rows. */
  const REF = 'GR-20601';

  async function openRecord() {
    localStorage.setItem('grp_role', 'management');
    const view = render(
      <MemoryRouter initialEntries={[`/applications/${REF}`]}>
        <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
      </MemoryRouter>,
    );
    await waitFor(() => { if (!document.querySelector('.rec-head')) throw new Error('detail not ready'); });
    /* AND THEN WAIT FOR IT TO STOP CHANGING, because .rec-head appears before the
       record has finished filling. Documents and notes resolve after it, so the
       two renderings this suite compares were being captured at whatever load
       state each happened to reach: the first render raced the fetch and the
       second found the mock store already warm. The difference that surfaced was
       "Nothing uploaded yet." against four files, which has nothing to do with
       commission, so the comparison was reporting a timing accident as a
       Director/Manager difference. Settling both sides first makes the assertion
       measure the thing it names. */
    let last = '';
    await waitFor(() => {
      const now = document.querySelector('.page-main, main, .app-main')?.textContent ?? '';
      const settled = now !== '' && now === last;
      last = now;
      if (!settled) throw new Error('record still filling');
    }, { timeout: 4000, interval: 60 });
    return view;
  }

  beforeEach(() => { flags.live = false; });

  it('shows a Manager the guarantee fee, which is the tenant\'s price and not our income', async () => {
    beManager();
    const view = await openRecord();
    const paid = [...view.container.querySelectorAll('.tl-step')]
      .find((s) => (s.textContent ?? '').includes('Guarantee fee'));
    expect(paid, 'no paid milestone on the timeline').toBeTruthy();
    expect(paid!.textContent).toMatch(/£[\d,]+/);
  });

  it('states no commission figure and no rate anywhere on it', async () => {
    beManager();
    const view = await openRecord();
    const body = text(view);
    /* The one mention of the word on this page is the refund note, "No
       commission or premium accrues on a refunded fee", which names no figure,
       lets none be worked out, and has always been read by a Negotiator who sees
       commission nowhere. Everything else is refused. */
    expect(body).not.toMatch(/Commission rate/i);
    expect(body).not.toMatch(/Commission payable/i);
    expect(body).not.toMatch(/Agent commission/i);
    expect(body).not.toMatch(/Commission earned/i);
    expect(body).not.toMatch(/\d+(\.\d+)?%\s*commission/i);
  });

  it('reads identically for a Director, which is what "not a commission surface" means', async () => {
    /* If any figure on this record were gated, these two would differ. They do
       not, and they must not: the day somebody adds the rate, the split or the
       amount payable to this page, it goes inside <RoleOnly commission> in the
       same change and this assertion is what notices if it does not. */
    /* Every dated figure on this record comes from the mock book or from the
       page's own fixed NOW, so two renderings of it are comparable character for
       character. The timeline and the key/value rows are named as well as the
       whole page, so a failure says WHERE the two levels came apart. */
    /* THE RECORD, NOT THE WHOLE DOCUMENT, and this comparison used to be the
       whole document. That was over-broad in a way that came due: the sidebar
       footer now names the reader's LEVEL, so the shell around this record says
       "Manager" for one and "Director" for the other, correctly and by design.
       Comparing the shell made this assertion a claim about the sidebar as well as
       about the record, and only the record is what "not a commission surface"
       means. The record region is named explicitly so a future change to the shell
       cannot fail this test and a change to the record still does. */
    const record = (v: View) => v.container.querySelector('.page-main, main, .app-main')?.textContent
      ?? v.container.textContent ?? '';

    beManager();
    const asManager = await openRecord();
    const managerRows = [...asManager.container.querySelectorAll('.drow')].map((r) => r.textContent).join('|');
    const managerTimeline = [...asManager.container.querySelectorAll('.tl-step')].map((s) => s.textContent).join('|');
    const managerRecord = record(asManager);
    const managerLevel = asManager.container.querySelector('.sb__user-role')?.textContent;
    cleanup();

    beDirector();
    const asDirector = await openRecord();
    expect([...asDirector.container.querySelectorAll('.tl-step')].map((s) => s.textContent).join('|')).toBe(managerTimeline);
    expect([...asDirector.container.querySelectorAll('.drow')].map((r) => r.textContent).join('|')).toBe(managerRows);
    expect(record(asDirector)).toBe(managerRecord);
    // Guards against both sides being empty, which would compare nothing.
    expect(managerTimeline).toMatch(/Guarantee fee/);
    expect(managerRows).toMatch(/£/);
    // And the one thing that SHOULD differ, asserted so this test documents the
    // boundary rather than quietly stepping around it.
    expect(managerLevel).toBe('Manager');
    expect(asDirector.container.querySelector('.sb__user-role')?.textContent).toBe('Director');
  });
});

/* =====================================================================
   5. AGENCIES, the surface the sweep never reached.

   Found by the adversarial audit, not by the sweep: OrgManagement.tsx has no
   <RoleOnly> in it at all, so a pass that went gate by gate walked straight past
   it. Its own gate was `const isMgmt = role === 'management'`, which is exactly
   what a Manager is, and it drew "Agency commission" three times over: on every
   agency head, again on every branch row inside it, and again rolled up on a
   collapsed group head. The agency's earnings at three grains, on a page nobody
   had filed under commission.
   ===================================================================== */
async function openAgencies(role = 'management') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/agencies']}>
      <SessionProvider><ToastProvider><PageMetaProvider><OrgManagement /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.textContent) throw new Error('agencies not ready'); });
  return view;
}

describe('Agencies, read by a Manager', () => {
  it('states no commission anywhere on the page', async () => {
    beManager();
    const v = await openAgencies();
    expect(text(v)).not.toMatch(/Agency commission/i);
    expect(text(v)).not.toMatch(/agency comm\./i);
  });

  it('but still lists the agencies and their branches, which are theirs', async () => {
    beManager();
    const v = await openAgencies();
    // The level is "every referral, every branch and the team". Taking the page
    // away to withhold one stat would be the level, not the figure.
    expect(v.container.querySelectorAll('.agency__stat').length).toBeGreaterThan(0);
  });

  it('and a Director still sees it, so the assertion above means something', async () => {
    beDirector();
    const v = await openAgencies();
    expect(text(v)).toMatch(/Agency commission/i);
  });
});
