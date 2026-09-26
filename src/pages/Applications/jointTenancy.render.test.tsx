/* A joint tenancy, as the admin surfaces draw it.

   Two applications, one property, one guarantee, one deed. The seed pair
   (GR-20601 Rosa Vance, GR-20602 Theo Brandt, tenancy ten-chalcot) carries the
   asymmetry faithfully: the lead is at "Deed Issued" and the sibling at "Paid",
   because apply_deed_executed keys on the PandaDoc document and only the lead
   has one. Left alone that reads as two £3,000 lets at the same address, one of
   which has a deed. These lock that it does not. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

const LEAD = 'GR-20601';
const SIBLING = 'GR-20602';

async function openAt(path: string, role: 'superadmin' | 'management' = 'superadmin') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  return view;
}

async function openList(role: 'superadmin' | 'management' = 'superadmin') {
  const view = await openAt('/applications', role);
  await waitFor(() => { if (!document.querySelector('table.dt tbody tr')) throw new Error('list not ready'); });
  /** The body rows, as text, in render order. */
  const rows = () => [...view.container.querySelectorAll<HTMLElement>('table.dt tbody tr')];
  const rowFor = (ref: string) => rows().find((r) => (r.textContent ?? '').includes(ref));
  return { view, rows, rowFor };
}

describe('the applications list', () => {
  it('draws one joint-tenancy heading above the pair', async () => {
    const { view } = await openList();
    const heads = view.container.querySelectorAll('.jt-head');
    expect(heads).toHaveLength(1);
    expect(heads[0].textContent).toMatch(/Joint tenancy/i);
    expect(heads[0].textContent).toMatch(/2 tenants/);
    expect(heads[0].textContent).toMatch(/one tenancy, a deed each/i);
  });

  it('puts the siblings next to each other, lead first', async () => {
    const { rows } = await openList();
    const refs = rows().map((r) => r.textContent ?? '');
    const lead = refs.findIndex((t) => t.includes(LEAD));
    const sib = refs.findIndex((t) => t.includes(SIBLING));
    expect(lead).toBeGreaterThan(-1);
    expect(sib).toBe(lead + 1);
  });

  // "Lead" is now only the first tenant entered: every one of them carries a deed.
  it('marks which applicant was entered first', async () => {
    const { rowFor } = await openList();
    expect(rowFor(LEAD)!.querySelector('.jt-lead')).toBeTruthy();
    expect(rowFor(SIBLING)!.querySelector('.jt-lead')).toBeNull();
  });

  it('says which tenant each row is', async () => {
    const { rowFor } = await openList();
    expect(rowFor(LEAD)!.textContent).toMatch(/Tenant 1 of 2/);
    expect(rowFor(SIBLING)!.textContent).toMatch(/Tenant 2 of 2/);
  });

  it('shows the share, so one rent does not read as two lets', async () => {
    const { rowFor } = await openList();
    // The rent column still states the property's rent, because that is what it
    // is — but it says what part of it this tenant carries.
    expect(rowFor(LEAD)!.textContent).toMatch(/£3,000/);
    expect(rowFor(LEAD)!.textContent).toMatch(/50% share/);
    expect(rowFor(SIBLING)!.textContent).toMatch(/50% share/);
  });

  it('counts the deeds on the heading, because there is no single one to name', async () => {
    /* This used to assert "Deed Issued" on the heading: the deed was the
       tenancy's, only the lead ever carried one, and a status pill taken from
       the lead stood for the group. Each tenant now signs their own deed once
       they have paid their own share, so the group has no one status and
       TenancyGroup no longer offers one. The honest tenancy-level fact is the
       count, and the seed pair is one deed in and one still to come. */
    const { view } = await openList();
    expect(view.container.querySelector('.jt-head')!.textContent).toMatch(/1 of 2 deeds executed/i);
  });

  it('leaves each row showing its OWN status, so the rows and the tabs agree', async () => {
    // countByStatus counts the sibling under Paid; the row must say Paid, or the
    // "Showing 22 of 22" and the status chips are describing a different list.
    const { rowFor } = await openList();
    const statusOf = (ref: string) => rowFor(ref)!.querySelector('.status-cell')!.textContent;
    expect(statusOf(LEAD)).toMatch(/Deed Issued/);
    expect(statusOf(SIBLING)).toMatch(/Paid/);
    expect(statusOf(SIBLING)).not.toMatch(/Deed Issued/);
  });

  it('leaves a sole applicant completely untouched', async () => {
    const { rowFor } = await openList();
    const solo = rowFor('GR-20418')!;
    expect(solo.classList.contains('jt-row')).toBe(false);
    expect(solo.textContent).not.toMatch(/Tenant \d of \d/);
    expect(solo.textContent).toMatch(/per month/);
  });
});

