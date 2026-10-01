/* THE INVOICE-EMAIL WARNING ON HOME, AND WHO SEES IT.
 *
 * Matt, 2026-10-01: "Until it's set, don't send statements; show a clear
 * warning on Home and Health saying the invoice email needs setting."
 * And, in the message after: "No warning needed while it's set."
 *
 * =====================================================================
 * THE TRAP THIS FILE EXISTS FOR
 * =====================================================================
 *
 * app_settings is readable only by an admin or an opndoor_manager, and
 * only at aal2. A warning driven off a direct read of that table would
 * answer "empty" for everybody else: every agency manager and negotiator
 * would land on a red band about Opndoor's own finance inbox, a setting
 * they cannot see, cannot change and have no business knowing about.
 *
 * So the question is asked through statements_can_be_posted(), which is
 * SECURITY DEFINER and answers the same for everyone, and the band is
 * gated on WHO SHOULD ACT rather than on who happens to be able to read
 * a row. Both halves are asserted below.
 *
 * AND A FAILED READ RAISES NOTHING. "We could not ask" is not "it is not
 * set", and a red band that appears when a network call drops is one
 * people learn to ignore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Home } from './Home';
import * as settings from '@/data/settingsService';
import * as recon from '@/data/reconciliationService';

const BAND = '.home-stop';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(recon, 'loadAgencyMatchQueue').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function home(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider><SessionProvider><PageMetaProvider><Home /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
  await act(async () => {});
  return view;
}

describe('when no statement can be posted', () => {
  beforeEach(() => { vi.spyOn(settings, 'canPostStatements').mockResolvedValue(false); });

  it('Opndoor staff get a band saying so, above every queue', async () => {
    const v = await home('superadmin');
    await waitFor(() => { if (!v.container.querySelector(BAND)) throw new Error('no band'); });
    const band = v.container.querySelector(BAND)!;
    expect(band.textContent).toMatch(/invoice email is not set/i);
    expect(band.textContent).toMatch(/no commission statement can be posted/i);
    /* IT SAYS WHERE TO GO, and is itself the link: a warning that names a
       screen without linking to it makes the reader hunt for it. */
    expect(band.getAttribute('href')).toBe('/health');
    expect(band.textContent).toMatch(/Set it on Health, under Settings/i);
  });

  it('and it sits above the queue tiles, because it outranks them', async () => {
    const v = await home('superadmin');
    await waitFor(() => { if (!v.container.querySelector(BAND)) throw new Error('no band'); });
    const band = v.container.querySelector(BAND)!;
    const queues = v.container.querySelector('.home-queues')!;
    expect(band.compareDocumentPosition(queues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('who it is not for', () => {
  /* THE PREDICATE IS NEVER EVEN ASKED for somebody who could not act on
     the answer, which is the half that keeps it off their screen whatever
     the RPC returns. */
  it('a non-staff reader is not asked the question at all', async () => {
    const spy = vi.spyOn(settings, 'canPostStatements').mockResolvedValue(false);
    await home('management');
    expect(spy).not.toHaveBeenCalled();
  });

  it('and never sees the band', async () => {
    vi.spyOn(settings, 'canPostStatements').mockResolvedValue(false);
    const v = await home('management');
    expect(v.container.querySelector(BAND)).toBeNull();
  });
});

describe('while it is set, which is the normal state', () => {
  it('nothing is said about it', async () => {
    vi.spyOn(settings, 'canPostStatements').mockResolvedValue(true);
    const v = await home('superadmin');
    expect(v.container.querySelector(BAND)).toBeNull();
    expect(v.container.textContent).not.toMatch(/invoice email/i);
  });
});

describe('when the question cannot be asked', () => {
  it('nothing is said either, rather than a red band about a guess', async () => {
    vi.spyOn(settings, 'canPostStatements').mockRejectedValue(new Error('offline'));
    const v = await home('superadmin');
    expect(v.container.querySelector(BAND)).toBeNull();
  });
});
