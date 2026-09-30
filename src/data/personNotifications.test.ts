/* WALK FIXES 9, 10 AND 12. ONE PER-PERSON NOTIFICATIONS PANEL, THREE PARTIES.
 *
 * Matt: "notifications move onto each person, like permissions, reached from
 * their row. For each person, one panel showing: whether they're copied on
 * referrals within their position, which events they're told about, and
 * whether they get monthly statements... Build items 10 and 12 as one shared
 * design so Opndoor team and agency people work the same way; suppliers too."
 *
 * WHY A PURE FUNCTION AND NOT JUST A COMPONENT. The hard part is not drawing
 * the panel, it is that the three parties have DIFFERENT SERVER MODELS
 * underneath and the panel has to be honest about that:
 *
 *   Opndoor         ops_routing_matrix     keyed by alert x RECIPIENT  -> per person
 *   agency/supplier notification_matrix    keyed by event x recipient CLASS -> party-wide
 *
 * So "which events they're told about" is a fact about the PERSON on one side
 * and a fact about the WHOLE AGENCY on the other. Assembling that in the
 * component would bury the distinction in JSX; assembling it here makes it
 * something a test can hold to account.
 *
 * THE ASSERTION THAT MATTERS MOST is `partyWide`. Get it wrong and a Director
 * edits one person's panel and silently changes what every colleague
 * receives. That is precisely the class of surprise the walk keeps turning
 * up, and it would be introduced deliberately rather than by accident.
 *
 * LOCKED CELLS ARE A REASON, NOT A BOOLEAN. Item 9's complaint is that boxes
 * could not be unticked and "nothing says why". So a locked row carries the
 * sentence to print, and a row that is merely off carries null -- the panel
 * cannot render a lock without also having the reason to hand.
 */
import { describe, expect, it } from 'vitest';
import { buildPersonPanel } from './personNotifications';
import type { OpsRouteCell } from './opsRoutingService';
import type { MatrixCell } from './notificationMatrixService';

const opsCell = (o: Partial<OpsRouteCell>): OpsRouteCell => ({
  alertType: 'deed_chain_failed', label: 'Deed chain failure', group: 'Critical',
  critical: true, typeOrd: 1, recipientKind: 'person', recipientId: 'u-1',
  recipientName: 'Ada', recipientEmail: 'ada@opndoor.co', enabled: true, liveCount: 2, ...o,
});

const matrixCell = (o: Partial<MatrixCell>): MatrixCell => ({
  notificationType: 'deed_issued', typeLabel: 'Deed issued', typeOrd: 1,
  recipient: 'ticked_users', recipientLabel: 'Users ticked Receives notifications',
  recipientOrd: 2, enabled: true, isDefault: false, locked: false, ...o,
});

describe('an Opndoor team member', () => {
  const panel = () => buildPersonPanel({
    party: 'opndoor',
    userId: 'u-1',
    copiedOnReferrals: null,
    getsStatements: null,
    ops: [
      opsCell({ alertType: 'a', label: 'Deed chain failure', recipientId: 'u-1', enabled: true, liveCount: 2 }),
      opsCell({ alertType: 'b', label: 'Sync failure', recipientId: 'u-1', enabled: false, critical: false, liveCount: 3 }),
      opsCell({ alertType: 'c', label: 'Somebody else only', recipientId: 'u-2', enabled: true }),
    ],
    matrix: [],
  });

  it('is shown only the alerts routed to THEM, not the whole grid', () => {
    expect(panel().events.map((e) => e.label)).toEqual(['Deed chain failure', 'Sync failure']);
  });

  /* THE ONE THAT PREVENTS THE SILENT CROSS-PERSON EDIT. */
  it('and each of those is genuinely their own setting', () => {
    expect(panel().events.every((e) => e.partyWide === false)).toBe(true);
  });

  it('has no "copied on referrals" or "statements" section, because neither applies', () => {
    expect(panel().copied).toBeNull();
    expect(panel().statements).toBeNull();
  });
});

