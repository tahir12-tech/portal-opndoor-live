/* A joint tenancy, as the admin surfaces draw it.

   Two applications, one property, a deed each. The seed pair (GR-20601 Rosa
   Vance, GR-20602 Theo Brandt, tenancy ten-chalcot) carries the asymmetry
   faithfully: one is at "Deed Issued" and the other at "Paid", because each
   tenant's deed follows that tenant's own payment. Left alone that reads as two
   £3,000 lets at the same address, one of which has a deed. These lock that it
   does not.

   WHAT THE GROUP HEADING IS NOW. The property address, a small "Joint tenancy"
   tag, and the two tallies. It used to open with a tenant count the rows
   themselves make and the slogan "one tenancy, a deed each"; the rows carried
   a LEAD badge and a "Tenant 1 of 2" numbering, and every sibling repeated the
   address. Lead stopped being a customer-facing idea when the deed moved onto
   the person, and the rest was the same fact said three times. So these assert
   the absences as hard as the presences. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

/** Entry order, and nothing more: neither tenant outranks the other now. */
const FIRST = 'GR-20601';
const SECOND = 'GR-20602';
const PROP = '14 Chalcot Road';

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
  const head = () => view.container.querySelector<HTMLElement>('.jt-head')!;
  return { view, rows, rowFor, head };
}

describe('the applications list', () => {
  it('heads the group with the property, tagged as a joint tenancy', async () => {
    const { view, head } = await openList();
    expect(view.container.querySelectorAll('.jt-head')).toHaveLength(1);
    expect(head().querySelector('.jt-head__prop')!.textContent).toMatch(PROP);
    expect(head().querySelector('.jt-head__tag')!.textContent).toBe('Joint tenancy');
  });

  it('drops the wording the heading used to carry', async () => {
    // A count the two rows underneath already make, and a rule about deeds that
    // the tally now states as a fact.
    const { head } = await openList();
    expect(head().textContent).not.toMatch(/one tenancy, a deed each/i);
    expect(head().textContent).not.toMatch(/2 tenants/);
  });

  it('reads both tallies on the heading: paid, then deeds', async () => {
    /* This used to assert "Deed Issued" on the heading: the deed was the
       tenancy's, only the lead ever carried one, and a status pill taken from
       the lead stood for the group. Each tenant now signs their own deed once
       they have paid their own share, so the group has no one status. The
       honest tenancy-level facts are the two counts, and the seed pair is both
       shares settled with one deed in and one still to come. */
    const { head } = await openList();
    expect(head().querySelector('.jt-head__paid')!.textContent).toBe('2 of 2 paid');
    expect(head().querySelector('.jt-head__deeds')!.textContent).toBe('1 of 2 deeds');
  });

  it('puts the siblings next to each other, in entry order', async () => {
    const { rows } = await openList();
    const refs = rows().map((r) => r.textContent ?? '');
    const first = refs.findIndex((t) => t.includes(FIRST));
    const second = refs.findIndex((t) => t.includes(SECOND));
    expect(first).toBeGreaterThan(-1);
    expect(second).toBe(first + 1);
  });

  it('does not repeat the property on the sibling rows', async () => {
    // The address is the heading. Saying it again on both rows is what made one
    // let read as two at the same address.
    const { rowFor } = await openList();
    expect(rowFor(FIRST)!.textContent).not.toMatch(PROP);
    expect(rowFor(SECOND)!.textContent).not.toMatch(PROP);
  });

  it('leaves a sibling row carrying its name and reference, and no rank', async () => {
    const { rowFor } = await openList();
    for (const ref of [FIRST, SECOND]) {
      const row = rowFor(ref)!;
      expect(row.querySelector('.dt__name')!.textContent).toBe(ref === FIRST ? 'Rosa Vance' : 'Theo Brandt');
      expect(row.querySelector('.dt__sub')!.textContent).toBe(ref);
      expect(row.textContent).not.toMatch(/Tenant \d of \d/);
    }
  });

  it('shows no LEAD badge anywhere on the list', async () => {
    // Lead meant "carries the tenancy's one deed". With a deed each there is
    // nothing behind the badge, so it is gone rather than redefined.
    const { view } = await openList();
    expect(view.container.querySelectorAll('.jt-lead')).toHaveLength(0);
    expect(view.container.querySelector('table.dt')!.textContent).not.toMatch(/\bLead\b/);
  });

  it('shows the share, so one rent does not read as two lets', async () => {
    const { rowFor } = await openList();
    // The rent column still states the property's rent, because that is what it
    // is, but it says what part of it this tenant carries.
    expect(rowFor(FIRST)!.textContent).toMatch(/£3,000/);
    expect(rowFor(FIRST)!.textContent).toMatch(/50% share/);
    expect(rowFor(SECOND)!.textContent).toMatch(/50% share/);
  });

  it('leaves each row showing its OWN status, so the rows and the tabs agree', async () => {
    // countByStatus counts the second under Paid; the row must say Paid, or the
    // "Showing 22 of 22" and the status chips are describing a different list.
    const { rowFor } = await openList();
    const statusOf = (ref: string) => rowFor(ref)!.querySelector('.status-cell')!.textContent;
    expect(statusOf(FIRST)).toMatch(/Deed Issued/);
    expect(statusOf(SECOND)).toMatch(/Paid/);
    expect(statusOf(SECOND)).not.toMatch(/Deed Issued/);
  });

  it('draws an agency viewer the same group as an opndoor admin', async () => {
    /* "Same treatment on the admin list" means one component, and the page has
       exactly one. Nothing about the grouping reads the role: only which
       COLUMNS are drawn does, and that is the viewer's shape, not their rank.
       So this is a guard against a fork appearing, not a second design. */
    const { head } = await openList('management');
    expect(head().querySelector('.jt-head__prop')!.textContent).toMatch(PROP);
    expect(head().querySelector('.jt-head__paid')!.textContent).toBe('2 of 2 paid');
    expect(head().querySelector('.jt-head__deeds')!.textContent).toBe('1 of 2 deeds');
    expect(head().textContent).not.toMatch(/Tenant \d of \d/);
  });

  it('leaves a sole applicant completely untouched', async () => {
    const { rowFor } = await openList();
    const solo = rowFor('GR-20418')!;
    expect(solo.classList.contains('jt-row')).toBe(false);
    expect(solo.textContent).not.toMatch(/Tenant \d of \d/);
    expect(solo.textContent).toMatch(/per month/);
    // And it still states its own property: only a grouped row leaves that to
    // the heading above it.
    expect(solo.textContent).toMatch(/18 Onslow Gardens/);
  });
});

