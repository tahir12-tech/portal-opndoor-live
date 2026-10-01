/* EVERY LINK INTO APPLICATIONS THAT CARRIES A FILTER ARRIVES FILTERED.
 *
 * Matt, 2026-09-30, verbatim: "Home's Direct signups links (View all
 * Direct, and each stage number) must open Applications already
 * filtered: Origin set to Direct, and the status set where the link
 * names one, with the filter controls showing that selection. Currently
 * ?route=Direct is ignored and all applications show. Check every other
 * link into Applications with a filter in it works the same way."
 *
 * THE LIST IS READ OUT OF THE SOURCE, not typed here. "Check every other
 * link" is a sweep, and a sweep written as a hand-copied list of URLs is
 * out of date the first time somebody adds a link. This greps the pages
 * for `/applications?...` and drives whatever it finds, so a new link is
 * covered by existing code the day it is written.
 *
 * WHAT IS ASSERTED is the CONTROLS, not the rows. Matt's words are "with
 * the filter controls showing that selection", and that is the half that
 * was broken: a list narrowed by a parameter the controls do not reflect
 * cannot be widened or cleared by the person reading it, and they cannot
 * tell what they are looking at. Row counts are asserted by
 * originPicker.render.test.tsx, which drives the control rather than the
 * URL.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KEYS } from '@/data/storage';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Applications } from './Applications';

afterEach(() => {
  cleanup();
  // Shared with Reporting and remembered, so it would leak into the next case.
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

/** Every .tsx under src/pages and src/components, minus the tests. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/* The links, as written. Template holes (`${...}`) are left out rather
   than guessed at: a link to one agency by id is the same MECHANISM as
   ?agency=, which the literal links below already exercise, and a made-up
   id would assert against a party that does not exist. */
const LINKS = [...new Set(
  sources(resolve(process.cwd(), 'src/pages'))
    .concat(sources(resolve(process.cwd(), 'src/components')))
    .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/["'`](\/applications\?[^"'`\s]+)["'`]/g)]
      .map((m) => m[1]))
    .filter((u) => !u.includes('${'))
    // A commented-out link is not a link.
    .map((u) => u.replace(/&amp;/g, '&')),
)].sort();

async function open(url: string) {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    /* INSIDE StrictMode, as src/main.tsx renders the app, and this file
       is the reason that matters. It passed for a fortnight while
       ?route=Direct was broken in the browser on every mount, because
       React 18 only double-invokes effects under StrictMode and this
       harness did not use it: the reset effect's `useRef(true)` guard
       was spent by the first invocation and the second threw the filter
       away. A render harness that does not render the app the way the
       app is rendered can only prove things about a program nobody runs.
       See aDeepLinkSurvivesStrictMode.test.tsx. */
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <SessionProvider><ToastProvider><PageMetaProvider><Applications /></PageMetaProvider></ToastProvider></SessionProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await waitFor(() => { if (!document.querySelector('.ftabs')) throw new Error('page did not draw'); });
  await act(async () => {});
  return view;
}
type View = Awaited<ReturnType<typeof open>>;
const activeTab = (v: View) => (v.container.querySelector('.ftab.is-active')?.textContent ?? '').trim();
const originBox = (v: View) =>
  v.container.querySelector<HTMLInputElement>('.scopepick input[role="combobox"]')?.value ?? '(no picker)';

/** What each status parameter should light up, by the tab's own label. */
const TAB_FOR: Record<string, RegExp> = {
  sent: /^Sent/, paid: /^Paid/, deed: /^Deed/,
  /* THE TAB IS CALLED "Awaiting decision", which is the agent rail's word
     for the referencing stage. My first draft expected "Referencing" and
     failed against a page that was right: the parameter is the internal
     status and the tab is the reader's word for it. */
  referencing: /^Awaiting decision/,
  invited: /^Invited/, 'fee-unpaid': /^(Fee|Unpaid)/, refunded: /^Refunded/,
  withdrawn: /^Withdrawn/, expired: /^Expired/, draft: /^(Draft|In progress)/,
  declined: /^Declined/,
};
const TAB_FOR_DEED: Record<string, RegExp> = {
  awaiting: /^Awaiting/, 'delivery-failed': /^(Delivery|Not delivered)/,
  'cannot-deliver': /^(Cannot|Held)/,
};

describe('the sweep found the links', () => {
  /* A GUARD ON THE SWEEP ITSELF. If the grep stops matching -- somebody
     builds the URLs a different way -- every case below would pass by
     testing nothing, which is the failure mode of a derived list. */
  it('and there are several of them', () => {
    expect(LINKS.length).toBeGreaterThanOrEqual(6);
    expect(LINKS).toContain('/applications?route=Direct');
    expect(LINKS.some((u) => u.includes('status='))).toBe(true);
  });
});

describe.each(LINKS)('%s', (url) => {
  const params = new URLSearchParams(url.split('?')[1]);

  it('arrives with its controls showing the selection', async () => {
    const v = await open(url);

    if (params.get('route') === 'Direct') {
      expect(originBox(v), 'the Origin box does not say Direct').toBe('Direct');
    }

    const status = params.get('status');
    if (status && TAB_FOR[status]) {
      expect(activeTab(v), `status=${status} did not select its tab`).toMatch(TAB_FOR[status]);
    }

    const deed = params.get('deed');
    if (deed && TAB_FOR_DEED[deed]) {
      expect(activeTab(v), `deed=${deed} did not select its tab`).toMatch(TAB_FOR_DEED[deed]);
    }

    /* AND NOTHING ARRIVES ON A FILTER IT DID NOT ASK FOR, which is the
       other way this goes wrong: a remembered scope from a previous
       visit sitting over a link that named none. */
    if (!params.get('route') && !params.get('partner') && !params.get('origin')) {
      expect(originBox(v)).toMatch(/^(Everything|\(no picker\))$/);
    }
  });
});

/* THE TWO MATT NAMED, spelled out rather than left to the sweep, because
   a derived list that stopped matching would take them with it. */
describe('the two links Matt named', () => {
  it('Home: View all Direct', async () => {
    const v = await open('/applications?route=Direct');
    expect(originBox(v)).toBe('Direct');
    expect(activeTab(v)).toMatch(/^All/);
  });

  it('Home: the Awaiting decision stage number, which carries both', async () => {
    const v = await open('/applications?route=Direct&status=referencing');
    expect(originBox(v)).toBe('Direct');
    expect(activeTab(v)).toMatch(/^Awaiting decision/);
  });
});
