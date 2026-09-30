/* THE PANEL'S SHAPE, AND THE THREE ANSWERS IT HAS TO CARRY.
 *
 * Rewritten after Matt's ruling of 2026-09-30 made notifications genuinely
 * per person. The previous version of this file tested an assembler that
 * merged two matrices and carried a `partyWide` flag; there is no party-wide
 * anything now, so those assertions are gone rather than left passing
 * vacuously. That is why the count moved.
 *
 * WHAT IS LEFT IS THE PART THAT CAN STILL BE WRONG: turning the server's
 * jsonb into the shape the screen draws. The server decides everything
 * substantive -- what may be changed, what is locked, what applies -- so the
 * only defect this layer can introduce is losing one of those answers on the
 * way through. Each assertion is one answer that must survive.
 */
import { describe, expect, it } from 'vitest';
import { shapePanel } from './personNotifications';

const RAW = {
  user_id: 'u-1',
  name: 'Tom Reeve',
  party_kind: 'agency',
  events: [
    { type: 'deed_issued', label: 'Deed issued', enabled: true, locked: true,
      lock_reason: 'The executed deed always reaches the person it is addressed to. That cannot be switched off.' },
    { type: 'paid', label: 'Paid', enabled: false, locked: false, lock_reason: null },
  ],
  may_edit_events: true,
  copied_applies: true, copied_on: false, may_edit_copied: false,
  statements_apply: false, statements_on: false, may_edit_statements: false,
};

describe('the three sections answer separately', () => {
  /* A Negotiator reading their own panel: yes to events, no to the other
     two. No single boolean can say that, which is the whole shape. */
  it('keeps a different answer per section', () => {
    const p = shapePanel(RAW);
    expect(p.mayEditEvents).toBe(true);
    expect(p.mayEditCopied).toBe(false);
    expect(p.mayEditStatements).toBe(false);
  });

  it('and keeps "does this apply" separate from "may you change it"', () => {
    const p = shapePanel({ ...RAW, statements_apply: false, may_edit_statements: true });
    expect(p.statementsApply).toBe(false);
    expect(p.mayEditStatements).toBe(true);
  });
});

describe('a locked event', () => {
  it('arrives with the sentence to print, not a bare flag', () => {
    const locked = shapePanel(RAW).events.find((e) => e.type === 'deed_issued');
    expect(locked?.lockReason).toMatch(/executed deed/i);
  });

  it('while one that is merely off carries no reason', () => {
    const off = shapePanel(RAW).events.find((e) => e.type === 'paid');
    expect(off?.lockReason).toBeNull();
    expect(off?.enabled).toBe(false);
  });

  /* A lock with no sentence would let the panel render exactly the thing
     item 9 complained about: a box you cannot untick and nothing saying
     why. Treated as no lock rather than a silent one. */
  it('and a lock with an empty reason is not treated as a lock', () => {
    const p = shapePanel({ ...RAW, events: [{ type: 'x', label: 'X', enabled: true, locked: true, lock_reason: '' }] });
    expect(p.events[0].lockReason).toBeNull();
  });
});

describe('nothing is invented', () => {
  it('an empty reply renders empty rather than guessing', () => {
    const p = shapePanel({});
    expect(p.events).toEqual([]);
    expect(p.mayEditEvents).toBe(false);
    expect(p.copiedApplies).toBe(false);
    expect(p.statementsApply).toBe(false);
  });

  /* Absent is false, never true. Everything here gates a control, so a
     missing field must close it, not open it. */
  it('and a missing permission flag closes the control', () => {
    const p = shapePanel({ user_id: 'u-9', events: [] });
    expect(p.mayEditEvents).toBe(false);
    expect(p.mayEditCopied).toBe(false);
    expect(p.mayEditStatements).toBe(false);
  });
});
