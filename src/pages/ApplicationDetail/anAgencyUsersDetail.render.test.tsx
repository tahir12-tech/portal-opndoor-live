/* WHAT AN AGENCY USER READS ON AN APPLICATION.
 *
 * Matt, 2026-10-01, verbatim: "'Referring agent' shows the referrer's
 * name and office, not just the route; remove the duplicate Referrer line
 * under Tenancy. Hide the Stripe reference and the Test mode label from
 * agency and supplier users. Show 'Paid on' as '27 Sep 2026' like
 * everywhere else."
 *
 * The notes and the applicant's documents went in their own commit; these
 * are the rest of that message.
 *
 * THE CARD NAMED EVERYTHING BUT THE AGENT. "Referring agent" listed the
 * agency, the branch and the route, and the one fact its heading promises
 * was on the Tenancy card below it, under a heading about the tenancy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(() => { cleanup(); localStorage.clear(); });

const SRC = readFileSync('src/pages/ApplicationDetail/ApplicationDetail.tsx', 'utf8');

async function detailAs(role: string, ref = 'GR-20601') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[`/applications/${ref}`]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.rec-head')) throw new Error('not ready'); });
  return view;
}

describe('the Referring agent card', () => {
  it('names the person who sent it, and their office', async () => {
    const v = await detailAs('management');
    const card = [...v.container.querySelectorAll('.card')]
      .find((c) => (c.querySelector('.card__title')?.textContent ?? '') === 'Referring agent');
    expect(card, 'no Referring agent card').toBeTruthy();
    expect(card!.textContent).toContain('Referred by');
  });

  /* THE SAME FACT TWICE, ON TWO CARDS, is what this removes: the Tenancy
     card is about the tenancy. */
  it('and the Tenancy card no longer repeats it', async () => {
    const v = await detailAs('management');
    const tenancy = [...v.container.querySelectorAll('.card')]
      .find((c) => (c.querySelector('.card__title')?.textContent ?? '') === 'Tenancy');
    expect(tenancy, 'no Tenancy card').toBeTruthy();
    expect([...tenancy!.querySelectorAll('.drow__k')].map((k) => k.textContent))
      .not.toContain('Referrer');
  });
});

describe('Opndoor’s own plumbing', () => {
  /* The reference is the key to a record in an account an agency has no
     login for; the mode label is a fact about our configuration. */
  it('the Stripe reference is staff only', () => {
    expect(SRC).toContain('{isOpndoorStaff(role) && (');
    const row = /Stripe reference[\s\S]{0,200}/.exec(SRC)?.[0] ?? '';
    expect(row).toContain('pay-mono');
  });

  it('and so is the Test mode badge', () => {
    expect(SRC).toContain('const paymentBadge = !isOpndoorStaff(role)');
  });

  it('and an agency user sees neither', async () => {
    const v = await detailAs('management');
    const t = v.container.textContent ?? '';
    expect(t).not.toContain('Stripe reference');
    expect(t).not.toContain('Test mode');
  });

  /* THE OTHER HALF IS NOT RENDERABLE HERE. The payment card is live-data
     only -- `pi` comes from getPaymentInfo, which returns nothing without
     a Supabase client -- so "Opndoor still sees it" is asserted against
     the source above rather than against a card this harness cannot
     draw. Pretending otherwise would be a test that passes because the
     page is empty. */
});

describe('the paid date', () => {
  /* fmtInput is the dd/mm/yyyy an <input type="date"> parses back, which
     the amend form needs and nobody reads. */
  it('reads like every other date on the page', () => {
    expect(SRC).toContain('{pi?.paidAt ? formatDate(pi.paidAt) : \'-\'}');
    expect(SRC).not.toContain('{pi?.paidAt ? fmtInput(new Date(pi.paidAt)) : \'-\'}');
  });

  /* AND THE FORMATTER ITSELF says what the row will read, which is the
     part a test can hold onto without a live payment record. */
  it('and that formatter spells the month', async () => {
    const { formatDate } = await import('@/lib/format');
    expect(formatDate('2026-09-27')).toBe('27 Sep 2026');
  });
});
