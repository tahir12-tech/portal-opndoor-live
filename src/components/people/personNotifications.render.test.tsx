/* WALK FIXES 9, 10 AND 12, ON THE SCREEN.
 *
 * Rewritten after Matt's ruling of 2026-09-30 made notifications genuinely
 * per person. The previous version of this file asserted, in two places, that
 * the panel printed a party-wide warning: "these are the agency's settings,
 * not this person's. Changing one changes it for everyone here." That
 * sentence was TRUE of the old storage and is FALSE now, so those two
 * assertions are deleted rather than inverted, along with the third that
 * counted the warning on the supplier rail. Three assertions removed, four
 * added for the permissions the server now returns. That is why the count
 * moved.
 *
 * The shaping of the server's reply is tested in
 * src/data/personNotifications.test.ts. This file asserts what is true only
 * once the panel is DRAWN, which is the rest of item 9:
 *
 *   "it isn't clear whose notifications you are changing"
 *        -> the panel names the person, in its title.
 *   "ticked boxes can't be unticked and nothing says why"
 *        -> a locked row prints its reason next to the box.
 *   "headings run into their labels"
 *        -> each section has its own heading element, separate from its rows.
 *
 * Plus the property that replaced the warning: a control the caller may not
 * change is disabled AND says who may, and a section that does not apply to
 * this person is absent rather than greyed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as data from '@/data/personNotifications';
import { EMPTY_PANEL, type PersonPanel } from '@/data/personNotifications';
import { PersonNotifications } from './PersonNotifications';

const LOCKED_REASON =
  'The executed deed always reaches the person it is addressed to. That cannot be switched off.';

/** A Director looking at one of their Negotiators: everything open. */
const DIRECTOR_VIEW: PersonPanel = {
  ...EMPTY_PANEL,
  userId: 'u-1', name: 'Tom Reeve', partyKind: 'agency',
  events: [
    { type: 'deed_issued', label: 'Deed issued', enabled: true, lockReason: LOCKED_REASON },
    { type: 'paid', label: 'Payment received', enabled: false, lockReason: null },
  ],
  mayEditEvents: true,
  copiedApplies: true, copiedOn: false, mayEditCopied: true,
  statementsApply: true, statementsOn: true, mayEditStatements: true,
};

function panel(over: Partial<PersonPanel> = {}) {
  vi.spyOn(data, 'getPersonPanel').mockResolvedValue({ ...DIRECTOR_VIEW, ...over });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  const view = render(
    <ToastProvider>
      <PersonNotifications userId="u-1" personName="Tom Reeve" onClose={() => {}} />
    </ToastProvider>,
  );
  await waitFor(() => {
    if (document.body.textContent?.includes('Loading')) throw new Error('still loading');
  });
  await act(async () => {});
  return view;
}
const body = () => document.body.textContent ?? '';
const heads = () => [...document.body.querySelectorAll('.pn__h')].map((h) => h.textContent);
const box = (label: string) =>
  document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe('a Director looking at one of their people', () => {
  beforeEach(() => { panel(); });

  it('names the person, so it is clear whose settings these are', async () => {
    await open();
    expect(body()).toMatch(/Notifications for Tom Reeve/);
  });

  it('prints the reason beside a locked box rather than just disabling it', async () => {
    await open();
    expect(box('Deed issued')?.disabled).toBe(true);
    expect(body()).toMatch(/executed deed/i);
  });

  it('gives each section its own heading, so nothing runs into its labels', async () => {
    await open();
    expect(heads()).toContain('Copied on colleagues’ referrals');
    expect(heads()).toContain('Monthly statements');
    expect(heads()).toContain('Events they are told about');
  });

  it('and leaves open every box the server said they may change', async () => {
    await open();
    expect(box('Payment received')?.disabled).toBe(false);
    expect(box('Receives notifications')?.disabled).toBe(false);
    expect(box('Receives commission statements')?.disabled).toBe(false);
  });
});

/* THE CASE THE WHOLE PER-SECTION SHAPE EXISTS FOR. One panel, three
   different answers: a Negotiator may change their own events but neither
   of the two Director-only settings. */
describe('a Negotiator looking at their own panel', () => {
  beforeEach(() => {
    panel({
      mayEditEvents: true,
      copiedApplies: true, copiedOn: true, mayEditCopied: false,
      statementsApply: false, statementsOn: false, mayEditStatements: false,
    });
  });

  it('may still change their own event choices', async () => {
    await open();
    expect(box('Payment received')?.disabled).toBe(false);
  });

  /* A disabled box with no explanation is precisely what item 9 objected
     to, so the reason has to be on the screen, not only in the tooltip. */
  it('but cannot change whether they are copied in, and is told who can', async () => {
    await open();
    expect(box('Receives notifications')?.disabled).toBe(true);
    expect(body()).toMatch(/A Director decides who is copied in/);
  });

  /* ABSENT, NOT GREYED. Their level cannot receive a statement at all, and
     a disabled control would imply somebody could switch it on. */
  it('and is not offered monthly statements at all, because their level cannot have one', async () => {
    await open();
    expect(heads()).not.toContain('Monthly statements');
    expect(box('Receives commission statements')).toBeNull();
  });
});

