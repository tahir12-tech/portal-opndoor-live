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
 * single tenant (no Add another tenant) [REVERSED by batch 16, walk fix 26:
 * suppliers may refer joint tenancies -- see the inverted assertion below]
 * ... Tenant, Property and Tenancy
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
import { getPartners } from '@/data/partnersService';

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

/* THE SUPPLIER CONTROL IS A TYPE-AHEAD SINCE (df), 2026-10-05. Matt:
   "make them type-to-search, like the agency picker, and list only
   suppliers that can take referrals". Options are chosen on MOUSEDOWN,
   which is where TypeAhead preventDefaults so the choice lands before
   the input blurs. */
const supplierBox = (v: View) => v.container.querySelector<HTMLInputElement>('#na-route')!;
const supplierOptionTexts = async (v: View) => {
  await act(async () => { fireEvent.focus(supplierBox(v)); });
  return [...v.container.querySelectorAll<HTMLElement>('.typeahead__opt')].map((o) => (o.textContent ?? '').trim());
};
const pickFirstSupplier = async (v: View) => {
  await act(async () => { fireEvent.focus(supplierBox(v)); });
  const opt = [...v.container.querySelectorAll<HTMLElement>('.typeahead__opt')][0];
  if (!opt) throw new Error('no supplier offered');
  const name = (opt.textContent ?? '').trim();
  await act(async () => { fireEvent.mouseDown(opt); });
  return name;
};

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
    await pickFirstSupplier(v);
    expect(tenantSection(v).getAttribute('aria-disabled')).toBe('false');
  });

  it('offers real suppliers only, never a house route', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    const labels = await supplierOptionTexts(v);
    expect(labels.length).toBeGreaterThan(0);
    // The three house routes are the ones a referral cannot be "referred by".
    expect(labels.join(' ')).not.toMatch(/opndoor agents|opndoor direct|Provider hand-over/i);
  });

  /* (df) AND ONLY SUPPLIERS, which is where "Harbour Lets" came from:
     an AGENCY with a partner row of its own sailed through the old
     list, because getPartners() strips the house routes and nothing
     else. Filing a referral under one puts its commission nowhere
     anybody reads. The list is the server's answer now and it is
     supplier-kind, active, and holding a live agreement. */
  it('and never an agency that happens to have a partner row', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    const labels = await supplierOptionTexts(v);
    expect(labels.length).toBeGreaterThan(0);
    for (const name of labels) {
      const p = getPartners().find((x) => x.name === name);
      expect(p?.kind, `${name} is offered as a supplier`).toBe('supplier');
    }
  });

  /* AND IT SAYS SO, which is the half a filter alone would leave a
     reader guessing at: a supplier they expected to see is missing and
     nothing on the screen explains why. */
  it('and says why the list is short', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    expect(v.container.textContent).toContain('Only suppliers with a live deal are shown');
  });

  /* TYPE TO SEARCH, narrowing as they type, which is the other half of
     Matt's sentence. */
  it('and narrows as it is typed into', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    const all = await supplierOptionTexts(v);
    expect(all.length).toBeGreaterThan(1);
    await act(async () => { fireEvent.change(supplierBox(v), { target: { value: all[0].slice(0, 4) } }); });
    const narrowed = [...v.container.querySelectorAll<HTMLElement>('.typeahead__opt')]
      .map((o) => (o.textContent ?? '').trim());
    expect(narrowed).toContain(all[0]);
    expect(narrowed.length).toBeLessThan(all.length);
  });

  /* THIS ASSERTION IS INVERTED, NOT DELETED, BECAUSE THE RULE CHANGED.

     It used to read "a supplier referral is single-tenant: the button is
     offered disabled, with the reason", and it was right: Q-06 item H's
     words were "single tenant (no Add another tenant)".

     Walk fix 26, batch 16, says the opposite -- "Suppliers may refer joint
     tenancies, the same way agencies can: Add another tenant works on the
     supplier route, shares are set, one fee for the tenancy split by
     share." Batch 16 is newer, so it governs, and the record of the
     reversal belongs here rather than in a deleted line: somebody reading
     Q-06 needs to be able to find out which rule is live.

     The money half is asserted where it lives, in
     supabase/tests/a_supplier_may_refer_a_joint_tenancy.test.sql -- one fee
     for the tenancy, split by share, and the direct rail still refused. */
  it('and a supplier referral may now be a joint tenancy, which Q-06 item H forbade', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    await pickFirstSupplier(v);
    const add = [...v.container.querySelectorAll('button')]
      .find((b) => /Add another tenant/.test(b.textContent ?? ''));
    expect(add, 'no Add another tenant control at all').toBeTruthy();
    expect(add!.disabled).toBe(false);
  });

  /* AND THE SENTENCE THAT EXPLAINED THE OLD RULE IS GONE WITH IT. Leaving
     "this partner sends them one tenant at a time" beside a button that now
     works would teach the rule the product no longer has. */
  it('and no longer says the supplier sends them one at a time', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    await pickFirstSupplier(v);
    expect(v.container.textContent).not.toMatch(/one tenant at a time/);
  });

  /* THE SECOND TENANT ACTUALLY APPEARS. Enabling a button is not the same
     as the form accepting what it does, and the two come apart easily.

     WHAT THIS DELIBERATELY DOES NOT PROVE, said here because the obvious
     reading is that it does: the form also DROPS tenants once the rail
     probe says the origin cannot carry them, and reaching that needs an
     agency and a branch chosen so the probe settles -- which the supplier
     path does not do here. That predicate is shared with the button and
     tested directly in jointAllowed.test.ts, which is the honest place for
     it. A render assertion that looks like it covers the wipe and does not
     would be worse than none; this one was written, checked by mutation,
     found not to bite, and replaced. */
  it('and a second tenant can actually be added on the supplier route', async () => {
    const v = await openForm('superadmin');
    await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
    await pickFirstSupplier(v);
    const add = [...v.container.querySelectorAll('button')]
      .find((b) => /Add another tenant/.test(b.textContent ?? ''))!;
    await act(async () => { add.click(); });
    expect(v.container.textContent).toMatch(/Tenant 2/);
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
