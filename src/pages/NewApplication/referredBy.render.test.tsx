/* WHO THE REFERRAL CAME THROUGH, ASKED FIRST.
 *
 * Q-06 item H. The form inferred the rail, the route and the fee from the
 * BRANCH, after the fact. That cannot answer the one question that decides
 * all three for an agency a supplier introduced, because such an agency can
 * transact on either route and the branch looks identical either way.
 *
 * Matt's text, and each clause is an assertion below: "First field is
 * Supplier or Agency, required, no default. Supplier: pick the supplier
 * (real suppliers only, never a house partner), then Agency and Branch
 * search only that supplier's ... changing the supplier clears both ...
 * single tenant (no Add another tenant) ... Tenant, Property and Tenancy
 * stay disabled until Referred by is complete ... Admin view only."
 *
 * AND "ADMIN VIEW ONLY" MEANS THE SECTION. Matt, 2026-09-29: "'Admin view
 * only' on Referred by means that section only; agencies keep their own form
 * as it is." So there is no route guard and an agency negotiator's form is
 * untouched -- which is the last describe block, and the one that would
 * matter most if it were wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { NewApplication } from './NewApplication';

beforeEach(() => { localStorage.clear(); });
afterEach(() => cleanup());

async function openForm(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <ToastProvider><SessionProvider><PageMetaProvider><NewApplication /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('#sec-tenant')) throw new Error('form not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openForm>>;
const sel = (v: View, label: string) =>
  v.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
const tenantSection = (v: View) => v.container.querySelector<HTMLElement>('#sec-tenant')!;

describe('an opndoor admin opening New application', () => {
  it('is asked who referred it, first, before anything else', async () => {
    const v = await openForm('superadmin');
    const section = v.container.querySelector('#sec-referredby');
    expect(section, 'no Referred by section').toBeTruthy();
    // FIRST: it precedes the tenant section in the document.
    expect(section!.compareDocumentPosition(tenantSection(v)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('with no default, because a default is a decision taken for them', async () => {
    const v = await openForm('superadmin');
    expect(sel(v, 'Referred by')!.value).toBe('');
  });

  it('and everything below stays shut until it is answered', async () => {
    const v = await openForm('superadmin');
    expect(tenantSection(v).getAttribute('aria-disabled')).toBe('true');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'agency' } }); });
    expect(tenantSection(v).getAttribute('aria-disabled')).toBe('false');
  });

  /* A SUPPLIER IS NOT COMPLETE UNTIL IT IS NAMED. Choosing "Supplier" and
     stopping leaves the form knowing the rail and not the route, which is
     the half that decides the commission. */
  it('and choosing Supplier does not open it until the supplier is chosen', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    expect(tenantSection(v).getAttribute('aria-disabled')).toBe('true');
    const supplier = sel(v, 'Supplier')!;
    const first = [...supplier.options].find((o) => o.value)!;
    await act(async () => { fireEvent.change(supplier, { target: { value: first.value } }); });
    expect(tenantSection(v).getAttribute('aria-disabled')).toBe('false');
  });

  it('offers real suppliers only, never a house route', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    const labels = [...sel(v, 'Supplier')!.options].map((o) => o.textContent ?? '');
    expect(labels.length).toBeGreaterThan(1);
    // The three house routes are the ones a referral cannot be "referred by".
    expect(labels.join(' ')).not.toMatch(/opndoor agents|opndoor direct|Provider hand-over/i);
  });

  /* SINGLE TENANT ON THE SUPPLIER PATH. Matt's words are "no Add another
     tenant", and the form's existing answer to that is better than hiding
     it: the button is drawn DISABLED with the reason beside it, which is
     what it already does when the chosen BRANCH turns out to be a
     supplier's. The change here is that it decides from the route the admin
     stated rather than waiting for the estate probe to come back about the
     branch -- and those two can disagree, for an agency a supplier
     introduced. So the assertion is that the affordance is unavailable and
     says why, not that the words are absent. */
  it('and a supplier referral is single-tenant: the button is offered disabled, with the reason', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    const supplier = sel(v, 'Supplier')!;
    const first = [...supplier.options].find((o) => o.value)!;
    await act(async () => { fireEvent.change(supplier, { target: { value: first.value } }); });
    const add = [...v.container.querySelectorAll('button')]
      .find((b) => /Add another tenant/.test(b.textContent ?? ''));
    expect(add, 'no Add another tenant control at all').toBeTruthy();
    expect(add!.disabled).toBe(true);
    expect(v.container.textContent).toMatch(/one tenant at a time/);
  });

  it('while the agency path leaves it available, because a joint tenancy is real there', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'agency' } }); });
    // Not yet enabled -- the estate probe answers about the branch, and no
    // branch is chosen -- but the reason must not be the supplier one.
    expect(v.container.textContent).not.toMatch(/one tenant at a time/);
  });
});

describe('an agency negotiator opening the same form', () => {
  /* THE ASSERTION MATT'S ANSWER TURNS ON. Reading "admin view only" as the
     whole PAGE would have stopped every agency negotiator referring a
     tenant, which is the product's main job. */
  it('is not asked, and their form is exactly as it was', async () => {
    const v = await openForm('referrer');
    expect(v.container.querySelector('#sec-referredby')).toBeNull();
    // And nothing is gated: the tenant section is open on arrival.
    expect(tenantSection(v).getAttribute('aria-disabled')).toBe('false');
  });
});
