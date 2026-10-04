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
import { shapePanel, whoDecidesThis, whoDecidesCopies } from './personNotifications';
import { readerIsTopOfEstate } from './capabilities';

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

/* WHO DECIDES A SETTING THE READER CANNOT CHANGE.
 *
 * Matt (qq): 'on supplier people, "A Director, or Opndoor, decides this"
 * should say "Management, or opndoor, decides this" (or "opndoor decides
 * this" when it's a peer the viewer can't change)'.
 *
 * TWO FAULTS IN ONE SENTENCE, and the parenthesis is the harder one. The
 * first is the agency ladder in supplier copy -- the fifth site of that
 * today. The second is that naming Management to somebody who IS Management
 * is a dead end: they look round the room and find the only Management is
 * them and the colleague whose row they are reading.
 *
 * ON THE SUPPLIER RAIL THAT IS ALWAYS THE CASE for a Management reader,
 * because Management is the top of that ladder. On the agency rail it
 * depends: a Manager has a Director above them, a Director does not.
 */
describe('whoDecidesThis', () => {
  it('names the agency ladder to an agency reader', () => {
    expect(whoDecidesThis('agency')).toBe('A Director, or opndoor, decides this.');
  });

  it('and the supplier ladder to a supplier reader, in lowercase opndoor', () => {
    expect(whoDecidesThis('supplier')).toBe('Management, or opndoor, decides this.');
    expect(whoDecidesThis('supplier')).not.toContain('Director');
    expect(whoDecidesThis('supplier')).not.toContain('Opndoor');
  });

  /* THE PEER CASE. A supplier's Management reading another Management's row
     is Matt's exact scenario, and "Management decides this" tells them to
     ask themselves. */
  it('but names opndoor alone when the reader is already the top', () => {
    expect(whoDecidesThis('supplier', true)).toBe('opndoor decides this.');
    expect(whoDecidesThis('agency', true)).toBe('opndoor decides this.');
  });

  /* OPNDOOR'S OWN STAFF are not on a customer ladder at all, whichever way
     the viewer flag is set. */
  it('and always for opndoor staff, who have no customer ladder', () => {
    expect(whoDecidesThis('opndoor')).toBe('opndoor decides this.');
    expect(whoDecidesThis('opndoor', false)).toBe('opndoor decides this.');
  });

  it('with the copies sentence following the same two rules', () => {
    expect(whoDecidesCopies('agency')).toBe('A Director decides who is copied in.');
    expect(whoDecidesCopies('supplier')).toBe('Management decides who is copied in.');
    expect(whoDecidesCopies('supplier', true)).toBe('opndoor decides who is copied in.');
  });
});

/* AND WHO COUNTS AS THE TOP, which is the fact the sentence turns on.
 * The two ladders END differently and that is the whole of it. */
describe('readerIsTopOfEstate', () => {
  it('a supplier Management is the top of their rail', () => {
    expect(readerIsTopOfEstate('management', false, 'harbourside')).toBe(true);
  });

  it('an agency Director is, and an agency Manager is not', () => {
    expect(readerIsTopOfEstate('management', true, 'opndoor-agents')).toBe(true);
    expect(readerIsTopOfEstate('management', false, 'opndoor-agents')).toBe(false);
  });

  /* A REFERRER IS NEVER THE TOP, on either rail, however the other two
     arguments fall. */
  it('and a referrer never is, on either rail', () => {
    expect(readerIsTopOfEstate('referrer', false, 'harbourside')).toBe(false);
    expect(readerIsTopOfEstate('referrer', true, 'opndoor-agents')).toBe(false);
  });
});
