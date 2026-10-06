/* "TOP 10" MEANT ONE THING ON A PAGE WHOSE CHARTS EACH HAVE A MEASURE.
 *
 * Matt, 2026-10-03, verbatim: "Reporting, 'Every customer' table: show the top
 * 10 by the chosen measure, with the search still finding any customer, and a
 * 'View all N customers' link to League with the same period and filter. Same
 * for any other list on Reporting or Home that grows with the number of
 * agencies."
 *
 * The table already showed a top ten with a search and a Show all -- that was
 * 2026-09-30's instruction -- but the ten were always the ten biggest by fees
 * collected, whichever column the reader was there for. A reader looking at
 * Deeds issued got the ten biggest by money with their deeds beside them,
 * which is not the top ten by deeds and does not say so.
 *
 * THE LEAGUE LINK FOLLOWS THE SEGMENT, and that is the one judgment call here.
 * The League has a board of agencies and a board of suppliers and no board of
 * both, so a single link from the combined table would send somebody looking
 * for a supplier to a table of agencies. The combined "All" view keeps "Show
 * all", which is the only place the two estates sit side by side and is why
 * this table exists at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomersTable } from './CustomersTable';
import { leagueLinkByRank } from '@/data/leagueLink';
import type { CustomerRow } from '@/data/liveAnalytics';

afterEach(cleanup);

/* TWELVE CUSTOMERS, so there is a ten and a remainder, and the orderings by
   fees, by referrals and by deeds are all DIFFERENT -- otherwise the test
   passes whichever measure the table actually used. `Deeds Only` is last by
   fees and first by deeds, which is the row that proves it. */
const ROWS: CustomerRow[] = [
  { key: 'agency:a:Deeds Only', name: 'Deeds Only', kind: 'agency', sent: 2, fees: 10, deeds: 99, payable: 1, agencyId: 'ag-d' },
  ...Array.from({ length: 10 }, (_, i) => ({
    key: `agency:a:Agency ${i}`, name: `Agency ${i}`, kind: 'agency' as const,
    sent: 100 - i, fees: 10_000 - i * 100, deeds: 5, payable: 500 - i, agencyId: `ag-${i}`,
  })),
  { key: 'partner:kestrel', name: 'A Supplier', kind: 'supplier', sent: 1, fees: 20, deeds: 1, payable: 2, agencyId: null },
] as CustomerRow[];

function draw(props: Partial<Parameters<typeof CustomersTable>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CustomersTable rows={ROWS} seesCommission periodId="last12m" {...props} />
    </MemoryRouter>,
  );
}

const names = (c: HTMLElement) => [...c.querySelectorAll('tbody tr td:first-child a')].map((a) => a.textContent);
const measureSel = (c: HTMLElement) => c.querySelector<HTMLSelectElement>('select[aria-label="Rank customers by"]')!;
const segment = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('.custtab__segbtn')].find((b) => b.textContent === label)!;

describe('the ten it shows', () => {
  it('are the ten biggest by fees, which is still the default', () => {
    const { container } = draw();
    expect(names(container)).toHaveLength(10);
    expect(names(container)[0]).toBe('Agency 0');
    expect(names(container)).not.toContain('Deeds Only');
    expect(container.textContent).toContain('Top 10 by fees collected');
  });

  /* THE ROW THAT PROVES THE ORDERING MOVED: last by money, first by deeds. */
  it('and the ten biggest by deeds issued when that is chosen', () => {
    const { container } = draw();
    fireEvent.change(measureSel(container), { target: { value: 'deeds' } });
    expect(names(container)[0]).toBe('Deeds Only');
    expect(container.textContent).toContain('Top 10 by deeds issued');
  });

  it('and by referrals sent', () => {
    const { container } = draw();
    fireEvent.change(measureSel(container), { target: { value: 'sent' } });
    expect(names(container)[0]).toBe('Agency 0');
    expect(container.textContent).toContain('Top 10 by referrals sent');
  });

  /* A SEARCH STILL REACHES ANYBODY, which is the half of the 2026-09-30 rule
     that must survive this one: a table that silently stops at ten is one a
     reader cannot trust for "is X in here". */
  it('while a search finds a customer outside the ten', () => {
    const { container } = draw();
    fireEvent.change(container.querySelector('#custtab-search')!, { target: { value: 'Deeds' } });
    expect(names(container)).toEqual(['Deeds Only']);
    expect(container.textContent).toContain('1 match');
  });
});

describe('the measure a reader may not see', () => {
  it('is not offered to one who may not see commission', () => {
    const { container } = draw({ seesCommission: false });
    const opts = [...measureSel(container).options].map((o) => o.value);
    expect(opts).not.toContain('payable');
    expect(opts).toEqual(['fees', 'sent', 'deeds']);
  });

  it('and is offered to one who may', () => {
    const { container } = draw();
    expect([...measureSel(container).options].map((o) => o.value)).toContain('payable');
  });
});

describe('the League link', () => {
  it('opens the Agencies board on the same period and measure', () => {
    const { container } = draw();
    fireEvent.click(segment(container, 'Agencies'));
    const foot = container.querySelector('.custtab__foot') as HTMLElement;
    const link = within(foot).getByRole('link', { name: /View all 11 agencies/ });
    expect(link.getAttribute('href')).toBe(leagueLinkByRank('agency', 'last12m', 'fees'));
  });

  it('and carries the chosen measure as the League’s own column', () => {
    const { container } = draw();
    fireEvent.click(segment(container, 'Agencies'));
    fireEvent.change(measureSel(container), { target: { value: 'deeds' } });
    const foot = container.querySelector('.custtab__foot') as HTMLElement;
    expect(within(foot).getByRole('link').getAttribute('href'))
      .toBe(leagueLinkByRank('agency', 'last12m', 'deed'));
  });

  /* THE COMBINED VIEW HAS NOWHERE TO SEND ANYBODY, so it does not pretend
     to. Show all is the answer there, and it is still offered. */
  it('and is absent on the combined view, which keeps Show all', () => {
    const { container, getByRole } = draw();
    const foot = container.querySelector('.custtab__foot') as HTMLElement;
    expect(within(foot).queryByRole('link')).toBeNull();
    getByRole('button', { name: 'Show all' });
  });

  it('and absent with no period to carry', () => {
    const { container } = draw({ periodId: undefined });
    fireEvent.click(segment(container, 'Agencies'));
    const foot = container.querySelector('.custtab__foot') as HTMLElement;
    expect(within(foot).queryByRole('link')).toBeNull();
  });
});

describe('Show all', () => {
  it('still opens the rest, and names the measure it is ordered by', () => {
    const { container, getByRole } = draw();
    fireEvent.change(measureSel(container), { target: { value: 'deeds' } });
    fireEvent.click(getByRole('button', { name: 'Show all' }));
    expect(names(container)).toHaveLength(12);
    expect(container.textContent).toContain('All 12, biggest first by deeds issued');
  });
});
