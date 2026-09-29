/* WALK FIX 13. AN INVITE ASKS WHERE THEY SIT, AND PLACES THEM IN ONE STEP.
 *
 * Matt, walking dev: "Inviting someone to an agency fails: 'Everybody on our
 * estate holds a position... jane@jane.com has none'. The rule that every
 * agency person holds a position is right, but the invite form never asks for
 * one and tells you to set it afterwards, so the invite is refused. Fix: the
 * invite form asks where they sit (branch, brand or whole agency, depending on
 * level) and the position is created with the invite in one step. If the
 * agency has only one branch, pick it automatically and don't ask. Add a
 * functional test inviting each level to a one-branch and a multi-branch
 * agency."
 *
 * WHERE THE CONTRADICTION IS. InviteToLevel says, in its own comment:
 *
 *     A Negotiator invited from the People tab gets neither a scope nor a
 *     branch, lands unplaced, and the admin sets where they sit with Position
 *     on their row, which is what the dialog's closing line tells them to do.
 *
 * That was a coherent design until 20261006300000 made an unpositioned active
 * person a constraint violation. The dialog still plans to place them
 * afterwards; the database refuses to create them at all. So the screen tells
 * the admin to do something the server has already refused, and the invite
 * dies with a sentence about "our estate" that means nothing to them.
 *
 * THE ASSERTION THAT MATTERS is what reaches inviteUser. A test that only
 * looked for a control on the page would pass while the dialog still dropped
 * the value on the floor -- which, per the sibling test on the Users screen,
 * is exactly how this class of bug ships.
 *
 * THE ONE-BRANCH CASE IS TWO ASSERTIONS, not one. It must place them, AND it
 * must not ask. Implemented carelessly it renders an empty or single-option
 * picker, which still "works" and still puts a pointless question in front of
 * somebody every single time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import { hydrateOrg } from '@/data';
import * as users from '@/data/usersService';
import { InviteToLevel, type InviteContext } from './InviteToLevel';

const ESTATE = 'opndoor-agents';
const MANY = 'ag-many';
const ONE = 'ag-one';

beforeEach(() => {
  hydrateOrg([
    {
      id: MANY, partner: ESTATE, name: 'ZZZ Many Branch Agency', referrals: 0, guaranteed: '0',
      branches: [
        { id: 'br-north', name: 'Northgate', referrals: 0, guaranteed: '0' },
        { id: 'br-south', name: 'Southbank', referrals: 0, guaranteed: '0' },
      ],
    },
    {
      id: ONE, partner: ESTATE, name: 'ZZZ One Branch Agency', referrals: 0, guaranteed: '0',
      branches: [{ id: 'br-only', name: 'The Only Office', referrals: 0, guaranteed: '0' }],
    },
  ] as never[]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function open(agencyId: string, name: string) {
  const sent = vi.spyOn(users, 'inviteUser').mockResolvedValue({ ok: true } as never);
  const ctx: InviteContext = {
    level: 'brand', partner: ESTATE, name, agencyId, chooseLevel: true,
  };
  const view = render(
    <ToastProvider>
      <InviteToLevel ctx={ctx} onClose={() => {}} onInvited={() => {}} />
    </ToastProvider>,
  );
  return { view, sent };
}

const sel = (v: ReturnType<typeof render>, label: string) =>
  document.body.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);

/** The level is chosen from three clickable options, not a select. */
async function pickLevel(v: ReturnType<typeof render>, level: string) {
  const opt = [...document.body.querySelectorAll<HTMLElement>('.roleopt')]
    .find((l) => l.querySelector('.roleopt__name')?.textContent?.trim() === level);
  if (!opt) throw new Error(`no level option "${level}"`);
  await act(async () => { fireEvent.click(opt); });
}

