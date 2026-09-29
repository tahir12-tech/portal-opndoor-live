/* THE POSITION MODAL SAYS WHAT THE DATABASE ACTUALLY DOES.
 *
 * Round 5, M12. Two controls, both describing a model that does not exist:
 *
 *   "Add position", over a LIST of held positions. There is no insert policy on
 *   user_scopes; positions are granted only through set_user_scope, which
 *   REPLACES. So nobody has ever held two, the list can never have a second
 *   row, and pressing Add silently deleted the position the person already
 *   had. The word and the list both promise accumulation and the write is a
 *   swap.
 *
 *   "Remove", offered on every row. The deferred constraint from
 *   20261006300000 refuses to leave an active person on our estate with no
 *   position, so Remove on the only position of an active person ALWAYS errors.
 *   It is offered exactly in the case where it cannot work.
 *
 * supabase/tests/the_work_still_works.test.sql already pins the real rule --
 * "Remove position succeeds in exactly one case: after they are deactivated" --
 * and this is the screen agreeing with it.
 *
 * ALL FOUR ASSERTIONS FAIL against the modal as it was: it said "Add position"
 * unconditionally and enabled Remove for anybody.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as positions from '@/data/positionsService';
import { PositionModal } from './PositionModal';
import type { ManagedUser } from '@/data/usersService';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const TARGETS = [
  { id: 'br-1', name: 'ZZZ Office', kind: 'branch' as const },
  { id: 'ag-1', name: 'ZZZ Agency', kind: 'agency' as const },
];

const person = (over: Partial<ManagedUser> = {}): ManagedUser => ({
  id: 'u1', name: 'Rosa Bell', email: 'rosa@zzz.test', role: 'management',
  lastActive: 'today', status: 'active', partner: 'opndoor-agents', ...over,
} as ManagedUser);

async function open(user: ManagedUser, held: positions.Position[]) {
  vi.spyOn(positions, 'getPositions').mockResolvedValue(held as never);
  const view = render(
    <ToastProvider>
      <PositionModal user={user} targets={TARGETS} onClose={() => {}} onSaved={() => {}} />
    </ToastProvider>,
  );
  // The modal loads positions asynchronously and renders "Loading…" until then.
  await waitFor(() => { if (/Loading/.test(document.body.textContent ?? '')) throw new Error('still loading'); });
  await act(async () => {});
  return view;
}

const HELD: positions.Position[] = [
  { id: 'p1', kind: 'agency', targetId: 'ag-1', targetName: 'ZZZ Agency' } as never,
];

const button = (re: RegExp) =>
  [...document.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));

describe('the position modal', () => {
  /* IT REPLACES, SO IT MUST NOT SAY ADD. */
  it('offers to MOVE the position of somebody who already holds one', async () => {
    await open(person(), HELD);
    expect(button(/add position/i)).toBeUndefined();
    expect(button(/move position/i)).toBeTruthy();
  });

  it('still offers to SET one for somebody who holds none', async () => {
    await open(person({ role: 'referrer' }), []);
    expect(button(/set position/i)).toBeTruthy();
  });

  it('says out loud that a person holds one position, so the swap is not a surprise', async () => {
    await open(person(), HELD);
    expect(document.body.textContent ?? '').toMatch(/holds one position/i);
  });

  /* AND REMOVE IS OFFERED ONLY WHERE IT CAN SUCCEED. */
  it('does not let Remove be pressed for an ACTIVE person, where the constraint refuses it', async () => {
    await open(person(), HELD);
    const remove = button(/^remove$/i);
    expect(remove).toBeTruthy();
    expect(remove!.hasAttribute('disabled')).toBe(true);
    expect(document.body.textContent ?? '').toMatch(/deactivat/i);
  });

  it('lets Remove be pressed once they are deactivated, which is the case that works', async () => {
    await open(person({ status: 'deactivated' }), HELD);
    expect(button(/^remove$/i)!.hasAttribute('disabled')).toBe(false);
  });
});
