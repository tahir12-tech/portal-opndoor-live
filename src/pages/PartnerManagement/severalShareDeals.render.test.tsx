/* SEVERAL AGENTS'-SHARE DEALS, AND WHO IS ON EACH, ON THE SCREEN.
 *
 * Matt, 2026-10-01: "under 'What the agencies underneath keep', allow
 * several deals. One default deal for all agencies, plus extra deals that
 * each apply to agencies picked from a searchable list of that supplier's
 * agencies (several agencies can share one deal). Show which agencies are
 * on which deal, and every agency not picked uses the default. An agency
 * can only be on one deal at a time; moving it is one click. Changes apply
 * to new referrals only and are recorded with who and when."
 *
 * And the same evening, rebuilding the tab: "4. 'Agencies on different
 * terms': a list of bespoke deals, each showing its agencies and terms
 * with a Change button. 'Add' opens one dialog that asks which agencies
 * first ... titled with them, e.g. 'Deal for Frost Partnership and 2
 * others', then the agencies' % editor below, one Save."
 *
 * =====================================================================
 * WHAT MOVED, AND WHAT DID NOT
 * =====================================================================
 *
 * The default deal left this list: it is the answer to "Agencies get",
 * which is a question about every agency rather than about a group of
 * them, so it is the card above. Its DERIVED membership came with it --
 * "every agency not picked uses the default" is still an instruction, and
 * the one place it can be said is beside that percentage.
 *
 * Add and Change are now one dialog. The rules stay in the database and
 * one_save_for_a_share_deal.test.sql holds them; this file is the screen:
 * which agencies are on which deal, that the default's list is subtracted
 * rather than read, that the dialog is titled with the agencies it is
 * for, and that Save is ONE call carrying both halves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as org from '@/data/orgService';
import type { AgreementView, ShareDealView } from '@/data/orgService';
import { SupplierDeals } from './SupplierDeals';

const AGENCIES = [
  { id: 'ag-alpha', name: 'Alpha Lettings' },
  { id: 'ag-bravo', name: 'Bravo Property' },
  { id: 'ag-charlie', name: 'Charlie Homes' },
  { id: 'ag-delta', name: 'Delta Residential' },
];

const deal = (o: Partial<ShareDealView>): ShareDealView => ({
  agreementId: 'd-default', scopeLevel: 'partner', coverage: 'additive', period: 'year',
  countingScope: 'agency', isStandard: false, note: null, periodStart: '2026-01-01',
  volume: 0, volumes: [], tiers: [], nextRate: null, nextBasis: null,
  bands: [{ min: 1, max: null, weeks: null, unit: 'months', rate: 0.10 }] as ShareDealView['bands'],
  isDefault: true, members: [], ...o,
});

/* THE DEFAULT, plus one deal that TWO agencies share -- which is the whole
   instruction and the thing N identical copies could not express. */
const DEALS: ShareDealView[] = [
  deal({}),
  deal({
    agreementId: 'd-premium', isDefault: false,
    bands: [{ min: 1, max: null, weeks: null, unit: 'months', rate: 0.20 }] as ShareDealView['bands'],
    members: [
      { agencyId: 'ag-alpha', name: 'Alpha Lettings', addedAt: '2026-09-14T10:00:00Z', addedBy: 'Rosa Vance' },
      { agencyId: 'ag-bravo', name: 'Bravo Property', addedAt: '2026-09-14T10:00:00Z', addedBy: 'Rosa Vance' },
    ],
  }),
];

/** The supplier's own commission, which the worked example needs. */
const TOTAL: AgreementView = {
  agreementId: 'd-total', scopeLevel: 'partner', coverage: 'additive', period: 'year',
  countingScope: 'agency', isStandard: false, note: null, periodStart: '2026-01-01',
  volume: 0, volumes: [], tiers: [], nextRate: null, nextBasis: null,
  bands: [{ min: 1, max: null, weeks: 1, unit: 'months', rate: 0.35 }],
};

