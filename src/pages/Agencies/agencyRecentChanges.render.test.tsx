/* RECENT CHANGES, ON THE AGENCY'S PAGE.
 *
 * Matt, 2026-10-01, verbatim: "Agency page: add a 'Recent changes' list like
 * the supplier's, showing every change to the agency's details, branches,
 * people's levels and commission deals in plain English, with who and when,
 * using the shared builder."
 *
 * WHERE EACH HALF IS PROVED. Which rows belong to an agency is the
 * database's and an_agency_can_see_what_changed.test.sql holds it: four
 * sources, two shapes, nobody else's rows, and the boundary. The wording is
 * changeSentence.test.ts. This is the card: that all four kinds are shown,
 * that each says who and when, and that it uses the shared builder rather
 * than a second wording of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as org from '@/data/orgService';
import type { AgencyChange } from '@/data/orgService';
import { AgencyChanges } from './AgencyChanges';

const at = (mins: number) => new Date(Date.UTC(2026, 8, 29, 12, 0) - mins * 60000);

/* ONE OF EACH KIND, in both shapes, which is the point of the card. */
const ROWS: AgencyChange[] = [
  { at: at(1), actor: 'Rosa Vance', subjectKind: 'deal', subject: null,
    action: 'commission_set', detail: 'partner 0.2500, agent 0.1000',
    field: null, oldValue: null, newValue: null },
  { at: at(2), actor: 'Rosa Vance', subjectKind: 'branch', subject: 'Chelsea',
    action: 'created', detail: 'Chelsea', field: null, oldValue: null, newValue: null },
  { at: at(3), actor: 'Nadia Shah', subjectKind: 'person', subject: 'Tom Reeve',
    action: 'position_set', detail: 'the Chelsea branch',
    field: null, oldValue: null, newValue: null },
  { at: at(4), actor: 'Nadia Shah', subjectKind: 'person', subject: 'Tom Reeve',
    action: null, detail: null, field: 'role', oldValue: 'referrer', newValue: 'management' },
  { at: at(5), actor: 'Rosa Vance', subjectKind: 'agency', subject: null,
    action: 'group_set', detail: 'Northgate', field: null, oldValue: null, newValue: null },
  { at: at(6), actor: 'Rosa Vance', subjectKind: 'deal', subject: null,
    action: 'agreement_created', detail: 'additive agreement',
    field: null, oldValue: null, newValue: null },
];

beforeEach(() => { vi.spyOn(org, 'getAgencyChanges').mockResolvedValue(ROWS); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function card(rows: AgencyChange[] = ROWS) {
  vi.spyOn(org, 'getAgencyChanges').mockResolvedValue(rows);
  const v = render(<ToastProvider><AgencyChanges agencyId="ag-1" /></ToastProvider>);
  await waitFor(() => { if ((v.container.textContent ?? '').includes('Loading')) throw new Error('nr'); });
  await act(async () => {});
  return v;
}
type View = Awaited<ReturnType<typeof card>>;
const rowsOf = (v: View) => [...v.container.querySelectorAll('.pm-audit__row')];
const said = (v: View) => rowsOf(v).map((r) => r.querySelector('.pm-audit__said')?.textContent ?? '');

describe('the card', () => {
  it('is headed the way the supplier’s is', async () => {
    expect((await card()).container.textContent).toContain('Recent changes');
  });

  /* FIVE THEN THE REST, like the supplier's. */
  it('and shows five until asked for the rest', async () => {
    const v = await card();
    expect(rowsOf(v)).toHaveLength(5);
    const more = [...v.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => /view all/i.test(b.textContent ?? ''))!;
    expect(more.textContent).toContain('6 changes');
    await act(async () => { fireEvent.click(more); });
    expect(rowsOf(v)).toHaveLength(6);
  });
});

describe('all four things Matt named', () => {
  /* THE DETAILS. */
  it('shows a change to the agency itself', async () => {
    expect(said(await card()).join(' | ')).toContain('Moved into the Northgate group');
  });
  /* THE BRANCHES. */
  it('and to a branch, saying which', async () => {
    const v = await card();
    const row = rowsOf(v).find((r) => (r.textContent ?? '').includes('Created: Chelsea'))!;
    expect(row.textContent).toContain('Branch');
    expect(row.querySelector('.agc-who')?.textContent).toBe('Chelsea');
  });
  /* THE PEOPLE'S LEVELS -- both shapes, since a position is an event and a
     level is a triple. */
  it('and a person’s position', async () => {
    expect(said(await card()).join(' | ')).toContain('Position set to the Chelsea branch');
  });
  it('and a person’s level, which arrives in the other shape entirely', async () => {
    expect(said(await card()).join(' | ')).toContain('Role changed from referrer to management');
  });
  /* THE COMMISSION DEALS. */
  /* THE SIXTH ROW, so this one opens the list first -- which is also the
     only place the "View all" button is exercised for what it reveals
     rather than for its count. */
  it('and a commission deal', async () => {
    const v = await card();
    await act(async () => {
      fireEvent.click([...v.container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => /view all/i.test(b.textContent ?? ''))!);
    });
    expect(said(v).join(' | ')).toContain('Commission deal agreed: additive agreement');
  });
});

describe('in plain English, with who and when', () => {
  /* THE SHARED BUILDER, not a second wording: the stored detail is
     "partner 0.2500, agent 0.1000" and only changeSentence turns that into
     percentages. If this card ever grew its own, this is what would fail. */
  it('so the stored rate pair reads as percentages', async () => {
    expect(said(await card()).join(' | ')).toContain('Commission set to 25% total, 10% to the agents');
  });

  it('and no raw field name or stored value survives', async () => {
    const t = (await card()).container.textContent ?? '';
    expect(t).not.toMatch(/commission_set|position_set|agreement_created|group_set/);
    expect(t).not.toMatch(/partner 0\.2500/);
  });

  it('and every row says who and when', async () => {
    const v = await card();
    const metas = rowsOf(v).map((r) => r.querySelector('.pm-audit__meta')?.textContent ?? '');
    expect(metas.every((m) => /Rosa Vance|Nadia Shah/.test(m))).toBe(true);
    /* THE SHARED DATE FORMAT, which is the other thing a second
       implementation would get subtly different. */
    expect(metas.every((m) => /\d+ Sep 2026/.test(m))).toBe(true);
  });
});

describe('an agency nothing has happened to', () => {
  /* A CARD THAT JUST STOPS READS AS BROKEN, and most agencies on a fresh
     estate have no history at all. */
  it('says what would appear here', async () => {
    const v = await card([]);
    expect(v.container.textContent).toMatch(/No changes recorded yet/);
    expect(v.container.textContent).toMatch(/people’s levels and its commission deals/);
  });
});
