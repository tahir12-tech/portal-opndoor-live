/* SEVERAL AGENTS'-SHARE DEALS, AND WHO IS ON EACH, ON THE SCREEN.
 *
 * Matt, 2026-10-01, verbatim: "under 'What the agencies underneath keep',
 * allow several deals. One default deal for all agencies, plus extra deals
 * that each apply to agencies picked from a searchable list of that
 * supplier's agencies (several agencies can share one deal). Show which
 * agencies are on which deal, and every agency not picked uses the default.
 * An agency can only be on one deal at a time; moving it is one click.
 * Changes apply to new referrals only and are recorded with who and when."
 *
 * WHERE EACH HALF IS PROVED. The rules are the database's and
 * several_agents_share_deals.test.sql holds them: several deals at once, one
 * default, one deal per agency, the resolver preferring a membered deal, the
 * move as one upsert, and the three things a membership may not be. This
 * file is the screen: that it shows which agencies are on which deal, that
 * the default's membership is DERIVED rather than read, that moving is one
 * call, and that it says when a move takes effect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as org from '@/data/orgService';
import type { ShareDealView } from '@/data/orgService';
import { ShareDeals } from './ShareDeals';

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

let setDeal: ReturnType<typeof vi.fn>;
let clearDeal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(org, 'getSupplierShareDeals').mockResolvedValue(DEALS);
  setDeal = vi.fn().mockResolvedValue(undefined);
  clearDeal = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(org, 'setAgencyShareDeal').mockImplementation(setDeal as never);
  vi.spyOn(org, 'clearAgencyShareDeal').mockImplementation(clearDeal as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(canEdit = true) {
  const v = render(
    <ToastProvider>
      <ShareDeals slug="zzz" partnerId="p-1" name="ZZZ Supplier" agencies={AGENCIES} canEdit={canEdit} />
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

describe('the list of deals', () => {
  it('shows every deal, not just one', async () => {
    const v = await open();
    expect(cards(v).length).toBe(2);
  });

  /* THE DEFAULT FIRST, because the extra deals are read as exceptions to it
     and a list that buries it reads as two equals. */
  it('with the default first', async () => {
    const v = await open();
    expect(cards(v)[0].textContent).toContain('The default deal');
  });

  it('and each one read back in plain English', async () => {
    const v = await open();
    expect(cardWith(v, 'The default deal').textContent).toContain('10% of the fee goes to the agency');
    expect(cardWith(v, 'A deal for named agencies').textContent).toContain('20% of the fee goes to the agency');
  });
});

describe('which agencies are on which deal', () => {
  /* "SEVERAL AGENCIES CAN SHARE ONE DEAL" -- both names under one card, off
     one agreement, which is what makes it one deal and not two copies. */
  it('names both agencies on the deal they share', async () => {
    const v = await open();
    expect(namesIn(cardWith(v, 'A deal for named agencies')))
      .toEqual(['Alpha Lettings', 'Bravo Property']);
  });

  /* "EVERY AGENCY NOT PICKED USES THE DEFAULT". This is DERIVED on the
     screen, not read: the default deal has no membership rows on purpose,
     because "everybody not named" cannot be kept correct as a list. So the
     assertion is that the screen does the subtraction. */
  it('and lists everybody else under the default, which is nowhere stored', async () => {
    const v = await open();
    expect(namesIn(cardWith(v, 'The default deal')))
      .toEqual(['Charlie Homes', 'Delta Residential']);
  });

  it('and counts them, so the default is not a silent catch-all', async () => {
    const v = await open();
    expect(cardWith(v, 'The default deal').textContent)
      .toMatch(/2 agencies, being everyone not named on a deal below/);
  });

  /* "RECORDED WITH WHO AND WHEN", against the agency it is about. */
  it('and says when each agency was moved and by whom', async () => {
    const v = await open();
    expect(cardWith(v, 'A deal for named agencies').textContent)
      .toMatch(/moved here 14 Sept\\? 2026 by Rosa Vance/);
  });
});