describe('the application detail page', () => {
  async function openDetail(ref: string) {
    const view = await openAt(`/applications/${ref}`);
    await waitFor(() => { if (!document.querySelector('.rec-head')) throw new Error('detail not ready'); });
    return view;
  }

  it('names the other tenant and links to them, from either sibling', async () => {
    for (const [here, there] of [[LEAD, 'Theo Brandt'], [SIBLING, 'Rosa Vance']] as const) {
      const view = await openDetail(here);
      const panel = view.container.querySelector('.jt-panel');
      expect(panel, `no panel on ${here}`).toBeTruthy();
      const link = [...panel!.querySelectorAll('a')].find((a) => (a.textContent ?? '').includes(there));
      expect(link, `${here} does not link to ${there}`).toBeTruthy();
      expect(link!.getAttribute('href')).toContain(here === LEAD ? SIBLING : LEAD);
      cleanup();
    }
  });

  it('marks this page among the tenants, so the reader knows which one they are on', async () => {
    const view = await openDetail(SIBLING);
    const me = view.container.querySelector('.jt-panel__row.is-me');
    expect(me?.textContent).toMatch(/Theo Brandt/);
    expect(me?.textContent).toMatch(/this page/i);
  });

  it('marks the lead, on the sibling’s page too', async () => {
    const view = await openDetail(SIBLING);
    const rows = [...view.container.querySelectorAll('.jt-panel__row')];
    const leadRow = rows.find((r) => r.querySelector('.jt-lead'));
    expect(leadRow?.textContent).toMatch(/Rosa Vance/);
  });

  it('shows each tenant’s share and whether they have paid', async () => {
    const view = await openDetail(LEAD);
    const panel = view.container.querySelector('.jt-panel')!;
    expect(panel.querySelectorAll('.jt-panel__row')).toHaveLength(2);
    expect(panel.textContent).toMatch(/50%/);
    expect(panel.querySelectorAll('.jt-panel__paid.is-paid')).toHaveLength(2);
    expect(panel.textContent).toMatch(/All 2 tenants have paid/i);
  });

  // Was "says the deed covers the tenancy, not this applicant", from the rule
  // that the tenancy had one deed and the lead carried it. Each tenant now signs
  // their own, covering their own share and naming everybody.
  it('says this applicant signs their own deed, naming the other tenants', async () => {
    const view = await openDetail(SIBLING);
    const deed = view.container.querySelector('.jt-panel__deed')?.textContent ?? '';
    expect(deed).toMatch(/signs their own Deed of Guarantee/i);
    expect(deed).toMatch(/names all 2 tenants/i);
  });

  it('says what the rent above is a share of', async () => {
    const view = await openDetail(LEAD);
    expect(view.container.textContent).toMatch(/is this tenant’s share/i);
  });

  it('shows no tenancy panel at all on a sole application', async () => {
    const view = await openDetail('GR-20418');
    expect(view.container.querySelector('.jt-panel')).toBeNull();
  });
});
