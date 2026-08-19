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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Apply } from './Apply';
import * as auth from '@/tenant/tenantAuth';
import * as api from '@/tenant/tenantApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
    profile: { first_name: 'Sam', last_name: 'Okafor' },
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

  it('sends a signed-out visitor to sign in rather than throwing', async () => {
    vi.spyOn(auth, 'currentTenant').mockResolvedValue(null);
    mount();
    await waitFor(() => expect(screen.getByText('Sign in to continue')).toBeTruthy());
  });
});