describe('a supplier person', () => {
  /* B3: the supplier rail has no positions, so there is nothing to be
     copied in "within". The control could never succeed, so it is absent. */
  it('is not offered "copied on colleagues’ referrals"', async () => {
    panel({ partyKind: 'supplier', copiedApplies: false, mayEditCopied: false });
    await open();
    expect(heads()).not.toContain('Copied on colleagues’ referrals');
  });
});

/* =====================================================================
   AN OPNDOOR TEAM MEMBER READS OPNDOOR'S ALERTS, 2026-09-30.

   Matt, verbatim: "for an Opndoor staff member it shows only Opndoor's
   internal alerts (the ones the old Internal notifications page
   listed), grouped Critical, Operations, Commercial, Information, each
   switchable per person, with the rule that a critical alert can never
   be left with nobody explained beside any box that can't be unticked.
   It must not show the agency sections ("Copied on colleagues'
   referrals", referral events)."

   THIS BLOCK USED TO ASSERT A RENAMED HEADING, and that is the whole
   reason the instruction exists. The panel gave an Opndoor person the
   AGENCY event list under the words "Internal alerts they receive": the
   heading was Opndoor's and the rows underneath were referral events of
   an estate that is not theirs. An assertion on the heading passed
   happily over it.
   ===================================================================== */
const OPNDOOR_VIEW: Partial<PersonPanel> = {
  partyKind: 'opndoor',
  // The server returns none for an Opndoor person: referral events are
  // not theirs. Kept non-empty here on purpose, so the test proves the
  // panel DOES NOT DRAW them rather than proving the fixture is empty.
  events: [{ type: 'paid', label: 'Payment received', enabled: true, lockReason: null }],
  copiedApplies: false, statementsApply: false,
  mayEditInternal: true,
  internal: [
    { type: 'deed_claim_failed', label: 'Deed could not be claimed after payment', group: 'Critical', critical: true, enabled: true, lockReason: 'This is the only place this critical alert goes. Add another recipient before switching it off here.' },
    { type: 'deed_void_failed', label: 'Deed could not be voided after a refund', group: 'Critical', critical: true, enabled: true, lockReason: null },
    { type: 'cron_error', label: 'A scheduled job threw', group: 'Operations', critical: false, enabled: false, lockReason: null },
    { type: 'lapse', label: 'A guarantee lapsed', group: 'Commercial', critical: false, enabled: true, lockReason: null },
    { type: 'hubspot_map_drift', label: 'CRM mapping has drifted', group: 'Information', critical: false, enabled: false, lockReason: null },
  ],
};

describe('an Opndoor team member', () => {
  it('gets the four groups the old Internal notifications page had', async () => {
    panel(OPNDOOR_VIEW);
    await open();
    expect(heads()).toContain('Critical');
    expect(heads()).toContain('Operations');
    expect(heads()).toContain('Commercial');
    expect(heads()).toContain('Information');
  });

  /* THE HALF THE OLD ASSERTION MISSED. */
  it('and none of the agency sections', async () => {
    panel(OPNDOOR_VIEW);
    await open();
    expect(heads()).not.toContain('Copied on colleagues’ referrals');
    expect(heads()).not.toContain('Events they are told about');
    // The referral event in the fixture must not be drawn.
    expect(body()).not.toMatch(/Payment received/);
  });

  it('and the alerts themselves, switchable', async () => {
    panel(OPNDOOR_VIEW);
    await open();
    expect(body()).toMatch(/A scheduled job threw/);
    /* THROUGH document.body, NOT the render container: Modal draws into a
       portal, so the container is empty and every assertion against it
       passes for the wrong reason. The helpers above already knew this
       and my first draft did not use them. */
    expect(document.body.querySelectorAll('.pn__row--ev input').length).toBe(5);
    const cron = box('A scheduled job threw')!;
    expect(cron.disabled).toBe(false);
    expect(cron.checked).toBe(false);
  });

  /* THE RULE, EXPLAINED BESIDE THE BOX. Matt's words, and item 9's
     original complaint: a dead control with no sentence reads as a bug. */
  it('and the last recipient of a critical alert is locked, with the reason', async () => {
    panel(OPNDOOR_VIEW);
    await open();
    expect(box('Deed could not be claimed after payment')!.disabled).toBe(true);
    expect(body()).toMatch(/only place this critical alert goes/);
  });

  it('while a critical alert with somebody else on it can still be switched off', async () => {
    panel(OPNDOOR_VIEW);
    await open();
    expect(box('Deed could not be voided after a refund')!.disabled).toBe(false);
  });
});

describe('when the server refuses the read', () => {
  /* Matt's rule for agency users, walk fix 14: an error a person can act
     on. A blank panel with no sentence reads as a broken screen. */
  it('says so rather than drawing an empty panel', async () => {
    vi.spyOn(data, 'getPersonPanel').mockRejectedValue(
      new Error('You can only see this for yourself, or for people at or below you in your own agency.'));
    await open();
    expect(body()).toMatch(/only see this for yourself/);
    expect(document.body.querySelectorAll('.pn__row')).toHaveLength(0);
  });
});