let save: ReturnType<typeof vi.fn>;
let clearDeal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(org, 'getSupplierShareDeals').mockResolvedValue(DEALS);
  vi.spyOn(org, 'getSupplierDeal').mockResolvedValue(TOTAL);
  save = vi.fn().mockResolvedValue('d-new');
  clearDeal = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(org, 'saveShareDeal').mockImplementation(save as never);
  vi.spyOn(org, 'clearAgencyShareDeal').mockImplementation(clearDeal as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(canEdit = true) {
  const v = render(
    <ToastProvider>
      <SupplierDeals
        slug="zzz" partnerId="p-1" name="ZZZ Supplier" canEdit={canEdit}
        total={0.35} agentShare={0.1} paysAgents={false}
        agencies={AGENCIES} onSaved={() => {}}
      />
    </ToastProvider>,
  );
  await waitFor(() => { if ((v.container.textContent ?? '').includes('Loading')) throw new Error('nr'); });
  await act(async () => {});
  return v;
}

type View = Awaited<ReturnType<typeof open>>;
const cards = (v: View) => [...v.container.querySelectorAll('.card')];
const cardWith = (v: View, t: string) => cards(v).find((c) => (c.textContent ?? '').includes(t))!;
const namesIn = (el: Element) =>
  [...el.querySelectorAll('.sd-member__name')].map((e) => e.textContent ?? '');
/* startsWith, not equals: a primary button with `arrow` renders its glyph
   inside the button, so Save reads "Save\u2192". */
const press = async (root: ParentNode, label: string, nth = 0) => {
  const hits = [...root.querySelectorAll<HTMLButtonElement>('button')]
    .filter((b) => (b.textContent ?? '').trim().startsWith(label));
  expect(hits.length, `no ${label} button`).toBeGreaterThan(nth);
  await act(async () => { fireEvent.click(hits[nth]); });
  await act(async () => {});
};

describe('the list of deals on different terms', () => {
  /* TITLED WITH ITS AGENCIES, in the same words the dialog that wrote it
     was titled with: a deal called one thing while it is written and
     another once it is saved reads as two deals. */
  it('names each deal by the agencies it is for', async () => {
    const v = await open();
    expect(cardWith(v, 'Deal for Alpha Lettings and 1 other')).toBeTruthy();
  });

  it('and reads each one back in plain English', async () => {
    const v = await open();
    expect(cardWith(v, 'Deal for Alpha Lettings and 1 other').textContent)
      .toContain('20% of the fee goes to the agency');
    /* The default's percentage is the card above, not in this list. */
    expect(cardWith(v, 'Of that, agencies get').textContent)
      .toContain('10% of the fee goes to the agency');
  });

  /* "SEVERAL AGENCIES CAN SHARE ONE DEAL" -- both names under one card, off
     one agreement, which is what makes it one deal and not two copies. */
  it('names both agencies on the deal they share', async () => {
    const v = await open();
    expect(namesIn(cardWith(v, 'Deal for Alpha Lettings and 1 other')))
      .toEqual(['Alpha Lettings', 'Bravo Property']);
  });

  /* "RECORDED WITH WHO AND WHEN", against the agency it is about. */
  /* "Sep", exactly, not Node's "Sept": the shared formatter carries its
     own month table so the same date cannot print differently depending
     on which Node built the page. */
  it('and says when each agency was moved and by whom', async () => {
    const v = await open();
    expect(cardWith(v, 'Deal for Alpha Lettings and 1 other').textContent)
      .toMatch(/moved here 14 Sep 2026 by Rosa Vance/);
  });

  /* "EVERY AGENCY NOT PICKED USES THE DEFAULT". DERIVED on the screen, not
     read: the default deal has no membership rows on purpose, because
     "everybody not named" cannot be kept correct as a list. So the
     assertion is that the screen does the subtraction. */
  it('and lists everybody else beside the default percentage, which is nowhere stored', async () => {
    const v = await open();
    const card = cardWith(v, 'Of that, agencies get');
    expect(namesIn(card)).toEqual(['Charlie Homes', 'Delta Residential']);
    expect(card.textContent).toMatch(/2 agencies, being everyone not named on a deal below/);
  });
});

describe('the one dialog that asks which agencies first', () => {
  it('opens on Add with nobody picked, and is titled as it fills up', async () => {
    const v = await open();
    await press(v.container, 'Add');
    expect(document.body.textContent).toContain('A deal for some of the agencies');
    expect(document.body.textContent).toContain('Which agencies is this deal for?');

    const box = document.querySelector<HTMLInputElement>('.modal input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'charl' } }); });
    /* mouseDown, not click: TypeAhead selects on mouseDown so the choice
       lands before the input's blur can close the list. A test that clicks
       asserts nothing about the control people actually use. */
    const row = [...document.querySelectorAll('[role="option"]')]
      .find((e) => (e.textContent ?? '').includes('Charlie Homes'))!;
    await act(async () => { fireEvent.mouseDown(row); });
    expect(document.body.textContent).toContain('Deal for Charlie Homes');
    expect(document.body.textContent).toContain('1 agency on this deal.');
  });

  /* ONE SAVE, BOTH HALVES. The whole point of the migration behind this:
     the agencies and the terms go in one call, because which agencies are
     named is what decides whether the deal is the supplier's default. */
  it('and saves the agencies and the percentage in one call', async () => {
    const v = await open();
    await press(v.container, 'Add');
    const box = document.querySelector<HTMLInputElement>('.modal input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'delta' } }); });
    await act(async () => {
      fireEvent.mouseDown([...document.querySelectorAll('[role="option"]')]
        .find((e) => (e.textContent ?? '').includes('Delta Residential'))!);
    });
    const pct = document.querySelector<HTMLInputElement>('input[aria-label="Percentage"]')!;
    await act(async () => { fireEvent.change(pct, { target: { value: '18' } }); });
    await press(document, 'Save');

    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0] as org.SaveShareDealInput;
    expect(sent.agencies).toEqual(['ag-delta']);
    expect(sent.bands[0].rate).toBeCloseTo(0.18);
    expect(sent.agreementId ?? null).toBeNull();
  });

  /* NOBODY PICKED IS NOT A DEAL. A deal naming no agency IS the default
     deal on the server, so saving one here would quietly replace the
     supplier's default with terms meant for three agencies. */
  it('and refuses to save a deal with nobody on it', async () => {
    const v = await open();
    await press(v.container, 'Add');
    await press(document, 'Save');
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Pick at least one agency');
  });

  it('opens on Change with its agencies and its percentage already in it', async () => {
    const v = await open();
    await press(cardWith(v, 'Deal for Alpha Lettings and 1 other'), 'Change');
    expect(document.body.textContent).toContain('Deal for Alpha Lettings and 1 other');
    expect(document.body.textContent).toContain('2 agencies on this deal.');
    const pct = document.querySelector<HTMLInputElement>('input[aria-label="Percentage"]')!;
    expect(pct.value).toBe('20');
  });

  it('and changing it sends the deal it is changing', async () => {
    const v = await open();
    await press(cardWith(v, 'Deal for Alpha Lettings and 1 other'), 'Change');
    await press(document, 'Save');
    const sent = save.mock.calls[0][0] as org.SaveShareDealInput;
    expect(sent.agreementId).toBe('d-premium');
    expect(sent.agencies).toEqual(['ag-alpha', 'ag-bravo']);
  });

  /* TAKING AN AGENCY OFF IS DONE IN THE DIALOG TOO, by removing it from the
     list: the whole named set is what Save means. */
  it('and taking an agency out of the list drops it from the deal', async () => {
    const v = await open();
    await press(cardWith(v, 'Deal for Alpha Lettings and 1 other'), 'Change');
    const x = document.querySelector<HTMLButtonElement>('button[aria-label="Remove Bravo Property"]')!;
    await act(async () => { fireEvent.click(x); });
    await press(document, 'Save');
    const sent = save.mock.calls[0][0] as org.SaveShareDealInput;
    expect(sent.agencies).toEqual(['ag-alpha']);
  });

  /* THE SEARCH OFFERS AGENCIES ALREADY ON ANOTHER DEAL, because otherwise a
     move is three steps: find where it is, open that deal, take it off,
     come back. The row says where it is now instead. */
  it('offers an agency that is on another deal, saying where it is', async () => {
    const v = await open();
    await press(v.container, 'Add');
    const box = document.querySelector<HTMLInputElement>('.modal input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'alpha' } }); });
    const row = [...document.querySelectorAll('[role="option"]')]
      .find((e) => (e.textContent ?? '').includes('Alpha Lettings'))!;
    expect(row.textContent).toContain('on Deal for Alpha Lettings and 1 other, so this moves it');
  });

  it('but not one already picked for this deal', async () => {
    const v = await open();
    await press(cardWith(v, 'Deal for Alpha Lettings and 1 other'), 'Change');
    const box = document.querySelector<HTMLInputElement>('.modal input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'Alpha' } }); });
    const listed = [...document.querySelectorAll('[role="option"]')].map((e) => e.textContent ?? '');
    expect(listed.some((t) => t.includes('Alpha Lettings'))).toBe(false);
  });
});

describe('what the screen has to say for itself', () => {
  it('and going back to the default is still one click', async () => {
    const v = await open();
    const card = cardWith(v, 'Deal for Alpha Lettings and 1 other');
    const back = [...card.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Back to default');
    expect(back).toHaveLength(2);
    await act(async () => { fireEvent.click(back[0]); });
    expect(clearDeal).toHaveBeenCalledWith('ag-alpha');
  });

  it('says when a change takes effect', async () => {
    expect((await open()).container.textContent)
      .toMatch(/Changes apply to new referrals only/);
  });

  /* A NAMED DEAL WITH NOBODY ON IT behaves as a second default on the
     server, which is the safe answer and the wrong thing to leave
     unexplained on a screen. The new dialog cannot create one; a deal
     emptied before it existed still can be. */
  it('and warns about a named deal nobody is on', async () => {
    vi.spyOn(org, 'getSupplierShareDeals').mockResolvedValue([
      deal({}), deal({ agreementId: 'd-empty', isDefault: false, members: [] }),
    ]);
    expect((await open()).container.textContent)
      .toMatch(/No agency is on this deal, so it prices nothing/);
  });

  /* AND A READER WHO MAY NOT EDIT GETS THE LIST WITHOUT THE CONTROLS,
     rather than no list: an opndoor_manager reads this page. */
  it('and gives a reader the list without the controls', async () => {
    const v = await open(false);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Add');
    expect(labels).not.toContain('Change');
    expect(labels).not.toContain('Back to default');
    expect(namesIn(cardWith(v, 'Deal for Alpha Lettings and 1 other'))).toHaveLength(2);
  });
});
