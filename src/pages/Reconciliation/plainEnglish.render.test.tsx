/* WALK FIX 22a. THE RECONCILIATION PAGE SPOKE TO ITSELF, NOT TO A READER.
 *
 * Matt, verbatim: "The page text is jargon ('canonical records', 'Merging
 * likely duplicates is coming in a later release'): rewrite in plain
 * English, explaining that a direct tenant named their letting agent and
 * Opndoor is linking it to a known agency."
 *
 * He named three phrases. There were sixteen on the same screen, and the
 * inventory is in QUEUE.md. The worst of them were not the long words:
 *
 *   "left on the direct house branch"   internal routing, in a toast, to a
 *                                       person who has never heard of a
 *                                       house branch
 *   "canonical records"                 a schema word
 *   "created on the fly by referrers"   describes our plumbing, not their job
 *   "Merging likely duplicates is       a roadmap sentence on a working
 *    coming in a later release"         screen
 *
 * WHAT THE PAGE IS ACTUALLY FOR, which is the sentence it never had: a
 * direct tenant tells us who their letting agent is, and a referrer can add
 * an agency or branch as they go. Both land here so a person checks them
 * before they become a record we work from.
 *
 * TESTED AS ABSENCE AND PRESENCE TOGETHER. Asserting the jargon is gone
 * would pass on a blank page; asserting the new copy is there would pass
 * with the old copy still beside it. Every block below does both.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Reconciliation } from './Reconciliation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

beforeEach(() => { localStorage.clear(); localStorage.setItem('grp_role', 'superadmin'); });
afterEach(() => { cleanup(); });

async function open(tab?: string) {
  const view = render(
    <MemoryRouter initialEntries={[tab ? `/reconciliation?tab=${tab}` : '/reconciliation']}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Reconciliation />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.rtabs')) throw new Error('no tabs'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof open>>;
const text = (v: View) => v.container.textContent ?? '';
/** Titles carry copy too, and are where half the jargon was hiding. */
const allCopy = (v: View) => {
  const titles = [...v.container.querySelectorAll('[title]')].map((e) => e.getAttribute('title') ?? '');
  return `${text(v)} ${titles.join(' ')}`;
};

describe('the words the page opens with', () => {
  it('say what actually lands here and why a person is looking at it', async () => {
    const v = await open();
    const t = text(v);
    expect(t).toMatch(/direct tenants? tell us who their letting agent is/i);
    expect(t).toMatch(/before they become a record we work from/i);
  });

  it('and not "canonical", which is a word from the schema', async () => {
    expect(allCopy(await open())).not.toMatch(/canonical/i);
  });

  it('and not "created on the fly", which describes our plumbing', async () => {
    expect(allCopy(await open())).not.toMatch(/on the fly/i);
  });

  /* A PERMANENTLY DISABLED CONTROL IS NOT A FEATURE, IT IS A PROMISE ON A
     SCREEN. Matt quoted the sentence; the greyed button it describes is
     the same statement in another form, so both go. */
  it('and make no promises about a later release', async () => {
    expect(allCopy(await open())).not.toMatch(/later release|coming soon/i);
  });

  it('and offer no button that cannot be pressed', async () => {
    const v = await open();
    const dead = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => b.disabled && /merge/i.test(b.textContent ?? ''));
    expect(dead.map((b) => b.textContent)).toEqual([]);
  });
});

describe('the CRM is called HubSpot, because that is what it is', () => {
  /* "CRM" is the category; the reader has one and it has a name. The Sync
     button is the one control on this page that reaches outside the
     product, so it is the one whose label most needs to say where. */
  it('on the sync button and in the sentence above it', async () => {
    const v = await open();
    expect(allCopy(v)).toMatch(/HubSpot/);
  });

  it('and the button says what it does rather than naming a system', async () => {
    const v = await open();
    const labels = [...v.container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels).toContain('Sync now');
    expect(labels).not.toContain('Sync CRM');
  });
});

describe('the direct-matches tab', () => {
  /* THE TAB NAME WAS THE SHORTEST PIECE OF JARGON ON THE PAGE. "Direct
     matches" is two nouns from our own model; it says nothing about a
     tenant naming their agent. */
  it('says what it holds', async () => {
    const v = await open();
    const tabs = [...v.container.querySelectorAll('.rtabs button')].map((b) => (b.textContent ?? '').trim());
    expect(tabs.join(' | ')).toMatch(/Agents named by tenants/i);
  });

  /* AND ITS URL DOES NOT CHANGE. Home links here with ?tab=matches and the
     whitelist keys on that literal, so renaming the label must not rename
     the id. This is the assertion that stops a tidy-up breaking a link
     from another page. */
  it('while ?tab=matches still lands on it, because Home links that way', async () => {
    const v = await open('matches');
    expect(text(v)).toMatch(/Tenant typed/);
  });
});

describe('the words a person sees after they act', () => {
  /* "left on the direct house branch" was the sharpest of the sixteen: a
     routing detail, in a toast, shown to somebody who has never heard of a
     house branch. */

  /** Every toast string in a file, without the comments around it. */
  function toastsIn(file: string): string {
    const src = readFileSync(join(process.cwd(), 'src/pages/Reconciliation', file), 'utf8');
    return [...src.matchAll(/toast\(`([^`]*)`/g)].map((m) => m[1]).join(' | ');
  }

  /* READ FROM THE SOURCE, and only the toast STRINGS out of it. A toast is
     transient, so a render test would have to catch it mid-flight; and
     reading the whole file would match the comments, which quote the old
     wording on purpose. Same lesson as the pgTAP source assertions in
     round_sixs_remaining_lows: grep the code, not the prose about it. */
  it('never mention a house branch', () => {
    expect(toastsIn('AgencyMatchQueue.tsx')).not.toMatch(/house branch/i);
  });

  it('and say where the tenant stays and where the agency goes', () => {
    const t = toastsIn('AgencyMatchQueue.tsx');
    expect(t).toMatch(/stays with Opndoor direct/i);
    expect(t).toMatch(/Not in network list/i);
  });

  it('and the confirm toast does not say "canonical" either', () => {
    expect(toastsIn('Reconciliation.tsx')).not.toMatch(/canonical/i);
  });

  it('while still naming the record it confirmed', () => {
    expect(toastsIn('Reconciliation.tsx')).toMatch(/confirmed \$\{item\.type\}/);
  });
});
