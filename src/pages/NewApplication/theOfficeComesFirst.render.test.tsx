/* THE OFFICE IS CHOSEN FIRST, NOT LAST.
 *
 * Matt, 2026-10-01, verbatim: "New application (signed in as a supplier
 * user, joe@bloggs.com at Kestrel): 'Add another tenant' is disabled
 * until an office is chosen, but the office section is last on the form.
 * Move the office/agent section to the top as step 1, so it's chosen
 * before tenants; if the supplier or agency only has one office, pick it
 * automatically so the button works straight away. Same for agency
 * users. Never leave a disabled button whose reason is further down the
 * page."
 *
 * The office was last because it reads like paperwork: who this is for,
 * after what it is about. But the RAIL the office sits on decides whether
 * a tenancy can hold two tenants, so the Tenants section could not be
 * finished until it was answered, and the reason for the disabled button
 * was six hundred pixels below the button.
 *
 * The last sentence is the standing rule, and the one worth keeping: a
 * disabled control whose reason is below the fold is the bug.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(() => { cleanup(); localStorage.clear(); });

const SRC = readFileSync('src/pages/NewApplication/NewApplication.tsx', 'utf8');

async function form(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('#sec-tenant')) throw new Error('form not ready'); });
  return view;
}

/** The sections in the order the page lays them out. */
const order = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('[id^="sec-"]')].map((s) => s.id);

describe('the order of the form', () => {
  it('puts the office before the tenants, for an agency user', async () => {
    const o = order(await form('management'));
    expect(o).toContain('sec-branch');
    expect(o.indexOf('sec-branch')).toBeLessThan(o.indexOf('sec-tenant'));
  });

  it('and for an admin, whose form also asks who referred it', async () => {
    const o = order(await form('superadmin'));
    expect(o.indexOf('sec-referredby')).toBeLessThan(o.indexOf('sec-branch'));
    expect(o.indexOf('sec-branch')).toBeLessThan(o.indexOf('sec-tenant'));
  });

  /* THE SIDE RAIL IS THE PAGE'S TABLE OF CONTENTS. A rail that lists the
     office last while the page asks for it first is the same fault in
     miniature. */
  it('and the rail lists them in the same order as the page', async () => {
    const v = await form('superadmin');
    const rail = [...v.container.querySelectorAll('.navrail a')].map((a) => a.getAttribute('href'));
    const page = order(v).map((id) => `#${id}`).filter((h) => rail.includes(h));
    expect(rail).toEqual(page);
  });
});

describe('one office is not a choice', () => {
  it('is picked automatically, whoever is asking', () => {
    const picker = readFileSync('src/components/AgentBranchPicker.tsx', 'utf8');
    expect(picker).toContain('if (rec.branches.length === 1) {');
    expect(picker).not.toContain('if (rec.branches.length === 1 && (isAdmin || shape.refersOwnStock)) {');
  });
});

describe('the disabled button', () => {
  /* The gate itself is unchanged: on a pre-referenced rail a referral
     really does cover one tenant. What changed is that its reason is now
     above it rather than below. */
  it('still says why, and the reason is now a section the reader has passed', () => {
    expect(SRC).toContain('Choose the agency and office first');
    const branchAt = SRC.indexOf('id="sec-branch"');
    const gateAt = SRC.indexOf('Choose the agency and office first');
    expect(branchAt).toBeGreaterThan(0);
    expect(branchAt).toBeLessThan(gateAt);
  });
});
