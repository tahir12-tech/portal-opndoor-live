/* WALK FIX 25. EVERY NUMBER ON HOME SAYS WHAT IT COUNTS.
 *
 * Verbatim: "Home: nothing says what period the numbers cover. Label every
 * number with what it counts: the four queue tiles as 'waiting now', and the
 * Direct signups stages with their period. Confirm from the code what period
 * Direct signups currently uses and write it under 'Needs Matt' with the
 * option of a period choice (today, this week, this month, all time) for
 * Matt to decide."
 *
 * WHAT THE DIRECT STAGES ACTUALLY COUNT, read off the code, because the
 * answer decides what the label can honestly say.
 *
 *   const direct = countByStatus({ ...scopeOpts, channel: 'Direct' });
 *
 * No `periodRange`, so `inPeriod` waves everything through: it is ALL TIME.
 * And `countByStatus` counts CURRENT STATUS, not events in a window -- a row
 * is counted under `sent` because it is sitting at Sent now, not because it
 * was sent recently.
 *
 * SO THREE OF THE FOUR ARE ALREADY "WAITING NOW" AND THE FOURTH IS NOT.
 * Awaiting decision, Sent and Paid are states a referral waits in and
 * leaves. Deed issued is terminal: nothing leaves it, so that number is
 * every direct deed ever issued and grows for ever. Four numbers side by
 * side, three of them a snapshot and one a lifetime total, is the thing
 * item 25 is about -- and a single period label over all four would be
 * wrong about three of them or about the fourth.
 *
 * THE CHOICE ITSELF IS MATT'S, recorded as NM-L. This labels what is there.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Home } from './Home';
import { hydrateApplications } from '@/data';
import type { ApplicationSummary } from '@/data';

/* THE MOCK BOOK HAS NO DIRECT ROWS -- it is 16 agency and 5 supplier -- and
   the Direct signups card only draws when the rail has some ("a panel of
   four zeros is not information"). So the card's assertions need a direct
   book, or they would pass vacuously over an absent card. One row per stage,
   including a terminal one, because the point of the fix is that the four
   are not all the same kind of number. */
const directRow = (ref: string, status: ApplicationSummary['status']): ApplicationSummary => ({
  ref, tenant: 'A Tenant', prop: '1 Direct Row, E1 1AA', branch: '', agency: '',
  ben: '', rent: 1500, status, date: '2026-05-10', owner: 0,
  partner: 'opndoor-direct', referrer: null,
} as unknown as ApplicationSummary);

beforeEach(() => {
  localStorage.clear();
  hydrateApplications([
    directRow('GR-DIR-R', 'referencing'),
    directRow('GR-DIR-S', 'sent'),
    directRow('GR-DIR-P', 'paid'),
    directRow('GR-DIR-D', 'deed'),
  ], []);
});
afterEach(() => { cleanup(); hydrateApplications([], []); });

async function openHome() {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={['/home']}>
      <ToastProvider><SessionProvider><PageMetaProvider><Home /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.home-queues')) throw new Error('no queues'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openHome>>;
const tiles = (v: View) => [...v.container.querySelectorAll('.home-q')];
const stages = (v: View) => [...v.container.querySelectorAll('.home-stage')];
const text = (v: View) => v.container.textContent ?? '';

describe('the four queue tiles', () => {
  it('are all there', async () => {
    const v = await openHome();
    expect(tiles(v).length).toBe(4);
  });

  /* MATT'S OWN WORDS, on every one of the four. A queue tile is a snapshot
     and nothing on the page said so. */
  it('each say "waiting now"', async () => {
    const v = await openHome();
    for (const t of tiles(v)) {
      expect(t.textContent ?? '', `tile "${t.querySelector('.home-q__label')?.textContent}"`)
        .toMatch(/waiting now/i);
    }
  });

  /* INCLUDING AN EMPTY ONE. A tile reading 0 still has to say what the 0 is
     a count of, and the empty tile is drawn by a different branch -- which
     is exactly how one of four would come to be missed. */
  it('including the empty ones, which are drawn by their own branch', async () => {
    const v = await openHome();
    const empty = tiles(v).filter((t) => t.classList.contains('home-q--empty'));
    expect(empty.length).toBeGreaterThan(0);
    for (const t of empty) expect(t.textContent ?? '').toMatch(/waiting now/i);
  });
});

describe('the Direct signups stages', () => {
  it('say what they count, not just a number and a word', async () => {
    const v = await openHome();
    // The card only appears when the direct rail has rows; the mock book has
    // them. If it ever stops, this must fail rather than pass vacuously.
    expect(stages(v).length).toBeGreaterThan(0);
    expect(text(v)).toMatch(/all time/i);
  });

  /* THE DISTINCTION THAT MAKES THE LABEL HONEST. Three of the four are
     states a referral waits in and leaves; Deed issued is terminal and
     accumulates for ever. Labelling all four the same would be wrong about
     one of them whichever label was chosen. */
  it('and Deed issued says it is a running total, not a queue', async () => {
    const v = await openHome();
    const deed = stages(v).find((s) => (s.textContent ?? '').includes('Deed issued'));
    expect(deed, 'no Deed issued stage').toBeTruthy();
    expect(deed!.textContent ?? '').toMatch(/all time/i);
  });

  it('while the three a referral passes through say they are waiting now', async () => {
    const v = await openHome();
    for (const label of ['Awaiting decision', 'Sent', 'Paid']) {
      const s = stages(v).find((x) => (x.querySelector('.home-stage__l')?.textContent ?? '') === label);
      expect(s, `no ${label} stage`).toBeTruthy();
      expect(s!.textContent ?? '', label).toMatch(/waiting now/i);
    }
  });

  /* MATT'S OWN WORDING, 2026-09-30, given in quotes and used verbatim:
     "Awaiting decision, Sent and Paid show who is there now. Deed issued is
     all time."

     WHAT IT REPLACES AND WHY HIS IS BETTER. The card said "Three of these
     are how many are sitting there now; Deed issued is every direct deed
     ever issued." A reader then has to work out WHICH three, against four
     tiles, and "three of these" is the kind of sentence that stops being
     true the moment a fifth stage is added. His names them.

     ASSERTED AS AN EXACT STRING, not a loose match. It is a wording change:
     a regex that passes on a paraphrase would not be testing the thing that
     was asked for. */
  it('and the card says, in Matt’s words, which are which', async () => {
    const v = await openHome();
    expect(text(v)).toContain(
      'Awaiting decision, Sent and Paid show who is there now. Deed issued is all time.',
    );
  });

  /* AND THE SENTENCE IT REPLACES IS GONE, so the card does not say the same
     thing twice in two different vocabularies. */
  it('and no longer says it the old, vaguer way', async () => {
    const v = await openHome();
    expect(text(v)).not.toMatch(/Three of these/);
    expect(text(v)).not.toMatch(/every direct deed ever issued/);
  });
});
