/* THE MONTH AS A LIST OF PAYEES.

   The panel stacked every payee's full table down one page. On a book with
   thirty agencies that is thirty tables, and finding one meant scrolling past
   twenty-nine; there was no way to see who was owed the most, and no way to
   take the month away in one file.

   And one of those tables was always "Unattached", the placeholder agency the
   direct route hangs off: a statement for a party that is not a party, about
   money that does not exist.

   ONE PAYEE STILL NEEDS NO LIST. The agency's Commission tab passes orgId and
   gets the statement itself, which is what a link from that tab must land on. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CommissionStatement } from './CommissionStatement';
import { ALL_PARTNERS } from '@/data';

const MONTH = { key: '2026-05', label: 'May 2026' };

function line(ref: string, commission: number) {
  return {
    ref, tenant: `Tenant ${ref}`, branch: 'Hampstead', tenancyPlace: null,
    sharePercent: null, paidAt: new Date('2026-05-12T00:00:00Z'),
    fee: 1500, rate: 0.2, source: 'agreement' as const, commission,
  };
}
function statement(payeeKey: string, payeeName: string, total: number, lines: number, level: 'agency' | 'group' | 'branch' = 'agency') {
  return {
    monthKey: MONTH.key, monthLabel: MONTH.label, payeeKey, level,
    orgId: `org-${payeeKey}`, payeeName,
    lines: Array.from({ length: lines }, (_, i) => line(`GR-${payeeKey}-${i}`, total / Math.max(lines, 1))),
    total,
  };
}

/* Deliberately out of order by total, so "sorted by total" is a real
   assertion rather than an accident of the fixture. Unattached carries no
   commission, which is the whole reason it must not be listed. */
const STATEMENTS = [
  statement('kestrel', 'Kestrel Lettings', 400, 2),
  statement('unattached', 'Unattached', 0, 0),
  statement('regent', "Regent's Lettings", 1200, 3),
  statement('northgate', 'Northgate Lettings', 800, 1),
];

const downloaded: { csv: string; name: string }[] = [];

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    statementMonths: () => [MONTH],
    getCommissionStatements: () => STATEMENTS,
    buildAllStatementsCsv: () => ({ csv: 'payee,total\n', filename: 'opndoor-commission-statements-2026-05.csv' }),
    downloadCsv: (csv: string, name: string) => { downloaded.push({ csv, name }); },
    buildCommissionStatementDoc: async () => ({ blocks: [] }),
    exportBranded: async () => {},
  };
});

const view = (orgId?: string) =>
  render(<CommissionStatement role="superadmin" scope={ALL_PARTNERS} orgId={orgId} />);

type View = ReturnType<typeof view>;
const payeeNames = (v: View) =>
  [...v.container.querySelectorAll('.stmt-list__name')].map((el) => (el.textContent ?? '').trim());

afterEach(() => { cleanup(); downloaded.length = 0; });

describe('the payee list', () => {
  it('lists the month\'s payees, biggest first', () => {
    const v = view();
    expect(payeeNames(v)).toEqual(["Regent's Lettings", 'Northgate Lettings', 'Kestrel Lettings']);
  });

  /* THE ROW THAT GOES. Unattached is the direct route's placeholder and earns
     nobody anything; it had a heading, a table and a zero total every month. */
  it('leaves out a party with no commission', () => {
    const v = view();
    expect(payeeNames(v)).not.toContain('Unattached');
    expect(v.container.textContent).not.toContain('Unattached');
  });

  it('gives each payee its level, its application count and its total', () => {
    const v = view();
    const row = [...v.container.querySelectorAll('tbody tr')]
      .find((tr) => (tr.textContent ?? '').includes("Regent's Lettings"))!;
    const cells = [...row.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim());
    expect(cells[1]).toBe('Agency');
    expect(cells[2]).toBe('3');
    expect(cells[3]).toBe('£1,200.00');
  });

  it('searches by payee', () => {
    const v = view();
    fireEvent.change(v.container.querySelector('.stmt-list__q')!, { target: { value: 'regent' } });
    expect(payeeNames(v)).toEqual(["Regent's Lettings"]);
  });

  it('says so rather than going blank when a search matches nothing', () => {
    const v = view();
    fireEvent.change(v.container.querySelector('.stmt-list__q')!, { target: { value: 'zzz' } });
    expect(v.container.textContent).toContain('No payee matches that search');
  });
});

describe('opening one payee', () => {
  it('opens that payee\'s statement, and comes back to the list', () => {
    const v = view();
    fireEvent.click([...v.container.querySelectorAll('.stmt-list__name')]
      .find((el) => (el.textContent ?? '').includes('Regent'))!);
    // The statement itself: its own lines, not the list.
    expect(v.container.querySelector('.stmt-list')).toBeNull();
    expect(v.container.querySelector('.stmt__payee')!.textContent).toBe("Regent's Lettings");

    fireEvent.click(v.getByText('All payees'));
    expect(v.container.querySelector('.stmt-list')).toBeTruthy();
  });
});

describe('one payee needs no list', () => {
  /* What the agency's Commission tab passes, and what a link from it must land
     on: the statement, not a list of one. */
  it('renders the statement directly when narrowed to one org', () => {
    const v = view('org-regent');
    expect(v.container.querySelector('.stmt-list')).toBeNull();
    expect(v.container.querySelector('.stmt__payee')!.textContent).toBe("Regent's Lettings");
    // And no way back to a list that was never shown.
    expect(v.queryByText('All payees')).toBeNull();
  });
});

describe('Export all', () => {
  it('takes the whole month in one file', () => {
    const v = view();
    fireEvent.click(v.getByText('Export all'));
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0].name).toBe('opndoor-commission-statements-2026-05.csv');
  });

  /* Not on a single payee's statement: that reader already has the per-payee
     Export beside the total, and "all" of one is the same file twice. */
  it('is not offered when the panel is showing one payee', () => {
    const v = view('org-regent');
    expect(v.queryByText('Export all')).toBeNull();
  });
});
