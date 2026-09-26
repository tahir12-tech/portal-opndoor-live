/* THE TENANCY CARD, AFTER "EACH TENANT SIGNS THEIR OWN DEED".

   The walk finding these exist for: on GR-20602 the sibling row read "Paid /
   Deed not yet issued / Reserved" while the tenancy card on the same page said
   the deed was issued. They disagreed by construction. The panel's closing
   paragraph spoke for the LEAD (tenancyGroups handed out lead.status as the
   tenancy's), and every other deed surface spoke for the row you were on.

   The seed pair carries the asymmetry faithfully: GR-20601 (Rosa Vance) is the
   lead and holds an executed deed, GR-20602 (Theo Brandt) has paid and has no
   deed of his own yet. So the correct page says two different things about two
   different tenants, and says them in the same place. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

const LEAD = 'GR-20601';
const SIBLING = 'GR-20602';

async function openDetail(ref: string) {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={[`/applications/${ref}`]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('.rec-head')) throw new Error('detail not ready'); });
  return view;
}

/** The tenancy panel's rows, keyed by the tenant they are about. */
function rowFor(view: { container: HTMLElement }, tenant: string): HTMLElement {
  const rows = [...view.container.querySelectorAll<HTMLElement>('.jt-panel__row')];
  const row = rows.find((r) => (r.textContent ?? '').includes(tenant));
  if (!row) throw new Error(`no tenancy row for ${tenant}`);
  return row;
}

describe('every sibling shows its OWN deed state', () => {
  it('gives each tenant a deed state on their row, on either sibling’s page', async () => {
    for (const here of [LEAD, SIBLING]) {
      const view = await openDetail(here);
      expect(rowFor(view, 'Rosa Vance').querySelector('.jt-panel__ds')?.textContent)
        .toBe('Deed executed');
      expect(rowFor(view, 'Theo Brandt').querySelector('.jt-panel__ds')?.textContent)
        .toBe('No deed yet');
      cleanup();
    }
  });

  it('tones the two apart, so the colour cannot say what the word does not', async () => {
    const view = await openDetail(SIBLING);
    expect(rowFor(view, 'Rosa Vance').querySelector('.jt-panel__ds')!.className)
      .toContain('jt-panel__ds--done');
    expect(rowFor(view, 'Theo Brandt').querySelector('.jt-panel__ds')!.className)
      .toContain('jt-panel__ds--none');
  });

  it('counts the deeds at the tenancy, which is the only tenancy-wide deed figure left', async () => {
    const view = await openDetail(SIBLING);
    expect(view.container.querySelector('.jt-panel__prog')?.textContent)
      .toMatch(/1 of 2 deeds executed/);
  });

  it('never states one tenant’s deed as the tenancy’s', async () => {
    /* The regression itself. On Theo's page the closing paragraph used to read
       "Its status is issued", taken from Rosa's row, directly under a row that
       said Theo had no deed. The paragraph now states the RULE and leaves every
       state to the row it belongs to. */
    const view = await openDetail(SIBLING);
    const para = view.container.querySelector('.jt-panel__deed')!.textContent ?? '';
    expect(para).toMatch(/Each tenant signs their own Deed of Guarantee/i);
    expect(para).toMatch(/names all 2 tenants/i);
    expect(para).not.toMatch(/carried by the lead/i);
    expect(para).not.toMatch(/issued/i);
  });

  /* NO LEAD BADGE AT ALL. This asserted the badge survived as "first tenant
     entered", which was the halfway position: true, and worth nothing to a
     reader. Under per-tenant deeds the lead carries no deed, no reminder and
     no expiry its co-tenants do not also carry, so the label distinguished
     nothing anybody could act on. Dropped here and on the Applications list in
     the same pass, which is why this test now asserts the absence on both
     rows rather than the presence on one. */
  it('marks nobody as the lead, because lead no longer means anything', async () => {
    const view = await openDetail(SIBLING);
    expect(rowFor(view, 'Rosa Vance').querySelector('.jt-lead')).toBeNull();
    expect(rowFor(view, 'Theo Brandt').querySelector('.jt-lead')).toBeNull();
    expect(view.container.textContent).not.toMatch(/\bLead\b/);
  });

  it('leaves a sole applicant with no tenancy panel at all', async () => {
    const view = await openDetail('GR-20418');
    expect(view.container.querySelector('.jt-panel')).toBeNull();
  });
});

describe('the fee, where the page used to print the rent', () => {
  it('never labels the property’s rent as the guarantor fee on a joint tenancy', async () => {
    /* Both siblings carry the WHOLE £3,000 tenancy rent in `rent` and pay a
       share of the fee. The Paid milestone used to print `d.rent`, so both were
       told they had paid £3,000. The rent is still on the page, on the Monthly
       rent row, which is the row whose subject it is. */
    const view = await openDetail(SIBLING);
    const paidNote = [...view.container.querySelectorAll('.tl-step')]
      .find((s) => (s.textContent ?? '').includes('Guarantor fee paid'));
    expect(paidNote, 'no paid milestone on the timeline').toBeTruthy();
    expect(paidNote!.textContent).not.toMatch(/Guarantor fee paid · £3,000(?!\.)/);
  });
});

describe('delivery', () => {
  it('shows no Delivery card in mock mode, where there is nothing to read', async () => {
    // my_application_delivery is a live-mode RPC. With no back end the panel has
    // no answer, and a Delivery card that cannot say where the deed went is
    // worse than no card at all.
    const view = await openDetail(LEAD);
    expect(view.container.querySelector('.dlv')).toBeNull();
    expect([...view.container.querySelectorAll('.card__title')]
      .some((h) => (h.textContent ?? '').trim() === 'Delivery')).toBe(false);
  });
});
