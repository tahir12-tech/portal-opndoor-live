/* THE SUPPLIER COMMISSION TAB, IN PLAIN ENGLISH.
 *
 * Matt, 2026-10-01, verbatim: "Rebuild the supplier Commission tab, plain
 * English only (no 'shapes', 'deals underneath', 'frozen', 'carved',
 * 'Standard terms'): 1. 'Who does opndoor pay?' Two options: 'Kestrel
 * Lettings only. They pay their agencies themselves.' / 'Kestrel Lettings
 * and each agency, separately.' ... 5. A worked example that updates
 * live: 'On a £1,000 fee: opndoor pays Kestrel Lettings £250 and the
 * agency £100. Total £350.' (option 1: 'opndoor pays Kestrel Lettings
 * £250, of which £100 goes to the agency'). 6. One line: 'Changes apply
 * to new referrals only.'"
 *
 * =====================================================================
 * THE BANNED WORDS ARE CHECKED AGAINST WHAT RENDERS, NOT THE SOURCE
 * =====================================================================
 *
 * Every one of those five words is in this codebase on purpose. "Carved"
 * and "shape" describe the two deal shapes in comments and in migration
 * names, `percentShape` is a function, and `isStandard` is a column. A
 * grep over the files would fail on all of them and teach the next person
 * to rename their variables instead of their copy.
 *
 * So the check reads `textContent` after a render: the words Matt was
 * reading, and nothing else. It walks the tab, then opens each editor,
 * because the editors are where four of the five words used to be.
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

const SUPPLIER = 'zzz-english';

/** opndoor pays the supplier, which settles with its own agencies. */
const carves = [{
  id: SUPPLIER, name: 'ZZZ Kestrel Lettings', status: 'active', since: '2026-01-01',
  weight: 1, users: 0, apps: 0, referencingMode: 'pre_referenced_open',
  partnerRate: 0.25, agentRate: 0.1,
  apiAccessEnabled: false, portalReferralsEnabled: true, primary: false,
  opndoorPaysAgents: false,
}] as unknown as Partner[];

/** opndoor pays the supplier AND each agency, separately. */
const siblings = [{ ...carves[0], opndoorPaysAgents: true }] as unknown as Partner[];

/* MATT'S FIVE WORDS. 'party' and 'additive' are not on his list for this
   instruction but were on the previous one about this same editor, so they
   are kept honest here too. */
const BANNED: { word: RegExp; said: string }[] = [
  { word: /\bshapes?\b/i, said: 'shape' },
  { word: /deals? underneath/i, said: 'deals underneath' },
  { word: /\bfroze(n)?\b/i, said: 'frozen' },
  { word: /\bcarve(d)?\b/i, said: 'carved' },
  { word: /standard terms/i, said: 'Standard terms' },
  { word: /\badditive\b/i, said: 'additive' },
];

function assertPlain(text: string, where: string) {
  for (const b of BANNED) {
    expect(b.word.test(text), `"${b.said}" is on screen on ${where}`).toBe(false);
  }
}

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydrateOrg([] as never[]);
  vi.spyOn(users, 'getUsers').mockReturnValue([] as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function commissionTab(partners: Partner[]) {
  hydratePartners(partners);
  const v = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  const tab = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === 'Commission');
  expect(tab, 'no Commission tab').toBeTruthy();
  await act(async () => { fireEvent.click(tab!); });
  await act(async () => {});
  return v;
}

type View = Awaited<ReturnType<typeof commissionTab>>;
const press = async (v: View, label: string, nth = 0) => {
  const hits = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
    .filter((b) => (b.textContent ?? '').trim() === label);
  expect(hits.length, `no ${label} button`).toBeGreaterThan(nth);
  await act(async () => { fireEvent.click(hits[nth]); });
  await act(async () => {});
};

