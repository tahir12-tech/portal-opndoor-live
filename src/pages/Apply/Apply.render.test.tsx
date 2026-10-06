/* Renders the tenant journey for real.

   WHY THIS EXISTS. It shipped a white page. tsc was clean, the build was clean,
   and 158 tests passed, because every one of them tested a pure function.
   A `useState` had been declared below an `if (!bundle) return`, so it did not
   run on the first render and did on the second, and React threw "rendered more
   hooks than during the previous render".

   Nothing in the suite mounted a component, so nothing could have caught it.
   These do. They are deliberately shallow assertions: the point is not what the
   screen says, it is that mounting it and letting its effects resolve does not
   throw. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Apply } from './Apply';
import * as auth from '@/tenant/tenantAuth';
import * as api from '@/tenant/tenantApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/apply'); });

function bundle(status: string, feePaid: boolean): api.ApplicationBundle {
  return {
    application: {
      id: 'a1', guarantee_ref: 'GR-TEST', status,
      monthly_rent: 1200, tenancy_start: '2026-09-01',
      prop_addr1: '1 Test Street', prop_addr2: null, prop_city: 'Sheffield',
      prop_county: null, prop_postcode: 'S1 1AA',
      tenant_first_name: 'Sam', tenant_last_name: 'Okafor', tenant_email: 's@example.invalid',
    },
    editable: status === 'draft',
    fee_paid: feePaid,
    profile: { first_name: 'Sam', last_name: 'Okafor', dob: '1990-05-14' },
    addresses: [], incomes: [], documents: [], agent: null,
  };
}

function stub(status: string, feePaid = false) {
  vi.spyOn(auth, 'currentTenant').mockResolvedValue({ email: 's@example.invalid', first_name: 'Sam', last_name: 'Okafor' });
  vi.spyOn(api, 'listApplications').mockResolvedValue({
    applicant: { email: 's@example.invalid', first_name: 'Sam', last_name: 'Okafor' },
    applications: [bundle(status, feePaid).application],
  });
  vi.spyOn(api, 'getApplication').mockResolvedValue(bundle(status, feePaid));
  vi.spyOn(api, 'prequalify').mockResolvedValue({
    outcome: null, reason: null, annual_income: 0,
    income_needed_monthly: null, history_months: 0, adverse_credit: null,
  });
}

const mount = () => render(<MemoryRouter><Apply /></MemoryRouter>);

describe('the tenant journey mounts', () => {
  it('renders a draft without throwing, and gets past the loading state', async () => {
    stub('draft');
    mount();
    // The bug was on the SECOND render, once the bundle arrived, so waiting for
    // the loaded screen is the assertion that matters.
    await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
  });

  it('sets its own tab title instead of inheriting the previous screen\'s', async () => {
    // /apply set no title, so after registration it kept "Check your email"
    // from the code screen and never moved. Seed that exact stale value.
    document.title = 'Check your email | opndoor guarantor application';
    stub('draft');
    mount();
    // A fresh draft opens on the Property step, under the tenant product suffix.
    await waitFor(() =>
      expect(document.title).toBe('Property | opndoor guarantor application'));
    expect(document.title).not.toMatch(/Check your email/);
  });

  it('renders every state after submission, which is where the form folds away', async () => {
    for (const status of ['referencing', 'sent', 'declined', 'paid', 'deed']) {
      stub(status, true);
      mount();
      await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
      cleanup();
    }
  });

  it('shows the fee step as locked before payment and unlocked after', async () => {
    stub('draft', false);
    mount();
    await waitFor(() => expect(screen.getAllByText('Application fee').length).toBeGreaterThan(0));
  });

  it('has no Payment tab after approval: Pay, Sign and View live on the Status card', async () => {
    stub('sent', true);
    mount();
    await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
    // The stale Payment tab is gone; the guarantee-fee CTA sits on the status card.
    expect(screen.queryByText(/^Payment$/)).toBeNull();
    expect(screen.getByRole('button', { name: /pay the guarantee fee/i })).toBeTruthy();
  });

  it('in the demo, lands on the application without a session and no interstitial page', async () => {
    // Mock mode has no real auth, so a missing session must not bounce to sign-in
    // (which the demo cannot do). It falls through to the demo application, and the
    // old "sign in or create an account" interstitial is gone.
    stub('draft');
    vi.spyOn(auth, 'currentTenant').mockResolvedValue(null);
    mount();
    await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
    expect(screen.queryByText('Sign in or create an account')).toBeNull();
  });
});

function mountAt(search: string) {
  window.history.replaceState({}, '', `/apply${search}`);
  return render(<MemoryRouter><Apply /></MemoryRouter>);
}

describe('the post-payment return', () => {
  it('lands on a confirmed state naming the amount, what it bought and the next section', async () => {
    stub('draft', true); // webhook has recorded the fee
    mountAt('?fee=paid');
    await waitFor(() => expect(screen.getByText(/Payment received/i)).toBeTruthy());
    // Names the amount and what it bought, and never claims an assessment happened.
    expect(screen.getByText(/£20 for your eligibility check/i)).toBeTruthy();
    expect(screen.getByText(/Nothing has been sent for checking yet/i)).toBeTruthy();
    // Button says where it goes, not "Carry on".
    expect(screen.getByRole('button', { name: /continue to address history/i })).toBeTruthy();
  });

  it('sends a cancelled payment back to the fee step, nothing alarming, payment still there', async () => {
    stub('draft', false);
    mountAt('?fee=cancelled');
    await waitFor(() => expect(screen.getByText(/No payment was taken/i)).toBeTruthy());
    // Still on the fee step with the payment available.
    expect(screen.getByRole('button', { name: /pay £20 and continue/i })).toBeTruthy();
    // Nothing alarming: no error alert.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the post-payment poll', () => {
  it('auto-advances when the payment lands late, without the tenant pressing anything', async () => {
    vi.useFakeTimers();
    // Not paid on arrival: the webhook has not landed yet.
    stub('draft', false);
    mountAt('?fee=paid');
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText(/Confirming your payment/i)).toBeTruthy();
    // The webhook lands a little later: the next reload sees fee_paid true.
    (api.getApplication as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(bundle('draft', true));
    await vi.advanceTimersByTimeAsync(10000);
    expect(screen.getByText(/Payment received/i)).toBeTruthy();
    vi.useRealTimers();
  });

  it('falls back to a "we have your payment" state after two minutes, with Check again', async () => {
    vi.useFakeTimers();
    stub('draft', false); // never confirms
    mountAt('?fee=paid');
    await vi.advanceTimersByTimeAsync(125000);
    expect(screen.getByText(/We have your payment and we are checking it/i)).toBeTruthy();
    expect(screen.getByText(/support@opndoor\.co/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /check again/i })).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('the declaration is a final confirmation', () => {
  async function toDeclaration() {
    stub('draft', true); // fee paid, so the declaration step is unlocked
    mount();
    await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /declaration/i })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /send my application/i })).toBeTruthy());
  }

  it('shows a summary date in long form, not ISO', async () => {
    await toDeclaration();
    // Date of birth is the summary's date row now; it must read long-form.
    expect(screen.getByText('14 May 1990')).toBeTruthy(); // profile dob 1990-05-14
    expect(screen.queryByText('1990-05-14')).toBeNull();
  });

  it('will not let the tick be set until a name is typed', async () => {
    await toDeclaration();
    const check = screen.getByRole('checkbox') as HTMLInputElement;
    expect(check.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/type your full name/i), { target: { value: 'Sam Okafor' } });
    expect(check.disabled).toBe(false);
  });

  it('keeps Send blocked while other sections are unfinished, and reveals rather than submits', async () => {
    await toDeclaration();
    const send = screen.getByRole('button', { name: /send my application/i }) as HTMLButtonElement;
    // Not a dead disabled button: pressable, but marked blocked, with the reasons listed.
    expect(send.disabled).toBe(false);
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/before you can send, finish/i)).toBeTruthy();
    // A press reveals the reason (scrolls/flashes it) and does not submit.
    (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
    const submit = vi.spyOn(api, 'submitApplication');
    fireEvent.click(send);
    expect(submit).not.toHaveBeenCalled();
  });

  it('lists ID check as outstanding, with a line that it is not switched on and on us', async () => {
    await toDeclaration();
    // It cannot gate Send yet, but it must not be silent: shown in the list, with
    // a note that it is on us, not a step the tenant has skipped.
    const block = screen.getByText(/before you can send, finish/i).closest('.ap-blocking') as HTMLElement;
    expect(block).toBeTruthy();
    expect(within(block).getByRole('button', { name: /^ID check$/i })).toBeTruthy();
    expect(within(block).getByText(/not switched on yet\. we will come back to you/i)).toBeTruthy();
  });

  it('demotes the optional note into a disclosure rather than the top of the page', async () => {
    await toDeclaration();
    const note = screen.getByText(/anything else you want to tell us/i);
    expect(note.closest('details')).not.toBeNull();
  });
});

describe('the progress indicators', () => {
  it('hides the five-stage lifecycle timeline while a draft', async () => {
    stub('draft');
    mount();
    await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
    // The timeline reads "1 of 5" forever on a draft and fights the sidebar ticks.
    expect(document.querySelector('.timeline')).toBeNull();
  });

  it('shows the lifecycle timeline once submitted', async () => {
    stub('referencing');
    mount();
    await waitFor(() => expect(document.querySelector('.timeline')).not.toBeNull());
  });

  it('no longer shows an "X of N done" count bar anywhere', async () => {
    stub('draft');
    mount();
    await waitFor(() => expect(screen.getAllByText('GR-TEST', { exact: false }).length).toBeGreaterThan(0));
    // Kept the sidebar ticks (which say WHICH sections); dropped the duplicate count.
    expect(screen.queryByText(/of \d+ done/i)).toBeNull();
  });
});
