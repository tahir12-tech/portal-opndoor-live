/* THE TICKBOX HAS TO EXIST WHERE THE PERSON IS.
 *
 * "Receives notifications" decides who is copied on every per-application
 * notification, the executed deed included. The rule for who may set it was
 * built in SQL (set_receives_notifications: an Opndoor admin, or an agency's
 * own Directors and Managers, for people at or below their own position), and
 * the control was put on ONE screen: the agency People tab, which only
 * Opndoor admin reaches.
 *
 * So for an agency's own Director the setting existed and was unreachable.
 * They could be told the rule and had no way to apply it. A permission with
 * no control is not a feature.
 *
 * This asserts the Team-side control: present for a Director, present for a
 * Manager, on the rows they may act on and not on the rows they may not, and
 * absent entirely for a Negotiator (who has no team screen at all).
 *
 * WHAT IT DOES NOT ASSERT. That ticking it makes the deed arrive: that is a
 * server rule and lives in pgTAP, in
 * supabase/tests/the_ticked_user_gets_the_deed.test.sql, where a real ladder
 * is resolved against a real application. A render test that mocked its way
 * to an email would be asserting the mock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import * as positionsService from '@/data/positionsService';
import { hydrateCommissionVisibility } from '@/data';
import { App } from '@/App';

afterEach(() => { cleanup(); hydrateCommissionVisibility(true); vi.restoreAllMocks(); });

async function openTeam(role: 'management' | 'referrer', director = true) {
  localStorage.setItem('grp_role', role);
  hydrateCommissionVisibility(director);
  const view = render(
    <MemoryRouter initialEntries={['/team']}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
  /* THE GROUPS OPEN CLOSED. Team collapses every block until the heading is
     clicked or a filter is typed, so a test that only waits sees no rows at
     all and would pass for the wrong reason whatever the tickbox did. */
  // A Negotiator has no Team screen at all, so there is nothing to expand and
  // waiting for a group would fail the case that is asserting its absence.
  if (role !== 'referrer') {
    await waitFor(() => { if (!view.container.querySelector('.tm-group')) throw new Error('no groups yet'); });
  }
  for (const b of [...view.container.querySelectorAll('.tm-group')]) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { (b as HTMLButtonElement).click(); });
  }
  return view;
}

/** Every notification tickbox on the page, by its stable aria-label prefix. */
const ticks = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('input[type="checkbox"]')]
    .filter((el) => (el.getAttribute('aria-label') ?? '').startsWith('Receives notifications'));

describe('the Receives notifications tickbox on Team', () => {
  it('is on the screen for a Director', async () => {
    const v = await openTeam('management', true);
    expect(ticks(v).length).toBeGreaterThan(0);
  });

  it('says what it does, once, above the list rather than in every row', async () => {
    const v = await openTeam('management', true);
    // The shared sentence from positionsService, so Team and the agency People
    // tab cannot describe the same setting differently.
    expect(v.container.textContent ?? '').toMatch(/copied on every referral within the position they already hold/i);
  });

  it('is there for a Manager too, who may set it for people below them', async () => {
    const v = await openTeam('management', false);
    expect(ticks(v).length).toBeGreaterThan(0);
  });

  /* THE ROWS IT IS NOT ON. set_receives_notifications refuses somebody above
     the caller, so drawing a control there would be a button that always
     errors. `may` is already how this row decides its other actions, and this
     follows it rather than inventing a second rule the SQL does not share. */
  it('is not drawn on a row the viewer may not act on', async () => {
    const v = await openTeam('management', false);
    const rows = [...v.container.querySelectorAll('.tm-person')];
    const withTick = rows.filter((r) =>
      [...r.querySelectorAll('input[type="checkbox"]')]
        .some((el) => (el.getAttribute('aria-label') ?? '').startsWith('Receives notifications')));
    // A Manager cannot act on a Director, so at least one row must be bare.
    expect(withTick.length).toBeLessThan(rows.length);
  });

  it('is nowhere for a Negotiator, who has no Team screen at all', async () => {
    const v = await openTeam('referrer');
    expect(ticks(v).length).toBe(0);
  });

  /* A NEGOTIATOR'S ROW SAYS WHY, RATHER THAN SHOWING A DEAD CONTROL.
     "Receives notifications" widens somebody to their whole position. A
     Negotiator's position IS their own referrals, so there is nothing to
     widen and the tickbox would do nothing whichever way it was set. An
     always-inert control reads as a broken one, so the cell states the
     reason instead. */
  it('states the reason on a Negotiator row instead of drawing a tickbox', async () => {
    const v = await openTeam('management', true);
    const negRows = [...v.container.querySelectorAll('.tm-person')]
      .filter((r) => r.querySelector('.role-tag')?.textContent === 'Negotiator');
    // If the fixture ever stops containing one, this must fail rather than
    // pass vacuously over an empty list.
    expect(negRows.length).toBeGreaterThan(0);
    for (const r of negRows) {
      expect(r.querySelector('.tm-person__notify')?.textContent).toMatch(/Own referrals/i);
      expect(r.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    }
  });

  /* AND TICKING IT ACTUALLY WRITES. Every assertion above is about whether the
     control is DRAWN. A control that renders correctly and is wired to
     nothing passes all five, which is the gap this closes: the click must
     reach set_receives_notifications with that person and the new value.
     What the server then does with it is asserted in SQL, not here. */
  it('sends the person and the new value to the server when it is ticked', async () => {
    const spy = vi.spyOn(positionsService, 'setReceivesNotifications');
    const v = await openTeam('management', true);
    const box = ticks(v)[0] as HTMLInputElement;
    expect(box).toBeTruthy();
    const wasOn = box.checked;
    await act(async () => { fireEvent.click(box); });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [userId, next] = spy.mock.calls.at(-1)!;
    expect(typeof userId).toBe('string');
    expect(userId.length).toBeGreaterThan(0);
    // The value sent is the OPPOSITE of what the row showed, not a constant.
    expect(next).toBe(!wasOn);
  });
});
