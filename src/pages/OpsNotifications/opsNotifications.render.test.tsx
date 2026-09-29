/* THE ROUTING PAGE DRAWS THE SERVER'S ANSWER, AND SHOWS THE FLOOR.
 *
 * Q-04. The behaviour -- routing, the floor on a critical type, deactivation
 * and who may change it -- is asserted in
 * supabase/tests/who_opndoor_tells.test.sql, where it is enforced. This
 * asserts the screen: that it holds no list of its own, that the last live
 * recipient of a critical alert is drawn locked rather than as a control that
 * errors, and that an opndoor_manager gets values and not controls.
 *
 * The service is mocked and fed a shape the real server does not currently
 * return -- a group with one type, a recipient absent from one row -- because
 * that is how you tell a page that reads its input from one that has
 * memorised the answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { SessionProvider } from '@/session/SessionContext';
import * as svc from '@/data/opsRoutingService';
import { OpsNotifications } from './OpsNotifications';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cell = (
  type: string, label: string, group: string, critical: boolean, ord: number,
  kind: 'person' | 'inbox', id: string, name: string,
  enabled: boolean, liveCount: number,
): svc.OpsRouteCell => ({
  alertType: type, label, group, critical, typeOrd: ord,
  recipientKind: kind, recipientId: id, recipientName: name,
  recipientEmail: `${id}@o.test`, enabled, liveCount,
});

/* One critical with TWO live recipients (so neither is the last), one
   critical with ONE (so that one is locked), and one Information type. */
const MATRIX: svc.OpsRouteCell[] = [
  cell('deed_claim_failed', 'Deed could not be claimed', 'Critical', true, 1, 'inbox', 'desk', 'Ops Desk', true, 2),
  cell('deed_claim_failed', 'Deed could not be claimed', 'Critical', true, 1, 'person', 'ada', 'Ada', true, 2),
  cell('deed_void_failed', 'Deed could not be voided', 'Critical', true, 2, 'inbox', 'desk', 'Ops Desk', true, 1),
  cell('deed_void_failed', 'Deed could not be voided', 'Critical', true, 2, 'person', 'ada', 'Ada', false, 1),
  cell('hubspot_map_drift', 'CRM mapping has drifted', 'Information', false, 50, 'inbox', 'desk', 'Ops Desk', false, 0),
  cell('hubspot_map_drift', 'CRM mapping has drifted', 'Information', false, 50, 'person', 'ada', 'Ada', false, 0),
];

async function show(role: 'superadmin' | 'opndoor_manager', cells = MATRIX) {
  localStorage.setItem('grp_role', role);
  vi.spyOn(svc, 'getOpsRoutingMatrix').mockResolvedValue(cells);
  const view = render(
    <MemoryRouter>
      <ToastProvider><SessionProvider><PageMetaProvider><OpsNotifications /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('.on-grid')) throw new Error('not drawn'); });
  await act(async () => {});
  return view;
}

const box = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe('the internal notifications page', () => {
  it('groups the alerts the way the server grouped them', async () => {
    await show('superadmin');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Critical/);
    expect(text).toMatch(/Information/);
    // Two cards of alerts, because only two groups were returned.
    expect(document.querySelectorAll('.on-grid').length).toBe(2);
  });

  it('draws one column per recipient and marks a shared inbox as shared', async () => {
    await show('superadmin');
    const heads = [...document.querySelectorAll('.on-grid')[0].querySelectorAll('thead th')]
      .map((t) => t.textContent);
    expect(heads[0]).toBe('Alert');
    expect(heads.join(' ')).toMatch(/Ops Desk/);
    expect(heads.join(' ')).toMatch(/shared/);
  });

  /* THE FLOOR, SHOWN. */
  it('locks the last live recipient of a critical alert, with the reason', async () => {
    await show('superadmin');
    const locked = box('Deed could not be voided: Ops Desk (locked: last recipient)');
    expect(locked).toBeTruthy();
    expect(locked!.disabled).toBe(true);
    expect(locked!.closest('label')!.getAttribute('title')).toMatch(/last person or inbox/i);
  });

  it('and does not lock one that has a second recipient beside it', async () => {
    await show('superadmin');
    const free = box('Deed could not be claimed: Ops Desk');
    expect(free).toBeTruthy();
    expect(free!.disabled).toBe(false);
  });

  it('says on the row when a critical alert is down to its last', async () => {
    await show('superadmin');
    expect(document.body.textContent).toMatch(/last one/i);
  });

  /* THE WRITE. */
  it('routes a change through set_ops_route with the cell it changed', async () => {
    const set = vi.spyOn(svc, 'setOpsRoute').mockResolvedValue(undefined);
    await show('superadmin');
    await act(async () => { fireEvent.click(box('CRM mapping has drifted: Ada')!); });
    await waitFor(() => expect(set).toHaveBeenCalled());
    expect(set.mock.calls.at(-1)).toEqual(['hubspot_map_drift', 'person', 'ada', true]);
  });

  /* SUPERADMIN EDITS, opndoor_manager VIEWS. */
  it('gives an opndoor_manager the values and no controls', async () => {
    await show('opndoor_manager');
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Changing it is done by an opndoor admin/i);
    expect(document.querySelector('[aria-label="Deed could not be claimed: Ada"]')!.textContent).toBe('Yes');
  });

  it('says plainly when there is nobody to route to, rather than drawing an empty grid', async () => {
    localStorage.setItem('grp_role', 'superadmin');
    vi.spyOn(svc, 'getOpsRoutingMatrix').mockResolvedValue([]);
    const v = render(
      <MemoryRouter>
        <ToastProvider><SessionProvider><PageMetaProvider><OpsNotifications /></PageMetaProvider></SessionProvider></ToastProvider>
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(v.container.querySelector('.on-grid')).toBeNull();
    expect(document.body.textContent).toMatch(/nobody to route alerts to yet/i);
  });
});