async function fillAndSend(v: ReturnType<typeof render>, level: string, branch?: string) {
  await pickLevel(v, level);
  if (branch) {
    const where = sel(v, 'Where they sit');
    if (!where) throw new Error('no "Where they sit" control to choose a branch in');
    await act(async () => { fireEvent.change(where, { target: { value: branch } }); });
  }
  const inputs = [...document.body.querySelectorAll('input')];
  const byPlaceholderOrType = (t: string) => inputs.find((i) => i.type === t) ?? inputs[0];
  await act(async () => {
    fireEvent.change(inputs[0], { target: { value: 'Jane' } });
    fireEvent.change(inputs[1], { target: { value: 'Doe' } });
    fireEvent.change(byPlaceholderOrType('email'), { target: { value: 'jane@jane.com' } });
  });
  const send = [...document.body.querySelectorAll('button')]
    .find((b) => /invite|send/i.test(b.textContent ?? '') && !b.disabled);
  if (!send) throw new Error('no enabled send button');
  await act(async () => { fireEvent.click(send); });
}

describe('a MULTI-branch agency', () => {
  it('asks a Negotiator where they sit, rather than refusing afterwards', async () => {
    const { view } = open(MANY, 'ZZZ Many Branch Agency');
    await pickLevel(view, 'Negotiator');
    expect(sel(view, 'Where they sit'), 'the dialog never asks where the negotiator sits').toBeTruthy();
  });

  it('and sends that branch as their position, in the same step as the invite', async () => {
    const { view, sent } = open(MANY, 'ZZZ Many Branch Agency');
    await fillAndSend(view, 'Negotiator', 'br-south');
    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0][0]).toMatchObject({ scopeKind: 'branch', scopeTarget: 'br-south' });
  });

  it('places a Manager too, so nobody on the estate is created unpositioned', async () => {
    const { view, sent } = open(MANY, 'ZZZ Many Branch Agency');
    await fillAndSend(view, 'Manager', 'br-north');
    await waitFor(() => expect(sent).toHaveBeenCalled());
    const arg = sent.mock.calls[0][0] as { scopeKind?: string };
    expect(arg.scopeKind, 'a Manager was invited with no position').toBeTruthy();
  });

  it('and a Director', async () => {
    const { view, sent } = open(MANY, 'ZZZ Many Branch Agency');
    await fillAndSend(view, 'Director');
    await waitFor(() => expect(sent).toHaveBeenCalled());
    const arg = sent.mock.calls[0][0] as { scopeKind?: string };
    expect(arg.scopeKind, 'a Director was invited with no position').toBeTruthy();
  });
});

describe('a ONE-branch agency', () => {
  /* Matt's words: "If the agency has only one branch, pick it automatically
     and don't ask." Both halves, because the easy implementation satisfies
     only the first. */
  it('does not ask, because there is only one answer', async () => {
    const { view } = open(ONE, 'ZZZ One Branch Agency');
    await pickLevel(view, 'Negotiator');
    expect(sel(view, 'Where they sit'), 'asked a question with one possible answer').toBeNull();
  });

  it('and places the negotiator at that one branch anyway', async () => {
    const { view, sent } = open(ONE, 'ZZZ One Branch Agency');
    await fillAndSend(view, 'Negotiator');
    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0][0]).toMatchObject({ scopeKind: 'branch', scopeTarget: 'br-only' });
  });

  it('and a Manager', async () => {
    const { view, sent } = open(ONE, 'ZZZ One Branch Agency');
    await fillAndSend(view, 'Manager');
    await waitFor(() => expect(sent).toHaveBeenCalled());
    const arg = sent.mock.calls[0][0] as { scopeKind?: string };
    expect(arg.scopeKind).toBeTruthy();
  });

  it('and a Director', async () => {
    const { view, sent } = open(ONE, 'ZZZ One Branch Agency');
    await fillAndSend(view, 'Director');
    await waitFor(() => expect(sent).toHaveBeenCalled());
    const arg = sent.mock.calls[0][0] as { scopeKind?: string };
    expect(arg.scopeKind).toBeTruthy();
  });
});
