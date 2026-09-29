/* THE MATRIX DRAWS WHAT THE SERVER SAYS EXISTS.
 *
 * Q-03: "Each supplier and each agency has a matrix: notification types
 * against recipients, each on or off... Not switchable, and shown as locked
 * with the reason."
 *
 * THE POINT OF THE TEST is that the screen holds no list of its own. Which
 * types exist, which recipient classes exist for THIS kind of party, which
 * cells are locked and what the current value is all come back from
 * `notification_matrix`. A component with its own copy of the type list would
 * eventually draw a switch that does nothing -- which is exactly the defect
 * that put "Add position" over a list that could never have a second row.
 *
 * So the service is mocked and the component is asserted to render the
 * server's answer, including a shape the current server never returns (a
 * fourth type, a class that is not in the other party's list), because that is
 * how you tell a component that reads its input from one that has memorised
 * the answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as svc from '@/data/notificationMatrixService';
import { NotificationMatrix } from './NotificationMatrix';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cell = (
  t: string, tl: string, to: number, r: string, rl: string, ro: number,
  over: Partial<svc.MatrixCell> = {},
): svc.MatrixCell => ({
  notificationType: t, typeLabel: tl, typeOrd: to,
  recipient: r, recipientLabel: rl, recipientOrd: ro,
  enabled: true, isDefault: true, locked: false, ...over,
});

/* A shape the real server does not return: two types, one of them with a
   recipient class the other does not have, and a locked cell. If the
   component renders this faithfully it is reading its input. */
const SUPPLIER: svc.MatrixCell[] = [
  cell('sent', 'Sent for referencing', 1, 'referrer', 'The referrer', 1),
  cell('sent', 'Sent for referencing', 1, 'agent_contact', 'The branch agent contact', 2, { enabled: false }),
  cell('deed_issued', 'Deed issued', 6, 'referrer', 'The referrer', 1),
  cell('deed_issued', 'Deed issued', 6, 'agent_contact', 'The branch agent contact', 2, { locked: true }),
];

async function show(cells: svc.MatrixCell[], mayEdit = true) {
  vi.spyOn(svc, 'getNotificationMatrix').mockResolvedValue(cells);
  vi.spyOn(svc, 'mayEditNotificationMatrix').mockResolvedValue(mayEdit);
  const view = render(
    <ToastProvider><NotificationMatrix party={{ partnerId: 'p-1' }} /></ToastProvider>,
  );
  await waitFor(() => { if (!document.querySelector('.nm-grid')) throw new Error('not drawn yet'); });
  await act(async () => {});
  return view;
}

const box = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe('the notification matrix', () => {
  it('draws a row per type and a column per class the server returned', async () => {
    await show(SUPPLIER);
    const heads = [...document.querySelectorAll('.nm-grid thead th')].map((t) => t.textContent);
    expect(heads).toEqual(['When this happens', 'The referrer', 'The branch agent contact']);
    const rows = [...document.querySelectorAll('.nm-grid tbody tr th')].map((t) => t.textContent);
    expect(rows).toEqual(['Sent for referencing', 'Deed issued']);
  });

  it('shows each cell at the value the server gave it', async () => {
    await show(SUPPLIER);
    expect(box('Sent for referencing: The referrer')!.checked).toBe(true);
    expect(box('Sent for referencing: The branch agent contact')!.checked).toBe(false);
  });

  /* THE LOCKED CELL. Not a ticked checkbox, and not a disabled one either: a
     control that cannot be operated should not look like a control. */
  it('draws a locked cell as a statement, with the reason on it', async () => {
    await show(SUPPLIER);
    expect(box('Deed issued: The branch agent contact')).toBeNull();
    const locked = document.querySelector('.nm-locked');
    expect(locked).toBeTruthy();
    expect(locked!.getAttribute('title')).toMatch(/cannot be turned off/i);
    expect(document.querySelector('[aria-label="Deed issued: The branch agent contact (always on)"]')).toBeTruthy();
  });

  /* THE ASSERTION THE FEATURE IS. A grid that rendered and wrote nothing would
     satisfy everything above. */
  it('writes a change through set_notification_setting, with the cell it changed', async () => {
    const set = vi.spyOn(svc, 'setNotificationSetting').mockResolvedValue(undefined);
    await show(SUPPLIER);
    await act(async () => { fireEvent.click(box('Sent for referencing: The branch agent contact')!); });
    await waitFor(() => expect(set).toHaveBeenCalled());
    const [party, type, recipient, enabled] = set.mock.calls.at(-1)!;
    expect(party).toEqual({ partnerId: 'p-1' });
    expect(type).toBe('sent');
    expect(recipient).toBe('agent_contact');
    expect(enabled).toBe(true);
  });

  /* AND THE SERVER IS STILL THE RULE. An optimistic flip that the server
     refuses has to go back, or the screen quietly disagrees with the database
     about who is being emailed. */
  it('puts the cell back when the server refuses', async () => {
    vi.spyOn(svc, 'setNotificationSetting').mockRejectedValue(new Error('not permitted'));
    await show(SUPPLIER);
    const b = box('Sent for referencing: The referrer')!;
    expect(b.checked).toBe(true);
    await act(async () => { fireEvent.click(b); });
    await waitFor(() => expect(box('Sent for referencing: The referrer')!.checked).toBe(true));
  });

  /* READ-ONLY IS A STATE, not twenty controls that each refuse. */
  it('offers no controls at all to a reader who may not edit', async () => {
    await show(SUPPLIER, false);
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Changing it is done by opndoor, or by a director/i);
    // The values are still legible.
    expect(document.querySelector('[aria-label="Sent for referencing: The referrer"]')!.textContent).toBe('Yes');
  });

  it('renders nothing at all where there is no matrix, rather than an empty card', async () => {
    const v = await (async () => {
      vi.spyOn(svc, 'getNotificationMatrix').mockResolvedValue([]);
      vi.spyOn(svc, 'mayEditNotificationMatrix').mockResolvedValue(true);
      const view = render(<ToastProvider><NotificationMatrix party={{ agencyId: 'a-1' }} /></ToastProvider>);
      await act(async () => {});
      return view;
    })();
    expect(v.container.querySelector('.nm-grid')).toBeNull();
  });
});
