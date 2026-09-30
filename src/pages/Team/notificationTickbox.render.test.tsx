/* THE SETTING HAS TO BE REACHABLE WHERE THE PERSON IS.
 *
 * The rule for who may change somebody's notifications was built in SQL (an
 * Opndoor admin, or an agency's own Director, for people at or below them),
 * and the control was put on ONE screen: the agency People tab, which only
 * Opndoor admin reaches. So for an agency's own Director the setting existed
 * and was unreachable. A permission with no control is not a feature. That is
 * the property this file protects, and it is unchanged.
 *
 * WHAT CHANGED, 2026-09-30. The control was a loose "Receives notifications"
 * tickbox in its own column. Matt's ruling made notifications per person and
 * put all three settings on one panel, so the row now opens that panel
 * instead of toggling a third of it in place. The assertions below follow the
 * control to its new shape; two are rewritten rather than deleted because the
 * property they check still holds:
 *
 *   "is on the screen for a Director"            -> still, as a button
 *   "is there for a Manager too"                 -> still, as a button
 *   "not drawn on a row the viewer may not act on" -> unchanged in meaning
 *   "is nowhere for a Negotiator"                -> unchanged (no Team screen)
 *   "sends the person and the new value"         -> now: opens THAT person's
 *                                                   panel. The write moved
 *                                                   into the panel and is
 *                                                   asserted there.
 *
 * And one is DELETED rather than rewritten: "states the reason on a
 * Negotiator row instead of drawing a tickbox". That cell said a Negotiator
 * had nothing to widen. The resolver in 20261006160000 disagrees -- its
 * `copies` arm does not filter on role, so a ticked Negotiator whose branch
 * scope covers the referral IS copied. The old copy was wrong about the
 * server; a Negotiator gets the same panel as anybody else, which is what the
 * replacement assertion below says.
 *
 * WHAT IT DOES NOT ASSERT. That the setting makes the deed arrive: that is a
 * server rule and lives in pgTAP, in
 * supabase/tests/the_ticked_user_gets_the_deed.test.sql, where a real ladder
 * is resolved against a real application.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
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
     all and would pass for the wrong reason whatever the control did. */
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

/** Every Notifications control on the page. */
const controls = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('.tm-person button')]
    .filter((el) => el.textContent === 'Notifications');

describe('the Notifications control on Team', () => {
  it('is on the screen for a Director', async () => {
    const v = await openTeam('management', true);
    expect(controls(v).length).toBeGreaterThan(0);
  });

  it('is there for a Manager too, who may set it for people below them', async () => {
    const v = await openTeam('management', false);
    expect(controls(v).length).toBeGreaterThan(0);
  });

  /* THE ROWS IT IS NOT ON. The server refuses somebody above the caller, so
     drawing a control there would be a button that always errors. `mayTick`
     is at-or-below, the client twin of caller_may_set_for, rather than a
     second rule the SQL does not share. */
  it('is not drawn on a row the viewer may not act on', async () => {
    const v = await openTeam('management', false);
    const rows = [...v.container.querySelectorAll('.tm-person')];
    const withControl = rows.filter((r) =>
      [...r.querySelectorAll('button')].some((b) => b.textContent === 'Notifications'));
    // A Manager cannot act on a Director, so at least one row must be bare.
    expect(withControl.length).toBeLessThan(rows.length);
  });

  it('is nowhere for a Negotiator, who has no Team screen at all', async () => {
    const v = await openTeam('referrer');
    expect(controls(v).length).toBe(0);
  });

  /* A NEGOTIATOR'S ROW GETS THE SAME PANEL. It used to say "Own referrals"
     and draw nothing, on the reasoning that there was no position to widen.
     The deed resolver copies anybody ticked whose scope covers the referral
     and does not filter on role, so that was never true; and the panel also
     carries the event choices, which are a Negotiator's own to make. */
  it('is drawn on an active Negotiator row like any other', async () => {
    const v = await openTeam('management', true);
    const has = (r: Element) =>
      [...r.querySelectorAll('button')].some((b) => b.textContent === 'Notifications');
    const negRows = [...v.container.querySelectorAll('.tm-person')]
      .filter((r) => r.querySelector('.role-tag')?.textContent === 'Negotiator');
    const active = negRows.filter((r) => r.querySelector('.pill')?.textContent === 'Active');
    const invited = negRows.filter((r) => r.querySelector('.pill')?.textContent === 'Invited');
    // If the fixture ever stops containing either, this must fail rather than
    // pass vacuously over an empty list.
    expect(active.length).toBeGreaterThan(0);
    expect(invited.length).toBeGreaterThan(0);
    for (const r of active) expect(has(r)).toBe(true);
    /* AND NOT ON AN INVITATION. They have never signed in, so there are no
       settings to hold and no address the panel could change anything for. */
    for (const r of invited) expect(has(r)).toBe(false);
  });

  /* AND IT ACTUALLY OPENS, FOR THAT PERSON. Every assertion above is about
     whether the control is DRAWN. A control that renders correctly and is
     wired to nothing passes all of them, which is the gap this closes: the
     click must open the panel naming the person on that row. What the panel
     then writes is asserted in its own tests and in SQL. */
  it('opens the panel for the person on that row', async () => {
    const v = await openTeam('management', true);
    const row = [...v.container.querySelectorAll('.tm-person')]
      .find((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === 'Notifications'))!;
    const name = row.querySelector('.tm-person__name')?.textContent?.replace(/You$/, '').trim();
    expect(name).toBeTruthy();
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Notifications')!;
    await act(async () => { btn.click(); });
    await waitFor(() => {
      if (!document.body.textContent?.includes(`Notifications for ${name}`)) throw new Error('panel not open');
    });
  });
});