describe('moving an agency', () => {
  /* "MOVING IT IS ONE CLICK." Open the picker, choose the agency, and that
     is the move -- no confirm step, no second screen. */
  it('is one call from the searchable list', async () => {
    const v = await open();
    const card = cardWith(v, 'A deal for named agencies');
    const add = [...card.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Add agencies')!;
    await act(async () => { fireEvent.click(add); });

    const box = card.querySelector<HTMLInputElement>('input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'charl' } }); });
    /* mouseDown, not click: TypeAhead selects on mouseDown so the choice
       lands before the input's blur can close the list. A test that clicks
       asserts nothing about the control people actually use. */
    const row = [...card.querySelectorAll('[role="option"]')]
      .find((e) => (e.textContent ?? '').includes('Charlie Homes'))!;
    await act(async () => { fireEvent.mouseDown(row); });

    expect(setDeal).toHaveBeenCalledTimes(1);
    expect(setDeal).toHaveBeenCalledWith('d-premium', 'ag-charlie');
  });

  /* THE LIST OFFERS AGENCIES THAT ARE ALREADY ON ANOTHER DEAL, because
     otherwise a move is three steps: find where it is, take it off, come
     back. The row says where it is now instead. */
  it('and offers one that is already on another deal, saying so', async () => {
    const v = await open();
    const card = cardWith(v, 'A deal for named agencies');
    await act(async () => {
      fireEvent.click([...card.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => (b.textContent ?? '').trim() === 'Add agencies')!);
    });
    const box = card.querySelector<HTMLInputElement>('input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'a' } }); });
    const text = card.textContent ?? '';
    expect(text).toContain('on the default');
  });

  /* AND IT DOES NOT OFFER AN AGENCY ALREADY ON THIS DEAL, which would be a
     click that does nothing. */
  it('but not one already on this deal', async () => {
    const v = await open();
    const card = cardWith(v, 'A deal for named agencies');
    await act(async () => {
      fireEvent.click([...card.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => (b.textContent ?? '').trim() === 'Add agencies')!);
    });
    const box = card.querySelector<HTMLInputElement>('input')!;
    await act(async () => { fireEvent.change(box, { target: { value: 'Alpha' } }); });
    const listed = [...card.querySelectorAll('[role="option"]')].map((e) => e.textContent ?? '');
    expect(listed.some((t) => t.includes('Alpha Lettings'))).toBe(false);
  });

  it('and going back to the default is one call too', async () => {
    const v = await open();
    const card = cardWith(v, 'A deal for named agencies');
    const back = [...card.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Back to default');
    expect(back).toHaveLength(2);
    await act(async () => { fireEvent.click(back[0]); });
    expect(clearDeal).toHaveBeenCalledWith('ag-alpha');
  });
});

describe('what the screen has to say for itself', () => {
  /* "CHANGES APPLY TO NEW REFERRALS ONLY" is true because the rates are
     frozen at creation, and nothing else on this screen says so. An
     administrator moving an agency mid-month will want to know. */
  it('says when a move takes effect', async () => {
    expect((await open()).container.textContent)
      .toMatch(/Moving an agency applies to its next referral/);
  });

  /* A NAMED DEAL WITH NOBODY ON IT behaves as a second default on the
     server, which is the safe answer and the wrong thing to leave
     unexplained on a screen. */
  it('and warns about a named deal nobody is on', async () => {
    vi.spyOn(org, 'getSupplierShareDeals').mockResolvedValue([
      deal({}), deal({ agreementId: 'd-empty', isDefault: false, members: [] }),
    ]);
    expect((await open()).container.textContent)
      .toMatch(/No agency is on this deal yet, so it prices nothing/);
  });

  /* AND A READER WHO MAY NOT EDIT GETS THE LIST WITHOUT THE CONTROLS,
     rather than no list: an opndoor_manager reads this page. */
  it('and gives a reader the list without the controls', async () => {
    const v = await open(false);
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels).not.toContain('Add agencies');
    expect(labels).not.toContain('Back to default');
    expect(namesIn(cardWith(v, 'A deal for named agencies'))).toHaveLength(2);
  });
});