describe('the floor on a critical alert', () => {
  /* Matt: "where a box can't be unticked because that person is the only
     recipient, say so plainly next to it." */
  it('locks the last recipient of a critical alert, WITH the reason', () => {
    const p = buildPersonPanel({
      party: 'opndoor', userId: 'u-1', copiedOnReferrals: null, getsStatements: null,
      ops: [opsCell({ recipientId: 'u-1', critical: true, enabled: true, liveCount: 1 })],
      matrix: [],
    });
    expect(p.events[0].locked).toMatch(/last person or inbox/i);
  });

  it('but not while somebody else also receives it', () => {
    const p = buildPersonPanel({
      party: 'opndoor', userId: 'u-1', copiedOnReferrals: null, getsStatements: null,
      ops: [opsCell({ recipientId: 'u-1', critical: true, enabled: true, liveCount: 2 })],
      matrix: [],
    });
    expect(p.events[0].locked).toBeNull();
  });

  it('and never locks a non-critical alert, however few receive it', () => {
    const p = buildPersonPanel({
      party: 'opndoor', userId: 'u-1', copiedOnReferrals: null, getsStatements: null,
      ops: [opsCell({ recipientId: 'u-1', critical: false, enabled: true, liveCount: 1 })],
      matrix: [],
    });
    expect(p.events[0].locked).toBeNull();
  });
});

describe('an agency person', () => {
  const panel = (over: Partial<Parameters<typeof buildPersonPanel>[0]> = {}) => buildPersonPanel({
    party: 'agency',
    userId: 'u-9',
    copiedOnReferrals: true,
    getsStatements: false,
    ops: [],
    matrix: [
      matrixCell({ notificationType: 'deed_issued', typeLabel: 'Deed issued', recipient: 'referrer', recipientLabel: 'The referrer', locked: true }),
      matrixCell({ notificationType: 'paid', typeLabel: 'Paid', recipient: 'ticked_users', enabled: false }),
    ],
    ...over,
  });

  it('gets all three sections, because all three apply to them', () => {
    const p = panel();
    expect(p.copied?.on).toBe(true);
    expect(p.statements?.on).toBe(false);
    expect(p.events.length).toBe(2);
  });

  /* THE HONEST HALF. These switches are the AGENCY's, not this person's, and
     the panel has to say so or a Director will change everyone by accident. */
  it('and every event switch is marked as affecting everyone at the agency', () => {
    expect(panel().events.every((e) => e.partyWide === true)).toBe(true);
  });

  it('shows a locked event with its reason rather than a bare disabled box', () => {
    const locked = panel().events.find((e) => e.locked);
    expect(locked?.label).toBe('Deed issued');
    expect(locked?.locked).toMatch(/executed deed/i);
  });

  it('and an event that is simply off is off, not locked', () => {
    const off = panel().events.find((e) => e.label === 'Paid');
    expect(off?.on).toBe(false);
    expect(off?.locked).toBeNull();
  });
});

describe('a supplier person', () => {
  /* B3: the supplier rail has no positions, so "copied on referrals within
     their position" cannot mean anything there and must not be offered.
     Offering a control that always fails is worse than offering none. */
  it('is not offered "copied on referrals", because that rail has no positions', () => {
    const p = buildPersonPanel({
      party: 'supplier', userId: 'u-3', copiedOnReferrals: true, getsStatements: true,
      ops: [], matrix: [matrixCell({ recipient: 'agent_contact', recipientLabel: 'The agent contact' })],
    });
    expect(p.copied).toBeNull();
  });

  it('but does get statements and events', () => {
    const p = buildPersonPanel({
      party: 'supplier', userId: 'u-3', copiedOnReferrals: null, getsStatements: true,
      ops: [], matrix: [matrixCell({ recipient: 'agent_contact' })],
    });
    expect(p.statements?.on).toBe(true);
    expect(p.events.length).toBe(1);
  });
});

describe('the panel never invents anything', () => {
  it('renders empty rather than guessing when the server returned nothing', () => {
    const p = buildPersonPanel({
      party: 'agency', userId: 'u-1', copiedOnReferrals: null, getsStatements: null,
      ops: [], matrix: [],
    });
    expect(p.events).toEqual([]);
    expect(p.copied).toBeNull();
    expect(p.statements).toBeNull();
  });
});