describe('the application detail page', () => {
  async function openDetail(ref: string) {
    const view = await openAt(`/applications/${ref}`);
    await waitFor(() => { if (!document.querySelector('.rec-head')) throw new Error('detail not ready'); });
    return view;
  }

  it('names the other tenant and links to them, from either sibling', async () => {
    for (const [here, there] of [[FIRST, 'Theo Brandt'], [SECOND, 'Rosa Vance']] as const) {
      const view = await openDetail(here);
      const panel = view.container.querySelector('.jt-panel');
      expect(panel, `no panel on ${here}`).toBeTruthy();
      const link = [...panel!.querySelectorAll('a')].find((a) => (a.textContent ?? '').includes(there));
      expect(link, `${here} does not link to ${there}`).toBeTruthy();
      expect(link!.getAttribute('href')).toContain(here === FIRST ? SECOND : FIRST);
      cleanup();
    }
  });

  it('marks this page among the tenants, so the reader knows which one they are on', async () => {
    const view = await openDetail(SECOND);
    const me = view.container.querySelector('.jt-panel__row.is-me');
    expect(me?.textContent).toMatch(/Theo Brandt/);
    expect(me?.textContent).toMatch(/this page/i);
  });

  /* NO "marks the lead, on the sibling's page too" ANY MORE. It asserted a
     .jt-lead badge in the tenancy panel, which is the same badge the list has
     just dropped: lead is not a customer-facing idea once every tenant signs
     for their own share. The panel's own badge is ApplicationDetail's to
     remove, and its test lives in ApplicationDetail/deedPerTenant.render.test.tsx;
     this file will not be the thing holding it in place. */

  it('shows each tenant’s share and whether they have paid', async () => {
    const view = await openDetail(FIRST);
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
    const view = await openDetail(SECOND);
    const deed = view.container.querySelector('.jt-panel__deed')?.textContent ?? '';
    expect(deed).toMatch(/signs their own Deed of Guarantee/i);
    expect(deed).toMatch(/names all 2 tenants/i);
  });

  it('says what the rent above is a share of', async () => {
    const view = await openDetail(FIRST);
    expect(view.container.textContent).toMatch(/is this tenant’s share/i);
  });

  it('shows no tenancy panel at all on a sole application', async () => {
    const view = await openDetail('GR-20418');
    expect(view.container.querySelector('.jt-panel')).toBeNull();
  });
});