describe('the six things the tab is made of', () => {
  it('asks who opndoor pays, in the supplier’s own name', async () => {
    const v = await commissionTab(carves);
    const t = v.container.textContent ?? '';
    expect(t).toContain('Who does opndoor pay?');
    expect(t).toContain('ZZZ Kestrel Lettings only. They pay their agencies themselves.');
    expect(t).toContain('ZZZ Kestrel Lettings and each agency, separately.');
  });

  it('shows what the supplier gets and what the agencies get, each with a Change', async () => {
    const v = await commissionTab(carves);
    const t = v.container.textContent ?? '';
    expect(t).toContain('ZZZ Kestrel Lettings gets');
    expect(t).toContain('25% of the fee');
    /* UNDER OPTION 1 THE AGENCIES' CARD IS HEADED DIFFERENTLY, because the
       same percentage means two different things under the two
       arrangements: out of the supplier's money, or beside it. */
    expect(t).toContain('Of that, agencies get (shown on the statements ZZZ Kestrel Lettings passes on)');
    expect(t).toContain('10% of the fee');
    const changes = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => (b.textContent ?? '').trim() === 'Change');
    expect(changes.length, 'a Change for each of the two deals').toBeGreaterThanOrEqual(2);
  });

  it('lists the agencies on different terms', async () => {
    const v = await commissionTab(carves);
    const t = v.container.textContent ?? '';
    expect(t).toContain('Agencies on different terms');
    expect(t).toContain('No agency is on different terms');
  });

  /* 5. THE WORKED EXAMPLE, which is the only place on the page the two
     deals are added up, and the two arrangements are two sentences. */
  it('works the example through on a £1,000 fee, the supplier settling its own agencies', async () => {
    const v = await commissionTab(carves);
    const t = (v.container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('On a £1,000.00 fee: opndoor pays ZZZ Kestrel Lettings £250.00, of which £100.00 goes to the agency.');
  });

  it('and the other way round when opndoor pays each agency', async () => {
    const v = await commissionTab(siblings);
    const t = (v.container.textContent ?? '').replace(/\s+/g, ' ');
    expect(t).toContain('On a £1,000.00 fee: opndoor pays ZZZ Kestrel Lettings £250.00 and the agency £100.00. Total £350.00.');
    expect(t).toContain('Opndoor pays each agency');
  });

  it('says once that a change applies to new referrals only', async () => {
    const v = await commissionTab(carves);
    expect(v.container.textContent).toContain('Changes apply to new referrals only.');
  });

  /* AND THE STATEMENT ADDRESSES ARE A SECTION OF THEIR OWN, below the
     deals: "Move Monthly statement addresses to its own section below,
     headed 'Who gets the statements'." */
  it('and heads the statement addresses with who gets the statements', async () => {
    const v = await commissionTab(carves);
    const t = v.container.textContent ?? '';
    expect(t).toContain('Who gets the statements');
    expect(t.indexOf('Who gets the statements'))
      .toBeGreaterThan(t.indexOf('Agencies on different terms'));
  });
});

describe('and none of the words Matt struck out', () => {
  it('not on the tab itself', async () => {
    const v = await commissionTab(carves);
    assertPlain(v.container.textContent ?? '', 'the Commission tab');
  });

  it('nor under the other arrangement', async () => {
    const v = await commissionTab(siblings);
    assertPlain(v.container.textContent ?? '', 'the Commission tab, opndoor paying each agency');
  });

  it('nor in the supplier’s own deal editor', async () => {
    const v = await commissionTab(carves);
    await press(v, 'Change', 0);
    const t = document.body.textContent ?? '';
    /* The note field is only shown once a deal shape is chosen, so the
       proof the editor opened is its own title. */
    expect(t, 'the editor did not open').toContain('Commission deal for ZZZ Kestrel Lettings');
    assertPlain(t, 'the supplier’s deal editor');
  });

  it('nor in the agencies’ percentage editor, which asks no fee question', async () => {
    const v = await commissionTab(carves);
    await press(v, 'Change', 1);
    const t = document.body.textContent ?? '';
    expect(t).toContain('How the percentage works');
    expect(t).toContain('Same % on every referral');
    expect(t).toContain('% depends on number of tenants');
    expect(t).toContain('% grows with referrals sent');
    /* NO FEE OPTIONS, which is the instruction: "Its editor sets only the
       agency's %, no fee options". The fee is the supplier's deal's
       business, and a share band naming another one would be two deals
       disagreeing about one referral. */
    expect(t).not.toContain('one month’s rent');
    expect(t).not.toContain('weeks’ rent');
    assertPlain(t, 'the agencies’ percentage editor');
  });

  /* THE VOLUME MODEL IS WHERE THE PERIOD AND THE COUNTING SCOPE LIVE, and
     only there: "with the count period and whose referrals count shown
     only for that last one. Volume steps start at referral 1, not 0." */
  it('and the volume model counts from referral 1, with its period beside it', async () => {
    const v = await commissionTab(carves);
    await press(v, 'Change', 1);
    const opt = [...document.querySelectorAll<HTMLElement>('.roleopt')]
      .find((x) => (x.textContent ?? '').includes('% grows with referrals sent'));
    expect(opt, 'no volume option').toBeTruthy();
    await act(async () => { fireEvent.click(opt!); });
    const t = document.body.textContent ?? '';
    expect(t).toContain('Counting starts at referral 1');
    expect(t).toContain('Counted over');
    expect(t).toContain('Whose referrals count');
    const from = document.querySelector<HTMLInputElement>('input[aria-label="Step 1 from referral"]');
    expect(from?.value, 'the first step must read 1, not 0').toBe('1');
    assertPlain(t, 'the volume model');
  });
});
