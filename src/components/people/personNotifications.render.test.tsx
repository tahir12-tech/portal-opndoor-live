/* WALK FIXES 9, 10 AND 12, ON THE SCREEN.
 *
 * The assembler is tested in src/data/personNotifications.test.ts. This file
 * asserts the four things Matt actually complained about in item 9, each of
 * which is a property of the RENDERED panel and not of the data:
 *
 *   "it isn't clear whose notifications you are changing"
 *        -> the panel names the person, in its title.
 *   "ticked boxes can't be unticked and nothing says why"
 *        -> a locked row prints its reason next to the box.
 *   "the description is repeated"
 *        -> the party-wide warning is said ONCE above the list, not per row.
 *   "headings run into their labels"
 *        -> each section has its own heading element, separate from its rows.
 *
 * And the one thing that is not a complaint but a correctness property: the
 * party-wide warning must appear for an agency and must NOT appear for an
 * Opndoor team member, because Opndoor's alerts really are per person.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as ops from '@/data/opsRoutingService';
import * as matrix from '@/data/notificationMatrixService';
import * as positions from '@/data/positionsService';
import { PersonNotifications } from './PersonNotifications';

const OPS_CELL = {
  alertType: 'deed_chain_failed', label: 'Deed chain failure', group: 'Critical',
  critical: true, typeOrd: 1, recipientKind: 'person' as const, recipientId: 'u-1',
  recipientName: 'Ada', recipientEmail: 'ada@opndoor.co', enabled: true, liveCount: 1,
};
const MATRIX_CELL = {
  notificationType: 'deed_issued', typeLabel: 'Deed issued', typeOrd: 1,
  recipient: 'referrer', recipientLabel: 'The referrer', recipientOrd: 1,
  enabled: true, isDefault: false, locked: true,
};

beforeEach(() => {
  vi.spyOn(positions, 'getNotificationTicks').mockResolvedValue({ 'u-1': true });
  vi.spyOn(positions, 'getCommissionStatementTicks').mockResolvedValue({ 'u-1': false });
  vi.spyOn(matrix, 'mayEditNotificationMatrix').mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(props: Partial<Parameters<typeof PersonNotifications>[0]> = {}) {
  const view = render(
    <ToastProvider>
      <PersonNotifications
        party="agency" partyRef={{ agencyId: 'ag-1' }} userId="u-1"
        personName="Tom Reeve" partyName="Regent's Lettings" canEdit
        onClose={() => {}} {...props}
      />
    </ToastProvider>,
  );
  await waitFor(() => {
    if (document.body.textContent?.includes('Loading')) throw new Error('still loading');
  });
  await act(async () => {});
  return view;
}
const body = () => document.body.textContent ?? '';

describe('an agency person', () => {
  beforeEach(() => {
    vi.spyOn(ops, 'getOpsRoutingMatrix').mockResolvedValue([]);
    vi.spyOn(matrix, 'getNotificationMatrix').mockResolvedValue([MATRIX_CELL]);
  });

  it('names the person, so it is clear whose settings these are', async () => {
    await open();
    expect(body()).toMatch(/Notifications for Tom Reeve/);
  });

  /* THE ONE THAT MATTERS. These switches belong to the agency, and a
     Director must not change one person and silently change everyone. */
  it('says plainly that the event switches belong to the whole agency', async () => {
    await open();
    expect(body()).toMatch(/Regent's Lettings'?s? settings, not\s+this person's/);
    expect(body()).toMatch(/Changing one changes it for everyone here/);
  });

  it('prints the reason beside a locked box rather than just disabling it', async () => {
    const v = await open();
    const box = document.body.querySelector<HTMLInputElement>('input[aria-label="Deed issued to referrer"]');
    expect(box?.disabled).toBe(true);
    expect(body()).toMatch(/executed deed/i);
    void v;
  });

  it('gives each section its own heading, so nothing runs into its labels', async () => {
    await open();
    const heads = [...document.body.querySelectorAll('.pn__h')].map((h) => h.textContent);
    expect(heads).toContain('Copied on referrals');
    expect(heads).toContain('Monthly statements');
    expect(heads).toContain('Events they are told about');
  });

  it('and says the party-wide warning ONCE, not on every row', async () => {
    await open();
    expect(document.body.querySelectorAll('.pn__warn')).toHaveLength(1);
  });
});

describe('an Opndoor team member', () => {
  beforeEach(() => {
    vi.spyOn(ops, 'getOpsRoutingMatrix').mockResolvedValue([OPS_CELL]);
    vi.spyOn(matrix, 'getNotificationMatrix').mockResolvedValue([]);
  });

  /* Their alerts genuinely ARE per person, so the warning would be a lie. */
  it('is NOT told the settings belong to anybody else', async () => {
    await open({ party: 'opndoor', partyRef: undefined, partyName: undefined });
    expect(document.body.querySelectorAll('.pn__warn')).toHaveLength(0);
  });

  it('and the last recipient of a critical alert is locked, with the reason', async () => {
    await open({ party: 'opndoor', partyRef: undefined });
    const box = document.body.querySelector<HTMLInputElement>('input[aria-label="Deed chain failure"]');
    expect(box?.disabled).toBe(true);
    expect(body()).toMatch(/last person or inbox receiving a critical alert/i);
  });

  it('and is offered neither statements nor copied-on-referrals', async () => {
    await open({ party: 'opndoor', partyRef: undefined });
    const heads = [...document.body.querySelectorAll('.pn__h')].map((h) => h.textContent);
    expect(heads).not.toContain('Copied on referrals');
    expect(heads).not.toContain('Monthly statements');
  });
});

describe('a supplier person', () => {
  beforeEach(() => {
    vi.spyOn(ops, 'getOpsRoutingMatrix').mockResolvedValue([]);
    vi.spyOn(matrix, 'getNotificationMatrix').mockResolvedValue([
      { ...MATRIX_CELL, recipient: 'agent_contact', recipientLabel: 'The agent contact', locked: false },
    ]);
  });

  /* B3: the control could never succeed on that rail, so it is not drawn. */
  it('is not offered "copied on referrals", because that rail has no positions', async () => {
    await open({ party: 'supplier', partyRef: { partnerId: 'p-1' }, partyName: 'Kestrel Lettings' });
    const heads = [...document.body.querySelectorAll('.pn__h')].map((h) => h.textContent);
    expect(heads).not.toContain('Copied on referrals');
  });

  it('but is still told its events belong to the supplier', async () => {
    await open({ party: 'supplier', partyRef: { partnerId: 'p-1' }, partyName: 'Kestrel Lettings' });
    expect(body()).toMatch(/Kestrel Lettings/);
    expect(document.body.querySelectorAll('.pn__warn')).toHaveLength(1);
  });
});
