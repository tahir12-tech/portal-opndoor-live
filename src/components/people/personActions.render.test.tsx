/* THE ROW ACTIONS, AND THE ONE THAT IS NOT OPNDOOR'S.
 *
 * `PersonActions` opened with `if (!isAdmin) return null`, which was right
 * for everything it drew: resend, change level, position, password, reset
 * two-factor, remove and restore are all things Opndoor does to somebody.
 *
 * Notifications is not one of those. After Matt's ruling of 2026-09-30 the
 * server lets a Director change anyone at or below them in their own agency,
 * and lets everybody change their own event choices. With the early return in
 * place, a Director on the agency People tab was drawn no row actions at all,
 * so the capability existed in SQL and had no door in the product. This file
 * is that door.
 *
 * WHY THE ROW DECIDES AND NOT THIS COMPONENT. The host knows the viewer and
 * the person; `mayNotify` is the caller's `mayActOnOrEqual`, the twin of the
 * server's `caller_may_set_for`. Offering the button to somebody the server
 * will refuse is the exact failure the panel's per-section flags exist to
 * prevent, so it is refused one level earlier, here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PersonActions } from './PersonActions';

afterEach(cleanup);

const PERSON = {
  userId: 'u-1', name: 'Tom Reeve', email: 't@r.test',
  status: 'active', agencyLevel: 'Negotiator',
};

function draw(over: Partial<Parameters<typeof PersonActions>[0]> = {}) {
  render(
    <PersonActions
      person={PERSON}
      isAdmin={false}
      manyOffices={false}
      onAction={() => {}}
      onCancelInvite={() => {}}
      onChangeLevel={() => {}}
      onPosition={() => {}}
      onNotifications={() => {}}
      {...over}
    />,
  );
}
const labels = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent);

describe('a Director, who is not an Opndoor admin', () => {
  it('is offered Notifications on a person at or below them', () => {
    draw({ mayNotify: true });
    expect(labels()).toContain('Notifications');
  });

  /* THE EARLY RETURN STAYS FOR EVERYTHING ELSE. These are things Opndoor
     does to somebody, and a Director must not be handed them by accident
     while the one button is let through. */
  it('and nothing else: no Change level, no reset, no Remove access', () => {
    draw({ mayNotify: true, manyOffices: true });
    expect(labels()).toEqual(['Notifications']);
  });

  it('but is offered nothing at all on somebody above them', () => {
    draw({ mayNotify: false });
    expect(labels()).toEqual([]);
  });
});

describe('an Opndoor admin', () => {
  it('still gets the whole set, with Notifications among it', () => {
    draw({ isAdmin: true, manyOffices: true });
    expect(labels()).toContain('Notifications');
    expect(labels()).toContain('Change level');
    expect(labels()).toContain('Remove access');
  });

  /* A pending invite has never signed in, so there is nobody to email and
     nothing to set. Unchanged by the ruling, and asserted because the new
     non-admin path could easily have been written without it. */
  it('and not Notifications on a pending invite', () => {
    draw({ isAdmin: true, person: { ...PERSON, status: 'pending' } });
    expect(labels()).not.toContain('Notifications');
  });
});

describe('a screen that has not been wired', () => {
  it('draws no Notifications button rather than a dead one', () => {
    const noop = vi.fn();
    render(
      <PersonActions
        person={PERSON} isAdmin manyOffices={false}
        onAction={noop} onCancelInvite={noop} onChangeLevel={noop} onPosition={noop}
      />,
    );
    expect(labels()).not.toContain('Notifications');
  });
});
